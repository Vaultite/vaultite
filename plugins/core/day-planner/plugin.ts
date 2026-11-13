import { Plugin } from "../../../core/plugins.ts"
import { type CalEvent, dayOf, eventsOf, merged, planOf, planText } from "./plan.ts"

export const plugin = new Plugin(import.meta.url)

async function events(day: string): Promise<CalEvent[]> {
  if (!plugin.host.catalog().some((o) => o.id === "calendar.events")) return []
  try { return ((await plugin.runOp("calendar.events", { from: day })).result as { events?: CalEvent[] }).events ?? [] } catch { return [] }
}

plugin.route("GET", "day-planner/events", async (req) => {
  const day = /^\d{4}-\d\d-\d\d$/.test(req.query.day ?? "") ? req.query.day : null
  return { events: day ? await events(day) : [] }
})

plugin.block("day-planner", async (ctx) => {
  const day = dayOf(ctx.path) ?? ctx.today
  const d = new Date()
  const cal = eventsOf(ctx.options.calendar !== false ? await events(day) : [], day)
  return planText(merged(planOf(ctx.body), cal.timed), day === ctx.today ? d.getHours() * 60 + d.getMinutes() : null, cal.allDay)
})
