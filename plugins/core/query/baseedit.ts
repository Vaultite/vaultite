// The app's changes to a .base as small edits on a YAML Document (comments, order and unknown keys kept), written in
// Obsidian's style so Obsidian still reads it.
import { isMap, isScalar, isSeq, parseDocument, type Document, type Node, type YAMLMap } from "yaml"
import { keyOf } from "./query.ts"

function doc(text: string): Document {
  // (Obsidian has written a key twice (columnSize): read as the last, as the server does, and written once)
  const d = parseDocument(text || "{}", { uniqueKeys: false })
  if (d.errors.length) throw new Error(d.errors[0].message.split("\n")[0])
  if (d.contents === null || !isMap(d.contents)) d.contents = d.createNode({}) as unknown as typeof d.contents
  return d
}
const out = (d: Document) => d.toString({ indent: 2, indentSeq: true, lineWidth: 0, flowCollectionPadding: false })

/** The views list, made when the base has none (with the table a base shows then). */
function views(d: Document) {
  let vs = d.get("views")
  if (!isSeq(vs) || !vs.items.length) {
    d.set("views", d.createNode([{ type: "table", name: "Table" }]))
    vs = d.get("views")
  }
  return vs as import("yaml").YAMLSeq
}

/** View `i`'s map, or null. */
const viewAt = (d: Document, i: number) => { const v = views(d).items[i]; return isMap(v) ? v as YAMLMap : null }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const js = (n: unknown) => (n && typeof n === "object" && "toJSON" in n ? (n as { toJSON: () => unknown }).toJSON() : n)
const plainObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** `value` written over `node` keeping what didn't change (its comments, flow or block style, quotes): items that are
 *  the same keep their node wherever they move, maps change key by key. */
function merge(d: Document, node: unknown, value: unknown): Node {
  if (node && same(js(node), value)) return node as Node
  if (isSeq(node) && Array.isArray(value)) {
    const olds = [...node.items]
    const used = new Set<number>()
    const kept = value.map((v) => { const i = olds.findIndex((o, j) => !used.has(j) && same(js(o), v)); if (i >= 0) used.add(i); return i })
    node.items = value.map((v, k) => {
      if (kept[k] >= 0) return olds[kept[k]]
      // (an item changed in place: the old one at its place, merged)
      if (k < olds.length && !used.has(k)) { used.add(k); return merge(d, olds[k], v) }
      return d.createNode(v)
    })
    return node
  }
  if (isMap(node) && plainObj(value)) {
    for (const p of [...node.items]) { const k = String(js(p.key)); if (!(k in value)) node.delete(p.key) }
    for (const [k, v] of Object.entries(value)) node.set(k, merge(d, node.get(k, true), v))
    return node
  }
  if (isScalar(node) && typeof node.value === typeof value && value !== null && typeof value !== "object") { node.value = value; return node }
  return d.createNode(value) as Node
}

/** Set (undefined: remove) `key` of a map, merged over what's there. */
function put(d: Document, m: YAMLMap, key: string, value: unknown) {
  if (value === undefined) {
    // (a comment above the key stays, above what follows it)
    const at = m.items.findIndex((p) => js(p.key) === key), gone = m.items[at]
    const note = gone && isScalar(gone.key) ? gone.key.commentBefore : null
    m.delete(key)
    const next = m.items[at]
    if (note && next && isScalar(next.key)) next.key.commentBefore = next.key.commentBefore ? `${note}\n${next.key.commentBefore}` : note
    return
  }
  m.set(key, merge(d, m.get(key, true), value))
}

/** The name a column key is written by in this base: as it's written already (`status`, `note.status`), else Obsidian's
 *  way (`note.status`, `file.name`, `formula.left`). */
export function propId(key: string, written: string[]): string {
  const had = written.find((w) => keyOf(w) === key)
  if (had) return had
  if (key === "file") return "file.name"
  if (key === "path" || key === "folder") return `file.${key}`
  return key.startsWith("formula.") || key.startsWith("file.") ? key : `note.${key}`
}
/** Every property name written in a base (its views' order, sort, columnSize, summaries, groupBy; its properties). */
function written(d: Document): string[] {
  const cfg = d.toJSON() as Record<string, unknown> | null
  const out: string[] = []
  const add = (v: unknown) => { if (typeof v === "string") out.push(v) }
  if (plainObj(cfg?.properties)) Object.keys(cfg.properties).forEach(add)
  for (const v of Array.isArray(cfg?.views) ? cfg.views : []) {
    if (!plainObj(v)) continue
    if (Array.isArray(v.order)) v.order.forEach(add)
    if (Array.isArray(v.sort)) for (const s of v.sort) if (plainObj(s)) add(s.property)
    for (const k of ["columnSize", "summaries"]) if (plainObj(v[k])) Object.keys(v[k] as object).forEach(add)
    if (plainObj(v.groupBy)) add(v.groupBy.property)
  }
  return out
}

/** View `i`'s sort (`sort: [{property, direction}]`; none: removed). Keys are the engine's (query.ts keyOf). */
export function setSort(text: string, i: number, sort: { key: string; desc: boolean }[]): string {
  const d = doc(text)
  const v = viewAt(d, i)
  if (!v) return text
  const w = written(d)
  put(d, v, "sort", sort.length ? sort.map((s) => ({ property: propId(s.key, w), direction: s.desc ? "DESC" : "ASC" })) : undefined)
  return out(d)
}

