// A scan's Huffman tables and bit reader. Past the next marker or the bytes' end it reads zeros, as libjpeg does: a
// cut-short picture decodes as far as it goes, every loop bounded by the picture's size, never by its bytes.
import { need } from "../pixels.ts"

/** A Huffman table as DHT defines it: a lookup by the next 9 bits for the common short codes, libjpeg's canonical
 *  limits for the longer ones. */
export type Huffman = {
  /** By the next 9 bits: (code length << 8) | symbol, or 0 when the code is longer. */
  look: Uint16Array
  /** By code length 1..16: the largest code of that length (-1: none; [17] stops the search), and what turns a code
   *  of it into its symbol's index. */
  maxcode: Int32Array
  valoff: Int32Array
  values: Uint8Array
  /** The largest symbol: a DC table's are bit counts, 15 at most. */
  maxSymbol: number
}

const LOOK = 9

/** The table of DHT's 16 code counts by length and its symbols (jpeg_make_d_derived_tbl). */
export function huffman(counts: Uint8Array, symbols: Uint8Array): Huffman {
  const sizes: number[] = []
  for (let l = 1; l <= 16; l++) for (let i = 0; i < counts[l - 1]; i++) sizes.push(l)
  need(sizes.length <= 256 && sizes.length === symbols.length, "bad Huffman table")
  const codes = new Int32Array(sizes.length)
  for (let p = 0, code = 0, si = sizes[0] ?? 0; p < sizes.length; code <<= 1, si++) {
    while (p < sizes.length && sizes[p] === si) codes[p++] = code++
    need(code < 1 << si, "bad Huffman table") // (more codes of a length than it has, or one of all ones)
  }
  const values = new Uint8Array(256), maxcode = new Int32Array(18).fill(-1), valoff = new Int32Array(18)
  values.set(symbols)
  for (let l = 1, p = 0; l <= 16; l++) {
    if (!counts[l - 1]) continue
    valoff[l] = p - codes[p]
    p += counts[l - 1]
    maxcode[l] = codes[p - 1]
  }
  maxcode[17] = 0x7fffffff
  const look = new Uint16Array(1 << LOOK)
  for (let p = 0; p < sizes.length && sizes[p] <= LOOK; p++) {
    const shift = LOOK - sizes[p], at = codes[p] << shift
    look.fill((sizes[p] << 8) | symbols[p], at, at + (1 << shift))
  }
  let maxSymbol = 0
  for (const s of symbols) if (s > maxSymbol) maxSymbol = s
  return { look, maxcode, valoff, values, maxSymbol }
}

/** The entropy-coded bytes of a scan, from `pos`, read a few bits at a time. */
export class BitReader {
  data: Uint8Array
  /** The next byte not yet in `bits`. */
  pos: number
  /** Up to 32 bits read ahead: the low `nbits` of them are next, high first. */
  bits = 0
  nbits = 0
  /** Zero bits fed past the segment's end: once `nbits` is under it, the data has run out. */
  pad = 0
  atMarker = false
  /** Data that ran out before a missing restart marker, so the segment after is skipped too (see restart, scan.ts). */
  starved = false

  constructor(data: Uint8Array, pos: number) {
    this.data = data
    this.pos = pos
  }

  /** Whether the segment's data has run out: what's left of it is skipped, rather than decoded from zeros. */
  get exhausted() {
    return this.starved || this.nbits < this.pad
  }

  /** Tops `bits` up to more than 24. */
  fill() {
    const d = this.data
    while (this.nbits <= 24) {
      let b = 0
      if (!this.atMarker) {
        const p = this.pos
        if (p >= d.length) this.atMarker = true
        else if ((b = d[p]) !== 0xff) this.pos = p + 1
        else if (d[p + 1] === 0) this.pos = p + 2
        else { this.atMarker = true; b = 0 }
      }
      if (this.atMarker) this.pad += 8
      this.bits = (this.bits << 8) | b
      this.nbits += 8
    }
  }

  /** The next symbol by table `t`. A code no table has reads as 0, as libjpeg's does (it warns). */
  decode(t: Huffman): number {
    if (this.nbits < 16) this.fill()
    const e = t.look[(this.bits >>> (this.nbits - LOOK)) & ((1 << LOOK) - 1)]
    if (e) { this.nbits -= e >> 8; return e & 255 }
    let l = LOOK + 1, code = (this.bits >>> (this.nbits - l)) & ((1 << l) - 1)
    while (code > t.maxcode[l]) { l++; code = (this.bits >>> (this.nbits - l)) & ((1 << l) - 1) }
    if (l > 16) { this.nbits -= 16; return 0 }
    this.nbits -= l
    return t.values[(code + t.valoff[l]) & 255]
  }

  /** The next `n` bits (0..16) as a number. */
  getBits(n: number): number {
    if (this.nbits < n) this.fill()
    this.nbits -= n
    return (this.bits >>> this.nbits) & ((1 << n) - 1)
  }

  /** The next `s` bits (1..15) as a signed value (the spec's EXTEND). */
  extend(s: number): number {
    const v = this.getBits(s)
    return v < 1 << (s - 1) ? v - (1 << s) + 1 : v
  }

  /** Drops what's read ahead, and finds the next marker from here: its code, with `pos` at its 0xFF, or -1 when the
   *  bytes end first. */
  seekMarker(): number {
    this.bits = this.nbits = this.pad = 0
    this.atMarker = this.starved = false
    const d = this.data
    for (let p = this.pos; p + 1 < d.length; p++) {
      if (d[p] === 0xff && d[p + 1] !== 0 && d[p + 1] !== 0xff) { this.pos = p; return d[p + 1] }
    }
    this.pos = d.length
    return -1
  }

  /** Leaves the segment empty: it reads zeros, and is skipped if the last one had run out too. */
  starve(skip: boolean) {
    this.atMarker = true
    this.starved = skip
  }
}
