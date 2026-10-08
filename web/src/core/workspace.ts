// The tabs on screen: groups of tabs, in a tree of splits (core/layout.ts, core/splits.ts), each tab
// with its own history. This device's (localStorage), or with Workspaces the current workspace's, shared across devices.
import { useSyncExternalStore } from "react"
import { backDetail, route } from "@/core/nav"
import { HISTORY, blankGroup, clean, dropBlank, isBlank, leaves, mapGroups, mapTabs, moveOn, newId, nextActive, okGroup, shownTab, tidy, vaultPath, type Group, type Layout, type Tab, type Workspace } from "@/core/layout"

const DESKTOP = "(min-width: 768px)"
export const isDesktop = () => matchMedia(DESKTOP).matches
/** isDesktop that follows the window: a phone's width and a computer's swap as it's resized. */
export const useDesktop = () => useSyncExternalStore((f) => { const m = matchMedia(DESKTOP); m.addEventListener("change", f); return () => m.removeEventListener("change", f) }, isDesktop)
const notify = () => dispatchEvent(new HashChangeEvent("hashchange"))
const enc = encodeURIComponent
/** This window is a pop-out (`?popout=<id>`: a tab moved or opened out of the main window, popOut):
 *  its own tabs, kept for the window (sessionStorage), no sidebars. */
const POPOUT = new URLSearchParams(location.search).get("popout")
export const isPopout = () => !!POPOUT
const KEY = POPOUT ? `vaultite.popout.${POPOUT}` : "vaultite.tabs"
if (POPOUT) document.documentElement.dataset.popout = "" // (index.css: the lights' room)
/** Where the tabs are kept: this device's (a pop-out's: this window's). */
const tabStore = () => (POPOUT ? sessionStorage : localStorage)

/** Nothing was saved on this device yet: its first tab is blank until where it starts is known (fillFirstTab). */
let unsaved = false
/** Asked to start on a new tab (the crash screen's "Reload with a new tab"): the tabs come back in one pane with a new
 *  tab shown, so the one that stopped the app isn't drawn. Workspaces saves that rather than undoes it. */
export const startedFresh = (() => {
  try { const v = sessionStorage.getItem("vaultite.freshStart"); sessionStorage.removeItem("vaultite.freshStart"); return !!v } catch { return false }
})()
function fresh(root: Layout): Workspace {
  const seen = new Set<string>()
  const tabs = leaves(root).flatMap((g) => g.tabs).filter((t) => !isBlank(t) && !seen.has(t.id) && !!seen.add(t.id))
  const blank = { id: newId(), to: "new" }
  return { root: { id: "g0", tabs: [...tabs, blank], active: blank.id }, focus: "g0" }
}
function load(): Workspace {
  try {
    const t = JSON.parse(tabStore().getItem(KEY) ?? "null") as (Workspace & Partial<Group> & { groups?: Group[]; split?: number }) | null
    let root: Layout | null = null
    if (t?.root) root = tidy(clean(t.root))
    // One group, or a main one and a right split: { groups, split } (the right one's share).
    else if (t && Array.isArray(t.groups)) {
      const gs = t.groups.filter(okGroup).slice(0, 2)
      root = tidy({ id: "s0", dir: "row", kids: gs, sizes: [1 - (t.split || 0.42), t.split || 0.42] })
    }
    // Before splits: { tabs, active }.
    else if (t && okGroup({ id: "g0", tabs: t.tabs!, active: t.active! })) root = { id: "g0", tabs: t.tabs!, active: t.active! }
    if (root && startedFresh) return fresh(root)
    if (root) { const gs = leaves(root); return { root, focus: gs.some((g) => g.id === t!.focus) ? t!.focus : gs[0].id } }
  } catch { /* private mode */ }
  unsaved = true
  return { root: blankGroup("g0"), focus: "g0" }
}
/** The file in the focused pane or, while that shows something else (a view, like the links tab), the file focused
 *  last, and the pane it's in: what a view that follows the other panes shows (a linked pane). */
