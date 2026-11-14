import { useEffect, type ReactNode } from "react"
import { signal } from "@/core/signal"
import { share } from "@/core/share"
import { PanelTop, Puzzle } from "lucide-react"
import BUILT_IN_ICONS from "virtual:plugin-icons"
import * as official from "virtual:official-plugins"
import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { MenuItem } from "@/components/ContextMenu"
import { editorOf } from "@/core/editors"
import type { AgentDef, EditorCtx, FileBarItem, FileFormat, FileIcon, FileMark, FileRow, HostedPlugin, Manifest, NewTabSection, Plugin, PluginDef, PluginHost, ReadingBlock, ReadingDrawn, SidebarCtx, SidebarPanel, TabButton, TimelineKind, ViewDef, WebContainer, WebPageAction } from "@/core/define"
import type { Store } from "@/core/data"
import { defaultSidebars, placePanel, sameSidebars, setCollapsed, setDocked, setHeight, setHeights, sideOf as sideIn, withoutPanel, type Place, type Side, type Sidebars } from "../../../core/sidebars.ts"
import { getPrefs, setPrefs, usePrefs } from "@/core/prefs"
import { peekSidebar } from "@/core/peek"
import { isDesktop, isMac, keysText } from "@/core/platform"
import { canonical, keyCaps, keysOf, setMissingCommand } from "@/core/commands"
import { setFenceLookup, setFormatLookup, type Drawn } from "@/core/formats"
import { reload } from "@/core/data"
import { op } from "@/core/http"
import { setPluginAsker } from "@/core/askers"
import { notify, notifyError } from "@/core/notify"
import { openDetail } from "@/core/nav"
import { askGrant } from "@/core/grants"
import { CATEGORIES, categoryOf, OTHER } from "../../../core/categories.ts"
import { autoUpdates, byPolicy } from "../../../core/updates.ts"
import { setMarks } from "../../../core/fileprops.ts"
import { switched } from "../../../core/pluginmeta.ts"
import { parseTerminal } from "../../../core/terminalids.ts"
import { drawnBy, type SettingDecls } from "../../../core/blocks.ts"
import { placeKey } from "../../../core/slots.ts"

export type { Place, Side, Sidebars } from "../../../core/sidebars.ts"
export { readSidebars, sameSidebars } from "../../../core/sidebars.ts"
export type { DetailDef, FileCtx, FileFormat, FileView, FormatCtx, HeaderItem, PageCtx, PageView, SidebarSetup, LinkTarget, Manifest, Plugin, PluginDef, SearchDoc, SidebarCtx, SidebarPanel } from "@/core/define"

const manifests = { ...import.meta.glob<Manifest>("../../../plugins/core/*/manifest.json", { eager: true, import: "default" }), ...official.manifests }
const modules = { ...import.meta.glob<PluginDef>("../../../plugins/core/*/index.tsx", { eager: true, import: "default" }), ...official.modules }
const pages = { ...import.meta.glob<string>("../../../plugins/core/*/pages/*.md", { eager: true, query: "?raw", import: "default" }), ...official.pages }

const folder = (path: string) => path.split("/").slice(-3, -1).join("/")

const keyedDecls = (decls: SettingDecls): SettingDecls => isMac ? decls
  : Object.fromEntries(Object.entries(decls).map(([k, d]) => [k, { ...d, label: d.label && keysText(d.label), description: d.description && keysText(d.description),
    labels: d.labels && Object.fromEntries(Object.entries(d.labels).map(([v, l]) => [v, keysText(l)])) }]))

