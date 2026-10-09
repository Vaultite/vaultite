// What the editing commands do to a note's editor (index.tsx lists them): each takes the CodeMirror view and changes
// every selection the way the command's name says. Loaded when one first runs.
import { startCompletion } from "@codemirror/autocomplete"
import { deleteLine, moveLineDown, moveLineUp } from "@codemirror/commands"
export { indentLess, indentMore } from "@codemirror/commands"
import { EditorSelection, type EditorState, type Line } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"

/** How many of `c` run back from `pos` (or on from it, `dir` 1). */
function run(state: EditorState, pos: number, c: string, dir: -1 | 1) {
  let n = 0
  while (true) {
    const at = dir < 0 ? pos - n - 1 : pos + n
    if (at < 0 || at >= state.doc.length || state.sliceDoc(at, at + 1) !== c) return n
    n++
  }
}
/** Whether runs of `c` this long on both sides hold mark `m` (`*` is italic in 1 or 3 of them, `**` bold in 2 or 3). */
function holds(m: string, before: number, after: number) {
  if (m === "*") return before % 2 === 1 && after % 2 === 1
  if (m === "**") return before >= 2 && after >= 2
  return before >= m.length && after >= m.length
}

/** Bold, italic, ==highlight==, ~~strike~~, `code`, %%comment%%: on what's selected (with nothing selected, the word
 *  at the cursor; between words, the marks with the cursor between them), or off where it's already marked. */
export const toggleMark = (m: string) => (view: EditorView) => {
  const { state } = view
  const c = m[0]
  view.dispatch(state.changeByRange((r) => {
    let { from, to } = r
    if (r.empty) {
      const w = state.wordAt(r.head)
      if (w) ({ from, to } = w)
    }
    const text = state.sliceDoc(from, to)
    // The marks selected with the text.
    if (text.length > 2 * m.length && text.startsWith(m) && text.endsWith(m) && holds(m, run(state, from, c, 1), run(state, to, c, -1))) {
      const inner = text.slice(m.length, -m.length)
      return { changes: { from, to, insert: inner }, range: EditorSelection.range(from, from + inner.length) }
    }
    // The marks around it.
    if (holds(m, run(state, from, c, -1), run(state, to, c, 1))) {
      const sel = r.empty ? EditorSelection.cursor(r.head - m.length) : EditorSelection.range(from - m.length, to - m.length)
      return { changes: [{ from: from - m.length, to: from }, { from: to, to: to + m.length }], range: sel }
    }
    const sel = r.empty ? EditorSelection.cursor(r.head + m.length) : EditorSelection.range(from + m.length, to + m.length)
    return { changes: [{ from, insert: m }, { from: to, insert: m }], range: sel }
  }), { userEvent: "input" })
  return true
}

