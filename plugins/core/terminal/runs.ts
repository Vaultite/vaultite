import { useMemo, useSyncExternalStore } from "react"
import { parseTerminal, useAccountNames, useAgents, type AgentRun } from "@vaultite"
import { agentIn, getSessions, runOf, subscribeSessions } from "./sessions"
import { menuOf } from "./SessionsPanel"

export function useTerminalRuns(): AgentRun[] | null {
  const { list, refused } = useSyncExternalStore(subscribeSessions, getSessions)
  const agents = useAgents()
  const accountName = useAccountNames()
  return useMemo(() => {
    if (refused) return []
    if (!list) return null
    return list.flatMap((s): AgentRun[] => {
      const a = agentIn(s, agents), run = runOf(s, a)
      if (!run || (s.external && !s.clients)) return []
      const account = accountName(a!.name, s.machine ?? "", s.account ?? parseTerminal(s.id)?.profile ?? undefined)
      return [{ ...run, ...(account ? { account } : {}), menu: () => menuOf(s, a) }]
    })
  }, [list, refused, agents, accountName])
}
