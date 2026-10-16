// Highlight colours, as Obsidian 1.14 writes them: a colour emoji at a highlight's start (==🟢text==), never shown.
// Drawn with the class `hl-<colour>` (index.css). CodeMirror types only: the editor is its own chunk.
import type { EditorState } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"

/** The six colours, in Obsidian's order: each one's name (drawn as `hl-<name>`) and emoji. */
export const HIGHLIGHT_COLORS = [
  { name: "red", emoji: "🔴" }, { name: "orange", emoji: "🟠" }, { name: "yellow", emoji: "🟡" },
  { name: "green", emoji: "🟢" }, { name: "blue", emoji: "🔵" }, { name: "purple", emoji: "🟣" },
] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]["name"]

/** A colour emoji (with the variation selector some keyboards add after it). */
export const HIGHLIGHT_EMOJI = `(?:${HIGHLIGHT_COLORS.map((c) => c.emoji).join("|")})\\uFE0F?`
/** ==a highlight== on one line (the editor's; markdown.ts has its own, over lines). */
export const HIGHLIGHT = /(?<!=)==(?=[^\s=])(.+?)(?<=[^\s=])==(?!=)/g
const LEADING = new RegExp(`^${HIGHLIGHT_EMOJI}`, "u")

/** The colour a highlight's text starts with, and how long its emoji is (UTF-16 units); null: the default. */
export function highlightColor(text: string): { color: HighlightColor; len: number } | null {
  const m = LEADING.exec(text)
  if (!m) return null
  const emoji = m[0].replace("️", "")
  return { color: HIGHLIGHT_COLORS.find((c) => c.emoji === emoji)!.name, len: m[0].length }
}

export const emojiOf = (color: HighlightColor | null) => (color ? HIGHLIGHT_COLORS.find((c) => c.name === color)!.emoji : "")

/** The class a highlight of that colour is drawn with (none for the default). */
export const highlightClass = (color: HighlightColor | null | undefined) => (color ? `hl-${color}` : "")

/** Each `==🟢` at a highlight's start back to `==`, for text shown without its marks (previews, sorting). */
export const dropHighlightEmoji = (md: string) => md.replace(new RegExp(`(?<!=)==${HIGHLIGHT_EMOJI}(?=[^\\s=])`, "gu"), "==")

// ---------- in an editor ----------

/** A highlight: `from` at its opening ==, `to` after its closing one, `len` its colour emoji's length. */
export type Highlight = { from: number; to: number; color: HighlightColor | null; len: number }

/** The highlight from..to is in (its marks too), on that line. */
export function highlightAt(state: EditorState, from: number, to = from): Highlight | null {
  const l = state.doc.lineAt(from)
  if (to > l.to) return null
  const re = new RegExp(HIGHLIGHT.source, "g")
  for (let m; (m = re.exec(l.text));) {
    const a = l.from + m.index, b = a + m[0].length
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
    const h = highlightAt(state, r.from, r.to)
    if (h) { changes.push(recolor(h, color)); continue }
    let { from, to } = r
    if (r.empty) { const w = state.wordAt(r.head); if (w) ({ from, to } = w) }
    changes.push({ from, insert: open }, { from: to, insert: "==" })
    // (nothing to wrap: the cursor goes between the new marks)
    if (from === to && state.selection.ranges.length === 1) cursor = from + open.length
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
