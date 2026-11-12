import { shown, type Kind, type Said, type SessionState } from "./osc7501.ts"

export type From = "osc7501" | "hooks" | "screen" | "agent" | "backend" | "shell"

export type Word = { state: SessionState; from: From; kind?: Kind; msg?: string }

export type Phase = { state: "quiet" } | { state: "missing" } | Word | Ended

export type Ended = { state: "ended"; code: number; signal: number; lost: boolean; by: { keep: boolean } | null }

export const SIGHUP = 1

export type Hooks = { state: "working" | "idle" | "missing" } | { state: "blocked"; kind?: Kind }

export type Ask = { id: string; says?: string }

export type Term = {
  agent: string
  osc: Said | null
  hooks: Hooks | null
  ask: Ask | null
  waits: Kind | null
  backend: "working" | "idle" | "blocked" | null
  front: boolean | null
  starting: boolean
  heard: number
  phase: Phase
  ending: { keep: boolean } | null
  at: number
  since: number
}

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
  | { type: "end"; keep: boolean }
  | { type: "exit"; code: number; signal: number; lost: boolean }

export type Now = { agent: string; state: SessionState; kind?: Kind; msg?: string; from: From }

const AGENT_APPS: Record<string, string> = { "claude-code": "claude" }

export const fresh = (agent: string): Term => ({ agent, osc: null, hooks: null, ask: null, waits: null, backend: null, front: null, starting: false, heard: 0,
  phase: { state: "quiet" }, ending: null, at: 0, since: 0 })

const isWord = (p: Phase): p is Word => "from" in p

export function hooksOf(text: string | null | undefined): Hooks | null {
  const [state, kind] = (text ?? "").trim().split(":")
  if (state === "working" || state === "idle" || state === "missing") return { state }
  if (state === "waiting") { const k = kind === "permission" || kind === "question" ? kind : undefined; return { state: "blocked", ...(k ? { kind: k } : {}) } }
  return null
}

function own(t: Term): Word | null {
  const st = t.osc?.status
  if (st) {
    // (blocked without saying why, as Codex says it: the question its agent declares on its screen does)
    const ask = st.state === "blocked" && !st.kind ? t.ask : null
    const kind = st.kind ?? (ask ? "permission" : undefined), msg = shown(st.msg) ?? ask?.says
    return { state: st.state, from: "osc7501", ...(kind && st.state === "blocked" ? { kind } : {}), ...(msg ? { msg } : {}) }
  }
  // (a program that speaks it says nothing before its session starts: Claude Code's folder trust is only on its screen)
  const h = t.osc?.seen ? null : t.hooks
  if (h?.state === "blocked") return { state: "blocked", from: "hooks", ...(h.kind ? { kind: h.kind } : {}) }
  if (h && h.state !== "missing") return { state: h.state, from: "hooks" }
  if (t.ask) return { state: "blocked", kind: "permission", from: "screen", ...(t.ask.says ? { msg: t.ask.says } : {}) }
  return t.backend ? { state: t.backend, from: "backend" } : null
}

/** Claude Code has dialogs no hook tells: its own word that it waits blocks it whatever the rest say. */
function said(t: Term): Word | null {
  const w = own(t)
  if (!t.waits || w?.state === "blocked") return w
  return { state: "blocked", kind: t.waits, from: "agent", ...(t.ask?.says ? { msg: t.ask.says } : {}) }
}

const kindOf = (p: Phase) => ("kind" in p ? p.kind : undefined)
const msgOf = (p: Phase) => ("msg" in p ? p.msg : undefined)
const same = (a: Phase, b: Phase) => a.state === b.state && kindOf(a) === kindOf(b) && msgOf(a) === msgOf(b)

function settle(n: Term, was: Term, now: number, gone = false): Term {
  const p = was.phase, w = said(n)
  const next: Phase = n.hooks?.state === "missing" ? { state: "missing" }
    : w ?? (gone ? { state: "idle", from: "shell" } : isWord(p) ? { state: "idle", from: p.from } : p)
  if (same(next, p)) return { ...n, phase: p }
  return { ...n, phase: next, at: now, since: next.state === "working" && p.state !== "working" ? now : n.since }
}

function left(n: Term, was: Term, now: number): Term {
  n.osc = n.osc && { seen: n.osc.seen, status: null }
  n.hooks = n.hooks?.state === "missing" ? n.hooks : null
  n.ask = null
  n.waits = null
  const p = was.phase
  const gone = isWord(p) ? p.state !== "idle" : p.state === "quiet" && was.front === true && !!n.agent
  return settle(n, was, now, gone)
}

export function step(t: Term, ev: Event, now: number): Term {
  if (t.phase.state === "ended") return t
  const n: Term = { ...t }
  if (ev.type === "osc" || (ev.type === "hooks" && hooksOf(ev.text)) || (ev.type === "ask" && ev.ask) || (ev.type === "waits" && ev.kind)) n.starting = false
  switch (ev.type) {
    case "start": n.starting = !n.hooks && !n.osc?.status && !n.osc?.seen; break
    case "late": n.starting = false; break
    case "seen":
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
      if (s === n.backend) return t
      n.backend = s
      n.heard = now
      break
    }
    case "front":
      n.front = ev.program
      if (ev.program) { n.starting = false; return n }
      return n.starting || ev.seen < n.heard ? n : left(n, t, now)
    case "end": return { ...n, ending: { keep: ev.keep } }
    case "exit": {
      const by = n.ending, how = by ? { code: 0, signal: SIGHUP, lost: false } : { code: ev.code, signal: ev.signal, lost: ev.lost }
      return { ...n, osc: null, hooks: null, ask: null, waits: null, backend: null, starting: false, ending: null, at: now,
        phase: { state: "ended", ...how, by } }
    }
  }
  return settle(n, t, now)
}

export function nowOf(t: Term): Now | null {
  const p = t.phase
  if (!isWord(p)) return null
  const app = p.from === "osc7501" ? t.osc?.status?.app : undefined
  return { agent: t.agent || (app ? AGENT_APPS[app] ?? app : ""), state: p.state, ...("kind" in p && p.kind ? { kind: p.kind } : {}), ...(p.msg ? { msg: p.msg } : {}), from: p.from }
}

export function label(p: Phase) {
  if (p.state === "ended") return `ended (${p.lost ? "lost" : p.signal ? `signal ${p.signal}` : `exit ${p.code}`})`
  if (!isWord(p)) return p.state
  return `${p.state}${"kind" in p && p.kind ? `: ${p.kind}` : ""} (${p.from})`
}

export const moved = (a: Phase, b: Phase) => a.state !== b.state || kindOf(a) !== kindOf(b)

export function closes(t: Term) {
  const p = t.phase
  if (p.state !== "ended") return !!t.ending && !t.ending.keep
  return p.by ? !p.by.keep : !p.code && !p.signal && !p.lost
}

export const byUs = (t: Term) => (t.phase.state === "ended" ? t.phase.by : t.ending)
