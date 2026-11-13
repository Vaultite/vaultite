import { isColor, type Color } from "./colors.ts"

/** One view with its own history: what a tab shows, or one part of a split tab. */
export type Pane = { id: string; to: string
  /** Where it was before, oldest first; and where Back came from, the next first. */
  back?: string[]; fwd?: string[]
  /** The pane it was opened from: Back past its first place closes it and shows that one again. Kept for this visit
   *  only, like its history. */
  from?: string
  /** Its place when its tab was pinned: ⌘W takes it back there. */
  home?: string
  /** When it was last on screen: ms, to the minute. */
  seen?: number
  /** Floating over the tab's other panes at this place (shares of the workspace), out of the tiling: its spot in the
   *  tree is kept, empty, so docking it puts it back where it came from. */
  float?: Rect
  /** A split's pane has tabs of its own: its other places, hidden, each a pane of its own (its id, its history; no stack
   *  nor float), in their order with this one at `stackAt` (none: first). Never in a tab of one pane (`spilled`). */
  stack?: Pane[]; stackAt?: number }
/** Panes (or splits) side by side ("row": a vertical divider between them) or stacked ("col"); `sizes` are their
 *  shares, adding up to 1. */
export type Split = { id: string; dir: "row" | "col"; kids: Layout[]; sizes: number[] }
export type Layout = Pane | Split
type Loose = Pane | (Omit<Split, "kids"> & { kids: (Loose | null)[] })
/** A tab: its panes in a tree of splits (one pane, mostly), the one `focus`ed, and the one filling it for now (`zoom`,
 *  tmux's). */
export type Tab = { id: string; root: Layout; focus: string; zoom?: string
  /** The name the user gave it (Rename tab), shown for what has no name of its own. */
  name?: string
  /** Pinned: what's opened from it opens in a tab beside it, ⌘W and closing others leave it open. */
  pinned?: boolean
  group?: string
  /** A split whose panes have tabs of their own, folded in the Tabs panel: its map says how many each has (+2), not
   *  listing them under its row. Gone once no pane has others, so the next ones start listed. */
  folded?: boolean }
/** A tab group, as browsers have them: a named, coloured run of tabs side by side (those whose `group` is its id),
 *  folded to its name while `collapsed`. */
export type Group = { id: string; name: string; color: Color; collapsed?: boolean }
/** A window's tabs, in order, their groups (in the order their tabs are) and the one on screen. */
export type TabList = { tabs: Tab[]; groups?: Group[]; active: string }
/** A pop-out; `barsHidden`: only what it shows (Hide window bars). */
export type Window = TabList & { id: string; barsHidden?: boolean }
/** A workspace: the main window's tabs, and its pop-outs'. */
export type Workspace = TabList & { windows?: Window[] }
export type Side = "left" | "right" | "top" | "bottom"

let seq = 0
const base = () => `${Date.now().toString(36)}${(seq++).toString(36)}`
/** A new pane's id (panes opened before tabs held panes kept their tabs' "t…" ids). */
export const newPaneId = () => `p${base()}`
export const newTabId = () => `t${base()}`
export const newSplitId = () => `s${base()}`
export const newGroupId = () => `g${base()}`
export const isSplit = (n: Layout): n is Split => "kids" in n
export const leaves = (n: Layout): Pane[] => (isSplit(n) ? n.kids.flatMap(leaves) : [n])
/** A tab's panes (what each shows: placesIn has the places stacked under them too). */
export const panesOf = (t: Tab): Pane[] => leaves(t.root)
/** The pane a tab has focused. */
export const focusedPane = (t: Tab): Pane => panesOf(t).find((p) => p.id === t.focus) ?? panesOf(t)[0]
/** The tab on screen in a list. */
export const shownTab = (l: TabList): Tab | undefined => l.tabs.find((t) => t.id === l.active)
export const bare = (p: Pane): Pane => {
  if (!p.stack && p.stackAt === undefined) return p
  const { stack: _, stackAt: _a, ...rest } = p
  return rest
}
/** Pane `p`'s places, its tabs, in their order: what it shows and what's stacked under it (each bare). */
export function placesOf(p: Pane): Pane[] {
  if (!p.stack?.length) return [bare(p)]
  const at = Math.min(p.stackAt ?? 0, p.stack.length)
  return [...p.stack.slice(0, at), bare(p), ...p.stack.slice(at)]
}
/** Every place open in a tab: each pane's, in their order. */
export const placesIn = (t: Tab): Pane[] => leaves(t.root).flatMap(placesOf)
/** The pane of tree `n` that has place `id`, shown or stacked under it. */
export const paneWith = (n: Layout, id: string): Pane | undefined => leaves(n).find((p) => p.id === id || !!p.stack?.some((x) => x.id === id))
export const isStacked = (n: Layout, id: string) => leaves(n).some((p) => !!p.stack?.some((x) => x.id === id))
/** The tab that has place `id` (a pane, or a place stacked under one). */
export const tabOfPane = (l: TabList, id: string): Tab | undefined => l.tabs.find((t) => placesIn(t).some((p) => p.id === id))
/** Every place open in a list: every pane of every tab, and what's stacked under them. */
export const allPanes = (l: TabList): Pane[] => l.tabs.flatMap(placesIn)
export function stacked(places: Pane[], shown: string, at?: Pane): Pane {
  const i = Math.max(0, places.findIndex((p) => p.id === shown))
  const loose = (p: Pane) => { const { stack: _, stackAt: _a, float: _f, ...rest } = p; return rest }
  const rest = places.filter((_, j) => j !== i).map(loose)
  return { ...loose(places[i]), ...(at?.float ? { float: at.float } : {}), ...(rest.length ? { stack: rest, ...(i ? { stackAt: i } : {}) } : {}) }
}
/** A file from outside the vault is absolute: "file:/…". */
export const tabPath = (to: string) => (to.startsWith("file:") ? to.slice(5) : null)
export const vaultPath = (to: string) => (to.startsWith("file:") && !to.startsWith("file:/") ? to.slice(5) : null)
export const tabOf = (to: string, opts: { id?: string; pane?: string } & Partial<Omit<Pane, "id" | "to">> = {}): Tab => {
  const { id = newTabId(), pane = newPaneId(), ...rest } = opts
  return { id, root: { id: pane, to, ...rest }, focus: pane }
}
export const tabWith = (p: Pane, id = newTabId()): Tab => { const { float: _, ...rest } = bare(p); return { id, root: rest, focus: p.id } }
export const blankList = (): TabList => { const t = tabOf("new"); return { tabs: [t], active: t.id } }

