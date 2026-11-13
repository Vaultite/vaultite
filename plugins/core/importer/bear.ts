// Bear's .bear2bk: a zip of TextBundles (text.markdown, info.json, assets/); its Markdown has ::highlights:: and #multi word tags#

export type BearInfo = { id: string | null; created: number | null; updated: number | null; archived: boolean; trashed: boolean }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const time = (v: unknown) => { const t = typeof v === "string" ? Date.parse(v) : NaN; return Number.isNaN(t) ? null : t }

export function bearInfo(v: unknown): BearInfo {
  const bear = isObj(v) ? v["net.shinyfrog.bear"] : undefined
  const b = isObj(bear) ? bear : {}
  return {
    id: typeof b.uniqueIdentifier === "string" ? b.uniqueIdentifier : null,
    created: time(b.creationDate), updated: time(b.modificationDate),
    archived: b.archived === true || b.archived === 1, trashed: b.trashed === true || b.trashed === 1,
  }
}

export function bearNote(md: string): { title: string; body: string } {
  const text = md.replace(/^﻿/, "").replace(/\r\n?/g, "\n")
  const first = /^\s*#\s+(.+)\n*/.exec(text)
  const title = first ? first[1].trim() : (text.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 80)
  const rest = first ? text.slice(first[0].length) : text
  const parts = rest.split(/(^```[\s\S]*?^```[^\n]*$|`[^`\n]+`)/m)
  const body = parts.map((p, i) => (i % 2 ? p : p
    .replace(/(?<![:\w])::(?=\S)([^:\n]+?)(?<=\S)::(?![:\w])/g, "==$1==")
    .replace(/(^|\s)#([^\s#][^#\n]*?[^\s#])#(?=\s|$)/g, (_, pre: string, t: string) => `${pre}#${t.replace(/\s+/g, "-")}`))).join("")
  return { title: title || "Untitled", body: body.trim() }
}
