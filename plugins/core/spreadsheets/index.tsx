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