/** 200px of a workspace up to 4000px wide. */
const THIN = 0.05

/** A part gone (null) leaves its room to its tiled neighbour; one too thin to use comes back at an even share. */
export function tidy(n: Loose | null): Layout | null {
  if (!n) return null
  if (!("kids" in n)) return n
  const kids: Layout[] = [], sizes: number[] = []
  let left = 0
  n.kids.forEach((k, i) => {
    const t = tidy(k)
    const s = n.sizes[i] > 0 ? n.sizes[i] : 1 / n.kids.length
    if (!t && k && "kids" in k && !k.kids.length) return
    if (!t) { const j = kids.findLastIndex(tiled); if (j >= 0) sizes[j] += s; else left += s; return }
    const at = sizes.length
    if (isSplit(t) && t.dir === n.dir) t.kids.forEach((x, j) => { kids.push(x); sizes.push(s * t.sizes[j]) })
    else { kids.push(t); sizes.push(s) }
    const j = kids.findIndex((x, m) => m >= at && tiled(x))
    if (j >= 0) { sizes[j] += left; left = 0 }
  })
  if (kids.length < 2) return kids[0] ?? null
  const sum = sizes.reduce((a, b) => a + b, 0)
  return { ...n, kids, sizes: unthinned(sizes.map((s) => s / sum)) }
}
function unthinned(shares: number[]) {
  const even = 1 / shares.length, thin = Math.min(THIN, even / 2)
  const n = shares.filter((s) => s < thin).length
  if (!n) return shares
  const rest = shares.reduce((a, s) => (s < thin ? a : a + s), 0)
  return shares.map((s) => (s < thin ? even : (s * (1 - n * even)) / rest))
}
export function withoutPanesIn(n: Layout, ids: Set<string>): Layout | null {
  const cut = (x: Layout): Loose | null => {
    if (!isSplit(x)) return ids.has(x.id) ? null : x
    const kept = x.kids.flatMap((k, i) => (!isSplit(k) && k.float && ids.has(k.id) ? [] : [i]))
    return { ...x, kids: kept.map((i) => cut(x.kids[i])), sizes: kept.map((i) => x.sizes[i]) }
  }
  return tidy(cut(n))
}

