// When a routine counts as done on a date: ticked by hand (that day's note lists it), or ticked by your data.
import { addDays, haptic, optimistic, post, type Store } from "@vaultite"
import { ticked, type Routine } from "./types"

/** Did a routine tick itself? auto "logs": any log in its area that day. "bed<HH:MM": that night's sleep log began
 *  before HH:MM (sleep logs are dated by wake-up day, so the bedtime belongs to the evening before). */
export function autoDone(s: Store, r: Routine, date: string): boolean {
  if (r.auto === "logs") return s.logs.some((l) => l.area === r.area && l.date === date)
  const m = r.auto?.match(/^bed<(\d\d:\d\d)$/)
  if (m) {
    const night = s.logs.find((l) => l.area === r.area && l.date === addDays(date, 1))
    const bed: string | undefined = night?.data?.bed
    return !!bed && bed >= "12:00" && bed < m[1]
  }
  return false
}

export const routineDone = (s: Store, r: Routine, date: string) => ticked(s, r.id, date) || autoDone(s, r, date)

/** Logs behind a routine on a date: its area's logs that day, or for a bedtime rule the sleep log of that night. */
export const routineLogs = (s: Store, r: Routine, date: string) =>
  r.area == null ? [] : s.logs.filter((l) => l.area === r.area && l.date === (r.auto?.startsWith("bed<") ? addDays(date, 1) : date))

/** Tick or untick by hand: shows at once, then writes Daily/<date>.md. */
export function toggle(routine: string, date: string) {
  haptic()
  let done = false
  return optimistic((s) => {
    done = !ticked(s, routine, date)
    const checks = s.checks.filter((c) => c.routine !== routine || c.date !== date)
    return { ...s, checks: done ? [...checks, { routine, date }] : checks }
  }, () => post("checks", { routine, date, done }), "Couldn't save it")
}

/** What a routine shows as its icon: its own, else its area's ("" for none). */
export const routineIcon = (s: Store, r: Routine) => r.icon || s.areas.find((a) => a.slug === r.area)?.icon || ""

/** How many a week counts as the goal: a routine tied to a weekly area goal (gym 3x) counts against it, else 7. */
export const weeklyTarget = (s: Store, r: Routine) => {
  const area = s.areas.find((a) => a.slug === r.area)
  return r.auto === "logs" && area?.weekly_goal ? area.weekly_goal : 7
}
