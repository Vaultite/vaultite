import { useMemo } from "react"
import { splitMachine, stem, useAccountNames, useLive, type AgentRun } from "@vaultite"
import { agentTint } from "../../../core/agenttint.ts"

type Chat = { id: string; state: "starting" | "working" | "waiting" | "idle" | "error"; cwd: string; account?: string; project?: string; by: string; started: number; at: number
  asks: string[]; title?: string; error?: string; turn: { prompt: string; text: string; error?: string } | null
  progress?: string }

const EVERY = 4000
const firstLine = (t: string | undefined) => t?.trim().split("\n")[0]?.slice(0, 120) || undefined

export function useChatRuns(): AgentRun[] | null {
  const { data, error } = useLive<{ sessions: Chat[] }>("claude-code/chats", undefined, false, EVERY)
  const accountName = useAccountNames()
  return useMemo(() => {
    if (!data) return error ? [] : null
    return data.sessions.map((c): AgentRun => {
      const [id, machine] = splitMachine(c.id)
      const needs = c.state === "waiting" || c.asks.length > 0, failed = c.state === "error"
      return {
        id: `chat:${c.id}`, kind: "chat", title: c.title || firstLine(c.turn?.prompt) || stem(c.cwd) || "Chat",
        step: needs ? "Waiting for your answer" : failed ? firstLine(c.error ?? c.turn?.error) : c.state === "working" ? c.progress || firstLine(c.turn?.prompt) : firstLine(c.turn?.text),
        state: needs ? "needs" : c.state === "working" || c.state === "starting" ? "working" : "done", failed,
        machine, agent: "Claude Code", tint: `var(--${agentTint(id)})`, session: id, account: accountName("claude", machine ?? "", c.account) || undefined,
        project: c.project || stem(c.cwd) || undefined, at: c.at || c.started, to: `view:claude-session/${c.id}`,
      }
    })
  }, [data, error, accountName])
}