const strings = (a: unknown): a is string[] => Array.isArray(a) && a.every((x) => typeof x === "string")
const str = (s: unknown): s is string => typeof s === "string" && !!s
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n)
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null
const savedShare = (split: Obj, i: number) => { const s = isObj(split.sizes) ? split.sizes[i] : undefined; return typeof s === "number" ? s : 1 }
function okPane(x: Obj, top = true): Pane | null {
  if (!str(x.id) || !str(x.to)) return null
  const float = top ? okFloat(x.float) : null
  const stack = top && Array.isArray(x.stack) ? x.stack.flatMap((s) => { const p = isObj(s) ? okPane(s, false) : null; return p && p.id !== x.id ? [p] : [] }) : []
  const at = typeof x.stackAt === "number" && Number.isInteger(x.stackAt) ? Math.min(Math.max(0, x.stackAt), stack.length) : 0
  return { id: x.id, to: x.to, ...(strings(x.back) ? { back: x.back } : {}), ...(strings(x.fwd) ? { fwd: x.fwd } : {}),
    ...(str(x.from) ? { from: x.from } : {}), ...(str(x.home) ? { home: x.home } : {}),
    ...(typeof x.seen === "number" ? { seen: x.seen } : {}), ...(float ? { float } : {}), ...(stack.length ? { stack, ...(at ? { stackAt: at } : {}) } : {}) }
}
export function cleanLayout(x: unknown): Layout | null {
  if (!isObj(x)) return null
  if (Array.isArray(x.kids)) {
    const kids = x.kids.map(cleanLayout)
    return tidy({ id: str(x.id) ? x.id : newSplitId(), dir: x.dir === "col" ? "col" : "row", kids, sizes: kids.map((_, i) => savedShare(x, i)) })
  }
  return okPane(x)
}
function okFloat(r: unknown): Rect | null {
  if (!isObj(r)) return null
  const { x, y, w: rw, h: rh } = r
  if (!finite(x) || !finite(y) || !finite(rw) || !finite(rh)) return null
  const w = Math.min(1, Math.max(0.05, rw)), h = Math.min(1, Math.max(0.05, rh))
  return { x: Math.min(1 - w, Math.max(0, x)), y: Math.min(1 - h, Math.max(0, y)), w, h }
}
const groupsIn = (s: unknown): Group[] => (isObj(s) && str(s.id) && typeof s.name === "string" && isColor(s.color)
  ? [{ id: s.id, name: s.name.slice(0, 80), color: s.color, ...(s.collapsed === true ? { collapsed: true } : {}) }] : [])
function okTab(x: Obj): Tab | null {
  const root = cleanLayout(x.root)
  if (!root || !str(x.id)) return null
  return settledTab({ id: x.id, root, focus: String(x.focus ?? ""), ...(str(x.zoom) ? { zoom: x.zoom } : {}),
    ...(str(x.name) ? { name: x.name.slice(0, 80) } : {}), ...(x.pinned === true ? { pinned: true } : {}), ...(str(x.group) ? { group: x.group } : {}),
    ...(x.folded === true ? { folded: true } : {}) })
}
function firstPlaces(t: Tab, taken: Set<string>): Tab | null {
  const seen = new Set(taken), gone = new Set<string>()
  const root = mapPanes(t.root, (p) => {
    const ps = placesOf(p).filter((x) => !seen.has(x.id) && !!seen.add(x.id))
    if (!ps.length) { const k = `\0${gone.size}`; gone.add(k); return { ...p, id: k } }
    return ps.length === placesOf(p).length ? p : stacked(ps, ps.some((x) => x.id === p.id) ? p.id : ps[0].id, p)
  })
  const left = gone.size ? withoutPanesIn(root, gone) : root
  return left && (left === t.root ? t : settledTab({ ...t, root: left }))
}
function okList(x: Obj, taken = new Set<string>()): TabList | null {
  const tabs = (Array.isArray(x.tabs) ? x.tabs : []).flatMap((t) => {
    const ok = isObj(t) ? okTab(t) : null
    const own = ok && !taken.has(ok.id) ? firstPlaces(ok, taken) : null
    if (!own) return []
    taken.add(own.id); placesIn(own).forEach((p) => taken.add(p.id))
    return [own]
  })
  if (!tabs.length) return null
  const groups = (Array.isArray(x.groups) ? x.groups : []).flatMap(groupsIn)
  return fixGroups(spilled({ tabs, ...(groups.length ? { groups } : {}), active: (tabs.find((t) => t.id === x.active) ?? tabs[0]).id }))
}
/** A saved workspace, checked; one saved before tabs held panes (`{root, focus, zoom}`) is migrated. Null: no tab. */
export function clean(w: unknown): Workspace | null {
  if (!isObj(w)) return null
  if (!Array.isArray(w.tabs) && w.root) return migrate(w)
  const taken = new Set<string>()
  const main = okList(w, taken)
  if (!main) return null
  const windows = (Array.isArray(w.windows) ? w.windows : []).flatMap((o) => {
    if (!isObj(o) || !str(o.id)) return []
    const l = okList(o, taken)
    return l ? [{ id: o.id, ...l, ...(o.barsHidden === true ? { barsHidden: true } : {}) }] : []
  })
  return windows.length ? { ...main, windows } : main
}

