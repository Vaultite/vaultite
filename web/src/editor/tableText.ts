// A Markdown table as rows and back (editor/tables.ts edits it cell by cell): what changed is all that's rewritten.
import { dropHighlightEmoji } from "../core/highlights.ts"

export type Align = "" | "left" | "center" | "right"
/** A row: its cells as written (`\|` escaped), and the line it came from while they're unchanged (kept as it was).
 *  `rest`: cells past its header's width, which nothing draws, kept until its shape changes (widen). */
type Row = { cells: string[]; line?: string; was?: string; rest?: string[] }
/** `delim`: its separator line as written, kept while the columns and their alignment (`aligned`) are the same. */
export type Table = { rows: Row[]; align: Align[]; delim: string; aligned: string; padded: boolean
  /** What its lines start with (a table in a list item): new lines get it too. */
  indent: string }
export type Cell = { r: number; c: number }

/** A row's cells as written: split at pipes that aren't escaped, the outer pipes dropped, trimmed. */
export function cellsOf(line: string): string[] {
  let t = line.trim()
  if (t.startsWith("|")) t = t.slice(1)
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1)
  const out: string[] = []
  let cur = ""
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "|") { cur += "\\|"; i++ } else if (t[i] === "|") { out.push(cur.trim()); cur = "" } else cur += t[i]
  }
  out.push(cur.trim())
  return out
}

/** Which cell of a table's line column `ch` is in (0 the first), counting the unescaped pipes before it. */
export function cellAt(line: string, ch: number) {
  let n = 0
  for (let i = 0; i < ch && i < line.length; i++) { if (line[i] === "\\") i++; else if (line[i] === "|") n++ }
  return Math.max(0, /^\s*\|/.test(line) ? n - 1 : n)
}

const wide = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{20000}-\u{3FFFD}]|\p{Extended_Pictographic}|\p{Regional_Indicator}/u
const segmenter = new Intl.Segmenter()
/** How many columns text takes in a monospace font (CJK and emoji two), as a padded table lines up. */
export function width(s: string) {
  let w = 0
  for (const { segment } of segmenter.segment(s)) w += wide.test(segment) ? 2 : 1
  return w
}

const DELIM = /^:?-+:?$/
/** A table's Markdown as rows, or null when it isn't one (no separator line under its header). */
export function parseTable(text: string): Table | null {
  const lines = text.split("\n")
  if (lines.length < 2) return null
  const head = cellsOf(lines[0]), d = cellsOf(lines[1])
  if (d.length !== head.length || !d.every((c) => DELIM.test(c))) return null
  const align = d.map((c): Align => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""))
  const rows: Row[] = []
  for (const [i, l] of lines.entries()) {
    if (i === 1) continue
    const cells = cellsOf(l)
    const rest = cells.length > head.length ? cells.splice(head.length) : null
    while (cells.length < head.length) cells.push("")
    rows.push({ cells, line: l, was: cells.join("\0"), ...(rest ? { rest } : {}) })
  }
  // Padded so its pipes line up (as a formatter writes it): kept lined up as cells change.
  const w = width(lines[0].trimEnd())
  const padded = lines.every((l) => width(l.trimEnd()) === w) && /\S {2,}\|/.test(lines.join("\n"))
  return { rows, align, delim: lines[1], aligned: align.join(), padded, indent: /^[ \t]*/.exec(lines[0])![0] }
}

const dashes = (a: Align, w: number) => a === "center" ? `:${"-".repeat(Math.max(w - 2, 1))}:` : a === "right" ? `${"-".repeat(Math.max(w - 1, 2))}:`
  : a === "left" ? `:${"-".repeat(Math.max(w - 1, 2))}` : "-".repeat(Math.max(w, 3))

/** The table as Markdown: rows that didn't change as they were, unless it's padded (then all of it, lined up again). */
export function writeTable(t: Table): string {
  const cols = t.align.length
  const all = (r: Row) => (r.rest ? [...r.cells, ...r.rest] : r.cells)
  if (t.padded) {
    const w = t.align.map((_, c) => Math.max(3, ...t.rows.map((r) => width(r.cells[c]))))
    const row = (r: Row) => `${t.indent}| ${all(r).map((x, c) => x + " ".repeat(Math.max(0, (w[c] ?? 0) - width(x)))).join(" | ")} |`
    return [row(t.rows[0]), `${t.indent}| ${t.align.map((a, c) => dashes(a, w[c])).join(" | ")} |`, ...t.rows.slice(1).map(row)].join("\n")
  }
  const row = (r: Row) => (r.line !== undefined && r.was === r.cells.join("\0") ? r.line : `${t.indent}| ${all(r).join(" | ")} |`)
  const delim = cellsOf(t.delim).length === cols && t.aligned === t.align.join() ? t.delim : `${t.indent}|${t.align.map((a) => dashes(a, 3)).join("|")}|`
  return [row(t.rows[0]), delim, ...t.rows.slice(1).map(row)].join("\n")
}

