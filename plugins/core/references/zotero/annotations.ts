import { children, type Conn, type ZoteroRow } from "./api.ts"
import type { ZoteroRef } from "../library.ts"

export type Html = (html: string) => Promise<string>

export function zoteroLink(ref: ZoteroRef, attachment = "", page = "") {
  const lib = ref.library.startsWith("groups/") ? `groups/${ref.library.slice(7)}` : "library"
  if (attachment) return `zotero://open-pdf/${lib}/items/${attachment}${page ? `?page=${encodeURIComponent(page)}` : ""}`
  return `zotero://select/${lib}/items/${ref.key}`
}

const quote = (text: string) => text.trim().split("\n").map((l) => `> ${l}`).join("\n")

function annotationLine(ref: ZoteroRef, att: string, a: ZoteroRow) {
  const d = a.data, page = d.annotationPageLabel ?? ""
  const where = page ? ` ([p. ${page}](${zoteroLink(ref, att, page)}))` : ` ([open](${zoteroLink(ref, att)}))`
  const parts: string[] = []
  if (d.annotationText?.trim()) parts.push(quote(`${d.annotationText.trim()}${where}`))
  if (d.annotationComment?.trim()) parts.push(d.annotationComment.trim() + (parts.length ? "" : where))
  return parts.join("\n\n")
}

export async function annotationsOf(conn: Conn, ref: ZoteroRef, html: Html): Promise<string> {
  const lib = { prefix: ref.library, name: "" }
  const kids = await children(conn, lib, ref.key)
  const notes: string[] = [], marks: string[] = []
  for (const k of kids) {
    if (k.data.itemType === "note" && k.data.note) notes.push((await html(k.data.note)).trim())
    if (k.data.itemType !== "attachment" || !/pdf|epub|html/i.test(k.data.contentType ?? "")) continue
    const anns = (await children(conn, lib, k.key)).filter((a) => a.data.itemType === "annotation")
    anns.sort((a, b) => (a.data.annotationSortIndex ?? "").localeCompare(b.data.annotationSortIndex ?? ""))
    for (const a of anns) { const line = annotationLine(ref, k.key, a); if (line) marks.push(line) }
  }
  const out: string[] = []
  if (marks.length) out.push(`## Annotations\n\n${marks.join("\n\n")}`)
  if (notes.length) out.push(`## Zotero notes\n\n${notes.join("\n\n---\n\n")}`)
  return out.join("\n\n")
}
