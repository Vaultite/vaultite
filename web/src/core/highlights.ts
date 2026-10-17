// Highlight colours, as Obsidian 1.14 writes them: a colour emoji at a highlight's start (==🟢text==), never shown.
// Drawn with the class `hl-<colour>` (index.css). CodeMirror types only: the editor is its own chunk.
import type { EditorState, Text } from "@codemirror/state"
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
/** The same over a paragraph's text: it runs on over soft line breaks (markdown.ts reads it so in a paragraph). */
export const HIGHLIGHT_SPAN = /(?<!=)==(?=[^\s=])([\s\S]+?)(?<=[^\s=])==(?!=)/g
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

const QUOTE = /^[ \t]*(?:>[ \t]?)+/
/** A line's text past its quote marks. */
const unquoted = (t: string) => t.replace(QUOTE, "")
const LEAD = /^(?:[ \t]*(?:#{1,6}[ \t]+|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,9}[.)][ \t]+))*/
/** Does a line start a block of its own (a list item, heading, fence, table row, rule), so it never joins a paragraph? */
const starts = (t: string) => /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)|^ {0,3}(?:#{1,6}(?:[ \t]|$)|```|~~~)|^[ \t]*\||^ {0,3}(?:[-*_][ \t]*){3,}$/.test(unquoted(t))
const blank = (t: string) => !unquoted(t).trim()

/** The lines of the soft-wrapped paragraph around `pos`: up to a blank line or a line that starts another block
 *  (list item, quote, heading, fence, table row, rule). */
export function paragraphAt(doc: Text, pos: number): { from: number; to: number } {
  const at = doc.lineAt(pos)
  if (blank(at.text) || /^ {0,3}(?:#{1,6}(?:[ \t]|$)|```|~~~)|^[ \t]*\||^ {0,3}(?:[-*_][ \t]*){3,}$/.test(unquoted(at.text))) return { from: at.from, to: at.to }
  let top = at, bottom = at
  // (a quote starting or ending on the line before makes another block; the plain line after a quote's last one is still it)
  const next = (l: typeof at, dir: 1 | -1) => {
    const n = l.number + dir
    if (n < 1 || n > doc.lines) return null
    const x = doc.line(n)
    const [first, second] = dir > 0 ? [l, x] : [x, l]
    if (blank(x.text) || (dir > 0 ? starts(x.text) : starts(l.text)) || (QUOTE.test(second.text) && !QUOTE.test(first.text)) || /^ {0,3}(?:#{1,6}(?:[ \t]|$)|```|~~~)|^[ \t]*\|/.test(unquoted(x.text))) return null
    return x
  }
  for (let x = next(top, -1); x; x = next(top, -1)) top = x
  for (let x = next(bottom, 1); x; x = next(bottom, 1)) bottom = x
  return { from: top.from, to: bottom.to }
}

/** from..to cut into one piece per block it touches (a mark never runs across blocks), each without its list marker,
 *  quote marks and edge spaces; none empty. */
export function blockPieces(doc: Text, from: number, to: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  for (let pos = from; pos <= to;) {
    const p = paragraphAt(doc, pos)
    const a = Math.max(p.from, from), b = Math.min(p.to, to)
    // (only a paragraph's first line has a list marker or heading mark of its own; later lines can carry quote marks)
    const l0 = doc.lineAt(a), q = QUOTE.exec(l0.text)?.[0].length ?? 0
    const lead = l0.from + q + (l0.from === p.from ? LEAD.exec(l0.text.slice(q))?.[0].length ?? 0 : 0)
    const start = Math.max(a, lead)
    const text = doc.sliceString(start, b), t0 = text.length - text.trimStart().length
    const end = b - (text.length - text.trimEnd().length)
    if (start + t0 < end) out.push({ from: start + t0, to: end })
    const nextLine = doc.lineAt(p.to)
    if (nextLine.number >= doc.lines) break
    pos = nextLine.to + 1
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
  const re = new RegExp(HIGHLIGHT_SPAN.source, "g")
  for (let m; (m = re.exec(state.sliceDoc(p.from, p.to)));) {
    const a = p.from + m.index, b = a + m[0].length
    if (a > from) break
    if (to > b) continue
    const c = highlightColor(m[1])
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
  for (const r of state.selection.ranges) {
    // (a selection over several blocks marks each one: a highlight never runs across them)
    const pieces = r.empty ? [] : blockPieces(state.doc, r.from, r.to)
    for (const piece of pieces.length > 1 ? pieces : [r]) {
      const h = highlightAt(state, piece.from, piece.to)
      if (h) { changes.push(recolor(h, color)); continue }
      let { from, to } = piece
      if (r.empty) { const w = state.wordAt(r.head); if (w) ({ from, to } = w) }
      changes.push({ from, insert: open }, { from: to, insert: "==" })
      // (nothing to wrap: the cursor goes between the new marks)
      if (from === to && state.selection.ranges.length === 1) cursor = from + open.length
    }
  }
  // (a selection maps inside the marks put around it; two cursors in one highlight change it once)
  const once = new Map(changes.map((c) => [`${c.from}:${c.to ?? ""}:${c.insert}`, c]))
  view.dispatch({ changes: [...once.values()], ...(cursor !== undefined ? { selection: { anchor: cursor } } : {}), userEvent: "input" })
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
