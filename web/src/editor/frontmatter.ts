import { EditorSelection, EditorState, Facet, StateField, Transaction, type Extension, type Text } from "@codemirror/state"
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view"
import type { BlockContext, MarkdownConfig } from "@lezer/markdown"
import { isObj } from "../../../core/values.ts"

const CLOSE = /^---[ \t]*$/

export function bodyStart(doc: Text): number {
  if (doc.lines < 2 || doc.line(1).text !== "---") return 0
  for (let n = 2; n <= doc.lines; n++) {
    const l = doc.line(n)
    if (!CLOSE.test(l.text)) continue
    if (n === doc.lines) return l.to
    const next = doc.line(n + 1)
    return next.length === 0 && n + 1 < doc.lines ? next.from + 1 : next.from
  }
  return 0
}

export const withBodyLine = (text: string) => (/^---\n(?:[\s\S]*?\n)?---[ \t]*$/.test(text) ? `${text}\n` : text)

const byUser = (tr: Transaction) => (tr.isUserEvent("input") && !tr.isUserEvent("input.app")) || tr.isUserEvent("delete") || tr.isUserEvent("move")

export const frontmatter: StateField<number> = StateField.define<number>({
  create: (s) => bodyStart(s.doc),
  update: (start, tr) => (!tr.docChanged ? start : byUser(tr) ? tr.changes.mapPos(start, -1) : bodyStart(tr.state.doc)),
})

export const titled = Facet.define<string, string>({ combine: (v) => v[0] ?? "" })

const H1 = /^#[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
export function titleEnd(doc: Text, body: number, title: string): number {
  if (!title || body >= doc.length) return body
  const l = doc.lineAt(body)
  if (l.from !== body || l.number === doc.lines || H1.exec(l.text)?.[1].trim() !== title) return body
  const next = doc.line(l.number + 1)
  return next.length === 0 && l.number + 1 < doc.lines ? next.from + 1 : next.from
}

export const shown: StateField<number> = StateField.define<number>({
  create: (s) => titleEnd(s.doc, s.field(frontmatter, false) ?? bodyStart(s.doc), s.facet(titled)),
  update: (start, tr) => {
    const again = () => titleEnd(tr.state.doc, tr.state.field(frontmatter), tr.state.facet(titled))
    if (tr.startState.facet(titled) !== tr.state.facet(titled)) return again()
    return !tr.docChanged ? start : byUser(tr) ? tr.changes.mapPos(start, -1) : again()
  },
  provide: (f) => [
    EditorView.decorations.compute([f], (s) => hiddenIn(s)),
    EditorView.atomicRanges.of((v) => hiddenIn(v.state)),
  ],
})
export const shownStart = (state: EditorState) => state.field(shown, false) ?? state.field(frontmatter, false) ?? 0

class Hidden extends WidgetType {
  eq() { return true }
  toDOM() { const el = document.createElement("div"); el.className = "cm-frontmatter"; el.setAttribute("aria-hidden", "true"); return el }
  get estimatedHeight() { return 0 }
}
const hidden = Decoration.replace({ block: true, widget: new Hidden() })
function hiddenIn(s: EditorState): DecorationSet {
  const start = s.field(shown)
  return start ? Decoration.set(hidden.range(0, s.doc.sliceString(start - 1, start) === "\n" ? start - 1 : start)) : Decoration.none
}

const guard = [
  EditorState.changeFilter.of((tr) => { const start = shownStart(tr.startState); return start && byUser(tr) ? [0, start] : true }),
  EditorState.transactionFilter.of((tr) => {
    if (!tr.selection && !tr.docChanged) return tr
    const start = shownStart(tr.state)
    if (!start || !tr.state.selection.ranges.some((r) => r.from < start)) return tr
    return [tr, { selection: clamp(tr.state.selection, start), sequential: true }]
  }),
]

function clamp(sel: EditorSelection, start: number) {
  return EditorSelection.create(sel.ranges.map((r) => EditorSelection.range(Math.max(r.anchor, start), Math.max(r.head, start))), sel.mainIndex)
}

class Placeholder extends WidgetType {
  text: string
  constructor(text: string) { super(); this.text = text }
  eq(o: Placeholder) { return o.text === this.text }
  toDOM() {
    const el = document.createElement("span")
    el.className = "cm-placeholder"
    el.style.pointerEvents = "none"
    el.setAttribute("aria-hidden", "true")
    el.textContent = this.text
    return el
  }
  ignoreEvent() { return false }
}

// CodeMirror's own placeholder shows only in an empty document.
function bodyPlaceholder(text: string): Extension {
  if (!text) return []
  const widget = Decoration.widget({ widget: new Placeholder(text), side: 1 })
  return [
    EditorView.decorations.compute(["doc", shown], (s) => (s.doc.length === s.field(shown) ? Decoration.set(widget.range(s.doc.length)) : Decoration.none)),
    EditorView.contentAttributes.of({ "aria-placeholder": text }),
  ]
}

export const hiddenFrontmatter = (placeholder: string): Extension => [frontmatter, shown, guard, bodyPlaceholder(placeholder)]

function inputOf(cx: BlockContext): { length: number; read: (from: number, to: number) => string } | null {
  const input = "input" in cx && isObj(cx.input) ? cx.input : null, length = Number(input?.length), read = input?.read
  return input && length >= 0 && read instanceof Function ? { length, read: (from, to) => String(read.call(input, from, to)) } : null
}

export const frontmatterSyntax: MarkdownConfig = {
  defineNodes: [{ name: "Frontmatter", block: true }],
  parseBlock: [{
    name: "Frontmatter",
    before: "HorizontalRule",
    parse(cx, line) {
      // Lezer can't give back a line once taken, so the closing line is found ahead.
      const input = inputOf(cx)
      if (cx.lineStart !== 0 || line.text !== "---" || !input) return false
      let m: RegExpExecArray | null = null
      for (let n = 1 << 16; !m; n *= 2) {
        const upto = Math.min(input.length, n)
        m = /^---\n(?:[\s\S]*?\n)?---[ \t]*(?=\n|$)/.exec(input.read(0, upto))
        if (m && m[0].length === upto && upto < input.length) m = null
        if (upto === input.length) break
      }
      if (!m) return false
      const end = m[0].length
      for (;;) {
        const last = cx.lineStart + line.text.length >= end
        if (!cx.nextLine() || last) break
      }
      cx.addElement(cx.elt("Frontmatter", 0, end))
      return true
    },
  }],
}
