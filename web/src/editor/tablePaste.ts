// Cells on the clipboard, both ways: what a spreadsheet, a web page's table or a CSV puts there read as rows of cells,
// and cells written as a spreadsheet reads them (tab-separated text and an HTML table). No DOM: tests run it in Node.
import { escape } from "./tableText.ts"

/** Delimited text as rows (Excel's quoting: a field in quotes may hold the delimiter, line breaks and "" for a quote). */
export function delimited(text: string, sep: string, quotes = true): string[][] {
  text = text.replace(/\r\n?/g, "\n").replace(/\n$/, "")
  const rows: string[][] = []
  let row: string[] = [], cur = "", q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) { if (ch !== '"') cur += ch; else if (text[i + 1] === '"') { cur += '"'; i++ } else q = false }
    else if (ch === '"' && quotes && cur === "") q = true
    else if (ch === sep) { row.push(cur); cur = "" }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = "" }
    else cur += ch
  }
  // (a quote never closed was text: read again without quoting)
  if (q) return delimited(text, sep, false)
  row.push(cur); rows.push(row)
  return rows
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }
const decode = (s: string) => s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e: string) => e[0] === "#"
  ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()] ?? m)
const NOISE = /<!--[\s\S]*?-->|<(style|script|head|title)\b[\s\S]*?<\/\1>/gi
/** The rows of an HTML table, when the table is all there is (a spreadsheet's copy, a table selected on a page); not
 *  for a page copied with a table somewhere in it. */
export function htmlTable(html: string): string[][] | null {
  const clean = html.replace(NOISE, "")
  const m = /<table\b[\s\S]*<\/table>/i.exec(clean)
  if (!m || decode(clean.replace(m[0], "").replace(/<[^>]*>/g, "")).trim()) return null
  const rows: string[][] = []
  for (const tr of m[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row: string[] = []
    for (const td of tr[1].matchAll(/<t([hd])\b([^>]*)>([\s\S]*?)<\/t\1>/gi)) {
      const text = decode(td[3].replace(/\s+/g, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div)>\s*<(p|div)\b/gi, "\n<$2").replace(/<[^>]*>/g, ""))
      row.push(text.split("\n").map((l) => l.trim()).join("\n").trim())
      // (a cell spanning columns leaves the ones it covers empty, so the rest stay under their headings)
      const span = Number(/colspan\s*=\s*["']?(\d+)/i.exec(td[2])?.[1] ?? 1)
      for (let k = 1; k < Math.min(span, 50); k++) row.push("")
    }
    if (row.length) rows.push(row)
  }
  return rows.length ? square(rows) : null
}

/** Every row as long as the longest. */
const square = (rows: string[][]) => { const n = Math.max(...rows.map((r) => r.length)); return rows.map((r) => [...r, ...Array(n - r.length).fill("")]) }
const sameShape = (a: string[][], b: string[][]) => a.length === b.length && a.every((r, i) => r.length === b[i].length)
const even = (rows: string[][]) => rows.every((r) => r.length === rows[0].length)

/** Cells pasted into a table's cell: a spreadsheet's (tab-separated, or its HTML table), a web page's table, or CSV
 *  lines; null for text (a line, a paragraph), which goes into the cell as it is. */
export function clipCells(plain: string, html = ""): string[][] | null {
  const table = htmlTable(html)
  // (its text when it says the same, as the app's own copy: its Markdown, which the HTML has drawn)
  const tsv = plain.includes("\t") || table ? delimited(plain, "\t") : null
  const cells = table ? (tsv && sameShape(tsv, table) ? tsv : table)
    : tsv ? square(tsv)
    : (() => { const csv = delimited(plain, ","); return csv.length > 1 && csv[0].length > 1 && even(csv) ? csv : null })()
  return cells && (cells.length > 1 || cells[0].length > 1) ? cells : null
}

/** A table pasted in a note's text: a spreadsheet's or a web page's (its HTML table), or lines with the same number of
 *  tabs in each; at least two rows of two. Not tab-indented lines (code), nor a page with a table somewhere in it. */
export function pastedTable(plain: string, html = ""): string[][] | null {
  const tsv = plain.includes("\t") ? delimited(plain, "\t") : null
  const table = htmlTable(html)
  const rows = tsv && even(tsv) && (!table || sameShape(tsv, table)) ? tsv : table
  if (!rows || rows.length < 2 || rows[0].length < 2) return null
  // (a column empty all the way down: indentation, not a table)
  return rows[0].some((_, c) => rows.every((r) => !r[c].trim())) ? null : rows
}

/** Rows as a Markdown table, the first its header. */
export function markdownTable(rows: string[][]) {
  const line = (r: string[]) => `| ${r.map((x) => escape(x.trim())).join(" | ")} |`
  return [line(rows[0]), `| ${rows[0].map(() => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n")
}

/** Cells as tab-separated lines, quoted where a cell holds a tab, a line break or a quote (as spreadsheets read it). */
export const tsvText = (rows: string[][]) =>
  rows.map((r) => r.map((x) => (/[\t\n"]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join("\t")).join("\n")
/** Cells (each already HTML) as an HTML table. */
export const htmlText = (rows: string[][]) => `<table>${rows.map((r) => `<tr>${r.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("")}</table>`
