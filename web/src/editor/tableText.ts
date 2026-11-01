// A Markdown table as rows and back (editor/tables.ts edits it cell by cell): what changed is all that's rewritten.
import { dropHighlightEmoji } from "../core/highlights.ts"

export type Align = "" | "left" | "center" | "right"
/** A row: its cells as written (`\|` escaped), and the line it came from while they're unchanged (kept as it was).
 *  `rest`: cells past its header's width, which nothing draws, kept until its shape changes (widen). */
type Row = { cells: string[]; line?: string; was?: string; rest?: string[] }
/** `delim`: its separator line as written, kept while the columns, their alignment and widths (`aligned`) are the same.
 *  `widths`: each column's dashes (colons too) when the separator sets the columns' widths. */
export type Table = { rows: Row[]; align: Align[]; delim: string; aligned: string; padded: boolean; widths: number[] | null
  /** What its lines start with (a table in a list item): new lines get it too. */
  indent: string }
export type Cell = { r: number; c: number }

/** A row's cells as written: split at pipes that aren't escaped, the outer pipes dropped, trimmed. */
function cellsOf(line: string): string[] {
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
const ASCII = /^[\x20-\x7e]*$/
/** How many columns text takes in a monospace font (CJK and emoji two), as a padded table lines up. */
export function width(s: string) {
  // (plain ASCII is one column a character: segmenting every cell was most of drawing a long table)
  if (ASCII.test(s)) return s.length
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
  const seps = d.map((c) => c.length), widths = setIn(seps, rows) ? seps : null
  // Padded so its pipes line up (as a formatter writes it): kept lined up as cells change.
  const w = width(lines[0].trimEnd())
  const padded = !widths && lines.every((l) => width(l.trimEnd()) === w) && /\S {2,}\|/.test(lines.join("\n"))
  return { rows, align, delim: lines[1], aligned: shape(align, widths), padded, widths, indent: /^[ \t]*/.exec(lines[0])![0] }
}
/** Whether a separator's dashes (colons too) set its columns' widths: past 72 columns with its pipes, as Pandoc reads
 *  them, and not just each column padded to its widest cell or its header (spaces around or not), as formatters do. */
function setIn(seps: number[], rows: Row[]) {
  if (seps.length < 2 || seps.reduce((a, b) => a + b, 0) + seps.length + 1 <= 72) return false
  // (formatters count a wide character as two columns or as one)
  const widest = (c: number, w: (s: string) => number) => rows.reduce((m, r) => Math.max(m, w(r.cells[c])), 3)
  const pads = (n: number, c: number) => [width, (s: string) => [...s].length].some((w) => [widest(c, w), w(rows[0].cells[c])].some((x) => n === x || n === x + 2))
  return seps.some((n, c) => !pads(n, c))
}
const shape = (align: Align[], widths: number[] | null) => `${align.join()}/${widths?.join() ?? ""}`

/** Its columns' shares of the table's width (summing to 1), when its separator sets them. */
export const columnShares = (t: Table) => {
  const sum = t.widths?.reduce((a, b) => a + b, 0)
  return t.widths && sum ? t.widths.map((n) => n / sum) : null
}
/** Dashes the separator spreads between columns given their widths: wider than 72, so Pandoc reads them as widths. */
const SCALE = 80
/** Its columns' widths set to these shares (any scale), or back to as wide as their text (null): only its separator
 *  changes. */
export function setWidths(t: Table, shares: number[] | null) {
  t.widths = shares && shares.length > 1 ? scaled(shares) : null
  if (t.widths) t.padded = false
}
const scaled = (shares: number[]) => { const sum = shares.reduce((a, b) => a + b, 0) || 1; return shares.map((s) => Math.max(3, Math.round((SCALE * s) / sum))) }
/** The narrowest a column whose width is set is drawn, in the table's ems: narrower, the table scrolls sideways. */
export const NARROWEST = 5
/** The width (ems) under which a table with these column shares scrolls sideways rather than squeeze a column. */
export const sharedMinWidth = (shares: number[]) => Math.min(shares.length * 12, Math.max(...shares.map((f) => NARROWEST / f)))

/** A column's separator `w` long, its colons included. */
const sized = (a: Align, w: number) => a === "center" ? `:${"-".repeat(w - 2)}:` : a === "right" ? `${"-".repeat(w - 1)}:` : a === "left" ? `:${"-".repeat(w - 1)}` : "-".repeat(w)
const dashes = (a: Align, w: number) => a === "center" ? `:${"-".repeat(Math.max(w - 2, 1))}:` : a === "right" ? `${"-".repeat(Math.max(w - 1, 2))}:`
  : a === "left" ? `:${"-".repeat(Math.max(w - 1, 2))}` : "-".repeat(Math.max(w, 3))

/** The table as Markdown: rows that didn't change as they were, unless it's padded (then all of it, lined up again). */
export function writeTable(t: Table): string {
  const cols = t.align.length
  const all = (r: Row) => (r.rest ? [...r.cells, ...r.rest] : r.cells)
  if (t.padded) {
    const w = t.align.map((_, c) => t.rows.reduce((m, r) => Math.max(m, width(r.cells[c])), 3))
    const row = (r: Row) => `${t.indent}| ${all(r).map((x, c) => x + " ".repeat(Math.max(0, (w[c] ?? 0) - width(x)))).join(" | ")} |`
    return [row(t.rows[0]), `${t.indent}| ${t.align.map((a, c) => dashes(a, w[c])).join(" | ")} |`, ...t.rows.slice(1).map(row)].join("\n")
  }
  const row = (r: Row) => (r.line !== undefined && r.was === r.cells.join("\0") ? r.line : `${t.indent}| ${all(r).join(" | ")} |`)
  const delim = cellsOf(t.delim).length === cols && t.aligned === shape(t.align, t.widths) ? t.delim : separator(t)
  return [row(t.rows[0]), delim, ...t.rows.slice(1).map(row)].join("\n")
}

function separator(t: Table) {
  const ws = t.widths && t.align.length > 1 ? scaled(t.widths) : null
  // (dashes that happen to match every column's text would read as a formatter's padding: one more says they're set)
  if (ws && !setIn(ws, t.rows)) ws[ws.indexOf(Math.max(...ws))]++
  return `${t.indent}|${t.align.map((a, c) => (ws ? sized(a, ws[c]) : dashes(a, 3))).join("|")}|`
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
  while (t.align.length < n) { t.align.push(""); t.widths?.push(average(t.widths)) }
}
/** A new column's width among set ones: theirs on average. */
const average = (ws: number[]) => Math.max(3, Math.round(ws.reduce((a, b) => a + b, 0) / Math.max(1, ws.length)))
const blank = (t: Table): Row => ({ cells: t.align.map(() => "") })
export const insertRow = (t: Table, at: number) => { t.rows.splice(at, 0, blank(t)) }
export const deleteRow = (t: Table, r: number) => { t.rows.splice(r, 1) }
/** A body row's copy put under it. */
export const duplicateRow = (t: Table, r: number) => { if (r > 0) t.rows.splice(r + 1, 0, { cells: [...t.rows[r].cells] }) }
export const insertColumn = (t: Table, at: number) => {
  t.align.splice(at, 0, ""); t.widths?.splice(at, 0, average(t.widths))
  for (const r of t.rows) r.cells.splice(at, 0, "")
}
export const deleteColumn = (t: Table, c: number) => {
  t.align.splice(c, 1); t.widths?.splice(c, 1)
  if (t.widths && t.widths.length < 2) t.widths = null
  for (const r of t.rows) r.cells.splice(c, 1)
}
const move = <T>(xs: T[], from: number, to: number) => { xs.splice(to, 0, ...xs.splice(from, 1)) }
/** A body row to another place among them (the header stays first). */
export const moveRow = (t: Table, from: number, to: number) => { if (from > 0 && to > 0 && to < t.rows.length) move(t.rows, from, to) }
export const moveColumn = (t: Table, from: number, to: number) => {
  if (to < 0 || to >= t.align.length) return
  move(t.align, from, to)
  if (t.widths) move(t.widths, from, to)
  for (const r of t.rows) move(r.cells, from, to)
}
/** Cells r0..r1, c0..c1 emptied. */
export function clearCells(t: Table, a: Cell, b: Cell) {
  for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) t.rows[r].cells[c] = ""
}
/** ⌘D, as a spreadsheet's: rows r0..r1 of columns c0..c1 take the top row's cells; one row takes the row above's (never
 *  the header's). False when there's nothing to copy from. */
