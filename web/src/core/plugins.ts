// The plugin registry: every folder in plugins/core/ with an index.tsx (found with import.meta.glob), plus the vault's
// own once /api/state lists them. Which are on is plugins.json (prefs.ts); a plugin is off while one it `requires` is.
import { signal } from "@/core/signal"
import { Puzzle } from "lucide-react"
import BUILT_IN_ICONS from "virtual:plugin-icons"
import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { MenuItem } from "@/components/ContextMenu"
import { editorOf } from "@/core/editors"
import type { AgentDef, EditorCtx, FileFormat, FileIcon, FileMark, FileRow, HostedPlugin, Manifest, NewTabSection, Plugin, PluginDef, PluginHost, SidebarPanel, TimelineKind, ViewDef } from "@/core/define"
import type { Store } from "@/core/data"
import { defaultSidebars, placePanel, sameSidebars, setCollapsed, setDocked, setHeight, setHeights, sideOf as sideIn, withoutPanel, type Place, type Side, type Sidebars } from "../../../core/sidebars.ts"
import { getPrefs, setPrefs, usePrefs } from "@/core/prefs"
import { isDesktop } from "@/core/workspace"
import { canonical, keyCaps, keysOf, setMissingCommand } from "@/core/commands"
import { setFenceLookup, setFormatLookup, type Drawn } from "@/core/formats"
import { reload } from "@/core/data"
import { op } from "@/core/http"
import { notify, notifyError } from "@/core/notify"
import { openDetail } from "@/core/nav"
import { CATEGORIES, categoryOf, OTHER } from "../../../core/categories.ts"
import { setMarks } from "../../../core/fileprops.ts"
import { parseTerminal } from "../../../core/terminalids.ts"

export type { Place, Side, Sidebars } from "../../../core/sidebars.ts"
export { readSidebars, sameSidebars } from "../../../core/sidebars.ts"
export type { DetailDef, FileCtx, FileFormat, FileView, FormatCtx, HeaderItem, PageCtx, PageView, SidebarSetup, LinkTarget, Manifest, Plugin, PluginDef, SearchDoc, SidebarCtx, SidebarPanel } from "@/core/define"

const manifests = import.meta.glob<Manifest>("../../../plugins/core/*/manifest.json", { eager: true, import: "default" })
const modules = import.meta.glob<PluginDef>("../../../plugins/core/*/index.tsx", { eager: true, import: "default" })
// The dashboards each plugin brings (the server copies them into the vault's Dashboards/; here for previews).
const pages = import.meta.glob<string>("../../../plugins/core/*/pages/*.md", { eager: true, query: "?raw", import: "default" })

const folder = (path: string) => path.split("/").slice(-3, -1).join("/") // "core/people"

/** Every plugin: the app's (fixed), then the vault's (setVaultPlugins). */
export const PLUGINS: Plugin[] = Object.entries(manifests)
  .map(([path, { blocks: decls, settings, ...m }]) => {
    const f = folder(path)
    const def = Object.entries(modules).find(([p]) => folder(p) === f)?.[1] ?? {}
    const icon = BUILT_IN_ICONS[m.id] // (a name: one it adds itself)
    return { ...m, ...def, icon: (typeof icon === "string" ? def.icons?.[icon] : icon) ?? Puzzle, blockDecls: decls ?? {}, settingsDecls: settings ?? {}, tier: "core" } as Plugin
  })

/** Plugins' colours: a manifest's `tint` ("orange") makes --<id> (--today: var(--orange)). At no specificity
 *  (:where), so a colour scheme's --today wins over it (index.css, themes/*.css). */
export const tintNames = () => PLUGINS.filter((p) => p.tint).map((p) => p.id)
function writeTints() {
  if (typeof document === "undefined") return
  const css = `:where(:root, .scheme-preview) {\n${PLUGINS.filter((p) => p.tint && /^[a-z][a-z-]*$/.test(p.tint) && /^[a-z][a-z0-9-]*$/.test(p.id))
    .map((p) => `  --${p.id}: var(--${p.tint});`).join("\n")}\n}`
  let el = document.getElementById("plugin-tints")
  if (!el) {
    el = document.createElement("style")
    el.id = "plugin-tints"
    document.head.prepend(el)
  }
  if (el.textContent !== css) el.textContent = css
}
writeTints()

// The vault's plugins arrive after the app's (and change while it runs): whatever reads the plugin list in a hook or
// caches what it got (commands, panels, agents) follows this counter.
const pluginsChanged = signal()
const signature = (ps: Plugin[]) => ps.map((p) => `${p.id}@${p.version ?? ""}:${(p.problems ?? []).join()}`).join("\n")

const bump = pluginsChanged.notify

/** The vault's plugins now (core/vaultPlugins.ts): they replace the ones before. */
export function setVaultPlugins(list: Plugin[]) {
  const app = PLUGINS.filter((p) => p.tier === "core"), hosted = PLUGINS.filter((p) => p.tier === "hosted")
  const was = signature(PLUGINS.filter((p) => p.tier === "vault"))
  PLUGINS.splice(0, PLUGINS.length, ...app, ...list, ...hosted)
  setMarks(PLUGINS as unknown as Record<string, unknown>[])
  writeTints()
  if (signature(list) !== was) bump()
}

