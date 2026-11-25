import { useMemo } from "react"
import { GitCompare, Globe, Terminal } from "lucide-react"
import { cn, usePane } from "@vaultite"
import type { Entry } from "./chatlog"
import { showDiff, showPreview, showShell, useAside, useThread } from "./aside"
import { previewUrlFrom } from "./preview"

const BUTTON = "chat-term grid h-7 w-auto min-w-7 cursor-pointer grid-flow-col place-items-center gap-1.5 rounded-control px-1.5 text-[13px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
const ON = "bg-foreground/[0.07] text-foreground"

export function ThreadButtons({ id, s, entries, hidden }: { id: string; s: { state: string } | null; entries: readonly Entry[]; hidden: boolean }) {
  const { pane } = usePane()
  const t = useThread(id, s?.state ?? "")
  const on = useAside(id, pane)
  const previewUrl = useMemo(() => previewUrlFrom(entries), [entries])
  if (!t?.git || !pane || hidden) return null
  return (
    <>
      <button type="button" aria-pressed={on.diff} onClick={() => showDiff(id, pane)} data-thread-diff
        data-tip={t.worktree ? `Changes on ${t.branch}` : "Its changes"} className={cn(BUTTON, on.diff && ON)}>
        <GitCompare className="size-4" strokeWidth={2} /><span>Diff</span>
      </button>
      <button type="button" aria-pressed={on.preview} onClick={() => showPreview(id, pane, previewUrl || undefined)} data-thread-preview
        data-tip={previewUrl ? `Preview ${previewUrl}` : "Open a preview beside this thread"} className={cn(BUTTON, on.preview && ON)}>
        <Globe className="size-4" strokeWidth={2} /><span>Preview</span>
      </button>
      <button type="button" aria-pressed={on.shell} onClick={() => void showShell(id, pane, t)} data-thread-shell
        data-tip={t.worktree ? "A terminal in its worktree" : "A terminal in its folder"} className={cn(BUTTON, on.shell && ON)}>
        <Terminal className="size-4" strokeWidth={2} /><span>Shell</span>
      </button>
    </>
  )
}
