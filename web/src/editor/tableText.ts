// A Markdown table as rows and back (editor/tables.ts edits it cell by cell): what changed is all that's rewritten.

export type Align = "" | "left" | "center" | "right"
/** A row: its cells as written (`\|` escaped), and the line it came from while they're unchanged (kept as it was). */
type Row = { cells: string[]; line?: string; was?: string }
/** `delim`: its separator line as written, kept while the columns and their alignment (`aligned`) are the same. */
export type Table = { rows: Row[]; align: Align[]; delim: string; aligned: string; padded: boolean
  /** What its lines start with (a table in a list item): new lines get it too. */
  indent: string }

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

const DELIM = /^:?-+:?$/
/** A table's Markdown as rows, or null when editing it cell by cell could lose something (a row wider than its header). */
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
    if (cells.length > head.length) return null
    while (cells.length < head.length) cells.push("")
    rows.push({ cells, line: l, was: cells.join("\0") })
  }
  // Padded so its pipes line up (as a formatter writes it): kept lined up as cells change.
  const width = lines[0].trimEnd().length
  const padded = lines.every((l) => l.trimEnd().length === width) && /\S {2,}\|/.test(lines.join("\n"))
  return { rows, align, delim: lines[1], aligned: align.join(), padded, indent: /^[ \t]*/.exec(lines[0])![0] }
}

const dashes = (a: Align, w: number) => a === "center" ? `:${"-".repeat(Math.max(w - 2, 1))}:` : a === "right" ? `${"-".repeat(Math.max(w - 1, 2))}:`
  : a === "left" ? `:${"-".repeat(Math.max(w - 1, 2))}` : "-".repeat(Math.max(w, 3))

/** The table as Markdown: rows that didn't change as they were, unless it's padded (then all of it, lined up again). */
export function writeTable(t: Table): string {
  const cols = t.align.length
  if (t.padded) {
    const w = t.align.map((_, c) => Math.max(3, ...t.rows.map((r) => r.cells[c].length)))
    const row = (cells: string[]) => `${t.indent}| ${cells.map((x, c) => x.padEnd(w[c])).join(" | ")} |`
    return [row(t.rows[0].cells), `${t.indent}| ${t.align.map((a, c) => dashes(a, w[c])).join(" | ")} |`, ...t.rows.slice(1).map((r) => row(r.cells))].join("\n")
  }
  const row = (r: Row) => (r.line !== undefined && r.was === r.cells.join("\0") ? r.line : `${t.indent}| ${r.cells.join(" | ")} |`)
  const delim = cellsOf(t.delim).length === cols && t.aligned === t.align.join() ? t.delim : `${t.indent}|${t.align.map((a) => dashes(a, 3)).join("|")}|`
  return [row(t.rows[0]), delim, ...t.rows.slice(1).map(row)].join("\n")
}

export const unescape = (cell: string) => cell.replace(/\\\|/g, "|")
export const escape = (shown: string) => shown.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|")
