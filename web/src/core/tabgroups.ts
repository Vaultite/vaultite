// Tab groups (Group, core/layout.ts), as browsers have them: making, adding to, leaving, naming, colouring, folding,
// moving and closing one; and what agents ask of the tabs (`vau tabs`). Each change is one `set`.
import { COLORS, isColor, type Color } from "../../../core/colors.ts"
import {
  focusedPane, inGroup, isBlankTab, isSplit, nextShown, newGroupId, outsideGroups, panesAt, panesOf, placesIn, placesOf, runOf, spotWords, tabOf, vaultPath,
  type Group, type Pane, type Tab, type TabList,
} from "../../../core/layout.ts"
import { activePane, activeTab, closeTabIds, closePane, getWorkspace, here, paneById, paneTab, popoutId, selectPane, selectTab, set, show, showActive, tabById } from "@/core/workspace"
import { canPaneIntoPane, canTabIntoPane, openInSplit, paneIntoPane, paneToTab, placeTab, splitPane, tabIntoPane, type Zone } from "@/core/splits"
import { answerUi } from "@/core/live"

/** A tab group of this window's. */
export const groupById = (id: string): Group | undefined => here().groups?.find((g) => g.id === id)
/** The tab groups, in order. */
export const allGroups = () => here().groups ?? []
/** A group's tabs. */
export const tabsIn = (id: string) => here().tabs.filter((t) => t.group === id)

/** The colour a new tab group takes: the first no group has, then round again. */
export function nextColor(): Color {
  const used = allGroups().map((s) => s.color)
  return COLORS.find((c) => !used.includes(c)) ?? COLORS[used.length % COLORS.length]
}

/** What a view names a group of its panes (ViewDef.groupName: a web page's site). Set by the app, which knows the views. */
let viewGroupName: (to: string) => string | null = () => null
export const setGroupNamer = (fn: (to: string) => string | null) => { viewGroupName = fn }
/** A name for a new group of these tabs: the folder or the view's name all their panes share, else none. */
export function suggestName(tabs: Tab[]): string {
  const ps = tabs.flatMap(panesOf)
  const folders = ps.map((p) => { const f = vaultPath(p.to); return f === null ? null : f.split("/").slice(0, -1).join("/") })
  if (folders.every((f) => f) && new Set(folders).size === 1) return folders[0]!.split("/").pop()!
  const named = ps.map((p) => (p.to.startsWith("view:") ? viewGroupName(p.to) : null))
  if (named.every((n) => n) && new Set(named).size === 1) return named[0]!
  return ""
}

/** The tabs `ids` in their order in the list. */
const inOrder = (ids: string[]) => here().tabs.filter((t) => ids.includes(t.id))

/** `tabs` put at `at` (an index into the list without them), in group `group`, taken out of where they were; `def`: a
 *  new group made for them. */
function gather(tabs: Tab[], at: (rest: Tab[]) => number, group: string, def?: Group, shown?: string): TabList {
  const l = here(), chosen = new Set(tabs.map((t) => t.id))
  const rest = l.tabs.filter((t) => !chosen.has(t.id)), i = at(rest)
  return { ...l, tabs: [...rest.slice(0, i), ...tabs.map((t) => inGroup(t, group || undefined)), ...rest.slice(i)],
    ...(def ? { groups: [...(l.groups ?? []), def] } : {}), active: shown ?? l.active }
}

/** Make tabs a new tab group where the first of them is: its name and colour, or the suggested ones. Returns its id. */
export function makeGroup(ids: string[], opts: { name?: string; color?: Color; collapsed?: boolean } = {}): string | null {
  const tabs = inOrder(ids)
  if (!tabs.length) return null
  const id = newGroupId()
  const def: Group = { id, name: (opts.name ?? suggestName(tabs)).trim().slice(0, 80), color: opts.color ?? nextColor(), ...(opts.collapsed ? { collapsed: true } : {}) }
  const first = here().tabs.findIndex((t) => t.id === tabs[0].id), chosen = new Set(ids)
  set(gather(tabs, (rest) => outsideGroups(rest, here().tabs.slice(0, first).filter((t) => !chosen.has(t.id)).length), id, def))
  return id
}

