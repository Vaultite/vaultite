import { patch, put } from "@/core/http"
import { readSidebars, type Sidebars } from "../../../core/sidebars.ts"
import { readNewTab, type NewTabSetup } from "../../../core/newtab.ts"
import type { UpdatePolicy } from "../../../core/updates.ts"
import { isNumber, isObj, isText } from "../../../core/values.ts"
import { LOOK, LOOK_KEYS } from "../../../core/look.ts"
import { signal } from "@/core/signal"

const THEMES = ["system", "light", "dark"] as const
export type Theme = (typeof THEMES)[number]
type Scheme = string
const DENSITIES = ["compact", "comfortable"] as const
export type Density = (typeof DENSITIES)[number]
const ANIMATIONS = ["snappy", "natural", "off"] as const
export type Animation = (typeof ANIMATIONS)[number]
const FADES = ["off", "typing", "always"] as const
export type FileBarFade = (typeof FADES)[number]
const SCROLLS = ["panels", "sidebar"] as const
type SidebarScroll = (typeof SCROLLS)[number]
const HEADINGS = ["shown", "quiet"] as const
const SORTS = ["name", "name-desc", "modified", "modified-old", "created", "created-old"] as const
export type FileSort = (typeof SORTS)[number]
const VIEWS = ["list", "grid", "columns", "gallery"] as const
export type FolderView = (typeof VIEWS)[number]
const GROUPINGS = ["none", "kind", "modified"] as const
export type FolderGroup = (typeof GROUPINGS)[number]
const POLICIES = ["vaultite", "all", "off"] as const satisfies readonly UpdatePolicy[]
export type Prefs = {
  theme: Theme; scheme: Scheme; sidebar: boolean; disabled: string[]
  density: Density
  animation: Animation
  sidebarScroll: SidebarScroll
  panelDividers: boolean
  panelHeadings: (typeof HEADINGS)[number]
  quickTextSize: boolean
  interfaceFont: string; textFont: string; monoFont: string
  snippets: string[]
  enabled: string[]
  ai: boolean
  sidebarWidth: number
  rightSidebar: boolean; rightSidebarWidth: number
  fileIcons: boolean
  tabBar: boolean
  paneTabBars: boolean
  dimPanes: boolean
  paneCards: boolean
  rails: boolean
  peekShade: boolean
  sidebarButtons: boolean
  fileBarFade: FileBarFade
  translucent: boolean
  translucentPages: boolean
  translucency: number; pageTranslucency: number
  lineNumbers: boolean
  statusBar: string[] | null
  statusBarMore: string[]
  statusBarLeft: string[] | null
  fileBar: string[] | null
  fileBarHidden: string[]
  sidebarHeader: string[] | null
  pullActions: string[] | null
  fileSort: FileSort
  folderView: FolderView
  folderGroup: FolderGroup
  folderLimit: number
  autoReveal: boolean
  showHidden: boolean
  showArchived: boolean
  sidebars: Sidebars | null
  newTab: NewTabSetup
  updates: UpdatePolicy; updatesOn: string[]; updatesOff: string[]
  device: Record<string, unknown>
  editor: Record<string, unknown>
}

const KEY = "vaultite.prefs"
const DEFAULTS: Prefs = {
  ...LOOK, sidebar: true, sidebarWidth: 240, rightSidebar: true, rightSidebarWidth: 280, disabled: [], enabled: [], ai: true, fileSort: "name", folderView: "list", folderGroup: "none", folderLimit: 0, autoReveal: true, showHidden: false, showArchived: false, sidebars: null, newTab: { sections: null, actions: null, icons: null, page: null, opens: null }, updates: "vaultite", updatesOn: [], updatesOff: [], device: {}, editor: {},
}
const FILE_NAMES = ["appearance", "plugins", "files"] as const
type File = (typeof FILE_NAMES)[number]
const FILES: Record<File, readonly Plain[]> = {
  appearance: LOOK_KEYS, plugins: ["disabled", "enabled", "ai", "updates", "updatesOn", "updatesOff"], files: ["fileSort", "folderView", "folderGroup", "folderLimit", "autoReveal", "showHidden", "showArchived"],
}
const WHOLE = ["sidebars"] as const satisfies readonly (keyof Prefs)[]

