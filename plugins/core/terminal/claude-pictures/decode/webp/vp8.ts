// A VP8 key frame (RFC 6386) to YUV planes, bit for bit as libwebp, so pictures match what Claude was shown. The frame
// is loop-filtered only once whole, as prediction reads unfiltered pixels.
import { type Limits, need, sized } from "../pixels.ts"
import { BoolDecoder } from "./vp8/bool.ts"
import { filterMacroblock } from "./vp8/filter.ts"
import { BPS, DC, H, inverseDc, inverseDct, inverseWht, predictBlock, predictSubblock, TM, V } from "./vp8/predict.ts"
import { AC_TABLE, BANDS, BMODE_PROBS, CAT_PROBS, COEFF_PROBS, COEFF_UPDATE_PROBS, DC_TABLE, ZIGZAG } from "./vp8/tables.ts"
import type { Yuv } from "./vp8/yuv.ts"

export function vp8Size(b: Uint8Array): { width: number; height: number } {
  need(b.length >= 10, "VP8 frame cut short")
  const bits = b[0] | (b[1] << 8) | (b[2] << 16)
  need(!(bits & 1), "not a VP8 key frame")
  need(((bits >> 1) & 7) <= 3, "unknown VP8 profile")
  need((bits >> 4) & 1, "VP8 frame not shown")
  need(b[3] === 0x9d && b[4] === 0x01 && b[5] === 0x2a, "no VP8 start code")
  // (the top 2 bits of each are an upscaling hint, not applied: libwebp doesn't either)
  return { width: (b[6] | (b[7] << 8)) & 0x3fff, height: (b[8] | (b[9] << 8)) & 0x3fff }
}

type Quant = { y1: [number, number]; y2: [number, number]; uv: [number, number] }
type Strength = { limit: number; interior: number; hev: number }

/** RFC 6386 9.2-9.11. */
type Header = {
  segmentMap: boolean
  segmentProbs: Uint8Array
  quants: Quant[]
  filterType: number
  strengths: Strength[]
  probs: Uint8Array
  skipProb: number
  partitions: BoolDecoder[]
}

// The work buffer's layout (libwebp's): luma below a row of edge pixels, chroma U and V side by side below it.
const Y_OFF = BPS + 8, U_OFF = Y_OFF + 16 * BPS + BPS, V_OFF = U_OFF + 16
const SCAN = Int32Array.from({ length: 16 }, (_, n) => (n & 3) * 4 + (n >> 2) * 4 * BPS)

export function decodeVp8(b: Uint8Array, limits: Limits): Yuv {
  const { width, height } = vp8Size(b)
  sized(width, height, limits)
  const firstSize = (b[0] | (b[1] << 8) | (b[2] << 16)) >>> 5
  need(10 + firstSize <= b.length, "VP8 first partition cut short")
  const br = new BoolDecoder(b, 10, 10 + firstSize)
  const h = readHeader(b, br, 10 + firstSize)
  const mbW = (width + 15) >> 4, mbH = (height + 15) >> 4
  const yStride = mbW * 16, uvStride = mbW * 8
  const Y = new Uint8Array(yStride * mbH * 16), U = new Uint8Array(uvStride * mbH * 8), Vp = new Uint8Array(uvStride * mbH * 8)
  const strength = new Uint8Array(mbW * mbH), inner = new Uint8Array(mbW * mbH)
  const ctx: Context = { modesAbove: new Uint8Array(4 * mbW), modesLeft: new Uint8Array(4), nzAbove: new Uint8Array(mbW), nzDcAbove: new Uint8Array(mbW), nzLeft: 0, nzDcLeft: 0 }
  const mb: Macroblock = { segment: 0, skip: false, i4: false, modes: new Uint8Array(16), uvMode: 0, nzY: 0, nzUv: 0 }
  const coeffs = new Int16Array(384), dc = new Int16Array(16), work = new Uint8Array(BPS * 26)

  for (let mbY = 0; mbY < mbH; mbY++) {
    const tokens = h.partitions[mbY & (h.partitions.length - 1)]
    ctx.modesLeft.fill(DC)
    ctx.nzLeft = ctx.nzDcLeft = 0
    for (let mbX = 0; mbX < mbW; mbX++) {
      readMacroblock(br, h, ctx, mbX, mb)
      readResiduals(tokens, h.probs, h.quants[mb.segment], ctx, mbX, mb, coeffs, dc)
      need(!tokens.eof && !br.eof, "VP8 frame cut short")
      const at = mbY * mbW + mbX
      strength[at] = 2 * mb.segment + (mb.i4 ? 1 : 0)
      // (as libwebp: a macroblock with coefficients only in its second-order block that come to none counts as without)
      inner[at] = mb.i4 || mb.nzY || mb.nzUv ? 1 : 0
      edges(work, Y, U, Vp, yStride, uvStride, mbX, mbY, mbW)
      reconstruct(work, mb, coeffs, mbX > 0, mbY > 0)
      for (let j = 0; j < 16; j++) Y.set(work.subarray(Y_OFF + j * BPS, Y_OFF + j * BPS + 16), (mbY * 16 + j) * yStride + mbX * 16)
      for (let j = 0; j < 8; j++) {
        U.set(work.subarray(U_OFF + j * BPS, U_OFF + j * BPS + 8), (mbY * 8 + j) * uvStride + mbX * 8)
        Vp.set(work.subarray(V_OFF + j * BPS, V_OFF + j * BPS + 8), (mbY * 8 + j) * uvStride + mbX * 8)
      }
    }
  }

  if (h.filterType) {
    const normal = h.filterType === 2
    for (let mbY = 0; mbY < mbH; mbY++) for (let mbX = 0; mbX < mbW; mbX++) {
      const at = mbY * mbW + mbX, s = h.strengths[strength[at]]
      if (!s.limit) continue
      filterMacroblock(Y, mbY * 16 * yStride + mbX * 16, yStride, normal ? U : null, normal ? Vp : null, mbY * 8 * uvStride + mbX * 8, uvStride,
        mbX > 0, mbY > 0, !!inner[at], s.limit, s.interior, s.hev)
    }
  }
  return { width, height, y: Y, u: U, v: Vp, yStride, uvStride }
}

