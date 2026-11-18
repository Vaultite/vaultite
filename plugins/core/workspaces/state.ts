import { ArrowDown, ArrowUp, Box, Copy, LayoutPanelLeft, Palette, Pencil, Plus, Settings2, Smile, Trash2 } from "lucide-react"
import {
  askText, cell, colorItems, colorVar, del, devicePref, dotIcon, isColor, mergeTabsSeen, pickIcon, tabsSeenSince, webContainers, getStore, getTabLayout, isViewOpen, notify, notifyError, openFile, openPluginSettings, openView, placePin, post, put, readSidebars,
  replaceHash, sameSidebars, WORKSPACES as MAX, DEVICE, get, plural, viewInfo, savedSidebars, setDefaultSidebars, setTabLayout, sidebarsChanged, startedFresh, workspaceChanged, type MenuItem,
  allPanes, cleanTabLayout as clean, focusedPane, placesIn as placesOfTab, selectTab, shownTab, withMyTabs, withoutPanes, withoutTabs, type Sidebars, type Tab, type TabLayout, type TabList, type WorkspaceHost, type WorkspaceInfo,
} from "@vaultite"
import { blankLayout, isBlank, isObj, type Obj } from "./blank"
import { markIcon } from "./Mark"
import { NO_MOVES, numberNow, type Moves } from "./order"

export const SLOTS = Array.from({ length: MAX }, (_, i) => i + 1)
type Def = { name?: string; icon?: unknown; tint?: unknown; container?: unknown; sidebars?: Sidebars; layout?: TabLayout; pinned?: unknown; state?: Obj }
type Slots = (Def | null)[]
type Keys = Partial<Record<keyof Def, unknown>>

const current_ = devicePref<number>("workspace", 0)
const movesSeen = devicePref<number>("workspace-moves", -1)
const arrival = location.hash
let wentTo: string | null = null
let arrived = false
for (const ev of ["hashchange", "popstate"]) addEventListener(ev, (e) => { if (e.isTrusted && !arrived) wentTo = location.hash })

export const defaultSidebars = (x: unknown) => x === undefined || sameSidebars(readSidebars(x), savedSidebars())
function defOf(x: Obj): Def {
  const { name, sidebars, state, layout, ...rest } = x
  const d: Def = rest, own = readSidebars(sidebars), l = clean(layout)
  if (typeof name === "string") d.name = name
  if (own) d.sidebars = own
  if (isObj(state)) d.state = state
  if (l) d.layout = l
  return d
}
const unusedIfBlank = (list: unknown[]): Slots => SLOTS.map((n) => {
  const d = list[n - 1]
  return isObj(d) && !isBlank(d, defaultSidebars) ? defOf(d) : null
})
let seen: unknown = undefined
let seenDef = ""
let local: Slots | null = null
let movesNow: Moves = NO_MOVES
let reorderedAt = 0
export function slots(): Slots | null {
  const w = getStore()?.workspaces
  const d = JSON.stringify(savedSidebars())
  if (w !== seen || d !== seenDef) {
    seen = w; seenDef = d
    const m = getStore()?.workspaceMoves ?? NO_MOVES
    if (local && m.seq < movesNow.seq && Date.now() - reorderedAt < 10_000) return local
    movesNow = m
    local = Array.isArray(w) ? unusedIfBlank(w) : null
  }
  return local
}
const followed = (n: number) => { const s = movesSeen.get(); return s >= 0 && s < movesNow.seq ? numberNow(movesNow, n, s) ?? n : n }
const picked = () => { const n = current_.get(); return n >= 1 && n <= MAX ? followed(n) : 0 }
const at = (path: string) => `${path}?moves=${movesNow.seq}`
export const current = () => (slots() ? picked() || used()[0] || 1 : 0)
export const lit = () => current() || 1

const version = cell(0)
export const emit = () => { version.update((n) => n + 1); workspaceChanged() }
export const useVersion = () => version.use()

