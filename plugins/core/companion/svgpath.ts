// SVG path data (a `d` string) read without a DOM, for the server and the overlay alike: checked as path data only (no
// markup can ride in it), and flattened into lines (a kept drawing's Excalidraw lines, a shape's bounds).

export type Sub = { pts: [number, number][]; closed: boolean }
type Cmd = { c: string; a: number[] }

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }
const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i

/** `d` as commands, or an Error saying where it stops being path data. */
export function parsePath(d: string): Cmd[] {
  const out: Cmd[] = []
  let i = 0, cur: string | null = null
  const skip = () => { while (i < d.length && /[\s,]/.test(d[i])) i++ }
  const number = () => {
    skip()
    const m = NUM.exec(d.slice(i, i + 40))
    if (!m) throw new Error(`d: not path data at "${d.slice(i, i + 12)}" (M, L, H, V, C, S, Q, T, A, Z and numbers only)`)
    i += m[0].length
    return Number(m[0])
  }
  // (an arc's flags may run together with what follows: "a5 5 0 011 1")
  const flag = () => { skip(); const f = d[i]; if (f !== "0" && f !== "1") throw new Error("d: an arc's flags are 0 or 1"); i++; return Number(f) }
  for (skip(); i < d.length; skip()) {
    const ch = d[i]
    if (/[a-z]/i.test(ch)) {
      if (!(ch.toLowerCase() in ARGS)) throw new Error(`d: "${ch}" isn't a path command (M, L, H, V, C, S, Q, T, A, Z)`)
      cur = ch; i++
      if (ch.toLowerCase() === "z") { out.push({ c: ch, a: [] }); cur = null }
      continue
    }
    if (!cur) throw new Error(out.length ? "d: numbers after Z need a command first" : "d: starts with M (a move to)")
    const k = cur.toLowerCase(), a = k === "a" ? [number(), number(), number(), flag(), flag(), number(), number()] : Array.from({ length: ARGS[k] }, number)
    out.push({ c: cur, a })
    // (more pairs after a move are lines)
    if (k === "m") cur = cur === "m" ? "l" : "L"
  }
  if (!out.length || out[0].c.toLowerCase() !== "m") throw new Error("d: starts with M (a move to)")
  return out
}

/** `d` as lines: each subpath its points (curves sampled), and whether it closes. */
export function flatten(d: string | Cmd[]): Sub[] {
  const cmds = typeof d === "string" ? parsePath(d) : d, subs: Sub[] = []
  let x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, prev = "", sub: Sub | null = null
  const to = (px: number, py: number) => { if (!sub) { sub = { pts: [[x, y]], closed: false }; subs.push(sub) } sub.pts.push([px, py]); x = px; y = py }
  const cubic = (x1: number, y1: number, x2: number, y2: number, ex: number, ey: number) => {
    const x0 = x, y0 = y, n = Math.max(6, Math.min(24, Math.ceil((Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(ex - x2, ey - y2)) / 8)))
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t
      to(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey)
    }
  }
  for (const { c, a } of cmds) {
    const rel = c === c.toLowerCase(), k = c.toLowerCase(), ox = rel ? x : 0, oy = rel ? y : 0
    if (k === "m") { sub = { pts: [[ox + a[0], oy + a[1]]], closed: false }; subs.push(sub); x = sx = ox + a[0]; y = sy = oy + a[1] }
    else if (k === "l") to(ox + a[0], oy + a[1])
    else if (k === "h") to(ox + a[0], y)
    else if (k === "v") to(x, oy + a[0])
    else if (k === "c") { cubic(ox + a[0], oy + a[1], ox + a[2], oy + a[3], ox + a[4], oy + a[5]); cx = ox + a[2]; cy = oy + a[3] }
    else if (k === "s") {
      const [x1, y1] = prev === "c" || prev === "s" ? [2 * x - cx, 2 * y - cy] : [x, y]
      cubic(x1, y1, ox + a[0], oy + a[1], ox + a[2], oy + a[3]); cx = ox + a[0]; cy = oy + a[1]
    } else if (k === "q" || k === "t") {
      const [qx, qy] = k === "q" ? [ox + a[0], oy + a[1]] : prev === "q" || prev === "t" ? [2 * x - cx, 2 * y - cy] : [x, y]
      const [ex, ey] = k === "q" ? [ox + a[2], oy + a[3]] : [ox + a[0], oy + a[1]]
      cubic(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey); cx = qx; cy = qy
    } else if (k === "a") arc(a[0], a[1], a[2], a[3], a[4], ox + a[5], oy + a[6])
    else if (k === "z") { if (sub) { to(sx, sy); sub.closed = true; sub = null } x = sx; y = sy }
    prev = k
  }
  return subs.filter((s) => s.pts.length > 1)

  // (an endpoint arc as its centre's: SVG's implementation notes, F.6.5)
  function arc(rx: number, ry: number, rot: number, large: number, sweep: number, ex: number, ey: number) {
    rx = Math.abs(rx); ry = Math.abs(ry)
    if (!rx || !ry || (x === ex && y === ey)) return to(ex, ey)
    const phi = (rot * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi)
    const dx = (x - ex) / 2, dy = (y - ey) / 2, x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy
    const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam) }
    const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, den = rx * rx * y1 * y1 + ry * ry * x1 * x1
    const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den)), ccx = (co * rx * y1) / ry, ccy = (-co * ry * x1) / rx
    const mx = cos * ccx - sin * ccy + (x + ex) / 2, my = sin * ccx + cos * ccy + (y + ey) / 2
    const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    const t0 = ang(1, 0, (x1 - ccx) / rx, (y1 - ccy) / ry)
    let dt = ang((x1 - ccx) / rx, (y1 - ccy) / ry, (-x1 - ccx) / rx, (-y1 - ccy) / ry)
    if (!sweep && dt > 0) dt -= 2 * Math.PI
    else if (sweep && dt < 0) dt += 2 * Math.PI
    const n = Math.max(6, Math.ceil(Math.abs(dt) / (Math.PI / 12)))
    for (let k = 1; k <= n; k++) {
      const t = t0 + (dt * k) / n
      to(mx + cos * rx * Math.cos(t) - sin * ry * Math.sin(t), my + sin * rx * Math.cos(t) + cos * ry * Math.sin(t))
    }
    x = ex; y = ey
  }
}

/** The box round lines (x, y, w, h), or null for none. */
export function boundsOf(subs: Sub[]): [number, number, number, number] | null {
  const xs = subs.flatMap((s) => s.pts.map((p) => p[0])), ys = subs.flatMap((s) => s.pts.map((p) => p[1]))
  if (!xs.length) return null
  const x = Math.min(...xs), y = Math.min(...ys)
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y]
}
