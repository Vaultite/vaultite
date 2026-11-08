// #tag suggestions: the vault's tags as soon as # is typed after a space (at a line's start once a letter follows, as
// "# " is a heading), most used first, narrowed as the tag is typed. Not in code, a [[link]], a comment or the frontmatter.
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete"
import { syntaxTree } from "@codemirror/language"
import type { EditorView } from "@codemirror/view"
import { inFrontmatter } from "./slash"

const CODE = /^(FencedCode|CodeBlock|CodeText|InlineCode|CodeInfo|CodeMark|Comment|CommentBlock)$/

/** `tags`: the vault's, most used first, with how many files have each. */
export function tagSource(tags: () => { tag: string; count: number }[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/(?<=^|[ \t])#[\p{L}\p{N}_\-/]*/u)
    if (!m) return null
    const line = ctx.state.doc.lineAt(m.from)
    if (m.from === line.from && m.text === "#" && !ctx.explicit) return null
    const before = line.text.slice(0, m.from - line.from)
    if (/\[\[[^\]]*$/.test(before) || /%%/.test(before.replace(/%%.*?%%/g, ""))) return null
    for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(ctx.state).resolveInner(m.from, 1); n; n = n.parent) {
      if (CODE.test(n.name)) return null
    }
    if (inFrontmatter(ctx)) return null
    // (a whole tag typed: no list, so Enter ends the line rather than picking a longer one; a / shows those under it)
    const typed = m.text.slice(1).toLowerCase(), all = tags()
    if (!ctx.explicit && typed && all.some((t) => t.tag.toLowerCase() === typed)) return null
    const list = all.filter((t) => t.tag.toLowerCase() !== typed)
    if (!list.length) return null
    const options: Completion[] = list.map((t, i) => ({
      label: `#${t.tag}`, detail: String(t.count), boost: Math.max(-99, -i),
      // (a space after it, unless one's there: the tag is done)
      apply: (view: EditorView, _c: Completion, from: number, to: number) => {
        const space = /^\s/.test(view.state.sliceDoc(to, to + 1)) ? "" : " "
        const insert = `#${t.tag}${space}`
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true, userEvent: "input.complete" })
      },
    }))
    return { from: m.from, options, validFor: /^#[\p{L}\p{N}_\-/]*$/u }
  }
}
