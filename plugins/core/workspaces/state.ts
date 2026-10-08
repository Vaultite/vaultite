// Workspaces' state: the slots (the store's, with this app's own changes on top), the current one, saving the tabs
// into it and following the file (see index.tsx). No components here: they're in Numbers.tsx.
import { useSyncExternalStore } from "react"
import { Copy, LayoutPanelLeft, Pencil, Plus, Settings2, Trash2 } from "lucide-react"
import {
  del, devicePref, getStore, getTabLayout, isViewOpen, notify, openFile, openPluginSettings, openView, notifyError, post, put, readSidebars, sameSidebars, savedSidebars, setDefaultSidebars,
  setTabLayout, sidebarsChanged, startedFresh, workspaceChanged, type MenuItem, type Sidebars, type TabLayout, type WorkspaceHost, type WorkspaceInfo,
} from "@vaultite"
import { blankLayout, isBlank } from "./blank"

const MAX = 5
export const SLOTS = Array.from({ length: MAX }, (_, i) => i + 1)
type Def = { name?: string; sidebars?: Sidebars; layout?: TabLayout; pinned?: string[]; state?: Record<string, unknown> }
type Slots = (Def | null)[]

const current_ = devicePref<number>("workspace", 0)
/** The address the app was opened at (a deep link), before any workspace was put in place. */
const arrival = location.hash
/** Where the user went (a link, Back, the address bar) before the workspace arrived: opened then instead, so its arrival
 *  doesn't take them back to where the page loaded. */
let wentTo: string | null = null
let arrived = false
for (const ev of ["hashchange", "popstate"]) addEventListener(ev, (e) => { if (e.isTrusted && !arrived) wentTo = location.hash })

// ---------- the slots: the store's, with this app's own changes on top until the store brings them back ----------
// An unused slot (blank.ts) reads as null everywhere here, and a change leaving one like that empties it in the vault.
/** A workspace's sidebars are the default: none of its own, or the same as sidebars.json's. */
export const defaultSidebars = (x: unknown) => x === undefined || sameSidebars(readSidebars(x), savedSidebars())
const unusedIfBlank = (list: unknown[]): Slots => SLOTS.map((n) => {
  const d = list[n - 1]
  if (!d || typeof d !== "object" || isBlank(d, defaultSidebars)) return null
  const { sidebars: own, ...rest } = d as Def
  const s = readSidebars(own)
  return s ? { ...rest, sidebars: s } : rest
})
let seen: unknown = undefined
let seenDef = ""
let local: Slots | null = null
/** The slots (null until /api/state arrived). */
export function slots(): Slots | null {
  const w = (getStore() as unknown as { workspaces?: unknown } | null)?.workspaces
  const d = JSON.stringify(savedSidebars())
  if (w !== seen || d !== seenDef) {
    seen = w; seenDef = d
    local = Array.isArray(w) ? unusedIfBlank(w) : null
  }
  return local
}
/** The workspace this device picked (0: none yet, a new device or browser). */
const picked = () => { const n = current_.get(); return n >= 1 && n <= MAX ? n : 0 }
/** The current workspace: there always is one, 1 to 5 (unused or not: this device is on it). A device that never
 *  picked one is on the first in use, else 1. 0 only until /api/state arrived. */
export const current = () => (slots() ? picked() || used()[0] || 1 : 0)
/** The number lit in the header. */
export const lit = () => current() || 1

const subs = new Set<() => void>()
let version = 0
export const emit = () => { version++; subs.forEach((f) => f()); workspaceChanged() }
export const useVersion = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => version)

/** The last write on its way (a move waits for it, so the server has this device's tabs first). */
let writing: Promise<unknown> = Promise.resolve()
/** Send a write after the ones before (so they land in order), retrying for about half a minute while the server can't
 *  read the file (503: iCloud holds it after a write) or be reached; else the next state would take the change back. */
