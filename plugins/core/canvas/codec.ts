// JSON Canvas (spec 1.0, Obsidian's .canvas): read, written back keeping every key it doesn't know, and read as
// Markdown for AIs. Shared by server and app; no Node.

export type Side = "top" | "right" | "bottom" | "left"
export type End = "none" | "arrow"
export type CanvasNode = {
  id: string; type: string; x: number; y: number; width: number; height: number
  /** A preset "1" to "6" (red, orange, yellow, green, cyan, purple) or a hex colour ("#FF0000"). */
  color?: string
  text?: string
  file?: string; subpath?: string
  url?: string
  label?: string; background?: string; backgroundStyle?: string
  [key: string]: unknown
}
export type CanvasEdge = {
  id: string; fromNode: string; toNode: string
  fromSide?: Side; toSide?: Side
  /** Defaults: no arrow where it starts, an arrow where it ends. */
  fromEnd?: End; toEnd?: End
  color?: string; label?: string
  [key: string]: unknown
}
export type CanvasDoc = { nodes: CanvasNode[]; edges: CanvasEdge[]; [key: string]: unknown }

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : d)

/** A .canvas file's text as a canvas. Empty text is an empty canvas; text that isn't JSON throws. Nodes without an id
 *  get one; sizes that aren't numbers get defaults (the file keeps its other keys). */
export function parseCanvas(text: string): CanvasDoc {
  if (!text.trim()) return { nodes: [], edges: [] }
  const raw = JSON.parse(text) as unknown
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("a canvas is a JSON object with nodes and edges")
  const doc = raw as Record<string, unknown>
  const nodes = (Array.isArray(doc.nodes) ? doc.nodes : []).filter((n): n is Record<string, unknown> => !!n && typeof n === "object")
    .map((n, i) => ({ ...n, id: typeof n.id === "string" && n.id ? n.id : `node-${i}`, type: typeof n.type === "string" ? n.type : "text",
      x: num(n.x), y: num(n.y), width: num(n.width, 250), height: num(n.height, 60) }) as CanvasNode)
  const edges = (Array.isArray(doc.edges) ? doc.edges : []).filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e, i) => ({ ...e, id: typeof e.id === "string" && e.id ? e.id : `edge-${i}`, fromNode: String(e.fromNode ?? ""), toNode: String(e.toNode ?? "") }) as CanvasEdge)
  return { ...doc, nodes, edges }
}

/** The indent the file already uses (Obsidian writes tabs). */
function indentOf(text: string) {
  const m = /\n([ \t]+)"/.exec(text)
  return m ? m[1] : "\t"
}

/** The canvas as a file's text, indented like `like` (the text it had), numbers as integers like Obsidian writes them. */
export function writeCanvas(doc: CanvasDoc, like = "") {
  const round = (n: CanvasNode) => ({ ...n, x: Math.round(n.x), y: Math.round(n.y), width: Math.round(n.width), height: Math.round(n.height) })
  const text = JSON.stringify({ ...doc, nodes: doc.nodes.map(round), edges: doc.edges }, null, indentOf(like))
  return like.endsWith("\n") ? text + "\n" : text
}

/** A new id (16 hex digits, as JSON Canvas files have them). */
export function newId(taken: Set<string> = new Set()) {
  for (;;) {
    let s = ""
    for (let i = 0; i < 16; i++) s += "0123456789abcdef"[Math.floor(Math.random() * 16)]
    if (!taken.has(s)) return s
  }
}

/** The colour token a canvas colour is drawn with: the presets are the app's colours, a hex colour is itself. */
export const PRESETS: Record<string, string> = { "1": "var(--red)", "2": "var(--orange)", "3": "var(--yellow)", "4": "var(--green)", "5": "var(--teal)", "6": "var(--purple)" }
export const PRESET_NAMES: Record<string, string> = { "1": "Red", "2": "Orange", "3": "Yellow", "4": "Green", "5": "Cyan", "6": "Purple" }
export function colorOf(c: unknown): string | null {
  if (typeof c !== "string" || !c) return null
  if (PRESETS[c]) return PRESETS[c]
  return /^#[0-9a-f]{3,8}$/i.test(c) ? c : null
}

/** Whether node `a` lies inside group `g` (its box, a little slack). */
export const inside = (a: CanvasNode, g: CanvasNode) =>
  a !== g && a.x >= g.x - 1 && a.y >= g.y - 1 && a.x + a.width <= g.x + g.width + 1 && a.y + a.height <= g.y + g.height + 1

/** The vault files a canvas's cards name (file cards, and [[links]] in text cards), for the graph. */
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
/** A text card named in one line: its first words, without heading marks. */
const quote = (text: string) => {
  const t = oneLine(text.replace(/^[ \t]*#{1,6}[ \t]+/gm, ""))
  return `"${t.length > 60 ? `${t.slice(0, 59)}…` : t}"`
}

/** The canvas as Markdown, for AIs (/api/render): its cards top to bottom, left to right (inside their groups), then
 *  its connections. File cards are [[links]]. */
export function canvasMarkdown(text: string): string {
  let doc: CanvasDoc
  try { doc = parseCanvas(text) } catch (e) { return `_(This canvas isn't valid JSON: ${(e as Error).message})_` }
  if (!doc.nodes.length) return "_An empty canvas._"
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const order = (a: CanvasNode, b: CanvasNode) => a.y - b.y || a.x - b.x
  const name = (n: CanvasNode): string =>
    n.type === "file" ? `[[${String(n.file ?? "").replace(/\.md$/i, "")}${n.subpath ? String(n.subpath) : ""}]]`
      : n.type === "link" ? `<${n.url ?? ""}>`
      : n.type === "group" ? `the group ${n.label ? `"${n.label}"` : "(no label)"}`
      : quote(String(n.text ?? ""))
  const colour = (n: CanvasNode | CanvasEdge) => (n.color ? ` (${PRESET_NAMES[String(n.color)]?.toLowerCase() ?? n.color})` : "")
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
  // The smallest group a card is in is its group.
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
    parts.push(`### ${g.label ? String(g.label) : "Group"}${colour(g)}\n\n${cards.length ? cards.map(card).join("\n") : "_(empty)_"}`)
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
