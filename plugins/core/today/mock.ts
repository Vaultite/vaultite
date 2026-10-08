// Plugin previews (Plugins → a plugin): the vault's real routines (configuration, not personal data), ticked on made-up
// days.
import { addDays, today, type Store } from "@vaultite"
import type { Check } from "./types"

export function mockRoutines(real: Store): Partial<Store> {
  const d = (n: number) => addDays(today(), -n)
  const checks: Check[] = []
  real.routines.forEach((r, i) => { for (let n = 0; n < 7; n++) if ((n + i) % 3) checks.push({ routine: r.id, date: d(n) }) })
  return { routines: real.routines, checks }
}
