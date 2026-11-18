import type { SearchDoc } from "@/core/plugins"
import { excerpt, marksOf, wordRanges } from "../../../core/searchquery.ts"
import { lowerFolded } from "../../../core/fold.ts"
import { fuzzy } from "@/core/fuzzy"

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

const hays = new WeakMap<Doc, string>()
const hayOf = (d: Doc) => { let h = hays.get(d); if (h === undefined) hays.set(d, h = lowerFolded(`${d.title} ${d.text}`)); return h }

export function search(docs: Doc[], query: string, limit = 40): Hit[] {
  const q = query.trim()
  if (!q) return []
  const words = lowerFolded(q).split(/\s+/)
  const out: Found[] = []
  for (const d of docs) {
    const m = fuzzy(q, d.title)
    const last = Number(!!d.archived) + Number(!!d.excluded)
    if (m) { out.push({ d, inTitle: true, marks: m.marks, score: m.score + (d.weight ?? 0), last }); continue }
    const name = d.file?.slice(d.file.lastIndexOf("/") + 1)
    const n = name && name !== d.title && name.startsWith(d.title) ? fuzzy(q, name) : null
    if (n) { out.push({ d, inTitle: true, marks: n.marks.filter((i) => i < d.title.length), score: n.score + (d.weight ?? 0), last }); continue }
    const hay = hayOf(d)
    if (words.every((w) => hay.includes(w))) out.push({ d, inTitle: false, marks: marksOf(wordRanges(d.title, words)), score: 10 + (d.weight ?? 0) / 2, last })
  }
  return out.sort((a, b) => a.last - b.last || b.score - a.score || b.d.recent - a.d.recent).slice(0, limit)
    .map(({ d, inTitle, marks, score }): Hit => ({ ...d, ...shown(d, words, inTitle), marks, score }))
}
