import { useEffect, useRef, useState } from "react"
import { Calendar1, ChevronLeft, ChevronRight } from "lucide-react"
import {
  addDays, Button, Empty, FileEditor, fmtDay, fmtLongDay, HeadingButton, Loading, notifyError, op, openFile, scopedState, SidebarHeading,
  today, useBusy, useLive, useScopedState, type SidebarCtx, type Store,
} from "@vaultite"

export const ISO = /^\d{4}-\d\d-\d\d$/
export const dayName = (date: string) => (date === addDays(today(), 1) ? "Tomorrow" : fmtDay(date))
/** A day's name inside a sentence: "today", "Oct 12". */
export const inSentence = (name: string) => (/^(Today|Yesterday|Tomorrow)$/.test(name) ? name.toLowerCase() : name)
/** "today's", "Oct 12's". */
export const whose = (date: string) => `${inSentence(dayName(date))}'s`
export const nav = "grid size-9 cursor-pointer place-items-center rounded-[7px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground md:size-7"

/** A day's note, made when there's none yet where daily notes go, named and filled as the settings say (daily-note.open). */
export async function openDay(date: string, newTab = false) {
  try { openFile((await op<{ path: string }>("daily-note.open", { date })).path, { newTab }) } catch (e) { notifyError(e, `Couldn't open ${whose(date)} daily note`) }
}

type Day = { date: string; path: string; exists: boolean }
/** A day's note as the server finds it (looking never makes it), and `start`: made as daily-note.open makes it, then
 *  focused (`started`) to write in at once. */
export function useDay(date: string) {
  const at = useRef<string | null>(null)
  const { data, error } = useLive<Day>(`daily-notes/day?date=${date}`, undefined, (p) => p === at.current)
  const day = data?.date === date ? data : null
  at.current = day?.path ?? null
  const [started, setStarted] = useState<string | null>(null)
  const [busy, run] = useBusy()
  const start = () => void run(() => op("daily-note.open", { date }).then(() => setStarted(date), (e) => notifyError(e, `Couldn't start ${whose(date)} note`)))
  // (busy from the press until the note is there to write in)
  return { day, error, start, started: started === date, starting: busy || (started === date && !!day && !day.exists) }
}

/** Today's date, changing at midnight (setting the same date again draws nothing). */
function useToday() {
  const [now, setNow] = useState(today)
  useEffect(() => {
    const id = setInterval(() => setNow(today()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

// The day the panel and its tab show, this device's (a phone browses days of its own): one stepped to stays until the
// date changes, then it's today again.
type Kept = { date: string; on: string } | null
const SHOWN = "daily-notes:shown"
const shown = (kept: Kept, now: string) => (kept?.on === now && ISO.test(kept.date) ? kept.date : now)
/** The day shown now, for the panel's menu. */
export const shownDay = () => shown(scopedState<Kept>(SHOWN, null, "device").get(), today())
function useShownDay() {
  const now = useToday()
  const [kept, keep] = useScopedState<Kept>(SHOWN, null, "device")
  return { date: shown(kept, now), now, show: (date: string) => keep(date === now ? undefined : { date, on: now }) }
}

/** The sidebar panel: the shown day's note, edited in place beside whatever is open; ‹ › step days. */
export const DailyPanel = ({ store, open, flyout }: SidebarCtx) => (open ? <DayPanel store={store} jot={flyout} /> : null)

/** `jot`: opened from the rail, to write in at once. */
function DayPanel({ store, jot }: { store: Store; jot?: boolean }) {
  const { date, now, show } = useShownDay()
  const { day, error, start, started, starting } = useDay(date)
  return (
    <div className="flex shrink-0 flex-col" data-daily-panel={date}>
      <SidebarHeading title={dayName(date)} open>
        {/* (first, so the arrows stay put as it comes and goes) */}
        {date !== now && <HeadingButton icon={Calendar1} label="Today" onClick={() => show(now)} />}
        <HeadingButton icon={ChevronLeft} label="Day before" onClick={() => show(addDays(date, -1))} />
        <HeadingButton icon={ChevronRight} label="Day after" onClick={() => show(addDays(date, 1))} />
      </SidebarHeading>
      {!day ? <p className="h-7 pl-1.5 text-[13px] leading-7 text-tertiary">{error ? "Couldn't find the daily note." : ""}</p>
        : !day.exists ? (
          <button type="button" onClick={start} disabled={starting} aria-busy={starting || undefined} data-daily-start
            className="flex h-7 min-w-0 cursor-pointer items-center truncate pl-1.5 text-left text-[13px] whitespace-nowrap text-tertiary hover:text-muted-foreground disabled:cursor-progress">
            {starting ? <span className="shimmer">Starting {whose(date)} note…</span> : <>No note for {inSentence(dayName(date))} yet. Start it</>}
          </button>
        )
        : <FileEditor key={day.path} path={day.path} store={store} autoFocus={started || jot} className="pr-1 pl-1.5 text-[13px] leading-[1.5]" />}
    </div>
  )
}

/** The panel as a tab (view:daily-note), to keep in a split: the same day, a page's size. */
export function DailyView({ store }: { store: Store }) {
  const { date, now, show } = useShownDay()
  const { day, error, start, started, starting } = useDay(date)
  return (
    <div className="pb-10" data-daily-view={date}>
      <div className="mb-3 flex items-center gap-1">
        <h1 className="min-w-0 flex-1 truncate text-[22px] leading-[28px] font-bold">{fmtLongDay(date)}</h1>
        <button type="button" className={nav} aria-label="Day before" data-tip="Day before" onClick={() => show(addDays(date, -1))}><ChevronLeft className="size-4" strokeWidth={2.5} /></button>
        <Button look="quiet" size="small" className="px-2" disabled={date === now} onClick={() => show(now)}>Today</Button>
        <button type="button" className={nav} aria-label="Day after" data-tip="Day after" onClick={() => show(addDays(date, 1))}><ChevronRight className="size-4" strokeWidth={2.5} /></button>
      </div>
      {!day ? <Loading error={error && "Couldn't find the daily note."} />
        : !day.exists ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Empty>No note for {inSentence(dayName(date))} yet.</Empty>
            <Button look="quiet" size="small" busy={starting} onClick={start}>Start it</Button>
          </div>
        )
        : <FileEditor key={day.path} path={day.path} store={store} autoFocus={started} />}
    </div>
  )
}
