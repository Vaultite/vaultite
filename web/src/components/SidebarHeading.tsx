// A sidebar panel's heading, on its own so the file tree (which the sidebar imports) can use it too.
import { createContext, useContext } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { coarse } from "@/core/haptics"
import { SwipeRow } from "@/components/SwipeRow"
import { cn } from "@/lib/utils"

/** The panel a heading is in (SidebarPanels provides it, in the open sidebar): whether it's folded to its heading, and
 *  how to fold or open it. None (a heading outside the sidebar, the rail): the heading is only a label. */
export const PanelFold = createContext<{ collapsed: boolean; toggle: (e?: { altKey: boolean }) => void } | null>(null)

/** A panel's heading: label left, hover buttons right (touch: swiped to); click folds the panel, drag moves it (`data-panel-handle`).
 *  Nothing in the rail. The Plugins page's sections use it too (`sticky` false). */
export function SidebarHeading({ title, open, children, sticky = true, className }: {
  title: string; open: boolean
  children?: React.ReactNode
  sticky?: boolean; className?: string
}) {
  const fold = useContext(PanelFold)
  if (!open) return null
  const f = fold
  const Chevron = f?.collapsed ? ChevronRight : ChevronDown
  const label = (
    <span role={f ? "button" : undefined} tabIndex={f ? 0 : undefined} aria-expanded={f ? !f.collapsed : undefined}
      onKeyDown={f ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); f.toggle(e) } } : undefined}
      className="flex min-w-0 items-center gap-0.5 rounded-[3px] text-[12px] font-semibold text-muted-foreground focus-visible:text-foreground">
      <span className="truncate">{title}</span>
      {f && <Chevron aria-hidden data-fold={f.collapsed ? "collapsed" : "open"} className={cn("size-3.5 shrink-0 transition-opacity", !f.collapsed && "opacity-0 group-hover/head:opacity-100 group-has-focus-visible/head:opacity-100")} strokeWidth={2.25} />}
    </span>
  )
  const head = {
    "data-panel-handle": "", "data-heading": title,
    onClick: f ? (e: React.MouseEvent) => { if (!(e.target as HTMLElement).closest("button, a, input")) f.toggle(e) } : undefined,
  }
  // In the open sidebar (one scroller), it stays at the top while its panel scrolls under it (the tree's buttons stay in
  // reach), and the next panel's pushes it away.
  const box = cn("group/head mt-2 shrink-0", f && sticky && "sticky top-0 z-[2] bg-sidebar", className)
  // A finger has no hover: the buttons are behind it, a swipe away (as a row's actions are).
  if (coarse && children) {
    return (
      <SwipeRow {...head} under={children} className={box}>
        <div className="flex h-7 items-center pr-0.5 pl-1.5">{label}</div>
      </SwipeRow>
    )
  }
  return (
    <div {...head} className={cn("flex h-7 items-center gap-0.5 pr-0.5 pl-1.5 transition-opacity duration-200", box)}>
      {label}
      <span className="flex-1" />
      <span className="flex gap-0.5 opacity-0 transition-opacity group-hover/head:opacity-100 focus-within:opacity-100">{children}</span>
    </div>
  )
}
