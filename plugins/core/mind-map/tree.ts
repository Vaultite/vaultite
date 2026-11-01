// A note's headings (and list items) as a tree, for both sides: the app draws it as a mind map, the block's text is it as a nested list.

export type Heading = { level: number; text: string; line: number }
export type MindNode = { text: string; line: number; children: MindNode[] }

/** A heading as it reads: links by their text, without Markdown's marks. */
export const plain = (t: string) => t.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`=]/g, "").trim() || "Untitled"

/** The ATX headings of Markdown text and, with `lists`, its list items (as levels below 6, by how far they're
 *  indented), code and frontmatter skipped. */
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
    // (an item's depth: how many open items are indented less than it)
    const at = li[1].replace(/\t/g, "    ").length
    indents = indents.filter((x) => x < at)
    out.push({ level: 7 + indents.length, text: li[2].replace(/\s\^[\w-]+$/, ""), line: i })
    indents.push(at)
  }
  return out
}

/** The tree under a root named `title`: each heading under the nearest one before it of a lower level. */
export function treeOf(headings: Heading[], title: string): MindNode {
  const root: MindNode = { text: title, line: -1, children: [] }
  const stack: { level: number; node: MindNode }[] = [{ level: 0, node: root }]
  for (const h of headings) {
    while (stack.length > 1 && stack.at(-1)!.level >= h.level) stack.pop()
    const node: MindNode = { text: plain(h.text), line: h.line, children: [] }
    stack.at(-1)!.node.children.push(node)
    stack.push({ level: h.level, node })
  }
  // A note under one title heading: that heading is the root (the map branches below it).
  const only = root.children.length === 1 ? root.children[0] : null
  return only && only.children.length ? only : root
}

/** The tree as a nested list, `depth` levels under the root. */
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