export type FocusedFile = { path: string; group: string }
let lastFile: FocusedFile = { path: "", group: "" }
function noteFile() {
  const g = leaves(state.root).find((x) => x.id === state.focus)
  const to = (g && shownTab(g)?.to) ?? ""
  if (to.startsWith("file:") && (to.slice(5) !== lastFile.path || g!.id !== lastFile.group)) lastFile = { path: to.slice(5), group: g!.id }
  else if (lastFile.path && !leaves(state.root).some((x) => x.id === lastFile.group && x.tabs.some((t) => t.to === `file:${lastFile.path}`))) {
    lastFile = { path: "", group: "" } // its tab closed
  }
}
let state = load()
noteFile()
const subs = new Set<() => void>()
/** The next workspace, tidied (an emptied group closes; with none left, a blank tab). A focused group that closed
 *  hands the focus to its neighbour. */
export function set(next: Workspace) {
  const was = leaves(state.root).map((g) => g.id)
  const root = tidy(next.root) ?? blankGroup()
  const gs = leaves(root)
  let focus = next.focus
  if (!gs.some((g) => g.id === focus)) {
    const i = Math.max(0, was.indexOf(focus))
    focus = (gs.find((g) => g.id === was[i + 1]) ?? [...gs].reverse().find((g) => was.indexOf(g.id) < i) ?? gs[0]).id
  }
  state = { root, focus }
  try { tabStore().setItem(KEY, JSON.stringify(state)) } catch { /* private mode */ }
  noteFile()
  subs.forEach((f) => f())
}
export const getWorkspace = () => state
export const useWorkspace = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => state)
/** Run fn whenever the tabs or splits change (a tab opened, moved, navigated; a divider dragged). */
export const onWorkspaceChange = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } }
/** Put a whole other layout in place (Workspaces switching). Nothing is "closed" (a terminal's tab reattaches when it
 *  comes back). `merge`: the same workspace changed on another device, so what's on screen here stays where it can. */
export function replaceWorkspace(next: unknown, opts: { merge?: boolean } = {}) {
  unsaved = false
  const w = next as Partial<Workspace> | null
  let root = w ? tidy(clean(w.root)) : null
  let gs = root ? leaves(root) : []
  let focus = gs.some((g) => g.id === w!.focus) ? w!.focus! : gs[0]?.id
  if (root && opts.merge) {
    const had = new Map(groups().map((g) => [g.id, g]))
    const tabs = new Map(groups().flatMap((g) => g.tabs).map((t) => [t.id, t]))
    root = mapGroups(root, (g) => {
      const mine = had.get(g.id)
      return {
        ...g,
        active: mine && g.tabs.some((t) => t.id === mine.active) ? mine.active : g.active,
        tabs: g.tabs.map((t) => { const o = tabs.get(t.id); return o && o.to === t.to && !t.back && !t.fwd ? { ...t, back: o.back, fwd: o.fwd, from: o.from } : t }),
      }
    })
    gs = leaves(root)
    if (gs.some((g) => g.id === state.focus)) focus = state.focus
  }
  set(root ? { root, focus } : { root: { id: "g0", tabs: [], active: "" }, focus: "g0" })
  showActiveUnder()
}

/** A device's first visit (nothing saved, no workspace put in place): its blank tab shows `to` (a plugin's `home`: the
 *  first pinned page), unless the address asks for something else (a deep link) or something was opened meanwhile. */
export function fillFirstTab(to: string) {
  if (!unsaved) return
  unsaved = false
  if (![undefined, "", "new"].includes(route().tab)) return
  const gs = groups()
  if (gs.length !== 1 || gs[0].tabs.length !== 1 || gs[0].tabs[0].to !== "new") return
  set(withGroup(gs[0].id, (g) => mapTabs(g, g.active, (t) => ({ ...t, to }))))
  showActive()
}