let writing: Promise<unknown> = Promise.resolve()
function queue(write: () => Promise<unknown>): Promise<unknown> {
  return writing.catch(() => {}).then(async () => {
    for (let wait = 1000; ; wait *= 2) {
      try { return await write() } catch (e) {
        const status = e instanceof Error && "status" in e ? e.status : undefined
        if ((status !== undefined && status !== 503) || wait > 16_000) throw e
        await new Promise((r) => setTimeout(r, wait))
      }
    }
  })
}
export function patch(n: number, keys: Keys): void {
  const list = [...(slots() ?? SLOTS.map(() => null))]
  const had = list[n - 1]
  const next: Record<string, unknown> = { ...(had ?? {}) }
  for (const [k, v] of Object.entries(keys)) { if (v === null) delete next[k]; else next[k] = v }
  if (isBlank(next, defaultSidebars)) { if (had) blanked(n, keys); return }
  const held = memory.get(n)
  if (!had && held && Object.keys(held).length) { next.state = isObj(next.state) ? { ...held, ...next.state } : held; memory.delete(n) }
  list[n - 1] = defOf(next)
  local = list
  emit(); sidebarsChanged()
  const to = at(`workspaces/${n}`)
  writing = queue(() => put(to, had ? keys : next)).catch(() => {})
}

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
  const to = at(`workspaces/${n}`)
  writing = queue(() => put(to, { state: { [key]: v } })).catch(() => {})
}

const pinnedHere = (): string[] | null => { const n = current(); const p = n ? slots()?.[n - 1]?.pinned : undefined; return Array.isArray(p) ? p : null }
function pinHere(path: string, on: boolean, before: string | null | undefined, base: string[]) {
  const n = current()
  if (!n) return Promise.resolve()
  const cur = pinnedHere() ?? base
  const next = placePin(cur, path, on, before)
  if (next.join("\n") === cur.join("\n")) return Promise.resolve()
  const list = [...(slots() ?? SLOTS.map(() => null))]
  list[n - 1] = { ...(list[n - 1] ?? {}), pinned: next }
  local = list
  emit()
  const to = at(`workspaces/${n}/pins`)
  writing = queue(() => post(to, { path, pinned: on, ...(before !== undefined ? { before } : {}) })).catch((e) => { notifyError(e, "Couldn't pin it") })
  return writing
}
export function pinsForNew(n: number) {
  const to = at(`workspaces/${n}/pins/default`)
  writing = queue(() => post(to, {})).then(() => { notify("New workspaces start with these pinned pages") }, (e) => { notifyError(e) })
  return writing
}

const placesIn = (l: unknown): string[] => { const w = clean(l); return w ? [w, ...(w.windows ?? [])].flatMap(allPanes).map((p) => p.to) : [] }
const placesOf = (n: number): string[] => placesIn(n === current() ? getTabLayout() : slots()?.[n - 1]?.layout).filter((to) => to !== "new")

export const host: WorkspaceHost = {
  current: () => current() || 1,
  picked: () => picked(),
  list: (): WorkspaceInfo[] => SLOTS.filter((n) => slots()?.[n - 1] || n === current()).map((n) => ({ n, label: label(n), places: placesOf(n), ...lookOf(n) })),
  switchTo: (n) => switchTo(n),
  menu: () => {
    const n = current() || 1, free = SLOTS.find((m) => m !== n && !now(m))
    return [
      ...SLOTS.filter((m) => m === n || now(m)).map((m) => ({ label: label(m), icon: markIcon(m, lookOf(m)), checked: m === n, run: () => switchTo(m) })),
      ...(free ? [{ label: "New workspace", icon: Plus, run: () => switchTo(free) }] : []),
      ...slotMenu(n, () => askName(n)).map((it, i) => (i ? it : { ...it, sep: true })),
    ]
  },
  get: getState,
  set: setState,
  tabs: tabsOf,
  show: showTab,
  pinned: pinnedHere,
  pin: pinHere,
}
function blanked(n: number, keys: Keys) {
  const list = [...(slots() ?? SLOTS.map(() => null))]
  list[n - 1] = null
  local = list
  emit(); sidebarsChanged()
  const to = at(`workspaces/${n}`)
  writing = queue(() => put(to, keys)).catch(() => {})
}

const VISIT = new Set(["back", "fwd", "from"])
const strip = (l: TabLayout): TabLayout => JSON.parse(JSON.stringify(l, (k, v) => (VISIT.has(k) ? undefined : v)))
const layoutKey = (l: TabLayout | null | undefined) =>
  !l || blankLayout(l) ? "" : JSON.stringify(l, (k, v) => (VISIT.has(k) || k === "active" || k === "focus" || k === "zoom" || k === "seen" ? undefined : v))
