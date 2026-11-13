import { parseCsv, Plugin } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")

export function csvMarkdown(text: string): string {
  const [head, ...all] = parseCsv(text)
  if (!head) return "_(empty table)_"
  const rows = all.filter((r) => r.some((f) => f !== ""))
  const out = [`| ${head.map(cell).join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`]
  for (const r of rows) out.push(`| ${head.map((_, j) => cell(r[j] ?? "")).join(" | ")} |`)
  return `${out.join("\n")}\n\n_${rows.length} ${rows.length === 1 ? "row" : "rows"}._`
}

plugin.provide("text:csv", (text: string) => csvMarkdown(text))
plugin.provide("looks:csv", () => ({}))
