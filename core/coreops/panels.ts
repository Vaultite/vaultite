// The sidebars' panels (core/sidebars.ts): list, move, hide, fold. They change the setup the user sees: their
// window's workspace with Workspaces on (service "sidebars:of"), else sidebars.json, key by key.
import type { App } from "../app.ts"
import { panelsOf, type PanelDef } from "../appsource.ts"
import { type Op, OpError, type Param } from "../ops.ts"
import { anchorFor } from "../slots.ts"
import { defaultSidebars, placePanel, readSidebars, setCollapsed, setDocked, type Side, sideOf, type Sidebars, withoutPanel } from "../sidebars.ts"
import { type Any, lines, serviceOn, windowWorkspace } from "./common.ts"
import { onOff, pluginList } from "./plugins.ts"

export type Panel = { key: string; title: string; plugin: string; on: boolean
  /** Its sidebar (null: hidden), its place there (from 1), and whether it's folded to its heading. */
  side: Side | null; place: number | null; collapsed: boolean
  /** In a phone's dock (drawn there, not in its drawer). */
  docked: boolean }

/** Sidebars kept by a plugin (Workspaces: a workspace's), the service "sidebars:of"(n): what to call them, their setup
 *  (null: none of their own, sidebars.json's applies) and how to save a change. */
export type SidebarsTarget = { label: string; setup: Sidebars | null; save: (next: Sidebars) => unknown }

/** Every plugin's panels (on or off), as their source declares them (core/appsource.ts). */
export const panelDefs = (app: App): PanelDef[] => pluginList(app).flatMap(panelsOf)

/** The sidebars' setup (`own`: a workspace's; else .vaultite/sidebars.json, or the default while it's unset) and
 *  every panel, the shown ones in their sidebars' order, then the hidden ones by `sort`. */
export function panelList(app: App, own?: Sidebars | null): { setup: Sidebars; panels: Panel[] } {
  const plugins = pluginList(app)
  const { on } = onOff(plugins, app.vault.config("plugins"))
  const defs = plugins.flatMap(panelsOf)
  const setup = own ?? readSidebars(app.vault.config("sidebars")) ?? defaultSidebars(defs)
  const panel = (d: PanelDef): Panel => {
    const side = sideOf(setup, d.key)
    return { key: d.key, title: d.title, plugin: d.plugin, on: on(d.plugin), side, place: side ? setup[side].indexOf(d.key) + 1 : null,
      collapsed: setup.collapsed.includes(d.key), docked: !!setup.dock?.includes(d.key) }
  }
  const byKey = new Map(defs.map((d) => [d.key, d]))
  const shown = [...setup.left, ...setup.right].flatMap((k) => byKey.get(k) ?? [])
  const hidden = defs.filter((d) => !shown.includes(d)).sort((a, b) => a.sort - b.sort)
  return { setup, panels: [...shown, ...hidden].map(panel) }
}

/** The sidebars as text: each sidebar's panels in order, then the hidden ones. */
export function showPanels(ps: Panel[]) {
  const side = (s: Side) => ps.filter((p) => p.side === s)
    .map((p) => `  ${p.place}. ${p.key} (${p.title})${p.collapsed ? "  (collapsed)" : ""}${p.docked ? "  (phone dock)" : ""}${p.on ? "" : "  (plugin off)"}`)
  const hidden = ps.filter((p) => !p.side)
  return [
    "Left sidebar:", lines(side("left"), "  (empty)"),
    "Right sidebar:", lines(side("right"), "  (empty)"),
    `Hidden: ${hidden.map((p) => `${p.key} (${p.title})`).join(", ") || "none"}`,
  ].join("\n")
}

/** Whose sidebars an op changes: a workspace's (the one asked for, else the user's window's, while Workspaces is on), or
 *  null for sidebars.json. */
