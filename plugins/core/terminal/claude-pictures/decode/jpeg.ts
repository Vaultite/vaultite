// JPEG's pixels as libjpeg-turbo's defaults decode them (islow IDCT, fancy upsampling), exactly: baseline, extended and
// progressive Huffman 8-bit frames, upright by EXIF. Arithmetic, lossless, hierarchical and 12-bit ones are refused.
import { type Limits, type Rgba, need, sized } from "./pixels.ts"
import { type ColorSpace, toRgba } from "./jpeg/color.ts"
import { exifOrientation, orient } from "./jpeg/exif.ts"
import { type Component, type Frame, NATURAL } from "./jpeg/frame.ts"
import { type Huffman, huffman } from "./jpeg/huffman.ts"
import { idct } from "./jpeg/idct.ts"
import { decodeScan, type Scan } from "./jpeg/scan.ts"

const MAX_SCANS = 256

const REFUSED: Record<number, string> = {
  0xc3: "lossless", 0xc5: "hierarchical", 0xc6: "hierarchical", 0xc7: "hierarchical", 0xc8: "reserved (JPG)",
  0xc9: "arithmetic-coded", 0xca: "arithmetic-coded", 0xcb: "arithmetic-coded", 0xcd: "arithmetic-coded",
  0xce: "arithmetic-coded", 0xcf: "arithmetic-coded", 0xde: "hierarchical", 0xdf: "hierarchical",
}

export function decodeJpeg(bytes: Uint8Array, limits: Limits): Rgba {
  const d = bytes
  need(d.length > 4 && d[0] === 0xff && d[1] === 0xd8, "not a JPEG")
  const quant: (Int32Array | null)[] = [null, null, null, null]
  const dcTables: (Huffman | null)[] = [null, null, null, null], acTables: (Huffman | null)[] = [null, null, null, null]
  let frame: Frame | null = null, interval = 0, scans = 0, orientation = 0, jfif = false, adobe = -1
  const u16 = (i: number) => (d[i] << 8) | d[i + 1]
  const says = (at: number, end: number, tag: string) => end - at >= tag.length && [...tag].every((ch, i) => d[at + i] === ch.charCodeAt(0))

  for (let pos = 2; ;) {
    // (the next marker: 0xFF and a code, past any fill bytes, or anything else between segments, as libjpeg skips)
    while (pos + 1 < d.length && !(d[pos] === 0xff && d[pos + 1] !== 0 && d[pos + 1] !== 0xff)) pos++
    if (pos + 1 >= d.length) break
    const m = d[pos + 1]
    pos += 2
    if (m === 0xd9) break
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) continue // (RSTn or TEM: no segment)
    need(m !== 0xd8, "a second SOI")
    need(!REFUSED[m], `${REFUSED[m]} JPEG`)
    if (pos + 2 > d.length || pos + u16(pos) > d.length) { need(scans, "cut short"); break }
    const len = u16(pos), at = pos + 2, end = pos + len
    need(len >= 2, "bad segment length")
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
      need(!frame, "a second frame")
      frame = readFrame(d, at, end, m === 0xc2, limits)
    } else if (m === 0xc4) readHuffman(d, at, end, dcTables, acTables)
    else if (m === 0xdb) readQuant(d, at, end, quant)
    else if (m === 0xdd) { need(len >= 4, "bad DRI"); interval = u16(at) }
    else if (m === 0xda) {
      need(frame, "a scan before its frame")
      need(++scans <= MAX_SCANS, "too many scans")
      pos = decodeScan(d, end, frame, readScan(d, at, end, frame, quant, dcTables, acTables), interval)
      continue
    } else if (m === 0xe0) jfif ||= len >= 16 && says(at, end, "JFIF\0")
    else if (m === 0xe1) orientation ||= exifOrientation(d, at, end)
    else if (m === 0xee && len >= 14 && says(at, end, "Adobe")) adobe = d[at + 11]
    pos = end
  }
  need(frame && scans, "no picture data")
  if (frame.progressive) for (const c of frame.components) inverse(c)
  const px = { width: frame.width, height: frame.height, data: toRgba(frame, colorSpace(frame, jfif, adobe)) }
  return orient(px, orientation)
}

function readFrame(d: Uint8Array, at: number, end: number, progressive: boolean, limits: Limits): Frame {
  need(end - at >= 6, "bad SOF")
  need(d[at] === 8, `${d[at]}-bit JPEG`)
  const height = (d[at + 1] << 8) | d[at + 2], width = (d[at + 3] << 8) | d[at + 4], n = d[at + 5]
  need(height, "height left to a DNL marker")
  need(n === 1 || n === 3 || n === 4, `${n} components`)
  need(end - at >= 6 + 3 * n, "bad SOF")
  sized(width, height, limits)
  const raw = []
  for (let i = 0, p = at + 6; i < n; i++, p += 3) {
    const h = d[p + 1] >> 4, v = d[p + 1] & 15, tq = d[p + 2]
    need(h >= 1 && h <= 4 && v >= 1 && v <= 4 && tq <= 3, "bad component")
    raw.push({ id: d[p], h, v, tq })
  }
  const hmax = Math.max(...raw.map((c) => c.h)), vmax = Math.max(...raw.map((c) => c.v))
  const sizes = raw.map(({ h, v }) => {
    const w = Math.ceil((width * h) / hmax), hh = Math.ceil((height * v) / vmax)
    return { width: w, height: hh, blocksW: Math.ceil(w / 8), blocksH: Math.ceil(hh / 8) }
  })
  const bytes = sizes.reduce((sum, s) => sum + s.blocksW * s.blocksH * 64, 0) * (progressive ? 3 : 1)
  need(bytes <= 16 * limits.maxPixels + (1 << 20), `too big: ${width}x${height}`)
  const components: Component[] = raw.map((c, i) => {
    const s = sizes[i], blocks = s.blocksW * s.blocksH
    return { ...c, ...s, quant: null, plane: new Uint8Array(blocks * 64).fill(128), coefs: progressive ? new Int16Array(blocks * 64) : null }
  })
  return { width, height, progressive, components, hmax, vmax, mcusX: Math.ceil(width / (8 * hmax)), mcusY: Math.ceil(height / (8 * vmax)) }
}

