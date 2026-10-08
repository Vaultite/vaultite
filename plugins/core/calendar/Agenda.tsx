// The calendar card on Today: a day timeline, live from GET /api/calendar. From 17:00 it leads with tomorrow: plan
// the next day the evening before.
import { CalendarDays } from "lucide-react"
import { addDays, cn, dateText, Empty, fmtTime, iso, List, Loading, Panel, parse, today, useLive } from "@vaultite"
import type { CalEvent } from "./types"

type Feed = { events: CalEvent[]; configured: boolean; errors?: string[] }

const CAL_COLORS = ["var(--red)", "var(--blue)", "var(--green)", "var(--orange)", "var(--purple)"]
const calColor = (name: string) => CAL_COLORS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % CAL_COLORS.length]
const dayLabel = (d: string) => dateText(parse(d), { weekday: "short", day: "numeric", month: "short" })

export function AgendaPanel() {
  const t = today()
  const { data, loading } = useLive<Feed>(`calendar?from=${t}&to=${addDays(t, 6)}`)
  const events = data?.events ?? []
  const configured = data?.configured ?? true
  const now = new Date()
  const tm = addDays(t, 1)
  const evening = now.getHours() >= 17
  const on = (d: string) => events
    .filter((e) => (e.all_day ? e.start <= d && (e.end ?? addDays(e.start, 1)) > d : iso(new Date(e.start)) === d))
    .sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start.localeCompare(b.start))
  const rest = on(t).filter((e) => !e.all_day && new Date(e.end ?? e.start) > now)
  const groups = evening
    ? [{ d: tm, label: null, items: on(tm) }, ...(rest.length ? [{ d: t, label: "Rest of today", items: rest }] : [])]
    : [{ d: t, label: null, items: on(t) }, { d: tm, label: `Tomorrow · ${dayLabel(tm)}`, items: on(tm) }]
  const lead = evening ? tm : t
  return (
    <Panel icon={CalendarDays} tint="var(--red)"
      title={<>{evening ? "Tomorrow" : "Today"} <span className="ml-1 font-normal text-muted-foreground">{dayLabel(lead)}</span></>}>
      {loading ? (
        <Loading />
      ) : !configured ? (
        <Empty>No calendars connected yet. Ask Claude to connect one (its private iCal link).</Empty>
      ) : (
        <div className="space-y-4">
          {groups.map(({ d, label, items }) => (
            <div key={d}>
              {label && <div className="mb-1 text-[13px] font-semibold text-muted-foreground">{label}</div>}
              {!items.length ? (
                <p className="py-1 text-[15px] text-muted-foreground">Nothing scheduled</p>
              ) : (
                <List>
                  {items.map((e, i) => {
                    const past = !e.all_day && new Date(e.end ?? e.start) < now
                    return (
                      <div key={i} className={cn("flex min-h-11 gap-3 py-2", past && "opacity-45")}>
                        <div className="num w-[62px] shrink-0 text-[13px] leading-[18px]">
                          {e.all_day ? <span className="text-muted-foreground">All day</span> : (
                            <>
                              <div>{fmtTime(e.start)}</div>
                              {e.end && <div className="text-muted-foreground">{fmtTime(e.end)}</div>}
                            </>
                          )}
                        </div>
                        <span className="w-[3px] shrink-0 rounded-full" style={{ background: calColor(e.calendar || "") }} />
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 text-[15px] leading-[18px] font-medium">{e.title || "Busy"}</div>
                          {e.location && <div className="truncate text-[13px] text-muted-foreground">{e.location}</div>}
                        </div>
                      </div>
                    )
                  })}
                </List>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

