// The Inbox's events in the app: one socket while the plugin is on; changes apply here at once and the server's answer
// comes back over the socket.
import { agentsOn, canRunAgents, cell, del, detailPath, fetchMachines, get, getTabLayout, isDesktop, isViewOpen, notify, notifyError, onMachine, op, openAgent, openDetail, openFile, openView, post, splitMachine, type Agent, type TabLayout } from "@vaultite"
import type { InboxEvent } from "./types"

export type Events = { events: InboxEvent[]; unread: number; ready: boolean }
/** The sheet of a permission the server waits on (Inbox.tsx's GateSheet): inbox-gate/<event id>. */
export const GATE_DETAIL = "inbox-gate"
/** The sheet of an agent's session (Session.tsx): its last answer or what it asks, the reply: inbox-session/<event id>. */
export const SESSION_DETAIL = "inbox-session"
const state = cell<Events>({ events: [], unread: 0, ready: false })
const fresh = new Set<(e: InboxEvent) => void>()

export const { get: getEvents, subscribe: subscribeEvents, use: useEvents } = state
/** Hear each event the user is to be told of (the server stamps it `nt` when they may be), once; not the ones there
 *  when the app loads. */
export function onFresh(fn: (e: InboxEvent) => void) { fresh.add(fn); return () => { fresh.delete(fn) } }

function set(events: InboxEvent[]) {
  state.set({ events, unread: events.filter((e) => !e.read).length, ready: true })
}

// ---------- the socket

let sock: WebSocket | null = null
let users = 0
let retry = 0
let timer: ReturnType<typeof setTimeout> | null = null
/** When each event last told the user, as last heard; null until the first list. */
let seen: Map<string, number> | null = null
/** News older than this when it arrives (the socket was away a while) is listed, not announced. */
const STALE = 2 * 60_000

