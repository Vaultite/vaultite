import { authorsShort, bareDoi, type CslItem, searchText, yearOf } from "./csl.ts"

export type Origin = "note" | "file" | "zotero" | "zotero-web"
export type ZoteroRef = { library: string; key: string; web: boolean }
export type Entry = { key: string; item: CslItem; origin: Origin; label: string; path?: string; zotero?: ZoteroRef }

export type Library = {
  entries: Map<string, Entry>
  aliases: Map<string, string>
  notes: Map<string, string>
}

export const emptyLibrary = (): Library => ({ entries: new Map(), aliases: new Map(), notes: new Map() })

const doiOf = (item: CslItem) => bareDoi(item.DOI ?? "").toLowerCase()

export function unite(sources: Entry[][], notes: Map<string, string>): Library {
  const lib: Library = { entries: new Map(), aliases: new Map(), notes }
  const byDoi = new Map<string, string>()
  for (const source of sources) {
    for (const e of source) {
      if (lib.entries.has(e.key) || lib.aliases.has(e.key)) continue
      const doi = doiOf(e.item)
      const same = doi ? byDoi.get(doi) : undefined
      if (same) { lib.aliases.set(e.key, same); continue }
      lib.entries.set(e.key, e)
      if (doi) byDoi.set(doi, e.key)
    }
  }
  return lib
}

export function lookup(lib: Library, key: string): Entry | undefined {
  return lib.entries.get(key) ?? lib.entries.get(lib.aliases.get(key) ?? "")
}

export function itemsFor(lib: Library, keys: string[]): Map<string, CslItem> {
  const out = new Map<string, CslItem>()
  for (const k of keys) {
    const e = lookup(lib, k)
    if (e) out.set(k, e.item)
  }
  return out
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

function score(e: Entry, words: string[], q: string): number {
  const key = e.key.toLowerCase(), hay = fold(searchText(e.item))
  const authors = fold(authorsShort(e.item)), title = fold(e.item.title ?? "")
  let s = key === q ? 200 : key.startsWith(q) ? 120 : 0
  for (const w of words) {
    if (!hay.includes(w) && !key.includes(w)) return 0
    if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(authors)) s += 40
    else if (yearOf(e.item) === w) s += 30
    else if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(title)) s += 20
    else s += 5
  }
  return s
}

export function search(lib: Library, query: string, limit = 50): Entry[] {
  const q = fold(query.trim().replace(/^\[?-?@/, ""))
  const all = [...lib.entries.values()]
  if (!q) return all.sort((a, b) => yearOf(b.item).localeCompare(yearOf(a.item)) || a.key.localeCompare(b.key)).slice(0, limit)
  const words = q.split(/\s+/).filter(Boolean)
  const scored: [number, Entry][] = []
  for (const e of all) {
    const s = score(e, words, q)
    if (s > 0) scored.push([s, e])
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].key.localeCompare(b[1].key)).slice(0, limit).map(([, e]) => e)
}
