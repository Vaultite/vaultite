// A hand's strokes: the points a pen goes through for each mark (seeded, so a mark redrawn looks the same), and as ink
// (perfect-freehand's outline, filled) or a sketch (rough.js' paths).
import { getStroke } from "perfect-freehand"
import rough from "roughjs"
import type { Rect } from "../../../plugins/core/companion/screenmarks"
import type { Pt } from "./layout"

export type Line = [number, number][]

/** A seeded random (mulberry32): the same mark wobbles the same way each time it's drawn. */
export function seeded(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
export const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }

/** A loop around `r`, as a hand rings something: it starts top left and overshoots its start a little. */
export function ringLine(r: Rect, rnd: () => number): Line {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2, ry = r.h / 2, start = -2.5 + rnd() * 0.4, turn = Math.PI * 2 + 0.45, phase = rnd() * 6
  return Array.from({ length: 56 }, (_, i) => {
    const k = i / 55, a = start + k * turn, wob = 1 + 0.035 * Math.sin(a * 3 + phase) + k * 0.05
    return [cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob] as [number, number]
  })
}
/** A stroke from `a` to `b` with a slight bow (`bow`: how far it bends, in px). */
export function bowLine(a: Pt, b: Pt, bow: number, n = 18): Line {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len
  return Array.from({ length: n }, (_, i) => { const k = i / (n - 1), s = Math.sin(k * Math.PI) * bow; return [a.x + dx * k + nx * s, a.y + dy * k + ny * s] as [number, number] })
}
/** A quadratic curve's points. */
export function curveLine(p0: Pt, c: Pt, p1: Pt, n = 28): Line {
  return Array.from({ length: n }, (_, i) => { const k = i / (n - 1), u = 1 - k; return [u * u * p0.x + 2 * u * k * c.x + k * k * p1.x, u * u * p0.y + 2 * u * k * c.y + k * k * p1.y] as [number, number] })
}
/** An arrow's head at `tip`, coming from `from`: two short strokes. */
export function headLines(tip: Pt, from: Pt, size = 13): Line[] {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x)
  return [-0.5, 0.5].map((d) => [[tip.x - Math.cos(a + d) * size, tip.y - Math.sin(a + d) * size], [tip.x, tip.y]] as Line)
}
/** A tick: short down, long up. */
export const checkLines = (c: Pt, s = 1): Line[] => [[[c.x - 11 * s, c.y - 1 * s], [c.x - 4 * s, c.y + 8 * s], [c.x + 13 * s, c.y - 12 * s]]]
export const crossLines = (c: Pt, s = 1): Line[] => [[[c.x - 10 * s, c.y - 10 * s], [c.x + 10 * s, c.y + 10 * s]], [[c.x + 10 * s, c.y - 10 * s], [c.x - 10 * s, c.y + 10 * s]]]

/** A line through `pts`, filled in between (a polyline's corners kept: a tick stays a tick). */
export function densify(pts: Line, step = 4): Line {
  const out: Line = []
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step))
    for (let k = 0; k < n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n])
  }
  out.push(pts[pts.length - 1])
  return out
}

/** Ink along `pts` (a pen's outline, its width swelling and thinning), as a filled path's `d`. */
export function inkPath(pts: Line, size = 5): string {
  const o = getStroke(densify(pts), { size, thinning: 0.5, smoothing: 0.55, streamline: 0.35, simulatePressure: true, last: true, start: { taper: size * 2.2 }, end: { taper: size * 1.6 } })
  if (o.length < 3) return ""
  // (through the midpoints, each point the curve's control: a smooth outline)
  let d = `M${f(o[0][0])},${f(o[0][1])} Q`
  for (let i = 0; i < o.length; i++) {
    const [x0, y0] = o[i], [x1, y1] = o[(i + 1) % o.length]
    d += `${f(x0)},${f(y0)} ${f((x0 + x1) / 2)},${f((y0 + y1) / 2)} `
  }
  return `${d}Z`
}
/** The line itself, as a path (what the pen's reveal follows). */
export const linePath = (pts: Line) => pts.map(([x, y], i) => `${i ? "L" : "M"}${f(x)},${f(y)}`).join("")
const f = (v: number) => (Math.round(v * 10) / 10).toString()

const gen = rough.generator()
/** rough.js' strokes of a shape, as paths (`fill`: hachure in the tint). */
export function sketch(kind: "rect" | "ellipse" | "line", r: Rect | [Pt, Pt], seed: number, opts: { fill?: boolean; roughness?: number } = {}) {
  const o = { seed: (seed % 2_000_000) + 1, roughness: opts.roughness ?? 1.1, bowing: 1.2, strokeWidth: 2, stroke: "#000", ...(opts.fill ? { fill: "#000", fillStyle: "hachure", hachureGap: 6, fillWeight: 1.4 } : {}) }
  const d = Array.isArray(r) ? gen.line(r[0].x, r[0].y, r[1].x, r[1].y, o)
    : kind === "ellipse" ? gen.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, o) : gen.rectangle(r.x, r.y, r.w, r.h, o)
  // (hachure's lines are thinner than the outline's)
  return gen.toPaths(d).map((p) => ({ d: p.d, hatch: p.strokeWidth < 2 }))
}
