// JSON Canvas 1.0 (Obsidian's .canvas): keys it doesn't know are written back as they were.

export type Side = "top" | "right" | "bottom" | "left"
export type End = "none" | "arrow"
export type CanvasNode = {
  id: string; type: string; x: number; y: number; width: number; height: number
  color?: string
  text?: string
  file?: string; subpath?: string
  url?: string
  label?: string; background?: string; backgroundStyle?: string
  styleAttributes?: unknown
  [key: string]: unknown
}
export type CanvasEdge = {
  id: string; fromNode: string; toNode: string
  fromSide?: Side; toSide?: Side
  fromEnd?: End; toEnd?: End
  color?: string; label?: string
  styleAttributes?: unknown
  [key: string]: unknown
}
export type CanvasDoc = { nodes: CanvasNode[]; edges: CanvasEdge[]; [key: string]: unknown }
export type Known<T> = { [K in keyof T as string extends K ? never : K]: T[K] }

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : d)

export function parseCanvas(text: string): CanvasDoc {
  if (!text.trim()) return { nodes: [], edges: [] }
  const doc = JSON.parse(text)
  if (!isObj(doc)) throw new Error("a canvas is a JSON object with nodes and edges")
  const nodes = (Array.isArray(doc.nodes) ? doc.nodes : []).filter(isObj)
    .map((n, i): CanvasNode => ({ ...n, id: typeof n.id === "string" && n.id ? n.id : `node-${i}`, type: typeof n.type === "string" ? n.type : "text",
      x: num(n.x), y: num(n.y), width: num(n.width, 250), height: num(n.height, 60) }))
  const edges = (Array.isArray(doc.edges) ? doc.edges : []).filter(isObj)
    .map((e, i): CanvasEdge => ({ ...e, id: typeof e.id === "string" && e.id ? e.id : `edge-${i}`, fromNode: String(e.fromNode ?? ""), toNode: String(e.toNode ?? "") }))
  return { ...doc, nodes, edges }
}

// Obsidian indents with tabs.
function indentOf(text: string) {
  const m = /\n([ \t]+)"/.exec(text)
  return m ? m[1] : "\t"
}

// Obsidian writes numbers as integers.
export function writeCanvas(doc: CanvasDoc, like = "") {
  const round = (n: CanvasNode) => ({ ...n, x: Math.round(n.x), y: Math.round(n.y), width: Math.round(n.width), height: Math.round(n.height) })
  const text = JSON.stringify({ ...doc, nodes: doc.nodes.map(round), edges: doc.edges }, null, indentOf(like))
  return like.endsWith("\n") ? text + "\n" : text
}

// JSON Canvas ids are 16 hex digits.
export function newId(taken: Set<string> = new Set()) {
  for (;;) {
    let s = ""
    for (let i = 0; i < 16; i++) s += "0123456789abcdef"[Math.floor(Math.random() * 16)]
    if (!taken.has(s)) return s
  }
}

export const PRESETS: Record<string, string> = { "1": "var(--red)", "2": "var(--orange)", "3": "var(--yellow)", "4": "var(--green)", "5": "var(--teal)", "6": "var(--purple)" }
export const PRESET_NAMES: Record<string, string> = { "1": "Red", "2": "Orange", "3": "Yellow", "4": "Green", "5": "Cyan", "6": "Purple" }
export function colorOf(c: unknown): string | null {
  if (typeof c !== "string" || !c) return null
  if (PRESETS[c]) return PRESETS[c]
  return /^#[0-9a-f]{3,8}$/i.test(c) ? c : null
}

// Other canvas apps keep shapes and line styles in `styleAttributes`.
export const SHAPES: Record<string, string> = { "": "Rectangle", pill: "Pill", circle: "Circle", diamond: "Diamond", parallelogram: "Parallelogram" }
export const BORDERS: Record<string, string> = { "": "Solid border", dashed: "Dashed border", dotted: "Dotted border", invisible: "No border" }
export const LINES: Record<string, string> = { "": "Solid line", "long-dashed": "Long dashes", "short-dashed": "Short dashes", dotted: "Dotted line" }
export function styleOf(x: { styleAttributes?: unknown }, key: "shape" | "border" | "path"): string {
  const v = isObj(x.styleAttributes) ? x.styleAttributes[key] : undefined
  const known = key === "shape" ? SHAPES : key === "border" ? BORDERS : LINES
  return typeof v === "string" && Object.hasOwn(known, v) ? v : ""
}
export function withStyle<T extends { styleAttributes?: unknown }>(x: T, key: string, value: string): T {
  const attrs: Record<string, unknown> = isObj(x.styleAttributes) ? { ...x.styleAttributes } : {}
  if (value) attrs[key] = value; else delete attrs[key]
  const y: T = { ...x, styleAttributes: attrs }
  if (!Object.keys(attrs).length) delete y.styleAttributes
  return y
}

export const COLLAPSED_H = 48
// Other canvas apps fold a group with `collapsed: true`.
export function hiddenIn(doc: CanvasDoc): Set<string> {
  const shut = doc.nodes.filter((g) => g.type === "group" && g.collapsed === true)
  return new Set(doc.nodes.filter((n) => shut.some((g) => inside(n, g))).map((n) => n.id))
}

