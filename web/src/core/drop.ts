// Dropping on the workspace (core/drag.ts: a tab, a whole pane, or a file or page from the sidebar): what's under the
// pointer and what a drop there does.
import type { DragItem } from "@/core/drag"
import type { Side } from "@/core/layout"
import { canMove, canMoveGroup, canOpenAt, moveGroupTo, moveTabsTo, moveTabTo, openAllAt, openAt } from "@/core/splits"
import { getStore } from "@/core/data"

/** Where a dragged tab or file would land: a place in a tab bar (`x`: the line's position in the bar), or a pane's edge
 *  or middle. */
export type Drop = { kind: "bar"; group: string; index: number; x: number } | { kind: "pane"; group: string; zone: Side | "center" }
/** The workspace's drop target (useDropTarget): its tab bars and panes. */
export const PANES = "panes"

/** Would dropping `item` there change anything? A pane or a tab moves (canMoveGroup, canMove), anything else opens
 *  (canOpenAt). */
const canDrop = (item: DragItem, gid: string, where: Side | "center" | number) =>
  item.group ? canMoveGroup(item.group, gid, where) : item.tab ? canMove(item.tab, gid, where) : !!item.to && canOpenAt(item.to, gid, where)

/** Where a point lands in the workspace: a place in a tab bar (`x`: the line's position in it), or a pane's edge or
 *  middle. `files`: a file would be left to what takes files itself there (a canvas, `data-drops`). */
export function placeAt(x: number, y: number, el: Element | null, files = false): { group: string; where: Side | "center" | number; x?: number } | null {
  const bar = el?.closest<HTMLElement>("[data-tab-bar]")
  // With the tab bar off (only the tab on screen shows), the bar is the pane's middle.
  if (bar && "tabsHidden" in bar.dataset) return { group: bar.dataset.tabBar!, where: "center" }
  if (bar) {
    const tabs = [...bar.querySelectorAll<HTMLElement>("[data-tab-id]")].map((t) => t.getBoundingClientRect())
    const index = tabs.filter((r) => r.left + r.width / 2 < x).length
    const b = bar.getBoundingClientRect()
    // Halfway between two tabs (they're 4px apart), or just after the last.
    const at = index < tabs.length ? tabs[index].left - 2 : tabs.length ? tabs[tabs.length - 1].right + 2 : 8
    return { group: bar.dataset.tabBar!, where: index, x: at - b.left }
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
  if (!item.to && !item.group) return null  // a folder, a sidebar panel
  const p = placeAt(x, y, el, !item.tab && !item.group)
  if (!p || !canDrop(item, p.group, p.where)) return null
  return typeof p.where === "number" ? { kind: "bar", group: p.group, index: p.where, x: p.x! } : { kind: "pane", group: p.group, zone: p.where }
}

/** Drop `item` there: a pane or a tab moves, a file opens in a new tab (or its tab in that bar moves there). */
export function dropOn(item: DragItem, d: Drop) {
  const where = d.kind === "bar" ? d.index : d.zone
  if (item.group) moveGroupTo(item.group, d.group, where)
  else if (item.tabs) moveTabsTo(item.tabs, item.tab!, d.group, where)
  else if (item.tab) moveTabTo(item.tab, d.group, where)
  // Files selected together: each opens there, in their order (a side: the first makes the split, the rest join it).
  else if (item.paths) openAllAt(filesAmong(item.paths).map((p) => `file:${p}`), d.group, where)
  // (A sidebar panel dragged by its heading opens as its view.)
  else if (item.to) openAt(item.to, d.group, where)
}

/** The files among paths selected in the tree (its folders don't open in a tab). */
function filesAmong(paths: string[]) {
  const s = getStore()
  const known = new Set([...(s?.files.files ?? []), ...(s?.files.others ?? [])].map((f) => f.path))
  return paths.filter((p) => known.has(p))
}