export const PLUGINS: Plugin[] = Object.entries(manifests)
  .map(([path, { blocks: decls, settings, ...read }]): Plugin => {
    const m = { ...read, description: read.description && keysText(read.description) }
    const f = folder(path)
    const def = Object.entries(modules).find(([p]) => folder(p) === f)?.[1] ?? {}
    const icon = BUILT_IN_ICONS[m.id]
    return { ...m, ...def, icon: (typeof icon === "string" ? def.icons?.[icon] : icon) ?? Puzzle, blockDecls: decls ?? {}, settingsDecls: keyedDecls(settings ?? {}), tier: "core" }
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

const pluginsChanged = signal()
const signature = (ps: Plugin[]) => ps.map((p) => `${p.id}@${p.version ?? ""}:${(p.problems ?? []).join()}:${JSON.stringify(p.meta ?? null)}`).join("\n")

const bump = pluginsChanged.notify
let generation = 0
let vaultIn = false
export const vaultPluginsIn = () => vaultIn

export function setVaultPlugins(list: Plugin[]) {
  const app = PLUGINS.filter((p) => p.tier === "core"), hosted = PLUGINS.filter((p) => p.tier === "hosted")
  const was = signature(PLUGINS.filter((p) => p.tier === "vault"))
  generation++
  PLUGINS.splice(0, PLUGINS.length, ...app, ...(isMac ? list : list.map((p) => ({ ...p, description: p.description && keysText(p.description), settingsDecls: keyedDecls(p.settingsDecls) }))), ...hosted)
  setMarks(PLUGINS.map((p) => ({ marks: p.marks })))
  writeTints()
  const first = !vaultIn
  vaultIn = true
  if (first || signature(list) !== was) bump()
}

const hosts = new Map<string, PluginHost>()
const hostedOn = new Map<string, boolean>()
export const hostOf = (p: Plugin) => (p.host ? hosts.get(p.host) ?? null : null)
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
  generation++
  PLUGINS.splice(0, PLUGINS.length, ...rest, ...mine.filter((p) => !rest.some((q) => q.id === p.id)))
  bump()
}

export const usePluginsVersion = () => pluginsChanged.use()

let byId: { generation: number; map: Map<string, Plugin> } | null = null
export const pluginById = (id: string) => {
  if (byId?.generation !== generation) byId = { generation, map: new Map(PLUGINS.map((p) => [p.id, p])) }
  return byId.map.get(id)
}

/** Hand a question about a file to the AI chat a plugin that's on brings (its `ask`); false when there's none. */
export function askAbout(question: string, file?: string) {
  const p = PLUGINS.find((x) => x.ask && isEnabled(x.id, getPrefs().disabled))
  p?.ask!(question, file)
  return !!p
}

/** An icon a plugin adds by name (`icons` in its definition), on or off: a file's `icon: claude`, Terminal's Claude
 *  sessions. */

export const iconNamed = (name: string) => PLUGINS.find((p) => p.icons?.[name])?.icons![name] ?? null

const optIn = (p: Plugin) => p.tier === "vault" || !!p.offByDefault
const hostedOwn = (p: Plugin, disabled: string[], seen: string[]) =>
  !!hostedOn.get(p.id) && !p.problems?.length && !p.meta?.approval && isEnabled(p.host!, disabled, [...seen, p.id])

export const safeMode = (() => { try { return sessionStorage.getItem("vaultite.safe") === "1" } catch { return false } })()
export function turnPluginsBackOn() {
  try { sessionStorage.removeItem("vaultite.safe") } catch { /* none kept */ }
  location.reload()
}

export function isEnabled(id: string, disabled: string[], seen: string[] = []): boolean {
  if (share) return share.plugins.includes(id) && !!pluginById(id)
  const p = pluginById(id)
  if (!p || seen.includes(id) || (safeMode && (p.tier === "vault" || p.tier === "hosted")) || (p.ai && !getPrefs().ai)) return false
  const own = p.tier === "hosted" ? hostedOwn(p, disabled, seen)
    : p.alwaysOn ? true
    : optIn(p) ? (getPrefs().enabled.includes(id) || disabled.includes(`!${id}`)) && !p.problems?.length && !p.meta?.approval : !disabled.includes(id)
  return own && (p.requires ?? []).every((r) => isEnabled(r, disabled, [...seen, id]))
}

export const offWithAi = (p: Plugin, prefs = getPrefs()) => !!p.ai && !prefs.ai

export function switchedOn(p: Plugin, prefs = getPrefs()) {
  if (p.tier === "hosted") return !!hostedOn.get(p.id)
  if (p.alwaysOn) return true
  return optIn(p) ? prefs.enabled.includes(p.id) : !prefs.disabled.includes(p.id)
}

export async function allowPlugin(p: Plugin, edits?: boolean) {
  try {
    if (p.tier === "hosted") { await hostOf(p)?.allow?.(p.id); return true }
    await op("plugin.allow", { id: p.id, ...(p.meta?.hash ? { hash: p.meta.hash } : {}), ...(edits === undefined ? {} : { edits }) })
    void reload()
    return true
  } catch (e) {
    notifyError(e, `Couldn't allow ${p.name} on this machine`)
    return false
  }
}

export function autoUpdating(p: Plugin, prefs = getPrefs()) {
  const src = p.meta?.source
  return !!src && autoUpdates(prefs, p.id, src.source)
}

export function setAutoUpdate(p: Plugin, on: boolean) {
  const src = p.meta?.source
  if (!src) return
  const { updatesOn, updatesOff } = getPrefs()
  const own = on !== byPolicy(getPrefs(), src.source)
  return setPrefs({ updatesOn: [...updatesOn.filter((id) => id !== p.id), ...(own && on ? [p.id] : [])],
    updatesOff: [...updatesOff.filter((id) => id !== p.id), ...(own && !on ? [p.id] : [])] })
}

export async function updatePlugin(p: Plugin) {
  try {
    const [row] = await op<{ applied?: boolean; to?: string; error?: string; disclosures?: string[] }[]>("plugin.update", { id: p.id, apply: true })
    if (row?.error) throw new Error(row.error)
    if (!row?.applied) { notify(`${p.name} is up to date`); return null }
    const more = (row.disclosures ?? []).filter((d) => d.startsWith("now "))
    if (switchedOn(p) && !more.length) await op("plugin.allow", { id: p.id })
    void reload()
    const review = { label: more.length ? "Review" : "What's new", run: () => openDetail(`plugin/${p.id}`) }
    notify(`${p.name} updated to ${row.to}${more.length && switchedOn(p) ? `. It ${more.join(" and ")}: it waits for you to allow it` : ""}`, { action: review })
    return row.to ?? null
  } catch (e) {
    notifyError(e, `Couldn't update ${p.name}`)
    return null
  }
}

export async function rollbackPlugin(p: Plugin) {
  try {
    const r = await op<{ to: string; from: string }>("plugin.rollback", { id: p.id })
    void reload()
    notify(`${p.name} is back to ${r.to}. It won't update to ${r.from} on its own.`)
    return true
  } catch (e) {
    notifyError(e, `Couldn't roll back ${p.name}`)
    return false
  }
}

const stands = (p: Plugin) => Object.entries(p.replaces ?? {}).flatMap(([a, ids]) => (Array.isArray(ids) ? ids : []).filter((x) => x !== "*").map((x) => `${a}:${x}`))
function alternativesOf(p: Plugin, prefs = getPrefs()) {
  const mine = stands(p)
  if (!mine.length) return []
  return PLUGINS.filter((q) => q.id !== p.id && (optIn(q) || q.tier === "hosted") && switchedOn(q, prefs) && stands(q).some((k) => mine.includes(k)))
}
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

export function setSwitch(p: Plugin, on: boolean, quiet = false): Promise<void> {
  if (p.alwaysOn) return Promise.resolve()
  if (on) {
    const others = alternativesOf(p)
    for (const q of others) setSwitch(q, false)
    const label = (q: Plugin) => (q.tier === "hosted" ? `${q.name} (${hostOf(q)?.kind ?? q.host})` : q.name)
    if (others.length && !quiet) notify(`Turned off ${others.map(label).join(" and ")}: ${label(p)} does the same`)
  }
  if (p.tier === "hosted") return Promise.resolve(hostOf(p)?.setOn(p.id, on)).then(() => {}, (e) => { notifyError(e, `Couldn't turn ${p.name} ${on ? "on" : "off"}`) })
  if (p.tier === "vault" && on) return allowPlugin(p).then(() => turn(p, true))
  return turn(p, on)
}

function turn(p: Plugin, on: boolean) {
  const { disabled, enabled } = getPrefs()
  if (on) { showPanelsOf(p); showSectionsOf(p); showBarItemsOf(p); showHeaderItemsOf(p) }
  if (on) void askGrant(p.id)
  const next = switched({ disabled, enabled }, p.id, on, optIn(p))
  return setPrefs({ ...(next.disabled.join() !== disabled.join() ? { disabled: next.disabled } : {}), ...(next.enabled.join() !== enabled.join() ? { enabled: next.enabled } : {}) })
}

export function useEnabled() {
  usePluginsVersion()
  const { disabled } = usePrefs()
  return (id: string) => isEnabled(id, disabled)
}

export const names = (ids: string[] = []) => ids.map((i) => pluginById(i)?.name ?? i).join(" and ")

/** Why a plugin that isn't on isn't ("People map needs People, which is off"): its own switch said off would send the
 *  user to a switch that's on. */
export function offText(p: Plugin, disabled = getPrefs().disabled) {
  const off = (p.requires ?? []).filter((r) => !isEnabled(r, disabled))
  const why = !switchedOn(p) ? "is off" : p.meta?.approval ? "waits for you to allow it on this machine" : p.problems?.length ? "couldn't load"
    : off.length ? `needs ${names(off)}, which ${off.length > 1 ? "are" : "is"} off` : "is off"
  return `${p.name} ${why}`
}

setMissingCommand((id) => {
  const p = PLUGINS.find((x) => x.commands?.some((c) => c.id === id)) ?? pluginById(id.split(":")[0])
  const { disabled } = getPrefs()
  if (!p || isEnabled(p.id, disabled)) return null
  const keys = keyCaps(keysOf({ id })[0] ?? "").join("")
  return () => notify(`${keys}: ${offText(p, disabled)}`, { id: `plugin:${p.id}`, action: { label: "Review", run: () => openDetail(`plugin/${p.id}`) } })
})

let listed: { v: number; list: Plugin[] } | null = null
export function usePlugins() {
  const v = usePluginsVersion()
  if (listed?.v !== v) listed = { v, list: [...PLUGINS] }
  return listed.list
}

let on: { generation: number; disabled: string[]; enabled: string[]; ai: boolean; list: Plugin[]; key: string } | null = null
export function active(disabled: string[]) {
  const { enabled, ai } = getPrefs()
  if (on?.generation === generation && on.disabled === disabled && on.enabled === enabled && on.ai === ai) return on.list
  const list = PLUGINS.filter((p) => isEnabled(p.id, disabled))
  on = { generation, disabled, enabled, ai, list, key: list.map((p) => p.id).join() }
  return on.list
}
export function activeKey(disabled: string[]) {
  active(disabled)
  return on!.key
}

/** The buttons a tab showing `to` has on hover (`tabButtons`), from the plugins that are on, in their order. */
export function tabButtons(to: string, disabled = getPrefs().disabled): TabButton[] {
  return active(disabled).flatMap((p) => { try { return p.tabButtons?.(to) ?? [] } catch { return [] } })
}

export function fileMarks(store: Store, disabled: string[]): Record<string, FileMark> {
  const out: Record<string, FileMark> = {}
  for (const p of PLUGINS) {
    if (!p.fileMarks || !isEnabled(p.id, disabled)) continue
    try { for (const [path, m] of Object.entries(p.fileMarks(store))) out[path] ??= m } catch { /* a plugin failing must not break the tree */ }
  }
  return out
}

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

export type ReadBlock = (el: HTMLElement, block: ReadingBlock) => Promise<ReadingDrawn | null>
const reading = signal()
let readMemo: { key: unknown[]; out: ReadBlock | null } | null = null
export function useReadBlock(disabled: string[]): ReadBlock | null {
  const key: unknown[] = [usePluginsVersion(), reading.use(), disabled, getPrefs().enabled]
  const list = PLUGINS.filter((p) => p.reading && isEnabled(p.id, disabled))
  const ids = list.map((p) => p.id).join()
  useEffect(() => {
    const stops = list.map((p) => { try { return p.reading!.subscribe(reading.notify) } catch { return () => {} } })
    return () => stops.forEach((s) => s())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- list is new each render: keyed by its ids
  }, [ids])
  const on = list.filter((p) => { try { return p.reading!.active() } catch { return false } })
  key.push(on.map((p) => p.id).join())
  if (readMemo?.key.every((k, i) => k === key[i])) return readMemo.out
  const out: ReadBlock | null = on.length ? async (el, block) => {
    const made: ReadingDrawn[] = []
    for (const p of on) {
      try { const d = await p.reading!.draw(el, block); if (d) made.push(d) } catch (e) { console.error(`${p.id}: reading`, e) }
    }
    return made.length ? { destroy: () => made.forEach((d) => { try { d.destroy?.() } catch (e) { console.error(e) } }) } : null
  } : null
  readMemo = { key, out }
  return out
}

export type PanelOf = { key: string; plugin: Plugin; panel: SidebarPanel }

export function sidebarPanels(disabled: string[]): PanelOf[] {
  const named = [...sidebars().left, ...sidebars().right], ai = getPrefs().ai
  return active(disabled)
    .flatMap((p) => [...Object.entries(p.sidebar ?? {}).filter(([, panel]) => ai || !panel.ai).map(([name, panel]) => ({ key: `${p.id}:${name}`, plugin: p, panel })),
      ...Object.entries(p.sidebarFor ?? {}).flatMap(([name, make]) => named.filter((k) => k.startsWith(`${p.id}:${name}/`)).map((key) => ({ key, plugin: p, panel: panelFor(key, name, p, make) }))),
      ...Object.entries(p.fileBar ?? {}).map(([name, item]) => ({ key: `${p.id}:${name}`, plugin: p, panel: barPanel(`${p.id}:${name}`, p, item) }))])
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => (a.panel.sort ?? 100) - (b.panel.sort ?? 100) || a.i - b.i)
}

