// Documents: .docx files drawn read-only like Word (Docx.tsx, its own chunk), embedded in a scrolling box. Off, a
// .docx is a file card.
import { lazy, Suspense } from "react"
import { FileText } from "lucide-react"
import { definePlugin, Loading, type FileFormat } from "@vaultite"

const Docx = lazy(() => import("./Docx"))

const format: FileFormat = {
  exts: ["docx"], icon: FileText, tint: "var(--blue)", binary: true, layout: "inline",
  render: ({ url }) => <Suspense fallback={<Loading />}><Docx url={url!} /></Suspense>,
  embed: ({ url }) => <Suspense fallback={<Loading />}><Docx url={url!} embed /></Suspense>,
}

export default definePlugin({
  icon: FileText,
  formats: { document: format },
})
