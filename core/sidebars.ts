// The sidebars' panels (`.vaultite/sidebars.json`: left, right, collapsed, dock, heights, heightsAt), one shape for the app,
// vau and Workspaces; pure functions, no Node. A panel in neither list is hidden; the default comes from core/slots.ts.
import { defaultOrder, placeKey, type SlotInfo } from "./slots.ts"

export type Side = "left" | "right"
export const SIDES: Side[] = ["left", "right"]
/** Panel keys are "<plugin id>:<name>" ("files:files"). */
export type Sidebars = { left: string[]; right: string[]; collapsed: string[]; heights: Record<string, number>
  /** Shown panels a phone draws in its drawer's dock (icons only, at the thumb) instead of in their drawer. */
  dock?: string[]
  /** The sidebar's height (px) when `heights` were set: drawn at heights[k] * (its height now / heightsAt). */
  heightsAt?: number }
/** What a panel needs to be in the default setup: its key, its plugin's `sort` and whether it's `hidden` until shown. */
export type PanelInfo = SlotInfo
/** Where a panel goes: sidebar `side`, before panel `before` (null: the end). An anchor, not a position, so taking the
 *  panel out of its old place first never shifts it. */
export type Place = { side: Side; before: string | null }

const keys = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [])

/** sidebars.json as it's saved (or a workspace's copy), checked; null when it has neither sidebar (unset: the default). */
export function readSidebars(raw: unknown): Sidebars | null {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  if (!Array.isArray(o.left) && !Array.isArray(o.right)) return null
  const seen = new Set<string>()
  const once = (k: string) => !seen.has(k) && !!seen.add(k)
  const left = keys(o.left).filter(once), right = keys(o.right).filter(once)
  const h = o.heights && typeof o.heights === "object" && !Array.isArray(o.heights) ? o.heights as Record<string, unknown> : {}
  const heights = Object.fromEntries(Object.entries(h).filter(([k, v]) => seen.has(k) && typeof v === "number" && v > 0).map(([k, v]) => [k, Math.round(v as number)]))
  const at = typeof o.heightsAt === "number" && o.heightsAt > 0 && Object.keys(heights).length ? { heightsAt: Math.round(o.heightsAt) } : {}
  const dock = [...new Set(keys(o.dock))].filter((k) => seen.has(k))
  return { left, right, collapsed: [...new Set(keys(o.collapsed))].filter((k) => seen.has(k)), heights, ...at, ...(dock.length ? { dock } : {}) }
}

/** The sidebars where nothing's saved: every panel not marked `hidden`, on the left, by `sort` (then the order given). */
export function defaultSidebars(panels: PanelInfo[]): Sidebars {
  return { left: defaultOrder(panels), right: [], collapsed: [], heights: {} }
}

/** The same setup (what Workspaces compares to tell an unused workspace). */
export const sameSidebars = (a: Sidebars | null, b: Sidebars | null) => JSON.stringify(a) === JSON.stringify(b)

/** Which sidebar a panel is in (null: hidden). */
export const sideOf = (s: Sidebars, key: string): Side | null => (s.left.includes(key) ? "left" : s.right.includes(key) ? "right" : null)

/** Without the panel (hidden; shown again, it's open, as tall as what it draws). */
export function withoutPanel(s: Sidebars, key: string): Sidebars {
  const { [key]: _gone, ...heights } = s.heights
  const at = s.heightsAt && Object.keys(heights).length ? { heightsAt: s.heightsAt } : {}
  const dock = s.dock?.filter((k) => k !== key)
  return { left: s.left.filter((k) => k !== key), right: s.right.filter((k) => k !== key), collapsed: s.collapsed.filter((k) => k !== key), heights, ...at, ...(dock?.length ? { dock } : {}) }
}

/** Put a panel at a place: moved there (folded or not, as it was), or shown there if it was hidden. An anchor that isn't
 *  in that sidebar puts it at the end. */
export function placePanel(s: Sidebars, key: string, to: Place): Sidebars {
  const next = { ...withoutPanel(s, key), collapsed: s.collapsed, heights: s.heights, ...(s.heightsAt ? { heightsAt: s.heightsAt } : {}), ...(s.dock ? { dock: s.dock } : {}) }
  return { ...next, [to.side]: placeKey(next[to.side], key, to.before) }
}

/** Fold a panel to its heading, or open it. */
export const setCollapsed = (s: Sidebars, key: string, collapsed: boolean): Sidebars =>
  ({ ...s, collapsed: collapsed ? [...s.collapsed.filter((k) => k !== key), key] : s.collapsed.filter((k) => k !== key) })

