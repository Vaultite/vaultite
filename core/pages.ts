// Plugins' pages are built in: each template (a plugin's pages/*.md, the core's Design) is kept in PAGES_DIR while its
// plugin is on, the template as it is now (they update with the plugin), read-only. Copy to my vault makes one the
// user's (`copyPage`): from then on their file wins and the built-in one goes. Nothing is written outside .vaultite/.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { enabled, HTTPError, type Plugin, ROOT, service } from "./plugins.ts"
import { homeFolder, inPagesDir, PAGES_DIR } from "./fileprops.ts"
import { tabHead, tabNames } from "./tabs.ts"
import { FM, readText, statFrom, type Vault, writeAtomic, writeNew } from "./vault.ts"
import { load } from "./yaml.ts"

const FOLDER = "Dashboards"

/** The core's own pages (Design: every block and piece of Markdown the app draws), shipped like a plugin's. */
const CORE = path.join(ROOT, "core")

/** [plugin id ("core" for the core's), template path (Dashboards/<name>.md), template text] for the core's pages/*.md,
 *  then every plugin's, in plugin order. */
export function templates(plugins: Plugin[]): [string, string, string][] {
  const out: [string, string, string][] = []
  for (const p of [{ id: "core", dir: CORE }, ...plugins]) {
    const dir = path.join(p.dir, "pages")
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".md") && !n.startsWith(".")).sort() : []
    for (const n of names) out.push([p.id, `${FOLDER}/${n}`, readText(path.join(dir, n))])
  }
  return out
}

/** The templates the vault has had built in. */
const HAD = ".vaultite/generated/pages.json"
const readList = (p: string): string[] => {
  try { const v = JSON.parse(readText(p)); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [] } catch { return [] }
}

/** The templates a vault from before pages were built in had copied in (its versions.json). */
const oldVersions = (vault: Vault) => {
  try { const v = JSON.parse(readText(vault.abs(".vaultite/generated/versions.json"))); return v && typeof v === "object" ? Object.keys(v) : [] } catch { return [] }
}

/** Where a template's built-in page is. */
export const builtIn = (rel: string) => `${PAGES_DIR}/${rel}`

function read(p: string) {
  try {
    return readText(p)
  } catch {
    return null
  }
}

const hash = (text: string) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 16)
const fmOf = (text: string): Record<string, unknown> => {
  try { const m = FM.exec(text); const fm = m && load(m[1]); return fm && typeof fm === "object" && !Array.isArray(fm) ? fm as Record<string, unknown> : {} } catch { return {} }
}
const pluginOf = (fm: Record<string, unknown>) => (typeof fm.plugin === "string" ? fm.plugin.trim() : "")
const isDashboard = (fm: Record<string, unknown>) => typeof fm.type === "string" && fm.type.trim().toLowerCase() === "dashboard"
const baseName = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1)

const SKIP = new Set(["node_modules", "__pycache__"])

/** The user's own copy of each template, if they have one: a dashboard of the same plugin by the same name among their
 *  files (hidden folders left out: the trash, PAGES_DIR), or one iCloud holds for now (nothing is made over it). One
 *  without `plugin:` (the core's page, an older copy) is matched by its icon. Read from disk: the index may lag. */
