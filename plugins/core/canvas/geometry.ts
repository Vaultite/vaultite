// A canvas's geometry: arrow anchors and curves, bounds, fitting, and snapping to the grid and other
// cards. Pure, in the file's pixels.
import type { Side } from "./codec.ts"

export type Pt = { x: number; y: number }
export type Box = { x: number; y: number; width: number; height: number }
export type View = { x: number; y: number; k: number }
/** Where a card is resized from: a side or a corner. */
export type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"
/** A line drawn while something snaps to it: `x` (vertical) or `y` (horizontal) at `at`, from `a` to `b`. */
export type Guide = { axis: "x" | "y"; at: number; a: number; b: number }

export const SIDES: Side[] = ["top", "right", "bottom", "left"]
export const DIRS: Dir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"]
export const GRID = 20
export const MIN_W = 80, MIN_H = 40
export const MIN_K = 0.05, MAX_K = 4
const DIR: Record<Side, Pt> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } }

export function anchor(n: Box, side: Side): Pt {
  return side === "top" ? { x: n.x + n.width / 2, y: n.y } : side === "bottom" ? { x: n.x + n.width / 2, y: n.y + n.height }
    : side === "left" ? { x: n.x, y: n.y + n.height / 2 } : { x: n.x + n.width, y: n.y + n.height / 2 }
}
export const center = (n: Box): Pt => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 })

/** The side of `n` facing the point: where an arrow without sides leaves or arrives. */
export function facing(n: Box, p: Pt): Side {
  const c = center(n)
  const dx = (p.x - c.x) / Math.max(1, n.width), dy = (p.y - c.y) / Math.max(1, n.height)
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "bottom" : "top")
}

/** The side of `n` nearest the point (an arrow's end dropped on a card: the side it was dropped by). */
export function nearestSide(n: Box, p: Pt): Side {
  let best: Side = "top", d = Infinity
  for (const s of SIDES) { const a = anchor(n, s), h = Math.hypot(a.x - p.x, a.y - p.y); if (h < d) { d = h; best = s } }
  return best
}

/** An arrow's curve from one side to another: its path, the middle (for its label), and the control points (the
 *  arrowheads point along them). */
