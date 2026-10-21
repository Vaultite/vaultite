// Dropping on the workspace (core/drag.ts: a tab, a whole pane, or a file or page from the sidebar): what's under the
// pointer and what a drop there does.
import type { DragItem } from "@/core/drag"
import { runOf, type Group, type Side } from "@/core/layout"
import { canMove, canMoveGroup, canOpenAt, moveGroupTo, moveTabsTo, moveTabTo, openAllAt, openAt } from "@/core/splits"
import { canMoveSet, moveSetTo } from "@/core/tabsets"
import { groups } from "@/core/workspace"
import { getStore } from "@/core/data"

/** Where a dragged tab or file would land: a place in a tab bar (`x`: the line's position in the bar; `set`: the tab
 *  group it joins there, null none), or a pane's edge or middle. */
export type Drop = { kind: "bar"; group: string; index: number; x: number; set: string | null } | { kind: "pane"; group: string; zone: Side | "center" }
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
/** Where `pos` along a pane's tabs as drawn lands: before which tab (`index`), in which tab group (after its name or
 *  between its tabs; at its end only for `own`, the dragged tab's), and where the line goes (`edge`, in the window). */
export function slotIn(g: Group, slots: Slot[], pos: number, axis: "x" | "y", own?: string) {
  const box = slots.map((s) => s.el.getBoundingClientRect())
  const mid = (r: DOMRect) => (axis === "x" ? r.left + r.width / 2 : r.top + r.height / 2)
  const k = box.filter((r) => mid(r) < pos).length
  const p = slots[k - 1], n = slots[k]
  const idx = (tab: string) => g.tabs.findIndex((t) => t.id === tab)
  const folded = (set: string) => !!g.sets?.find((s) => s.id === set)?.collapsed
  const before = (s: Slot) => (s.tab ? idx(s.tab) : runOf(g, s.set!).at)
  const after = (s: Slot) => (s.tab ? idx(s.tab) + 1 : folded(s.set!) ? runOf(g, s.set!).at + runOf(g, s.set!).n : runOf(g, s.set!).at)
  const index = n ? before(n) : p ? after(p) : 0
  const ps = p?.tab ? g.tabs[idx(p.tab)]?.set : undefined, ns = n?.tab ? g.tabs[idx(n.tab)]?.set : undefined
  const set = p && !p.tab && !folded(p.set!) ? p.set! : ps && ps === ns ? ps : ps && ps === own ? ps : null
  const edge = n ? (axis === "x" ? box[k].left - 2 : box[k].top - 1) : p ? (axis === "x" ? box[k - 1].right + 2 : box[k - 1].bottom + 1) : 0
  return { index, set, edge }
}
/** The tab group a dragged tab is in. */
const ownSet = (item: DragItem) => (item.tab ? groups().flatMap((g) => g.tabs).find((t) => t.id === item.tab)?.set : undefined)

/** Where a point lands in the workspace: a place in a tab bar (`x`: the line's position in it), or a pane's edge or
 *  middle. `files`: a file would be left to what takes files itself there (a canvas, `data-drops`). */
export function placeAt(x: number, y: number, el: Element | null, files = false, own?: string): { group: string; where: Side | "center" | number; x?: number; set?: string | null } | null {
  const bar = el?.closest<HTMLElement>("[data-tab-bar]")
  // With the tab bar off (only the tab on screen shows), the bar is the pane's middle.
  if (bar && "tabsHidden" in bar.dataset) return { group: bar.dataset.tabBar!, where: "center" }
  const g = bar && groups().find((x) => x.id === bar.dataset.tabBar)
  if (bar && g) {
    const slots = [...bar.querySelectorAll<HTMLElement>("[data-tab-id], [data-set-chip]")].map((e) => ({ el: e, tab: e.dataset.tabId, set: e.dataset.setChip }))
    // Halfway between two tabs (they're 4px apart), or just after the last.
    const s = slotIn(g, slots, x, "x", own)
    return { group: g.id, where: s.index, x: (slots.length ? s.edge : 8) - bar.getBoundingClientRect().left, set: s.set }
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
  const p = placeAt(x, y, el, !item.tab && !item.group && !item.tabset, ownSet(item))
  // (a tab group goes where it's dropped, joining none)
  const set = item.tabset ? null : p?.set ?? null
  if (!p || !canDrop(item, p.group, p.where, set)) return null
  return typeof p.where === "number" ? { kind: "bar", group: p.group, index: p.where, x: p.x!, set } : { kind: "pane", group: p.group, zone: p.where }
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
