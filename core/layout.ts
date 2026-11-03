// The tabs as data: a workspace's list of tabs, each a tree of splits of panes, and their pure changes, app and server
// alike (no state, no DOM). web/src/core/workspace.ts keeps the one on screen; Workspaces' backend changes saved ones.
import { isColor, type Color } from "./colors.ts"

/** One view with its own history: what a tab shows, or one part of a split tab. */
export type Pane = { id: string; to: string
  /** Where it was before, oldest first; and where Back came from, the next first. */
  back?: string[]; fwd?: string[]
  /** The pane it was opened from, for what was opened from that one (a person from People): Back past its first
   *  place closes it and shows that one again, as it was left. Kept for this visit only, like its history. */
  from?: string
  /** Its place when its tab was pinned: ⌘W takes it back there (its page unloaded), as Arc's pinned tabs. */
  home?: string
  /** When it was last on screen (ms, to the minute), stamped while tabs archive themselves (Tabs' setting). */
  seen?: number
  /** Floating over the tab's other panes at this place (shares of the workspace), out of the tiling: its spot in the
   *  tree is kept, empty, so docking it puts it back where it came from. */
  float?: Rect }
/** Panes (or splits) side by side ("row": a vertical divider between them) or stacked ("col"); `sizes` are their
 *  shares, adding up to 1. */
export type Split = { id: string; dir: "row" | "col"; kids: Layout[]; sizes: number[] }
export type Layout = Pane | Split
/** A tab: its panes in a tree of splits (one pane, mostly), the one `focus`ed, and the one filling it for now (`zoom`,
 *  tmux's). */
export type Tab = { id: string; root: Layout; focus: string; zoom?: string
  /** The name the user gave it (Rename tab), shown for what has no name of its own. */
  name?: string
  /** Pinned: what's opened from it opens in a tab beside it, ⌘W and closing others leave it open. */
  pinned?: boolean
  /** The tab group it's in (one of its list's `groups`). */
  group?: string }
/** A tab group, as browsers have them: a named, coloured run of tabs side by side (those whose `group` is its id),
 *  folded to its name while `collapsed`. */
export type Group = { id: string; name: string; color: Color; collapsed?: boolean }
/** A window's tabs, in order, their groups (in the order their tabs are) and the one on screen. */
export type TabList = { tabs: Tab[]; groups?: Group[]; active: string }
/** A window of its own (a pop-out), with its own tabs. */
export type Window = TabList & { id: string }
/** A workspace: the main window's tabs, and its pop-outs'. */
export type Workspace = TabList & { windows?: Window[] }
/** Where a new split goes, beside a pane. */
export type Side = "left" | "right" | "top" | "bottom"

let seq = 0
const base = () => `${Date.now().toString(36)}${(seq++).toString(36)}`
/** A new pane's id (panes opened before tabs held panes kept their tabs' "t…" ids). */
export const newPaneId = () => `p${base()}`
export const newTabId = () => `t${base()}`
export const newSplitId = () => `s${base()}`
export const newGroupId = () => `g${base()}`
export const isSplit = (n: Layout): n is Split => "kids" in n
/** Every pane, left to right and top to bottom. */
export const leaves = (n: Layout): Pane[] => (isSplit(n) ? n.kids.flatMap(leaves) : [n])
/** A tab's panes. */
export const panesOf = (t: Tab): Pane[] => leaves(t.root)
/** The pane a tab has focused. */
export const focusedPane = (t: Tab): Pane => panesOf(t).find((p) => p.id === t.focus) ?? panesOf(t)[0]
/** The tab on screen in a list. */
export const shownTab = (l: TabList): Tab | undefined => l.tabs.find((t) => t.id === l.active)
/** The tab that has pane `id`. */
export const tabOfPane = (l: TabList, id: string): Tab | undefined => l.tabs.find((t) => panesOf(t).some((p) => p.id === id))
/** Every pane of every tab. */
export const allPanes = (l: TabList): Pane[] => l.tabs.flatMap(panesOf)
/** The file a target shows ("file:<path>"; one from outside the vault is absolute, "file:/…"), else null. */
export const tabPath = (to: string) => (to.startsWith("file:") ? to.slice(5) : null)
/** The vault file a target shows: null for a view, a blank pane or a file from outside the vault. */
export const vaultPath = (to: string) => (to.startsWith("file:") && !to.startsWith("file:/") ? to.slice(5) : null)
/** A tab of one pane showing `to`. */
export const tabOf = (to: string, opts: { id?: string; pane?: string } & Partial<Omit<Pane, "id" | "to">> = {}): Tab => {
  const { id = newTabId(), pane = newPaneId(), ...rest } = opts
  return { id, root: { id: pane, to, ...rest }, focus: pane }
}
/** A tab of one pane `p`. */
export const tabWith = (p: Pane, id = newTabId()): Tab => { const { float: _, ...rest } = p; return { id, root: rest, focus: p.id } }
/** A list of one blank tab. */
export const blankList = (): TabList => { const t = tabOf("new"); return { tabs: [t], active: t.id } }

