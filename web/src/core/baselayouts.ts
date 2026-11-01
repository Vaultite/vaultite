// Layouts a base's views can have besides the app's own (table, cards, list, board, map, calendar): a plugin's, as
// Obsidian plugins' Bases views come through plugin-compat. Each draws a view's rows into an element of its own.
import { useSyncExternalStore } from "react"

/** A base's rows as a layout gets them: every match, in the view's groups (one, unnamed, when it has none). */
export type BaseRows = {
  columns: { key: string; label: string }[]
  groups: { name: string | null; rows: { path: string; title: string; values: Record<string, unknown> }[] }[]
  total: number
}
/** What a layout draws: the base's file (or the note with its fence), the whole base's YAML, the view's own and its
 *  name, its rows. */
export type BaseLayoutCtx = { path: string; host?: string; base: Record<string, unknown>; view: Record<string, unknown>; name: string; rows: BaseRows }
/** What a layout drew, told when the rows or the view change and when it goes. */
export type BaseLayoutDrawn = { update?: (ctx: BaseLayoutCtx) => void; destroy?: () => void }
export type BaseLayout = {
  /** Its name in a view's `type:` (a plugin's, such as tasknotesKanban). */
  type: string
  /** In the view's Layout menu. */
  name: string
  mount: (el: HTMLElement, ctx: BaseLayoutCtx) => BaseLayoutDrawn | void
}

const layouts = new Map<string, BaseLayout>()
const subs = new Set<() => void>()
let version = 0
const changed = () => { version++; for (const fn of [...subs]) fn() }

/** A layout views can pick: registered until the returned function (a later one of the same type replaces it). */
export function registerBaseLayout(l: BaseLayout) {
  const key = l.type.toLowerCase()
  layouts.set(key, l)
  changed()
  return () => { if (layouts.get(key) === l) { layouts.delete(key); changed() } }
}

/** The layouts plugins registered, and the one for a view's type. */
export const baseLayouts = () => [...layouts.values()]
export const baseLayoutOf = (type: string) => layouts.get(type.toLowerCase()) ?? null

/** The registered layouts, followed: a component using it draws again as plugins add theirs. */
export function useBaseLayouts() {
  useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn) }, () => version)
  return baseLayouts()
}