const kept = new Map<number, TabLayout>()
const mine = new Set<string>()
let timer = 0
export const savePending = () => !!timer
export function saveTabs() {
  clearTimeout(timer); timer = 0
  if (moving) { timer = window.setTimeout(saveTabs, 300); return }
  const n = current()
  if (!n) return
  const saved = slots()?.[n - 1]?.layout, there = clean(saved)
  const l = strip(there ? withMyTabs(there) : getTabLayout())
  if (layoutKey(l) === layoutKey(saved) && !tabsSeenSince(saved)) return
  mine.add(layoutKey(l))
  if (mine.size > 20) mine.delete(mine.values().next().value!)
  patch(n, { layout: layoutKey(l) ? l : null })
}
let applying = false
function apply(l: TabLayout | null, merge = false, kept = false) {
  applying = true
  try { setTabLayout(l, { merge, kept }) } finally { applying = false }
}
export const saveTabsSoon = () => { if (applying) return; clearTimeout(timer); timer = window.setTimeout(saveTabs, 1000) }

let synced = false
let carry = false
let taking: TabLayout | null = null
export function tookTabs(own: TabLayout) { synced = false; mine.clear(); carry = document.hasFocus(); taking = own }
const UNSAVED = "vaultite.workspaces.unsaved"
export function leaving() {
  if (!savePending() || layoutKey(strip(getTabLayout())) === layoutKey(slots()?.[current() - 1]?.layout)) return
  try { sessionStorage.setItem(UNSAVED, String(current())) } catch { /* private mode */ }
  saveTabs()
}

function arrive() {
  arrived = true
  const at = wentTo ?? arrival
  const m = /^#(file|view)\/([^/]+)/.exec(at)
  if (m) { try { const to = decodeURIComponent(m[2]); if (m[1] === "file") openFile(to, { newTab: !placesIn(getTabLayout()).includes(`file:${to}`) }); else openView(to, { newTab: !isViewOpen(to) }) } catch {} }
  else if (at.length > 1 && location.hash !== at) replaceHash(at)
}

