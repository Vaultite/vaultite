// Log cards other plugins build on (Health, Learning, Work require Logs): an area's weeks and recent sessions, and
// this week against each area's goal (also on Today).
import type { ReactNode } from "react"
import { ArrowUpRight, Target } from "lucide-react"
import {
  detailPath, Empty, fmtDay, fmtMin, List, openDetail, Panel, plain, Ring, Row, Section, snippet, Stat, today, WeeksGrid,
  weekStart, type Store,
} from "@vaultite"
import { areaBySlug, between, logsOf, minutes, sessionDays, type Log } from "./types"
import { areaStyle } from "./areas"

/** Sessions this week against each area's weekly goal (default: every area that has one). */
export function WeekGoals({ store, slugs, title = "This week" }: { store: Store; slugs?: string[]; title?: string }) {
  const t = today()
  const ws = weekStart(t)
  const items = (slugs ?? store.areas.filter((a) => a.weekly_goal).map((a) => a.slug)).map((s) => areaBySlug(store, s)).filter((a) => a && !a.archived)
  return (
    <Panel title={title} icon={Target} tint="var(--today)">
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        {items.map((a) => {
          const logs = between(logsOf(store, a!.slug), ws, t)
          const n = sessionDays(logs)
          const goal = a!.weekly_goal
          const mins = logs.reduce((s, l) => s + (l.duration_min || 0), 0)
          return (
            <div key={a!.slug} className="flex items-center gap-3">
              {goal ? <Ring value={n} goal={goal} color={n >= goal ? "var(--green)" : "var(--primary)"} /> : <span className="num grid size-11 shrink-0 place-items-center rounded-full border-[5px] border-muted text-[15px] font-semibold">{n}</span>}
              <div className="min-w-0">
                <div className="text-[15px] font-medium">{a!.name}</div>
                <div className="text-[13px] text-muted-foreground tabular-nums">
                  {goal ? `${n} of ${goal}` : `${n} ${n === 1 ? "session" : "sessions"}`}{mins ? ` · ${fmtMin(mins)}` : ""}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

/** An area's recent weeks as a presence grid, plus its latest sessions. Rows and dots open the log's detail sheet. */
export function AreaPanel({
  store, slug, empty, meta, className, action, stat, children,
}: {
  store: Store; slug: string; empty: ReactNode; meta?: (l: Log) => ReactNode; className?: string
  action?: ReactNode; stat?: ReactNode; children?: ReactNode
}) {
  const area = areaBySlug(store, slug)
  const { icon, tint } = areaStyle(area)
  const logs = logsOf(store, slug)
  const thisWeek = between(logs, weekStart(today()), today())
  const useTime = area?.track_duration !== false
  const days = sessionDays(thisWeek)
  // (by day once: the grid asks for every day of its weeks)
  const byDay = new Map<string, Log[]>()
  for (const l of logs) { const on = byDay.get(l.date); if (on) on.push(l); else byDay.set(l.date, [l]) }
  const onDay = (d: string) => byDay.get(d) ?? []
  return (
    <Panel title={area?.name ?? slug} icon={icon} tint={tint} className={className} action={action ?? (area?.link ? <AreaLink {...area.link} /> : undefined)}>
      {!logs.length ? (
        <Empty>{empty}</Empty>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4">
            <Stat label="This week" value={useTime ? fmtMin(minutes(thisWeek)) : thisWeek.length}
              hint={`${days} ${days === 1 ? "day" : "days"}${area?.weekly_goal ? ` of ${area.weekly_goal}` : ""}`} />
            {stat ?? <Stat label="Last session" value={fmtDay(logs[0].date)} hint={plain(logs[0].title) || undefined} />}
          </div>
          <WeeksGrid tint={tint} goal={area?.weekly_goal}
            tip={(d) => onDay(d).map((l) => [plain(l.title || "Session"), l.duration_min && fmtMin(l.duration_min)].filter(Boolean).join(", ")).join("; ") || null}
            onOpen={(d) => openDetail(detailPath("log", onDay(d)[0].id))} />
          {children}
          <Section title="Recent" className="mt-4">
            <List>
              {logs.slice(0, 5).map((l) => (
                <Row key={l.id} title={l.title || fmtDay(l.date)}
                  meta={[l.title ? fmtDay(l.date) : null, meta?.(l)].filter(Boolean).join(" · ") || snippet(l.notes)}
                  right={l.duration_min ? fmtMin(l.duration_min) : undefined}
                  onOpen={() => openDetail(detailPath("log", l.id))} />
              ))}
            </List>
          </Section>
        </>
      )}
    </Panel>
  )
}

/** An area's `link` setting (e.g. a gym's booking app), top right of its card. */
function AreaLink({ label, url }: { label: string; url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className="-my-1 flex items-center gap-0.5 rounded-full px-2 py-1 text-[13px] font-medium text-primary transition hover:bg-foreground/[0.05]">
      {label}<ArrowUpRight className="size-3.5" strokeWidth={2.25} />
    </a>
  )
}
