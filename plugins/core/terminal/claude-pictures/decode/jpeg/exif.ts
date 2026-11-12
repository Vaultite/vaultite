import type { Rgba } from "../pixels.ts"

export function exifOrientation(d: Uint8Array, at: number, end: number): number {
  // ("Exif\0\0", then a TIFF header: its byte order, 42, and where IFD0 is, from the header)
  if (end - at < 14 || d[at] !== 0x45 || d[at + 1] !== 0x78 || d[at + 2] !== 0x69 || d[at + 3] !== 0x66 || d[at + 4] || d[at + 5]) return 0
  const t = at + 6, little = d[t] === 0x49 && d[t + 1] === 0x49
  if (!little && !(d[t] === 0x4d && d[t + 1] === 0x4d)) return 0
  const u16 = (i: number) => (little ? d[i] | (d[i + 1] << 8) : (d[i] << 8) | d[i + 1])
  const u32 = (i: number) => (little ? u16(i) + u16(i + 2) * 65536 : u16(i) * 65536 + u16(i + 2))
  if (u16(t + 2) !== 42) return 0
  const ifd = t + u32(t + 4)
  if (ifd + 2 > end) return 0
  const n = u16(ifd)
  for (let i = 0, e = ifd + 2; i < n && e + 12 <= end; i++, e += 12) {
    if (u16(e) !== 0x0112) continue
    const v = u16(e + 2) === 3 ? u16(e + 8) : 0 // (a SHORT, in the entry itself)
    return v >= 1 && v <= 8 ? v : 0
  }
  return 0
}

/** The picture as orientation `o` says to show it: 2 mirrored, 3 turned half round, 4 flipped, 5 transposed, 6 turned
 *  a quarter clockwise, 7 transversed, 8 a quarter anticlockwise. */
export function orient(px: Rgba, o: number): Rgba {
  if (o < 2 || o > 8) return px
  const { width: w, height: h } = px
  const W = o >= 5 ? h : w, H = o >= 5 ? w : h
  const [ax, bx, cx, ay, by, cy] = [
    [-1, 0, w - 1, 0, 1, 0], [-1, 0, w - 1, 0, -1, h - 1], [1, 0, 0, 0, -1, h - 1], [0, 1, 0, 1, 0, 0],
    [0, -1, h - 1, 1, 0, 0], [0, -1, h - 1, -1, 0, w - 1], [0, 1, 0, -1, 0, w - 1],
  ][o - 2]
  const src = new Uint32Array(px.data.buffer, px.data.byteOffset, w * h)
  const data = new Uint8Array(w * h * 4), dst = new Uint32Array(data.buffer)
  const stepX = ay * W + ax, stepY = by * W + bx
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0, d = cy * W + cx + y * stepY; x < w; x++, d += stepX) dst[d] = src[i++]
  }
  return { width: W, height: H, data }
}
