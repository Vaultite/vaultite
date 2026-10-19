import { useEffect, useRef, useState } from "react"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import { addDays, Button, definePlugin, Empty, FileEditor, fmtDay, Loading, notifyError, op, openFile, Panel, today, useLive, type BlockCtx } from "@vaultite"

/** A day's note, made when there's none yet where daily notes go, named and filled as the settings say (daily-note.open). */
async function openDay(date: string, what: string) {
  try { openFile((await op<{ path: string }>("daily-note.open", { date })).path) } catch (e) { notifyError(e, `Couldn't open ${what} daily note`) }
}

const ISO = /^\d{4}-\d\d-\d\d$/
const dayName = (date: string) => (date === addDays(today(), 1) ? "Tomorrow" : fmtDay(date))
const nav = "grid size-9 cursor-pointer place-items-center rounded-[7px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground md:size-7"

/** ```block-day: a day's note (or its `section`) edited in place, stepping to other days; a missing one is started
 *  only when asked (reading never makes it). */
function DayBlock({ store, options }: BlockCtx) {
  const heading = typeof options.section === "string" ? options.section.trim().replace(/^#+\s*/, "") : ""
  const base = typeof options.date === "string" && ISO.test(options.date) ? options.date : today()
  const [date, setDate] = useState(base)
  useEffect(() => setDate(base), [base])
  const at = useRef<string | null>(null)
  const { data, error } = useLive<{ date: string; path: string; exists: boolean }>(`daily-notes/day?date=${date}`, undefined, (p) => p === at.current)
  const day = data?.date === date ? data : null
  at.current = day?.path ?? null
  // (focused once it's started here, to write in at once)
  const [started, setStarted] = useState<string | null>(null)
  const name = dayName(date)
  const start = async () => {
    try { await op("daily-note.open", { date }); setStarted(date) } catch (e) { notifyError(e, `Couldn't start ${name.toLowerCase()}'s note`) }
  }
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
            <Empty>No note for {name === "Today" || name === "Tomorrow" || name === "Yesterday" ? name.toLowerCase() : name} yet.</Empty>
            <Button look="quiet" size="small" className="-mr-2" onClick={start}>Start it</Button>
          </div>
        )
        : <FileEditor key={day.path} path={day.path} store={store} section={heading || undefined} autoFocus={started === date}
            noSection={<Empty>No {heading} section in this note.</Empty>} />}
    </Panel>
  )
}

export default definePlugin({
  commands: [
    { id: "daily-notes:today", name: "Open today's daily note", keys: ["Mod+Shift+D"], run: () => openDay(today(), "today's"), label: "Daily note" },
    { id: "daily-notes:tomorrow", name: "Open tomorrow's daily note", run: () => openDay(addDays(today(), 1), "tomorrow's"), label: "Daily note" },
  ],
  blocks: { day: (ctx) => <DayBlock {...ctx} /> },
})
