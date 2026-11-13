import type { LucideIcon } from "lucide-react"
import { agentOfTerminal, agentsOn, announceAgent, closeView, confirmDialog, notify, notifyError, op, openView, parseTerminal, type Agent, type AgentPhase, type AgentRun, type Dot } from "@vaultite"
import { agentTint } from "../../../core/agenttint.ts"
import { hasNews, waitsOnUser } from "../../../core/attention.ts"
import { resumeTerminalId } from "../../../core/terminalids.ts"

type Live = { id: string; end: () => void }
const live = new Map<string, Live>()
let last = ""

export function register(t: Live) {
  live.set(t.id, t)
  return () => { if (live.get(t.id) === t) live.delete(t.id) }
}

export const touch = (id: string) => { last = id }
export const current = () => live.get(last) ?? null

const parked = new Map<string, () => void>()
const closedNow = new Set<string>()
export const parkTerminal = (id: string, letGo: () => void) => { parked.set(id, letGo) }
export const unparkTerminal = (id: string) => { parked.delete(id) }
export const closedJustNow = (id: string) => closedNow.has(id)
function letGo(id: string) {
  const f = parked.get(id)
  parked.delete(id)
  f?.()
}

export type Session = { id: string; agent: string | null; process: string; busy?: boolean; clients: number; started: number; title?: string
  name?: string
  state?: "idle" | "working" | "blocked" | "done" | "error"; kind?: "permission" | "question" | "auth"; msg?: string
  since?: number
  progress?: string
  starting?: boolean
  needs?: boolean
  review?: boolean
  note?: string
  missing?: boolean
  machine?: string; machineLabel?: string
  backend?: string; external?: boolean
  session?: string
  account?: string; project?: string
  meter?: Meter }
export type Meter = { context?: { tokens: number; window: number; as: "bar" | "percent" | "tokens" }; cache?: { until: number; ttl: number; as: "icon" | "bar" } }

export const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "-zsh", "-bash", "-sh", "login", "pwsh", "powershell", "cmd", "wsl"])
export function agentIn(s: Session, agents: Agent[] = agentsOn()): Agent | null {
  const own = s.agent ? agents.find((a) => a.name === s.agent) : undefined
  if (own && s.busy !== undefined) return s.busy || s.starting ? own : null
  if (own && (!s.process || s.process === "node" || SHELLS.has(s.process) || own.process?.includes(s.process))) return own
  return agents.find((a) => a.process?.includes(s.process)) ?? null
}
export const labelOf = (s: Session, a = agentIn(s)) => s.name || autoLabel(s, a)
export const autoLabel = (s: Session, a = agentIn(s)) => (a ? s.title || a.label : s.process && !SHELLS.has(s.process) ? s.process : "Terminal")

export async function nameSession(id: string, name: string) {
  const was = sessionById(id), clean = name.replace(/\s+/g, " ").trim()
  const swap = (s: Session | null) => { if (s && now.list) put({ list: now.list.map((x) => (x.id === id ? s : x)) }) }
  swap(was && { ...was, name: clean || undefined })
  try {
    await op("terminal.rename", { id, name: clean })
  } catch (e) {
    swap(was)
    notifyError(e, "Couldn't rename the terminal")
  }
}
export const busy = (s: Session) => s.busy ?? (!!s.process && !SHELLS.has(s.process))

