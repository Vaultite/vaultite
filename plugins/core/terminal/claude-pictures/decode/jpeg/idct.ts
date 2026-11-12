// libjpeg's accurate integer inverse DCT (jidctint.c's jpeg_idct_islow, its default): the same integer steps, so a
// block decodes to the samples libjpeg-turbo's gives (its SIMD versions match its C one).

// (its constants: FIX(x) = round(x * 2^13))
const F0_298 = 2446, F0_390 = 3196, F0_541 = 4433, F0_765 = 6270, F0_899 = 7373, F1_175 = 9633, F1_501 = 12299
const F1_847 = 15137, F1_961 = 16069, F2_053 = 16819, F2_562 = 20995, F3_072 = 25172

/** libjpeg's post-IDCT range limit: a sample from its value about 0 (masked to 10 bits, as libjpeg's is), clamped. */
const RANGE = new Uint8Array(1024)
for (let i = 0; i < 1024; i++) RANGE[i] = Math.max(0, Math.min(255, (i < 512 ? i : i - 1024) + 128))

const ws = new Int32Array(64)

export function idct(c: Int16Array, co: number, q: Int32Array, out: Uint8Array, at: number, stride: number, dcOnly: boolean) {
  if (dcOnly) {
    const v = RANGE[((c[co] * q[0] * 4 + 16) >> 5) & 1023]
    for (let y = 0; y < 8; y++, at += stride) out.fill(v, at, at + 8)
    return
  }
  // (columns: 2 bits of extra precision kept for the rows)
  for (let i = 0; i < 8; i++) {
    const p = co + i
    if (c[p + 8] === 0 && c[p + 16] === 0 && c[p + 24] === 0 && c[p + 32] === 0 && c[p + 40] === 0 && c[p + 48] === 0 && c[p + 56] === 0) {
      const dc = c[p] * q[i] * 4
      ws[i] = ws[i + 8] = ws[i + 16] = ws[i + 24] = ws[i + 32] = ws[i + 40] = ws[i + 48] = ws[i + 56] = dc
      continue
    }
    let z2 = c[p + 16] * q[i + 16], z3 = c[p + 48] * q[i + 48]
    let z1 = (z2 + z3) * F0_541
    let t2 = z1 - z3 * F1_847, t3 = z1 + z2 * F0_765
    z2 = c[p] * q[i]; z3 = c[p + 32] * q[i + 32]
    let t0 = (z2 + z3) * 8192, t1 = (z2 - z3) * 8192
    const t10 = t0 + t3, t13 = t0 - t3, t11 = t1 + t2, t12 = t1 - t2
    t0 = c[p + 56] * q[i + 56]; t1 = c[p + 40] * q[i + 40]; t2 = c[p + 24] * q[i + 24]; t3 = c[p + 8] * q[i + 8]
    z1 = t0 + t3; z2 = t1 + t2; z3 = t0 + t2
    let z4 = t1 + t3
    const z5 = (z3 + z4) * F1_175
    t0 *= F0_298; t1 *= F2_053; t2 *= F3_072; t3 *= F1_501
    z1 *= -F0_899; z2 *= -F2_562; z3 = z3 * -F1_961 + z5; z4 = z4 * -F0_390 + z5
    t0 += z1 + z3; t1 += z2 + z4; t2 += z2 + z3; t3 += z1 + z4
    ws[i] = (t10 + t3 + 1024) >> 11
    ws[i + 56] = (t10 - t3 + 1024) >> 11
    ws[i + 8] = (t11 + t2 + 1024) >> 11
    ws[i + 48] = (t11 - t2 + 1024) >> 11
    ws[i + 16] = (t12 + t1 + 1024) >> 11
    ws[i + 40] = (t12 - t1 + 1024) >> 11
    ws[i + 24] = (t13 + t0 + 1024) >> 11
    ws[i + 32] = (t13 - t0 + 1024) >> 11
  }
  // (rows: descaled by the 2 bits and the transform's 3, plus its 13 of fixed point)
  for (let i = 0; i < 64; i += 8, at += stride) {
    if (ws[i + 1] === 0 && ws[i + 2] === 0 && ws[i + 3] === 0 && ws[i + 4] === 0 && ws[i + 5] === 0 && ws[i + 6] === 0 && ws[i + 7] === 0) {
      out.fill(RANGE[((ws[i] + 16) >> 5) & 1023], at, at + 8)
      continue
    }
    let z2 = ws[i + 2], z3 = ws[i + 6]
    let z1 = (z2 + z3) * F0_541
    let t2 = z1 - z3 * F1_847, t3 = z1 + z2 * F0_765
    let t0 = (ws[i] + ws[i + 4]) * 8192, t1 = (ws[i] - ws[i + 4]) * 8192
    const t10 = t0 + t3, t13 = t0 - t3, t11 = t1 + t2, t12 = t1 - t2
    t0 = ws[i + 7]; t1 = ws[i + 5]; t2 = ws[i + 3]; t3 = ws[i + 1]
    z1 = t0 + t3; z2 = t1 + t2; z3 = t0 + t2
    let z4 = t1 + t3
    const z5 = (z3 + z4) * F1_175
    t0 *= F0_298; t1 *= F2_053; t2 *= F3_072; t3 *= F1_501
    z1 *= -F0_899; z2 *= -F2_562; z3 = z3 * -F1_961 + z5; z4 = z4 * -F0_390 + z5
    t0 += z1 + z3; t1 += z2 + z4; t2 += z2 + z3; t3 += z1 + z4
    out[at] = RANGE[((t10 + t3 + 131072) >> 18) & 1023]
    out[at + 7] = RANGE[((t10 - t3 + 131072) >> 18) & 1023]
    out[at + 1] = RANGE[((t11 + t2 + 131072) >> 18) & 1023]
    out[at + 6] = RANGE[((t11 - t2 + 131072) >> 18) & 1023]
    out[at + 2] = RANGE[((t12 + t1 + 131072) >> 18) & 1023]
    out[at + 5] = RANGE[((t12 - t1 + 131072) >> 18) & 1023]
    out[at + 3] = RANGE[((t13 + t0 + 131072) >> 18) & 1023]
    out[at + 4] = RANGE[((t13 - t0 + 131072) >> 18) & 1023]
  }
}
