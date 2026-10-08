// Climbing sessions: data.climbs = [{ grade, note?, color? }], or only data.top_grade. Shared by the app (Health.tsx)
// and the server (plugin.ts: the workouts block as text), so it imports nothing.
import type { GymLog } from "./gym.ts"

export type Climb = { grade: string; note?: string; color?: string }
export const climbs = (l: GymLog): Climb[] => (Array.isArray(l.data?.climbs) ? l.data.climbs : [])
/** V-scale as a number ("VB" = -1), for picking the top grade. */
export const gradeNum = (g?: string) => (!g ? -Infinity : /^vb$/i.test(g) ? -1 : Number(g.match(/\d+/)?.[0] ?? -Infinity))
/** The highest of some grades. */
export const topOf = (grades: (string | undefined)[]) =>
  grades.reduce<string | undefined>((best, g) => (g && (!best || gradeNum(g) > gradeNum(best)) ? g : best), undefined)

/** A session in a few words: "V3" (one climb), "4 climbs, top V5", or "top V5" (only a top grade logged). */
export function climbLine(l: GymLog) {
  const cs = climbs(l).filter((c) => c?.grade)
  if (cs.length === 1) return cs[0].grade
  if (cs.length) return `${cs.length} climbs, top ${topOf(cs.map((c) => c.grade))}`
  return l.data?.top_grade ? `top ${l.data.top_grade}` : ""
}

/** The best grade in the logs since a date, and the day it was climbed. */
export function topGrade(logs: GymLog[], since: string) {
  let best: { grade: string; date: string } | null = null
  for (const l of logs) {
    if (l.date < since) continue
    for (const g of [l.data?.top_grade, ...climbs(l).map((c) => c.grade)])
      if (g && (!best || gradeNum(g) > gradeNum(best.grade))) best = { grade: String(g), date: l.date }
  }
  return best
}
