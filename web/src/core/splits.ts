// Splits: moving tabs and panes between groups and into new splits, opening at a place, focus and
// dividers. The tree itself is core/layout.ts.
import { beside, evened, evenedAll, floated, inSet, layout, mapGroups, mapTabs, moveOn, neighbourOf, newId, nudged, pastBlank, resized, setAt, shownTab, swapped, tidy, type Group, type Layout, type Rect, type Side, type Tab, withoutTabs } from "../../../core/layout.ts"
import { focusPane } from "@/core/focus"
import { activeTab, focusGroup, getWorkspace, groupOfTab, groups, onWorkspaceChange, quietly, set, show, showActive, withGroup } from "@/core/workspace"

/** The tree without tab `id` (its group may be left empty: `set` tidies it away). */
function pull(id: string): { root: Layout; tab: Tab } | null {
  const g = groupOfTab(id)
  if (!g) return null
  const tab = g.tabs.find((t) => t.id === id)!
  return { tab, root: mapGroups(getWorkspace().root, (x) => (x.id === g.id ? withoutTabs(x, new Set([id])) : x)) }
}

/** Would moving tab `id` there change anything? Into its own bar at its own place (in the same tab group), its own
 *  group's middle, or beside its own group as its only tab: no (drops like these aren't offered). */
export function canMove(id: string, gid: string, where: Side | "center" | number, tabset?: string | null) {
  const g = groupOfTab(id)
  if (!g || !groups().some((x) => x.id === gid)) return false
  if (g.id !== gid) return true
  if (where === "center") return false
  if (typeof where === "number") {
    const i = g.tabs.findIndex((t) => t.id === id)
    if (where !== i && where !== i + 1) return true
    return tabset !== undefined && (tabset ?? undefined) !== g.tabs[i].set
  }
  return g.tabs.length > 1
}

/** Move a tab into group `gid`'s bar before its `index`th tab (into tab group `tabset`: null none, left out setAt's), its
 *  pane, or a new split beside it: that group's active tab (a blank one shown there goes), the group focused. */
export function moveTabTo(id: string, gid: string, where: Side | "center" | number, tabset?: string | null) {
  if (!canMove(id, gid, where, tabset)) return
  const from = groupOfTab(id)!, p = pull(id)!
  if (typeof where === "number" || where === "center") {
    let at = typeof where === "number" ? where : Infinity
    if (from.id === gid && at > from.tabs.findIndex((t) => t.id === id)) at--
    const into = (g: Group): Group => {
      const s = tabset === undefined ? setAt(g.tabs, Math.min(at, g.tabs.length), from.id === gid ? p.tab.set : undefined) : tabset ?? undefined
      // Into a folded tab group it's put away there: the tab on screen stays (unless it's this one, which opens it).
      const away = !!s && !!g.sets?.find((x) => x.id === s)?.collapsed && !(from.id === gid && from.active === id)
      return { ...g, tabs: [...g.tabs.slice(0, at), inSet(p.tab, s), ...g.tabs.slice(at)], active: away ? g.active : id }
    }
    set({ root: mapGroups(p.root, (g) => (g.id !== gid ? g : from.id === gid ? into(g) : pastBlank(g, into(g)))), focus: gid })
  } else {
    const g: Group = { id: `g${newId()}`, tabs: [p.tab], active: id }
    set({ root: beside(p.root, gid, g, where), focus: g.id })
  }
  showActive()
}

/** The tab on screen one place left (-1) or right (1) along its bar, as a drag there would (into a tab group it comes
 *  to, out of one at its end): the keyboard's way. False at the bar's end. */
export function moveTabBy(dir: 1 | -1) {
  const t = activeTab(), g = groupOfTab(t.id)
  const i = g ? g.tabs.findIndex((x) => x.id === t.id) : -1
  if (!g || i + dir < 0 || i + dir >= g.tabs.length) return false
  moveTabTo(t.id, g.id, dir > 0 ? i + 2 : i - 1)
  return true
}

/** Would moving the whole pane `gid` there change anything? Anywhere on or in itself: no. */
export function canMoveGroup(gid: string, target: string, _where: Side | "center" | number) {
  return gid !== target && groups().some((g) => g.id === gid) && groups().some((g) => g.id === target)
}

/** Move a whole pane: into another's bar or middle (its tabs
 *  join that one and it closes), or beside it on one side (the pane itself moves, same id, so nothing remounts). */
