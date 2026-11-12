// The tabs on screen: a list of tabs (core/layout.ts), each a split tree of panes with their own history. This device's
// (localStorage), or with Workspaces the workspace's, shared across devices; a pop-out has its own list in it.
import { backDetail, hashChanged, route } from "@/core/nav"
import { isDesktop } from "@/core/platform"
import {
  HISTORY, allPanes, beside, blankList, clean, cleanLayout, fixGroups, focusedPane, foldedAway, inGroup, isBlank, isBlankTab, isSplit, mapPane, mapPanes, mapPlaces, mapTab, mapTabs, migrate, moveOn,
  newPaneId, newTabId, panesOf, paneWith, placesIn, placesOf, putBack, settledTab, showingPlace, shownTab, spilled, spotOf, tabOf, tabOfPane, tabWith, tabWithout, vaultPath, withPlace, withoutTabs,
  type Group, type Pane, type Spot, type Tab, type TabList, type Window, type Workspace,
} from "../../../core/layout.ts"
import { signal } from "@/core/signal"
import { tabsChanged } from "@/core/tabevents"

const enc = encodeURIComponent
/** This window is a pop-out (`?popout=<id>`: tabs moved or opened out of the main window, popOut): its own list in the
 *  workspace (`windows`), no sidebars. */
const POPOUT = new URLSearchParams(location.search).get("popout")
export const isPopout = () => !!POPOUT
export const popoutId = () => POPOUT
const KEY = "vaultite.tabs"
/** While Workspaces holds the tabs: theirs as last shown here (the app starts on them), apart from this device's own
 *  (KEY), which come back as they were when it lets go (tabsInWorkspace). */
const HELD = "vaultite.tabs.workspace"
let held = (() => { try { return localStorage.getItem(HELD) !== null } catch { return false } })()
const tabKey = () => (held ? HELD : KEY)
if (POPOUT) document.documentElement.dataset.popout = "" // (index.css: the lights' room)
/** This pop-out's bars are hidden (Window.barsHidden): this window's own, whatever another's copy says. */
let barsOff = false
const tabStore = () => localStorage

/** Nothing was saved on this device yet: its first tab is blank until where it starts is known (fillFirstTab). */
let unsaved = false
/** Asked to start on a new tab (the crash screen's "Reload with a new tab"): the tabs come back with a new tab shown, so
 *  the one that stopped the app isn't drawn. Workspaces saves that rather than undoes it. */
export const startedFresh = (() => {
  try { const v = sessionStorage.getItem("vaultite.freshStart"); sessionStorage.removeItem("vaultite.freshStart"); return !!v } catch { return false }
})()
/** What a page saved before tabs held panes: one group (`{tabs, active}`), or a main one and a right split. */
function older(t: Record<string, unknown>): unknown {
  if (Array.isArray(t.groups) && !Array.isArray(t.tabs)) return migrate({ root: { id: "s0", dir: "row", kids: t.groups.slice(0, 2), sizes: [1 - (Number(t.split) || 0.42), Number(t.split) || 0.42] } })
  if (Array.isArray(t.tabs) && t.tabs.some((x) => x && typeof x === "object" && !("root" in x))) return migrate({ root: { id: "g0", tabs: t.tabs, active: t.active } })
  return t
}
function load(): Workspace {
  try {
    const t = JSON.parse(tabStore().getItem(tabKey()) ?? "null") as Record<string, unknown> | null
    let w = t ? clean(older(t)) : null
    // (a pop-out opened just now has its tabs handed over: popOut)
    if (POPOUT && !w?.windows?.some((x) => x.id === POPOUT)) {
      const handed = clean(JSON.parse(sessionStorage.getItem(`vaultite.popout.${POPOUT}`) ?? "null"))
      if (handed) w = { ...(w ?? blankList()), windows: [...(w?.windows ?? []), { id: POPOUT, tabs: handed.tabs, ...(handed.groups ? { groups: handed.groups } : {}), active: handed.active }] }
    }
    barsOff = !!POPOUT && !!w?.windows?.find((x) => x.id === POPOUT)?.barsHidden
    if (w && startedFresh) w = withList(w, fresh(listIn(w)))
    if (w) return w
  } catch { /* private mode */ }
  unsaved = true
  return blankList()
}
/** The tabs again, a new blank tab shown (startedFresh). */
function fresh(l: TabList): TabList {
  const kept = l.tabs.filter((t) => !isBlankTab(t)), blank = tabOf("new")
  return { ...l, tabs: [...kept, blank], active: blank.id }
}
/** This window's list in workspace `w`. */
const listIn = (w: Workspace): TabList => (POPOUT ? w.windows?.find((x) => x.id === POPOUT) ?? { tabs: [], active: "" } : w)
/** Workspace `w` with this window's list `l`. */
function withList(w: Workspace, l: TabList): Workspace {
  const own = { tabs: l.tabs, ...(l.groups ? { groups: l.groups } : {}), active: l.active }
  if (!POPOUT) return { ...own, ...(w.windows?.length ? { windows: w.windows } : {}) }
  const win: Window = { id: POPOUT, ...own, ...(barsOff ? { barsHidden: true } : {}) }
  const ws = w.windows ?? []
  return { ...w, windows: ws.some((x) => x.id === POPOUT) ? ws.map((x) => (x.id === POPOUT ? win : x)) : [...ws, win] }
}

/** The file in the focused pane or, while that shows something else (a view, like the links pane), the file focused
 *  last, and the pane it's in: what a view that follows the other panes shows (a linked pane). */
export type FocusedFile = { path: string; pane: string }
let lastFile: FocusedFile = { path: "", pane: "" }
function noteFile() {
  const p = activePane(), to = p?.to ?? ""
  if (to.startsWith("file:") && (to.slice(5) !== lastFile.path || p!.id !== lastFile.pane)) lastFile = { path: to.slice(5), pane: p!.id }
  else if (lastFile.path && !allPanes(here()).some((x) => x.id === lastFile.pane && x.to === `file:${lastFile.path}`)) lastFile = { path: "", pane: "" } // (its pane closed)
}
let state = load()
const changed = signal()
/** This window's tabs. */
export const here = (): TabList => listIn(state)
noteFile()

/** The next list of this window's tabs, tidied: tabs as they must be (settledTab), groups too (fixGroups), with none
 *  left a blank tab. */
export function set(next: TabList) {
  const was = here(), wasTab = was.active, wasPane = activePane()?.id ?? ""
  const tabs = spilled(next).tabs.map(settledTab)
  let l: TabList = tabs.length ? fixGroups({ ...next, tabs, active: tabs.some((t) => t.id === next.active) ? next.active : tabs[0].id }) : blankList()
  l = stamped(l, was)
  state = withList(state, l)
  quietNow = replacing || quiet > 0
  const p = activePane()
  if (p?.float) raised = [...raised.filter((id) => id !== p.id), p.id]
  save()
  if (l.active !== wasTab) { if (!kin(wasTab, l.active)) openers.clear(); if (lastChild?.opener !== l.active) lastChild = null; leftTab(wasTab) }
  noteFile()
  tabsChanged(was, l, wasPane, p?.id ?? "")
  changed.notify()
}
/** Kept on this device, this window's list put into what's kept (another window's are theirs). */
function save() {
  try {
    const kept = clean(JSON.parse(tabStore().getItem(tabKey()) ?? "null"))
    tabStore().setItem(tabKey(), JSON.stringify(kept ? mineInto(kept) : state))
  } catch { /* private mode */ }
}
/** Workspace `w` (saved elsewhere: another window, another device) with this window's own tabs: the main window's list
 *  and which pop-outs there are (it opens and closes them), or a pop-out's list. */
export function mineInto(w: Workspace): Workspace {
  if (POPOUT) return withList(w, here())
  const theirs = new Map((w.windows ?? []).map((x) => [x.id, x]))
  const windows = (state.windows ?? []).map((x) => theirs.get(x.id) ?? x)
  return { ...withList({ ...w, windows: [] }, state), ...(windows.length ? { windows } : {}) }
}
// Another window of this device saved: its tabs are taken in (this one's stay as they are).
addEventListener("storage", (e) => {
  if (e.key !== tabKey() || !e.newValue || replacing) return
  try { const w = clean(JSON.parse(e.newValue)); if (w) adopt(w) } catch { /* not ours */ }
})
/** The other windows' tabs from `w`, this one's as they are. */
function adopt(w: Workspace) {
  const next = POPOUT ? { ...withList(w, here()) } : { ...withList(w, here()), ...(w.windows?.length ? { windows: w.windows } : {}) }
  if (JSON.stringify(next.windows ?? []) === JSON.stringify(state.windows ?? [])) return
  state = next
  changed.notify()
}

export const getWorkspace = () => state
let quiet = 0, quietNow = false
/** Run `fn`, its layout changes drawn at once rather than moving there (a divider or a floating pane dragged). */
export function quietly<T>(fn: () => T): T { quiet++; try { return fn() } finally { quiet-- } }
/** Whether the latest change is drawn at once (quietly, or a whole layout put in place). */
export const layoutQuiet = () => quietNow
/** Floating panes focused, the last one latest: the one drawn on top. */
let raised: string[] = []
export const floatOrder = (ids: string[]) => [...ids.filter((id) => !raised.includes(id)), ...raised.filter((id) => ids.includes(id))]
/** The whole workspace, live. */
export const useWorkspace = () => changed.use(() => state)
/** This window's tabs, live. */
export const useTabList = () => changed.use(here)
/** Run fn whenever the tabs or splits change (a tab opened, moved, navigated; a divider dragged). */
export const onWorkspaceChange = changed.subscribe
let replacing = false
/** The change being told is a whole layout put in place (replaceWorkspace): nothing the user did here. */
export const replacingWorkspace = () => replacing
/** Put a whole other workspace in place (Workspaces switching): what it takes away is reopenable as closed unless
 *  `kept` elsewhere (a switch, a move). `merge`: the same one changed on another device; what's on screen stays. */
