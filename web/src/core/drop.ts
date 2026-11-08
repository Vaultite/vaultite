// Dropping tabs, panes, tab groups and files (core/drag.ts): on the list of tabs (the tab bar, the Tabs panel) or on a
// pane of the tab on screen. What's under the pointer and what a drop there does.
import { laidOut, rehit, type DragItem } from "@/core/drag"
import { isSplit, outsideGroups, panesOf, runOf, type TabList } from "../../../core/layout.ts"
import {
  canOpenAt, canOpenAtIndex, canPaneIntoPane, canPlaceAmong, canPlaceTab, canTabIntoPane, openAllAt, openAllAtIndex, openAmong, openAt, openAtIndex, paneIntoPane, paneToTab, placeAmong, placeTab, placeTabs,
  tabIntoPane, tabShowing, type Zone,
} from "@/core/splits"
import { canMoveGroup, moveGroupTo } from "@/core/tabgroups"
import { here, paneById, paneTab, selectTab, tabById } from "@/core/workspace"
import { INCOMING } from "@/core/slide"

/** Where something dragged would land: a place in the list of tabs (`group` it joins, null none; `home`: where it is
 *  already), a pane's edge or middle, or before the `index`th of a split pane's own tabs (`pane`: one of them). */
export type Drop = { kind: "list"; index: number; group: string | null; home?: boolean } | { kind: "pane"; pane: string; zone: Zone }
  | { kind: "places"; pane: string; index: number }
/** The tab of one pane `id` is, which can go among a pane's own tabs (a split's, or a blank one's: no). */
const loneTab = (id: string) => { const t = tabById(id); return t && !isSplit(t.root) && t.root.to !== "new" ? t.root : null }
/** The workspace's drop target (useDropTarget): its tab bar and panes. */
export const PANES = "panes"

/** A pane dragged onto the list: the tab it's alone in moves, a split's pane becomes a tab of its own. */
const lonePane = (id: string) => { const t = paneTab(id); return t && panesOf(t).length === 1 ? t : null }
/** A place in a list of tabs as a drop target answers it: what a drop there does, or, where the tabs or group dragged
 *  already are, `home` (taken there and drawn so, as in a browser, not pulled off as over nothing); else null. */
export function listDrop(item: DragItem, d: Drop & { kind: "list" }): Drop | null {
  if (canDropAt(item, d)) return d
  return item.tab || item.group ? { ...d, home: true } : null
}

/** Would that drop change anything? */
export function canDropAt(item: DragItem, d: Drop): boolean {
  if (d.kind === "list") {
    if (d.home) return false
    if (item.pane) { const t = lonePane(item.pane); return t ? canPlaceTab(t.id, d.index, d.group) : !!paneById(item.pane) }
    if (item.group) return canMoveGroup(item.group, d.index)
    if (item.tabs?.length) return true
    if (item.tab) return canPlaceTab(item.tab, d.index, d.group)
    return !!item.to && canOpenAtIndex(item.to, d.index, d.group)
  }
  if (d.kind === "places") {
    if (item.pane) return canPlaceAmong(item.pane, d.pane, d.index)
    if (item.group || item.tabs?.length || item.tos?.length) return false
    if (item.tab) { const p = loneTab(item.tab); return !!p && canPlaceAmong(p.id, d.pane, d.index) }
    return !!item.to && !!paneTab(d.pane)
  }
  if (item.pane) return canPaneIntoPane(item.pane, d.pane, d.zone, item.place || undefined)
  if (item.group) return false
  if (item.tab) return canTabIntoPane(item.tab, d.pane, d.zone)
  return !!item.to && canOpenAt(item.to, d.pane, d.zone)
}

/** Drop `item` there: a tab, a pane or a group moves, a file opens (a tab of its own in the list, or in a pane). */
export function dropOn(item: DragItem, d: Drop) {
  if (d.kind === "list") {
    if (d.home) return
    if (item.pane) { const t = lonePane(item.pane); if (t) placeTab(t.id, d.index, d.group); else paneToTab(item.pane, d.index, d.group) }
    else if (item.group) moveGroupTo(item.group, d.index)
    else if (item.tabs?.length) placeTabs(item.tabs, item.tab!, d.index, d.group)
    else if (item.tab) placeTab(item.tab, d.index, d.group)
    // Several selected together: each in a tab of its own, in their order.
    else if (item.tos?.length) openAllAtIndex(item.tos, d.index, d.group)
    else if (item.to) openAtIndex(item.to, d.index, d.group)
    return
  }
  if (d.kind === "places") {
    if (item.pane) placeAmong(item.pane, d.pane, d.index)
    else if (item.tab) { const p = loneTab(item.tab); if (p) placeAmong(p.id, d.pane, d.index) }
    else if (item.to) openAmong(item.to, d.pane, d.index)
    return
  }
  if (item.pane) paneIntoPane(item.pane, d.pane, d.zone, item.place || undefined)
  else if (item.tab) tabIntoPane(item.tab, d.pane, d.zone)
  else if (item.tos?.length) openAllAt(item.tos, d.pane, d.zone)
  // (A sidebar panel dragged by its heading opens as its view.)
  else if (item.to) openAt(item.to, d.pane, d.zone)
}