// Plugins other plugins run (an Obsidian plugin under obsidian-compat), by host: their switches are the host's.
const hosts = new Map<string, PluginHost>()
const hostedOn = new Map<string, boolean>()
export const hostOf = (p: Plugin) => (p.host ? hosts.get(p.host) ?? null : null)
/** The hosts running now (an Obsidian plugins' host with none yet included), by the host plugin's id. */
export const hostsNow = () => [...hosts]

/** A host's plugins now (null: none, the host gone or off): they replace its ones before, and whatever they draw
 *  (commands, panels, fences, editor extensions) follows. Ids must be the host's own (`obsidian.calendar`). */
export function hostPlugins(host: string, info: PluginHost | null, list: HostedPlugin[] = []) {
  if (info) hosts.set(host, info); else hosts.delete(host)
  const mine = info ? list.map(({ on, waiting, problems, disclosures, version, author, url, ...def }): Plugin => {
    hostedOn.set(def.id, on)
    return { ...def, description: def.description ?? "", tier: "hosted", host, blockDecls: {}, settingsDecls: {}, problems: problems ?? [],
      meta: { version: version ?? null, author: author ?? null, repo: null, fundingUrl: url ?? null, disclosures: disclosures ?? {}, source: null,
        approval: waiting ? { state: waiting === "changed" ? "changed" : "new", since: null, changed: [] } : null, blocked: null, hash: "", edits: false } }
  }) : []
  const rest = PLUGINS.filter((p) => p.host !== host || p.tier !== "hosted")
  PLUGINS.splice(0, PLUGINS.length, ...rest, ...mine.filter((p) => !rest.some((q) => q.id === p.id)))
  bump()
}

/** Re-render when the plugin list changes (the vault's plugins came, went or changed); returns a counter. */
export const usePluginsVersion = () => pluginsChanged.use()

export const pluginById = (id: string) => PLUGINS.find((x) => x.id === id)

/** An icon a plugin adds by name (`icons` in its definition), on or off: a file's `icon: claude`, Terminal's Claude
 *  sessions. */
export const iconNamed = (name: string) => PLUGINS.find((p) => p.icons?.[name])?.icons![name] ?? null

/** Off until turned on (`enabled`): the vault's plugins (they run code), and the app's that change how everything
 *  behaves or that few want (`offByDefault`: Vim, Finance). */
const optIn = (p: Plugin) => p.tier === "vault" || !!p.offByDefault
const hostedOwn = (p: Plugin, disabled: string[], seen: string[]) =>
  !!hostedOn.get(p.id) && !p.problems?.length && !p.meta?.approval && isEnabled(p.host!, disabled, [...seen, p.id])

/** On: not switched off (an opt-in plugin: switched on, and nothing wrong with it), and everything it requires is on
 *  (all the way down). */
/** The vault's plugins (and Obsidian's) off for this window's visit, the crash screen's "Reload with vault plugins
 *  off": code written for this vault can't keep the app from opening, and the Plugins page can turn that one off.
 *  Nothing is written; turnPluginsBackOn ends it. The app's own stay on (the file tree is one). */
export const safeMode = (() => { try { return sessionStorage.getItem("vaultite.safe") === "1" } catch { return false } })()
export function turnPluginsBackOn() {
  try { sessionStorage.removeItem("vaultite.safe") } catch { /* none kept */ }
  location.reload()
}

export function isEnabled(id: string, disabled: string[], seen: string[] = []): boolean {
  const p = pluginById(id)
  if (!p || seen.includes(id) || (safeMode && (p.tier === "vault" || p.tier === "hosted"))) return false
  const own = p.tier === "hosted" ? hostedOwn(p, disabled, seen)
    : optIn(p) ? getPrefs().enabled.includes(id) && !p.problems?.length && !p.meta?.approval : !disabled.includes(id)
  return own && (p.requires ?? []).every((r) => isEnabled(r, disabled, [...seen, id]))
}

/** Its own switch (not what it requires): the app's plugins are on unless in `disabled`, opt-in ones (the vault's,
 *  `offByDefault`) are off unless in `enabled`. */
export function switchedOn(p: Plugin, prefs = getPrefs()) {
  if (p.tier === "hosted") return !!hostedOn.get(p.id)
  return optIn(p) ? prefs.enabled.includes(p.id) : !prefs.disabled.includes(p.id)
}

/** Let a vault plugin run on this machine as it was shown (its files' hash: refused if they changed since; core/trust.ts).
 *  Only this machine's owner may; false when it wasn't allowed (said in a toast). */
export async function allowPlugin(p: Plugin, edits?: boolean) {
  try {
    if (p.tier === "hosted") { await hostOf(p)?.allow?.(p.id); return true }
    await op("plugin.allow", { id: p.id, ...(p.meta?.hash ? { hash: p.meta.hash } : {}), ...(edits === undefined ? {} : { edits }) })
    void reload() // (this machine's yes isn't a vault file: no change comes to say it)
    return true
  } catch (e) {
    notifyError(e, `Couldn't allow ${p.name} on this machine`)
    return false
  }
}

