// /api/state as a patch since the state the app has, instead of megabytes again on every change. A patch is {set},
// {keys, drop} or {items: runs of old items and new ones}; what it leaves alone keeps its object, so nothing redraws.

/** A value as pieces of JSON: whole (its JSON), an object's keys, or an array's items (each one's JSON). */
export type Piece = string | { keys: Map<string, Piece> } | { items: string[] }
export type Patch = { set: unknown } | { keys: Record<string, Patch>; drop?: string[] } | { items: ([number, number] | [unknown])[] }

const isPlain = (x: unknown): x is Record<string, unknown> => {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false
  const proto = Object.getPrototypeOf(x)
  return proto === Object.prototype || proto === null
}
const json = (x: unknown) => JSON.stringify(x) ?? "null"

/** Each item's first index in an array of pieces (built once per array, when a patch is made from it). */
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
  if (Array.isArray(value)) {
    const was = prev !== undefined && typeof prev !== "string" && "items" in prev ? prev.items : null
    const at = was && indexOf(was)
    return { items: value.map((x) => { const j = json(x), i = at?.get(j); return i === undefined ? j : was![i] }) }
  }
  if (isPlain(value)) {
    const was = prev !== undefined && typeof prev !== "string" && "keys" in prev ? prev.keys : null
    const keys = new Map<string, Piece>()
    for (const [k, v] of Object.entries(value)) if (v !== undefined && typeof v !== "function") keys.set(k, snapshot(v, was?.get(k)))
    return { keys }
  }
  const j = json(value)
  return prev === j ? prev : j
}

/** The JSON of a value from its pieces. */
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
  if (typeof now === "string") return set()
  if ("items" in now) {
    if (typeof old === "string" || !("items" in old)) return set()
    const was = old.items
    if (now.items.length === was.length && now.items.every((j, i) => j === was[i])) return null
    const at = indexOf(was), out: string[] = []
    let start = -1, n = 0, reused = 0
    const flush = () => { if (n) out.push(`[${start},${n}]`); n = 0 }
    for (const j of now.items) {
      if (n && was[start + n] === j) { n++; reused++; continue }
      flush()
      const i = at.get(j)
      if (i === undefined) out.push(`[${j}]`)
      else { start = i; n = 1; reused++ }
    }
    flush()
    return reused ? `{"items":[${out.join(",")}]}` : set()
  }
  if (typeof old === "string" || !("keys" in old)) return set()
  // The keys come out in the same order: the old ones still there as they were, then the new ones.
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

/** The new value: `old` with the patch applied (patchOf's, parsed). What the patch didn't change is the same objects.
 *  Throws when the patch doesn't fit `old` (the caller then asks for the whole state). */
export function applyPatch(old: unknown, patch: Patch): unknown {
  if ("set" in patch) return patch.set
  if ("items" in patch) {
    if (!Array.isArray(old)) throw new Error("a patch of items, for something that isn't a list")
    const out: unknown[] = []
    for (const e of patch.items) {
      if (e.length === 1) { out.push(e[0]); continue }
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
