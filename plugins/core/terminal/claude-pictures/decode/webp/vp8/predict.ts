// VP8's intra predictions (RFC 6386 12) and inverse transforms (14.3, 14.4), as libwebp computes them: on a work buffer
// of rows BPS apart, a block at `o` with its edge pixels above (`o - BPS`, from `o - BPS - 1`) and left (`o - 1`).

export const BPS = 32

// Modes as libwebp numbers them: a 16x16 or chroma block takes DC, TM, V, H (0..3); a 4x4 subblock any of the ten.
export const DC = 0, TM = 1, V = 2, H = 3
const RD = 4, VR = 5, LD = 6, VL = 7, HD = 8, HU = 9

const clip8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
const avg3 = (a: number, b: number, c: number) => (a + 2 * b + c + 2) >> 2
const avg2 = (a: number, b: number) => (a + b + 1) >> 1

function fill(b: Uint8Array, o: number, size: number, v: number) {
  for (let y = 0; y < size; y++, o += BPS) b.fill(v, o, o + size)
}

function trueMotion(b: Uint8Array, o: number, size: number) {
  const top = o - BPS, corner = b[top - 1]
  for (let y = 0; y < size; y++, o += BPS) {
    const d = b[o - 1] - corner
    for (let x = 0; x < size; x++) b[o + x] = clip8(b[top + x] + d)
  }
}

/** A 16x16 luma or 8x8 chroma block's prediction (`size` 16 or 8): DC uses only the edges the macroblock has. */
export function predictBlock(b: Uint8Array, o: number, size: number, mode: number, hasTop: boolean, hasLeft: boolean) {
  if (mode === DC) {
    const shift = size === 16 ? 4 : 3
    let dc = 0
    if (hasTop) for (let i = 0; i < size; i++) dc += b[o - BPS + i]
    if (hasLeft) for (let i = 0; i < size; i++) dc += b[o - 1 + i * BPS]
    fill(b, o, size, hasTop && hasLeft ? (dc + size) >> (shift + 1) : hasTop || hasLeft ? (dc + (size >> 1)) >> shift : 0x80)
  } else if (mode === TM) trueMotion(b, o, size)
  else if (mode === V) for (let y = 0; y < size; y++) b.copyWithin(o + y * BPS, o - BPS, o - BPS + size)
  else for (let y = 0; y < size; y++) b.fill(b[o + y * BPS - 1], o + y * BPS, o + y * BPS + size)
}

