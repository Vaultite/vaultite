import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { useCommandKeys } from "@/core/commands"
import { canNavigate, navigate, paneById, useTabList } from "@/core/workspace"
import { usePane, usePaneTopBar } from "@/core/pane"
import { PaneControls } from "@/components/Tabs"
import { cn } from "@/lib/utils"

export const barButton = "grid size-7 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"

function NavButtons() {
  const { pane } = usePane()
  useTabList()
  const p = paneById(pane)
  const back = useCommandKeys("nav:back", true), forward = useCommandKeys("nav:forward", true)
  return (
    <div className="flex h-7 min-w-0 flex-wrap items-center overflow-clip [overflow-clip-margin:4px]">

      <button type="button" onClick={() => navigate(-1)} disabled={!canNavigate(p, -1)} aria-label="Navigate back" data-ui="button:nav:back" data-tip={`Navigate back${back}`} className={barButton}>
        <ArrowLeft className="size-4" strokeWidth={2} />
      </button>
      <button type="button" onClick={() => navigate(1)} disabled={!canNavigate(p, 1)} aria-label="Navigate forward" data-ui="button:nav:forward" data-tip={`Navigate forward${forward}`} className={barButton}>
        <ArrowRight className="size-4" strokeWidth={2} />
      </button>
    </div>
  )
}

const EDGE = 8

function usePaneWide(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current, parent = el?.parentElement, scroller = el?.closest<HTMLElement>("[data-pane]")
    if (!el || !parent || !scroller) return
    const fit = () => {
      const s = scroller.getBoundingClientRect(), p = parent.getBoundingClientRect(), cs = getComputedStyle(parent)
      if (!p.width) return
      const left = s.left + scroller.clientLeft, right = left + scroller.clientWidth
      const from = p.left + parseFloat(cs.paddingLeft), to = p.right - parseFloat(cs.paddingRight)
      el.style.marginLeft = `${Math.min(-EDGE, left + EDGE - from)}px`
      el.style.marginRight = `${Math.min(-EDGE, to - right + EDGE)}px`
    }
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(scroller)
    watch.observe(parent)
    return () => watch.disconnect()
  }, [ref])
}

export function ViewBar({ children, right, className }: { children?: ReactNode; right?: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  usePaneTopBar(ref)
  usePaneWide(ref)
  return (
    <div ref={ref} data-view-bar className={cn("group/bar sight-top sticky top-0 z-10 -mx-2 mb-4 flex h-10 items-center gap-2 bg-background px-2 text-[13px]", className)}>
      <NavButtons />
      <div data-view-bar-fill className="flex min-w-0 flex-1 items-center overflow-clip [overflow-clip-margin:4px]">{children}</div>
      {right}
      <PaneControls />
    </div>
  )
}
