import { hopFor, OPEN_EASE, type Stroke } from "../core/pilot"
import { centre, inflate, markSpot, ringBox, ringShape, type Placed, type Pt } from "./layout"
import { bowLine, checkLines, crossLines, curveLine, headLines, type Line, ringLine, seeded } from "./ink"

export const STAGGER = 170
export const FRAME_MS = 640
export const FOCUS_FROM = 12

const lenOf = (l: Line) => l.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0)
export const durOf = (l: Line) => Math.min(650, Math.max(180, lenOf(l) * 1.3))
export function lineStarts(lines: Line[]) {
  let at = 0
  return lines.map((l) => { const s = at; at += durOf(l) * 0.85; return s })
}
const pt = (p: [number, number]): Pt => ({ x: p[0], y: p[1] })

export function markInk(p: Placed, seed: number): { lines: Line[]; size?: number } | null {
  const m = p.mark, r = p.box, rnd = seeded(seed)
  if (!r) return null
  switch (m.type) {
    case "ring": return { lines: [ringLine(ringBox(m, r), rnd, ringShape(r))] }
    case "underline": return { lines: [bowLine({ x: r.x - 4, y: r.y + r.h + 5 }, { x: r.x + r.w + 4, y: r.y + r.h + 3 + rnd() * 2 }, 2 + rnd() * 2)], size: 4 }
    case "strike": return { lines: [bowLine({ x: r.x - 5, y: r.y + r.h * 0.55 }, { x: r.x + r.w + 5, y: r.y + r.h * 0.45 }, 1.5)], size: 3.6 }
    case "check": return { lines: checkLines(markSpot(r)), size: 4.6 }
    case "cross": return { lines: crossLines(markSpot(r)), size: 4.6 }
    case "point": {
      if (!p.arrow) return null
      const { tip, tail } = p.arrow, shaft = bowLine(tail, tip, 7)
      return { lines: [shaft, ...headLines(tip, pt(shaft[shaft.length - 4]))], size: 4.2 }
    }
    case "connect": {
      if (!p.curve) return null
      const a = p.curve, c = curveLine(a.from, a.control, a.to)
      return { lines: [c, ...headLines(a.to, pt(c[c.length - 4]))], size: 4.2 }
    }
    case "scroll": {
      const c = centre(r), v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[m.dir], from = { x: c.x - v[0] * 28, y: c.y - v[1] * 28 }, to = { x: c.x + v[0] * 28, y: c.y + v[1] * 28 }
      return { lines: [bowLine(from, to, 3), ...headLines(to, from, 12)], size: 4.4 }
    }
    default: return null
  }
}

export function penStrokes(placed: Placed[], seedOf: (i: number) => number, startOf: (i: number) => number): Stroke[] {
  const out: Stroke[] = []
  for (const p of placed) {
    const at = startOf(p.i), ink = markInk(p, seedOf(p.i))
    if (ink) { const starts = lineStarts(ink.lines); ink.lines.forEach((l, j) => out.push({ start: at + starts[j], dur: durOf(l), pts: l })); continue }
    if (p.mark.type === "frame" && p.box) {
      const r = p.ink ?? inflate(p.box, 6)
      out.push({ start: at, dur: FRAME_MS, pts: [[r.x + Math.min(FOCUS_FROM, r.w), r.y + Math.min(FOCUS_FROM, r.h)], [r.x + r.w, r.y + r.h]], ease: OPEN_EASE, dry: true })
    } else if (p.mark.type === "num" && p.box) {
      const r = p.box, c = r.w || r.h ? { x: r.x + 1, y: r.y + 1 } : { x: r.x, y: r.y }
      out.push({ start: at, dur: 220, pts: [[c.x - 2, c.y - 2], [c.x, c.y]], dry: true })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

export const NEAR = 90
export function waitForPen(placed: Placed[], seedOf: (i: number) => number, startOf: (i: number) => number): Map<number, number> {
  const out = new Map<number, number>()
  let last: { end: number; at: [number, number] } | null = null
  for (const p of [...placed].sort((a, b) => startOf(a.i) - startOf(b.i) || a.i - b.i)) {
    const base = startOf(p.i), ss = penStrokes([p], seedOf, () => 0)
    if (!ss.length || !Number.isFinite(base)) { out.set(p.i, base); continue }
    const from = ss[0].pts[0], d = last ? Math.hypot(from[0] - last.at[0], from[1] - last.at[1]) : 0
    const at: number = last && d > NEAR ? Math.max(base, last.end + hopFor(d)) : base
    out.set(p.i, at)
    const tail = ss.reduce((a, b) => (b.start + b.dur > a.start + a.dur ? b : a)), end = tail.pts[tail.pts.length - 1]
    last = { end: at + tail.start + tail.dur, at: [end[0], end[1]] }
  }
  return out
}
