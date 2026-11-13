import { lazy, Suspense } from "react"
import { Presentation } from "lucide-react"
import { definePlugin, Loading, type FileFormat } from "@vaultite"

const Deck = lazy(() => import("./Deck"))

const format: FileFormat = {
  exts: ["pptx"], icon: Presentation, tint: "var(--orange)", binary: true, layout: "inline",
  render: ({ url }) => <Suspense fallback={<Loading />}><Deck url={url!} /></Suspense>,
  embed: ({ url }) => <Suspense fallback={<Loading />}><Deck url={url!} embed /></Suspense>,
}

export default definePlugin({
  formats: { deck: format },
})