const argPanels = new Map<string, SidebarPanel>()
function panelFor(key: string, name: string, p: Plugin, make: (arg: string) => SidebarPanel) {
  let panel = argPanels.get(key)
  if (!panel) argPanels.set(key, panel = make(key.slice(`${p.id}:${name}/`.length)))
  return panel
}

export const taskDoer = (disabled: string[]) => active(disabled).find((p) => p.doTask)?.doTask ?? null

const panelInfo = () =>
  PLUGINS.flatMap((p) => Object.entries(p.sidebar ?? {}).map(([name, s]) => ({ key: `${p.id}:${name}`, sort: s.sort, hidden: s.hidden, side: s.side })))

let drawBarItem: ((item: FileBarItem, ctx: SidebarCtx) => ReactNode) | null = null
export const setBarItemDrawer = (fn: typeof drawBarItem) => { drawBarItem = fn }
const barPanels = new WeakMap<FileBarItem, SidebarPanel>()
function barPanel(key: string, p: Plugin, item: FileBarItem): SidebarPanel {
  let panel = barPanels.get(item)
  if (!panel) {
    panel = { title: item.title ?? p.name, hidden: true, sort: 200, render: (ctx) => drawBarItem?.(item, ctx) ?? null,
      menu: () => [{ label: "Move to top bar", icon: PanelTop, run: () => moveBarItem(key, null) }] }
    barPanels.set(item, panel)
  }
  return panel
}
export const isBarItem = (key: string) => { const { disabled } = getPrefs(); return fileBarItems(disabled).some((x) => x.key === key) }
export function moveBarItem(key: string, before: string | null) {
  const { disabled, fileBarHidden } = getPrefs()
  void setPrefs({ fileBar: placeKey(fileBarItems(disabled).map((x) => x.key), key, before), ...(fileBarHidden.includes(key) ? { fileBarHidden: fileBarHidden.filter((k) => k !== key) } : {}) })
  if (sideIn(sidebars(), key)) hidePanel(key)
}
export function hideBarItem(key: string) {
  const { fileBarHidden } = getPrefs()
  if (!fileBarHidden.includes(key)) void setPrefs({ fileBarHidden: [...fileBarHidden, key] })
  if (sideIn(sidebars(), key)) hidePanel(key)
}

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
export const savedSidebars = (prefs = getPrefs()): Sidebars | null => prefs.sidebars
/** sidebars.json's setup: as saved, or the default while it's unset (what a workspace without its own shows). */
export const vaultSidebars = (prefs = getPrefs()): Sidebars => prefs.sidebars ?? defaultSidebars(panelInfo())
/** The sidebars' setup in effect: a plugin's own (the current workspace's), else sidebars.json's. */
export const sidebars = (prefs = getPrefs()): Sidebars => provided(prefs)?.own ?? vaultSidebars(prefs)
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

