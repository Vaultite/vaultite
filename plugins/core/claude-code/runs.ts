// The Agents panel's chats: the Claude Code sessions every machine's app runs in its chat (GET /api/claude-code/chats,
// asked every few seconds while the panel shows). A session a terminal took over shows as that terminal.
import { useMemo } from "react"
import { splitMachine, stem, useLive, type AgentRun } from "@vaultite"

/** A session as the route lists it (chathost.ts' Summary, with its title); <id>@<machine> for another machine's. */
type Chat = { id: string; state: "starting" | "working" | "waiting" | "idle" | "error"; cwd: string; by: string; started: number; at: number
  asks: string[]; title?: string; error?: string; turn: { prompt: string; text: string; error?: string } | null }

const EVERY = 4000
const firstLine = (t: string | undefined) => t?.trim().split("\n")[0]?.slice(0, 120) || undefined

export function useChatRuns(): AgentRun[] | null {
  const { data, error } = useLive<{ sessions: Chat[] }>("claude-code/chats", undefined, false, EVERY)
  return useMemo(() => {
    if (!data) return error ? [] : null
    return data.sessions.map((c): AgentRun => {
      const [id, machine] = splitMachine(c.id)
      const needs = c.state === "waiting" || c.asks.length > 0, failed = c.state === "error"
      return {
        id: `chat:${c.id}`, kind: "chat", title: c.title || firstLine(c.turn?.prompt) || stem(c.cwd) || "Chat",
        step: needs ? "Waiting for your answer" : failed ? firstLine(c.error ?? c.turn?.error) : c.state === "working" ? firstLine(c.turn?.prompt) : firstLine(c.turn?.text),
        state: needs ? "needs" : c.state === "working" || c.state === "starting" ? "working" : "done", failed,
        machine, agent: "Claude Code", tint: "var(--orange)", session: id, at: c.at || c.started, to: `view:claude-session/${c.id}`,
      }
    })
  }, [data, error])
}
