// Phones: the top bar: the sidebars' buttons (`sidebarButtons`, or where the edges are the browser's), the pane's title
// (once the page's own has scrolled away) with a split tab's dots, the page's buttons (#phone-actions), the … menu.
import { Ellipsis, PanelLeft, PanelRight } from "lucide-react"
import { focusedPane, panesOf, type Tab } from "../../../core/layout.ts"
import { menuBelow } from "@/components/ContextMenu"
import { openDrawer, useHasDrawer } from "@/components/PhoneDrawer"
import { phoneTabMenu, useTabLabels } from "@/components/Tabs"
import { titleInSight } from "@/components/FileTitle"
import { usePrefs } from "@/core/prefs"
import { useStore } from "@/core/data"
import { selectPane } from "@/core/workspace"
import { phoneApp } from "@/core/phoneapp"
import { cn } from "@/lib/utils"

/** Whether the screen's edges are the drawers' (the iPhone app, a Home Screen web app on an iPhone or iPad), not the
 *  browser's or the system's. */
const edgesOurs = typeof navigator !== "undefined" && (!!phoneApp
  || (/iPhone|iPad|iPod/.test(navigator.userAgent) && (matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true)))

const button = "grid size-11 shrink-0 cursor-pointer place-items-center text-primary active:opacity-50"

export function PhoneHeader({ title, tab }: { title: string; tab: Tab }) {
  const buttons = usePrefs().sidebarButtons || !edgesOurs
  const left = useHasDrawer("left") && buttons, right = useHasDrawer("right") && buttons
  // iOS large titles: the name shows here once the page's own title (FileTitle.tsx) has scrolled away, or if it has none.
  const inSight = titleInSight.use()
  const ps = panesOf(tab), at = ps.findIndex((p) => p.id === tab.focus)
  // (a split tab's title is its panes' joined: the header names the one on screen)
  const label = useTabLabels(useStore().store)
  const name = ps.length > 1 ? label(focusedPane(tab)).label : title
  return (
    <header data-phone-header className="sight-top glass-strong fixed inset-x-0 top-0 z-30 pt-[env(safe-area-inset-top)] md:hidden">
      {/* Three columns, the outer two as wide as each other, so the name stays centred whatever buttons there are. */}
      <div className="grid h-11 grid-cols-[1fr_minmax(0,auto)_1fr] items-center px-1">
        <div className="flex items-center">
          {left && (
            <button type="button" aria-label="Open sidebar" onClick={() => openDrawer("left")} className={button}>
              <PanelLeft className="size-[22px]" strokeWidth={1.9} />
            </button>
          )}
        </div>
        <div className={cn("relative flex min-w-0 flex-col items-center", ps.length > 1 && "self-stretch justify-center pb-2.5")} style={ps.length > 1 ? { minWidth: ps.length * 44 } : undefined}>
          <div data-phone-title className={cn("max-w-full truncate px-1 text-center text-[17px] font-semibold transition-opacity duration-150", inSight && "opacity-0")}>{name}</div>
          {ps.length > 1 && <PaneDots ids={ps.map((p) => p.id)} at={at} />}
        </div>
        <div className="flex items-center justify-end">
          <div id="phone-actions" className="flex items-center empty:hidden" />
          {right && (
            <button type="button" aria-label="Open right sidebar" onClick={() => openDrawer("right")} className={button}>
              <PanelRight className="size-[22px]" strokeWidth={1.9} />
            </button>
          )}
          <button type="button" aria-label="More" aria-haspopup="menu" onClick={(e) => menuBelow(e, phoneTabMenu(tab))} className={cn(button, "-mr-0.5")}>
            <Ellipsis className="size-[22px]" strokeWidth={2} />
          </button>
        </div>
      </div>
    </header>
  )
}

/** A split tab's panes, a dot each under the title, the shown one darker: each a button (the row's whole height, 44px
 *  wide) that shows its pane, for who doesn't swipe. The dots sit closer than their buttons, each inside its own. */
function PaneDots({ ids, at }: { ids: string[]; at: number }) {
  const n = ids.length, k = Math.max(16 / 44, 1 - 19 / ((n - 1) * 22))
  return (
    <div data-pane-dots role="group" aria-label="Panes" className="absolute inset-y-0 left-1/2 flex -translate-x-1/2">
      {ids.map((id, i) => (
        <button key={id} type="button" aria-label={`Pane ${i + 1} of ${n}`} aria-current={i === at || undefined} onClick={() => selectPane(id)}
          className="relative w-11 cursor-pointer">
          <span aria-hidden className={cn("absolute bottom-[7px] left-1/2 size-1.5 rounded-full transition-colors", i === at ? "bg-foreground/70" : "bg-foreground/20")}
            style={{ transform: `translateX(calc(-50% + ${-(i - (n - 1) / 2) * 44 * (1 - k)}px))` }} />
        </button>
      ))}
    </div>
  )
}
