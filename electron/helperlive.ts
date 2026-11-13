import { WebSocket } from "ws"
import type { HelperJob } from "./helperlogic.ts"
import { asked, QUIET } from "./helperask.ts"
import type { Agent, Note } from "./helperbase.ts"

export type Message = Record<string, unknown>
let on: { heard: (m: Message) => void; opened: (s: WebSocket) => void; closed: () => void }
export const liveHooks = (h: typeof on) => { on = h }
/** The companion's socket, as the helper (?screen=1): the agents and their bubbles, and what the user asks on screen. */
export const live = (() => {
  let ws: WebSocket | null = null, port: number | null = null, wait = 1000, timer: ReturnType<typeof setTimeout> | null = null
  const state = { mode: "quiet", name: "", agents: new Map<string, Agent>(), notes: new Map<string, Note>(),
    /** Each agent's last says and what the user asked it: its conversation. */
    said: [] as Note[],
    /** What it handed off (null till the server says): the menu's Jobs. */
    jobs: null as HelperJob[] | null }
  const connect = () => {
    timer = null
    if (port === null) return
    const s = new WebSocket(`ws://127.0.0.1:${port}/api/companion/live?screen=1`)
    ws = s
    s.on("open", () => { wait = 1000; on.opened(s) })
    s.on("message", (d) => {
      let m: Message
      try { m = JSON.parse(String(d)) } catch { return }
      on.heard(m)
    })
    s.on("error", () => {})
    s.on("close", () => { if (ws === s) { ws = null; if (port !== null) { timer = setTimeout(connect, wait); wait = Math.min(wait * 2, 5000) } } })
  }
  return {
    state,
    open(p: number | null) { this.close(); port = p; if (p !== null) connect() },
    close() { port = null; if (timer) clearTimeout(timer); timer = null; ws?.close(); ws = null; state.agents.clear(); state.notes.clear(); state.said = []; state.jobs = null; on.closed() },
    /** Not connected: try again now, not at the next backoff (a press is waiting for it). */
    now() { if (ws || port === null) return; if (timer) clearTimeout(timer); wait = 1000; connect() },
    say(m: object) { if (QUIET) asked.push(m); if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(m)); return true } return false },
  }
})()