export function panelsIn(side: Side, s: Sidebars, disabled: string[]): PanelOf[] {
  const on = new Map(sidebarPanels(disabled).map((x) => [x.key, x]))
  return s[side].flatMap((k) => on.get(k) ?? [])
}

export function phoneDock(s: Sidebars, disabled: string[]): PanelOf[] {
  const on = new Map(sidebarPanels(disabled).filter((x) => x.panel.dockable).map((x) => [x.key, x]))
  return (s.dock ?? []).filter((k) => sideIn(s, k)).flatMap((k) => on.get(k) ?? [])
}
export function drawerPanels(side: Side, s: Sidebars, disabled: string[]): PanelOf[] {
  const docked = new Set(phoneDock(s, disabled).map((x) => x.key))
  return panelsIn(side, s, disabled).filter((x) => !docked.has(x.key))
}

/** Which sidebar a panel is in (null: hidden). */
export const sideOf = (key: string, s = sidebars()) => sideIn(s, key)

export function panelOfView(to: string | undefined) {
  if (!to?.startsWith("view:")) return null
  const name = to.slice(5).split("/")[0]
  const { disabled } = getPrefs()
  return sidebarPanels(disabled).find((x) => x.panel.view === name)?.key ?? null
}

export function dockPanel(key: string | string[], to: Place) {
  const keys = [key].flat()
  keys.forEach(unhideBarItem)
  changeSidebars((s) => keys.reduce((acc, k) => placePanel(acc, k, to), s))
}
function unhideBarItem(key: string) {
  const { fileBarHidden } = getPrefs()
  if (fileBarHidden.includes(key)) void setPrefs({ fileBarHidden: fileBarHidden.filter((k) => k !== key) })
}
/** Put panels at a sidebar's end, unfolded, the sidebar open: every move but a drop does, so where they went is in sight. */
export function dockAtEnd(key: string | string[], side: Side) {
  const keys = [key].flat()
  keys.forEach(unhideBarItem)
  changeSidebars((s) => keys.reduce((acc, k) => setCollapsed(placePanel(acc, k, { side, before: null }), k, false), s))
  if (side === "left" ? !getPrefs().sidebar : !getPrefs().rightSidebar) void setPrefs(side === "left" ? { sidebar: true } : { rightSidebar: true })
}
/** Bring a panel into a sidebar unasked, the sidebar left closed: unfolded, at `side`'s end (or before `before`) if
 *  it's in neither. revealPanel is for what the user asked to see. */
