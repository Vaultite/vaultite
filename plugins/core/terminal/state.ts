// A terminal's agent state, one value per terminal (plugin.ts keeps them): every source's word comes in as an event, and
// `step` alone says what the terminal is then. No clock and no Node of its own: the caller says when.
import { shown, type Kind, type Said, type SessionState } from "./osc7501.ts"

/** Where a state came from: `shell` is its program gone from in front of its shell (back at its prompt). */
export type From = "osc7501" | "hooks" | "screen" | "agent" | "backend" | "shell"

/** A state a source says (SessionState's), with where it came from. */
export type Word =
  | { state: "idle" | "done" | "error"; from: From; msg?: string }
  | { state: "working"; from: From; msg?: string }
  | { state: "blocked"; from: From; kind?: Kind; msg?: string }

/** What a terminal's agent is doing: `quiet` while nothing has said, `missing` when its shell found no such program,
 *  `ended` once the terminal ended (and how); else what its sources say. */
export type Phase = { state: "quiet" } | { state: "missing" } | Word | { state: "ended"; code: number; signal: number; lost: boolean }

/** What its agent's hooks wrote in its state file (plugin.ts' stateCommand): working, idle, waiting[:kind] or missing. */
export type Hooks = { state: "working" | "idle" | "missing" } | { state: "blocked"; kind?: Kind }

/** A question its agent declares, seen on its screen. */
export type Ask = { id: string; says?: string }

/** A terminal: each source's last word, and what they make it. */
export type Term = {
  /** Its agent, by its id (else what its program calls itself in OSC 7501). */
  agent: string
  osc: Said | null
  hooks: Hooks | null
  ask: Ask | null
  /** Its agent's own word that it waits on the user (Claude Code's session file): it blocks whatever the rest say. */
  waits: Kind | null
  /** Its backend's own word on the agent there (herdr's). */
  backend: "working" | "idle" | "blocked" | null
  /** Its program in front of its shell, as last seen (null: not looked at yet). */
  front: boolean | null
  /** Its agent's command was typed into its shell, its program not seen nor heard yet: its shell's prompt ends nothing. */
  starting: boolean
  /** When a source last said something: a program seen gone before then left nothing it said. */
  heard: number
  phase: Phase
  /** When its phase last changed (terminal.wait counts one after the last input), and when it last began working. */
  at: number
  since: number
}

/** What happens to a terminal, from each source. `seen`: one first listed after this server started, with what its
 *  sources said before (when, unknown); `front`: its program in front or its shell at its prompt, as read at `seen`. */
export type Event =
  | { type: "start" }
  | { type: "late" }
  | { type: "seen"; osc: Said | null; hooks: string | null }
  | { type: "osc"; said: Said }
  | { type: "hooks"; text: string | null }
  | { type: "ask"; ask: Ask | null }
  | { type: "waits"; kind: Kind | null }
  | { type: "backend"; state: string | undefined }
  | { type: "front"; program: boolean; seen: number }
  | { type: "exit"; code: number; signal: number; lost: boolean }

/** What reads a terminal's state gets: a Word with its agent, or null when nothing says (or it ended). */
export type Now = { agent: string; state: SessionState; kind?: Kind; msg?: string; from: From }

/** An OSC 7501 program's own name, as the agent whose service runs it. */
const AGENT_APPS: Record<string, string> = { "claude-code": "claude" }

export const fresh = (agent: string): Term => ({ agent, osc: null, hooks: null, ask: null, waits: null, backend: null, front: null, starting: false, heard: 0,
  phase: { state: "quiet" }, at: 0, since: 0 })

const isWord = (p: Phase): p is Word => "from" in p

/** The state file's text as Hooks, or null. */
export function hooksOf(text: string | null | undefined): Hooks | null {
  const [state, kind] = (text ?? "").trim().split(":")
  if (state === "working" || state === "idle" || state === "missing") return { state }
  if (state === "waiting") { const k = kind === "permission" || kind === "question" ? kind : undefined; return { state: "blocked", ...(k ? { kind: k } : {}) } }
  return null
}

/** What the terminal's own sources say, by rank: OSC 7501, else its hooks, else a question on its screen, else its backend. */
function own(t: Term): Word | null {
  const st = t.osc?.status
  if (st) {
    // (blocked without saying why, as Codex says it: the question its agent declares on its screen does)
    const ask = st.state === "blocked" && !st.kind ? t.ask : null
    const kind = st.kind ?? (ask ? "permission" : undefined), msg = shown(st.msg) ?? ask?.says
    return { state: st.state, from: "osc7501", ...(kind && st.state === "blocked" ? { kind } : {}), ...(msg ? { msg } : {}) } as Word
  }
  // (a program that speaks it says nothing before its session starts: Claude Code's folder trust is only on its screen)
  const h = t.osc?.seen ? null : t.hooks
  if (h?.state === "blocked") return { state: "blocked", from: "hooks", ...(h.kind ? { kind: h.kind } : {}) }
  if (h && h.state !== "missing") return { state: h.state, from: "hooks" }
  if (t.ask) return { state: "blocked", kind: "permission", from: "screen", ...(t.ask.says ? { msg: t.ask.says } : {}) }
  return t.backend ? { state: t.backend, from: "backend" } : null
}

