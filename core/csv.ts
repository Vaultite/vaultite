// CSV (RFC 4180, CRLF or LF, BOM dropped), shared with plugins through the plugin API, so no Node. The separator is
// the header's commonest of `,` `;` and tab, since spreadsheets in many languages export with `;`.

/** Rows of fields. A trailing newline doesn't make an empty row. (Self-contained: artifacts get its source.) */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = "", quoted = false, i = 0
  if (text.charCodeAt(0) === 0xfeff) i = 1
  // The separator: the first line's commonest of , ; and tab, outside quotes.
  const count: Record<string, number> = { ",": 0, ";": 0, "\t": 0 }
  for (let j = i, q = false; j < text.length && j < i + 10_000; j++) {
    const c = text[j]
    if (c === '"') q = !q
    else if (!q && (c === "\n" || c === "\r")) break
    else if (!q && c in count) count[c]++
  }
  const sep = count[";"] > count[","] && count[";"] >= count["\t"] ? ";" : count["\t"] > count[","] ? "\t" : ","
  for (; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"' && field === "") quoted = true
    else if (c === sep) { row.push(field); field = "" }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(field); rows.push(row); row = []; field = ""
    } else field += c
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row) }
  return rows
}

/** The records of a CSV with a header row, as objects keyed by the header's names. */
export function csvRecords(text: string): Record<string, string>[] {
  const [head, ...rows] = parseCsv(text)
  if (!head) return []
  return rows.filter((r) => r.some((f) => f !== "")).map((r) => Object.fromEntries(head.map((h, j) => [h, r[j] ?? ""])))
}