export async function sidebarsTarget(app: App, ctx: Parameters<Op["run"]>[1], p: { workspace?: number; vault?: boolean }): Promise<SidebarsTarget | null> {
  if (p.vault) return null
  const of = serviceOn(app, "sidebars:of")
  if (!of) {
    if (p.workspace) throw new OpError("Workspaces is off: there's one setup of the sidebars (leave out workspace)")
    return null
  }
  const n = p.workspace ?? await windowWorkspace(ctx)
  return n ? await of(n) : null
}

/** A panel by its key, another name its plugin gives it (`names`), its title or heading, its name in its plugin, or its
 *  plugin's id when that has one panel ("terminals", "file tree", "pinned", "search"). */
function namedPanel(app: App, list: Panel[], q: string) {
  const low = q.toLowerCase().trim().replace(/[\s_-]+/g, " ")
  const defs = new Map(panelDefs(app).map((d) => [d.key, d]))
  const norm = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[\s_-]+/g, " ")
  const hit = list.find((p) => p.key === q) ?? list.find((p) => defs.get(p.key)?.names.some((n) => norm(n) === low)) ??
    list.find((p) => norm(p.title) === low) ?? list.find((p) => norm(defs.get(p.key)?.heading) === low) ?? list.find((p) => norm(p.key.split(":")[1]) === low) ??
    list.find((p) => p.plugin === low && list.filter((x) => x.plugin === low).length === 1)
  if (!hit) throw new OpError(`no sidebar panel '${q}'. Panels: ${list.map((p) => `${p.key} (${p.title})`).join(", ")}`, 404)
  return hit
}

const WORKSPACE: Param = { type: "integer", minimum: 1, maximum: 5, description: "the workspace (1 to 5) whose panels to use; the user's window's when left out (Workspaces on)" }
const VAULT: Param = { type: "boolean", description: "sidebars.json itself (the default for workspaces without panels of their own), not a workspace's" }
const PANEL: Param = { type: "string", required: true, description: "the panel: its key (files:files), title or a plain name (terminals, file tree, pinned, search)" }

const HELP = `The desktop app's two sidebars are stacks of plugins' panels (Search field, Pinned pages, File explorer,
Terminals...), kept in .vaultite/sidebars.json: {"left": [panels], "right": [panels], "collapsed": [panels]}, top to
bottom; \`collapsed\` are the ones folded to their heading; \`dock\`, the ones a phone draws as icons in its drawer's
dock instead (Buttons). A panel in neither sidebar is hidden (its plugin stays
on). Without the file, every panel its plugin doesn't hide is on the left, by its sort. With Workspaces on there's
always a current workspace, and each has its own panels (\`sidebars\` in its entry; none of its own: sidebars.json's,
which is also what new workspaces start with): these read and change the workspace the user's window is on
(--workspace <n> for another, --vault for sidebars.json itself). A panel is named by its key, its title or a plain
name: "terminals", "file tree" (or "files"), "pinned", "search". Positions count from 1, in the panel's sidebar.

  vau panels
  vau panels move terminals top
  vau panels move "file tree" 2
  vau panels hide search
  vau panels show search               (at the end of the left sidebar; \`show search right\` for the right one)
  vau panels right "local graph"       (to the end of the right sidebar)
  vau panels left "local graph"
  vau panels collapse pinned
  vau panels expand pinned
  vau panels dock buttons              (on phones, icons at the drawer's bottom; \`undock\` puts it back)
  vau panels hide terminals --workspace 2
  vau panels --vault                   (sidebars.json: the default for new workspaces)`