export function moveGroupTo(gid: string, target: string, where: Side | "center" | number) {
  if (!canMoveGroup(gid, target, where)) return
  const g = groups().find((x) => x.id === gid)!
  const root = mapGroups(getWorkspace().root, (x) => (x.id === gid ? { ...x, tabs: [] } : x))
  if (typeof where === "number" || where === "center") {
    const at = typeof where === "number" ? where : Infinity
    // (its tab groups come along)
    const sets = (x: Group) => (g.sets ? { sets: [...(x.sets ?? []), ...g.sets] } : {})
    set({ root: mapGroups(root, (x) => (x.id !== target ? x : pastBlank(x, { ...x, tabs: [...x.tabs.slice(0, at), ...g.tabs, ...x.tabs.slice(at)], active: g.active, ...sets(x) }))), focus: target })
  } else {
    // The emptied original is tidied away by set; the moved one keeps its id (a floating one docks there).
    const { float: _, ...moved } = g
    set({ root: beside(tidy(root) ?? root, target, moved, where), focus: g.id })
  }
  showActive()
}

/** Would opening `to` there (a file dragged from the sidebar) change anything? Into the middle of a pane already
 *  showing it: no; into a bar that has it already: only if that tab would move. */
export function canOpenAt(to: string, gid: string, where: Side | "center" | number) {
  const g = groups().find((x) => x.id === gid)
  if (!g) return false
  const has = typeof where === "number" ? g.tabs.find((t) => t.to === to) : null
  if (has) return canMove(has.id, gid, where)
  return where !== "center" || shownTab(g)?.to !== to
}

/** Open `to` at a place, like a tab dropped there (in a bar, in tab group `tabset`). A bar never gets the same place
 *  twice: the tab that has it moves instead. A blank tab the pane showed doesn't stay behind; the group gets the focus. */
export function openAt(to: string, gid: string, where: Side | "center" | number, tabset?: string | null) {
  if (!canOpenAt(to, gid, where)) return
  const has = typeof where === "number" ? groups().find((x) => x.id === gid)?.tabs.find((t) => t.to === to) : null
  if (has) return moveTabTo(has.id, gid, where, tabset)
  if (typeof where === "number" || where === "center") {
    set(withGroup(gid, (g) => {
      const has = where === "center" ? g.tabs.find((t) => t.to === to) : null
      if (has) return pastBlank(g, { ...g, active: has.id })
      const cur = shownTab(g)
      if (where === "center" && cur?.to === "new") return mapTabs(g, cur.id, (t) => moveOn(t, to))
      const id = newId(), at = typeof where === "number" ? where : g.tabs.findIndex((t) => t.id === g.active) + 1
      const tab: Tab = typeof where === "number" && tabset ? { id, to, set: tabset } : { id, to }
      return pastBlank(g, { ...g, tabs: [...g.tabs.slice(0, at), tab, ...g.tabs.slice(at)], active: id })
    }, { focus: gid }))
  } else {
    const id = newId(), g: Group = { id: `g${newId()}`, tabs: [{ id, to }], active: id }
    set({ root: beside(getWorkspace().root, gid, g, where), focus: g.id })
  }
  show(to, true)
}

/** Several tabs selected together, moved as one (dragged by `held`, shown after) in their order: into a bar (as
 *  moveTabTo), a pane's middle, or a new split beside it (the first makes it, the rest join). */
export function moveTabsTo(ids: string[], held: string, gid: string, where: Side | "center" | number, tabset?: string | null) {
  const order = groups().flatMap((g) => g.tabs.map((t) => t.id)).filter((id) => ids.includes(id))
  if (!order.length) return
  if (typeof where === "number") {
    let at = where
    for (const id of order) {
      moveTabTo(id, gid, at, tabset)
      const g = groups().find((x) => x.id === gid)
      const i = g?.tabs.findIndex((t) => t.id === id) ?? -1
      if (i >= 0) at = i + 1
    }
  } else if (where === "center") for (const id of order) moveTabTo(id, gid, "center")
  else {
    moveTabTo(order[0], gid, where)
    const into = groupOfTab(order[0])
    if (into && into.id !== gid) for (const id of order.slice(1)) moveTabTo(id, into.id, "center")
  }
  const g = groupOfTab(held)
  if (g && !(tabset && g.sets?.find((x) => x.id === tabset)?.collapsed)) set(withGroup(g.id, (x) => ({ ...x, active: held }), { focus: g.id }))
  showActive()
}

/** Several things opened at one place, in order (files selected together, dropped): a bar from its `where`th tab on,
 *  a pane's middle, or a new split beside it (the first makes it, the rest open in it). */
