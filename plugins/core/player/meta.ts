// What a long audio file says about itself: its title, author, chapters and cover, read from an MP4's (m4b, m4a) atoms
// or an MP3's ID3 tag, as audiobook and podcast apps read them. Only the parts needed are read, never the whole file.
import fs from "node:fs"
import type { Chapter } from "./shelves.ts"
export type Meta = { title?: string; artist?: string; chapters: Chapter[]; cover?: { mime: string; bytes: Buffer } }

export function readMeta(file: string): Meta {
  const fd = fs.openSync(file, "r")
  try {
    const head = Buffer.alloc(10)
    fs.readSync(fd, head, 0, 10, 0)
    if (head.toString("latin1", 0, 3) === "ID3") return id3(fd, head)
    if (head.toString("latin1", 4, 8) === "ftyp") return mp4(fd, fs.fstatSync(fd).size)
    return { chapters: [] }
  } finally { fs.closeSync(fd) }
}

const read = (fd: number, at: number, n: number) => {
  const b = Buffer.alloc(n)
  return b.subarray(0, fs.readSync(fd, b, 0, n, at))
}
const tidy = (cs: Chapter[]) => cs.filter((c) => Number.isFinite(c.t) && c.t >= 0).sort((a, b) => a.t - b.t)

// ---------- MP4: moov holds the tags (udta/meta/ilst), Nero's chapter list (udta/chpl) and the chapter track's index

type Box = { type: string; start: number; end: number } // (start: the body, after the header)
function boxes(b: Buffer, from = 0, to = b.length): Box[] {
  const out: Box[] = []
  for (let i = from; i + 8 <= to;) {
    let size = b.readUInt32BE(i), head = 8
    if (size === 1 && i + 16 <= to) { size = Number(b.readBigUInt64BE(i + 8)); head = 16 } else if (size === 0) size = to - i
    if (size < head || i + size > to) break
    out.push({ type: b.toString("latin1", i + 4, i + 8), start: i + head, end: i + size })
    i += size
  }
  return out
}
const child = (b: Buffer, box: Box | undefined, type: string, skip = 0) => box && boxes(b, box.start + skip, box.end).find((x) => x.type === type)
// (an iTunes meta has a version and flags before its children; QuickTime's doesn't)
const skipOf = (b: Buffer, x: Box) => (x.type === "meta" && b.toString("latin1", x.start + 4, x.start + 8) !== "hdlr" ? 4 : 0)
const path = (b: Buffer, box: Box | undefined, ...types: string[]) => types.reduce<Box | undefined>((x, t) => x && child(b, x, t, skipOf(b, x)), box)

function mp4(fd: number, size: number): Meta {
  // The top-level boxes, walked by their headers (mdat can be gigabytes), to read only moov.
  let moov: Buffer | null = null
  for (let at = 0; at + 8 <= size;) {
    const h = read(fd, at, 16)
    let len = h.readUInt32BE(0)
    if (len === 1) len = Number(h.readBigUInt64BE(8)); else if (len === 0) len = size - at
    if (len < 8) break
    if (h.toString("latin1", 4, 8) === "moov") { moov = read(fd, at, Math.min(len, 64 << 20)); break }
    at += len
  }
  if (!moov) return { chapters: [] }
  const root = boxes(moov)[0]
  const meta: Meta = { chapters: [] }
  const ilst = path(moov, root, "udta", "meta", "ilst")
  const tag = (type: string) => {
    const data = child(moov!, child(moov!, ilst, type), "data")
    return data && data.end - data.start > 8 ? { kind: moov!.readUInt32BE(data.start) & 0xffffff, bytes: moov!.subarray(data.start + 8, data.end) } : null
  }
  const text = (type: string) => tag(type)?.bytes.toString("utf8").trim() || undefined
  meta.title = text("©nam") ?? text("©alb")
  meta.artist = text("©ART") ?? text("aART") ?? text("©wrt")
  const covr = tag("covr")
  if (covr) meta.cover = { mime: covr.kind === 14 || covr.bytes[0] === 0x89 ? "image/png" : "image/jpeg", bytes: Buffer.from(covr.bytes) }
  meta.chapters = trackChapters(fd, moov, root)
  if (!meta.chapters.length) meta.chapters = nero(moov, path(moov, root, "udta", "chpl"))
  return meta
}