/** Each tab's id is "t" + its first pane's, so every device and the server migrate a layout alike. */
export function migrate(old: Obj): Workspace | null {
  type OldTab = Obj & { id: string; to: string }
  const isOldTab = (t: unknown): t is OldTab => isObj(t) && str(t.id) && str(t.to)
  type OldGroup = { id: string; tabs: OldTab[]; active: string; float?: unknown }
  const groups: Group[] = [], seen = new Set<string>(), gs: OldGroup[] = []
  const walk = (x: unknown): Loose | null => {
    if (!isObj(x)) return null
    if (Array.isArray(x.kids)) return { id: str(x.id) ? x.id : newSplitId(), dir: x.dir === "col" ? "col" : "row", kids: x.kids.map(walk),
      sizes: x.kids.map((_, i) => savedShare(x, i)) }
    const tabs = (Array.isArray(x.tabs) ? x.tabs : []).filter(isOldTab).filter((t) => !seen.has(t.id) && !!seen.add(t.id))
    if (!tabs.length) return null
    for (const s of Array.isArray(x.sets) ? x.sets : []) for (const g of groupsIn(s)) if (!groups.some((h) => h.id === g.id)) groups.push(g)
    const g: OldGroup = { id: String(x.id), tabs, active: (tabs.find((t) => t.id === x.active) ?? tabs[0]).id, float: x.float }
    gs.push(g)
    return okPane({ ...shown(g), float: g.float })
  }
  const shown = (g: OldGroup) => g.tabs.find((t) => t.id === g.active)!
  const root = tidy(walk(old.root))
  if (!root) return null
  const tabFrom = (t: OldTab, root: Layout, focus: string, zoom?: string): Tab => ({ id: `t${leaves(root)[0].id}`, root, focus, ...(zoom ? { zoom } : {}),
    ...(str(t.name) ? { name: t.name } : {}), ...(t.pinned === true ? { pinned: true } : {}), ...(str(t.set) ? { group: t.set } : {}) })
  const focusGroup = gs.find((g) => g.id === old.focus) ?? gs[0], zoomGroup = gs.find((g) => g.id === old.zoom)
  const focus = shown(focusGroup).id
  const split = tabFrom(shown(focusGroup), root, focus, zoomGroup ? shown(zoomGroup).id : undefined)
  const tabs: Tab[] = []
  for (const g of gs) for (const t of g.tabs) {
    if (t.id === focus) tabs.push(split)
    else if (t.id !== shown(g).id) { const p = okPane({ ...t, float: undefined }); if (p) tabs.push(tabFrom(t, p, p.id)) }
  }
  return clean({ tabs, groups, active: split.id })
}

export const mapPanes = (n: Layout, fn: (p: Pane) => Pane): Layout => (isSplit(n) ? { ...n, kids: n.kids.map((k) => mapPanes(k, fn)) } : fn(n))
export const mapPlaces = (n: Layout, fn: (p: Pane) => Pane): Layout => mapPanes(n, (p) => {
  if (!p.stack?.length) return fn(p)
  const { stack, stackAt, ...shown } = p
  return { ...fn(shown), stack: stack.map(fn), ...(stackAt ? { stackAt } : {}) }
})
export const mapTabs = <L extends TabList>(l: L, fn: (t: Tab) => Tab): L => ({ ...l, tabs: l.tabs.map(fn) })
export const mapPane = <L extends TabList>(l: L, id: string, fn: (p: Pane) => Pane): L =>
  mapTabs(l, (t) => (placesIn(t).some((p) => p.id === id) ? { ...t, root: mapPlaces(t.root, (p) => (p.id === id ? fn(p) : p)) } : t))
export const mapTab = <L extends TabList>(l: L, id: string, fn: (t: Tab) => Tab): L => mapTabs(l, (t) => (t.id === id ? fn(t) : t))

export const HISTORY = 50
export const moveOn = (p: Pane, to: string): Pane =>
  p.to === to ? p : { ...p, to, back: p.to === "new" ? p.back : [...(p.back ?? []), p.to].slice(-HISTORY), fwd: [] }
export const isBlank = (p: Pane | undefined) => p?.to === "new"
export const isBlankTab = (t: Tab | undefined) => !!t && !isSplit(t.root) && isBlank(t.root)

