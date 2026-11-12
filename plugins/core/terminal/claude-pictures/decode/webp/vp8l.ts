// WebP's lossless bitstream (VP8L, RFC 9649 section 5), and an ALPH chunk's of method 1 (the same, headerless, its
// size given, alpha in its green): ours, as the mod worker has no image decoder and kitty takes only PNG or pixels.
import { type Limits, need, type Rgba, sized } from "../pixels.ts"

/** A VP8L chunk's pixels; with `implicit`, an ALPH chunk's lossless stream (after its 1-byte header) of that size. */
export function decodeVp8l(data: Uint8Array, limits: Limits, implicit?: { width: number; height: number }): Rgba {
  const br = new Bits(data)
  let width: number, height: number, opaque = false
  if (implicit) ({ width, height } = implicit)
  else {
    need(data.length >= 5 && br.read(8) === 0x2f, "not a VP8L stream")
    width = br.read(14) + 1
    height = br.read(14) + 1
    opaque = !br.read(1) // (alpha_is_used: unset, the picture is opaque, as libwebp's tools show it)
    need(br.read(3) === 0, "unknown VP8L version")
  }
  sized(width, height, limits)
  const argb = decodeImage(br, width, height, limits)
  const out = new Uint8Array(width * height * 4)
  for (let i = 0, o = 0; i < argb.length; i++, o += 4) {
    const px = argb[i]
    out[o] = px >>> 16; out[o + 1] = px >>> 8; out[o + 2] = px; out[o + 3] = opaque ? 255 : px >>> 24
  }
  return { width, height, data: out }
}

// --- the image: transforms around the main entropy-coded image ---

type Transform =
  | { kind: 0 | 1; width: number; bits: number; data: Uint32Array } // predictor, colour transform
  | { kind: 2 } // subtract green
  | { kind: 3; width: number; bits: number; palette: Uint32Array } // colour indexing

/** The ARGB pixels of the main image: its transforms read, its pixels decoded, the transforms undone. */
function decodeImage(br: Bits, width: number, height: number, limits: Limits): Uint32Array {
  const transforms: Transform[] = []
  let xsize = width, seen = 0
  while (br.read(1)) {
    const kind = br.read(2)
    need(!(seen & (1 << kind)), "a transform twice")
    seen |= 1 << kind
    if (kind === 0 || kind === 1) {
      const bits = br.read(3) + 2
      transforms.push({ kind, width: xsize, bits, data: decodeStream(br, shrink(xsize, bits), shrink(height, bits), false, limits) })
    } else if (kind === 2) transforms.push({ kind })
    else {
      const size = br.read(8) + 1, bits = size > 16 ? 0 : size > 4 ? 1 : size > 2 ? 2 : 3
      const palette = decodeStream(br, size, 1, false, limits)
      for (let i = 1; i < size; i++) palette[i] = addPixels(palette[i], palette[i - 1])
      transforms.push({ kind: 3, width: xsize, bits, palette })
      xsize = shrink(xsize, bits)
    }
  }
  let px = decodeStream(br, xsize, height, true, limits)
  for (let i = transforms.length - 1; i >= 0; i--) {
    const t = transforms[i]
    if (t.kind === 3) px = unindex(px, t.width, height, t.bits, t.palette)
    else if (t.kind === 2) addGreen(px)
    else if (t.kind === 1) uncorrelate(px, t.width, height, t.bits, t.data)
    else unpredict(px, t.width, height, t.bits, t.data)
  }
  return px
}

/** `size` in blocks of `1 << bits`. */
const shrink = (size: number, bits: number) => (size + (1 << bits) - 1) >> bits

// --- an entropy-coded image: its colour cache, prefix codes and LZ77-coded pixels ---

const LITERALS = 256, LENGTHS = 24, DISTANCES = 40

/** A `width * height` image stream's ARGB pixels: the main one (`main`, which may have meta prefix codes) or a
 *  transform's or the entropy image's. */