export function offerPanel(key: string, side: Side, before: string | null = null) {
  changeSidebars((s) => setCollapsed(sideIn(s, key) ? s : placePanel(s, key, { side, before: before && s[side].includes(before) ? before : null }), key, false))
}
export function restoreSidebars() {
  const was = sidebars(), d = defaultSidebars(panelInfo())
  setSidebars({ ...was, left: d.left, right: d.right })
  return () => setSidebars(was)
}
export function defaultPanels(s: Sidebars) {
  const d = defaultSidebars(panelInfo())
  return d.left.join() === s.left.join() && d.right.join() === s.right.join()
}
/** Hide a panel (out of both sidebars; its plugin stays on). */
export const hidePanel = (key: string) => changeSidebars((s) => withoutPanel(s, key))
export const setPanelHeight = (key: string, px: number | null, at?: number) => changeSidebars((s) => setHeight(s, key, px, at))
export const setPanelHeights = (change: Record<string, number | null>, at?: number) => changeSidebars((s) => setHeights(s, change, at))
export const setPanelDocked = (key: string, docked: boolean) => changeSidebars((s) => setDocked(s, key, docked))
export type HeadingMode = "shown" | "quiet"
export const headingMode = (panel: SidebarPanel, prefs = getPrefs()): HeadingMode =>
  prefs.panelHeadings === "quiet" && !panel.needsHeading ? "quiet" : "shown"
export const togglePanelCollapsed = (key: string) => changeSidebars((s) => setCollapsed(s, key, !s.collapsed.includes(key)))

export function tabListPanel(prefs = getPrefs()) {
  return sidebarPanels(prefs.disabled).find((x) => x.panel.tabList)?.key ?? null
}
export function tabsInSidebar(prefs = getPrefs()) {
  const key = tabListPanel(prefs)
  return !prefs.tabBar && !!key && !!sideIn(sidebars(prefs), key)
}
export function showTabsIn(where: "sidebar" | "top") {
  const key = tabListPanel()
  if (!key) return
  if (where === "top") {
    void setPrefs({ tabBar: true })
    if (sideIn(sidebars(), key)) hidePanel(key)
    return
  }
  changeSidebars((s) => setCollapsed(sideIn(s, key) ? s : placePanel(s, key, { side: "left", before: s.left[0] ?? null }), key, false))
  void setPrefs({ tabBar: false, ...(sideIn(sidebars(), key) === "left" && !getPrefs().sidebar ? { sidebar: true } : {}) })
}

let drawerOpener: ((side: Side) => void) | null = null
export const setDrawerOpener = (fn: (side: Side) => void) => { drawerOpener = fn }

/** Bring a sidebar panel into sight (Reveal current file in file tree): its sidebar open (not a rail), the panel
 *  unfolded. Not one the user hid, or whose plugin is off: false then. */
export function revealPanel(key: string) {
  const prefs = getPrefs(), s = sidebars(prefs), side = sideIn(s, key)
  if (!side || !sidebarPanels(prefs.disabled).some((x) => x.key === key)) return false
  if (drawerOpener && !isDesktop()) { setSidebars(setCollapsed(s, key, false)); drawerOpener(side); return true }
  if (isDesktop() && peekSidebar(side)) { setSidebars(setCollapsed(s, key, false)); return true }
  if (side === "left" ? !prefs.sidebar : !prefs.rightSidebar) void setPrefs(side === "left" ? { sidebar: true } : { rightSidebar: true })
  setSidebars(setCollapsed(s, key, false))
  return true
}

function showSectionsOf(p: Plugin) {
  const { sections } = getPrefs().newTab
  const add = sectionsOf(p).filter((x) => !x.section.hidden).map((x) => x.key).filter((k) => !sections?.includes(k))
  if (sections && add.length) void setPrefs({ newTab: { ...getPrefs().newTab, sections: [...sections, ...add] } })
}

function showPanelsOf(p: Plugin) {
  const s = sidebars()
  const add = Object.entries(p.sidebar ?? {}).filter(([, x]) => !x.hidden).map(([name, x]) => ({ key: `${p.id}:${name}`, side: x.side ?? "left" })).filter((x) => !sideIn(s, x.key))
  if (!add.length || (!provided() && !getPrefs().sidebars)) return
  setSidebars(add.reduce((acc, x) => placePanel(acc, x.key, { side: x.side, before: null }), s))
}

function showBarItemsOf(p: Plugin) {
  const { statusBar, statusBarLeft, disabled } = getPrefs()
  if (!statusBar) return
  const file = new Set(statusItems(disabled).map((x) => x.key))
  let list = statusBar, left = statusBarLeft
  const add = (key: string, before: string | null) => { if (!list.includes(key)) list = placeKey(list, key, before) }
  for (const [name, x] of Object.entries(p.ambient ?? {})) {
    const key = `${p.id}:${name}`
    if (x.hidden || list.includes(key)) continue
    add(key, list.find((k) => k.startsWith("core:") || file.has(k)) ?? null)
    if (x.left && left) left = [...left, key]
  }
  for (const [name, x] of Object.entries(p.status ?? {})) add(`${p.id}:${name}`, x.after ? null : list.find((k) => k.startsWith("core:")) ?? null)
  if (list !== statusBar) void setPrefs({ statusBar: list, ...(left !== statusBarLeft ? { statusBarLeft: left } : {}) })
}

