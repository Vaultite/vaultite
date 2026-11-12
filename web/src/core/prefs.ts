import { patch, put } from "@/core/http"
import { readSidebars, type Sidebars } from "../../../core/sidebars.ts"
import { readNewTab, type NewTabSetup } from "../../../core/newtab.ts"
import type { UpdatePolicy } from "../../../core/updates.ts"
import { isObj } from "../../../core/values.ts"
import { LOOK, LOOK_KEYS } from "../../../core/look.ts"
import { signal } from "@/core/signal"

export type Theme = "system" | "light" | "dark"
type Scheme = string
export type Density = "compact" | "comfortable"
export type Animation = "snappy" | "natural" | "off"
export type FileBarFade = "off" | "typing" | "always"
type SidebarScroll = "panels" | "sidebar"
export type FileSort = "name" | "name-desc" | "modified" | "modified-old" | "created" | "created-old"
export type FolderView = "list" | "grid" | "columns" | "gallery"
export type FolderGroup = "none" | "kind" | "modified"
export type Prefs = {
  theme: Theme; scheme: Scheme; sidebar: boolean; disabled: string[]
  density: Density
  animation: Animation
  sidebarScroll: SidebarScroll
  panelDividers: boolean
  panelHeadings: "shown" | "quiet"
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
const FILES = {
  appearance: LOOK_KEYS, plugins: ["disabled", "enabled", "ai", "updates", "updatesOn", "updatesOff"], files: ["fileSort", "folderView", "folderGroup", "folderLimit", "autoReveal", "showHidden", "showArchived"],
} as const
type File = keyof typeof FILES
const WHOLE = { sidebars: "sidebars" } as const

function fits(k: keyof Prefs, v: unknown) {
  const d = DEFAULTS[k], nullable = k === "statusBar" || k === "statusBarLeft" || k === "fileBar" || k === "sidebarHeader" || k === "pullActions"
  if (Array.isArray(d) || nullable) return (v === null && nullable) || (Array.isArray(v) && v.every((x) => typeof x === "string"))
  if (d === null) return v === null || (typeof v === "object" && !Array.isArray(v))
  if (typeof d === "number") return typeof v === "number" && Number.isFinite(v)
  if (typeof d === "object") return !!v && typeof v === "object" && !Array.isArray(v)
  return typeof v === typeof d
}

function load(): Prefs {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    if (!isObj(saved)) return DEFAULTS
    const out = { ...DEFAULTS } as Record<string, unknown>
    for (const k of Object.keys(DEFAULTS) as (keyof Prefs)[]) if (k in saved && fits(k, saved[k])) out[k] = saved[k]
    return out as Prefs
  } catch { return DEFAULTS }
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
  const tab = changes.newTab && (Object.keys(changes.newTab) as (keyof NewTabSetup)[]).filter((k) => JSON.stringify(changes.newTab![k]) !== JSON.stringify(before.newTab[k]))
  const newTab = tab?.length ? [patch("config/newtab", Object.fromEntries(tab.map((k) => [k, prefs.newTab[k]]))).then(() => {}, () => {})] : []
  const ed = changes.editor && [...new Set([...Object.keys(before.editor), ...Object.keys(changes.editor)])]
    .filter((k) => JSON.stringify(changes.editor![k]) !== JSON.stringify(before.editor[k]))
  const editor = ed?.length ? [patch("config/editor", Object.fromEntries(ed.map((k) => [k, prefs.editor[k] ?? null]))).then(() => {}, () => {})] : []
  const whole = (Object.keys(WHOLE) as (keyof typeof WHOLE)[]).filter((k) => k in changes).map((k) =>
    put(`config/${WHOLE[k]}`, prefs[k] ?? {}).then(() => {}, () => {}))
  return Promise.all([...whole, ...newTab, ...editor, ...(Object.keys(FILES) as File[]).filter((file) => FILES[file].some((k) => k in changes)).map((file) => save(file, Object.keys(changes)))]).then(() => {})
}

export function hydratePrefs(config: Partial<Record<File | (typeof WHOLE)[keyof typeof WHOLE] | "newtab" | "editor", Record<string, unknown>>>,
  seeds: Record<string, Record<string, unknown>> = {}) {
  const next = { ...prefs, sidebars: readSidebars(config.sidebars), newTab: readNewTab(config.newtab), editor: isObj(config.editor) ? config.editor : {} }
  for (const file of Object.keys(FILES) as File[]) {
    const got: unknown = config[file], saved = { ...(isObj(seeds[file]) ? seeds[file] : {}), ...(isObj(got) ? got : {}) }
    for (const k of FILES[file]) (next as Record<string, unknown>)[k] = k in saved && fits(k, saved[k]) ? saved[k] : DEFAULTS[k]
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
