import {
  beside, bare, evened, evenedAll, floated, groupAt, inGroup, isBlank, isBlankTab, isSplit, isStacked, layout, leaves, mapPanes, mapPlaces, mapTab, moveOn, neighbourOf, newPaneId, nudged, panesOf,
  paneWith, placesIn, placesOf, replaced, resized, swapped, tabOf, tabOfPane, tabWith, tabWithout, tabWithoutPanes, tidy, withoutTabs, withPlace, type Layout, type Pane, type Rect, type Side, type Tab, type TabList,
} from "../../../core/layout.ts"
import { focusPane } from "@/core/focus"
import { activePane, activeTab, setFocusedPane, here, keepsTab, onWorkspaceChange, paneById, panes, paneTab, quietly, set, show, showActive, showActiveUnder, tabById, tabsByRecent, withTab } from "@/core/workspace"

export type Zone = Side | "center"

function pulled(l: TabList, id: string) {
  const at = l.tabs.findIndex((t) => t.id === id)
  return { tab: l.tabs[at], at, rest: { ...l, tabs: l.tabs.filter((t) => t.id !== id) } }
}
function putAt(l: TabList, t: Tab, at: number, group?: string | null, own?: string): TabList {
  const i = Math.max(0, Math.min(at, l.tabs.length))
  const g = group === undefined ? groupAt(l.tabs, i, own) : group ?? undefined
  return { ...l, tabs: [...l.tabs.slice(0, i), inGroup(t, g), ...l.tabs.slice(i)] }
}

export function canPlaceTab(id: string, at: number, group?: string | null) {
  const l = here(), i = l.tabs.findIndex((t) => t.id === id)
  if (i < 0) return false
  if (at !== i && at !== i + 1) return true
  return group !== undefined && (group ?? undefined) !== l.tabs[i].group
}
export function placeTab(id: string, at: number, group?: string | null) {
  if (!canPlaceTab(id, at, group)) return
  const { tab, at: i, rest } = pulled(here(), id)
  set(putAt(rest, tab, at > i ? at - 1 : at, group, tab.group))
}
export function placeTabs(ids: string[], held: string, at: number, group?: string | null) {
  const l = here(), order = l.tabs.filter((t) => ids.includes(t.id))
  if (!order.length) return
  const before = l.tabs.slice(0, at).filter((t) => ids.includes(t.id)).length
  const rest = l.tabs.filter((t) => !ids.includes(t.id)), i = at - before
  const g = group === undefined ? groupAt(rest, i, tabById(held)?.group) : group ?? undefined
  set({ ...l, tabs: [...rest.slice(0, i), ...order.map((t) => inGroup(t, g)), ...rest.slice(i)] })
}
export function moveTabBy(dir: 1 | -1) {
  const l = here(), i = l.tabs.findIndex((t) => t.id === l.active)
  if (i < 0 || i + dir < 0 || i + dir >= l.tabs.length) return false
  placeTab(l.active, dir > 0 ? i + 2 : i - 1)
  return true
}