/** A part of a split thinner than this share (or half an even one) is too thin to use: no divider drags one there
 *  (Workspace's 200px, up to 4000px wide). */
const THIN = 0.05

/** The tree without splits of one, or a split inside another going the same way (its parts join it). A part gone
 *  (null) leaves its room to its tiled neighbour (beside's undo); one too thin to use comes back at an even share. */
export function tidy(n: Layout | null): Layout | null {
  if (!n) return null
  if (!isSplit(n)) return n
  const kids: Layout[] = [], sizes: number[] = []
  let left = 0 // the room of parts gone before any stayed
  n.kids.forEach((k, i) => {
    const t = tidy(k)
    const s = n.sizes[i] > 0 ? n.sizes[i] : 1 / n.kids.length
    // (a split left with nothing: withoutPanesIn took its floating ones out, whose room the tiled ones had already)
    if (!t && k && isSplit(k) && !k.kids.length) return
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
/** Shares (adding up to 1) with each too thin to use at an even one, the others making room in proportion. */
function unthinned(shares: number[]) {
  const even = 1 / shares.length, thin = Math.min(THIN, even / 2)
  const n = shares.filter((s) => s < thin).length
  if (!n) return shares
  const rest = shares.reduce((a, s) => (s < thin ? a : a + s), 0)
  return shares.map((s) => (s < thin ? even : (s * (1 - n * even)) / rest))
}
/** `n` without the panes `ids` (tidied; null when none is left). */
export function withoutPanesIn(n: Layout, ids: Set<string>): Layout | null {
  // (a floating one goes with its share: the tiled ones had its room already, and keep theirs)
  const cut = (x: Layout): Layout | null => {
    if (!isSplit(x)) return ids.has(x.id) ? null : x
    const kept = x.kids.flatMap((k, i) => (!isSplit(k) && k.float && ids.has(k.id) ? [] : [i]))
    return { ...x, kids: kept.map((i) => cut(x.kids[i]) as Layout), sizes: kept.map((i) => x.sizes[i]) }
  }
  return tidy(cut(n))
}

// ---------- reading what was saved (by hand, by another device, or before tabs held panes) ----------

const strings = (a: unknown) => Array.isArray(a) && a.every((x) => typeof x === "string")
const str = (s: unknown): s is string => typeof s === "string" && !!s
type Obj = Record<string, unknown>
/** A saved pane, checked; null if it isn't one. */
function okPane(x: Obj): Pane | null {
  if (!str(x.id) || !str(x.to)) return null
  const float = okFloat(x.float)
  return { id: x.id, to: x.to, ...(strings(x.back) ? { back: x.back as string[] } : {}), ...(strings(x.fwd) ? { fwd: x.fwd as string[] } : {}),
    ...(str(x.from) ? { from: x.from } : {}), ...(str(x.home) ? { home: x.home } : {}),
    ...(typeof x.seen === "number" ? { seen: x.seen } : {}), ...(float ? { float } : {}) }
}
/** A saved tree of panes, checked: what isn't a pane is dropped. */
export function cleanLayout(n: unknown): Layout | null {
  const x = n as Obj | null
  if (!x || typeof x !== "object") return null
  if (Array.isArray(x.kids)) {
    const kids = x.kids.map(cleanLayout)
    const sizes = kids.map((_, i) => (typeof (x.sizes as number[] | undefined)?.[i] === "number" ? (x.sizes as number[])[i] : 1))
    return tidy({ id: str(x.id) ? x.id : newSplitId(), dir: x.dir === "col" ? "col" : "row", kids: kids as Layout[], sizes })
  }
  return okPane(x)
}
/** A saved place for a float, kept inside the workspace; null if it isn't one. */
function okFloat(r: unknown): Rect | null {
  const o = r as Partial<Rect> | null
  if (!o || typeof o !== "object" || ![o.x, o.y, o.w, o.h].every((n) => typeof n === "number" && Number.isFinite(n))) return null
  const w = Math.min(1, Math.max(0.05, o.w!)), h = Math.min(1, Math.max(0.05, o.h!))
  return { x: Math.min(1 - w, Math.max(0, o.x!)), y: Math.min(1 - h, Math.max(0, o.y!)), w, h }
}
const okGroup = (s: unknown): s is Group => !!s && typeof s === "object" && str((s as Group).id) && typeof (s as Group).name === "string" && isColor((s as Group).color)
const groupOf = (s: Group): Group => ({ id: s.id, name: s.name.slice(0, 80), color: s.color, ...(s.collapsed === true ? { collapsed: true } : {}) })
/** A saved tab, checked; null if it has no pane. */
function okTab(x: Obj): Tab | null {
  const root = cleanLayout(x.root)
  if (!root || !str(x.id)) return null
  return settledTab({ id: x.id, root, focus: String(x.focus ?? ""), ...(str(x.zoom) ? { zoom: x.zoom } : {}),
    ...(str(x.name) ? { name: x.name.slice(0, 80) } : {}), ...(x.pinned === true ? { pinned: true } : {}), ...(str(x.group) ? { group: x.group } : {}) })
}
/** A saved list, checked: tabs with no pane dropped, ids made unique, groups as they must be (fixGroups). */
function okList(x: Obj, taken = new Set<string>()): TabList | null {
  const tabs = (Array.isArray(x.tabs) ? x.tabs as Obj[] : []).flatMap((t) => {
    const ok = t && typeof t === "object" ? okTab(t) : null
    if (!ok || taken.has(ok.id) || panesOf(ok).some((p) => taken.has(p.id))) return []
    taken.add(ok.id); panesOf(ok).forEach((p) => taken.add(p.id))
    return [ok]
  })
  if (!tabs.length) return null
  const groups = (Array.isArray(x.groups) ? x.groups : []).filter(okGroup).map(groupOf)
  return fixGroups({ tabs, ...(groups.length ? { groups } : {}), active: tabs.some((t) => t.id === x.active) ? x.active as string : tabs[0].id })
}
/** A saved workspace, checked; one saved before tabs held panes (`{root, focus, zoom}`) is migrated. Null: no tab. */
export function clean(w: unknown): Workspace | null {
  const x = w as Obj | null
  if (!x || typeof x !== "object") return null
  if (!Array.isArray(x.tabs) && x.root) return migrate(x)
  const taken = new Set<string>()
  const main = okList(x, taken)
  if (!main) return null
  // (a tab or pane in two windows stays in the first)
  const windows = (Array.isArray(x.windows) ? x.windows as Obj[] : []).flatMap((o) => {
    const l = o && typeof o === "object" && str(o.id) ? okList(o, taken) : null
    return l ? [{ id: o.id as string, ...l }] : []
  })
  return windows.length ? { ...main, windows } : main
}

/** An old layout (groups of tabs in splits): the groups' shown tabs become one split tab, every other tab its own. Old
 *  tab ids become pane ids, each tab's id "t" + its first pane's, so every device and the server migrate it alike. */
export function migrate(old: Obj): Workspace | null {
  type OldTab = Obj & { id: string; to: string; set?: string; pinned?: boolean; name?: string }
  type OldGroup = { id: string; tabs: OldTab[]; active: string; float?: unknown }
  const groups: Group[] = [], seen = new Set<string>(), gs: OldGroup[] = []
  // The tree with each group's shown tab as its pane.
  const walk = (n: unknown): Layout | null => {
    const x = n as Obj | null
    if (!x || typeof x !== "object") return null
    if (Array.isArray(x.kids)) return { id: str(x.id) ? x.id : newSplitId(), dir: x.dir === "col" ? "col" : "row", kids: x.kids.map(walk) as Layout[],
      sizes: x.kids.map((_, i) => (typeof (x.sizes as number[] | undefined)?.[i] === "number" ? (x.sizes as number[])[i] : 1)) }
    const tabs = (Array.isArray(x.tabs) ? x.tabs as OldTab[] : []).filter((t) => t && str(t.id) && str(t.to) && !seen.has(t.id) && !!seen.add(t.id))
    if (!tabs.length) return null
    for (const s of Array.isArray(x.sets) ? x.sets : []) if (okGroup(s) && !groups.some((g) => g.id === s.id)) groups.push(groupOf(s))
    const g: OldGroup = { id: String(x.id), tabs, active: tabs.some((t) => t.id === x.active) ? x.active as string : tabs[0].id, float: x.float }
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
  // The rest, group by group in their order, the split tab where the focused group's shown tab was.
  const tabs: Tab[] = []
  for (const g of gs) for (const t of g.tabs) {
    if (t.id === focus) tabs.push(split)
    else if (t.id !== shown(g).id) { const p = okPane({ ...t, float: undefined }); if (p) tabs.push(tabFrom(t, p, p.id)) }
  }
  return clean({ tabs, groups, active: split.id })
}

// ---------- panes and their history ----------

/** Every pane changed by `fn`. */
export const mapPanes = (n: Layout, fn: (p: Pane) => Pane): Layout => (isSplit(n) ? { ...n, kids: n.kids.map((k) => mapPanes(k, fn)) } : fn(n))
/** Every tab of a list changed by `fn`. */
export const mapTabs = <L extends TabList>(l: L, fn: (t: Tab) => Tab): L => ({ ...l, tabs: l.tabs.map(fn) })
/** Pane `id`, wherever it is in the list, changed by `fn`. */
export const mapPane = <L extends TabList>(l: L, id: string, fn: (p: Pane) => Pane): L =>
  mapTabs(l, (t) => (panesOf(t).some((p) => p.id === id) ? { ...t, root: mapPanes(t.root, (p) => (p.id === id ? fn(p) : p)) } : t))
/** Tab `id` changed by `fn`. */
export const mapTab = <L extends TabList>(l: L, id: string, fn: (t: Tab) => Tab): L => mapTabs(l, (t) => (t.id === id ? fn(t) : t))

export const HISTORY = 50
/** A pane moving on to `to`: where it was goes into its history (a blank pane isn't worth going back to). */
export const moveOn = (p: Pane, to: string): Pane =>
  p.to === to ? p : { ...p, to, back: p.to === "new" ? p.back : [...(p.back ?? []), p.to].slice(-HISTORY), fwd: [] }
// A blank pane ("new") is only a place to open something, never worth keeping: what's opened from it goes in it.
export const isBlank = (p: Pane | undefined) => p?.to === "new"
/** A tab of one blank pane. */
export const isBlankTab = (t: Tab | undefined) => !!t && !isSplit(t.root) && isBlank(t.root)

// ---------- tabs leaving (closed, or moved elsewhere): the one rule for what shows next ----------

/** Whether tab `t` is folded away, in a collapsed tab group. */
export const foldedAway = (l: TabList, t: Tab) => !!t.group && !!l.groups?.some((g) => g.id === t.group && g.collapsed)
/** What `l` shows once its shown tab goes with `ids`, as Chrome's tab strip picks: another of its group (after, else
 *  before), else the nearest not folded away, else (`any`) the nearest, whose group then opens. Null: none. */
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
/** The pane focused after `was` became `root`: `focus` while it's there, else (it closed) the one after it, else before. */
export function focusAfter(was: Layout, root: Layout, focus: string): string {
  const ps = leaves(root), ids = leaves(was).map((p) => p.id)
  if (ps.some((p) => p.id === focus)) return focus
  const i = Math.max(0, ids.indexOf(focus))
  return (ps.find((p) => p.id === ids[i + 1]) ?? ps.findLast((p) => ids.indexOf(p.id) < i) ?? ps[0]).id
}
/** Tab `t` without the panes `ids`; null when it has none left. */
export function tabWithout(t: Tab, ids: Set<string>): Tab | null {
  if (!panesOf(t).some((p) => ids.has(p.id))) return t
  const root = withoutPanesIn(t.root, ids)
  return root && settledTab({ ...t, root, focus: focusAfter(t.root, root, t.focus) })
}
/** List `l` without the panes `ids`: a tab left with none goes (withoutTabs). Null: no tab left. */
export function withoutPanes<L extends TabList>(l: L, ids: Set<string>): L | null {
  const gone = new Set<string>()
  const tabs = l.tabs.map((t) => { const n = tabWithout(t, ids); if (!n) gone.add(t.id); return n ?? t })
  return withoutTabs({ ...l, tabs }, gone)
}

// ---------- tab groups: runs of tabs ----------

/** A tab in tab group `group` (none: out of any). */
export const inGroup = (t: Tab, group: string | undefined): Tab => {
  if (t.group === group) return t
  const { group: _, ...rest } = t
  return group ? { ...rest, group } : rest
}
/** `l` as tab groups must be: each one's tabs together (where its first is), none in an unknown or empty one, listed in
 *  order, the tab shown never folded away (its group opens). Unchanged, `l` itself. */
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
/** The tab group a tab put at index `at` of `tabs` (which haven't got it) joins: the one on both sides of it, or, at
 *  either end of its own group (`own`), that one. Else none. */
export function groupAt(tabs: Tab[], at: number, own?: string): string | undefined {
  const l = tabs[at - 1]?.group, r = tabs[at]?.group
  if (l && l === r) return l
  return own && (l === own || r === own) ? own : undefined
}
/** Where a tab group's tabs are in its list: the first's index and how many. */
export function runOf(l: TabList, group: string) {
  const at = l.tabs.findIndex((t) => t.group === group)
  return { at, n: at < 0 ? 0 : l.tabs.filter((t) => t.group === group).length }
}
/** Index `at` moved out of any tab group's run (to before it), so what goes there joins none. */
export function outsideGroups(tabs: Tab[], at: number) {
  const s = tabs[at]?.group
  if (!s || tabs[at - 1]?.group !== s) return at
  return tabs.findIndex((t) => t.group === s)
}

// ---------- a tab's splits ----------

/** `n` with pane (or tree) `p` put beside pane `at`: in `at`'s split if it goes the same way, else in a new split. */
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

/** Where a pane sat, to put it back (a pane closed, then reopened): beside `next`, the part its room goes to when it
 *  closes (tidy: the one before it, else after), on the `after` side, with its `share` of the room the two had. */
export type Spot = { next: string; dir: Split["dir"]; after: boolean; share: number }
export function spotOf(n: Layout, id: string): Spot | null {
  if (!isSplit(n)) return null
  const i = n.kids.findIndex((k) => !isSplit(k) && k.id === id)
  if (i < 0) return n.kids.reduce<Spot | null>((s, k) => s ?? spotOf(k, id), null)
  const j = i > 0 ? i - 1 : i + 1
  return { next: n.kids[j].id, dir: n.dir, after: i > 0, share: n.sizes[i] / (n.sizes[i] + n.sizes[j]) }
}
/** `n` with pane `p` back at `spot`, taking its share of the room `next` has now; null if `next` is gone. */
export function putBack(n: Layout, p: Pane, { next, dir, after, share }: Spot): Layout | null {
  const two = (s: number) => (after ? [s * (1 - share), s * share] : [s * share, s * (1 - share)])
  const i = isSplit(n) ? n.kids.findIndex((k) => k.id === next) : -1
  if (isSplit(n) && i >= 0 && n.dir === dir) {
    const kids = [...n.kids], sizes = [...n.sizes]
    kids.splice(after ? i + 1 : i, 0, p)
    sizes.splice(i, 1, ...two(sizes[i]))
    return { ...n, kids, sizes }
  }
  if (n.id === next) return { id: newSplitId(), dir, kids: after ? [n, p] : [p, n], sizes: two(1) }
  if (!isSplit(n)) return null
  for (const [j, k] of n.kids.entries()) {
    const put = putBack(k, p, { next, dir, after, share })
    if (put) return { ...n, kids: n.kids.map((x, m) => (m === j ? put : x)) }
  }
  return null
}

/** Where each pane sits, as shares of the workspace (x, y, width, height from 0 to 1), floating ones in `floats`; the
 *  dividers between the tiled parts of each split: `at` where it is, `rect` the split's box, `i` the tiled part before. */
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
/** Whether any of `n` is tiled (not every pane in it floating). */
export const tiled = (n: Layout): boolean => (isSplit(n) ? n.kids.some(tiled) : !n.float)
/** A split's tiled parts (their indexes) and the room they have together. */
function tiledIn(n: Split) {
  const at = n.kids.flatMap((k, j) => (tiled(k) ? [j] : []))
  return { at, total: at.reduce((a, j) => a + n.sizes[j], 0) || 1 }
}

/** The pane beside `from` on that side (the one most in line with it), if any; from a floating one, the tiled ones
 *  past its edge. */
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

/** Tiled part `i` of split `splitId` ends at `at` (a share of the split), each part at least `min` wide. */
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
/** That split's tiled parts back to equal (a floating one keeps its share, for when it docks). */
export function evened(root: Layout, splitId: string): Layout {
  const fix = (n: Layout): Layout => {
    if (!isSplit(n)) return n
    if (n.id !== splitId) return { ...n, kids: n.kids.map(fix) }
    const { at, total } = tiledIn(n)
    return { ...n, sizes: n.sizes.map((s, j) => (at.includes(j) ? total / at.length : s)) }
  }
  return fix(root)
}
/** Every split's parts back to equal. */
export const evenedAll = (n: Layout): Layout => (isSplit(n) ? { ...n, sizes: n.kids.map(() => 1 / n.kids.length), kids: n.kids.map(evenedAll) } : n)

/** Panes `a` and `b` in each other's place (the same objects, so neither remounts). */
export function swapped(root: Layout, a: string, b: string): Layout {
  const pa = leaves(root).find((p) => p.id === a), pb = leaves(root).find((p) => p.id === b)
  if (!pa || !pb || a === b) return root
  return mapPanes(root, (p) => (p.id === a ? pb : p.id === b ? pa : p))
}
/** Pane `id` replaced by `p` where it sits (as tiled or floating as it was). */
export const replaced = (root: Layout, id: string, p: Pane): Layout =>
  mapPanes(root, (x) => { if (x.id !== id) return x; const { float: _, ...rest } = p; return x.float ? { ...rest, float: x.float } : rest })

/** The divider along pane `id`'s edge on `side`, if it has one there (only one can be: tidy joins splits that go
 *  the same way). */
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
/** Pane `id`'s divider on `side` (else the one on the other side) moved that way by `by`, each part at least `min`
 *  (both shares of the whole layout, across that way): a pane resized from the keyboard, as a terminal's splits are. */
export function nudged(root: Layout, id: string, side: Side, by: number, min: number): Layout {
  const back: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" }
  const d = edgeOf(root, id, side) ?? edgeOf(root, id, back[side])
  if (!d) return root
  const span = d.split.dir === "row" ? d.rect.w : d.rect.h
  return resized(root, d.split.id, d.i, d.at + ((side === "right" || side === "bottom" ? by : -by) / span), min / span)
}

// ---------- zoom and floating panes ----------

/** Pane `id` floating at `rect` (shares of the workspace), or docked back into its spot (null). */
export const floated = (root: Layout, id: string, rect: Rect | null): Layout => mapPanes(root, (p) => {
  if (p.id !== id) return p
  const { float: _, ...rest } = p
  return rect ? { ...rest, float: okFloat(rect)! } : rest
})
/** `t` as it must be: some pane tiled (with none, the floating ones dock), the focus on one of its panes, the zoom only
 *  on the focused pane while it's tiled and has others beside it. Unchanged, `t` itself. */
export function settledTab(t: Tab): Tab {
  const root = tiled(t.root) ? t.root : mapPanes(t.root, (p) => { const { float: _, ...rest } = p; return rest })
  const ps = leaves(root), focus = ps.some((p) => p.id === t.focus) ? t.focus : ps[0].id
  const tiles = layout(root).panes
  const zoom = t.zoom && t.zoom === focus && tiles.length > 1 && tiles.some((p) => p.pane.id === t.zoom) ? t.zoom : undefined
  if (root === t.root && zoom === t.zoom && focus === t.focus) return t
  const { zoom: _, ...rest } = t
  return { ...rest, root, focus, ...(zoom ? { zoom } : {}) }
}
