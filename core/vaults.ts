// Manage vaults on the web (the desktop app has a server per vault, so 404 there). The list is this machine's; any
// folder can be one (external drives too) but hidden and system ones, so a page on the tailnet can't serve ~/.ssh or /etc.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { HTTPError, LOCAL } from "./plugins.ts"
import { readText, writeAtomic } from "./vault.ts"

type Known = { path: string; name: string }
type Saved = { current?: string; vaults?: Known[] }

const FILE = () => path.join(LOCAL, "vaults.json")
const HOME = os.homedir()

function load(): Saved {
  try {
    const v = JSON.parse(readText(FILE()))
    return v && typeof v === "object" ? v : {}
  } catch {
    return {}
  }
}

function save(s: Saved) {
  writeAtomic(FILE(), JSON.stringify(s, null, 2) + "\n")
}

const nameOf = (p: string) => path.basename(p) || p

/** The vault to serve on start: the last one switched to, if it's still there. */
export function current(fallback: string) {
  const c = load().current
  return c && isDir(c) ? c : fallback
}

function isDir(p: string) {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Folders of the system and of apps' own data: never browsed or served. Cloud drives live in ~/Library, and Linux
 *  mounts drives under /run/media. */
const SYSTEM = ["/System", "/Library", "/Applications", "/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", "/libx32", "/etc",
  "/dev", "/proc", "/sys", "/boot", "/root", "/run", "/srv", "/snap", "/opt", "/cores", "/private/etc", "/private/var", "/var",
  path.join(HOME, "Library"), path.join(HOME, "snap")]
const OPEN_IN_SYSTEM = ["/run/media", path.join(HOME, "Library", "Mobile Documents"), path.join(HOME, "Library", "CloudStorage")]

const inside = (p: string, dir: string) => { const rel = path.relative(dir, p); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)) }

/** Why a folder can't be browsed (or, with `vault`, served), or null. */
export function refused(p: string, { vault = false } = {}): string | null {
  if (p.split(path.sep).some((x) => x.startsWith("."))) return "not inside a hidden folder"
  if (SYSTEM.some((d) => inside(p, d)) && !OPEN_IN_SYSTEM.some((d) => inside(p, d))) return "not a system folder"
  if (vault && path.dirname(p) === p) return "the root folder can't be a vault"
  if (vault && (p === HOME || p === fs.realpathSync(HOME))) return "the home folder itself can't be a vault"
  return null
}

/** A folder that may be browsed or served: absolute, not hidden or the system's, there. */
function safe(p: unknown, { vault = false } = {}) {
  if (typeof p !== "string" || !path.isAbsolute(p)) throw new HTTPError(400, "a full path, please")
  const abs = path.resolve(p)
  let real: string
  try {
    real = fs.realpathSync(abs)
  } catch {
    throw new HTTPError(404, `no folder '${abs}'`)
  }
  // Both the path and where it points (a symlink to iCloud Drive) are checked.
  for (const where of [abs, real]) {
    const why = refused(where, { vault })
    if (why) throw new HTTPError(403, why)
  }
  if (!isDir(real)) throw new HTTPError(404, `no folder '${abs}'`)
  return abs
}

function remember(list: Known[], p: string) {
  return [{ path: p, name: nameOf(p) }, ...list.filter((v) => v.path !== p)]
}

export type Switch = (p: string) => Promise<void>

/** The /api/vaults routes, or undefined when it isn't one. `serving` is the vault being served; `open` switches. */
export async function handle(method: string, parts: string[], query: Record<string, string>, body: Record<string, unknown>,
  serving: string, open: Switch): Promise<unknown> {
  if (parts[0] !== "vaults") return undefined
  const route = parts.slice(1).join("/")
  const s = load()
  const list = (s.vaults ?? []).filter((v) => v && typeof v.path === "string")
  const known = () => ({ current: serving, home: HOME, vaults: list.some((v) => v.path === serving) ? list : remember(list, serving) })
  if (route === "" && method === "GET") return known()
  if (route === "" && method === "DELETE") {
    const p = query.path ?? body.path
    if (p === serving) throw new HTTPError(400, "that's the vault being served; open another one first")
    save({ ...s, vaults: list.filter((v) => v.path !== p) })
    return load()
  }
  if (route === "open" && method === "POST") {
    // One already in the list (or served from the start, maybe through a symlink in a hidden folder) is fine as it is.
    const p = typeof body.path === "string" && (body.path === serving || list.some((v) => v.path === body.path)) && isDir(body.path)
      ? body.path : safe(body.path, { vault: true })
    await open(p)
    save({ current: p, vaults: remember(list.some((v) => v.path === serving) ? list : remember(list, serving), p) })
    return known()
  }
  if (route === "create" && method === "POST") {
    const parent = safe(body.parent)
    const name = String(body.name ?? "").replace(/[/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim()
    if (!name || name.startsWith(".")) throw new HTTPError(400, "the vault needs a name")
    const p = path.join(parent, name)
    if (fs.existsSync(p) && fs.readdirSync(p).length) throw new HTTPError(409, `${p} already exists and isn't empty`)
    fs.mkdirSync(p, { recursive: true })
    await open(p)
    save({ current: p, vaults: remember(list.some((v) => v.path === serving) ? list : remember(list, serving), p) })
    return known()
  }
  if (route === "folders" && method === "GET") {
    const p = safe(query.path || HOME)
    const folders = fs.readdirSync(p, { withFileTypes: true })
      .filter((e) => (e.isDirectory() || (e.isSymbolicLink() && isDir(path.join(p, e.name)))) && !refused(path.join(p, e.name)))
      .map((e) => ({ name: e.name, vault: fs.existsSync(path.join(p, e.name, ".vaultite")) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { path: p, home: HOME, parent: path.dirname(p) === p ? null : path.dirname(p), folders }
  }
  throw new HTTPError(404, "not found")
}
