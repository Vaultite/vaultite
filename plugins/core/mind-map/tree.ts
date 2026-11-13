
export type Heading = { level: number; text: string; line: number }
export type MindNode = { text: string; line: number; children: MindNode[] }

export const plain = (t: string) => t.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`=]/g, "").trim() || "Untitled"

export function headingsIn(text: string, lists = false): Heading[] {
  const out: Heading[] = []
  let fence: string | null = null
  const lines = text.split("\n")
  let i = 0
  if (lines[0] === "---") { i = lines.indexOf("---", 1) + 1 || 0 }
  let indents: number[] = []
  for (; i < lines.length; i++) {
    const l = lines[i]
    // (a fence closes on its own mark, at least as long, alone: a ```js line inside a ```` block is code)
    const f = /^\s*(`{3,}|~{3,})(.*)$/.exec(l)
    if (f && !fence) { fence = f[1]; continue }
    if (f && f[1][0] === fence![0] && f[1].length >= fence!.length && !f[2].trim()) { fence = null; continue }
    if (fence) continue
    // (closing #s only after a space: "# Learning C#" keeps its #)
    const m = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(l)
    if (m) { out.push({ level: m[1].length, text: m[2].replace(/\s\^[\w-]+$/, ""), line: i }); indents = []; continue }
    const li = lists ? /^([ \t]*)(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?(.+?)\s*$/.exec(l) : null
    if (!li) continue
    const at = li[1].replace(/\t/g, "    ").length
    indents = indents.filter((x) => x < at)
    out.push({ level: 7 + indents.length, text: li[2].replace(/\s\^[\w-]+$/, ""), line: i })
    indents.push(at)
  }
  return out
}

export function treeOf(headings: Heading[], title: string): MindNode {
  const root: MindNode = { text: title, line: -1, children: [] }
  const stack: { level: number; node: MindNode }[] = [{ level: 0, node: root }]
  for (const h of headings) {
    while (stack.length > 1 && stack.at(-1)!.level >= h.level) stack.pop()
    const node: MindNode = { text: plain(h.text), line: h.line, children: [] }
    stack.at(-1)!.node.children.push(node)
    stack.push({ level: h.level, node })
  }
  const only = root.children.length === 1 ? root.children[0] : null
  return only && only.children.length ? only : root
}

export function treeText(root: MindNode, depth = 9): string {
  const out: string[] = [`**${root.text}**`]
  const walk = (n: MindNode, d: number) => {
    for (const c of n.children) {
      out.push(`${"  ".repeat(d)}- ${c.text}`)
      if (d + 1 < depth) walk(c, d + 1)
    }
  }
  walk(root, 0)
  return out.length > 1 ? out.join("\n") : `**${root.text}** has no headings yet.`
}

export function canvasOf(root: MindNode, note: string): string {
  const W = 260, H = 60, GAP_X = 80, ROW = 90
  const nodes: Record<string, unknown>[] = [], edges: Record<string, unknown>[] = []
  let rows = 0
  const place = (n: MindNode, depth: number, color: string | null): { id: string; y: number } => {
    const id = `n${nodes.length}`
    const node: Record<string, unknown> = { id, type: "text", text: depth ? n.text : `## [[${note.replace(/\.md$/i, "")}|${n.text}]]`, x: depth * (W + GAP_X), y: 0, width: W, height: H }
    if (color) node.color = color
    nodes.push(node)
    const kids = n.children.map((c, i) => place(c, depth + 1, color ?? String((i % 6) + 1)))
    const y = kids.length ? (kids[0].y + kids.at(-1)!.y) / 2 : rows++ * ROW
    node.y = Math.round(y)
    for (const k of kids) edges.push({ id: `e${edges.length}`, fromNode: id, fromSide: "right", toNode: k.id, toSide: "left" })
    return { id, y }
  }
  place(root, 0, null)
  return `${JSON.stringify({ nodes, edges }, null, "\t")}\n`
}