function readHeader(b: Uint8Array, br: BoolDecoder, at: number): Header {
  br.bit(0x80) // (colour space: no other is defined)
  br.bit(0x80) // (clamping type: libwebp always clamps)
  // Segments (9.3): their quantizer and filter level absolute, or deltas (libwebp's default absolute, for a header
  // with segments but no values: all 0)
  const useSegments = !!br.bit(0x80)
  let segmentMap = false, absolute = true
  const segQuant = [0, 0, 0, 0], segLevel = [0, 0, 0, 0], segmentProbs = new Uint8Array([255, 255, 255])
  if (useSegments) {
    segmentMap = !!br.bit(0x80)
    if (br.bit(0x80)) {
      absolute = !!br.bit(0x80)
      for (let s = 0; s < 4; s++) segQuant[s] = br.maybeSigned(7)
      for (let s = 0; s < 4; s++) segLevel[s] = br.maybeSigned(6)
    }
    if (segmentMap) for (let s = 0; s < 3; s++) segmentProbs[s] = br.bit(0x80) ? br.literal(8) : 255
  }
  // Loop filter (9.4): a key frame's macroblocks use only the intra frame's delta, and subblock ones B_PRED's
  const simple = br.bit(0x80), level = br.literal(6), sharpness = br.literal(3)
  let refDelta = 0, modeDelta = 0
  const useDeltas = !!br.bit(0x80)
  if (useDeltas && br.bit(0x80)) {
    for (let i = 0; i < 4; i++) if (br.bit(0x80)) { const d = br.signed(6); if (i === 0) refDelta = d }
    for (let i = 0; i < 4; i++) if (br.bit(0x80)) { const d = br.signed(6); if (i === 0) modeDelta = d }
  }
  // Token partitions (9.5): each but the last sized in 3 bytes before them; one past the data is cut to it
  const count = 1 << br.literal(2), sizes = at
  need(at + 3 * (count - 1) <= b.length, "VP8 partition sizes cut short")
  at += 3 * (count - 1)
  const partitions: BoolDecoder[] = []
  for (let p = 0; p < count - 1; p++) {
    const size = Math.min(b[sizes + 3 * p] | (b[sizes + 3 * p + 1] << 8) | (b[sizes + 3 * p + 2] << 16), b.length - at)
    partitions.push(new BoolDecoder(b, at, at + size))
    at += size
  }
  need(at < b.length, "VP8 partitions cut short")
  partitions.push(new BoolDecoder(b, at, b.length))
  const baseQ = br.literal(7)
  const dY1Dc = br.maybeSigned(4), dY2Dc = br.maybeSigned(4), dY2Ac = br.maybeSigned(4), dUvDc = br.maybeSigned(4), dUvAc = br.maybeSigned(4)
  const quants: Quant[] = [], strengths: Strength[] = []
  for (let s = 0; s < 4; s++) {
    const q = useSegments ? segQuant[s] + (absolute ? 0 : baseQ) : baseQ
    quants.push({
      y1: [DC_TABLE[clip(q + dY1Dc, 127)], AC_TABLE[clip(q, 127)]],
      // (x * 155 / 100, as libwebp computes it)
      y2: [DC_TABLE[clip(q + dY2Dc, 127)] * 2, Math.max(8, (AC_TABLE[clip(q + dY2Ac, 127)] * 101581) >> 16)],
      uv: [DC_TABLE[clip(q + dUvDc, 117)], AC_TABLE[clip(q + dUvAc, 127)]],
    })
    // (15.1's thresholds, from the segment's level and the sharpness)
    const base = useSegments ? segLevel[s] + (absolute ? 0 : level) : level
    for (let i4 = 0; i4 < 2; i4++) {
      const lvl = clip(base + (useDeltas ? refDelta + (i4 ? modeDelta : 0) : 0), 63)
      let interior = lvl
      if (sharpness > 0) interior = Math.min(interior >> (sharpness > 4 ? 2 : 1), 9 - sharpness)
      interior = Math.max(interior, 1)
      strengths.push(lvl > 0 ? { limit: 2 * lvl + interior, interior, hev: lvl >= 40 ? 2 : lvl >= 15 ? 1 : 0 } : { limit: 0, interior: 0, hev: 0 })
    }
  }
  br.bit(0x80) // (refresh_entropy_probs: there's one frame)
  const probs = new Uint8Array(COEFF_PROBS.length)
  for (let i = 0; i < probs.length; i++) probs[i] = br.bit(COEFF_UPDATE_PROBS[i]) ? br.literal(8) : COEFF_PROBS[i]
  const skipProb = br.bit(0x80) ? br.literal(8) : -1
  need(!br.eof, "VP8 header cut short")
  // (the frame's filter level decides: 0, none, whatever its segments' levels)
  return { segmentMap, segmentProbs, quants, filterType: level === 0 ? 0 : simple ? 1 : 2, strengths, probs, skipProb, partitions }
}