export function panelOps(app: App): Op[] {
  /** A change to one panel, saved where it belongs; the panels after it. */
  const change = (id: string, cli: string, summary: string, args: string[], params: Record<string, Param>, fn: (s: Sidebars, p: Panel, given: Any) => Sidebars): Op => ({
    id, cli, summary, help: `${summary} See vau panels --help.`, kind: "write",
    params: { panel: PANEL, ...params, workspace: WORKSPACE, vault: VAULT }, args: ["panel", ...args],
    run: async (given, ctx) => {
      const target = await sidebarsTarget(app, ctx, given)
      const { setup, panels } = panelList(app, target?.setup)
      const next = fn(setup, namedPanel(app, panels, given.panel), given)
      if (target) await target.save(next)
      else app.vault.patchConfig("sidebars", { left: next.left, right: next.right, collapsed: next.collapsed, heights: next.heights, heightsAt: next.heightsAt ?? null, dock: next.dock ?? null })
      const after = panelList(app, target ? next : undefined)
      return { sidebars: after.setup, panels: after.panels, ...(target ? { workspace: target.label } : {}) }
    },
    text: (r) => `${r.workspace ? `${r.workspace}:\n` : ""}${showPanels(r.panels)}`,
  })
  /** To the end of one sidebar, unfolded. */
  const dock = (side: Side) => (s: Sidebars, p: Panel) => setCollapsed(placePanel(s, p.key, { side, before: null }), p.key, false)

  return [{
    id: "panel.list",
    cli: "panels",
    summary: "The sidebars' panels, in order, and the hidden ones (the user's window's workspace's with Workspaces on).",
    help: HELP,
    kind: "read",
    params: { workspace: WORKSPACE, vault: VAULT },
    run: async (given, ctx) => {
      const target = await sidebarsTarget(app, ctx, given)
      const { setup, panels } = panelList(app, target?.setup)
      return { sidebars: setup, panels, ...(target ? { workspace: target.label, own: !!target.setup } : {}) }
    },
    text: (r) => `${r.workspace ? `${r.workspace}${r.own ? "" : " (the default panels: none of its own yet)"}:\n` : ""}${showPanels(r.panels)}`,
  },
  change("panel.move", "panels move", "Move a panel within its sidebar: to a position (from 1), up, down, top or bottom.", ["to"],
    { to: { type: "string", required: true, description: "where: a position from 1, up, down, top or bottom" } },
    (s, p, { to: where }) => {
      const side = sideOf(s, p.key) ?? "left"
      const before = anchorFor(s[side], p.key, where)
      if (before === undefined) throw new OpError(`'${where}' isn't a position (a number from 1, up, down, top or bottom)`)
      return placePanel(s, p.key, { side, before })
    }),
  change("panel.hide", "panels hide", "Hide a panel (out of both sidebars; its plugin stays on).", [], {}, (s, p) => withoutPanel(s, p.key)),
  change("panel.show", "panels show", "Show a hidden panel at the end of the left sidebar (or the right one).", ["side"],
    { side: { type: "string", enum: ["left", "right"], description: "which sidebar (left by default); given, a shown panel moves to its end" } },
    (s, p, { side }) => (sideOf(s, p.key) && !side ? s : dock(side === "right" ? "right" : "left")(s, p))),
  change("panel.left", "panels left", "Put a panel at the end of the left sidebar.", [], {}, dock("left")),
  change("panel.right", "panels right", "Put a panel at the end of the right sidebar.", [], {}, dock("right")),
  change("panel.collapse", "panels collapse", "Fold a panel to its heading.", [], {}, (s, p) => {
    if (!sideOf(s, p.key)) throw new OpError(`${p.title} is hidden: vau panels show ${p.key}`)
    return setCollapsed(s, p.key, true)
  }),
  change("panel.expand", "panels expand", "Unfold a panel folded to its heading.", [], {}, (s, p) => {
    if (!sideOf(s, p.key)) throw new OpError(`${p.title} is hidden: vau panels show ${p.key}`)
    return setCollapsed(s, p.key, false)
  }),
  change("panel.dock", "panels dock", "On phones, draw a panel as icons in the drawer's dock, not in its drawer (Buttons).", [], {}, (s, p) => {
    if (!sideOf(s, p.key)) throw new OpError(`${p.title} is hidden: vau panels show ${p.key}`)
    if (!panelDefs(app).find((d) => d.key === p.key)?.dockable) throw new OpError(`${p.title} has no dock form: ${panelDefs(app).filter((d) => d.dockable).map((d) => d.key).join(", ") || "no panel"} can be docked`)
    return setDocked(s, p.key, true)
  }),
  change("panel.undock", "panels undock", "Put a docked panel back in its phone drawer.", [], {}, (s, p) => setDocked(s, p.key, false))]
}
