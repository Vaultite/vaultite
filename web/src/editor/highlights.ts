// Typing == suggests the highlight colours (core/highlights.ts), each with its dot.
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete"
import { syntaxTree } from "@codemirror/language"
import type { EditorView } from "@codemirror/view"
import { HIGHLIGHT_COLORS, closesHighlight, highlightClass, paragraphAt, type HighlightColor } from "@/core/highlights"
import { capitalize } from "@/lib/utils"
import { inFrontmatter } from "./slash"

const CODE = /^(FencedCode|CodeBlock|CodeText|InlineCode|CodeInfo|CodeMark)$/

type ColorOption = Completion & { highlight: HighlightColor }
/** A suggestion's dot (autocompletion's addToOptions). */
export const optionDot = (c: Completion) => {
  const color = (c as ColorOption).highlight
  if (!color) return null
  const el = document.createElement("span")
  el.className = `hl-dot ${highlightClass(color)} cm-hl-option`
  return el
}

/** == typed (an opening one, not in code): the colours, narrowed by a name typed after it. The pick goes in after the
 *  ==, with the closing == after the cursor unless text follows. */
export function highlightSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/(?<![=\\])==[a-z]*$/i)
  if (!m) return null
  // (a highlight open since an earlier line of the paragraph: this == closes it)
  if (closesHighlight(ctx.state.sliceDoc(paragraphAt(ctx.state.doc, m.from).from, m.from))) return null
  for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(ctx.state).resolveInner(m.from, 1); n; n = n.parent) {
    if (CODE.test(n.name)) return null
  }
  if (inFrontmatter(ctx)) return null
  const q = m.text.slice(2).toLowerCase()
  const options = HIGHLIGHT_COLORS.filter((c) => c.name.startsWith(q)).map(({ name, emoji }, i): ColorOption => ({
    label: capitalize(name), highlight: name, boost: -i,
    apply: (view: EditorView, _c: Completion, from: number, to: number) => {
      const closes = !/^\S/.test(view.state.sliceDoc(to, view.state.doc.lineAt(to).to))
      view.dispatch({ changes: { from, to, insert: closes ? `${emoji}==` : emoji }, selection: { anchor: from + emoji.length }, userEvent: "input.complete" })
    },
  }))
  return options.length ? { from: m.from + 2, options, filter: false } : null
}
