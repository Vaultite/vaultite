// Preferences: most live in the vault's .vaultite/*.json so every device (and any AI) shares them; only sidebar state
// and plugins' device values are per device. A localStorage copy lets the theme apply before the first request.
import { patch, put } from "@/core/http"
import { readSidebars, type Sidebars } from "../../../core/sidebars.ts"
import { readNewTab, type NewTabSetup } from "../../../core/newtab.ts"
import type { UpdatePolicy } from "../../../core/updates.ts"
import { LOOK, LOOK_KEYS } from "../../../core/look.ts"
import { signal } from "@/core/signal"

export type Theme = "system" | "light" | "dark"
/** Colour scheme: recolours every page (tokens in index.css, overrides in themes/<name>.css; the list is
 *  themes/schemes.ts), or "theme:<Name>", an Obsidian theme in the vault's .vaultite/themes/ (or .obsidian/themes/). */
export type Scheme = string
export type Density = "compact" | "comfortable"
/** How a sidebar with more than fits scrolls: each panel in its own box, under dividers that set their heights
 *  ("panels"), or the whole sidebar as one ("sidebar"). */
export type SidebarScroll = "panels" | "sidebar"
/** How the file tree orders files (folders always come first, by name). */
export type FileSort = "name" | "name-desc" | "modified" | "modified-old" | "created" | "created-old"
export type Prefs = {
  theme: Theme; scheme: Scheme; sidebar: boolean; disabled: string[]
  /** Compact (the default sizes) or comfortable (everything spaced out a little). */
  density: Density
  sidebarScroll: SidebarScroll
  /** A hairline between the sidebars' panels (off: only the space between them, a divider showing on hover). */
  panelDividers: boolean
  /** ⌘/⌃ and the wheel, or a pinch, over a note or a terminal steps its text size (core/textsize.ts); off, they do
   *  what the browser does. */
  quickTextSize: boolean
  /** CSS font-family lists; empty = the app's own (the system font, SF Mono). */
  interfaceFont: string; textFont: string; monoFont: string
  /** CSS snippets turned on (.vaultite/snippets/<name>.css, or .obsidian/snippets/), by name. */
  snippets: string[]
  /** Opt-in plugins turned on: the vault's (off until then: they run code) and the app's `offByDefault` ones (Vim, Finance). */
  enabled: string[]
  /** The open sidebar's width (px; drag its edge). */
  sidebarWidth: number
  /** The right sidebar (when panels are there): open, or folded to its icon rail; its open width. This device's. */
  rightSidebar: boolean; rightSidebarWidth: number
  /** Plugins' saved order (plugins.json `order`). Nothing sets it any more (the Plugins page is alphabetical); a saved
   *  one still breaks ties: search results, wikilink targets, sidebar panels of equal `sort`. */
  order: string[]
  /** Icons before file names, in the file tree and the tabs. */
  fileIcons: boolean
  /** The tabs above each pane (desktop); off, each pane's bar shows only what's on screen, and the sidebar (the Tabs
   *  panel, Terminals, Pinned) or the keyboard switches tabs. */
  tabBar: boolean
  /** With the tab bar off, a strip above each pane naming what's open; off, the pane starts at the window's top. */
  paneTitles: boolean
  /** The active tab takes a light wash of the colour its view gives it (a web page's container). */
  tabTint: boolean
  /** A hidden sidebar folds to its icon rail; off, it's gone, sliding back over the page while the pointer is at its
   *  edge of the window. */
  rails: boolean
  /** Behind a hidden sidebar slid in, the page dims a little. */
  peekShade: boolean
  /** The bars above files fade while typing in one, back once the pointer moves. */
  typingFade: boolean
  /** Line numbers beside the text of a file being edited (Markdown, source mode, JSON);
   *  code files always have them. */
  lineNumbers: boolean
  /** The plugins' ambient items in the status bar, in order ("today:routines"); null: the ones not hidden. */
  statusBar: string[] | null
  /** Those of them kept in the bar's tray (its "more" button) whatever room there is. */
  statusBarMore: string[]
  /** The plugins' items in a file's top bar, in order ("companion:presence"); null: by their `sort`. One docked in a
   *  sidebar is a panel there (sidebars.json) instead. */
  fileBar: string[] | null
  /** The commands a page pulled down on a phone offers, left, straight down, right (components/PullActions.tsx); null:
   *  the default ones. */
  pullActions: string[] | null
  fileSort: FileSort
  /** Files a folder shows in the tree before a "Show N more" row (its folders always show); 0: all of them. */
  folderLimit: number
  /** Show the open file in the tree (open its folders, scroll to it) whenever it changes. */
  autoReveal: boolean
  /** Hidden files and folders (.vaultite, .trash) in the file tree; the server only lets them be reached then. */
  showHidden: boolean
  /** Archive folders (`.archive`, where the Archive plugin moves archived files) in the file tree, dimmed. */
  showArchived: boolean
  /** The sidebars' panels (.vaultite/sidebars.json, the whole file; core/sidebars.ts): null while it's unset, the
   *  default (web/src/core/plugins.ts, vaultSidebars). */
  sidebars: Sidebars | null
  /** A blank tab's sections and buttons (.vaultite/newtab.json; core/newtab.ts), each key null while it's unset. */
  newTab: NewTabSetup
  /** Which installed plugins update on their own (core/updates.ts), and a plugin's own choice over that. */
  updates: UpdatePolicy; updatesOn: string[]; updatesOff: string[]
  /** Values plugins keep for this device only (Workspaces: the current workspace), by key; see devicePref. */
  device: Record<string, unknown>
  /** The keys .vaultite/editor.json sets, as written (core/editorPrefs.ts reads them with their defaults). */
  editor: Record<string, unknown>
}