export const useFocusedFile = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => lastFile)
export const groups = () => leaves(state.root)
/** A group's tabs (the focused group's by default). */
export function useTabs(group?: string): Group {
  const gs = leaves(useWorkspace().root)
  return gs.find((g) => g.id === (group || state.focus)) ?? gs[0]
}
const focused = () => groups().find((g) => g.id === state.focus) ?? groups()[0]
export const groupOfTab = (id: string) => groups().find((g) => g.tabs.some((t) => t.id === id))
/** The vault file in the focused tab ("" when it shows something else, or a file from outside the vault). */
export const currentFile = () => vaultPath(activeTab()?.to ?? "") ?? ""
export const activeTab = () => shownTab(focused())!
/** Change one group. */
export const withGroup = (gid: string, fn: (g: Group) => Group, extra: Partial<Workspace> = {}): Workspace =>
  ({ ...state, ...extra, root: mapGroups(state.root, (g) => (g.id === gid ? fn(g) : g)) })

/** The hash for a tab's target: "file/Notes%2FIdea.md", "view/terminal%2Fabc", "new". */
export const hashOf = (to: string) => (to.startsWith("file:") ? `file/${enc(to.slice(5))}` : to.startsWith("view:") ? `view/${enc(to.slice(5))}` : to)
/** The target for a route's tab ("file/Notes%2FIdea.md" -> "file:Notes/Idea.md"). */
export function targetOf(tab: string) {
  for (const k of ["file", "view"]) {
    if (tab.startsWith(`${k}/`)) { try { return `${k}:${decodeURIComponent(tab.slice(5))}` } catch { return `${k}:${tab.slice(5)}` } }
  }
  return tab
}
const isFile = (to: string) => to.startsWith("file:")

/** Back (-1) or forward (1) in the active tab's history. Back closes an open sheet first; Back from the first place
 *  of a tab opened for something (`from`) closes it and shows that one again, like a browser tab opened from a link. */
export function navigate(dir: -1 | 1) {
  if (dir < 0 && route().detail) return backDetail()
  const cur = activeTab()
  const back = [...(cur.back ?? [])], fwd = [...(cur.fwd ?? [])]
  const to = dir < 0 ? back.pop() : fwd.shift()
  if (!to && dir < 0 && opener(cur)) { const from = cur.from!; return guarded([cur], () => { closeTab(cur.id, true); selectTab(from) }) }
  if (!to) return
  if (dir < 0) fwd.unshift(cur.to); else back.push(cur.to)
  set(withGroup(state.focus, (g) => mapTabs(g, cur.id, (t) => ({ ...t, to, back, fwd }))))
  show(to, false)
}
export const canNavigate = (t: Tab | undefined, dir: -1 | 1) => !!(dir < 0 ? t?.back : t?.fwd)?.length || (dir < 0 && !!opener(t))
/** The tab `t` was opened beside, if it's still open. */
const opener = (t: Tab | undefined) => (t?.from && t.from !== t.id && groupOfTab(t.from) ? t.from : null)

/** Each history entry says which tab it's a place of (`tab`: phones find the tab to go back to by it; followHash). */
type Entry = { tab?: string; sheet?: number; prev?: string } | null
const entry = () => history.state as Entry
/** The address shows `to` (a new history entry with `push`). */
export function show(to: string, push: boolean) {
  const h = `#${hashOf(to)}`
  if (location.hash === h) { stamp(); return notify() }
  const st = { tab: activeTab().id }
  if (push) history.pushState(st, "", h); else history.replaceState(st, "", h)
  notify()
}
/** Mark the entry on screen as the active tab's place, if nothing said whose it is (a link followed, a sheet closed). */
function stamp() {
  const e = entry()
  if (!e?.tab) history.replaceState({ ...e, tab: activeTab().id }, "")
}
// The address changed to what the active tab shows (a sheet opened or closed over it): that entry is this tab's. A new
// place (a link) is stamped once followHash has put it in a tab.
addEventListener("hashchange", () => { if (targetOf(route().tab) === activeTab().to) stamp() })
/** The address shows the focused group's active tab. */
export const showActive = () => show(activeTab().to, false)

