import { ranked, type QuerySuggestion, type QueryVocab } from "../../../core/searchquery.ts"
import type { VaultFile } from "@/core/files"

export type TagCount = { tag: string; count: number; only?: string }
export type Vocab = QueryVocab & { tagFiles: TagCount[] }

const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count

const kept = new WeakMap<VaultFile[], Vocab>()

export function vocabOf(files: VaultFile[]): Vocab {
  let v = kept.get(files)
  if (v) return v
  const tags = new Map<string, TagCount>(), types = new Map<string, number>(), folders = new Map<string, number>()
  for (const f of files) {
    if (f.excluded) continue
    for (const t of f.tags ?? []) {
      const k = t.toLowerCase(), had = tags.get(k)
      if (had) { had.count++; had.only = undefined } else tags.set(k, { tag: t, count: 1, only: f.path })
    }
    if (f.type) types.set(f.type, (types.get(f.type) ?? 0) + 1)
    for (let at = f.path.indexOf("/"); at > 0; at = f.path.indexOf("/", at + 1)) {
      const dir = f.path.slice(0, at)
      folders.set(dir, (folders.get(dir) ?? 0) + 1)
    }
  }
  const pairs = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])
  const tagFiles = [...tags.values()].sort(byCount)
  v = { tagFiles, tags: tagFiles.map((t) => [t.tag, t.count]), types: pairs(types), folders: pairs(folders) }
  kept.set(files, v)
  return v
}

export function fieldSuggestions(list: [string, number][], typed: string, has: string[] = [], max = 30): { from: number; to: number; items: QuerySuggestion[] } | null {
  const t = typed.trim().toLowerCase(), skip = new Set(has.map((h) => h.toLowerCase()))
  if (t && list.some(([v]) => v.toLowerCase() === t)) return null
  const items = ranked(list.filter(([v]) => !skip.has(v.toLowerCase())), t, max).map(([v, n]) => ({ label: v, detail: String(n), text: v }))
  return items.length ? { from: 0, to: typed.length, items } : null
}

export function valuesOf(rows: { path: string; value: unknown }[], except: string, near: (path: string) => boolean = () => false): [string, number][] {
  const counts = new Map<string, { v: string; n: number; near: number }>()
  for (const r of rows) {
    if (r.path === except) continue
    const close = near(r.path) ? 1 : 0
    for (const v of Array.isArray(r.value) ? r.value : [r.value]) {
      if (typeof v !== "string" && typeof v !== "number") continue
      const s = String(v).trim()
      if (!s || s.length > 80 || s.includes("\n")) continue
      const had = counts.get(s.toLowerCase())
      if (had) { had.n++; had.near += close } else counts.set(s.toLowerCase(), { v: s, n: 1, near: close })
    }
  }
  return [...counts.values()].sort((a, b) => b.near - a.near || b.n - a.n).map((c) => [c.v, c.n])
}

const typed = new WeakMap<VaultFile[], Map<string, string | null>>()
export function typesOf(files: VaultFile[]): Map<string, string | null> {
  let m = typed.get(files)
  if (!m) typed.set(files, m = new Map(files.map((f) => [f.path, f.type])))
  return m
}
