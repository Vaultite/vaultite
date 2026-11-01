// Day planner's block as text: the note's timed items as the day's plan, the one going on now marked.
import { Plugin } from "../../../core/plugins.ts"
import { dayOf, planOf, planText } from "./plan.ts"

export const plugin = new Plugin(import.meta.url)

plugin.block("day-planner", (ctx) => {
  const day = dayOf(ctx.path)
  const d = new Date()
  return planText(planOf(ctx.body), !day || day === ctx.today ? d.getHours() * 60 + d.getMinutes() : null)
})
