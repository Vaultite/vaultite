import { lazy, Suspense } from "react"
import { GitCompareArrows } from "lucide-react"
import { currentFile, definePlugin, isHidden, Panel, stem } from "@vaultite"
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
  preview: () => (
    <Panel title="Review" icon={GitCompareArrows} tint="var(--review)">
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        When an AI app or a coding agent changes your vault, the file waits here for you, like a pull request: who changed it
        and when, the lines added and removed, and Keep or Revert. A count in the status bar and a line in the file's header
        lead here.
      </p>
    </Panel>
  ),
})
