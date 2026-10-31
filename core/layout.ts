// The tabs' layout as data: tabs in groups, groups in a tree of splits, and its pure changes, for app and server alike
// (no state, no DOM). web/src/core/workspace.ts keeps the one on screen; Workspaces' backend changes saved ones.
import { isColor, type Color } from "./colors.ts"

export type Tab = { id: string; to: string
  /** Where it was before, oldest first; and where Back came from, the next first. */
  back?: string[]; fwd?: string[]
  /** The tab it was opened beside, for what was opened from that one (a person from People): Back past its first
   *  place closes it and shows that tab again, as it was left. Kept for this visit only, like its history. */
  from?: string
  /** Pinned: what's opened from it opens in a tab beside it, ⌘W and closing others leave it open. */
  pinned?: boolean
  /** A pinned tab's place when it was pinned: ⌘W takes it back there (its page unloaded), as Arc's pinned tabs. */
  home?: string
  /** The tab group it's in (one of its pane's `sets`). */
  set?: string
  /** The name the user gave it (Rename tab), shown for what has no name of its own: not a file, nor a view that keeps
   *  its own (a terminal's session). */
  name?: string
  /** When it was last on screen (ms, to the minute), stamped while tabs archive themselves (Tabs' setting). */
  seen?: number }
/** A tab group, as browsers have them: a named, coloured run of a pane's tabs (those whose `set` is its id, side by
 *  side), folded to its name while `collapsed`. A "set" in code, since the code's groups are panes. */
export type TabSet = { id: string; name: string; color: Color; collapsed?: boolean }
export type Group = { id: string; tabs: Tab[]; active: string
  /** Its tabs side by side, sliding over each other with their titles on spines. */
  stacked?: boolean
  /** Its tab groups, in the order their tabs are. */
  sets?: TabSet[]
  /** Floating over the workspace at this place (shares of it), out of the tiling: its spot in the tree is kept, empty,
   *  so docking it puts it back where it came from. */
  float?: Rect }
/** Groups (or splits) side by side ("row": a vertical divider between them) or stacked ("col"); `sizes` are their
 *  shares, adding up to 1. */
export type Split = { id: string; dir: "row" | "col"; kids: Layout[]; sizes: number[] }
export type Layout = Group | Split
export type Workspace = { root: Layout; focus: string
  /** The pane filling the workspace for now (tmux's zoom), the others left as they are under it: the focused one. */
  zoom?: string }
/** Where a new split goes, beside a group. */
export type Side = "left" | "right" | "top" | "bottom"