function queue(write: () => Promise<unknown>): Promise<unknown> {
  return writing.catch(() => {}).then(async () => {
    for (let wait = 1000; ; wait *= 2) {
      try { return await write() } catch (e) {
        const status = (e as { status?: number }).status
        if ((status !== undefined && status !== 503) || wait > 16_000) throw e
        await new Promise((r) => setTimeout(r, wait))
      }
    }
  })
}
/** Change slot n's keys here at once and in the vault (a null value removes a key). One the change leaves unused
 *  (blank.ts) is emptied instead. */
export function patch(n: number, keys: Partial<Record<keyof Def, unknown>>) {
  const list = [...(slots() ?? SLOTS.map(() => null))]
  const had = list[n - 1]
  const next: Record<string, unknown> = { ...(had ?? {}) }
  for (const [k, v] of Object.entries(keys)) { if (v === null) delete next[k]; else next[k] = v }
  if (isBlank(next, defaultSidebars)) { if (had) clear(n); return null }
  // Made just now: what this device kept for it while it was unused (open folders...) goes in with it.
  const held = memory.get(n)
  if (!had && held && Object.keys(held).length) { next.state = { ...held, ...(next.state as object ?? {}) }; memory.delete(n) }
  list[n - 1] = next as Def
  local = list
  emit(); sidebarsChanged()
  writing = queue(() => put(`workspaces/${n}`, had ? keys : next)).catch(() => { /* offline: it applies here meanwhile */ })
  return next as Def
}

// ---------- what the app and plugins keep per workspace (`state`, useScopedState in the app: core/scope.ts) ----------
/** Values kept for workspaces that are unused (nothing's written for those): they go into the slot when it's made. */
const memory = new Map<number, Record<string, unknown>>()
export function getState(key: string): unknown {
  const n = current()
  if (!n) return undefined
  const d = slots()?.[n - 1]
  return d ? d.state?.[key] : memory.get(n)?.[key]
}
export function setState(key: string, value: unknown) {
  const n = current()
  if (!n) return
  const d = slots()?.[n - 1]
  const v = value === undefined ? null : value
  if (!d) {
    const m = { ...(memory.get(n) ?? {}) }
    if (v === null) delete m[key]; else m[key] = v
    memory.set(n, m)
    emit()
    return
  }
  if (JSON.stringify(d.state?.[key] ?? null) === JSON.stringify(v)) return
  const state = { ...(d.state ?? {}) }
  if (v === null) delete state[key]; else state[key] = v
  const list = [...slots()!]
  list[n - 1] = { ...d, state }
  local = list
  emit()
  // Only this key: the server merges `state` key by key (another device's keys stay).
  writing = queue(() => put(`workspaces/${n}`, { state: { [key]: v } })).catch(() => {})
}

// ---------- the workspace's pinned pages (POST /api/workspaces/<n>/pins: one change, on the list as it is) ----------
// Without a list of its own it shows the vault's; its first change copies that list (server and here alike).
/** The current workspace's own pinned pages, or null: none of its own (the vault's apply). */
const pinnedHere = (): string[] | null => { const n = current(); const p = n ? slots()?.[n - 1]?.pinned : undefined; return Array.isArray(p) ? p : null }
function pinHere(path: string, on: boolean, before: string | null | undefined, base: string[]) {
  const n = current()
  if (!n) return Promise.resolve()
  const cur = pinnedHere() ?? base
  const rest = cur.filter((p) => p !== path)
  const i = before ? rest.indexOf(before) : -1
  const next = !on ? rest : cur.includes(path) && before === undefined ? cur : i < 0 ? [...rest, path] : [...rest.slice(0, i), path, ...rest.slice(i)]
  if (next.join("\n") === cur.join("\n")) return Promise.resolve()
  // Shown at once; the server's answer (the list as it applied the change) comes back with the store.
  const list = [...(slots() ?? SLOTS.map(() => null))]
  list[n - 1] = { ...(list[n - 1] ?? {}), pinned: next }
  local = list
  emit()
  writing = queue(() => post(`workspaces/${n}/pins`, { path, pinned: on, ...(before !== undefined ? { before } : {}) })).catch((e) => { notifyError(e, "Couldn't pin it") })
  return writing
}
/** Make workspace n's pinned pages the default new workspaces start with (pages.json's), as the server has them. */
export function pinsForNew(n: number) {
  writing = queue(() => post(`workspaces/${n}/pins/default`, {})).then(() => { notify("New workspaces start with these pinned pages") }, (e) => { notifyError(e) })
  return writing
}

