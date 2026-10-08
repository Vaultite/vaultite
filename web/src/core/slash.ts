// What's in the editor's slash menu, like Notion's: the core's entries, then plugins' blocks, then their `slash`
// items. The editor draws it (editor/slash.ts).
import { pad, type Store } from "@/core/data"
import type { SlashItem } from "@/core/define"
import { isEnabled, PLUGINS } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"

export type { SlashItem }

const day = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const time = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

const CORE: SlashItem[] = [
  { id: "h1", title: "Heading 1", keywords: "title h1", text: "# ", line: true },
  { id: "h2", title: "Heading 2", keywords: "h2 section", text: "## ", line: true },
  { id: "h3", title: "Heading 3", keywords: "h3", text: "### ", line: true },
  { id: "bullets", title: "Bulleted list", keywords: "ul bullet list", text: "- ", line: true },
  { id: "numbers", title: "Numbered list", keywords: "ol ordered list", text: "1. ", line: true },
  { id: "tasks", title: "Checklist", keywords: "todo task checkbox", text: "- [ ] ", line: true },
  { id: "quote", title: "Quote", keywords: "blockquote", text: "> ", line: true },
  { id: "code", title: "Code block", keywords: "pre fence", text: "```\n$|\n```\n", line: true },
  { id: "callout", title: "Callout", keywords: "note tip warning info admonition", text: "> [!note] $|\n> \n", line: true },
  { id: "math", title: "Math block", keywords: "latex tex equation katex", text: "$$\n$|\n$$\n", line: true },
  { id: "mermaid", title: "Diagram", keywords: "mermaid flowchart chart graph", text: "```mermaid\nflowchart LR\n  A --> B$|\n```\n", line: true },
  { id: "footnote", title: "Footnote", keywords: "reference note citation", text: "[^$|]" },
  { id: "table", title: "Table", keywords: "grid columns", text: "| $| |  |\n| --- | --- |\n|  |  |\n", line: true },
  { id: "divider", title: "Divider", keywords: "hr rule line separator", text: "---\n", line: true },
  { id: "link", title: "Link to a file", keywords: "wikilink note page mention", text: "[[$|" },
  { id: "embed", title: "Embed a file", keywords: "image artifact table csv pdf", text: "![[$|" },
  { id: "today", title: "Today's date", keywords: "date now", detail: "", run: (put) => put(day()) },
  { id: "now", title: "Current time", keywords: "time clock", run: (put) => put(time()) },
  { id: "timeline", title: "Timeline", keywords: "history log entries", line: true, run: (put) => put(`## Timeline\n\n- ${day()} · note · $|\n`) },
]

/** "people-due" -> "People due". */
const human = (name: string) => { const s = name.replace(/[-_]+/g, " "); return s.charAt(0).toUpperCase() + s.slice(1) }

/** Everything the slash menu offers now, in order. */
export function slashItems(store: Store): SlashItem[] {
  const { disabled } = getPrefs()
  const on = PLUGINS.filter((p) => isEnabled(p.id, disabled))
  const blocks: SlashItem[] = on.flatMap((p) => Object.keys(p.blocks ?? {}).map((name) => {
    // (its required options typed in, the cursor at the first: core/blocks.ts)
    const decl = p.blockDecls?.[name]
    const need = Object.entries(decl?.options ?? {}).filter(([, d]) => d.required).map(([k], i) => `${k}: ${i ? "" : "$|"}\n`).join("")
    return {
      id: `block-${name}`, title: human(name), section: "Blocks", detail: p.name, keywords: `block ${name} ${p.name}`,
      text: `\`\`\`block-${name}\n${need}\`\`\`\n`, line: true,
    }
  }))
  const extra = on.flatMap((p) => { try { return p.slash?.(store) ?? [] } catch { return [] } })
  return [...CORE.map((c) => ({ section: "Basic", ...c })), ...extra, ...blocks]
}
