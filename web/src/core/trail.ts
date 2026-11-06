// The trail the pointer leaves while the companion's Talk key is held (web/src/screen.tsx): a thick stroke in its colour,
// smooth through the pointer's samples, its newest part solid and older parts fading. Pure (tools/test/vault/helper.ts).

export type Sample = { x: number; y: number; t: number }
/** A piece of the trail to stroke: from `a` to `b`, at `alpha`, `width` wide. */
export type Piece = { a: [number, number]; b: [number, number]; alpha: number; width: number }

/** How long a part of it lasts (ms), and how wide its newest part is (points). */
export const TRAIL = { fade: 1600, width: 7 }

/** A Catmull-Rom point between p1 and p2 (`k` 0..1), p0 and p3 their neighbours: a smooth curve through every sample. */
function spline(p0: Sample, p1: Sample, p2: Sample, p3: Sample, k: number): [number, number] {
  const k2 = k * k, k3 = k2 * k
  const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * k + (2 * a - 5 * b + 4 * c - d) * k2 + (3 * b - a - 3 * c + d) * k3)
  return [f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y)]
}

/** The samples still showing at `now` (older ones go). */
export const live = (s: Sample[], now: number, fade = TRAIL.fade) => s.filter((p) => now - p.t < fade)

/** The trail at `now` as short pieces along a smooth curve, each as faded as it is old: solid where the pointer is, gone
 *  after `fade` ms, thinning a little as it fades. `still`: reduced motion, no fading (it's cut, not faded). */
export function trailPieces(s: Sample[], now: number, o: { fade?: number; width?: number; still?: boolean } = {}): Piece[] {
  const fade = o.fade ?? TRAIL.fade, width = o.width ?? TRAIL.width, out: Piece[] = []
  const pts = live(s, now, fade)
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    if (len < 0.01) continue
    // (a piece every few points of the way: smooth on a curve, few on a straight run)
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
