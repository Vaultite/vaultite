// Bear's backup (.bear2bk: a zip of TextBundles, a note's text.markdown with its info.json and assets/): Bear's own
// Markdown made the vault's (::highlights::, #multi word tags#), its dates, and whether it's archived or trashed.

export type BearInfo = { id: string | null; created: number | null; updated: number | null; archived: boolean; trashed: boolean }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const time = (v: unknown) => { const t = typeof v === "string" ? Date.parse(v) : NaN; return Number.isNaN(t) ? null : t }

/** A bundle's info.json, Bear's part of it. */
export function bearInfo(v: unknown): BearInfo {
  const b = isObj(v) && isObj(v["net.shinyfrog.bear"]) ? v["net.shinyfrog.bear"] as Record<string, unknown> : {}
  return {
    id: typeof b.uniqueIdentifier === "string" ? b.uniqueIdentifier : null,
    created: time(b.creationDate), updated: time(b.modificationDate),
    archived: b.archived === true || b.archived === 1, trashed: b.trashed === true || b.trashed === 1,
  }
}

/** A note's text the vault's way, its title (its first heading, taken off) apart. Code is left as written. */
export function bearNote(md: string): { title: string; body: string } {
  const text = md.replace(/^﻿/, "").replace(/\r\n?/g, "\n")
  const first = /^\s*#\s+(.+)\n*/.exec(text)
  const title = first ? first[1].trim() : (text.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 80)
  const rest = first ? text.slice(first[0].length) : text
  const parts = rest.split(/(^```[\s\S]*?^```[^\n]*$|`[^`\n]+`)/m)
  const body = parts.map((p, i) => (i % 2 ? p : p
    .replace(/::([^:\n]+?)::/g, "==$1==")
    // (a tag with spaces is closed by a #: the vault's tags can't hold spaces)
    .replace(/(^|\s)#([^\s#][^#\n]*?[^\s#])#(?=\s|$)/g, (_, pre: string, t: string) => `${pre}#${t.replace(/\s+/g, "-")}`))).join("")
  return { title: title || "Untitled", body: body.trim() }
}