/** What sort of thing a tab shows, for go(): a page, a file, or a view by name, so Graph view never replaces a
 *  terminal. A view that keeps its tab (`keepsTab`) is a sort of its own: nothing opens in its place. */
function sortOf(to: string) {
  if (to.startsWith("view:")) return keeps(to) ? to : `view:${to.slice(5).split("/")[0]}`
  return isFile(to) && !isPage(to.slice(5)) ? "file" : "page"
}
/** Whether a view's tab is its own (ViewDef.keepsTab). Set by the app, which knows the views. */
let keeps: (to: string) => boolean = () => false
export const setTabKeeper = (fn: (to: string) => boolean) => { keeps = fn }
/** Whether a file is a page (core/pages.ts isPage). Set by the app, which knows the plugins. */
let isPage: (path: string) => boolean = () => false
export const setPageTest = (fn: (path: string) => boolean) => { isPage = fn }

/** Where a target is open: the focused group first. */
export function findOpen(to: string) {
  for (const g of [focused(), ...groups().filter((x) => x.id !== state.focus)]) {
    const t = g.tabs.find((x) => x.to === to)
    if (t) return { g, t }
  }
  return null
}

/** Switch to tab `t` of group `gid`, which has what was just opened from the active tab: a blank one is left behind
 *  closed (layout.ts, dropBlank). `from`: it was opened from that tab (Tab.from). */
function switchTo(gid: string, t: Tab, from?: string) {
  const cur = activeTab()
  const ws = withGroup(gid, (g) => ({ ...(from ? mapTabs(g, t.id, (x) => ({ ...x, from })) : g), active: t.id }), { focus: gid })
  set(isBlank(cur) && cur.id !== t.id ? { ...ws, root: dropBlank(ws.root, cur.id, isDesktop()) } : ws)
}

/** Go somewhere: an open tab that has it, else the current tab when it shows the same sort of thing (or nothing), else a
 *  new tab beside it, so a person opened from People opens beside it and Back returns there. Blank tabs are never kept. */
export function go(to: string, newTab = false, push = true) {
  const cur = activeTab()
  const open = findOpen(to)
  // Opened from a page into a tab of its own (not asked for one): Back returns to the page.
  const from = !newTab && !isBlank(cur) && sortOf(cur.to) === "page" && sortOf(to) !== "page" ? cur.id : undefined
  // Another tab: on phones a history entry, like selectTab (Back returns to the tab it was opened from; replacing the
  // entry would lose that place, and Back would skip it).
  if (open && (!newTab || isBlank(cur))) { switchTo(open.g.id, open.t, open.t.id === cur.id ? undefined : from); return show(to, push && !isDesktop() && open.t.id !== cur.id && !isBlank(cur)) }
  if (isBlank(cur) || (!newTab && !cur.pinned && sortOf(cur.to) === sortOf(to))) {
    set(withGroup(state.focus, (g) => mapTabs(g, cur.id, (t) => moveOn(t, to))))
    return show(to, push)
  }
  set(withGroup(state.focus, (g) => withTabAfter(g, cur.id, to, from)))
  show(to, push)
}

/** A group with a new tab showing `to` right after tab `after`, active (`from`: the tab it was opened from, Tab.from). */
function withTabAfter(g: Group, after: string, to: string, from?: string): Group {
  const id = newId(), at = g.tabs.findIndex((t) => t.id === after) + 1
  const tab: Tab = from ? { id, to, from } : { id, to }
  return { ...g, tabs: [...g.tabs.slice(0, at), tab, ...g.tabs.slice(at)], active: id }
}

/** Change what a tab shows in place, with no history entry (a view's own state in its arg: a search's query as it's
 *  typed, `ViewCtx.setArg`). The address follows when it's the tab on screen. */
export function replaceTabTarget(id: string, to: string) {
  const g = groupOfTab(id)
  if (!g || g.tabs.find((t) => t.id === id)?.to === to) return
  set(withGroup(g.id, (x) => mapTabs(x, id, (t) => ({ ...t, to }))))
  if (g.id === state.focus && g.active === id) show(to, false)
}