export function replaceWorkspace(next: unknown, opts: { merge?: boolean; kept?: boolean } = {}) {
  unsaved = false
  let w: Workspace = clean(next) ?? blankList()
  if (opts.merge) {
    // What each device keeps for itself: the tab it shows, each tab's focused and zoomed pane, the panes' history.
    const mine = here(), tabs = new Map(mine.tabs.map((t) => [t.id, t])), panes = new Map(allPanes(mine).map((p) => [p.id, p]))
    const keep = (l: TabList): TabList => ({
      ...l,
      active: l.tabs.some((t) => t.id === mine.active) ? mine.active : l.active,
      tabs: l.tabs.map((t) => {
        const o = tabs.get(t.id)
        const root = mapPlaces(t.root, (p) => {
          const q = panes.get(p.id), seen = Math.max(p.seen ?? 0, q?.seen ?? 0) || undefined
          return q && q.to === p.to && !p.back && !p.fwd ? { ...p, back: q.back, fwd: q.fwd, from: q.from, seen } : seen === p.seen ? p : { ...p, seen }
        })
        return settledTab({ ...t, root, ...(o ? { focus: o.focus, zoom: o.zoom } : {}) })
      }),
    })
    w = withList(w, keep(listIn(w)))
  }
  replacing = true
  try {
    const was = here(), wasPane = activePane()?.id ?? ""
    state = { ...w }
    if (POPOUT && !w.windows?.some((x) => x.id === POPOUT)) state = withList(state, was)
    if (!opts.kept) rememberTaken(was, here())
    quietNow = true
    save()
    noteFile()
    tabsChanged(was, here(), wasPane, activePane()?.id ?? "")
    changed.notify()
  } finally { replacing = false }
  showActiveUnder()
}

/** Workspaces takes the tabs (`on`: what's shown and saved from now is a workspace's) or lets go of them: this device's
 *  own come back as they were left, so turning it on and off (a layout and back) loses nothing. True: it changed. */
export function tabsInWorkspace(on: boolean): boolean {
  if (on === held) return false
  if (on) { held = true; save(); return true }
  let own: Workspace | null = null
  try { tabStore().removeItem(HELD); const t = JSON.parse(tabStore().getItem(KEY) ?? "null"); own = t ? clean(older(t)) : null } catch { /* private mode */ }
  held = false
  replaceWorkspace(own ?? blankList())
  return true
}

/** A device's first visit (nothing saved, no workspace put in place): its blank tab shows `to` (a plugin's `home`: the
 *  first pinned page), unless the address asks for something else (a deep link) or something was opened meanwhile. */
export function fillFirstTab(to: string) {
  if (!unsaved) return
  unsaved = false
  if (![undefined, "", "new"].includes(route().tab)) return
  const l = here()
  if (l.tabs.length !== 1 || !isBlankTab(l.tabs[0])) return
  set(mapPane(l, l.tabs[0].focus, (p) => ({ ...p, to })))
  showActive()
}

export const useFocusedFile = () => changed.use(() => lastFile)
/** Whether the focused pane shows a file (not a view or a blank pane). */
export const useFileTab = () => changed.use(() => !!activePane()?.to.startsWith("file:"))
/** The tab on screen in this window. */
export function activeTab(): Tab { return shownTab(here()) ?? here().tabs[0] }
/** The pane focused in the tab on screen: where the address, the commands and what's opened go. */
export function activePane(): Pane { const t = activeTab(); return t && focusedPane(t) }
/** The panes of the tab on screen. */
export const panes = () => (activeTab() ? panesOf(activeTab()) : [])
/** This window's tabs. */
export const tabs = () => here().tabs
export const tabById = (id: string) => here().tabs.find((t) => t.id === id)
/** The tab that has pane `id` (in this window). */
export const paneTab = (id: string) => tabOfPane(here(), id)
/** The panes showing any of these targets ("file:Inbox/A.md"), in every tab of this window. */
export const panesShowing = (...to: string[]) => allPanes(here()).filter((p) => to.includes(p.to))
export const paneById = (id: string) => allPanes(here()).find((p) => p.id === id)
/** The vault file in the focused pane ("" when it shows something else, or a file from outside the vault). */
export const currentFile = () => vaultPath(activePane()?.to ?? "") ?? ""
/** This window's list with pane `id` changed. */
export const withPane = (id: string, fn: (p: Pane) => Pane): TabList => mapPane(here(), id, fn)
/** This window's list with tab `id` changed. */
export const withTab = (id: string, fn: (t: Tab) => Tab, extra: Partial<TabList> = {}): TabList => ({ ...mapTab(here(), id, fn), ...extra })

/** The hash for a target: "file/Notes%2FIdea.md", "view/terminal%2Fabc", "new". */
export const hashOf = (to: string) => (to.startsWith("file:") ? `file/${enc(to.slice(5))}` : to.startsWith("view:") ? `view/${enc(to.slice(5))}` : to)
/** The target for a route's tab ("file/Notes%2FIdea.md" -> "file:Notes/Idea.md"). */
export function targetOf(tab: string) {
  for (const k of ["file", "view"]) {
    if (tab.startsWith(`${k}/`)) { try { return `${k}:${decodeURIComponent(tab.slice(5))}` } catch { return `${k}:${tab.slice(5)}` } }
  }
  return tab
}
const isFile = (to: string) => to.startsWith("file:")

/** Back (-1) or forward (1) in the focused pane's history. Back closes an open sheet first; Back from the first place
 *  of a pane opened for something (`from`) closes it and shows that one again, like a browser tab opened from a link. */
export function navigate(dir: -1 | 1) {
  if (dir < 0 && route().detail) return backDetail()
  const cur = activePane()
  // (its own history is asked, not what it last told: a key just after a page moved went nowhere)
  const own = ownHistory(cur, dir)
  if (own) return void own.go().then((went) => { if (!went && activePane().id === cur.id) walkPane(dir) })
  walkPane(dir)
}
function walkPane(dir: -1 | 1) {
  const cur = activePane()
  const back = [...(cur.back ?? [])], fwd = [...(cur.fwd ?? [])]
  const to = dir < 0 ? back.pop() : fwd.shift()
  if (!to && dir < 0 && opener(cur)) { const from = cur.from!; return guarded([cur], () => { closePane(cur.id, true); selectPane(from) }) }
  if (!to) return
  if (dir < 0) fwd.unshift(cur.to); else back.push(cur.to)
  set(withPane(cur.id, (p) => ({ ...p, to, back, fwd })))
  show(to, false)
}
export const canNavigate = (p: Pane | undefined, dir: -1 | 1) => !!(dir < 0 ? p?.back : p?.fwd)?.length || (dir < 0 && !!opener(p)) || (!!p && !!ownHistory(p, dir)?.can)
/** A view's own history (a web page's), walked before its pane's, in pane `p` (null: it has none now). Set by the app. */
let ownHistory: (p: Pane, dir: -1 | 1) => OwnHistory | null = () => null
export const setOwnHistory = (fn: typeof ownHistory) => { ownHistory = fn }
/** `can`: it can go that way, as it last told; `go`: go if it can now, answering whether it went. */
export type OwnHistory = { can: boolean; go: () => Promise<boolean> }
/** The pane `p` was opened from, if it's still open. */
const opener = (p: Pane | undefined) => (p?.from && p.from !== p.id && paneById(p.from) ? p.from : null)

/** Each history entry says which pane it's a place of (`pane`: phones find the one to go back to by it; followHash). */
type Entry = { pane?: string; sheet?: number; prev?: string } | null
const entry = () => history.state as Entry
/** The address shows `to` (a new history entry with `push`). */
export function show(to: string, push: boolean) {
  const h = `#${hashOf(to)}`
  if (location.hash === h) { stamp(); return hashChanged() }
  const st = { pane: activePane().id }
  if (push) history.pushState(st, "", h); else history.replaceState(st, "", h)
  hashChanged()
}
/** Mark the entry on screen as the focused pane's place, if nothing said whose it is (a link followed, a sheet closed). */
function stamp() {
  const e = entry()
  if (!e?.pane) history.replaceState({ ...e, pane: activePane().id }, "")
}
// The address changed to what the focused pane shows (a sheet opened or closed over it): that entry is this pane's. A
// new place (a link) is stamped once followHash has put it in a pane.
addEventListener("hashchange", () => { if (targetOf(route().tab) === activePane().to) stamp() })
/** The address shows the focused pane. */
export const showActive = () => show(activePane().to, false)

/** What sort of thing a pane shows, for go(): a page, a file, or a view by name, so Graph view never replaces a
 *  terminal. A view that keeps its pane (`keepsTab`) is a sort of its own: nothing opens in its place. */
