// Desktop: the bar on top of every tab's view: back and forward (the tab's own history),
// then what the view says (a file's path, a page's name), then its buttons.
import { useRef, type ReactNode } from "react"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { useCommandKeys } from "@/core/commands"
import { canNavigate, navigate, useTabs } from "@/core/workspace"
import { usePane, usePaneTopBar } from "@/core/pane"
import { cn } from "@/lib/utils"

/** A small icon button. */
export const barButton = "grid size-7 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"

function NavButtons() {
  // This pane's tab (the buttons act on the focused one: clicking here focuses this pane first).
  const { tabs, active } = useTabs(usePane().group)
  const tab = tabs.find((t) => t.id === active)
  const back = useCommandKeys("nav:back", true), forward = useCommandKeys("nav:forward", true)
  return (
    // (a pane too narrow for the bar's buttons: forward, then back wrap out of sight, so the view's buttons stay put)
    <div className="flex h-7 min-w-0 flex-wrap items-center overflow-clip [overflow-clip-margin:4px]">

      <button type="button" onClick={() => navigate(-1)} disabled={!canNavigate(tab, -1)} aria-label="Navigate back" data-tip={`Navigate back${back}`} className={barButton}>
        <ArrowLeft className="size-4" strokeWidth={2} />
      </button>
      <button type="button" onClick={() => navigate(1)} disabled={!canNavigate(tab, 1)} aria-label="Navigate forward" data-tip={`Navigate forward${forward}`} className={barButton}>
        <ArrowRight className="size-4" strokeWidth={2} />
      </button>
    </div>
  )
}

export function ViewBar({ children, right, className }: { children?: ReactNode; right?: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  usePaneTopBar(ref)
  return (
    <div ref={ref} data-view-bar className={cn("sight-top sticky top-0 z-10 -mx-2 mb-4 flex h-10 items-center gap-2 bg-background px-2 text-[13px]", className)}>
      <NavButtons />
      {/* (squeezed past what its crumbs can shrink to, it cuts them off rather than drawing them under the buttons;
          the margin keeps focus rings) */}
      <div data-view-bar-fill className="flex min-w-0 flex-1 items-center overflow-clip [overflow-clip-margin:4px]">{children}</div>
      {right}
    </div>
  )
}
