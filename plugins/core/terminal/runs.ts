// The Agents panel's terminals: each session running a coding agent, from the one live list (sessions.ts).
import { useMemo, useSyncExternalStore } from "react"
import { useAgents, type AgentRun } from "@vaultite"
import { agentIn, getSessions, labelOf, needsYou, subscribeSessions } from "./sessions"
import { menuOf } from "./SessionsPanel"
import { agentTint } from "../../../core/agenttint.ts"

export function useTerminalRuns(): AgentRun[] | null {
  const { list, refused } = useSyncExternalStore(subscribeSessions, getSessions)
  const agents = useAgents()
  return useMemo(() => {
    if (refused) return []
    if (!list) return null
    return list.flatMap((s): AgentRun[] => {
      const a = agentIn(s, agents)
      // (another program's own pane, a herdr one, only while a tab shows it: as the Terminals panel)
      if (!a || (s.external && !s.clients)) return []
      const needs = needsYou(s, a)
      return [{
        id: `terminal:${s.id}`, kind: "terminal", title: labelOf(s, a), step: s.progress || s.msg || undefined,
        state: needs ? "needs" : s.state === "working" || s.starting ? "working" : "done", failed: s.state === "error", unread: !!s.needs && s.state !== "blocked",
        machine: s.machine, where: s.machineLabel, agent: a.label, tint: `var(--${agentTint(s.id)})`, session: s.session, at: s.started, started: true,
        to: `view:terminal/${s.id}`, menu: () => menuOf(s, a),
      }]
    })
  }, [list, refused, agents])
}