export function copies(vault: Vault, list: [string, string, string][]): Map<string, string> {
  const want = new Map<string, [string, string][]>() // file name -> its templates [path, text]
  for (const [, rel, text] of list) want.set(baseName(rel), [...(want.get(baseName(rel)) ?? []), [rel, text]])
  const found: [string, string, boolean][] = [] // [name, path, evicted]
  const stack = [""]
  while (stack.length) {
    const sub = stack.pop()!
    let names: fs.Dirent[]
    try { names = fs.readdirSync(vault.abs(sub), { withFileTypes: true }) } catch { continue }
    for (const d of names) {
      const rel = sub ? `${sub}/${d.name}` : d.name
      if (d.isDirectory()) { if (!d.name.startsWith(".") && !SKIP.has(d.name)) stack.push(rel); continue }
      const evicted = /^\..+\.md\.icloud$/.test(d.name), name = evicted ? d.name.slice(1, -7) : d.name
      if (want.has(name) && (evicted || !d.name.startsWith("."))) found.push([name, sub ? `${sub}/${name}` : name, evicted])
    }
  }
  found.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  const out = new Map<string, string>()
  for (const [name, at, evicted] of found) {
    const fm = evicted ? null : fmOf(read(vault.abs(at)) ?? "")
    if (fm && !isDashboard(fm)) continue
    for (const [rel, text] of want.get(name)!) {
      const own = pluginOf(fmOf(text))
      // (a copy from an older template may have no `plugin:`: then its icon says)
      const same = !fm || (pluginOf(fm) ? pluginOf(fm) === own : fm.icon === fmOf(text).icon)
      if (!out.has(rel) && same) { out.set(rel, at); break }
    }
  }
  return out
}

/** Keep the built-in pages as their templates are now: one for each template of a plugin that's on and the user has no
 *  copy of; none for the others. Returns the pages it made. `pin: false`: Pinned isn't told (a new vault's bundle just
 *  pinned what it wants). */
export function install(vault: Vault, plugins: Plugin[], opts: { pin?: boolean } = {}) {
  const made: string[] = []
  const on = enabled(vault, plugins)
  const all = templates(plugins), list = all.filter(([id]) => id === "core" || on.has(id))
  const mine = copies(vault, list), wanted = new Set<string>()
  // (the pages it has made before: one back with its plugin isn't new, so it isn't pinned again; a vault from before
  // pages were built in had the ones its versions.json names, a page the user deleted among them)
  const had = new Set(fs.existsSync(vault.abs(HAD)) ? readList(vault.abs(HAD)) : oldVersions(vault))
  for (const [, rel, text] of list) {
    if (mine.has(rel)) continue
    const at = builtIn(rel)
    wanted.add(at)
    const cur = read(vault.abs(at))
    if (cur === text) continue
    writeAtomic(vault.abs(at), text)
    if (cur === null && !had.has(rel)) made.push(at)
  }
  const now = [...new Set([...had, ...list.filter(([, rel]) => !mine.has(rel)).map(([, rel]) => rel)])].sort()
  if (now.length !== had.size || !fs.existsSync(vault.abs(HAD))) writeAtomic(vault.abs(HAD), JSON.stringify(now, null, 1) + "\n")
  // (a plugin turned off, or a page the user copied: its built-in one goes; a bundle's own pages there stay)
  for (const [, rel] of all) {
    const at = builtIn(rel)
    if (!wanted.has(at) && fs.existsSync(vault.abs(at))) fs.rmSync(vault.abs(at), { force: true })
  }
  if (opts.pin !== false) installed(vault, plugins, made, list, mine)
  return made
}

/** Where pages the user makes or copies go unless a folder is set: the folder set (folders.json `dashboards`), else the
 *  one most of their dashboards are in, else Dashboards/. */
export const pagesHome = (vault: Vault) => vault.folderSet("dashboards") ??
  homeFolder([...vault.entries.values()].filter((e) => e.fm.type === "dashboard" && !inPagesDir(e.rel)).map((e) => e.rel), FOLDER) ?? FOLDER

/** A page now at `to` instead of `from`, in the index at once (installing next sees it), its pins and links following. */
function moveIn(vault: Vault, from: string, to: string) {
  vault.drop(from)
  vault.read(to, statFrom(fs.statSync(vault.abs(to), { bigint: true })))
  vault.version++
  vault.moved(from, to) // (pinned pages follow: plugin.onMove)
  vault.relink([[from, to]])
}

/** Make a built-in page the user's: copied into `folder` (else where their pages go), its pins and links following it;
 *  the built-in one goes. Returns the copy's path. */
