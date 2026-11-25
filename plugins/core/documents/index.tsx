import { lazy, Suspense } from "react"
import { FileText } from "lucide-react"
import { definePlugin, Loading, type FileFormat } from "@vaultite"

const Docx = lazy(() => import("./Docx"))

const format: FileFormat = {
  exts: ["docx"], icon: FileText, tint: "var(--blue)", binary: true, layout: "inline",
  render: ({ url, path }) => <Suspense fallback={<Loading />}><Docx url={url!} path={path} /></Suspense>,
  embed: ({ url, path }) => <Suspense fallback={<Loading />}><Docx url={url!} path={path} embed /></Suspense>,
}

export default definePlugin({
  formats: { document: format },
})