// Inline marks, longest first (so ** is taken before *).
const MARKS = ["**", "__", "==", "~~", "%%", "*", "_", "`", "$"]
const STRIP = [/(\*\*|__|==|~~|%%)(?=\S)(.*?\S)\1/g, /(?<![\w*])([*_])(?=\S)(.*?\S)\1(?![\w*])/g, /(`)([^`\n]+)`/g, /(\$)(?=\S)([^$\n]*?\S)\$/g]

/** Clear formatting: the marks in what's selected (with nothing selected, the word at the cursor), and those around
 *  it, taken out; the text stays selected. */
export const clearFormatting = (view: EditorView) => {
  const { state } = view
  view.dispatch(state.changeByRange((r) => {
    let { from, to } = r
    if (r.empty) { const w = state.wordAt(r.head); if (w) ({ from, to } = w) }
    for (let grew = true; grew;) {
      grew = false
      for (const m of MARKS) {
        if (state.sliceDoc(from - m.length, from) === m && state.sliceDoc(to, to + m.length) === m) { from -= m.length; to += m.length; grew = true; break }
      }
    }
    let text = state.sliceDoc(from, to)
    for (let was = ""; was !== text;) { was = text; for (const re of STRIP) text = text.replace(re, "$2") }
    return { changes: { from, to, insert: text }, range: EditorSelection.range(from, from + text.length) }
  }), { userEvent: "input" })
  return true
}

/** Insert footnote: the next [^n] after the selection, and its definition at the end of the note,
 *  the cursor there to write it. */
export function insertFootnote(view: EditorView) {
  const { state } = view
  const used = new Set([...state.doc.toString().matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1])))
  let n = 1
  while (used.has(n)) n++
  const at = state.selection.main.to, end = state.doc.length
  const tail = state.sliceDoc(Math.max(0, end - 2), end)
  const def = `${tail.endsWith("\n\n") ? "" : tail.endsWith("\n") ? "\n" : "\n\n"}[^${n}]: `
  view.dispatch({ changes: [{ from: at, insert: `[^${n}]` }, { from: end, insert: def }], selection: { anchor: end + `[^${n}]`.length + def.length }, userEvent: "input", scrollIntoView: true })
  return true
}

const URL_RE = /^(https?:\/\/|www\.)\S+$/

/** ⌘K: the selection as a link's text, the cursor where its address goes ([text](|)); a selected address as the
 *  address, the cursor in the text ([|](url)); nothing selected: [|](). */
export function insertLink(view: EditorView) {
  const { state } = view
  view.dispatch(state.changeByRange((r) => {
    const text = state.sliceDoc(r.from, r.to)
    if (URL_RE.test(text.trim())) return { changes: { from: r.from, to: r.to, insert: `[](${text.trim()})` }, range: EditorSelection.cursor(r.from + 1) }
    const insert = `[${text}]()`
    return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.cursor(r.from + (text ? insert.length - 1 : 1)) }
  }), { userEvent: "input" })
  return true
}

/** Add internal link: [[selection]], or [[|]] with the suggestions open. */
export function insertWikilink(view: EditorView) {
  const { state } = view
  const empty = state.selection.ranges.every((r) => r.empty)
  view.dispatch(state.changeByRange((r) => {
    const text = state.sliceDoc(r.from, r.to)
    return { changes: { from: r.from, to: r.to, insert: `[[${text}]]` }, range: EditorSelection.cursor(r.from + 2 + text.length) }
  }), { userEvent: "input" })
  if (empty) startCompletion(view)
  return true
}

/** The lines the selections touch, each once, top to bottom. */
function linesOf(state: EditorState) {
  const seen = new Set<number>(), out: Line[] = []
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      if (!seen.has(n)) { seen.add(n); out.push(state.doc.line(n)) }
    }
  }
  return out.sort((a, b) => a.number - b.number)
}
/** Rewrite each selected line's start (its indent, list marker, checkbox, heading or quote marks): `fn` gets the line
 *  and returns what its first `len` characters become. The cursors move with the text. */
function rewriteLines(view: EditorView, fn: (text: string, i: number) => { len: number; insert: string } | null) {
  const changes = linesOf(view.state).flatMap((l, i) => {
    const r = fn(l.text, i)
    return r ? [{ from: l.from, to: l.from + r.len, insert: r.insert }] : []
  })
  if (!changes.length) return true
  view.dispatch({ changes, userEvent: "input" })
  return true
}

const LIST = /^(\s*)([-*+]|\d+[.)])( +\[(.)\])?( +|$)/

/** ⌘L: a line becomes a task (- [ ] ), a task is ticked, a ticked one unticked; a list item keeps its marker. */
export const toggleChecklist = (view: EditorView) => rewriteLines(view, (t) => {
  const m = LIST.exec(t)
  if (m?.[3]) return { len: m[0].length, insert: `${m[1]}${m[2]} [${m[4] === " " ? "x" : " "}] ` }
  if (m) return { len: m[0].length, insert: `${m[1]}${m[2]} [ ] ` }
  const indent = /^\s*/.exec(t)![0]
  return { len: indent.length, insert: `${indent}- [ ] ` }
})

/** Toggle bullet list: lines that are all bullets lose them; otherwise each becomes one (a numbered item or a task
 *  turns into a plain bullet). */
export function toggleBullets(view: EditorView) {
  const lines = linesOf(view.state).filter((l) => l.text.trim())
  const all = lines.length > 0 && lines.every((l) => { const m = LIST.exec(l.text); return m && !/\d/.test(m[2]) && !m[3] })
  return rewriteLines(view, (t) => {
    if (!t.trim()) return null
    const m = LIST.exec(t)
    if (all) return { len: m![0].length, insert: m![1] }
    if (m) return { len: m[0].length, insert: `${m[1]}- ` }
    const indent = /^\s*/.exec(t)![0]
    return { len: indent.length, insert: `${indent}- ` }
  })
}

/** Toggle task list: lines that are all tasks lose their checkboxes and markers; otherwise each becomes a task
 *  (a list item keeps its marker). */
export function toggleTasks(view: EditorView) {
  const lines = linesOf(view.state).filter((l) => l.text.trim())
  const all = lines.length > 0 && lines.every((l) => LIST.exec(l.text)?.[3])
  return rewriteLines(view, (t) => {
    if (!t.trim()) return null
    const m = LIST.exec(t)
    if (all) return { len: m![0].length, insert: m![1] }
    if (m) return { len: m[0].length, insert: `${m[1]}${m[2]} [ ] ` }
    const indent = /^\s*/.exec(t)![0]
    return { len: indent.length, insert: `${indent}- [ ] ` }
  })
}

/** Toggle numbered list: numbered lines lose their numbers; otherwise they're numbered 1, 2, 3… */
export function toggleNumbers(view: EditorView) {
  const lines = linesOf(view.state).filter((l) => l.text.trim())
  const all = lines.length > 0 && lines.every((l) => /\d/.test(LIST.exec(l.text)?.[2] ?? ""))
  let n = 0
  return rewriteLines(view, (t) => {
    if (!t.trim()) return null
    const m = LIST.exec(t)
    if (all) return { len: m![0].length, insert: m![1] }
    n++
    if (m) return { len: m[0].length, insert: `${m[1]}${n}. ` }
    const indent = /^\s*/.exec(t)![0]
    return { len: indent.length, insert: `${indent}${n}. ` }
  })
}

/** Set as heading 1–6 (0: Remove heading). */
export const setHeading = (level: number) => (view: EditorView) => rewriteLines(view, (t) => {
  const m = /^#{1,6}[ \t]+|^#{1,6}$/.exec(t)
  return { len: m ? m[0].length : 0, insert: level ? `${"#".repeat(level)} ` : "" }
})

/** Toggle blockquote: quoted lines lose their > ; otherwise every line gets one. */
export function toggleQuote(view: EditorView) {
  const all = linesOf(view.state).every((l) => /^\s*>/.test(l.text))
  return rewriteLines(view, (t) => {
    if (all) { const m = /^(\s*)> ?/.exec(t)!; return { len: m[0].length, insert: m[1] } }
    return { len: 0, insert: "> " }
  })
}

/** Text that goes on lines of its own (a callout, a fence, a table, a rule), the cursor at its `‸`: around what's
 *  selected (in place of `‸`), on the cursor's line when it's empty, else after it. */
export const insertBlock = (block: string) => (view: EditorView) => {
  const { state } = view
  const r = state.selection.main
  const line = state.doc.lineAt(r.from)
  let from: number, to: number, lead = ""
  if (!r.empty) { from = r.from; to = r.to; if (from !== line.from) lead = "\n" }
  else if (!line.text.trim()) { from = line.from; to = line.to }
  else { from = to = line.to; lead = "\n\n" }
  const text = lead + block.replace("‸", `${state.sliceDoc(r.from, r.to)}‸`)
  const at = text.indexOf("‸")
  view.dispatch({ changes: { from, to, insert: text.replace("‸", "") }, selection: { anchor: from + at }, userEvent: "input", scrollIntoView: true })
  return true
}

export const deleteParagraph = deleteLine
export const lineUp = moveLineUp
export const lineDown = moveLineDown

/** Paste as plain text: the clipboard's text, as it is, in place of the selection (nothing a paste would make of it). */
export async function pastePlain(view: EditorView) {
  const text = await navigator.clipboard.readText()
  if (text) view.dispatch(view.state.replaceSelection(text), { userEvent: "input.paste", scrollIntoView: true })
  return true
}

/** Put text at the cursor (in place of the selection). */
export function insertText(view: EditorView, text: string) {
  view.dispatch(view.state.replaceSelection(text), { userEvent: "input", scrollIntoView: true })
  return true
}
