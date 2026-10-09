// The Inbox's events in the app: one socket while the plugin is on; changes apply here at once and the server's answer
// comes back over the socket.
import { agentsOn, canRunAgents, del, detailPath, getTabLayout, isDesktop, isViewOpen, notifyError, onMachine, openDetail, openFile, openView, post, type Agent, type TabLayout } from "@vaultite"
import type { InboxEvent } from "./types"

export type Events = { events: InboxEvent[]; unread: number; ready: boolean }
/** The sheet of a permission the server waits on (Inbox.tsx's GateSheet): inbox-gate/<event id>. */
export const GATE_DETAIL = "inbox-gate"
let state: Events = { events: [], unread: 0, ready: false }
const subs = new Set<() => void>()
const fresh = new Set<(e: InboxEvent) => void>()

export const getEvents = () => state
export function subscribeEvents(fn: () => void) { subs.add(fn); return () => { subs.delete(fn) } }
/** Hear each new event (or one updated with news: the same thing again), but not the ones there when the app loads. */
export function onFresh(fn: (e: InboxEvent) => void) { fresh.add(fn); return () => { fresh.delete(fn) } }

function set(events: InboxEvent[]) {
  state = { events, unread: events.filter((e) => !e.read).length, ready: true }
  subs.forEach((f) => f())
}

// ---------- the socket

let sock: WebSocket | null = null
let users = 0
let retry = 0
let timer: ReturnType<typeof setTimeout> | null = null
/** Each event's time as last heard (an update is news again); null until the first list. */
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
    seen = new Map(msg.events.map((e) => [e.id, e.t]))
    set(msg.events)
    if (!before) return
    for (const e of [...msg.events].reverse()) {
      if (!e.read && (before.get(e.id) ?? -1) < e.t && Date.now() - e.t < STALE) fresh.forEach((f) => f(e))
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
  if (!state.events.some((e) => !e.read && (!want || want.has(e.id)))) return
  const before = state.events
  set(state.events.map((e) => (!e.read && (!want || want.has(e.id)) ? { ...e, read: true, kept: undefined } : e)))
  void post("inbox/events/read", ids ? { ids } : {}).catch(undo(before, "Couldn't mark it read"))
}

/** Mark events unread by hand: they stay so while the Inbox is seen, until opened or marked read. */
export function markUnread(ids: string[]) {
  const want = new Set(ids)
  const before = state.events
  set(state.events.map((e) => (want.has(e.id) ? { ...e, read: false, kept: true } : e)))
  void post("inbox/events/unread", { ids }).catch(undo(before, "Couldn't mark it unread"))
}

/** Seeing the Inbox reads what's new, but not what the user marked unread. */
export function markSeen() {
  const ids = state.events.filter((e) => !e.read && !e.kept).map((e) => e.id)
  if (ids.length) markRead(ids)
}

/** Answer a permission the server waits on (a gate): the server runs what was asked, or refuses it. */
export async function answerGate(e: InboxEvent, answer: "approve" | "deny") {
  set(state.events.map((x) => (x.id === e.id ? { ...x, answer, read: true, kept: undefined } : x)))
  try {
    await post(`inbox/events/${encodeURIComponent(e.id)}/answer`, { answer })
  } catch (err) {
    set(state.events.map((x) => (x.id === e.id ? e : x)))
    throw err
  }
}

/** Forget one event, or all of them. */
export function forget(id?: string) {
  const before = state.events
  set(id ? state.events.filter((e) => e.id !== id) : [])
  const p = del(id ? `inbox/events/${encodeURIComponent(id)}` : "inbox/events")
  p.catch(undo(before, "Couldn't dismiss it"))
  return p
}

/** A change made at once that the server refused: the list as it was, and why. */
const undo = (before: InboxEvent[], what: string) => (e: unknown) => { set(before); notifyError(e, what) }

// ---------- where an event leads

/** The agent an event is about (its source names one), or null. */
export const agentOf = (e: InboxEvent, agents: Agent[] = agentsOn()) => agents.find((a) => a.name === e.source) ?? null

/** What a click on it opens, as a tab's target: its link, else the app's terminal it ran in (on a computer, with the
 *  Terminal on), else its agent's session (`AgentDef.session`), or null. */
export function targetOf(e: InboxEvent): string | null {
  if (e.gate) return `detail:${detailPath(GATE_DETAIL, e.id)}`
  if (e.link) return /^(view:|detail:|https?:)/.test(e.link) ? e.link : `file:${e.link.replace(/^file:/, "")}`
  const a = agentOf(e)
  if (e.terminal && isDesktop() && canRunAgents()) return `view:terminal/${e.terminal}`
  if (e.session && a?.session) return `view:${a.session}/${onMachine(e.session, e.machine)}`
  return null
}

/** Open what it's about (and mark it read). */
export function openEvent(e: InboxEvent) {
  markRead([e.id])
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