function decodeStream(br: Bits, width: number, height: number, main: boolean, limits: Limits): Uint32Array {
  let cacheBits = 0
  if (br.read(1)) {
    cacheBits = br.read(4)
    need(cacheBits >= 1 && cacheBits <= 11, `colour cache bits ${cacheBits}`)
  }
  // (the entropy image: which group of prefix codes each block of pixels uses; only the groups used are kept)
  let metaBits = 0, metaWidth = 0, groupOf: Uint32Array | null = null, groups = 1, kept = 1, keep: Int32Array | null = null
  if (main && br.read(1)) {
    metaBits = br.read(3) + 2
    metaWidth = shrink(width, metaBits)
    const meta = decodeStream(br, metaWidth, shrink(height, metaBits), false, limits)
    for (let i = 0; i < meta.length; i++) groups = Math.max(groups, ((meta[i] >> 8) & 0xffff) + 1)
    keep = new Int32Array(groups).fill(-1)
    groupOf = new Uint32Array(meta.length)
    kept = 0
    for (let i = 0; i < meta.length; i++) {
      const g = (meta[i] >> 8) & 0xffff
      if (keep[g] < 0) keep[g] = kept++
      groupOf[i] = keep[g] * 5
    }
  }
  const codes = new Codes(Math.max(1 << 16, limits.maxPixels * 4)) // (tables at most 16 bytes a pixel allowed)
  const handles = new Int32Array(kept * 5), lengths = new Uint8Array(LITERALS + LENGTHS + 2048)
  const alphabets = [LITERALS + LENGTHS + (cacheBits ? 1 << cacheBits : 0), 256, 256, 256, DISTANCES]
  for (let g = 0; g < groups; g++) {
    const slot = keep ? keep[g] : g, mark = codes.used
    for (let k = 0; k < 5; k++) {
      const h = readCode(br, codes, alphabets[k], lengths)
      if (slot >= 0) handles[slot * 5 + k] = h
    }
    if (slot < 0) codes.used = mark // (parsed, not kept)
    need(!br.over(), "cut short")
  }
  return decodePixels(br, width, height, codes.table, handles, cacheBits, metaBits, metaWidth, groupOf)
}

/** The LZ77-coded pixels, each read with its block's group of five prefix codes (green with lengths and cache codes,
 *  red, blue, alpha, distance). */
function decodePixels(br: Bits, width: number, height: number, t: Uint32Array, handles: Int32Array, cacheBits: number,
  metaBits: number, metaWidth: number, groupOf: Uint32Array | null): Uint32Array {
  const total = width * height, out = new Uint32Array(total)
  const cache = cacheBits ? new Uint32Array(1 << cacheBits) : null, shift = 32 - cacheBits
  const mask = groupOf ? (1 << metaBits) - 1 : -1
  const groupAt = (x: number, y: number) => groupOf ? groupOf[(y >> metaBits) * metaWidth + (x >> metaBits)] : 0
  let i = 0, x = 0, y = 0, g = 0
  while (i < total) {
    if ((x & mask) === 0) g = groupAt(x, y)
    const s = br.symbol(t, handles[g])
    if (s < LITERALS + LENGTHS && s >= LITERALS) {
      const length = br.prefixed(s - LITERALS), dist = planeDistance(width, br.prefixed(br.symbol(t, handles[g + 4])))
      need(dist <= i && length <= total - i, "a backward reference out of the image")
      for (const end = i + length; i < end; i++) {
        const px = out[i - dist]
        out[i] = px
        if (cache) cache[Math.imul(px, 0x1e35a7bd) >>> shift] = px
      }
      x += length
      if (x >= width) { y += (x / width) | 0; x %= width; need(!br.over(), "cut short") }
      if ((x & mask) !== 0 && i < total) g = groupAt(x, y)
      continue
    }
    let px: number
    if (s < LITERALS) {
      const r = br.symbol(t, handles[g + 1]), b = br.symbol(t, handles[g + 2]), a = br.symbol(t, handles[g + 3])
      px = ((a << 24) | (r << 16) | (s << 8) | b) >>> 0
      if (cache) cache[Math.imul(px, 0x1e35a7bd) >>> shift] = px
    } else px = cache![s - LITERALS - LENGTHS] // (the alphabet has cache codes only with a cache; it holds px already)
    out[i++] = px
    if (++x === width) { x = 0; y++; need(!br.over(), "cut short") }
  }
  need(!br.over(), "cut short")
  return out
}

