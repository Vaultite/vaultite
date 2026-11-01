// The month's daily notes as a calendar in the sidebar: a dot under each day that has one (more dots, more words),
// today ringed; a day opens its note (made from the template when there's none, as the commands do).
import { useEffect, useState } from "react"
import { Calendar1, ChevronLeft, ChevronRight } from "lucide-react"
import { addDays, cn, dateText, dow, get, HeadingButton, openFile, parse, range, SidebarHeading, today, useVaultChange, type SidebarCtx } from "@vaultite"
import { nav, openDay } from "./Day"

type Month = { month: string; days: Record<string, { path: string; words: number }> }

const firstOf = (month: string) => `${month}-01`
const shift = (month: string, by: number) => { const d = parse(firstOf(month)); d.setMonth(d.getMonth() + by); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` }
/** Dots for a note's length: one for a few words, up to three for a long one. */
const dots = (words: number) => (words < 150 ? 1 : words < 600 ? 2 : 3)

function useMonth(month: string) {
  const [data, setData] = useState<Month | null>(null)
  const [seen, setSeen] = useState(0)
  useVaultChange(() => setSeen(Date.now()), [])
  useEffect(() => {
    let live = true
    get<Month>(`daily-notes/month?month=${month}`).then((r) => { if (live) setData(r) }, () => { if (live) setData({ month, days: {} }) })
    return () => { live = false }
  }, [month, seen])
  return data?.month === month ? data : null
}

export const MonthPanel = ({ open }: SidebarCtx) => (open ? <MonthCalendar /> : null)

/** The calendar itself: the panel's, and the tab's (`tab`: a page's heading with its arrows always shown). */
export function MonthCalendar({ tab = false }: { tab?: boolean }) {
  const now = today()
  const [month, setMonth] = useState(now.slice(0, 7))
  const data = useMonth(month)
  const start = addDays(firstOf(month), -dow(firstOf(month)))
  const weeks = Math.ceil((dow(firstOf(month)) + new Date(+month.slice(0, 4), +month.slice(5), 0).getDate()) / 7)
  const title = dateText(parse(firstOf(month)), { month: "long", year: "numeric" })
  const arrows = [
    month !== now.slice(0, 7) && { icon: Calendar1, label: "This month", to: now.slice(0, 7) },
    { icon: ChevronLeft, label: "Month before", to: shift(month, -1) }, { icon: ChevronRight, label: "Month after", to: shift(month, 1) },
  ].filter((a) => !!a)
  return (
    <div className={cn("flex shrink-0 flex-col", tab && "max-w-[440px]")} data-month-panel={month}>
      {tab ? (
        <div className="mb-3 flex items-center gap-1">
          <h1 className="mr-auto truncate text-[22px] leading-[28px] font-bold">{title}</h1>
          {arrows.map((a) => <button key={a.label} type="button" className={nav} aria-label={a.label} data-tip={a.label} onClick={() => setMonth(a.to)}><a.icon className="size-4" strokeWidth={2.5} /></button>)}
        </div>
      ) : (
        <SidebarHeading title={title} open>
          {arrows.map((a) => <HeadingButton key={a.label} icon={a.icon} label={a.label} onClick={() => setMonth(a.to)} />)}
        </SidebarHeading>
      )}
      <div className="grid grid-cols-7 px-1 pb-1 text-center" role="grid" aria-label="Daily notes this month">
        {range(start, 7).map((d) => <div key={d} className="pb-0.5 text-[11px] text-tertiary">{dateText(parse(d), { weekday: "narrow" })}</div>)}
        {range(start, weeks * 7).map((d) => {
          const note = data?.days[d], inMonth = d.startsWith(month)
          return (
            <button key={d} type="button" data-month-day={d} data-has-note={note ? "" : undefined}
              aria-label={`${dateText(parse(d), { weekday: "long", day: "numeric", month: "long" })}${note ? ", has a note" : ""}`}
              onClick={(e) => (note && (e.metaKey || e.ctrlKey) ? openFile(note.path, { newTab: true }) : void openDay(d, e.metaKey || e.ctrlKey))}
              className={cn("flex h-8 cursor-pointer flex-col items-center justify-center rounded-[6px] text-[13px] tabular-nums hover:bg-foreground/[0.06]",
                inMonth ? "text-foreground" : "text-tertiary")}>
              <span className={cn("grid size-6 place-items-center rounded-full leading-none", d === now && "bg-primary font-semibold text-primary-foreground")}>{+d.slice(8)}</span>
              <span className="flex h-1 gap-[2px]" aria-hidden>
                {note && Array.from({ length: dots(note.words) }, (_, i) => <span key={i} className="size-1 rounded-full bg-muted-foreground/70" />)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
