// Obsidian reads these files too: edits keep their comments, order and unknown keys, in Obsidian's style.
import { isMap, isNode, isScalar, isSeq, parseDocument, type Document, type Node, type YAMLMap, type YAMLSeq } from "yaml"
import { keyOf } from "./query.ts"

type Obj = Record<string, unknown>

function doc(text: string): { d: Document; root: YAMLMap } {
  // Obsidian has written a key twice (columnSize): the last one counts.
  const d: Document = parseDocument(text || "{}", { uniqueKeys: false })
  if (d.errors.length) throw new Error(d.errors[0].message.split("\n")[0])
  if (isMap(d.contents)) return { d, root: d.contents }
  const root = d.createNode<Obj>({})
  d.contents = root
  return { d, root }
}
const out = (d: Document) => d.toString({ indent: 2, indentSeq: true, lineWidth: 0, flowCollectionPadding: false })

function views(d: Document): YAMLSeq {
  const vs = d.get("views")
  if (isSeq(vs) && vs.items.length) return vs
  const made = d.createNode([{ type: "table", name: "Table" }])
  d.set("views", made)
  return made
}

const viewAt = (d: Document, i: number) => { const v = views(d).items[i]; return isMap(v) ? v : null }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const js = (n: unknown): unknown => (isNode(n) ? n.toJSON() : n)
const plainObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v)