// (the 120 nearest pixels, as `dy << 4 | (8 - dx)`, by distance code; above 120 a code is a distance + 120)
const PLANE = new Uint8Array([
  0x18, 0x07, 0x17, 0x19, 0x28, 0x06, 0x27, 0x29, 0x16, 0x1a, 0x26, 0x2a, 0x38, 0x05, 0x37, 0x39, 0x15, 0x1b, 0x36, 0x3a,
  0x25, 0x2b, 0x48, 0x04, 0x47, 0x49, 0x14, 0x1c, 0x35, 0x3b, 0x46, 0x4a, 0x24, 0x2c, 0x58, 0x45, 0x4b, 0x34, 0x3c, 0x03,
  0x57, 0x59, 0x13, 0x1d, 0x56, 0x5a, 0x23, 0x2d, 0x44, 0x4c, 0x55, 0x5b, 0x33, 0x3d, 0x68, 0x02, 0x67, 0x69, 0x12, 0x1e,
  0x66, 0x6a, 0x22, 0x2e, 0x54, 0x5c, 0x43, 0x4d, 0x65, 0x6b, 0x32, 0x3e, 0x78, 0x01, 0x77, 0x79, 0x53, 0x5d, 0x11, 0x1f,
  0x64, 0x6c, 0x42, 0x4e, 0x76, 0x7a, 0x21, 0x2f, 0x75, 0x7b, 0x31, 0x3f, 0x63, 0x6d, 0x52, 0x5e, 0x00, 0x74, 0x7c, 0x41,
  0x4f, 0x10, 0x20, 0x62, 0x6e, 0x30, 0x73, 0x7d, 0x51, 0x5f, 0x40, 0x72, 0x7e, 0x61, 0x6f, 0x50, 0x71, 0x7f, 0x60, 0x70,
])

/** A distance code as a distance back in pixels, in an image `width` wide (at least 1). */
function planeDistance(width: number, code: number) {
  if (code > 120) return code - 120
  const p = PLANE[code - 1], dist = (p >> 4) * width + 8 - (p & 15)
  return dist >= 1 ? dist : 1
}

// --- prefix codes ---

const ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]

/** One prefix code of `size` symbols read and built in `codes`: its handle (Codes.add). */
function readCode(br: Bits, codes: Codes, size: number, lengths: Uint8Array): number {
  lengths.fill(0, 0, size)
  if (br.read(1)) { // (simple: one or two symbols)
    const two = br.read(1), first = br.read(br.read(1) ? 8 : 1)
    need(first < size, "a symbol out of its alphabet")
    lengths[first] = 1
    if (two) {
      const second = br.read(8)
      need(second < size, "a symbol out of its alphabet")
      lengths[second] = 1
    }
    return codes.add(lengths, size)
  }
  const lengthLengths = new Uint8Array(19)
  for (let i = 0, n = br.read(4) + 4; i < n; i++) lengthLengths[ORDER[i]] = br.read(3)
  const mark = codes.used, lengthCode = codes.add(lengthLengths, 19)
  let max = size
  if (br.read(1)) {
    max = 2 + br.read(2 + 2 * br.read(3))
    need(max <= size, "more code lengths than symbols")
  }
  for (let s = 0, prev = 8; s < size && max-- > 0;) {
    const len = br.symbol(codes.table, lengthCode)
    if (len < 16) {
      lengths[s++] = len
      if (len) prev = len
      continue
    }
    const repeat = len === 16 ? 3 + br.read(2) : len === 17 ? 3 + br.read(3) : 11 + br.read(7)
    need(s + repeat <= size, "code lengths past the alphabet")
    lengths.fill(len === 16 ? prev : 0, s, s + repeat)
    s += repeat
  }
  codes.used = mark
  return codes.add(lengths, size)
}

