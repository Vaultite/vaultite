import { GitCompareArrows } from "lucide-react"
import { currentFile, definePlugin, isHidden, Panel, stem } from "@vaultite"
import { argOf, reviewFileView, reviewView } from "./open"
import { ReviewChip, ReviewCount, ReviewFileView, ReviewView } from "./Review"

// Review: what AIs changed that the user hasn't looked at, to keep or revert (Review.tsx; the finding is plugin.ts').

const onFile = () => !!currentFile() && !isHidden(currentFile()) && !currentFile().startsWith("/")

export default definePlugin({
  views: {
    // Every writer's (view:review), or one's: view:review/<name as Activity says it, encoded>.
    review: { icon: GitCompareArrows, title: (arg) => (arg ? `${argOf(arg)}'s changes` : "AI changes"), render: ({ arg }) => <ReviewView key={arg} arg={arg} /> },
    // One file's: view:review-file/<vault path>.
    "review-file": { icon: GitCompareArrows, title: (arg) => `${stem(arg)} changes`, render: ({ arg }) => <ReviewFileView key={arg} path={arg} /> },
  },
  fileBar: { review: { sort: 51, render: (file) => (isHidden(file.path) || file.path.startsWith("/") ? null : <ReviewChip file={file} />) } },
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
