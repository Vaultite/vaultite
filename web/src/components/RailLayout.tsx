// The shell Settings and Plugins share, as System Settings is: a menu with its search on top, beside what's picked,
// each scrolling on its own. Narrow, the menu is the page's list (Settings: a pick opens a sheet) or chips (Plugins).
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode, type UIEvent } from "react"
import { ChevronLeft, type LucideIcon } from "lucide-react"
import { usePane } from "@/core/pane"
import { cn } from "@/lib/utils"
import { FilterField, PageHeader } from "@/components/kit"
import { SidebarRow } from "@/components/Sidebar"

type Attrs = Record<`data-${string}`, string | undefined>

export type RailItem = {
  id: string; label: string; icon?: LucideIcon; tint?: string
  /** At its right end: how many it holds. */
  count?: number
  /** Above it: a heading (Features, Categories), or only some space. */
  heading?: string; gap?: boolean
  attrs?: Attrs
}

/** Wide enough for the menu beside what's picked: Tailwind's @3xl (48rem). Only in a pane: a phone's page is narrower.
 *  A callback ref: the page may draw another layout in its place (Settings' Plugins) and come back. */
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

/** The menu as a row of chips (a heading: a hairline before its first). */
function RailChips({ label, items, active, pick, ...rest }: { label: string; items: RailItem[]; active: string | null; pick: (id: string) => void } & Attrs) {
  return (
    <div className="-mx-1 mb-4 flex items-center gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label={label} {...rest}>
      {items.map((it) => (
        <Fragment key={it.id}>
          {(it.heading || it.gap) && <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />}
          <button type="button" onClick={() => pick(it.id)} aria-pressed={active === it.id} {...it.attrs}
            className={cn("h-9 shrink-0 cursor-pointer rounded-full px-3.5 text-[15px] whitespace-nowrap md:h-7.5 md:px-3 md:text-[13px]",
              active === it.id ? "bg-foreground text-background" : "bg-muted")}>
            {it.label}
          </button>
        </Fragment>
      ))}
    </div>
  )
}

type Search = { value: string; onChange: (v: string) => void; placeholder: string; onSubmit?: () => void; attrs?: Attrs }

/** `page`: what's picked (a new one starts at its top, the menu staying put). `narrow`: the menu as chips, or `children`
 *  alone (the page draws RailMenu as its list). `title`: narrow, above the search. `back`: a way out above the search. */
export function RailLayout({ rail: [ref, wide], label, items, active, pick, search, page, narrow, title, back, menuAttrs, chipsAttrs, children }: {
  rail: Rail
  label: string; items: RailItem[]; active: string | null; pick: (id: string) => void
  search: Search; page: string; narrow: "chips" | "list"; title?: string
  back?: { label: string; run: () => void }
  menuAttrs?: Attrs; chipsAttrs?: Attrs
  children: ReactNode
}) {
  // In a pane (not a phone's page, which the window scrolls): the layout scrolls itself.
  const { group, hidden } = usePane()
  const bounded = !!group
  const scroller = useRef<HTMLDivElement>(null), menuBox = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [page])
  // A tab kept drawn while hidden (display: none) loses its scroll: put back as it shows again.
  const kept = useRef({ pane: 0, menu: 0 })
  useLayoutEffect(() => {
    if (hidden) return
    if (scroller.current) scroller.current.scrollTop = kept.current.pane
    if (menuBox.current) menuBox.current.scrollTop = kept.current.menu
  }, [hidden])
  const keep = (k: "pane" | "menu") => (e: UIEvent<HTMLElement>) => { if (!hidden) kept.current[k] = e.currentTarget.scrollTop }
  const field = (
    // Enter goes to the first one found.
    <form role="search" className="flex" onSubmit={(e) => { e.preventDefault(); search.onSubmit?.() }} {...search.attrs}>
      <FilterField value={search.value} onChange={search.onChange} placeholder={search.placeholder} />
    </form>
  )
  const out = back && (
    <button type="button" onClick={back.run} data-rail-back
      className="-ml-1.5 mb-1 inline-flex h-8 cursor-pointer items-center gap-0.5 self-start rounded-[8px] pr-2 text-[15px] text-primary active:opacity-50 md:text-[13px]">
      <ChevronLeft className="size-4.5" strokeWidth={2.25} />{back.label}
    </button>
  )
  if (wide && bounded) {
    return (
      <div ref={ref} className="flex h-full" data-rail-layout="wide">
        <div className="flex w-60 shrink-0 flex-col pr-2 pl-6" data-rail>
          {out}
          <div className="shrink-0 pb-2">{field}</div>
          <div ref={menuBox} onScroll={keep("menu")} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6">
            <RailMenu label={label} items={items} active={active} pick={pick} {...menuAttrs} />
          </div>
        </div>
        <div ref={scroller} onScroll={keep("pane")} className="min-w-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]" data-rail-pane>
          <div className="mx-auto max-w-[760px] px-8 pb-6">{children}</div>
        </div>
      </div>
    )
  }
  const body = (
    <>
      {out}
      {title && <PageHeader title={title} />}
      <div className="mb-4">{field}</div>
      {narrow === "chips" && <RailChips label={label} items={items} active={active} pick={pick} {...chipsAttrs} />}
      {children}
    </>
  )
  return (
    <div ref={ref} className={cn(bounded && "h-full")} data-rail-layout="narrow">
      {bounded ? (
        <div ref={scroller} onScroll={keep("pane")} className="h-full overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
          <div className="mx-auto max-w-[912px] px-8 pb-6">{body}</div>
        </div>
      ) : body}
    </div>
  )
}