function slotItems<I extends { sort?: number }>(slot: (p: Plugin) => { [name: string]: I } | undefined, disabled: string[]) {
  return active(disabled)
    .flatMap((p) => Object.entries(slot(p) ?? {}).map(([name, item]) => ({ key: `${p.id}:${name}`, plugin: p, item })))
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => (a.item.sort ?? 100) - (b.item.sort ?? 100) || a.i - b.i)
}
export const headerItems = (disabled: string[]) => slotItems((p) => p.header, disabled)
export function shownHeaderItems(disabled: string[], saved = getPrefs().sidebarHeader) {
  const all = headerItems(disabled)
  if (!saved) return all
  return saved.flatMap((k) => all.find((x) => x.key === k) ?? [])
}
export function setHeaderItemShown(key: string, on: boolean, before: string | null = null) {
  const { disabled } = getPrefs()
  const all = headerItems(disabled).map((x) => x.key), keys = shownHeaderItems(disabled).map((x) => x.key)
  const next = all.slice(all.indexOf(key) + 1).find((k) => keys.includes(k)) ?? null
  return setPrefs({ sidebarHeader: on ? placeKey(keys, key, before ?? next) : keys.filter((k) => k !== key) })
}
function showHeaderItemsOf(p: Plugin) {
  if (!getPrefs().sidebarHeader) return
  for (const name of Object.keys(p.header ?? {})) void setHeaderItemShown(`${p.id}:${name}`, true)
}
export const statusItems = (disabled: string[]) => slotItems((p) => p.status, disabled)
export function fileBarItems(disabled: string[], saved = getPrefs().fileBar) {
  const all = slotItems((p) => p.fileBar, disabled)
  const at = (k: string) => { const i = saved?.indexOf(k) ?? -1; return i < 0 ? Infinity : i }
  return saved ? [...all].sort((a, b) => at(a.key) - at(b.key)) : all
}
export const noteItems = (disabled: string[], at: "top" | "end") => slotItems((p) => (at === "top" ? p.noteTop : p.noteEnd), disabled)

export function ambientItems(disabled: string[]) {
  const ai = getPrefs().ai
  return active(disabled).flatMap((p) => Object.entries(p.ambient ?? {}).filter(([, item]) => ai || !item.ai).map(([name, item]) => ({ key: `${p.id}:${name}`, item })))
}

export function keyGroupNames(disabled: string[]) {
  const out = new Map<string, string>()
  for (const p of active(disabled)) for (const [k, name] of Object.entries(p.keyGroups ?? {})) out.set(canonical(k).toLowerCase(), name)
  return out
}

export const backgrounds = (disabled: string[]) =>
  active(disabled).filter((p) => p.background).map((p) => ({ key: p.id, Run: p.background! }))

export const playerFor = (disabled: string[]) => PLUGINS.find((p) => p.player && isEnabled(p.id, disabled))?.player ?? null

export function homeTab(store: Store, disabled: string[]) {
  for (const p of active(disabled)) {
    try { const to = p.home?.(store); if (to) return to } catch { /* a plugin failing must not keep the app from starting */ }
  }
  return null
}

function sectionsOf(p: Plugin): { key: string; section: NewTabSection }[] {
  const nt = p.newTab
  if (!nt) return []
  return Object.entries(nt).map(([name, section]) => ({ key: `${p.id}:${name}`, section }))
}

export const newTabSections = (disabled: string[]) => active(disabled).flatMap(sectionsOf)

export function templatesOf(id: string) {
  const p = pluginById(id)
  if (!p) return []
  if (p.tier === "vault") return p.pages ?? []
  const dir = `/${p.tier}/${id}/pages/`
  return Object.entries(pages).filter(([path]) => path.includes(dir)).map(([path, text]) => ({ name: path.split("/").pop()!.replace(/\.md$/, ""), text }))
}

export function byCategory<T extends Pick<Plugin, "category">>(list: T[]) {
  const all: readonly { id: string; label: string }[] = [...CATEGORIES, OTHER]
  return all
    .map((c) => ({ id: c.id, label: c.label, plugins: list.filter((p) => categoryOf(p.category).id === c.id) }))
    .filter((s) => s.plugins.length)
}

export function tintOfPlugin(id: string) {
  const t = templatesOf(id)[0]?.text.match(/^tint:[ \t]*([a-z-]+)[ \t]*$/m)?.[1]
  return t ? `var(--${t})` : "var(--primary)"
}

const CATEGORY_TINTS: Record<string, string> = {
  navigation: "blue", writing: "orange", life: "green", health: "pink", "ai-apps": "purple", agents: "indigo", formats: "teal",
}
export function tileTint(id: string) {
  const own = tintOfPlugin(id)
  return own !== "var(--primary)" ? own : categoryTint(categoryOf(pluginById(id)?.category).id)
}
export const categoryTint = (category: string) => `var(--${CATEGORY_TINTS[category] ?? "gray"})`

export function detailFor(path: string, disabled: string[]) {
  const [kind, ...rest] = path.split("/")
  const args = rest.map((s) => { try { return decodeURIComponent(s) } catch { return s } })
  const p = PLUGINS.find((x) => x.details?.[kind] && isEnabled(x.id, disabled))
  return p ? { def: p.details![kind], args } : null
}

