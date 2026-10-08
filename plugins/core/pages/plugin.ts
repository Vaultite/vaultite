// Pinned: the files pinned to the sidebar (.vaultite/pages.json), all of pinning. Pins change one at a time on the file
// as it is (POST /api/pins), so an old copy can't bring back pages unpinned elsewhere; pins follow moves.
import fs from "node:fs"
import { HTTPError, type OpCtx, OpError, type Param, pinProblem, Plugin, relocatedPin, repinList } from "../../../core/plugins.ts"
import { ConfigError, type Item, type Vault } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

/** The pinned entries, in order. One whose file was moved outside the app (Finder, iCloud) is where it is now
 *  (Vault.relocated); the next change to the list writes it so. */
export function pinned(vault: Vault): string[] {
  const p = vault.config("pages").pinned
  return Array.isArray(p) ? [...new Set(p.filter((x) => typeof x === "string").map((x) => relocatedPin(vault, x)))] : []
}

plugin.state(() => ({ pinned: pinned(plugin.vault) }))

/** Pin or unpin one entry (POST /api/pins), on the file as it is now. */
export function pinOne(vault: Vault, body: { path?: unknown; pinned?: unknown; before?: unknown }) {
  // (a path from before the user moved its folder is the file where it is now)
  const p = typeof body.path === "string" ? relocatedPin(vault, body.path.trim()) : ""
  if (!p) throw new HTTPError(400, "path is required")
  const conf = vault.config("pages")
  const cur = pinned(vault)
  const at = cur.indexOf(p)
  let out = cur
  if (body.pinned === false) out = cur.filter((x) => x !== p)
  else if (at < 0 || body.before !== undefined) {
    // A page is a file (or a heading in one, or a search): a path that isn't one would be a pin nothing shows.
    const problem = at < 0 ? pinProblem(vault, p) : null
    if (problem) throw new HTTPError(404, problem)
    const rest = cur.filter((x) => x !== p)
    const i = typeof body.before === "string" ? rest.indexOf(body.before) : -1
    out = i < 0 ? [...rest, p] : [...rest.slice(0, i), p, ...rest.slice(i)]
  }
  if (out.join("\n") !== cur.join("\n") || !Array.isArray(conf.pinned)) vault.setConfig("pages", { ...conf, pinned: out })
  return { pinned: out }
}

plugin.route("POST", "pins", (req) => pinOne(plugin.vault, req.body ?? {}))

/** A file or folder moved (to null: to the trash): the pins follow it. */
export function repin(vault: Vault, src: string, dst: string | null) {
  const conf = vault.config("pages")
  const list = conf.pinned
  if (!Array.isArray(list)) return
  // (an entry that isn't a string stays where it is)
  const strings = repinList(list.filter((p): p is string => typeof p === "string"), src, dst)
  const out = [...strings, ...list.filter((p) => typeof p !== "string")]
  if (JSON.stringify(out) !== JSON.stringify(list)) vault.setConfig("pages", { ...conf, pinned: out })
}

plugin.onMove((from, to) => repin(plugin.vault, from, to))

/** What core/pages.ts tells "pages:installed" (its Installed). */
type Installed = { made: string[]; pages: { path: string; plugin: string; tab: boolean }[] }

/** Pin the pages just made (not another page's tab). A vault that never had pages.json gets every page; one that can't
 *  be read (mid-sync) is left alone, or every page the user unpinned would come back. */
export function pinInstalled(vault: Vault, { made, pages }: Installed) {
  const tabs = new Set(pages.filter((p) => p.tab).map((p) => p.path))
  const heads = made.filter((m) => !tabs.has(m))
  let conf
  try { conf = vault.readConfig("pages") } catch (e) {
    if (e instanceof ConfigError) return
    throw e
  }
  // A plugin keeping lists of its own (Workspaces: a workspace's) pins them there too.
  const also = (paths: string[]) => { const fn = plugin.service("pins:installed"); if (paths.length && typeof fn === "function") fn(paths) }
  if (conf) {
    if (conf.pinNew === false) return
    const list = conf.pinned
    const add = Array.isArray(list) ? heads.filter((m) => !list.includes(m)) : []
    if (add.length) vault.setConfig("pages", { ...conf, pinned: [...list, ...add] })
    also(add)
    return
  }
  const all = [...new Set(pages.filter((p) => !p.tab && fs.existsSync(vault.abs(p.path))).map((p) => p.path))]
  vault.setConfig("pages", { pinned: all })
}

plugin.provide("pages:installed", (info: Installed) => pinInstalled(plugin.vault, info))

// ---------- operations (vau pages, pin, unpin) and vau context ----------

type PinsTarget = { label: string; pinned: string[] | null; pin: (path: string, on: boolean, before?: string) => { pinned: string[] } }

/** The list the user sees: workspace n's with Workspaces on (the service "pins:of": the one asked for, else the user's
 *  window's; `vault`: pages.json itself), else pages.json's. */
