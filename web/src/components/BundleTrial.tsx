// A bundle being tried (core/bundles.ts trial.json, in /api/state: every window, and after a restart): a slim bar over
// the bottom of the window until it's kept or reverted. It floats, so nothing moves; toasts sit above it (index.css).
import { useEffect, useState } from "react"
import { FlaskConical } from "lucide-react"
import type { Store } from "@/core/data"
import { keepTrial, restoreSetup } from "@/core/bundles"
import { notifyError } from "@/core/notify"
import { cn } from "@/lib/utils"

const ACTION = "h-7 shrink-0 cursor-pointer rounded-[6px] px-2.5 text-[13px] font-semibold hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none disabled:cursor-default disabled:opacity-50 max-md:h-11 max-md:rounded-[10px] max-md:px-3 max-md:text-[17px]"

export function BundleTrial({ store }: { store: Store | null }) {
  const trial = store?.bundles?.trial
  const [busy, setBusy] = useState(false)
  // (the root's mark lifts toasts and page ends above the bar: index.css --trial-bar)
  const on = !!trial
  useEffect(() => {
    if (!on) return
    document.documentElement.dataset.trying = ""
    return () => { delete document.documentElement.dataset.trying }
  }, [on])
  if (!trial) return null
  const run = (what: () => Promise<unknown>, failed: string) => {
    setBusy(true)
    what().catch((e) => notifyError(e, failed)).finally(() => setBusy(false))
  }
  return (
    <div role="status" aria-label={`Trying ${trial.name}`} data-bundle-trial={trial.id}
      className={cn("fixed z-40 flex items-center gap-1 rounded-[10px] border-[0.5px] border-border bg-card py-1 pr-1 pl-3 shadow-[0_6px_20px_rgb(0_0_0/0.12),0_1px_3px_rgb(0_0_0/0.06)] dark:shadow-[0_6px_20px_rgb(0_0_0/0.4)]",
        "bottom-[calc(40px+var(--mini-player))] left-1/2 max-w-[calc(100vw-2rem)] -translate-x-1/2",
        "max-md:inset-x-4 max-md:bottom-[calc(var(--phone-bar)+var(--mini-player)+0.75rem)] max-md:max-w-none max-md:translate-x-0 max-md:rounded-[14px] max-md:py-1 max-md:pl-4")}>
      <FlaskConical className="size-4 shrink-0 text-primary max-md:size-5" strokeWidth={2.25} />
      <span className="mr-2 ml-1 min-w-0 flex-1 truncate text-[13px] max-md:text-[17px]">Trying <span className="font-semibold">{trial.name}</span></span>
      <button type="button" disabled={busy} onClick={() => run(restoreSetup, "Couldn't revert it")} className={cn(ACTION, "text-muted-foreground hover:text-foreground")} data-bundle-trial-revert>Revert</button>
      <button type="button" disabled={busy} onClick={() => run(keepTrial, `Couldn't keep ${trial.name}`)} className={cn(ACTION, "text-primary")} data-bundle-trial-keep>Keep</button>
    </div>
  )
}