/** What it stands in for ("obsidian:dataview"), the runner's "*" left out. */
const stands = (p: Plugin) => Object.entries(p.replaces ?? {}).flatMap(([a, ids]) => (Array.isArray(ids) ? ids : []).filter((x) => x !== "*").map((x) => `${a}:${x}`))
/** Opt-in plugins switched on that stand in for the same as `p` (Vaultite's Dataview and Obsidian's): never both on.
 *  The app's own on by default (Search) stay. */
function alternativesOf(p: Plugin, prefs = getPrefs()) {
  const mine = stands(p)
  if (!mine.length) return []
  return PLUGINS.filter((q) => q.id !== p.id && (optIn(q) || q.tier === "hosted") && switchedOn(q, prefs) && stands(q).some((k) => mine.includes(k)))
}
/** A hosted plugin's stand-in here, on or off (Vaultite's Excalidraw for Obsidian's): an opt-in one, so the two are
 *  never both on and the Plugins page draws them as one row. The app's own on by default (Search) aren't. */
export function standInOf(h: Plugin) {
  const theirs = h.tier === "hosted" ? stands(h) : []
  return theirs.length ? PLUGINS.find((q) => q.tier !== "hosted" && optIn(q) && stands(q).some((k) => theirs.includes(k))) ?? null : null
}
/** The opt-in plugins on that stand in for another app's plugin (`standingIn("obsidian", "dataview")`): its original
 *  stays off while one is. */
export function standingIn(app: string, id: string) {
  const { disabled } = getPrefs()
  return PLUGINS.filter((q) => q.tier !== "hosted" && optIn(q) && stands(q).includes(`${app}:${id}`) && isEnabled(q.id, disabled))
}

/** `quiet`: no word of the stand-ins it turned off (a swap the user asked for by name). */
export function setSwitch(p: Plugin, on: boolean, quiet = false) {
  if (on) {
    const others = alternativesOf(p)
    for (const q of others) setSwitch(q, false)
    const label = (q: Plugin) => (q.tier === "hosted" ? `${q.name} (${hostOf(q)?.kind ?? q.host})` : q.name)
    if (others.length && !quiet) notify(`Turned off ${others.map(label).join(" and ")}: ${label(p)} does the same`)
  }
  if (p.tier === "hosted") return void Promise.resolve(hostOf(p)?.setOn(p.id, on)).catch((e) => notifyError(e, `Couldn't turn ${p.name} ${on ? "on" : "off"}`))
  // A vault plugin turned on here is allowed to run here first (as it's shown), then turned on in the vault (refused,
  // it's on and waits for this machine's owner).
  if (p.tier === "vault" && on) return void allowPlugin(p).then(() => turn(p, true))
  turn(p, on)
}

function turn(p: Plugin, on: boolean) {
  const { disabled, enabled } = getPrefs()
  if (on) { showPanelsOf(p); showSectionsOf(p) }
  if (optIn(p)) return setPrefs({ enabled: on ? [...enabled.filter((id) => id !== p.id), p.id] : enabled.filter((id) => id !== p.id) })
  return setPrefs({ disabled: on ? disabled.filter((id) => id !== p.id) : [...disabled.filter((id) => id !== p.id), p.id] })
}

export function useEnabled() {
  usePluginsVersion()
  const { disabled } = usePrefs()
  return (id: string) => isEnabled(id, disabled)
}

export const names = (ids: string[] = []) => ids.map((i) => pluginById(i)?.name ?? i).join(" and ")

// A shortcut for a command whose plugin is off, waits to be allowed here or failed to load says so (its id's prefix
// names a vault plugin that isn't loaded).
setMissingCommand((id) => {
  const p = PLUGINS.find((x) => x.commands?.some((c) => c.id === id)) ?? pluginById(id.split(":")[0])
  const { disabled } = getPrefs()
  if (!p || isEnabled(p.id, disabled)) return null
  const off = (p.requires ?? []).filter((r) => !isEnabled(r, disabled))
  const why = !switchedOn(p) ? "is off" : p.meta?.approval ? "waits for you to allow it on this machine" : p.problems?.length ? "couldn't load"
    : off.length ? `needs ${names(off)}, which is off` : "is off"
  const keys = keyCaps(keysOf({ id })[0] ?? "").join("")
  return () => notify(`${keys}: ${p.name} ${why}`, { id: `plugin:${p.id}`, action: { label: "Review", run: () => openDetail(`plugin/${p.id}`) } })
})

/** Plugin ids in the saved order (prefs.order: plugins.json's `order`, from when the Plugins page could be dragged; it
 *  only breaks ties now: search, links, sidebar panels of equal `sort`); new ones after the ones in it. */
function orderedIds(order: string[]) {
  const ids = PLUGINS.map((p) => p.id)
  const at = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length + ids.indexOf(id) : i }
  return [...ids].sort((a, b) => at(a) - at(b))
}

/** Plugins in the saved order (prefs.order). */
function ordered(order: string[]) {
  const ids = orderedIds(order)
  return [...PLUGINS].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
}

