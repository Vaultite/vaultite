// A PNG's pixels, decoded where a terminal's pty is (kitty.ts): the pages' terminals take pixels, as they have no
// decoder of their own (libghostty-vt asks its host for one, synchronously, and a page has none that is).
import zlib from "node:zlib"

export type Pixels = { width: number; height: number; channels: 3 | 4; data: Buffer }

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
export const isPng = (b: Uint8Array) => b.length > 8 && SIGNATURE.equals(b.subarray(0, 8))

/** Its pixels, 8 bits a channel: RGB, or RGBA when it has any transparency. Null when it isn't a PNG this reads, or
 *  it decodes to more than `maxBytes`. */
export function decodePng(b: Buffer, maxBytes: number): Pixels | null {
  if (!isPng(b)) return null
  let at = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0
  let palette: Buffer | null = null, trns: Buffer | null = null
  const idat: Buffer[] = []
  while (at + 12 <= b.length) {
    const len = b.readUInt32BE(at), kind = b.toString("latin1", at + 4, at + 8), body = b.subarray(at + 8, at + 8 + len)
    at += 12 + len
    if (kind === "IHDR") { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12] }
    else if (kind === "PLTE") palette = body
    else if (kind === "tRNS") trns = body
    else if (kind === "IDAT") idat.push(body)
    else if (kind === "IEND") break
  }
  const samples = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type]
  if (!samples || !width || !height || ![1, 2, 4, 8, 16].includes(depth) || (type === 3 && !palette)) return null
  const alpha = type === 4 || type === 6 || !!trns, channels: 3 | 4 = alpha ? 4 : 3
  if (width * height * channels > maxBytes) return null
  let raw: Buffer
  try { raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: Math.ceil(width * samples * depth / 8 + 1) * height * 2 + 1024 }) } catch { return null }
  const out = Buffer.alloc(width * height * channels)
  const bpp = Math.max(1, (samples * depth) >> 3)
  // (Adam7: seven passes of a grid; one pass of every pixel when not interlaced)
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]]
  let off = 0
  for (const [x0, y0, dx, dy] of passes) {
    const w = Math.ceil((width - x0) / dx), h = Math.ceil((height - y0) / dy)
    if (w <= 0 || h <= 0) continue
    const stride = Math.ceil(w * samples * depth / 8)
    let prev = Buffer.alloc(stride)
    for (let y = 0; y < h; y++) {
      if (off + 1 + stride > raw.length) return null
      const filter = raw[off], line = Buffer.from(raw.subarray(off + 1, off + 1 + stride))
      off += 1 + stride
      if (!unfilter(filter, line, prev, bpp)) return null
      for (let x = 0; x < w; x++) put(out, ((y0 + y * dy) * width + x0 + x * dx) * channels, line, x)
      prev = line
    }
  }
  return { width, height, channels, data: out }

  /** Pixel `x` of a line, as 8-bit RGB(A) at `o` (a colour key in tRNS compares its samples at full depth). */
  function put(dst: Buffer, o: number, line: Buffer, x: number) {
    const raw = (i: number) => {
      const k = x * samples + i
      if (depth === 8) return line[k]
      if (depth === 16) return line.readUInt16BE(k * 2)
      const bit = k * depth
      return (line[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
    }
    const to8 = (v: number) => (depth === 8 ? v : depth === 16 ? v >> 8 : Math.round(v * 255 / ((1 << depth) - 1)))
    const keyed = (n: number) => {
      if (!trns || trns.length < n * 2) return false
      for (let i = 0; i < n; i++) if (raw(i) !== trns.readUInt16BE(i * 2)) return false
      return true
    }
    let r: number, g: number, bl: number, a = 255
    if (type === 3) {
      const i = raw(0); r = palette![i * 3] ?? 0; g = palette![i * 3 + 1] ?? 0; bl = palette![i * 3 + 2] ?? 0
      if (trns) a = i < trns.length ? trns[i] : 255
    } else if (type === 0 || type === 4) {
      r = g = bl = to8(raw(0))
      if (type === 4) a = to8(raw(1)); else if (keyed(1)) a = 0
    } else {
      r = to8(raw(0)); g = to8(raw(1)); bl = to8(raw(2))
      if (type === 6) a = to8(raw(3)); else if (keyed(3)) a = 0
    }
    dst[o] = r; dst[o + 1] = g; dst[o + 2] = bl
    if (channels === 4) dst[o + 3] = a
  }
}

function unfilter(filter: number, line: Buffer, prev: Buffer, bpp: number) {
  const n = line.length
  switch (filter) {
    case 0: return true
    case 1: for (let i = bpp; i < n; i++) line[i] = (line[i] + line[i - bpp]) & 255; return true
    case 2: for (let i = 0; i < n; i++) line[i] = (line[i] + prev[i]) & 255; return true
    case 3: for (let i = 0; i < n; i++) line[i] = (line[i] + (((i >= bpp ? line[i - bpp] : 0) + prev[i]) >> 1)) & 255; return true
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
      return true
    default: return false
  }
}
