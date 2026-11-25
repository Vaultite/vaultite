import { useMemo, useSyncExternalStore } from "react"
import { parseTerminal, useAccountNames, useAgents, type AgentFeed, type AgentRun } from "@vaultite"
import { agentIn, getSessions, retrySessions, runOf, subscribeSessions } from "./sessions"
import { menuOf } from "./SessionsPanel"

export function useTerminalRuns(): AgentFeed {
  const { list, refused, lost } = useSyncExternalStore(subscribeSessions, getSessions)
  const agents = useAgents()
  const accountName = useAccountNames()
  const runs = useMemo(() => {
    if (refused) return []
    if (!list) return lost ? [] : null
    return list.flatMap((s): AgentRun[] => {
      const a = agentIn(s, agents), run = runOf(s, a)
      if (!run || (s.external && !s.clients)) return []
      const t = parseTerminal(s.id)
      const account = accountName(a!.name, s.machine ?? "", s.account ?? (t?.agent === a!.name ? t.profile : null) ?? undefined)
      return [{ ...run, ...(account ? { account } : {}), menu: () => menuOf(s, a) }]
    })
  }, [list, refused, lost, agents, accountName])
  return useMemo(() => ({ runs, unreachable: lost ? "the terminals" : undefined, retry: retrySessions }), [runs, lost])
}