/** Show `to` in the active tab whatever it held (a page's tabs, List -> Map: the same place, its own history). */
export function goHere(to: string) {
  const cur = activeTab()
  if (cur.to === to) return
  set(withGroup(state.focus, (g) => mapTabs(g, cur.id, (t) => moveOn(t, to))))
  show(to, true)
}

/** The address changed by itself (back, forward, a typed URL): show it in the tab that has it. Every place a phone
 *  shows is its own history entry, marked with its tab, so Back and Forward land on exactly what a swipe slid in. */
export function followHash(tab: string) {
  const to = targetOf(tab)
  let cur = activeTab()
  if (cur.to === to) return stamp()
  const owner = isDesktop() ? undefined : entry()?.tab
  const g = owner && owner !== cur.id ? groupOfTab(owner) : undefined
  if (g) { set(withGroup(g.id, (x) => ({ ...x, active: owner! }), { focus: g.id })); cur = activeTab(); if (cur.to === to) return }
  // A link (no owner yet): the tab that has it, as on desktop (a blank tab it was followed from closes: go).
  const open = findOpen(to)
  if (open && !owner) { switchTo(open.g.id, open.t); return stamp() }
  if (!isDesktop()) {
    const back = [...(cur.back ?? [])], fwd = [...(cur.fwd ?? [])]
    const walk = (t: Partial<Tab>) => { set(withGroup(state.focus, (x) => mapTabs(x, cur.id, (c) => ({ ...c, to, ...t })))); stamp() }
    if (back.at(-1) === to) { back.pop(); return walk({ back, fwd: [cur.to, ...fwd] }) }
    if (fwd[0] === to) { fwd.shift(); return walk({ back: [...back, cur.to].slice(-HISTORY), fwd }) }
  }
  if (open && !g) switchTo(open.g.id, open.t)
  else if (keeps(cur.to) || cur.pinned) set(withGroup(state.focus, (x) => withTabAfter(x, cur.id, to)))
  else set(withGroup(state.focus, (x) => mapTabs(x, cur.id, (t) => moveOn(t, to))))
  stamp()
}

/** Show a tab. On phones that's a history entry (Back returns to the tab that was on screen); on desktop the address
 *  just follows. */
export function selectTab(id: string) {
  const g = groupOfTab(id)
  if (!g) return
  set(withGroup(g.id, (x) => ({ ...x, active: id }), { focus: g.id }))
  show(g.tabs.find((t) => t.id === id)!.to, !isDesktop())
}

/** How many tabs the focused pane has. */
export const tabsHere = () => focused().tabs.length
/** The next (1) or previous (-1) tab in the focused pane, round from the last to the first. */
export function cycleTab(dir: 1 | -1) {
  const g = focused()
  if (g.tabs.length < 2) return
  const i = g.tabs.findIndex((t) => t.id === g.active)
  selectTab(g.tabs[(i + dir + g.tabs.length) % g.tabs.length].id)
}

/** Show the focused pane's nth tab (1-based; -1: its last), like a browser's ⌘1–⌘9. */
export function selectTabAt(n: number) {
  const g = focused()
  const t = n < 0 ? g.tabs.at(-1) : g.tabs[n - 1]
  if (t) selectTab(t.id)
}

/** Open tab `id` in a window of its own (a pop-out: POPOUT), with its history; `move`: and take it out of this one
 *  (not closed: a terminal's shell goes on in the new window). */
export function popOut(id: string, move = false) {
  const g = groupOfTab(id)
  const t = g?.tabs.find((x) => x.id === id)
  if (!g || !t) return
  const pid = newId(), key = `vaultite.popout.${pid}`
  // The new window starts with a copy of this one's sessionStorage (window.open): its tab, history and all.
  try { sessionStorage.setItem(key, JSON.stringify({ root: { id: "g0", tabs: [{ id: t.id, to: t.to, back: t.back, fwd: t.fwd }], active: t.id }, focus: "g0" })) } catch { /* the address is enough */ }
  const w = window.open(`${location.pathname}?popout=${pid}#${hashOf(t.to)}`, `vaultite-${pid}`, "popup,width=960,height=760")
  try { sessionStorage.removeItem(key) } catch { /* private mode */ }
  if (w && move) takeOut([id])
}