const clip = (v: number, max: number) => (v < 0 ? 0 : v > max ? max : v)

type Context = { modesAbove: Uint8Array; modesLeft: Uint8Array; nzAbove: Uint8Array; nzDcAbove: Uint8Array; nzLeft: number; nzDcLeft: number }

type Macroblock = { segment: number; skip: boolean; i4: boolean; modes: Uint8Array; uvMode: number; nzY: number; nzUv: number }

function readMacroblock(br: BoolDecoder, h: Header, ctx: Context, mbX: number, mb: Macroblock) {
  const p = h.segmentProbs
  mb.segment = h.segmentMap ? (!br.bit(p[0]) ? br.bit(p[1]) : 2 + br.bit(p[2])) : 0
  mb.skip = h.skipProb >= 0 && !!br.bit(h.skipProb)
  mb.i4 = !br.bit(145)
  const above = 4 * mbX, { modesAbove, modesLeft } = ctx, modes = mb.modes
  if (!mb.i4) {
    // (a 16x16 mode stands for its subblocks' in their neighbours' contexts)
    const mode = br.bit(156) ? (br.bit(128) ? TM : H) : (br.bit(163) ? V : DC)
    modes[0] = mode
    modesAbove.fill(mode, above, above + 4)
    modesLeft.fill(mode)
  } else {
    for (let y = 0; y < 4; y++) {
      let mode = modesLeft[y]
      for (let x = 0; x < 4; x++) {
        mode = subblockMode(br, (modesAbove[above + x] * 10 + mode) * 9)
        modesAbove[above + x] = mode
        modes[y * 4 + x] = mode
      }
      modesLeft[y] = mode
    }
  }
  mb.uvMode = !br.bit(142) ? DC : !br.bit(114) ? V : br.bit(183) ? TM : H
}

/** RFC 6386 11.2's tree. */
function subblockMode(br: BoolDecoder, p: number): number {
  const P = BMODE_PROBS
  if (!br.bit(P[p])) return 0 // DC
  if (!br.bit(P[p + 1])) return 1 // TM
  if (!br.bit(P[p + 2])) return 2 // VE
  if (!br.bit(P[p + 3])) return !br.bit(P[p + 4]) ? 3 : !br.bit(P[p + 5]) ? 4 : 5 // HE, RD, VR
  return !br.bit(P[p + 6]) ? 6 : !br.bit(P[p + 7]) ? 7 : !br.bit(P[p + 8]) ? 8 : 9 // LD, VL, HD, HU
}

