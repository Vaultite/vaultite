// Plugins' dashboards ship as templates (pages/*.md), copied into the vault once; then the file is the user's. A newer
// template is only offered (updates: the page's bar, the dashboard.update ops); versions are remembered across apps.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { enabled, type Plugin, ROOT, service } from "./plugins.ts"
import { homeFolder, PAGES_DIR } from "./fileprops.ts"
import { tabHead, tabNames } from "./tabs.ts"
import { FM, readText, type Vault, writeAtomic } from "./vault.ts"
import { load } from "./yaml.ts"

const FOLDER = "Dashboards"

/** The core's own pages (Design: every block and piece of Markdown the app draws), shipped like a plugin's. */
const CORE = path.join(ROOT, "core")

/** [plugin id ("core" for the core's), vault path, template text] for the core's pages/*.md, then every plugin's, in
 *  plugin order. */
export function templates(plugins: Plugin[]): [string, string, string][] {
  const out: [string, string, string][] = []
  for (const p of [{ id: "core", dir: CORE }, ...plugins]) {
    const dir = path.join(p.dir, "pages")
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".md") && !n.startsWith(".")).sort() : []
    for (const n of names) out.push([p.id, `${FOLDER}/${n}`, readText(path.join(dir, n))])
  }
  return out
}

function read(p: string) {
  try {
    return readText(p)
  } catch {
    return null
  }
}

/** The versions of the dashboard templates this vault has had. */
export class Versions {
  vault: Vault
  seen: Record<string, string[]>
  changed = false

  constructor(vault: Vault) {
    this.vault = vault
    try {
      const v = JSON.parse(readText(this.file))
      this.seen = v && typeof v === "object" && !Array.isArray(v) ? v : {}
    } catch {
      this.seen = {}
    }
  }

  get file() {
    return this.vault.abs(".vaultite/generated/versions.json")
  }

  static hash(text: string) {
    return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16)
  }

  /** Is this text a version the vault already moved past (base is the copy installed last, after it)? */
  older(rel: string, base: string | null, text: string) {
    const list = this.seen[rel] ?? [], at = list.indexOf(Versions.hash(text))
    return base !== null && base !== text && at >= 0 && list.indexOf(Versions.hash(base)) > at
  }

  /** Remember versions of a file. */
  add(rel: string, ...texts: (string | null)[]) {
    const list = this.seen[rel] ?? []
    for (const t of texts) {
      if (t === null || list.includes(Versions.hash(t))) continue
      list.push(Versions.hash(t))
      this.changed = true
    }
    this.seen[rel] = list
  }

  save() {
    if (this.changed) writeAtomic(this.file, JSON.stringify(this.seen, null, 1) + "\n")
    this.changed = false
  }
}

/** There, or in iCloud only for now (an evicted file is a ".<name>.icloud" placeholder until it's downloaded). */
function there(p: string) {
  return fs.existsSync(p) || fs.existsSync(path.join(path.dirname(p), `.${path.basename(p)}.icloud`))
}

const SKIP = new Set(["node_modules", "__pycache__"])
const fmOf = (text: string): Record<string, unknown> => {
  try { const m = FM.exec(text); const fm = m && load(m[1]); return fm && typeof fm === "object" && !Array.isArray(fm) ? fm as Record<string, unknown> : {} } catch { return {} }
}
const pluginOf = (fm: Record<string, unknown>) => (typeof fm.plugin === "string" ? fm.plugin.trim() : "")
const isDashboard = (fm: Record<string, unknown>) => typeof fm.type === "string" && fm.type.trim().toLowerCase() === "dashboard"

/** Where each template's page is now: its own path, else the one dashboard of that plugin with its name elsewhere (the
 *  user moved it), else null. An iCloud-only copy counts (`evicted`), so nothing is made over it. */