/** A 4x4 subblock's prediction: from the 4 pixels above, the 4 above right, the 4 left and the corner. */
export function predictSubblock(b: Uint8Array, o: number, mode: number) {
  const t = o - BPS
  const X = b[t - 1], A = b[t], B = b[t + 1], C = b[t + 2], D = b[t + 3], E = b[t + 4], F = b[t + 5], G = b[t + 6], Hh = b[t + 7]
  const I = b[o - 1], J = b[o - 1 + BPS], K = b[o - 1 + 2 * BPS], L = b[o - 1 + 3 * BPS]
  const r1 = o + BPS, r2 = o + 2 * BPS, r3 = o + 3 * BPS
  switch (mode) {
    case DC: fill(b, o, 4, (A + B + C + D + I + J + K + L + 4) >> 3); break
    case TM: trueMotion(b, o, 4); break
    case V: {
      const v0 = avg3(X, A, B), v1 = avg3(A, B, C), v2 = avg3(B, C, D), v3 = avg3(C, D, E)
      for (let at = o; at <= r3; at += BPS) { b[at] = v0; b[at + 1] = v1; b[at + 2] = v2; b[at + 3] = v3 }
      break
    }
    case H:
      b.fill(avg3(X, I, J), o, o + 4); b.fill(avg3(I, J, K), r1, r1 + 4); b.fill(avg3(J, K, L), r2, r2 + 4); b.fill(avg3(K, L, L), r3, r3 + 4)
      break
    case RD:
      b[r3] = avg3(J, K, L)
      { const v = avg3(I, J, K); b[r3 + 1] = v; b[r2] = v }
      { const v = avg3(X, I, J); b[r3 + 2] = v; b[r2 + 1] = v; b[r1] = v }
      { const v = avg3(A, X, I); b[r3 + 3] = v; b[r2 + 2] = v; b[r1 + 1] = v; b[o] = v }
      { const v = avg3(B, A, X); b[r2 + 3] = v; b[r1 + 2] = v; b[o + 1] = v }
      { const v = avg3(C, B, A); b[r1 + 3] = v; b[o + 2] = v }
      b[o + 3] = avg3(D, C, B)
      break
    case LD:
      b[o] = avg3(A, B, C)
      { const v = avg3(B, C, D); b[o + 1] = v; b[r1] = v }
      { const v = avg3(C, D, E); b[o + 2] = v; b[r1 + 1] = v; b[r2] = v }
      { const v = avg3(D, E, F); b[o + 3] = v; b[r1 + 2] = v; b[r2 + 1] = v; b[r3] = v }
      { const v = avg3(E, F, G); b[r1 + 3] = v; b[r2 + 2] = v; b[r3 + 1] = v }
      { const v = avg3(F, G, Hh); b[r2 + 3] = v; b[r3 + 2] = v }
      b[r3 + 3] = avg3(G, Hh, Hh)
      break
    case VR:
      { const v = avg2(X, A); b[o] = v; b[r2 + 1] = v }
      { const v = avg2(A, B); b[o + 1] = v; b[r2 + 2] = v }
      { const v = avg2(B, C); b[o + 2] = v; b[r2 + 3] = v }
      b[o + 3] = avg2(C, D)
      b[r3] = avg3(K, J, I)
      b[r2] = avg3(J, I, X)
      { const v = avg3(I, X, A); b[r1] = v; b[r3 + 1] = v }
      { const v = avg3(X, A, B); b[r1 + 1] = v; b[r3 + 2] = v }
      { const v = avg3(A, B, C); b[r1 + 2] = v; b[r3 + 3] = v }
      b[r1 + 3] = avg3(B, C, D)
      break
    case VL:
      b[o] = avg2(A, B)
      { const v = avg2(B, C); b[o + 1] = v; b[r2] = v }
      { const v = avg2(C, D); b[o + 2] = v; b[r2 + 1] = v }
      { const v = avg2(D, E); b[o + 3] = v; b[r2 + 2] = v }
      b[r1] = avg3(A, B, C)
      { const v = avg3(B, C, D); b[r1 + 1] = v; b[r3] = v }
      { const v = avg3(C, D, E); b[r1 + 2] = v; b[r3 + 1] = v }
      { const v = avg3(D, E, F); b[r1 + 3] = v; b[r3 + 2] = v }
      b[r2 + 3] = avg3(E, F, G)
      b[r3 + 3] = avg3(F, G, Hh)
      break
    case HU:
      b[o] = avg2(I, J)
      { const v = avg2(J, K); b[o + 2] = v; b[r1] = v }
      { const v = avg2(K, L); b[r1 + 2] = v; b[r2] = v }
      b[o + 1] = avg3(I, J, K)
      { const v = avg3(J, K, L); b[o + 3] = v; b[r1 + 1] = v }
      { const v = avg3(K, L, L); b[r1 + 3] = v; b[r2 + 1] = v }
      b[r2 + 3] = L; b[r2 + 2] = L; b[r3] = L; b[r3 + 1] = L; b[r3 + 2] = L; b[r3 + 3] = L
      break
    case HD:
      { const v = avg2(I, X); b[o] = v; b[r1 + 2] = v }
      { const v = avg2(J, I); b[r1] = v; b[r2 + 2] = v }
      { const v = avg2(K, J); b[r2] = v; b[r3 + 2] = v }
      b[r3] = avg2(L, K)
      b[o + 3] = avg3(A, B, C)
      b[o + 2] = avg3(X, A, B)
      { const v = avg3(I, X, A); b[o + 1] = v; b[r1 + 3] = v }
      { const v = avg3(J, I, X); b[r1 + 1] = v; b[r2 + 3] = v }
      { const v = avg3(K, J, I); b[r2 + 1] = v; b[r3 + 3] = v }
      b[r3 + 1] = avg3(L, K, J)
      break
  }
}

