import { useEffect, useState } from "react"
import { CalendarClock, Check } from "lucide-react"
import { cn, currentEditor, definePlugin, get, Loading, notify, notifyError, Panel, put, readFile, today } from "@vaultite"
import { type CalEvent, dayOf, type Entry, eventsOf, hhmm, merged, nextStart, planOf, ticked } from "./plan"

const TINT = "var(--day-planner)"
const HOUR = 48
const EVENT = "var(--blue)"

const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() }

function useNow() {
  const [now, setNow] = useState(nowMinutes)
  useEffect(() => { const t = setInterval(() => setNow(nowMinutes()), 30_000); return () => clearInterval(t) }, [])
  return now
}

function lanes(plan: Entry[]) {
  const out = plan.map(() => ({ lane: 0, of: 1 }))
  let cluster: number[] = [], until = -1
  const close = () => { const n = Math.max(1, ...cluster.map((i) => out[i].lane + 1)); for (const i of cluster) out[i].of = n }
  plan.forEach((e, i) => {
    if (e.start >= until) { close(); cluster = []; until = -1 }
    const busy = new Set(cluster.filter((j) => plan[j].end > e.start).map((j) => out[j].lane))
    let lane = 0
    while (busy.has(lane)) lane++
    out[i].lane = lane
    cluster.push(i)
    until = Math.max(until, e.end)
  })
  close()
  return out
}

const NO_EVENTS = { timed: [] as Entry[], allDay: [] as string[] }
function useEvents(day: string, on: boolean) {
  const [events, setEvents] = useState<typeof NO_EVENTS | null>(on ? null : NO_EVENTS)
  useEffect(() => {
    if (!on) return setEvents(NO_EVENTS)
    let live = true
    get<{ events?: CalEvent[] }>(`day-planner/events?day=${day}`).then((r) => { if (live) setEvents(eventsOf(r.events ?? [], day)) }, () => { if (live) setEvents(NO_EVENTS) })
    return () => { live = false }
  }, [day, on])
  return events
}

async function tick(path: string, e: Entry) {
  try {
    const { text } = await readFile(path)
    const next = ticked(text, e.raw, !e.done, e.nth)
    if (next === null) return notify("That item changed: tick it in the note")
    await put("file", { path, text: next, base: text })
  } catch (err) { notifyError(err, "Couldn't tick it") }
}

