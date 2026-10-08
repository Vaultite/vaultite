// The tabs' layout as data: tabs in groups, groups in a tree of splits, and the pure changes to it (no state, no
// address, no DOM). core/workspace.ts keeps the one on screen and changes it with these.

export type Tab = { id: string; to: string
  /** Where it was before, oldest first; and where Back came from, the next first. */
  back?: string[]; fwd?: string[]
  /** The tab it was opened beside, for what was opened from that one (a person from People): Back past its first
   *  place closes it and shows that tab again, as it was left. Kept for this visit only, like its history. */
  from?: string
  /** Pinned: what's opened from it opens in a tab beside it, ⌘W and closing others leave it open. */
  pinned?: boolean }
export type Group = { id: string; tabs: Tab[]; active: string
  /** Its tabs side by side, sliding over each other with their titles on spines. */
  stacked?: boolean }
/** Groups (or splits) side by side ("row": a vertical divider between them) or stacked ("col"); `sizes` are their
 *  shares, adding up to 1. */
export type Split = { id: string; dir: "row" | "col"; kids: Layout[]; sizes: number[] }
export type Layout = Group | Split
export type Workspace = { root: Layout; focus: string }
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

/** The tree without empty groups, splits of one, or a split inside another going the same way (its parts join it). */
export function tidy(n: Layout | null): Layout | null {
  if (!n) return null
  if (!isSplit(n)) return n.tabs.length ? n : null
  const kids: Layout[] = [], sizes: number[] = []
  n.kids.forEach((k, i) => {
    const t = tidy(k)
    const s = n.sizes[i] > 0 ? n.sizes[i] : 1 / n.kids.length
    if (!t) return
    if (isSplit(t) && t.dir === n.dir) t.kids.forEach((x, j) => { kids.push(x); sizes.push(s * t.sizes[j]) })
    else { kids.push(t); sizes.push(s) }
  })
  if (kids.length < 2) return kids[0] ?? null
  const sum = sizes.reduce((a, b) => a + b, 0)
  return { ...n, kids, sizes: sizes.map((s) => s / sum) }
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
  return tabs.length && active ? { id: String(x.id), tabs, active, ...(x.stacked === true ? { stacked: true } : {}) } : null
}
const okTab = (t: unknown): t is Tab => !!t && typeof t === "object" && typeof (t as Tab).id === "string" && !!(t as Tab).id && typeof (t as Tab).to === "string" && !!(t as Tab).to
const strings = (a: unknown) => Array.isArray(a) && a.every((x) => typeof x === "string")
function okHistory(t: Tab): Tab {
  if ((t.back === undefined || strings(t.back)) && (t.fwd === undefined || strings(t.fwd)) && (t.from === undefined || typeof t.from === "string")) return t
  const { back, fwd, from, ...rest } = t
  return { ...rest, ...(strings(back) ? { back } : {}), ...(strings(fwd) ? { fwd } : {}), ...(typeof from === "string" ? { from } : {}) }
}

/** Every group changed by `fn`. */
export const mapGroups = (n: Layout, fn: (g: Group) => Group): Layout => (isSplit(n) ? { ...n, kids: n.kids.map((k) => mapGroups(k, fn)) } : fn(n))
/** One tab of a group changed by `fn`. */
export const mapTabs = (g: Group, id: string, fn: (t: Tab) => Tab): Group => ({ ...g, tabs: g.tabs.map((t) => (t.id === id ? fn(t) : t)) })

export const HISTORY = 50
/** A tab moving on to `to`: where it was goes into its history (a blank tab isn't worth going back to). */
export const moveOn = (t: Tab, to: string): Tab =>
  t.to === to ? t : { ...t, to, back: t.to === "new" ? t.back : [...(t.back ?? []), t.to].slice(-HISTORY), fwd: [] }

/** Which tab becomes active when `id` leaves a group: the one after it, else the one before. */
export const nextActive = (g: Group, id: string, rest: Tab[]) =>
  g.active !== id ? g.active : rest[Math.min(g.tabs.findIndex((t) => t.id === id), rest.length - 1)]?.id ?? ""

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
    const rest = g.tabs.filter((x) => x.id !== id)
    return { ...g, tabs: rest, active: nextActive(g, id, rest) }
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

/** Where each group sits, as shares of the workspace (x, y, width, height from 0 to 1), and the dividers between
 *  the parts of each split: `at` is where the divider is, `rect` the split's own box. */
export type Rect = { x: number; y: number; w: number; h: number }
export type Divider = { split: Split; i: number; rect: Rect; at: number }
export function layout(root: Layout) {
  const panes: { group: Group; rect: Rect }[] = [], dividers: Divider[] = []
  const walk = (n: Layout, r: Rect) => {
    if (!isSplit(n)) return void panes.push({ group: n, rect: r })
    let off = 0
    n.kids.forEach((k, i) => {
      const s = n.sizes[i]
      walk(k, n.dir === "row" ? { ...r, x: r.x + off * r.w, w: s * r.w } : { ...r, y: r.y + off * r.h, h: s * r.h })
      off += s
      if (i < n.kids.length - 1) dividers.push({ split: n, i, rect: r, at: off })
    })
  }
  walk(root, { x: 0, y: 0, w: 1, h: 1 })
  return { panes, dividers }
}

/** The group beside `from` on that side (the one most in line with it), if any. */
export function neighbourOf(root: Layout, from: string, side: Side) {
  const { panes } = layout(root)
  const cur = panes.find((p) => p.group.id === from)
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

/** Part `i` of split `splitId` ends at `at` (a share of the split), each part at least `min` wide. */
export function resized(root: Layout, splitId: string, i: number, at: number, min: number): Layout {
  const fix = (n: Layout): Layout => {
    if (!isSplit(n)) return n
    if (n.id !== splitId) return { ...n, kids: n.kids.map(fix) }
    const before = n.sizes.slice(0, i).reduce((a, b) => a + b, 0), pair = n.sizes[i] + n.sizes[i + 1]
    const a = Math.min(pair - min, Math.max(min, at - before))
    if (a <= 0 || pair - a <= 0) return n
    const sizes = [...n.sizes]
    sizes[i] = a; sizes[i + 1] = pair - a
    return { ...n, sizes }
  }
  return fix(root)
}
/** That split's parts back to equal. */
export function evened(root: Layout, splitId: string): Layout {
  const fix = (n: Layout): Layout => !isSplit(n) ? n
    : n.id === splitId ? { ...n, sizes: n.kids.map(() => 1 / n.kids.length) } : { ...n, kids: n.kids.map(fix) }
  return fix(root)
}
