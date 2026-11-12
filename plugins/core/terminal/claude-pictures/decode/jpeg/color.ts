// A decoded frame's planes as RGBA: subsampled components brought to the picture's size as libjpeg-turbo's default
// ("fancy") upsampling does, then its colour space to RGB as libjpeg's colour converter and common viewers do.
import type { Component, Frame } from "./frame.ts"

/** What the components are: libjpeg's reading of the markers (default_decompress_parms in jdapimin.c). */
export type ColorSpace = "gray" | "ycc" | "rgb" | "cmyk" | "ycck"

// (libjpeg's YCbCr to RGB tables, jdcolor.c: 16 bits of fixed point, by Cb or Cr)
const ONE_HALF = 1 << 15, fix = (x: number) => Math.round(x * 65536)
const crR = new Int32Array(256), cbB = new Int32Array(256), crG = new Int32Array(256), cbG = new Int32Array(256)
for (let i = 0; i < 256; i++) {
  const x = i - 128
  crR[i] = (fix(1.402) * x + ONE_HALF) >> 16
  cbB[i] = (fix(1.772) * x + ONE_HALF) >> 16
  crG[i] = -fix(0.71414) * x
  cbG[i] = -fix(0.34414) * x + ONE_HALF
}
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

export function toRgba(frame: Frame, space: ColorSpace): Uint8Array {
  const { width: W, height: H } = frame
  const out = new Uint8Array(W * H * 4)
  const n = frame.components.length
  const rows = frame.components.map((c) => upsampler(frame, c))
  const src: Uint8Array[] = new Array(n), at = new Int32Array(n)
  for (let y = 0, o = 0; y < H; y++) {
    for (let i = 0; i < n; i++) { const [buf, off] = rows[i](y); src[i] = buf; at[i] = off }
    const c0 = src[0], a0 = at[0]
    if (space === "gray") {
      for (let x = 0; x < W; x++, o += 4) { const v = c0[a0 + x]; out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255 }
      continue
    }
    const c1 = src[1], a1 = at[1], c2 = src[2], a2 = at[2]
    if (space === "rgb") {
      for (let x = 0; x < W; x++, o += 4) { out[o] = c0[a0 + x]; out[o + 1] = c1[a1 + x]; out[o + 2] = c2[a2 + x]; out[o + 3] = 255 }
    } else if (space === "ycc") {
      for (let x = 0; x < W; x++, o += 4) {
        const Y = c0[a0 + x], cb = c1[a1 + x], cr = c2[a2 + x]
        out[o] = clamp(Y + crR[cr])
        out[o + 1] = clamp(Y + ((cbG[cb] + crG[cr]) >> 16))
        out[o + 2] = clamp(Y + cbB[cb])
        out[o + 3] = 255
      }
    } else {
      // (Adobe's CMYK, as libjpeg readers take it: stored inverted, so 255 is no ink; YCCK is that CMY as YCbCr, its
      // K as is. Shown as Pillow does, each ink scaled by what K leaves.)
      const c3 = src[3], a3 = at[3], ycck = space === "ycck"
      for (let x = 0; x < W; x++, o += 4) {
        let c = c0[a0 + x], m = c1[a1 + x], yy = c2[a2 + x]
        if (ycck) {
          const Y = c, cb = m, cr = yy
          c = 255 - clamp(Y + crR[cr]); m = 255 - clamp(Y + ((cbG[cb] + crG[cr]) >> 16)); yy = 255 - clamp(Y + cbB[cb])
        }
        const k = c3[a3 + x]
        out[o] = k - mul255(255 - c, k)
        out[o + 1] = k - mul255(255 - m, k)
        out[o + 2] = k - mul255(255 - yy, k)
        out[o + 3] = 255
      }
    }
  }
  return out
}

/** a * b / 255, rounded as Pillow's MULDIV255 does. */
const mul255 = (a: number, b: number) => { const t = a * b + 128; return ((t >> 8) + t) >> 8 }

function upsampler(frame: Frame, c: Component): (y: number) => [Uint8Array, number] {
  const p = c.plane, stride = c.blocksW * 8, cw = c.width, last = c.height - 1
  const hr = frame.hmax / c.h, vr = frame.vmax / c.v
  if (hr === 1 && vr === 1) return (y) => [p, y * stride]
  const out = new Uint8Array(frame.width + 2), sums = new Int32Array(cw)
  // (libjpeg-turbo's triangle filters, jdsample.c: each output sample 3/4 its nearer input and 1/4 the next one,
  // edges repeated; by row pairs for a vertical half, the two rows' sums first. Its rounding biases alternate.)
  if (hr === 2 && vr === 1 && cw > 2) {
    return (y) => {
      const r = y * stride
      out[0] = p[r]
      out[1] = (p[r] * 3 + p[r + 1] + 2) >> 2
      for (let x = 1; x < cw - 1; x++) {
        const v = p[r + x] * 3
        out[2 * x] = (v + p[r + x - 1] + 1) >> 2
        out[2 * x + 1] = (v + p[r + x + 1] + 2) >> 2
      }
      out[2 * cw - 2] = (p[r + cw - 1] * 3 + p[r + cw - 2] + 1) >> 2
      out[2 * cw - 1] = p[r + cw - 1]
      return [out, 0]
    }
  }
  const near = (y: number) => (y >> 1) * stride
  const far = (y: number) => Math.min(last, Math.max(0, (y >> 1) + (y & 1 ? 1 : -1))) * stride
  if (hr === 1 && vr === 2) {
    return (y) => {
      const a = near(y), b = far(y), bias = y & 1 ? 2 : 1
      for (let x = 0; x < cw; x++) out[x] = (p[a + x] * 3 + p[b + x] + bias) >> 2
      return [out, 0]
    }
  }
  if (hr === 2 && vr === 2 && cw > 2) {
    return (y) => {
      const a = near(y), b = far(y)
      for (let x = 0; x < cw; x++) sums[x] = p[a + x] * 3 + p[b + x]
      out[0] = (sums[0] * 4 + 8) >> 4
      out[1] = (sums[0] * 3 + sums[1] + 7) >> 4
      for (let x = 1; x < cw - 1; x++) {
        const v = sums[x] * 3
        out[2 * x] = (v + sums[x - 1] + 8) >> 4
        out[2 * x + 1] = (v + sums[x + 1] + 7) >> 4
      }
      out[2 * cw - 2] = (sums[cw - 1] * 3 + sums[cw - 2] + 8) >> 4
      out[2 * cw - 1] = (sums[cw - 1] * 4 + 7) >> 4
      return [out, 0]
    }
  }
  // (any other ratio, or too narrow to filter: each sample repeated, as libjpeg's int_upsample does)
  const xs = new Int32Array(frame.width)
  for (let x = 0; x < xs.length; x++) xs[x] = Math.floor((x * c.h) / frame.hmax)
  return (y) => {
    const r = Math.floor((y * c.v) / frame.vmax) * stride
    for (let x = 0; x < xs.length; x++) out[x] = p[r + xs[x]]
    return [out, 0]
  }
}