export const foldedAway = (l: TabList, t: Tab) => !!t.group && !!l.groups?.some((g) => g.id === t.group && g.collapsed)
export function nextShown(l: TabList, ids: Set<string>, any = true): string | null {
  const i = l.tabs.findIndex((t) => t.id === l.active), group = l.tabs[i]?.group
  const near = [...l.tabs.slice(i + 1), ...l.tabs.slice(0, Math.max(i, 0)).reverse()].filter((t) => !ids.has(t.id))
  return (near.find((t) => group && t.group === group) ?? near.find((t) => !foldedAway(l, t)) ?? (any ? near[0] : undefined))?.id ?? null
}
/** List `l` without the tabs `ids`: the tab shown, if it goes, hands over to the next (nextShown). Null: none left. */
export function withoutTabs<L extends TabList>(l: L, ids: Set<string>): L | null {
  if (!l.tabs.some((t) => ids.has(t.id))) return l
  const tabs = l.tabs.filter((t) => !ids.has(t.id))
  if (!tabs.length) return null
  return fixGroups({ ...l, tabs, active: ids.has(l.active) ? nextShown(l, ids) ?? tabs[0].id : l.active })
}
export function focusAfter(was: Layout, root: Layout, focus: string): string {
  const ps = leaves(root), ids = leaves(was).map((p) => p.id)
  if (ps.some((p) => p.id === focus)) return focus
  const i = Math.max(0, ids.indexOf(focus))
  return (ps.find((p) => p.id === ids[i + 1]) ?? ps.findLast((p) => ids.indexOf(p.id) < i) ?? ps[0]).id
}
export function tabWithout(t: Tab, ids: Set<string>): Tab | null {
  if (!placesIn(t).some((p) => ids.has(p.id))) return t
  const gone = new Set<string>(), next = new Map<string, string>()
  const kept = mapPanes(t.root, (p) => {
    const ps = placesOf(p)
    if (!ps.some((x) => ids.has(x.id))) return p
    const left = ps.filter((x) => !ids.has(x.id))
    if (!left.length) { gone.add(p.id); return p }
    const i = ps.findIndex((x) => x.id === p.id)
    const shown = ids.has(p.id) ? (ps.slice(i + 1).find((x) => !ids.has(x.id)) ?? ps.slice(0, i).findLast((x) => !ids.has(x.id)))!.id : p.id
    next.set(p.id, shown)
    return stacked(left, shown, p)
  })
  const root = gone.size ? withoutPanesIn(kept, gone) : kept
  const focus = next.get(t.focus) ?? t.focus, zoom = t.zoom && (next.get(t.zoom) ?? t.zoom)
  return root && settledTab({ ...t, root, focus: focusAfter(kept, root, focus), ...(zoom ? { zoom } : {}) })
}
export function tabWithoutPanes(t: Tab, ids: Set<string>): Tab | null {
  if (!panesOf(t).some((p) => ids.has(p.id))) return t
  const root = withoutPanesIn(t.root, ids)
  return root && settledTab({ ...t, root, focus: focusAfter(t.root, root, t.focus) })
}

export function showingPlace(t: Tab, id: string): Tab {
  const p = paneWith(t.root, id)
  if (!p || p.id === id) return t
  const places = placesOf(p).filter((x) => x.id !== p.id || !isBlank(x))
  const root = mapPanes(t.root, (x) => (x.id === p.id ? stacked(places, id, p) : x))
  return { ...t, root, focus: t.focus === p.id ? id : t.focus, ...(t.zoom === p.id ? { zoom: id } : {}) }
}
export function withPlace(t: Tab, at: string, p: Pane, { show = true, index }: { show?: boolean; index?: number } = {}): Tab {
  const into = paneWith(t.root, at)
  if (!into) return t
  const was = placesOf(into).filter((x) => x.id !== p.id)
  const i = Math.min(index ?? was.findIndex((x) => x.id === at) + 1, was.length)
  const { float: _, ...place } = bare(p)
  const places = [...was.slice(0, i), place, ...was.slice(i)].filter((x) => !(show && x.id === into.id && isBlank(x)))
  const shown = show || !places.some((x) => x.id === into.id) ? p.id : into.id
  const root = mapPanes(t.root, (x) => (x.id === into.id ? stacked(places, shown, into) : x))
  return { ...t, root, focus: t.focus === into.id ? shown : t.focus, ...(t.zoom === into.id ? { zoom: shown } : {}) }
}
export function spilled<L extends TabList>(l: L): L {
  if (!l.tabs.some((t) => !isSplit(t.root) && t.root.stack?.length)) return l
  const ids = new Set(l.tabs.map((t) => t.id))
  const tabs = l.tabs.flatMap((t) => {
    if (isSplit(t.root) || !t.root.stack?.length) return [t]
    const shown = t.root.id
    return placesOf(t.root).map((p): Tab => {
      if (p.id === shown) return { ...t, root: p, focus: p.id }
      const id = ids.has(`t${p.id}`) ? newTabId() : `t${p.id}`
      ids.add(id)
      return { id, root: p, focus: p.id, ...(t.group ? { group: t.group } : {}) }
    })
  })
  return { ...l, tabs }
}
/** List `l` without the panes `ids`: a tab left with none goes (withoutTabs). Null: no tab left. */
export function withoutPanes<L extends TabList>(l: L, ids: Set<string>): L | null {
  const gone = new Set<string>()
  const tabs = l.tabs.map((t) => { const n = tabWithout(t, ids); if (!n) gone.add(t.id); return n ?? t })
  return withoutTabs({ ...l, tabs }, gone)
}