/** Nero's list: start times in 100 ns units and titles (what most m4b tools write next to the track). */
function nero(b: Buffer, chpl: Box | undefined): Chapter[] {
  if (!chpl) return []
  let i = chpl.start + 4 + (b[chpl.start] ? 4 : 0)
  const n = b[i++], out: Chapter[] = []
  for (let k = 0; k < n && i + 9 <= chpl.end; k++) {
    const t = Number(b.readBigUInt64BE(i)) / 1e7, len = b[i + 8]
    out.push({ t, title: b.toString("utf8", i + 9, i + 9 + len).trim() })
    i += 9 + len
  }
  return tidy(out)
}

/** QuickTime's: a text track the audio's tref/chap points at, one sample per chapter (what Apple's and Audible's use). */
function trackChapters(fd: number, b: Buffer, root: Box): Chapter[] {
  const traks = boxes(b, root.start, root.end).filter((x) => x.type === "trak")
  const idOf = (t: Box) => { const h = child(b, t, "tkhd"); return h ? b.readUInt32BE(h.start + (b[h.start] === 1 ? 20 : 12)) : -1 }
  const ids = new Set<number>()
  for (const t of traks) {
    const chap = path(b, t, "tref", "chap")
    for (let i = chap?.start ?? 0; chap && i + 4 <= chap.end; i += 4) ids.add(b.readUInt32BE(i))
  }
  const trak = traks.find((t) => ids.has(idOf(t)))
  if (!trak) return []
  const mdhd = path(b, trak, "mdia", "mdhd"), stbl = path(b, trak, "mdia", "minf", "stbl")
  if (!mdhd || !stbl) return []
  const scale = b.readUInt32BE(mdhd.start + (b[mdhd.start] === 1 ? 20 : 12)) || 1
  const table = (type: string) => child(b, stbl, type)
  // When each sample starts (stts), how big it is (stsz) and where (stsc's chunks at stco/co64's offsets).
  const starts: number[] = []
  const stts = table("stts")
  for (let i = stts ? stts.start + 8 : 0, n = stts ? b.readUInt32BE(stts.start + 4) : 0, at = 0; n-- > 0; i += 8)
    for (let k = b.readUInt32BE(i), d = b.readUInt32BE(i + 4); k-- > 0; at += d) starts.push(at / scale)
  const stsz = table("stsz")
  const fixed = stsz ? b.readUInt32BE(stsz.start + 4) : 0
  const sizeOf = (k: number) => fixed || b.readUInt32BE(stsz!.start + 12 + k * 4)
  const co = table("stco") ?? table("co64"), wide = co?.type === "co64"
  const chunks = co ? Array.from({ length: b.readUInt32BE(co.start + 4) }, (_, k) => wide ? Number(b.readBigUInt64BE(co.start + 8 + k * 8)) : b.readUInt32BE(co.start + 8 + k * 4)) : []
  const stsc = table("stsc"), runs: { first: number; per: number }[] = []
  for (let i = stsc ? stsc.start + 8 : 0, n = stsc ? b.readUInt32BE(stsc.start + 4) : 0; n-- > 0; i += 12) runs.push({ first: b.readUInt32BE(i) - 1, per: b.readUInt32BE(i + 4) })
  const out: Chapter[] = []
  let k = 0
  chunks.forEach((off, c) => {
    const per = [...runs].reverse().find((r) => r.first <= c)?.per ?? 1
    for (let s = 0; s < per && k < starts.length; s++, k++) {
      const len = sizeOf(k), sample = read(fd, off, Math.min(len, 1024))
      off += len
      const n = sample.length >= 2 ? Math.min(sample.readUInt16BE(0), sample.length - 2) : 0
      const raw = sample.subarray(2, 2 + n)
      const title = raw[0] === 0xfe && raw[1] === 0xff ? Buffer.from(raw.subarray(2)).swap16().toString("utf16le") : raw.toString("utf8")
      out.push({ t: starts[k], title: title.trim() })
    }
  })
  return tidy(out)
}

