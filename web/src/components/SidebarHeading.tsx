import { createContext, useContext } from "react"
import { ChevronRight, Ellipsis, X } from "lucide-react"
import { coarse } from "@/core/haptics"
import { HeadingButton } from "@/components/Button"
import { rightClickBelow } from "@/components/ContextMenu"
import { SwipeRow } from "@/components/SwipeRow"
import { headingsPeek } from "@/core/headingpeek"
import type { HeadingMode } from "@/core/plugins"
import { cn } from "@/lib/utils"
import { closestOf } from "@/core/dom"

/** The panel a heading is in (SidebarPanels provides it, in the open sidebar): whether it's folded to its heading, and
 *  how to fold or open it. None (a heading outside the sidebar, the rail): the heading is only a label. */
export const PanelFold = createContext<{ collapsed: boolean; toggle: (e?: { altKey: boolean }) => void; /** the id of what it folds */ controls?: string } | null>(null)

export const PanelHeading = createContext<HeadingMode>("shown")

export const PanelAlone = createContext<(() => void) | null>(null)

const LeaveMode = ({ leave }: { leave: () => void }) => <HeadingButton icon={X} label="Show panels" data-leave-mode onClick={leave} className="ml-0.5" />

/** A panel's heading: label left, hover buttons right (touch: swiped to), then … for its menu, then `aside` (always
 *  shown: a picker of what it shows); click folds the panel, drag moves it (`data-panel-handle`). Nothing in the rail. */
export function SidebarHeading({ title, open, children, aside, className }: {
  title: string; open: boolean
  children?: React.ReactNode
  aside?: React.ReactNode
  className?: string
}) {
  const fold = useContext(PanelFold)
  const alone = useContext(PanelAlone)
  const asked = useContext(PanelHeading)
  const mode = fold?.collapsed ? "shown" : asked === "quiet" && coarse ? "hidden" : asked
  if (!open) return null
  const f = fold
  const label = (
    <span role={f ? "button" : undefined} tabIndex={f ? 0 : undefined} aria-expanded={f ? !f.collapsed : undefined} aria-controls={f?.controls} id={f?.controls && `${f.controls}-name`}
      onKeyDown={f ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); f.toggle(e) } } : undefined}
      className="flex min-w-0 items-center gap-0.5 rounded-[3px] text-[12px] font-semibold text-muted-foreground focus-visible:text-foreground">
      <span className="truncate">{title}</span>
      {f && <ChevronRight aria-hidden data-fold={f.collapsed ? "collapsed" : "open"} className={cn("size-3.5 shrink-0 [transition:opacity_var(--motion-fast)_var(--ease-out),rotate_var(--motion-fast)_var(--ease-out)]", !f.collapsed && "rotate-90 opacity-0 group-hover/head:opacity-100 group-has-focus-visible/head:opacity-100")} strokeWidth={2.25} />}
    </span>
  )
  const head = {
    "data-panel-handle": "", "data-heading": title,
    onClick: f ? (e: React.MouseEvent) => { if (!closestOf(e.target, "button, a, input") && (mode !== "hidden" || headingsPeek())) f.toggle(e) } : undefined,
  }
  if (mode !== "shown") {
    return (
      <div {...head} data-heading-mode={mode} className={cn("group/head flex h-5 shrink-0 items-center pr-0.5 pl-1.5", className)}>
        <div data-heading-name className={cn("pointer-events-none flex min-w-0 flex-1 items-center gap-0.5 opacity-0 transition-opacity duration-(--motion-fast)",
          "group-focus-within/head:pointer-events-auto group-focus-within/head:opacity-100 [[data-headings-peek]_&]:pointer-events-auto [[data-headings-peek]_&]:opacity-100",
          mode === "quiet" && "group-hover/head:pointer-events-auto group-hover/head:opacity-100")}>
          {label}
          <span className="flex-1" />
          {children}
          {f && <HeadingButton icon={Ellipsis} label={`More for ${title}`} tip="More" data-heading-more onClick={rightClickBelow} />}
          {aside}
        </div>
      </div>
    )
  }
  const box = cn("group/head mt-2 shrink-0", f && "sticky top-0 z-[2] bg-sidebar", className)
  if (coarse && children) {
    return (
      <SwipeRow {...head} under={children} className={box}>
        <div className="flex h-7 items-center gap-0.5 pr-0.5 pl-1.5">{label}<span className="flex-1" />{aside}{alone && <LeaveMode leave={alone} />}</div>
      </SwipeRow>
    )
  }
  return (
    <div {...head} className={cn("flex h-7 items-center gap-0.5 pr-0.5 pl-1.5 transition-opacity duration-200", box)}>
      {label}
      <span className="flex-1" />
      <span className="flex gap-0.5 opacity-0 transition-opacity group-hover/head:opacity-100 focus-within:opacity-100">
        {children}
        {f && <HeadingButton icon={Ellipsis} label={`More for ${title}`} tip="More" data-heading-more onClick={rightClickBelow} />}
      </span>
      {aside}
      {alone && <LeaveMode leave={alone} />}
    </div>
  )
}
