import { useEffect, useState } from "react"
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight } from "lucide-react"
import { addDays, Button, definePlugin, Empty, FileEditor, get, Loading, op, openFile, Panel, today, type BlockCtx } from "@vaultite"
import { MonthCalendar, MonthPanel } from "./Month"
import { DailyPanel, DailyView, dayName, inSentence, ISO, nav, openDay, shownDay, useDay, whose } from "./Day"

/** ```block-day: a day's note (or its `section`) edited in place, stepping to other days; a missing one is started
 *  only when asked (reading never makes it). */
function DayBlock({ store, options }: BlockCtx) {
  const heading = typeof options.section === "string" ? options.section.trim().replace(/^#+\s*/, "") : ""
  const base = typeof options.date === "string" && ISO.test(options.date) ? options.date : today()
  const [date, setDate] = useState(base)
  useEffect(() => setDate(base), [base])
  const { day, error, start, started, starting } = useDay(date)
  const name = dayName(date)
  return (
    <Panel title={heading || "Daily note"} icon={CalendarDays}
      action={
        <div className="flex items-center gap-1">
          <button type="button" className={nav} aria-label="Day before" data-tip="Day before" onClick={() => setDate(addDays(date, -1))}><ChevronLeft className="size-4" strokeWidth={2.5} /></button>
          <button type="button" disabled={!day?.exists} className="h-9 cursor-pointer rounded-[7px] px-1.5 text-[13px] text-muted-foreground tabular-nums hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted-foreground md:h-7"
            data-tip={day?.exists ? `Open ${date}` : undefined} onClick={(e) => day && openFile(day.path, { newTab: e.metaKey || e.ctrlKey })}>{name}</button>
          <button type="button" className={nav} aria-label="Day after" data-tip="Day after" onClick={() => setDate(addDays(date, 1))}><ChevronRight className="size-4" strokeWidth={2.5} /></button>
        </div>
      }>
      {!day ? <Loading error={error && "Couldn't find the daily note."} />
        : !day.exists ? (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <Empty>No note for {inSentence(name)} yet.</Empty>
            <Button look="quiet" size="small" className="-mr-2" busy={starting} onClick={start}>Start it</Button>
          </div>
        )
        : <FileEditor key={day.path} path={day.path} store={store} section={heading || undefined} autoFocus={started}
            noSection={<Empty>No {heading} section in this note.</Empty>} />}
    </Panel>
  )
}

export default definePlugin({
  commands: [
    { id: "daily-notes:today", name: "Open today's daily note", keys: ["Mod+Alt+D"], run: () => openDay(today()), fromLink: true, label: "Daily note" },
    { id: "daily-notes:tomorrow", name: "Open tomorrow's daily note", run: () => openDay(addDays(today(), 1)), label: "Daily note" },
  ],
  blocks: { day: (ctx) => <DayBlock {...ctx} /> },
  // (a link to a day without a note, [[2026-10-08]], makes it as the commands do: not a stray note beside the open one)
  conventions: {
    linkedNote: async (_s, name) => {
      const day = await get<{ date: string; path: string } | null>(`daily-notes/day?name=${encodeURIComponent(name)}`)
      return day && (await op<{ path: string }>("daily-note.open", { date: day.date })).path
    },
  },
  // Hidden until shown (the sidebar's right-click menu): a scratchpad beside the open note; in the rail, a flyout to
  // jot in.
  sidebar: {
    daily: {
      title: "Daily note", names: ["daily note", "journal", "today's note", "scratchpad"], heading: false, needsHeading: true, sort: 38, hidden: true, view: "daily-note",
      flyout: { icon: CalendarDays, width: 320 },
      // (opening the note makes it, as the commands do)
      tab: () => { const date = shownDay(); return { name: `${whose(date)} note`, open: () => openDay(date, true) } },
      render: (ctx) => <DailyPanel {...ctx} />,
    },
    // Hidden until shown: the month's daily notes as a calendar, a day opening its note.
    month: { title: "Month", names: ["calendar", "month", "daily notes calendar"], heading: false, sort: 37, hidden: true, view: "daily-month",
      flyout: { icon: CalendarRange, width: 280 }, render: (ctx) => <MonthPanel {...ctx} /> },
  },
  views: {
    "daily-note": { icon: CalendarDays, title: () => "Daily note", render: ({ store }) => <DailyView store={store} /> },
    // (the month panel as a tab)
    "daily-month": { icon: CalendarRange, title: () => "Month", render: () => <div className="pb-10"><MonthCalendar tab /></div> },
  },
})
