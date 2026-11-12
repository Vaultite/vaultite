// Pure: tools/test_web.ts checks it in Node.
import type { AgentRun } from "@/core/define"

const RANK: Record<AgentRun["state"], number> = { needs: 0, working: 1, done: 2 }
const KIND: Record<AgentRun["kind"], number> = { terminal: 0, chat: 1, cloud: 2 }

/** The panel's order: needs you, then working, then at rest; the ones at rest newest first, the others oldest first
 *  (as they started: a new one doesn't push the rest down). One session listed by two plugins shows once, the terminal. */
export function orderRuns(list: AgentRun[]): AgentRun[] {
  const best = new Map<string, AgentRun>()
  const key = (r: AgentRun) => `${r.machine ?? ""}/${r.session}`
  for (const r of list) {
    const was = r.session && best.get(key(r))
    if (r.session && (!was || KIND[r.kind] < KIND[was.kind])) best.set(key(r), r)
  }
  return list.filter((r) => !r.session || best.get(key(r)) === r)
    .sort((x, y) => RANK[x.state] - RANK[y.state] || (x.state === "done" ? y.at - x.at : x.at - y.at) || x.id.localeCompare(y.id))
}

/** How long a run that asks nothing stays in the panels' view once it came to rest, before it folds under Earlier,
 *  unless the user set otherwise (the Agents plugin's setting `fold`). */
export const QUIET_AFTER = 5 * 60_000
/** It asks nothing of the user: at rest, nothing unread (an answer, a result ready for review), not failed. */
export const asksNothing = (r: Pick<AgentRun, "state" | "unread" | "failed">) => r.state === "done" && !r.unread && !r.failed

/** It folds under Earlier (the Agents and Terminals panels): it has asked nothing for `after` (null: never) since it came
 *  to rest (never when that's unknown: a terminal's `at` is its start) and no tab shows it (`shown`). */
export function foldsAway(r: AgentRun, now: number, shown: boolean, after: number | null = QUIET_AFTER) {
  const rested = r.since ?? (r.started ? undefined : r.at)
  return after !== null && !shown && asksNothing(r) && rested !== undefined && now - rested > after
}
