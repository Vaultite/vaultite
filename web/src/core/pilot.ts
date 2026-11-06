// The summoned companion's motion in an exchange (web/src/screen.tsx): beside the pointer on a spring, an arc to what it
// points at, its marks traced as their pen, back once they move on. Pure: every display's window agrees on it.
import { glide, type Glide, stiffness } from "./spring.ts"

export type Pt = { x: number; y: number }
/** What it points at: its tip goes there; a new `id` is a new one. */
export type Aim = { id: string; x: number; y: number }
/** A stroke of a mark as its ink reveals it: from `start` (wall-clock ms) for `dur` ms, eased as the reveal is (`ease`:
 *  another curve than the ink's, as a frame's box opens). */
export type Stroke = { start: number; dur: number; pts: [number, number][]; ease?: Ease }
export type Ease = readonly [number, number, number, number]
/** A drawing's strokes in the order they're drawn (`id`: the drawing's). */
export type PenScript = { id: string; strokes: Stroke[] }
export type Mode = "follow" | "fly" | "pen" | "parked" | "back"
/** Where it is at a moment: `scale` swells a little mid-flight; `busy`: it needs frames (else the loop may sleep till
 *  the next input). `to`: where it's headed or rests (null: with the pointer). */
export type Pose = { x: number; y: number; scale: number; mode: Mode; busy: boolean; to: Pt | null }

/** Beside the pointer: it trails it, visibly following (about a third of a second to catch up), never sluggish. */
export const FOLLOW = stiffness(340)
/** Pointing: shown this long once it's there before moving on can take it back. */
export const DWELL = 900
/** Moving on: the pointer this far from where it was when the pointing began. */
export const MOVE_ON = 110
/** A pen's lead: how long before its first stroke a drawing waits for it to fly there. */
export const PEN_LEAD = 520
/** The ink's reveal (web/src/screendraw/index.tsx .sd-pen): the pen keeps to its front. */
export const PEN_EASE = [0.35, 0.1, 0.35, 1] as const
/** A frame's box opening (web/src/screendraw/index.tsx .sd-focus), the pen at its far corner: quick out, a long settle. */
export const OPEN_EASE = [0.5, 0, 0.12, 1] as const

/** A CSS cubic-bezier easing, solved for x (Newton, then bisection). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t, sy = (t: number) => ((ay * t + by) * t + cy) * t, dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 6; i++) { const e = sx(t) - x, d = dx(t); if (Math.abs(e) < 1e-5) return sy(t); if (Math.abs(d) < 1e-6) break; t -= e / d }
    let lo = 0, hi = 1
    t = x
    for (let i = 0; i < 30; i++) { const v = sx(t); if (Math.abs(v - x) < 1e-5) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2 }
    return sy(t)
  }
}
const penEase = cubicBezier(...PEN_EASE), eases = new Map<Ease, (x: number) => number>()
const easeOf = (s: Stroke) => { if (!s.ease) return penEase; let f = eases.get(s.ease); if (!f) eases.set(s.ease, f = cubicBezier(...s.ease)); return f }
const smooth = (k: number) => k * k * (3 - 2 * k)
const clamp01 = (k: number) => Math.max(0, Math.min(1, k))
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

/** How long a flight of `d` px takes (ms): short hops quick, long ones a little longer. */
export const flightMs = (d: number) => Math.round(Math.min(850, Math.max(380, 320 + d / 1.8)))
/** The arc's bend: a quadratic curve's control point, lifted to the upper side of the way by a fifth of it (80 px at most). */
export function arcControl(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, lift = Math.min(len * 0.2, 80)
  let nx = -dy / len, ny = dx / len
  if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny }
  return { x: (a.x + b.x) / 2 + nx * lift, y: (a.y + b.y) / 2 + ny * lift }
}
/** A point `k` (0..1) along the arc from `a` to `b`. */
export function arcAt(a: Pt, b: Pt, k: number): Pt {
  const c = arcControl(a, b), u = 1 - k
  return { x: u * u * a.x + 2 * u * k * c.x + k * k * b.x, y: u * u * a.y + 2 * u * k * c.y + k * k * b.y }
}
/** The point `k` (0..1) of the way along a polyline, by its length. */
export function alongLine(pts: [number, number][], k: number): Pt {
  if (pts.length === 1 || k <= 0) return { x: pts[0][0], y: pts[0][1] }
  const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])), total = lens.reduce((s, l) => s + l, 0)
  let left = Math.min(1, k) * total
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] || i === lens.length - 1) { const f = lens[i] ? Math.min(1, left / lens[i]) : 1; return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f } }
    left -= lens[i]
  }
  const e = pts[pts.length - 1]
  return { x: e[0], y: e[1] }
}

