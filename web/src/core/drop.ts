// Dropping on the workspace (core/drag.ts: a tab, a whole pane, or a file or page from the sidebar): what's under the
// pointer and what a drop there does.
import type { DragItem } from "@/core/drag"
import { outsideSets, runOf, type Group, type Side } from "@/core/layout"
import { canMove, canMoveGroup, canOpenAt, moveGroupTo, moveTabsTo, moveTabTo, openAllAt, openAt } from "@/core/splits"
import { canMoveSet, moveSetTo } from "@/core/tabsets"
import { groups } from "@/core/workspace"
import { getStore } from "@/core/data"
import { INCOMING } from "@/core/slide"

/** Where a dragged tab or file would land: a place in a tab bar (`set`: the tab group it joins there, null none), or a
 *  pane's edge or middle. */
export type Drop = { kind: "bar"; group: string; index: number; set: string | null } | { kind: "pane"; group: string; zone: Side | "center" }
/** The workspace's drop target (useDropTarget): its tab bars and panes. */
export const PANES = "panes"

/** Would dropping `item` there change anything? A pane, a tab group or a tab moves (canMoveGroup, canMoveSet,
 *  canMove), anything else opens (canOpenAt). */
const canDrop = (item: DragItem, gid: string, where: Side | "center" | number, set?: string | null) =>
  item.group ? canMoveGroup(item.group, gid, where) : item.tabset ? canMoveSet(item.tabset, gid, where)
    : item.tab ? canMove(item.tab, gid, where, set) : !!item.to && canOpenAt(item.to, gid, where)
/** Would that drop (in a list of a pane's tabs drawn elsewhere: the Tabs panel) change anything? */
export const canDropAt = (item: DragItem, d: Drop) => canDrop(item, d.group, d.kind === "bar" ? d.index : d.zone, d.kind === "bar" ? d.set : undefined)

/** A tab, or a tab group's name (its chip, its row), in a row or list of a pane's tabs as drawn (tabs of a folded
 *  group aren't). */
export type Slot = { el: Element; tab?: string; set?: string }

/** Where an element is laid out, without the slide a drag's preview gives it (useSlide): hits are worked out on that. */
export function laidOut(el: Element) {
  const r = el.getBoundingClientRect(), slid = el.closest<HTMLElement>("[data-slide]")
  if (!slid?.style.transform) return r
  const m = new DOMMatrixReadOnly(getComputedStyle(slid).transform)
  return new DOMRect(r.x - m.m41, r.y - m.m42, r.width, r.height)
}

/** Where `pos` along a pane's tabs as drawn lands: before which tab (`index`), in which tab group. Between its tabs or
 *  after its name: in it; over its last tab, in; just past it, out; on the middle of a folded one's name, into it. */
export function slotIn(g: Group, slots: Slot[], pos: number, axis: "x" | "y") {
  const box = slots.map((s) => laidOut(s.el))
  const lo = (r: DOMRect) => (axis === "x" ? r.left : r.top), hi = (r: DOMRect) => (axis === "x" ? r.right : r.bottom)
  const folded = (set: string) => !!g.sets?.find((s) => s.id === set)?.collapsed
  const on = slots.findIndex((s, i) => s.set && folded(s.set) && Math.abs(pos - (lo(box[i]) + hi(box[i])) / 2) < (hi(box[i]) - lo(box[i])) / 4)
  if (on >= 0) { const r = runOf(g, slots[on].set!); return { index: r.at + r.n, set: slots[on].set! } }
  const k = box.filter((r) => (lo(r) + hi(r)) / 2 < pos).length
  const p = slots[k - 1], n = slots[k]
  const idx = (tab: string) => g.tabs.findIndex((t) => t.id === tab)
  const before = (s: Slot) => (s.tab ? idx(s.tab) : runOf(g, s.set!).at)
  const after = (s: Slot) => (s.tab ? idx(s.tab) + 1 : folded(s.set!) ? runOf(g, s.set!).at + runOf(g, s.set!).n : runOf(g, s.set!).at)
  const index = n ? before(n) : p ? after(p) : 0
  const ps = !p ? undefined : p.tab ? g.tabs[idx(p.tab)]?.set : folded(p.set!) ? undefined : p.set
  const ns = n?.tab ? g.tabs[idx(n.tab)]?.set : undefined
  const end = p && hi(box[k - 1]) + (n ? (lo(box[k]) - hi(box[k - 1])) / 2 : 0)
  const set = !ps ? null : !p.tab || ps === ns || pos < end! ? ps : null
  return { index, set }
}

/** A pane's tabs as a drop under the pointer would leave them, for its bar to draw while dragging (`INCOMING`: where
 *  what comes from elsewhere opens; `into`: a folded group taking it, which stays folded). Null: nothing changes there. */
