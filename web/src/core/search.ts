// Search across the vault, fuzzy like fzf (letters in order, word starts and runs score higher; titles win). Archived
// files come last and never as suggestions; plugins add live things with `searchLive`.
import { useEffect, useMemo, useState } from "react"
import { FileText } from "lucide-react"
import type { Store } from "@/core/data"
import { kindIcon } from "@/core/filekinds"
import { folderOf, isHidden, stem } from "@/core/files"
import { active, formatFor, type SearchDoc } from "@/core/plugins"
import { getPrefs, usePrefs } from "@/core/prefs"
import { excerpt, marksOf, wordRanges } from "../../../core/searchquery.ts"

export type Hit = SearchDoc & {
  /** Indexes of matched characters in the title, for highlighting. */
  marks: number[]; score: number
  /** And in `meta` (which may be the part of its text around a word, when that's where it matched). */
  metaMarks?: number[]
}
type Doc = SearchDoc

const boundary = (s: string, i: number) => i === 0 || /[\s\-_/:.,(]/.test(s[i - 1]) || (/[a-z]/.test(s[i - 1]) && /[A-Z]/.test(s[i]))

/** fzf-style subsequence match. Returns the score and matched positions, or null. */
export function fuzzy(q: string, s: string): { score: number; marks: number[] } | null {
  if (!q) return { score: 0, marks: [] }
  const lq = q.toLowerCase(), ls = s.toLowerCase()
  // Prefer a contiguous hit when there is one (it's what people mean when they type a whole word).
  const at = ls.indexOf(lq)
  if (at >= 0) {
    const marks = [...lq].map((_, k) => at + k)
    return { score: 100 + lq.length * 6 + (boundary(s, at) ? 30 : 0) + (at === 0 ? 20 : 0) - s.length * 0.1, marks }
  }
  const marks: number[] = []
  let score = 0, run = 0, i = 0
  for (const c of lq) {
    if (c === " ") continue
    const j = ls.indexOf(c, i)
    if (j < 0) return null
    run = marks.length && j === marks[marks.length - 1] + 1 ? run + 1 : 0
    score += 1 + run * 3 + (boundary(s, j) ? 8 : 0) - Math.min(j - i, 10) * 0.3
    marks.push(j)
    i = j + 1
  }
  return { score: score - s.length * 0.1, marks }
}

/** Everything the quick switcher finds, once per store and settings (it's opened again and again, and the sidebar's
 *  search asks too). */
let built: { store: Store; disabled: string[]; order: string[]; docs: Doc[] } | null = null
function buildIndex(store: Store, disabled: string[], order: string[]): Doc[] {
  const b = built
  if (b && b.store === store && b.disabled === disabled && b.order === order) return b.docs
  const docs = index(store, disabled, order)
  built = { store, disabled, order, docs }
  return docs
}
function index(store: Store, disabled: string[], order: string[]): Doc[] {
  const docs: Doc[] = []
  for (const p of active(disabled, order)) {
    try { docs.push(...(p.search?.(store) ?? [])) } catch { /* a plugin's index failing must not break search */ }
  }
  // Every other file in the vault, by name (plugins index their own files better: a person with their context).
  const covered = new Set(docs.map((d) => d.file).filter(Boolean))
  for (const f of store.files?.files ?? []) {
    if (covered.has(f.path) || f.path.startsWith(".trash/")) continue
    const name = f.path.split("/").pop()!
    docs.push({ id: `file-${f.path}`, title: /\.md$/i.test(name) ? stem(f.path) : name, meta: folderOf(f.path).split("/").join(" / ") || "Top level", kind: "File", icon: FileText,
      tint: "var(--muted-foreground)", file: f.path, text: [folderOf(f.path), ...f.aliases].join(" "), recent: f.mtime, weight: 6 })
  }
  // What's archived: marked, and ranked last (search).
  const archived = new Set((store.files?.files ?? []).filter((f) => f.archived).map((f) => f.path))
  if (archived.size) for (let i = 0; i < docs.length; i++) {
    const d = docs[i]
    if (d.file && archived.has(d.file)) docs[i] = { ...d, archived: true, meta: d.meta ? `Archived · ${d.meta}` : "Archived" }
  }
  // And every file that isn't a note (code, images, PDFs), by its full name.
  for (const f of store.files?.others ?? []) {
    if (covered.has(f.path) || f.path.startsWith(".trash/")) continue
    docs.push({ id: `file-${f.path}`, title: f.path.split("/").pop()!, meta: folderOf(f.path).split("/").join(" / ") || "Top level", kind: "File",
      icon: formatFor(f.path, getPrefs().disabled)?.format.icon ?? kindIcon(f.path),
      tint: "var(--muted-foreground)", file: f.path, text: folderOf(f.path), recent: f.mtime, weight: 5 })
  }
  return docs
}

/** The index with what plugins find live (searchLive), followed while the component that asks is on screen. */
export function useSearchIndex(store: Store): Doc[] {
  const { disabled, order } = usePrefs()
  const live = useMemo(() => active(disabled, order).filter((p) => p.searchLive), [disabled, order])
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const stops = live.map((p) => { try { return p.searchLive!.subscribe(() => setVersion((v) => v + 1)) } catch { return () => {} } })
    return () => stops.forEach((stop) => stop())
  }, [live])
  return useMemo(() => {
    const found = live.flatMap((p) => { try { return p.searchLive!.docs() } catch { return [] } })
    return [...buildIndex(store, disabled, order), ...found]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, disabled, order, live, version])
}

