// Dropping tabs, panes, tab groups and files (core/drag.ts): on the list of tabs (the tab bar, the Tabs panel) or on a
// pane of the tab on screen. What's under the pointer and what a drop there does.
import type { DragItem } from "@/core/drag"
import { outsideGroups, panesOf, runOf, type TabList } from "../../../core/layout.ts"
import {
  canOpenAt, canOpenAtIndex, canPaneIntoPane, canPlaceTab, canTabIntoPane, openAllAt, openAllAtIndex, openAt, openAtIndex, paneIntoPane, paneToTab, placeTab, placeTabs,
  tabIntoPane, type Zone,
} from "@/core/splits"
import { canMoveGroup, moveGroupTo } from "@/core/tabgroups"
import { here, paneById, paneTab, selectTab } from "@/core/workspace"
import { getStore } from "@/core/data"
import { INCOMING } from "@/core/slide"

/** Where something dragged would land: a place in the list of tabs (`group`: the tab group it joins there, null none),
 *  or a pane's edge or middle. */
export type Drop = { kind: "list"; index: number; group: string | null } | { kind: "pane"; pane: string; zone: Zone }
/** The workspace's drop target (useDropTarget): its tab bar and panes. */
export const PANES = "panes"

/** A pane dragged onto the list: the tab it's alone in moves, a split's pane becomes a tab of its own. */
const lonePane = (id: string) => { const t = paneTab(id); return t && panesOf(t).length === 1 ? t : null }
/** Would that drop change anything? */
export function canDropAt(item: DragItem, d: Drop): boolean {
  if (d.kind === "list") {
    if (item.pane) { const t = lonePane(item.pane); return t ? canPlaceTab(t.id, d.index, d.group) : !!paneById(item.pane) }
    if (item.group) return canMoveGroup(item.group, d.index)
    if (item.tabs?.length) return true
    if (item.tab) return canPlaceTab(item.tab, d.index, d.group)
    return !!item.to && canOpenAtIndex(item.to, d.index, d.group)
  }
  if (item.pane) return canPaneIntoPane(item.pane, d.pane, d.zone)
  if (item.group) return false
  if (item.tab) return canTabIntoPane(item.tab, d.pane, d.zone)
  return !!item.to && canOpenAt(item.to, d.pane, d.zone)
}

/** Drop `item` there: a tab, a pane or a group moves, a file opens (a tab of its own in the list, or in a pane). */
export function dropOn(item: DragItem, d: Drop) {
  if (d.kind === "list") {
    if (item.pane) { const t = lonePane(item.pane); if (t) placeTab(t.id, d.index, d.group); else paneToTab(item.pane, d.index, d.group) }
    else if (item.group) moveGroupTo(item.group, d.index)
    else if (item.tabs?.length) placeTabs(item.tabs, item.tab!, d.index, d.group)
    else if (item.tab) placeTab(item.tab, d.index, d.group)
    // Files selected together: each in a tab of its own, in their order.
    else if (item.paths) openAllAtIndex(filesAmong(item.paths).map((p) => `file:${p}`), d.index, d.group)
    else if (item.to) openAtIndex(item.to, d.index, d.group)
    return
  }
  if (item.pane) paneIntoPane(item.pane, d.pane, d.zone)
  else if (item.tab) tabIntoPane(item.tab, d.pane, d.zone)
  else if (item.paths) openAllAt(filesAmong(item.paths).map((p) => `file:${p}`), d.pane, d.zone)
  // (A sidebar panel dragged by its heading opens as its view.)
  else if (item.to) openAt(item.to, d.pane, d.zone)
}

/** A tab, or a tab group's name (its chip, its row), in a list of tabs as drawn (tabs of a folded group aren't). */
export type Slot = { el: Element; tab?: string; group?: string }

/** Where an element is laid out, without the slide a drag's preview gives it (useSlide): hits are worked out on that. */
function laidOut(el: Element) {
  const r = el.getBoundingClientRect(), slid = el.closest<HTMLElement>("[data-slide]")
  if (!slid?.style.transform) return r
  const m = new DOMMatrixReadOnly(getComputedStyle(slid).transform)
  return new DOMRect(r.x - m.m41, r.y - m.m42, r.width, r.height)
}