async function target(ctx: OpCtx, { workspace, vault }: { workspace?: number; vault?: boolean }) {
  const own = pinned(plugin.vault)
  const of = plugin.service("pins:of") as ((n: number) => PinsTarget) | null
  if (!of && workspace) throw new OpError("Workspaces is off: there's one list of pinned pages (leave out workspace)")
  let n: number | null = null
  if (of && !vault) {
    try { const w = workspace ?? (await ctx.ui(null) as Item)?.workspace; n = Number.isInteger(w) ? w as number : null } catch { n = workspace ?? null }
  }
  const t = n ? of!(n) : null
  return { t, pinned: t ? t.pinned ?? own : own, label: t ? t.label : "pages.json" }
}

const numbered = (pins: string[], indent = "") => (pins.length ? pins.map((p, i) => `${indent}${i + 1}. ${p}`).join("\n") : `${indent}(none)`)

/** One change, in the list the user sees. */
async function change(ctx: OpCtx, given: { path: string; before?: string; workspace?: number; vault?: boolean }, on: boolean) {
  const { t, label } = await target(ctx, given)
  const r = t ? t.pin(given.path, on, given.before) : pinOne(plugin.vault, { path: given.path, pinned: on, ...(given.before ? { before: given.before } : {}) })
  return { path: given.path, pinned: r.pinned, label }
}

const FLAGS = `With Workspaces on, each workspace has its own list (the sidebar there): these act on the one the user's
window is on, --workspace <n> on another's. A workspace that has no list of its own shows .vaultite/pages.json's,
which is also what new workspaces start with; its first change makes it its own (a copy, changed). --vault acts on
pages.json itself (the default; without Workspaces, the only list).`
const WORKSPACE: Param = { type: "integer", minimum: 1, maximum: 5, description: "the workspace (1 to 5) whose list to use; the user's window's when left out (Workspaces on)" }
const VAULT: Param = { type: "boolean", description: "pages.json itself (the default for workspaces without a list of their own)" }

plugin.op({
  id: "page.list",
  cli: "pages",
  summary: "The pinned pages (the sidebar's list, the current workspace's with Workspaces on), in order.",
  help: `The sidebar's pages, in order. Change them with vau pin / vau unpin.\n\n${FLAGS}\n\n  vau pages\n  vau pages --workspace 2\n  vau pages --vault`,
  kind: "read",
  params: { workspace: WORKSPACE, vault: VAULT },
  run: async (given, ctx) => {
    const { t, pinned: list, label } = await target(ctx, given)
    return { label, pinned: list, own: t ? !!t.pinned : true }
  },
  text: (r) => `${r.label}${r.own ? "" : " (pages.json's, the default)"}:\n${numbered(r.pinned)}`,
})

plugin.op({
  id: "page.pin",
  cli: "pin",
  summary: "Pin a file to the sidebar (at the end, or before another): the current workspace's list with Workspaces on.",
  help: `Adds a file to the sidebar's pages, or moves it when it's already there and before is given. Any file can be a
page: a dashboard, a note, an artifact (.html), a table (.csv). A heading in a note ("Notes/Idea.md#Plan", a block
"Notes/Idea.md#^id") and a search ("search:tag:#book") can be pinned too, like bookmarks.

${FLAGS}

  vau pin Dashboards/Finance.md
  vau pin Finance/Spending.html --before Dashboards/People.md
  vau pin "Notes/Idea.md#Plan"
  vau pin "search:tag:#book"
  vau pin Notes/Draft.md --workspace 2
  vau pin Dashboards/Today.md --vault`,
  kind: "write",
  params: {
    path: { type: "string", format: "path", required: true, description: "the file (a path, or a name as the user says it)" },
    before: { type: "string", format: "path", description: "the pinned page it goes before (else at the end)" },
    workspace: WORKSPACE, vault: VAULT,
  },
  args: ["path"],
  run: (given, ctx) => change(ctx, given, true),
  text: (r) => `Pinned ${r.path} in ${r.label}.\n${numbered(r.pinned)}`,
})

plugin.op({
  id: "page.unpin",
  cli: "unpin",
  summary: "Take a file off the sidebar (the file stays): the current workspace's list with Workspaces on.",
  help: `Removes a page from the sidebar's pages. The file isn't touched.\n\n${FLAGS}\n\n  vau unpin Dashboards/Work.md\n  vau unpin Dashboards/Work.md --vault`,
  kind: "write",
  params: {
    path: { type: "string", format: "path", required: true, description: "the file (a path, or a name as the user says it)" },
    workspace: WORKSPACE, vault: VAULT,
  },
  args: ["path"],
  run: (given, ctx) => change(ctx, given, false),
  text: (r) => `Unpinned ${r.path} in ${r.label}.\n${numbered(r.pinned)}`,
})

/** What `vau context` says of it: the pinned pages the user's window shows. */
plugin.provide("context", ({ workspace }: { workspace: number | null }) => {
  const of = plugin.service("pins:of") as ((n: number) => PinsTarget) | null
  const t = workspace && of ? of(workspace) : null
  const list = t ? t.pinned ?? pinned(plugin.vault) : pinned(plugin.vault)
  const whose = t ? `Pinned pages in ${t.label}${t.pinned ? "" : " (none of its own: pages.json's, the default)"}` : "Pinned pages"
  return { data: { pinned: list }, text: `${whose} (the sidebar, in order):\n${numbered(list, "  ")}` }
})
