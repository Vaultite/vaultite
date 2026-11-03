// Phones: the top bar: the sidebars' buttons (with `sidebarButtons`, or where the edges are the browser's), the title
// (once the page's own has scrolled away), the page's own buttons (#phone-actions) and the tab's … menu.
import { Ellipsis, PanelLeft, PanelRight } from "lucide-react"
import type { Tab } from "../../../core/layout.ts"
import { menuBelow } from "@/components/ContextMenu"
import { openDrawer, useHasDrawer } from "@/components/PhoneDrawer"
import { phoneTabMenu } from "@/components/Tabs"
import { titleInSight } from "@/components/FileTitle"
import { usePrefs } from "@/core/prefs"
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
        <div data-phone-title className={cn("truncate px-1 text-center text-[17px] font-semibold transition-opacity duration-150", inSight && "opacity-0")}>{title}</div>
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