/** Where `pos` along the tabs as drawn lands: before which tab (`index`), in which tab group. Between a group's tabs or
 *  after its name: in it; over its last tab, in; just past it, out; on the middle of a folded one's name, into it. */
export function slotIn(l: TabList, slots: Slot[], pos: number, axis: "x" | "y") {
  const box = slots.map((s) => laidOut(s.el))
  const lo = (r: DOMRect) => (axis === "x" ? r.left : r.top), hi = (r: DOMRect) => (axis === "x" ? r.right : r.bottom)
  const folded = (g: string) => !!l.groups?.find((s) => s.id === g)?.collapsed
  const on = slots.findIndex((s, i) => s.group && folded(s.group) && Math.abs(pos - (lo(box[i]) + hi(box[i])) / 2) < (hi(box[i]) - lo(box[i])) / 4)
  if (on >= 0) { const r = runOf(l, slots[on].group!); return { index: r.at + r.n, group: slots[on].group! } }
  const k = box.filter((r) => (lo(r) + hi(r)) / 2 < pos).length
  const p = slots[k - 1], n = slots[k]
  const idx = (tab: string) => l.tabs.findIndex((t) => t.id === tab)
  const before = (s: Slot) => (s.tab ? idx(s.tab) : runOf(l, s.group!).at)
  const after = (s: Slot) => (s.tab ? idx(s.tab) + 1 : folded(s.group!) ? runOf(l, s.group!).at + runOf(l, s.group!).n : runOf(l, s.group!).at)
  const index = n ? before(n) : p ? after(p) : 0
  const pg = !p ? undefined : p.tab ? l.tabs[idx(p.tab)]?.group : folded(p.group!) ? undefined : p.group
  const ng = n?.tab ? l.tabs[idx(n.tab)]?.group : undefined
  const end = p && hi(box[k - 1]) + (n ? (lo(box[k]) - hi(box[k - 1])) / 2 : 0)
  const group = !pg ? null : !p.tab || pg === ng || pos < end! ? pg : null
  return { index, group }
}

/** The tabs as a drop under the pointer would leave them, for a list to draw while dragging (`INCOMING`: where what
 *  comes from elsewhere opens; `into`: a folded group taking it, which stays folded). Null: nothing changes there. */
export type Preview = { tabs: { id: string; group?: string }[]; into?: string }
export function previewIn(l: TabList, item: DragItem, d: Drop | null): Preview | null {
  if (!d || d.kind !== "list") return null
  const groups = new Map(l.tabs.map((t) => [t.id, t.group]))
  const alone = item.pane ? lonePane(item.pane) : null
  const moving = new Set(item.group ? l.tabs.filter((t) => t.group === item.group).map((t) => t.id)
    : alone ? [alone.id] : (item.tabs ?? (item.tab ? [item.tab] : [])).filter((id) => groups.has(id)))
  const into = d.group && l.groups?.find((s) => s.id === d.group)?.collapsed ? d.group : undefined
  if (into) return { tabs: l.tabs.map((t) => ({ id: t.id, group: t.group })), into }
  const rest = l.tabs.filter((t) => !moving.has(t.id))
  let at = d.index - l.tabs.slice(0, d.index).filter((t) => moving.has(t.id)).length
  if (item.group) at = outsideGroups(rest, at)
  const group = item.group ?? d.group ?? undefined
  const come = moving.size ? l.tabs.filter((t) => moving.has(t.id)).map((t) => ({ id: t.id, group })) : [{ id: INCOMING, group }]
  return { tabs: [...rest.slice(0, at).map((t) => ({ id: t.id, group: t.group })), ...come, ...rest.slice(at).map((t) => ({ id: t.id, group: t.group }))] }
}
/** What the tabs show in that order (useSlide's keys): each tab group's name (`group:<id>`) before its tabs, which a
 *  folded one hides. */