/** A tab, or a tab group's name (its chip, its row), in a list of tabs as drawn (tabs of a folded group aren't). */
export type Slot = { el: Element; tab?: string; group?: string }

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

/** Where a tab or pane held on tab `tab`'s middle (springOver) lands: beside it, in its group, on the side it came from
 *  (after it, from elsewhere), so that row holds still under the pointer, not sliding away and back across its middle. */
export function slotBeside(l: TabList, item: DragItem, tab: string) {
  const i = l.tabs.findIndex((t) => t.id === tab)
  const own = item.pane ? lonePane(item.pane)?.id : undefined
  const moving = new Set([...(item.tabs ?? []), ...(item.tab ? [item.tab] : []), ...(own ? [own] : [])])
  const above = l.tabs.slice(0, i).some((t) => moving.has(t.id))
  return { index: above ? i : i + 1, group: l.tabs[i]?.group ?? null }
}

/** The tabs as a drop under the pointer would leave them, for a list to draw while dragging (`INCOMING`: where what
 *  comes from elsewhere opens; `into`: a folded group taking it, which stays folded). Null: nothing changes there. */
export type Preview = { tabs: { id: string; group?: string }[]; into?: string }
export function previewIn(l: TabList, item: DragItem, d: Drop | null): Preview | null {
  if (!d || d.kind !== "list") return null
  const groups = new Map(l.tabs.map((t) => [t.id, t.group]))
  const alone = item.pane ? lonePane(item.pane) : null
  // (a file dragged in that a tab shows already: that tab moves there, as dropOn does, rather than a new one coming in)
  const shows = !item.tab && !item.pane && !item.group && item.to && (item.paths?.length ?? 1) === 1 ? tabShowing(l, item.to) : undefined
  const moving = new Set(item.group ? l.tabs.filter((t) => t.group === item.group).map((t) => t.id)
    : alone ? [alone.id] : shows ? [shows.id] : (item.tabs ?? (item.tab ? [item.tab] : [])).filter((id) => groups.has(id)))
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
  // A pane's strip of its own tabs: among them, before the chip it's left of the middle of.
  const chips = el?.closest<HTMLElement>("[data-place-strip]")
  if (chips) {
    const index = [...chips.querySelectorAll<HTMLElement>("[data-place]")].filter((c) => { const b = laidOut(c); return (b.left + b.right) / 2 < x }).length
    return { kind: "places", pane: chips.dataset.placeStrip!, index }
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

/** What's under the pointer, if dropping there changes something (or, in the tab bar, it's where the tab is: `home`).
 *  `held`: the tab whose chip it's held on (springTabAt), which holds still. */
export function dropAt(item: DragItem, x: number, y: number, el: Element | null, held?: string | null): Drop | null {
  if (!item.to && !item.pane && !item.group && !item.tab) return null  // a folder, a sidebar panel
  // (a strip in a pane with drops of its own, as the Browser's bookmarks bar: not a place in the pane)
  if (el?.closest("[data-own-drops]")) return null
  const d: Drop | null = held ? (el?.closest("[data-tab-strip]") ? { kind: "list", ...slotBeside(here(), item, held) } : null)
    : placeAt(x, y, el, !item.tab && !item.pane && !item.group)
  if (d?.kind === "list") return listDrop(item, item.group ? { ...d, group: null } : d)  // (a tab group joins none)
  return d && canDropAt(item, d) ? d : null
}

// ---------- spring-loaded tabs: a dragged pane or tab held over another tab's row opens it (Rex) ----------

const SPRING_MS = 1000
/** Lit only once held there this long: passed over on the way elsewhere, a row doesn't flash. */
const LIT_MS = 250
/** Moved further than this (px), the pointer isn't holding still: the wait starts again. */
const STILL_PX = 6
type Spring = { tab: string; x: number; y: number; timer: number; lit: boolean; light: number }
let spring: Spring | null = null
/** What's dragged is at (x, y) on tab `tab`'s row (null: none): held still there a second, that tab opens to drop into
 *  its panes; moved on, it waits again. Only a pane or a tab springs one; a file opens in the list where it's let go. */
export function springOver(tab: string | null, item: DragItem | null, x = 0, y = 0) {
  if (spring?.tab === tab && Math.hypot(x - spring.x, y - spring.y) <= STILL_PX) return
  if (spring) { clearTimeout(spring.timer); clearTimeout(spring.light) }
  // (a row lit goes dark with the move that left it, drawn again as every move is)
  spring = null
  if (!tab || !item || !(item.pane || item.tab) || item.tab === tab || here().active === tab) return
  const s: Spring = { tab, x, y, lit: false, light: 0, timer: window.setTimeout(() => { spring = null; sprung = { tab, item }; selectTab(tab) }, SPRING_MS) }
  s.light = window.setTimeout(() => { if (spring !== s) return; s.lit = true; rehit() }, LIT_MS)
  spring = s
}
/** Whether a row is about to spring open (drawn lit, as Rex's), once held on it a moment. */
export const springing = () => (spring?.lit ? spring.tab : null)
/** The tab a spring opened, and for which drag (its item, the same object all along). */
let sprung: { tab: string; item: DragItem } | null = null
/** Whether `item`'s drag opened tab `tab` by holding on it: its row goes on holding still, though it's the tab shown now. */
export const sprangOpen = (item: DragItem, tab: string) => sprung?.item === item && sprung.tab === tab