export function openAllAt(tos: string[], gid: string, where: Side | "center" | number) {
  if (!tos.length) return
  if (typeof where === "number") { tos.forEach((to, i) => openAt(to, gid, where + i)); return }
  openAt(tos[0], gid, where)
  const into = where === "center" ? gid : getWorkspace().focus
  for (const to of tos.slice(1)) openAt(to, into, "center")
}

/** Tabs from another window (a pop-out's, moved back: core/windows.ts), as they were (ids and history): into pane
 *  `gid`'s bar before its `where`th tab, its middle (after its active tab), or a new split beside it. `active` is shown. */
export function takeTabs(tabs: Tab[], active: string, gid = getWorkspace().focus, where: Side | "center" | number = "center") {
  if (!tabs.length || !groups().some((g) => g.id === gid)) return
  // A tab opened in a new window (not moved) is still here under the same id: the one coming back gets a new one.
  const here = new Set(groups().flatMap((g) => g.tabs.map((t) => t.id)))
  const took = tabs.map((t) => (here.has(t.id) ? { ...t, id: newId() } : t))
  const i = tabs.findIndex((t) => t.id === active), shown = took[i < 0 ? took.length - 1 : i].id
  if (typeof where === "number" || where === "center") {
    set(withGroup(gid, (g) => {
      const at = typeof where === "number" ? where : g.tabs.findIndex((t) => t.id === g.active) + 1
      return pastBlank(g, { ...g, tabs: [...g.tabs.slice(0, at), ...took, ...g.tabs.slice(at)], active: shown })
    }, { focus: gid }))
  } else {
    const g: Group = { id: `g${newId()}`, tabs: took, active: shown }
    set({ root: beside(getWorkspace().root, gid, g, where), focus: g.id })
  }
  showActive()
}

// ---------- a phone's tab list (components/TabSwitcher.tsx: every pane's tabs in one list) ----------

/** After tabs moved between panes, the tab on screen `id` still is: its pane focused, showing it. */
export function keepShown(id: string) {
  const g = groupOfTab(id)
  if (g && (g.id !== getWorkspace().focus || g.active !== id)) set(withGroup(g.id, (x) => ({ ...x, active: id }), { focus: g.id }))
}

/** Tab `id` moved to just before or after tab `ref` (into its pane if another), in tab group `tabset` (null: none);
 *  the tab on screen stays. */
export function placeTab(id: string, where: "before" | "after", ref: string, tabset: string | null) {
  const shown = activeTab().id, into = groupOfTab(ref)
  if (!into || id === ref || !groupOfTab(id)) return
  const p = pull(id)!
  set({ ...getWorkspace(), root: mapGroups(p.root, (x) => {
    if (x.id !== into.id) return x
    const at = x.tabs.findIndex((t) => t.id === ref) + (where === "after" ? 1 : 0)
    return { ...x, tabs: [...x.tabs.slice(0, at), inSet(p.tab, tabset ?? undefined), ...x.tabs.slice(at)] }
  }) })
  keepShown(shown)
}

/** Move a tab (the active one by default) into a new split beside its group. */
export function moveToSplit(side: Side, id = activeTab().id) {
  const g = groupOfTab(id)
  if (g) { dockFirst(g.id); moveTabTo(id, g.id, side) }
}

/** Split a pane (Split right / Split down): the tab (the active one by default) opens again in a new
 *  group beside its own, with its history. A plugin's view (a terminal) isn't doubled: the new group gets a blank tab. */
export function splitTab(side: Side, id = activeTab().id) {
  const from = groupOfTab(id)
  if (!from) return
  dockFirst(from.id)
  const t = from.tabs.find((x) => x.id === id)!
  const tab: Tab = t.to.startsWith("view:") ? { id: newId(), to: "new" } : { ...t, id: newId() }
  const g: Group = { id: `g${newId()}`, tabs: [tab], active: tab.id }
  const typing = document.activeElement?.closest("[data-pane]")
  set({ root: beside(getWorkspace().root, from.id, g, side), focus: g.id })
  show(tab.to, true)
  if (typing) keysTo(g.id)
}
/** The keyboard into pane `gid` once its editor or terminal is drawn, as long as it has the focus; one with neither
 *  leaves it nowhere, rather than typing into the pane left behind. */
function keysTo(gid: string, tries = 30) {
  requestAnimationFrame(() => {
    if (getWorkspace().focus !== gid || focusPane(gid)) return
    if (tries > 0) return keysTo(gid, tries - 1)
    const a = document.activeElement
    if (a instanceof HTMLElement && a.closest("[data-pane]")) a.blur()
  })
}

/** `to` in a pane beside the focused one (right or below, made if none); `focus` false: the focus stays where it is.
 *  `tabId`: the new tab's id (a desktop web page whose tab is gone comes back to the tab of that id). Returns its id. */
