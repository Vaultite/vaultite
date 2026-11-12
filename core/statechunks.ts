// The vault's state as chunks named by their content (GET /api/state/manifest, /api/state/chunk/<hash>), so a page
// keeps them in its cache and a load fetches only the ones that changed. No Node: the web assembles them.
import type { Piece } from "./statepatch.ts"

/** How the state is made of chunks: a value whose JSON is one chunk, an array that is its chunks' arrays one after
 *  another, or an object with its big keys apart and the rest (`r`) in one chunk, its keys in their order (`k`). */
export type ChunkNode = { j: string } | { a: string[] } | { o: Record<string, ChunkNode>; r?: string; k: string[] }
export type Manifest = { v: string; tree: ChunkNode; live?: unknown; here?: string }
/** A state smaller than this comes whole (as `?since=0` does): the round trip its chunks take costs more than they save. */
export const WHOLE_UNDER = 1 << 20

/** Under this, a value is one chunk: smaller ones cost a request each for little. */
const MIN = 16 << 10
/** An array's chunks end after an item with the odds of its size in this (by its id's hash): about this much a chunk,
 *  and where they end follows the items, not their places, so an item added or changed changes its own chunk only. */
const TARGET = 48 << 10
const MAX = 256 << 10

/** FNV-1a over a string's UTF-16 units (where chunks end; not their names). */
function fnv(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}

const sizes = new WeakMap<object, number>()
/** A piece's JSON length, without making it. */
export function sizeOf(p: Piece): number {
  if (typeof p === "string") return p.length
  const known = sizes.get(p)
  if (known !== undefined) return known
  let n = 2
  if ("items" in p) for (const it of p.items) n += it.length + 1
  else for (const [k, v] of p.keys) n += k.length + 4 + sizeOf(v)
  sizes.set(p, n)
  return n
}
function jsonOf(p: Piece): string {
  if (typeof p === "string") return p
  if ("items" in p) return `[${p.items.join(",")}]`
  return `{${[...p.keys].map(([k, v]) => `${JSON.stringify(k)}:${jsonOf(v)}`).join(",")}}`
}
/** What an item is, wherever it moves: its id or path, else its JSON. */
function idOf(item: unknown, json: string) {
  const o = item as { id?: unknown; path?: unknown } | null
  return typeof o?.id === "string" ? o.id : typeof o?.path === "string" ? o.path : json
}

/** The state's pieces (statepatch.ts) as chunks: each chunk's text put in `chunks` under its name (`name(text)`). */
export function chunkState(p: Piece, name: (text: string) => string, chunks: Map<string, string>, depth = 0): ChunkNode {
  const put = (text: string) => { const h = name(text); chunks.set(h, text); return h }
  if (typeof p === "string" || depth > 3 || sizeOf(p) < MIN) return { j: put(jsonOf(p)) }
  if ("items" in p) {
    const a: string[] = []
    let run: string[] = [], len = 0
    p.items.forEach((it, n) => {
      run.push(it); len += it.length + 1
      if (fnv(idOf(p.from?.[n], it)) / 2 ** 32 < it.length / TARGET || len >= MAX) { a.push(put(`[${run.join(",")}]`)); run = []; len = 0 }
    })
    if (run.length) a.push(put(`[${run.join(",")}]`))
    return { a }
  }
  const o: Record<string, ChunkNode> = {}, rest: string[] = []
  for (const [k, v] of p.keys) {
    if (sizeOf(v) >= MIN) o[k] = chunkState(v, name, chunks, depth + 1)
    else rest.push(`${JSON.stringify(k)}:${jsonOf(v)}`)
  }
  const k = [...p.keys.keys()]
  return rest.length ? { o, r: put(`{${rest.join(",")}}`), k } : { o, k }
}

/** Every chunk a tree names, in order. */
export function chunksOf(n: ChunkNode): string[] {
  if ("j" in n) return [n.j]
  if ("a" in n) return n.a
  return [...(n.r ? [n.r] : []), ...Object.values(n.o).flatMap(chunksOf)]
}

/** The value a tree makes of its chunks (each one's value, parsed). */
export function assemble(n: ChunkNode, chunk: (hash: string) => unknown): unknown {
  if ("j" in n) return chunk(n.j)
  if ("a" in n) return n.a.flatMap((h) => chunk(h) as unknown[])
  const rest = (n.r ? chunk(n.r) : {}) as Record<string, unknown>, out: Record<string, unknown> = {}
  for (const k of n.k) out[k] = k in n.o ? assemble(n.o[k], chunk) : rest[k]
  return out
}