export type Preview = { tabs: { id: string; set?: string }[]; into?: string }
export function previewIn(g: Group, item: DragItem, d: Drop | null): Preview | null {
  if (!d || d.kind !== "bar" || d.group !== g.id) return null
  const sets = new Map(g.tabs.map((t) => [t.id, t.set]))
  const moving = new Set(item.tabset ? g.tabs.filter((t) => t.set === item.tabset).map((t) => t.id) : (item.tabs ?? (item.tab ? [item.tab] : [])).filter((id) => sets.has(id)))
  const into = d.set && g.sets?.find((s) => s.id === d.set)?.collapsed ? d.set : undefined
  if (into) return { tabs: g.tabs.map((t) => ({ id: t.id, set: t.set })), into }
  const rest = g.tabs.filter((t) => !moving.has(t.id))
  let at = d.index - g.tabs.slice(0, d.index).filter((t) => moving.has(t.id)).length
  if (item.tabset) at = outsideSets(rest, at)
  const set = item.tabset ?? d.set ?? undefined
  const come = moving.size ? g.tabs.filter((t) => moving.has(t.id)).map((t) => ({ id: t.id, set })) : [{ id: INCOMING, set }]
  // (more tabs than this pane's, selected together: the rest come in after them)
  if (moving.size && item.tabs && item.tabs.length > moving.size) come.push({ id: INCOMING, set })
  return { tabs: [...rest.slice(0, at).map((t) => ({ id: t.id, set: t.set })), ...come, ...rest.slice(at).map((t) => ({ id: t.id, set: t.set }))] }
}
/** What a pane's tabs show in that order (useSlide's keys): each tab group's name (`set:<id>`) before its tabs, which a
 *  folded one hides. */
export function previewOrder(g: Group, p: Preview) {
  const folded = new Set(g.sets?.filter((s) => s.collapsed).map((s) => s.id))
  return p.tabs.flatMap((t, i) => [...(t.set && t.set !== p.tabs[i - 1]?.set ? [`set:${t.set}`] : []), ...(t.set && folded.has(t.set) ? [] : [t.id])])
}
/** Each tab's group as drawn (a preview's while dragging), and whether it's that group's last: its line ends there. */
export function setsAsDrawn(tabs: { id: string; set?: string }[]) {
  return new Map(tabs.map((t, i) => [t.id, { set: t.set, last: tabs[i + 1]?.set !== t.set }]))
}

/** Where a point lands in the workspace: a place in a tab bar, or a pane's edge or middle. `files`: a file would be left
 *  to what takes files itself there (a canvas, `data-drops`). */
export function placeAt(x: number, y: number, el: Element | null, files = false): { group: string; where: Side | "center" | number; set?: string | null } | null {
  const bar = el?.closest<HTMLElement>("[data-tab-bar]")
  // With the tab bar off (only the tab on screen shows), the bar is the pane's middle.
  if (bar && "tabsHidden" in bar.dataset) return { group: bar.dataset.tabBar!, where: "center" }
  const g = bar && groups().find((x) => x.id === bar.dataset.tabBar)
  if (bar && g) {
    const slots = [...bar.querySelectorAll<HTMLElement>("[data-tab-id], [data-set-chip]")].map((e) => ({ el: e, tab: e.dataset.tabId, set: e.dataset.setChip }))
    const s = slotIn(g, slots, x, "x")
    return { group: g.id, where: s.index, set: s.set }
  }
  const body = el?.closest<HTMLElement>("[data-pane-body]")
  if (!body || (files && el?.closest("[data-drops]"))) return null
  const r = body.getBoundingClientRect()
  const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height
  // The outer quarter on each side splits; the rest (the middle half) moves the tab (opens the file) into the pane.
  const [side, d] = ([["left", fx], ["right", 1 - fx], ["top", fy], ["bottom", 1 - fy]] as [Side, number][]).sort((a, b) => a[1] - b[1])[0]
  return { group: body.dataset.paneBody!, where: d < 0.25 ? side : "center" }
}

/** What's under the pointer, if dropping there changes something. */
export function dropAt(item: DragItem, x: number, y: number, el: Element | null): Drop | null {
  if (!item.to && !item.group && !item.tabset) return null  // a folder, a sidebar panel
  const p = placeAt(x, y, el, !item.tab && !item.group && !item.tabset)
  // (a tab group goes where it's dropped, joining none)
  const set = item.tabset ? null : p?.set ?? null
  if (!p || !canDrop(item, p.group, p.where, set)) return null
  return typeof p.where === "number" ? { kind: "bar", group: p.group, index: p.where, set } : { kind: "pane", group: p.group, zone: p.where }
}

/** Drop `item` there: a pane or a tab moves, a file opens in a new tab (or its tab in that bar moves there). */
export function dropOn(item: DragItem, d: Drop) {
  const where = d.kind === "bar" ? d.index : d.zone, set = d.kind === "bar" ? d.set : undefined
  if (item.group) moveGroupTo(item.group, d.group, where)
  else if (item.tabset) moveSetTo(item.tabset, d.group, where)
  else if (item.tabs) moveTabsTo(item.tabs, item.tab!, d.group, where, set)
  else if (item.tab) moveTabTo(item.tab, d.group, where, set)
  // Files selected together: each opens there, in their order (a side: the first makes the split, the rest join it).
  else if (item.paths) openAllAt(filesAmong(item.paths).map((p) => `file:${p}`), d.group, where)
  // (A sidebar panel dragged by its heading opens as its view.)
  else if (item.to) openAt(item.to, d.group, where, set)
}

/** The files among paths selected in the tree (its folders don't open in a tab). */
function filesAmong(paths: string[]) {
  const s = getStore()
  const known = new Set([...(s?.files.files ?? []), ...(s?.files.others ?? [])].map((f) => f.path))
  return paths.filter((p) => known.has(p))
}
