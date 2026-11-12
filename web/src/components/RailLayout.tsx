import { Fragment, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type UIEvent } from "react"
import { ChevronRight, type LucideIcon } from "lucide-react"
import { usePane } from "@/core/pane"
import { cn } from "@/lib/utils"
import { FilterField, IconTile, PageHeader } from "@/components/kit"
import { SidebarRow } from "@/components/Sidebar"

type Attrs = Record<`data-${string}`, string | undefined>

export type RailItem = {
  id: string; label: string; icon?: LucideIcon; tint?: string
  value?: string
  heading?: string; gap?: boolean
  fold?: { open: boolean; toggle: () => void }
  attrs?: Attrs
}

export function useRail(): Rail {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [wide, setWide] = useState(false)
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

function rowsFrom(items: RailItem[], i: number) {
  let n = 1
  while (i + n < items.length && !items[i + n].heading && !items[i + n].gap) n++
  return n
}

const tiles = new Map<string, LucideIcon>()
const tileOf = (icon: LucideIcon, tint: string): LucideIcon => {
  const key = `${icon.displayName ?? icon.name}|${tint}`
  let t = tiles.get(key)
  if (!t) { t = (() => <IconTile icon={icon} tint={tint} />) as unknown as LucideIcon; tiles.set(key, t) }
  return t
}

export function RailMenu({ label, items, active, pick, tiles: tiled, chevrons, ...rest }: { label: string; items: RailItem[]; active: string | null; pick: (id: string) => void; tiles?: boolean; chevrons?: boolean } & Attrs) {
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
              <SidebarRow icon={icon} tint={tiled ? undefined : it.tint} label={it.label} open active={active === it.id} aria-current={active === it.id ? "page" : undefined} onClick={() => pick(it.id)} {...it.attrs}>
                {it.value && <span className="pr-0.5 text-[12px] text-muted-foreground tabular-nums">{it.value}</span>}
                {chevrons && <ChevronRight aria-hidden className="size-4 shrink-0 text-tertiary" strokeWidth={2.5} />}
              </SidebarRow>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}

// display: none drops an element's scroll position, so a hidden tab's is kept and put back.
function Scroller({ page, className, children, ...rest }: { page?: string; className?: string; children: ReactNode } & Attrs) {
  const { hidden } = usePane()
  const el = useRef<HTMLDivElement>(null), kept = useRef(0)
  useLayoutEffect(() => { if (page !== undefined) el.current?.scrollTo({ top: 0 }) }, [page])
  useLayoutEffect(() => { if (!hidden && el.current) el.current.scrollTop = kept.current }, [hidden])
  const keep = (e: UIEvent<HTMLElement>) => { if (!hidden) kept.current = e.currentTarget.scrollTop }
  return <div ref={el} onScroll={keep} className={cn("overflow-y-auto overscroll-contain", className)} {...rest}>{children}</div>
}

function PageScroller({ page, children, ...rest }: { page?: string; children: ReactNode } & Attrs) {
  const { pane: own } = usePane()
  if (!own) return <div {...rest}>{children}</div>
  return (
    <Scroller page={page} className="h-full [scrollbar-gutter:stable]" {...rest}>
      <div className="mx-auto max-w-[912px] px-8 pb-6">{children}</div>
    </Scroller>
  )
}

type Search = {
  value: string; onChange: (v: string) => void; placeholder: string
  onSubmit?: () => void
  onMove?: (by: 1 | -1) => void
  attrs?: Attrs
}

export function RailLayout({ rail: [ref, wide], search, side, page, title, children }: {
  rail: Rail; search?: Search; side: ReactNode; page: string; title?: string; children: ReactNode
}) {
  const { pane: own } = usePane()
  const keys = (e: KeyboardEvent) => {
    if (!search?.onMove || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return
    e.preventDefault()
    search.onMove(e.key === "ArrowDown" ? 1 : -1)
  }
  const field = search && (
    <form role="search" aria-label={search.placeholder} className="flex" onKeyDown={keys} onSubmit={(e) => { e.preventDefault(); search.onSubmit?.() }} {...search.attrs}>
      <FilterField value={search.value} onChange={search.onChange} placeholder={search.placeholder} />
    </form>
  )
  if (wide && own) {
    return (
      <div ref={ref} className="flex h-full" data-rail-layout="wide">
        <div className="flex w-60 shrink-0 flex-col pr-2 pl-6" data-rail>
          {field && <div className="shrink-0 pb-2">{field}</div>}
          <Scroller className="min-h-0 flex-1 pb-6">{side}</Scroller>
        </div>
        <Scroller page={page} className="min-w-0 flex-1 [scrollbar-gutter:stable]" data-rail-pane="">
          <div className="max-w-[800px] pr-8 pb-6 pl-6">{children}</div>
        </Scroller>
      </div>
    )
  }
  return (
    <div ref={ref} className={cn(own && "h-full")} data-rail-layout="narrow">
      <PageScroller page={page}>
        {title && <PageHeader title={title} />}
        {field && <div className="mb-4">{field}</div>}
        {children}
      </PageScroller>
    </div>
  )
}