export function sync() {
  followMoves()
  if (!taking || !slots()) { syncTabs(); return }
  const own = taking
  taking = null; synced = true
  void takeIn(own)
}
function syncTabs() {
  const list = slots()
  if (!list) return
  if (!picked()) {
    synced = true
    const first = used()[0]
    current_.set(first || 1)
    if (!first || startedFresh) {
      const l = strip(getTabLayout())
      if (layoutKey(l)) patch(first || 1, { layout: l })
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
    let unsaved = false
    try { unsaved = sessionStorage.getItem(UNSAVED) === String(n); sessionStorage.removeItem(UNSAVED) } catch { /* private mode */ }
    const took = carry
    carry = false
    if (unsaved || startedFresh || (took && !list[n - 1])) { saveTabs(); arrive(); return }
    const want = list[n - 1]?.layout ?? null
    if (layoutKey(want) !== layoutKey(strip(getTabLayout()))) apply(want, true)
    else mergeTabsSeen(want)
    arrive()
    return
  }
  if (timer) return
  const want = list[n - 1]?.layout ?? null
  const there = layoutKey(want)
  if (there === layoutKey(strip(getTabLayout()))) { mergeTabsSeen(want); return }
  if (mine.has(there)) return
  mine.clear()
  apply(want, true)
}

export type Sent = { tab: string } | { pane: string } | { group: string } | { open: string[] }
export type Place = { at?: number; into?: string }
let moving = false

function without(l: TabLayout, what: Exclude<Sent, { open: string[] }>): TabLayout | null {
  if ("group" in what) return withoutTabs(l, new Set(l.tabs.filter((t) => t.group === what.group).map((t) => t.id)))
  return "tab" in what ? withoutTabs(l, new Set([what.tab])) : withoutPanes(l, new Set([what.pane]))
}
type Moved = { tabs: { id: string }[]; group?: string; workspaces: unknown[] }
function undoOf(what: Sent, r: Moved): Sent | null {
  if ("open" in what || !r.tabs.length) return null
  return "group" in what && r.group ? { group: r.group } : { tab: r.tabs[0].id }
}
function placeOf(what: Sent, before: TabLayout) {
  const i = before.tabs.findIndex((t) => ("tab" in what ? t.id === what.tab : "group" in what ? t.group === what.group : "pane" in what && placesOfTab(t).some((p) => p.id === what.pane)))
  if (i < 0) return {}
  return "tab" in what ? { at: i, into: before.tabs[i].group } : { at: "group" in what ? i : i + 1 }
}
function movedText(what: Sent, n: number, r: Moved) {
  if (!r.tabs.length) return `Already open in ${named(n)}`
  return "open" in what ? `Opened in ${named(n)}` : "group" in what ? `Moved the group to ${named(n)}` : `Moved to ${named(n)}`
}

export async function sendTo(n: number, what: Sent, place?: Place) {
  if (!slots() || moving) return
  const from = current()
  if (!from || from === n) return
  if (timer) saveTabs()
  moving = true
  const before = getTabLayout()
  const gone = "open" in what ? null : without(before, what)
  if (gone) apply(gone, true, true)
  await writing
  try {
    const r = await post<Moved>(at("workspaces/move"), { ...("open" in what ? {} : { from }), to: n, ...what, ...place })
    local = unusedIfBlank(r.workspaces)
    const l = local[from - 1]?.layout ?? null
    mine.add(layoutKey(l))
    apply(l, true)
    emit()
    const back = undoOf(what, r)
    notify(movedText(what, n, r), back ? { action: { label: "Undo", run: () => bringBack(n, from, back, placeOf(what, before)) } } : undefined)
  } catch (e) {
    if (gone) apply(before, true)
    notifyError(e, "open" in what ? "Couldn't open it there" : "Couldn't move it")
  } finally {
    moving = false
  }
}
async function bringBack(n: number, to: number, what: Sent, place: Place) {
  if (timer) saveTabs()
  await writing
  moving = true
  try {
    const r = await post<{ workspaces: unknown[] }>(at("workspaces/move"), { from: n, to, ...what, ...place })
    local = unusedIfBlank(r.workspaces)
    if (current() === to) { const l = local[to - 1]?.layout ?? null; mine.add(layoutKey(l)); apply(l, true) }
    emit()
  } catch (e) {
    notifyError(e, "Couldn't move it back")
  } finally {
    moving = false
  }
}

export const moveAt = (from: number, to: number, what: Exclude<Sent, { open: string[] }>, place: Place) =>
  (from === current() ? sendTo(to, what, place) : bringBack(from, to, what, place))

export const moveTab = (id: string, n: number) => sendTo(n, { tab: id })
export const moveBetween = (from: number, to: number, id: string) => (from === current() ? sendTo(to, { tab: id }) : bringBack(from, to, { tab: id }, {}))

async function deviceName(): Promise<string | null> {
  const { z } = await import("zod")
  const Devices = z.object({ devices: z.array(z.object({ id: z.string(), name: z.string(), label: z.string().optional() })) })
  try { const d = Devices.parse(await get("tabs/devices")).devices.find((x) => x.id === DEVICE); return d ? d.label || d.name : null } catch { return null }
}

async function takeIn(own: TabLayout) {
  const n = picked() || 1
  current_.set(n)
  emit(); sidebarsChanged()
  const had = !blankLayout(slots()?.[n - 1]?.layout)
  moving = true
  try {
    await writing
    const name = await deviceName()
    const r = await post<{ tabs: Tab[]; workspaces: unknown[] }>(at("workspaces/take"), { to: n, tabs: strip(own), name: name && `From ${name}` })
    local = unusedIfBlank(r.workspaces)
    const l = local[n - 1]?.layout ?? null
    mine.add(layoutKey(l))
    apply(l, true, true)
    emit(); sidebarsChanged()
    if (had && r.tabs.length) {
      notify(`${plural(r.tabs.length, "tab")} from this device ${r.tabs.length === 1 ? "is" : "are"} in ${named(n)}${name ? `, in the group "From ${name}"` : ""}`,
        { action: { label: "Show workspaces", run: showAllTabs } })
    }
  } catch (e) {
    notifyError(e, "Couldn't put this device's tabs in a workspace")
  } finally {
    moving = false
  }
  arrive()
}

export const ALL_TABS = "all-tabs"
export const showAllTabs = () => openView(ALL_TABS, { newTab: !isViewOpen(ALL_TABS) })

export function listsOf(n: number): TabList[] {
  const l = n === current() ? getTabLayout() : clean(slots()?.[n - 1]?.layout)
  return l ? [l, ...(l.windows ?? [])] : []
}
export function tabsOf(n: number): Tab[] { return listsOf(n).flatMap((x) => x.tabs) }
export function showTab(n: number, id: string) {
  switchTo(n)
  selectTab(id)
}
export function markOf(n: number) {
  for (const p of tabsOf(n).flatMap(placesOfTab)) { const m = p.to.startsWith("view:") ? viewInfo(p.to, undefined, p.id).mark : undefined; if (m) return m }
  return null
}
export function othersOnly() {
  const here = new Set(allPanes(getTabLayout()).map((p) => p.id)), n = current()
  return SLOTS.filter((m) => m !== n).flatMap(tabsOf).flatMap(placesOfTab).filter((p) => !here.has(p.id))
}

export function currentTab(): string | null {
  const t = shownTab(getTabLayout())
  return t && focusedPane(t).to !== "new" ? t.id : null
}

export function switchTo(n: number) {
  if (!slots()) return
  const now = current()
  if (n === now) return
  if (now) { saveTabs(); kept.set(now, getTabLayout()) }
  const d = slots()![n - 1]
  current_.set(n)
  emit(); sidebarsChanged()
  const k = kept.get(n)
  apply(k && layoutKey(k) === layoutKey(d?.layout) ? k : d?.layout ?? null, false, true)
}

export const used = () => SLOTS.filter((n) => slots()?.[n - 1])

function followMoves() {
  const s = movesSeen.get()
  if (!slots() || s === movesNow.seq) return
  const was = current_.get()
  movesSeen.set(movesNow.seq)
  if (s < 0 || s > movesNow.seq) return
  const n = was >= 1 && was <= MAX ? numberNow(movesNow, was, s) ?? Math.max(1, Math.min(was, used().length)) : 0
  if (n && n !== was) current_.set(n)
  const renumber = <V,>(m: Map<number, V>) => {
    const was = [...m]
    m.clear()
    for (const [k, v] of was) { const to = numberNow(movesNow, k, s); if (to) m.set(to, v) }
  }
  renumber(kept); renumber(memory)
}

export function reorder(from: number, to: number) {
  const list = slots()
  if (!list || from === to || !list[from - 1] && from !== current()) return
  if (timer) saveTabs()
  const path = at("workspaces/order")
  writing = queue(async () => {
    const r = await post<{ workspaces: unknown[]; moves: Moves }>(path, { from, to })
    reorderedAt = Date.now()
    local = unusedIfBlank(r.workspaces)
    movesNow = r.moves
    followMoves()
    emit(); sidebarsChanged()
  }).catch((e) => { notifyError(e, "Couldn't reorder the workspaces") })
  return writing
}

export function openElsewhere(): string[] {
  const n = current()
  return (slots() ?? []).flatMap((d, i) => (d && i + 1 !== n ? placesIn(d.layout) : []))
}
export function cycle(dir: 1 | -1) {
  const u = used()
  if (u.length < 2) return
  const i = u.indexOf(current())
  switchTo(u[(i + dir + u.length) % u.length])
}

let renaming = 0
export const getRenaming = () => renaming
export const setRenaming = (n: number) => { renaming = n; emit() }
export function renamed(n: number, name: string | null) {
  if (renaming !== n) return
  setRenaming(0)
  if (name !== null) patch(n, { name: name.trim() || null })
}
function askName(n: number) {
  const name = slots()?.[n - 1]?.name ?? ""
  askText({
    title: "Rename workspace", heading: `Rename workspace "${label(n)}"`, placeholder: "Name this workspace…", typed: name,
    hint: name ? `Enter to go back to the automatic name, "Workspace ${n}"` : "Type a name",
    label: (t) => `Rename to "${t}"`, icon: Pencil, onText: (t) => { patch(n, { name: t }) }, onBlank: () => { patch(n, { name: null }) },
  })
}
export const label = (n: number) => slots()?.[n - 1]?.name || `Workspace ${n}`
export function lookOf(n: number): Pick<WorkspaceInfo, "icon" | "tint" | "container"> {
  const d = slots()?.[n - 1]
  return { ...(typeof d?.icon === "string" && d.icon ? { icon: d.icon } : {}), ...(isColor(d?.tint) ? { tint: d.tint } : {}),
    ...(typeof d?.container === "string" && d.container ? { container: d.container } : {}) }
}
export const askIcon = (n: number) => pickIcon({ title: `Icon for ${named(n)}`, current: lookOf(n).icon, onPick: (i) => { patch(n, { icon: i }) },
  noIcon: { label: `Its number, ${n}`, mark: markIcon(n, { tint: lookOf(n).tint }), onPick: () => { patch(n, { icon: null }) } } })
export function tintItems(n: number): MenuItem[] {
  const { tint } = lookOf(n)
  return [{ label: "No colour", checked: !tint, run: () => { patch(n, { tint: null }) } }, ...colorItems(tint ?? "", (c) => { patch(n, { tint: c }) })]
}
export function containerItems(n: number): { items: MenuItem[]; name?: string } {
  const { container } = lookOf(n), boxes = webContainers()
  if (!boxes.length) return { items: [] }
  return { name: boxes.find((b) => b.id === container)?.name, items: [
    { label: "No container", icon: Box, checked: !boxes.some((b) => b.id === container), run: () => { patch(n, { container: null }) } },
    ...boxes.map((b) => ({ label: b.name, icon: dotIcon(colorVar(b.color)), checked: b.id === container, run: () => { patch(n, { container: b.id }) } })),
  ] }
}
function lookItems(n: number): MenuItem[] {
  const { tint } = lookOf(n), box = containerItems(n)
  return [
    { label: "Change icon", icon: Smile, run: () => askIcon(n) },
    { label: "Colour", icon: tint ? dotIcon(colorVar(tint)) : Palette, run: () => {}, items: tintItems(n) },
    ...(box.items.length ? [{ label: "Container", icon: Box, hint: box.name, run: () => {}, items: box.items }] : []),
  ]
}
export const named = (n: number) => slots()?.[n - 1]?.name || `workspace ${n}`

function now(n: number): Def | null {
  if (n !== current()) return slots()?.[n - 1] ?? null
  const d: Def = { ...(slots()?.[n - 1] ?? {}), layout: strip(getTabLayout()) }
  return isBlank(d, defaultSidebars) ? null : d
}

export function remove(n: number) {
  const was = now(n)
  if (!was) return
  const here = n === current()
  kept.delete(n); memory.delete(n)
  if (here) { clearTimeout(timer); timer = 0 }
  moving = true
  const path = at(`workspaces/${n}`)
  writing = queue(async () => {
    const r = await del<{ workspaces: unknown[]; moves: Moves }>(path)
    reorderedAt = Date.now()
    local = unusedIfBlank(r.workspaces)
    movesNow = r.moves
    followMoves()
    if (here) { const m = current(), k = kept.get(m), d = local[m - 1]; apply(k && layoutKey(k) === layoutKey(d?.layout) ? k : d?.layout ?? null, false, true) }
    emit(); sidebarsChanged()
    notify(`Deleted ${was.name || `workspace ${n}`}`, { action: { label: "Undo", run: () => restore(n, was, here) } })
  }).catch((e) => { notifyError(e, "Couldn't delete it") }).finally(() => { moving = false })
}
async function restore(n: number, was: Def, here: boolean) {
  const free = SLOTS.find((m) => !now(m))
  if (!free) return
  patch(free, { ...was })
  if (free !== n) await reorder(free, n)
  if (here) switchTo(n)
}

const moveItems = (n: number): MenuItem[] => [
  ...(n > 1 ? [{ label: "Move up", icon: ArrowUp, run: () => reorder(n, n - 1) }] : []),
  ...(now(n + 1) ? [{ label: "Move down", icon: ArrowDown, run: () => reorder(n, n + 1) }] : []),
].map((m, i) => (i ? m : { ...m, sep: true }))

export function slotMenu(n: number, rename = () => setRenaming(n)): MenuItem[] {
  const has = !!now(n)
  const d = slots()?.[n - 1]
  const free = SLOTS.find((m) => m !== n && !now(m))
  const own = d?.sidebars && !defaultSidebars(d.sidebars) ? d.sidebars : null
  return [
    { label: "Rename", icon: Pencil, run: rename },
    ...lookItems(n),
    ...(has ? [{ label: free ? `Duplicate to workspace ${free}` : `Duplicate (all ${MAX} are in use)`, icon: Copy, disabled: !free, run: () => {
      const { name: _name, ...rest } = now(n)!
      patch(free!, rest)
      if (free === current()) { apply(rest.layout ?? null); sidebarsChanged() }
    } }] : []),
    ...(has ? moveItems(n) : []),
    ...(own ? [
      { label: "Use these panels for new workspaces", icon: LayoutPanelLeft, sep: true, run: () => { setDefaultSidebars(own); notify("New workspaces start with these panels") } },
    ] : []),
    ...(n === current() ? [{ label: "Settings…", icon: Settings2, sep: !own, run: () => openPluginSettings("workspaces") }] : []),
    ...(has ? [{ label: "Delete", icon: Trash2, danger: true, sep: true, run: () => remove(n) }] : []),
  ]
}