export function curve(a: Pt, sa: Side, b: Pt, sb: Side | null) {
  const d = Math.max(30, Math.min(220, Math.hypot(b.x - a.x, b.y - a.y) / 2))
  const c1 = { x: a.x + DIR[sa].x * d, y: a.y + DIR[sa].y * d }
  const c2 = sb ? { x: b.x + DIR[sb].x * d, y: b.y + DIR[sb].y * d } : b
  const mid = { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 }
  return { d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`, mid, c1, c2 }
}

/** An arrowhead at `tip`, pointing away from `from`. */
export function head(tip: Pt, from: Pt, size: number) {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x)
  const p = (t: number) => `${tip.x - size * Math.cos(a + t)},${tip.y - size * Math.sin(a + t)}`
  return `${tip.x},${tip.y} ${p(0.45)} ${p(-0.45)}`
}

export function bounds(nodes: Box[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.width); y1 = Math.max(y1, n.y + n.height) }
  return nodes.length ? { x0, y0, x1, y1 } : null
}

/** The view that shows these boxes in a w × h box, `pad` px around them, never zoomed in past `max`. */
export function fitView(nodes: Box[], w: number, h: number, pad = 40, max = 1): View {
  const b = bounds(nodes)
  if (!b || !w || !h) return { x: w / 2, y: h / 2, k: 1 }
  const k = Math.max(MIN_K, Math.min(max, (w - pad * 2) / Math.max(1, b.x1 - b.x0), (h - pad * 2) / Math.max(1, b.y1 - b.y0 + 24)))
  return { k, x: w / 2 - ((b.x0 + b.x1) / 2) * k, y: h / 2 - ((b.y0 + b.y1) / 2 - 12) * k }
}

/** The view zoomed to `k` about a point of the box (px from its top left), which stays where it is. */
export function zoomAbout(v: View, k: number, px: number, py: number): View {
  const kk = Math.max(MIN_K, Math.min(MAX_K, k))
  const wx = (px - v.x) / v.k, wy = (py - v.y) / v.k
  return { k: kk, x: px - wx * kk, y: py - wy * kk }
}

export const overlaps = (a: Box, b: { x0: number; y0: number; x1: number; y1: number }) =>
  a.x < b.x1 && a.x + a.width > b.x0 && a.y < b.y1 && a.y + a.height > b.y0

/** Whether a box lies wholly in a rectangle. */
export const within = (a: Box, b: { x0: number; y0: number; x1: number; y1: number }) =>
  a.x >= b.x0 && a.y >= b.y0 && a.x + a.width <= b.x1 && a.y + a.height <= b.y1

export const snapGrid = (v: number) => Math.round(v / GRID) * GRID

/** The lines other cards offer to snap to on one axis: their two edges and their centre. */
function lines(others: Box[], axis: "x" | "y") {
  const out: { at: number; a: number; b: number }[] = []
  for (const o of others) {
    const s = axis === "x" ? o.x : o.y, size = axis === "x" ? o.width : o.height
    const a = axis === "x" ? o.y : o.x, b = a + (axis === "x" ? o.height : o.width)
    out.push({ at: s, a, b }, { at: s + size / 2, a, b }, { at: s + size, a, b })
  }
  return out
}

/** The nearest of `lines` to any of `mine` (within `tol`): how far to move, and the line. */
function nearest(mine: number[], cands: { at: number; a: number; b: number }[], tol: number) {
  let best: { delta: number; line: { at: number; a: number; b: number } } | null = null
  for (const m of mine) {
    for (const c of cands) {
      const d = c.at - m
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, line: c }
    }
  }
  return best
}

/** A box being moved, snapped: to other cards' edges and centres (`others`; a guide is drawn for each) when one is
 *  within `tol`, else to the grid (its top left corner). Returns how far to shift it, and the guides. */
export function snapMove(box: Box, others: Box[], opts: { grid: boolean; objects: boolean; tol: number }) {
  const guides: Guide[] = []
  let dx = 0, dy = 0
  const span = (axis: "x" | "y", d: number, line: { at: number; a: number; b: number }) => {
    const a = axis === "x" ? box.y + dy : box.x + dx, b = a + (axis === "x" ? box.height : box.width)
    guides.push({ axis, at: line.at, a: Math.min(a, line.a), b: Math.max(b, line.b) })
    return d
  }
  const hx = opts.objects ? nearest([box.x, box.x + box.width / 2, box.x + box.width], lines(others, "x"), opts.tol) : null
  const hy = opts.objects ? nearest([box.y, box.y + box.height / 2, box.y + box.height], lines(others, "y"), opts.tol) : null
  if (hx) dx = hx.delta; else if (opts.grid) dx = snapGrid(box.x) - box.x
  if (hy) dy = hy.delta; else if (opts.grid) dy = snapGrid(box.y) - box.y
  if (hx) span("x", hx.delta, hx.line)
  if (hy) span("y", hy.delta, hy.line)
  return { dx, dy, guides }
}

/** A box resized from `dir` by (dx, dy) from `start`, at least the minimum size; its moving edges snap like a move's.
 *  `keep`: the corner keeps the box's proportions (Shift, an image). */
export function resizeBox(start: Box, dir: Dir, dx: number, dy: number, others: Box[], opts: { grid: boolean; objects: boolean; tol: number; keep?: boolean }) {
  let x0 = start.x, y0 = start.y, x1 = start.x + start.width, y1 = start.y + start.height
  if (dir.includes("w")) x0 += dx
  if (dir.includes("e")) x1 += dx
  if (dir.includes("n")) y0 += dy
  if (dir.includes("s")) y1 += dy
  const guides: Guide[] = []
  const snap = (v: number, axis: "x" | "y") => {
    if (opts.objects) {
      const hit = nearest([v], lines(others, axis), opts.tol)
      if (hit) {
        guides.push({ axis, at: hit.line.at, a: Math.min(axis === "x" ? y0 : x0, hit.line.a), b: Math.max(axis === "x" ? y1 : x1, hit.line.b) })
        return v + hit.delta
      }
    }
    return opts.grid ? snapGrid(v) : v
  }
  if (!opts.keep) {
    if (dir.includes("w")) x0 = snap(x0, "x")
    if (dir.includes("e")) x1 = snap(x1, "x")
    if (dir.includes("n")) y0 = snap(y0, "y")
    if (dir.includes("s")) y1 = snap(y1, "y")
  }
  if (x1 - x0 < MIN_W) { if (dir.includes("w")) x0 = x1 - MIN_W; else x1 = x0 + MIN_W }
  if (y1 - y0 < MIN_H) { if (dir.includes("n")) y0 = y1 - MIN_H; else y1 = y0 + MIN_H }
  if (opts.keep && dir.length === 2 && start.width > 0 && start.height > 0) {
    // A corner: the larger change wins, the other side follows the proportions.
    const ratio = start.width / start.height
    const w = x1 - x0, h = y1 - y0
    if (w / h > ratio) { const nh = w / ratio; if (dir.includes("n")) y0 = y1 - nh; else y1 = y0 + nh }
    else { const nw = h * ratio; if (dir.includes("w")) x0 = x1 - nw; else x1 = x0 + nw }
  }
  return { box: { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) }, guides }
}

/** Where a new card goes so its side facing `from` sits at `p`: an arrow dragged out from a card's `side` and let go
 *  in empty space. Returns its box and the side the arrow arrives at. */
export function placeFrom(p: Pt, from: Pt, w: number, h: number): { box: Box; side: Side } {
  const dx = p.x - from.x, dy = p.y - from.y
  const side: Side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "left" : "right") : (dy > 0 ? "top" : "bottom")
  const x = side === "left" ? p.x : side === "right" ? p.x - w : p.x - w / 2
  const y = side === "top" ? p.y : side === "bottom" ? p.y - h : p.y - h / 2
  return { box: { x: Math.round(x), y: Math.round(y), width: w, height: h }, side }
}