const ROOT = 8, MAX_LENGTH = 15
/** Space for the largest table one code can make: the root's, and at most one second-level table of at most
 *  `1 << (MAX_LENGTH - ROOT)` per root entry. */
const MAX_TABLE = (1 << ROOT) + (1 << ROOT) * (1 << (MAX_LENGTH - ROOT))

/** Prefix codes as libwebp's two-level tables in one growing array (a symbol a lookup or two). An entry is
 *  `value << 4 | bits`: a symbol and its length, or in the root, a subtable's offset from it and 8 + its bits. */
class Codes {
  table = new Uint32Array(1 << 12)
  used = 0
  private readonly cap: number
  private readonly count = new Int32Array(MAX_LENGTH + 1)
  private readonly offset = new Int32Array(MAX_LENGTH + 1)
  private readonly sorted = new Uint16Array(4096)
  private readonly scratch = new Uint32Array(MAX_TABLE)

  constructor(cap: number) { this.cap = cap }

  /** A code of the `size` symbols with these lengths built: its handle, the table's offset, or for a code of one
   *  symbol (which takes no bits) `~symbol`. Throws on a code that isn't complete. */
  add(lengths: Uint8Array, size: number): number {
    const { count, offset, sorted, scratch: t } = this
    count.fill(0)
    for (let s = 0; s < size; s++) count[lengths[s]]++
    const symbols = size - count[0]
    need(symbols > 0, "an empty prefix code")
    offset[1] = 0
    for (let len = 1; len < MAX_LENGTH; len++) {
      need(count[len] <= 1 << len, "an over-subscribed prefix code")
      offset[len + 1] = offset[len] + count[len]
    }
    for (let s = 0; s < size; s++) if (lengths[s]) sorted[offset[lengths[s]]++] = s
    if (symbols === 1) return ~sorted[0]
    let key = 0, sym = 0, nodes = 1, open = 1
    for (let len = 1, step = 2; len <= ROOT; len++, step <<= 1) {
      open = (open << 1) - count[len]
      nodes += open + count[len]
      need(open >= 0, "an over-subscribed prefix code")
      for (; count[len] > 0; count[len]--) {
        replicate(t, key, step, 1 << ROOT, (sorted[sym++] << 4) | len)
        key = nextKey(key, len)
      }
    }
    let total = 1 << ROOT, start = 0, size2 = 1 << ROOT, low = -1
    for (let len = ROOT + 1, step = 2; len <= MAX_LENGTH; len++, step <<= 1) {
      open = (open << 1) - count[len]
      nodes += open + count[len]
      need(open >= 0, "an over-subscribed prefix code")
      for (; count[len] > 0; count[len]--) {
        if ((key & ((1 << ROOT) - 1)) !== low) {
          start += size2
          const bits = nextTableBits(count, len)
          size2 = 1 << bits
          total += size2
          low = key & ((1 << ROOT) - 1)
          t[low] = ((start - low) << 4) | (bits + ROOT)
        }
        replicate(t, start + (key >>> ROOT), step, size2, (sorted[sym++] << 4) | (len - ROOT))
        key = nextKey(key, len)
      }
    }
    need(nodes === 2 * symbols - 1, "an incomplete prefix code")
    const at = this.used
    if (at + total > this.table.length) {
      const grown = Math.max(this.table.length * 2, at + total)
      need(grown <= this.cap, "prefix codes too large")
      const table = new Uint32Array(grown)
      table.set(this.table.subarray(0, at))
      this.table = table
    }
    this.table.set(t.subarray(0, total), at)
    this.used = at + total
    return at
  }
}