export function usePlugins() {
  usePluginsVersion()
  return ordered(usePrefs().order)
}

/** The enabled plugins, in order. */
export function active(disabled: string[], order: string[]) {
  return ordered(order).filter((p) => isEnabled(p.id, disabled))
}

/** The file tree's marks from the plugins that are on (`fileMarks`), by path; the first plugin's wins. */
export function fileMarks(store: Store, disabled: string[]): Record<string, FileMark> {
  const out: Record<string, FileMark> = {}
  for (const p of PLUGINS) {
    if (!p.fileMarks || !isEnabled(p.id, disabled)) continue
    try { for (const [path, m] of Object.entries(p.fileMarks(store))) out[path] ??= m } catch { /* a plugin failing must not break the tree */ }
  }
  return out
}

/** Icons plugins that are on give files and folders (`fileIcons`), by path; the first plugin's wins. Worked out once per
 *  store and setup: the tree and the tabs ask for every row. */
let icons: { key: unknown[]; out: Record<string, FileIcon> } | null = null
export function fileIcons(store: Store, disabled: string[]): Record<string, FileIcon> {
  const key = [store, disabled, getPrefs().enabled, pluginsChanged.version()]
  if (icons?.key.every((k, i) => k === key[i])) return icons.out
  const out: Record<string, FileIcon> = {}
  for (const p of PLUGINS) {
    if (!p.fileIcons || !isEnabled(p.id, disabled)) continue
    try { for (const [path, i] of Object.entries(p.fileIcons(store))) out[path] ??= i } catch { /* a plugin failing must not break the tree */ }
  }
  icons = { key, out }
  return out
}

/** What plugins that are on draw into the file tree's rows (`fileRows`), by path; the first plugin's wins. */
const rows = signal()
export const fileRowsChanged = () => rows.notify()
let rowsMemo: { key: unknown[]; out: Record<string, FileRow> } | null = null
export function useFileRows(disabled: string[]): Record<string, FileRow> {
  const key = [rows.use(), disabled, getPrefs().enabled, pluginsChanged.version()]
  if (rowsMemo?.key.every((k, i) => k === key[i])) return rowsMemo.out
  const out: Record<string, FileRow> = {}
  for (const p of PLUGINS) {
    if (!p.fileRows || !isEnabled(p.id, disabled)) continue
    try { for (const [path, r] of Object.entries(p.fileRows())) out[path] ??= r } catch { /* a plugin failing must not break the tree */ }
  }
  rowsMemo = { key, out }
  return out
}

// ---------- the sidebars' panels: .vaultite/sidebars.json (core/sidebars.ts) ----------
// sidebars.json, unless a plugin that's on keeps the setup itself (`sidebarSetup`: Workspaces).

/** A panel of a plugin: its key ("terminal:sessions"), its plugin, its definition. */
export type PanelOf = { key: string; plugin: Plugin; panel: SidebarPanel }

/** The panels of the plugins that are on, by `sort` (then the plugins' order): the order of the Panels menu. */
export function sidebarPanels(disabled: string[], order: string[]): PanelOf[] {
  return active(disabled, order)
    .flatMap((p) => Object.entries(p.sidebar ?? {}).map(([name, panel]) => ({ key: `${p.id}:${name}`, plugin: p, panel })))
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => (a.panel.sort ?? 100) - (b.panel.sort ?? 100) || a.i - b.i)
}

/** Every plugin's panels (on or off), for the default setup. */
const panelInfo = (prefs = getPrefs()) =>
  ordered(prefs.order).flatMap((p) => Object.entries(p.sidebar ?? {}).map(([name, s]) => ({ key: `${p.id}:${name}`, sort: s.sort, hidden: s.hidden })))

const setup = signal()
/** Tell the sidebars a plugin's setup changed (a workspace switch). */
export const sidebarsChanged = () => setup.notify()
function provided(prefs = getPrefs()) {
  for (const p of PLUGINS) {
    if (!p.sidebarSetup || !isEnabled(p.id, prefs.disabled)) continue
    const own = p.sidebarSetup.get()
    if (own) return { own, set: p.sidebarSetup.set }
  }
  return null
}
/** sidebars.json as saved (null: unset, the default). */
export const savedSidebars = (prefs = getPrefs()) => prefs.sidebars
/** sidebars.json's setup: as saved, or the default while it's unset (what a workspace without its own shows). */
export const vaultSidebars = (prefs = getPrefs()): Sidebars => prefs.sidebars ?? defaultSidebars(panelInfo(prefs))
/** The sidebars' setup in effect: a plugin's own (the current workspace's), else sidebars.json's. */
export const sidebars = (prefs = getPrefs()): Sidebars => provided(prefs)?.own ?? vaultSidebars(prefs)
/** Change the setup where it's kept: the plugin that has it (the current workspace), else sidebars.json (written
 *  whole: the first change writes the default out). */
function setSidebars(next: Sidebars) {
  if (sameSidebars(next, sidebars())) return
  const p = provided()
  if (p) return p.set(next)
  return setPrefs({ sidebars: next })
}
const changeSidebars = (f: (s: Sidebars) => Sidebars) => setSidebars(f(sidebars()))
/** Save a setup as sidebars.json's, whatever's current: what a workspace without panels of its own shows, and what new
 *  workspaces start with. */