type Fits<T> = (v: unknown) => v is T
type Plain = Exclude<keyof Prefs, "sidebars" | "newTab">
const oneOf = <T extends string>(values: readonly T[]) => (v: unknown): v is T => values.some((x) => x === v)
const bool = (v: unknown): v is boolean => v === true || v === false
const finite = (v: unknown): v is number => isNumber(v) && Number.isFinite(v)
const texts = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)
const textsOrNull = (v: unknown): v is string[] | null => v === null || texts(v)
const FITS: { [K in Plain]: Fits<Prefs[K]> } = {
  theme: oneOf(THEMES), scheme: isText, sidebar: bool, disabled: texts, density: oneOf(DENSITIES), animation: oneOf(ANIMATIONS), sidebarScroll: oneOf(SCROLLS),
  panelDividers: bool, panelHeadings: oneOf(HEADINGS), quickTextSize: bool, interfaceFont: isText, textFont: isText, monoFont: isText, snippets: texts,
  enabled: texts, ai: bool, sidebarWidth: finite, rightSidebar: bool, rightSidebarWidth: finite, fileIcons: bool, tabBar: bool, paneTabBars: bool,
  dimPanes: bool, paneCards: bool, rails: bool, peekShade: bool, sidebarButtons: bool, fileBarFade: oneOf(FADES), translucent: bool, translucentPages: bool,
  translucency: finite, pageTranslucency: finite, lineNumbers: bool, statusBar: textsOrNull, statusBarMore: texts, statusBarLeft: textsOrNull,
  fileBar: textsOrNull, fileBarHidden: texts, sidebarHeader: textsOrNull, pullActions: textsOrNull, fileSort: oneOf(SORTS), folderView: oneOf(VIEWS),
  folderGroup: oneOf(GROUPINGS), folderLimit: finite, autoReveal: bool, showHidden: bool, showArchived: bool, updates: oneOf(POLICIES),
  updatesOn: texts, updatesOff: texts, device: isObj, editor: isObj,
}
const isPlain = (k: string): k is Plain => Object.hasOwn(FITS, k)
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this is the parse at the boundary
function take<K extends Plain>(out: Prefs, k: K, saved: unknown, orDefault = false) {
  if (FITS[k](saved)) out[k] = saved
  else if (orDefault) out[k] = DEFAULTS[k]
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this is the parse at the boundary
export function readPrefs(saved: unknown): Prefs {
  if (!isObj(saved)) return DEFAULTS
  const out: Prefs = { ...DEFAULTS }
  for (const [k, v] of Object.entries(saved)) if (isPlain(k)) take(out, k, v)
  if (saved.sidebars === null || isObj(saved.sidebars)) out.sidebars = readSidebars(saved.sidebars)
  if (isObj(saved.newTab)) out.newTab = readNewTab(saved.newTab)
  return out
}

function load(): Prefs {
  try { return readPrefs(JSON.parse(localStorage.getItem(KEY) ?? "{}")) } catch { return DEFAULTS }
}

let prefs = load()
const changed = signal()

function commit(next: Prefs) {
  if (next.ai !== prefs.ai && next.disabled === prefs.disabled) next = { ...next, disabled: [...next.disabled] }
  prefs = next
  try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* private mode */ }
  changed.notify()
}

const UNSET_AT_DEFAULT: readonly (keyof Prefs)[] = ["ai"]
const pick = (file: File, keys: readonly string[] = FILES[file]) => Object.fromEntries(FILES[file].filter((k) => keys.includes(k))
  .map((k) => [k, UNSET_AT_DEFAULT.includes(k) && prefs[k] === DEFAULTS[k] ? null : prefs[k]]))

function save(file: File, keys?: readonly string[]) {
  return patch(`config/${file}`, pick(file, keys)).then(() => {}, () => { /* offline: the local copy still applies */ })
}

export function setPrefs(changes: Partial<Prefs>) {
  const before = prefs
  commit({ ...prefs, ...changes })
  const tab = changes.newTab && Object.keys(changes.newTab).filter(isNewTabKey).filter((k) => JSON.stringify(changes.newTab![k]) !== JSON.stringify(before.newTab[k]))
  const newTab = tab?.length ? [patch("config/newtab", Object.fromEntries(tab.map((k) => [k, prefs.newTab[k]]))).then(() => {}, () => {})] : []
  const ed = changes.editor && [...new Set([...Object.keys(before.editor), ...Object.keys(changes.editor)])]
    .filter((k) => JSON.stringify(changes.editor![k]) !== JSON.stringify(before.editor[k]))
  const editor = ed?.length ? [patch("config/editor", Object.fromEntries(ed.map((k) => [k, prefs.editor[k] ?? null]))).then(() => {}, () => {})] : []
  const whole = WHOLE.flatMap((k) => (k in changes ? [put(`config/${k}`, prefs[k] ?? {}).then(() => {}, () => {})] : []))
  const files = FILE_NAMES.flatMap((file) => (FILES[file].some((k) => k in changes) ? [save(file, Object.keys(changes))] : []))
  return Promise.all([...whole, ...newTab, ...editor, ...files]).then(() => {})
}
const isNewTabKey = (k: string): k is keyof NewTabSetup => Object.hasOwn(DEFAULTS.newTab, k)

export function hydratePrefs(config: Partial<Record<File | (typeof WHOLE)[number] | "newtab" | "editor", Record<string, unknown>>>,
  seeds: Record<string, Record<string, unknown>> = {}) {
  const next = { ...prefs, sidebars: readSidebars(config.sidebars), newTab: readNewTab(config.newtab), editor: isObj(config.editor) ? config.editor : {} }
  for (const file of FILE_NAMES) {
    const got: unknown = config[file], saved: Record<string, unknown> = { ...(isObj(seeds[file]) ? seeds[file] : {}), ...(isObj(got) ? got : {}) }
    for (const k of FILES[file]) take(next, k, saved[k], true)
  }
  if (JSON.stringify(next) !== JSON.stringify(prefs)) commit(next)
}

export const getPrefs = () => prefs

/** A value a plugin keeps for this device only (the current workspace), in this device's prefs (localStorage), never
 *  in the vault. `get` falls back to `fallback`; redraws follow usePrefs. */
export function devicePref<T>(key: string, fallback: T) {
  return {
    get: (): T => (key in prefs.device ? (prefs.device[key] as T) : fallback),
    set: (v: T) => commit({ ...prefs, device: { ...prefs.device, [key]: v } }),
  }
}

export const usePrefs = () => changed.use(getPrefs)

export const onPrefs = changed.subscribe