/** The places each workspace's tabs show (the current one's: what's on screen). */
function placesOf(n: number): string[] {
  const l = n === current() ? getTabLayout() : slots()?.[n - 1]?.layout
  const out: string[] = []
  const walk = (x: unknown) => {
    if (!x || typeof x !== "object") return
    const g = x as { kids?: unknown[]; tabs?: { to?: unknown }[] }
    if (Array.isArray(g.kids)) g.kids.forEach(walk)
    if (Array.isArray(g.tabs)) for (const t of g.tabs) if (typeof t?.to === "string" && t.to !== "new") out.push(t.to)
  }
  walk(l?.root)
  return out
}

/** What the app asks Workspaces (WorkspaceHost in the plugin API; core/scope.ts). */
export const host: WorkspaceHost = {
  current: () => current() || 1,
  list: (): WorkspaceInfo[] => SLOTS.filter((n) => slots()?.[n - 1] || n === current()).map((n) => ({ n, label: label(n), places: placesOf(n) })),
  switchTo: (n) => switchTo(n),
  menu: () => {
    const n = current() || 1, free = SLOTS.find((m) => m !== n && !now(m))
    return [
      ...SLOTS.filter((m) => m === n || now(m)).map((m) => ({ label: label(m), checked: m === n, run: () => switchTo(m) })),
      ...(free ? [{ label: "New workspace", icon: Plus, run: () => switchTo(free) }] : []),
      ...slotMenu(n, false).map((it, i) => (i ? it : { ...it, sep: true })),
    ]
  },
  get: getState,
  set: setState,
  pinned: pinnedHere,
  pin: pinHere,
}
function clear(n: number) {
  const list = [...(slots() ?? SLOTS.map(() => null))]
  list[n - 1] = null
  local = list
  emit(); sidebarsChanged()
  writing = queue(() => del(`workspaces/${n}`)).catch(() => {})
}

// ---------- tabs ----------
/** What each tab keeps for this visit only, not saved in the vault: its back/forward history and the tab it was opened
 *  beside (Tab.from). */
const VISIT = new Set(["back", "fwd", "from"])
/** The tabs as saved in the vault: without what's kept for this visit. */
const strip = (l: TabLayout): TabLayout => JSON.parse(JSON.stringify(l, (k, v) => (VISIT.has(k) ? undefined : v)))
/** What devices share of a layout: the tabs, their places and the splits; not which tab each group shows or which
 *  group has the focus (each device's own). "" for none. */
const shape = (l: TabLayout | null | undefined) =>
  !l || blankLayout(l) ? "" : JSON.stringify(l, (k, v) => (VISIT.has(k) || k === "active" || k === "focus" ? undefined : v))
/** Each workspace's tabs as they were left in this visit, history and all. */
const kept = new Map<number, TabLayout>()
/** What this device saved lately: the file bringing one back is its own write coming round, not news. */
const mine = new Set<string>()
let timer = 0
/** A change of this device's tabs is waiting to be saved. */
export const savePending = () => !!timer
export function saveTabs() {
  clearTimeout(timer); timer = 0
  // A move on its way decides this workspace's tabs: a change made meanwhile is saved after it.
  if (moving) { timer = window.setTimeout(saveTabs, 300); return }
  const n = current()
  if (!n) return
  const l = strip(getTabLayout())
  if (shape(l) === shape(slots()?.[n - 1]?.layout)) return
  mine.add(shape(l))
  if (mine.size > 20) mine.delete(mine.values().next().value!)
  // Back to a lone blank tab: the layout goes (null), so a workspace that's nothing more than that is unused again.
  patch(n, { layout: shape(l) ? l : null })
}
/** Putting a layout in place ourselves (a switch, another device's change): not a change to save. */
let applying = false
function apply(l: TabLayout | null, merge = false) {
  applying = true
  try { setTabLayout(l, { merge }) } finally { applying = false }
}
export const saveTabsSoon = () => { if (applying) return; clearTimeout(timer); timer = window.setTimeout(saveTabs, 1000) }