function open() {
  timer = null
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/inbox/live`)
  sock = ws
  ws.onopen = () => { retry = 0 }
  ws.onmessage = (m) => {
    let msg: { t?: string; events?: InboxEvent[] }
    try { msg = JSON.parse(String(m.data)) } catch { return }
    if (msg.t !== "events" || !Array.isArray(msg.events)) return
    const before = seen
    seen = new Map(msg.events.map((e) => [e.id, e.nt ?? 0]))
    set(msg.events)
    if (!before) return
    for (const e of [...msg.events].reverse()) {
      if (!e.read && e.nt && (before.get(e.id) ?? 0) < e.nt && Date.now() - e.nt < STALE) fresh.forEach((f) => f(e))
    }
  }
  ws.onclose = () => {
    if (sock === ws) sock = null
    if (users > 0 && !timer) timer = setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++))
  }
}

/** Follow the events while something needs them (the background, while the plugin is on). */
export function follow() {
  if (users++ === 0 && !sock && !timer) open()
  return () => {
    if (--users > 0) return
    if (timer) { clearTimeout(timer); timer = null }
    sock?.close()
    sock = null
    seen = null
  }
}

// ---------- changes

/** Mark events read (no ids: every one). */
export function markRead(ids?: string[]) {
  const want = ids ? new Set(ids) : null
  if (!getEvents().events.some((e) => !e.read && (!want || want.has(e.id)))) return
  const before = getEvents().events
  set(getEvents().events.map((e) => (!e.read && (!want || want.has(e.id)) ? { ...e, read: true, kept: undefined } : e)))
  void post("inbox/events/read", ids ? { ids } : {}).catch(undo(before, "Couldn't mark it read"))
}

/** Mark events unread by hand: they stay so while the Inbox is seen, until opened or marked read. */
export function markUnread(ids: string[]) {
  const want = new Set(ids)
  const before = getEvents().events
  set(getEvents().events.map((e) => (want.has(e.id) ? { ...e, read: false, kept: true } : e)))
  void post("inbox/events/unread", { ids }).catch(undo(before, "Couldn't mark it unread"))
}

/** Seeing the Inbox reads news, but not what the user marked unread, nor what waits on them: a session that needs them
 *  is read once opened or answered, as a mail is. */
export function markSeen() {
  const ids = getEvents().events.filter((e) => !e.read && !e.kept && e.kind !== "waiting" && !answerable(e)).map((e) => e.id)
  if (ids.length) markRead(ids)
}

/** A permission waiting on an answer: one a server waits on (a gate), or an agent's in an app terminal, on any machine
 *  (answered there). */
export const answerable = (e: InboxEvent) => (e.gate ? !e.answer : e.kind === "waiting" && e.ask === "permission" && !!e.terminal && !e.read)

/** An agent's session's row (not a server's question or news): its sheet shows it, and it's replied to. */
export const isSession = (e: InboxEvent) => !e.gate && !!(e.terminal || e.session) && (e.kind === "waiting" || e.kind === "done")

/** Reply to a session's row: typed into its session (on the machine it runs on); read here at once. */
export async function replyTo(e: InboxEvent, text: string, how: "resume" | "new" | "" = "") {
  const before = getEvents().events
  set(before.map((x) => (x.id === e.id ? { ...x, read: true, kept: undefined } : x)))
  try {
    return await op<{ how: string; terminal: string }>("inbox.reply", { to: e.id, text, ...(how ? { how } : {}) })
  } catch (err) {
    set(getEvents().events.map((x) => (x.id === e.id ? before.find((b) => b.id === e.id) ?? x : x)))
    throw err
  }
}

/** A session's terminal if it still runs, else its session resumed in a new one: on the machine it ran on (a session
 *  is kept there). */
export async function openSession({ terminal = "", session = "", agent = "", machine = "" }: { terminal?: string; session?: string; agent?: string; machine?: string }) {
  const ms = await fetchMachines()
  const [bare, at] = splitMachine(terminal)
  const there = at || (machine && ms.some((m) => m.id === machine && !m.self) ? machine : "")
  // (whether it still runs: as the machine it runs on lists its terminals)
  const { sessions } = await get<{ sessions: { id: string }[] }>(there ? `machines/${encodeURIComponent(there)}/terminals/sessions` : "terminals/sessions")
  if (bare && sessions.some((s) => s.id === bare)) openView(`terminal/${onMachine(bare, there)}`, { newTab: true })
  else if (session && agent) openAgent(agent, { resume: session, machine: there })
  else notify("Its terminal has ended, and it names no session to resume")
}

/** Answer a permission: a gate's server runs what was asked or refuses it; an agent's terminal gets the keys for it. */
export async function answerAsk(e: InboxEvent, answer: "approve" | "deny") {
  set(getEvents().events.map((x) => (x.id === e.id ? { ...x, answer, read: true, kept: undefined } : x)))
  try {
    if (e.gate) await post(`inbox/events/${encodeURIComponent(e.id)}/answer`, { answer })
    else await op("inbox.answer", { id: e.id, answer })
  } catch (err) {
    set(getEvents().events.map((x) => (x.id === e.id ? e : x)))
    throw err
  }
}

/** Forget one event, or all of them. */
export function forget(id?: string) {
  const before = getEvents().events
  set(id ? getEvents().events.filter((e) => e.id !== id) : [])
  const p = del(id ? `inbox/events/${encodeURIComponent(id)}` : "inbox/events")
  p.catch(undo(before, "Couldn't dismiss it"))
  return p
}

/** A change made at once that the server refused: the list as it was, and why. */
const undo = (before: InboxEvent[], what: string) => (e: unknown) => { set(before); notifyError(e, what) }

// ---------- where an event leads

/** The agent an event is about (its source names one), or null. */
export const agentOf = (e: InboxEvent, agents: Agent[] = agentsOn()) => agents.find((a) => a.name === e.source) ?? null

/** What a click on it opens, as a tab's target: its link, else a session's sheet (its answer, the reply), else the
 *  app's terminal it ran in (on a computer, with the Terminal on), else its agent's session (`AgentDef.session`), or null. */
export function targetOf(e: InboxEvent): string | null {
  if (e.gate) return `detail:${detailPath(GATE_DETAIL, e.id)}`
  if (e.link) return /^(view:|detail:|https?:)/.test(e.link) ? e.link : `file:${e.link.replace(/^file:/, "")}`
  if (isSession(e)) return `detail:${detailPath(SESSION_DETAIL, e.id)}`
  return viewOf(e)
}

/** Where its agent is: the app's terminal it runs in (on a computer, with the Terminal on), else its session's view. */
export function viewOf(e: InboxEvent): string | null {
  const a = agentOf(e)
  if (e.terminal && isDesktop() && canRunAgents()) return `view:terminal/${e.terminal}`
  if (e.session && a?.session) return `view:${a.session}/${onMachine(e.session, e.machine)}`
  return null
}

/** Open what it's about (and mark it read, unless it's a permission still to answer: its sheet has the buttons). */
export function openEvent(e: InboxEvent) {
  if (!answerable(e)) markRead([e.id])
  const to = targetOf(e)
  if (!to) return
  if (/^https?:/.test(to)) window.open(to, "_blank", "noopener")
  else if (to.startsWith("view:")) openView(to, { newTab: !isViewOpen(to) })
  else if (to.startsWith("detail:")) openDetail(to.slice(7))
  else openFile(to.slice(5))
}

/** The focused tab's target ("view:terminal/abc"), to tell whether the user is looking at what an event is about. */
export function focusedTarget(layout: TabLayout = getTabLayout()): string {
  const walk = (n: TabLayout["root"]): string | null => {
    if ("kids" in n) { for (const k of n.kids) { const t = walk(k); if (t !== null) return t } return null }
    return n.id === layout.focus ? n.tabs.find((t) => t.id === n.active)?.to ?? "" : null
  }
  return walk(layout.root) ?? ""
}
