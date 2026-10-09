// Spreadsheets' server side: each sheet as a Markdown table of its formatted cells for /api/render and
// search, with SheetJS loaded on first use.
import { createRequire } from "node:module"
import { Plugin } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

export const EXTS = ["xlsx", "xlsm", "xls", "ods", "numbers"]
type XLSX = typeof import("xlsx")
let lib: XLSX | null = null
const xlsx = () => (lib ??= createRequire(import.meta.url)("xlsx") as XLSX)

const cell = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim()

/** A workbook's sheets as Markdown: `## Sheet` then its cells as a table (the first row as its header). */
export function workbookMarkdown(bytes: Buffer): string {
  const X = xlsx()
  const book = X.read(bytes, { type: "buffer", cellDates: true, dense: true })
  const out: string[] = []
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name]
    const rows = (X.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false, defval: "" }) as unknown[][])
      .map((r) => r.map(cell))
    const width = Math.max(0, ...rows.map((r) => { let n = r.length; while (n && !r[n - 1]) n--; return n }))
    out.push(`## ${name}`)
    if (!rows.length || !width) { out.push("_(empty sheet)_"); continue }
    const fit = (r: string[]) => `| ${Array.from({ length: width }, (_, j) => r[j] ?? "").join(" | ")} |`
    out.push(fit(rows[0]), `| ${Array(width).fill("---").join(" | ")} |`)
    for (let i = 1; i < rows.length; i++) out.push(fit(rows[i])) // (not spread: a sheet's rows can pass the arguments limit)
    const n = rows.length - 1
    out.push(`\n_${n} ${n === 1 ? "row" : "rows"}._`)
  }
  return out.join("\n") || "_(empty workbook)_"
}

for (const ext of EXTS) plugin.provide(`text:${ext}`, (bytes: Buffer | string) => workbookMarkdown(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)))
