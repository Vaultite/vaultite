import { ListChecks, ScrollText } from "lucide-react"
import { definePlugin, fmtLongDay, fmtMin, numberText, plain, plainText, Stat, today, weekStart, type BlockCtx } from "@vaultite"
import { human, LogFields } from "./LogFields"
import { AreaPanel, WeekGoals } from "./sections"
import { between, fieldText, logsOf, type Log } from "./types"
import { mockLogs } from "./mock"

/** A list option (`areas: [workouts, study]`, or `areas: workouts, study`). */
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",") : []).map((x) => x.trim()).filter(Boolean)
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)

/** ```block-area: an area's weeks and latest sessions; `meta` fields on each row, `total` a field summed this week,
 *  `empty` the text when there's nothing yet. */
function Area({ store, options }: BlockCtx) {
  const slug = str(options.area)
  if (!slug) return <p className="text-[15px] text-muted-foreground">Name the area: area: workouts</p>
  const area = store.areas.find((a) => a.slug === slug)
  const name = area?.name ?? slug
  const field = (k: string) => area?.fields.find((f) => f.key === k)
  const metas = list(options.meta)
  const meta = metas.length ? (l: Log) => metas.map((k) => fieldText(l.data?.[k], field(k)?.unit)).filter(Boolean).join(" · ") : undefined
  const total = str(options.total)
  let stat
  if (total) {
    const f = field(total)
    const t = today()
    const sum = between(logsOf(store, slug), weekStart(t), t).reduce((n, l) => n + (Number(l.data?.[total]) || 0), 0)
    stat = <Stat label={f?.label ?? human(total)} value={f?.unit === "min" ? fmtMin(sum) : numberText(Math.round(sum * 10) / 10)}
      unit={f?.unit && f.unit !== "min" ? f.unit : undefined} hint="This week" />
  }
  return (
    <AreaPanel store={store} slug={slug} meta={meta} stat={stat}
      empty={str(options.empty) ?? `No ${name.toLowerCase()} logged yet. Tell Claude about it and it shows here.`} />
  )
}

export default definePlugin({
  mock: mockLogs,
  blocks: {
    // ```block-log: the fields of the log file it's in.
    log: ({ store, path }) => {
      const l = store.logs.find((x) => `${x.id}.md` === path)
      return l ? <LogFields store={store} log={l} /> : null
    },
    // ```block-week-goals: sessions this week against each area's weekly goal. Options: areas (default: every area with
    // a goal), title.
    "week-goals": ({ store, options }) => {
      const areas = list(options.areas)
      return <WeekGoals store={store} slugs={areas.length ? areas : undefined} title={str(options.title)} />
    },
    area: (ctx) => <Area {...ctx} />,
  },
  // A log is its file (Logs/<Area>/<date> <title>.md): links and old #…/log/… addresses open it.
  details: {
    log: {
      render: () => null,
      title: (s, [id]) => {
        const l = s.logs.find((x) => x.id === id)
        return l ? plain(l.title) || (s.areas.find((a) => a.slug === l.area)?.name ?? "Log") : ""
      },
      file: (s, [id]) => (s.logs.some((x) => x.id === id) ? `${id}.md` : null),
    },
  },
  // A log file: its area and day above the title; ```block-log draws its fields.
  files: {
    types: ["log"], folders: ["Logs"], icon: ScrollText, tint: "var(--muted-foreground)",
    kicker: ({ store, path }) => {
      const l = store.logs.find((x) => `${x.id}.md` === path)
      return l ? `${store.areas.find((a) => a.slug === l.area)?.name ?? "Log"} · ${fmtLongDay(l.date)}` : "Log"
    },
  },
  search: (s) => {
    const area = new Map(s.areas.map((a) => [a.slug, a.name]))
    const t = (x: string) => Date.parse(x) || 0
    return s.logs.filter((l) => l.title).map((l) => ({
      id: `log-${l.id}`, title: plain(l.title), meta: `${area.get(l.area) ?? "Log"} · ${l.date}`, kind: "Log", icon: ListChecks,
      tint: "var(--muted-foreground)", detail: `log/${encodeURIComponent(l.id)}`, file: `${l.id}.md`, text: `${area.get(l.area) ?? ""} ${plainText(l.notes)}`,
      recent: t(l.date), weight: 0,
    }))
  },
  preview: "today",
})
