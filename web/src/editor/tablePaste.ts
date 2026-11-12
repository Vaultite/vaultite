import { escape, NUMBER } from "./tableText.ts"

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
  if (q) return delimited(text, sep, false)
  row.push(cur); rows.push(row)
  return rows
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }
const decode = (s: string) => s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e: string) => e[0] === "#"
  ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()] ?? m)
const NOISE = /<!--[\s\S]*?-->|<(style|script|head|title)\b[\s\S]*?<\/\1>/gi
function inline(h: string): string {
  // CommonMark: `** x**` isn't emphasis, so spaces stay outside the marks.
  const wrap = (mark: string, t: string) => { const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(t)!; return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : t }
  return h
    .replace(/<a\b[^>]*?href\s*=\s*["']((?:https?:|mailto:)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, t: string) => {
      const text = t.replace(/<[^>]*>/g, "").trim()
      return !text || decode(text) === decode(href) ? href : `[${t.trim()}](${href.replace(/[()\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)})`
    })
    .replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, t: string) => wrap("**", t))
    .replace(/<span\b[^>]*font-weight\s*:\s*(?:bold|[6-9]00)[^>]*>([\s\S]*?)<\/span>/gi, (_, t: string) => wrap("**", t))
    .replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, t: string) => wrap("*", t))
    .replace(/<(s|del|strike)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, t: string) => wrap("~~", t))
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, t: string) => (t.includes("`") ? t : wrap("`", t)))
}

export function htmlTable(html: string, md = false): string[][] | null {
  const clean = html.replace(NOISE, "")
  const m = /<table\b[\s\S]*<\/table>/i.exec(clean)
  if (!m || decode(clean.replace(m[0], "").replace(/<[^>]*>/g, "")).trim()) return null
  const rows: string[][] = []
  for (const tr of m[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row: string[] = []
    for (const td of tr[1].matchAll(/<t([hd])\b([^>]*)>([\s\S]*?)<\/t\1>/gi)) {
      const h = td[3].replace(/\s+/g, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div)>\s*<(p|div)\b/gi, "\n<$2")
      let text = decode((md ? inline(h) : h).replace(/<[^>]*>/g, "")).split("\n").map((l) => l.trim()).join("\n").trim()
      // Spreadsheets mark a bold cell by its style, not a <b>.
      if (md && text && rows.length && td[1] === "d" && /font-weight\s*:\s*(?:bold|[6-9]00)/i.test(td[2]) && !/^\*\*[\s\S]*\*\*$/.test(text)) text = `**${text}**`
      row.push(text)
      const span = Number(/colspan\s*=\s*["']?(\d+)/i.exec(td[2])?.[1] ?? 1)
      for (let k = 1; k < Math.min(span, 50); k++) row.push("")
    }
    if (row.length) rows.push(row)
  }
  return rows.length ? square(rows) : null
}

function fromHtml(plain: string[][] | null, html: string): string[][] | null {
  const table = htmlTable(html)
  if (!table) return null
  if (plain && sameShape(plain, table) && !plain.every((r, i) => r.every((x, j) => x.trim() === table[i][j]))) return plain
  return htmlTable(html, true)
}

const square = (rows: string[][]) => { const n = Math.max(...rows.map((r) => r.length)); return rows.map((r) => [...r, ...Array(n - r.length).fill("")]) }
const sameShape = (a: string[][], b: string[][]) => a.length === b.length && a.every((r, i) => r.length === b[i].length)
const even = (rows: string[][]) => rows.every((r) => r.length === rows[0].length)

export function clipCells(plain: string, html = ""): string[][] | null {
  const tsv = plain.includes("\t") || /<table\b/i.test(html) ? delimited(plain, "\t") : null
  const table = fromHtml(tsv, html)
  const cells = table ?? (tsv && plain.includes("\t") ? square(tsv)
    : (() => { const csv = delimited(plain, ","); return csv.length > 1 && csv[0].length > 1 && even(csv) ? csv : null })())
  return cells && (cells.length > 1 || cells[0].length > 1) ? cells : null
}

export function pastedTable(plain: string, html = ""): string[][] | null {
  const tsv = plain.includes("\t") ? delimited(plain, "\t") : null
  const table = fromHtml(tsv, html)
  const rows = table ?? (tsv && even(tsv) ? tsv : null)
  if (!rows || rows.length < 2 || rows[0].length < 2) return null
  return rows[0].some((_, c) => rows.every((r) => !r[c].trim())) ? null : rows
}

export function markdownTable(rows: string[][]) {
  const line = (r: string[]) => `| ${r.map((x) => escape(x.trim())).join(" | ")} |`
  const numbers = (c: number) => { const xs = rows.slice(1).map((r) => r[c].trim()).filter(Boolean); return xs.length > 0 && xs.every((x) => NUMBER.test(x)) }
  return [line(rows[0]), `| ${rows[0].map((_, c) => (numbers(c) ? "--:" : "---")).join(" | ")} |`, ...rows.slice(1).map(line)].join("\n")
}

export const tsvText = (rows: string[][]) =>
  rows.map((r) => r.map((x) => (/[\t\n"]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join("\t")).join("\n")
export const htmlText = (rows: string[][]) => `<table>${rows.map((r) => `<tr>${r.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("")}</table>`