export const setDefaultSidebars = (next: Sidebars) => setPrefs({ sidebars: next })

let snap: Sidebars | null = null
export function useSidebars() {
  usePluginsVersion()
  const prefs = usePrefs()
  return setup.use(() => {
    const next = sidebars(prefs)
    if (!snap || !sameSidebars(snap, next)) snap = next
    return snap
  })
}

/** A sidebar's panels as drawn, top to bottom: the ones whose plugin is on. */
export function panelsIn(side: Side, s: Sidebars, disabled: string[], order: string[]): PanelOf[] {
  const on = new Map(sidebarPanels(disabled, order).map((x) => [x.key, x]))
  return s[side].flatMap((k) => on.get(k) ?? [])
}

/** The panels a phone draws in its drawer's dock, in order: docked, shown, on and `dockable`. */
export function phoneDock(s: Sidebars, disabled: string[], order: string[]): PanelOf[] {
  const on = new Map(sidebarPanels(disabled, order).filter((x) => x.panel.dockable).map((x) => [x.key, x]))
  return (s.dock ?? []).filter((k) => sideIn(s, k)).flatMap((k) => on.get(k) ?? [])
}
/** A sidebar's panels as a phone's drawer stacks them: without the docked ones. */
export function drawerPanels(side: Side, s: Sidebars, disabled: string[], order: string[]): PanelOf[] {
  const docked = new Set(phoneDock(s, disabled, order).map((x) => x.key))
  return panelsIn(side, s, disabled, order).filter((x) => !docked.has(x.key))
}

/** Which sidebar a panel is in (null: hidden). */
export const sideOf = (key: string, s = sidebars()) => sideIn(s, key)

/** The sidebar panel a view tab is (`view:files`, `view:search/query`: the panel whose `view` is its name), if any. */
export function panelOfView(to: string | undefined) {
  if (!to?.startsWith("view:")) return null
  const name = to.slice(5).split("/")[0]
  const { disabled, order } = getPrefs()
  return sidebarPanels(disabled, order).find((x) => x.panel.view === name)?.key ?? null
}

/** Put a panel somewhere (moved, or shown if it was hidden): see Place. */
export const dockPanel = (key: string, to: Place) => changeSidebars((s) => placePanel(s, key, to))
/** Put a panel at the end of a sidebar, open, and that sidebar open: what every move without a drop does (a sidebar's
 *  toggle, Move to the other sidebar, ticking it in the Panels menu), so where it went is in sight. */
export function dockAtEnd(key: string, side: Side) {
  changeSidebars((s) => setCollapsed(placePanel(s, key, { side, before: null }), key, false))
  if (side === "left" ? !getPrefs().sidebar : !getPrefs().rightSidebar) void setPrefs(side === "left" ? { sidebar: true } : { rightSidebar: true })
}
/** Hide a panel (out of both sidebars; its plugin stays on). */
export const hidePanel = (key: string) => changeSidebars((s) => withoutPanel(s, key))
/** Give a panel a height (px; a divider dragged), or none (null: as tall as what it draws). */
/** Give a panel a height (null: as tall as what it draws); `at`: its sidebar's height now, so other screens draw the
 *  heights in proportion (core/sidebars.ts heightsAt). */
export const setPanelHeight = (key: string, px: number | null, at?: number) => changeSidebars((s) => setHeight(s, key, px, at))
/** Several panels' heights at once (a divider dragged: the panels on both sides of it), px or null for none. */
export const setPanelHeights = (change: Record<string, number | null>, at?: number) => changeSidebars((s) => setHeights(s, change, at))
/** Put a panel in the phone's dock, or back in its drawer. */
export const setPanelDocked = (key: string, docked: boolean) => changeSidebars((s) => setDocked(s, key, docked))
/** Fold a panel to its heading, or open it again. */
export const togglePanelCollapsed = (key: string) => changeSidebars((s) => setCollapsed(s, key, !s.collapsed.includes(key)))

/** Bring a sidebar panel into sight (Reveal current file in file tree): its sidebar open (not a rail), the panel
 *  unfolded. Not one the user hid, or whose plugin is off: false then. */
// (a phone shows a sidebar as a drawer: components/PhoneDrawer.tsx opens it)
let drawerOpener: ((side: Side) => void) | null = null
export const setDrawerOpener = (fn: (side: Side) => void) => { drawerOpener = fn }

export function revealPanel(key: string) {
  const prefs = getPrefs(), s = sidebars(prefs), side = sideIn(s, key)
  if (!side || !sidebarPanels(prefs.disabled, prefs.order).some((x) => x.key === key)) return false
  if (drawerOpener && !isDesktop()) { setSidebars(setCollapsed(s, key, false)); drawerOpener(side); return true }
  if (side === "left" ? !prefs.sidebar : !prefs.rightSidebar) void setPrefs(side === "left" ? { sidebar: true } : { rightSidebar: true })
  setSidebars(setCollapsed(s, key, false))
  return true
}

