import { getStroke } from "perfect-freehand"
import rough from "roughjs"
import type { Rect } from "../../../core/desktop/screenmarks"
import { type Pt, type RingShape } from "./layout"

export type Line = [number, number][]

export function seeded(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
export const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }

export function ringLine(r: Rect, rnd: () => number, shape: RingShape = "ellipse"): Line {
  if (shape === "box") return boxLoop(r, rnd)
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2, ry = r.h / 2, start = -2.5 + rnd() * 0.4, turn = Math.PI * 2 + 0.45, phase = rnd() * 6
  return Array.from({ length: 56 }, (_, i) => {
    const k = i / 55, a = start + k * turn, wob = 1 + 0.035 * Math.sin(a * 3 + phase) + k * 0.05
    return [cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob] as [number, number]
  })
}
function boxLoop(r: Rect, rnd: () => number): Line {
  const rad = Math.min(16, r.w / 2, r.h / 2), sw = r.w - 2 * rad, sh = r.h - 2 * rad, arc = (Math.PI / 2) * rad
  const per = 2 * (sw + sh) + 4 * arc, startAt = sw * (0.12 + rnd() * 0.12), run = per * 1.07, phase = rnd() * 6
  const n = Math.min(140, Math.max(48, Math.round(run / 9)))
  const at = (s: number): [number, number] => {
    s = ((s % per) + per) % per
    const corner = (cx: number, cy: number, a0: number, d: number): [number, number] => { const a = a0 + d / rad; return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad] }
    const x0 = r.x + rad, x1 = r.x + r.w - rad, y0 = r.y + rad, y1 = r.y + r.h - rad
    if (s < sw) return [x0 + s, r.y]; s -= sw
    if (s < arc) return corner(x1, y0, -Math.PI / 2, s); s -= arc
    if (s < sh) return [r.x + r.w, y0 + s]; s -= sh
    if (s < arc) return corner(x1, y1, 0, s); s -= arc
    if (s < sw) return [x1 - s, r.y + r.h]; s -= sw
    if (s < arc) return corner(x0, y1, Math.PI / 2, s); s -= arc
    if (s < sh) return [r.x, y1 - s]; s -= sh
    return corner(x0, y0, Math.PI, s)
  }
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  return Array.from({ length: n }, (_, i) => {
    const k = i / (n - 1), [x, y] = at(startAt + k * run), out = 1.5 * Math.sin(k * 9 + phase) + k * 4
    const dx = x - cx, dy = y - cy, len = Math.hypot(dx, dy) || 1
    return [x + (dx / len) * out, y + (dy / len) * out] as [number, number]
  })
}
export function bowLine(a: Pt, b: Pt, bow: number, n = 18): Line {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len
  return Array.from({ length: n }, (_, i) => { const k = i / (n - 1), s = Math.sin(k * Math.PI) * bow; return [a.x + dx * k + nx * s, a.y + dy * k + ny * s] as [number, number] })
}
export function curveLine(p0: Pt, c: Pt, p1: Pt, n = 28): Line {
  return Array.from({ length: n }, (_, i) => { const k = i / (n - 1), u = 1 - k; return [u * u * p0.x + 2 * u * k * c.x + k * k * p1.x, u * u * p0.y + 2 * u * k * c.y + k * k * p1.y] as [number, number] })
}
export function headLines(tip: Pt, from: Pt, size = 13): Line[] {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x)
  return [-0.5, 0.5].map((d) => [[tip.x - Math.cos(a + d) * size, tip.y - Math.sin(a + d) * size], [tip.x, tip.y]] as Line)
}
export const checkLines = (c: Pt, s = 1): Line[] => [[[c.x - 11 * s, c.y - 1 * s], [c.x - 4 * s, c.y + 8 * s], [c.x + 13 * s, c.y - 12 * s]]]
export const crossLines = (c: Pt, s = 1): Line[] => [[[c.x - 10 * s, c.y - 10 * s], [c.x + 10 * s, c.y + 10 * s]], [[c.x + 10 * s, c.y - 10 * s], [c.x - 10 * s, c.y + 10 * s]]]

export function densify(pts: Line, step = 4): Line {
  const out: Line = []
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step))
    for (let k = 0; k < n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n])
  }
  out.push(pts[pts.length - 1])
  return out
}

export function inkPath(pts: Line, size = 5): string {
  const o = getStroke(densify(pts), { size, thinning: 0.5, smoothing: 0.55, streamline: 0.35, simulatePressure: true, last: true, start: { taper: size * 2.2 }, end: { taper: size * 1.6 } })
  if (o.length < 3) return ""
  let d = `M${f(o[0][0])},${f(o[0][1])} Q`
  for (let i = 0; i < o.length; i++) {
    const [x0, y0] = o[i], [x1, y1] = o[(i + 1) % o.length]
    d += `${f(x0)},${f(y0)} ${f((x0 + x1) / 2)},${f((y0 + y1) / 2)} `
  }
  return `${d}Z`
}
export const linePath = (pts: Line) => pts.map(([x, y], i) => `${i ? "L" : "M"}${f(x)},${f(y)}`).join("")
const f = (v: number) => (Math.round(v * 10) / 10).toString()

const gen = rough.generator()
export type Sketched = { d: string; hatch: boolean; fill?: boolean }
type Shape = "rect" | "ellipse" | "diamond" | "line" | "poly" | "open"
export function sketch(kind: Shape, r: Rect | [Pt, Pt] | Line, seed: number, opts: { fill?: boolean; solid?: boolean; roughness?: number } = {}): Sketched[] {
  const o = { seed: (seed % 2_000_000) + 1, roughness: opts.roughness ?? 1.1, bowing: 1.2, strokeWidth: 2, stroke: "#000",
    ...(opts.fill ? { fill: "#000", fillStyle: "hachure", hachureGap: 6, fillWeight: 1.4 } : opts.solid ? { fill: "#000", fillStyle: "solid" } : {}) }
  const pts = (l: Line) => l.map(([x, y]) => [x, y] as [number, number])
  const d = kind === "poly" ? gen.polygon(pts(r as Line), o) : kind === "open" ? gen.linearPath(pts(r as Line), o)
    : Array.isArray(r) ? gen.line((r as [Pt, Pt])[0].x, (r as [Pt, Pt])[0].y, (r as [Pt, Pt])[1].x, (r as [Pt, Pt])[1].y, o)
    : kind === "ellipse" ? gen.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, o)
    : kind === "diamond" ? gen.polygon([[r.x + r.w / 2, r.y], [r.x + r.w, r.y + r.h / 2], [r.x + r.w / 2, r.y + r.h], [r.x, r.y + r.h / 2]], o)
    : gen.rectangle(r.x, r.y, r.w, r.h, o)
  return gen.toPaths(d).map((p) => { const fill = p.stroke === "none" && !!p.fill && p.fill !== "none"; return { d: p.d, hatch: !fill && p.strokeWidth < 2, ...(fill ? { fill } : {}) } })
}
