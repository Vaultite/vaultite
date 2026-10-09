// A note's editor holds its whole file, as Obsidian's does, so positions are the file's: the frontmatter at the top is
// hidden (Properties draws it above the editor), out of reach of the cursor and of typing, but plugins see and edit it.
import { EditorSelection, EditorState, StateField, Transaction, type Extension, type Text } from "@codemirror/state"
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view"
import type { MarkdownConfig } from "@lezer/markdown"

const CLOSE = /^---[ \t]*$/

/** Where the body starts in `doc` (0: no frontmatter), as core/files.ts splitFm reads it: `---` on the first line to
 *  the next `---` line, and one blank line after it. */
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

/** Text whose frontmatter ends without a line break, with one: the body always has a line to type on. */
export const withBodyLine = (text: string) => (/^---\n(?:[\s\S]*?\n)?---[ \t]*$/.test(text) ? `${text}\n` : text)

// What the user does with the keyboard and mouse (not undo, not the app's own changes, not plugins' or the disk's).
const byUser = (tr: Transaction) => (tr.isUserEvent("input") && !tr.isUserEvent("input.app")) || tr.isUserEvent("delete") || tr.isUserEvent("move")

/** Where the body starts now. Typing keeps it (Enter at the body's top is a line of the body); any other change to
 *  the text reads it again (a property set, a plugin adding frontmatter, the file changed on disk). */
export const frontmatter: StateField<number> = StateField.define<number>({
  create: (s) => bodyStart(s.doc),
  update: (start, tr) => (!tr.docChanged ? start : byUser(tr) ? tr.changes.mapPos(start, -1) : bodyStart(tr.state.doc)),
  provide: (f) => [
    EditorView.decorations.compute([f], (s) => hiddenIn(s)),
    EditorView.atomicRanges.of((v) => hiddenIn(v.state)),
  ],
})
// (an element of its own, so what comes first in the text is still styled as first: index.css)
class Hidden extends WidgetType {
  eq() { return true }
  toDOM() { const el = document.createElement("div"); el.className = "cm-frontmatter"; el.setAttribute("aria-hidden", "true"); return el }
  get estimatedHeight() { return 0 }
}
const hidden = Decoration.replace({ block: true, widget: new Hidden() })
// (whole lines: to the line break after the frontmatter, or to the end when there's none)
function hiddenIn(s: EditorState): DecorationSet {
  const start = s.field(frontmatter)
  return start ? Decoration.set(hidden.range(0, s.doc.sliceString(start - 1, start) === "\n" ? start - 1 : start)) : Decoration.none
}

/** The frontmatter is out of the user's reach: typing, deleting or dropping over it only touches the body, and
 *  selections start at the body. Plugins' changes, undo and the app's go through as they are. */
const guard = [
  EditorState.changeFilter.of((tr) => { const start = tr.startState.field(frontmatter, false); return start && byUser(tr) ? [0, start] : true }),
  EditorState.transactionFilter.of((tr) => {
    if (!tr.selection && !tr.docChanged) return tr
    const start = tr.state.field(frontmatter, false) ?? 0
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

/** CodeMirror's placeholder, shown while the body is empty (its own is only for an empty document). */
function bodyPlaceholder(text: string): Extension {
  if (!text) return []
  const widget = Decoration.widget({ widget: new Placeholder(text), side: 1 })
  return [
    EditorView.decorations.compute(["doc", frontmatter], (s) => (s.doc.length === s.field(frontmatter) ? Decoration.set(widget.range(s.doc.length)) : Decoration.none)),
    EditorView.contentAttributes.of({ "aria-placeholder": text }),
  ]
}

/** The editor of a whole file whose frontmatter is hidden: `placeholder` while its body is empty. */
export const hiddenFrontmatter = (placeholder: string): Extension => [frontmatter, guard, bodyPlaceholder(placeholder)]

/** The Markdown parser reading a file's frontmatter as one Frontmatter block, not a rule and a setext heading. */
export const frontmatterSyntax: MarkdownConfig = {
  defineNodes: [{ name: "Frontmatter", block: true }],
  parseBlock: [{
    name: "Frontmatter",
    before: "HorizontalRule",
    parse(cx, line) {
      // (the closing line is looked for ahead: once a line is taken it can't be given back)
      const input = (cx as unknown as { input?: { length: number; read: (from: number, to: number) => string } }).input
      if (cx.lineStart !== 0 || line.text !== "---" || !input) return false
      // (read on until it closes, twice as far each time: a frontmatter of any size, the rest of a big file not read)
      let m: RegExpExecArray | null = null
      for (let n = 1 << 16; !m; n *= 2) {
        const upto = Math.min(input.length, n)
        m = /^---\n(?:[\s\S]*?\n)?---[ \t]*(?=\n|$)/.exec(input.read(0, upto))
        if (m && m[0].length === upto && upto < input.length) m = null // (the closing line may go on past what was read)
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