/** A plugin was turned on: its sections of a blank tab's page (not the ones it
 *  marks `hidden`) join the end of the page, when newtab.json lists the sections (the default lists them already). */
function showSectionsOf(p: Plugin) {
  const { sections } = getPrefs().newTab
  const add = sectionsOf(p).filter((x) => !x.section.hidden).map((x) => x.key).filter((k) => !sections?.includes(k))
  if (sections && add.length) void setPrefs({ newTab: { ...getPrefs().newTab, sections: [...sections, ...add] } })
}

/** A plugin was turned on: its panels (not the ones it marks `hidden`) join the end of the left sidebar, where the
 *  setup is saved (the default lists them already). */
function showPanelsOf(p: Plugin) {
  const s = sidebars()
  const add = Object.entries(p.sidebar ?? {}).filter(([, x]) => !x.hidden).map(([name]) => `${p.id}:${name}`).filter((k) => !sideIn(s, k))
  if (!add.length || (!provided() && !getPrefs().sidebars)) return
  setSidebars(add.reduce((acc, k) => placePanel(acc, k, { side: "left", before: null }), s))
}

/** What the plugins that are on draw in one place (`slot`: its items by name), left to right by their `sort`. */
function slotItems<K extends "header" | "status" | "fileBar" | "noteTop">(slot: K, disabled: string[], order: string[]) {
  return active(disabled, order)
    .flatMap((p) => Object.entries(p[slot] ?? {}).map(([name, item]) => ({ key: `${p.id}:${name}`, plugin: p, item: item as NonNullable<Plugin[K]>[string] })))
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => (a.item.sort ?? 100) - (b.item.sort ?? 100) || a.i - b.i)
}
/** The sidebar's header (see HeaderItem), the status bar (StatusItem) and a file's header (FileBarItem). */
export const headerItems = (disabled: string[], order: string[]) => slotItems("header", disabled, order)
export const statusItems = (disabled: string[], order: string[]) => slotItems("status", disabled, order)
export const fileBarItems = (disabled: string[], order: string[]) => slotItems("fileBar", disabled, order)
export const noteTopItems = (disabled: string[], order: string[]) => slotItems("noteTop", disabled, order)

/** What the plugins that are on can draw at the start of the status bar (see AmbientItem), as "<plugin>:<name>". */
export function ambientItems(disabled: string[], order: string[]) {
  return active(disabled, order).flatMap((p) => Object.entries(p.ambient ?? {}).map(([name, item]) => ({ key: `${p.id}:${name}`, item })))
}

/** The names the plugins that are on give the first steps of key sequences (see `keyGroups`), by canonical steps. */
export function keyGroupNames(disabled: string[], order: string[]) {
  const out = new Map<string, string>()
  for (const p of active(disabled, order)) for (const [k, name] of Object.entries(p.keyGroups ?? {})) out.set(canonical(k).toLowerCase(), name)
  return out
}

/** What the plugins that are on run in the background (see `background` in PluginDef). */
export const backgrounds = (disabled: string[], order: string[]) =>
  active(disabled, order).filter((p) => p.background).map((p) => ({ key: p.id, Run: p.background! }))

/** Where a device's first tab goes (see `home` in PluginDef): the first plugin that's on and answers, or null. */
export function homeTab(store: Store, disabled: string[], order: string[]) {
  for (const p of active(disabled, order)) {
    try { const to = p.home?.(store); if (to) return to } catch { /* a plugin failing must not keep the app from starting */ }
  }
  return null
}

/** A plugin's sections of a blank tab's page, keyed "<plugin id>:<name>". */
function sectionsOf(p: Plugin): { key: string; section: NewTabSection }[] {
  const nt = p.newTab
  if (!nt) return []
  return Object.entries(nt).map(([name, section]) => ({ key: `${p.id}:${name}`, section }))
}

/** The sections the plugins that are on add to a blank tab's page (see `newTab` in PluginDef); the app's own are
 *  core/newtab.ts' CORE_SECTIONS. */
export const newTabSections = (disabled: string[], order: string[]) => active(disabled, order).flatMap(sectionsOf)

/** A plugin's dashboards as it ships them (pages/Today.md): [{name, text}]. */
export function templatesOf(id: string) {
  const p = pluginById(id)
  if (!p) return []
  if (p.tier === "vault") return p.pages ?? []
  const dir = `/${p.tier}/${id}/pages/`
  return Object.entries(pages).filter(([path]) => path.includes(dir)).map(([path, text]) => ({ name: path.split("/").pop()!.replace(/\.md$/, ""), text }))
}

/** Plugins in sections by their manifest's `category` (core/categories.ts),
 *  in that order, Other (none or unknown) last; sections with none left out. The list's order is kept within each. */
export function byCategory<T extends Pick<Plugin, "category">>(list: T[]) {
  return [...CATEGORIES, OTHER]
    .map((c) => ({ id: c.id as string, label: c.label as string, plugins: list.filter((p) => categoryOf(p.category).id === c.id) }))
    .filter((s) => s.plugins.length)
}

