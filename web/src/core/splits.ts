// Splits: moving tabs and panes between groups and into new splits, opening at a place, focus and
// dividers. The tree itself is core/layout.ts.
import { beside, evened, leaves, mapGroups, mapTabs, moveOn, neighbourOf, newId, nextActive, pastBlank, resized, shownTab, tidy, type Group, type Layout, type Side, type Tab } from "@/core/layout"
import { focusPane } from "@/core/focus"
import { activeTab, focusGroup, getWorkspace, groupOfTab, groups, set, show, showActive, withGroup } from "@/core/workspace"

/** The tree without tab `id` (its group may be left empty: `set` tidies it away). */
function pull(id: string): { root: Layout; tab: Tab } | null {
  const g = groupOfTab(id)
  if (!g) return null
  const tab = g.tabs.find((t) => t.id === id)!
  const rest = g.tabs.filter((t) => t.id !== id)
  return { tab, root: mapGroups(getWorkspace().root, (x) => (x.id === g.id ? { ...x, tabs: rest, active: nextActive(x, id, rest) } : x)) }
}

/** Would moving tab `id` there change anything? Into its own group's bar at its own place, into the middle of its own
 *  group, or beside its own group when it's the group's only tab: no (drops like these aren't offered). */
export function canMove(id: string, gid: string, where: Side | "center" | number) {
  const g = groupOfTab(id)
  if (!g || !groups().some((x) => x.id === gid)) return false
  if (g.id !== gid) return true
  if (where === "center") return false
  if (typeof where === "number") { const i = g.tabs.findIndex((t) => t.id === id); return where !== i && where !== i + 1 }
  return g.tabs.length > 1
}

/** Move a tab into group `gid`'s bar before its `index`th tab, into its pane, or into a new split beside it. It becomes
 *  that group's active tab (replacing a blank one shown there) and the group gets the focus. */
