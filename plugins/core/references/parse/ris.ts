import { bareDoi, type CslDate, type CslItem, type CslName } from "../csl.ts"
import { type ParseResult, put } from "./item.ts"
import { anyDate } from "./dates.ts"
import { makeKey } from "./keys.ts"
import { plainName, toList } from "./names.ts"

type RisRecord = Map<string, string[]>

const TYPES = new Map([
  ["JOUR", "article-journal"], ["JFULL", "article-journal"], ["EJOUR", "article-journal"], ["ABST", "article-journal"],
  ["INPR", "article-journal"], ["MGZN", "article-magazine"], ["NEWS", "article-newspaper"], ["BOOK", "book"],
  ["EBOOK", "book"], ["EDBOOK", "book"], ["SER", "book"], ["CTLG", "book"], ["CHAP", "chapter"], ["ECHAP", "chapter"],
  ["CONF", "paper-conference"], ["CPAPER", "paper-conference"], ["THES", "thesis"], ["RPRT", "report"],
  ["GOVDOC", "report"], ["ELEC", "webpage"], ["WEB", "webpage"], ["BLOG", "post-weblog"], ["GEN", "document"],
  ["DATA", "dataset"], ["DBASE", "dataset"], ["AGGR", "dataset"], ["COMP", "software"], ["PAT", "patent"],
  ["MAP", "map"], ["UNPB", "manuscript"], ["MANSCPT", "manuscript"], ["PCOMM", "personal_communication"],
  ["ICOMM", "personal_communication"], ["STAND", "standard"], ["STAT", "legislation"], ["LEGAL", "legislation"],
  ["BILL", "bill"], ["CASE", "legal_case"], ["HEAR", "hearing"], ["ENCYC", "entry-encyclopedia"],
  ["DICT", "entry-dictionary"], ["VIDEO", "motion_picture"], ["MPCT", "motion_picture"], ["ADVS", "motion_picture"],
  ["SOUND", "song"], ["AUDIO", "song"], ["MUSIC", "musical_score"], ["ART", "graphic"], ["FIGURE", "figure"],
  ["CHART", "figure"], ["SLIDE", "speech"], ["PAMP", "pamphlet"], ["CLSWK", "classic"], ["ANCIENT", "classic"],
])
const TEXT: [string, string][] = [
  ["TI", "title"], ["T1", "title"], ["CT", "title"], ["ST", "title-short"], ["T2", "container-title"],
  ["JF", "container-title"], ["JO", "container-title"], ["J2", "container-title-short"], ["JA", "container-title-short"],
  ["T3", "collection-title"], ["VL", "volume"], ["SP", "page"], ["PB", "publisher"], ["CY", "publisher-place"],
  ["PP", "publisher-place"], ["AB", "abstract"], ["N2", "abstract"], ["N1", "note"], ["LA", "language"],
  ["ET", "edition"], ["M3", "genre"], ["C3", "event-title"],
]
const NAMES: [string, string][] = [["AU", "author"], ["A1", "author"], ["ED", "editor"], ["A2", "editor"],
  ["A3", "collection-editor"], ["A4", "translator"]]
const CONTAINED = new Set(["chapter", "paper-conference", "entry-encyclopedia", "entry-dictionary"])
const NUMBERED = new Set(["report", "patent", "standard", "bill", "legislation"])
const LINE = /^([A-Z][A-Z0-9])\s{1,2}-\s?(.*)$/
const CITEKEY = /^[A-Za-z][\w:.+\-/]*$/

function records(text: string): RisRecord[] {
  const out: RisRecord[] = []
  let current: RisRecord | null = null, last = ""
  for (const line of text.replace(/^﻿/, "").split(/\r\n?|\n/)) {
    const m = LINE.exec(line)
    if (!m) {
      const list = current?.get(last)
      if (list?.length && line.trim()) list[list.length - 1] += ` ${line.trim()}`
      continue
    }
    const [, tag, value] = m
    if (tag === "TY") out.push((current = new Map()))
    if (tag === "ER") current = null
    if (!current || tag === "ER") continue
    current.set(tag, [...current.get(tag) ?? [], value.trim()])
    last = tag
  }
  return out
}

function first(r: RisRecord, tag: string): string {
  return r.get(tag)?.find(Boolean) ?? ""
}


function risDate(text: string): CslDate | null {
  const m = /^(\d{4})(?:\/(\d{0,2})(?:\/(\d{0,2}))?)?/.exec(text.trim())
  if (!m) return anyDate(text)
  const parts = [Number(m[1])]
  if (m[2]) parts.push(Number(m[2]))
  if (m[2] && m[3]) parts.push(Number(m[3]))
  return { "date-parts": [parts] }
}

function bestDate(r: RisRecord): CslDate | null {
  const full = risDate(first(r, "DA")), year = risDate(first(r, "PY") || first(r, "Y1"))
  const length = (d: CslDate | null) => d?.["date-parts"]?.[0]?.length ?? 0
  return length(full) >= length(year) && full ? full : year
}

function standardNumbers(item: CslItem, r: RisRecord) {
  const numbers = (r.get("SN") ?? []).flatMap((v) => v.split(/[\s;,]+/)).filter(Boolean)
  const issn = numbers.some((n) => /^\d{4}-?\d{3}[\dXx]$/.test(n))
  put(item, issn ? "ISSN" : "ISBN", numbers.join(", "))
}

function fill(item: CslItem, r: RisRecord) {
  for (const [tag, key] of TEXT) put(item, key, first(r, tag))
  const book = first(r, "BT")
  put(item, CONTAINED.has(item.type) ? "container-title" : "title", book)
  const end = first(r, "EP")
  if (item.page && end && !/[-–]/.test(item.page)) item.page = `${item.page}–${end}`
  put(item, NUMBERED.has(item.type) ? "number" : "issue", first(r, "IS"))
  put(item, "issued", bestDate(r))
  put(item, "accessed", risDate(first(r, "Y2")))
  const doi = first(r, "DO")
  put(item, "DOI", bareDoi(doi) || doi)
  put(item, "URL", first(r, "UR").split(/\s+/)[0])
  standardNumbers(item, r)
  put(item, "keyword", (r.get("KW") ?? []).flatMap((k) => k.split(/\s*;\s*/)).filter(Boolean).join(", "))
  for (const [tag, key] of NAMES) put(item, key, (r.get(tag) ?? []).flatMap((n): CslName[] => toList(plainName(n, "literal"))))
}

export function parseRis(text: string): ParseResult {
  const items: CslItem[] = [], problems: string[] = [], taken = new Set<string>()
  for (const r of records(text)) {
    const ty = first(r, "TY").toUpperCase()
    const type = TYPES.get(ty)
    if (!type) problems.push(`An RIS record has type "${ty}", read as a document`)
    const item: CslItem = { id: "", type: type ?? "document" }
    fill(item, r)
    const id = first(r, "ID")
    item.id = CITEKEY.test(id) && !taken.has(id) ? id : makeKey(item, taken)
    taken.add(item.id)
    items.push(item)
  }
  if (!items.length && text.trim()) problems.push("No RIS records found (each starts with a TY line)")
  return { items, problems }
}