function Timeline({ path, body, options, editable }: { path: string; body: string; options: Record<string, unknown>; editable: boolean }) {
  const now = useNow()
  const day = dayOf(path) ?? today()
  const isToday = day === today()
  const cal = useEvents(day, !!path && options.calendar !== false)
  const plan = merged(planOf(body), cal?.timed ?? [])
  const first = plan.length ? Math.floor(plan[0].start / 60) : 8
  const last = plan.length ? Math.ceil(Math.max(...plan.map((e) => e.end)) / 60) : 18
  const from = Math.max(0, Math.min(23, Number.isFinite(Number(options.start)) && options.start !== undefined ? Number(options.start) : Math.min(8, first)))
  const to = Math.max(from + 1, Math.min(24, Number.isFinite(Number(options.end)) && options.end !== undefined ? Number(options.end) : Math.max(18, last)))
  const y = (min: number) => ((min - from * 60) / 60) * HOUR
  const lane = lanes(plan)
  const allDay = !!cal?.allDay.length && (
    <div className="mb-2 flex flex-wrap gap-1" data-plan-all-day>
      {cal.allDay.map((t, i) => <span key={i} className="rounded-[6px] px-2 py-0.5 text-[13px]" style={{ background: `color-mix(in oklab, ${EVENT} 16%, var(--background))` }}>{t}</span>)}
    </div>
  )
  if (!plan.length) {
    if (allDay) return allDay
    if (!cal) return <Loading />
    return <p className="text-[15px] leading-[20px] text-muted-foreground">Nothing planned yet: list items that start with a time, like - 09:00 - 10:00 Standup, show here.</p>
  }
  return (<>
    {allDay}
    <div className="relative" style={{ height: (to - from) * HOUR }} data-day-planner>
      {Array.from({ length: to - from + 1 }, (_, i) => (
        <div key={i} className="absolute right-0 left-0 flex items-start" style={{ top: i * HOUR }}>
          <span className="-mt-[7px] w-12 shrink-0 text-[11px] tabular-nums text-tertiary">{i < to - from ? hhmm((from + i) * 60) : ""}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
      ))}
      {plan.map((e, i) => {
        if (e.end <= from * 60 || e.start >= to * 60) return null
        const top = Math.max(0, y(e.start)), bottom = Math.min((to - from) * HOUR, y(e.end))
        const { lane: l, of } = lane[i]
        const on = isToday && now >= e.start && now < e.end
        const event = e.calendar !== undefined, ink = event ? EVENT : TINT
        return (
          <div key={event ? `event-${i}` : `${e.line}`} data-plan-item={e.text} data-plan-event={event ? "" : undefined}
            data-tip={`${hhmm(e.start)}–${hhmm(e.end)} ${e.text}${event && e.calendar ? ` · ${e.calendar}` : ""}`}
            className={cn("absolute overflow-hidden rounded-[6px] border-l-[3px] px-2 py-0.5 text-[13px] leading-[17px]", e.done ? "opacity-55" : "", on ? "font-medium" : "")}
            style={{ top: top + 1, height: Math.max(18, bottom - top - 2), left: `calc(52px + (100% - 52px) * ${l / of})`, width: `calc((100% - 52px) / ${of} - 3px)`,
              borderColor: ink, background: `color-mix(in oklab, ${ink} ${on ? 26 : 14}%, var(--background))` }}>
            {e.done !== null && editable && (
              <button type="button" role="checkbox" aria-checked={!!e.done} aria-label={e.done ? `Not done: ${e.text}` : `Done: ${e.text}`} data-plan-tick
                onClick={(ev) => { ev.stopPropagation(); void tick(path, e) }}
                className="mr-1.5 inline-grid size-3.5 cursor-pointer place-items-center rounded-[4px] border-[1.5px] align-[-2px] text-background"
                style={{ borderColor: TINT, background: e.done ? TINT : "transparent" }}>{e.done ? <Check className="size-2.5" strokeWidth={3.5} /> : null}</button>
            )}
            <span className={cn(e.done && "line-through")}>{e.text}</span>
            {bottom - top >= 34 && <span className="block text-[11px] tabular-nums text-muted-foreground">{hhmm(e.start)}–{hhmm(e.end)}</span>}
          </div>
        )
      })}
      {isToday && now >= from * 60 && now <= to * 60 && (
        <div className="pointer-events-none absolute right-0 left-12 flex items-center" style={{ top: y(now) - 4 }} data-plan-now aria-label={`Now, ${hhmm(now)}`}>
          <span className="size-2 rounded-full bg-[var(--red)]" />
          <span className="h-[2px] flex-1 bg-[var(--red)]" />
        </div>
      )}
    </div>
  </>)
}

const MOCK = "- [x] 08:30 Run\n- 09:00 - 10:00 Standup and planning\n- [ ] 10:00 - 12:00 Write the launch post\n- 12:30 Lunch with Alice Park\n- 14:00 - 15:30 Design review\n- 14:30 Call the bank\n"

function insertBlock() {
  const ed = currentEditor()
  if (!ed || ed.kind !== "markdown") return notify("Open a note to plan in it")
  const v = ed.view, line = v.state.doc.lineAt(v.state.selection.main.head)
  const item = `- [ ] ${hhmm(nextStart(v.state.doc.toString(), nowMinutes()))} `
  const empty = !line.text.trim()
  const from = empty ? line.from : line.to, insert = empty ? item : `\n${item}`
  v.dispatch({ changes: { from, to: empty ? line.to : line.to, insert }, selection: { anchor: from + insert.length }, userEvent: "input" })
  v.focus()
}

export default definePlugin({
  commands: [{ id: "day-planner:insert", name: "Insert time block", when: () => currentEditor()?.kind === "markdown", run: insertBlock, icon: CalendarClock }],
  blocks: {
    "day-planner": ({ path, body, options, setProperty }) => (
      <Panel title="Day plan" icon={CalendarClock} tint={TINT}><Timeline path={path} body={body} options={options} editable={!!setProperty} /></Panel>
    ),
  },
  preview: () => (
    <Panel title="Day plan" icon={CalendarClock} tint={TINT}><Timeline path="" body={MOCK} options={{ start: 8, end: 16 }} editable={false} /></Panel>
  ),
})