function fetchSessions(ms = 1500): Promise<Session[] | null> {
  return new Promise((resolve) => {
    const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminals`)
    const done = (v: Session[] | null) => { clearTimeout(timer); sock.close(); resolve(v) }
    const timer = setTimeout(() => done(null), ms)
    sock.onmessage = (e) => {
      try { const m = JSON.parse(e.data); if (m.t === "sessions" && Array.isArray(m.list)) done(m.list) } catch {}
    }
    sock.onerror = () => done(null)
  })
}

async function running(ids: string[]) {
  const list = await fetchSessions()
  const unknown = list ? ids.filter((id) => id.includes("@") && !list.some((s) => s.id === id)) : [...ids]
  const keep = list
    ? list.filter((s) => ids.includes(s.id) && busy(s)).map((s) => ({ id: s.id, label: labelOf(s) }))
    : ids.flatMap((id) => { const a = agentOfTerminal(id); return a ? [{ id, label: a.label }] : [] })
  return Object.assign(keep, { unknown })
}

async function confirmEnd(ids: string[]) {
  const seen = ws?.readyState === WebSocket.OPEN ? ids.map(sessionById) : []
  const known = seen.length > 0 && seen.every((s) => s && busy(s))
  const r = known ? null : await running(ids)
  const busyOnes = known ? seen.map((s) => labelOf(s!)) : [...r!.map((x) => x.label), ...r!.unknown.filter((id) => !r!.some((x) => x.id === id)).map((id) => { const s = sessionById(id); return s ? labelOf(s) : "this terminal" })]
  if (!busyOnes.length) return null
  const one = busyOnes.length === 1
  return {
    title: one ? `End ${busyOnes[0]}?` : `End ${busyOnes.length} running terminals?`,
    body: one ? "It's still running in this terminal. Ending the session stops it." : `Still running: ${busyOnes.join(", ")}. Ending them stops them.`,
    confirm: one ? "End it" : "End them",
    danger: true,
  }
}

const socketFor = (id: string, q = "") => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal/${encodeURIComponent(id)}${q}`
const ending = new Set<string>()
function endSession(id: string) {
  letGo(id)
  ending.add(id)
  setTimeout(() => ending.delete(id), 5000)
  if (now.list?.some((s) => s.id === id)) put({ list: now.list })
  const sock = new WebSocket(socketFor(id, "?end=1"))
  sock.onerror = () => sock.close()
}

export async function endForGood(id: string) {
  const s = sessionById(id), a = s ? agentIn(s) : null
  if (s && a && resting(s)) {
    const resume = pinOfTerminal(id)
    endSession(id)
    closeView(`terminal/${id}`)
    notify(`Ended ${labelOf(s, a)}`, resume ? { action: { label: "Resume", run: () => openView(`view:terminal/${resume}`, { newTab: true }) } } : undefined)
    return
  }
  const ask = await confirmEnd([id])
  if (ask && !(await confirmDialog(ask))) return
  endSession(id)
  closeView(`terminal/${id}`)
}

let closing = new Set<string>()
let closeTimer = 0
export function tabClosed(id: string) {
  closedNow.add(id)
  setTimeout(() => closedNow.delete(id), 1000)
  letGo(id)
  if (ending.has(id)) return
  closing.add(id)
  clearTimeout(closeTimer)
  closeTimer = window.setTimeout(() => { void settle([...closing]); closing = new Set() }, 0)
}
async function settle(ids: string[]) {
  const keep = await running(ids)
  const theirs = new Set((getSessions().list ?? []).filter((s) => s.external).map((s) => s.id))
  for (const id of ids) if (!keep.some((k) => k.id === id) && !keep.unknown.includes(id) && !theirs.has(id)) endSession(id)
  const agent = (id: string) => { const s = sessionById(id); return s ? !!agentIn(s) : !!agentOfTerminal(id) }
  keep.splice(0, keep.length, ...keep.filter((k) => !theirs.has(k.id) && !agent(k.id)))
  if (!keep.length) return
  const one = keep.length === 1
  notify(one ? `${keep[0].label} is still running, in Terminals` : `${keep.length} terminals are still running, in Terminals`, {
    action: { label: one ? "End it" : "End them", run: () => keep.forEach((k) => endSession(k.id)) },
  })
}

export const tintOf = (s: Session, a = agentIn(s)) => (!a || (resting(s) && !cacheIn(s)) ? undefined : a.tint)
export const rankOf = (s: Session, a = agentIn(s)) => (!a ? 4 : needsYou(s, a) ? 0 : s.state === "working" ? 1 : hasNews(s) ? 2 : 3)
export const needsYou = (s: Session, a = agentIn(s)) => !!a && waitsOnUser(s)
export const resting = (s: Session) => s.state === "idle" || s.state === "done" || s.state === "error"
export function runOf(s: Session, a = agentIn(s)): AgentRun | null {
  if (!a) return null
  const needs = needsYou(s, a)
  return {
    id: `terminal:${s.id}`, kind: "terminal", title: labelOf(s, a), step: s.progress || s.msg || undefined,
    state: needs ? "needs" : s.state === "working" || s.starting ? "working" : "done", failed: s.state === "error", unread: !needs && hasNews(s),
    machine: s.machine, where: s.machineLabel, agent: a.label, ...(s.project ? { project: s.project } : {}), tint: `var(--${agentTint(s.id)})`, session: s.session, at: s.started, started: true,
    ...(resting(s) && !s.starting && s.since ? { since: s.since } : {}), to: `view:terminal/${s.id}`,
  }
}

type Sessions = { list: Session[] | null; refused: string }
let now: Sessions = { list: null, refused: "" }
const listeners = new Set<() => void>()
let ws: WebSocket | null = null, timer = 0, tries = 0
const put = (next: Partial<Sessions>) => {
  if (next.list && ending.size) next = { ...next, list: next.list.filter((s) => !ending.has(s.id)) }
  if (next.list) tell(now.list, next.list)
  now = { ...now, ...next }
  listeners.forEach((f) => f())
  tick()
}
const PHASE: Record<string, AgentPhase> = { working: "working", blocked: "waiting", idle: "done", done: "done", error: "failed" }
function tell(was: Session[] | null, list: Session[]) {
  if (!was) return
  const before = new Map(was.map((s) => [s.id, s]))
  for (const s of list) {
    const a = agentIn(s), b = before.get(s.id)
    if (a && b) announceAgent(labelOf(s, a), PHASE[b.state ?? ""] ?? null, PHASE[s.state ?? ""] ?? null)
  }
}
let ticking = 0
function tick() {
  const any = now.list?.some((s) => s.meter?.cache && s.meter.cache.until > Date.now())
  if (any && !ticking) ticking = window.setInterval(() => put({}), 15_000)
  else if (!any && ticking) { clearInterval(ticking); ticking = 0 }
}

function connect() {
  const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminals`)
  ws = sock
  sock.onmessage = (e) => {
    if (typeof e.data !== "string") return
    let m: { t?: string; list?: Session[]; reason?: string }
    try { m = JSON.parse(e.data) } catch { return }
    if (m.t === "sessions" && Array.isArray(m.list)) { tries = 0; put({ list: m.list, refused: "" }) }
    else if (m.t === "refused") put({ refused: m.reason ?? "refused" })
  }
  sock.onclose = () => {
    if (ws !== sock || now.refused) return
    timer = window.setTimeout(connect, Math.min(10000, 500 * 2 ** Math.min(tries++, 5)))
  }
}

function disconnect() {
  const sock = ws
  ws = null; tries = 0
  clearInterval(ticking); ticking = 0
  clearTimeout(timer)
  sock?.close()
}
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => {
  if (document.hidden) disconnect()
  else if (listeners.size && !ws) connect()
})

export function subscribeSessions(fn: () => void) {
  listeners.add(fn)
  if (!ws && !document.hidden) connect()
  return () => {
    listeners.delete(fn)
    // (a view redrawn drops its last listener and takes one again a frame later: the socket outlives that)
    if (!listeners.size) setTimeout(() => { if (!listeners.size) disconnect() }, 1000)
  }
}
export const getSessions = () => now
export const sessionById = (id: string) => now.list?.find((s) => s.id === id) ?? null

export function pinOfTerminal(id: string): string | null {
  const s = sessionById(id), t = parseTerminal(id)
  const a = s ? agentIn(s) : agentOfTerminal(id)
  const session = s?.session ?? t?.resume
  if (!a?.session || !session) return null
  const machine = s?.machine ?? t?.machine
  return `${resumeTerminalId(a.name, session, t?.agent === a.name ? t.profile : null)}${machine ? `@${machine}` : ""}`
}

export function runningResume(id: string): string | null {
  const t = parseTerminal(id)
  if (!t?.resume) return null
  return now.list?.find((s) => s.id !== id && s.session === t.resume && (s.machine ?? null) === t.machine && agentIn(s)?.name === t.agent)?.id ?? null
}

export const iconOf = (s: Session, a = agentIn(s)): LucideIcon | null => a?.icon ?? null
export function dotOf(s: Session, a = agentIn(s)): Dot {
  if (!a) return false
  if (s.state === "blocked") return "ask"
  if (s.state === "working") return "working"
  if (s.state === "error") return "error"
  return hasNews(s) ? "unread" : false
}
export const stateClass = (s: Session, a = agentIn(s)) => (a && resting(s) ? DRAIN[Math.ceil(cacheIn(s) * 10)] : undefined)

export const cacheIn = (s: Session) => {
  const c = s.meter?.cache
  return c?.as === "icon" && resting(s) ? cacheLeft(c) : 0
}
export const cacheLeft = (c: { until: number; ttl: number }) => Math.min(1, Math.max(0, (c.until - Date.now()) / (c.ttl * 1000)))
const DRAIN = [undefined,
  "[mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.3)_90%,#000_90%)]", "[mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.3)_80%,#000_80%)]",
  "[mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.3)_70%,#000_70%)]", "[mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.3)_60%,#000_60%)]",
  "[mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.3)_50%,#000_50%)]", "[mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.3)_40%,#000_40%)]",
  "[mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.3)_30%,#000_30%)]", "[mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.3)_20%,#000_20%)]",
  "[mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.3)_10%,#000_10%)]", undefined]

export function meterText(s: Session) {
  const { context: c, cache } = s.meter ?? {}
  const k = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`)
  const left = cache && Math.ceil(Math.max(0, cache.until - Date.now()) / 60000)
  return [c && `context ${k(c.tokens)} of ${k(c.window)} (${Math.round((c.tokens / c.window) * 100)}%)`,
    cache && resting(s) && (left ? `cache ${left} min left` : "cache expired")].filter(Boolean).join(", ")
}
export const stateTip = (s: Session) => (s.missing ? " (not installed)" : s.state === "working" ? " (working)" : s.state === "blocked" ? " (waiting for you)"
  : hasNews(s) ? " (has something for you)" : s.state === "error" ? " (failed)" : s.state === "done" ? " (done)" : "")
