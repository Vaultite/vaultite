import type { Entry } from "./library.ts"
import { parseBibtex } from "./parse/bibtex.ts"
import { parseCslJson, parseCslYaml } from "./parse/csljson.ts"
import type { ParseResult } from "./parse/item.ts"
import { CslFields, readCslItem } from "./parse/normalize.ts"
import { parseRis } from "./parse/ris.ts"

export type VaultFiles = {
  others: () => Iterable<[string, string]>
  read: (rel: string) => string
  notes: () => Iterable<{ rel: string; fm: CslFields }>
}

export type FileState = { path: string; count: number; problems: string[] }

const PARSERS: [RegExp, (text: string) => ParseResult][] = [
  [/\.(bib|bibtex|biblatex)$/i, parseBibtex],
  [/\.ris$/i, parseRis],
  [/\.json$/i, parseCslJson],
  [/\.ya?ml$/i, parseCslYaml],
]
const AUTO = /\.(bib|bibtex|ris)$|\.csl\.(json|ya?ml)$|(^|\/)[^/]*(librar|bibliograph|references|zotero)[^/]*\.(json|ya?ml)$/i

export const isBibliography = (rel: string) => PARSERS.some(([re]) => re.test(rel))
export const foundOnItsOwn = (rel: string) => AUTO.test(rel)

const parsed = new Map<string, { stamp: string; result: ParseResult }>()

export function readBibliography(files: VaultFiles, rel: string, stamp: string): ParseResult {
  const had = parsed.get(rel)
  if (had && had.stamp === stamp) return had.result
  const parse = PARSERS.find(([re]) => re.test(rel))?.[1]
  let result: ParseResult
  try { result = parse ? parse(files.read(rel)) : { items: [], problems: ["Not a bibliography file (.bib, .json, .yaml or .ris)"] } }
  catch { result = { items: [], problems: ["Couldn't be read"] } }
  parsed.set(rel, { stamp, result })
  return result
}

export function fileEntries(files: VaultFiles, rels: string[], states: FileState[]): Entry[] {
  const stamps = new Map(files.others())
  const out: Entry[] = []
  for (const rel of rels) {
    const stamp = stamps.get(rel)
    if (stamp === undefined) { states.push({ path: rel, count: 0, problems: ["Not in the vault"] }); continue }
    const r = readBibliography(files, rel, stamp)
    states.push({ path: rel, count: r.items.length, problems: r.problems.slice(0, 20) })
    for (const item of r.items) out.push({ key: item.id, item, origin: "file", label: rel.split("/").pop() ?? rel, path: rel })
  }
  return out
}

export function bibliographyFiles(files: VaultFiles, listed: string[], auto: boolean): string[] {
  const out = new Set(listed.map((p) => p.replace(/^\/+/, "")))
  if (auto) for (const [rel] of files.others()) if (foundOnItsOwn(rel)) out.add(rel)
  return [...out]
}

export type NoteSource = { entries: Entry[]; notes: Map<string, string> }

export function noteEntries(files: VaultFiles): NoteSource {
  const entries: Entry[] = [], notes = new Map<string, string>()
  for (const { rel, fm } of files.notes()) {
    const key = String(fm.citekey ?? fm["citation-key"] ?? fm.id ?? "").trim() || (rel.split("/").pop() ?? "").replace(/\.md$/, "").replace(/^@/, "")
    if (!key || notes.has(key)) continue
    notes.set(key, rel)
    if (!fm.title) continue
    const read = readCslItem(fm, { id: key, typeKey: "item-type", cslOnly: true })
    if (read.item) entries.push({ key, item: read.item, origin: "note", label: rel.split("/").pop()?.replace(/\.md$/, "") ?? rel, path: rel })
  }
  return { entries, notes }
}

export function ownBibliographies(fm: CslFields[string] | undefined, from: string, exists: (rel: string) => boolean): string[] {
  const list = Array.isArray(fm) ? fm : fm ? [fm] : []
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : ""
  const out: string[] = []
  for (const raw of list) {
    const p = String(raw ?? "").trim().replace(/^\.\//, "")
    if (!p) continue
    const near = normal(dir + p)
    out.push(exists(near) ? near : normal(p))
  }
  return out
}

function normal(p: string) {
  const parts: string[] = []
  for (const s of p.split("/")) {
    if (s === "..") parts.pop()
    else if (s && s !== ".") parts.push(s)
  }
  return parts.join("/")
}