function merge(d: Document, node: unknown, value: unknown): Node {
  if (isNode(node) && same(js(node), value)) return node
  if (isSeq(node) && Array.isArray(value)) {
    const olds = [...node.items]
    const used = new Set<number>()
    const kept = value.map((v) => { const i = olds.findIndex((o, j) => !used.has(j) && same(js(o), v)); if (i >= 0) used.add(i); return i })
    node.items = value.map((v, k) => {
      if (kept[k] >= 0) return olds[kept[k]]
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
  return d.createNode(value)
}

function put(d: Document, m: YAMLMap, key: string, value: unknown) {
  if (value === undefined) {
    const at = m.items.findIndex((p) => js(p.key) === key), gone = m.items[at]
    const note = gone && isScalar(gone.key) ? gone.key.commentBefore : null
    m.delete(key)
    const next = m.items[at]
    if (note && next && isScalar(next.key)) next.key.commentBefore = next.key.commentBefore ? `${note}\n${next.key.commentBefore}` : note
    return
  }
  m.set(key, merge(d, m.get(key, true), value))
}

export function propId(key: string, written: string[]): string {
  const had = written.find((w) => keyOf(w) === key)
  if (had) return had
  if (key === "file") return "file.name"
  if (key === "path" || key === "folder") return `file.${key}`
  return key.startsWith("formula.") || key.startsWith("file.") ? key : `note.${key}`
}
function written(d: Document): string[] {
  const cfg: Obj | null = d.toJSON()
  const out: string[] = []
  const add = (v: unknown) => { if (typeof v === "string") out.push(v) }
  if (plainObj(cfg?.properties)) Object.keys(cfg.properties).forEach(add)
  for (const v of Array.isArray(cfg?.views) ? cfg.views : []) {
    if (!plainObj(v)) continue
    if (Array.isArray(v.order)) v.order.forEach(add)
    if (Array.isArray(v.sort)) for (const s of v.sort) if (plainObj(s)) add(s.property)
    for (const k of ["columnSize", "summaries"]) { const o = v[k]; if (plainObj(o)) Object.keys(o).forEach(add) }
    if (plainObj(v.groupBy)) add(v.groupBy.property)
  }
  return out
}

export function setSort(text: string, i: number, sort: { key: string; desc: boolean }[]): string {
  const { d } = doc(text)
  const v = viewAt(d, i)
  if (!v) return text
  const w = written(d)
  put(d, v, "sort", sort.length ? sort.map((s) => ({ property: propId(s.key, w), direction: s.desc ? "DESC" : "ASC" })) : undefined)
  return out(d)
}

export function setOrder(text: string, i: number, keys: string[]): string {
  const { d } = doc(text)
  const v = viewAt(d, i)
  if (!v) return text
  const w = written(d)
  put(d, v, "order", keys.map((k) => propId(k, w)))
  return out(d)
}

export function setColumnSize(text: string, i: number, key: string, px: number | null): string {
  const { d } = doc(text)
  const v = viewAt(d, i)
  if (!v) return text
  const was = v.toJSON<Obj>().columnSize, now = plainObj(was) ? was : {}
  const next: Obj = {}
  for (const [k, n] of Object.entries(now)) if (keyOf(k) !== key) next[k] = n
  if (px !== null) next[propId(key, [...Object.keys(now), ...written(d)])] = Math.round(px)
  const cs = v.get("columnSize", true)
  // Obsidian writes some keys twice.
  if (isMap(cs)) { const seen = new Set<string>(); cs.items = cs.items.reverse().filter((p) => { const k = String(js(p.key)); return !seen.has(k) && !!seen.add(k) }).reverse() }
  put(d, v, "columnSize", Object.keys(next).length ? next : undefined)
  return out(d)
}

export function setDisplayName(text: string, key: string, name: string): string {
  const { d, root } = doc(text)
  const cfg: Obj | null = d.toJSON(), props = plainObj(cfg?.properties) ? cfg.properties : {}
  const id = propId(key, written(d))
  const next = { ...props }
  const had = Object.keys(next).find((k) => keyOf(k) === key) ?? id
  const was = next[had], own: Obj = plainObj(was) ? { ...was } : {}
  if (name.trim()) own.displayName = name.trim()
  else delete own.displayName
  if (Object.keys(own).length) next[had] = own
  else delete next[had]
  put(d, root, "properties", Object.keys(next).length ? next : undefined)
  return out(d)
}

export function setSummary(text: string, i: number, key: string, name: string | null): string {
  const { d } = doc(text)
  const v = viewAt(d, i)
  if (!v) return text
  const was = v.toJSON<Obj>().summaries, now = plainObj(was) ? was : {}
  const next: Obj = {}
  for (const [k, n] of Object.entries(now)) if (keyOf(k) !== key) next[k] = n
  if (name) next[Object.keys(now).find((k) => keyOf(k) === key) ?? propId(key, written(d))] = name
  put(d, v, "summaries", Object.keys(next).length ? next : undefined)
  return out(d)
}

export function setFilters(text: string, i: number | null, filters: unknown): string {
  const { d, root } = doc(text)
  const m = i === null ? root : viewAt(d, i)
  if (!m) return text
  put(d, m, "filters", filters)
  return out(d)
}

export function setGroupBy(text: string, i: number, group: { key: string; desc: boolean } | null): string {
  const { d } = doc(text)
  const v = viewAt(d, i)
  if (!v) return text
  put(d, v, "groupBy", group ? { property: propId(group.key, written(d)), direction: group.desc ? "DESC" : "ASC" } : undefined)
  if (!group) put(d, v, "groupOrder", undefined)
  return out(d)
}

export function setGroupOrder(text: string, i: number, order: unknown[] | null): string {
  const { d } = doc(text)
  const v = viewAt(d, i)
  if (!v) return text
  put(d, v, "groupOrder", order ? order.map((x) => x ?? null) : undefined)
  return out(d)
}

export function setLimit(text: string, i: number, limit: number | null): string {
  const { d } = doc(text)
  const v = viewAt(d, i)
  if (!v) return text
  put(d, v, "limit", limit && limit > 0 ? Math.trunc(limit) : undefined)
  return out(d)
}

export function setFormula(text: string, name: string, expr: string | null): string {
  const { d, root } = doc(text)
  const cfg: Obj | null = d.toJSON(), now = plainObj(cfg?.formulas) ? cfg.formulas : {}
  const next: Obj = { ...now }
  if (expr === null) delete next[name]
  else next[name] = expr
  put(d, root, "formulas", Object.keys(next).length ? next : undefined)
  return out(d)
}

export function removeProperty(text: string, key: string): string {
  const { d, root } = doc(text)
  const cfg: Obj | null = d.toJSON()
  const named = (k: unknown) => typeof k === "string" && keyOf(k) === key
  const views: unknown[] = Array.isArray(cfg?.views) ? cfg.views : []
  views.forEach((v, i) => {
    const m = plainObj(v) ? viewAt(d, i) : null
    if (!m || !plainObj(v)) return
    if (Array.isArray(v.order) && v.order.some(named)) put(d, m, "order", v.order.filter((k) => !named(k)))
    if (Array.isArray(v.sort) && v.sort.some((s) => plainObj(s) && named(s.property))) {
      const rest = v.sort.filter((s) => !(plainObj(s) && named(s.property)))
      put(d, m, "sort", rest.length ? rest : undefined)
    }
    for (const k of ["columnSize", "summaries"]) {
      const o = v[k]
      if (!plainObj(o) || !Object.keys(o).some(named)) continue
      const rest = Object.fromEntries(Object.entries(o).filter(([x]) => !named(x)))
      put(d, m, k, Object.keys(rest).length ? rest : undefined)
    }
    if (plainObj(v.groupBy) && named(v.groupBy.property)) { put(d, m, "groupBy", undefined); put(d, m, "groupOrder", undefined) }
  })
  if (plainObj(cfg?.properties) && Object.keys(cfg.properties).some(named)) {
    const rest = Object.fromEntries(Object.entries(cfg.properties).filter(([x]) => !named(x)))
    put(d, root, "properties", Object.keys(rest).length ? rest : undefined)
  }
  return out(d)
}

export function setViewType(text: string, i: number, type: string): string {
  const { d } = doc(text)
  const v = views(d).items[i]
  if (!isMap(v)) return text
  v.set("type", type)
  return out(d)
}

export function addView(text: string, type: string, name: string, from?: number): string {
  const { d } = doc(text)
  const vs = views(d)
  const at = from === undefined ? undefined : vs.items[from], src = isMap(at) ? at.toJSON<Obj>() : {}
  const copy: Obj = { type, name }
  for (const k of ["filters", "order", "sort", "groupBy", "groupOrder", "summaries", "limit", "coordinates", "markerColor", "markerIcon"]) if (src[k] !== undefined) copy[k] = src[k]
  vs.add(d.createNode(copy))
  return out(d)
}

export function removeView(text: string, i: number): string {
  const { d } = doc(text)
  const vs = views(d)
  if (vs.items.length < 2 || i < 0 || i >= vs.items.length) return text
  vs.items.splice(i, 1)
  return out(d)
}

export function firstView(text: string, i: number): string {
  const { d } = doc(text)
  const vs = views(d)
  if (i <= 0 || i >= vs.items.length) return text
  const [v] = vs.items.splice(i, 1)
  vs.items.unshift(v)
  return out(d)
}

export function freeViewName(names: string[], base: string) {
  const taken = new Set(names.map((n) => n.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`
}
