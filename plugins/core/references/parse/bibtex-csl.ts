import { bareDoi, type CslItem } from "../csl.ts"
import type { RawEntry } from "./bibtex-lexer.ts"
import { anyDate, isoDate, yearDate } from "./dates.ts"
import { latexToUnicode, unescapeUrl } from "./latex.ts"
import { bibtexNames } from "./names.ts"
import { put } from "./item.ts"
import { bibtexTypeOf } from "./types.ts"

const TEXT: [string, string, boolean][] = [
  ["shorttitle", "title-short", true], ["journaltitle", "container-title", true], ["journal", "container-title", true],
  ["shortjournal", "container-title-short", true], ["series", "collection-title", true], ["volume", "volume", false],
  ["issue", "issue", false], ["pages", "page", false], ["edition", "edition", false], ["publisher", "publisher", false],
  ["institution", "publisher", false], ["school", "publisher", false], ["organization", "publisher", false],
  ["address", "publisher-place", false], ["location", "publisher-place", false], ["isbn", "ISBN", false],
  ["issn", "ISSN", false], ["abstract", "abstract", false], ["note", "note", false], ["chapter", "chapter-number", false],
  ["pagetotal", "number-of-pages", false], ["volumes", "number-of-volumes", false], ["version", "version", false],
  ["eventtitle", "event-title", true], ["venue", "event-place", false], ["pmid", "PMID", false],
  ["pmcid", "PMCID", false],
]
const NAMES: [string, string][] = [["author", "author"], ["editor", "editor"], ["translator", "translator"],
  ["bookauthor", "container-author"]]
const DATES: [string, string][] = [["urldate", "accessed"], ["eventdate", "event-date"], ["origdate", "original-date"]]
const CONTAINED = new Set(["chapter", "paper-conference", "entry", "entry-dictionary", "entry-encyclopedia"])
const ARTICLES = new Set(["article-journal", "article-magazine", "article-newspaper"])
const NUMBERED = new Set(["report", "patent", "standard", "legislation", "bill"])
const GENRES = new Map([["phdthesis", "PhD thesis"], ["mastersthesis", "Master's thesis"], ["mathesis", "Master's thesis"],
  ["candthesis", "Candidate thesis"], ["techreport", "Technical report"], ["resreport", "Research report"]])
const LANGS = new Map([["english", "en"], ["american", "en-US"], ["usenglish", "en-US"], ["british", "en-GB"],
  ["ukenglish", "en-GB"], ["german", "de"], ["ngerman", "de"], ["austrian", "de-AT"], ["french", "fr"],
  ["spanish", "es"], ["italian", "it"], ["portuguese", "pt"], ["brazil", "pt-BR"], ["brazilian", "pt-BR"],
  ["dutch", "nl"], ["swedish", "sv"], ["danish", "da"], ["norsk", "nb"], ["finnish", "fi"], ["polish", "pl"],
  ["czech", "cs"], ["russian", "ru"], ["greek", "el"], ["turkish", "tr"], ["japanese", "ja"], ["chinese", "zh"],
  ["korean", "ko"], ["catalan", "ca"], ["hungarian", "hu"], ["latin", "la"]])

type Entry = { fields: Map<string, string>; item: CslItem }

function text(e: Entry, field: string, protect = false): string {
  const raw = e.fields.get(field)
  return raw === undefined ? "" : latexToUnicode(raw, protect)
}


function typeOf(fields: Map<string, string>, entryType: string): string {
  const sub = (fields.get("entrysubtype") ?? "").toLowerCase()
  const type = bibtexTypeOf(entryType)
  if (type === "article-journal" && /newspaper/.test(sub)) return "article-newspaper"
  if (type === "article-journal" && /magazine/.test(sub)) return "article-magazine"
  if (entryType === "misc" && (fields.has("url") || /\\url|https?:/.test(fields.get("howpublished") ?? ""))) return "webpage"
  return type
}

function titles(e: Entry) {
  const title = text(e, "title", true), subtitle = text(e, "subtitle", true)
  put(e.item, "title", title && subtitle ? `${title}: ${subtitle}` : title)
  for (const [field, key, protect] of TEXT) put(e.item, key, text(e, field, protect))
  if (CONTAINED.has(e.item.type)) put(e.item, "container-title", text(e, "booktitle", true) || text(e, "maintitle", true))
  if (e.item.page) e.item.page = e.item.page.replace(/\s*(?:[-–]+)\s*/g, "–")
}

function numbers(e: Entry, entryType: string) {
  const number = text(e, "number"), type = e.item.type
  if (ARTICLES.has(type)) put(e.item, "issue", number)
  else if (e.fields.has("series") && !NUMBERED.has(type)) put(e.item, "collection-number", number)
  else put(e.item, "number", number)
  const genre = text(e, "type")
  put(e.item, "genre", GENRES.get(genre.toLowerCase()) ?? genre)
  put(e.item, "genre", GENRES.get(entryType))
}

function dates(e: Entry) {
  const date = text(e, "date")
  put(e.item, "issued", date ? isoDate(date) ?? anyDate(date) : yearDate(text(e, "year"), text(e, "month"), text(e, "day")))
  for (const [field, key] of DATES) {
    const value = text(e, field)
    put(e.item, key, value ? isoDate(value) ?? anyDate(value) : null)
  }
}

function links(e: Entry) {
  const doi = unescapeUrl(e.fields.get("doi") ?? "")
  put(e.item, "DOI", bareDoi(doi) || doi)
  put(e.item, "URL", unescapeUrl(e.fields.get("url") ?? ""))
  const how = e.fields.get("howpublished") ?? ""
  if (/\\url|^\s*https?:/.test(how)) put(e.item, "URL", unescapeUrl(how))
  else put(e.item, "publisher", latexToUnicode(how))
  const kind = (e.fields.get("eprinttype") ?? e.fields.get("archiveprefix") ?? "").toLowerCase()
  const eprint = (e.fields.get("eprint") ?? "").replace(/^\s*arxiv:/i, "").trim()
  if (kind !== "arxiv" || !eprint) return
  put(e.item, "number", `arXiv:${eprint}`)
  put(e.item, "URL", `https://arxiv.org/abs/${eprint}`)
  if (!e.item["container-title"] && (e.item.type === "document" || e.item.type === "article-journal")) {
    e.item.type = "article"
    put(e.item, "publisher", "arXiv")
  }
}

function extras(e: Entry) {
  const lang = text(e, "langid") || text(e, "language")
  put(e.item, "language", LANGS.get(lang.toLowerCase()) ?? lang)
  put(e.item, "keyword", text(e, "keywords").replace(/\s*[;,]\s*/g, ", "))
  for (const [field, key] of NAMES) put(e.item, key, bibtexNames(e.fields.get(field) ?? ""))
}

export function entryToCsl(entry: RawEntry): CslItem {
  const e: Entry = { fields: entry.fields, item: { id: entry.key, type: typeOf(entry.fields, entry.type) } }
  titles(e)
  numbers(e, entry.type)
  dates(e)
  links(e)
  extras(e)
  return e.item
}
