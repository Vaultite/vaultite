// VP8's loop filter (RFC 6386 15), as libwebp computes it: across an edge at `p[i]` (its first pixel past the edge),
// pixels `step` apart across it; `stride` apart along it. A threshold `t` here is libwebp's, 2 * limit + 1.

const abs = (v: number) => (v < 0 ? -v : v)
const clip8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
const sclip1 = (v: number) => (v < -128 ? -128 : v > 127 ? 127 : v)
const sclip2 = (v: number) => (v < -16 ? -16 : v > 15 ? 15 : v)

function filter2(p: Uint8Array, i: number, step: number) {
  const p1 = p[i - 2 * step], p0 = p[i - step], q0 = p[i], q1 = p[i + step]
  const a = 3 * (q0 - p0) + sclip1(p1 - q1)
  const a1 = sclip2((a + 4) >> 3), a2 = sclip2((a + 3) >> 3)
  p[i - step] = clip8(p0 + a2)
  p[i] = clip8(q0 - a1)
}

function filter4(p: Uint8Array, i: number, step: number) {
  const p1 = p[i - 2 * step], p0 = p[i - step], q0 = p[i], q1 = p[i + step]
  const a = 3 * (q0 - p0)
  const a1 = sclip2((a + 4) >> 3), a2 = sclip2((a + 3) >> 3), a3 = (a1 + 1) >> 1
  p[i - 2 * step] = clip8(p1 + a3)
  p[i - step] = clip8(p0 + a2)
  p[i] = clip8(q0 - a1)
  p[i + step] = clip8(q1 - a3)
}

function filter6(p: Uint8Array, i: number, step: number) {
  const p2 = p[i - 3 * step], p1 = p[i - 2 * step], p0 = p[i - step], q0 = p[i], q1 = p[i + step], q2 = p[i + 2 * step]
  const a = sclip1(3 * (q0 - p0) + sclip1(p1 - q1))
  const a1 = (27 * a + 63) >> 7, a2 = (18 * a + 63) >> 7, a3 = (9 * a + 63) >> 7
  p[i - 3 * step] = clip8(p2 + a3)
  p[i - 2 * step] = clip8(p1 + a2)
  p[i - step] = clip8(p0 + a1)
  p[i] = clip8(q0 - a1)
  p[i + step] = clip8(q1 - a2)
  p[i + 2 * step] = clip8(q2 - a3)
}

const edgeSmall = (p: Uint8Array, i: number, step: number, t: number) => 4 * abs(p[i - step] - p[i]) + abs(p[i - 2 * step] - p[i + step]) <= t

function smooth(p: Uint8Array, i: number, step: number, t: number, it: number) {
  const p3 = p[i - 4 * step], p2 = p[i - 3 * step], p1 = p[i - 2 * step], p0 = p[i - step]
  const q0 = p[i], q1 = p[i + step], q2 = p[i + 2 * step], q3 = p[i + 3 * step]
  if (4 * abs(p0 - q0) + abs(p1 - q1) > t) return false
  return abs(p3 - p2) <= it && abs(p2 - p1) <= it && abs(p1 - p0) <= it && abs(q3 - q2) <= it && abs(q2 - q1) <= it && abs(q1 - q0) <= it
}

const highVariance = (p: Uint8Array, i: number, step: number, t: number) => abs(p[i - 2 * step] - p[i - step]) > t || abs(p[i + step] - p[i]) > t

export function simpleEdge(p: Uint8Array, i: number, step: number, stride: number, n: number, limit: number) {
  const t = 2 * limit + 1
  for (let k = 0; k < n; k++, i += stride) if (edgeSmall(p, i, step, t)) filter2(p, i, step)
}

export function normalEdge(p: Uint8Array, i: number, step: number, stride: number, n: number, limit: number, interior: number, hev: number, mb: boolean) {
  const t = 2 * limit + 1
  for (let k = 0; k < n; k++, i += stride) {
    if (!smooth(p, i, step, t, interior)) continue
    if (highVariance(p, i, step, hev)) filter2(p, i, step)
    else if (mb) filter6(p, i, step)
    else filter4(p, i, step)
  }
}

/** In libwebp's order: the left edge, inner vertical edges, top edge, inner horizontal ones. */
export function filterMacroblock(
  Y: Uint8Array, y: number, ys: number, U: Uint8Array | null, V: Uint8Array | null, uv: number, uvs: number,
  left: boolean, top: boolean, inner: boolean, limit: number, interior: number, hev: number,
) {
  if (!U || !V) {
    if (left) simpleEdge(Y, y, 1, ys, 16, limit + 4)
    if (inner) for (let x = 4; x < 16; x += 4) simpleEdge(Y, y + x, 1, ys, 16, limit)
    if (top) simpleEdge(Y, y, ys, 1, 16, limit + 4)
    if (inner) for (let r = 4; r < 16; r += 4) simpleEdge(Y, y + r * ys, ys, 1, 16, limit)
    return
  }
  if (left) {
    normalEdge(Y, y, 1, ys, 16, limit + 4, interior, hev, true)
    normalEdge(U, uv, 1, uvs, 8, limit + 4, interior, hev, true)
    normalEdge(V, uv, 1, uvs, 8, limit + 4, interior, hev, true)
  }
  if (inner) {
    for (let x = 4; x < 16; x += 4) normalEdge(Y, y + x, 1, ys, 16, limit, interior, hev, false)
    normalEdge(U, uv + 4, 1, uvs, 8, limit, interior, hev, false)
    normalEdge(V, uv + 4, 1, uvs, 8, limit, interior, hev, false)
  }
  if (top) {
    normalEdge(Y, y, ys, 1, 16, limit + 4, interior, hev, true)
    normalEdge(U, uv, uvs, 1, 8, limit + 4, interior, hev, true)
    normalEdge(V, uv, uvs, 1, 8, limit + 4, interior, hev, true)
  }
  if (inner) {
    for (let r = 4; r < 16; r += 4) normalEdge(Y, y + r * ys, ys, 1, 16, limit, interior, hev, false)
    normalEdge(U, uv + 4 * uvs, uvs, 1, 8, limit, interior, hev, false)
    normalEdge(V, uv + 4 * uvs, uvs, 1, 8, limit, interior, hev, false)
  }
}
