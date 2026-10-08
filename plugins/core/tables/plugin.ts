// Tables' server side: `text:csv` (its first 50 rows as Markdown, for /api/render and embeds) and `looks:csv` (a
// table is a page, listed with the notes).
import { parseCsv, Plugin } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")

/** A CSV as a Markdown table: the header and the first `limit` records, then how many there are in all. */
export function csvMarkdown(text: string, limit = 50): string {
  const [head, ...all] = parseCsv(text)
  if (!head) return "_(empty table)_"
  const rows = all.filter((r) => r.some((f) => f !== ""))
  const out = [`| ${head.map(cell).join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`]
  for (const r of rows.slice(0, limit)) out.push(`| ${head.map((_, j) => cell(r[j] ?? "")).join(" | ")} |`)
  const more = rows.length > limit ? `, the first ${limit} shown` : ""
  return `${out.join("\n")}\n\n_${rows.length} ${rows.length === 1 ? "row" : "rows"}${more}._`
}

plugin.provide("text:csv", (text: string) => csvMarkdown(text))
plugin.provide("looks:csv", () => ({}))
