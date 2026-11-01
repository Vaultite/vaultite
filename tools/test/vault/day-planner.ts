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

  const { ticked } = await import("../../../plugins/core/day-planner/plan.ts")
  const note = "# Day\n\n- [ ] 09:00 Standup\n- [x] 10:00 Email\n- 11:00 Walk\n"
  const p2 = planOf(note)
  check("day planner tick: an item's line ticked and unticked, by its text", ticked(note, p2[0].raw, true) === note.replace("- [ ] 09:00", "- [x] 09:00") &&
    ticked(note, p2[1].raw, false) === note.replace("- [x] 10:00", "- [ ] 10:00") && ticked(note, p2[2].raw, true) === null && ticked("changed\n", p2[0].raw, true) === null)

  const { eventsOf, merged } = await import("../../../plugins/core/day-planner/plan.ts")
  const day = "2026-10-05"
  const ev = eventsOf([
    { title: "Standup", start: `${day}T09:15:00`, end: `${day}T09:30:00`, all_day: false, calendar: "Work" },
    { title: "Flight", start: "2026-10-04T22:00:00", end: `${day}T02:00:00`, all_day: false, calendar: "" },
    { title: "Offsite", start: day, end: "2026-10-06", all_day: true, calendar: "Work" },
    { title: "Yesterday", start: "2026-10-04", end: day, all_day: true, calendar: "" },
    { title: "Tomorrow", start: "2026-10-06T10:00:00", end: "2026-10-06T11:00:00", all_day: false, calendar: "" },
  ], day)
  check("day planner calendar: the day's timed events (one from the night before cut to midnight), its all-day ones", ev.timed.map((e) => `${e.start}-${e.end} ${e.text}`).join("|") === "0-120 Flight|555-570 Standup" &&
    ev.allDay.join() === "Offsite", ev)
  const both = merged(planOf("- 09:00 Plan\n"), ev.timed)
  check("day planner calendar: beside the note's items, in order, named as events in the text", planText(both, null, ev.allDay) === "All day: Offsite\n\n- 00:00–02:00 Flight (calendar)\n- 09:00–09:30 Plan\n- 09:15–09:30 Standup (calendar: Work)", planText(both, null, ev.allDay))
  const [es, eb] = await api("GET", "day-planner/events?day=2026-10-05")
  check("day planner calendar: the route answers the day's events (none here: no calendars)", es === 200 && Array.isArray(eb.events) && eb.events.length === 0, eb)
  // Fixes: 24:00 as an end, a fence closed only by its own mark, the right twin ticked.
  check("day planner: 24:00 ends the day", planOf("- 22:00 - 24:00 Party\n")[0].end === 1440)
  check("day planner: a ```js line inside a ```` block is code", planOf("````\n```js\n- 09:00 In code\n````\n- 10:00 Real\n").map((e) => e.text).join() === "Real")
  const twins = "## Mon\n- [ ] 09:00 Standup\n## Tue\n- [ ] 09:00 Standup\n"
  const tue = planOf(twins).find((e) => e.line === 3)!
  check("day planner tick: the item ticked, not an earlier one that reads the same", ticked(twins, tue.raw, true, tue.nth) === "## Mon\n- [ ] 09:00 Standup\n## Tue\n- [x] 09:00 Standup\n")
  const { nextStart } = await import("../../../plugins/core/day-planner/plan.ts")
  check("day planner insert: after the note's last block, else at the next half hour", nextStart("- 09:00 - 10:15 Standup\n- 13:00 Lunch\n", 9 * 60 + 5) === 13 * 60 + 30 &&
    nextStart("", 9 * 60 + 5) === 9 * 60 + 30 && nextStart("- 08:00 Run\n", 9 * 60) === 9 * 60 && nextStart("", 23 * 60 + 50) === 23 * 60 + 30)
}