export function previewOrder(l: TabList, p: Preview) {
  const folded = new Set(l.groups?.filter((s) => s.collapsed).map((s) => s.id))
  return p.tabs.flatMap((t, i) => [...(t.group && t.group !== p.tabs[i - 1]?.group ? [`group:${t.group}`] : []), ...(t.group && folded.has(t.group) ? [] : [t.id])])
}
/** Each tab's group as drawn (a preview's while dragging): its line runs by it. */
export function groupsAsDrawn(tabs: { id: string; group?: string }[]) {
  return new Map(tabs.map((t) => [t.id, t.group]))
}

/** Where a point lands in the workspace: a place in the tab bar, or a pane's edge or middle. `files`: a file would be
 *  left to what takes files itself there (a canvas, `data-drops`). */
export function placeAt(x: number, y: number, el: Element | null, files = false): Drop | null {
  const strip = el?.closest<HTMLElement>("[data-tab-strip]")
  if (strip) {
    const slots = [...strip.querySelectorAll<HTMLElement>("[data-tab-id], [data-group-chip]")].map((e) => ({ el: e, tab: e.dataset.tabId, group: e.dataset.groupChip }))
    const s = slotIn(here(), slots, x, "x")
    return { kind: "list", index: s.index, group: s.group }
  }
  // A pane's bar is its middle.
  const bar = el?.closest<HTMLElement>("[data-pane-bar]")
  if (bar) return { kind: "pane", pane: bar.dataset.paneBar!, zone: "center" }
  const body = el?.closest<HTMLElement>("[data-pane-body]")
  if (!body || (files && el?.closest("[data-drops]"))) return null
  const pane = body.dataset.paneBody!
  // A floating pane has no edges to split: a drop on it goes in it.
  if (paneById(pane)?.float) return { kind: "pane", pane, zone: "center" }
  const r = body.getBoundingClientRect()
  const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height
  // The outer quarter on each side splits; the rest (the middle half) takes its place.
  const [side, d] = ([["left", fx], ["right", 1 - fx], ["top", fy], ["bottom", 1 - fy]] as [Zone, number][]).sort((a, b) => a[1] - b[1])[0]
  return { kind: "pane", pane, zone: d < 0.25 ? side : "center" }
}

/** What's under the pointer, if dropping there changes something. */
export function dropAt(item: DragItem, x: number, y: number, el: Element | null): Drop | null {
  if (!item.to && !item.pane && !item.group && !item.tab) return null  // a folder, a sidebar panel
  const d = placeAt(x, y, el, !item.tab && !item.pane && !item.group)
  // (a tab group goes where it's dropped, joining none)
  const fixed = d?.kind === "list" && item.group ? { ...d, group: null } : d
  return fixed && canDropAt(item, fixed) ? fixed : null
}

/** The files among paths selected in the tree (its folders don't open in a tab). */
function filesAmong(paths: string[]) {
  const s = getStore()
  const known = new Set([...(s?.files.files ?? []), ...(s?.files.others ?? [])].map((f) => f.path))
  return paths.filter((p) => known.has(p))
}

// ---------- spring-loaded tabs: a dragged pane or tab held over another tab's row opens it (Rex) ----------

const SPRING_MS = 1000
let spring: { tab: string; timer: number } | null = null
/** What's dragged is over tab `tab`'s row (null: over none): held there about a second, that tab opens, so what's
 *  dragged can go into its panes. Only a pane or a tab springs a row open; a file opens in the list where it's let go. */
export function springOver(tab: string | null, item: DragItem | null) {
  if (spring?.tab === tab) return
  if (spring) clearTimeout(spring.timer)
  spring = null
  if (!tab || !item || !(item.pane || item.tab) || item.tab === tab || here().active === tab) return
  spring = { tab, timer: window.setTimeout(() => { spring = null; selectTab(tab) }, SPRING_MS) }
}
/** Whether a row is about to spring open (drawn lit, as Rex's). */
export const springing = () => spring?.tab ?? null
