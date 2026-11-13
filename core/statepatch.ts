import { applyEdit, editOf } from "./texthash.ts"

/** A value as pieces of JSON: whole (its JSON), an object's keys, or an array's items (each one's JSON). */
export type Piece = string | { keys: Map<string, Piece>; from?: object } | { items: string[]; from?: readonly unknown[] }
export type Patch = { set: unknown } | { keys: Record<string, Patch>; drop?: string[] } | { items: ([number, number] | [unknown] | [number, Patch])[] }
  | { edit: [number, number, string] }

const isPlain = (x: unknown): x is Record<string, unknown> => {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false
  const proto = Object.getPrototypeOf(x)
  return proto === Object.prototype || proto === null
}
// A frozen object's JSON is kept: it's the same object while what it shows is (the tree's rows), so an edit
// serializes only what changed.
const kept = new WeakMap<object, string>()
function json(x: unknown) {
  if (x === null || typeof x !== "object" || !Object.isFrozen(x)) return JSON.stringify(x) ?? "null"
  let j = kept.get(x)
  if (j === undefined) kept.set(x, j = JSON.stringify(x) ?? "null")
  return j
}

const indexes = new WeakMap<string[], Map<string, number>>()
function indexOf(items: string[]) {
  let at = indexes.get(items)
  if (!at) {
    at = new Map()
    for (let i = items.length - 1; i >= 0; i--) at.set(items[i], i)
    indexes.set(items, at)
  }
  return at
}

/** A value (JSON-safe: what the API answers) as pieces. With `prev`, the pieces of an earlier state, a piece that's
 *  the same is that one's string: kept once in memory, and compared at once. */
export function snapshot(value: unknown, prev?: Piece): Piece {
  if (prev !== undefined && typeof prev !== "string" && prev.from === value && Object.isFrozen(value)) return prev
  if (Array.isArray(value)) {
    const old = prev !== undefined && typeof prev !== "string" && "items" in prev ? prev : null, was = old?.items ?? null
    let at: Map<string, number> | null = null
    return { from: value, items: value.map((x, n) => {
      if (was && old!.from?.[n] === x && x !== null && typeof x === "object" && Object.isFrozen(x)) return was[n]
      const j = json(x)
      if (!was || was[n] === j || (x !== null && typeof x === "object" && Object.isFrozen(x))) return j
      const i = (at ??= indexOf(was)).get(j)
      return i === undefined ? j : was[i]
    }) }
  }
  if (isPlain(value)) {
    const was = prev !== undefined && typeof prev !== "string" && "keys" in prev ? prev.keys : null
    const keys = new Map<string, Piece>()
    for (const [k, v] of Object.entries(value)) if (v !== undefined && typeof v !== "function") keys.set(k, snapshot(v, was?.get(k)))
    return { keys, from: value }
  }
  const j = json(value)
  return prev === j ? prev : j
}

export function jsonOf(p: Piece): string {
  if (typeof p === "string") return p
  if ("items" in p) return `[${p.items.join(",")}]`
  const out: string[] = []
  for (const [k, v] of p.keys) out.push(`${JSON.stringify(k)}:${jsonOf(v)}`)
  return `{${out.join(",")}}`
}