/** `code` in every `step`-th entry of `t[base .. base + end)`. */
function replicate(t: Uint32Array, base: number, step: number, end: number, code: number) {
  do { end -= step; t[base + end] = code } while (end > 0)
}

/** The next code of `len` bits after `key`, bits reversed (codes are read from their first bit, LSB-first). */
function nextKey(key: number, len: number) {
  let step = 1 << (len - 1)
  while (key & step) step >>= 1
  return step ? (key & (step - 1)) + step : key
}

/** The bits of a second-level table for the codes from `len` on that share its root entry. */
function nextTableBits(count: Int32Array, len: number) {
  let left = 1 << (len - ROOT)
  while (len < MAX_LENGTH) {
    left -= count[len]
    if (left <= 0) break
    len++
    left <<= 1
  }
  return len - ROOT
}

// --- the bits ---

/** The stream's bits, LSB-first. Past its end it reads zeros, and says so (over) once those are used: loops are
 *  bounded by the image's size, and check it then. */
class Bits {
  private readonly buf: Uint8Array
  private pos = 0
  private val = 0
  private n = 0

  constructor(buf: Uint8Array) { this.buf = buf }

  private fill() {
    while (this.n <= 24) {
      this.val |= (this.pos < this.buf.length ? this.buf[this.pos] : 0) << this.n
      this.pos++
      this.n += 8
    }
  }

  /** Whether more bits were used than the stream has. */
  over() { return this.pos * 8 - this.n > this.buf.length * 8 }

  /** The next `n` bits (at most 24) as a number. */
  read(n: number): number {
    if (this.n < n) this.fill()
    const v = this.val & ((1 << n) - 1)
    this.val >>>= n
    this.n -= n
    return v
  }

  /** The next symbol of the code at `h` in `t` (Codes.add). */
  symbol(t: Uint32Array, h: number): number {
    if (h < 0) return ~h
    if (this.n < MAX_LENGTH) this.fill()
    const low = this.val & ((1 << ROOT) - 1)
    let e = t[h + low], len = e & 15
    if (len > ROOT) {
      this.val >>>= ROOT
      this.n -= ROOT
      e = t[h + low + (e >>> 4) + (this.val & ((1 << (len - ROOT)) - 1))]
      len = e & 15
    }
    this.val >>>= len
    this.n -= len
    return e >>> 4
  }

  /** A length or distance from its prefix symbol and extra bits. */
  prefixed(sym: number): number {
    if (sym < 4) return sym + 1
    const extra = (sym - 2) >> 1
    return ((2 + (sym & 1)) << extra) + this.read(extra) + 1
  }
}

// --- the transforms, undone ---

/** Each channel of a and b added, mod 256. */
function addPixels(a: number, b: number) {
  return (((a & 0xff00ff00) + (b & 0xff00ff00)) & 0xff00ff00) | (((a & 0x00ff00ff) + (b & 0x00ff00ff)) & 0x00ff00ff)
}

const average = (a: number, b: number) => (((a ^ b) & 0xfefefefe) >>> 1) + (a & b)
const clamp = (v: number) => v < 0 ? 0 : v > 255 ? 255 : v

function select(l: number, t: number, tl: number) {
  let d = 0 // (how much nearer the prediction L + T - TL is to T than to L, over the channels)
  for (let s = 0; s < 32; s += 8) {
    const c = (tl >>> s) & 255
    d += Math.abs(((l >>> s) & 255) - c) - Math.abs(((t >>> s) & 255) - c)
  }
  return d <= 0 ? t : l
}

function addSubtractFull(a: number, b: number, c: number) {
  let px = 0
  for (let s = 0; s < 32; s += 8) px |= clamp(((a >>> s) & 255) + ((b >>> s) & 255) - ((c >>> s) & 255)) << s
  return px
}

