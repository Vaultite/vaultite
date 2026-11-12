// A scan's Huffman tables and bit reader. Past the next marker or the bytes' end it reads zeros, as libjpeg does: a
// cut-short picture decodes as far as it goes, every loop bounded by the picture's size, never by its bytes.
import { need } from "../pixels.ts"

export type Huffman = {
  look: Uint16Array
  maxcode: Int32Array
  valoff: Int32Array
  values: Uint8Array
  maxSymbol: number
}

const LOOK = 9

/** libjpeg's jpeg_make_d_derived_tbl. */
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

export class BitReader {
  data: Uint8Array
  pos: number
  bits = 0
  nbits = 0
  pad = 0
  atMarker = false
  starved = false

  constructor(data: Uint8Array, pos: number) {
    this.data = data
    this.pos = pos
  }

  get exhausted() {
    return this.starved || this.nbits < this.pad
  }

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

  /** A code no table has reads as 0, as libjpeg's does. */
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

  getBits(n: number): number {
    if (this.nbits < n) this.fill()
    this.nbits -= n
    return (this.bits >>> this.nbits) & ((1 << n) - 1)
  }

  extend(s: number): number {
    const v = this.getBits(s)
    return v < 1 << (s - 1) ? v - (1 << s) + 1 : v
  }

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

  starve(skip: boolean) {
    this.atMarker = true
    this.starved = skip
  }
}