/** A hit's grey text: `meta` with the words marked, or, when a word is in neither its title nor its meta, the part of
 *  its text around that word. */
function shown(d: Doc, words: string[], inTitle: boolean): { meta: string; metaMarks: number[] } {
  const inMeta = wordRanges(d.meta, words)
  const rest = words.filter((w) => !d.title.toLowerCase().includes(w) && !d.meta.toLowerCase().includes(w))
  if (inTitle || !rest.length || !d.text) return { meta: d.meta, metaMarks: marksOf(inMeta) }
  const at = wordRanges(d.text, rest)
  if (!at.length) return { meta: d.meta, metaMarks: marksOf(inMeta) }
  const ex = excerpt(d.text, wordRanges(d.text, words).filter(([a]) => a >= at[0][0]), 140)
  const lead = d.archived ? "Archived · " : ""
  return { meta: lead + ex.text, metaMarks: marksOf(ex.ranges.map(([a, b]) => [a + lead.length, b + lead.length])) }
}

export function search(docs: Doc[], query: string, limit = 40): Hit[] {
  const q = query.trim()
  if (!q) return []
  const words = q.toLowerCase().split(/\s+/)
  const out: Hit[] = []
  for (const d of docs) {
    const m = fuzzy(q, d.title)
    if (m) { out.push({ ...d, ...shown(d, words, true), marks: m.marks, score: m.score + (d.weight ?? 0) }); continue }
    // Its file name, extension included: marks past the title are left out.
    const name = d.file?.split("/").pop()
    const n = name && name !== d.title && name.startsWith(d.title) ? fuzzy(q, name) : null
    if (n) { out.push({ ...d, ...shown(d, words, true), marks: n.marks.filter((i) => i < d.title.length), score: n.score + (d.weight ?? 0) }); continue }
    // Not in the title: every word somewhere in the title or the text (not the grey text: every page's says "Page").
    const hay = `${d.title} ${d.text}`.toLowerCase()
    if (words.every((w) => hay.includes(w))) {
      out.push({ ...d, ...shown(d, words, false), marks: marksOf(wordRanges(d.title, words)), score: 10 + (d.weight ?? 0) / 2 })
    }
  }
  return out.sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || b.score - a.score || b.recent - a.recent).slice(0, limit)
}

/** Files that count as "recently changed" (the quick switcher's suggestions, a new tab's list): not the trash's or
 *  other hidden ones, nor the vault's AGENTS.md and CLAUDE.md (instructions for AIs, not notes). */
export const isRecentable = (path: string) => !isHidden(path) && path !== "AGENTS.md" && path !== "CLAUDE.md"

/** With an empty query: the files opened lately in this workspace (`opened`, newest first), then recently changed
 *  ones, then the pages. */
export function suggestions(docs: Doc[], opened: string[] = []): Hit[] {
  const pages = docs.filter((d) => d.kind === "Page")
  const byFile = new Map(docs.filter((d) => d.file && d.kind !== "Page" && !d.archived).map((d) => [d.file!, d]))
  const mine = opened.flatMap((p) => byFile.get(p) ?? []).slice(0, 6)
  const seen = new Set(mine.map((d) => d.file))
  const files = docs.filter((d) => d.file && d.recent && !d.archived && isRecentable(d.file) && !seen.has(d.file)).sort((a, b) => b.recent - a.recent).slice(0, Math.max(3, 6 - mine.length))
  const shown = new Set([...mine, ...files].map((d) => d.file))
  return [...mine, ...files, ...pages.filter((d) => !shown.has(d.file))].map((d) => ({ ...d, marks: [], score: 0 }))
}
