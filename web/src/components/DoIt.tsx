import { useState } from "react"
import { Play } from "lucide-react"
import type { DoTask } from "@/core/define"
import { taskDoer } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { cn } from "@/lib/utils"

export function DoIt({ task, done, className }: { task: DoTask
  /** After it's handed off (an inbox item settles). */
  done?: () => void
  className?: string }) {
  const { disabled } = usePrefs()
  const [busy, setBusy] = useState(false)
  const doer = taskDoer(disabled)
  if (!doer) return null
  return (
    <button type="button" data-do-it disabled={busy} data-tip="Hand it to a worker"
      onClick={(e) => { e.stopPropagation(); setBusy(true); void doer(task).then((ok) => { setBusy(false); if (ok) done?.() }) }}
      className={cn("inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-[6px] px-1.5 text-[12px] leading-[22px] whitespace-nowrap text-primary hover:bg-foreground/[0.06] disabled:opacity-50 max-md:px-2.5 max-md:text-[15px] max-md:leading-[36px]", className)}>
      <Play className="size-3 max-md:size-3.5" strokeWidth={2.25} />Do it
    </button>
  )
}