function sortOf(to: string) {
  if (to.startsWith("view:")) return keeps(to) ? to : `view:${to.slice(5).split("/")[0]}`
  return isFile(to) && !isPage(to.slice(5)) ? "file" : "page"
}
/** Whether a view's pane is its own (ViewDef.keepsTab). Set by the app, which knows the views. */
let keeps: (to: string) => boolean = () => false
export const setTabKeeper = (fn: (to: string) => boolean) => { keeps = fn }
export const keepsTab = (to: string) => keeps(to)
/** Whether a view's arg is a vault path (ViewDef.pathArg: a folder's page), which retarget follows. Set by the app. */
let pathView: (to: string) => boolean = () => false
export const setPathView = (fn: (to: string) => boolean) => { pathView = fn }
/** The pane a new tab of `to` opens beside (ViewDef.opensBeside: a session dispatched from a note, by that note's), or
 *  null for the current one. Set by the app, which knows the views. */
let besideOf: (to: string) => string | null = () => null
export const setOpener = (fn: (to: string) => string | null) => { besideOf = fn }
/** Whether a file is a page (core/pages.ts isPage). Set by the app, which knows the plugins. */
let isPage: (path: string) => boolean = () => false
export const setPageTest = (fn: (path: string) => boolean) => { isPage = fn }

/** Where a target is open (any of several: a page's tabs): the tab and pane, the tab on screen first. */
export function findOpen(...to: string[]) {
  for (const t of [activeTab(), ...here().tabs.filter((x) => x.id !== here().active)]) {
    if (!t) continue
    const p = (t.id === here().active ? [focusedPane(t), ...panesOf(t), ...placesIn(t)] : placesIn(t)).find((x) => to.includes(x.to))
    if (p) return { t, p }
  }
  return null
}

/** Show pane `p` of tab `t`, which has what was just opened from the focused pane: a blank tab is left behind closed.
 *  `from`: it was opened from that pane (Pane.from). */
function switchTo(t: Tab, p: Pane, from?: string) {
  const cur = activeTab()
  let l = withTab(t.id, (x) => ({ ...showingPlace(from ? { ...x, root: mapPlaces(x.root, (y) => (y.id === p.id ? { ...y, from } : y)) } : x, p.id), focus: p.id }), { active: t.id })
  if (isBlankTab(cur) && cur.id !== t.id) l = withoutTabs(l, new Set([cur.id])) ?? l
  set(l)
}

/** Where the tabs made now go (`newTabsAt`): beside the tab they're opened from, in its group (a link); "new": past the
 *  tab on screen's group, as ⌘T; "end": the list's end; "pane": the focused pane's own, a terminal's too (its strip's +). */
export type TabsAt = "new" | "end" | "pane" | undefined
let placing: TabsAt
/** Runs `fn` with the tabs it makes put as a new tab is, in no tab group: beside the tab on screen, past its group
 *  (⌘T), or at the list's end (a tab bar's + and the Tabs panel's New tab row, whose place the new tab takes). */
export function newTabsAt<T>(at: TabsAt, fn: () => T): T {
  const was = placing
  placing = at
  try { return fn() } finally { placing = was }
}

/** Where in `l` a tab made now after tab `after` goes, and the tab group it joins (`how`: `placing`). */
function placeAfter(l: TabList, after: string, how = placing): { at: number; group?: string } {
  if (how === "end") return { at: l.tabs.length }
  let at = l.tabs.findIndex((t) => t.id === after) + 1
  const group = l.tabs[at - 1]?.group
  if (!how) return { at, group }
  while (group && l.tabs[at]?.group === group) at++
  return { at }
}

/** The pane of the tab on screen that `to` opens in: the focused one when it shows the same sort of thing (or
 *  nothing), else another of the tab's that does (a split's note beside its terminal), else none (a new tab). */
function paneFor(to: string, newTab: boolean): Pane | null {
  const t = activeTab(), cur = activePane()
  if (isBlank(cur)) return cur
  if (newTab || t.pinned) return null
  const fits = (p: Pane) => isBlank(p) || (sortOf(p.to) === sortOf(to) && !keeps(p.to))
  return fits(cur) ? cur : panesOf(t).find((p) => p.id !== cur.id && fits(p)) ?? null
}

let asked: { front: boolean; item: boolean } | null = null
export const setClickOpens = (how: typeof asked) => { asked = how }
/** How the click under way asks to open (core/links.ts sets it): ⌘ or a middle click, a new tab behind (`front`: ⌘⇧);
 *  `item`: on an in-app item (a row, a link), whatever its handler opens goes there. null: a plain click. */
export const clickOpening = () => asked

/** Go somewhere: a pane that has it, else the focused pane (or another of its split) showing the same sort of thing or
 *  nothing, else a new tab beside it (a person from People: Back returns there). Blank tabs are never kept. */
export function go(to: string, newTab = false, push = true) {
  if (asked && (newTab || asked.item)) return void openTab(to, { background: !asked.front, ...(intoPane(activeTab()) ? { from: activePane().id } : {}) })
  const cur = activePane()
  const open = findOpen(to)
  // Opened from a page into a tab of its own (not asked for one): Back returns to the page.
  const from = !newTab && !isBlank(cur) && sortOf(cur.to) === "page" && sortOf(to) !== "page" ? cur.id : undefined
  // Another tab: on phones a history entry, like selectTab (Back returns to the tab it was opened from).
  if (open && (!newTab || isBlank(cur))) {
    switchTo(open.t, open.p, open.p.id === cur.id || open.t.id === activeTab().id ? undefined : from)
    return show(to, push && !isDesktop() && open.p.id !== cur.id && !isBlank(cur))
  }
  // Opened by another pane (its opener): a tab beside that one's, in its tab group, as a browser opens a link.
  const by = isBlank(cur) || placing ? null : besideOf(to)
  const at = by && by !== cur.to ? findOpen(by) : null
  if (at) {
    set(intoPane(at.t, at.p.id) ? withNewPlace(at.t.id, at.p.id, { id: newPaneId(), to }) : withTabAfter(here(), at.t.id, to))
    return show(to, push)
  }
  const into = paneFor(to, newTab)
  if (into) {
    set(withTab(activeTab().id, (t) => ({ ...t, focus: into.id, root: mapPanes(t.root, (p) => (p.id === into.id ? moveOn(p, to) : p)) })))
    return show(to, push)
  }
  // (in a split, a new tab is one of the focused pane's own)
  if (intoPane(activeTab())) {
    set(withNewPlace(activeTab().id, cur.id, { id: newPaneId(), to, ...(from ? { from } : {}) }))
    return show(to, push)
  }
  set(withTabAfter(here(), activeTab().id, to, from))
  if (from) openers.set(activeTab().id, here().tabs.find((t) => panesOf(t).some((p) => p.id === from))?.id ?? "")
  show(to, push)
}

/** Whether a new tab from pane `from` of tab `t` is one of that pane's own (Pane.stack): a split's, unpinned, not keeping
 *  its view (a terminal's go in the list) unless asked for there, nor asked for at the list's end (a tab bar's +). */
const intoPane = (t: Tab, from = focusedPane(t).id) => isSplit(t.root) && !t.pinned && placing !== "end" && (placing === "pane" || !keeps(paneWith(t.root, from)?.to ?? ""))
/** This window's list with place `p` among the tabs of the pane that has place `at` (after it), shown and focused there
 *  (`show` false: stacked behind), its tab on screen. */
function withNewPlace(tab: string, at: string, p: Pane, show = true): TabList {
  return withTab(tab, (t) => { const x = withPlace(t, at, p, { show }); return show ? { ...x, focus: p.id } : x }, show ? { active: tab } : {})
}
/** `to` as a new tab in pane `pane` (one of its own in a split; a tab of one pane's, a tab after it), shown and focused:
 *  an agent's open `in` a pane the user named. One of that pane's tabs showing it already is shown. Returns its pane. */
export function openInPane(pane: string, to: string): string {
  const t = tabOfPane(here(), pane), p = t && paneWith(t.root, pane)
  if (!t || !p) throw new Error(`no pane ${pane} (vau tabs lists them)`)
  const had = placesOf(p).find((x) => x.to === to)
  if (had) { selectPane(had.id); return had.id }
  if (!isSplit(t.root)) {
    set(withTabAfter(here(), t.id, to))
    show(to, true)
    return activePane().id
  }
  const id = newPaneId()
  set(withNewPlace(t.id, p.id, { id, to }))
  show(to, true)
  return id
}
/** The place opened last behind `opener` (a pane's place), while it stays focused: the next opened from it goes after
 *  it, as Chrome's do. */
let lastPlace: { opener: string; place: string } | null = null

/** Chrome's openers (tab: the tab it was opened from), what closing a tab goes on to (closeTab: openerNext): kept while
 *  the user moves among a tab, those it opened and their siblings; a tab opened in front forgets the others'. */
const openers = new Map<string, string>()
const kin = (a: string, b: string) => {
  const oa = openers.get(a), ob = openers.get(b)
  return oa === b || ob === a || (!!oa && oa === ob)
}
/** The tab opened last from `opener` while it stayed on screen: the next opened from it goes after it (Chrome's order). */
let lastChild: { opener: string; tab: string } | null = null

/** `to` in a new tab though another may show it, after pane `from`'s tab (default: the one on screen) and those it opened,
 *  in its group; `background`: the user stays (agents'). `id`: the new pane's (a page handed it first). Returns it. */