/** Take tabs out of this window without closing them: they go on in another (popOut, core/windows.ts' moveToMain). */
export function takeOut(ids: string[]) {
  for (const id of ids) {
    const g = groupOfTab(id)
    if (!g) continue
    const rest = g.tabs.filter((x) => x.id !== id)
    leave(g.id, rest, nextActive(g, id, rest))
  }
}

/** Stack a pane's tabs, or put them back in a row (Group.stacked). */
export function toggleStacked(gid = state.focus) {
  set(withGroup(gid, (g) => { const { stacked, ...rest } = g; return stacked ? rest : { ...rest, stacked: true } }))
}

/** Pin or unpin a tab (Tab.pinned). */
export function togglePinTab(id: string) {
  const g = groupOfTab(id)
  if (!g) return
  set(withGroup(g.id, (x) => mapTabs(x, id, (t) => { const { pinned, ...rest } = t; return pinned ? rest : { ...rest, pinned: true } })))
}

/** Clicking in a group's pane gives it the focus (the address shows its tab; commands act on it). */
export function focusGroup(gid: string) {
  if (state.focus === gid || !groups().some((g) => g.id === gid)) return
  set({ ...state, focus: gid })
  showActive()
}

/** After tabs close: the address shows the active tab, keeping a sheet that's open over it (tabs closed from the
 *  phone's tab switcher, a sheet itself, leave it open). */
function showActiveUnder() {
  const to = activeTab().to, { tab, detail } = route()
  if (!detail) return showActive()
  if (tab !== hashOf(to)) history.replaceState(history.state, "", `#${hashOf(to)}/${detail}`)
  notify()
}

/** A group left with `tabs` (none: it closes, and the tree closes up around it). A pop-out whose last tab closed closes. */
function leave(gid: string, tabs: Tab[], active: string) {
  set(withGroup(gid, (g) => ({ ...g, tabs, active })))
  if (POPOUT && tabCount() === 1 && isBlank(activeTab())) { window.close(); return }
  showActiveUnder()
}

/** How many tabs are open, in every pane (the phone's tab switcher button). */
export const tabCount = (ws: Workspace = state) => leaves(ws.root).reduce((n, g) => n + g.tabs.length, 0)

/** Plugins' views hear a tab closed (a terminal ends its shell) only once no tab anywhere still shows that place (other
 *  workspaces too: `setOpenElsewhere`). Moving a tab isn't closing it. */
let onClosed: ((to: string) => void) | null = null
export const setTabCloser = (fn: (to: string) => void) => { onClosed = fn }
/** Whether a place is open in tabs kept elsewhere (Workspaces: the other workspaces' tabs). Set by the app. */
let elsewhere: (to: string) => boolean = () => false
export const setOpenElsewhere = (fn: (to: string) => boolean) => { elsewhere = fn }
/** The views whose last tab is among `tabs` (each once). */
function lastOf(tabs: Tab[]) {
  const going = new Set(tabs.map((t) => t.id))
  const left = new Set(groups().flatMap((g) => g.tabs).filter((t) => !going.has(t.id)).map((t) => t.to))
  return [...new Set(tabs.map((t) => t.to))].filter((to) => to.startsWith("view:") && !left.has(to) && !elsewhere(to))
}
const closed = (tabs: Tab[]) => { remember(tabs); for (const to of lastOf(tabs)) onClosed?.(to) }

/** Tabs closed lately, for ⌘⇧T, with their pane and place. Not blank tabs, nor views that end with their tab (a
 *  terminal's shell). */
