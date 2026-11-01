// Day planner: a note's timed list items drawn as blocks on a day's hours, side by side where they overlap, with a line
// at the time it is now on the note's own day (a daily note's date, or any note without one).
import { useEffect, useState } from "react"
import { CalendarClock } from "lucide-react"
import { cn, definePlugin, Panel, today } from "@vaultite"
import { dayOf, type Entry, hhmm, planOf } from "./plan"

const TINT = "var(--day-planner)"
const HOUR = 48

const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() }

function useNow() {
  const [now, setNow] = useState(nowMinutes)
  useEffect(() => { const t = setInterval(() => setNow(nowMinutes()), 30_000); return () => clearInterval(t) }, [])
  return now
}

/** Each entry's lane among those it overlaps, and how many lanes its cluster has. */
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

function Timeline({ path, body, options }: { path: string; body: string; options: Record<string, unknown> }) {
  const plan = planOf(body)
  const now = useNow()
  const day = dayOf(path)
  const isToday = !day || day === today()
  const first = plan.length ? Math.floor(plan[0].start / 60) : 8
  const last = plan.length ? Math.ceil(Math.max(...plan.map((e) => e.end)) / 60) : 18
  const from = Math.max(0, Math.min(23, Number.isFinite(Number(options.start)) && options.start !== undefined ? Number(options.start) : Math.min(8, first)))
  const to = Math.max(from + 1, Math.min(24, Number.isFinite(Number(options.end)) && options.end !== undefined ? Number(options.end) : Math.max(18, last)))
  const y = (min: number) => ((min - from * 60) / 60) * HOUR
  const lane = lanes(plan)
  if (!plan.length) {
    return <p className="text-[15px] leading-[20px] text-muted-foreground">Nothing planned yet: list items that start with a time, like - 09:00 - 10:00 Standup, show here.</p>
  }
  return (
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
        return (
          <div key={`${e.line}`} data-plan-item={e.text} data-tip={`${hhmm(e.start)}–${hhmm(e.end)} ${e.text}`}
            className={cn("absolute overflow-hidden rounded-[6px] border-l-[3px] px-2 py-0.5 text-[13px] leading-[17px]", e.done ? "opacity-55" : "", on ? "font-medium" : "")}
            style={{ top: top + 1, height: Math.max(18, bottom - top - 2), left: `calc(52px + (100% - 52px) * ${l / of})`, width: `calc((100% - 52px) / ${of} - 3px)`,
              borderColor: TINT, background: `color-mix(in oklab, ${TINT} ${on ? 26 : 14}%, var(--background))` }}>
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
  )
}

const MOCK = "- [x] 08:30 Run\n- 09:00 - 10:00 Standup and planning\n- [ ] 10:00 - 12:00 Write the launch post\n- 12:30 Lunch with Alice Park\n- 14:00 - 15:30 Design review\n- 14:30 Call the bank\n"

export default definePlugin({
  blocks: {
    // ```block-day-planner: the note's plan.
    "day-planner": ({ path, body, options }) => (
      <Panel title="Day plan" icon={CalendarClock} tint={TINT}><Timeline path={path} body={body} options={options} /></Panel>
    ),
  },
  preview: () => (
    <Panel title="Day plan" icon={CalendarClock} tint={TINT}><Timeline path="" body={MOCK} options={{ start: 8, end: 16 }} /></Panel>
  ),
})
