// Pure: tools/test/vault/helper.ts tests it alone.
export type Sample = { x: number; y: number; t: number }
export type Piece = { a: [number, number]; b: [number, number]; alpha: number; width: number }

export const TRAIL = { fade: 1700, still: 700, width: 10 }

function spline(p0: Sample, p1: Sample, p2: Sample, p3: Sample, k: number): [number, number] {
  const k2 = k * k, k3 = k2 * k
  const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * k + (2 * a - 5 * b + 4 * c - d) * k2 + (3 * b - a - 3 * c + d) * k3)
  return [f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y)]
}

export const live = (s: Sample[], now: number, fade = TRAIL.fade) => s.filter((p) => now - p.t < fade)

export function trailPieces(s: Sample[], now: number, o: { fade?: number; width?: number; still?: boolean } = {}): Piece[] {
  const fade = o.fade ?? (o.still ? TRAIL.still : TRAIL.fade), width = o.width ?? TRAIL.width, out: Piece[] = []
  const pts = live(s, now, fade)
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    if (len < 0.01) continue
    const n = Math.max(1, Math.min(12, Math.ceil(len / 4)))
    let prev = spline(p0, p1, p2, p3, 0)
    for (let j = 1; j <= n; j++) {
      const k = j / n, next = spline(p0, p1, p2, p3, k), age = now - (p1.t + (p2.t - p1.t) * (k - 0.5 / n))
      const left = o.still ? 1 : Math.max(0, 1 - age / fade), alpha = left * left * (3 - 2 * left)
      if (alpha > 0.01) out.push({ a: prev, b: next, alpha, width: width * (0.55 + 0.45 * left) })
      prev = next
    }
  }
  return out
}