export function fillDown(t: Table, a: Cell, b: Cell): boolean {
  const r0 = Math.min(a.r, b.r), r1 = Math.max(a.r, b.r), c0 = Math.min(a.c, b.c), c1 = Math.max(a.c, b.c)
  const from = r0 === r1 ? r0 - 1 : r0
  if (from < 1) return false
  for (let r = from + 1; r <= r1; r++) for (let c = c0; c <= c1; c++) t.rows[r].cells[c] = t.rows[from].cells[c]
  return true
}
/** Text (as typed: line breaks, pipes) into the cells from `at` on, rows and columns added where it runs past them. */
export function fillCells(t: Table, at: Cell, cells: string[][]) {
  const cols = Math.max(...cells.map((r) => r.length))
  while (t.align.length < at.c + cols) insertColumn(t, t.align.length)
  while (t.rows.length < at.r + cells.length) insertRow(t, t.rows.length)
  cells.forEach((row, i) => row.forEach((x, j) => { t.rows[at.r + i].cells[at.c + j] = escape(x.trim()) }))
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
export const NUMBER = /^[-+]?[$€£¥]?\s?[-+]?(\d[\d,]*)?\.?\d+\s?%?$/
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

/** Where ⌘ or Ctrl and an arrow goes from `at`, as in a spreadsheet: along filled cells, the last before a blank one;
 *  from a blank one (or the end of a run), the next filled cell; else the table's edge. */
export function edgeFrom(t: Table, at: Cell, dr: number, dc: number): Cell {
  const filled = (r: number, c: number) => shownText(t.rows[r]?.cells[c] ?? "").trim() !== ""
  const inside = (r: number, c: number) => r >= 0 && c >= 0 && r < t.rows.length && c < t.align.length
  let { r, c } = at
  if (!inside(r + dr, c + dc)) return at
  if (filled(r, c) && filled(r + dr, c + dc)) {
    while (inside(r + dr, c + dc) && filled(r + dr, c + dc)) { r += dr; c += dc }
    return { r, c }
  }
  r += dr; c += dc
  while (!filled(r, c) && inside(r + dr, c + dc)) { r += dr; c += dc }
  return { r, c }
}