export function canTabIntoPane(id: string, pane: string, zone: Zone) {
  const t = tabById(id), into = paneTab(pane)
  if (!t || !into || isBlankTab(t) || zone === undefined) return false
  return t.id !== into.id || (zone !== "center" && !isSplit(t.root))
}
export function tabIntoPane(id: string, pane: string, zone: Zone) {
  if (!canTabIntoPane(id, pane, zone)) return
  if (paneTab(pane)!.id === id) return splitOff(id, zone as Side)
  const l = here(), { tab, at, rest } = pulled(l, id), into = tabOfPane(rest, pane)!
  const one = tab.root
  if (zone === "center" && isSplit(into.root) && !isSplit(one)) {
    set({ ...mapTab(rest, into.id, (t) => ({ ...withPlace(t, pane, one), focus: one.id })), active: into.id })
    return showActiveUnder()
  }
  const root: Layout = zone === "center" ? graft(into.root, pane, tab.root) : beside(into.root, pane, tab.root, zone)
  let next = mapTab(rest, into.id, (t) => ({ ...t, root, focus: tab.focus, zoom: undefined }))
  const was = leaves(into.root).find((p) => p.id === pane)!
  if (zone === "center" && !isBlank(was)) next = putAt(next, tabWith(was), at, null)
  set({ ...next, active: into.id })
  showActiveUnder()
}
const across: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" }
function splitOff(id: string, side: Side) {
  const t = tabById(id)!, prev = tabsByRecent().find((x) => x.id !== id)
  const other: Layout = prev?.root ?? { id: newPaneId(), to: "new" }
  const root = tidy(beside(t.root, t.root.id, other, across[side]))!
  const focus = isBlank(other as Pane) ? other.id : t.focus
  const l = mapTab(here(), id, (x) => ({ ...x, root, focus, zoom: undefined }))
  set({ ...(prev ? withoutTabs(l, new Set([prev.id]))! : l), active: id })
  if (focus === t.focus) return showActiveUnder()
  show("new", true)
}
function graft(n: Layout, id: string, by: Layout): Layout {
  if (!("kids" in by)) return replaced(n, id, by)
  const put = (x: Layout): Layout => ("kids" in x ? { ...x, kids: x.kids.map(put) } : x.id === id ? by : x)
  return put(n)
}
export const replaceWithTab = (id: string, pane = activePane().id) => tabIntoPane(id, pane, "center")
export const moveToSplit = (side: Side, id: string) => tabIntoPane(id, activePane().id, side)
export const canJoin = (id: string) => !!tabById(id) && id !== here().active && !isBlankTab(tabById(id))

const stackedHere = (id: string) => { const t = paneTab(id); return !!t && isStacked(t.root, id) }
export function canPaneIntoPane(id: string, target: string, zone: Zone, asPlace = stackedHere(id)) {
  const from = paneTab(id), into = paneTab(target)
  if (!from || !into) return false
  if (id === target) return asPlace && zone !== "center" && placesOf(paneWith(from.root, id)!).length > 1
  if (!asPlace) return from.id !== into.id || zone === "center" || panesOf(from).length > 1
  if (zone === "center") return !placesOf(paneWith(into.root, target)!).some((p) => p.id === id)
  return from.id !== into.id || placesIn(from).length > 1
}
export function paneIntoPane(id: string, target: string, zone: Zone, asPlace = stackedHere(id)) {
  if (!canPaneIntoPane(id, target, zone, asPlace)) return
  if (asPlace) return placeIntoPane(id, target, zone)
  const l = here(), from = paneTab(id)!, into = paneTab(target)!, p = paneWith(from.root, id)!, q = paneWith(into.root, target)!
  if (zone === "center") {
    if (from.id === into.id) set(withTab(from.id, (t) => ({ ...t, root: swapped(t.root, id, target), focus: id })))
    else if (isBlank(q)) {
      const left = tabWithoutPanes(from, new Set([id]))
      const base = left ? mapTab(l, from.id, () => left) : withoutTabs(l, new Set([from.id])) ?? l
      set({ ...mapTab(base, into.id, (t) => ({ ...t, root: replaced(t.root, target, p), focus: id })), active: into.id })
    } else {
      const swap = (t: Tab, a: Pane, b: Pane) => ({ ...t, root: replaced(t.root, a.id, b), focus: t.focus === a.id ? b.id : t.focus })
      set({ ...mapTab(mapTab(l, from.id, (t) => swap(t, p, q)), into.id, (t) => ({ ...swap(t, q, p), focus: id })), active: into.id })
    }
  } else {
    const { float: _, ...moved } = p
    const left = tabWithoutPanes(from, new Set([id]))
    const base = left ? mapTab(l, from.id, () => left) : withoutTabs(l, new Set([from.id])) ?? l
    const t = base.tabs.find((x) => x.id === into.id)!
    set({ ...mapTab(base, into.id, () => ({ ...t, root: beside(t.root, target, moved, zone), focus: id })), active: into.id })
  }
  showActiveUnder()
}
function placeIntoPane(id: string, target: string, zone: Zone) {
  if (zone === "center") {
    const own = paneWith(paneTab(target)!.root, target)!
    return placeAmong(id, target, placesOf(own).findIndex((p) => p.id === target) + 1)
  }
  if (id === target) return splitOut(id, zone)
  const from = paneTab(id)!, into = paneTab(target)!, { float: _, ...p } = bare(paneById(id)!)
  const left = tabWithout(from, new Set([id]))
  const base = left ? mapTab(here(), from.id, () => left) : withoutTabs(here(), new Set([from.id])) ?? here()
  set({ ...mapTab(base, into.id, (t) => ({ ...t, root: beside(t.root, target, p, zone), focus: id })), active: into.id })
  showActiveUnder()
}

