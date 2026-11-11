// The Agents panel's terminals: each session running a coding agent, from the one live list (sessions.ts).
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
      // (another program's own pane, a herdr one, only while a tab shows it: as the Terminals panel)
      if (!run || (s.external && !s.clients)) return []
      const account = accountName(a!.name, s.machine ?? "", s.account ?? parseTerminal(s.id)?.profile ?? undefined)
      return [{ ...run, ...(account ? { account } : {}), menu: () => menuOf(s, a) }]
    })
  }, [list, refused, agents, accountName])
}