const reopenable: { tab: Tab; group: string; at: number }[] = []
function remember(tabs: Tab[]) {
  const ending = new Set(lastOf(tabs).filter(keeps))
  // The last first: reopened one by one, each goes back in front of those after it.
  for (const t of [...tabs].reverse()) {
    const g = groupOfTab(t.id)
    if (!g || isBlank(t) || ending.has(t.to)) continue
    reopenable.push({ tab: { id: t.id, to: t.to, back: t.back, fwd: t.fwd, ...(t.pinned ? { pinned: true } : {}) }, group: g.id, at: g.tabs.indexOf(t) })
  }
  reopenable.splice(0, Math.max(0, reopenable.length - 50))
}
export const canReopenTab = () => reopenable.length > 0
/** Reopen the tab closed last where it was (its pane gone: the focused one), with its history; skips ones open again
 *  or `gone`. A blank active tab there makes way for it. */
export function reopenTab(gone: (to: string) => boolean = () => false) {
  let last = reopenable.pop()
  while (last && (findOpen(last.tab.to) || gone(last.tab.to))) last = reopenable.pop()
  if (!last) return
  const r = last, { tab } = r
  const gid = groups().some((g) => g.id === r.group) ? r.group : state.focus
  set(withGroup(gid, (g) => {
    const cur = shownTab(g)
    const tabs = g.tabs.filter((t) => t.id !== tab.id && !(isBlank(t) && t === cur))
    const at = Math.min(r.at, tabs.length)
    return { ...g, tabs: [...tabs.slice(0, at), tab, ...tabs.slice(at)], active: tab.id }
  }, { focus: gid }))
  show(tab.to, !isDesktop())
}

/** Before tabs close, their views may ask first (a terminal with a program running in it): resolves true to go ahead.
 *  Set by the app; tabs that aren't views never ask, and they close at once. */
let closeGuard: ((tos: string[]) => Promise<boolean>) | null = null
export const setCloseGuard = (fn: (tos: string[]) => Promise<boolean>) => { closeGuard = fn }
/** Run `close` now, or once the views among `tabs` said yes (only those whose last tab it is: see `closed`). */
export function guarded(tabs: Tab[], close: () => void) {
  const views = lastOf(tabs)
  if (!views.length || !closeGuard) return close()
  void closeGuard(views).then((ok) => { if (ok) close() })
}

/** Close a tab (`force`: without its view asking first, e.g. its shell already ended). */
export function closeTab(id: string, force = false) {
  const g = groupOfTab(id)
  if (!g) return
  if (!force) return guarded(g.tabs.filter((t) => t.id === id), () => closeTab(id, true))
  closed(g.tabs.filter((t) => t.id === id))
  const rest = g.tabs.filter((t) => t.id !== id)
  leave(g.id, rest, nextActive(g, id, rest))
}

/** Close several tabs at once (the tab menu: others, to the right, all); keeps `id` open if it's left, and pinned
 *  tabs. */
export function closeTabs(which: "others" | "right" | "all", id: string, force = false) {
  const g = groupOfTab(id)
  if (!g) return
  const i = g.tabs.findIndex((t) => t.id === id)
  const kept = which === "others" ? [g.tabs[i]] : which === "right" ? g.tabs.slice(0, i + 1) : []
  const rest = g.tabs.filter((t) => kept.includes(t) || t.pinned)
  if (!force) return guarded(g.tabs.filter((t) => !rest.includes(t)), () => closeTabs(which, id, true))
  closed(g.tabs.filter((t) => !rest.includes(t)))
  leave(g.id, rest, rest.some((t) => t.id === g.active) ? g.active : rest.some((t) => t.id === id) ? id : rest[0]?.id ?? id)
}

/** Close the tabs `ids` (selected together: core/select.ts), wherever they are, pinned ones too: they were picked.
 *  `keep`: close every other tab in their panes instead (pinned ones stay). */