export function fileViewFor(file: { path: string; type?: string | null }, disabled: string[]) {
  if (!file.type) return null
  for (const p of PLUGINS) {
    const v = p.files
    if (v && isEnabled(p.id, disabled) && v.types?.includes(file.type)) return { plugin: p, view: v }
  }
  return null
}

export const pageViewOf = (type: string) => PLUGINS.find((p) => p.files?.page && p.files.types?.includes(type))?.files?.page ?? null
/** Whether a plain Markdown file in `folder` would be a kind's (People/,
 *  Logs/Gym/): such a folder holds only that kind, so another sort of note goes where new notes go instead. */
export function kindFolder(folder: string, disabled = getPrefs().disabled) {
  const parts = folder.split("/")
  return PLUGINS.some((p) => p.files?.folders && isEnabled(p.id, disabled) && p.files.folders.some((f) => parts.includes(f)))
}

export const fillsPane = (path: string, disabled: string[]) => (fileFormatFor(path, disabled) ?? formatFor(path, disabled)?.format)?.layout === "pane"

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

/** Who draws ```block-<name> (the enabled plugin that has it, else the one that would, off; with `by`, the one its option
 *  names, else `unnamed` says why) and its declaration. A "```<lang>" name is a fence a plugin draws: no declaration. */
export function blockFor(name: string, disabled: string[], options: Record<string, unknown> = {}) {
  if (name.startsWith("```")) {
    const lang = name.slice(3), all = PLUGINS.filter((p) => p.fences?.[lang])
    const on = all.find((p) => isEnabled(p.id, disabled))
    return { plugin: on ?? all[0] ?? null, render: on ? on.fences![lang] : null, decl: null, unnamed: "" }
  }
  const declared = PLUGINS.filter((p) => p.blockDecls && Object.hasOwn(p.blockDecls, name))
  const declarer = declared.find((p) => isEnabled(p.id, disabled)) ?? declared[0]
  const by = declarer?.blockDecls[name].by
  if (by && isEnabled(declarer.id, disabled)) {
    const drawers = PLUGINS.filter((p) => p.draws?.includes(name) && p.blocks?.[name])
    const decl = drawnBy(declarer.blockDecls[name], drawers.filter((p) => isEnabled(p.id, disabled)).map((p) => p.id))
    const p = drawers.find((x) => x.id === String(options[by] ?? "")) ?? null
    const unnamed = p ? "" : `This ${name} block needs ${by}: one of ${decl.options![by].values!.join(", ") || "none that's on"}.`
    return { plugin: p, render: p && isEnabled(p.id, disabled) ? p.blocks![name] : null, decl, unnamed }
  }
  const all = PLUGINS.filter((p) => p.blocks?.[name])
  const on = all.find((p) => isEnabled(p.id, disabled))
  const p = on ?? all[0] ?? null
  const decl = p?.blockDecls && Object.hasOwn(p.blockDecls, name) ? p.blockDecls[name] : null
  return { plugin: p, render: on ? on.blocks![name] : null, decl, unnamed: "" }
}

const views = signal()
/** Tell the tabs that a view's `title` or `iconClass` answers something else now. */
export const viewsChanged = () => views.notify()
/** Re-render when a view's title or icon changes (returns a counter). */
export const useViewsVersion = () => views.use()

// A view's title and icon hooks never throw: one that did would stop every tab bar drawing.
const safeViews = new WeakMap<ViewDef, ViewDef>()
function safeView(name: string, def: ViewDef): ViewDef {
  let safe = safeViews.get(def)
  if (safe) return safe
  const guard = <A extends unknown[], T>(f: ((...a: A) => T) | undefined, or: T) => f && ((...a: A) => {
    try { return f(...a) } catch (e) { console.error(`view ${name}`, e); return or }
  })
  safe = { ...def, title: guard(def.title, name)!, iconFor: guard(def.iconFor, def.icon), iconClass: guard(def.iconClass, undefined),
    iconTint: guard(def.iconTint, undefined), iconBadge: guard(def.iconBadge, false), tabColor: guard(def.tabColor, undefined), pinAs: guard(def.pinAs, null), pinLabel: guard(def.pinLabel, undefined), resolve: guard(def.resolve, null), opensBeside: guard(def.opensBeside, null), onScreen: guard(def.onScreen, false), rename: guard(def.rename, null), tabPicture: guard(def.tabPicture, null) }
  safeViews.set(def, safe)
  return safe
}

export function viewFor(to: string, disabled: string[]) {
  const [name, ...rest] = to.replace(/^view:/, "").split("/")
  for (const p of PLUGINS) {
    const def = p.views?.[name]
    if (def) return { plugin: p, def: safeView(name, def), arg: rest.join("/"), on: isEnabled(p.id, disabled) }
  }
  return null
}

/** The items the plugins that are on add to a view's menus (`viewMenu`), for its tab's target. */
export function viewMenuItems(target: string, disabled = getPrefs().disabled): MenuItem[] {
  return active(disabled).flatMap((p) => {
    try { return (p.viewMenu?.(target) ?? []).map(({ section: _, many: __, ...it }) => it) } catch { return [] }
  })
}

/** What pinning a view's tab pins (its `pinAs`, else its arg): the pin's key ("view:web/https://example.com",
 *  "view:inbox", "view:terminal/resume-claude-<session>") and its name now, or null when it can't be pinned. */
export function pinOfView(target: string, disabled = getPrefs().disabled): { key: string; label: string } | null {
  const v = viewFor(target, disabled)
  if (!v?.on) return null
  const arg = v.def.pinAs ? v.def.pinAs(v.arg) || null : v.arg
  if (arg === null) return null
  const name = target.replace(/^view:/, "").split("/")[0]
  return { key: arg ? `view:${name}/${arg}` : `view:${name}`, label: v.def.pinLabel?.(arg) || v.def.title(v.arg) }
}

