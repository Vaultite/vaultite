// Plugins' pages: turning a plugin on writes each of its pages (its pages/*.md) once into the user's pages folder, as
// their own file, where none by that name is there. The plugin never touches it again (core/app.ts says when).
import fs from "node:fs"
import path from "node:path"
import { enabled, type Plugin, service } from "./plugins.ts"
import { readText, statFrom, type Vault, writeNew } from "./vault.ts"
import { logFailure } from "./writegate.ts"

/** [plugin id, file name (Today.md), text] for every plugin's pages/*.md, in plugin order. */
export function templates(plugins: Plugin[]): [string, string, string][] {
  const out: [string, string, string][] = []
  for (const p of plugins) {
    const dir = path.join(p.dir, "pages")
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".md") && !n.startsWith(".")).sort() : []
    for (const n of names) out.push([p.id, n, readText(path.join(dir, n))])
  }
  return out
}

/** Where a page named `name` (Today.md) goes: the user's pages folder (Vault.pagesHome). */
export function pageAt(vault: Vault, name: string) {
  const dir = vault.pagesHome()
  return dir ? `${dir}/${name}` : name
}

/** A new file at `rel` with `text`, in the index at once (pins and links find it); false when one is there. */
function add(vault: Vault, rel: string, text: string) {
  if (!writeNew(vault.abs(rel), text)) return false
  vault.read(rel, statFrom(fs.statSync(vault.abs(rel), { bigint: true })))
  vault.version++
  return true
}

/** Write the pages of plugins `ids` the pages folder has no file of that name for, and pin them (Pinned's
 *  "pages:installed", unless `pin: false`); one the write gate refuses is skipped. Returns the pages made. */
export function writePages(vault: Vault, plugins: Plugin[], ids: Iterable<string>, { pin = true } = {}) {
  const want = new Set(ids), made: string[] = []
  for (const [id, name, text] of templates(plugins)) {
    if (!want.has(id)) continue
    const at = pageAt(vault, name)
    try { if (add(vault, at, text)) made.push(at) } catch (e) { logFailure(`${id}'s page ${name}:`, e) }
  }
  if (made.length && pin) installed(vault, plugins, made)
  return made
}

/** What "pages:installed" (Pinned) is told: the pages just written. */
type Installed = { made: string[] }

function installed(vault: Vault, plugins: Plugin[], made: string[]) {
  const on = enabled(vault, plugins)
  const fn = service(plugins.filter((p) => on.has(p.id)), "pages:installed")
  try { fn?.({ made } satisfies Installed) } catch (e) { console.error(e) }
}

/** Where the app kept read-only copies of the plugins' pages before they became the user's files. */
const OLD = ".vaultite/pages"

/** Write the missing pages of the plugins that are on (`only`: one), unpinned, and point pins, links and the new tab's
 *  page from the old copies in .vaultite/pages/ to the user's files, the old folder going. Idempotent. */
export function restorePages(vault: Vault, plugins: Plugin[], only?: string) {
  const made = writePages(vault, plugins, only ? [only] : enabled(vault, plugins), { pin: false })
  const moved: [string, string][] = []
  if (only || !fs.existsSync(vault.abs(OLD))) return { made, moved }
  for (const rel of (fs.readdirSync(vault.abs(OLD), { recursive: true }) as string[]).map((f) => f.split(path.sep).join("/")).sort()) {
    if (!rel.endsWith(".md") || rel.split("/").some((s) => s.startsWith("."))) continue
    const from = `${OLD}/${rel}`, to = pageAt(vault, path.basename(rel))
    // (a bundle's page: the only kind not written above)
    if (add(vault, to, readText(vault.abs(from)))) made.push(to)
    moved.push([from, to])
  }
  const found = moved.length
  // (pins to a plugin's page that's off now find it when it's turned on)
  for (const [, name] of templates(plugins)) {
    const from = `${OLD}/Dashboards/${name}`
    if (!moved.some(([f]) => f === from)) moved.push([from, pageAt(vault, name)])
  }
  for (const [from, to] of moved) vault.moved(from, to)
  vault.relink(moved.filter(([, to]) => vault.entries.has(to)))
  const tab = vault.config("newtab"), page = moved.find(([from]) => from === tab.page)
  if (page) vault.patchConfig("newtab", { page: page[1] })
  fs.rmSync(vault.abs(OLD), { recursive: true, force: true })
  fs.rmSync(vault.abs(".vaultite/generated/pages.json"), { force: true })
  return { made, moved: moved.slice(0, found) }
}
