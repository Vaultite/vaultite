import { citationsInLine } from "./cite.ts"
import { authorsShort, type CslItem, yearOf } from "./csl.ts"
import { formatKeys, markdownOf } from "./format.ts"
import { type Entry, type Library, lookup, search } from "./library.ts"
import { type NoteFormat, realCites, type References } from "./refs.ts"
import { localeXml } from "./styles.ts"
import type { Links, NoteAnswer, Row, Shown } from "./wire.ts"
import { zoteroLink } from "./zotero/annotations.ts"


const plain = (t: string) => t.replace(/<[^>]+>/g, "")
const ORIGINS = new Map([["note", "Reference note"], ["file", ""], ["zotero", "Zotero"], ["zotero-web", "Zotero (web)"]])

export function rowOf(lib: Library, e: Entry): Row {
  const it = e.item
  return { key: e.key, authors: authorsShort(it), year: yearOf(it), title: plain(it.title ?? ""), container: plain(it["container-title"] ?? ""),
    type: it.type, from: ORIGINS.get(e.origin) || e.label, note: lib.notes.get(e.key) ?? null }
}

export function linksOf(e: Entry): Links {
  const doi = e.item.DOI ? `https://doi.org/${e.item.DOI}` : ""
  return { doi, url: e.item.URL ?? "", zotero: e.zotero ? zoteroLink(e.zotero) : "" }
}

export function searchRows(refs: References, query: string, path = "", limit = 30): Row[] {
  const lib = refs.library(path)
  return search(lib, query, limit).map((e) => rowOf(lib, e))
}

export async function shownEntries(refs: References, keys: string[], path = "", style = ""): Promise<{ lib: Library; shown: Shown[]; missing: string[] }> {
  const lib = refs.library(path)
  const { style: s } = refs.styleFor(path, style)
  const known = new Map<string, CslItem>()
  for (const k of keys) { const e = lookup(lib, k); if (e) known.set(k, e.item) }
  const locales = { get: (l: string) => localeXml(refs.host, l), fallback: localeXml(refs.host, "en-US") ?? "" }
  const f = await formatKeys(s, refs.langFor(path), locales, known, keys)
  const shown = f.entries.flatMap((x) => {
    const e = lookup(lib, x.key)
    return e ? [{ ...rowOf(lib, e), html: x.html, links: linksOf(e) }] : []
  })
  return { lib, shown, missing: f.missing }
}

export function noteAnswer(lib: Library, f: NoteFormat): NoteAnswer {
  const entries = f.entries.flatMap((x) => {
    const e = lookup(lib, x.key)
    return e ? [{ ...rowOf(lib, e), html: x.html, links: linksOf(e) }] : []
  })
  const citations = f.cites.map((c, i) => ({ from: c.from, to: c.to, source: c.source, html: f.citations[i] ?? "", keys: c.items.map((it) => it.key) }))
  return { style: f.style, entries, missing: f.missing, hanging: f.hanging, numbered: f.numbered, citations, place: f.place }
}

export async function formatSources(refs: References, path: string, sources: string[]) {
  const lib = refs.library(path)
  const parsed = sources.map((s) => realCites(citationsInLine(s).slice(0, 1), lib)[0] ?? null)
  const cites = parsed.flatMap((c) => (c ? [c] : []))
  const { style, problem, own } = refs.styleFor(path)
  const f = await refs.format(style, refs.langFor(path), lib, cites)
  const answer = noteAnswer(lib, { ...f, style: { id: style.id, title: style.title, problem, own }, cites, place: "end" })
  let n = 0
  const html = parsed.map((c) => (c ? answer.citations[n++]?.html ?? "" : ""))
  return { ...answer, sources: html }
}

export const textOf = (html: string) => markdownOf(html)
