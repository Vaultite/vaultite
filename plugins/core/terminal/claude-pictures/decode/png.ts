import { inflateZlib } from "./inflate.ts"
import { type Limits, need, type Rgba, sized } from "./pixels.ts"

export const isPng = (b: Uint8Array) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a

export function decodePng(b: Uint8Array, limits: Limits): Rgba {
  need(isPng(b), "not a PNG")
  let at = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0, idatBytes = 0
  let palette: Uint8Array | null = null, trns: Uint8Array | null = null
  const idat: Uint8Array[] = []
  while (at + 12 <= b.length) {
    const len = be32(b, at), kind = String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7])
    const body = b.subarray(at + 8, Math.min(b.length, at + 8 + len))
    at += 12 + len
    if (kind === "IHDR") { need(len >= 13, "bad IHDR"); width = be32(body, 0); height = be32(body, 4); depth = body[8]; type = body[9]; interlace = body[12] }
    else if (kind === "PLTE") palette = body
    else if (kind === "tRNS") trns = body
    else if (kind === "IDAT") { idat.push(body); idatBytes += body.length }
    else if (kind === "IEND") break
  }
  const samples = SAMPLES[type] ?? 0
  need(samples && [1, 2, 4, 8, 16].includes(depth) && (type === 3 ? depth <= 8 && palette : type === 0 || depth >= 8), "bad header")
  sized(width, height, limits)
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]]
  let rawBytes = 0
  for (const [x0, y0, dx, dy] of passes) {
    const w = Math.ceil((width - x0) / dx), h = Math.ceil((height - y0) / dy)
    if (w > 0 && h > 0) rawBytes += (Math.ceil((w * samples * depth) / 8) + 1) * h
  }
  const joined = new Uint8Array(idatBytes)
  for (let i = 0, o = 0; i < idat.length; o += idat[i].length, i++) joined.set(idat[i], o)
  const raw = inflateZlib(joined, rawBytes)
  const out = new Uint8Array(width * height * 4)
  const bpp = Math.max(1, (samples * depth) >> 3)
  const key = trns && type !== 3 ? Array.from({ length: trns.length >> 1 }, (_, i) => (trns![i * 2] << 8) | trns![i * 2 + 1]) : null
  let off = 0
  for (const [x0, y0, dx, dy] of passes) {
    const w = Math.ceil((width - x0) / dx), h = Math.ceil((height - y0) / dy)
    if (w <= 0 || h <= 0) continue
    const stride = Math.ceil((w * samples * depth) / 8)
    let prev = new Uint8Array(stride), line = new Uint8Array(stride)
    for (let y = 0; y < h; y++) {
      need(off + 1 + stride <= raw.length, "cut short")
      const filter = raw[off]
      line.set(raw.subarray(off + 1, off + 1 + stride))
      off += 1 + stride
      unfilter(filter, line, prev, bpp)
      for (let x = 0; x < w; x++) put(((y0 + y * dy) * width + x0 + x * dx) * 4, line, x)
      const t = prev; prev = line; line = t
    }
  }
  return { width, height, data: out }

  // A tRNS colour key compares samples at full bit depth.
  function put(o: number, line: Uint8Array, x: number) {
    const sample = (i: number) => {
      const k = x * samples + i
      if (depth === 8) return line[k]
      if (depth === 16) return (line[k * 2] << 8) | line[k * 2 + 1]
      const bit = k * depth
      return (line[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
    }
    const to8 = (v: number) => (depth === 8 ? v : depth === 16 ? v >> 8 : Math.round((v * 255) / ((1 << depth) - 1)))
    let r: number, g: number, bl: number, a = 255
    if (type === 3) {
      const i = sample(0)
      r = palette![i * 3] ?? 0; g = palette![i * 3 + 1] ?? 0; bl = palette![i * 3 + 2] ?? 0
      if (trns) a = i < trns.length ? trns[i] : 255
    } else if (type === 0 || type === 4) {
      const v = sample(0)
      r = g = bl = to8(v)
      if (type === 4) a = to8(sample(1)); else if (key && key.length >= 1 && v === key[0]) a = 0
    } else {
      const sr = sample(0), sg = sample(1), sb = sample(2)
      r = to8(sr); g = to8(sg); bl = to8(sb)
      if (type === 6) a = to8(sample(3)); else if (key && key.length >= 3 && sr === key[0] && sg === key[1] && sb === key[2]) a = 0
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = a
  }
}

const be32 = (a: Uint8Array, o: number) => ((a[o] << 24) | (a[o + 1] << 16) | (a[o + 2] << 8) | a[o + 3]) >>> 0
const SAMPLES: Partial<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function unfilter(filter: number, line: Uint8Array, prev: Uint8Array, bpp: number) {
  const n = line.length
  switch (filter) {
    case 0: return
    case 1: for (let i = bpp; i < n; i++) line[i] = (line[i] + line[i - bpp]) & 255; return
    case 2: for (let i = 0; i < n; i++) line[i] = (line[i] + prev[i]) & 255; return
    case 3: for (let i = 0; i < n; i++) line[i] = (line[i] + (((i >= bpp ? line[i - bpp] : 0) + prev[i]) >> 1)) & 255; return
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
      return
    default: need(false, `bad filter ${filter}`)
  }
}