export function openInSplit(to: string, side: "right" | "bottom" = "right", focusIt = true, tabId?: string): string {
  const { root, focus } = getWorkspace()
  // (from a floating pane: beside the tiled one under it)
  const at = isFloating(focus) ? under(focus) : focus
  const right = neighbourOf(root, at, side)
  if (!right) {
    const id = tabId ?? newId(), g: Group = { id: `g${newId()}`, tabs: [{ id, to }], active: id }
    set({ root: beside(root, at, g, side), focus: focusIt ? g.id : focus })
    if (focusIt) show(to, true)
    return id
  }
  const blankTab = tabId ? undefined : right.tabs.find((t) => t.id === right.active && t.to === "new")
  const id = blankTab?.id ?? tabId ?? newId()
  const tabs = blankTab ? right.tabs.map((t) => (t.id === id ? { ...t, to } : t)) : [...right.tabs, { id, to }]
  set(withGroup(right.id, (x) => ({ ...x, tabs, active: id }), { focus: focusIt ? right.id : focus }))
  if (focusIt) show(to, true)
  return id
}

const neighbour = (side: Side) => { const { root, focus } = getWorkspace(); return neighbourOf(root, focus, side) }
export const hasNeighbour = (side: Side) => !!neighbour(side)
/** Move the focus to the group on that side (the keyboard way between panes). */
export function focusSide(side: Side) {
  const g = neighbour(side)
  if (g) focusOn(g.id)
}
// The keyboard goes there too: its editor or terminal.
const focusOn = (gid: string) => { focusGroup(gid); focusPane(gid) }
/** Focus the next pane (-1: the one before), left to right and top to bottom, round from the last to the first. */
export function focusByOrder(by: 1 | -1) {
  const gs = groups(), i = gs.findIndex((g) => g.id === getWorkspace().focus)
  if (gs.length > 1) focusOn(gs[(i + by + gs.length) % gs.length].id)
}
// The pane focused before this one, for Focus last pane (tmux's last-pane).
let lastFocus = "", nowFocus = getWorkspace().focus
onWorkspaceChange(() => { const f = getWorkspace().focus; if (f !== nowFocus) { lastFocus = nowFocus; nowFocus = f } })
export const hasLastPane = () => lastFocus !== getWorkspace().focus && groups().some((g) => g.id === lastFocus)
export function focusLastPane() { if (hasLastPane()) focusOn(lastFocus) }

/** Swap the focused pane with the one on that side (it keeps the focus). */
export function movePane(side: Side) {
  const g = neighbour(side), w = getWorkspace()
  if (g) set({ ...w, root: swapped(w.root, w.focus, g.id) })
}
/** The workspace's box on screen (Workspace.tsx), to turn pixels into shares of it. */
const box = () => document.querySelector("section[data-group]")?.parentElement?.getBoundingClientRect()
/** Move the focused pane's divider on that side (else the other) that way by a step, as a drag would. */
export function nudgePane(side: Side) {
  const w = getWorkspace(), b = box(), across = side === "left" || side === "right" ? b?.width : b?.height
  if (!across) return
  // (the dividers' own least sizes: Workspace.tsx)
  set({ ...w, root: nudged(w.root, w.focus, side, 48 / across, (side === "left" || side === "right" ? 200 : 120) / across) })
}
export const canNudge = (side: Side) => { const w = getWorkspace(); return nudged(w.root, w.focus, side, 0, 0) !== w.root }
/** Split the focused pane across its longer side: right when it's wider than tall, else down. */
export function splitToFit() {
  const r = document.querySelector(`section[data-group="${CSS.escape(getWorkspace().focus)}"]`)?.getBoundingClientRect()
  splitTab(r && r.height > r.width ? "bottom" : "right")
}
/** The tab's group has others (so it can move into a split of its own). */
export const hasSiblings = (id: string) => (groupOfTab(id)?.tabs.length ?? 0) > 1

/** Drag a divider: part `i` of the split ends at `at` (a share of the split), each part at least `min` wide. */
export function resize(splitId: string, i: number, at: number, min: number) {
  const w = getWorkspace()
  set({ ...w, root: resized(w.root, splitId, i, at, min) })
}
/** Double-click a divider: that split's parts back to equal. */
export function evenOut(splitId: string) {
  const w = getWorkspace()
  set({ ...w, root: evened(w.root, splitId) })
}

// ---------- zoom and floating panes (Workspace.zoom, Group.float) ----------