type Flight = { from: Pt; to: Pt | null; t0: number; dur: number }
const end = (s: Stroke) => s.start + s.dur

/** When it leaves `from` for the first stroke: a flight's time before it starts (never a slow drift over a long wait). */
export const penLeaves = (script: PenScript, from: Pt, t0: number) => {
  const f = script.strokes[0]
  return Math.max(t0, f.start - flightMs(Math.hypot(f.pts[0][0] - from.x, f.pts[0][1] - from.y)))
}
/** The pen's tip at `t` along `script`: on the stroke being drawn (the earliest one not done), hopping between strokes
 *  just in time for the next; before the first, at `from` (where it was at `t0`), then flying there. Null: done. */
export function penAt(script: PenScript, t: number, from: Pt, t0: number): { p: Pt; flying: boolean; done: boolean } {
  const ss = script.strokes
  const first = ss[0], firstAt = { x: first.pts[0][0], y: first.pts[0][1] }
  if (t < first.start) {
    const leave = penLeaves(script, from, t0)
    if (t < leave) return { p: from, flying: false, done: false }
    const k = clamp01((t - leave) / Math.max(1, first.start - leave))
    return { p: arcAt(from, firstAt, smooth(k)), flying: true, done: false }
  }
  // (the stroke whose turn it is: started, and every one before it done)
  let i = 0
  while (i < ss.length - 1 && t >= end(ss[i]) && t >= ss[i + 1].start) i++
  const s = ss[i]
  if (t < end(s)) {
    const p = alongLine(s.pts, easeOf(s)(clamp01((t - s.start) / s.dur)))
    // (it came onto this one late, its front ahead: a moment to catch up rather than a jump)
    const prev = ss[i - 1], late = prev && end(prev) > s.start ? end(prev) : 0
    if (late && t - late < 70) {
      const was = alongLine(prev.pts, 1), k = smooth((t - late) / 70)
      return { p: { x: was.x + (p.x - was.x) * k, y: was.y + (p.y - was.y) * k }, flying: false, done: false }
    }
    return { p, flying: false, done: false }
  }
  const last = alongLine(s.pts, 1), next = ss[i + 1]
  if (!next) return { p: last, flying: false, done: true }
  // (between strokes: it waits at the last one's end, then hops so it's at the next one's start as it begins)
  const hop = hopMs(ss, i), leave = next.start - hop
  if (t < leave) return { p: last, flying: false, done: false }
  return { p: arcAt(last, { x: next.pts[0][0], y: next.pts[0][1] }, smooth(clamp01((t - leave) / hop))), flying: true, done: false }
}
/** How long the hop from stroke `i`'s end to the next one's start takes: the gap, up to a short flight's time. */
function hopMs(ss: Stroke[], i: number) {
  const a = ss[i].pts[ss[i].pts.length - 1], b = ss[i + 1].pts[0], gap = ss[i + 1].start - end(ss[i])
  return Math.max(1, Math.min(Math.max(0, gap), Math.min(420, 140 + Math.hypot(b[0] - a[0], b[1] - a[1]) / 2.5)))
}

/** The companion's motion in one exchange. Inputs: the pointer (and its home beside it), what it points at, its pen;
 *  `pose(now)` says where it is. `reduced`: no motion, each place at once. */