export function openTab(to: string, { background = false, from, id = newPaneId() }: { background?: boolean; from?: string; id?: string } = {}): string {
  const l = here(), owner = (from && tabOfPane(l, from)) || activeTab(), cur = activePane()
  if (!from && !background && isBlankTab(owner)) {
    const t: Tab = { ...tabOf(to, { pane: id, id: owner.id }), ...(owner.group && !placing ? { group: owner.group } : {}) }
    set({ ...mapTab(l, owner.id, () => t), active: t.id })
    show(to, true)
    return id
  }
  const fromPane = from && placesIn(owner).some((p) => p.id === from) ? from : owner.id === activeTab().id ? cur.id : focusedPane(owner).id
  // (in a split, one of the pane's own tabs: an agent's, which says no pane, goes in the list)
  if (intoPane(owner, fromPane) && (from || !background)) {
    const behind = background && lastPlace?.opener === fromPane && placesIn(owner).some((p) => p.id === lastPlace!.place) ? lastPlace.place : fromPane
    set(withNewPlace(owner.id, behind, { id, to, from: fromPane }, !background))
    if (background) lastPlace = { opener: fromPane, place: id }
    else show(to, true)
    return id
  }
  const tab = tabOf(to, { pane: id, from: fromPane })
  const after = background && lastChild?.opener === owner.id && l.tabs.some((t) => t.id === lastChild!.tab) ? lastChild.tab : owner.id
  const { at, group } = placeAfter(l, after)
  const placed = inGroup(tab, group)
  set({ ...l, tabs: [...l.tabs.slice(0, at), placed, ...l.tabs.slice(at)], active: background ? l.active : tab.id })
  openers.set(tab.id, owner.id)
  if (background) lastChild = { opener: owner.id, tab: tab.id }
  else show(to, true)
  return id
}

/** A list with a new tab showing `to` right after tab `after`, shown (`from`: the pane it was opened from, Pane.from),
 *  in `after`'s tab group, as a browser's link opened from a grouped tab is (or as a new tab is: `newTabsAt`). */
function withTabAfter(l: TabList, after: string, to: string, from?: string): TabList {
  const { at, group } = placeAfter(l, after)
  const tab = inGroup(tabOf(to, from ? { from } : {}), group)
  return { ...l, tabs: [...l.tabs.slice(0, at), tab, ...l.tabs.slice(at)], active: tab.id }
}

/** Change what a pane shows in place, with no history entry (a view's own state in its arg: a search's query as it's
 *  typed, `ViewCtx.setArg`). The address follows when it's the pane focused. */
export function replaceTabTarget(id: string, to: string) {
  const p = paneById(id)
  if (!p || p.to === to) return
  set(withPane(id, (x) => ({ ...x, to })))
  if (activePane().id === id) show(to, false)
}

/** Show `to` in the focused pane whatever it held (a page's tabs, List -> Map: the same place, its own history). */
export function goHere(to: string) {
  const cur = activePane()
  if (cur.to === to) return
  set(withPane(cur.id, (p) => moveOn(p, to)))
  show(to, true)
}

/** The address changed by itself (back, forward, a typed URL): show it in the pane that has it. Every place a phone
 *  shows is its own history entry, marked with its pane, so Back and Forward land on exactly what a swipe slid in. */
export function followHash(tab: string) {
  const to = targetOf(tab)
  let cur = activePane()
  if (cur.to === to) return stamp()
  const owner = isDesktop() ? undefined : entry()?.pane
  const t = owner && owner !== cur.id ? tabOfPane(here(), owner) : undefined
  if (t) { set(withTab(t.id, (x) => ({ ...showingPlace(x, owner!), focus: owner! }), { active: t.id })); cur = activePane(); if (cur.to === to) return }
  // A link (no owner yet): the pane that has it, as on desktop (a blank tab it was followed from closes: go).
  const open = findOpen(to)
  if (open && !owner) { switchTo(open.t, open.p); return stamp() }
  if (!isDesktop()) {
    const back = [...(cur.back ?? [])], fwd = [...(cur.fwd ?? [])]
    const walk = (x: Partial<Pane>) => { set(withPane(cur.id, (c) => ({ ...c, to, ...x }))); stamp() }
    if (back.at(-1) === to) { back.pop(); return walk({ back, fwd: [cur.to, ...fwd] }) }
    if (fwd[0] === to) { fwd.shift(); return walk({ back: [...back, cur.to].slice(-HISTORY), fwd }) }
  }
  if (open && !t) switchTo(open.t, open.p)
  else if (keeps(cur.to) || activeTab().pinned) set(withTabAfter(here(), activeTab().id, to))
  else set(withPane(cur.id, (p) => moveOn(p, to)))
  stamp()
}

/** Show a tab (false: there's none). On phones that's a history entry (Back returns to the tab that was on screen); on
 *  desktop the address just follows. */
export function selectTab(id: string) {
  const t = tabById(id)
  if (!t) return false
  set({ ...here(), active: id })
  show(focusedPane(t).to, !isDesktop())
  return true
}
/** Show pane `id`: its tab on screen, the pane focused (false: there's none). */
export function selectPane(id: string) {
  const t = tabOfPane(here(), id)
  if (!t) return false
  if (here().active === t.id && t.focus === id) return true
  set(withTab(t.id, (x) => ({ ...showingPlace(x, id), focus: id }), { active: t.id }))
  show(activePane().to, here().active !== t.id && !isDesktop())
  return true
}

/** The tabs on screen in this window since it opened, the one left last first (Search tabs' order). One shown only on
 *  the way to another isn't. */
const recent: string[] = []
let focusedAt = 0
function leftTab(id: string) {
  const held = Date.now() - focusedAt > 300
  focusedAt = Date.now()
  if (!held || !id) return
  const i = recent.indexOf(id)
  if (i > 0) recent.splice(i, 1)
  if (i !== 0) recent.unshift(id)
  recent.length = Math.min(recent.length, 200)
}
/** When a tab was last on screen (its panes' latest). */
export const seenOf = (t: Tab) => Math.max(0, ...panesOf(t).map((p) => p.seen ?? 0))
/** Every open tab, the one on screen first, then the others by when they were left here; those not shown since the
 *  window opened after them, by when they were last seen and their place. */
export function tabsByRecent(): Tab[] {
  const cur = here().active, order = new Map(recent.map((id, i) => [id, i]))
  const rank = (t: Tab) => (t.id === cur ? -1 : order.get(t.id) ?? Infinity)
  return here().tabs.map((t, i) => ({ t, i, r: rank(t) })).sort((a, b) => a.r - b.r || seenOf(b.t) - seenOf(a.t) || a.i - b.i).map((x) => x.t)
}

/** How many tabs this window has. */
export const tabsHere = () => here().tabs.length
/** How many tabs of its own the focused pane has (a split's: Pane.stack). */
export const placesHere = () => (activePane() ? placesOf(activePane()).length : 0)
/** The next (1) or previous (-1) tab, round from the last to the first (past folded groups); in a split's pane with tabs
 *  of its own, through those first, then on to the next tab. */
export function cycleTab(dir: 1 | -1) {
  const l = here(), open = l.tabs.filter((t) => !foldedAway(l, t) || t.id === l.active)
  const ps = placesOf(activePane()), at = ps.findIndex((p) => p.id === activePane().id)
  if (ps.length > 1 && (ps[at + dir] || open.length < 2)) return void selectPane(ps[(at + dir + ps.length) % ps.length].id)
  if (open.length < 2) return
  const i = open.findIndex((t) => t.id === l.active)
  selectTab(open[(i + dir + open.length) % open.length].id)
}
/** Show the nth tab (1-based; -1: the last), like a browser's ⌘1–⌘9. */
export function selectTabAt(n: number) {
  const l = here(), t = n < 0 ? l.tabs.at(-1) : l.tabs[n - 1]
  if (t) selectTab(t.id)
}

// ---------- pop-outs: windows with tabs of their own (core/windows.ts moves tabs between them) ----------

/** This pop-out shows only what it shows, no bars (Hide window bars), kept with its tabs (Window.barsHidden). */
export const barsHidden = () => barsOff
export const useBarsHidden = () => changed.use(barsHidden)
export function hideBars(on: boolean) {
  if (!POPOUT || on === barsOff) return
  barsOff = on
  state = withList(state, here())
  save()
  changed.notify()
}

/** The pop-outs this device opened, open now. */
const opened = new Map<string, globalThis.Window>()
/** The pop-outs this window opened that are still open, by id (core/windows.ts moves tabs between them all). */
export const openedWindows = () => [...opened].filter(([, w]) => !w.closed)
/** Open tabs `ids` in a window of their own (a pop-out: POPOUT), panes, history and all; `move`: and take them out of
 *  this one (not closed: a terminal's shell goes on there). `at`: the screen point to open it under (dragged out). */