export function canPlaceAmong(id: string, at: string, index: number) {
  const into = paneTab(at), from = paneTab(id)
  if (!into || !from || !isSplit(into.root)) return false
  const i = placesOf(paneWith(into.root, at)!).findIndex((p) => p.id === id)
  return i < 0 || (index !== i && index !== i + 1)
}
export function placeAmong(id: string, at: string, index: number) {
  if (!canPlaceAmong(id, at, index)) return
  const into = paneTab(at)!, from = paneTab(id)!, p = paneById(id)!, pane = paneWith(into.root, at)!
  const i = placesOf(pane).findIndex((x) => x.id === id)
  if (i >= 0) return set(withTab(into.id, (t) => withPlace(t, at, p, { show: pane.id === id, index: index > i ? index - 1 : index })))
  const add = (t: Tab) => ({ ...withPlace(t, at, p, { index }), focus: id })
  if (from.id === into.id) set(withTab(into.id, (t) => add(tabWithout(t, new Set([id]))!), { active: into.id }))
  else {
    const left = tabWithout(from, new Set([id]))
    const base = left ? mapTab(here(), from.id, () => left) : withoutTabs(here(), new Set([from.id])) ?? here()
    set({ ...mapTab(base, into.id, add), active: into.id })
  }
  showActiveUnder()
}
export function splitOut(id: string, side: Side) {
  const t = paneTab(id), own = t && paneWith(t.root, id), p = paneById(id)
  const other = own && placesOf(own).find((x) => x.id !== id)
  if (!t || !p || !other) return
  const { float: _, ...moved } = bare(p)
  set(withTab(t.id, (x) => { const left = tabWithout(x, new Set([id]))!; return { ...left, root: beside(left.root, paneWith(left.root, other.id)!.id, moved, side), focus: id } }, { active: t.id }))
  showActiveUnder()
}
export function openAmong(to: string, at: string, index: number) {
  const t = paneTab(at)
  if (!t || !isSplit(t.root)) return
  const p: Pane = { id: newPaneId(), to }
  set(withTab(t.id, (x) => ({ ...withPlace(x, at, p, { index }), focus: p.id }), { active: t.id }))
  show(to, true)
}

export function paneToTab(id: string, at?: number, group?: string | null) {
  const t = paneTab(id), p = paneById(id)
  if (!t || !p || panesOf(t).length < 2) return
  const l = mapTab(here(), t.id, (x) => tabWithout(x, new Set([id]))!)
  const own = tabWith(p)
  set({ ...putAt(l, own, at ?? l.tabs.findIndex((x) => x.id === t.id) + 1, group === undefined ? t.group ?? null : group), active: own.id })
  showActiveUnder()
}
export const canPaneToTab = (id: string) => { const t = paneTab(id); return !!t && panesOf(t).length > 1 }