const tiles = () => layout(getWorkspace().root).panes
export const isZoomed = () => !!getWorkspace().zoom
/** Whether pane `gid` (the focused one) can fill the workspace for now: it's tiled, beside others. */
export const canZoom = (gid = getWorkspace().focus) => isZoomed() || (tiles().length > 1 && tiles().some((p) => p.group.id === gid))
/** Pane `gid` fills the workspace, the others left under it; again (or another pane focused), it's back in its place. */
export function zoomPane(gid = getWorkspace().focus) {
  const w = getWorkspace()
  if (!canZoom(gid)) return
  set({ ...w, focus: gid, zoom: w.zoom === gid ? undefined : gid })
}

export const isFloating = (gid = getWorkspace().focus) => !!groups().find((g) => g.id === gid)?.float
/** Whether pane `gid` can float: it's tiled, and others stay tiled. */
export const canFloat = (gid = getWorkspace().focus) => tiles().length > 1 && tiles().some((p) => p.group.id === gid)
/** The tiled pane under floating pane `gid`'s middle (the first if none). */
function under(gid: string) {
  const f = groups().find((g) => g.id === gid)?.float, t = tiles()
  const inside = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
  return (f && t.find((p) => inside(p.rect, f.x + f.w / 2, f.y + f.h / 2)) || t[0])?.group.id ?? gid
}
/** Lift pane `gid` out of the tiling into a card over the workspace, at `rect` (by default a smaller one, centred on
 *  the right as Rex's, clear of other floating panes); the others close the gap. */
export function floatPane(gid = getWorkspace().focus, rect?: Rect) {
  const w = getWorkspace(), tile = tiles().find((p) => p.group.id === gid)?.rect
  if (!tile || !canFloat(gid)) return
  set({ ...w, root: floated(w.root, gid, rect ?? cardOver(tile)), focus: gid })
  lifted.set(gid, groups().find((g) => g.id === gid)!.float!)
}
/** Where each pane was floated to here: one docked from there, unmoved, goes back where it came from. */
const lifted = new Map<string, Rect>()
function cardOver(t: Rect): Rect {
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
  const w = clamp(t.w * 0.7, 0.32, 0.5), h = clamp(t.h * 0.7, 0.45, 0.7)
  let x = 1 - w - 0.04, y = (1 - h) / 2
  const others = groups().flatMap((g) => (g.float ? [g.float] : []))
  for (let i = 0; i < 12 && others.some((o) => Math.abs(o.x - x) < 0.02 && Math.abs(o.y - y) < 0.02); i++) {
    x = x + 0.03 > 1 - w ? 0 : x + 0.03; y = y + 0.03 > 1 - h ? 0 : y + 0.03
  }
  return { x, y, w, h }
}
/** Put floating pane `gid` back into the tiling: unmoved, where it came from; else nearest where it sits, as Rex does (its
 *  own spot while over it, else the half of the tiled pane under its middle on the side that's nearest). */
export function dockPane(gid = getWorkspace().focus) {
  const w = getWorkspace(), f = groups().find((g) => g.id === gid)?.float
  if (!f) return
  const home = layout(floated(w.root, gid, null)).panes.find((p) => p.group.id === gid)?.rect
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2
  const over = (r: Rect) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h
  const at = tiles().find((p) => over(p.rect))
  const was = lifted.get(gid)
  lifted.delete(gid)
  if (!at || (home && over(home)) || (was && JSON.stringify(was) === JSON.stringify(f))) return set({ ...w, root: floated(w.root, gid, null), focus: gid })
  const r = at.rect, fx = (cx - r.x) / r.w, fy = (cy - r.y) / r.h
  const [side] = ([["left", fx], ["right", 1 - fx], ["top", fy], ["bottom", 1 - fy]] as [Side, number][]).sort((a, b) => a[1] - b[1])[0]
  moveGroupTo(gid, at.group.id, side)
}
/** Float the focused pane, or dock it if it floats (one key, as Rex's). */
export const toggleFloat = () => (isFloating() ? dockPane() : floatPane())
/** A floating pane moved or resized by hand: there at once. */
export function placeFloat(gid: string, rect: Rect) {
  const w = getWorkspace()
  if (isFloating(gid)) quietly(() => set({ ...w, root: floated(w.root, gid, rect) }))
}
/** Before splitting a floating pane: it docks, so the split is in the tiling. */
function dockFirst(gid: string) { if (isFloating(gid)) dockPane(gid) }

/** Every split's parts back to equal (Even out panes). */
export function evenOutAll() {
  const w = getWorkspace()
  set({ ...w, root: evenedAll(w.root) })
}
export const severalPanes = () => groups().length > 1
