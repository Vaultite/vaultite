// Routines as a week matrix: one row per routine, one column per day. Tap a cell to tick it; tap a routine for its history.
import { useRef, useState, type ReactNode } from "react"
import { Check, ChevronLeft, ChevronRight } from "lucide-react"
import { addDays, cn, dateText, detailPath, dow, isArchived, namedIcon, openDetail, parse, range, today, weekStart, type Store } from "@vaultite"
import { ticked, type Routine } from "./types"
import { autoDone, routineDone, routineIcon, toggle, weeklyTarget } from "./routines"

export function RoutineGrid({ store }: { store: Store }) {
  const t = today()
  const [start, setStart] = useState(weekStart(t))
  const days = range(start, 7)
  const habits = store.routines.filter((h) => !isArchived(h))
  const isThisWeek = start === weekStart(t)
  const label = isThisWeek
    ? "This week"
    : `${dateText(parse(start), { day: "numeric", month: "short" })} – ${dateText(parse(addDays(start, 6)), { day: "numeric", month: "short" })}`

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        <div className="flex gap-1">
          <NavButton label="Previous week" onClick={() => setStart(addDays(start, -7))}><ChevronLeft className="size-4" /></NavButton>
          <NavButton label="Next week" disabled={isThisWeek} onClick={() => setStart(addDays(start, 7))}><ChevronRight className="size-4" /></NavButton>
        </div>
      </div>
      {/* Under 360px the days take 26px each (their dots are 24px there), so a routine's name keeps room for a word. */}
      <div className="grid items-center grid-cols-[minmax(0,1fr)_repeat(7,26px)] min-[360px]:grid-cols-[minmax(0,1fr)_repeat(7,30px)] sm:grid-cols-[minmax(92px,1fr)_repeat(7,minmax(26px,56px))_40px]">
        <div />
        {days.map((d) => (
          <div key={d} className={cn("text-center text-[11px] leading-tight text-muted-foreground", d === t && "font-semibold text-primary")}>
            {dateText(parse(d), { weekday: "narrow" })}
            <div className="tabular-nums">{parse(d).getDate()}</div>
          </div>
        ))}
        <div className="hidden sm:block" />
        {habits.map((h) => {
          const done = days.filter((d) => routineDone(store, h, d)).length
          const target = weeklyTarget(store, h)
          const Icon = namedIcon(routineIcon(store, h))
          return (
            <Row key={h.id}>
              <button type="button" onClick={() => openDetail(detailPath("routine", h.id))}
                className="flex min-w-0 cursor-pointer items-start gap-2 py-1 pr-2 text-left transition-colors hover:text-primary">
                {Icon && <Icon className="mt-px size-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0">
                  <span className="line-clamp-2 text-[15px] leading-[18px] [overflow-wrap:anywhere]">{h.name.replace(/ (am|pm)\b/gi, "\u00a0$1")}</span>
                  <span className="num block text-[12px] text-muted-foreground sm:hidden">{done} of {target}</span>
                </span>
              </button>
              {days.map((d) => <Cell key={d} store={store} h={h} d={d} />)}
              <div className="num hidden text-right text-[13px] text-muted-foreground sm:block">{done}/{target}</div>
            </Row>
          )
        })}
      </div>
    </div>
  )
}

/** Tap ticks an open day; a done day (or right-click / long-press on any day) opens what's behind it. */
function Cell({ store, h, d }: { store: Store; h: Routine; d: string }) {
  const t = today()
  const timer = useRef<number>(undefined)
  const long = useRef(false)
  const auto = autoDone(store, h, d)
  const on = auto || ticked(store, h.id, d)
  const applies = h.days.includes(String(dow(d)))
  const future = d > t
  const open = () => openDetail(detailPath("routine", h.id, d))
  const cancel = () => clearTimeout(timer.current)
  return (
    <div className="grid place-items-center">
      <button
        type="button"
        disabled={future || !applies}
        onClick={() => { if (long.current) { long.current = false; return } on ? open() : toggle(h.id, d) }}
        onContextMenu={(e) => { e.preventDefault(); cancel(); open() }}
        onPointerDown={() => { long.current = false; timer.current = window.setTimeout(() => { long.current = true; open() }, 500) }}
        data-own-hold=""
        onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel}
        aria-label={`${h.name}, ${d}${auto ? ", done (from your data)" : on ? ", done" : ""}`}
        data-tip={on ? "Open details" : undefined}
        aria-pressed={on}
        className={cn(
          "group grid h-11 w-full cursor-pointer place-items-center rounded-full transition-transform select-none [-webkit-touch-callout:none] active:scale-90 disabled:cursor-default",
          (future || !applies) && "opacity-30",
        )}
      >
        <span className={cn(
          "grid size-6 place-items-center rounded-full transition-colors min-[360px]:size-7 sm:size-8",
          on ? "bg-primary text-primary-foreground group-hover:brightness-110" : "bg-muted group-hover:bg-foreground/10",
          d === t && !on && "ring-2 ring-primary/40",
        )}>
          {on && <Check className="size-4" strokeWidth={3} />}
        </span>
      </button>
    </div>
  )
}

// display: contents keeps each routine's cells in the parent grid.
const Row = ({ children }: { children: ReactNode }) => <div className="contents">{children}</div>

function NavButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} disabled={disabled}
      className="grid size-7 place-items-center rounded-full bg-muted text-foreground transition hover:bg-foreground/10 disabled:opacity-30">
      {children}
    </button>
  )
}
