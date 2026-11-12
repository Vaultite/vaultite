// A WebP's pixels (RFC 9649): the container here, the picture by vp8.ts or vp8l.ts, alpha from ALPH. An animation
// shows its first frame on a transparent canvas, as Claude sees it; metadata and unknown chunks are skipped.
import { type Limits, need, type Rgba, sized, Unreadable } from "../pixels.ts"
import { decodeVp8 } from "./vp8.ts"
import { yuvToRgba } from "./vp8/yuv.ts"
import { decodeVp8l } from "./vp8l.ts"

const ANIMATION = 0x02

type Chunk = { tag: string; at: number; size: number }

/** A WebP's pixels (an animation's first frame). Throws when it isn't one this reads, or is too big for `limits`. */
export function decodeWebp(b: Uint8Array, limits: Limits): Rgba {
  need(b.length >= 12 && tag(b, 0) === "RIFF" && tag(b, 8) === "WEBP", "not a WebP")
  const riff = le32(b, 4)
  need(riff >= 12, "bad RIFF size")
  need(8 + riff <= b.length, "WebP cut short")
  const chunks = chunksOf(b, 12, 8 + riff)
  const first = chunks[0]
  need(first, "no WebP chunk")
  if (first.tag === "VP8 " || first.tag === "VP8L") return image(b, chunks, 0, limits)
  need(first.tag === "VP8X", `unknown WebP chunk ${JSON.stringify(first.tag)}`)
  need(first.size === 10, "bad VP8X size")
  const flags = b[first.at], width = 1 + le24(b, first.at + 4), height = 1 + le24(b, first.at + 7)
  sized(width, height, limits)
  if (!(flags & ANIMATION)) {
    const pic = image(b, chunks, 1, limits)
    need(pic.width === width && pic.height === height, "picture and canvas sizes differ")
    return pic
  }
  // (an animation: its first frame, at its offset on a transparent canvas)
  const anmf = chunks.find((c) => c.tag === "ANMF")
  need(anmf && anmf.size >= 16, "no animation frame")
  const x = 2 * le24(b, anmf.at), y = 2 * le24(b, anmf.at + 3)
  const frame = image(b, chunksOf(b, anmf.at + 16, anmf.at + anmf.size), 0, limits)
  need(x + frame.width <= width && y + frame.height <= height, "frame outside the canvas")
  if (x === 0 && y === 0 && frame.width === width && frame.height === height) return frame
  const data = new Uint8Array(width * height * 4)
  for (let r = 0; r < frame.height; r++) data.set(frame.data.subarray(r * frame.width * 4, (r + 1) * frame.width * 4), ((y + r) * width + x) * 4)
  return { width, height, data }
}

/** The picture of the first VP8 or VP8L chunk from `chunks[from]` on, a lossy one with the alpha of an ALPH before it. */
function image(b: Uint8Array, chunks: Chunk[], from: number, limits: Limits): Rgba {
  let alpha: Chunk | null = null
  for (let i = from; i < chunks.length; i++) {
    const c = chunks[i], payload = b.subarray(c.at, c.at + c.size)
    if (c.tag === "ALPH") alpha = c // (the last before the picture, as libwebp takes)
    else if (c.tag === "VP8L") return decodeVp8l(payload, limits)
    else if (c.tag === "VP8 ") {
      const yuv = decodeVp8(payload, limits)
      const data = yuvToRgba(yuv)
      if (alpha) {
        const a = decodeAlpha(b.subarray(alpha.at, alpha.at + alpha.size), yuv.width, yuv.height, limits)
        for (let p = 0; p < a.length; p++) data[p * 4 + 3] = a[p]
      }
      return { width: yuv.width, height: yuv.height, data }
    }
  }
  throw new Unreadable("no VP8 or VP8L chunk")
}

/** An ALPH chunk's alpha plane (RFC 9649 5.2.3): raw or lossless, then unfiltered. Its pre-processing bits (a hint
 *  that levels were quantized) are ignored, as libwebp does by default. */
function decodeAlpha(d: Uint8Array, width: number, height: number, limits: Limits): Uint8Array {
  need(d.length > 1, "ALPH cut short")
  const method = d[0] & 3, filter = (d[0] >> 2) & 3
  let deltas: Uint8Array
  if (method === 0) {
    need(d.length - 1 >= width * height, "ALPH cut short")
    deltas = d.subarray(1, 1 + width * height)
  } else {
    need(method === 1, `unknown ALPH compression ${method}`)
    const px = decodeVp8l(d.subarray(1), limits, { width, height })
    deltas = new Uint8Array(width * height)
    for (let p = 0; p < deltas.length; p++) deltas[p] = px.data[p * 4 + 1]
  }
  return unfilter(filter, deltas, width, height)
}

/** The alpha plane its filter predicted (none, horizontal, vertical, gradient), from the differences it stored. */
function unfilter(filter: number, deltas: Uint8Array, width: number, height: number): Uint8Array {
  if (filter === 0) return deltas
  const out = new Uint8Array(width * height)
  for (let y = 0, o = 0; y < height; y++, o += width) {
    const up = o - width
    if (y === 0 || filter === 1) {
      // (left-predicted; the first of a row from above, or 0 for the very first)
      let pred = y === 0 ? 0 : out[up]
      for (let x = 0; x < width; x++) pred = out[o + x] = (pred + deltas[o + x]) & 255
    } else if (filter === 2) {
      for (let x = 0; x < width; x++) out[o + x] = (out[up + x] + deltas[o + x]) & 255
    } else {
      out[o] = (out[up] + deltas[o]) & 255
      for (let x = 1; x < width; x++) {
        const g = out[o + x - 1] + out[up + x] - out[up + x - 1]
        out[o + x] = ((g < 0 ? 0 : g > 255 ? 255 : g) + deltas[o + x]) & 255
      }
    }
  }
  return out
}

/** The chunks from `at` to `end`: each's tag, payload offset and size (an odd one padded). */
function chunksOf(b: Uint8Array, at: number, end: number): Chunk[] {
  const chunks: Chunk[] = []
  while (at + 8 <= end) {
    const size = le32(b, at + 4)
    need(at + 8 + size <= end, "WebP chunk cut short")
    chunks.push({ tag: tag(b, at), at: at + 8, size })
    at += 8 + size + (size & 1)
  }
  return chunks
}

const tag = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])
const le24 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)
const le32 = (b: Uint8Array, at: number) => (le24(b, at) + b[at + 3] * 0x1000000)