const KEY = "vaultite.prefs"
const DEFAULTS: Prefs = {
  ...LOOK, sidebar: true, sidebarWidth: 240, rightSidebar: true, rightSidebarWidth: 280, disabled: [], enabled: [], order: [], fileSort: "name", folderLimit: 0, autoReveal: true, showHidden: false, showArchived: false, sidebars: null, newTab: { sections: null, actions: null, icons: null, page: null }, updates: "vaultite", updatesOn: [], updatesOff: [], device: {}, editor: {},
}
// Which vault file each synced pref is saved in, key by key; `sidebars` is a whole file (WHOLE).
const FILES = {
  appearance: LOOK_KEYS, plugins: ["disabled", "enabled", "order", "updates", "updatesOn", "updatesOff"], files: ["fileSort", "folderLimit", "autoReveal", "showHidden", "showArchived"],
} as const
type File = keyof typeof FILES
/** Prefs that are a whole settings file each: .vaultite/sidebars.json is `sidebars` ({left, right}). */
const WHOLE = { sidebars: "sidebars" } as const

/** Whether a saved value has its default's shape (a list of names, a number, a flag): a settings file edited by hand to
 *  `"disabled": null` would otherwise stop the app on every load. `statusBar`, `fileBar` and `pullActions` may be null. */
function fits(k: keyof Prefs, v: unknown) {
  const d = DEFAULTS[k], nullable = k === "statusBar" || k === "fileBar" || k === "pullActions"
  if (Array.isArray(d) || nullable) return (v === null && nullable) || (Array.isArray(v) && v.every((x) => typeof x === "string"))
  if (d === null) return v === null || (typeof v === "object" && !Array.isArray(v))
  if (typeof d === "number") return typeof v === "number" && Number.isFinite(v)
  if (typeof d === "object") return !!v && typeof v === "object" && !Array.isArray(v)
  return typeof v === typeof d
}
const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)

function load(): Prefs {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    if (!isObject(saved)) return DEFAULTS
    const out = { ...DEFAULTS } as Record<string, unknown>
    for (const k of Object.keys(DEFAULTS) as (keyof Prefs)[]) if (k in saved && fits(k, saved[k])) out[k] = saved[k]
    return out as Prefs
  } catch { return DEFAULTS }
}

let prefs = load()
const changed = signal()

function commit(next: Prefs) {
  prefs = next
  try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* private mode */ }
  changed.notify()
}

const pick = (file: File, keys: readonly string[] = FILES[file]) => Object.fromEntries(FILES[file].filter((k) => keys.includes(k)).map((k) => [k, prefs[k]]))

/** Write these prefs' keys to their file, and only them (PATCH): the file's other keys stay as they are on disk, so one
 *  changed meanwhile (by an AI, another device) isn't put back. */
function save(file: File, keys?: readonly string[]) {
  return patch(`config/${file}`, pick(file, keys)).then(() => {}, () => { /* offline: the local copy still applies */ })
}

/** Change prefs; resolves once they're saved in the vault. */
export function setPrefs(changes: Partial<Prefs>) {
  const before = prefs
  commit({ ...prefs, ...changes })
  // newtab.json: only its keys that changed (null removes one: back to the default).
  const tab = changes.newTab && (Object.keys(changes.newTab) as (keyof NewTabSetup)[]).filter((k) => JSON.stringify(changes.newTab![k]) !== JSON.stringify(before.newTab[k]))
  const newTab = tab?.length ? [patch("config/newtab", Object.fromEntries(tab.map((k) => [k, prefs.newTab[k]]))).then(() => {}, () => {})] : []
  // editor.json: only its keys that changed (one taken out: null, back to the default).
  const ed = changes.editor && [...new Set([...Object.keys(before.editor), ...Object.keys(changes.editor)])]
    .filter((k) => JSON.stringify(changes.editor![k]) !== JSON.stringify(before.editor[k]))
  const editor = ed?.length ? [patch("config/editor", Object.fromEntries(ed.map((k) => [k, prefs.editor[k] ?? null]))).then(() => {}, () => {})] : []
  const whole = (Object.keys(WHOLE) as (keyof typeof WHOLE)[]).filter((k) => k in changes).map((k) =>
    put(`config/${WHOLE[k]}`, prefs[k] ?? {}).then(() => {}, () => {}))
  return Promise.all([...whole, ...newTab, ...editor, ...(Object.keys(FILES) as File[]).filter((file) => FILES[file].some((k) => k in changes)).map((file) => save(file, Object.keys(changes)))]).then(() => {})
}

/** The vault's settings arrived: they're the truth, a key a file doesn't have another app's (`seeds`: the look an
 *  Obsidian vault has, core/plugins.ts settingDefaults), else the default. */
export function hydratePrefs(config: Partial<Record<File | (typeof WHOLE)[keyof typeof WHOLE] | "newtab" | "editor", Record<string, unknown>>>,
  seeds: Record<string, Record<string, unknown>> = {}) {
  const next = { ...prefs, sidebars: readSidebars(config.sidebars), newTab: readNewTab(config.newtab), editor: isObject(config.editor) ? config.editor : {} }
  for (const file of Object.keys(FILES) as File[]) {
    const got: unknown = config[file], saved = { ...(isObject(seeds[file]) ? seeds[file] : {}), ...(isObject(got) ? got : {}) }
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

/** Run fn whenever prefs change (core/appearance.ts applies them to the page). */
export const onPrefs = changed.subscribe