export function makePilot(o: { reduced?: boolean } = {}) {
  let mode: Mode = "follow", g: Glide | null = null, last = 0
  let pointer: Pt | null = null, home: Pt | null = null
  let flight: Flight | null = null, aim: Aim | null = null, pen: PenScript | null = null
  /** Where its pen leaves from and when it got its strokes; `penRides`: it rides with the pointer till it must leave. */
  let penFrom: Pt = { x: 0, y: 0 }, penT0 = 0, penRides = false
  /** Where the pointer was when the pointing began, and since when it's been shown there. */
  let anchor: Pt | null = null, settled = 0, rest: Pt | null = null
  const done = new Set<string>()
  const here = (): Pt => (g ? { x: g.x, y: g.y } : home ?? { x: 0, y: 0 })

  function fly(to: Pt | null, now: number, m: Mode) {
    const from = here(), d = dist(from, to ?? home ?? from)
    flight = { from, to, t0: now, dur: o.reduced ? 0 : flightMs(d) }
    mode = m
  }
  function back(now: number) {
    if (aim) done.add(aim.id)
    if (pen) done.add(pen.id)
    aim = null; pen = null; anchor = null; rest = null
    fly(null, now, "back")
  }

  const api = {
    /** The pointer and its home (where the companion rides, beside it), in this window's points. */
    pointer(p: Pt, h: Pt, now: number) {
      // (up to now on the old home first: every window then agrees, whatever its frame rate)
      if (g && home) api.pose(now)
      pointer = p; home = h
      if (!g) { g = { x: h.x, y: h.y, vx: 0, vy: 0 }; last = now }
    },
    /** What it points at now (null: nothing): a new one, it flies there. */
    aim(a: Aim | null, now: number) {
      if (home) api.pose(now)
      if (!a) { if (aim && (mode === "fly" || mode === "parked")) back(now); aim = null; return }
      // (one already shown and left, the same one, or its pen at work first: nothing new)
      if (done.has(a.id) || aim?.id === a.id || mode === "pen") return
      aim = a
      anchor = pointer
      rest = { x: a.x, y: a.y }
      fly(rest, now, "fly")
    },
    /** A drawing's strokes (null: it's gone): it flies to the first as it begins and draws each. */
    pen(s: PenScript | null, now: number) {
      if (home) api.pose(now)
      if (!s || !s.strokes.length) { if (pen && (mode === "pen" || mode === "parked")) back(now); pen = null; return }
      if (done.has(s.id)) return
      const same = pen?.id === s.id
      pen = s
      if (o.reduced) { const e = alongLine(s.strokes.at(-1)!.pts, 1); rest = e; flight = null; g = { x: e.x, y: e.y, vx: 0, vy: 0 }; mode = "parked"; settled = now; anchor = pointer; return }
      if (!same || mode !== "pen") { penFrom = here(); penT0 = now; anchor = pointer; penRides = mode === "follow" || mode === "back" }
      flight = null
      mode = "pen"
    },
    /** Back beside the pointer now (the Talk key held again). */
    release(now: number) { if (home) api.pose(now); if (mode !== "follow" && mode !== "back") back(now) },
    pose(now: number): Pose {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      if (!home) return { ...here(), scale: 1, mode, busy: false, to: null }
      if (mode === "pen" && pen) {
        // (its first stroke a while off, its words not said yet: beside the pointer (or where it was) till it must go)
        if (penRides && now < penLeaves(pen, here(), now)) {
          if (!o.reduced && g) glide(g, home.x, home.y, FOLLOW, dt)
          penFrom = here(); penT0 = now
          return { ...penFrom, scale: 1, mode: "follow", busy: true, to: null }
        }
        const at = penAt(pen, now, penFrom, penT0)
        g = { x: at.p.x, y: at.p.y, vx: 0, vy: 0 }
        if (at.done) { mode = "parked"; settled = now; rest = at.p }
        // (where it draws: its first stroke, so what goes with it doesn't chase the pen)
        const first = pen.strokes[0].pts[0]
        return { ...at.p, scale: at.flying ? 1.06 : 1, mode: at.done ? "parked" : "pen", busy: true, to: at.done ? at.p : { x: first[0], y: first[1] } }
      }
      if (flight && (mode === "fly" || mode === "back")) {
        const to = flight.to ?? home, k = flight.dur ? clamp01((now - flight.t0) / flight.dur) : 1, e = smooth(k), p = arcAt(flight.from, to, e)
        g = { x: p.x, y: p.y, vx: 0, vy: 0 }
        if (k >= 1) {
          flight = null
          if (mode === "back") mode = "follow"
          else { mode = "parked"; settled = now }
        }
        return { ...p, scale: 1 + 0.12 * Math.sin(Math.PI * k), mode, busy: true, to: flight ? flight.to : mode === "parked" ? rest : null }
      }
      if (mode === "parked") {
        const p = here()
        // (shown a moment, then moving on takes it back to the pointer)
        if (now - settled >= DWELL && pointer && anchor && dist(pointer, anchor) > MOVE_ON) { back(now); return api.pose(now) }
        if (pointer && !anchor) anchor = pointer
        return { ...p, scale: 1, mode, busy: now - settled < DWELL, to: rest }
      }
      // (following: a spring to its home, exactly there when reduced)
      if (o.reduced || !g) g = { x: home.x, y: home.y, vx: 0, vy: 0 }
      const still = glide(g, home.x, home.y, FOLLOW, dt)
      return { x: g.x, y: g.y, scale: 1, mode: "follow", busy: !still, to: null }
    },
    mode: () => mode,
  }
  return api
}
export type Pilot = ReturnType<typeof makePilot>