/** A plugin's colour: its dashboard's `tint` (People: var(--people)), else the app's accent. */
export function tintOfPlugin(id: string) {
  const t = templatesOf(id)[0]?.text.match(/^tint:[ \t]*([a-z-]+)[ \t]*$/m)?.[1]
  return t ? `var(--${t})` : "var(--primary)"
}

/** The detail sheet for a path ("person/People%2FAlice%20Park"), from whichever enabled plugin handles that kind. */
export function detailFor(path: string, disabled: string[]) {
  const [kind, ...rest] = path.split("/")
  const args = rest.map((s) => { try { return decodeURIComponent(s) } catch { return s } })
  const p = PLUGINS.find((x) => x.details?.[kind] && isEnabled(x.id, disabled))
  return p ? { def: p.details![kind], args } : null
}


/** The file view of the enabled plugin that shows this file, by its type (core/fileprops.ts): never by its folder. */
export function fileViewFor(file: { path: string; type?: string | null }, disabled: string[]) {
  if (!file.type) return null
  for (const p of PLUGINS) {
    const v = p.files
    if (v && isEnabled(p.id, disabled) && v.types?.includes(file.type)) return { plugin: p, view: v }
  }
  return null
}

/** How files of a type are drawn
 *  as pages (FileView.page), by whichever plugin does, on or off: a plugin's preview shows its pages as they'd look. */
export const pageViewOf = (type: string) => PLUGINS.find((p) => p.files?.page && p.files.types?.includes(type))?.files?.page ?? null
/** Whether a plain Markdown file in `folder` would be a kind's (People/,
 *  Logs/Gym/): such a folder holds only that kind, so another sort of note goes where new notes go instead. */
export function kindFolder(folder: string, disabled = getPrefs().disabled) {
  const parts = folder.split("/")
  return PLUGINS.some((p) => p.files?.folders && isEnabled(p.id, disabled) && p.files.folders.some((f) => parts.includes(f)))
}

/** The plugin that's on and draws files like this one (by extension, the longest that fits: "excalidraw.md" before a
 *  plain "md"; see FileFormat), or null. */
/** Whether a file takes its whole pane in a tab (its format's `layout: "pane"`: a canvas, a drawing). */
export const fillsPane = (path: string, disabled: string[]) => (fileFormatFor(path, disabled) ?? formatFor(path, disabled)?.format)?.layout === "pane"

/** The format a plugin that's on gives this one Markdown file (`fileFormat`), or null. */
export function fileFormatFor(path: string, disabled: string[]) {
  if (!/\.md$/i.test(path)) return null
  for (const p of PLUGINS) {
    if (!p.fileFormat || !isEnabled(p.id, disabled)) continue
    const f = p.fileFormat(path)
    if (f) return f
  }
  return null
}

export function formatFor(path: string, disabled: string[]) {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase()
  let best: { plugin: Plugin; format: FileFormat; ext: string } | null = null
  for (const p of PLUGINS) {
    if (!p.formats || !isEnabled(p.id, disabled)) continue
    for (const f of Object.values(p.formats)) {
      for (const ext of f.exts) if (name.endsWith(`.${ext}`) && name.length > ext.length + 1 && (!best || ext.length > best.ext.length)) best = { plugin: p, format: f, ext }
    }
  }
  return best && { plugin: best.plugin, format: best.format, ext: best.ext }
}
// (asked for every file's name, stem() in core/files.ts: remembered per name until the plugins or the switches change)
let looked: { disabled: string[]; enabled: string[]; vault: Plugin[]; names: Map<string, Drawn | null> } | null = null
setFormatLookup((path) => {
  const { disabled, enabled } = getPrefs(), vault = PLUGINS.filter((p) => p.tier === "vault")
  if (looked?.disabled !== disabled || looked.enabled !== enabled || looked.vault.length !== vault.length || looked.vault.some((p, i) => p !== vault[i])) {
    looked = { disabled, enabled, vault, names: new Map() }
  }
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase()
  let hit = looked.names.get(name)
  if (hit === undefined) {
    const f = formatFor(name, disabled)
    looked.names.set(name, hit = f && { ext: f.ext, page: !!f.format.page })
  }
  return hit
})

setFenceLookup((lang) => PLUGINS.some((p) => p.fences?.[lang] && isEnabled(p.id, getPrefs().disabled)))

/** Who draws ```block-<name> (the enabled plugin that has it, else the one that would, off) and its declaration, null
 *  when undeclared. A "```<lang>" name is a code fence a plugin draws: its text is its own, so no declaration. */
export function blockFor(name: string, disabled: string[]) {
  if (name.startsWith("```")) {
    const lang = name.slice(3), all = PLUGINS.filter((p) => p.fences?.[lang])
    const on = all.find((p) => isEnabled(p.id, disabled))
    return { plugin: on ?? all[0] ?? null, render: on ? on.fences![lang] : null, decl: null }
  }
  const all = PLUGINS.filter((p) => p.blocks?.[name])
  const on = all.find((p) => isEnabled(p.id, disabled))
  const p = on ?? all[0] ?? null
  const decl = p?.blockDecls && Object.hasOwn(p.blockDecls, name) ? p.blockDecls[name] : null
  return { plugin: p, render: on ? on.blocks![name] : null, decl }
}