export function locate(vault: Vault, list: [string, string, string][]): Map<string, { path: string; evicted: boolean } | null> {
  const out = new Map<string, { path: string; evicted: boolean } | null>()
  const want = new Map<string, string[]>() // file name -> templates of that name not where they're expected
  // (with the pages in PAGES_DIR, a file of the user's where a page would be is only that page if it says so)
  const copies = installs(vault), mine = (file: string, text: string) => copies || ((fm) => isDashboard(fm) && pluginOf(fm) === pluginOf(fmOf(text)))(fmOf(read(file) ?? ""))
  for (const [, rel, text] of list) {
    const file = vault.abs(rel), kept = `${PAGES_DIR}/${rel}`
    if (fs.existsSync(file) && mine(file, text)) out.set(rel, { path: rel, evicted: false })
    else if (fs.existsSync(vault.abs(kept))) out.set(rel, { path: kept, evicted: false })
    else if (there(file)) out.set(rel, { path: rel, evicted: true })
    else {
      out.set(rel, null)
      const name = path.basename(rel)
      want.set(name, [...(want.get(name) ?? []), rel])
    }
  }
  if (!want.size) return out
  // The vault's Markdown files with those names (hidden folders left out, like the index)
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
  const texts = new Map(list.map(([, rel, text]) => [rel, text]))
  for (const [name, rels] of want) {
    for (const rel of rels) {
      const own = pluginOf(fmOf(texts.get(rel)!))
      const hit = found.find(([n, p, evicted]) => {
        if (n !== name) return false
        if (evicted) return true
        const fm = fmOf(read(vault.abs(p)) ?? "")
        return isDashboard(fm) && pluginOf(fm) === own
      })
      if (hit) out.set(rel, { path: hit[1], evicted: hit[2] })
    }
  }
  return out
}

/** Where new pages go: the folder most of the pages already in the vault are in (core/fileprops.ts), else Dashboards/. */
const homeOf = (at: Map<string, { path: string; evicted: boolean } | null>) =>
  homeFolder([...at.values()].flatMap((v) => (v ? [v.path] : [])), FOLDER) ?? FOLDER

/** Plugins' pages are copied among the vault's files unless its pages.json says `"install": false` (a folder of the
 *  user's own, opened in Set up Vaultite): then into PAGES_DIR, so nothing is written outside .vaultite/. */
export const installs = (vault: Vault) => vault.config("pages").install !== false

/** Copy new templates into the vault (never over a page that's there: a newer template is an update to offer). Returns the
 *  files it made. `pin: false`: Pinned isn't told (a new vault's bundle just pinned what it wants). A template is known by its path in Dashboards/ (versions, the kept copy) wherever its page is. */
export function install(vault: Vault, plugins: Plugin[], opts: { pin?: boolean } = {}) {
  const made: string[] = []
  const versions = new Versions(vault)
  const on = enabled(vault, plugins)
  const list = templates(plugins.filter((p) => on.has(p.id))), at = locate(vault, list)
  const home = installs(vault) ? homeOf(at) : `${PAGES_DIR}/${FOLDER}`
  for (const [, rel, text] of list) {
    const kept = vault.abs(`.vaultite/generated/${rel}`), where = at.get(rel) ?? null
    const base = read(kept)
    if (versions.older(rel, base, text)) continue // an older app: the newer version stays
    // A copy that's in iCloud but not downloaded isn't missing: nothing is copied in (or pinned) again.
    if (base === null && there(kept)) continue
    if (base === null) {
      const dest = path.posix.join(home, path.basename(rel))
      if (where === null && !there(vault.abs(dest))) {
        writeAtomic(vault.abs(dest), text)
        made.push(dest)
        at.set(rel, { path: dest, evicted: false })
      }
      // else: a file of that name is already there (the user's): it stays as it is
      writeAtomic(kept, text)
    }
    // (the kept copy is the version the page came from; a dashboard the user deleted isn't brought back)
    if (base !== text || !versions.seen[rel]) versions.add(rel, base, text)
  }
  versions.save()
  if (opts.pin !== false) installed(vault, plugins, made, list, at)
  return made
}

