import { syntaxTree } from "@codemirror/language"
import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import type { SyntaxNode } from "@lezer/common"

const RAW = /^(FencedCode|CodeBlock|InlineCode|Frontmatter|Table)$/
export function pastesRaw(state: EditorState, pos: number) {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) if (RAW.test(n.name)) return true
  return false
}

type Paste = { clipboardData: Pick<DataTransfer, "getData" | "types"> | null; preventDefault(): void }
type Into = { state: EditorState; dispatch(...specs: TransactionSpec[]): void }

const URL_TEXT = /^[a-z][\w+.-]*:\/\/\S+$/i

export function pasteLink(e: Paste, view: Into) {
  const url = e.clipboardData?.getData("text/plain").trim() ?? ""
  const { state } = view
  if (!URL_TEXT.test(url) || !state.facet(EditorView.editable)) return false
  const linkable = state.selection.ranges.every((r) => {
    const text = state.sliceDoc(r.from, r.to)
    return !r.empty && !text.includes("\n") && !URL_TEXT.test(text.trim()) && !pastesRaw(state, r.from)
  })
  if (!linkable) return false
  e.preventDefault()
  view.dispatch(state.changeByRange((r) => {
    const insert = `[${state.sliceDoc(r.from, r.to)}](${url})`
    return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.cursor(r.from + insert.length) }
  }), { userEvent: "input.paste", scrollIntoView: true })
  return true
}

const FORMATTED = /<(a|b|strong|em|i|u|s|del|strike|mark|h[1-6]|ul|ol|li|img|pre|code|blockquote|table|hr|input)\b|<span\b[^>]*style="[^"]*(font-weight|font-style|line-through)/i
const colouredCode = (d: Paste["clipboardData"] & {}, html: string) => d.types.includes("vscode-editor-data") || (/white-space:\s*pre/i.test(html) && !/<pre\b/i.test(html))

export function pasteHtml(e: Paste, view: Into) {
  const d = e.clipboardData, html = d?.getData("text/html") ?? ""
  const { state } = view, at = state.selection.main
  if (!d || !FORMATTED.test(html) || colouredCode(d, html) || !state.facet(EditorView.editable)) return false
  if (state.selection.ranges.length > 1 || pastesRaw(state, at.from)) return false
  e.preventDefault()
  const plain = d.getData("text/plain"), doc = state.doc
  void import("../../../core/htmlmd.ts").then((m) => m.htmlToMarkdown(html)).catch(() => plain).then((md) => {
    const text = md || plain, r = view.state.doc === doc ? at : view.state.selection.main
    view.dispatch({ changes: { from: r.from, to: r.to, insert: text }, selection: EditorSelection.cursor(r.from + text.length),
      scrollIntoView: true, userEvent: "input.paste" })
  })
  return true
}