/** Every source's word together: its agent's own word that it waits blocks it (a dialog nothing else tells). */
function said(t: Term): Word | null {
  const w = own(t)
  if (!t.waits || w?.state === "blocked") return w
  return { state: "blocked", kind: t.waits, from: "agent", ...(t.ask?.says ? { msg: t.ask.says } : {}) }
}

const same = (a: Phase, b: Phase) => a.state === b.state && (a as { kind?: Kind }).kind === (b as { kind?: Kind }).kind &&
  (a as { msg?: string }).msg === (b as { msg?: string }).msg

/** Its phase from its sources: nothing saying any more after something did is at rest (idle); `gone`, its program left. */
function settle(n: Term, was: Term, now: number, gone = false): Term {
  const p = was.phase, w = said(n)
  const next: Phase = n.hooks?.state === "missing" ? { state: "missing" }
    : w ?? (gone || isWord(p) ? { state: "idle", from: gone ? "shell" : (p as Word).from } : p)
  if (same(next, p)) return { ...n, phase: p }
  return { ...n, phase: next, at: now, since: next.state === "working" && p.state !== "working" ? now : n.since }
}

/** Its program left (its shell at its prompt, seen after its last word): what it worked on or was blocked on is over,
 *  and what its sources said goes with it (its hooks' file and OSC 7501's records stay as they were). */
function left(n: Term, was: Term, now: number): Term {
  n.osc = n.osc && { seen: n.osc.seen, status: null }
  n.hooks = n.hooks?.state === "missing" ? n.hooks : null
  n.ask = null
  n.waits = null
  const p = was.phase
  // (an agent's program that said nothing, seen in front and now gone, is at rest too)
  const gone = isWord(p) ? p.state !== "idle" : p.state === "quiet" && was.front === true && !!n.agent
  return settle(n, was, now, gone)
}

/** Terminal `t` after `ev`, at `now`. An ended terminal stays so: one started again under its id is a fresh Term. */
export function step(t: Term, ev: Event, now: number): Term {
  if (t.phase.state === "ended") return t
  const n: Term = { ...t }
  // (its agent heard: it runs; a state file removed as it starts isn't a word)
  if (ev.type === "osc" || (ev.type === "hooks" && hooksOf(ev.text)) || (ev.type === "ask" && ev.ask) || (ev.type === "waits" && ev.kind)) n.starting = false
  switch (ev.type) {
    case "start": n.starting = true; break
    case "late": n.starting = false; break
    case "seen":
      // (what was said before, at a time unknown: what came since stands)
      n.osc ??= ev.osc
      n.hooks ??= hooksOf(ev.hooks)
      break
    case "osc":
      n.osc = ev.said
      n.heard = now
      if (ev.said.status?.state !== "blocked" || ev.said.status.kind) n.ask = null
      break
    case "hooks":
      n.hooks = hooksOf(ev.text)
      n.heard = now
      break
    case "ask": n.ask = ev.ask; n.heard = now; break
    case "waits": n.waits = ev.kind; n.heard = now; break
    case "backend": {
      const s = ev.state === "working" || ev.state === "idle" ? ev.state : ev.state === "waiting" ? "blocked" : null
      // (told again with every list: only a change is news)
      if (s === n.backend) return t
      n.backend = s
      n.heard = now
      break
    }
    case "front":
      n.front = ev.program
      if (ev.program) { n.starting = false; return n }
      // (a shell at its prompt while its agent starts, or seen before its program last spoke, ends nothing)
      return n.starting || ev.seen < n.heard ? n : left(n, t, now)
    case "exit":
      return { ...n, osc: null, hooks: null, ask: null, waits: null, backend: null, starting: false, at: now,
        phase: { state: "ended", code: ev.code, signal: ev.signal, lost: ev.lost } }
  }
  return settle(n, t, now)
}

/** What reads terminal `t`'s state gets (the list, terminal.wait, "inbox:state"), or null when nothing says. */
export function nowOf(t: Term): Now | null {
  const p = t.phase
  if (!isWord(p)) return null
  const app = p.from === "osc7501" ? t.osc?.status?.app : undefined
  return { agent: t.agent || (app ? AGENT_APPS[app] ?? app : ""), state: p.state, ...("kind" in p && p.kind ? { kind: p.kind } : {}), ...(p.msg ? { msg: p.msg } : {}), from: p.from }
}

/** A phase in a log line: "working (hooks)", "blocked: permission (osc7501)", "ended (lost)". */
export function label(p: Phase) {
  if (p.state === "ended") return `ended (${p.lost ? "lost" : p.signal ? `signal ${p.signal}` : `exit ${p.code}`})`
  if (!isWord(p)) return p.state
  return `${p.state}${"kind" in p && p.kind ? `: ${p.kind}` : ""} (${p.from})`
}

/** Whether a change is a transition (its state or what it waits on), as the log tells it: a new message isn't one. */
export const moved = (a: Phase, b: Phase) => a.state !== b.state || (a as { kind?: Kind }).kind !== (b as { kind?: Kind }).kind