export function popOut(ids: string | string[], move = false, at?: { x: number; y: number }) {
  const want = [ids].flat()
  const tabs = here().tabs.filter((t) => want.includes(t.id) && !isBlankTab(t))
  if (!tabs.length) return
  const shown = tabs.find((t) => t.id === here().active) ?? tabs.at(-1)!
  // (copied, a new window's tabs need ids of their own)
  const theirs = move ? tabs : tabs.map((t) => ({ ...t, id: newTabId(), root: mapPlaces(t.root, (p) => ({ ...p, id: newPaneId() })), focus: "" }))
  const list: TabList = { tabs: theirs.map((t) => ({ ...t, group: undefined })), active: theirs[tabs.indexOf(shown)].id }
  if (!openWindow(list, at)) return
  if (move) takeOut(tabs.map((t) => t.id))
  else { save(); changed.notify() }
  watchWindows()
}
/** A pop-out showing `list` (its ids its own), opened under the screen point `at`; false where the browser won't. */
function openWindow(list: TabList, at?: { x: number; y: number }) {
  const ok = clean(list)
  if (!ok) return false
  const pid = newTabId().slice(1)
  try { sessionStorage.setItem(`vaultite.popout.${pid}`, JSON.stringify(ok)) } catch { /* the workspace is enough */ }
  // (its first tab under the pointer: past a Mac's traffic lights, half a tab bar down)
  const place = at ? `,left=${Math.round(at.x - 120)},top=${Math.round(at.y - 20)}` : ""
  const first = focusedPane(shownTab(ok) ?? ok.tabs[0])
  const w = window.open(`${location.pathname}?popout=${pid}#${hashOf(first.to)}`, `vaultite-${pid}`, `popup,width=960,height=760${place}`)
  try { sessionStorage.removeItem(`vaultite.popout.${pid}`) } catch { /* private mode */ }
  if (!w) return false
  opened.set(pid, w)
  state = { ...state, windows: [...(state.windows ?? []), { id: pid, tabs: ok.tabs, ...(ok.groups ? { groups: ok.groups } : {}), active: ok.active }] }
  return true
}
let watching = 0
/** A pop-out closed: its tabs close with it, as a browser window's do. */
function watchWindows() {
  if (watching || POPOUT) return
  watching = window.setInterval(() => {
    const gone = [...opened].filter(([, w]) => w.closed).map(([id]) => id)
    if (!gone.length) return
    for (const id of gone) opened.delete(id)
    if (!opened.size) { clearInterval(watching); watching = 0 }
    // (as a browser's window, ⌘⇧T brings it back whole)
    for (const w of state.windows ?? []) if (gone.includes(w.id)) remember(w.tabs, [], { from: w, window: true, ending: false })
    const windows = (state.windows ?? []).filter((x) => !gone.includes(x.id))
    state = { tabs: state.tabs, ...(state.groups ? { groups: state.groups } : {}), active: state.active, ...(windows.length ? { windows } : {}) }
    save()
    changed.notify()
  }, 1000)
}
/** The pop-outs this device had open (a reload, a relaunch): opened again, or where a browser won't, their tabs back
 *  in this window. Others' (another device's) are theirs. */
export function reopenWindows() {
  if (POPOUT) return
  let mine: string[] = []
  try { mine = JSON.parse(localStorage.getItem("vaultite.popouts") ?? "[]") } catch { /* none */ }
  for (const w of state.windows ?? []) {
    if (!mine.includes(w.id) || opened.has(w.id)) continue
    const first = focusedPane(shownTab(w) ?? w.tabs[0])
    const win = window.open(`${location.pathname}?popout=${w.id}#${hashOf(first.to)}`, `vaultite-${w.id}`, "popup,width=960,height=760")
    if (win) { opened.set(w.id, win); continue }
    const l = here()
    state = { ...state, windows: state.windows!.filter((x) => x.id !== w.id) }
    set({ ...l, tabs: [...l.tabs, ...w.tabs.map((t) => inGroup(t, undefined))] })
  }
  if (opened.size) watchWindows()
}
onWorkspaceChange(() => {
  if (POPOUT) return
  try { localStorage.setItem("vaultite.popouts", JSON.stringify([...opened.keys()])) } catch { /* private mode */ }
})

/** Take tabs out of this window without closing them: they go on in another (popOut, core/windows.ts' moveToMain). */
export function takeOut(ids: string[]) {
  const going = here().tabs.filter((t) => ids.includes(t.id))
  for (const t of going) for (const p of placesIn(t)) if (p.to.startsWith("view:")) onClosed?.(p.to, p.id, false, true)
  leave(withoutTabs(here(), new Set(going.map((t) => t.id))))
}

/** Pin or unpin a tab (Tab.pinned): its panes' places now are where ⌘W takes them back. */
export function togglePinTab(id: string) {
  set(withTab(id, (t) => {
    if (t.pinned) { const { pinned: _, ...rest } = t; return { ...rest, root: mapPlaces(t.root, (p) => { const { home: _h, ...x } = p; return x }) } }
    return { ...t, pinned: true, root: mapPlaces(t.root, (p) => ({ ...p, home: p.to })) }
  }))
}
/** Name a tab (Tab.name: Rename tab), or "" to give it back the name of what it shows. */
export function nameTab(id: string, name: string) {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 80)
  set(withTab(id, (t) => { const { name: _, ...rest } = t; return clean ? { ...rest, name: clean } : rest }))
}
/** ⌘W on a pinned tab, as Arc's: the next tab shows, and a pane with a page of its own here (a web page) ends it and
 *  goes back to its `home`, as a fresh pane that loads it when shown; others (a note, a terminal) stay as they are. */
export function restTab(id: string) {
  const t = tabById(id)
  if (!t) return
  const root = mapPanes(t.root, (p) => {
    const ended = p.to.startsWith("view:") && !!onClosed?.(p.to, p.id, false, false)
    return ended ? { id: newPaneId(), to: p.home ?? p.to, ...(p.home ? { home: p.home } : {}), ...(p.float ? { float: p.float } : {}),
      ...(p.stack ? { stack: p.stack, ...(p.stackAt ? { stackAt: p.stackAt } : {}) } : {}) } : p
  })
  const ids = new Map(panesOf(t).map((p, i) => [p.id, panesOf({ ...t, root })[i].id]))
  const l = here(), active = l.tabs.length > 1 && l.active === id ? nextShown_(l, id) : l.active
  set({ ...mapTab(l, id, () => ({ ...t, root, focus: ids.get(t.focus) ?? t.focus, zoom: undefined })), active })
  showActiveUnder()
}
const nextShown_ = (l: TabList, id: string) => withoutTabs(l, new Set([id]))?.active ?? id

/** Clicking in a pane gives it the focus (the address shows it; commands act on it). */
export function setFocusedPane(id: string) {
  const t = activeTab()
  if (t.focus === id || !panesOf(t).some((p) => p.id === id)) return
  set(withTab(t.id, (x) => ({ ...x, focus: id })))
  showActive()
}

/** The address shows the focused pane, keeping a sheet that's open over it (tabs closed or moved from the phone's tab
 *  list, a sheet itself, leave it open). */
export function showActiveUnder() {
  const to = activePane().to, { tab, detail } = route()
  if (!detail) return showActive()
  if (tab !== hashOf(to)) history.replaceState(history.state, "", `#${hashOf(to)}/${detail}`)
  hashChanged()
}

/** This window's list now `l` (null: no tab left, a blank one). A pop-out whose last tab closed closes. */
function leave(l: TabList | null) {
  set(l ?? blankList())
  if (POPOUT && !l) { window.close(); return }
  showActiveUnder()
}

/** How many tabs are open (the phone's tab switcher button). */
export const tabCount = (l: TabList = here()) => l.tabs.length

/** Views hear each pane of theirs leaving this window (closed, or taken out to another), `last` once no pane anywhere
 *  shows that place (other workspaces too: `setOpenElsewhere`; a terminal ends its shell). Moving isn't leaving. */
let onClosed: ((to: string, pane: string, last: boolean, moved: boolean) => boolean) | null = null
/** `fn` answers whether something of the pane's own ended (its web page); `moved`: it went on in another window. */
export const setTabCloser = (fn: (to: string, pane: string, last: boolean, moved: boolean) => boolean) => { onClosed = fn }
/** Whether a place is open in tabs kept elsewhere (Workspaces: the other workspaces' tabs). Set by the app. */
let elsewhere: (to: string) => boolean = () => false
export const setOpenElsewhere = (fn: (to: string) => boolean) => { elsewhere = fn }
/** The views whose last pane is among `panes` (each once). */
function lastOf(going: Pane[]) {
  const ids = new Set(going.map((p) => p.id))
  const left = new Set(allPanes(state).concat((state.windows ?? []).flatMap(allPanes)).filter((p) => !ids.has(p.id)).map((p) => p.to))
  return [...new Set(going.map((p) => p.to))].filter((to) => to.startsWith("view:") && !left.has(to) && !elsewhere(to))
}
/** Views hear their panes leave (`last` once a place: with the last of its panes). */
function heard(going: Pane[]) {
  const last = new Set(lastOf(going))
  going.forEach((p, i) => { if (p.to.startsWith("view:")) onClosed?.(p.to, p.id, last.has(p.to) && !going.slice(i + 1).some((x) => x.to === p.to), false) })
}

/** A closed tab and its place in the list: what ⌘⇧T and the archived tabs (core/tabarchive.ts) bring back. */
export type ClosedTab = { tab: Tab; at: number }
/** What closed together, as ⌘⇧T brings it back: tabs (a group, Close others, a window) with their places, groups and
 *  the one shown; or a pane of a split, with its tab, where it sat and whether it was zoomed. */
type ClosedSet = { tabs: ClosedTab[]; groups?: Group[]; shown?: string; window?: boolean }
type ClosedPane = { pane: Pane; tab: string; spot: Spot | null; zoom?: boolean
  /** One of a pane's own tabs (Pane.stack): the others it was among, and its place among them. */
  beside?: string[]; at?: number }
/** Kept on this device for all its windows, across relaunches, `ws` the workspace it closed in (none: from before
 *  that was kept, any); never blank panes, nor views that end with their pane (a terminal's shell). */
