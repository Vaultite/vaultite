// A workout's exercises: data.exercises = [{ name, sets: [{ type, weight_kg, reps }] }] (Hevy's lbs arrive as kg).
// Shared by the app (Health.tsx) and the server (plugin.ts: the workouts block as text), so it imports nothing.

/** What this needs of a log: the app's Log and the server's item both are one. */
export type GymLog = { id: string; date: string; data?: Record<string, any> | null }
/** YYYY-MM-DD plus n days. */
const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

export type GymSet = { type?: string; weight_kg?: number; reps?: number; distance_km?: number; duration_s?: number }
export type Exercise = { name: string; sets: GymSet[] }

export const exercises = (l: GymLog): Exercise[] => l.data?.exercises ?? []
export const kg = (w: number) => Math.round(w * 2) / 2
/** Assisted machines: the weight is help, so less is better. */
export const assisted = (name: string) => /assisted/i.test(name)

/** Heaviest working set (least help for assisted lifts), most reps on ties. Warmups don't count. */
export function topSet(e: Exercise): GymSet | null {
  const sign = assisted(e.name) ? -1 : 1
  const score = (s: GymSet) => [sign * kg(s.weight_kg ?? 0), s.reps ?? 0]
  return e.sets.filter((s) => s.type !== "warmup").reduce<GymSet | null>((best, s) => {
    if (!best) return s
    const [a, b] = [score(s), score(best)]
    return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]) ? s : best
  }, null)
}

export const fmtSet = (s: GymSet) =>
  s.weight_kg ? `${kg(s.weight_kg)} kg × ${s.reps ?? 0}` : s.reps ? `${s.reps} reps` : s.duration_s ? `${Math.round(s.duration_s)} s` : "—"

/** "Bench Press (Barbell)" → ["Bench Press", "Barbell"]. */
export const splitName = (n: string): [string, string | undefined] => {
  const m = n.match(/^(.*?)\s*\(([^)]*)\)\s*$/)
  return m ? [m[1], m[2]] : [n, undefined]
}

export type Lift = { name: string; date: string; set: GymSet; change: string | null; better: boolean | null; log: GymLog }

/** The exercises done most often in the last `weeks` weeks, each with its latest top set and the change over ~4 weeks. */
export function lifts(logs: GymLog[], t: string, n = 6, weeks = 8): Lift[] {
  const since = addDays(t, -7 * weeks)
  const count = new Map<string, number>()
  for (const l of logs) if (l.date >= since) for (const e of exercises(l)) count.set(e.name, (count.get(e.name) ?? 0) + 1)
  const names = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name]) => name)
  return names.map((name) => {
    // logs are newest first
    const history = logs.flatMap((l) => {
      const e = exercises(l).find((x) => x.name === name)
      const s = e && topSet(e)
      return s ? [{ date: l.date, set: s, log: l }] : []
    })
    const [last] = history
    const prev = history.find((h) => h.date <= addDays(last.date, -21) && h.date >= addDays(last.date, -56))
    let change: string | null = null
    let better: boolean | null = null
    // Only compare like with like: an assisted set logged without its weight isn't "no help".
    if (prev && !prev.set.weight_kg === !last.set.weight_kg) {
      const dw = kg(last.set.weight_kg ?? 0) - kg(prev.set.weight_kg ?? 0)
      const dr = (last.set.reps ?? 0) - (prev.set.reps ?? 0)
      if (dw) { change = `${dw > 0 ? "+" : "−"}${Math.abs(dw)} kg`; better = assisted(name) ? dw < 0 : dw > 0 }
      else if (dr) { change = `${dr > 0 ? "+" : "−"}${Math.abs(dr)} reps`; better = dr > 0 }
      else change = "Same"
    }
    return { name, date: last.date, set: last.set, change, better, log: last.log }
  })
}
