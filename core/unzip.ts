// A zip held in memory, entries inflated on demand: Office files and EPUBs are zips of XML (plugin API `unzip`). Big
// archives read as a stream are ai-import's.
import zlib from "node:zlib"

const EOCD = 0x06054b50, CEN = 0x02014b50, LOC = 0x04034b50

/** The entries of the zip in `buf`, by name (folders left out); each one's bytes, inflated when read. Throws when it
 *  isn't a zip. */
export function unzip(buf: Buffer): Map<string, () => Buffer> {
  let end = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === EOCD) { end = i; break }
  }
  if (end < 0) throw new Error("not a zip file")
  const count = buf.readUInt16LE(end + 10)
  let at = buf.readUInt32LE(end + 16)
  const out = new Map<string, () => Buffer>()
  for (let n = 0; n < count && at + 46 <= buf.length && buf.readUInt32LE(at) === CEN; n++) {
    const method = buf.readUInt16LE(at + 10), packed = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28), extra = buf.readUInt16LE(at + 30), comment = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen)
    at += 46 + nameLen + extra + comment
    if (name.endsWith("/")) continue
    out.set(name, () => {
      if (buf.readUInt32LE(local) !== LOC) throw new Error(`a broken zip entry: ${name}`)
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + packed)
      if (method === 0) return data
      if (method === 8) return zlib.inflateRawSync(data)
      throw new Error(`a zip entry packed in a way this can't read (${method}): ${name}`)
    })
  }
  return out
}

/** An entry's text (UTF-8), or null when there's no such entry. */
export function zipText(zip: Map<string, () => Buffer>, name: string): string | null {
  const read = zip.get(name) ?? zip.get(name.replace(/^\/+/, ""))
  return read ? read().toString("utf8") : null
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }

/** XML or HTML text with its entities decoded (&amp;, &#233;, &#x2014;). */
export function xmlDecode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? all
    const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all
  })
}
