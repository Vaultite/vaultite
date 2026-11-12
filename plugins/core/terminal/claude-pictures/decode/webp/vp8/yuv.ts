// YUV 4:2:0 to RGBA as libwebp's decoder gives it by default, to match dwebp: chroma "fancy" upsampled (9-3-3-1, its
// rounding) and converted in its fixed point (yuv.h).

export type Yuv = { width: number; height: number; y: Uint8Array; u: Uint8Array; v: Uint8Array; yStride: number; uvStride: number }

// (BT.601 limited range: (x * k) >> 8 with libwebp's constants, 6 fractional bits left)
const clip = (v: number) => ((v & ~16383) === 0 ? v >> 6 : v < 0 ? 0 : 255)

function put(out: Uint8Array, o: number, y: number, u: number, v: number) {
  const yy = (y * 19077) >> 8
  out[o] = clip(yy + ((v * 26149) >> 8) - 14234)
  out[o + 1] = clip(yy - ((u * 6419) >> 8) - ((v * 13320) >> 8) + 8708)
  out[o + 2] = clip(yy + ((u * 33050) >> 8) - 17685)
}

const blend = (n: number, a: number, b: number, o: number) => ((((n + a + b + o + 8) + 2 * (a + b)) >> 3) + n) >> 1

function row(f: Yuv, r: number, near: number, far: number, out: Uint8Array, at: number) {
  const { y: Y, u: U, v: V, width } = f
  const yo = r * f.yStride, n = near * f.uvStride, d = far * f.uvStride
  put(out, at, Y[yo], (3 * U[n] + U[d] + 2) >> 2, (3 * V[n] + V[d] + 2) >> 2)
  const pairs = (width - 1) >> 1
  for (let x = 1; x <= pairs; x++) {
    const un0 = U[n + x - 1], un1 = U[n + x], ud0 = U[d + x - 1], ud1 = U[d + x]
    const vn0 = V[n + x - 1], vn1 = V[n + x], vd0 = V[d + x - 1], vd1 = V[d + x]
    put(out, at + (2 * x - 1) * 4, Y[yo + 2 * x - 1], blend(un0, un1, ud0, ud1), blend(vn0, vn1, vd0, vd1))
    put(out, at + 2 * x * 4, Y[yo + 2 * x], blend(un1, un0, ud1, ud0), blend(vn1, vn0, vd1, vd0))
  }
  if (!(width & 1)) {
    const c = width / 2 - 1
    put(out, at + (width - 1) * 4, Y[yo + width - 1], (3 * U[n + c] + U[d + c] + 2) >> 2, (3 * V[n + c] + V[d + c] + 2) >> 2)
  }
}

export function yuvToRgba(f: Yuv): Uint8Array {
  const { width, height } = f
  const out = new Uint8Array(width * height * 4).fill(255)
  for (let r = 0; r < height; r++) {
    // (an odd row is nearer the chroma row above, an even one the row below; the first row, and an even height's last,
    // have only one)
    const k = r >> 1
    if (r === 0) row(f, r, 0, 0, out, 0)
    else if (!(r & 1)) row(f, r, k, k - 1, out, r * width * 4)
    else if (r === height - 1) row(f, r, k, k, out, r * width * 4)
    else row(f, r, k, k + 1, out, r * width * 4)
  }
  return out
}
