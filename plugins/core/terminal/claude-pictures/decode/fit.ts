// A picture made smaller for the cells it's drawn in: what a terminal can't show is only bytes to carry and keep.
import type { Rgba } from "./pixels.ts"

/** `px` within `maxWidth` × `maxHeight` and `maxPixels`, its shape kept: area-averaged down (each pixel weighted by
 *  its alpha, so clear ones don't darken their neighbours' edges), or `px` itself when it fits. */
export function fit(px: Rgba, maxWidth: number, maxHeight: number, maxPixels: number): Rgba {
  const k = Math.max(1, px.width / maxWidth, px.height / maxHeight, Math.sqrt((px.width * px.height) / maxPixels))
  if (k === 1) return px
  const width = Math.max(1, Math.floor(px.width / k)), height = Math.max(1, Math.floor(px.height / k))
  // (two passes: rows narrowed, then columns shortened; premultiplied in floats between them)
  const across = spans(px.width, width), down = spans(px.height, height)
  const mid = new Float32Array(width * px.height * 4)
  for (let y = 0; y < px.height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let s = across.start[x], i = across.from[x]; i < across.from[x + 1]; i++, s++) {
        const w = across.weight[i], o = (y * px.width + s) * 4, al = px.data[o + 3] * w
        r += px.data[o] * al; g += px.data[o + 1] * al; b += px.data[o + 2] * al; a += al
      }
      const o = (y * width + x) * 4
      mid[o] = r; mid[o + 1] = g; mid[o + 2] = b; mid[o + 3] = a
    }
  }
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let s = down.start[y], i = down.from[y]; i < down.from[y + 1]; i++, s++) {
        const w = down.weight[i], o = (s * width + x) * 4
        r += mid[o] * w; g += mid[o + 1] * w; b += mid[o + 2] * w; a += mid[o + 3] * w
      }
      const o = (y * width + x) * 4
      if (a > 0) { data[o] = Math.round(r / a); data[o + 1] = Math.round(g / a); data[o + 2] = Math.round(b / a) }
      data[o + 3] = Math.round(a)
    }
  }
  return { width, height, data }
}

/** For each of `to` pixels along a line of `from`: the source pixels it covers (from `start`), and how much of each
 *  (weights summing to 1), all of them flat in `weight` (pixel n's are from[n] to from[n + 1]). */
function spans(from: number, to: number) {
  const scale = from / to, start = new Int32Array(to), offsets = new Int32Array(to + 1), weights: number[] = []
  for (let n = 0; n < to; n++) {
    const lo = n * scale, hi = Math.min(from, (n + 1) * scale)
    start[n] = Math.floor(lo)
    offsets[n] = weights.length
    for (let s = Math.floor(lo); s < hi; s++) weights.push((Math.min(hi, s + 1) - Math.max(lo, s)) / (hi - lo))
  }
  offsets[to] = weights.length
  return { start, from: offsets, weight: Float32Array.from(weights) }
}