export function canOpenAt(to: string, pane: string, zone: Zone) {
  const p = paneById(pane)
  return !!p && paneTab(pane)?.id === here().active && (zone !== "center" || p.to !== to)
}
export function openAt(to: string, pane: string, zone: Zone) {
  if (!canOpenAt(to, pane, zone)) return
  const t = paneTab(pane)!
  if (zone === "center" && isSplit(t.root) && !isBlank(paneById(pane))) { const p: Pane = { id: newPaneId(), to }; set(withTab(t.id, (x) => ({ ...withPlace(x, pane, p), focus: p.id }))) }
  else if (zone === "center") set(withTab(t.id, (x) => ({ ...x, root: mapPanes(x.root, (p) => (p.id === pane ? moveOn(p, to) : p)), focus: pane })))
  else { const p: Pane = { id: newPaneId(), to }; set(withTab(t.id, (x) => ({ ...x, root: beside(x.root, pane, p, zone), focus: p.id }))) }
  show(to, true)
}
export function openAllAt(tos: string[], pane: string, zone: Zone) {
  if (!tos.length) return
  openAt(tos[0], pane, zone)
  openAllAtIndex(tos.slice(1), here().tabs.findIndex((t) => t.id === here().active) + 1, undefined, false)
}
export const tabShowing = (l: TabList, to: string) => l.tabs.find((t) => !("kids" in t.root) && t.root.to === to)
export function canOpenAtIndex(to: string, at: number, group?: string | null) {
  const has = tabShowing(here(), to)
  return has ? canPlaceTab(has.id, at, group) : true
}
export const openAtIndex = (to: string, at: number, group?: string | null) => openAllAtIndex([to], at, group)
export function openAllAtIndex(tos: string[], at: number, group?: string | null, shown = true) {
  let l = here(), i = at, last = ""
  for (const to of tos) {
    const has = tabShowing(l, to)
    if (has) {
      const { tab, at: j, rest } = pulled(l, has.id)
      l = putAt(rest, tab, i > j ? i - 1 : i, group, tab.group)
      i = l.tabs.findIndex((t) => t.id === has.id) + 1
      last = has.id
      continue
    }
    const t = tabOf(to)
    l = putAt(l, t, i, group)
    i++
    last = t.id
  }
  if (!last) return
  const cur = l.tabs.find((t) => t.id === l.active)
  if (shown && cur && isBlankTab(cur) && cur.id !== last) l = withoutTabs(l, new Set([cur.id])) ?? l
  set(shown ? { ...l, active: last } : l)
  if (shown) showActive()
}

export function takeTabs(tabs: Tab[], active: string, place?: { index: number; group?: string | null } | { pane: string; zone: Zone }) {
  if (!tabs.length) return
  const taken = new Set(here().tabs.flatMap((t) => [t.id, ...placesIn(t).map((p) => p.id)]))
  const took = tabs.map((t) => (taken.has(t.id) || placesIn(t).some((p) => taken.has(p.id)) ? fresh(t) : t))
  const i = tabs.findIndex((t) => t.id === active), shown = took[i < 0 ? took.length - 1 : i]
  const l = here(), at = place && "index" in place ? place.index : l.tabs.findIndex((t) => t.id === l.active) + 1
  const group = place && "index" in place ? place.group ?? undefined : undefined
  set({ ...l, tabs: [...l.tabs.slice(0, at), ...took.map((t) => inGroup(t, group)), ...l.tabs.slice(at)], active: shown.id })
  if (place && "pane" in place) tabIntoPane(shown.id, place.pane, place.zone)
  showActive()
}
function fresh(t: Tab): Tab {
  const ids = new Map(placesIn(t).map((p) => [p.id, newPaneId()]))
  return { ...t, id: `t${newPaneId().slice(1)}`, root: mapPlaces(t.root, (p) => ({ ...p, id: ids.get(p.id)! })), focus: ids.get(t.focus) ?? [...ids.values()][0], zoom: undefined }
}

export function keepShown(id: string) {
  if (here().active !== id && tabById(id)) set({ ...here(), active: id })
}
export function placeTabBy(id: string, where: "before" | "after", ref: string, group: string | null) {
  if (id === ref || !tabById(id) || !tabById(ref)) return
  const { tab, rest } = pulled(here(), id)
  const at = rest.tabs.findIndex((t) => t.id === ref) + (where === "after" ? 1 : 0)
  set(putAt(rest, tab, at, group))
}

