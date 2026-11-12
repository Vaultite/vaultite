// zlib's inflate (RFC 1950 around RFC 1951's DEFLATE), for PNG: the mod's worker has no zlib of its own.
import { need } from "./pixels.ts"

export function inflateZlib(b: Uint8Array, max: number): Uint8Array {
  need(b.length >= 2 && (b[0] & 0x0f) === 8 && ((b[0] << 8) | b[1]) % 31 === 0 && !(b[1] & 0x20), "not a zlib stream")
  return inflate(b.subarray(2), max)
}

type Code = { table: Int32Array; bits: number }

function code(lengths: Uint8Array, n: number): Code {
  const counts = new Uint16Array(16), next = new Uint16Array(16)
  let bits = 0
  for (let i = 0; i < n; i++) { counts[lengths[i]]++; if (lengths[i] > bits) bits = lengths[i] }
  counts[0] = 0
  // (over-subscribed is wrong; incomplete is allowed, as zlib allows a code of one symbol)
  let left = 1
  for (let len = 1; len < 16; len++) { left = (left << 1) - counts[len]; need(left >= 0, "over-subscribed code") }
  for (let len = 1, c = 0; len < 16; len++) { c = (c + counts[len - 1]) << 1; next[len] = c }
  const table = new Int32Array(1 << Math.max(1, bits))
  for (let i = 0; i < n; i++) {
    const len = lengths[i]
    if (!len) continue
    let c = next[len]++, r = 0
    // DEFLATE's codes come bit-reversed, LSB first.
    for (let k = 0; k < len; k++) { r = (r << 1) | (c & 1); c >>= 1 }
    for (let j = r; j < table.length; j += 1 << len) table[j] = (i << 4) | len
  }
  return { table, bits: Math.max(1, bits) }
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

const FIXED = (() => {
  const l = new Uint8Array(288)
  l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288)
  return { lit: code(l, 288), dist: code(new Uint8Array(30).fill(5), 30) }
})()

export function inflate(b: Uint8Array, max: number): Uint8Array {
  let out = new Uint8Array(Math.min(max, Math.max(1024, b.length * 4))), o = 0
  let at = 0, bits = 0, held = 0
  const bit = (n: number) => {
    while (held < n) { need(at < b.length, "cut short"); bits |= b[at++] << held; held += 8 }
    const v = bits & ((1 << n) - 1)
    bits >>>= n; held -= n
    return v
  }
  const symbol = (c: Code) => {
    while (held < c.bits && at < b.length) { bits |= b[at++] << held; held += 8 }
    const e = c.table[bits & ((1 << c.bits) - 1)], len = e & 15
    need(len && len <= held, len ? "cut short" : "bad code")
    bits >>>= len; held -= len
    return e >> 4
  }
  const room = (n: number) => {
    if (o + n <= out.length) return
    need(o + n <= max, "too many bytes")
    const grown = new Uint8Array(Math.min(max, Math.max(o + n, out.length * 2)))
    grown.set(out.subarray(0, o)); out = grown
  }
  let last = 0
  while (!last) {
    last = bit(1)
    const type = bit(2)
    if (type === 0) {
      bits = 0; held = 0
      need(at + 4 <= b.length, "cut short")
      const len = b[at] | (b[at + 1] << 8), nlen = b[at + 2] | (b[at + 3] << 8)
      need((len ^ 0xffff) === nlen, "bad stored block")
      at += 4
      need(at + len <= b.length, "cut short")
      room(len); out.set(b.subarray(at, at + len), o); o += len; at += len
      continue
    }
    need(type !== 3, "bad block type")
    let lit = FIXED.lit, dist = FIXED.dist
    if (type === 2) {
      const nlit = bit(5) + 257, ndist = bit(5) + 1, ncode = bit(4) + 4
      need(nlit <= 286 && ndist <= 30, "bad counts")
      const cl = new Uint8Array(19)
      for (let i = 0; i < ncode; i++) cl[ORDER[i]] = bit(3)
      const clc = code(cl, 19), lengths = new Uint8Array(nlit + ndist)
      for (let i = 0; i < nlit + ndist;) {
        const s = symbol(clc)
        if (s < 16) { lengths[i++] = s; continue }
        let v = 0, n: number
        if (s === 16) { need(i > 0, "repeat of nothing"); v = lengths[i - 1]; n = 3 + bit(2) }
        else n = s === 17 ? 3 + bit(3) : 11 + bit(7)
        need(i + n <= nlit + ndist, "too many lengths")
        lengths.fill(v, i, i + n); i += n
      }
      need(lengths[256], "no end of block")
      lit = code(lengths.subarray(0, nlit), nlit); dist = code(lengths.subarray(nlit), ndist)
    }
    for (;;) {
      const s = symbol(lit)
      if (s < 256) { room(1); out[o++] = s; continue }
      if (s === 256) break
      const li = s - 257
      need(li < 29, "bad length")
      const len = LENGTH_BASE[li] + bit(LENGTH_EXTRA[li])
      const di = symbol(dist)
      need(di < 30, "bad distance")
      const d = DIST_BASE[di] + bit(DIST_EXTRA[di])
      need(d <= o, "distance too far")
      room(len)
      for (let k = 0; k < len; k++, o++) out[o] = out[o - d]
    }
  }
  return out.subarray(0, o)
}
