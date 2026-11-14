import { lazy, Suspense } from "react"
import { GitCompareArrows } from "lucide-react"
import { currentFile, definePlugin, isHidden, stem } from "@vaultite"
import { argOf, reviewFileView, reviewView } from "./open"
import { ReviewChip, ReviewCount, ReviewSettings } from "./Chip"

const ReviewView = lazy(() => import("./Review").then((m) => ({ default: m.ReviewView })))
const ReviewFileView = lazy(() => import("./Review").then((m) => ({ default: m.ReviewFileView })))

const onFile = () => !!currentFile() && !isHidden(currentFile()) && !currentFile().startsWith("/")

export default definePlugin({
  views: {
    review: { icon: GitCompareArrows, title: (arg) => (arg ? `${argOf(arg)}'s changes` : "AI changes"), render: ({ arg }) => <Suspense fallback={null}><ReviewView key={arg} arg={arg} /></Suspense> },
    "review-file": { icon: GitCompareArrows, title: (arg) => `${stem(arg)} changes`, pinAs: (arg) => arg || null, render: ({ arg }) => <Suspense fallback={null}><ReviewFileView key={arg} path={arg} /></Suspense> },
  },
  fileBar: { review: { sort: 51, render: (file) => (isHidden(file.path) || file.path.startsWith("/") ? null : <ReviewChip file={file} />) } },
  settingsPanel: () => <ReviewSettings />,
  settingsPanelFirst: true,
  ambient: { review: { title: "AI changes to review", sort: 35, render: () => <ReviewCount /> } },
  commands: [
    { id: "review:open", name: "Review AI changes", run: () => reviewView(), icon: GitCompareArrows },
    { id: "review:file", name: "Review AI changes to this file", when: onFile, run: () => reviewFileView(currentFile()), icon: GitCompareArrows },
  ],
})