export function addPane(id: string): string | null {
  const t = tabById(id)
  if (!t) return null
  const p: Pane = { id: newPaneId(), to: "new" }
  set(withTab(t.id, (x) => ({ ...x, root: beside(x.root, panesOf(x).at(-1)!.id, p, "right"), focus: p.id, zoom: undefined })))
  return p.id
}

export function splitPane(side: Side, id = activePane().id) {
  const t = paneTab(id), p = paneById(id)
  if (!t || !p) return
  dockFirst(id)
  const { float: _, from: _f, ...rest } = bare(p)
  const copy: Pane = p.to.startsWith("view:") ? { id: newPaneId(), to: "new" } : { ...rest, id: newPaneId() }
  const typing = document.activeElement?.closest("[data-pane]")
  set(withTab(t.id, (x) => ({ ...x, root: beside(x.root, id, copy, side), focus: copy.id }), { active: t.id }))
  show(copy.to, true)
  if (typing) keysTo(copy.id)
}
function keysTo(id: string, tries = 30) {
  requestAnimationFrame(() => {
    if (activePane().id !== id || focusPane(id)) return
    if (tries > 0) return keysTo(id, tries - 1)
    const a = document.activeElement
    if (a instanceof HTMLElement && a.closest("[data-pane]")) a.blur()
  })
}

/** `to` in a pane beside the focused one (right or below, made if none, or beside one keeping its view); `focusIt` false:
 *  the focus stays. `paneId`: the new pane's id (a web page coming back to its pane). Returns the pane's id. */
export function openInSplit(to: string, side: "right" | "bottom" = "right", focusIt = true, paneId?: string): string {
  const t = activeTab(), focus = t.focus
  const at = isFloating(focus) ? under(focus) : focus
  const right = neighbourOf(t.root, at, side)
  const reuse = right && !paneId && (isBlank(right) || !keepsTab(right.to)) ? right : null
  const id = reuse?.id ?? paneId ?? newPaneId()
  const root = reuse ? mapPanes(t.root, (p) => (p.id === id ? (isBlank(p) ? { ...p, to } : moveOn(p, to)) : p)) : beside(t.root, right?.id ?? at, { id, to }, side)
  set(withTab(t.id, (x) => ({ ...x, root, focus: focusIt ? id : focus })))
  if (focusIt) show(to, true)
  return id
}

const neighbour = (side: Side) => { const t = activeTab(); return neighbourOf(t.root, t.focus, side) }
export const hasNeighbour = (side: Side) => !!neighbour(side)
export function focusSide(side: Side) {
  const p = neighbour(side)
  if (p) focusOn(p.id)
}
const focusOn = (id: string) => { setFocusedPane(id); focusPane(id) }
export function focusByOrder(by: 1 | -1) {
  const ps = panes(), i = ps.findIndex((p) => p.id === activePane().id)
  if (ps.length > 1) focusOn(ps[(i + by + ps.length) % ps.length].id)
}
let lastFocus = "", nowFocus = activePane()?.id ?? ""
onWorkspaceChange(() => { const f = activePane()?.id ?? ""; if (f !== nowFocus) { lastFocus = nowFocus; nowFocus = f } })
export const hasLastPane = () => lastFocus !== activePane().id && panes().some((p) => p.id === lastFocus)
export function focusLastPane() { if (hasLastPane()) focusOn(lastFocus) }

export function movePane(side: Side) {
  const p = neighbour(side), t = activeTab()
  if (p) set(withTab(t.id, (x) => ({ ...x, root: swapped(x.root, x.focus, p.id) })))
}
const box = () => document.querySelector("[data-pane-area]")?.getBoundingClientRect()
export function nudgePane(side: Side) {
  const t = activeTab(), b = box(), across = side === "left" || side === "right" ? b?.width : b?.height
  if (!across) return
  set(withTab(t.id, (x) => ({ ...x, root: nudged(x.root, x.focus, side, 48 / across, (side === "left" || side === "right" ? 200 : 120) / across) })))
}
export const canNudge = (side: Side) => { const t = activeTab(); return nudged(t.root, t.focus, side, 0, 0) !== t.root }
export function splitToFit() {
  const r = document.querySelector(`[data-pane-frame="${CSS.escape(activePane().id)}"]`)?.getBoundingClientRect()
  splitPane(r && r.height > r.width ? "bottom" : "right")
}

