// What Today keeps in the store (/api/state's `routines` and `checks`, from its plugin.ts).
import type { Store } from "@vaultite"

/** days: weekdays it applies to ("0123456", 0 = Monday). auto: "logs" (any log in its area that day) or "bed<22:00". */
export type Routine = { id: string; name: string; area: string | null; days: string; sort: number; auto: string; notes: string
  /** Its icon (a Lucide name or an emoji); none: its area's (routineIcon). */
  icon?: string
  /** Its file has `archived: true` (the core's, on every item: isArchived from "@vaultite"). */
  archived?: boolean }
/** A routine ticked by hand on a date (listed in that day's Daily/<date>.md). */
export type Check = { routine: string; date: string }

declare module "@vaultite" {
  interface PluginState {
    routines: Routine[]
    checks: Check[]
  }
}

// The ticks as "<routine id>|<date>", made once per list (the store replaces the list when it changes).
const sets = new WeakMap<Check[], Set<string>>()
/** Did the user tick this routine by hand on this date? */
export function ticked(s: Store, routine: string, date: string) {
  let set = sets.get(s.checks)
  if (!set) sets.set(s.checks, (set = new Set(s.checks.map((c) => `${c.routine}|${c.date}`))))
  return set.has(`${routine}|${date}`)
}
