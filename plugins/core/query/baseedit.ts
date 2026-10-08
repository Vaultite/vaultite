// The app's changes to a .base as small edits on a YAML Document (comments, order and unknown keys kept), written in
// Obsidian's style so Obsidian still reads it.
import { isMap, isSeq, parseDocument, type Document } from "yaml"

function doc(text: string): Document {
  const d = parseDocument(text || "{}")
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