/** A page whose plugin's template is newer than the version it came from: `edited`, the user changed their copy. */
export type PageUpdate = { path: string; template: string; plugin: string; edited: boolean }

const DISMISSED = "dismissedUpdates" // pages.json: template -> the version's hash the user said no to

/** The pages with an update to offer (not dismissed for this version), or only `page`'s. */
export function updates(vault: Vault, plugins: Plugin[], page?: string): (PageUpdate & { mine: string; text: string })[] {
  const versions = new Versions(vault)
  const on = enabled(vault, plugins)
  let list = templates(plugins.filter((p) => on.has(p.id)))
  if (page) list = list.filter(([plugin, rel]) => path.posix.basename(rel) === path.posix.basename(page) && pluginOf(fmOf(read(vault.abs(page)) ?? "")) === plugin)
  const at = page ? new Map(list.map(([, rel]) => [rel, { path: page, evicted: false }])) : locate(vault, list)
  const raw = vault.config("pages")[DISMISSED], dismissed = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
  const out: (PageUpdate & { mine: string; text: string })[] = []
  for (const [plugin, rel, text] of list) {
    const where = at.get(rel), base = read(vault.abs(`.vaultite/generated/${rel}`))
    const mine = where && !where.evicted ? read(vault.abs(where.path)) : null
    if (base === null || mine === null || base === text || mine === text || versions.older(rel, base, text)) continue
    if (dismissed[rel] === Versions.hash(text)) continue
    out.push({ path: where!.path, template: rel, plugin, edited: mine !== base, mine, text })
  }
  return out
}

/** Make a page its plugin's template now (the version it came from moves along; file history keeps the old one). */
export function applied(vault: Vault, update: { template: string; text: string }) {
  writeAtomic(vault.abs(`.vaultite/generated/${update.template}`), update.text)
}

/** Don't offer this version of a page's template again (a newer one is offered). */
export function dismissal(vault: Vault, update: { template: string; text: string }): Record<string, string> {
  const raw = vault.config("pages")[DISMISSED]
  return { ...(raw && typeof raw === "object" ? raw as Record<string, string> : {}), [update.template]: Versions.hash(update.text) }
}
export { DISMISSED }

/** What "pages:installed" is told: the pages just made, and every page in its plugin's order (pageSort), with whether
 *  it's another page's tab. Paths are where they are now (locate). */
export type Installed = { made: string[]; pages: { path: string; plugin: string; tab: boolean }[] }

/** Tell the plugin that's on and offers "pages:installed" (Pinned) which pages there are, and which were just made. */
function installed(vault: Vault, plugins: Plugin[], made: string[], list: [string, string, string][],
  at: Map<string, { path: string; evicted: boolean } | null>) {
  const on = enabled(vault, plugins)
  const fn = service(plugins.filter((p) => on.has(p.id)), "pages:installed")
  if (!fn) return
  const files = list.map(([plugin, rel, text]) => ({ path: rel, plugin, tabs: tabNames(fmOf(text).tabs) }))
  const raw = vault.config("plugins").order
  const order = (Array.isArray(raw) ? raw : []).filter((x) => typeof x === "string")
  const sorts = new Map(plugins.map((p) => [p.id, typeof p.manifest.pageSort === "number" ? p.manifest.pageSort : 1000]))
  const rank = (pid: string) => (order.includes(pid) ? order.indexOf(pid) : order.length + (sorts.get(pid) ?? 1000))
  const pages = files.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f.plugin) - rank(b.f.plugin) || a.i - b.i)
    .map(({ f }) => { const h = tabHead(files, f.path); return { path: at.get(f.path)?.path ?? f.path, plugin: f.plugin, tab: !!h && h.path !== f.path } })
  const info: Installed = { made, pages }
  try { fn(info) } catch (e) { console.error(e) }
}
