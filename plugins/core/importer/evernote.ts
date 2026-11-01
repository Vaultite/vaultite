// Evernote's export (.enex: one notebook's notes as XML, attachments inside as base64): each note's title, dates, tags,
// source and attachments, its ENML body as Markdown with every <en-media> an embed of its attachment (by MD5).
import crypto from "node:crypto"
import { xmlDecode } from "../../../core/plugins.ts"
import { fromEnml, toMarkdown } from "./html.ts"

export type Resource = { name: string; mime: string; data: Buffer; hash: string }
export type EnNote = { title: string; created: number | null; updated: number | null; tags: string[]; source: string; author: string; html: string; resources: Resource[] }

const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml)
  return m ? text(m[1]) : ""
}
const text = (s: string) => {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s)
  return cdata ? cdata[1] : xmlDecode(s).trim()
}

/** "20261005T150405Z" as a time, or null. */
export function enDate(s: string): number | null {
  const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z?$/.exec(s.trim())
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null
}

const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "image/heic": "heic",
  "application/pdf": "pdf", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a", "video/mp4": "mp4", "text/plain": "txt",
}

function resource(xml: string, i: number): Resource {
  const data = Buffer.from(tag(xml, "data").replace(/\s+/g, ""), "base64")
  const mime = tag(xml, "mime") || "application/octet-stream"
  const given = tag(xml, "file-name")
  const name = given || `Attachment ${i + 1}.${EXT[mime] ?? mime.split("/")[1]?.replace(/[^\w]+/g, "") ?? "bin"}`
  return { name, mime, data, hash: crypto.createHash("md5").update(data).digest("hex") }
}

/** Every note in an .enex file's text. */
export function* readEnex(xml: string): Generator<EnNote> {
  if (!/<en-export\b/i.test(xml)) throw new Error("this isn't an Evernote export (.enex)")
  for (const m of xml.matchAll(/<note>([\s\S]*?)<\/note>/gi)) {
    const n = m[1]
    const attrs = /<note-attributes>([\s\S]*?)<\/note-attributes>/i.exec(n)?.[1] ?? ""
    const res = [...n.matchAll(/<resource>([\s\S]*?)<\/resource>/gi)].map((r, i) => resource(r[1], i))
    yield {
      title: tag(n, "title") || "Untitled", // (the note's own comes before its content)
      created: enDate(tag(n, "created")), updated: enDate(tag(n, "updated")),
      tags: [...n.matchAll(/<tag>([\s\S]*?)<\/tag>/gi)].map((t) => text(t[1])).filter(Boolean),
      source: tag(attrs, "source-url"), author: tag(attrs, "author"),
      html: tag(n, "content"), resources: res,
    }
  }
}

/** A note's body as Markdown, each attachment by `link` (given its resource). Ones the body never shows are listed at the
 *  end, so nothing is left behind. */
export function noteBody(note: EnNote, link: (r: Resource) => string) {
  const shown = new Set<string>()
  const byHash = new Map(note.resources.map((r) => [r.hash, r]))
  const md = toMarkdown(fromEnml(note.html), (hash) => {
    const r = byHash.get(hash.toLowerCase())
    if (!r) return null
    shown.add(r.hash)
    return link(r)
  })
  const rest = note.resources.filter((r) => !shown.has(r.hash)).map(link)
  return [md, ...rest].filter(Boolean).join("\n\n")
}