/** View `i`'s columns, in order (`order`). */
export function setOrder(text: string, i: number, keys: string[]): string {
  const d = doc(text)
  const v = viewAt(d, i)
  if (!v) return text
  const w = written(d)
  put(d, v, "order", keys.map((k) => propId(k, w)))
  return out(d)
}

/** A column's width in view `i` (`columnSize: {note.price: 200}`, as Obsidian writes it; null: its own again). */
export function setColumnSize(text: string, i: number, key: string, px: number | null): string {
  const d = doc(text)
  const v = viewAt(d, i)
  if (!v) return text
  const now = plainObj(v.toJSON().columnSize) ? v.toJSON().columnSize as Record<string, unknown> : {}
  const next: Record<string, unknown> = {}
  for (const [k, n] of Object.entries(now)) if (keyOf(k) !== key) next[k] = n
  if (px !== null) next[propId(key, [...Object.keys(now), ...written(d)])] = Math.round(px)
  const cs = v.get("columnSize", true)
  // (written twice by Obsidian: the duplicates go)
  if (isMap(cs)) { const seen = new Set<string>(); cs.items = cs.items.reverse().filter((p) => { const k = String(js(p.key)); return !seen.has(k) && !!seen.add(k) }).reverse() }
  put(d, v, "columnSize", Object.keys(next).length ? next : undefined)
  return out(d)
}

/** A property's name in the base's columns (`properties: {note.x: {displayName}}`; "" removes it). */
export function setDisplayName(text: string, key: string, name: string): string {
  const d = doc(text)
  const props = plainObj(d.toJSON()?.properties) ? d.toJSON().properties as Record<string, unknown> : {}
  const id = propId(key, written(d))
  const next = { ...props }
  const had = Object.keys(next).find((k) => keyOf(k) === key) ?? id
  const own = plainObj(next[had]) ? { ...next[had] as Record<string, unknown> } : {}
  if (name.trim()) own.displayName = name.trim()
  else delete own.displayName
  if (Object.keys(own).length) next[had] = own
  else delete next[had]
  put(d, d.contents as YAMLMap, "properties", Object.keys(next).length ? next : undefined)
  return out(d)
}

/** View `i`'s summary of a column (`summaries: {formula.left: Sum}`; null: none). */
export function setSummary(text: string, i: number, key: string, name: string | null): string {
  const d = doc(text)
  const v = viewAt(d, i)
  if (!v) return text
  const now = plainObj(v.toJSON().summaries) ? v.toJSON().summaries as Record<string, unknown> : {}
  const next: Record<string, unknown> = {}
  for (const [k, n] of Object.entries(now)) if (keyOf(k) !== key) next[k] = n
  if (name) next[Object.keys(now).find((k) => keyOf(k) === key) ?? propId(key, written(d))] = name
  put(d, v, "summaries", Object.keys(next).length ? next : undefined)
  return out(d)
}

/** The filters of view `i`, or (null) of the whole base: an expression or an and / or / not tree (undefined: none). */
export function setFilters(text: string, i: number | null, filters: unknown): string {
  const d = doc(text)
  const m = i === null ? d.contents as YAMLMap : viewAt(d, i)
  if (!m) return text
  put(d, m, "filters", filters)
  return out(d)
}

/** Set view `i`'s layout (`type`). */
export function setViewType(text: string, i: number, type: string): string {
  const d = doc(text)
  const v = views(d).items[i]
  if (!isMap(v)) return text
  v.set("type", type)
  return out(d)
}

/** Add a view at the end (a copy of view `from`'s columns, sort and grouping, when given), named `name`. */
export function addView(text: string, type: string, name: string, from?: number): string {
  const d = doc(text)
  const vs = views(d)
  const src = from !== undefined && isMap(vs.items[from]) ? (vs.items[from] as import("yaml").YAMLMap).toJSON() as Record<string, unknown> : {}
  const copy: Record<string, unknown> = { type, name }
  for (const k of ["filters", "order", "sort", "groupBy", "summaries", "limit", "coordinates", "markerColor", "markerIcon"]) if (src[k] !== undefined) copy[k] = src[k]
  vs.add(d.createNode(copy))
  return out(d)
}

/** Remove view `i` (never the last one). */
export function removeView(text: string, i: number): string {
  const d = doc(text)
  const vs = views(d)
  if (vs.items.length < 2 || i < 0 || i >= vs.items.length) return text
  vs.items.splice(i, 1)
  return out(d)
}

/** Move view `i` to the front: the view an embed without `#View` shows, like Obsidian's (the first). */
export function firstView(text: string, i: number): string {
  const d = doc(text)
  const vs = views(d)
  if (i <= 0 || i >= vs.items.length) return text
  const [v] = vs.items.splice(i, 1)
  vs.items.unshift(v)
  return out(d)
}

/** A name for a new view that no other view has ("Table 2"). */
export function freeViewName(names: string[], base: string) {
  const taken = new Set(names.map((n) => n.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`
}