/** Tab `id` dropped on tab `onto` (a phone's tab list): the two make a new tab group where `onto` is, or `id` joins
 *  `onto`'s. Returns the group's id. */
export function groupWith(id: string, onto: string): string | null {
  const a = tabById(id), b = tabById(onto)
  if (!a || !b || id === onto) return null
  if (b.group && groupById(b.group)) { addToGroup([id], b.group); return b.group }
  const gid = newGroupId(), def: Group = { id: gid, name: suggestName([b, a]), color: nextColor() }
  const before = here().tabs.slice(0, here().tabs.findIndex((t) => t.id === onto)).filter((t) => t.id !== id).length
  set(gather([b, a], () => before, gid, def))
  return gid
}

/** Add tabs to the end of a tab group; `shown`: the one of them to show. */
export function addToGroup(ids: string[], group: string, shown?: string) {
  const tabs = inOrder(ids).filter((t) => t.group !== group)
  if (!groupById(group) || !tabs.length) return
  set(gather(tabs, (rest) => { const r = runOf({ ...here(), tabs: rest }, group); return r.at + r.n }, group, undefined, shown))
}

/** `to` in a new tab, shown, at the end of the tab group named `name` (an agent's: "<agent>/<task>"); none such: a new
 *  one after the tab on screen (`beside`: in a split beside the focused pane, its tab the group's). Returns the pane id. */
export function openInGroup(to: string, name: string, beside = false): string {
  const named = name.trim() ? allGroups().find((s) => s.name === name) : undefined
  if (!named && beside) {
    const id = openInSplit(to, "right", false)
    if (name.trim()) makeGroup([paneTab(id)!.id], { name })
    return id
  }
  const tab = tabOf(to)
  if (!named) {
    const def: Group | undefined = name.trim() ? { id: newGroupId(), name: name.trim().slice(0, 80), color: nextColor() } : undefined
    const after = here().tabs.findIndex((t) => t.id === here().active) + 1
    set(gather([tab], (rest) => outsideGroups(rest, after), def?.id ?? "", def, tab.id))
  } else set(gather([tab], (rest) => { const r = runOf({ ...here(), tabs: rest }, named.id); return r.n ? r.at + r.n : rest.length }, named.id, undefined, tab.id))
  showActive()
  return tab.root.id
}

/** Take tabs out of their tab groups: each goes right after what's left of its group, as in a browser. */
export function leaveGroup(ids: string[]) {
  const l = here(), going = new Set(inOrder(ids).filter((t) => t.group).map((t) => t.id))
  if (!going.size) return
  let tabs = l.tabs.filter((t) => !going.has(t.id))
  for (const g of l.groups ?? []) {
    const out = l.tabs.filter((t) => going.has(t.id) && t.group === g.id).map((t) => inGroup(t, undefined))
    if (!out.length) continue
    const last = tabs.map((t) => t.group).lastIndexOf(g.id)
    const at = last >= 0 ? last + 1 : l.tabs.slice(0, l.tabs.findIndex((t) => t.group === g.id)).filter((t) => !going.has(t.id)).length
    tabs = [...tabs.slice(0, at), ...out, ...tabs.slice(at)]
  }
  set({ ...l, tabs })
}

/** Change a tab group's name, colour or fold. */
function changeGroup(id: string, fn: (g: Group) => Group) {
  const l = here()
  if (groupById(id)) set({ ...l, groups: l.groups!.map((g) => (g.id === id ? fn(g) : g)) })
}
export const renameGroup = (id: string, name: string) => changeGroup(id, (g) => ({ ...g, name: name.trim().slice(0, 80) }))
export const colorGroup = (id: string, color: Color) => changeGroup(id, (g) => ({ ...g, color }))

