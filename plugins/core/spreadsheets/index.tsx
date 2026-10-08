// Spreadsheets open read-only as a grid with a tab per sheet (Workbook.tsx, its own chunk with SheetJS) and embed as
// rows (`#Sheet` for one). Off, a workbook is a file card.
import { lazy, Suspense } from "react"
import { FileSpreadsheet } from "lucide-react"
import { definePlugin, Loading, type FileFormat } from "@vaultite"

const Workbook = lazy(() => import("./Workbook"))

const format: FileFormat = {
  exts: ["xlsx", "xlsm", "xls", "ods", "numbers"], icon: FileSpreadsheet, tint: "var(--green)", binary: true, layout: "box", autoHeight: true,
  render: ({ url }) => <Suspense fallback={<Loading />}><Workbook url={url!} /></Suspense>,
  embed: ({ url, subpath }) => <Suspense fallback={<Loading />}><Workbook url={url!} sheet={subpath} embed /></Suspense>,
}

export default definePlugin({
  formats: { workbook: format },
})