export const inGroup = (t: Tab, group: string | undefined): Tab => {
  if (t.group === group) return t
  const { group: _, ...rest } = t
  return group ? { ...rest, group } : rest
}
/** Unchanged, `l` itself. */
export function fixGroups<L extends TabList>(l: L): L {
  if (!l.groups) return l.tabs.some((t) => t.group) ? { ...l, tabs: l.tabs.map((t) => inGroup(t, undefined)) } : l
  const known = new Map(l.groups.map((s) => [s.id, s]))
  const tabs: Tab[] = [], done = new Set<string>()
  for (const t of l.tabs) {
    const s = t.group && known.has(t.group) ? t.group : undefined
    if (!s) { tabs.push(inGroup(t, undefined)); continue }
    if (done.has(s)) continue
    done.add(s)
    tabs.push(...l.tabs.filter((x) => x.group === s))
  }
  const shown = tabs.find((t) => t.id === l.active)?.group
  const groups = [...done].map((id) => { const s = known.get(id)!; return s.collapsed && id === shown ? { id: s.id, name: s.name, color: s.color } : s })
  const same = tabs.length === l.tabs.length && tabs.every((t, i) => t === l.tabs[i]) && groups.length === l.groups.length && groups.every((s, i) => s === l.groups![i])
  if (same) return l
  const { groups: _, ...rest } = l
  return (groups.length ? { ...rest, tabs, groups } : { ...rest, tabs }) as L
}
export function groupAt(tabs: Tab[], at: number, own?: string): string | undefined {
  const l = tabs[at - 1]?.group, r = tabs[at]?.group
  if (l && l === r) return l
  return own && (l === own || r === own) ? own : undefined
}
export function runOf(l: TabList, group: string) {
  const at = l.tabs.findIndex((t) => t.group === group)
  return { at, n: at < 0 ? 0 : l.tabs.filter((t) => t.group === group).length }
}
export function outsideGroups(tabs: Tab[], at: number) {
  const s = tabs[at]?.group
  if (!s || tabs[at - 1]?.group !== s) return at
  return tabs.findIndex((t) => t.group === s)
}

export function beside(n: Layout, at: string, p: Layout, side: Side): Layout {
  const dir = side === "left" || side === "right" ? "row" : "col"
  const after = side === "right" || side === "bottom"
  if (!isSplit(n)) return n.id !== at ? n : { id: newSplitId(), dir, kids: after ? [n, p] : [p, n], sizes: [0.5, 0.5] }
  const i = n.kids.findIndex((k) => !isSplit(k) && k.id === at)
  if (i < 0 || n.dir !== dir) return { ...n, kids: n.kids.map((k) => beside(k, at, p, side)) }
  const kids = [...n.kids], sizes = [...n.sizes]
  kids.splice(after ? i + 1 : i, 0, p)
  sizes.splice(i, 1, sizes[i] / 2, sizes[i] / 2)
  return tidy({ ...n, kids, sizes })!
}

/** `next`: the part its room goes to when it closes; `share`: its part of the room the two had. */
export type Spot = { next: string; dir: Split["dir"]; after: boolean; share: number }
export function spotOf(n: Layout, id: string): Spot | null {
  if (!isSplit(n)) return null
  const i = n.kids.findIndex((k) => !isSplit(k) && k.id === id)
  if (i < 0) return n.kids.reduce<Spot | null>((s, k) => s ?? spotOf(k, id), null)
  const j = i > 0 ? i - 1 : i + 1
  return { next: n.kids[j].id, dir: n.dir, after: i > 0, share: n.sizes[i] / (n.sizes[i] + n.sizes[j]) }
}
export function putBack(n: Layout, p: Pane, { next, dir, after, share }: Spot): Layout | null {
  const two = (s: number) => (after ? [s * (1 - share), s * share] : [s * share, s * (1 - share)])
  const i = isSplit(n) ? n.kids.findIndex((k) => k.id === next) : -1
  if (isSplit(n) && i >= 0 && n.dir === dir) {
    const kids = [...n.kids], sizes = [...n.sizes]
    kids.splice(after ? i + 1 : i, 0, p)
    if (!p.float) { sizes.splice(i, 1, ...two(sizes[i])); return { ...n, kids, sizes } }
    sizes.splice(after ? i + 1 : i, 0, (sizes[i] * share) / Math.max(1 - share, THIN))
    const sum = sizes.reduce((a, b) => a + b, 0)
    return { ...n, kids, sizes: sizes.map((x) => x / sum) }
  }
  if (n.id === next) return { id: newSplitId(), dir, kids: after ? [n, p] : [p, n], sizes: two(1) }
  if (!isSplit(n)) return null
  for (const [j, k] of n.kids.entries()) {
    const put = putBack(k, p, { next, dir, after, share })
    if (put) return { ...n, kids: n.kids.map((x, m) => (m === j ? put : x)) }
  }
  return null
}

