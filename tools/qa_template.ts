// What each QA script starts from (tools/qa.ts), made once and copied: the sandbox, Vaultite's own plugins installed and
// allowed, a made-up Vaultite/plugins. Kept under a hash of all that makes it: a change makes another, never a stale one.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { sharedTmp } from "../core/testrun.ts"
import { makeSandbox } from "../core/sandbox.ts"
import { MOVED } from "../core/migrations.ts"
import { trustName } from "../core/trust.ts"
import { quietGrants } from "./qa_grants.ts"
import { officialBundles, officialRepos } from "./test/official.ts"

const ROOT = path.resolve(import.meta.dirname, "..")
const HOME = path.join(sharedTmp(), "vaultite-qa-templates")
/** What the server and vau that make it run, and what they read: the app's code (not the web app's, whose files only
 *  feed text the server writes again when it starts), the sample, the bundles, and this. */
const INPUTS = ["core", "plugins", "examples", "bundles", "bin", "server.ts", "package.json", "package-lock.json",
  "tools/qa.ts", "tools/qa_template.ts", "tools/qa_grants.ts", "tools/test/official.ts", "tools/test/lib.ts", "tools/test/isolate.ts",
  "tools/fixtures/claude"]
/** Unused this long, a template is removed (by the next run that makes one): disk, not freshness, which the key keeps. */
const UNUSED = 2 * 86400_000

/** `day`: the sandbox's today; `plugins`: Vaultite's own plugins the sample turns on, from their checkout `official`. */
export type Variant = { day: string; plugins: boolean; official: string }
/** A vault, its machine state (VAULTITE_LOCAL) and its made-up repositories. */
export type Copy = { vault: string; local: string; repos: string }
/** A server on `at`, its other files under `scratch`; stop() resolves once it exited. */
export type Boot = (at: Copy, scratch: string) => Promise<{ base: string; stop: () => Promise<void> }>

/** Vaultite's own plugins the sandbox turns on that the checkout has. */
function officialIds(v: Variant): string[] {
  if (!v.plugins) return []
  let on: string[] = []
  try { on = JSON.parse(fs.readFileSync(path.join(ROOT, "examples/vault/.vaultite/plugins.json"), "utf8")).enabled ?? [] } catch { /* none */ }
  return Object.keys(MOVED).filter((id) => on.includes(id) && fs.existsSync(path.join(v.official, id, "manifest.json")))
}

/** A hash of every file's path and content under `dirs` (relative to `root`), in a stable order. */
function hashFiles(h: crypto.Hash, root: string, dirs: string[]) {
  const walk = (rel: string) => {
    const abs = path.join(root, rel)
    let st: fs.Stats
    try { st = fs.statSync(abs) } catch { return void h.update(`${rel}\0missing\0`) }
    if (st.isFile()) return void h.update(`${rel}\0`).update(fs.readFileSync(abs)).update("\0")
    for (const n of fs.readdirSync(abs).sort()) if (n !== "node_modules" && n !== ".git" && n !== ".DS_Store") walk(path.join(rel, n))
  }
  dirs.forEach(walk)
}

/** The variant's key: everything it's made of. */
export function keyOf(v: Variant): string {
  const ids = officialIds(v)
  const h = crypto.createHash("sha256").update(JSON.stringify({ day: v.day, ids, official: v.official, node: process.version, os: `${process.platform}-${process.arch}` }))
  hashFiles(h, ROOT, INPUTS)
  hashFiles(h, v.official, ids)
  return h.digest("hex").slice(0, 16)
}

const making = new Map<string, Promise<string>>()
/** The variant's template folder, made first when there's none for its key. */
export function template(v: Variant, boot: Boot): Promise<string> {
  const key = keyOf(v), dir = path.join(HOME, key)
  if (fs.existsSync(dir)) {
    try { fs.utimesSync(dir, new Date(), new Date()) } catch { /* removed meanwhile: made again below */ }
    if (fs.existsSync(dir)) return Promise.resolve(dir)
  }
  let p = making.get(key)
  if (!p) {
    p = make(v, dir, boot).finally(() => making.delete(key))
    making.set(key, p)
  }
  return p
}

async function make(v: Variant, dir: string, boot: Boot): Promise<string> {
  fs.mkdirSync(HOME, { recursive: true })
  prune(path.basename(dir))
  // (made aside and renamed in: another run making the same one at once, or one stopped midway, never shows half of it)
  const work = fs.mkdtempSync(`${dir}.making-`)
  try {
    const at: Copy = { vault: path.join(work, "vault"), local: path.join(work, "local"), repos: path.join(work, "repos") }, { vault, local } = at
    makeSandbox(vault, v.day)
    quietGrants(vault)
    officialRepos(at.repos)
    officialBundles(at.repos)
    const ids = officialIds(v)
    if (ids.length) {
      const server = await boot(at, path.join(work, "scratch"))
      try {
        for (const id of ids) for (const [op, body] of [["plugin.install", { source: path.join(v.official, id) }], ["plugin.enable", { id }]] as const) {
          const r = await fetch(`${server.base}api/ops/${op}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
          if (!r.ok) throw new Error(`QA's template: ${op} ${id} failed: ${(await r.text()).slice(0, 300)}`)
        }
      } finally { await server.stop() }
      // (the machine's side: its caches, and what it allowed, filed under the vault's path, so each copy files it again)
      const trust = path.join(local, "trust", trustName(vault))
      if (fs.existsSync(trust)) fs.copyFileSync(trust, path.join(work, "trust.json"))
      if (fs.existsSync(path.join(local, "cache"))) fs.renameSync(path.join(local, "cache"), path.join(work, "cache"))
    }
    for (const n of ["local", "scratch"]) fs.rmSync(path.join(work, n), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    try { fs.renameSync(work, dir) } catch (e) { if (!fs.existsSync(dir)) throw e }
    return dir
  } finally {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

/** Templates unused for UNUSED, and makings a stopped run left. */
function prune(keep: string) {
  for (const n of fs.readdirSync(HOME)) {
    if (n === keep) continue
    const p = path.join(HOME, n)
    try { if (Date.now() - fs.statSync(p).mtimeMs > (n.includes(".making-") ? 3600_000 : UNUSED)) fs.rmSync(p, { recursive: true, force: true }) } catch { /* gone */ }
  }
}

/** Copy-on-write where the disk can (APFS, Btrfs, XFS), else a plain copy; times kept (the sandbox spreads them out). */
const cp = (from: string, to: string) => fs.cpSync(from, to, { recursive: true, mode: fs.constants.COPYFILE_FICLONE, preserveTimestamps: true })

/** The template in `dir` copied into `into`: a vault, its machine state and the made-up repositories, all its own. */
export function copyTemplate(dir: string, into: string): Copy {
  const out = { vault: path.join(into, "vault"), local: path.join(into, "local"), repos: path.join(into, "repos") }
  cp(path.join(dir, "vault"), out.vault)
  cp(path.join(dir, "repos"), out.repos)
  fs.mkdirSync(out.local, { recursive: true })
  if (fs.existsSync(path.join(dir, "cache"))) cp(path.join(dir, "cache"), path.join(out.local, "cache"))
  if (fs.existsSync(path.join(dir, "trust.json"))) {
    fs.mkdirSync(path.join(out.local, "trust"), { recursive: true })
    fs.copyFileSync(path.join(dir, "trust.json"), path.join(out.local, "trust", trustName(out.vault)))
  }
  return out
}
