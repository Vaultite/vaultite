import { agentOfTerminal, agentsOn, closeView, confirmDialog, notify, type Agent } from "@vaultite"

// Which terminal the keyboard was in last (for "End terminal session"), without loading xterm.js: the lazy view
// registers itself here while it's mounted.
type Live = { id: string; end: () => void }
const live = new Map<string, Live>()
let last = ""

export function register(t: Live) {
  live.set(t.id, t)
  return () => { if (live.get(t.id) === t) live.delete(t.id) }
}

export const touch = (id: string) => { last = id }
export const current = () => live.get(last) ?? null

// Terminals kept while their tabs are hidden (Terminal.tsx parks them, so a tab coming back shows at once, without a
// new socket or the replay): one whose last tab closes, or whose session is ended here, is let go.
const parked = new Map<string, () => void>()
const closedNow = new Set<string>()
export const parkTerminal = (id: string, letGo: () => void) => { parked.set(id, letGo) }
export const unparkTerminal = (id: string) => { parked.delete(id) }
/** Its last tab closed a moment ago (its view unmounts after that): not to be parked. */
export const closedJustNow = (id: string) => closedNow.has(id)
function letGo(id: string) {
  const f = parked.get(id)
  parked.delete(id)
  f?.()
}

/** A new session id: 8 letters and digits. */
export { terminalId as newId } from "@vaultite"

/** A session as /api/terminals lists it: `agent`, the coding agent its id names (codex-<id>), or null; `machine` and
 *  `machineLabel`, another machine's (its id ends in @<machine>). */
export type Session = { id: string; agent: string | null; process: string; busy?: boolean; clients: number; started: number; title?: string; state?: string
  machine?: string; machineLabel?: string
  /** Where it runs (backend.ts: vaultite, tmux, herdr...), and whether it's another program's own (a herdr pane the
   *  user opened there: listed only while a tab shows it, never ended by closing one). */
  backend?: string; external?: boolean
  /** Its agent's own session id (what it resumes; Claude Code's names its transcript), when the agent says. */
  session?: string
  /** Its agent's context and prompt cache, with Agent meters on (its service terminal:meters), drawn as it says (`as`). */
  meter?: Meter }
export type Meter = { context?: { tokens: number; window: number; as: "bar" | "percent" | "tokens" }; cache?: { until: number; ttl: number; as: "icon" | "bar" } }

/** A shell running a program shows it ("vim"); a shell at its prompt, or an agent, just its kind. */
export const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "-zsh", "-bash", "-sh", "login"])
const STARTING = 10_000
/** The coding agent a session runs: opened as one (while it runs, not the shell it leaves after), or its program run in
 *  a plain terminal (`claude`, `codex`); null for anything else. From the agents of the plugins that are on. */
export function agentIn(s: Session, agents: Agent[] = agentsOn()): Agent | null {
  const own = s.agent ? agents.find((a) => a.name === s.agent) : undefined
  // Something runs in front of its shell: the agent (whatever its binary's called). At the shell's prompt: only while it
  // starts (the shell runs a moment before the agent does), not once the agent has quit. An older server says no `busy`.
  if (own && s.busy !== undefined) return s.busy || Date.now() - s.started < STARTING ? own : null
  if (own && (!s.process || s.process === "node" || SHELLS.has(s.process) || own.process?.includes(s.process))) return own
  return agents.find((a) => a.process?.includes(s.process)) ?? null
}
export const labelOf = (s: Session, a = agentIn(s)) => (a ? s.title || a.label : s.process && !SHELLS.has(s.process) ? s.process : "Terminal")
/** Something besides the shell runs in it (an agent, a server, vim, a script like `mo`): ending it would kill that. The
 *  server says (`busy`: it checks the terminal's foreground group); an older one, only by the program's name. */
export const busy = (s: Session) => s.busy ?? (!!s.process && !SHELLS.has(s.process))