/** The vault changed: the current workspace's tabs as they are there now (an unused one's: a blank tab). A change of
 *  ours still on its way wins (last write wins); a device on no workspace yet takes the first. */
/** The first sync of this page has happened (what it arrived at is opened then). */
let synced = false
const UNSAVED = "vaultite.workspaces.unsaved"
/** The page is going away (a reload, a closed window) with a change of its tabs the vault doesn't have yet (not just
 *  another tab shown): saved now, and noted for this tab's next page in case the request doesn't get out in time. */
export function leaving() {
  if (!savePending() || shape(strip(getTabLayout())) === shape(slots()?.[current() - 1]?.layout)) return
  try { sessionStorage.setItem(UNSAVED, String(current())) } catch { /* private mode */ }
  saveTabs()
}

/** The address this page was opened at (#file/Notes%2FIdea.md, a deep link), or the one the user went to since (wentTo),
 *  opens once the workspace's tabs are in place: in them, as a tab of its own when it isn't one already. */
function arrive() {
  arrived = true
  const at = wentTo ?? arrival
  const m = /^#(file|view)\/([^/]+)/.exec(at)
  if (m) { try { const to = decodeURIComponent(m[2]); if (m[1] === "file") openFile(to, { newTab: !JSON.stringify(getTabLayout().root).includes(JSON.stringify(`file:${to}`)) }); else openView(to, { newTab: !isViewOpen(to) }) } catch { /* a bad address */ } }
  // Any other place (a sheet, like #new/plugin/graph): the address again, for the app to follow as it would have.
  else if (at.length > 1 && location.hash !== at) { history.replaceState(null, "", at); dispatchEvent(new HashChangeEvent("hashchange")) }
}

export function sync() {
  const list = slots()
  if (!list) return
  if (!picked()) {
    // A device that never picked a workspace goes to the first in use, else 1 (which these tabs make). The first sync
    // happens once, so the next doesn't undo what the user did meanwhile.
    synced = true
    const first = used()[0]
    current_.set(first || 1)
    // (A page started on a new tab after the app stopped: its tabs are the workspace's now, not the other way.)
    if (!first || startedFresh) {
      const l = strip(getTabLayout())
      if (shape(l)) patch(first || 1, { layout: l })
      emit(); sidebarsChanged()
      return
    }
    apply(list[first - 1]?.layout ?? null)
    emit(); sidebarsChanged()
    arrive()
    return
  }
  const n = current()
  if (!synced) {
    synced = true
    // This page's tabs changed less than a second before the last one went away (a reload, a closed window): they're
    // newer than the workspace's, so they're saved rather than replaced.
    let unsaved = false
    try { unsaved = sessionStorage.getItem(UNSAVED) === String(n); sessionStorage.removeItem(UNSAVED) } catch { /* private mode */ }
    if (unsaved || startedFresh) { saveTabs(); arrive(); return }
    const want = list[n - 1]?.layout ?? null
    if (shape(want) !== shape(strip(getTabLayout()))) apply(want, true)
    arrive()
    return
  }
  if (timer) return
  const want = list[n - 1]?.layout ?? null
  const there = shape(want)
  if (there === shape(strip(getTabLayout()))) return
  if (mine.has(there)) return
  mine.clear()
  apply(want, true)
}