type Closed = (ClosedSet | ClosedPane) & { closed: number; ws?: number }
/** One of closedTabs(): its tabs not open again (a pane's as a tab of its own), the groups they were in. */
export type ClosedEntry = { id: string; tabs: Tab[]; groups: Group[]; closed: number; window: boolean }
const CLOSED_KEY = `${KEY}.closed`, MAX_CLOSED = 50
type Obj = Record<string, unknown>
/** A closed entry as kept, checked; older ones become today's: a tab (`{tab, at}`, or before tabs held panes
 *  `{tab: {id, to}}`), or a pane's tabs from then (each a tab). */
function closedOf(e: Obj): Closed[] {
  const when = { closed: typeof e.closed === "number" ? e.closed : 0, ...(typeof e.ws === "number" ? { ws: e.ws } : {}) }
  // (a tab alone loses its group as it's checked: put back)
  const tabIn = (x: unknown): Tab | null => {
    const t = x && typeof x === "object" ? clean({ tabs: [x], active: "" })?.tabs[0] : null, g = (x as Obj | null)?.group
    return t ? (typeof g === "string" && g ? { ...t, group: g } : t) : null
  }
  const old = (t: Obj) => tabOf(String(t.to), { id: `t${t.id}`, pane: String(t.id) })
  const isOld = (t: unknown): t is Obj => !!t && typeof t === "object" && typeof (t as Obj).to === "string" && typeof (t as Obj).id === "string"
  if (Array.isArray(e.tabs)) {
    const tabs = e.tabs.flatMap((c: Obj | null) => { const t = tabIn(c?.tab); return t ? [{ tab: t, at: typeof c!.at === "number" ? c!.at : Infinity }] : [] })
    if (!tabs.length) return []
    const groups = clean({ tabs: tabs.map((c) => c.tab), groups: e.groups, active: "" })?.groups?.map(({ collapsed: _, ...g }) => g)
    return [{ tabs, ...(groups?.length ? { groups } : {}), ...(typeof e.shown === "string" ? { shown: e.shown } : {}), ...(e.window === true ? { window: true } : {}), ...when }]
  }
  if (e.tab && typeof e.tab === "object") {
    const t = isOld(e.tab) ? old(e.tab) : tabIn(e.tab)
    return t ? [{ tabs: [{ tab: t, at: typeof e.at === "number" ? e.at : 0 }], ...when }] : []
  }
  const pane = e.pane as Obj | undefined
  if (pane && Array.isArray(pane.tabs)) return pane.tabs.filter(isOld).map((t) => ({ tabs: [{ tab: old(t), at: Infinity }], ...when }))
  const p = pane && cleanLayout(pane)
  const among = Array.isArray(e.beside) && e.beside.every((x) => typeof x === "string") ? { beside: e.beside as string[], at: typeof e.at === "number" ? e.at : 0 } : {}
  if (p && !isSplit(p) && typeof e.tab === "string") return [{ pane: p, tab: e.tab, spot: (e.spot as Spot) ?? null, ...(e.zoom === true ? { zoom: true } : {}), ...among, ...when }]
  return []
}
const closedFrom = (raw: string | null): Closed[] => {
  try { const l = JSON.parse(raw ?? "[]"); return Array.isArray(l) ? l.flatMap((e) => (e && typeof e === "object" ? closedOf(e) : [])) : [] } catch { return [] }
}
let reopenable = closedFrom((() => { try { return tabStore().getItem(CLOSED_KEY) } catch { return null } })())
const keepClosed = () => {
  reopenable.splice(0, Math.max(0, reopenable.length - MAX_CLOSED))
  try { tabStore().setItem(CLOSED_KEY, JSON.stringify(reopenable)) } catch { /* private mode */ }
}
// (each window closes and reopens from the same list: another's change is taken in)
addEventListener("storage", (e) => { if (e.key === CLOSED_KEY) reopenable = closedFrom(e.newValue) })
// (pop-outs once kept lists of their own: they join this one)
if (!POPOUT) {
  try {
    const old = Object.keys(tabStore()).filter((k) => k.startsWith(`${CLOSED_KEY}.`))
    if (old.length) {
      for (const k of old) { reopenable.push(...closedFrom(tabStore().getItem(k))); tabStore().removeItem(k) }
      reopenable.sort((a, b) => a.closed - b.closed)
      keepClosed()
    }
  } catch { /* private mode */ }
}
/** The workspace this window is on (0: none), what's closed belongs to. Set by the app. */
let workspaceNow: () => number = () => 0
export const setWorkspaceOf = (fn: () => number) => { workspaceNow = fn }
const mineNow = (r: Closed) => r.ws === undefined || r.ws === workspaceNow()
/** What's kept of a pane closed: its place, history and float, not this visit's opener. */
const keptPane = (p: Pane): Pane => ({ id: p.id, to: p.to, ...(p.back ? { back: p.back } : {}), ...(p.fwd ? { fwd: p.fwd } : {}), ...(p.home ? { home: p.home } : {}),
  ...(p.float ? { float: p.float } : {}) })
const keptTab = (t: Tab): Tab => ({ ...t, root: mapPlaces(t.root, keptPane) })
function closedEntry(t: Tab): ClosedTab | null {
  const at = here().tabs.findIndex((x) => x.id === t.id)
  return at >= 0 ? { tab: keptTab(t), at } : null
}
/** Remember tabs closing together (one entry), and panes of tabs that stay, for ⌘⇧T. `from`: the list they were in;
 *  `ending`: leave out the views that end with their pane (closed for good, not taken away). Returns the tabs' entry. */
function remember(tabs: Tab[], panes: Pane[] = [], { from = here(), window = false, ending = true }: { from?: TabList; window?: boolean; ending?: boolean } = {}) {
  const ends = new Set(ending ? lastOf([...tabs.flatMap(placesIn), ...panes]).filter(keeps) : [])
  const keep = (p: Pane) => !isBlank(p) && !ends.has(p.to)
  const closed = Date.now(), ws = workspaceNow()
  for (const p of panes) {
    const t = tabOfPane(from, p.id), own = t && paneWith(t.root, p.id), among = own ? placesOf(own) : []
    const beside = among.length > 1 ? { beside: among.filter((x) => x.id !== p.id).map((x) => x.id), at: among.findIndex((x) => x.id === p.id) } : {}
    if (t && keep(p)) reopenable.push({ pane: keptPane(p), tab: t.id, spot: spotOf(t.root, p.id), ...(t.zoom === p.id ? { zoom: true } : {}), ...beside, closed, ws })
  }
  const kept = tabs.flatMap((t): ClosedTab[] => {
    const left = tabWithout(t, new Set(placesIn(t).filter((p) => !keep(p)).map((p) => p.id))), at = from.tabs.findIndex((x) => x.id === t.id)
    return left && at >= 0 ? [{ tab: keptTab({ ...left, id: t.id }), at }] : []
  })
  if (kept.length) {
    const ids = new Set(kept.map((c) => c.tab.group)), groups = from.groups?.filter((g) => ids.has(g.id)).map(({ collapsed: _, ...g }) => g)
    const shown = kept.find((c) => c.tab.id === from.active)?.tab.id
    reopenable.push({ tabs: kept, ...(groups?.length ? { groups } : {}), ...(shown ? { shown } : {}), ...(window ? { window } : {}), closed, ws })
  }
  keepClosed()
  return kept.length ? reopenable[reopenable.length - 1] as Extract<Closed, ClosedSet> : null
}
/** What a whole list put in place (`next`) takes away from `was` that's open nowhere else (not there by id or place, nor
 *  in another workspace): remembered as closed, so a layout or another device's change loses nothing for good. */
function rememberTaken(was: TabList, next: TabList) {
  const ids = new Set(allPanes(next).map((p) => p.id)), places = new Set(allPanes(next).map((p) => p.to)), stays = new Set(next.tabs.map((t) => t.id))
  const lost = (p: Pane) => !isBlank(p) && !ids.has(p.id) && !places.has(p.to) && !elsewhere(p.to)
  const tabs: Tab[] = [], panes: Pane[] = []
  for (const t of was.tabs) {
    const ps = placesIn(t).filter(lost)
    if (!ps.length) continue
    if (stays.has(t.id)) panes.push(...ps)
    else tabs.push(tabWithout(t, new Set(placesIn(t).filter((p) => !lost(p)).map((p) => p.id)))!)
  }
  if (tabs.length || panes.length) remember(tabs, panes, { from: was, ending: false })
}
const isOpen = (id: string) => !!tabById(id) || !!paneById(id)
const idOf = (r: Closed) => ("pane" in r ? `t${r.pane.id}` : r.tabs[0].tab.id)
/** An entry without what's open again: a tab's panes open again leave it. */
function entryOf(r: Closed): ClosedEntry {
  if ("pane" in r) return { id: idOf(r), tabs: isOpen(r.pane.id) ? [] : [tabWith(r.pane, idOf(r))], groups: [], closed: r.closed, window: false }
  const tabs = r.tabs.flatMap((c) => tabWithout(c.tab, new Set(placesIn(c.tab).filter((p) => isOpen(p.id)).map((p) => p.id))) ?? [])
  return { id: idOf(r), tabs, groups: r.groups ?? [], closed: r.closed, window: !!r.window }
}
export const canReopenTab = () => reopenable.some(mineNow)
/** What closed lately in this workspace and isn't open again, the latest first. */
export function closedTabs(): ClosedEntry[] {
  return reopenable.filter(mineNow).map(entryOf).filter((e) => e.tabs.length).reverse()
}
/** Reopen one of closedTabs() as ⌘⇧T would (reopenEntry): it leaves the list. */
export function reopenClosed(id: string, gone: (to: string) => boolean = () => false) {
  const i = reopenable.findLastIndex((r) => idOf(r) === id)
  if (i < 0) return
  const [r] = reopenable.splice(i, 1)
  keepClosed()
  reopenEntry(r, gone)
}
/** When what ⌘⇧T would reopen was closed (0: nothing). */
export const lastClosedAt = () => reopenable.findLast(mineNow)?.closed ?? 0
/** Reopen what closed last in this workspace, all that closed with it, even where other tabs have their places (a
 *  browser's way); skips `gone` ones and what's open again. */
