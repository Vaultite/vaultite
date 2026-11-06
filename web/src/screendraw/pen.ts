// A mark's strokes as the ink draws them (Draw.tsx) and as the companion's cursor traces them, its pen (web/src/core/
// pilot.ts): one geometry and one timing for both, so the cursor keeps to the ink's front. No DOM.
import type { Stroke } from "../core/pilot"
import { centre, inflate, markSpot, ringBox, type Placed, type Pt } from "./layout"
import { bowLine, checkLines, crossLines, curveLine, headLines, type Line, ringLine, seeded } from "./ink"

/** How far apart marks of one beat start (ms). */
export const STAGGER = 170
/** A frame's sketch takes this long. */
export const FRAME_MS = 700

const lenOf = (l: Line) => l.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0)
/** How long a line's ink takes to draw. */
export const durOf = (l: Line) => Math.min(650, Math.max(180, lenOf(l) * 1.3))
/** When each line starts after its mark's (ms): the next a little before the last is done, as a hand goes on. */
export function lineStarts(lines: Line[]) {
  let at = 0
  return lines.map((l) => { const s = at; at += durOf(l) * 0.85; return s })
}
const pt = (p: [number, number]): Pt => ({ x: p[0], y: p[1] })

/** A screen mark's ink: its lines and the pen's size (null: it draws none, a card or a sketch). Seeded as drawn. */
export function markInk(p: Placed, seed: number): { lines: Line[]; size?: number } | null {
  const m = p.mark, r = p.box, rnd = seeded(seed)
  if (!r) return null
  switch (m.type) {
    case "ring": return { lines: [ringLine(ringBox(m, r), rnd)] }
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

/** The pen's strokes for marks placed here, each mark starting at `startOf(i)` (wall-clock ms): ink lines as drawn, a
 *  frame round its box, a step's badge tapped. Cards and spotlights have none. */
export function penStrokes(placed: Placed[], seedOf: (i: number) => number, startOf: (i: number) => number): Stroke[] {
  const out: Stroke[] = []
  for (const p of placed) {
    const at = startOf(p.i), ink = markInk(p, seedOf(p.i))
    if (ink) { const starts = lineStarts(ink.lines); ink.lines.forEach((l, j) => out.push({ start: at + starts[j], dur: durOf(l), pts: l })); continue }
    if (p.mark.type === "frame" && p.box) {
      const r = inflate(p.box, 6)
      out.push({ start: at, dur: FRAME_MS, pts: [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y + 2]] })
    } else if (p.mark.type === "num" && p.box) {
      const r = p.box, c = r.w || r.h ? { x: r.x + 1, y: r.y + 1 } : { x: r.x, y: r.y }
      out.push({ start: at, dur: 220, pts: [[c.x - 2, c.y - 2], [c.x, c.y]] })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}
