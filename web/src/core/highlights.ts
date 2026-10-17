// Highlight colours, as Obsidian 1.14 writes them: a colour emoji at a highlight's start (==🟢text==), never shown.
// Drawn with the class `hl-<colour>` (index.css). CodeMirror types only: the editor is its own chunk.
import type { EditorState, Text } from "@codemirror/state"
import { scan } from "../../../core/sections.ts"
import type { EditorView } from "@codemirror/view"

/** The six colours, in Obsidian's order: each one's name (drawn as `hl-<name>`) and emoji. */
export const HIGHLIGHT_COLORS = [
  { name: "red", emoji: "🔴" }, { name: "orange", emoji: "🟠" }, { name: "yellow", emoji: "🟡" },
  { name: "green", emoji: "🟢" }, { name: "blue", emoji: "🔵" }, { name: "purple", emoji: "🟣" },
] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]["name"]

/** A colour emoji (with the variation selector some keyboards add after it). */
export const HIGHLIGHT_EMOJI = `(?:${HIGHLIGHT_COLORS.map((c) => c.emoji).join("|")})\\uFE0F?`
/** ==a highlight== on one line. */
export const HIGHLIGHT = /(?<!=)==(?=[^\s=])(.+?)(?<=[^\s=])==(?!=)/g
const LEADING = new RegExp(`^${HIGHLIGHT_EMOJI}`, "u")

/** The colour a highlight's text starts with, and how long its emoji is (UTF-16 units); null: the default. */
export function highlightColor(text: string): { color: HighlightColor; len: number } | null {
  const m = LEADING.exec(text)
  if (!m) return null
  const emoji = m[0].replace("️", "")
  return { color: HIGHLIGHT_COLORS.find((c) => c.emoji === emoji)!.name, len: m[0].length }
}

const emojiOf = (color: HighlightColor | null) => (color ? HIGHLIGHT_COLORS.find((c) => c.name === color)!.emoji : "")

/** The class a highlight of that colour is drawn with (none for the default). */
export const highlightClass = (color: HighlightColor | null | undefined) => (color ? `hl-${color}` : "")

/** Each `==🟢` at a highlight's start back to `==`, for text shown without its marks (previews, sorting). */
export const dropHighlightEmoji = (md: string) => md.replace(new RegExp(`(?<!=)==${HIGHLIGHT_EMOJI}(?=[^\\s=])`, "gu"), "==")

// ---------- paragraphs: what a mark runs over ----------

/** ==highlights== in a paragraph's text, running over its soft line breaks. One pass: an opener with no closer after it
 *  ends the search (no later one has a closer either), so unclosed ones cost nothing. `inner`: between the marks. */
export function highlightSpans(text: string): { index: number; length: number; inner: string }[] {
  const out: { index: number; length: number; inner: string }[] = []
  const open = /(?<!=)==(?=[^\s=])/g, close = /(?<=[^\s=])==(?!=)/g
  for (let m; (m = open.exec(text));) {
    close.lastIndex = m.index + 3
    const c = close.exec(text)
    if (!c) break
    out.push({ index: m.index, length: c.index + 2 - m.index, inner: text.slice(m.index + 2, c.index) })
    open.lastIndex = c.index + 2
  }
  return out
}
/** Is a == typed after `before` (the paragraph's text so far) a closing one, a highlight being open? */
export function closesHighlight(before: string): boolean {
  let open = false
  for (const m of before.matchAll(/(?<!=)==(?!=)/g)) {
    const prev = before[m.index - 1], next = before[m.index + 2]
    if (!open) open = !!next && !/[\s=]/.test(next)
    else if (prev && !/\s/.test(prev)) open = false
  }
  return open && !!before.length && !/\s$/.test(before)
}
/** The %%comments%% of a paragraph's text (from, to), over soft breaks too. */
export function commentSpans(text: string): [number, number][] {
  const out: [number, number][] = []
  for (let a = text.indexOf("%%"); a >= 0;) {
    const b = text.indexOf("%%", a + 2)
    if (b < 0) break
    out.push([a, b + 2])
    a = text.indexOf("%%", b + 2)
  }
  return out
}

