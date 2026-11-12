// A GIF's first frame, as Claude sees an animation: placed on its logical screen, the rest transparent.
import { type Limits, need, type Rgba, sized } from "./pixels.ts"

export const isGif = (b: Uint8Array) => b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61

export function decodeGif(b: Uint8Array, limits: Limits): Rgba {
  need(isGif(b) && b.length >= 13, "not a GIF")
  const u16 = (o: number) => { need(o + 2 <= b.length, "cut short"); return b[o] | (b[o + 1] << 8) }
  let width = u16(6), height = u16(8)
  const flags = b[10]
  let at = 13
  let global: Uint8Array | null = null
  if (flags & 0x80) { const n = 3 << ((flags & 7) + 1); need(at + n <= b.length, "cut short"); global = b.subarray(at, at + n); at += n }
  let transparent = -1
  for (;;) {
    need(at < b.length, "no frame")
    const kind = b[at++]
    need(kind !== 0x3b, "no frame")
    if (kind === 0x21) {
      need(at < b.length, "cut short")
      const label = b[at++]
      // (a Graphic Control Extension: its transparent colour applies to the next frame)
      if (label === 0xf9 && at + 5 <= b.length && b[at] >= 4) transparent = b[at + 1] & 1 ? b[at + 4] : -1
      at = skipBlocks(b, at)
      continue
    }
    need(kind === 0x2c, `unknown block ${kind}`)
    const left = u16(at), top = u16(at + 2), w = u16(at + 4), h = u16(at + 6), f = b[at + 8]
    at += 9
    // (a logical screen smaller than its frame, or of size 0, as browsers have it: the frame's)
    if (!width || !height || left + w > width || top + h > height) { width = Math.max(width, left + w); height = Math.max(height, top + h) }
    sized(width, height, limits)
    need(w > 0 && h > 0, "an empty frame")
    let palette = global
    if (f & 0x80) { const n = 3 << ((f & 7) + 1); need(at + n <= b.length, "cut short"); palette = b.subarray(at, at + n); at += n }
    need(palette, "no palette")
    need(at < b.length, "cut short")
    const minCode = b[at++]
    need(minCode >= 1 && minCode <= 11, "bad LZW code size")
    const data = blocks(b, at)
    const { indices, decoded } = lzw(data, minCode, w * h)
    const out = new Uint8Array(width * height * 4)
    const rows = f & 0x40 ? interlaced(h) : null
    const colors = palette.length / 3
    for (let n = 0; n < decoded; n++) {
      const i = indices[n]
      if (i === transparent || i >= colors) continue
      const y = Math.floor(n / w), x = n - y * w
      const o = ((top + (rows ? rows[y] : y)) * width + left + x) * 4
      out[o] = palette[i * 3]; out[o + 1] = palette[i * 3 + 1]; out[o + 2] = palette[i * 3 + 2]; out[o + 3] = 255
    }
    return { width, height, data: out }
  }
}

function skipBlocks(b: Uint8Array, at: number) {
  while (at < b.length && b[at]) at += b[at] + 1
  return at + 1
}

function blocks(b: Uint8Array, at: number) {
  let n = 0
  for (let i = at; i < b.length && b[i]; i += b[i] + 1) n += Math.min(b[i], b.length - i - 1)
  const data = new Uint8Array(n)
  for (let o = 0, i = at; i < b.length && b[i]; i += b[i] + 1) { const len = Math.min(b[i], b.length - i - 1); data.set(b.subarray(i + 1, i + 1 + len), o); o += len }
  return data
}

function interlaced(h: number) {
  const rows = new Uint32Array(h)
  let r = 0
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) rows[r++] = y
  return rows
}

/** A frame cut short draws what it has, the rest clear, as browsers draw one still loading. */
function lzw(data: Uint8Array, minCode: number, count: number) {
  const out = new Uint8Array(count)
  const clear = 1 << minCode, eoi = clear + 1
  const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096), length = new Uint16Array(4096)
  for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; first[i] = i; length[i] = 1 }
  let size = minCode + 1, next = eoi + 1, prev = -1, o = 0
  let bits = 0, held = 0, at = 0
  while (o < count) {
    while (held < size && at < data.length) { bits |= data[at++] << held; held += 8 }
    if (held < size) break
    const code = bits & ((1 << size) - 1)
    bits >>>= size; held -= size
    if (code === clear) { size = minCode + 1; next = eoi + 1; prev = -1; continue }
    if (code === eoi) break
    // (the code about to be made is the last one's string and its first byte; one past it: the data's wrong)
    if (code > next || (code === next && prev < 0)) break
    if (prev >= 0 && next < 4096) {
      prefix[next] = prev; suffix[next] = first[code < next ? code : prev]; first[next] = first[prev]; length[next] = length[prev] + 1
      next++
      if (next === 1 << size && size < 12) size++
    }
    const n = length[code], end = Math.min(count, o + n)
    for (let k = code, p = o + n - 1; k >= 0; k = prefix[k], p--) if (p < end) out[p] = suffix[k]
    o = end
    prev = code
  }
  return { indices: out, decoded: o }
}