// ---------- sending tabs, panes and files to another workspace ----------
/** What goes: a tab (by id), a whole pane (by its group's id: all its tabs) or files to open there (vault paths). */
export type Sent = { tab: string } | { group: string } | { open: string[] }
let moving = false
/** Send a tab, pane or files to workspace n (dropped on its number), through the server so every device on either
 *  follows; this device puts the result in place itself, so nothing stale of its own is saved over it. */
export async function sendTo(n: number, what: Sent) {
  if (!slots()) return
  const from = current()
  if (!from || from === n) return
  if (timer) saveTabs()
  await writing
  moving = true
  try {
    const r = await post<{ tabs: { id: string }[]; group?: string; workspaces: unknown[] }>("workspaces/move", { ...("open" in what ? {} : { from }), to: n, ...what })
    local = unusedIfBlank(r.workspaces)
    const l = local[from - 1]?.layout ?? null
    mine.add(shape(l))
    apply(l, true)
    emit()
    // A move can be undone (it comes back, to this workspace's pane focused last, or as a pane of its own), like
    // every other move in the app; files opened there left nothing here to bring back.
    const back: Sent | null = "open" in what || !r.tabs.length ? null : "group" in what ? { group: r.group ?? what.group } : { tab: r.tabs[0].id }
    notify(r.tabs.length ? ("open" in what ? `Opened in ${named(n)}` : `Moved to ${named(n)}`) : `Already open in ${named(n)}`,
      back ? { action: { label: "Undo", run: () => void bringBack(n, from, back) } } : undefined)
  } catch (e) {
    notifyError(e, "open" in what ? "Couldn't open it there" : "Couldn't move it")
  } finally {
    moving = false
  }
}
/** Undo a move to workspace n: what went there comes back to workspace `to`, and if that's still this device's, it
 *  shows here at once. */
async function bringBack(n: number, to: number, what: Sent) {
  if (timer) saveTabs()
  await writing
  moving = true
  try {
    const r = await post<{ workspaces: unknown[] }>("workspaces/move", { from: n, to, ...what })
    local = unusedIfBlank(r.workspaces)
    if (current() === to) { const l = local[to - 1]?.layout ?? null; mine.add(shape(l)); apply(l, true) }
    emit()
  } catch (e) {
    notifyError(e, "Couldn't move it back")
  } finally {
    moving = false
  }
}

/** Move tab `id` from the current workspace to workspace n. */
export const moveTab = (id: string, n: number) => sendTo(n, { tab: id })

/** The focused pane's tab showing something (not a blank one): what "Move current tab to workspace n" moves. */
export function currentTab(): string | null {
  const { root, focus } = getTabLayout()
  const find = (x: unknown): { tabs: { id: string; to: string }[]; active: string } | null => {
    const g = x as { id?: string; kids?: unknown[]; tabs?: { id: string; to: string }[]; active?: string }
    if (Array.isArray(g.kids)) { for (const k of g.kids) { const f = find(k); if (f) return f } return null }
    return g.id === focus && Array.isArray(g.tabs) ? { tabs: g.tabs, active: g.active ?? "" } : null
  }
  const g = find(root)
  const t = g?.tabs.find((x) => x.id === g.active)
  return t && t.to !== "new" ? t.id : null
}

// ---------- switching ----------
export function switchTo(n: number) {
  if (!slots()) return
  const now = current()
  if (n === now) return
  if (now) { saveTabs(); kept.set(now, getTabLayout()) }
  // An unused one is nothing until it's used: the default sidebars and one blank tab, and nothing written (the first
  // tab opened or panel changed there makes it).
  const d = slots()![n - 1]
  current_.set(n)
  emit(); sidebarsChanged()
  const k = kept.get(n)
  apply(k && shape(k) === shape(d?.layout) ? k : d?.layout ?? null)
}

export const used = () => SLOTS.filter((n) => slots()?.[n - 1])

