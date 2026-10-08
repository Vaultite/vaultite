// Health's cards, also on Today: last night's sleep and today's meals.
import { Apple, Moon } from "lucide-react"
import {
  addDays, Bars, dateText, detailPath, Empty, fmtDay, fmtMin, List, openDetail, Panel, parse, range, Row, snippet,
  Stat, today, type Store,
} from "@vaultite"
import { logsOf } from "@plugins/core/logs/types"

export function SleepPanel({ store, nights = 7 }: { store: Store; nights?: number }) {
  const t = today()
  const logs = logsOf(store, "sleep")
  const last = logs.find((l) => l.date >= addDays(t, -1))
  const days = range(addDays(t, -(nights - 1)), nights)
  const byDate = new Map(logs.map((l) => [l.date, l]))
  const recent = days.map((d) => byDate.get(d)).filter(Boolean)
  const avg = recent.length ? recent.reduce((n, l) => n + (l!.duration_min || 0), 0) / recent.length : 0
  return (
    <Panel title="Sleep" icon={Moon} tint="var(--indigo)">
      {!logs.length ? (
        <Empty>No sleep data yet. Export Apple Health on your iPhone (Health → your photo → Export All Health Data) and send the zip to Claude.</Empty>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4">
            <Stat label={last ? (last.date === t ? "Last night" : fmtDay(last.date)) : "Last night"}
              value={last ? fmtMin(last.duration_min || 0) : "—"}
              hint={last?.data?.bed && `${last.data.bed} → ${last.data.wake}`} />
            <Stat label={`${nights}-night average`} value={avg ? fmtMin(Math.round(avg)) : "—"}
              hint={`${recent.length} of ${nights} nights recorded`} />
          </div>
          <Bars color="var(--indigo)" height={72} goal={8}
            format={(v) => (v ? fmtMin(Math.round(v * 60)) : "no data")}
            data={days.map((d) => ({
              label: dateText(parse(d), { weekday: "narrow" }),
              tip: fmtDay(d),
              value: (byDate.get(d)?.duration_min || 0) / 60,
            }))} />
        </>
      )}
    </Panel>
  )
}

export function NutritionPanel({ store, date = today() }: { store: Store; date?: string }) {
  const meals = logsOf(store, "nutrition").filter((l) => l.date === date).reverse()
  const sum = (k: string) => meals.reduce((n, l) => n + (Number(l.data?.[k]) || 0), 0)
  return (
    <Panel title="Nutrition" icon={Apple} tint="var(--green)">
      {!meals.length ? (
        <Empty>Nothing logged today. Send Claude a photo of what you eat and it'll log calories and protein.</Empty>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-3 gap-4">
            <Stat label="Calories" value={Math.round(sum("kcal")) || "—"} unit="kcal" />
            <Stat label="Protein" value={Math.round(sum("protein")) || "—"} unit="g" />
            <Stat label="Meals" value={meals.length} />
          </div>
          <List>
            {meals.map((l) => (
              <Row key={l.id} title={l.title || l.data?.meal || "Meal"} meta={l.data?.meal && l.title ? l.data.meal : snippet(l.notes)}
                right={[l.data?.kcal && `${l.data.kcal} kcal`, l.data?.protein && `${l.data.protein} g`].filter(Boolean).join(" · ")}
                onOpen={() => openDetail(detailPath("log", l.id))} />
            ))}
          </List>
        </>
      )}
    </Panel>
  )
}