const QUOTE = /^[ \t]*(?:>[ \t]?)+/
/** A line's text past its quote marks. */
export const unquoted = (t: string) => t.replace(QUOTE, "")
const depth = (t: string) => (QUOTE.exec(t)?.[0].match(/>/g)?.length ?? 0)
const LEAD = /^(?:[ \t]*(?:#{1,6}[ \t]+|[-*+][ \t]+(?:\[[^\]]\][ \t]+)?|\d{1,9}[.)][ \t]+))*/
const ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/
// Lines that are a block alone: marks never go on them (fences, rules, table rows, math, a callout's head)...
const DELIM = /^[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/
const SKIP = /^ {0,3}(?:```|~~~|\$\$)|^ {0,3}(?:[-*_][ \t]*){3,}$|^[ \t]*\||^\[![\w-]+\][+-]?/
// ...and ones that only never join a neighbour (headings, HTML, footnote definitions, a setext underline).
const ALONE = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|<\/?[a-z!]|\[\^[^\]\s]+\]:|=+[ \t]*$)/i
const alone = (t: string) => { const u = unquoted(t); return SKIP.test(u) || ALONE.test(u) || DELIM.test(u) }
const blank = (t: string) => !unquoted(t).trim()
/** Do two neighbouring lines (a above b) belong to one paragraph? A deeper or different quote starts another; a plain
 *  line after a quote is still it (lazy continuation). */
const joins = (a: string, b: string) => {
  if (blank(a) || blank(b) || alone(a) || alone(b) || ITEM.test(unquoted(b))) return false
  const da = depth(a), db = depth(b)
  return da === db || (db === 0 && da > 0)
}
/** Lines taken at most this far each way: a paragraph that long isn't prose, and it bounds the work per keystroke. */
const REACH = 300

/** The lines of the soft-wrapped paragraph around `pos`: up to a blank line or a line that starts another block
 *  (list item, quote, heading, fence, table, math, HTML, footnote definition, callout head, setext underline). */
export function paragraphAt(doc: Text, pos: number): { from: number; to: number } {
  const at = doc.lineAt(pos)
  if (alone(at.text) || blank(at.text)) return { from: at.from, to: at.to }
  let top = at, bottom = at
  for (let x = top; x.number > Math.max(1, at.number - REACH) && joins(doc.line(x.number - 1).text, x.text); x = top) top = doc.line(x.number - 1)
  for (let x = bottom; x.number < Math.min(doc.lines, at.number + REACH) && joins(x.text, doc.line(x.number + 1).text); x = bottom) bottom = doc.line(x.number + 1)
  // (a table's header row, or a setext heading's text, comes just before its delimiter or underline)
  const below = bottom.number < doc.lines ? unquoted(doc.line(bottom.number + 1).text) : ""
  if (DELIM.test(below)) { if (at.number === bottom.number) top = bottom; else bottom = doc.line(bottom.number - 1) }
  return { from: top.from, to: bottom.to }
}

/** from..to cut into one piece per block it touches (a mark never runs across blocks), each without its list marker,
 *  quote marks and edge spaces; none empty. Code, math, tables, rules, callout heads and comments get none. */
export function blockPieces(doc: Text, from: number, to: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  const { prose, code, lines } = scan(doc.toString())
  const math: boolean[] = []
  for (let i = 0, on = false; i < lines.length; i++) {
    const n = (lines[i].match(/\$\$/g) ?? []).length
    math[i] = on || n % 2 === 1
    if (n % 2 === 1 && !code[i]) on = !on
  }
  for (let pos = from; pos <= to;) {
    const p = paragraphAt(doc, pos)
    const a = Math.max(p.from, from), b = Math.min(p.to, to)
    const l0 = doc.lineAt(a), q = QUOTE.exec(l0.text)?.[0].length ?? 0
    const lead = l0.from + q + (l0.from === p.from ? LEAD.exec(l0.text.slice(q))?.[0].length ?? 0 : 0)
    const start = Math.max(a, lead)
    const text = doc.sliceString(start, b), t0 = text.length - text.trimStart().length
    const end = b - (text.length - text.trimEnd().length)
    const i = l0.number - 1
    if (start + t0 < end && prose[i] && !code[i] && !math[i] && !SKIP.test(unquoted(l0.text)) && !DELIM.test(unquoted(l0.text)) && !(l0.from === p.from && /^\[![\w-]+\]/.test(unquoted(l0.text).replace(LEAD, "")))) out.push({ from: start + t0, to: end })
    const last = doc.lineAt(p.to)
    if (last.number >= doc.lines) break
    pos = last.to + 1
  }
  return out
}

// ---------- in an editor ----------

/** A highlight: `from` at its opening ==, `to` after its closing one, `len` its colour emoji's length. */
export type Highlight = { from: number; to: number; color: HighlightColor | null; len: number }

/** The highlight from..to is in (its marks too), in that paragraph. */
export function highlightAt(state: EditorState, from: number, to = from): Highlight | null {
  const p = paragraphAt(state.doc, from)
  if (to > p.to) return null
  for (const m of highlightSpans(state.sliceDoc(p.from, p.to))) {
    const a = p.from + m.index, b = a + m.length
    if (a > from) break
    if (to > b) continue
    const c = highlightColor(m.inner)
    return { from: a, to: b, color: c?.color ?? null, len: c?.len ?? 0 }
  }
  return null
}

export const recolor = (h: Highlight, color: HighlightColor | null) => ({ from: h.from + 2, to: h.from + 2 + h.len, insert: emojiOf(color) })
export const unmark = (h: Highlight) => [{ from: h.from, to: h.from + 2 + h.len }, { from: h.to - 2, to: h.to }]

/** Colour the highlight each selection is in (null: the default, no emoji); elsewhere, highlight the selection (or the
 *  word at the cursor) in it. */
export const colorHighlight = (color: HighlightColor | null) => (view: EditorView) => {
  const { state } = view
  const open = `==${emojiOf(color)}`
  const changes: { from: number; to?: number; insert?: string }[] = []
  let cursor: number | undefined
  let selection: { anchor: number; head: number } | undefined
  for (const r of state.selection.ranges) {
    // (a selection marks each block it touches: a highlight never runs across them)
    const pieces = r.empty ? [r] : blockPieces(state.doc, r.from, r.to)
    for (const piece of pieces) {
      const h = highlightAt(state, piece.from, piece.to)
      if (h) { changes.push(recolor(h, color)); continue }
      let { from, to } = piece
      if (r.empty) { const w = state.wordAt(r.head); if (w) ({ from, to } = w) }
      changes.push({ from, insert: open }, { from: to, insert: "==" })
      // (nothing to wrap: the cursor goes between the new marks)
      if (from === to && state.selection.ranges.length === 1) cursor = from + open.length
    }
    // (the selection stays on the text, inside the marks around it)
    if (!r.empty && pieces.length && state.selection.ranges.length === 1) selection = { anchor: pieces[0].from, head: pieces[pieces.length - 1].to }
  }
  // (a selection maps inside the marks put around it; two cursors in one highlight change it once)
  const once = new Map(changes.map((c) => [`${c.from}:${c.to ?? ""}:${c.insert}`, c]))
  const list = [...once.values()]
  const cs = state.changes(list)
  view.dispatch({ changes: list, ...(cursor !== undefined ? { selection: { anchor: cursor } } : selection ? { selection: { anchor: cs.mapPos(selection.anchor, 1), head: cs.mapPos(selection.head, -1) } } : {}), userEvent: "input" })
  return true
}

/** Take out the coloured highlight the selection is in, marks and colour (false if it's in none: plain ones toggle as
 *  the other marks do). */
export function unhighlight(view: EditorView) {
  const { state } = view
  const { main } = state.selection
  if (!highlightAt(state, main.from, main.to)?.color) return false
  const hs = state.selection.ranges.map((r) => highlightAt(state, r.from, r.to)).filter((h) => h !== null)
  const seen = new Set<number>()
  view.dispatch({ changes: hs.filter((h) => !seen.has(h.from) && seen.add(h.from)).flatMap(unmark), userEvent: "delete" })
  return true
}
