import type { SearchDoc } from "@/core/plugins"
import { excerpt, marksOf, wordRanges } from "../../../core/searchquery.ts"
import { lowerFolded } from "../../../core/fold.ts"
import { fuzzy, mayFind } from "@/core/fuzzy"

export type Hit = SearchDoc & {
  marks: number[]; score: number
  metaMarks?: number[]
}
type Doc = SearchDoc
type Found = { d: Doc; inTitle: boolean; marks: number[]; score: number; last: number }

function shown(d: Doc, words: string[], inTitle: boolean) {
  const inMeta = wordRanges(d.meta, words)
  const rest = words.filter((w) => !lowerFolded(d.title).includes(w) && !lowerFolded(d.meta).includes(w))
  if (inTitle || !rest.length || !d.text) return { meta: d.meta, metaMarks: marksOf(inMeta) }
  const at = wordRanges(d.text, rest)
  if (!at.length) return { meta: d.meta, metaMarks: marksOf(inMeta) }
  const ex = excerpt(d.text, wordRanges(d.text, words).filter(([a]) => a >= at[0][0]), 140)
  const lead = d.archived ? "Archived · " : ""
  return { meta: lead + ex.text, metaMarks: marksOf(ex.ranges.map(([a, b]) => [a + lead.length, b + lead.length])) }
}

type Prep = { title: string; name: string | null; file: string | null; hay: string }
const preps = new WeakMap<Doc, Prep>()
function prepOf(d: Doc): Prep {
  let p = preps.get(d)
  if (p) return p
  const file = d.file?.slice(d.file.lastIndexOf("/") + 1)
  const name = file && file !== d.title && file.startsWith(d.title) ? file : null
  preps.set(d, p = { title: lowerFolded(d.title), name: name && lowerFolded(name), file: name, hay: lowerFolded(`${d.title} ${d.text}`) })
  return p
}

export function search(docs: Doc[], query: string, limit = 40): Hit[] {
  return searchNames(docs, query).top(limit)
}

function foundIn(d: Doc, q: string, words: string[]): Found | null {
  const p = prepOf(d), last = Number(!!d.archived) + Number(!!d.excluded)
  const m = mayFind(q, p.title) ? fuzzy(q, d.title) : null
  if (m) return { d, inTitle: true, marks: m.marks, score: m.score + (d.weight ?? 0), last }
  const n = p.file && p.name && mayFind(q, p.name) ? fuzzy(q, p.file) : null
  if (n) return { d, inTitle: true, marks: n.marks.filter((i) => i < d.title.length), score: n.score + (d.weight ?? 0), last }
  return words.every((w) => p.hay.includes(w)) ? { d, inTitle: false, marks: [], score: 10 + (d.weight ?? 0) / 2, last } : null
}

export type Names = { total: number; top: (n: number) => Hit[] }
export function searchNames(docs: Doc[], query: string): Names {
  const q = query.trim()
  if (!q) return { total: 0, top: () => [] }
  const words = lowerFolded(q).split(/\s+/)
  const out: Found[] = []
  for (const d of docs) { const f = foundIn(d, q, words); if (f) out.push(f) }
  const sorted = out.sort((a, b) => a.last - b.last || b.score - a.score || b.d.recent - a.d.recent)
  return { total: sorted.length, top: (n) => sorted.slice(0, n).map(({ d, inTitle, marks, score }): Hit => ({ ...d, ...shown(d, words, inTitle), marks: inTitle ? marks : marksOf(wordRanges(d.title, words)), score })) }
}