/** Put a panel in the phone's dock, or back in its drawer. */
export function setDocked(s: Sidebars, key: string, docked: boolean): Sidebars {
  const { dock: was = [], ...rest } = s
  const dock = docked ? [...was.filter((k) => k !== key), key] : was.filter((k) => k !== key)
  return { ...rest, ...(dock.length ? { dock } : {}) }
}

/** Give a panel a height (px), or none (null: as tall as what it draws). `at`: the sidebar's height now (px): the
 *  other panels' heights are put in this screen's terms too, and all of them drawn in proportion elsewhere. */
export const setHeight = (s: Sidebars, key: string, px: number | null, at?: number): Sidebars => setHeights(s, { [key]: px }, at)

/** Several panels' heights at once (a divider dragged changes the panels on both sides of it): px, or null for none. */
export function setHeights(s: Sidebars, change: Record<string, number | null>, at?: number): Sidebars {
  const k = at && s.heightsAt ? at / s.heightsAt : 1
  const heights = Object.fromEntries(Object.entries(s.heights).filter(([x]) => !(x in change)).map(([x, v]) => [x, Math.round(v * k)]))
  for (const [key, px] of Object.entries(change)) if (px !== null) heights[key] = Math.round(px)
  const { heightsAt, ...base } = s
  const ref = at || heightsAt
  return { ...base, heights, ...(ref && Object.keys(heights).length ? { heightsAt: Math.round(ref) } : {}) }
}

/** A panel's height as drawn in a sidebar `at` px tall: its saved height in proportion (undefined: none). */
export function heightIn(s: Sidebars, key: string, at: number): number | undefined {
  const px = s.heights[key]
  if (!px) return undefined
  return s.heightsAt && at > 0 ? Math.round(px * at / s.heightsAt) : px
}

// ---- Laying out a sidebar whose panels each scroll in their own box (`sidebarScroll: panels`), like VS Code's ----

/** A panel as the sidebar lays it out (px): what it draws, the least it's given, and its saved height. */
export type PanelFit = {
  /** Everything it draws: the most it's ever given, so there's never empty room inside a panel. */
  content: number
  /** The least it's given when room runs short (its heading and a few rows), when what it draws is taller. */
  min: number
  /** The height its divider was dragged to, in this screen's terms (heightIn); clamped between `min` and `content`. */
  height?: number
  /** Takes the room the others leave (the file tree, a `tall` panel): it keeps at least half of what's shared. */
  greedy?: boolean
  /** Always as tall as what it draws (folded to its heading). */
  fixed?: boolean
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0)
/** The least and the most a panel is given. */
const bounds = (p: PanelFit): [number, number] => (p.fixed ? [p.content, p.content] : [Math.min(p.min, p.content), p.content])

/** `total` px shared evenly among panels `idx`, each within lo..hi; one that needs less keeps only that and the others
 *  share the rest (water filling). Whole pixels adding up to `total`. */
function share(total: number, idx: number[], lo: number[], hi: number[]): Map<number, number> {
  const out = new Map<number, number>()
  if (!idx.length) return out
  total = clamp(total, sum(idx.map((i) => lo[i])), sum(idx.map((i) => hi[i])))
  const at = (t: number) => sum(idx.map((i) => clamp(t, lo[i], hi[i])))
  let a = 0, b = Math.max(1, ...idx.map((i) => hi[i]))
  for (let n = 0; n < 50; n++) { const m = (a + b) / 2; if (at(m) < total) a = m; else b = m }
  const exact = idx.map((i) => clamp(b, lo[i], hi[i]))
  const whole = exact.map(Math.floor)
  let left = Math.round(total - sum(whole))
  // The pixels lost to rounding go to the ones that lost the most and can still grow.
  const order = idx.map((_, k) => k).sort((x, y) => (exact[y] - whole[y]) - (exact[x] - whole[x]))
  for (const k of order) { if (left <= 0) break; if (whole[k] < hi[idx[k]]) { whole[k]++; left-- } }
  idx.forEach((i, k) => out.set(i, whole[k]))
  return out
}

/** Each panel's height in `room` px. A panel is never taller than what it draws; when they don't fit, small and folded
 *  ones keep their height, then saved heights, then the greedy one (the file tree) takes what's left. */
