import type { Text } from "@codemirror/state"
import { EditorView, WidgetType } from "@codemirror/view"
import { footnoteText, inlineNoteEnd } from "@/core/markdown"
import { scanOf, textStart } from "./scan"

type Notes = { defs: Map<string, { at: number; text: string }>; num: Map<string, number>; inlineAt: Map<number, number> }
const notesOf = new WeakMap<Text, Notes>()
export const FN_DEF = /^\[\^([^\]\s]+)\]:[ \t]?/
export const FN_REF = /\[\^([^\]\s]+)\](?!:)/g
export function inlineNotes(text: string): [number, number][] {
  const out: [number, number][] = []
  for (let i = text.indexOf("^["); i >= 0; i = text.indexOf("^[", i + 1)) {
    const end = inlineNoteEnd(text, i)
    if (end > 0) { out.push([i, end]); i = end - 1 }
  }
  return out
}
export function footnotes(doc: Text): Notes {
  let n = notesOf.get(doc)
  if (n) return n
  n = { defs: new Map(), num: new Map(), inlineAt: new Map() }
  const { code } = scanOf(doc)
  let count = 0
  for (let k = 1; k <= doc.lines; k++) {
    const l = doc.line(k)
    if (code[k - 1] || !(l.text.includes("[^") || l.text.includes("^["))) continue
    const d = FN_DEF.exec(l.text)
    if (d && !n.defs.has(d[1])) n.defs.set(d[1], { at: l.from, text: footnoteText(l.text.slice(d[0].length)).trim() })
    const seen: [number, string | null][] = inlineNotes(l.text).map(([i]) => [i, null])
    FN_REF.lastIndex = d ? d[0].length : 0
    for (let m; (m = FN_REF.exec(l.text));) seen.push([m.index, m[1]])
    for (const [i, label] of seen.sort((a, b) => a[0] - b[0])) {
      if (label === null) n.inlineAt.set(l.from + i, ++count)
      else if (!n.num.has(label)) n.num.set(label, ++count)
    }
  }
  notesOf.set(doc, n)
  return n
}

// No position stored, as with Check: eq would fail for every reference below an edit.
export class FootnoteRef extends WidgetType {
  label: string; n: number; tip: string; found: boolean
  constructor(label: string, n: number, tip: string, found: boolean) { super(); this.label = label; this.n = n; this.tip = tip; this.found = found }
  eq(o: FootnoteRef) { return o.label === this.label && o.n === this.n && o.tip === this.tip && o.found === this.found }
  toDOM(view: EditorView) {
    const s = document.createElement("sup")
    s.className = `cm-footnote-ref${this.found ? "" : " is-missing"}`
    s.textContent = String(this.n || this.label)
    if (this.tip) s.dataset.tip = this.tip
    s.addEventListener("mousedown", (e) => {
      const at = footnotes(view.state.doc).defs.get(this.label)?.at
      if (at === undefined) return
      e.preventDefault()
      view.dispatch({ effects: EditorView.scrollIntoView(textStart(view.state, at), { y: "center" }) })
    })
    return s
  }
  ignoreEvent() { return true }
}

export class FootnoteLabel extends WidgetType {
  text: string
  constructor(text: string) { super(); this.text = text }
  eq(o: FootnoteLabel) { return o.text === this.text }
  toDOM() { const s = document.createElement("span"); s.className = "cm-footnote-label"; s.textContent = this.text; return s }
}
