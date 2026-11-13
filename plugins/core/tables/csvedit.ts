
type Span = { start: number; end: number; quoted: boolean }

function sepOf(text: string, from: number): string {
  const count: Record<string, number> = { ",": 0, ";": 0, "\t": 0 }
  for (let j = from, q = false; j < text.length && j < from + 10_000; j++) {
    const c = text[j]
    if (c === '"') q = !q
    else if (!q && (c === "\n" || c === "\r")) break
    else if (!q && c in count) count[c]++
  }
  return count[";"] > count[","] && count[";"] >= count["\t"] ? ";" : count["\t"] > count[","] ? "\t" : ","
}

function spans(text: string) {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const sep = sepOf(text, i)
  const rows: { fields: Span[]; end: number }[] = []
  let fields: Span[] = [], start = i, quoted = false, inQuotes = false
  for (; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') i++; else inQuotes = false }
    } else if (c === '"' && i === start) { inQuotes = true; quoted = true }
    else if (c === sep) { fields.push({ start, end: i, quoted }); start = i + 1; quoted = false }
    else if (c === "\n" || c === "\r") {
      fields.push({ start, end: i, quoted }); rows.push({ fields, end: i })
      if (c === "\r" && text[i + 1] === "\n") i++
      fields = []; start = i + 1; quoted = false
    }
  }
  if (start < text.length || fields.length) { fields.push({ start, end: text.length, quoted }); rows.push({ fields, end: text.length }) }
  return { sep, rows, newline: /\r\n/.test(text) ? "\r\n" : "\n" }
}

const field = (v: string, sep: string, quote = false) => (quote || v.includes(sep) || /["\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)

export function setCell(text: string, row: number, col: number, value: string): string {
  const { sep, rows } = spans(text)
  const r = rows[row]
  if (!r) return text
  const f = r.fields[col]
  if (f) return text.slice(0, f.start) + field(value, sep, f.quoted && value !== "") + text.slice(f.end)
  return text.slice(0, r.end) + sep.repeat(col - r.fields.length + 1) + field(value, sep) + text.slice(r.end)
}

export function addRow(text: string, n: number): string {
  const { sep, newline } = spans(text)
  const body = text.length && !/[\r\n]$/.test(text) ? text + newline : text
  return `${body}${sep.repeat(Math.max(0, n - 1))}${newline}`
}
