import { HTTPError, movedFilePanels, type OpCtx, OpError, type Param, pinProblem, placePin, Plugin, readSidebars, relocatedPin, repinList, sameSidebars } from "../../../core/plugins.ts"
import { ConfigError, type Item, type Vault } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

export function pinned(vault: Vault): string[] {
  const p = vault.config("pages").pinned
  return Array.isArray(p) ? [...new Set(p.filter((x) => typeof x === "string").map((x) => relocatedPin(vault, x)))] : []
}

export function labels(vault: Vault): Record<string, string> {
  const l = vault.config("pages").labels
  return l && typeof l === "object" && !Array.isArray(l) ? Object.fromEntries(Object.entries(l).filter(([, v]) => typeof v === "string")) as Record<string, string> : {}
}

plugin.state(() => ({ pinned: pinned(plugin.vault), pinLabels: labels(plugin.vault) }))

export function pinOne(vault: Vault, body: { path?: unknown; pinned?: unknown; before?: unknown }) {
  const p = typeof body.path === "string" ? relocatedPin(vault, body.path.trim()) : ""
  if (!p) throw new HTTPError(400, "path is required")
  const conf = vault.config("pages")
  const cur = pinned(vault)
  const at = cur.indexOf(p)
  let out = cur
  if (body.pinned === false) {
    out = cur.filter((x) => x !== p)
    if (p in labels(vault)) { const { [p]: _, ...rest } = labels(vault); vault.setConfig("pages", { ...conf, pinned: out, labels: rest }); return { pinned: out } }
  }
  else if (at < 0 || body.before !== undefined) {
    const problem = at < 0 ? pinProblem(vault, p) : null
    if (problem) throw new HTTPError(404, problem)
    out = placePin(cur, p, true, typeof body.before === "string" ? body.before : null)
  }
  if (out.join("\n") !== cur.join("\n") || !Array.isArray(conf.pinned)) vault.setConfig("pages", { ...conf, pinned: out })
  return { pinned: out }
}

plugin.route("POST", "pins", (req) => pinOne(plugin.vault, req.body ?? {}))

export function setLabel(vault: Vault, p: string, label: string) {
  const conf = vault.config("pages"), now = labels(vault)
  const name = label.trim().slice(0, 200)
  if (now[p] !== name) vault.setConfig("pages", { ...conf, labels: { ...now, [p]: name } })
}

plugin.route("POST", "pins/label", (req) => {
  const { path: p, label } = (req.body ?? {}) as { path?: unknown; label?: unknown }
  if (typeof p !== "string" || !p.startsWith("view:") || typeof label !== "string") throw new HTTPError(400, "path (a view: view:<name>/<arg>) and label are required")
  setLabel(plugin.vault, p, label)
  return { ok: true }
})

export function repin(vault: Vault, src: string, dst: string | null) {
  const conf = vault.config("pages")
  const list = conf.pinned
  if (!Array.isArray(list)) return
  const strings = repinList(list.filter((p): p is string => typeof p === "string"), src, dst)
  const out = [...strings, ...list.filter((p) => typeof p !== "string")]
  if (JSON.stringify(out) !== JSON.stringify(list)) vault.setConfig("pages", { ...conf, pinned: out })
}

export function repanel(vault: Vault, src: string, dst: string | null) {
  const s = readSidebars(vault.config("sidebars"))
  if (!s) return
  const next = movedFilePanels(s, src, dst)
  if (!sameSidebars(s, next)) vault.patchConfig("sidebars", { left: next.left, right: next.right, collapsed: next.collapsed, heights: next.heights, dock: next.dock ?? null })
}

plugin.onMove((from, to) => { repin(plugin.vault, from, to); repanel(plugin.vault, from, to) })

type Installed = { made: string[] }

export function pinInstalled(vault: Vault, { made }: Installed) {
  let conf
  try { conf = vault.readConfig("pages") } catch (e) {
    if (e instanceof ConfigError) return
    throw e
  }
  if (conf?.pinNew === false) return
  const list = Array.isArray(conf?.pinned) ? conf.pinned as unknown[] : []
  const add = made.filter((m) => !list.includes(m))
  if (!add.length) return
  vault.setConfig("pages", { ...conf, pinned: [...list, ...add] })
  const fn = plugin.service("pins:installed")
  if (typeof fn === "function") fn(add)
}

plugin.provide("pages:installed", (info: Installed) => pinInstalled(plugin.vault, info))

