import type { RawEntry } from "./bibtex-lexer.ts"

const NOT_INHERITED = new Set(["ids", "crossref", "xref", "xdata", "entryset", "entrysubtype", "execute", "label",
  "options", "presort", "related", "relatedoptions", "relatedstring", "relatedtype", "shorthand", "shorthandintro",
  "sortkey", "sortname", "sorttitle", "indextitle", "indexsorttitle"])
const IN_BOOK = new Set(["inbook", "incollection", "inproceedings", "conference", "bookinbook", "suppbook",
  "suppcollection", "inreference"])
const TITLES = ["title", "subtitle", "titleaddon", "shorttitle"]

type Resolver = { byKey: Map<string, RawEntry>; done: Set<RawEntry>; problems: string[] }

function renamed(child: RawEntry, parent: RawEntry): Map<string, string> {
  if (IN_BOOK.has(child.type) && parent.type.startsWith("mv")) {
    return new Map([["title", "maintitle"], ["subtitle", "mainsubtitle"], ["titleaddon", "maintitleaddon"]])
  }
  if (IN_BOOK.has(child.type)) {
    return new Map([["title", "booktitle"], ["subtitle", "booksubtitle"], ["titleaddon", "booktitleaddon"]])
  }
  if (child.type === "article" && parent.type === "periodical") {
    return new Map([["title", "journaltitle"], ["subtitle", "journalsubtitle"]])
  }
  return new Map()
}

function copyInto(child: RawEntry, parent: RawEntry, rename: Map<string, string>) {
  for (const [name, value] of parent.fields) {
    if (NOT_INHERITED.has(name) || (rename.size && TITLES.includes(name))) continue
    if (!child.fields.has(name)) child.fields.set(name, value)
  }
  for (const [from, to] of rename) {
    const value = parent.fields.get(from)
    if (value !== undefined && !child.fields.has(to)) child.fields.set(to, value)
  }
}

function parentOf(r: Resolver, child: RawEntry, key: string, field: string): RawEntry | undefined {
  const parent = r.byKey.get(key.trim().toLowerCase())
  if (!parent) r.problems.push(`"${child.key}" has ${field} "${key.trim()}", which isn't in the file`)
  return parent === child ? undefined : parent
}

function resolve(r: Resolver, entry: RawEntry, seen: Set<RawEntry>) {
  if (r.done.has(entry) || seen.has(entry)) return
  seen.add(entry)
  for (const key of (entry.fields.get("xdata") ?? "").split(",")) {
    const data = key.trim() ? parentOf(r, entry, key, "xdata") : undefined
    if (!data) continue
    resolve(r, data, seen)
    copyInto(entry, data, new Map())
  }
  const crossref = entry.fields.get("crossref") ?? ""
  const parent = crossref.trim() ? parentOf(r, entry, crossref, "crossref") : undefined
  if (parent) {
    resolve(r, parent, seen)
    copyInto(entry, parent, renamed(entry, parent))
  }
  r.done.add(entry)
}

export function inheritAll(entries: RawEntry[], problems: string[]) {
  const byKey = new Map<string, RawEntry>()
  for (const e of entries) if (!byKey.has(e.key.toLowerCase())) byKey.set(e.key.toLowerCase(), e)
  const r: Resolver = { byKey, done: new Set(), problems }
  for (const e of entries) resolve(r, e, new Set())
}
