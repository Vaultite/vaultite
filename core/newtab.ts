// A new tab's page (`.vaultite/newtab.json`: `sections` top to bottom, `actions` the buttons, each a command id, `icons`
// a button's icon other than its command's), one shape for app and vau; each key written on its own. Pure functions, no Node: both sides use them.
import { defaultOrder, keyList, type SlotInfo } from "./slots.ts"

export type NewTabSetup = {
  /** The sections shown, top to bottom; null: unset (the default). */
  sections: string[] | null
  /** The buttons' commands, top to bottom; null: unset (DEFAULT_ACTIONS). */
  actions: string[] | null
  /** Icons the user gave buttons, by command id (a Lucide name or an emoji); null: unset (each its command's). */
  icons: Record<string, string> | null
}

/** A section as the setup needs it: its key, title, default place and whether it's only on phones or computers. */
export type SectionInfo = SlotInfo & { title: string; only?: "phone" | "desktop"
  /** A sidebar panel offered as a section (`withPanels`). */
  panel?: boolean }

/** The app's own sections (drawn by components/Tabs.tsx, NewTab). */
export const CORE_SECTIONS: SectionInfo[] = [
  { key: "core:actions", title: "Buttons", sort: 10 },
  { key: "core:opened", title: "Recently opened here", sort: 20 },
  { key: "core:changed", title: "Recently changed", sort: 30 },
]

/** The sections, then every sidebar panel (`<plugin id>:<name>`) that isn't one already, as a section out of the default
 *  page. */
export function withPanels<S extends SectionInfo, P extends { key: string; title: string }>(sections: S[], panels: P[]): (S | (P & SectionInfo))[] {
  const have = new Set(sections.map((s) => s.key))
  return [...sections, ...panels.filter((p) => !have.has(p.key)).map((p) => ({ ...p, sort: 1000, hidden: true, panel: true }))]
}

/** The buttons while `actions` is unset. */
export const DEFAULT_ACTIONS = ["file:new", "switcher:open", "palette:open"]

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** newtab.json as it's saved, checked: a key that isn't a list (`icons`: an object) is unset. */
export function readNewTab(raw: unknown): NewTabSetup {
  const o = isMap(raw) ? raw : {}
  const icons = isMap(o.icons) ? Object.fromEntries(Object.entries(o.icons).flatMap(([k, v]) => (typeof v === "string" && v.trim() ? [[k, v.trim()]] : []))) : null
  return { sections: Array.isArray(o.sections) ? keyList(o.sections) : null, actions: Array.isArray(o.actions) ? keyList(o.actions) : null, icons }
}

/** `icons` with a button's icon set (an empty name: back to its command's), null once none is left. */
export function withIcon(icons: Record<string, string> | null, id: string, name: string) {
  const next = { ...icons }
  if (name.trim()) next[id] = name.trim()
  else delete next[id]
  return Object.keys(next).length ? next : null
}

/** The sections shown, top to bottom (`all`: every section there is, the app's and the plugins'). */
export const shownSections = (s: NewTabSetup, all: SlotInfo[]) => s.sections ?? defaultOrder(all)

/** The buttons' commands, top to bottom. */
export const shownActions = (s: NewTabSetup) => s.actions ?? DEFAULT_ACTIONS