/** Timeline entry kinds from every enabled plugin ("call" from People). */
// Views' titles and icons can follow live data a plugin keeps (a terminal's session name and state): the plugin says
// when it changed, and whatever draws tabs (useTabInfo) draws them again.
const views = signal()
/** Tell the tabs that a view's `title` or `iconClass` answers something else now. */
export const viewsChanged = () => views.notify()
/** Re-render when a view's title or icon changes (returns a counter). */
export const useViewsVersion = () => views.use()

/** A view as its tabs ask it: its title and icon hooks never throw (one that does would stop every tab bar drawing),
 *  the name and its plain icon instead, the error in Errors. */
const safeViews = new WeakMap<ViewDef, ViewDef>()
function safeView(name: string, def: ViewDef): ViewDef {
  let safe = safeViews.get(def)
  if (safe) return safe
  const guard = <T,>(f: ((arg: string) => T) | undefined, or: T) => f && ((arg: string) => {
    try { return f(arg) } catch (e) { console.error(`view ${name}`, e); return or }
  })
  safe = { ...def, title: guard(def.title, name)!, iconFor: guard(def.iconFor, def.icon), iconClass: guard(def.iconClass, undefined),
    iconTint: guard(def.iconTint, undefined), iconBadge: guard(def.iconBadge, false) }
  safeViews.set(def, safe)
  return safe
}

/** The view a tab's target names ("view:terminal/abc" -> the terminal plugin's `terminal` view, arg "abc"). */
export function viewFor(to: string, disabled: string[]) {
  const [name, ...rest] = to.replace(/^view:/, "").split("/")
  for (const p of PLUGINS) {
    const def = p.views?.[name]
    if (def) return { plugin: p, def: safeView(name, def), arg: rest.join("/"), on: isEnabled(p.id, disabled) }
  }
  return null
}

/** Whether a place is open in tabs a plugin that's on keeps off screen (`openElsewhere`: the other workspaces). */
export const openElsewhere = (to: string, disabled: string[]) =>
  PLUGINS.some((p) => p.openElsewhere && isEnabled(p.id, disabled) && p.openElsewhere().includes(to))

/** The editor extensions of the plugins that are on, for one editor (`editor` in their definitions), in their order. A
 *  plugin whose extension fails to load is left out (the editor still works). */
export async function editorExtensions(ctx: EditorCtx, disabled: string[], order: string[]): Promise<Extension[]> {
  const list = ordered(order).filter((p) => p.editor && isEnabled(p.id, disabled))
  const got = await Promise.all(list.map((p) => Promise.resolve().then(() => p.editor!(ctx)).catch((e) => { console.error(`${p.id}: editor`, e); return [] })))
  return got
}

/** What the plugins that are on add to this editor's right-click menu (`editorMenu`). */
export function editorMenuItems(view: EditorView): MenuItem[] {
  const ctx = { view, path: editorOf(view)?.path }, { disabled } = getPrefs()
  return PLUGINS.filter((p) => p.editorMenu && isEnabled(p.id, disabled)).flatMap((p) => {
    try { return p.editorMenu!(ctx) } catch (e) { console.error(`${p.id}: editorMenu`, e); return [] }
  })
}

/** The kinds of files the plugins that are on make (NewFile): New canvas, New drawing... */
export const pluginNewFiles = (disabled: string[]) => PLUGINS.filter((p) => p.newFiles && isEnabled(p.id, disabled)).flatMap((p) => p.newFiles!)
/** Commands of the plugins that are on, each with its plugin's icon when it has none of its own. */
export const pluginCommands = (disabled: string[]) => PLUGINS.filter((p) => p.commands && isEnabled(p.id, disabled))
  .flatMap((p) => p.commands!.map((c) => (c.icon || !p.icon ? c : { ...c, icon: p.icon })))

export function timelineKinds(disabled: string[]) {
  const out: Record<string, TimelineKind> = {}
  for (const p of PLUGINS) if (p.timeline && isEnabled(p.id, disabled)) Object.assign(out, p.timeline)
  return out
}


/** A coding agent of a plugin that's on (see AgentDef): `name` is its key ("codex"), `plugin` the plugin's id. */
export type Agent = AgentDef & { name: string; plugin: string }

/** The coding agents of the plugins that are on, in the plugins' order. */
export function agentsOn(disabled = getPrefs().disabled, order = getPrefs().order): Agent[] {
  return active(disabled, order).flatMap((p) => Object.entries(p.agents ?? {}).map(([name, a]) => ({ ...a, name, plugin: p.id })))
}

export function useAgents() {
  usePluginsVersion()
  const { disabled, order } = usePrefs()
  return agentsOn(disabled, order)
}

/** The agent a terminal runs, by its id ("codex-<id>", "claude_<account>-<id>", "resume-<name>-<session>", "@<machine>"
 *  suffixes), or null for a plain shell (core/terminalids.ts). */
export function agentOfTerminal(id: string, list = agentsOn()): Agent | null {
  const t = parseTerminal(id)
  return (t && list.find((a) => a.name === t.agent)) ?? null
}
