// Pure: every display's window computes the same motion from the same input.
import { glide, type Glide, stiffness } from "./spring.ts"

export type Pt = { x: number; y: number }
export type Aim = { id: string; x: number; y: number }
export type Stroke = { start: number; dur: number; pts: [number, number][]; ease?: Ease
  dry?: boolean }
export type Ease = readonly [number, number, number, number]
export type PenScript = { id: string; strokes: Stroke[]
  sound?: boolean }
export type Mode = "follow" | "fly" | "pen" | "parked" | "back"
export type Pose = { x: number; y: number; scale: number; mode: Mode; busy: boolean; to: Pt | null
  ink?: boolean }

export const FOLLOW = stiffness(340)
export const DWELL = 900
export const MOVE_ON = 110
export const PEN_LEAD = 520
export const PEN_EASE = [0.35, 0.1, 0.35, 1] as const
export const OPEN_EASE = [0.5, 0, 0.12, 1] as const

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

export const flightMs = (d: number) => Math.round(Math.min(850, Math.max(380, 320 + d / 1.8)))
export function arcControl(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, lift = Math.min(len * 0.2, 80)
  let nx = -dy / len, ny = dx / len
  if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny }
  return { x: (a.x + b.x) / 2 + nx * lift, y: (a.y + b.y) / 2 + ny * lift }
}
export function arcAt(a: Pt, b: Pt, k: number): Pt {
  const c = arcControl(a, b), u = 1 - k
  return { x: u * u * a.x + 2 * u * k * c.x + k * k * b.x, y: u * u * a.y + 2 * u * k * c.y + k * k * b.y }
}
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

export const penLeaves = (script: PenScript, from: Pt, t0: number) => {
  const f = script.strokes[0]
  return Math.max(t0, f.start - flightMs(Math.hypot(f.pts[0][0] - from.x, f.pts[0][1] - from.y)))
}
export function penAt(script: PenScript, t: number, from: Pt, t0: number): { p: Pt; flying: boolean; done: boolean; ink?: boolean } {
  const ss = script.strokes
  const first = ss[0], firstAt = { x: first.pts[0][0], y: first.pts[0][1] }
  if (t < first.start) {
    const leave = penLeaves(script, from, t0)
    if (t < leave) return { p: from, flying: false, done: false }
    const k = clamp01((t - leave) / Math.max(1, first.start - leave))
    return { p: arcAt(from, firstAt, smooth(k)), flying: true, done: false }
  }
  let i = 0
  while (i < ss.length - 1 && t >= end(ss[i]) && t >= ss[i + 1].start) i++
  const s = ss[i]
  if (t < end(s)) {
    const p = alongLine(s.pts, easeOf(s)(clamp01((t - s.start) / s.dur)))
    const prev = ss[i - 1], late = prev && end(prev) > s.start ? end(prev) : 0
    if (late && t - late < 70) {
      const was = alongLine(prev.pts, 1), k = smooth((t - late) / 70)
      return { p: { x: was.x + (p.x - was.x) * k, y: was.y + (p.y - was.y) * k }, flying: false, done: false, ink: !s.dry }
    }
    return { p, flying: false, done: false, ink: !s.dry }
  }
  const last = alongLine(s.pts, 1), next = ss[i + 1]
  if (!next) return { p: last, flying: false, done: true }
  const hop = hopMs(ss, i), leave = next.start - hop
  if (t < leave) return { p: last, flying: false, done: false }
  return { p: arcAt(last, { x: next.pts[0][0], y: next.pts[0][1] }, smooth(clamp01((t - leave) / hop))), flying: true, done: false }
}
function hopMs(ss: Stroke[], i: number) {
  const a = ss[i].pts[ss[i].pts.length - 1], b = ss[i + 1].pts[0], gap = ss[i + 1].start - end(ss[i])
  return Math.max(1, Math.min(Math.max(0, gap), hopFor(Math.hypot(b[0] - a[0], b[1] - a[1]))))
}
export const hopFor = (d: number) => Math.min(420, 140 + d / 2.5)

export function makePilot(o: { reduced?: boolean } = {}) {
  let mode: Mode = "follow", g: Glide | null = null, last = 0
  let pointer: Pt | null = null, home: Pt | null = null
  let flight: Flight | null = null, aim: Aim | null = null, pen: PenScript | null = null
  let penFrom: Pt = { x: 0, y: 0 }, penT0 = 0, penRides = false
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
    pointer(p: Pt, h: Pt, now: number) {
      if (g && home) api.pose(now)
      pointer = p; home = h
      if (!g) { g = { x: h.x, y: h.y, vx: 0, vy: 0 }; last = now }
    },
    aim(a: Aim | null, now: number) {
      if (home) api.pose(now)
      if (!a) { if (aim && (mode === "fly" || mode === "parked")) back(now); aim = null; return }
      if (done.has(a.id) || aim?.id === a.id || mode === "pen") return
      aim = a
      anchor = pointer
      rest = { x: a.x, y: a.y }
      fly(rest, now, "fly")
    },
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
    release(now: number) { if (home) api.pose(now); if (mode !== "follow" && mode !== "back") back(now) },
    pose(now: number): Pose {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      if (!home) return { ...here(), scale: 1, mode, busy: false, to: null }
      if (mode === "pen" && pen) {
        if (penRides && now < penLeaves(pen, here(), now)) {
          if (!o.reduced && g) glide(g, home.x, home.y, FOLLOW, dt)
          penFrom = here(); penT0 = now
          return { ...penFrom, scale: 1, mode: "follow", busy: true, to: null }
        }
        const at = penAt(pen, now, penFrom, penT0)
        g = { x: at.p.x, y: at.p.y, vx: 0, vy: 0 }
        if (at.done) { mode = "parked"; settled = now; rest = at.p }
        const first = pen.strokes[0].pts[0]
        return { ...at.p, scale: at.flying ? 1.06 : 1, mode: at.done ? "parked" : "pen", busy: true, to: at.done ? at.p : { x: first[0], y: first[1] }, ...(at.ink ? { ink: true } : {}) }
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
        if (now - settled >= DWELL && pointer && anchor && dist(pointer, anchor) > MOVE_ON) { back(now); return api.pose(now) }
        if (pointer && !anchor) anchor = pointer
        return { ...p, scale: 1, mode, busy: now - settled < DWELL, to: rest }
      }
      if (o.reduced || !g) g = { x: home.x, y: home.y, vx: 0, vy: 0 }
      const still = glide(g, home.x, home.y, FOLLOW, dt)
      return { x: g.x, y: g.y, scale: 1, mode: "follow", busy: !still, to: null }
    },
    mode: () => mode,
  }
  return api
}
export type Pilot = ReturnType<typeof makePilot>
