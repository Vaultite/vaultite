import { useLayoutEffect, useRef } from "react"
import { Ellipsis, PanelLeft, PanelRight } from "lucide-react"
import { focusedPane, panesOf, type Pane, type Tab } from "../../../core/layout.ts"
import { besideOf, useSwipe } from "@/core/phoneTabs"
import { menuBelow } from "@/components/ContextMenu"
import { openDrawer, useHasDrawer } from "@/components/PhoneDrawer"
import { phoneTabMenu, useTabLabels } from "@/components/Tabs"
import { titleInSight } from "@/components/FileTitle"
import { usePrefs } from "@/core/prefs"
import { useStore } from "@/core/data"
import { selectPane } from "@/core/workspace"
import { phoneApp } from "@/core/phoneapp"
import { cn } from "@/lib/utils"

const edgesOurs = typeof navigator !== "undefined" && (!!phoneApp
  || (/iPhone|iPad|iPod/.test(navigator.userAgent) && (matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true)))

const button = "grid size-11 shrink-0 cursor-pointer place-items-center text-primary active:opacity-50"

export function PhoneHeader({ title, tab }: { title: string; tab: Tab }) {
  const buttons = usePrefs().sidebarButtons || !edgesOurs
  const left = useHasDrawer("left") && buttons, right = useHasDrawer("right") && buttons
  const inSight = titleInSight.use()
  const ps = panesOf(tab), at = ps.findIndex((p) => p.id === tab.focus)
  const label = useTabLabels(useStore().store)
  const name = ps.length > 1 ? label(focusedPane(tab)).label : title
  const swipe = useSwipe()
  const near = swipe ? besideOf(swipe) : []
  const nameOf = (t: Tab, p: Pane) => (swipe === "panes" || panesOf(t).length > 1 ? label(p).label : label(t).label)
  const row = useSides()
  return (
    <header data-phone-header className="sight-top glass-strong fixed inset-x-0 top-0 z-30 pt-[env(safe-area-inset-top)] md:hidden">
      <div ref={row} className="relative grid h-11 grid-cols-[1fr_minmax(0,auto)_1fr] items-center px-1">
        {ps.length > 1 && <PaneDots ids={ps.map((p) => p.id)} at={at} tabs={swipe === "tabs"} alone={inSight} />}
        <div className="flex min-w-(--side) items-center">
          <div data-side className="flex w-max items-center">
            {left && (
              <button type="button" aria-label="Open sidebar" onClick={() => openDrawer("left")} className={button}>
                <PanelLeft className="size-[22px]" strokeWidth={1.9} />
              </button>
            )}
          </div>
        </div>
        <div className={cn("relative flex min-w-0 flex-col items-center", ps.length > 1 && "self-stretch justify-center pb-2.5")}>
          <div className={cn("group/title relative max-w-full transition-opacity duration-150", inSight && "opacity-0")}>
            <div data-phone-title className="truncate px-1 text-center text-[17px] font-semibold group-has-[#phone-subtitle:not(:empty)]/title:text-[16px] group-has-[#phone-subtitle:not(:empty)]/title:leading-[20px]" style={NOW}>{name}</div>
            <div id="phone-subtitle" className="truncate px-1 text-center text-[12px] leading-[15px] text-muted-foreground empty:hidden" style={NOW} />
            {near.map((b) => (
              <div key={b.side} aria-hidden data-phone-title-beside={b.side} style={SIDE[b.side]}
                className="pointer-events-none absolute top-0 left-1/2 w-max max-w-[calc(100vw-0.5rem-2*var(--side,0px))] truncate px-1 text-center text-[17px] font-semibold">{nameOf(b.tab, b.pane)}</div>
            ))}
          </div>
        </div>
        <div className="flex min-w-(--side) items-center justify-end">
          <div data-side className="flex w-max items-center">
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
      </div>
    </header>
  )
}

function useSides() {
  const row = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = row.current
    if (!el) return
    const sides = [...el.querySelectorAll<HTMLElement>("[data-side]")]
    const fit = () => el.style.setProperty("--side", `${Math.max(...sides.map((s) => s.offsetWidth))}px`)
    const ro = new ResizeObserver(fit)
    for (const s of sides) ro.observe(s)
    fit()
    return () => ro.disconnect()
  }, [])
  return row
}

const COME = { 1: "var(--swipe-next, 0)", [-1]: "var(--swipe-prev, 0)", 0: "(1 - var(--swipe-next, 0) - var(--swipe-prev, 0))" } as const
const NOW = { opacity: `calc${COME[0]}`, transform: "translateX(calc((var(--swipe-prev, 0) - var(--swipe-next, 0)) * 40px))" }
const SIDE = {
  1: { opacity: COME[1], translate: "calc(-50% + (1 - var(--swipe-next, 0)) * 40px) 0" },
  [-1]: { opacity: COME[-1], translate: "calc(-50% - (1 - var(--swipe-prev, 0)) * 40px) 0" },
} as const

function PaneDots({ ids, at, tabs, alone }: { ids: string[]; at: number; tabs: boolean; alone: boolean }) {
  const n = ids.length, k = Math.max(16 / 44, 1 - 19 / ((n - 1) * 22))
  const lit = (i: number) => (i === at ? `calc${COME[0]}` : i === at + 1 ? COME[1] : i === at - 1 ? COME[-1] : "0")
  return (
    <div data-pane-dots role="group" aria-label="Panes" className={cn("absolute inset-y-0 left-1/2 flex -translate-x-1/2 transition-transform duration-150", alone && "-translate-y-3")} style={tabs ? { opacity: `calc${COME[0]}` } : undefined}>
      {ids.map((id, i) => (
        <button key={id} type="button" aria-label={`Pane ${i + 1} of ${n}`} aria-current={i === at || undefined} onClick={() => selectPane(id)}
          className="relative w-11 cursor-pointer">
          <span aria-hidden data-dot-lit={i === at || undefined} className="absolute bottom-[7px] left-1/2 size-1.5 rounded-full"
            style={{ transform: `translateX(calc(-50% + ${-(i - (n - 1) / 2) * 44 * (1 - k)}px))`, background: `color-mix(in srgb, var(--foreground) calc(20% + 50% * ${lit(i)}), transparent)` }} />
        </button>
      ))}
    </div>
  )
}
