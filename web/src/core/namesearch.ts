import type { SearchDoc } from "@/core/plugins"
import { excerpt, marksOf, wordRanges } from "../../../core/searchquery.ts"
import { fuzzy } from "@/core/fuzzy"

export type Hit = SearchDoc & {
  marks: number[]; score: number
  metaMarks?: number[]
}
type Doc = SearchDoc

function shown(d: Doc, words: string[], inTitle: boolean) {
  const inMeta = wordRanges(d.meta, words)
  const rest = words.filter((w) => !d.title.toLowerCase().includes(w) && !d.meta.toLowerCase().includes(w))
  if (inTitle || !rest.length || !d.text) return { meta: d.meta, metaMarks: marksOf(inMeta) }
  const at = wordRanges(d.text, rest)
  if (!at.length) return { meta: d.meta, metaMarks: marksOf(inMeta) }
  const ex = excerpt(d.text, wordRanges(d.text, words).filter(([a]) => a >= at[0][0]), 140)
  const lead = d.archived ? "Archived · " : ""
  return { meta: lead + ex.text, metaMarks: marksOf(ex.ranges.map(([a, b]) => [a + lead.length, b + lead.length])) }
}

const hays = new WeakMap<Doc, string>()
const hayOf = (d: Doc) => { let h = hays.get(d); if (h === undefined) hays.set(d, h = `${d.title} ${d.text}`.toLowerCase()); return h }

export function search(docs: Doc[], query: string, limit = 40): Hit[] {
  const q = query.trim()
  if (!q) return []
  const words = q.toLowerCase().split(/\s+/)
  const out: Hit[] = []
  for (const d of docs) {
    const m = fuzzy(q, d.title)
    if (m) { out.push({ ...d, ...shown(d, words, true), marks: m.marks, score: m.score + (d.weight ?? 0) }); continue }
    const name = d.file?.split("/").pop()
    const n = name && name !== d.title && name.startsWith(d.title) ? fuzzy(q, name) : null
    if (n) { out.push({ ...d, ...shown(d, words, true), marks: n.marks.filter((i) => i < d.title.length), score: n.score + (d.weight ?? 0) }); continue }
    const hay = hayOf(d)
    if (words.every((w) => hay.includes(w))) {
      out.push({ ...d, ...shown(d, words, false), marks: marksOf(wordRanges(d.title, words)), score: 10 + (d.weight ?? 0) / 2 })
    }
  }
  const last = (h: Hit) => Number(!!h.archived) + Number(!!h.excluded)
  return out.sort((a, b) => last(a) - last(b) || b.score - a.score || b.recent - a.recent).slice(0, limit)
}