export function resize(splitId: string, i: number, at: number, min: number) {
  set(withTab(activeTab().id, (x) => ({ ...x, root: resized(x.root, splitId, i, at, min) })))
}
export function evenOut(splitId: string) {
  set(withTab(activeTab().id, (x) => ({ ...x, root: evened(x.root, splitId) })))
}
export function evenOutAll() {
  set(withTab(activeTab().id, (x) => ({ ...x, root: evenedAll(x.root) })))
}
export const severalPanes = () => panes().length > 1

const tiles = () => layout(activeTab().root).panes
export const isZoomed = () => !!activeTab().zoom
export const canZoom = (id = activePane().id) => isZoomed() || (tiles().length > 1 && tiles().some((p) => p.pane.id === id))
export function zoomPane(id = activePane().id) {
  if (!canZoom(id)) return
  set(withTab(activeTab().id, (x) => ({ ...x, focus: id, zoom: x.zoom === id ? undefined : id })))
}

export const isFloating = (id = activePane().id) => !!paneById(id)?.float
export const canFloat = (id = activePane().id) => tiles().length > 1 && tiles().some((p) => p.pane.id === id)
function under(id: string) {
  const f = paneById(id)?.float, t = tiles()
  const inside = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
  return (f && t.find((p) => inside(p.rect, f.x + f.w / 2, f.y + f.h / 2)) || t[0])?.pane.id ?? id
}
export function floatPane(id = activePane().id, rect?: Rect) {
  const tile = tiles().find((p) => p.pane.id === id)?.rect
  if (!tile || !canFloat(id)) return
  set(withTab(activeTab().id, (x) => ({ ...x, root: floated(x.root, id, rect ?? cardOver(tile)), focus: id })))
  lifted.set(id, paneById(id)!.float!)
}
const lifted = new Map<string, Rect>()
function cardOver(t: Rect): Rect {
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
  const w = clamp(t.w * 0.7, 0.32, 0.5), h = clamp(t.h * 0.7, 0.45, 0.7)
  let x = 1 - w - 0.04, y = (1 - h) / 2
  const others = panes().flatMap((p) => (p.float ? [p.float] : []))
  for (let i = 0; i < 12 && others.some((o) => Math.abs(o.x - x) < 0.02 && Math.abs(o.y - y) < 0.02); i++) {
    x = x + 0.03 > 1 - w ? 0 : x + 0.03; y = y + 0.03 > 1 - h ? 0 : y + 0.03
  }
  return { x, y, w, h }
}
export function dockPane(id = activePane().id) {
  const t = activeTab(), f = paneById(id)?.float
  if (!f) return
  const home = layout(floated(t.root, id, null)).panes.find((p) => p.pane.id === id)?.rect
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2
  const over = (r: Rect) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h
  const at = tiles().find((p) => over(p.rect))
  const was = lifted.get(id)
  lifted.delete(id)
  if (!at || (home && over(home)) || (was && JSON.stringify(was) === JSON.stringify(f))) return set(withTab(t.id, (x) => ({ ...x, root: floated(x.root, id, null), focus: id })))
  const r = at.rect, fx = (cx - r.x) / r.w, fy = (cy - r.y) / r.h
  const [side] = ([["left", fx], ["right", 1 - fx], ["top", fy], ["bottom", 1 - fy]] as [Side, number][]).sort((a, b) => a[1] - b[1])[0]
  paneIntoPane(id, at.pane.id, side)
}
export const toggleFloat = () => (isFloating() ? dockPane() : floatPane())
export function placeFloat(id: string, rect: Rect) {
  const t = paneTab(id)
  if (t && isFloating(id)) quietly(() => set(withTab(t.id, (x) => ({ ...x, root: floated(x.root, id, rect) }))))
}
function dockFirst(id: string) { if (isFloating(id)) dockPane(id) }
