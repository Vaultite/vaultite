// Read-only presence grid: recent weeks as rows, Mon–Sun as columns, a dot on days that count.
// `tip(d)` returns a description for filled days (null for empty ones); filled dots open `onOpen(d)`.
import { addDays, dateText, parse, range, today, weekStart } from "@/core/data"
import { cn } from "@/lib/utils"

const DAY = { day: "numeric", month: "short" } as const, NARROW = { weekday: "narrow" } as const
const short = (d: string) => dateText(parse(d), DAY)

export function WeeksGrid({ tip, tint, goal, weeks = 6, onOpen }: {
  tip: (d: string) => string | null; tint: string; goal?: number | null; weeks?: number; onOpen?: (d: string) => void
}) {
  const t = today()
  const ws = weekStart(t)
  const starts = Array.from({ length: weeks }, (_, i) => addDays(ws, -7 * (weeks - 1 - i)))
  return (
    <div className="grid items-center gap-y-1" style={{ gridTemplateColumns: "minmax(44px,1fr) repeat(7, minmax(24px, 40px)) 32px" }}>
      <div />
      {range(ws, 7).map((d) => (
        <div key={d} className="text-center text-[11px] text-muted-foreground">
          {dateText(parse(d), NARROW)}
        </div>
      ))}
      <div />
      {starts.map((w) => {
        const days = range(w, 7)
        const tips = days.map(tip)
        const n = tips.filter((x) => x !== null).length
        const met = !!goal && n >= goal
        return (
          <div key={w} className="contents">
            <div className={cn("text-[13px] whitespace-nowrap tabular-nums", w === ws ? "font-semibold" : "text-muted-foreground")}>{short(w)}</div>
            {days.map((d, i) => {
              const on = tips[i]
              const label = `${short(d)}${on ? `: ${on}` : ", nothing"}`
              const dot = (
                <span className={cn("block size-5 rounded-full transition-transform", on === null && "bg-muted",
                  d > t && "opacity-40", d === t && on === null && "ring-2 ring-primary/40")}
                  style={on !== null ? { background: tint } : undefined} />
              )
              return (
                <div key={d} className="grid h-8 place-items-center">
                  {on !== null && onOpen ? (
                    <button type="button" data-tip={label} aria-label={label} onClick={() => onOpen(d)}
                      className="grid size-8 cursor-pointer place-items-center rounded-full hover:[&>span]:scale-115 active:[&>span]:scale-90">
                      {dot}
                    </button>
                  ) : (
                    <span role="img" data-tip={on ? label : undefined} aria-label={label}>{dot}</span>
                  )}
                </div>
              )
            })}
            <div className={cn("num text-right text-[13px]", met ? "font-semibold" : "text-muted-foreground")}
              style={met ? { color: tint } : undefined}>
              {goal ? `${n}/${goal}` : n}
            </div>
          </div>
        )
      })}
    </div>
  )
}