/** The sessions as the server says now, once (/api/terminals' first message); null if it doesn't answer in time. */
function fetchSessions(ms = 1500): Promise<Session[] | null> {
  return new Promise((resolve) => {
    const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminals`)
    const done = (v: Session[] | null) => { clearTimeout(timer); sock.close(); resolve(v) }
    const timer = setTimeout(() => done(null), ms)
    sock.onmessage = (e) => {
      try { const m = JSON.parse(e.data); if (m.t === "sessions" && Array.isArray(m.list)) done(m.list) } catch { /* not ours */ }
    }
    sock.onerror = () => done(null)
  })
}

/** The ones among `ids` with something running (what ending them would kill). Server unreachable: agents' terminals,
 *  to be safe; another machine's not in the list are `unknown`, so nothing ends them. */
async function running(ids: string[]) {
  const list = await fetchSessions()
  const unknown = list ? ids.filter((id) => id.includes("@") && !list.some((s) => s.id === id)) : []
  const keep = list
    ? list.filter((s) => ids.includes(s.id) && busy(s)).map((s) => ({ id: s.id, label: labelOf(s) }))
    : ids.flatMap((id) => { const a = agentOfTerminal(id); return a ? [{ id, label: a.label }] : [] })
  return Object.assign(keep, { unknown })
}

/** What to ask before ending these sessions for good, or null when nothing but a shell runs in them. */
async function confirmEnd(ids: string[]) {
  const busyOnes = (await running(ids)).map((r) => r.label)
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
/** Sessions being ended here: their tabs closing isn't news (tabClosed). */
const ending = new Set<string>()
/** End a session for good: its shell and whatever runs in it. */
function endSession(id: string) {
  letGo(id)
  ending.add(id)
  setTimeout(() => ending.delete(id), 5000)
  const sock = new WebSocket(socketFor(id, "?end=1"))
  sock.onerror = () => sock.close()
}

/** End a session for good, from its row's x, its tab's End session or the command: asks first while something runs in
 *  it, then its tabs here close with it. */
export async function endForGood(id: string) {
  const ask = await confirmEnd([id])
  if (ask && !(await confirmDialog(ask))) return
  endSession(id)
  closeView(`terminal/${id}`)
}

/** Closing a tab isn't ending what runs in it: at its last tab a shell at its prompt ends, one running something stays
 *  detached and a toast offers to end it (one toast for tabs closing together). */
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
  // (another program's own, a herdr pane: closing its tab here leaves it be)
  const theirs = new Set((getSessions().list ?? []).filter((s) => s.external).map((s) => s.id))
  for (const id of ids) if (!keep.some((k) => k.id === id) && !keep.unknown.includes(id) && !theirs.has(id)) endSession(id)
  keep.splice(0, keep.length, ...keep.filter((k) => !theirs.has(k.id)))
  if (!keep.length) return
  const one = keep.length === 1
  notify(one ? `${keep[0].label} is still running, in Terminals` : `${keep.length} terminals are still running, in Terminals`, {
    action: { label: one ? "End it" : "End them", run: () => keep.forEach((k) => endSession(k.id)) },
  })
}

/** A session's colour, its state's (Claude Code's agent view): its agent's own (Claude Code's orange, Codex's green)
 *  while it works or says nothing, yellow while it waits on you, none (the icons' grey) idle or a plain shell. */
export const tintOf = (s: Session, a = agentIn(s)) =>
  !a || (s.state === "idle" && !cacheIn(s)) ? undefined : s.state === "waiting" ? "var(--yellow)" : a.tint
/** Where a session sorts (the agent view's groups): waiting on you, working, idle (or saying nothing), a plain shell. */
export const rankOf = (s: Session, a = agentIn(s)) => (!a ? 3 : s.state === "waiting" ? 0 : s.state === "working" ? 1 : 2)

// ---------- every session the server runs, live (one socket for the whole app) ----------
// The Terminals panel, its tab and the terminal tabs' names and states all read this one list.
type Sessions = { list: Session[] | null; refused: string }
let now: Sessions = { list: null, refused: "" }
const listeners = new Set<() => void>()
let ws: WebSocket | null = null, timer = 0, tries = 0
const put = (next: Partial<Sessions>) => { now = { ...now, ...next }; listeners.forEach((f) => f()); tick() }
// While a cache drains, the list is told again every 15 s, so icons and bars follow the clock between the server's lists.
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
  sock.onclose = (e) => {
    if (ws !== sock || e.code === 4003) return
    // The server restarting ends every shell (without tmux): reconnect, and the list comes back.
    timer = window.setTimeout(connect, Math.min(10000, 500 * 2 ** Math.min(tries++, 5)))
  }
}

/** Listen to the sessions list (the socket opens with the first listener and closes after the last). */
export function subscribeSessions(fn: () => void) {
  listeners.add(fn)
  if (!ws) connect()
  return () => {
    listeners.delete(fn)
    if (listeners.size) return
    const sock = ws
    ws = null; tries = 0
    clearInterval(ticking); ticking = 0
    clearTimeout(timer)
    sock?.close()
  }
}
export const getSessions = () => now
/** The session with this id, as the server said last (null: not known yet). */
export const sessionById = (id: string) => now.list?.find((s) => s.id === id) ?? null

/** The icon's status while an agent runs (when its hooks say: AgentStart's `state` on the server): a slow pulse while
 *  it works (opacity only, cheap), yellow with a dot while it waits on you (`waiting`, `tintOf`). */
export const stateClass = (s: Session, a = agentIn(s)) =>
  !a ? undefined : s.state === "working" ? "animate-pulse" : s.state === "idle" ? DRAIN[Math.ceil(cacheIn(s) * 10)] : undefined

/** How much of its prompt cache's time an idle agent has left (0-1), when Agent meters draws it in the icon. */
export const cacheIn = (s: Session) => {
  const c = s.meter?.cache
  return c?.as === "icon" && s.state === "idle" ? cacheLeft(c) : 0
}
export const cacheLeft = (c: { until: number; ttl: number }) => Math.min(1, Math.max(0, (c.until - Date.now()) / (c.ttl * 1000)))
/** The icon dimmed from the top as far as its cache has run out (DRAIN[n]: n tenths left, still coloured). */
const DRAIN = [undefined,
  "[mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.3)_90%,#000_90%)]", "[mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.3)_80%,#000_80%)]",
  "[mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.3)_70%,#000_70%)]", "[mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.3)_60%,#000_60%)]",
  "[mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.3)_50%,#000_50%)]", "[mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.3)_40%,#000_40%)]",
  "[mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.3)_30%,#000_30%)]", "[mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.3)_20%,#000_20%)]",
  "[mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.3)_10%,#000_10%)]", undefined]

/** Its meters in words, for its tooltip and the Terminals tab: "context 116k of 1M (12%), cache 42 min left". */
export function meterText(s: Session) {
  const { context: c, cache } = s.meter ?? {}
  const k = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`)
  const left = cache && Math.ceil(Math.max(0, cache.until - Date.now()) / 60000)
  return [c && `context ${k(c.tokens)} of ${k(c.window)} (${Math.round((c.tokens / c.window) * 100)}%)`,
    cache && s.state === "idle" && (left ? `cache ${left} min left` : "cache expired")].filter(Boolean).join(", ")
}
export const waiting = (s: Session, a = agentIn(s)) => !!a && s.state === "waiting"
export const stateTip = (s: Session) => (s.state === "working" ? " (working)" : s.state === "waiting" ? " (waiting for you)" : "")
