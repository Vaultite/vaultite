import type { EditorState, Text } from "@codemirror/state"
import { scan } from "../../../core/sections.ts"

// CodeMirror can't measure a hidden-Markdown line's very start (it has no size): scroll to its text.
export const textStart = (state: EditorState, pos: number) => textStartIn(state.doc, pos)
export function textStartIn(doc: Text, pos: number) {
  const l = doc.lineAt(pos)
  const m = /^(?:[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+|\[\^[^\]\s]+\]:[ \t]?))*/.exec(l.text)
  return l.from + (m ? m[0].length : 0)
}

export type Scan = ReturnType<typeof scan> & { starts: number[]; text: string }
const scans = new WeakMap<Text, Scan>()
export function scanOf(doc: Text): Scan {
  let s = scans.get(doc)
  if (!s) {
    const text = doc.toString(), r = scan(text)
    const starts: number[] = new Array(r.lines.length)
    for (let i = 0, at = 0; i < r.lines.length; i++) { starts[i] = at; at += r.lines[i].length + 1 }
    s = { ...r, starts, text }
    scans.set(doc, s)
  }
  return s
}