// (x * sqrt(2) * cos(pi/8) and x * sqrt(2) * sin(pi/8), in 16-bit fixed point)
const mul1 = (a: number) => ((a * 20091) >> 16) + a
const mul2 = (a: number) => (a * 35468) >> 16
const tmp = new Int32Array(16)

/** Adds the inverse DCT of the 16 coefficients at `c[k]` to the 4x4 block at `o`. */
export function inverseDct(c: Int16Array, k: number, b: Uint8Array, o: number) {
  for (let i = 0; i < 4; i++) {
    const i0 = c[k + i], i4 = c[k + 4 + i], i8 = c[k + 8 + i], i12 = c[k + 12 + i]
    const a = i0 + i8, d0 = i0 - i8, cc = mul2(i4) - mul1(i12), d = mul1(i4) + mul2(i12)
    tmp[i * 4] = a + d; tmp[i * 4 + 1] = d0 + cc; tmp[i * 4 + 2] = d0 - cc; tmp[i * 4 + 3] = a - d
  }
  for (let i = 0; i < 4; i++, o += BPS) {
    const dc = tmp[i] + 4
    const a = dc + tmp[8 + i], d0 = dc - tmp[8 + i]
    const cc = mul2(tmp[4 + i]) - mul1(tmp[12 + i]), d = mul1(tmp[4 + i]) + mul2(tmp[12 + i])
    b[o] = clip8(b[o] + ((a + d) >> 3)); b[o + 1] = clip8(b[o + 1] + ((d0 + cc) >> 3))
    b[o + 2] = clip8(b[o + 2] + ((d0 - cc) >> 3)); b[o + 3] = clip8(b[o + 3] + ((a - d) >> 3))
  }
}

/** The same when only the DC coefficient isn't zero. */
export function inverseDc(c: Int16Array, k: number, b: Uint8Array, o: number) {
  const dc = (c[k] + 4) >> 3
  for (let y = 0; y < 4; y++, o += BPS) for (let x = 0; x < 4; x++) b[o + x] = clip8(b[o + x] + dc)
}

/** The inverse Walsh-Hadamard transform of a 16x16 macroblock's second-order coefficients (`dc`): its subblocks' DC
 *  coefficients, written at `out[16 * n]`. */
export function inverseWht(dc: Int16Array, out: Int16Array) {
  for (let i = 0; i < 4; i++) {
    const a0 = dc[i] + dc[12 + i], a1 = dc[4 + i] + dc[8 + i], a2 = dc[4 + i] - dc[8 + i], a3 = dc[i] - dc[12 + i]
    tmp[i] = a0 + a1; tmp[8 + i] = a0 - a1; tmp[4 + i] = a3 + a2; tmp[12 + i] = a3 - a2
  }
  for (let i = 0; i < 4; i++) {
    const dc0 = tmp[i * 4] + 3
    const a0 = dc0 + tmp[i * 4 + 3], a1 = tmp[i * 4 + 1] + tmp[i * 4 + 2], a2 = tmp[i * 4 + 1] - tmp[i * 4 + 2], a3 = dc0 - tmp[i * 4 + 3]
    out[i * 64] = (a0 + a1) >> 3; out[i * 64 + 16] = (a3 + a2) >> 3; out[i * 64 + 32] = (a0 - a1) >> 3; out[i * 64 + 48] = (a3 - a2) >> 3
  }
}