function readResiduals(br: BoolDecoder, probs: Uint8Array, q: Quant, ctx: Context, mbX: number, mb: Macroblock, coeffs: Int16Array, dc: Int16Array) {
  coeffs.fill(0)
  mb.nzY = mb.nzUv = 0
  if (mb.skip) {
    ctx.nzAbove[mbX] = ctx.nzLeft = 0
    if (!mb.i4) ctx.nzDcAbove[mbX] = ctx.nzDcLeft = 0
    return
  }
  let first = 0, type = 3
  if (!mb.i4) {
    dc.fill(0)
    const n = tokens(br, probs, 1, ctx.nzDcAbove[mbX] + ctx.nzDcLeft, q.y2[0], q.y2[1], 0, dc, 0)
    ctx.nzDcAbove[mbX] = ctx.nzDcLeft = n > 0 ? 1 : 0
    if (n > 1) inverseWht(dc, coeffs)
    else { const dc0 = (dc[0] + 3) >> 3; for (let i = 0; i < 256; i += 16) coeffs[i] = dc0 }
    first = 1
    type = 0
  }
  // (the bit shuffling is libwebp's: `tnz` the 4 subblocks above the next one's row, `lnz` those left)
  let tnz = ctx.nzAbove[mbX] & 0x0f, lnz = ctx.nzLeft & 0x0f, nzY = 0
  for (let y = 0; y < 4; y++) {
    let l = lnz & 1, codes = 0
    for (let x = 0; x < 4; x++) {
      const k = (y * 4 + x) * 16
      const n = tokens(br, probs, type, l + (tnz & 1), q.y1[0], q.y1[1], first, coeffs, k)
      l = n > first ? 1 : 0
      tnz = (tnz >> 1) | (l << 7)
      codes = (codes << 2) | code(n, coeffs[k])
    }
    tnz >>= 4
    lnz = (lnz >> 1) | (l << 7)
    nzY = (nzY << 8) | codes
  }
  let above = tnz, left = lnz >> 4, nzUv = 0
  for (let ch = 0; ch < 4; ch += 2) {
    let codes = 0
    tnz = ctx.nzAbove[mbX] >> (4 + ch)
    lnz = ctx.nzLeft >> (4 + ch)
    for (let y = 0; y < 2; y++) {
      let l = lnz & 1
      for (let x = 0; x < 2; x++) {
        const k = 256 + (2 * ch + 2 * y + x) * 16
        const n = tokens(br, probs, 2, l + (tnz & 1), q.uv[0], q.uv[1], 0, coeffs, k)
        l = n > 0 ? 1 : 0
        tnz = (tnz >> 1) | (l << 3)
        codes = (codes << 2) | code(n, coeffs[k])
      }
      tnz >>= 2
      lnz = (lnz >> 1) | (l << 5)
    }
    nzUv |= codes << (4 * ch)
    above |= (tnz << 4) << ch
    left |= (lnz & 0xf0) << ch
  }
  ctx.nzAbove[mbX] = above
  ctx.nzLeft = left
  mb.nzY = nzY >>> 0
  mb.nzUv = nzUv
}

const code = (n: number, dc: number) => (n > 3 ? 3 : n > 1 ? 2 : dc !== 0 ? 1 : 0)

/** `type` (13.3): 0 luma after a second-order block, 1 that block, 2 chroma, 3 luma. */
function tokens(br: BoolDecoder, probs: Uint8Array, type: number, ctx: number, dq0: number, dq1: number, n: number, out: Int16Array, k: number): number {
  const t = type * 8
  let p = ((t + BANDS[n]) * 3 + ctx) * 11
  for (; n < 16; n++) {
    if (!br.bit(probs[p])) return n // (end of block)
    while (!br.bit(probs[p + 1])) { // (a zero)
      if (++n === 16) return 16
      p = (t + BANDS[n]) * 33
    }
    const next = (t + BANDS[n + 1]) * 33
    let v: number
    if (!br.bit(probs[p + 2])) { v = 1; p = next + 11 }
    else { v = largeValue(br, probs, p); p = next + 22 }
    // (as libwebp's int16_t: a corrupt one's product wraps)
    out[k + ZIGZAG[n]] = (br.bit(0x80) ? -v : v) * (n > 0 ? dq1 : dq0)
  }
  return 16
}