let seq = 0
export const newId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`
export const isSplit = (n: Layout): n is Split => "kids" in n
/** Every group, left to right and top to bottom. */
export const leaves = (n: Layout): Group[] => (isSplit(n) ? n.kids.flatMap(leaves) : [n])
/** The tab group `g` shows. */
export const shownTab = (g: Group): Tab | undefined => g.tabs.find((t) => t.id === g.active)
/** The file a tab target shows ("file:<path>"; one from outside the vault is absolute, "file:/…"), else null. */
export const tabPath = (to: string) => (to.startsWith("file:") ? to.slice(5) : null)
/** The vault file a tab target shows: null for a view, a blank tab or a file from outside the vault. */
export const vaultPath = (to: string) => (to.startsWith("file:") && !to.startsWith("file:/") ? to.slice(5) : null)
export const okGroup = (g: Group | undefined): g is Group => !!g && Array.isArray(g.tabs) && !!g.tabs.length && g.tabs.some((t) => t.id === g.active)
/** A group with one blank tab. */
export const blankGroup = (id = `g${newId()}`): Group => { const t = newId(); return { id, tabs: [{ id: t, to: "new" }], active: t } }

/** A part of a split thinner than this share (or half an even one) is too thin to use: no divider drags one there
 *  (Workspace's 200px, up to 4000px wide). */
const THIN = 0.05

/** The tree without empty groups, splits of one, or a split inside another going the same way (its parts join it). A
 *  part gone leaves its room to its tiled neighbour (beside's undo); one too thin to use comes back at an even share. */
export function tidy(n: Layout | null): Layout | null {
  if (!n) return null
  if (!isSplit(n)) return n.tabs.length ? n : null
  const kids: Layout[] = [], sizes: number[] = []
  let left = 0 // the room of parts gone before any stayed
  n.kids.forEach((k, i) => {
    const t = tidy(k)
    const s = n.sizes[i] > 0 ? n.sizes[i] : 1 / n.kids.length
    // (a floating one's room was the tiled ones' already: they keep their shares)
    if (!t && !tiled(k)) return
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

/** A saved tree, checked: bad groups are dropped. */
export function clean(n: unknown): Layout | null {
  const x = n as Partial<Split & Group> | null
  if (!x || typeof x !== "object") return null
  if (Array.isArray(x.kids)) {
    const kids = x.kids.map(clean)
    const sizes = kids.map((_, i) => (typeof x.sizes?.[i] === "number" ? x.sizes[i] : 1))
    return { id: String(x.id ?? `s${newId()}`), dir: x.dir === "col" ? "col" : "row", kids: kids.map((k) => k ?? { id: "", tabs: [], active: "" }), sizes }
  }
  // (a hand-edited or half-synced file: a tab that isn't one is dropped, not every tab bar stopped on it)
  const tabs = (Array.isArray(x.tabs) ? x.tabs : []).flatMap((t) => (okTab(t) ? [okHistory(t)] : []))
  const active = tabs.some((t) => t.id === x.active) ? x.active! : tabs[0]?.id
  const sets = (Array.isArray(x.sets) ? x.sets : []).flatMap((s) => (okSet(s) ? [{ id: s.id, name: s.name.slice(0, 80), color: s.color, ...(s.collapsed === true ? { collapsed: true } : {}) }] : []))
  const float = okFloat(x.float)
  return tabs.length && active ? fixSets({ id: String(x.id), tabs, active, ...(x.stacked === true ? { stacked: true } : {}), ...(sets.length ? { sets } : {}), ...(float ? { float } : {}) }) : null
}
/** A saved float's place, kept inside the workspace; null if it isn't one. */
function okFloat(r: unknown): Rect | null {
  const o = r as Partial<Rect> | null
  if (!o || typeof o !== "object" || ![o.x, o.y, o.w, o.h].every((n) => typeof n === "number" && Number.isFinite(n))) return null
  const w = Math.min(1, Math.max(0.05, o.w!)), h = Math.min(1, Math.max(0.05, o.h!))
  return { x: Math.min(1 - w, Math.max(0, o.x!)), y: Math.min(1 - h, Math.max(0, o.y!)), w, h }
}
const okSet = (s: unknown): s is TabSet => !!s && typeof s === "object" && typeof (s as TabSet).id === "string" && !!(s as TabSet).id
  && typeof (s as TabSet).name === "string" && isColor((s as TabSet).color)
const okTab = (t: unknown): t is Tab => !!t && typeof t === "object" && typeof (t as Tab).id === "string" && !!(t as Tab).id && typeof (t as Tab).to === "string" && !!(t as Tab).to
const strings = (a: unknown) => Array.isArray(a) && a.every((x) => typeof x === "string")
function okHistory(t: Tab): Tab {
  if ((t.back === undefined || strings(t.back)) && (t.fwd === undefined || strings(t.fwd)) && (t.from === undefined || typeof t.from === "string")
    && (t.set === undefined || (typeof t.set === "string" && !!t.set)) && (t.home === undefined || (typeof t.home === "string" && !!t.home))
    && (t.name === undefined || (typeof t.name === "string" && !!t.name))) return t
  const { back, fwd, from, set, home, name, ...rest } = t
  return { ...rest, ...(strings(back) ? { back } : {}), ...(strings(fwd) ? { fwd } : {}), ...(typeof from === "string" ? { from } : {}),
    ...(typeof set === "string" && set ? { set } : {}), ...(typeof home === "string" && home ? { home } : {}), ...(typeof name === "string" && name ? { name } : {}) }
}

/** Every group changed by `fn`. */
export const mapGroups = (n: Layout, fn: (g: Group) => Group): Layout => (isSplit(n) ? { ...n, kids: n.kids.map((k) => mapGroups(k, fn)) } : fn(n))
/** One tab of a group changed by `fn`. */
export const mapTabs = (g: Group, id: string, fn: (t: Tab) => Tab): Group => ({ ...g, tabs: g.tabs.map((t) => (t.id === id ? fn(t) : t)) })

export const HISTORY = 50
/** A tab moving on to `to`: where it was goes into its history (a blank tab isn't worth going back to). */
export const moveOn = (t: Tab, to: string): Tab =>
  t.to === to ? t : { ...t, to, back: t.to === "new" ? t.back : [...(t.back ?? []), t.to].slice(-HISTORY), fwd: [] }

// Tabs leaving (closed, or moved elsewhere): the one rule for what shows next, in a pane and in the workspace.
/** Group `g` without the tabs `ids`: the tab shown, if it goes, moves on to the nearest one after it, else before it. */
export function withoutTabs(g: Group, ids: Set<string>): Group {
  if (!g.tabs.some((t) => ids.has(t.id))) return g
  const tabs = g.tabs.filter((t) => !ids.has(t.id))
  if (!ids.has(g.active)) return { ...g, tabs }
  const i = g.tabs.findIndex((t) => t.id === g.active)
  const next = g.tabs.slice(i).find((t) => !ids.has(t.id)) ?? g.tabs.slice(0, i).findLast((t) => !ids.has(t.id))
  return { ...g, tabs, active: next?.id ?? "" }
}
/** The pane focused after `was` became `root`: `focus` while it's there, else (it closed) the one after it, else before. */
export function focusAfter(was: Layout, root: Layout, focus: string): string {
  const gs = leaves(root), ids = leaves(was).map((g) => g.id)
  if (gs.some((g) => g.id === focus)) return focus
  const i = Math.max(0, ids.indexOf(focus))
  return (gs.find((g) => g.id === ids[i + 1]) ?? gs.findLast((g) => ids.indexOf(g.id) < i) ?? gs[0]).id
}
/** Workspace `w` without the tabs `ids`: panes left with none close. Null when no tab is left. */
export function withoutTabsIn(w: Workspace, ids: Set<string>): Workspace | null {
  const root = tidy(mapGroups(w.root, (g) => withoutTabs(g, ids)))
  return root && { root, focus: focusAfter(w.root, root, w.focus) }
}

// A blank tab ("new") is only a place to open something, never worth keeping: what's opened from it goes in it, and
// when what's opened from it shows in another tab instead, it closes. Only switching tabs by hand leaves one be.
export const isBlank = (t: Tab | undefined) => t?.to === "new"
/** `next`, a change of group `g` that shows another tab there (something opened or dropped into it): the blank tab
 *  `g` showed, if it did, is gone from it. */
export function pastBlank(g: Group, next: Group): Group {
  const b = shownTab(g)
  return b && isBlank(b) && next.active !== b.id ? { ...next, tabs: next.tabs.filter((t) => t.id !== b.id) } : next
}
/** `n` without blank tab `id`, left for a tab elsewhere that has what was opened from it. `keepPane`: not when it's
 *  its pane's last tab (a computer's split stays as the user made it; a phone shows no panes). */
export function dropBlank(n: Layout, id: string, keepPane: boolean): Layout {
  return mapGroups(n, (g) => {
    if (!isBlank(g.tabs.find((x) => x.id === id)) || (keepPane && g.tabs.length < 2)) return g
    return withoutTabs(g, new Set([id]))
  })
}

/** `n` with group `g` put beside group `at`: in `at`'s split if it goes the same way, else in a new split with it. */
export function beside(n: Layout, at: string, g: Group, side: Side): Layout {
  const dir = side === "left" || side === "right" ? "row" : "col"
  const after = side === "right" || side === "bottom"
  if (!isSplit(n)) return n.id !== at ? n : { id: `s${newId()}`, dir, kids: after ? [n, g] : [g, n], sizes: [0.5, 0.5] }
  const i = n.kids.findIndex((k) => !isSplit(k) && k.id === at)
  if (i < 0 || n.dir !== dir) return { ...n, kids: n.kids.map((k) => beside(k, at, g, side)) }
  const kids = [...n.kids], sizes = [...n.sizes]
  kids.splice(after ? i + 1 : i, 0, g)
  sizes.splice(i, 1, sizes[i] / 2, sizes[i] / 2)
  return { ...n, kids, sizes }
}

/** Where a group sat, to put it back (a pane closed, then reopened): beside `next`, the part its room goes to when it
 *  closes (tidy: the one before it, else after), on the `after` side, with its `share` of the room the two had. */
export type Spot = { next: string; dir: Split["dir"]; after: boolean; share: number }
export function spotOf(n: Layout, gid: string): Spot | null {
  if (!isSplit(n)) return null
  const i = n.kids.findIndex((k) => !isSplit(k) && k.id === gid)
  if (i < 0) return n.kids.reduce<Spot | null>((s, k) => s ?? spotOf(k, gid), null)
  const j = i > 0 ? i - 1 : i + 1
  return { next: n.kids[j].id, dir: n.dir, after: i > 0, share: n.sizes[i] / (n.sizes[i] + n.sizes[j]) }
}
/** `n` with group `g` back at `spot`, taking its share of the room `next` has now; null if `next` is gone. */
export function putBack(n: Layout, g: Group, { next, dir, after, share }: Spot): Layout | null {
  const two = (s: number) => (after ? [s * (1 - share), s * share] : [s * share, s * (1 - share)])
  const i = isSplit(n) ? n.kids.findIndex((k) => k.id === next) : -1
  if (isSplit(n) && i >= 0 && n.dir === dir) {
    const kids = [...n.kids], sizes = [...n.sizes]
    kids.splice(after ? i + 1 : i, 0, g)
    sizes.splice(i, 1, ...two(sizes[i]))
    return { ...n, kids, sizes }
  }
  if (n.id === next) return { id: `s${newId()}`, dir, kids: after ? [n, g] : [g, n], sizes: two(1) }
  if (!isSplit(n)) return null
  for (const [j, k] of n.kids.entries()) {
    const put = putBack(k, g, { next, dir, after, share })
    if (put) return { ...n, kids: n.kids.map((x, m) => (m === j ? put : x)) }
  }
  return null
}

/** Where each group sits, as shares of the workspace (x, y, width, height from 0 to 1), floating ones in `floats`; the
 *  dividers between the tiled parts of each split: `at` where it is, `rect` the split's box, `i` the tiled part before. */
export type Rect = { x: number; y: number; w: number; h: number }
export type Divider = { split: Split; i: number; rect: Rect; at: number }
export function layout(root: Layout) {
  const panes: { group: Group; rect: Rect }[] = [], dividers: Divider[] = [], floats: { group: Group; rect: Rect }[] = []
  const walk = (n: Layout, r: Rect) => {
    if (!isSplit(n)) return void panes.push({ group: n, rect: r })
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
  for (const g of leaves(root)) if (g.float) floats.push({ group: g, rect: g.float })
  return { panes, dividers, floats }
}
/** Whether any of `n` is tiled (not every group in it floating). */
export const tiled = (n: Layout): boolean => (isSplit(n) ? n.kids.some(tiled) : !n.float)
/** A split's tiled parts (their indexes) and the room they have together. */
function tiledIn(n: Split) {
  const at = n.kids.flatMap((k, j) => (tiled(k) ? [j] : []))
  return { at, total: at.reduce((a, j) => a + n.sizes[j], 0) || 1 }
}

/** The group beside `from` on that side (the one most in line with it), if any; from a floating one, the tiled
 *  ones past its edge. */
export function neighbourOf(root: Layout, from: string, side: Side) {
  const { panes, floats } = layout(root)
  const cur = panes.find((p) => p.group.id === from) ?? floats.find((p) => p.group.id === from)
  if (!cur) return null
  const c = cur.rect, e = 1e-6
  const mid = (r: Rect) => (side === "left" || side === "right" ? r.y + r.h / 2 : r.x + r.w / 2)
  const ok = (r: Rect) => side === "right" ? r.x >= c.x + c.w - e && r.y < c.y + c.h - e && r.y + r.h > c.y + e
    : side === "left" ? r.x + r.w <= c.x + e && r.y < c.y + c.h - e && r.y + r.h > c.y + e
    : side === "bottom" ? r.y >= c.y + c.h - e && r.x < c.x + c.w - e && r.x + r.w > c.x + e
    : r.y + r.h <= c.y + e && r.x < c.x + c.w - e && r.x + r.w > c.x + e
  const gap = (r: Rect) => (side === "right" ? r.x - c.x - c.w : side === "left" ? c.x - r.x - r.w : side === "bottom" ? r.y - c.y - c.h : c.y - r.y - r.h)
  const near = panes.filter((p) => ok(p.rect)).sort((a, b) => gap(a.rect) - gap(b.rect) || Math.abs(mid(a.rect) - mid(c)) - Math.abs(mid(b.rect) - mid(c)))
  return near[0]?.group ?? null
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

/** Groups `a` and `b` in each other's place (the same objects, so neither pane remounts). */
export function swapped(root: Layout, a: string, b: string): Layout {
  const ga = leaves(root).find((g) => g.id === a), gb = leaves(root).find((g) => g.id === b)
  if (!ga || !gb || a === b) return root
  return mapGroups(root, (g) => (g.id === a ? gb : g.id === b ? ga : g))
}

/** The divider along group `gid`'s edge on `side`, if it has one there (only one can be: tidy joins splits that go
 *  the same way). */
function edgeOf(root: Layout, gid: string, side: Side): Divider | null {
  const { panes, dividers } = layout(root)
  const c = panes.find((p) => p.group.id === gid)?.rect
  if (!c) return null
  const row = side === "left" || side === "right", e = 1e-6
  const edge = side === "left" ? c.x : side === "right" ? c.x + c.w : side === "top" ? c.y : c.y + c.h
  return dividers.find(({ split, rect: r, at }) => (split.dir === "row") === row && (row
    ? Math.abs(r.x + at * r.w - edge) < e && r.y < c.y + c.h - e && r.y + r.h > c.y + e
    : Math.abs(r.y + at * r.h - edge) < e && r.x < c.x + c.w - e && r.x + r.w > c.x + e)) ?? null
}
/** Group `gid`'s divider on `side` (else the one on the other side) moved that way by `by`, each part at least `min`
 *  (both shares of the whole layout, across that way): a pane resized from the keyboard, as a terminal's splits are. */
export function nudged(root: Layout, gid: string, side: Side, by: number, min: number): Layout {
  const back: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" }
  const d = edgeOf(root, gid, side) ?? edgeOf(root, gid, back[side])
  if (!d) return root
  const span = d.split.dir === "row" ? d.rect.w : d.rect.h
  return resized(root, d.split.id, d.i, d.at + ((side === "right" || side === "bottom" ? by : -by) / span), min / span)
}

// ---------- zoom and floating panes ----------

/** Group `gid` floating at `rect` (shares of the workspace), or docked back into its spot (null). */
export const floated = (root: Layout, gid: string, rect: Rect | null): Layout => mapGroups(root, (g) => {
  if (g.id !== gid) return g
  const { float: _, ...rest } = g
  return rect ? { ...rest, float: okFloat(rect)! } : rest
})
/** `w` as it must be: some pane tiled (with none, the floating ones dock), and the zoom only on the focused pane, while
 *  it's tiled and has others beside it. Unchanged, `w` itself. */
export function settled(w: Workspace): Workspace {
  const root = tiled(w.root) ? w.root : mapGroups(w.root, (g) => { const { float: _, ...rest } = g; return rest })
  const tiles = layout(root).panes
  const zoom = w.zoom && w.zoom === w.focus && tiles.length > 1 && tiles.some((p) => p.group.id === w.zoom) ? w.zoom : undefined
  if (root === w.root && zoom === w.zoom) return w
  const { zoom: _, ...rest } = w
  return { ...rest, root, ...(zoom ? { zoom } : {}) }
}

// ---------- tab groups (TabSet): runs of a pane's tabs ----------

/** A tab in tab group `set` (none: out of any). */
export const inSet = (t: Tab, set: string | undefined): Tab => {
  if (t.set === set) return t
  const { set: _, ...rest } = t
  return set ? { ...rest, set } : rest
}

/** `g` as tab groups must be: each one's tabs together (where its first is), none in an unknown or empty one, listed in
 *  order, the tab shown never folded away (its group opens). Unchanged, `g` itself. */
export function fixSets(g: Group): Group {
  if (!g.sets) return g.tabs.some((t) => t.set) ? { ...g, tabs: g.tabs.map((t) => inSet(t, undefined)) } : g
  const known = new Map(g.sets.map((s) => [s.id, s]))
  const tabs: Tab[] = [], done = new Set<string>()
  for (const t of g.tabs) {
    const s = t.set && known.has(t.set) ? t.set : undefined
    if (!s) { tabs.push(inSet(t, undefined)); continue }
    if (done.has(s)) continue
    done.add(s)
    tabs.push(...g.tabs.filter((x) => x.set === s))
  }
  const shown = tabs.find((t) => t.id === g.active)?.set
  const sets = [...done].map((id) => { const s = known.get(id)!; return s.collapsed && id === shown ? { id: s.id, name: s.name, color: s.color } : s })
  const same = tabs.length === g.tabs.length && tabs.every((t, i) => t === g.tabs[i]) && sets.length === g.sets.length && sets.every((s, i) => s === g.sets![i])
  if (same) return g
  const { sets: _, ...rest } = g
  return sets.length ? { ...rest, tabs, sets } : { ...rest, tabs }
}
/** Every pane's tab groups fixed (fixSets); unchanged, `n` itself. */
export function fixAllSets(n: Layout): Layout {
  if (!isSplit(n)) return fixSets(n)
  const kids = n.kids.map(fixAllSets)
  return kids.every((k, i) => k === n.kids[i]) ? n : { ...n, kids }
}

/** The tab group a tab put at index `at` of `tabs` (which haven't got it) joins: the one on both sides of it, or, at
 *  either end of its own group (`own`), that one. Else none. */
export function setAt(tabs: Tab[], at: number, own?: string): string | undefined {
  const l = tabs[at - 1]?.set, r = tabs[at]?.set
  if (l && l === r) return l
  return own && (l === own || r === own) ? own : undefined
}

/** Where a tab group's tabs are in its pane: the first's index and how many. */
export function runOf(g: Group, set: string) {
  const at = g.tabs.findIndex((t) => t.set === set)
  return { at, n: at < 0 ? 0 : g.tabs.filter((t) => t.set === set).length }
}
/** Index `at` moved out of any tab group's run (to before it), so what goes there joins none. */
export function outsideSets(tabs: Tab[], at: number) {
  const s = tabs[at]?.set
  if (!s || tabs[at - 1]?.set !== s) return at
  return tabs.findIndex((t) => t.set === s)
}