/** Fold a tab group to its name, or open it (`collapsed` left out: the other way). Folding the one whose tab is on
 *  screen shows another first (handOver). */
export function foldGroup(id: string, collapsed?: boolean) {
  const g = groupById(id)
  if (!g) return
  const fold = collapsed ?? !g.collapsed
  if (!!g.collapsed === fold) return
  const { collapsed: _, ...open } = g
  const l = here(), was = l.active
  const next = { ...l, groups: l.groups!.map((x) => (x.id === id ? (fold ? { ...g, collapsed: true } : open) : x)) }
  put(fold ? handOver(next, id) : next, was)
}
/** Folding tab group `id`, as its tabs start to move: the tab on screen, if it's one of its, hands over now
 *  (handOver), so the page changes at the click rather than once they've gone. Returns how to hand back. */
export function handOverFrom(id: string): (() => void) | undefined {
  const l = here(), next = handOver(l, id)
  if (next === l) return
  put(next, l.active)
  const was = l.active, to = next.active, made = !l.tabs.some((t) => t.id === to)
  // The fold turned round: its tab again, a blank tab made for it gone, if the list still shows the one it got.
  return () => {
    const now = here()
    if (now.active !== to || !now.tabs.some((t) => t.id === was)) return
    const blank = made && now.tabs.find((t) => t.id === to && isBlankTab(t))
    put({ ...now, active: was, tabs: blank ? now.tabs.filter((t) => t !== blank) : now.tabs }, to)
  }
}
/** `l` with the tab it shows moved off tab group `id`, which is folding: to the nearest not folded away, after the
 *  group, else before (Chrome's, never into another folded one); with none, a new tab. */
function handOver(l: TabList, id: string): TabList {
  if (l.tabs.find((t) => t.id === l.active)?.group !== id) return l
  const folded = { ...l, groups: l.groups?.map((s) => (s.id === id ? { ...s, collapsed: true } : s)) }
  const next = nextShown(folded, new Set(l.tabs.filter((t) => t.group === id).map((t) => t.id)), false)
  if (next) return { ...l, active: next }
  const blank = tabOf("new")
  return { ...l, tabs: [...l.tabs, blank], active: blank.id }
}
/** The list changed (it showed `was`): the address follows what it shows. */
function put(l: TabList, was: string) {
  set(l)
  if (l.active !== was) showActive()
}

/** Ungroup: the group goes, its tabs stay where they are. */
export function ungroup(id: string) {
  const l = here()
  if (groupById(id)) set({ ...l, groups: l.groups!.filter((g) => g.id !== id) })
}
/** Close a tab group's tabs (each reopens with ⌘⇧T; the group goes with its last tab). */
export const closeGroup = (id: string) => { if (groupById(id)) closeTabIds(tabsIn(id).map((t) => t.id)) }

/** A new tab at the end of a tab group, shown (the blank tab there is moves there if there is one). */
export function newTabInGroup(id: string) {
  if (!groupById(id)) return
  const blank = here().tabs.find(isBlankTab) ?? tabOf("new")
  set(gather([blank], (rest) => { const r = runOf({ ...here(), tabs: rest }, id); return r.at + r.n }, id, undefined, blank.id))
  show("new", true)
}

/** Would moving a whole tab group to index `at` of the list change anything? Not onto its own place. */
export function canMoveGroup(id: string, at: number) {
  const r = runOf(here(), id)
  return r.n > 0 && (at < r.at || at > r.at + r.n)
}
/** Move a whole tab group (dragged by its name) to before the `at`th tab, never inside another group (before it). */
export function moveGroupTo(id: string, at: number) {
  if (!canMoveGroup(id, at)) return
  const l = here(), tabs = tabsIn(id), before = l.tabs.slice(0, at).filter((t) => t.group === id).length
  set(gather(tabs, (rest) => outsideGroups(rest, Math.min(at - before, rest.length)), id))
}

// ---------- what agents ask (vau tabs: plugins/core/tabs/plugin.ts) ----------

