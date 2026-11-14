import { pad, type Store } from "@/core/data"
import type { SlashItem } from "@/core/define"
import { CalendarDays, Clock, FileInput, Heading1, Heading2, Heading3, History, Link, List, ListOrdered, ListTodo, MessageSquareWarning, Minus, Sigma, SquareCode,
  Superscript, Table, TextQuote, Workflow } from "lucide-react"
import { blockFor, isEnabled, PLUGINS, templatesOf } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"
import { capitalize } from "@/lib/utils"
import { dump } from "../../../core/yaml.ts"

export type { SlashItem }

const day = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const time = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

const core = (): SlashItem[] => [
  { id: "h1", title: "Heading 1", keywords: "title h1", text: "# ", line: true, icon: Heading1, description: "A big heading for a section.",
    sample: "# Project plan\nWhat we want done by spring." },
  { id: "h2", title: "Heading 2", keywords: "h2 section", text: "## ", line: true, icon: Heading2, description: "A medium heading.",
    sample: "## Next steps\nWhat happens this week." },
  { id: "h3", title: "Heading 3", keywords: "h3", text: "### ", line: true, icon: Heading3, description: "A small heading.",
    sample: "### Open questions\nWho signs off on the budget?" },
  { id: "bullets", title: "Bulleted list", keywords: "ul bullet list", text: "- ", line: true, icon: List, description: "A simple list.",
    sample: "- Milk\n- Eggs\n- Bread" },
  { id: "numbers", title: "Numbered list", keywords: "ol ordered list", text: "1. ", line: true, icon: ListOrdered, description: "A list in order.",
    sample: "1. Draft the outline\n2. Write the first pass\n3. Edit" },
  { id: "tasks", title: "Checklist", keywords: "todo task checkbox", text: "- [ ] ", line: true, icon: ListTodo, description: "Things to tick off.",
    sample: "- [x] Book the room\n- [ ] Send the agenda\n- [ ] Print the handouts" },
  { id: "quote", title: "Quote", keywords: "blockquote", text: "> ", line: true, icon: TextQuote, description: "Words from someone else.",
    sample: "> Simple things should be simple, complex things should be possible." },
  { id: "code", title: "Code block", keywords: "pre fence", text: "```\n$|\n```\n", line: true, icon: SquareCode, description: "Code, kept as typed.",
    sample: "```js\nconst greet = (name) => `Hello, ${name}`\n```" },
  { id: "callout", title: "Callout", keywords: "note tip warning info admonition", text: "> [!note] $|\n> \n", line: true, icon: MessageSquareWarning,
    description: "A boxed note that stands out.", sample: "> [!note] Remember\n> Bring the signed contract." },
  { id: "math", title: "Math block", keywords: "latex tex equation katex", text: "$$\n$|\n$$\n", line: true, icon: Sigma, description: "An equation in LaTeX.",
    sample: "$$\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$" },
  { id: "mermaid", title: "Diagram", keywords: "mermaid flowchart chart graph", text: "```mermaid\nflowchart LR\n  A --> B$|\n```\n", line: true, icon: Workflow,
    description: "A flowchart drawn from text.", sample: "```mermaid\nflowchart LR\n  Draft --> Review\n```" },
  { id: "footnote", title: "Footnote", keywords: "reference note citation", text: "[^$|]", icon: Superscript, description: "A note at the bottom of the page.",
    sample: "Water boils at 100 degrees.[^1]\n\n[^1]: At sea level." },
  { id: "table", title: "Table", keywords: "grid columns", text: "| $| |  |\n| --- | --- |\n|  |  |\n", line: true, icon: Table, description: "Rows and columns.",
    sample: "| Name | Role |\n| --- | --- |\n| Alice Park | Design |\n| Ben Ito | Code |" },
  { id: "divider", title: "Divider", keywords: "hr rule line separator", text: "---\n", line: true, icon: Minus, description: "A line between parts.",
    sample: "The first part.\n\n---\n\nThe second part." },
  { id: "link", title: "Link to a file", keywords: "wikilink note page mention", text: "[[$|", icon: Link, description: "A link to another note or file.",
    sample: "Ideas for the trip are in [[Weekend trip ideas]]." },
  { id: "embed", title: "Embed a file", keywords: "image artifact table csv pdf", text: "![[$|", icon: FileInput, description: "Another file, shown in this one.",
    preview: () => null },
  { id: "today", title: "Today's date", keywords: "date now", detail: "", run: (put) => put(day()), icon: CalendarDays, description: "Today, as text.",
    sample: `Written on ${day()}.` },
  { id: "now", title: "Current time", keywords: "time clock", run: (put) => put(time()), icon: Clock, description: "The time now, as text.",
    sample: `Call started at ${time()}.` },
  { id: "timeline", title: "Timeline", keywords: "history log entries", line: true, run: (put) => put(`## Timeline\n\n- ${day()} · note · $|\n`), icon: History,
    description: "A dated list of what happened.", sample: `## Timeline\n\n- ${day()} · note · Met Alice about the launch\n- ${day()} · call · Agreed on the date` },
]

let samples: { of: unknown; n: number; map: Map<string, string> } | null = null
function blockSample(name: string, by?: string): string | undefined {
  if (samples?.of !== PLUGINS || samples.n !== PLUGINS.length) {
    const map = new Map<string, string>()
    for (const p of PLUGINS) for (const { text } of templatesOf(p.id)) {
      for (const m of text.matchAll(/^```block-([\w-]+)[^\n]*\n[\s\S]*?^```$/gm)) {
        const byLine = /^(\w+):\s*([\w-]+)\s*$/m.exec(m[0])
        if (!map.has(m[1])) map.set(m[1], m[0])
        if (byLine) map.set(`${m[1]}:${byLine[2]}`, m[0])
      }
    }
    samples = { of: PLUGINS, n: PLUGINS.length, map }
  }
  return samples.map.get(by ? `${name}:${by}` : name)
}

const human = (name: string) => capitalize(name.replace(/[-_]+/g, " "))

export function slashItems(store: Store): SlashItem[] {
  const { disabled } = getPrefs()
  const on = PLUGINS.filter((p) => isEnabled(p.id, disabled))
  const blocks: SlashItem[] = on.flatMap((p) => Object.keys(p.blocks ?? {}).map((name) => {
    const decl = p.draws?.includes(name) ? blockFor(name, disabled).decl : p.blockDecls?.[name]
    const by = decl?.by ? `${decl.by}: ${p.id}\n` : ""
    const need = by + Object.entries(decl?.options ?? {}).filter(([k, d]) => d.required && k !== decl?.by).map(([k], i) => `${k}: ${i ? "" : "$|"}\n`).join("")
    const text = `\`\`\`block-${name}\n${need}\`\`\`\n`
    return {
      id: `block-${name}${by ? `:${p.id}` : ""}`, title: human(name), section: "Blocks", detail: p.name, keywords: `block ${name} ${p.name}`,
      text, line: true, icon: p.icon, description: decl?.description && capitalize(decl.description), sample: blockSample(name, by && p.id) ?? (decl?.example ? `\`\`\`block-${name}\n${by}${dump(decl.example)}\n\`\`\`` : text.replace("$|", "")),
    }
  }))
  const extra = on.flatMap((p) => { try { return p.slash?.(store) ?? [] } catch { return [] } })
  return [...core().map((c) => ({ section: "Basic", ...c })), ...extra, ...blocks]
}
