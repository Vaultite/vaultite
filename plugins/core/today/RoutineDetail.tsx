// A routine's sheets: one date (how it got ticked, the logs behind it) and its history (8 weeks, streak).
import { ListChecks } from "lucide-react"
import {
  addDays, cn, detailPath, dow, fmtDay, fmtLongDay, fmtMin, Group, KV, List, namedIcon, notifyError, openDetail, pickIcon, range, Row,
  Section, setProperty, SheetHead, Stat, today, WeeksGrid, weekStart, type Store,
} from "@vaultite"
import { autoDone, routineDone, routineIcon, routineLogs, toggle, weeklyTarget } from "./routines"
import { ticked, type Routine } from "./types"

/** A log (Logs' type: Today only enhances Logs, so it reads it off the store). */
type Log = Store["logs"][number]

function LogRow({ l }: { l: Log }) {
  return <Row title={l.title || fmtDay(l.date)} meta={fmtDay(l.date)} right={l.duration_min ? fmtMin(l.duration_min) : undefined}
    onOpen={() => openDetail(detailPath("log", l.id))} />
}

/** A routine on one date: how it got ticked and the logs behind it. */
export function RoutineDay({ store, r, date }: { store: Store; r: Routine; date: string }) {
  const area = store.areas.find((a) => a.slug === r.area)
  const auto = autoDone(store, r, date)
  const manual = ticked(store, r.id, date)
  const logs = routineLogs(store, r, date)
  const bed = r.auto?.match(/^bed<(.*)$/)?.[1]
  const status = auto
    ? bed ? `Done automatically: in bed at ${logs[0]?.data?.bed}` : `Done automatically, from your ${area?.name ?? ""} log`
    : manual ? "Done, ticked by you" : "Not done"
  const canTick = !auto && date <= today() && r.days.includes(String(dow(date)))
  return (
    <>
      <SheetHead icon={ListChecks} tint="var(--primary)" kicker="Routine" title={r.name} sub={fmtLongDay(date)} />
      <div className="space-y-5">
        <Group>
          <KV label="Status"><span className={cn(auto || manual ? "text-[var(--green)]" : "")}>{status}</span></KV>
          {bed && !auto && logs[0]?.data?.bed && <KV label="Bedtime">{logs[0].data.bed}, target before {bed}</KV>}
        </Group>
        {canTick && (
          <button type="button" onClick={() => toggle(r.id, date)}
            className="h-11 w-full cursor-pointer rounded-[10px] bg-foreground/[0.06] text-[15px] font-medium text-primary transition hover:bg-foreground/10">
            {manual ? "Mark as not done" : "Mark as done"}
          </button>
        )}
        {!!logs.length && (
          <Section title={bed ? "That night" : "Logged that day"}>
            <List>{logs.map((l) => <LogRow key={l.id} l={l} />)}</List>
          </Section>
        )}
        <button type="button" onClick={() => openDetail(detailPath("routine", r.id))} className="cursor-pointer text-[15px] text-primary hover:underline">
          Routine history
        </button>
      </div>
    </>
  )
}

/** A routine over time: 8 weeks of ticks, streak, and recent logs in its area. */
export function RoutineHistory({ store, r }: { store: Store; r: Routine }) {
  const t = today()
  const area = store.areas.find((a) => a.slug === r.area)
  const target = weeklyTarget(store, r)
  const applies = (d: string) => r.days.includes(String(dow(d)))
  const count = (ws: string) => range(ws, 7).filter((d) => d <= t && routineDone(store, r, d)).length
  // Daily routines count days in a row; ones with a weekly goal (gym 3x) count weeks at goal.
  let streak = 0
  if (target < 7) {
    for (let w = count(weekStart(t)) >= target ? weekStart(t) : addDays(weekStart(t), -7); streak < 60 && count(w) >= target; w = addDays(w, -7)) streak++
  } else {
    for (let d = routineDone(store, r, t) ? t : addDays(t, -1); streak < 400; d = addDays(d, -1)) {
      if (!applies(d)) continue
      if (!routineDone(store, r, d)) break
      streak++
    }
  }
  const unit = target < 7 ? (streak === 1 ? "week" : "weeks") : streak === 1 ? "day" : "days"
  const week = count(weekStart(t))
  const logs = area ? store.logs.filter((l) => l.area === area.slug).slice(0, 5) : []
  const rule = r.auto === "logs" ? `Ticks itself when a ${area?.name} log comes in` : r.auto?.startsWith("bed<") ? `Ticks itself when you're in bed before ${r.auto.slice(4)}` : null
  return (
    <>
      <SheetHead icon={namedIcon(routineIcon(store, r)) ?? ListChecks} tint="var(--primary)" kicker="Routine" title={r.name} sub={rule ?? area?.name} />
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Stat label={target < 7 ? "Weeks at goal" : "Current streak"} value={streak} unit={unit} />
          <Stat label="This week" value={`${week}/${target}`} />
        </div>
        <WeeksGrid weeks={8} tint="var(--primary)" goal={target === 7 ? null : target}
          tip={(d) => (routineDone(store, r, d) ? (autoDone(store, r, d) ? "done, from your data" : "done") : null)}
          onOpen={(d) => openDetail(detailPath("routine", r.id, d))} />
        {!!logs.length && (
          <Section title={`Recent ${area?.name.toLowerCase()}`}>
            <List>{logs.map((l) => <LogRow key={l.id} l={l} />)}</List>
          </Section>
        )}
        <button type="button" className="cursor-pointer text-[15px] text-primary hover:underline"
          onClick={() => pickIcon({ title: "Routine icon", current: r.icon || undefined, onPick: (n) => { setProperty(`${r.id}.md`, "icon", n).catch(notifyError) } })}>
          Change icon
        </button>
      </div>
    </>
  )
}