// (a split's pane's own tabs follow it, each `behind` the pane it's stacked in)
const paneLine = (p: Pane, t: Tab, behind?: string) => ({ id: p.id, to: p.to, ...(vaultPath(p.to) ? { path: vaultPath(p.to)! } : {}), ...(behind ? { behind } : {}),
  ...(p.id === t.focus ? { focused: true } : {}), ...(p.float ? { floating: true } : {}), ...(t.zoom === p.id ? { zoomed: true } : {}) })
const tabLine = (t: Tab, l: TabList) => ({ id: t.id, ...(t.id === l.active ? { active: true } : {}), ...(t.pinned ? { pinned: true } : {}), ...(t.name ? { name: t.name } : {}),
  ...(t.group ? { group: t.group } : {}), panes: panesOf(t).flatMap((p) => [paneLine(p, t), ...(p.stack ?? []).map((x) => paneLine(x, t, p.id))]) })
/** This window's tabs, each with its panes, and its tab groups; the main window's report has its pop-outs' too. */
export function tabsReport() {
  const l = here(), w = getWorkspace()
  return {
    tabs: l.tabs.map((t) => tabLine(t, l)),
    groups: (l.groups ?? []).map((g) => ({ ...g, tabs: runOf(l, g.id).n })),
    ...(popoutId() ? { window: popoutId() } : w.windows?.length ? { windows: w.windows.map((x) => ({ id: x.id, tabs: x.tabs.map((t) => tabLine(t, x)) })) } : {}),
  }
}
/** What an agent names (a tab's or pane's id, what a pane shows: "file:Notes/a.md", "view:terminal/x", or a file's path
 *  or name): the tabs and panes it is. */
