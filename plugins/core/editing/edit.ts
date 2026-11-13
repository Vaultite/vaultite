import { startCompletion } from "@codemirror/autocomplete"
import { deleteLine, moveLineDown, moveLineUp } from "@codemirror/commands"
export { indentLess, indentMore } from "@codemirror/commands"
import { EditorSelection, type EditorState, type Line } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { blockPieces, paragraphAt } from "@vaultite"

function run(state: EditorState, pos: number, c: string, dir: -1 | 1) {
  let n = 0
  while (true) {
    const at = dir < 0 ? pos - n - 1 : pos + n
    if (at < 0 || at >= state.doc.length || state.sliceDoc(at, at + 1) !== c) return n
    n++
  }
}
function holds(m: string, before: number, after: number) {
  if (m === "*") return before % 2 === 1 && after % 2 === 1
  if (m === "**") return before >= 2 && after >= 2
  return before >= m.length && after >= m.length
}

function unmarkOf(state: EditorState, from: number, to: number, m: string) {
  const c = m[0], text = state.sliceDoc(from, to)
  if (text.length > 2 * m.length && text.startsWith(m) && text.endsWith(m) && holds(m, run(state, from, c, 1), run(state, to, c, -1))) {
    return [{ from, to: from + m.length }, { from: to - m.length, to }]
  }
  if (holds(m, run(state, from, c, -1), run(state, to, c, 1))) return [{ from: from - m.length, to: from }, { from: to, to: to + m.length }]
  return null
}

export const toggleMark = (m: string) => (view: EditorView) => {
  const { state } = view
  const c = m[0]
  view.dispatch(state.changeByRange((r) => {
    let { from, to } = r
    if (!r.empty) {
      const pieces = blockPieces(state.doc, from, to)
      if (!pieces.length) return { range: r }
      const offs = pieces.map((p) => unmarkOf(state, p.from, p.to, m))
      const changes = offs.every((o) => o !== null) ? offs.flat()
        : pieces.flatMap((p, i) => offs[i] ? [] : [{ from: p.from, insert: m }, { from: p.to, insert: m }])
      const cs = state.changes(changes)
      return { changes: cs, range: EditorSelection.range(cs.mapPos(pieces[0].from, 1), cs.mapPos(pieces[pieces.length - 1].to, -1)) }
    }
    if (r.empty) {
      const w = state.wordAt(r.head)
      if (w) ({ from, to } = w)
    }
    const text = state.sliceDoc(from, to)
    if (text.length > 2 * m.length && text.startsWith(m) && text.endsWith(m) && holds(m, run(state, from, c, 1), run(state, to, c, -1))) {
      const inner = text.slice(m.length, -m.length)
      return { changes: { from, to, insert: inner }, range: EditorSelection.range(from, from + inner.length) }
    }
    if (holds(m, run(state, from, c, -1), run(state, to, c, 1))) {
      const sel = r.empty ? EditorSelection.cursor(r.head - m.length) : EditorSelection.range(from - m.length, to - m.length)
      return { changes: [{ from: from - m.length, to: from }, { from: to, to: to + m.length }], range: sel }
    }
    const sel = r.empty ? EditorSelection.cursor(r.head + m.length) : EditorSelection.range(from + m.length, to + m.length)
    return { changes: [{ from, insert: m }, { from: to, insert: m }], range: sel }
  }), { userEvent: "input" })
  return true
}

const MARKS = ["**", "__", "==", "~~", "%%", "*", "_", "`", "$"]
const MARK_CHAR = /[*_=~%`$]/
const STRIP = [/(\*\*|__|==|~~|%%)(?=\S)((?:(?!\n[ \t]*\n)[^])*?\S)\1/g, /(?<![\w*])([*_])(?=\S)(.*?\S)\1(?![\w*])/g, /(`)([^`\n]+)`/g, /(\$)(?=\S)([^$\n]*?\S)\$/g]

export const clearFormatting = (view: EditorView, colors = "") => {
  const { state } = view
  const opened = colors ? new RegExp(`==${colors}$`, "u") : null, colored = colors ? new RegExp(`(?<!=)==${colors}(?=\\S)`, "gu") : null
  view.dispatch(state.changeByRange((r) => {
    let { from, to } = r
    if (r.empty) { const w = state.wordAt(r.head); if (w) ({ from, to } = w) }
    else {
      const a = state.doc.lineAt(from).from, b = state.doc.lineAt(to).to
      for (;;) {
        while (from > a && MARK_CHAR.test(state.sliceDoc(from - 1, from))) from--
        const e = opened?.exec(state.sliceDoc(Math.max(a, from - 5), from))
        if (!e) break
        from -= e[0].length
      }
      while (to < b && MARK_CHAR.test(state.sliceDoc(to, to + 1))) to++
    }
    for (let grew = true; grew;) {
      grew = false
      for (const m of MARKS) {
        if (state.sliceDoc(from - m.length, from) === m && state.sliceDoc(to, to + m.length) === m) { from -= m.length; to += m.length; grew = true; break }
      }
      const hl = !grew && opened ? opened.exec(state.sliceDoc(Math.max(0, from - 5), from)) : null
      if (hl && state.sliceDoc(to, to + 2) === "==") { from -= hl[0].length; to += 2; grew = true }
    }
    const strip = (t: string) => {
      if (colored) t = t.replace(colored, "==")
      for (let was = ""; was !== t;) { was = t; for (const re of STRIP) t = t.replace(re, "$2") }
      return t
    }
    let text = "", done = from
    for (let pos = from; pos <= to;) {
      const para = paragraphAt(state.doc, pos), a = Math.max(para.from, from), b = Math.min(para.to, to)
      text += state.sliceDoc(done, a) + strip(state.sliceDoc(a, b))
      done = b
      if (para.to >= state.doc.length) break
      pos = para.to + 1
    }
    text += state.sliceDoc(done, to)
    return { changes: { from, to, insert: text }, range: EditorSelection.range(from, from + text.length) }
  }), { userEvent: "input" })
  return true
}

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

function linesOf(state: EditorState) {
  const seen = new Set<number>(), out: Line[] = []
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      if (!seen.has(n)) { seen.add(n); out.push(state.doc.line(n)) }
    }
  }
  return out.sort((a, b) => a.number - b.number)
}
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

export const toggleChecklist = (view: EditorView) => rewriteLines(view, (t) => {
  const m = LIST.exec(t)
  if (m?.[3]) return { len: m[0].length, insert: `${m[1]}${m[2]} [${m[4] === " " ? "x" : " "}] ` }
  if (m) return { len: m[0].length, insert: `${m[1]}${m[2]} [ ] ` }
  const indent = /^\s*/.exec(t)![0]
  return { len: indent.length, insert: `${indent}- [ ] ` }
})

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

export const setHeading = (level: number) => (view: EditorView) => rewriteLines(view, (t) => {
  const m = /^#{1,6}[ \t]+|^#{1,6}$/.exec(t)
  return { len: m ? m[0].length : 0, insert: level ? `${"#".repeat(level)} ` : "" }
})

export function toggleQuote(view: EditorView) {
  const all = linesOf(view.state).every((l) => /^\s*>/.test(l.text))
  return rewriteLines(view, (t) => {
    if (all) { const m = /^(\s*)> ?/.exec(t)!; return { len: m[0].length, insert: m[1] } }
    return { len: 0, insert: "> " }
  })
}

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

export async function pastePlain(view: EditorView) {
  const text = await navigator.clipboard.readText()
  if (text) view.dispatch(view.state.replaceSelection(text), { userEvent: "input.paste", scrollIntoView: true })
  return true
}
