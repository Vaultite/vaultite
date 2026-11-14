import { stringify } from "yaml"
import { z } from "zod"
import { authorsShort, type CslItem, nameText, yearOf } from "./csl.ts"
import type { Entry } from "./library.ts"
import { zoteroLink } from "./zotero/annotations.ts"

export const DEFAULT_FOLDER = "Literature"

const SKIP = new Set(["id", "type", "citation-key", "abstract", "note", "keyword"])

type Front = Map<string, string | string[] | number>

function ownFields(fm: Front, it: CslItem) {
  fm.set("item-type", it.type)
  for (const [k, v] of Object.entries(it)) {
    if (SKIP.has(k) || fm.has(k)) continue
    if (k === "editor" || k === "translator") { const names: CslItem["author"] = it[k]; if (names?.length) fm.set(k, names.map(nameText)); continue }
    const text = z.string().safeParse(v)
    if (text.success && text.data.trim()) fm.set(k, text.data.replace(/<[^>]+>/g, ""))
  }
}

export function noteFrontmatter(e: Entry, own: boolean): string {
  const fm: Front = new Map([["type", "reference"], ["citekey", e.key]])
  const it = e.item
  if (it.title) fm.set("title", it.title.replace(/<[^>]+>/g, ""))
  if (it.author?.length) fm.set("author", it.author.map(nameText))
  const year = yearOf(it)
  if (year) fm.set("issued", /^\d+$/.test(year) ? Number(year) : year)
  if (own) ownFields(fm, it)
  return `---\n${stringify(Object.fromEntries(fm), { lineWidth: 0 }).trimEnd()}\n---\n`
}

export const DEFAULT_TEMPLATE = `> {{bibliography}}

## Summary

## Notes

{{annotations}}`

export type Fill = { bibliography: string; annotations: string }

export function fillTemplate(template: string, e: Entry, fill: Fill): string {
  const it = e.item, doi = it.DOI ? `https://doi.org/${it.DOI}` : ""
  const values = new Map([
    ["citekey", e.key], ["title", (it.title ?? "").replace(/<[^>]+>/g, "")], ["authors", authorsShort(it)], ["year", yearOf(it)],
    ["bibliography", fill.bibliography], ["doi", doi], ["url", it.URL ?? doi], ["zotero", e.zotero ? zoteroLink(e.zotero) : ""],
    ["annotations", fill.annotations], ["abstract", it.abstract ?? ""],
  ])
  return template.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (m, k: string) => values.get(k.toLowerCase()) ?? m).replace(/\n{3,}/g, "\n\n").trim() + "\n"
}

export const fileNameFor = (key: string) => key.replace(/[\\/:*?"<>|#^[\]]+/g, "-").replace(/^\.+/, "") || "reference"