export function reopenTab(gone: (to: string) => boolean = () => false) {
  for (let i = reopenable.length - 1; i >= 0; i--) {
    if (!mineNow(reopenable[i])) continue
    const [r] = reopenable.splice(i, 1)
    if (reopenEntry(r, gone)) break
  }
  keepClosed()
}
/** An entry back as it was: a pane where it sat in its tab (reopenPane), tabs at their places (restoreTabs), a
 *  pop-out's in a window of their own again. False: nothing of it was left to reopen. */
function reopenEntry(r: Closed, gone: (to: string) => boolean): boolean {
  const back = (p: Pane) => !gone(p.to) && !isOpen(p.id)
  if ("pane" in r) { if (!back(r.pane)) return false; reopenPane(r); return true }
  const tabs = r.tabs.flatMap((c) => { const t = tabWithout(c.tab, new Set(placesIn(c.tab).filter((p) => !back(p)).map((p) => p.id))); return t ? [{ ...c, tab: t }] : [] })
  if (!tabs.length) return false
  if (r.window && !POPOUT && openWindow({ tabs: tabs.map((c) => c.tab), ...(r.groups ? { groups: r.groups } : {}), active: tabs.find((c) => c.tab.id === r.shown)?.tab.id ?? tabs[0].tab.id })) {
    save(); changed.notify(); watchWindows()
    return true
  }
  restoreTabs(tabs, { groups: r.groups, front: r.shown })
  return true
}
/** Put a closed tab back at its place in the list (restoreTabs): shown, or (`shown` false) behind the one on screen. */
export const restoreTab = (r: ClosedTab, shown = true) => restoreTabs([r], { show: shown })
/** Put closed tabs back at their places, with their panes' history and their tab groups (one gone meanwhile comes
 *  back). Shown: `front`, or a lone one, a blank tab on screen making way; else the tab on screen stays. */
function restoreTabs(list: ClosedTab[], { groups = [], front, show: shows = true }: { groups?: Group[]; front?: string; show?: boolean } = {}) {
  const l = here(), cur = activeTab(), had = new Set((l.groups ?? []).map((g) => g.id))
  const ids = new Set<string>()
  const placed = [...list].sort((a, b) => a.at - b.at).map((c) => {
    const tab = tabById(c.tab.id) || ids.has(c.tab.id) ? { ...c.tab, id: newTabId() } : c.tab
    ids.add(tab.id)
    return { c, tab }
  })
  const pick = shows ? placed.find((x) => x.c.tab.id === front) ?? (placed.length === 1 || isBlankTab(cur) ? placed[0] : undefined) : undefined
  let tabs = l.tabs.filter((t) => !(pick && isBlankTab(t) && t === cur))
  for (const { c, tab } of placed) { const at = Math.min(c.at, tabs.length); tabs = [...tabs.slice(0, at), tab, ...tabs.slice(at)] }
  const back = groups.filter((g) => !had.has(g.id) && placed.some((x) => x.tab.group === g.id))
  set({ ...l, tabs, ...(back.length ? { groups: [...(l.groups ?? []), ...back] } : {}), active: pick ? pick.tab.id : l.active })
  if (pick) show(focusedPane(pick.tab).to, !isDesktop())
}
/** A closed pane back where it sat in its tab (putBack; that gone, beside the focused pane), focused and zoomed as it
 *  was; one of a pane's tabs back among them, while one is open; its tab gone, as a tab of its own. */
function reopenPane({ pane: p, tab: tabId, spot, zoom = false, beside: among, at }: ClosedPane) {
  const t = tabById(tabId)
  if (!t) return restoreTab({ tab: tabWith(p), at: Infinity })
  const near = among?.find((id) => placesIn(t).some((x) => x.id === id))
  if (near) {
    set(withTab(t.id, (x) => ({ ...withPlace(x, near, p, { index: at }), focus: p.id }), { active: t.id }))
    return show(p.to, !isDesktop())
  }
  const side = !spot ? "right" : spot.dir === "row" ? (spot.after ? "right" : "left") : spot.after ? "bottom" : "top"
  const root = (spot && putBack(t.root, p, spot)) ?? beside(t.root, t.focus, p, side)
  set(withTab(t.id, (x) => ({ ...x, root, focus: p.id, ...(zoom ? { zoom: p.id } : {}) }), { active: t.id }))
  show(p.to, !isDesktop())
}

/** Before panes close, their views may ask first (a terminal with a program running in it): resolves true to go ahead.
 *  Set by the app; panes that aren't views never ask, and they close at once. */
let closeGuard: ((tos: string[]) => Promise<boolean>) | null = null
export const setCloseGuard = (fn: (tos: string[]) => Promise<boolean>) => { closeGuard = fn }
/** Whether `panes` may close: at once, or once the views among them have said (only those whose last pane it is). */
export function mayClose(going: Pane[]): true | Promise<boolean> {
  const views = lastOf(going)
  return !views.length || !closeGuard ? true : closeGuard(views)
}
/** Run `close` now, or once the views among `panes` said yes. */
export function guarded(going: Pane[], close: () => void) {
  const ok = mayClose(going)
  if (ok === true) return close()
  void ok.then((yes) => { if (yes) close() })
}

/** Close a tab, every pane in it (`force`: without its views asking first, e.g. its shell already ended). */
export function closeTab(id: string, force = false) {
  const t = tabById(id)
  if (!t) return
  if (!force) return guarded(placesIn(t), () => closeTab(id, true))
  remember([t])
  heard(placesIn(t))
  const l = here()
  const next = withoutTabs(l, new Set([id]))
  leave(next && (l.active === id ? { ...next, active: openerNext(l, id) ?? next.active } : next))
  // (those it opened are now its opener's, as Chrome's are)
  const up = openers.get(id)
  openers.delete(id)
  for (const [x, o] of openers) if (o === id) { if (up) openers.set(x, up); else openers.delete(x) }
}
/** Chrome's tab after closing the one on screen: the next it opened, else the next its opener opened (each to the
 *  right, else the left), else its opener, none folded away in a tab group; null when none is kept (`openers`). */
function openerNext(l: TabList, id: string) {
  const i = l.tabs.findIndex((t) => t.id === id), by = openers.get(id)
  const ok = (t: Tab, o: string | undefined) => openers.get(t.id) === o && !foldedAway(l, t)
  const next = (o: string | undefined) => (o ? l.tabs.slice(i + 1).find((t) => ok(t, o)) ?? l.tabs.slice(0, i).findLast((t) => ok(t, o)) : undefined)
  return (next(id) ?? next(by) ?? l.tabs.find((t) => t.id === by && t.id !== id && !foldedAway(l, t)))?.id ?? null
}

/** Whether the focused pane can close on its own: its tab has others (else it's Close tab). */
export const canClosePane = () => panes().length > 1
/** Close a pane's place (the focused one): its pane's next tab shows (Pane.stack), else the pane closes, its tab keeping
 *  the others; its last pane closes the tab. ⌘⇧T brings it back. */
export function closePane(id = activePane().id, force = false) {
  const t = tabOfPane(here(), id), p = paneById(id)
  if (!t || !p) return
  if (placesIn(t).length < 2) return closeTab(t.id, force)
  if (!force) return guarded([p], () => closePane(id, true))
  remember([], [p])
  heard([p])
  leave(mapTab(here(), t.id, (x) => tabWithout(x, new Set([id]))!))
}

/** Close pane `id` with its own tabs (Pane.stack), each reopenable; its tab's last pane closes the tab. */
export function closeWholePane(id: string, force = false) {
  const t = tabOfPane(here(), id), own = t && paneWith(t.root, id)
  if (!t || !own) return
  const going = placesOf(own)
  if (panesOf(t).length < 2) return closeTab(t.id, force)
  if (!force) return guarded(going, () => closeWholePane(id, true))
  remember([], going)
  heard(going)
  leave(mapTab(here(), t.id, (x) => tabWithout(x, new Set(going.map((p) => p.id)))!))
}

/** Close several tabs at once (the tab menu: others, to the right, all); keeps `id` open if it's left, and pinned
 *  tabs. */
export function closeTabs(which: "others" | "right" | "all", id: string, force = false) {
  const l = here(), i = l.tabs.findIndex((t) => t.id === id)
  if (i < 0) return
  const kept = which === "others" ? [l.tabs[i]] : which === "right" ? l.tabs.slice(0, i + 1) : []
  const going = l.tabs.filter((t) => !kept.includes(t) && !t.pinned)
  closeTabIds(going.map((t) => t.id), { force })
}

/** Close the tabs `ids` (selected together: core/select.ts), pinned ones too: they were picked. `keep`: close every
 *  other tab instead (pinned ones stay). */
