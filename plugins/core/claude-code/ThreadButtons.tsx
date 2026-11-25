import { GitCompare, Terminal } from "lucide-react"
import { cn, usePane } from "@vaultite"
import { showDiff, showShell, useAside, useThread } from "./aside"

const BUTTON = "chat-term grid h-7 w-auto min-w-7 cursor-pointer grid-flow-col place-items-center gap-1.5 rounded-control px-1.5 text-[13px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
const ON = "bg-foreground/[0.07] text-foreground"

export function ThreadButtons({ id, s, hidden }: { id: string; s: { state: string } | null; hidden: boolean }) {
  const { pane } = usePane()
  const t = useThread(id, s?.state ?? "")
  const on = useAside(id, pane)
  if (!t?.git || !pane || hidden) return null
  return (
    <>
      <button type="button" aria-pressed={on.diff} onClick={() => showDiff(id, pane)} data-thread-diff
        data-tip={t.worktree ? `Changes on ${t.branch}` : "Its changes"} className={cn(BUTTON, on.diff && ON)}>
        <GitCompare className="size-4" strokeWidth={2} /><span>Diff</span>
      </button>
      <button type="button" aria-pressed={on.shell} onClick={() => void showShell(id, pane, t)} data-thread-shell
        data-tip={t.worktree ? "A terminal in its worktree" : "A terminal in its folder"} className={cn(BUTTON, on.shell && ON)}>
        <Terminal className="size-4" strokeWidth={2} /><span>Shell</span>
      </button>
    </>
  )
}
