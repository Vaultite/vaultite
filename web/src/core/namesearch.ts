import type { SearchDoc } from "@/core/plugins"
import { excerpt, marksOf, wordRanges } from "../../../core/searchquery.ts"
import { lowerFolded } from "../../../core/fold.ts"
import { fuzzy, leadsOf, mayFind, warmName } from "@/core/fuzzy"

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

type Prep = { title: string; name: string | null; file: string | null; hay: string; mask: number }
const preps = new WeakMap<Doc, Prep>(), prepped = new WeakMap<Doc[], Prep[]>()
const maskOf = (s: string) => {
  let m = 0
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 97 && c <= 122) m |= 1 << (c - 97); else if (c >= 48 && c <= 57) m |= 1 << (26 + ((c - 48) % 5)) }
  return m
}
function prepOf(d: Doc): Prep {
  let p = preps.get(d)
  if (p) return p
  const file = d.file?.slice(d.file.lastIndexOf("/") + 1)
  const name = file && file !== d.title && file.startsWith(d.title) ? file : null
  const title = lowerFolded(d.title), low = name && lowerFolded(name), hay = lowerFolded(`${d.title} ${d.text}`)
  preps.set(d, p = { title, name: low, file: name, hay, mask: maskOf(`${hay} ${low ?? ""}`) })
  return p
}
function prepsOf(docs: Doc[]): Prep[] {
  let ps = prepped.get(docs)
  if (!ps) prepped.set(docs, ps = docs.map(prepOf))
  return ps
}

type Left = () => number
const idle = (fn: (left: Left) => void): (() => void) => {
  if ("requestIdleCallback" in window) { const t = requestIdleCallback((d) => fn(() => d.timeRemaining())); return () => cancelIdleCallback(t) }
  const t = setTimeout(() => { const at = performance.now(); fn(() => 5 - (performance.now() - at)) }, 50)
  return () => clearTimeout(t)
}

export function warmNames(docs: Doc[]): () => void {
  let i = 0, cancel = () => {}
  const step = (left: Left) => {
    for (; i < docs.length && left() > 1; i++) { const d = docs[i], p = prepOf(d); warmName(d.title); if (p.file) warmName(p.file) }
    if (i < docs.length) cancel = idle(step)
    else prepsOf(docs)
  }
  cancel = idle(step)
  return () => cancel()
}

export function search(docs: Doc[], query: string, limit = 40): Hit[] {
  return searchNames(docs, query).top(limit)
}

function foundIn(d: Doc, p: Prep, q: string, words: string[]): Found | null {
  const last = Number(!!d.archived) + Number(!!d.excluded)
  const named = !p.name || mayFind(q, p.name)
  const m = named ? fuzzy(q, d.title, p.title) : null
  if (m) return { d, inTitle: true, marks: m.marks, score: m.score + (d.weight ?? 0), last }
  const n = named && p.file ? fuzzy(q, p.file, p.name ?? undefined) : null
  if (n) return { d, inTitle: true, marks: n.marks.filter((i) => i < d.title.length), score: n.score + (d.weight ?? 0), last }
  return words.every((w) => p.hay.includes(w)) ? { d, inTitle: false, marks: [], score: 10 + (d.weight ?? 0) / 2, last } : null
}

export type Names = { total: number; top: (n: number) => Hit[] }
export function searchNames(docs: Doc[], query: string): Names {
  const q = query.trim()
  if (!q) return { total: 0, top: () => [] }
  const words = lowerFolded(q).split(/\s+/)
  const out: Found[] = []
  const ps = prepsOf(docs), need = maskOf(leadsOf(q).join(""))
  docs.forEach((d, i) => { const f = (ps[i].mask & need) === need ? foundIn(d, ps[i], q, words) : null; if (f) out.push(f) })
  const sorted = out.sort((a, b) => a.last - b.last || b.score - a.score || b.d.recent - a.d.recent)
  return { total: sorted.length, top: (n) => sorted.slice(0, n).map(({ d, inTitle, marks, score }): Hit => ({ ...d, ...shown(d, words, inTitle), marks: inTitle ? marks : marksOf(wordRanges(d.title, words)), score })) }
}