/** Shares of the workspace, 0 to 1. */
export type Rect = { x: number; y: number; w: number; h: number }
export type Divider = { split: Split; i: number; rect: Rect; at: number }
export function layout(root: Layout) {
  const panes: { pane: Pane; rect: Rect }[] = [], dividers: Divider[] = [], floats: { pane: Pane; rect: Rect }[] = []
  const walk = (n: Layout, r: Rect) => {
    if (!isSplit(n)) return void panes.push({ pane: n, rect: r })
    const { at, total } = tiledIn(n)
    let off = 0
    at.forEach((j, i) => {
      const s = n.sizes[j] / total
      walk(n.kids[j], n.dir === "row" ? { ...r, x: r.x + off * r.w, w: s * r.w } : { ...r, y: r.y + off * r.h, h: s * r.h })
      off += s
      if (i < at.length - 1) dividers.push({ split: n, i, rect: r, at: off })
    })
  }
  if (tiled(root)) walk(root, { x: 0, y: 0, w: 1, h: 1 })
  for (const p of leaves(root)) if (p.float) floats.push({ pane: p, rect: p.float })
  return { panes, dividers, floats }
}
export const tiled = (n: Layout): boolean => (isSplit(n) ? n.kids.some(tiled) : !n.float)
function tiledIn(n: Split) {
  const at = n.kids.flatMap((k, j) => (tiled(k) ? [j] : []))
  return { at, total: at.reduce((a, j) => a + n.sizes[j], 0) || 1 }
}

export function neighbourOf(root: Layout, from: string, side: Side): Pane | null {
  const { panes, floats } = layout(root)
  const cur = panes.find((p) => p.pane.id === from) ?? floats.find((p) => p.pane.id === from)
  if (!cur) return null
  const c = cur.rect, e = 1e-6
  const mid = (r: Rect) => (side === "left" || side === "right" ? r.y + r.h / 2 : r.x + r.w / 2)
  const ok = (r: Rect) => side === "right" ? r.x >= c.x + c.w - e && r.y < c.y + c.h - e && r.y + r.h > c.y + e
    : side === "left" ? r.x + r.w <= c.x + e && r.y < c.y + c.h - e && r.y + r.h > c.y + e
    : side === "bottom" ? r.y >= c.y + c.h - e && r.x < c.x + c.w - e && r.x + r.w > c.x + e
    : r.y + r.h <= c.y + e && r.x < c.x + c.w - e && r.x + r.w > c.x + e
  const gap = (r: Rect) => (side === "right" ? r.x - c.x - c.w : side === "left" ? c.x - r.x - r.w : side === "bottom" ? r.y - c.y - c.h : c.y - r.y - r.h)
  const near = panes.filter((p) => ok(p.rect)).sort((a, b) => gap(a.rect) - gap(b.rect) || Math.abs(mid(a.rect) - mid(c)) - Math.abs(mid(b.rect) - mid(c)))
  return near[0]?.pane ?? null
}

/** `at` and `min`: shares of the split. */
export function resized(root: Layout, splitId: string, i: number, at: number, min: number): Layout {
  const fix = (n: Layout): Layout => {
    if (!isSplit(n)) return n
    if (n.id !== splitId) return { ...n, kids: n.kids.map(fix) }
    const { at: js, total } = tiledIn(n)
    if (i + 1 >= js.length) return n
    const share = (j: number) => n.sizes[j] / total
    const before = js.slice(0, i).reduce((a, j) => a + share(j), 0), pair = share(js[i]) + share(js[i + 1])
    const a = Math.min(pair - min, Math.max(min, at - before))
    if (a <= 0 || pair - a <= 0) return n
    const sizes = [...n.sizes]
    sizes[js[i]] = a * total; sizes[js[i + 1]] = (pair - a) * total
    return { ...n, sizes }
  }
  return fix(root)
}
export function evened(root: Layout, splitId: string): Layout {
  const fix = (n: Layout): Layout => {
    if (!isSplit(n)) return n
    if (n.id !== splitId) return { ...n, kids: n.kids.map(fix) }
    const { at, total } = tiledIn(n)
    return { ...n, sizes: n.sizes.map((s, j) => (at.includes(j) ? total / at.length : s)) }
  }
  return fix(root)
}
export const evenedAll = (n: Layout): Layout => (isSplit(n) ? { ...n, sizes: n.kids.map(() => 1 / n.kids.length), kids: n.kids.map(evenedAll) } : n)

