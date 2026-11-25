import { useMemo } from "react"
import { agentNamed, useAgents, useLive, type Agent, type AgentRun } from "@vaultite"

type Shell = { id: string; agent: string | null; process: string; busy?: boolean; starting?: boolean; clients: number; started: number
  title?: string; name?: string; external?: boolean }
const EVERY = 5000
const SHELLS = new Set(["zsh", "bash", "sh", "fish", "pwsh", "powershell", "cmd", "nu"])

const hasAgent = (s: Shell, agents: Agent[]) => (s.agent ? (s.busy !== false || !!s.starting) && !!agentNamed(s.agent, agents) : agents.some((a) => a.process?.includes(s.process)))
const titleOf = (s: Shell) => s.name || (s.process && !SHELLS.has(s.process) ? s.process : s.title) || "Terminal"

export function useShellRuns(on: boolean): AgentRun[] {
  const { data } = useLive<{ sessions: Shell[] }>(on ? "terminals/sessions" : null, undefined, false, EVERY)
  const agents = useAgents()
  return useMemo(() => (on ? data?.sessions ?? [] : []).filter((s) => !hasAgent(s, agents) && !(s.external && !s.clients)).map((s): AgentRun => ({
    id: `terminal:${s.id}`, kind: "terminal", shell: true, title: titleOf(s), state: s.busy ? "working" : "done", at: s.started, started: true, to: `view:terminal/${s.id}`,
  })), [on, data, agents])
}