/** Every place open in the other workspaces' tabs (what closing a tab here mustn't end: a terminal they show too). */
export function openElsewhere(): string[] {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return
    const x = n as { kids?: unknown[]; tabs?: { to?: unknown }[] }
    if (Array.isArray(x.kids)) x.kids.forEach(walk)
    if (Array.isArray(x.tabs)) for (const t of x.tabs) if (typeof t?.to === "string") out.push(t.to)
  }
  const n = current()
  slots()?.forEach((d, i) => { if (d && i + 1 !== n) walk(d.layout?.root) })
  return out
}
export function cycle(dir: 1 | -1) {
  const u = used()
  if (u.length < 2) return
  const i = u.indexOf(current())
  switchTo(u[(i + dir + u.length) % u.length])
}

// ---------- menus ----------
/** The workspace whose name is being edited, on its row in the switcher's list (0: none). */
let renaming = 0
export const getRenaming = () => renaming
export const setRenaming = (n: number) => { renaming = n; emit() }
export const label = (n: number) => slots()?.[n - 1]?.name || `Workspace ${n}`
/** A workspace in the middle of a sentence: its name, else "workspace 2". */
export const named = (n: number) => slots()?.[n - 1]?.name || `workspace ${n}`

/** Workspace n as it is now: for the current one, what's on screen (its last second of changes may not be saved yet). */
function now(n: number): Def | null {
  if (n !== current()) return slots()?.[n - 1] ?? null
  const d: Def = { ...(slots()?.[n - 1] ?? {}), layout: strip(getTabLayout()) }
  return isBlank(d, defaultSidebars) ? null : d
}

/** Empty workspace n (Delete). Nothing is closed: its terminals keep running (the Terminals panel has them). If it's the
 *  current one, this device stays on it, now unused: the default sidebars and a blank tab. A toast offers Undo. */
export function remove(n: number) {
  const was = now(n)
  if (!was) return
  kept.delete(n)
  if (n === current()) { clearTimeout(timer); timer = 0 }
  clear(n)
  if (n === current()) { apply(null); sidebarsChanged() }
  notify(`Deleted ${was.name || `workspace ${n}`}`, { action: { label: "Undo", run: () => {
    if (slots()?.[n - 1]) return
    patch(n, { ...was })
    if (n === current() && !shape(strip(getTabLayout()))) { apply(was.layout ?? null); sidebarsChanged() }
  } } })
}

/** Workspace n's menu. `rename: false`: without Rename (the phone's, which edits the name in a field of its own). */
export function slotMenu(n: number, rename = true): MenuItem[] {
  const has = !!now(n)
  const d = slots()?.[n - 1]
  // Duplicate goes to the first unused slot (the current one too, when it's unused: it then shows the copy).
  const free = SLOTS.find((m) => m !== n && !now(m))
  // Panels of its own that differ from the default (sidebars.json's, what new workspaces start with).
  const own = d?.sidebars && !defaultSidebars(d.sidebars) ? d.sidebars : null
  return [
    // The name is edited on its row in the switcher's list (which opens for it).
    ...(rename ? [{ label: "Rename", icon: Pencil, run: () => setRenaming(n) }] : []),
    { label: !has ? "Duplicate" : free ? `Duplicate to workspace ${free}` : "Duplicate (all five are in use)", icon: Copy, disabled: !has || !free, run: () => {
      const { name: _name, ...rest } = now(n)!
      patch(free!, rest)
      if (free === current()) { apply(rest.layout ?? null); sidebarsChanged() }
    } },
    ...(own ? [
      { label: "Use these panels for new workspaces", icon: LayoutPanelLeft, sep: true, run: () => { setDefaultSidebars(own); notify("New workspaces start with these panels") } },
    ] : []),
    // The current one's name, pins and panels: Workspaces' settings sheet.
    ...(n === current() ? [{ label: "Settings…", icon: Settings2, sep: !own, run: () => openPluginSettings("workspaces") }] : []),
    { label: "Delete", icon: Trash2, danger: true, sep: true, disabled: !has, run: () => remove(n) },
  ]
}
