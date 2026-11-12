// A sidebar panel's heading, on its own so the file tree (which the sidebar imports) can use it too.
import { createContext, useContext } from "react"
import { ChevronRight, Ellipsis, X } from "lucide-react"
import { coarse } from "@/core/haptics"
import { HeadingButton } from "@/components/Button"
import { rightClickBelow } from "@/components/ContextMenu"
import { SwipeRow } from "@/components/SwipeRow"
import { headingsPeek } from "@/core/headingpeek"
import type { HeadingMode } from "@/core/plugins"
import { cn } from "@/lib/utils"

/** The panel a heading is in (SidebarPanels provides it, in the open sidebar): whether it's folded to its heading, and
 *  how to fold or open it. None (a heading outside the sidebar, the rail): the heading is only a label. */
export const PanelFold = createContext<{ collapsed: boolean; toggle: (e?: { altKey: boolean }) => void; /** the id of what it folds */ controls?: string } | null>(null)

/** How the heading of the panel it's in shows (core/plugins.ts headingMode); none (outside the sidebar): shown. */
export const PanelHeading = createContext<HeadingMode>("shown")

/** A panel shown alone in the left sidebar (its mode, core/sidebarmode.ts): how to bring the panels back, which its
 *  heading offers as an X that's always there. */
export const PanelAlone = createContext<(() => void) | null>(null)

/** Its heading's way out of the sidebar's mode: back to the panels. */
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
  // (folded, it's all that's left of the panel; a finger has no hover to show a quiet one)
  const asked = useContext(PanelHeading)
  const mode = fold?.collapsed ? "shown" : asked === "quiet" && coarse ? "hidden" : asked
  if (!open) return null
  const f = fold
  const label = (
    <span role={f ? "button" : undefined} tabIndex={f ? 0 : undefined} aria-expanded={f ? !f.collapsed : undefined} aria-controls={f?.controls} id={f?.controls && `${f.controls}-name`}
      onKeyDown={f ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); f.toggle(e) } } : undefined}
      className="flex min-w-0 items-center gap-0.5 rounded-[3px] text-[12px] font-semibold text-muted-foreground focus-visible:text-foreground">
      <span className="truncate">{title}</span>
      {/* (one chevron turning as the panel folds and opens) */}
      {f && <ChevronRight aria-hidden data-fold={f.collapsed ? "collapsed" : "open"} className={cn("size-3.5 shrink-0 [transition:opacity_var(--motion-fast)_var(--ease-out),rotate_var(--motion-fast)_var(--ease-out)]", !f.collapsed && "rotate-90 opacity-0 group-hover/head:opacity-100 group-has-focus-visible/head:opacity-100")} strokeWidth={2.25} />}
    </span>
  )
  const head = {
    "data-panel-handle": "", "data-heading": title,
    // (a hidden one folds only while its name shows: a click in the gap between panels does nothing)
    onClick: f ? (e: React.MouseEvent) => { if (!(e.target as HTMLElement).closest("button, a, input") && (mode !== "hidden" || headingsPeek())) f.toggle(e) } : undefined,
  }
  // Quiet or hidden: a slim gap, its name and buttons in it out of sight until pointed at (quiet) or ⌥ held; keyboard
  // focus shows them too. Nothing moves when they show.
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
  // In the open sidebar (one scroller), it stays at the top while its panel scrolls under it (the tree's buttons stay in
  // reach), and the next panel's pushes it away.
  const box = cn("group/head mt-2 shrink-0", f && "sticky top-0 z-[2] bg-sidebar", className)
  // A finger has no hover: the buttons are behind it, a swipe away (as a row's actions are).
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
        {/* The heading's right-click, under the button: whatever menu the panel gives it (Panels ▸, Hide...). */}
        {f && <HeadingButton icon={Ellipsis} label={`More for ${title}`} tip="More" data-heading-more onClick={rightClickBelow} />}
      </span>
      {aside}
      {alone && <LeaveMode leave={alone} />}
    </div>
  )
}