export function unfoldOnDrop(before: CanvasDoc, next: CanvasDoc): CanvasDoc {
  const was = hiddenIn(before), shut = new Set(before.nodes.filter((g) => g.collapsed === true).map((g) => g.id))
  const open = next.nodes.filter((g) => g.type === "group" && g.collapsed === true && shut.has(g.id) && next.nodes.some((n) => !was.has(n.id) && !shut.has(n.id) && inside(n, g)))
  if (!open.length) return next
  return { ...next, nodes: next.nodes.map((g) => { if (!open.includes(g)) return g; const y = { ...g }; delete y.collapsed; return y }) }
}

export const inside = (a: CanvasNode, g: CanvasNode) =>
  a !== g && a.x >= g.x - 1 && a.y >= g.y - 1 && a.x + a.width <= g.x + g.width + 1 && a.y + a.height <= g.y + g.height + 1

export function canvasLinks(text: string): string[] {
  let doc: CanvasDoc
  try { doc = parseCanvas(text) } catch { return [] }
  const out: string[] = []
  for (const n of doc.nodes) {
    if (n.type === "file" && typeof n.file === "string" && n.file) out.push(n.file)
    if (n.type === "text" && typeof n.text === "string") for (const m of n.text.matchAll(/\[\[([^[\]\n|#^]+)/g)) out.push(m[1].trim())
  }
  return out
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim()
const quote = (text: string) => {
  const t = oneLine(text.replace(/^[ \t]*#{1,6}[ \t]+/gm, ""))
  return `"${t.length > 60 ? `${t.slice(0, 59)}…` : t}"`
}

export function canvasMarkdown(text: string): string {
  let doc: CanvasDoc
  try { doc = parseCanvas(text) } catch (e) { return `_(This canvas isn't valid JSON: ${e instanceof Error ? e.message : String(e)})_` }
  if (!doc.nodes.length) return "_An empty canvas._"
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const order = (a: CanvasNode, b: CanvasNode) => a.y - b.y || a.x - b.x
  const name = (n: CanvasNode): string =>
    n.type === "file" ? `[[${String(n.file ?? "").replace(/\.md$/i, "")}${n.subpath ? String(n.subpath) : ""}]]`
      : n.type === "link" ? `<${n.url ?? ""}>`
      : n.type === "group" ? `the group ${n.label ? `"${n.label}"` : "(no label)"}`
      : quote(String(n.text ?? ""))
  const colour = (n: CanvasNode | CanvasEdge) => {
    const bits = [n.color ? PRESET_NAMES[String(n.color)]?.toLowerCase() ?? String(n.color) : "", styleOf(n, "shape"), styleOf(n, "path") ? LINES[styleOf(n, "path")].toLowerCase() : ""].filter(Boolean)
    return bits.length ? ` (${bits.join(", ")})` : ""
  }
  const card = (n: CanvasNode) => {
    if (n.type === "text") {
      const t = String(n.text ?? "").trim()
      return t.includes("\n") ? `- Card${colour(n)}:\n${t.split("\n").map((l) => `  ${l}`).join("\n")}` : `- Card${colour(n)}: ${t || "_(empty)_"}`
    }
    if (n.type === "file") return `- File${colour(n)}: ${name(n)}`
    if (n.type === "link") return `- Web page${colour(n)}: <${n.url ?? ""}>`
    return `- ${n.type}${colour(n)}`
  }
  const groups = doc.nodes.filter((n) => n.type === "group").sort(order)
  const inGroup = new Map<string, CanvasNode>()
  for (const n of doc.nodes) {
    if (n.type === "group") continue
    const g = groups.filter((x) => inside(n, x)).sort((a, b) => a.width * a.height - b.width * b.height)[0]
    if (g) inGroup.set(n.id, g)
  }
  const parts: string[] = []
  const loose = doc.nodes.filter((n) => n.type !== "group" && !inGroup.has(n.id)).sort(order)
  if (loose.length) parts.push(loose.map(card).join("\n"))
  for (const g of groups) {
    const cards = doc.nodes.filter((n) => inGroup.get(n.id) === g).sort(order)
    parts.push(`### ${g.label ? String(g.label) : "Group"}${colour(g)}${g.collapsed === true ? " (collapsed)" : ""}\n\n${cards.length ? cards.map(card).join("\n") : "_(empty)_"}`)
  }
  const lines = doc.edges.flatMap((e) => {
    const a = byId.get(e.fromNode), b = byId.get(e.toNode)
    if (!a || !b) return []
    const both = (e.fromEnd ?? "none") === "arrow" && (e.toEnd ?? "arrow") === "arrow"
    const none = (e.fromEnd ?? "none") === "none" && (e.toEnd ?? "arrow") === "none"
    const arrow = both ? "↔" : none ? "—" : (e.toEnd ?? "arrow") === "arrow" ? "→" : "←"
    return [`- ${name(a)} ${arrow} ${name(b)}${e.label ? `: ${oneLine(String(e.label))}` : ""}${colour(e)}`]
  })
  if (lines.length) parts.push(`### Connections\n\n${lines.join("\n")}`)
  return parts.join("\n\n")
}
