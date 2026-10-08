// Health: workouts, sleep and nutrition drawn from the logs (no files of its own): the areas it brings to Logs, and its
// blocks as text.
import { addDays, bullets, type BlockCtx, fmtMin, Plugin, section } from "../../../core/plugins.ts"
import { isArchived, type Item, str } from "../../../core/vault.ts"
import { climbLine, topGrade } from "./climbs.ts"
import { exercises, fmtSet, type GymLog, lifts, splitName } from "./gym.ts"

export const plugin = new Plugin(import.meta.url)

// The areas it draws, for a vault that has no areas setting (and each area's icon and colour, for one that has them
// without): Logs asks every plugin that's on (core/logs/plugin.ts).
plugin.provide("log-areas", () => [
  { slug: "health", name: "Health", icon: "heart", tint: "health" },
  { slug: "workouts", name: "Workouts", icon: "dumbbell", tint: "pink", parent: "health", weekly_goal: 3, blocks: ["workout"], fields: [
    { key: "kind", label: "Kind", type: "text" },
    { key: "place", label: "Place", type: "text" },
    { key: "exercises", label: "Exercises", type: "json" },
    { key: "volume_kg", label: "Volume", type: "number", unit: "kg" },
    { key: "sets", label: "Sets", type: "number" }] },
  { slug: "sleep", name: "Sleep", icon: "moon", tint: "indigo", parent: "health", fields: [
    { key: "bed", label: "Bedtime", type: "text" }, { key: "wake", label: "Wake", type: "text" },
    { key: "in_bed_min", label: "In bed", type: "number", unit: "min" }] },
  { slug: "nutrition", name: "Nutrition", icon: "apple", tint: "green", parent: "health", track_duration: false, fields: [
    { key: "meal", label: "Meal", type: "text" },
    { key: "kcal", label: "Calories", type: "number", unit: "kcal" },
    { key: "protein", label: "Protein", type: "number", unit: "g" },
    { key: "carbs", label: "Carbs", type: "number", unit: "g" },
    { key: "fat", label: "Fat", type: "number", unit: "g" }] },
])

const logs = (area: string) => (plugin.vault.has("logs") ? plugin.vault.items("logs").filter((l) => l.area === area && !isArchived(l)) : [])

function summary(ctx: BlockCtx, slug: string, extra?: (l: Item) => string) {
  const logsPlugin = plugin.peer("logs")
  return logsPlugin ? logsPlugin.exports.areaSummary(slug, ctx.today, null, extra) : ""
}

/** A number the way Python's :g writes it (50.0 -> 50, 42.5 -> 42.5). */
const g = (n: number) => String(Number(n.toPrecision(6)))

function sets(e: Item) {
  return ((e.sets || []) as Item[]).map((s) => {
    const w = s.weight_kg, r = s.reps
    const mark = ({ warmup: "W ", failure: "F ", dropset: "D " } as Record<string, string>)[s.type] ?? ""
    return mark + (w !== undefined && w !== null && r !== undefined && r !== null ? `${g(w)} kg x ${r}` : r !== undefined && r !== null ? `${r} reps` : "set")
  }).join(", ")
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`
/** A session in a few words: its exercises and volume, its climbs, else its kind and place. */
const sessionLine = (l: GymLog) => {
  const n = exercises(l).length
  if (n) return [plural(n, "exercise"), l.data?.volume_kg && `${Math.round(l.data.volume_kg).toLocaleString("en-US")} kg`].filter(Boolean).join(" · ")
  return climbLine(l) || [l.data?.kind, l.data?.place].filter(Boolean).join(" · ")
}

// The same as the card draws (Health.tsx): each session's exercises and volume or climbs; then, when the logs have them,
// each lift's latest top set and the top grade of the last 90 days.
plugin.block("workouts", (ctx) => {
  const area = typeof ctx.options.area === "string" && ctx.options.area ? ctx.options.area : "workouts"
  const all = logs(area) as GymLog[]
  let text = summary(ctx, area, (l) => sessionLine(l as GymLog))
  const rows = lifts(all, ctx.today).map((r) => {
    const [name, kind] = splitName(r.name)
    return `${name}${kind ? ` (${kind})` : ""}: ${fmtSet(r.set)}${r.change ? `, ${r.change.toLowerCase()}` : ""} (${r.date})`
  })
  if (rows.length) text += `\n\nLifts (latest top working set, change vs about 4 weeks earlier):\n${bullets(rows)}`
  const best = all.length ? topGrade(all, addDays(ctx.today, -90)) : null
  return best ? `${text}\n\nTop grade, last 90 days: ${best.grade} (${best.date}).` : text
})

plugin.block("sleep", (ctx) => {
  const t = ctx.today, n = Math.max(1, Math.min(60, Math.trunc(Number(ctx.options.nights || 7))))
  const by = new Map(logs("sleep").map((l) => [l.date, l]))
  const got = Array.from({ length: n }, (_, k) => by.get(addDays(t, -k))).filter((l): l is Item => !!l)
  ctx.source(got)
  const avg = got.length ? got.reduce((s, l) => s + (l.duration_min || 0), 0) / got.length : 0
  const rows = got.map((l) => `${l.date}: ${fmtMin(l.duration_min)}` + (l.data.bed ? ` (${l.data.bed} to ${l.data.wake ?? "None"})` : ""))
  return section("Sleep", `${n}-night average: ${avg ? fmtMin(Math.round(avg)) : "no data"} (${got.length} of ${n} nights recorded).`,
    bullets(rows, "No sleep data."))
})

plugin.block("nutrition", (ctx) => {
  const meals = logs("nutrition").filter((l) => l.date === ctx.today).reverse()
  ctx.source(meals)
  const total = (k: string) => Math.round(meals.reduce((s, l) => s + Number(l.data[k] || 0), 0))
  const rows = meals.map((l) => `${l.data.meal ? l.data.meal + ": " : ""}${l.title || "Meal"}` +
    ([["kcal", "kcal"], ["protein", "g protein"]] as const).filter(([k]) => l.data[k]).map(([k, u]) => `, ${str(l.data[k])} ${u}`).join(""))
  const head = meals.length ? `Today: ${total("kcal")} kcal, ${total("protein")} g protein, ${meals.length} meals.` : ""
  return section("Nutrition", head, bullets(rows, "Nothing logged today."))
})

plugin.block("workout", (ctx) => {
  const l = plugin.vault.has("logs") ? plugin.vault.items("logs").find((x) => x.id + ".md" === ctx.path) : null
  if (!l) return ""
  const ex = (l.data.exercises || []) as Item[]
  const climbs = (l.data.climbs || []) as Item[]
  const parts: string[] = []
  const isRecord = (x: unknown): x is Item => !!x && typeof x === "object" && !Array.isArray(x)
  if (ex.length) parts.push(section("Exercises", bullets(ex.filter(isRecord).map((e) => `${e.name ?? "None"}: ${sets(e)}`))))
  if (climbs.length) {
    parts.push(section("Climbs", bullets(climbs.filter(isRecord).map((c) => [c.grade, c.color, c.note].filter(Boolean).join(" ")))))
  }
  return parts.join("\n\n")
})
