import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check, write } = $
  // Day planner (plugins/core/day-planner): a note's timed items as a plan, and its block as text.
  const { planOf, planText, dayOf } = await import("../../../plugins/core/day-planner/plan.ts")
  const plan = planOf("- [x] 08:30 Run\n- 9:00 - 10:30 Standup\n- [ ] 14:00 Lunch\n* 12:00 to 12:45 Walk\n```\n- 11:00 not this\n```\n- 25:00 Nope\n- 16:00\n- 15:00 Last\n")
  check("day planner: timed items in order, ends from their own, the next start, or 30 minutes", plan.map((e) => `${e.start}-${e.end} ${e.text}${e.done === null ? "" : e.done ? " x" : " o"}`).join("|") ===
    "510-540 Run x|540-630 Standup|720-765 Walk|840-900 Lunch o|900-930 Last", plan)
  check("day planner: as text, the item going on marked", planText(plan, 545).split("\n")[1] === "- 09:00–10:30 Standup **(now)**" && !planText(plan, null).includes("now"), planText(plan, 545))
  check("day planner: a daily note's date", dayOf("Daily/2026-10-05.md") === "2026-10-05" && dayOf("Notes/Plan.md") === null)

  write("Daily/2020-01-02.md", "# Plan\n\n```block-day-planner\n```\n\n- [ ] 09:00 - 10:00 Standup\n- 13:00 Gym\n")
  const [st, out] = await api("GET", "render?path=Daily/2020-01-02.md")
  check("day planner block: rendered as the plan (another day: no now)", st === 200 && String(out).includes("- 09:00–10:00 Standup\n- 13:00–13:30 Gym") && !String(out).includes("(now)"), out)
}