// ---------- MP3: ID3v2's CHAP frames (each with its TIT2), TIT2/TPE1 and the APIC picture

function id3(fd: number, head: Buffer): Meta {
  const v = head[3], flags = head[5]
  const syncsafe = (b: Buffer, i: number) => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f)
  const size = syncsafe(head, 6)
  const b = read(fd, 10, size)
  const from = flags & 0x40 ? (v === 4 ? syncsafe(b, 0) : b.readUInt32BE(0) + 4) : 0
  const meta: Meta = { chapters: [] }
  for (const f of frames(b, from, b.length, v)) {
    if (f.id === "TIT2") meta.title = text(f.body)
    else if (f.id === "TALB") meta.title ??= text(f.body)
    else if (f.id === "TPE1") meta.artist = text(f.body)
    else if (f.id === "APIC" && !meta.cover) meta.cover = picture(f.body)
    else if (f.id === "CHAP") {
      const z = f.body.indexOf(0)
      if (z < 0 || z + 17 > f.body.length) continue
      const t = f.body.readUInt32BE(z + 1) / 1000
      const sub = frames(f.body, z + 17, f.body.length, v).find((x) => x.id === "TIT2")
      meta.chapters.push({ t, title: sub ? text(sub.body) : "" })
    }
  }
  meta.chapters = tidy(meta.chapters).map((c, k) => ({ ...c, title: c.title || `Chapter ${k + 1}` }))
  return meta
}

function frames(b: Buffer, from: number, to: number, v: number) {
  const out: { id: string; body: Buffer }[] = []
  for (let i = from; i + 10 <= to;) {
    const id = b.toString("latin1", i, i + 4)
    if (!/^[A-Z0-9]{4}$/.test(id)) break
    const len = v === 4 ? ((b[i + 4] & 0x7f) << 21) | ((b[i + 5] & 0x7f) << 14) | ((b[i + 6] & 0x7f) << 7) | (b[i + 7] & 0x7f) : b.readUInt32BE(i + 4)
    if (i + 10 + len > to) break
    out.push({ id, body: b.subarray(i + 10, i + 10 + len) })
    i += 10 + len
  }
  return out
}

/** A text frame: its encoding byte, then Latin-1, UTF-16 (with a BOM, or big-endian) or UTF-8. */
function text(body: Buffer) { return decode(body.subarray(1), body[0]).replace(/\0[\s\S]*$/, "").trim() }
function decode(b: Buffer, enc: number) {
  if (enc === 3) return b.toString("utf8")
  if (enc === 0) return b.toString("latin1")
  if (b[0] === 0xfe && b[1] === 0xff) return Buffer.from(b.subarray(2)).swap16().toString("utf16le")
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString("utf16le")
  return enc === 2 ? Buffer.from(b.subarray(0, b.length & ~1)).swap16().toString("utf16le") : b.toString("utf16le")
}

function picture(body: Buffer): Meta["cover"] {
  const enc = body[0], m = body.indexOf(0, 1)
  if (m < 0) return undefined
  const mime = body.toString("latin1", 1, m) || "image/jpeg"
  let i = m + 2 // (the picture type byte)
  if (enc === 1 || enc === 2) { while (i + 1 < body.length && (body[i] || body[i + 1])) i += 2; i += 2 } else { while (i < body.length && body[i]) i++; i++ }
  return i < body.length ? { mime: mime.includes("/") ? mime : `image/${mime.toLowerCase()}`, bytes: Buffer.from(body.subarray(i)) } : undefined
}
