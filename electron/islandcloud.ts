import { agentTint } from "../core/agenttint.ts"
import { DONE_MS, type Presence, type PresenceState } from "../core/desktop/knocks.ts"
import type { CloudSession } from "./cloud.ts"

const ASKED_MS = 3 * 86_400_000, REVIEW_MS = 7 * 86_400_000

function stateOf(c: CloudSession, now: number): PresenceState | null {
  if (c.state === "waiting") return "needs you"
  if (c.state === "running") return "working"
  const age = now - c.updated
  if (c.unread && c.outcome === "input" && age < ASKED_MS) return "needs you"
  if (c.unread && c.outcome === "review" && age < REVIEW_MS) return "ready"
  return age < DONE_MS ? "done" : null
}

const pageOf = (c: CloudSession) => `view:web/${c.profile.startsWith("c-") ? `@${c.profile.slice(2)}/` : ""}${c.url}`

export function cloudPresences(list: CloudSession[], served: Presence[], settled: Record<string, number>, now: number): Presence[] {
  const had = new Set(served.map((p) => p.id))
  return list.flatMap((c) => {
    const id = `cloud:${c.id}`, state = stateOf(c, now)
    if (!state || had.has(c.id) || (settled[id] ?? 0) >= c.updated) return []
    const p: Presence = { id, who: c.title, tint: agentTint(c.id), state, since: c.updated, link: pageOf(c), agent: "claude", where: c.remote ? "Remote Control" : "Cloud" }
    if (c.summary) p.step = c.summary
    return [p]
  })
}