export function closeTabIds(ids: string[], { keep = false, force = false }: { keep?: boolean; force?: boolean } = {}) {
  const chosen = new Set(ids)
  const panes = groups().filter((g) => g.tabs.some((t) => chosen.has(t.id)))
  const going = panes.flatMap((g) => g.tabs.filter((t) => (keep ? !chosen.has(t.id) && !t.pinned : chosen.has(t.id))))
  if (!going.length) return
  if (!force) return guarded(going, () => closeTabIds(ids, { keep, force: true }))
  closed(going)
  const gone = new Set(going.map((t) => t.id))
  for (const g of panes) {
    const now = groups().find((x) => x.id === g.id)
    if (!now) continue
    const rest = now.tabs.filter((t) => !gone.has(t.id))
    leave(now.id, rest, rest.some((t) => t.id === now.active) ? now.active : rest[0]?.id ?? now.active)
  }
}

/** Rename a file from elsewhere (the tab menu): its bar's name turns into a field once the file shows. */
let toRename: string | null = null
export function askRename(path: string) { toRename = path; dispatchEvent(new Event("vaultite:rename")) }
export const takeRename = (path: string) => { if (toRename !== path) return false; toRename = null; return true }

/** A new tab, in the focused group (or `gid`'s: its tab bar's +), next to the active one: a blank tab, one per pane
 *  (the blank tab it has already moves next to the active one instead; none, or the active one itself: nothing moves). */
export function newTab(gid = state.focus) {
  set(withGroup(gid, (g) => {
    if (isBlank(shownTab(g))) return g
    const blank = g.tabs.find(isBlank) ?? { id: newId(), to: "new" }
    const tabs = g.tabs.filter((t) => t.id !== blank.id)
    const at = tabs.findIndex((t) => t.id === g.active) + 1
    return { ...g, tabs: [...tabs.slice(0, at), blank, ...tabs.slice(at)], active: blank.id }
  }, { focus: gid }))
  show("new", true)
}

// ---------- files moving and going (core/files.ts calls these after the server did it) ----------

/** Every tab in every group, changed by `fn`. */
function everyTab(fn: (t: Tab) => Tab): Workspace {
  return { ...state, root: mapGroups(state.root, (g) => ({ ...g, tabs: g.tabs.map(fn) })) }
}

/** A file was renamed or moved (or a folder with it): tabs showing it follow. */
export function retarget(from: string, to: string) {
  const map = (p: string) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : null)
  let changed = false
  const one = (to: string) => {
    const m = isFile(to) ? map(to.slice(5)) : null
    if (m === null) return to
    changed = true
    return `file:${m}`
  }
  const next = everyTab((t) => ({ ...t, to: one(t.to), back: t.back?.map(one), fwd: t.fwd?.map(one) }))
  const moved = changed
  for (const r of reopenable) r.tab = { ...r.tab, to: one(r.tab.to), back: r.tab.back?.map(one), fwd: r.tab.fwd?.map(one) }
  if (!moved) return
  set(next)
  const cur = activeTab()
  if (isFile(cur.to)) history.replaceState(history.state, "", `#${hashOf(cur.to)}`)
  notify()
}

const showing = (path: string) => (to: string) => isFile(to) && (to.slice(5) === path || to.slice(5).startsWith(`${path}/`))

/** Close the tabs showing a file, or what's in a folder (archived: out of the way, like Mail's); they stay reopenable.
 *  Returns whether any was. */
export function closeFileTabs(path: string) {
  const ids = groups().flatMap((g) => g.tabs).filter((t) => showing(path)(t.to)).map((t) => t.id)
  for (const id of ids) closeTab(id, true)
  return ids.length > 0
}

/** A file or folder was deleted: close its tabs, and it leaves every tab's history. */
export function dropTabs(path: string) {
  const gone = showing(path)
  const clean = (l?: string[]) => l?.filter((to) => !gone(to)).filter((to, i, a) => to !== a[i - 1])
  set(everyTab((t) => ({ ...t, back: clean(t.back), fwd: clean(t.fwd) })))
  closeFileTabs(path)
  for (let i = reopenable.length - 1; i >= 0; i--) if (gone(reopenable[i].tab.to)) reopenable.splice(i, 1)
}
