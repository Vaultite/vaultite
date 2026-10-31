// Settings' shell, as System Settings is: a menu with its search on top (what it finds takes the menu's place), beside
// what's picked, each scrolling on its own. Narrow, the page is the menu (a pick opens a sheet). Plugins scrolls the same.
import { Fragment, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type UIEvent } from "react"
import { ChevronRight, type LucideIcon } from "lucide-react"
import { usePane } from "@/core/pane"
import { cn } from "@/lib/utils"
import { FilterField, IconTile, PageHeader } from "@/components/kit"
import { SidebarRow } from "@/components/Sidebar"

type Attrs = Record<`data-${string}`, string | undefined>

export type RailItem = {
  id: string; label: string; icon?: LucideIcon; tint?: string
  /** At its right end: how many it holds. */
  count?: number
  /** Above it: a heading (Features), or only some space. */
  heading?: string; gap?: boolean
  /** Its heading folds what's under it, to the next heading or space. */
  fold?: { open: boolean; toggle: () => void }
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

/** A heading that folds its rows, saying how many it holds. */
function FoldHeading({ label, fold, count }: { label: string; fold: NonNullable<RailItem["fold"]>; count: number }) {
  return (
    <button type="button" aria-expanded={fold.open} onClick={fold.toggle} data-rail-fold={label}
      className="group/fold mt-3 flex h-7 cursor-pointer items-center gap-1 rounded-[5px] px-1.5 text-[12px] font-semibold text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground">
      <span className="flex-1 text-left">{label}</span>
      {!fold.open && <span className="font-normal tabular-nums">{count}</span>}
      <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 transition-transform duration-150", fold.open && "rotate-90")} strokeWidth={2.5} />
    </button>
  )
}

/** How many rows a heading at `i` holds: to the next heading or space. */
function rowsFrom(items: RailItem[], i: number) {
  let n = 1
  while (i + n < items.length && !items[i + n].heading && !items[i + n].gap) n++
  return n
}

/** Icons on tiles of their colour (Settings' menu), memoised per icon and colour so rows keep their component. */
const tiles = new Map<string, LucideIcon>()
const tileOf = (icon: LucideIcon, tint: string): LucideIcon => {
  const key = `${icon.displayName ?? icon.name}|${tint}`
  let t = tiles.get(key)
  if (!t) { t = (() => <IconTile icon={icon} tint={tint} />) as unknown as LucideIcon; tiles.set(key, t) }
  return t
}

/** The menu's rows, at the sidebar's sizes: the rail where wide, Settings' page where narrow. `tiles`: each icon on a
 *  tile of its colour, as System Settings' menu. */
export function RailMenu({ label, items, active, pick, tiles: tiled, ...rest }: { label: string; items: RailItem[]; active: string | null; pick: (id: string) => void; tiles?: boolean } & Attrs) {
  let folded = false
  return (
    <nav aria-label={label} className={cn("flex flex-col gap-px", tiled && "[&_[data-keyrow]]:h-8")} {...rest}>
      {items.map((it, i) => {
        if (it.heading || it.gap) folded = !!it.fold && !it.fold.open
        else if (folded) return null
        const head = it.fold && it.heading
          ? <FoldHeading label={it.heading} fold={it.fold} count={rowsFrom(items, i)} />
          : it.heading ? heading(it.heading) : it.gap && <div className="pt-3" />
        const icon = tiled && it.icon ? tileOf(it.icon, it.tint ?? "var(--primary)") : it.icon
        return (
          <Fragment key={it.id}>
            {head}
            {!folded && (
              <SidebarRow icon={icon} tint={tiled ? undefined : it.tint} label={it.label} open active={active === it.id} onClick={() => pick(it.id)} {...it.attrs}>
                {it.count !== undefined && <span className="pr-0.5 text-[12px] text-muted-foreground tabular-nums">{it.count}</span>}
              </SidebarRow>
            )}
          </Fragment>
        )
      })}
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
