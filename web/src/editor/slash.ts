// The slash menu (what's in it: core/slash.ts): "/" at a line's start or after a space, narrowed by what follows, Enter
// puts the pick in place of "/query". Not in code, nor in the frontmatter.
import { startCompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete"
import { syntaxTree } from "@codemirror/language"
import type { EditorView } from "@codemirror/view"
import type { SlashItem } from "@/core/define"
import { fuzzy } from "@/core/search"

const CODE = /^(FencedCode|CodeBlock|CodeText|InlineCode|CodeInfo|CodeMark)$/

/** Type `text` at the cursor ("$|" is where the cursor goes). `line`: on a line of its own. */
function putText(view: EditorView, text: string, line = false) {
  const at = view.state.selection.main.head
  const before = view.state.doc.lineAt(at)
  if (line && /\S/.test(view.state.sliceDoc(before.from, at))) text = `\n${text}`
  const mark = text.indexOf("$|")
  const insert = text.replace("$|", "")
  view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + (mark < 0 ? insert.length : mark) }, scrollIntoView: true, userEvent: "input" })
  view.focus()
  // A link was started: suggest names right away.
  if (/\[\[$/.test(view.state.sliceDoc(Math.max(0, at + (mark < 0 ? insert.length : mark) - 2), at + (mark < 0 ? insert.length : mark)))) startCompletion(view)
}

function inFrontmatter(ctx: CompletionContext) {
  const doc = ctx.state.doc
  if (doc.line(1).text !== "---") return false
  for (let i = 2; i <= doc.lines; i++) {
    const l = doc.line(i)
    if (l.text === "---") return ctx.pos <= l.from
  }
  return true
}

export function slashSource(items: () => SlashItem[]) {
  return (ctx: CompletionContext) => {
    const m = ctx.matchBefore(/(?:^|\s)\/[\p{L}\p{N}-]*$/u)
    if (!m) return null
    const from = m.from + (m.text.startsWith("/") ? 0 : 1)
    for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(ctx.state).resolveInner(from, 1); n; n = n.parent) {
      if (CODE.test(n.name)) return null
    }
    if (inFrontmatter(ctx)) return null
    const q = ctx.state.sliceDoc(from + 1, ctx.pos).toLowerCase()
    const all = items()
    const hits = !q ? all.map((it, i) => ({ it, score: -i }))
      : all.flatMap((it, i) => {
        const t = fuzzy(q, it.title)
        const k = (it.keywords ?? "").toLowerCase().split(/\s+/).some((w) => w.startsWith(q))
        return t || k ? [{ it, score: (t?.score ?? 0) + (k ? 5 : 0) - i / 1000 }] : []
      }).sort((a, b) => b.score - a.score)
    if (!hits.length) return null
    const ranks = new Map<string, number>()
    for (const { it } of hits) if (it.section && !ranks.has(it.section)) ranks.set(it.section, ranks.size)
    const options: Completion[] = hits.map(({ it }, i) => ({
      label: it.title, detail: it.detail, boost: Math.max(-99, -i),
      section: q || !it.section ? undefined : { name: it.section, rank: ranks.get(it.section)! },
      apply: (view: EditorView, _c: Completion, a: number, b: number) => {
        view.dispatch({ changes: { from: a, to: b }, selection: { anchor: a }, userEvent: "delete" })
        const put = (text: string) => { if (view.dom.isConnected) putText(view, text, it.line) }
        if (it.run) void it.run(put)
        else put(it.text ?? "")
      },
    }))
    return { from, options, filter: false }
  }
}