function addSubtractHalf(a: number, b: number) {
  let px = 0
  for (let s = 0; s < 32; s += 8) {
    const x = (a >>> s) & 255
    px |= clamp(x + (((x - ((b >>> s) & 255)) / 2) | 0)) << s
  }
  return px
}

/** The predictor transform undone in place: each pixel plus its prediction from the pixels decoded before it, by
 *  its block's mode (the first row from the left, the first column from above). */
function unpredict(d: Uint32Array, width: number, height: number, bits: number, modes: Uint32Array) {
  const mw = shrink(width, bits)
  d[0] = addPixels(d[0], 0xff000000)
  for (let x = 1; x < width; x++) d[x] = addPixels(d[x], d[x - 1])
  for (let y = 1; y < height; y++) {
    const row = y * width, mrow = (y >> bits) * mw
    d[row] = addPixels(d[row], d[row - width])
    for (let x = 1; x < width; x++) {
      const i = row + x, l = d[i - 1], t = d[i - width]
      let p: number
      switch ((modes[mrow + (x >> bits)] >> 8) & 15) {
        case 1: p = l; break
        case 2: p = t; break
        case 3: p = d[i - width + 1]; break // (the last column's is the row's first pixel)
        case 4: p = d[i - width - 1]; break
        case 5: p = average(average(l, d[i - width + 1]), t); break
        case 6: p = average(l, d[i - width - 1]); break
        case 7: p = average(l, t); break
        case 8: p = average(d[i - width - 1], t); break
        case 9: p = average(t, d[i - width + 1]); break
        case 10: p = average(average(l, d[i - width - 1]), average(t, d[i - width + 1])); break
        case 11: p = select(l, t, d[i - width - 1]); break
        case 12: p = addSubtractFull(l, t, d[i - width - 1]); break
        case 13: p = addSubtractHalf(average(l, t), d[i - width - 1]); break
        default: p = 0xff000000 // (0, and 14 and 15 as libwebp reads them)
      }
      d[i] = addPixels(d[i], p)
    }
  }
}

/** The colour transform undone in place: red and blue given back what green (and red, blue) took from them. */
function uncorrelate(d: Uint32Array, width: number, height: number, bits: number, m: Uint32Array) {
  const mw = shrink(width, bits)
  for (let y = 0, i = 0; y < height; y++) {
    const mrow = (y >> bits) * mw
    for (let x = 0; x < width; x++, i++) {
      const e = m[mrow + (x >> bits)], g2r = (e << 24) >> 24, g2b = (e << 16) >> 24, r2b = (e << 8) >> 24
      const px = d[i], g = (px << 16) >> 24
      const r = ((px >>> 16) + ((g2r * g) >> 5)) & 255
      const b = (px + ((g2b * g) >> 5) + ((r2b * ((r << 24) >> 24)) >> 5)) & 255
      d[i] = (px & 0xff00ff00) | (r << 16) | b
    }
  }
}

/** Subtract green undone in place. */
function addGreen(d: Uint32Array) {
  for (let i = 0; i < d.length; i++) {
    const px = d[i], g = (px >>> 8) & 255
    d[i] = (px & 0xff00ff00) | ((((px >>> 16) + g) & 255) << 16) | ((px + g) & 255)
  }
}

/** Colour indexing undone: each index (several to a pixel's green for small palettes) as its colour, an index past
 *  the palette as transparent black. */
function unindex(d: Uint32Array, width: number, height: number, bits: number, palette: Uint32Array): Uint32Array {
  const colors = new Uint32Array(256), packed = shrink(width, bits)
  colors.set(palette.subarray(0, 256))
  const per = 8 >> bits, xmask = (1 << bits) - 1, vmask = (1 << per) - 1
  const out = new Uint32Array(width * height)
  for (let y = 0, o = 0; y < height; y++) {
    const row = y * packed
    for (let x = 0; x < width; x++, o++) out[o] = colors[((d[row + (x >> bits)] >>> 8) >> ((x & xmask) * per)) & vmask]
  }
  return out
}
