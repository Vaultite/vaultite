// Health's workouts card, ```block-workouts: an area's sessions, with each lift's latest top set and the top grade when its
// logs have them (a link if the area has one). Sleep and nutrition are in sections.tsx; pages/Health.md puts them together.
import { addDays, detailPath, fmtDay, List, numberText, openDetail, Row, Section, Stat, today, type Store } from "@vaultite"
import { logsOf, type Log } from "@plugins/core/logs/types"
import { AreaPanel } from "@plugins/core/logs/sections"
import { exercises, fmtSet, lifts, splitName } from "./gym"
import { climbLine, topGrade } from "./climbs"

/** A session in a few words: its exercises and volume, its climbs, else its kind and place. */
const meta = (l: Log) => {
  const n = exercises(l).length
  if (n) return [`${n} ${n === 1 ? "exercise" : "exercises"}`, l.data?.volume_kg && `${numberText(Math.round(l.data.volume_kg))} kg`].filter(Boolean).join(" · ")
  const place = l.data?.place && l.data.place !== l.title ? l.data.place : null
  return [l.data?.kind, place, climbLine(l)].filter(Boolean).join(" · ")
}

function Lifts({ logs }: { logs: Log[] }) {
  const rows = lifts(logs, today())
  if (!rows.length) return null
  return (
    <Section title="Lifts" className="mt-4">
      <List>
        {rows.map((r) => {
          const [name, kind] = splitName(r.name)
          return (
            <Row key={r.name} title={name} meta={[kind, fmtDay(r.date)].filter(Boolean).join(" · ")}
              onOpen={() => openDetail(detailPath("log", r.log.id))}
              right={
                <div className="text-right">
                  <div className="num text-[15px] text-foreground">{fmtSet(r.set)}</div>
                  {r.change && <div className="num text-[12px]" style={{ color: r.better ? "var(--green)" : undefined }}>{r.change}</div>}
                </div>
              } />
          )
        })}
      </List>
      <p className="mt-1 text-[12px] text-muted-foreground">Latest top working set, change vs about 4 weeks earlier.</p>
    </Section>
  )
}

export function WorkoutsPanel({ store, area }: { store: Store; area: string }) {
  const logs = logsOf(store, area)
  const best = topGrade(logs, addDays(today(), -90))
  return (
    <AreaPanel store={store} slug={area} meta={meta} empty="No workouts yet. Tell Claude about one, or import them (Hevy, Apple Health)."
      stat={best && <Stat label="Top grade" value={best.grade} hint={`${fmtDay(best.date)}, last 90 days`} />}>
      <Lifts logs={logs} />
    </AreaPanel>
  )
}
