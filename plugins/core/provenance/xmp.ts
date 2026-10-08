// The IPTC label for AI-made media (XMP's Iptc4xmpExt:DigitalSourceType, what Photos, Adobe and Google read): written
// into a new file's bytes where its format takes it cheaply (PNG, JPEG, WebP, MP4/MOV, SVG), and found in any file.
import zlib from "node:zlib"

export const AI_SOURCE = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"
/** The IPTC values that say an AI made it, whole or in part (in XMP, and in a C2PA manifest's actions). */
const SAYS_AI = /digitalsourcetype\/(?:compositeWith)?trainedAlgorithmicMedia/i
const XMP_KEY = "XML:com.adobe.xmp"
const JPEG_XMP = "http://ns.adobe.com/xap/1.0/\0"
const MP4_XMP = Buffer.from("be7acfcb97a942e89c71999491e3afac", "hex")

/** The RDF saying an AI made it: what an SVG's <metadata> holds (as Inkscape writes it). */
const RDF = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
  `<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/">` +
  `<Iptc4xmpExt:DigitalSourceType>${AI_SOURCE}</Iptc4xmpExt:DigitalSourceType></rdf:Description></rdf:RDF>`
/** And as an XMP packet, which images carry. */
export const XMP_PACKET = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">${RDF}</x:xmpmeta><?xpacket end="r"?>`

/** Bytes that say an AI made them: an IPTC DigitalSourceType in XMP or a C2PA manifest (a plain byte scan), or in a
 *  PNG's compressed XMP. Give it the head of a big file and its tail (`more`). */
export function saysAi(head: Buffer, more?: Buffer): boolean {
  if (SAYS_AI.test(head.toString("latin1")) || (more && SAYS_AI.test(more.toString("latin1")))) return true
  return isPng(head) && pngXmps(head).some((x) => SAYS_AI.test(x))
}

/** The bytes with the AI label in them, or null when the format isn't one it writes, the file already has XMP, or its
 *  structure doesn't read as it should (it's left as it is then). */
export function withAiLabel(rel: string, b: Buffer): Buffer | null {
  try {
    if (/\.svg$/i.test(rel)) return svgWith(b)
    if (isPng(b)) return pngWith(b)
    if (b[0] === 0xff && b[1] === 0xd8) return jpegWith(b)
    if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return webpWith(b)
    if (b.subarray(4, 8).toString("latin1") === "ftyp") return mp4With(b)
  } catch { /* a file cut short: left alone */ }
  return null
}

// ---------- PNG: an iTXt chunk after IHDR

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const isPng = (b: Buffer) => b.length >= 8 && b.subarray(0, 8).equals(PNG_SIG)

/** Its chunks [type, data start, data length], or null when they don't add up to the file (cut short: what's there). */
function pngChunks(b: Buffer, partial = false): [string, number, number][] | null {
  const out: [string, number, number][] = []
  let at = 8
  while (at + 12 <= b.length) {
    const len = b.readUInt32BE(at), type = b.subarray(at + 4, at + 8).toString("latin1")
    if (at + 12 + len > b.length) return partial ? out : null
    out.push([type, at + 8, len])
    at += 12 + len
    if (type === "IEND") return at === b.length || partial ? out : null
  }
  return partial ? out : null
}

/** The XMP texts in its iTXt chunks, inflated when compressed. */
function pngXmps(b: Buffer): string[] {
  const out: string[] = []
  for (const [type, start, len] of pngChunks(b, true) ?? []) {
    if (type !== "iTXt") continue
    const d = b.subarray(start, start + len), k = d.indexOf(0)
    if (k < 0 || d.subarray(0, k).toString("latin1") !== XMP_KEY) continue
    const compressed = d[k + 1] === 1
    let at = k + 3
    for (let n = 0; n < 2; n++) { const z = d.indexOf(0, at); if (z < 0) { at = -1; break } at = z + 1 }
    if (at < 0) continue
    try { out.push((compressed ? zlib.inflateSync(d.subarray(at)) : d.subarray(at)).toString("utf8")) } catch { /* unreadable */ }
  }
  return out
}

function pngChunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, "latin1")
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

function pngWith(b: Buffer) {
  const chunks = pngChunks(b)
  if (!chunks || chunks[0]?.[0] !== "IHDR" || pngXmps(b).length) return null
  // keyword, null, not compressed, method 0, no language, no translated keyword: then the text
  const data = Buffer.concat([Buffer.from(`${XMP_KEY}\0\0\0\0\0`, "latin1"), Buffer.from(XMP_PACKET, "utf8")])
  const at = chunks[0][1] + chunks[0][2] + 4
  return Buffer.concat([b.subarray(0, at), pngChunk("iTXt", data), b.subarray(at)])
}

// ---------- JPEG: an APP1 segment after the JFIF and Exif ones