/** The patch (as JSON) that makes `now` from `old`, or null when they're the same. */
export function patchOf(old: Piece, now: Piece): string | null {
  if (old === now) return null
  const set = () => `{"set":${jsonOf(now)}}`
  if (typeof now === "string") {
    if (typeof old !== "string" || now.length < LONG || now[0] !== '"' || old[0] !== '"') return set()
    const e = editOf(JSON.parse(old), JSON.parse(now)), p = `{"edit":[${e.at},${e.cut},${JSON.stringify(e.add)}]}`
    return p.length < now.length ? p : set()
  }
  if ("items" in now) {
    if (typeof old === "string" || !("items" in old)) return set()
    const was = old.items
    if (now.items.length === was.length && now.items.every((j, i) => j === was[i])) return null
    let at: Map<string, number> | null = null
    const out: string[] = []
    let start = -1, n = 0, reused = 0, pos = 0
    const flush = () => { if (n) out.push(`[${start},${n}]`); n = 0 }
    for (const j of now.items) {
      if (n && was[start + n] === j) { n++; reused++; pos = start + n; continue }
      flush()
      let i = -1
      for (let k = pos, end = Math.min(was.length, pos + 64); k < end; k++) if (was[k] === j) { i = k; break }
      if (i < 0 && was.length <= 5000) i = (at ??= indexOf(was)).get(j) ?? -1
      const edit = i < 0 && pos < was.length ? itemPatch(was[pos], j) : null
      if (edit) { out.push(`[${pos},${edit}]`); reused++; pos++ }
      else if (i < 0) out.push(`[${j}]`)
      else { start = i; n = 1; reused++; pos = i + 1 }
    }
    flush()
    return reused ? `{"items":[${out.join(",")}]}` : set()
  }
  if (typeof old === "string" || !("keys" in old)) return set()
  const kept = [...old.keys.keys()].filter((k) => now.keys.has(k)), order = [...now.keys.keys()]
  if (kept.some((k, i) => order[i] !== k)) return set()
  const parts: string[] = [], drop = [...old.keys.keys()].filter((k) => !now.keys.has(k))
  for (const [k, v] of now.keys) {
    const was = old.keys.get(k)
    const p = was === undefined ? `{"set":${jsonOf(v)}}` : patchOf(was, v)
    if (p !== null) parts.push(`${JSON.stringify(k)}:${p}`)
  }
  if (!parts.length && !drop.length) return null
  return `{"keys":{${parts.join(",")}}${drop.length ? `,"drop":${JSON.stringify(drop)}` : ""}}`
}

const LONG = 256
/** The patch of an item into the one in its place, when both are the same thing (the same `id` or `path`: a note
 *  edited) and the patch is the smaller; else null (it's sent whole). */
function itemPatch(old: string, now: string): string | null {
  if (now.length < LONG || old[0] !== "{" || now[0] !== "{") return null
  const a = JSON.parse(old), b = JSON.parse(now), id = (x: Record<string, unknown>) => x.id ?? x.path
  if (id(a) === undefined || id(a) !== id(b)) return null
  const p = patchOf(snapshot(a), snapshot(b))
  return p !== null && p.length < now.length ? p : null
}

/** The new value: `old` with the patch applied (patchOf's, parsed). What the patch didn't change is the same objects.
 *  Throws when the patch doesn't fit `old` (the caller then asks for the whole state). */
export function applyPatch(old: unknown, patch: Patch): unknown {
  if ("set" in patch) return patch.set
  if ("edit" in patch) {
    const [at, cut, add] = patch.edit, made = typeof old === "string" ? applyEdit(old, { at, cut, add }) : null
    if (made === null) throw new Error("an edit of a text that isn't there")
    return made
  }
  if ("items" in patch) {
    if (!Array.isArray(old)) throw new Error("a patch of items, for something that isn't a list")
    const out: unknown[] = []
    for (const e of patch.items) {
      if (e.length === 1) { out.push(e[0]); continue }
      if (typeof e[1] === "object") {
        const [i, p] = e as [number, Patch]
        if (!(i >= 0 && i < old.length)) throw new Error("a patch of an item that isn't there")
        out.push(applyPatch(old[i], p))
        continue
      }
      const [i, n] = e as [number, number]
      if (!(i >= 0 && n > 0 && i + n <= old.length)) throw new Error("a patch of items that aren't there")
      for (let k = i; k < i + n; k++) out.push(old[k])
    }
    return out
  }
  if (!isPlain(old)) throw new Error("a patch of keys, for something that isn't an object")
  const drop = new Set(patch.drop ?? [])
  const entries: [string, unknown][] = []
  for (const [k, v] of Object.entries(old)) {
    if (drop.has(k)) continue
    entries.push([k, Object.hasOwn(patch.keys, k) ? applyPatch(v, patch.keys[k]) : v])
  }
  for (const [k, p] of Object.entries(patch.keys)) if (!Object.hasOwn(old, k)) entries.push([k, applyPatch(undefined, p)])
  return Object.fromEntries(entries)
}
