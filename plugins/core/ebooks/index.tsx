import { lazy, Suspense } from "react"
import { BookOpen } from "lucide-react"
import { definePlugin, Loading, type FileFormat } from "@vaultite"

const Reader = lazy(() => import("./Reader"))

const format: FileFormat = {
  exts: ["epub", "mobi", "azw", "azw3", "fb2", "fbz", "cbz"], icon: BookOpen, tint: "var(--indigo)", binary: true, layout: "box", autoHeight: true,
  render: ({ url, path }) => <Suspense fallback={<Loading />}><Reader url={url!} path={path} /></Suspense>,
  embed: ({ url, path }) => <Suspense fallback={<Loading />}><Reader url={url!} path={path} embed /></Suspense>,
}

export default definePlugin({
  formats: { book: format },
})