function largeValue(br: BoolDecoder, probs: Uint8Array, p: number): number {
  if (!br.bit(probs[p + 3])) return !br.bit(probs[p + 4]) ? 2 : 3 + br.bit(probs[p + 5])
  if (!br.bit(probs[p + 6])) {
    if (!br.bit(probs[p + 7])) return 5 + br.bit(159)
    return 7 + 2 * br.bit(165) + br.bit(145)
  }
  const bit1 = br.bit(probs[p + 8]), cat = 2 * bit1 + br.bit(probs[p + 9 + bit1])
  let v = 0
  for (const prob of CAT_PROBS[cat]) v += v + br.bit(prob)
  return v + 3 + (8 << cat)
}

function reconstruct(w: Uint8Array, mb: Macroblock, coeffs: Int16Array, hasLeft: boolean, hasTop: boolean) {
  if (mb.i4) {
    for (let n = 0; n < 16; n++) {
      const o = Y_OFF + SCAN[n]
      predictSubblock(w, o, mb.modes[n])
      residual(mb.nzY >>> (30 - 2 * n), coeffs, n * 16, w, o)
    }
  } else {
    predictBlock(w, Y_OFF, 16, mb.modes[0], hasTop, hasLeft)
    if (mb.nzY) for (let n = 0; n < 16; n++) residual(mb.nzY >>> (30 - 2 * n), coeffs, n * 16, w, Y_OFF + SCAN[n])
  }
  predictBlock(w, U_OFF, 8, mb.uvMode, hasTop, hasLeft)
  predictBlock(w, V_OFF, 8, mb.uvMode, hasTop, hasLeft)
  chromaResidual(mb.nzUv & 0xff, coeffs, 256, w, U_OFF)
  chromaResidual(mb.nzUv >> 8, coeffs, 320, w, V_OFF)
}

function residual(code: number, c: Int16Array, k: number, b: Uint8Array, o: number) {
  code &= 3
  if (code > 1) inverseDct(c, k, b, o)
  else if (code) inverseDc(c, k, b, o)
}

function chromaResidual(codes: number, c: Int16Array, k: number, b: Uint8Array, o: number) {
  if (!(codes & 0xff)) return
  for (let n = 0; n < 4; n++) {
    const at = o + (n & 1) * 4 + (n >> 1) * 4 * BPS
    if (codes & 0xaa) inverseDct(c, k + n * 16, b, at)
    else if (c[k + n * 16]) inverseDc(c, k + n * 16, b, at)
  }
}

function edges(w: Uint8Array, Y: Uint8Array, U: Uint8Array, V: Uint8Array, ys: number, uvs: number, mbX: number, mbY: number, mbW: number) {
  const top = Y_OFF - BPS
  if (mbY === 0) {
    w.fill(127, top - 1, top + 20)
    w.fill(127, U_OFF - BPS - 1, U_OFF - BPS + 8)
    w.fill(127, V_OFF - BPS - 1, V_OFF - BPS + 8)
  } else {
    const yRow = (mbY * 16 - 1) * ys + mbX * 16, uvRow = (mbY * 8 - 1) * uvs + mbX * 8
    w.set(Y.subarray(yRow, yRow + 16), top)
    // (the rightmost macroblock's above right: its above row's last pixel, repeated)
    if (mbX < mbW - 1) w.set(Y.subarray(yRow + 16, yRow + 20), top + 16)
    else w.fill(Y[yRow + 15], top + 16, top + 20)
    w.set(U.subarray(uvRow, uvRow + 8), U_OFF - BPS)
    w.set(V.subarray(uvRow, uvRow + 8), V_OFF - BPS)
    w[top - 1] = mbX > 0 ? Y[yRow - 1] : 129
    w[U_OFF - BPS - 1] = mbX > 0 ? U[uvRow - 1] : 129
    w[V_OFF - BPS - 1] = mbX > 0 ? V[uvRow - 1] : 129
  }
  // (subblocks on the right take the macroblock's above right pixels: those right of them aren't decoded yet)
  for (let r = 4; r < 16; r += 4) w.copyWithin(Y_OFF + (r - 1) * BPS + 16, top + 16, top + 20)
  if (mbX === 0) {
    for (let j = 0; j < 16; j++) w[Y_OFF + j * BPS - 1] = 129
    for (let j = 0; j < 8; j++) { w[U_OFF + j * BPS - 1] = 129; w[V_OFF + j * BPS - 1] = 129 }
  } else {
    for (let j = 0; j < 16; j++) w[Y_OFF + j * BPS - 1] = Y[(mbY * 16 + j) * ys + mbX * 16 - 1]
    for (let j = 0; j < 8; j++) {
      const o = (mbY * 8 + j) * uvs + mbX * 8 - 1
      w[U_OFF + j * BPS - 1] = U[o]
      w[V_OFF + j * BPS - 1] = V[o]
    }
  }
}