export function fitPanels(ps: PanelFit[], room: number): number[] {
  const lo: number[] = [], hi: number[] = []
  ps.forEach((p, i) => { [lo[i], hi[i]] = bounds(p) })
  const want = ps.map((p, i) => (p.height && !p.fixed ? clamp(p.height, lo[i], hi[i]) : hi[i]))
  const out = [...want]
  const put = (m: Map<number, number>) => { for (const [i, h] of m) out[i] = h }
  const all = ps.map((_, i) => i)
  if (sum(want) <= room) {
    // Room to spare: a panel drawn shorter than what it draws (a height dragged smaller) takes it back.
    const short = all.filter((i) => want[i] < hi[i])
    put(share(sum(short.map((i) => want[i])) + room - sum(want), short, want, hi))
    return out
  }
  const free = all.filter((i) => !ps[i].fixed && !ps[i].height && hi[i] > lo[i])
  const sized = all.filter((i) => !ps[i].fixed && !!ps[i].height && hi[i] > lo[i])
  const rest = room - sum(all.filter((i) => !free.includes(i)).map((i) => want[i]))
  if (rest >= sum(free.map((i) => lo[i]))) {
    const greedy = free.filter((i) => ps[i].greedy), others = free.filter((i) => !ps[i].greedy)
    const g = (f: (i: number) => number) => sum(greedy.map(f))
    // The greedy panels keep at least half of what's shared (when they draw that much); the others share what that
    // leaves, and the greedy ones take what the others don't need.
    const floor = greedy.length ? clamp(rest / 2, g((i) => lo[i]), g((i) => hi[i])) : 0
    let mine = share(rest - floor, others, lo, hi)
    const theirs = share(rest - sum([...mine.values()]), greedy, lo, hi)
    const over = rest - sum([...mine.values()]) - sum([...theirs.values()])
    if (over > 0) mine = share(sum([...mine.values()]) + over, others, lo, hi)
    put(mine); put(theirs)
    return out
  }
  // Not even that: the free panels at their least, and the ones with a height give way in proportion to what they have
  // above their least.
  for (const i of free) out[i] = lo[i]
  const left = room - sum(all.filter((i) => !sized.includes(i)).map((i) => out[i]))
  const above = sized.map((i) => want[i] - lo[i]), total = sum(above)
  const k = total > 0 ? clamp((left - sum(sized.map((i) => lo[i]))) / total, 0, 1) : 0
  sized.forEach((i, n) => { out[i] = Math.floor(lo[i] + above[n] * k) })
  return out
}

/** The divider under panel `i` dragged `dy` px, like VS Code's: the nearest panels on each side give or take, each
 *  within its least and what it draws, so the total stays the same and no gap opens. */
export function dragPanels(ps: PanelFit[], start: number[], i: number, dy: number): number[] {
  const out = [...start]
  const lim = ps.map((p, j) => (p.fixed ? [start[j], start[j]] : bounds(p)))
  const up = Array.from({ length: i + 1 }, (_, n) => i - n), down = Array.from({ length: ps.length - i - 1 }, (_, n) => i + 1 + n)
  const [grow, give] = dy > 0 ? [up, down] : [down, up]
  const canGrow = (j: number) => Math.max(0, lim[j][1] - start[j]), canGive = (j: number) => Math.max(0, start[j] - lim[j][0])
  let left = Math.min(Math.abs(Math.round(dy)), sum(grow.map(canGrow)), sum(give.map(canGive)))
  for (let pass = 0, rest = left; pass < 2; pass++, rest = left) {
    for (const j of pass ? give : grow) {
      const d = Math.min(rest, pass ? canGive(j) : canGrow(j))
      out[j] += pass ? -d : d
      rest -= d
    }
  }
  return out
}

/** The heights to save after a drag: only those fitPanels needs to draw the panels so again (a panel whose height makes
 *  no difference gets none). Indexes of `ps`: px, or null to drop one. */
export function heightsAfterDrag(ps: PanelFit[], room: number, after: number[]): Map<number, number | null> {
  const keep = new Map<number, number | undefined>()
  ps.forEach((p, i) => { if (!p.fixed && (after[i] < p.content || p.height)) keep.set(i, after[i]) })
  const lay = () => fitPanels(ps.map((p, i) => ({ ...p, height: keep.has(i) ? keep.get(i) : undefined })), room)
  const same = (h: number[]) => h.every((x, i) => Math.abs(x - after[i]) <= 1)
  const order = [...keep.keys()].sort((a, b) => Number(!!ps[b].greedy) - Number(!!ps[a].greedy) || ps[b].content - ps[a].content)
  for (const i of order) {
    const was = keep.get(i)
    keep.set(i, undefined)
    if (!same(lay())) keep.set(i, was)
  }
  const out = new Map<number, number | null>()
  ps.forEach((p, i) => {
    const h = keep.get(i)
    if (h !== undefined && h !== p.height) out.set(i, h)
    else if (h === undefined && p.height) out.set(i, null)
  })
  return out
}
