// The IPTC label for AI-made media (XMP's Iptc4xmpExt:DigitalSourceType, what Photos, Adobe and Google write): found
// in any file's bytes, never written into them (a label the app keeps lives in files.json).
import zlib from "node:zlib"

export const AI_SOURCE = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"
/** The IPTC values that say an AI made it, whole or in part (in XMP, and in a C2PA manifest's actions). */
const SAYS_AI = /digitalsourcetype\/(?:compositeWith)?trainedAlgorithmicMedia/i
const XMP_KEY = "XML:com.adobe.xmp"

/** Bytes that say an AI made them: an IPTC DigitalSourceType in XMP or a C2PA manifest (a plain byte scan), or in a
 *  PNG's compressed XMP. Give it the head of a big file and its tail (`more`). */
export function saysAi(head: Buffer, more?: Buffer): boolean {
  if (SAYS_AI.test(head.toString("latin1")) || (more && SAYS_AI.test(more.toString("latin1")))) return true
  return isPng(head) && pngXmps(head).some((x) => SAYS_AI.test(x))
}

// ---------- PNG: XMP in iTXt chunks

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
