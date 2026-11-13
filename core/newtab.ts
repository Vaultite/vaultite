import { defaultOrder, keyList, type SlotInfo } from "./slots.ts"
import { isObj as isMap } from "./values.ts"

export type NewTabSetup = {
  /** The sections shown, top to bottom; null: unset (the default). */
  sections: string[] | null
  /** The buttons' commands, top to bottom; null: unset (DEFAULT_ACTIONS). */
  actions: string[] | null
  /** Icons the user gave buttons, by command id (a Lucide name or an emoji); null: unset (each its command's). */
  icons: Record<string, string> | null
  /** A file a blank tab draws instead of the sections (a dashboard: any blocks), by its vault path; null: unset. */
  page: string | null
  /** What a new tab (⌘T, the + buttons) opens: "switcher", the quick switcher as a launcher (what's picked opens in a new
   *  tab), or a view's tab (`view:web`: a web page, its address to type); null: unset (a blank tab's page). */
  opens: string | null
}

export type SectionInfo = SlotInfo & { title: string; only?: "phone" | "desktop"
  panel?: boolean }

export const CORE_SECTIONS: SectionInfo[] = [
  { key: "core:actions", title: "Buttons", sort: 10 },
  { key: "core:opened", title: "Recently opened here", sort: 20 },
  { key: "core:changed", title: "Recently changed", sort: 30 },
]

export function withPanels<S extends SectionInfo, P extends { key: string; title: string }>(sections: S[], panels: P[]): (S | (P & SectionInfo))[] {
  const have = new Set(sections.map((s) => s.key))
  return [...sections, ...panels.filter((p) => !have.has(p.key)).map((p) => ({ ...p, sort: 1000, hidden: true, panel: true }))]
}

export const DEFAULT_ACTIONS = ["file:new", "switcher:open", "palette:open"]


export function readNewTab(raw: unknown): NewTabSetup {
  const o = isMap(raw) ? raw : {}
  const icons = isMap(o.icons) ? Object.fromEntries(Object.entries(o.icons).flatMap(([k, v]) => (typeof v === "string" && v.trim() ? [[k, v.trim()]] : []))) : null
  const page = typeof o.page === "string" && o.page.trim() ? o.page.trim() : null
  return { sections: Array.isArray(o.sections) ? keyList(o.sections) : null, actions: Array.isArray(o.actions) ? keyList(o.actions) : null, icons, page,
    opens: typeof o.opens === "string" && isOpens(o.opens.trim()) ? o.opens.trim() : null }
}

export const isOpens = (v: string) => v === "switcher" || /^view:[\w-]+(\/.*)?$/.test(v)

/** An empty name: back to its command's icon. null once none is left. */
export function withIcon(icons: Record<string, string> | null, id: string, name: string) {
  const next = { ...icons }
  if (name.trim()) next[id] = name.trim()
  else delete next[id]
  return Object.keys(next).length ? next : null
}

export const shownSections = (s: NewTabSetup, all: SlotInfo[]) => s.sections ?? defaultOrder(all)

export const shownActions = (s: NewTabSetup) => s.actions ?? DEFAULT_ACTIONS
