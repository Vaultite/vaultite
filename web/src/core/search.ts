import { useEffect, useMemo, useState } from "react"
import { FileText } from "lucide-react"
import type { Store } from "@/core/data"
import { kindIcon } from "@/core/filekinds"
import { folderOf, isHidden, stem } from "@/core/files"
import { active, formatFor, type SearchDoc } from "@/core/plugins"
import { getPrefs, usePrefs } from "@/core/prefs"
import { excerpt, marksOf, wordRanges } from "../../../core/searchquery.ts"
import { fuzzy } from "@/core/fuzzy"

export type Hit = SearchDoc & {
  marks: number[]; score: number
  metaMarks?: number[]
}
type Doc = SearchDoc

let built: { store: Store; disabled: string[]; docs: Doc[] } | null = null
function buildIndex(store: Store, disabled: string[]): Doc[] {
  const b = built
  if (b && b.store === store && b.disabled === disabled) return b.docs
  const docs = index(store, disabled)
  built = { store, disabled, docs }
  return docs
}
function index(store: Store, disabled: string[]): Doc[] {
  const docs: Doc[] = []
  for (const p of active(disabled)) {
    try { docs.push(...(p.search?.(store) ?? [])) } catch { /* a plugin's index failing must not break search */ }
  }
  const covered = new Set(docs.map((d) => d.file).filter(Boolean))
  for (const f of store.files?.files ?? []) {
    if (covered.has(f.path) || f.path.startsWith(".trash/")) continue
    const name = f.path.split("/").pop()!
    docs.push({ id: `file-${f.path}`, title: /\.md$/i.test(name) ? stem(f.path) : name, meta: folderOf(f.path).split("/").join(" / ") || "Top level", kind: "File", icon: FileText,
      tint: "var(--muted-foreground)", file: f.path, text: [folderOf(f.path), ...f.aliases].join(" "), recent: f.mtime, weight: 6 })
  }
  const archived = new Set((store.files?.files ?? []).filter((f) => f.archived).map((f) => f.path))
  const excluded = new Set([...store.files?.files ?? [], ...store.files?.others ?? []].filter((f) => f.excluded).map((f) => f.path))
  if (archived.size || excluded.size) for (let i = 0; i < docs.length; i++) {
    const d = docs[i]
    if (d.file && archived.has(d.file)) docs[i] = { ...d, archived: true, meta: d.meta ? `Archived · ${d.meta}` : "Archived" }
    if (d.file && excluded.has(d.file)) docs[i] = { ...docs[i], excluded: true }
  }
  for (const f of store.files?.others ?? []) {
    if (covered.has(f.path) || f.path.startsWith(".trash/")) continue
    docs.push({ id: `file-${f.path}`, title: f.path.split("/").pop()!, meta: folderOf(f.path).split("/").join(" / ") || "Top level", kind: "File",
      icon: formatFor(f.path, getPrefs().disabled)?.format.icon ?? kindIcon(f.path),
      tint: "var(--muted-foreground)", file: f.path, text: folderOf(f.path), recent: f.mtime, weight: 5, ...(f.excluded ? { excluded: true } : {}) })
  }
  return docs
}

export function useSearchIndex(store: Store): Doc[] {
  const { disabled } = usePrefs()
  const live = useMemo(() => active(disabled).filter((p) => p.searchLive), [disabled])
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const stops = live.map((p) => { try { return p.searchLive!.subscribe(() => setVersion((v) => v + 1)) } catch { return () => {} } })
    return () => stops.forEach((stop) => stop())
  }, [live])
  return useMemo(() => {
    const found = live.flatMap((p) => { try { return p.searchLive!.docs() } catch { return [] } })
    return [...buildIndex(store, disabled), ...found]
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` asks again when a plugin's live docs change
  }, [store, disabled, live, version])
}

function asHits(docs: Doc[], query: string): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return docs.map((d) => ({ ...d, marks: fuzzy(query, d.title)?.marks ?? marksOf(wordRanges(d.title, words)), metaMarks: marksOf(wordRanges(d.meta, words)), score: 0 }))
}

export function useQueried(query: string): { section: string; hits: Hit[] }[] {
  const { disabled } = usePrefs()
  const finders = useMemo(() => active(disabled).filter((p) => p.searchQuery?.find), [disabled])
  const [found, setFound] = useState<{ section: string; hits: Hit[] }[]>([])
  useEffect(() => {
    const q = query.trim()
    const set = (next: { section: string; hits: Hit[] }[]) => setFound((was) => (next.length || was.length ? next : was))
    if (!q || !finders.length) { set([]); return }
    let on = true
    const t = setTimeout(() => void Promise.all(finders.map((p) => p.searchQuery!.find!(q).then(
      (docs) => ({ section: p.searchQuery!.section ?? p.name, hits: asHits(docs, q) }), () => null)))
      .then((all) => { if (on) set(all.filter((g) => !!g?.hits.length) as { section: string; hits: Hit[] }[]) }), 150)
    return () => { on = false; clearTimeout(t) }
  }, [query, finders])
  return found
}

export function typedHits(query: string, disabled: string[], o: { complete: string | null; turn: number } = { complete: null, turn: 0 }): Hit[] {
  const q = query.trim()
  if (!q) return []
  return active(disabled).flatMap((p) => { try { return (p.searchQuery?.typed?.(q, o) ?? []).map((d) => ({ ...d, marks: [], score: 0 })) } catch { return [] } })
}

export async function completeTyped(query: string, disabled: string[]): Promise<string | null> {
  for (const p of active(disabled)) {
    const c = p.searchQuery?.complete && await p.searchQuery.complete(query).catch(() => null)
    if (c) return c
  }
  return null
}
export const typedTurns = (disabled: string[]) => active(disabled).find((p) => p.searchQuery?.turns)?.searchQuery?.turns ?? null
export const typedOwned = (query: string, disabled: string[]) => active(disabled).some((p) => { try { return !!p.searchQuery?.owns?.(query.trim()) } catch { return false } })

export function launcherText(disabled: string[]): string | null {
  for (const p of active(disabled)) { const t = p.searchQuery?.typed && p.searchQuery.launcher?.(); if (t) return t }
  return null
}

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

export const isRecentable = (path: string) => !isHidden(path) && path !== "AGENTS.md" && path !== "CLAUDE.md"

export function suggestions(docs: Doc[], opened: string[] = []): Hit[] {
  const pages = docs.filter((d) => d.kind === "Page")
  const byFile = new Map(docs.filter((d) => d.file && d.kind !== "Page" && !d.archived).map((d) => [d.file!, d]))
  const mine = opened.flatMap((p) => byFile.get(p) ?? []).slice(0, 6)
  const seen = new Set(mine.map((d) => d.file))
  const files = docs.filter((d) => d.file && d.recent && !d.archived && !d.excluded && isRecentable(d.file) && !seen.has(d.file)).sort((a, b) => b.recent - a.recent).slice(0, Math.max(3, 6 - mine.length))
  const shown = new Set([...mine, ...files].map((d) => d.file))
  return [...mine, ...files, ...pages.filter((d) => !shown.has(d.file))].map((d) => ({ ...d, marks: [], score: 0 }))
}
