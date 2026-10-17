// Settings' shell, as System Settings is: a menu with its search on top (what it finds takes the menu's place), beside
// what's picked, each scrolling on its own. Narrow, the page is the menu (a pick opens a sheet). Plugins scrolls the same.
import { Fragment, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type UIEvent } from "react"
import type { LucideIcon } from "lucide-react"
import { usePane } from "@/core/pane"
import { cn } from "@/lib/utils"
import { FilterField, PageHeader } from "@/components/kit"
import { SidebarRow } from "@/components/Sidebar"

type Attrs = Record<`data-${string}`, string | undefined>

export type RailItem = {
  id: string; label: string; icon?: LucideIcon; tint?: string
  /** At its right end: how many it holds. */
  count?: number
  /** Above it: a heading (Features), or only some space. */
  heading?: string; gap?: boolean
  attrs?: Attrs
}

/** Wide enough for the menu beside what's picked: Tailwind's @3xl (48rem). Only in a pane: a phone's page is narrower.
 *  A callback ref: the page may draw another layout in its place and come back. */
export function useRail(): Rail {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [wide, setWide] = useState(false)
  // (before the first paint, so a wide pane never shows the narrow layout first; a hidden tab measures 0 and keeps its)
  useLayoutEffect(() => {
    if (!el) return
    const measure = () => { if (el.clientWidth) setWide(el.clientWidth >= 48 * parseFloat(getComputedStyle(document.documentElement).fontSize)) }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, wide]
}
type Rail = [(el: HTMLDivElement | null) => void, boolean]

const heading = (t: string) => <div className="px-1.5 pt-4 pb-1 text-[12px] font-semibold text-muted-foreground">{t}</div>

/** The menu's rows, at the sidebar's sizes: the rail where wide, Settings' page where narrow. */
export function RailMenu({ label, items, active, pick, ...rest }: { label: string; items: RailItem[]; active: string | null; pick: (id: string) => void } & Attrs) {
  return (
    <nav aria-label={label} className="flex flex-col gap-px" {...rest}>
      {items.map((it) => (
        <Fragment key={it.id}>
          {it.heading ? heading(it.heading) : it.gap && <div className="pt-3" />}
          <SidebarRow icon={it.icon} tint={it.tint} label={it.label} open active={active === it.id} onClick={() => pick(it.id)} {...it.attrs}>
            {it.count !== undefined && <span className="pr-0.5 text-[12px] text-muted-foreground tabular-nums">{it.count}</span>}
          </SidebarRow>
        </Fragment>
      ))}
    </nav>
  )
}

/** A box that scrolls itself; a tab kept drawn while hidden (display: none) loses its scroll, put back as it shows.
 *  `page`: a new one starts at the top. */
function Scroller({ page, className, children, ...rest }: { page?: string; className?: string; children: ReactNode } & Attrs) {
  const { hidden } = usePane()
  const el = useRef<HTMLDivElement>(null), kept = useRef(0)
  useLayoutEffect(() => { if (page !== undefined) el.current?.scrollTo({ top: 0 }) }, [page])
  useLayoutEffect(() => { if (!hidden && el.current) el.current.scrollTop = kept.current }, [hidden])
  const keep = (e: UIEvent<HTMLElement>) => { if (!hidden) kept.current = e.currentTarget.scrollTop }
  return <div ref={el} onScroll={keep} className={cn("overflow-y-auto overscroll-contain", className)} {...rest}>{children}</div>
}

/** The narrow layout in a pane scrolls itself (a phone's, the window does), at the reading width. */
function PageScroller({ children, ...rest }: { children: ReactNode } & Attrs) {
  const { group } = usePane()
  if (!group) return <div {...rest}>{children}</div>
  return (
    <Scroller className="h-full [scrollbar-gutter:stable]" {...rest}>
      <div className="mx-auto max-w-[912px] px-8 pb-6">{children}</div>
    </Scroller>
  )
}

type Search = {
  value: string; onChange: (v: string) => void; placeholder: string
  /** Enter: the result picked (else the first). */
  onSubmit?: () => void
  /** The arrow keys: the next or previous result. */
  onMove?: (by: 1 | -1) => void
  attrs?: Attrs
}

/** `side`: under the search where wide (the menu, or what it found). `page`: what's picked (a new one starts at its top).
 *  Narrow: `title`, the search, then `children` alone (the page draws the menu as its list). */
export function RailLayout({ rail: [ref, wide], search, side, page, title, children }: {
  rail: Rail; search: Search; side: ReactNode; page: string; title?: string; children: ReactNode
}) {
  const { group } = usePane()
  const keys = (e: KeyboardEvent) => {
    if (!search.onMove || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return
    e.preventDefault()
    search.onMove(e.key === "ArrowDown" ? 1 : -1)
  }
  const field = (
    // Enter goes to the result picked; the arrows move between them.
    <form role="search" className="flex" onKeyDown={keys} onSubmit={(e) => { e.preventDefault(); search.onSubmit?.() }} {...search.attrs}>
      <FilterField value={search.value} onChange={search.onChange} placeholder={search.placeholder} />
    </form>
  )
  // In a pane (not a phone's page, which the window scrolls): the layout scrolls itself.
  if (wide && group) {
    return (
      <div ref={ref} className="flex h-full" data-rail-layout="wide">
        <div className="flex w-60 shrink-0 flex-col pr-2 pl-6" data-rail>
          <div className="shrink-0 pb-2">{field}</div>
          <Scroller className="min-h-0 flex-1 pb-6">{side}</Scroller>
        </div>
        <Scroller page={page} className="min-w-0 flex-1 [scrollbar-gutter:stable]" data-rail-pane="">
          <div className="mx-auto max-w-[760px] px-8 pb-6">{children}</div>
        </Scroller>
      </div>
    )
  }
  return (
    <div ref={ref} className={cn(group && "h-full")} data-rail-layout="narrow">
      <PageScroller>
        {title && <PageHeader title={title} />}
        <div className="mb-4">{field}</div>
        {children}
      </PageScroller>
    </div>
  )
}
