// Do it on an open task line of a note: a button at the line's end, on hover; on a phone, on the caret's line. Loads with
// the editor (editor.ts), so CodeMirror stays out of the app's start.
import { RangeSetBuilder } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view"
import { syntaxTree } from "@codemirror/language"
import type { DoTask } from "@vaultite"
import { doTask } from "./doit"

const OPEN = /^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s+(\S.*)$/
const coarse = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches

/** The open task on line `l` (its text), outside code. */
function openTask(view: EditorView, l: { from: number; text: string }) {
  const m = OPEN.exec(l.text)
  if (!m) return null
  const at = syntaxTree(view.state).resolveInner(l.from, 1).name
  return /Code|Comment|Frontmatter/i.test(at) ? null : m[1]
}

class Button extends WidgetType {
  path: string
  constructor(path: string) { super(); this.path = path }
  eq(o: Button) { return o.path === this.path }
  toDOM(view: EditorView) {
    const b = document.createElement("button")
    b.type = "button"
    b.className = "cm-do-it"
    b.textContent = "Do it"
    b.dataset.doIt = ""
    b.onmousedown = (e) => e.preventDefault()
    b.onclick = (e) => {
      e.preventDefault()
      const l = view.state.doc.lineAt(view.posAtDOM(b)), text = openTask(view, l)
      if (!text) return
      b.disabled = true
      void doTask({ path: this.path, line: l.number, text }).then(() => { b.disabled = false })
    }
    return b
  }
  ignoreEvent() { return true }
}

function buttons(view: EditorView, path: string) {
  const out = new RangeSetBuilder<Decoration>(), widget = Decoration.widget({ widget: new Button(path), side: 1 })
  const only = coarse() ? view.state.doc.lineAt(view.state.selection.main.head).number : 0
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const l = view.state.doc.lineAt(pos)
      pos = l.to + 1
      if ((!only || l.number === only) && openTask(view, l)) out.add(l.to, l.to, widget)
    }
  }
  return out.finish()
}

export const doItEditor = (path: string) => [
  ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = buttons(view, path) }
    update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = buttons(u.view, path) }
  }, { decorations: (v) => v.decorations }),
  EditorView.baseTheme({
    ".cm-do-it": { marginLeft: "8px", padding: "0 6px", border: "0", borderRadius: "6px", background: "transparent", color: "var(--primary)", font: "12px/20px var(--font-sans, system-ui)", cursor: "pointer", opacity: "0" },
    ".cm-line:hover .cm-do-it, .cm-do-it:focus-visible": { opacity: "1" },
    ".cm-do-it:hover": { background: "color-mix(in srgb, var(--foreground) 6%, transparent)" },
    "@media (pointer: coarse)": { ".cm-do-it": { opacity: "1", lineHeight: "28px" } },
  }),
]

/** The caret's line as a task, for the editor's menu. */
export function taskHere(view: EditorView, path: string): DoTask | null {
  const l = view.state.doc.lineAt(view.state.selection.main.head), text = openTask(view, l)
  return text ? { path, line: l.number, text } : null
}
