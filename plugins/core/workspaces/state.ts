import { Box, CircleSlash, Copy, LayoutPanelLeft, Palette, Pencil, Plus, Settings2, Smile, Trash2 } from "lucide-react"
import {
  cell, colorItems, colorVar, del, devicePref, dotIcon, isColor, mergeTabsSeen, pickIcon, tabsSeenSince, webContainers, getStore, getTabLayout, isViewOpen, notify, notifyError, openFile, openPluginSettings, openView, placePin, post, put, readSidebars,
  replaceHash, sameSidebars, savedSidebars, setDefaultSidebars, setTabLayout, sidebarsChanged, startedFresh, workspaceChanged, type MenuItem,
  allPanes, cleanTabLayout as clean, focusedPane, placesIn as placesOfTab, shownTab, withMyTabs, withoutPanes, withoutTabs, type Sidebars, type TabLayout, type WorkspaceHost, type WorkspaceInfo,
} from "@vaultite"
import { blankLayout, isBlank, isObj, type Obj } from "./blank"
import { markIcon } from "./Mark"

const MAX = 5
export const SLOTS = Array.from({ length: MAX }, (_, i) => i + 1)
type Def = { name?: string; icon?: unknown; tint?: unknown; container?: unknown; sidebars?: Sidebars; layout?: TabLayout; pinned?: unknown; state?: Obj }
type Slots = (Def | null)[]

const current_ = devicePref<number>("workspace", 0)
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
export function slots(): Slots | null {
  const w = getStore()?.workspaces
  const d = JSON.stringify(savedSidebars())
  if (w !== seen || d !== seenDef) {
    seen = w; seenDef = d
    local = Array.isArray(w) ? unusedIfBlank(w) : null
  }
  return local
}
const picked = () => { const n = current_.get(); return n >= 1 && n <= MAX ? n : 0 }
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
export function patch(n: number, keys: Partial<Record<keyof Def, unknown>>): void {
  const list = [...(slots() ?? SLOTS.map(() => null))]
  const had = list[n - 1]
  const next: Record<string, unknown> = { ...(had ?? {}) }
  for (const [k, v] of Object.entries(keys)) { if (v === null) delete next[k]; else next[k] = v }
  if (isBlank(next, defaultSidebars)) { if (had) clear(n); return }
  const held = memory.get(n)
  if (!had && held && Object.keys(held).length) { next.state = isObj(next.state) ? { ...held, ...next.state } : held; memory.delete(n) }
  list[n - 1] = defOf(next)
  local = list
  emit(); sidebarsChanged()
  writing = queue(() => put(`workspaces/${n}`, had ? keys : next)).catch(() => {})
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
  writing = queue(() => put(`workspaces/${n}`, { state: { [key]: v } })).catch(() => {})
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
  writing = queue(() => post(`workspaces/${n}/pins`, { path, pinned: on, ...(before !== undefined ? { before } : {}) })).catch((e) => { notifyError(e, "Couldn't pin it") })
  return writing
}
export function pinsForNew(n: number) {
  writing = queue(() => post(`workspaces/${n}/pins/default`, {})).then(() => { notify("New workspaces start with these pinned pages") }, (e) => { notifyError(e) })
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

const VISIT = new Set(["back", "fwd", "from"])
const strip = (l: TabLayout): TabLayout => JSON.parse(JSON.stringify(l, (k, v) => (VISIT.has(k) ? undefined : v)))
const shape = (l: TabLayout | null | undefined) =>
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
  if (shape(l) === shape(saved) && !tabsSeenSince(saved)) return
  mine.add(shape(l))
  if (mine.size > 20) mine.delete(mine.values().next().value!)
  patch(n, { layout: shape(l) ? l : null })
}
let applying = false
function apply(l: TabLayout | null, merge = false, kept = false) {
  applying = true
  try { setTabLayout(l, { merge, kept }) } finally { applying = false }
}
export const saveTabsSoon = () => { if (applying) return; clearTimeout(timer); timer = window.setTimeout(saveTabs, 1000) }

let synced = false
let carry = false
export function tookTabs() { synced = false; mine.clear(); carry = document.hasFocus() }
const UNSAVED = "vaultite.workspaces.unsaved"
export function leaving() {
  if (!savePending() || shape(strip(getTabLayout())) === shape(slots()?.[current() - 1]?.layout)) return
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
  const list = slots()
  if (!list) return
  if (!picked()) {
    synced = true
    const first = used()[0]
    current_.set(first || 1)
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
    let unsaved = false
    try { unsaved = sessionStorage.getItem(UNSAVED) === String(n); sessionStorage.removeItem(UNSAVED) } catch { /* private mode */ }
    const took = carry
    carry = false
    if (unsaved || startedFresh || (took && !list[n - 1])) { saveTabs(); arrive(); return }
    const want = list[n - 1]?.layout ?? null
    if (shape(want) !== shape(strip(getTabLayout()))) apply(want, true)
    else mergeTabsSeen(want)
    arrive()
    return
  }
  if (timer) return
  const want = list[n - 1]?.layout ?? null
  const there = shape(want)
  if (there === shape(strip(getTabLayout()))) { mergeTabsSeen(want); return }
  if (mine.has(there)) return
  mine.clear()
  apply(want, true)
}

