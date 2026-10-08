// Obsidian Bases: each view of a .base becomes a database view's options, run by the same engine as ```block-query. A
// view type this app doesn't draw is a table with a note; unknown keys are kept. No Node.
import type { Opts } from "./query.ts"

export type BaseView = { name: string; type: string }
export type BaseConfig = Record<string, unknown>

/** What Obsidian calls a view's type -> what this app draws. */
const TYPES: Record<string, string> = { table: "table", cards: "cards", list: "list", map: "map", kanban: "board", board: "board", calendar: "calendar" }

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null)

/** A base's views (a base without any has one table, "Table", like a new one in Obsidian). */
function viewsOf(cfg: BaseConfig): Record<string, unknown>[] {
  const vs = Array.isArray(cfg.views) ? cfg.views.map(obj).filter((v): v is Record<string, unknown> => !!v) : []
  return vs.length ? vs : [{ type: "table", name: "Table" }]
}

/** A view's name: its `name`, else its type's ("Table"), numbered when two have the same. */
export function viewNames(cfg: BaseConfig): BaseView[] {
  const seen = new Map<string, number>()
  return viewsOf(cfg).map((v) => {
    const type = typeof v.type === "string" && v.type.trim() ? v.type.trim() : "table"
    let name = typeof v.name === "string" && v.name.trim() ? v.name.trim() : type.charAt(0).toUpperCase() + type.slice(1)
    const n = (seen.get(name.toLowerCase()) ?? 0) + 1
    seen.set(name.toLowerCase(), n)
    if (n > 1) name = `${name} ${n}`
    return { name, type }
  })
}

/** Which view a name picks (any case; a number is its place), else the first. */
export function pickView(cfg: BaseConfig, want?: string | null): { index: number; found: boolean } {
  const names = viewNames(cfg)
  const w = String(want ?? "").trim().toLowerCase()
  if (!w) return { index: 0, found: true }
  const i = names.findIndex((v) => v.name.toLowerCase() === w)
  return i >= 0 ? { index: i, found: true } : { index: 0, found: false }
}

/** One view of a base as a database view's options, with what couldn't be carried over in `notes`. */
export function baseOptions(cfg: BaseConfig, want?: string | null): { opts: Opts; views: BaseView[]; index: number; notes: string[] } {
  const notes: string[] = []
  if (!obj(cfg)) throw new Error("a base is YAML keys: filters, formulas, properties, summaries, views")
  const views = viewNames(cfg)
  const { index, found } = pickView(cfg, want)
  if (!found) notes.push(`There's no view named ${want}: showing ${views[0].name}`)
  const v = viewsOf(cfg)[index]
  const type = views[index].type
  let view = TYPES[type.toLowerCase()]
  if (!view) { view = "table"; notes.push(`This app draws ${type} views as a table`) }
  const group = obj(v.groupBy)
  if (view === "board" && !(group && typeof group.property === "string")) {
    view = "table"
    notes.push("A kanban view needs a group (groupBy): shown as a table")
  }
  const filters = [cfg.filters, v.filters].filter((f) => f !== undefined && f !== null && f !== "")
  const opts: Opts = {
    title: views[index].name, view,
    ...(filters.length ? { filters: filters.length === 1 ? filters[0] : { and: filters } } : {}),
    ...(obj(cfg.formulas) ? { formulas: cfg.formulas } : {}),
    ...(obj(cfg.properties) ? { properties: cfg.properties } : {}),
    ...(obj(cfg.summaries) ? { summaryFormulas: cfg.summaries } : {}),
    ...(obj(v.summaries) ? { summaries: v.summaries } : {}),
    ...(Array.isArray(v.order) && v.order.length ? { columns: v.order.map(String) } : {}),
    ...(v.sort !== undefined ? { sort: v.sort } : {}),
    ...(group && typeof group.property === "string" ? { group: { property: group.property, direction: group.direction } } : {}),
    // (Obsidian shows every match; here at most 500 rows are drawn, and the count says how many there are)
    limit: typeof v.limit === "number" && v.limit > 0 ? v.limit : 500,
  }
  for (const k of ["coordinates", "markerColor", "markerIcon", "date", "month"]) if (typeof v[k] === "string") opts[k] = v[k]
  return { opts, views, index, notes }
}