export const unescape = (cell: string) => cell.replace(/\\\|/g, "|")
export const escape = (shown: string) => shown.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|")
/** A cell's text as edited: its pipes and line breaks as typed. */
export const shownText = (cell: string) => unescape(cell).replace(/<br\s*\/?>/gi, "\n")

// ---------- changes to its shape (each changes the table in place) ----------

/** Cells past the header's width made columns of their own (the header gets empty ones): before its shape changes, so
 *  nothing is lost and they show. */
export function widen(t: Table) {
  const n = Math.max(t.align.length, ...t.rows.map((r) => r.cells.length + (r.rest?.length ?? 0)))
  for (const r of t.rows) { if (r.rest) { r.cells.push(...r.rest); delete r.rest } while (r.cells.length < n) r.cells.push("") }
  while (t.align.length < n) t.align.push("")
}
const blank = (t: Table): Row => ({ cells: t.align.map(() => "") })
export const insertRow = (t: Table, at: number) => { t.rows.splice(at, 0, blank(t)) }
export const deleteRow = (t: Table, r: number) => { t.rows.splice(r, 1) }
export const insertColumn = (t: Table, at: number) => { t.align.splice(at, 0, ""); for (const r of t.rows) r.cells.splice(at, 0, "") }
export const deleteColumn = (t: Table, c: number) => { t.align.splice(c, 1); for (const r of t.rows) r.cells.splice(c, 1) }
const move = <T>(xs: T[], from: number, to: number) => { xs.splice(to, 0, ...xs.splice(from, 1)) }
/** A body row to another place among them (the header stays first). */
export const moveRow = (t: Table, from: number, to: number) => { if (from > 0 && to > 0 && to < t.rows.length) move(t.rows, from, to) }
export const moveColumn = (t: Table, from: number, to: number) => {
  if (to < 0 || to >= t.align.length) return
  move(t.align, from, to)
  for (const r of t.rows) move(r.cells, from, to)
}
/** Cells r0..r1, c0..c1 emptied. */
export function clearCells(t: Table, a: Cell, b: Cell) {
  for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) t.rows[r].cells[c] = ""
}
/** Text (as typed: line breaks, pipes) into the cells from `at` on, rows and columns added where it runs past them. */
export function fillCells(t: Table, at: Cell, cells: string[][]) {
  const cols = Math.max(...cells.map((r) => r.length))
  while (t.align.length < at.c + cols) insertColumn(t, t.align.length)
  while (t.rows.length < at.r + cells.length) insertRow(t, t.rows.length)
  cells.forEach((row, i) => row.forEach((x, j) => { t.rows[at.r + i].cells[at.c + j] = escape(x.trim()) }))
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
const NUMBER = /^[-+]?[$€£¥]?\s?[-+]?(\d[\d,]*)?\.?\d+\s?%?$/
const DATE = /^\d{4}-\d{1,2}-\d{1,2}(?:[ T][\d:.]+Z?)?$|^\d{4}\/\d{1,2}\/\d{1,2}$|^[A-Za-z]{3,9}\.? \d{1,2},? \d{4}$|^\d{1,2} [A-Za-z]{3,9}\.? \d{4}$/
/** A cell's text as read: links by their names, without emphasis marks. */
const plain = (cell: string) => dropHighlightEmoji(shownText(cell)).replace(/!?\[\[([^\]|]*)\|?([^\]]*)\]\]/g, (_, a, b) => b || a)
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/(\*\*|__|\*|_|~~|==|`)/g, "").trim()
const asNumber = (s: string) => (NUMBER.test(s) ? Number(s.replace(/[$€£¥,%\s]/g, "")) : NaN)
const asDate = (s: string) => (DATE.test(s) ? Date.parse(s) : NaN)
/** Two cells in order: as numbers if both are, else as dates if both are, else as text (numbers in it by value). */
export function compareCells(x: string, y: string) {
  const a = plain(x), b = plain(y)
  const na = asNumber(a), nb = asNumber(b)
  if (!isNaN(na) && !isNaN(nb)) return na - nb
  const da = asDate(a), db = asDate(b)
  if (!isNaN(da) && !isNaN(db)) return da - db
  return collator.compare(a, b)
}
/** The body rows in column `c`'s order (the header stays first), empty cells last either way; ties keep their order. */
export function sortRows(t: Table, c: number, desc = false) {
  const body = t.rows.slice(1).map((r, i) => ({ r, i }))
  body.sort((a, b) => {
    const x = a.r.cells[c], y = b.r.cells[c]
    if (!x || !y) return (x ? -1 : y ? 1 : 0) || a.i - b.i
    const d = compareCells(x, y)
    return (desc ? -d : d) || a.i - b.i
  })
  t.rows = [t.rows[0], ...body.map((b) => b.r)]
}
