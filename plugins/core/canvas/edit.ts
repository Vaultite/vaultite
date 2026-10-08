// Canvas edits from menus and keys as pure canvas -> canvas functions (so the board can undo them); copy and paste is
// JSON Canvas text, so it pastes between canvases and into Obsidian.
import { inside, newId, type CanvasDoc, type CanvasEdge, type CanvasNode } from "./codec.ts"

const taken = (doc: CanvasDoc) => new Set([...doc.nodes.map((n) => n.id), ...doc.edges.map((e) => e.id)])

/** The nodes `ids` names, with the cards inside a group named (a group goes with what's in it). */
export function withContents(doc: CanvasDoc, ids: Set<string>): Set<string> {
  const out = new Set(ids)
  for (const g of doc.nodes) if (g.type === "group" && ids.has(g.id)) for (const n of doc.nodes) if (inside(n, g)) out.add(n.id)
  return out
}

/** The selection as a canvas of its own: its nodes and the arrows between them. */
export function slice(doc: CanvasDoc, ids: Set<string>): CanvasDoc {
  return { nodes: doc.nodes.filter((n) => ids.has(n.id)), edges: doc.edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode)) }
}

/** What the clipboard holds for a copy: JSON Canvas text. */
export const copyText = (part: CanvasDoc) => JSON.stringify({ nodes: part.nodes, edges: part.edges }, null, "\t")

/** Clipboard text that is a piece of a canvas (a copy from one), or null. */
export function pastedCanvas(text: string): CanvasDoc | null {
  const t = text.trim()
  if (!t.startsWith("{")) return null
  try {
    const raw = JSON.parse(t) as { nodes?: unknown; edges?: unknown }
    if (!Array.isArray(raw.nodes) || !raw.nodes.length) return null
    const nodes = raw.nodes.filter((n): n is CanvasNode => !!n && typeof n === "object" && typeof (n as CanvasNode).type === "string")
    const edges = (Array.isArray(raw.edges) ? raw.edges : []).filter((e): e is CanvasEdge => !!e && typeof e === "object")
    return nodes.length ? { nodes, edges } : null
  } catch { return null }
}

/** `part` added to `doc` with new ids, moved by (dx, dy). Returns the new canvas and the added nodes' ids. Groups go
 *  first (drawn behind), arrows only between the added nodes. */
export function insert(doc: CanvasDoc, part: CanvasDoc, dx: number, dy: number): { doc: CanvasDoc; ids: Set<string> } {
  const used = taken(doc)
  const map = new Map<string, string>()
  for (const n of part.nodes) { const id = newId(used); used.add(id); map.set(n.id, id) }
  const nodes = part.nodes.map((n) => ({ ...n, id: map.get(n.id)!, x: Math.round((Number(n.x) || 0) + dx), y: Math.round((Number(n.y) || 0) + dy),
    width: Number(n.width) || 250, height: Number(n.height) || 60 }))
  const edges = part.edges.filter((e) => map.has(e.fromNode) && map.has(e.toNode)).map((e) => {
    const id = newId(used); used.add(id)
    return { ...e, id, fromNode: map.get(e.fromNode)!, toNode: map.get(e.toNode)! }
  })
  const groups = nodes.filter((n) => n.type === "group"), cards = nodes.filter((n) => n.type !== "group")
  return { doc: { ...doc, nodes: [...groups, ...doc.nodes, ...cards], edges: [...doc.edges, ...edges] }, ids: new Set(nodes.map((n) => n.id)) }
}

/** The selection (with what's in its groups) copied next to itself. */
export function duplicate(doc: CanvasDoc, ids: Set<string>, dx = 30, dy = 30) {
  return insert(doc, slice(doc, withContents(doc, ids)), dx, dy)
}

/** The nodes taken away, with their arrows. */
export function remove(doc: CanvasDoc, ids: Set<string>): CanvasDoc {
  return { ...doc, nodes: doc.nodes.filter((n) => !ids.has(n.id)), edges: doc.edges.filter((e) => !ids.has(e.fromNode) && !ids.has(e.toNode)) }
}

/** Groups taken away, their cards left where they are. */
export function ungroup(doc: CanvasDoc, ids: Set<string>): CanvasDoc {
  const gone = new Set(doc.nodes.filter((n) => ids.has(n.id) && n.type === "group").map((n) => n.id))
  return remove(doc, gone)
}

export type Align = "left" | "center" | "right" | "top" | "middle" | "bottom"
/** The cards lined up on the selection's edge or centre (groups move what's in them). */
export function align(doc: CanvasDoc, ids: Set<string>, how: Align): CanvasDoc {
  const sel = doc.nodes.filter((n) => ids.has(n.id))
  if (sel.length < 2) return doc
  const x0 = Math.min(...sel.map((n) => n.x)), x1 = Math.max(...sel.map((n) => n.x + n.width))
  const y0 = Math.min(...sel.map((n) => n.y)), y1 = Math.max(...sel.map((n) => n.y + n.height))
  const shift = new Map<string, { dx: number; dy: number }>()
  for (const n of sel) {
    const x = how === "left" ? x0 : how === "right" ? x1 - n.width : how === "center" ? (x0 + x1) / 2 - n.width / 2 : n.x
    const y = how === "top" ? y0 : how === "bottom" ? y1 - n.height : how === "middle" ? (y0 + y1) / 2 - n.height / 2 : n.y
    const d = { dx: Math.round(x - n.x), dy: Math.round(y - n.y) }
    shift.set(n.id, d)
    if (n.type === "group") for (const m of doc.nodes) if (!ids.has(m.id) && inside(m, n)) shift.set(m.id, d)
  }
  return { ...doc, nodes: doc.nodes.map((n) => { const d = shift.get(n.id); return d ? { ...n, x: n.x + d.dx, y: n.y + d.dy } : n }) }
}

export type Direction = "none" | "forward" | "both"
/** Which ends of an arrow have a head: none, the end only (the default), or both. */
export const directionOf = (e: CanvasEdge): Direction => {
  const from = (e.fromEnd ?? "none") === "arrow", to = (e.toEnd ?? "arrow") === "arrow"
  return from && to ? "both" : !from && !to ? "none" : "forward"
}
/** An arrow with its heads set, writing only what isn't the default (Obsidian's way). */
export function setDirection(e: CanvasEdge, d: Direction): CanvasEdge {
  const y = { ...e }
  delete y.fromEnd; delete y.toEnd
  if (d === "both") y.fromEnd = "arrow"
  if (d === "none") y.toEnd = "none"
  return y
}
/** The arrow turned around: from its end to its start. */
export function reverse(e: CanvasEdge): CanvasEdge {
  // (its heads stay at its start and end: an arrow from A to B now goes from B to A)
  const y: CanvasEdge = { ...e, fromNode: e.toNode, toNode: e.fromNode }
  delete y.fromSide; delete y.toSide
  if (e.toSide) y.fromSide = e.toSide
  if (e.fromSide) y.toSide = e.fromSide
  return y
}

/** A note's name from a text card's first line: no heading marks or Markdown, none of the characters a file name
 *  can't have, at most 60 characters; "Untitled" when nothing is left. */
export function nameFromText(text: string): string {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? ""
  const plain = line.replace(/^#{1,6}\s+/, "").replace(/^[-*+]\s+(\[.\]\s+)?/, "")
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, t: string, a?: string) => a || t)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`~=]/g, "")
    .replace(/[:/\\?*"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim()
  const cut = plain.length > 60 ? plain.slice(0, 60).replace(/\s+\S*$/, "") : plain
  return cut.replace(/^\.+/, "").trim() || "Untitled"
}
