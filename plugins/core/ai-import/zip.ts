// A zip read in place with Node only (zip64 too: exports with images pass 4 GB), each entry as a stream, so a huge
// conversations.json is never held whole. `zipFiles` writes one, for the tests.
import fs from "node:fs"
import { Readable } from "node:stream"
import zlib from "node:zlib"

export type ZipEntry = { name: string; method: number; size: number; packed: number; offset: number }

const EOCD = 0x06054b50, EOCD64 = 0x06064b50, LOC64 = 0x07064b50, CEN = 0x02014b50, LOC = 0x04034b50

function read(fd: number, at: number, len: number) {
  const buf = Buffer.alloc(len)
  let got = 0
  while (got < len) {
    const n = fs.readSync(fd, buf, got, len - got, at + got)
    if (!n) break
    got += n
  }
  return buf.subarray(0, got)
}

/** Does the file start like a zip ("PK\3\4", or an empty one's "PK\5\6")? Claude's exports may come named .dms. */
export function isZip(file: string) {
  const fd = fs.openSync(file, "r")
  try {
    const b = read(fd, 0, 4)
    return b.length === 4 && b[0] === 0x50 && b[1] === 0x4b && (b.readUInt32LE(0) === LOC || b.readUInt32LE(0) === EOCD)
  } finally { fs.closeSync(fd) }
}

/** Every entry of the zip at `file` (folders left out). Throws when it isn't one. */
export function zipEntries(file: string): ZipEntry[] {
  const fd = fs.openSync(file, "r")
  try {
    const size = fs.fstatSync(fd).size
    const tailLen = Math.min(size, 65_557)
    const tail = read(fd, size - tailLen, tailLen)
    let at = -1
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === EOCD) { at = i; break }
    if (at < 0) throw new Error("not a zip file (no central directory)")
    let count = tail.readUInt16LE(at + 10)
    let cdSize = tail.readUInt32LE(at + 12)
    let cdAt = tail.readUInt32LE(at + 16)
    // Zip64: the locator just before the end record points at the zip64 end record, whose numbers are 64-bit.
    if ((count === 0xffff || cdSize === 0xffffffff || cdAt === 0xffffffff) && at >= 20 && tail.readUInt32LE(at - 20) === LOC64) {
      const rec = read(fd, Number(tail.readBigUInt64LE(at - 20 + 8)), 56)
      if (rec.readUInt32LE(0) === EOCD64) {
        count = Number(rec.readBigUInt64LE(32))
        cdSize = Number(rec.readBigUInt64LE(40))
        cdAt = Number(rec.readBigUInt64LE(48))
      }
    }
    const cd = read(fd, cdAt, cdSize)
    const out: ZipEntry[] = []
    let p = 0
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== CEN) throw new Error("a broken zip (central directory)")
      const method = cd.readUInt16LE(p + 10)
      let packed = cd.readUInt32LE(p + 20), size = cd.readUInt32LE(p + 24)
      const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32)
      let offset = cd.readUInt32LE(p + 42)
      // (UTF-8 whether or not flag bit 11 says so: exports name their files in ASCII or UTF-8)
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString("utf8").replace(/\\/g, "/")
      // Zip64 extra field: the values that didn't fit, in this order.
      let x = p + 46 + nameLen
      const xEnd = x + extraLen
      while (x + 4 <= xEnd) {
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2)
        if (id === 1) {
          let q = x + 4
          if (size === 0xffffffff) { size = Number(cd.readBigUInt64LE(q)); q += 8 }
          if (packed === 0xffffffff) { packed = Number(cd.readBigUInt64LE(q)); q += 8 }
          if (offset === 0xffffffff) { offset = Number(cd.readBigUInt64LE(q)); q += 8 }
        }
        x += 4 + len
      }
      if (!name.endsWith("/")) out.push({ name, method, size, packed, offset })
      p += 46 + nameLen + extraLen + commentLen
    }
    return out
  } finally { fs.closeSync(fd) }
}

/** One entry's bytes as a stream (inflated as they're read). */
export function entryStream(file: string, e: ZipEntry): Readable {
  const fd = fs.openSync(file, "r")
  let head: Buffer
  try { head = read(fd, e.offset, 30) } finally { fs.closeSync(fd) }
  if (head.length < 30 || head.readUInt32LE(0) !== LOC) throw new Error(`a broken zip (${e.name})`)
  const start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
  if (e.packed === 0) return Readable.from([])
  const raw = fs.createReadStream(file, { start, end: start + e.packed - 1 })
  if (e.method === 0) return raw
  if (e.method !== 8) throw new Error(`${e.name} is compressed in a way this can't read (method ${e.method})`)
  const inflate = zlib.createInflateRaw()
  raw.on("error", (err) => inflate.destroy(err))
  return raw.pipe(inflate)
}

/** One entry's bytes, whole (for small ones: an image, memories.json). */
export async function entryBytes(file: string, e: ZipEntry): Promise<Buffer> {
  const parts: Buffer[] = []
  for await (const c of entryStream(file, e)) parts.push(c as Buffer)
  return Buffer.concat(parts)
}

/** A zip of these files (name -> content), deflated: the tests' made-up exports. */
export function zipFiles(files: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = []
  let at = 0
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8")
    const packed = zlib.deflateRawSync(data)
    const nameBuf = Buffer.from(name, "utf8")
    const crc = zlib.crc32(data)
    const loc = Buffer.alloc(30)
    loc.writeUInt32LE(LOC, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x800, 6); loc.writeUInt16LE(8, 8)
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(packed.length, 18); loc.writeUInt32LE(data.length, 22); loc.writeUInt16LE(nameBuf.length, 26)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(CEN, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x800, 8); cen.writeUInt16LE(8, 10)
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt32LE(at, 42)
    locals.push(loc, nameBuf, packed)
    central.push(cen, nameBuf)
    at += 30 + nameBuf.length + packed.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  const n = Object.keys(files).length
  end.writeUInt32LE(EOCD, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(at, 16)
  return Buffer.concat([...locals, cd, end])
}