export type Sent = { tab: string } | { pane: string } | { open: string[] }
let moving = false

function without(l: TabLayout, what: { tab: string } | { pane: string }): TabLayout | null {
  return "tab" in what ? withoutTabs(l, new Set([what.tab])) : withoutPanes(l, new Set([what.pane]))
}

export async function sendTo(n: number, what: Sent) {
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
    const r = await post<{ tabs: { id: string }[]; workspaces: unknown[] }>("workspaces/move", { ...("open" in what ? {} : { from }), to: n, ...what })
    local = unusedIfBlank(r.workspaces)
    const l = local[from - 1]?.layout ?? null
    mine.add(shape(l))
    apply(l, true)
    emit()
    const back: Sent | null = "open" in what || !r.tabs.length ? null : { tab: r.tabs[0].id }
    const i = before.tabs.findIndex((t) => ("tab" in what ? t.id === what.tab : "pane" in what && placesOfTab(t).some((p) => p.id === what.pane)))
    const place = i < 0 ? {} : "tab" in what ? { at: i, group: before.tabs[i].group } : { at: i + 1 }
    notify(r.tabs.length ? ("open" in what ? `Opened in ${named(n)}` : `Moved to ${named(n)}`) : `Already open in ${named(n)}`,
      back ? { action: { label: "Undo", run: () => void bringBack(n, from, back, place) } } : undefined)
  } catch (e) {
    if (gone) apply(before, true)
    notifyError(e, "open" in what ? "Couldn't open it there" : "Couldn't move it")
  } finally {
    moving = false
  }
}
async function bringBack(n: number, to: number, what: Sent, place: { at?: number; group?: string }) {
  if (timer) saveTabs()
  await writing
  moving = true
  try {
    const r = await post<{ workspaces: unknown[] }>("workspaces/move", { from: n, to, ...what, ...place })
    local = unusedIfBlank(r.workspaces)
    if (current() === to) { const l = local[to - 1]?.layout ?? null; mine.add(shape(l)); apply(l, true) }
    emit()
  } catch (e) {
    notifyError(e, "Couldn't move it back")
  } finally {
    moving = false
  }
}

export const moveTab = (id: string, n: number) => sendTo(n, { tab: id })

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
  apply(k && shape(k) === shape(d?.layout) ? k : d?.layout ?? null, false, true)
}

export const used = () => SLOTS.filter((n) => slots()?.[n - 1])

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
export const label = (n: number) => slots()?.[n - 1]?.name || `Workspace ${n}`
export function lookOf(n: number): Pick<WorkspaceInfo, "icon" | "tint" | "container"> {
  const d = slots()?.[n - 1]
  return { ...(typeof d?.icon === "string" && d.icon ? { icon: d.icon } : {}), ...(isColor(d?.tint) ? { tint: d.tint } : {}),
    ...(typeof d?.container === "string" && d.container ? { container: d.container } : {}) }
}
export const askIcon = (n: number) => pickIcon({ title: `Icon for ${named(n)}`, current: lookOf(n).icon, onPick: (i) => { patch(n, { icon: i }) } })
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
export function lookItems(n: number): MenuItem[] {
  const { icon, tint } = lookOf(n), box = containerItems(n)
  return [
    { label: "Change icon", icon: Smile, run: () => askIcon(n) },
    ...(icon ? [{ label: "Remove icon", icon: CircleSlash, run: () => { patch(n, { icon: null }) } }] : []),
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

export function slotMenu(n: number, rename = true): MenuItem[] {
  const has = !!now(n)
  const d = slots()?.[n - 1]
  const free = SLOTS.find((m) => m !== n && !now(m))
  const own = d?.sidebars && !defaultSidebars(d.sidebars) ? d.sidebars : null
  return [
    ...(rename ? [{ label: "Rename", icon: Pencil, run: () => setRenaming(n) }] : []),
    ...lookItems(n),
    { label: !has ? "Duplicate" : free ? `Duplicate to workspace ${free}` : "Duplicate (all five are in use)", icon: Copy, disabled: !has || !free, run: () => {
      const { name: _name, ...rest } = now(n)!
      patch(free!, rest)
      if (free === current()) { apply(rest.layout ?? null); sidebarsChanged() }
    } },
    ...(own ? [
      { label: "Use these panels for new workspaces", icon: LayoutPanelLeft, sep: true, run: () => { setDefaultSidebars(own); notify("New workspaces start with these panels") } },
    ] : []),
    ...(n === current() ? [{ label: "Settings…", icon: Settings2, sep: !own, run: () => openPluginSettings("workspaces") }] : []),
    { label: "Delete", icon: Trash2, danger: true, sep: true, disabled: !has, run: () => remove(n) },
  ]
}
