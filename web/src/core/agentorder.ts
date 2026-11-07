// The Agents panel's order (core/agentruns.tsx): pure, so tools/test_web.ts checks it.
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