export function closeTabIds(ids: string[], { keep = false, force = false }: { keep?: boolean; force?: boolean } = {}) {
  const chosen = new Set(ids)
  const going = here().tabs.filter((t) => (keep ? !chosen.has(t.id) && !t.pinned : chosen.has(t.id)))
  if (!going.length) return
  if (!force) return guarded(going.flatMap(placesIn), () => closeTabIds(ids, { keep, force: true }))
  const entry = remember(going)
  heard(going.flatMap(placesIn))
  leave(withoutTabs(here(), new Set(going.map((t) => t.id))))
  if (entry && entry.tabs.length > 1) closedTogether?.(idOf(entry), entry.tabs.length)
}
/** Told when several tabs close at once (Close others, a group, all): their entry's id (reopenClosed's) and how many,
 *  for the toast that offers them back. Set by the app. */
let closedTogether: ((id: string, n: number) => void) | null = null
export const setClosedTogether = (fn: (id: string, n: number) => void) => { closedTogether = fn }

// ---------- tabs that archive themselves: an unpinned tab unseen a while (Tabs' setting; core/tabarchive.ts) ----------

/** How long a tab may go unseen before it archives itself (0: never, and no pane is stamped `seen`). */
let archiveAfter = 0
/** Since when this device has archived tabs: none goes before that's longer ago than the setting, so turning it on (a
 *  layout) archives nothing at once by stamps from the last time it was on. */
const SINCE = "vaultite.tabs.archiving"
let archiveSince = 0
export function setArchiveAfter(ms: number) {
  archiveAfter = ms
  try {
    const was = Number(localStorage.getItem(SINCE)) || 0
    archiveSince = ms ? was || Date.now() : 0
    if (!ms) localStorage.removeItem(SINCE); else if (!was) localStorage.setItem(SINCE, String(archiveSince))
  } catch { archiveSince = Date.now() }
  touchSeen()
}
export const archivesAfter = () => archiveAfter
/** Whether tabs unseen that long may archive now (it's been on longer than that). */
export const archivingDue = () => !!archiveAfter && Date.now() - archiveSince >= archiveAfter
const minute = () => Math.floor(Date.now() / 60_000) * 60_000
/** `l` with the panes of its tab on screen, or on screen until now in `was`, stamped as seen now (and any never). */
function stamped(l: TabList, was: TabList): TabList {
  if (!archiveAfter) return l
  const now = minute(), on = new Set([was.active, l.active])
  const due = (t: Tab, p: Pane) => !isBlank(p) && (on.has(t.id) || typeof p.seen !== "number") && p.seen !== now
  if (!l.tabs.some((t) => panesOf(t).some((p) => due(t, p)))) return l
  return mapTabs(l, (t) => (panesOf(t).some((p) => due(t, p)) ? { ...t, root: mapPanes(t.root, (p) => (due(t, p) ? { ...p, seen: now } : p)) } : t))
}
/** The tab on screen is being looked at (the window is in view): its panes stamped as seen now. */
export function touchSeen() { if (stamped(here(), here()) !== here()) set(here()) }
const seenIn = (w: unknown) => {
  const l = clean(w)
  return new Map(l ? [l, ...(l.windows ?? [])].flatMap(allPanes).map((p) => [p.id, typeof p.seen === "number" ? p.seen : 0]) : [])
}
/** Another copy of these tabs (the workspace's file, from another device): where it saw a pane later, that's taken. */
export function mergeSeen(other: unknown) {
  const theirs = seenIn(other)
  const later = (p: Pane) => (theirs.get(p.id) ?? 0) > (p.seen ?? 0)
  if (!allPanes(here()).some(later)) return
  set(mapTabs(here(), (t) => ({ ...t, root: mapPlaces(t.root, (p) => (later(p) ? { ...p, seen: theirs.get(p.id) } : p)) })))
}
/** Whether a pane was seen here later than `saved` (the workspace's file) says, by more than a quarter of the archive
 *  time: worth a write of its own. Else the stamps ride on writes that happen anyway, so they cost iCloud nothing. */
export function seenSince(saved: unknown) {
  if (!archiveAfter) return false
  const theirs = seenIn(saved)
  return allPanes(here()).some((p) => typeof p.seen === "number" && p.seen - (theirs.get(p.id) ?? 0) > archiveAfter / 4)
}
/** Whether a pane may archive itself (ViewDef.archives; a file with unsaved edits mayn't). Set by the app. */
let archivable: (p: Pane) => boolean = () => false
export const setArchivable = (fn: (p: Pane) => boolean) => { archivable = fn }
/** The tabs unseen since `before` that may archive themselves: unpinned, not on screen, nothing lost closing them. */
export function unseenTabs(before: number): Tab[] {
  const l = here()
  return l.tabs.filter((t) => !t.pinned && !isBlankTab(t) && t.id !== l.active && panesOf(t).every((p) => typeof p.seen === "number" && p.seen < before) && placesIn(t).every(archivable))
}
/** Close tabs into the archive: without asking (what's archived loses nothing), and not for ⌘⇧T. */
export function closeToArchive(ids: string[]): ClosedTab[] {
  const going = here().tabs.filter((t) => ids.includes(t.id))
  const out = going.flatMap((t) => closedEntry(t) ?? [])
  if (!going.length) return out
  heard(going.flatMap(placesIn))
  leave(withoutTabs(here(), new Set(going.map((t) => t.id))))
  return out
}

/** Rename a file from elsewhere (the tab menu): its bar's name turns into a field once the file shows. */
let toRename: string | null = null
export function askRename(path: string) { toRename = path; dispatchEvent(new Event("vaultite:rename")) }
export const takeRename = (path: string) => { if (toRename !== path) return false; toRename = null; return true }

/** A new blank tab next to the one on screen, past its tab group and in none (or at the end: `newTabsAt`, a tab bar's
 *  +): one blank tab at a time (the one there is moves there instead; on screen already: nothing moves). */
export function newTab() {
  // (asked for before the vault arrived, on a first visit's blank tab: it stays one, not filled with the home page)
  unsaved = false
  const l = here()
  if (isBlankTab(activeTab())) return show("new", true)
  // (in a split, one of the focused pane's own tabs, as its blank one: one at a time there too)
  const cur = activePane()
  if (intoPane(activeTab())) {
    if (!isBlank(cur)) set(withNewPlace(activeTab().id, cur.id, placesOf(cur).find(isBlank) ?? { id: newPaneId(), to: "new" }))
    return show("new", true)
  }
  const had = l.tabs.find(isBlankTab), blank = had ? inGroup(had, undefined) : tabOf("new")
  const tabs = l.tabs.filter((t) => t.id !== blank.id), { at } = placeAfter({ ...l, tabs }, l.active, placing ?? "new")
  set({ ...l, tabs: [...tabs.slice(0, at), blank, ...tabs.slice(at)], active: blank.id })
  show("new", true)
}

// ---------- files moving and going (core/files.ts calls these after the server did it) ----------

/** Every pane of this window's, changed by `fn`. */
const everyPane = (fn: (p: Pane) => Pane): TabList => mapTabs(here(), (t) => ({ ...t, root: mapPlaces(t.root, fn) }))

/** A file was renamed or moved (or a folder with it): panes showing it follow. */
export function retarget(from: string, to: string) {
  const map = (p: string) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : null)
  let moved = false
  const one = (to: string) => {
    // (a view of a path: view:<name>/<path>, its arg mapped as a file's path is)
    const view = !isFile(to) && to.includes("/") && pathView(to) ? to.slice(0, to.indexOf("/") + 1) : ""
    const m = isFile(to) ? map(to.slice(5)) : view ? map(to.slice(view.length)) : null
    if (m === null) return to
    moved = true
    return view ? view + m : `file:${m}`
  }
  const follow = (p: Pane) => ({ ...p, to: one(p.to), back: p.back?.map(one), fwd: p.fwd?.map(one) })
  const next = everyPane(follow)
  const didMove = moved
  for (const r of reopenable) { if ("pane" in r) r.pane = follow(r.pane); else r.tabs = r.tabs.map((c) => ({ ...c, tab: { ...c.tab, root: mapPlaces(c.tab.root, follow) } })) }
  keepClosed()
  if (!didMove) return
  set(next)
  const cur = activePane()
  if (isFile(cur.to) || pathView(cur.to)) history.replaceState(history.state, "", `#${hashOf(cur.to)}`)
  hashChanged()
}

const showing = (path: string) => (to: string) => isFile(to) && (to.slice(5) === path || to.slice(5).startsWith(`${path}/`))

/** Close the panes showing a file, or what's in a folder; they stay reopenable. Returns whether any was. */
export function closeFileTabs(path: string) {
  const ids = allPanes(here()).filter((p) => showing(path)(p.to)).map((p) => p.id)
  for (const id of ids) closePane(id, true)
  return ids.length > 0
}

/** A file or folder was deleted: close its panes, and it leaves every pane's history. */
export function dropTabs(path: string) {
  const gone = showing(path)
  const clean = (l?: string[]) => l?.filter((to) => !gone(to)).filter((to, i, a) => to !== a[i - 1])
  set(everyPane((p) => ({ ...p, back: clean(p.back), fwd: clean(p.fwd) })))
  closeFileTabs(path)
  for (let i = reopenable.length - 1; i >= 0; i--) {
    const r = reopenable[i]
    if ("pane" in r) { if (gone(r.pane.to)) reopenable.splice(i, 1); continue }
    r.tabs = r.tabs.flatMap((c) => { const left = tabWithout(c.tab, new Set(placesIn(c.tab).filter((p) => gone(p.to)).map((p) => p.id))); return left ? [{ ...c, tab: left }] : [] })
    if (!r.tabs.length) reopenable.splice(i, 1)
  }
  keepClosed()
}
