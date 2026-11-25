import { useState, type MouseEvent } from "react"
import { ChevronDown, Copy, GitCommitHorizontal, GitPullRequest, Upload } from "lucide-react"
import { cn, copyText, menuBelow, notify, notifyError, op, type MenuItem } from "@vaultite"
import { seenOf } from "./seen"

type Done = { text: string; url?: string }

export function GitActions({ id, branch, after }: { id: string; branch: string; after: () => void }) {
  const [busy, setBusy] = useState(false)
  const run = async (action: "commit" | "push" | "pr", fail: string) => {
    setBusy(true)
    try {
      const message = seenOf(id)?.title || (branch ? `Changes from ${branch}` : "")
      const r = await op<Done>("claude-code.chat-git", { id, action, message: action === "commit" ? message || undefined : undefined })
      notify(r.text)
      after()
    } catch (e) { notifyError(e, fail) }
    setBusy(false)
  }
  const items: MenuItem[] = [
    { label: "Commit", icon: GitCommitHorizontal, run: () => run("commit", "Couldn't commit") },
    { label: "Push", icon: Upload, disabled: !branch, run: () => run("push", "Couldn't push") },
    { label: "Create pull request", icon: GitPullRequest, disabled: !branch, run: () => run("pr", "Couldn't create the pull request") },
    { label: "Copy branch", icon: Copy, sep: true, disabled: !branch, run: () => copyText(branch).then(() => notify("Branch name copied")) },
  ]
  const more = (e: MouseEvent) => menuBelow(e, items)
  return (
    <div data-git-actions className={cn("flex h-7 shrink-0 items-stretch overflow-hidden rounded-control border-[0.5px] border-border text-[13px]", busy && "opacity-60")}>
      <button type="button" disabled={busy} onClick={() => void run("commit", "Couldn't commit")} data-git-commit
        className="flex cursor-pointer items-center gap-1.5 px-2.5 hover:bg-foreground/[0.06] disabled:cursor-default">
        <GitCommitHorizontal className="size-3.5" strokeWidth={2} />Commit
      </button>
      <button type="button" disabled={busy} onClick={more} aria-label="More git actions" aria-haspopup="menu" data-git-more
        className="grid w-6 cursor-pointer place-items-center border-l-[0.5px] border-border text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default">
        <ChevronDown className="size-3.5" />
      </button>
    </div>
  )
}