/** A pinned view's name now, when its view knows it (its `pinLabel`: a web page's title, once loaded), else null. */
export function viewPinLabel(target: string, disabled = getPrefs().disabled): string | null {
  const v = viewFor(target, disabled)
  return (v?.on && v.def.pinLabel?.(v.arg)) || null
}

/** The main view of each plugin that's on, as a pin (its first view pinned as itself, without an arg: Inbox, Graph
 *  view), in the plugins' order: what Pinned's menu offers. */
export function viewSurfaces(disabled = getPrefs().disabled): { key: string; label: string }[] {
  return active(disabled).flatMap((p) => {
    for (const name of Object.keys(p.views ?? {})) {
      const pin = pinOfView(`view:${name}`, disabled)
      if (pin?.key === `view:${name}`) return [pin]
    }
    return []
  })
}

/** Whether what a view target shows is on screen in another form (its view's `onScreen`). */
export const viewOnScreen = (target: string, disabled = getPrefs().disabled) => { const v = viewFor(target, disabled); return !!v?.on && !!v.def.onScreen?.(v.arg) }

/** Whether a view's plugin is there and on (a pinned view of a plugin turned off doesn't show). */
export const viewShown = (target: string, disabled = getPrefs().disabled) => !!viewFor(target, disabled)?.on

/** The target to open for this one (its view's `resolve`): a conversation already running, its terminal. */
export function resolveView(target: string, disabled = getPrefs().disabled): string {
  const v = viewFor(target, disabled)
  const arg = v?.on ? v.def.resolve?.(v.arg) : null
  return arg ? `view:${target.replace(/^view:/, "").split("/")[0]}/${arg}` : target
}

export function filesMoved(from: string, to: string | null) {
  const { disabled } = getPrefs()
  for (const p of PLUGINS) {
    if (!p.onMove || !isEnabled(p.id, disabled)) continue
    try { p.onMove(from, to) } catch (e) { console.error(`${p.id}: onMove`, e) }
  }
}
setPluginAsker((action) => {
  const i = action.indexOf(":"), p = i > 0 ? pluginById(action.slice(0, i)) : undefined
  return (p && isEnabled(p.id, getPrefs().disabled) && p.answers?.[action.slice(i + 1)]) || null
})

export const openElsewhere = (to: string, disabled: string[]) =>
  PLUGINS.some((p) => p.openElsewhere && isEnabled(p.id, disabled) && p.openElsewhere().includes(to))

export async function editorExtensions(ctx: EditorCtx, disabled: string[]): Promise<Extension[]> {
  const list = PLUGINS.filter((p) => p.editor && isEnabled(p.id, disabled))
  const got = await Promise.all(list.map((p) => Promise.resolve().then(() => p.editor!(ctx)).catch((e) => { console.error(`${p.id}: editor`, e); return [] })))
  return got
}

export const pluginEditorExtensions = (ctx: EditorCtx) => editorExtensions(ctx, getPrefs().disabled)

/** What the plugins that are on add to this editor's right-click menu (`editorMenu`). */
export function editorMenuItems(view: EditorView): MenuItem[] {
  const ctx = { view, path: editorOf(view)?.path }, { disabled } = getPrefs()
  return PLUGINS.filter((p) => p.editorMenu && isEnabled(p.id, disabled)).flatMap((p) => {
    try { return p.editorMenu!(ctx) } catch (e) { console.error(`${p.id}: editorMenu`, e); return [] }
  })
}

/** What the plugins that are on add to a web page's bar (`webPageActions`). */
export function webPageActions(page: { url: string; title: string }): WebPageAction[] {
  const { disabled } = getPrefs()
  return PLUGINS.filter((p) => p.webPageActions && isEnabled(p.id, disabled)).flatMap((p) => {
    try { return p.webPageActions!(page) } catch (e) { console.error(`${p.id}: webPageActions`, e); return [] }
  })
}

/** The containers web pages open in, from the plugins that are on (the Browser's). */
export function webContainers(): WebContainer[] {
  const { disabled } = getPrefs()
  return PLUGINS.filter((p) => p.containers && isEnabled(p.id, disabled)).flatMap((p) => {
    try { return p.containers!() } catch (e) { console.error(`${p.id}: containers`, e); return [] }
  })
}

export function webLinkOpensIn(url: string, container?: string | null): string | null | undefined {
  const { disabled } = getPrefs()
  for (const p of PLUGINS) {
    if (!p.webLinkOpensIn || !isEnabled(p.id, disabled)) continue
    try { const c = p.webLinkOpensIn(url, container); if (c !== undefined) return c } catch (e) { console.error(`${p.id}: webLinkOpensIn`, e) }
  }
  return undefined
}

export const pluginNewFiles = (disabled: string[]) => PLUGINS.filter((p) => p.newFiles && isEnabled(p.id, disabled)).flatMap((p) => p.newFiles!)
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
export function agentsOn(disabled = getPrefs().disabled): Agent[] {
  return active(disabled).flatMap((p) => Object.entries(p.agents ?? {}).map(([name, a]) => ({ ...a, name, plugin: p.id })))
}

export function useAgents() {
  usePluginsVersion()
  const { disabled } = usePrefs()
  return agentsOn(disabled)
}

/** The agent a terminal runs, by its id ("codex-<id>", "claude_<account>-<id>", "resume-<name>-<session>", "@<machine>"
 *  suffixes), or null for a plain shell (core/terminalids.ts). */
export function agentOfTerminal(id: string, list = agentsOn()): Agent | null {
  const t = parseTerminal(id)
  return (t && list.find((a) => a.name === t.agent)) ?? null
}
