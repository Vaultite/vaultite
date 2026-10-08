// Tables: a .csv opens as a table named like a note and embeds as its rows; editing it is its text. Off, a .csv is
// plain text.
import { Sheet } from "lucide-react"
import { definePlugin, numberText, parseCsv, type FileFormat } from "@vaultite"
import { CsvView } from "./Table"

/** How many records a CSV has (rows after the header with something in them). */
const count = (text: string) => Math.max(0, parseCsv(text).slice(1).filter((r) => r.some((f) => f !== "")).length)

const format: FileFormat = {
  exts: ["csv"], icon: Sheet, code: "text", page: true, edit: "source", layout: "inline",
  status: (text) => { const n = count(text); return `${numberText(n)} ${n === 1 ? "row" : "rows"}` },
  render: ({ text }) => <CsvView text={text} />,
  embed: ({ text }) => <div className="px-3 pb-3"><CsvView text={text} embed /></div>,
}

// A made-up table for the Plugins sheet.
const SAMPLE = "date,amount,note\n2026-01-01,-5.20,\"Coffee, large\"\n2026-01-02,1200,Pay\n2026-01-03,-42,Groceries\n2026-01-04,-9,Books\n"

export default definePlugin({
  formats: { table: format },
  preview: () => <CsvView text={SAMPLE} embed />,
})