type PinsTarget = { label: string; pinned: string[] | null; pin: (path: string, on: boolean, before?: string) => { pinned: string[] } }

async function target(ctx: OpCtx, { workspace, vault }: { workspace?: number; vault?: boolean }) {
  const own = pinned(plugin.vault)
  const of = plugin.service("pins:of") as ((n: number) => PinsTarget) | null
  if (!of && workspace) throw new OpError("Workspaces is off: there's one list of pinned pages (leave out `workspace`)")
  let n: number | null = null
  if (of && !vault) {
    try { const w = workspace ?? (await ctx.ui(null) as Item)?.workspace; n = Number.isInteger(w) ? w as number : null } catch { n = workspace ?? null }
  }
  const t = n ? of!(n) : null
  return { t, pinned: t ? t.pinned ?? own : own, label: t ? t.label : "pages.json" }
}

const numbered = (pins: string[], indent = "") => (pins.length ? pins.map((p, i) => `${indent}${i + 1}. ${p}`).join("\n") : `${indent}(none)`)

async function change(ctx: OpCtx, given: { path: string; before?: string; label?: string; workspace?: number; vault?: boolean }, on: boolean) {
  const { t, label } = await target(ctx, given)
  if (on && given.label?.trim() && !given.path.startsWith("view:")) throw new OpError("Only a view is named (`label`): a file or folder shows its own name")
  const r = t ? t.pin(given.path, on, given.before) : pinOne(plugin.vault, { path: given.path, pinned: on, ...(given.before ? { before: given.before } : {}) })
  if (on && given.label?.trim()) setLabel(plugin.vault, given.path, given.label)
  return { path: given.path, pinned: r.pinned, label }
}

const FLAGS = `With Workspaces on, each workspace has its own list (the sidebar there): these act on the one the user's
window is on, --workspace <n> on another's. A workspace that has no list of its own shows .vaultite/pages.json's,
which is also what new workspaces start with; its first change makes it its own (a copy, changed). --vault acts on
pages.json itself (the default; without Workspaces, the only list).`
const WORKSPACE = { type: "integer", minimum: 1, maximum: 5, description: "the workspace (1 to 5) whose list to use; the user's window's when left out (Workspaces on)" } satisfies Param
const VAULT = { type: "boolean", description: "pages.json itself (the default for workspaces without a list of their own)" } satisfies Param

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
  summary: "Pin a file, folder, web page or view to the sidebar (at the end, or before another): the current workspace's list with Workspaces on.",
  help: `Adds a file to the sidebar's pages, or moves it when it's already there and before is given. Any file can be a
page: a dashboard, a note, an artifact (.html), a table (.csv), an image or a recording; a folder too, which opens
in place in the list. A heading in a note ("Notes/Idea.md#Plan", a block
"Notes/Idea.md#^id") and a search ("search:tag:#book") can be pinned too, like bookmarks, and so can a tab that isn't
a file, as its target ("view:<name>" or "view:<name>/<arg>", as vau open takes it): a web page (its address, or
"view:web/<address>": it opens in the Browser, named by label until it's opened, then by its title), a plugin's
page ("view:inbox", "view:graph"), a coding agent's conversation ("view:terminal/resume-claude-<session id>",
"@<machine>" after it for another machine's: it opens the terminal running it, else resumes it there). A view whose
plugin is off doesn't show until it's on again.

${FLAGS}

  vau pin Dashboards/Finance.md
  vau pin Finance/Spending.html --before Dashboards/People.md
  vau pin "Notes/Idea.md#Plan"
  vau pin Projects/Lighthouse
  vau pin "search:tag:#book"
  vau pin https://example.com/docs --label "Example docs"
  vau pin view:inbox
  vau pin "view:terminal/resume-claude-0b5c9e2a-4f1d-4c4e-9a7e-2d6f1b3c8e90"
  vau pin Notes/Draft.md --workspace 2
  vau pin Dashboards/People.md --vault`,
  kind: "write",
  params: {
    path: { type: "string", format: "path", required: true, description: "the file or folder (a path, or a name as the user says it), a web address, or a view (view:<name>/<arg>)" },
    before: { type: "string", format: "path", description: "the pinned page it goes before (else at the end)" },
    label: { type: "string", description: "a view's name in the list (a web page's title); else its tab's" },
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
    path: { type: "string", format: "path", required: true, description: "the file (a path, or a name as the user says it), a web address or a view" },
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