function readHuffman(d: Uint8Array, at: number, end: number, dc: (Huffman | null)[], ac: (Huffman | null)[]) {
  while (at < end) {
    need(at + 17 <= end, "bad DHT")
    const tc = d[at] >> 4, th = d[at] & 15, counts = d.subarray(at + 1, at + 17)
    need(tc <= 1 && th <= 3, "bad DHT")
    const n = counts.reduce((a, b) => a + b, 0)
    need(at + 17 + n <= end, "bad DHT")
    ;(tc ? ac : dc)[th] = huffman(counts, d.subarray(at + 17, at + 17 + n))
    at += 17 + n
  }
}

function readQuant(d: Uint8Array, at: number, end: number, quant: (Int32Array | null)[]) {
  while (at < end) {
    const pq = d[at] >> 4, tq = d[at] & 15
    need(pq <= 1 && tq <= 3 && at + 1 + 64 * (pq + 1) <= end, "bad DQT")
    const q = new Int32Array(64)
    for (let k = 0, p = at + 1; k < 64; k++, p += pq + 1) q[NATURAL[k]] = pq ? (d[p] << 8) | d[p + 1] : d[p]
    quant[tq] = q
    at += 1 + 64 * (pq + 1)
  }
}

/** Checked as libjpeg checks SOS; a component's quantization table is latched at its first scan, as libjpeg does. */
function readScan(d: Uint8Array, at: number, end: number, frame: Frame, quant: (Int32Array | null)[], dcTables: (Huffman | null)[], acTables: (Huffman | null)[]): Scan {
  const n = d[at]
  need(n >= 1 && n <= 4 && end - at >= 4 + 2 * n, "bad SOS")
  const components: Component[] = [], dc: (Huffman | null)[] = [], ac: (Huffman | null)[] = []
  const p = at + 1 + 2 * n, ss = d[p], se = d[p + 1], ah = d[p + 2] >> 4, al = d[p + 2] & 15
  if (frame.progressive) {
    // (a DC band alone, of any components; an AC band of one; each bit after the one before)
    need(ss === 0 ? se === 0 : ss <= se && se <= 63 && n === 1, "bad progression")
    need((ah === 0 || al === ah - 1) && al <= 13, "bad progression")
  }
  const needDc = !frame.progressive || (ss === 0 && ah === 0), needAc = !frame.progressive || ss > 0
  for (let i = 0; i < n; i++) {
    const c = frame.components.find((c) => c.id === d[at + 1 + 2 * i])
    need(c && !components.includes(c), "bad SOS component")
    const td = d[at + 2 + 2 * i] >> 4, ta = d[at + 2 + 2 * i] & 15
    need(td <= 3 && ta <= 3, "bad SOS tables")
    const dcT = needDc ? dcTables[td] : null, acT = needAc ? acTables[ta] : null
    need((!needDc || dcT) && (!needAc || acT), "a scan's Huffman table missing")
    need(!dcT || dcT.maxSymbol <= 15, "bad DC table")
    if (!c.quant) { const q = quant[c.tq]; need(q, "a component's quantization table missing"); c.quant = q.slice() }
    components.push(c); dc.push(dcT); ac.push(acT)
  }
  need(n === 1 || components.reduce((sum, c) => sum + c.h * c.v, 0) <= 10, "too many blocks an MCU")
  return { components, dc, ac, ss, se, ah, al }
}

function inverse(c: Component) {
  if (!c.quant) return
  const stride = c.blocksW * 8
  for (let row = 0, b = 0; row < c.blocksH; row++) {
    for (let col = 0; col < c.blocksW; col++, b++) idct(c.coefs!, b * 64, c.quant, c.plane, row * 8 * stride + col * 8, stride, false)
  }
}

/** What the components are, as libjpeg reads the markers: JFIF says YCbCr, Adobe's transform YCbCr (or YCCK) or not,
 *  and without either, three components with ids 'R', 'G', 'B' are RGB. */
function colorSpace(frame: Frame, jfif: boolean, adobe: number): ColorSpace {
  const c = frame.components
  if (c.length === 1) return "gray"
  if (c.length === 4) return adobe > 0 ? "ycck" : "cmyk"
  if (jfif) return "ycc"
  if (adobe >= 0) return adobe === 0 ? "rgb" : "ycc"
  return c[0].id === 0x52 && c[1].id === 0x47 && c[2].id === 0x42 ? "rgb" : "ycc"
}
