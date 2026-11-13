// IPTC's mark for AI-made media: XMP's Iptc4xmpExt:DigitalSourceType, as Photos, Adobe and Google write it
import zlib from "node:zlib"

export const AI_SOURCE = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"
const SAYS_AI = /digitalsourcetype\/(?:compositeWith)?trainedAlgorithmicMedia/i
const XMP_KEY = "XML:com.adobe.xmp"

export function saysAi(head: Buffer, more?: Buffer): boolean {
  if (SAYS_AI.test(head.toString("latin1")) || (more && SAYS_AI.test(more.toString("latin1")))) return true
  return isPng(head) && pngXmps(head).some((x) => SAYS_AI.test(x))
}

// PNG keeps XMP in iTXt chunks, sometimes compressed

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const isPng = (b: Buffer) => b.length >= 8 && b.subarray(0, 8).equals(PNG_SIG)

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
    try { out.push((compressed ? zlib.inflateSync(d.subarray(at)) : d.subarray(at)).toString("utf8")) } catch {}
  }
  return out
}