function find(q: string): { tabs: Tab[]; panes: Pane[] } {
  const l = here(), t = tabById(q), p = paneById(q)
  if (t) return { tabs: [t], panes: [] }
  if (p) return { tabs: [], panes: [p] }
  const low = q.toLowerCase().replace(/\.md$/, ""), ps = l.tabs.flatMap(placesIn)
  const hit = ps.filter((x) => x.to === q || x.to === `file:${q}`)
  const found = hit.length ? hit : ps.filter((x) => { const f = vaultPath(x.to)?.toLowerCase().replace(/\.md$/, ""); return !!f && (f === low || f.split("/").pop() === low) })
  if (!found.length) throw new Error(`no open tab or pane is ${q} (vau tabs lists them)`)
  return { tabs: [], panes: found }
}
/** The tabs an agent names (a pane names its tab). */
function namedTabs(said: unknown): string[] {
  const out: string[] = []
  for (const q of Array.isArray(said) ? said.map(String) : []) {
    const f = find(q)
    for (const id of [...f.tabs.map((t) => t.id), ...f.panes.map((p) => paneTab(p.id)!.id)]) if (!out.includes(id)) out.push(id)
  }
  return out
}
/** The one pane an agent names (a tab names its focused pane). */
function namedPane(q: unknown, what = "pane"): Pane {
  if (typeof q !== "string" || !q) throw new Error(`say which ${what}`)
  const f = find(q)
  const ps = [...f.tabs.map(focusedPane), ...f.panes]
  if (ps.length > 1) throw new Error(`${q} is open in ${ps.length} panes: name one by its id (vau tabs lists them)`)
  return ps[0]
}
/** What a pane's tab says it shows (a note's name, a page's title). Set by the app, which draws the tabs. */
let paneLabel: (p: Pane) => string = (p) => p.to
export const setPaneLabeler = (fn: (p: Pane) => string) => { paneLabel = fn }
const THIS = /^(this|here|current|focused|active)( one| pane| panel| tab)?$|^the (current|focused|active)( one| pane| panel| tab)?$/i
const host = (to: string) => { try { return to.startsWith("view:web/") ? new URL(to.slice(9).replace(/^@[a-z0-9]+\//, "")).host.replace(/^www\./, "") : "" } catch { return "" } }
/** What a pane is called by: its places' targets, paths, names, tab labels and sites, in lower case. */
const namesOf = (p: Pane) => placesOf(p).flatMap((x) => { const f = vaultPath(x.to); return [x.to, f, f?.split("/").pop()?.replace(/\.md$/, ""), paneLabel(x), host(x.to)] })
  .filter((n): n is string => !!n).map((n) => n.toLowerCase())
const named = (p: Pane) => `${p.id} (${paneLabel(p)})`
/** The pane the user names, to open something in it (vau open --in): its id, where it is in the tab on screen ("left",
 *  "the top right one"), "this" (the one focused), or what it shows (a file, a site, words of its tab's title). */
export function paneNamed(said: string): Pane {
  const q = said.trim(), t = activeTab()
  if (!q) throw new Error("say which pane")
  const byId = paneById(q)
  if (byId) return byId
  if (THIS.test(q)) return activePane()
  const spots = spotWords(q)
  if (spots) {
    if (!isSplit(t.root)) return focusedPane(t)
    const at = panesAt(t.root, spots), where = spots.join(" ")
    if (at.length === 1) return at[0]
    if (!at.length) throw new Error(`no pane is at the ${where} of the tab on screen: its panes are ${panesOf(t).map(named).join(", ")}`)
    const more = spots.some((x) => x === "top" || x === "bottom") ? `${where} left` : `top ${where}`
    throw new Error(`${at.length} panes are at the ${where}: ${at.map(named).join(", ")}; name one (by its id, or more of where it is: ${more})`)
  }
  const w = q.toLowerCase().replace(/^(the\s+)?((one|pane|panel|tab|split)\s+)?(showing|with|that shows|that has|where|of|on)\s+/, "").replace(/^the\s+/, "").replace(/\.md$/, "").trim()
  const i = q.toLowerCase().indexOf(w), as = i >= 0 && w ? q.slice(i, i + w.length) : q // (as said: its case)
  for (const ps of [panesOf(t), here().tabs.filter((x) => x.id !== t.id).flatMap(panesOf)]) {
    const exact = ps.filter((p) => namesOf(p).includes(w))
    const word = new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
    const hit = exact.length ? exact : ps.filter((p) => namesOf(p).some((n) => word.test(n)))
    if (hit.length === 1) return hit[0]
    if (hit.length > 1) throw new Error(`${hit.length} panes show ${as}: ${hit.map(named).join(", ")}; name one by its id or where it is (left, top right)`)
  }
  throw new Error(`no pane shows ${as}: the tab on screen has ${panesOf(t).map(named).join(", ")} (or name one by where it is: left, top right, this)`)
}
const SIDES = ["left", "right", "top", "bottom"]
const zoneOf = (z: unknown, fallback: Zone): Zone => {
  if (z === undefined || z === null || z === "") return fallback
  if (z === "center" || SIDES.includes(String(z))) return z as Zone
  throw new Error("a side is left, right, top, bottom or center")
}
answerUi("tabs", (m) => {
  if (m.do === "list") return tabsReport()
  const color = m.color === undefined || m.color === null ? undefined : String(m.color)
  if (color !== undefined && !isColor(color)) throw new Error(`a colour is one of ${COLORS.join(", ")}`)
  if (m.do === "group") {
    const ids = namedTabs(m.tabs)
    let id = typeof m.group === "string" && m.group ? m.group : null
    if (id && !groupById(id)) throw new Error(`no tab group ${id} (vau tabs lists them)`)
    if (!id && !ids.length) throw new Error("say which tabs to group")
    if (id) addToGroup(ids, id)
    else id = makeGroup(ids, { name: typeof m.name === "string" ? m.name : undefined, color: color as Color | undefined })!
    if (typeof m.name === "string") renameGroup(id, m.name)
    if (color) colorGroup(id, color as Color)
    if (typeof m.collapsed === "boolean") foldGroup(id, m.collapsed)
    return { group: { ...groupById(id)!, tabs: tabsIn(id).map((t) => tabLine(t, here())) } }
  }
  if (m.do === "ungroup") {
    if (typeof m.group === "string" && m.group) {
      if (!groupById(m.group)) throw new Error(`no tab group ${m.group} (vau tabs lists them)`)
      ungroup(m.group)
      return { ungrouped: m.group }
    }
    const ids = namedTabs(m.tabs)
    leaveGroup(ids)
    return { removed: ids }
  }
  if (m.do === "split") {
    const p = namedPane(m.pane), side = zoneOf(m.side, "right")
    if (side === "center") throw new Error("a split's side is left, right, top or bottom")
    selectPane(p.id)
    if (typeof m.to === "string" && m.to) {
      const into = paneTab(p.id)!, made = tabOf(m.to)
      set({ ...here(), tabs: [...here().tabs, made] })
      tabIntoPane(made.id, p.id, side)
      return { pane: made.root.id, tab: into.id }
    }
    splitPane(side, p.id)
    return { pane: activePane().id, tab: here().active }
  }
  if (m.do === "move") {
    const what = typeof m.what === "string" ? find(m.what) : null
    if (!what) throw new Error("say what to move: a tab or a pane")
    const at = typeof m.at === "number" ? m.at : undefined
    const tab = what.tabs[0], pane = what.tabs.length ? null : what.panes.length === 1 ? what.panes[0] : null
    if (!tab && !pane) throw new Error(`${m.what} is open in ${what.panes.length} panes: name one by its id`)
    if (typeof m.into === "string" && m.into) {
      const target = namedPane(m.into, "pane to move it to"), zone = zoneOf(m.side, "right")
      selectPane(target.id)
      if (tab) { if (!canTabIntoPane(tab.id, target.id, zone)) throw new Error("that move changes nothing"); tabIntoPane(tab.id, target.id, zone) }
      else { if (!canPaneIntoPane(pane!.id, target.id, zone)) throw new Error("that move changes nothing"); paneIntoPane(pane!.id, target.id, zone) }
    } else if (at !== undefined) {
      if (tab) placeTab(tab.id, Math.max(0, at))
      else if (panesOf(paneTab(pane!.id)!).length > 1) paneToTab(pane!.id, Math.max(0, at))
      else placeTab(paneTab(pane!.id)!.id, Math.max(0, at))
    } else if (pane && panesOf(paneTab(pane.id)!).length > 1) paneToTab(pane.id)
    else throw new Error("say where: `into` a pane (with `side`), or `at` a place in the list")
    return tabsReport()
  }
  if (m.do === "swap") {
    const a = namedPane(m.pane), b = namedPane(m.with, "pane to swap with")
    if (!canPaneIntoPane(a.id, b.id, "center")) throw new Error("those are the same pane")
    paneIntoPane(a.id, b.id, "center")
    return tabsReport()
  }
  if (m.do === "focus") {
    if (typeof m.what !== "string" || !m.what) throw new Error("say which tab or pane")
    const f = find(m.what)
    if (f.tabs.length) selectTab(f.tabs[0].id)
    else selectPane(f.panes[0].id)
    return { tab: here().active, pane: activePane().id }
  }
  if (m.do === "close") {
    // (another device closing this one's tabs: named as its list has them, a terminal with or without its machine)
    const bare = (to: string) => (to.startsWith("view:terminal/") ? to.replace(/@[a-z0-9-]+$/, "") : to)
    const want = Array.isArray(m.tabs) ? new Set(m.tabs.map((t) => bare(String(t)))) : null
    const ps = here().tabs.flatMap(placesIn).filter((p) => p.to !== "new" && (!want || want.has(bare(p.to))))
    const whole = here().tabs.filter((t) => placesIn(t).every((p) => ps.includes(p))).map((t) => t.id)
    if (whole.length) closeTabIds(whole)
    for (const p of ps) if (paneById(p.id)) closePane(p.id)
    return { closed: ps.length }
  }
  throw new Error("do is list, group, ungroup, split, move, swap, focus or close")
})