export function moveTabTo(id: string, gid: string, where: Side | "center" | number) {
  if (!canMove(id, gid, where)) return
  const from = groupOfTab(id)!, p = pull(id)!
  if (typeof where === "number" || where === "center") {
    let at = typeof where === "number" ? where : Infinity
    if (from.id === gid && at > from.tabs.findIndex((t) => t.id === id)) at--
    const into = (g: Group): Group => ({ ...g, tabs: [...g.tabs.slice(0, at), p.tab, ...g.tabs.slice(at)], active: id })
    set({ root: mapGroups(p.root, (g) => (g.id !== gid ? g : from.id === gid ? into(g) : pastBlank(g, into(g)))), focus: gid })
  } else {
    const g: Group = { id: `g${newId()}`, tabs: [p.tab], active: id }
    set({ root: beside(p.root, gid, g, where), focus: g.id })
  }
  showActive()
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
    set({ root: mapGroups(root, (x) => (x.id !== target ? x : pastBlank(x, { ...x, tabs: [...x.tabs.slice(0, at), ...g.tabs, ...x.tabs.slice(at)], active: g.active }))), focus: target })
  } else {
    // The emptied original is tidied away by set; the moved one keeps its id.
    set({ root: beside(tidy(root) ?? root, target, g, where), focus: g.id })
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

/** Open `to` at a place, like a tab dropped there. A bar never gets the same place twice: the tab that has it moves
 *  instead. A blank tab the pane showed doesn't stay behind; the group gets the focus. */
export function openAt(to: string, gid: string, where: Side | "center" | number) {
  if (!canOpenAt(to, gid, where)) return
  const has = typeof where === "number" ? groups().find((x) => x.id === gid)?.tabs.find((t) => t.to === to) : null
  if (has) return moveTabTo(has.id, gid, where)
  if (typeof where === "number" || where === "center") {
    set(withGroup(gid, (g) => {
      const has = where === "center" ? g.tabs.find((t) => t.to === to) : null
      if (has) return pastBlank(g, { ...g, active: has.id })
      const cur = shownTab(g)
      if (where === "center" && cur?.to === "new") return mapTabs(g, cur.id, (t) => moveOn(t, to))
      const id = newId(), at = typeof where === "number" ? where : g.tabs.findIndex((t) => t.id === g.active) + 1
      return pastBlank(g, { ...g, tabs: [...g.tabs.slice(0, at), { id, to }, ...g.tabs.slice(at)], active: id })
    }, { focus: gid }))
  } else {
    const id = newId(), g: Group = { id: `g${newId()}`, tabs: [{ id, to }], active: id }
    set({ root: beside(getWorkspace().root, gid, g, where), focus: g.id })
  }
  show(to, true)
}

/** Several tabs selected together, moved as one (dragged by `held`, which is shown after), in their order on screen:
 *  into a bar before its `where`th tab, a pane's middle, or a new split beside it (the first makes it, the rest join). */
export function moveTabsTo(ids: string[], held: string, gid: string, where: Side | "center" | number) {
  const order = groups().flatMap((g) => g.tabs.map((t) => t.id)).filter((id) => ids.includes(id))
  if (!order.length) return
  if (typeof where === "number") {
    let at = where
    for (const id of order) {
      moveTabTo(id, gid, at)
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
  if (g) set(withGroup(g.id, (x) => ({ ...x, active: held }), { focus: g.id }))
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

// ---------- a phone's tab groups (the tab list: a pane with several tabs is a group) ----------

/** Set the tree after moving tabs between panes, the tab on screen kept: its pane is focused and shows it. */
function regroup(root: Layout) {
  const shown = activeTab().id
  const g = leaves(root).find((x) => x.tabs.some((t) => t.id === shown))
  set({ root: g ? mapGroups(root, (x) => (x.id === g.id ? { ...x, active: shown } : x)) : root, focus: g?.id ?? getWorkspace().focus })
}

/** Would dropping tab `id` on tab `onto` make a group? Not when the two are a pane of their own already. */
export function canGroup(id: string, onto: string) {
  const a = groupOfTab(id), b = groupOfTab(onto)
  return !!a && !!b && id !== onto && !(a.id === b.id && b.tabs.length <= 2)
}

/** Tab `id` dropped on tab `onto`: it joins `onto`'s pane if that's alone in it, else the two make a pane beside it. */
export function groupTabs(id: string, onto: string) {
  if (!canGroup(id, onto)) return
  const b = groupOfTab(onto)!
  if (b.tabs.length === 1) return joinGroup(id, b.id)
  const p = pull(id)!, tb = b.tabs.find((t) => t.id === onto)!
  const root = mapGroups(p.root, (x) => {
    if (x.id !== b.id) return x
    const rest = x.tabs.filter((t) => t.id !== onto)
    return { ...x, tabs: rest, active: nextActive(x, onto, rest) }
  })
  regroup(beside(root, b.id, { id: `g${newId()}`, tabs: [tb, p.tab], active: onto }, "right"))
}

/** Tab `id` added to the end of pane `gid`. */
export function joinGroup(id: string, gid: string) {
  if (groupOfTab(id)?.id === gid || !groups().some((g) => g.id === gid)) return
  const p = pull(id)!
  regroup(mapGroups(p.root, (x) => (x.id === gid ? { ...x, tabs: [...x.tabs, p.tab] } : x)))
}

/** Tab `id` out of its pane, into one of its own beside it. */
export function leaveGroup(id: string) {
  const g = groupOfTab(id)
  if (!g || g.tabs.length < 2) return
  const p = pull(id)!
  regroup(beside(p.root, g.id, { id: `g${newId()}`, tabs: [p.tab], active: id }, "right"))
}

/** Pane `gid`'s tabs join the pane before it (the next one for the first): the split closes. */
export function ungroup(gid: string) {
  const all = groups(), i = all.findIndex((g) => g.id === gid)
  const into = all[i > 0 ? i - 1 : 1]
  if (i < 0 || !into) return
  const tabs = all[i].tabs
  regroup(mapGroups(getWorkspace().root, (x) => (x.id === gid ? { ...x, tabs: [] } : x.id === into.id ? { ...x, tabs: [...x.tabs, ...tabs] } : x)))
}

/** Tab `id` moved in its own pane to before tab `before` (the end for null); the tab on screen stays. */
export function placeTab(id: string, before: string | null) {
  const g = groupOfTab(id)
  if (!g || id === before) return
  const t = g.tabs.find((x) => x.id === id)!, rest = g.tabs.filter((x) => x.id !== id)
  const at = before ? rest.findIndex((x) => x.id === before) : rest.length
  if (at < 0) return
  set(withGroup(g.id, (x) => ({ ...x, tabs: [...rest.slice(0, at), t, ...rest.slice(at)] })))
}

/** Move a tab (the active one by default) into a new split beside its group. */
export function moveToSplit(side: Side, id = activeTab().id) {
  const g = groupOfTab(id)
  if (g) moveTabTo(id, g.id, side)
}

/** Split a pane (Split right / Split down): the tab (the active one by default) opens again in a new
 *  group beside its own, with its history. A plugin's view (a terminal) isn't doubled: the new group gets a blank tab. */
export function splitTab(side: Side, id = activeTab().id) {
  const from = groupOfTab(id)
  if (!from) return
  const t = from.tabs.find((x) => x.id === id)!
  const tab: Tab = t.to.startsWith("view:") ? { id: newId(), to: "new" } : { ...t, id: newId() }
  const g: Group = { id: `g${newId()}`, tabs: [tab], active: tab.id }
  set({ root: beside(getWorkspace().root, from.id, g, side), focus: g.id })
  show(tab.to, true)
}

/** Open something in a split on the right (or below): the group on that side of the focused one (a new tab there, or
 *  its blank one), made if there's none. */
/** `to` in a pane beside the focused one (`focus` false: shown there, the focus stays where it is). */
export function openInSplit(to: string, side: "right" | "bottom" = "right", focusIt = true) {
  const { root, focus } = getWorkspace()
  const right = neighbourOf(root, focus, side)
  if (!right) {
    const id = newId(), g: Group = { id: `g${newId()}`, tabs: [{ id, to }], active: id }
    set({ root: beside(root, focus, g, side), focus: focusIt ? g.id : focus })
    return focusIt ? show(to, true) : undefined
  }
  const blankTab = right.tabs.find((t) => t.id === right.active && t.to === "new")
  const id = blankTab?.id ?? newId()
  const tabs = blankTab ? right.tabs.map((t) => (t.id === id ? { ...t, to } : t)) : [...right.tabs, { id, to }]
  set(withGroup(right.id, (x) => ({ ...x, tabs, active: id }), { focus: focusIt ? right.id : focus }))
  if (focusIt) show(to, true)
}

const neighbour = (side: Side) => { const { root, focus } = getWorkspace(); return neighbourOf(root, focus, side) }
export const hasNeighbour = (side: Side) => !!neighbour(side)
/** Move the focus to the group on that side (the keyboard way between panes). */
export function focusSide(side: Side) {
  const g = neighbour(side)
  if (!g) return
  focusGroup(g.id)
  // The keyboard goes there too: its editor or terminal.
  focusPane(g.id)
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