function jpegWith(b: Buffer) {
  let at = 2
  // The leading APP0/APP1 segments (JFIF, Exif) stay first: readers expect them there.
  while (at + 4 <= b.length && b[at] === 0xff && (b[at + 1] === 0xe0 || b[at + 1] === 0xe1)) {
    const len = b.readUInt16BE(at + 2)
    if (len < 2 || at + 2 + len > b.length) return null
    if (b[at + 1] === 0xe1 && b.subarray(at + 4, at + 4 + JPEG_XMP.length).toString("latin1") === JPEG_XMP) return null
    at += 2 + len
  }
  if (!jpegWhole(b, at)) return null
  // Any XMP further on (after an ICC profile) is still XMP: don't add a second.
  if (b.includes(Buffer.from(JPEG_XMP, "latin1"))) return null
  const body = Buffer.concat([Buffer.from(JPEG_XMP, "latin1"), Buffer.from(XMP_PACKET, "utf8")])
  const seg = Buffer.alloc(4)
  seg.writeUInt16BE(0xffe1, 0)
  seg.writeUInt16BE(body.length + 2, 2)
  return Buffer.concat([b.subarray(0, at), seg, body, b.subarray(at)])
}

/** Its segments from `at` read up to the scan, and it ends as a JPEG does (not cut short). */
function jpegWhole(b: Buffer, at: number) {
  while (at + 4 <= b.length && b[at] === 0xff) {
    if (b[at + 1] === 0xff) { at++; continue } // (fill bytes)
    if (b[at + 1] === 0xda) return b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9
    const len = b.readUInt16BE(at + 2)
    if (len < 2) return false
    at += 2 + len
  }
  return false
}

// ---------- WebP: an XMP chunk at the end, flagged in VP8X (made for a simple file)

function riffChunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8)
  head.write(type, 0, "latin1")
  head.writeUInt32LE(data.length, 4)
  return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)])
}

function webpWith(b: Buffer) {
  if (b.readUInt32LE(4) + 8 !== b.length) return null
  const chunks: [string, number, number][] = []
  let at = 12
  while (at < b.length) {
    if (at + 8 > b.length) return null
    const type = b.subarray(at, at + 4).toString("latin1"), len = b.readUInt32LE(at + 4)
    if (at + 8 + len > b.length) return null
    chunks.push([type, at + 8, len])
    at += 8 + len + (len % 2)
  }
  if (at !== b.length || !chunks.length || chunks.some(([t]) => t === "XMP ")) return null
  const [type, start, len] = chunks[0]
  let head: Buffer, rest: Buffer
  if (type === "VP8X") {
    if (len !== 10) return null
    head = Buffer.from(b.subarray(12, start + 10))
    head[8] |= 0x04 // XMP present
    rest = b.subarray(start + 10)
  } else {
    // A simple file (one VP8 or VP8L chunk) becomes an extended one, with its canvas's size from the bitstream.
    let w: number, h: number, alpha = false
    if (type === "VP8 ") {
      if (b[start + 3] !== 0x9d || b[start + 4] !== 0x01 || b[start + 5] !== 0x2a) return null
      w = b.readUInt16LE(start + 6) & 0x3fff; h = b.readUInt16LE(start + 8) & 0x3fff
    } else if (type === "VP8L") {
      if (b[start] !== 0x2f) return null
      const bits = b.readUInt32LE(start + 1)
      w = (bits & 0x3fff) + 1; h = ((bits >>> 14) & 0x3fff) + 1; alpha = ((bits >>> 28) & 1) === 1
    } else return null
    if (!w || !h) return null
    const x = Buffer.alloc(10)
    x[0] = 0x04 | (alpha ? 0x10 : 0)
    x.writeUIntLE(w - 1, 4, 3); x.writeUIntLE(h - 1, 7, 3)
    head = riffChunk("VP8X", x)
    rest = b.subarray(12)
  }
  const body = Buffer.concat([head, rest, riffChunk("XMP ", Buffer.from(XMP_PACKET, "utf8"))])
  const riff = Buffer.alloc(12)
  riff.write("RIFF", 0, "latin1"); riff.writeUInt32LE(body.length + 4, 4); riff.write("WEBP", 8, "latin1")
  return Buffer.concat([riff, body])
}

// ---------- MP4 / MOV: a top-level uuid box (Adobe's XMP one) at the end, so no offset in the file moves

function mp4With(b: Buffer) {
  for (let at = 0; at < b.length;) {
    if (at + 8 > b.length) return null
    let len = b.readUInt32BE(at)
    if (len === 1) { if (at + 16 > b.length) return null; len = Number(b.readBigUInt64BE(at + 8)) }
    // (0: the last box runs to the end, so nothing can follow it)
    if (len < 8 || at + len > b.length) return null
    if (b.subarray(at + 4, at + 8).toString("latin1") === "uuid" && b.subarray(at + 8, at + 24).equals(MP4_XMP)) return null
    at += len
  }
  const xmp = Buffer.from(XMP_PACKET, "utf8"), head = Buffer.alloc(8)
  head.writeUInt32BE(8 + 16 + xmp.length, 0)
  head.write("uuid", 4, "latin1")
  return Buffer.concat([b, head, MP4_XMP, xmp])
}

// ---------- SVG: a <metadata> element first in the <svg>

function svgWith(b: Buffer) {
  const text = b.toString("utf8")
  if (/<metadata[\s>]/i.test(text)) return null
  const open = /<svg\b(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(text)
  if (!open || open[0].endsWith("/>")) return null
  const at = open.index + open[0].length
  return Buffer.from(`${text.slice(0, at)}<metadata>${RDF}</metadata>${text.slice(at)}`, "utf8")
}