/** The same objects, so neither remounts. */
export function swapped(root: Layout, a: string, b: string): Layout {
  const pa = leaves(root).find((p) => p.id === a), pb = leaves(root).find((p) => p.id === b)
  if (!pa || !pb || a === b) return root
  return mapPanes(root, (p) => (p.id === a ? pb : p.id === b ? pa : p))
}
export const replaced = (root: Layout, id: string, p: Pane): Layout =>
  mapPanes(root, (x) => { if (x.id !== id) return x; const { float: _, ...rest } = p; return x.float ? { ...rest, float: x.float } : rest })

function edgeOf(root: Layout, id: string, side: Side): Divider | null {
  const { panes, dividers } = layout(root)
  const c = panes.find((p) => p.pane.id === id)?.rect
  if (!c) return null
  const row = side === "left" || side === "right", e = 1e-6
  const edge = side === "left" ? c.x : side === "right" ? c.x + c.w : side === "top" ? c.y : c.y + c.h
  return dividers.find(({ split, rect: r, at }) => (split.dir === "row") === row && (row
    ? Math.abs(r.x + at * r.w - edge) < e && r.y < c.y + c.h - e && r.y + r.h > c.y + e
    : Math.abs(r.y + at * r.h - edge) < e && r.x < c.x + c.w - e && r.x + r.w > c.x + e)) ?? null
}
/** `by` and `min`: shares of the whole layout, across that way. */
export function nudged(root: Layout, id: string, side: Side, by: number, min: number): Layout {
  const back: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" }
  const d = edgeOf(root, id, side) ?? edgeOf(root, id, back[side])
  if (!d) return root
  const span = d.split.dir === "row" ? d.rect.w : d.rect.h
  return resized(root, d.split.id, d.i, d.at + ((side === "right" || side === "bottom" ? by : -by) / span), min / span)
}

/** null docks it back into its spot. */
export const floated = (root: Layout, id: string, rect: Rect | null): Layout => mapPanes(root, (p) => {
  if (p.id !== id) return p
  const { float: _, ...rest } = p
  return rect ? { ...rest, float: okFloat(rect)! } : rest
})
/** Unchanged, `t` itself. */
export function settledTab(t: Tab): Tab {
  const root = tiled(t.root) ? t.root : mapPanes(t.root, (p) => { const { float: _, ...rest } = p; return rest })
  const ps = leaves(root), focus = ps.some((p) => p.id === t.focus) ? t.focus : ps[0].id
  const tiles = layout(root).panes
  const zoom = t.zoom && t.zoom === focus && tiles.length > 1 && tiles.some((p) => p.pane.id === t.zoom) ? t.zoom : undefined
  const folded = !!t.folded && ps.some((p) => !!p.stack?.length)
  if (root === t.root && zoom === t.zoom && focus === t.focus && folded === !!t.folded) return t
  const { zoom: _, folded: _f, ...rest } = t
  return { ...rest, root, focus, ...(zoom ? { zoom } : {}), ...(folded ? { folded } : {}) }
}

const SPOT_WORDS: Record<string, Side | "middle"> = { left: "left", right: "right", top: "top", upper: "top", bottom: "bottom", lower: "bottom",
  middle: "middle", center: "middle", centre: "middle" }
const FILLER = new Set(["the", "a", "on", "in", "at", "to", "of", "one", "pane", "panel", "panes", "side", "split", "tab", "half", "column", "row", "part", "hand", "same", "there"])
export function spotWords(said: string): (Side | "middle")[] | null {
  const words = said.toLowerCase().split(/[\s,.-]+/).filter((w) => w && !FILLER.has(w))
  if (!words.length || words.some((w) => !SPOT_WORDS[w])) return null
  return [...new Set(words.map((w) => SPOT_WORDS[w]))]
}
export function panesAt(root: Layout, spots: (Side | "middle")[]): Pane[] {
  const e = 1e-6, across = spots.some((s) => s === "left" || s === "right"), down = spots.some((s) => s === "top" || s === "bottom")
  const midX = (r: Rect) => r.x > e && r.x + r.w < 1 - e, midY = (r: Rect) => r.y > e && r.y + r.h < 1 - e
  const at = (r: Rect, s: Side | "middle") => s === "left" ? r.x < e : s === "right" ? r.x + r.w > 1 - e : s === "top" ? r.y < e : s === "bottom" ? r.y + r.h > 1 - e
    : across && !down ? midY(r) : down && !across ? midX(r) : across ? false : midX(r) || midY(r)
  return layout(root).panes.filter(({ rect }) => spots.every((s) => at(rect, s))).map((p) => p.pane)
}