export function copyPage(vault: Vault, page: string, folder?: string | null) {
  if (!inPagesDir(page)) throw new HTTPError(400, `${page} is already yours: only a plugin's built-in page is copied`)
  const text = read(vault.abs(page))
  if (text === null) throw new HTTPError(404, `no page ${page}`)
  const dir = (folder ?? pagesHome(vault)).trim().replace(/^\/+|\/+$/g, "")
  if (dir.split("/").includes("..") || dir.startsWith(".")) throw new HTTPError(400, `${dir}: pick a folder of your vault`)
  const to = dir ? `${dir}/${baseName(page)}` : baseName(page)
  if (!writeNew(vault.abs(to), text)) throw new HTTPError(409, `${to} already exists: pick another folder`)
  fs.rmSync(vault.abs(page), { force: true })
  moveIn(vault, page, to)
  return to
}

/** The pages copied into the vault before pages were built in that the user never changed: their text is a version of
 *  its template the vault had (the copy the app last installed in .vaultite/generated/, the hashes in versions.json),
 *  or the template now. */
export function unedited(vault: Vault, plugins: Plugin[]): { path: string; template: string; plugin: string }[] {
  const on = enabled(vault, plugins)
  const list = templates(plugins).filter(([id]) => id === "core" || on.has(id))
  let seen: Record<string, unknown> = {}
  try { seen = JSON.parse(readText(vault.abs(".vaultite/generated/versions.json"))) } catch { /* none */ }
  const out: { path: string; template: string; plugin: string }[] = []
  for (const [rel, at] of copies(vault, list)) {
    const [plugin, , text] = list.find(([, r]) => r === rel)!
    const mine = read(vault.abs(at))
    if (mine === null) continue
    const known = new Set([hash(text), ...(Array.isArray(seen[rel]) ? seen[rel] as string[] : [])])
    const kept = read(vault.abs(`.vaultite/generated/${rel}`))
    if (kept !== null) known.add(hash(kept))
    if (known.has(hash(mine))) out.push({ path: at, template: rel, plugin })
  }
  return out
}

/** Remove copies the user never edited (`paths`, else all of them): each to the trash, its pins and links moving to the
 *  built-in page that comes back in its place. Returns the copies removed. */
export function uncopy(vault: Vault, plugins: Plugin[], paths?: string[]) {
  const list = unedited(vault, plugins).filter((u) => !paths || paths.includes(u.path))
  const tpl = new Map(templates(plugins).map(([, rel, text]) => [rel, text]))
  for (const u of list) {
    const at = builtIn(u.template)
    writeAtomic(vault.abs(at), tpl.get(u.template)!)
    vault.toTrash(u.path)
    moveIn(vault, u.path, at)
  }
  return list
}

/** What "pages:installed" is told: the pages just made, and every page in its plugin's order (pageSort), with whether
 *  it's another page's tab. Paths are where they are now (the user's copy, or the built-in one). */
export type Installed = { made: string[]; pages: { path: string; plugin: string; tab: boolean }[] }

/** Tell the plugin that's on and offers "pages:installed" (Pinned) which pages there are, and which were just made. */
function installed(vault: Vault, plugins: Plugin[], made: string[], list: [string, string, string][], mine: Map<string, string>) {
  const on = enabled(vault, plugins)
  const fn = service(plugins.filter((p) => on.has(p.id)), "pages:installed")
  if (!fn) return
  const files = list.map(([plugin, rel, text]) => ({ path: rel, plugin, tabs: tabNames(fmOf(text).tabs) }))
  const raw = vault.config("plugins").order
  const order = (Array.isArray(raw) ? raw : []).filter((x) => typeof x === "string")
  const sorts = new Map(plugins.map((p) => [p.id, typeof p.manifest.pageSort === "number" ? p.manifest.pageSort : 1000]))
  const rank = (pid: string) => (order.includes(pid) ? order.indexOf(pid) : order.length + (sorts.get(pid) ?? 1000))
  const pages = files.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f.plugin) - rank(b.f.plugin) || a.i - b.i)
    .map(({ f }) => { const h = tabHead(files, f.path); return { path: mine.get(f.path) ?? builtIn(f.path), plugin: f.plugin, tab: !!h && h.path !== f.path } })
  const info: Installed = { made, pages }
  try { fn(info) } catch (e) { console.error(e) }
}
