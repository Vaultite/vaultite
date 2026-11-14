import { useMemo } from "react"
import { agentsOn, canRunAgents, cell, clickOpening, del, detailPath, fetchMachines, focusedPane, get, getTabLayout, haptic, shownTab, isDesktop, isOutside, isViewOpen, notify, notifyError, onMachine, op, openAgent, openDetail, openFile, openOutside, openView, openWebLink, post, splitMachine, type Agent, type TabLayout } from "@vaultite"
import { snoozed, snoozeMs } from "./snooze"
import { isMessage, waitsOnYou } from "./threads"
import type { InboxEvent } from "./types"

export type Hold = { until: string; from: string; label?: string }
export type Events = { events: InboxEvent[]; unread: number; needs: number; ready: boolean; hold: Hold | null }
export const GATE_DETAIL = "inbox-gate"
export const SESSION_DETAIL = "inbox-session"
const state = cell<Events>({ events: [], unread: 0, needs: 0, ready: false, hold: null })
const fresh = new Set<(e: InboxEvent) => void>()

export const { get: getEvents, subscribe: subscribeEvents, use: useEvents } = state
export const heldNow = (h = state.get().hold) => (h && snoozeMs(h.until) > Date.now() ? h : null)
export function onFresh(fn: (e: InboxEvent) => void) { fresh.add(fn); return () => { fresh.delete(fn) } }

function set(events: InboxEvent[], hold = state.get().hold) {
  state.set({ events, unread: events.filter((e) => !e.read).length, needs: events.filter((e) => waitsOnYou(e) && !snoozed(e.snoozed)).length, ready: true, hold })
}

let sock: WebSocket | null = null
let users = 0
let retry = 0
let timer: ReturnType<typeof setTimeout> | null = null
let seen: Map<string, number> | null = null
const STALE = 2 * 60_000

function open() {
  timer = null
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/inbox/live`)
  sock = ws
  ws.onopen = () => { retry = 0 }
  ws.onmessage = (m) => {
    let msg: { t?: string; events?: InboxEvent[]; hold?: Hold | null }
    try { msg = JSON.parse(String(m.data)) } catch { return }
    if (msg.t !== "events" || !Array.isArray(msg.events)) return
    const before = seen
    seen = new Map(msg.events.map((e) => [e.id, e.nt ?? 0]))
    set(msg.events, msg.hold ?? null)
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

export function markRead(ids?: string[]) {
  const want = ids ? new Set(ids) : null
  if (!getEvents().events.some((e) => !e.read && (!want || want.has(e.id)))) return
  const before = getEvents().events
  set(getEvents().events.map((e) => (!e.read && (!want || want.has(e.id)) ? { ...e, read: true, kept: undefined, ...(isMessage(e) && e.state === "open" && !e.pinned ? { state: "done" as const } : {}) } : e)))
  void post("inbox/events/read", ids ? { ids } : {}).catch(undo(before, "Couldn't mark it read"))
}

export function markUnread(ids: string[]) {
  const want = new Set(ids)
  const before = getEvents().events
  set(getEvents().events.map((e) => (want.has(e.id) ? { ...e, read: false, kept: true, snoozed: undefined, ...(isMessage(e) && !e.gate ? { state: "open" as const } : {}) } : e)))
  void post("inbox/events/unread", { ids }).catch(undo(before, "Couldn't mark it unread"))
}

export function markEventsDone(ids: string[], done = true) {
  const want = new Set(ids)
  const before = getEvents().events
  set(before.map((e) => (!want.has(e.id) ? e : done ? { ...e, state: "done" as const, read: true, kept: undefined, snoozed: undefined, questions: undefined, pinned: undefined }
    : e.state === "done" ? { ...e, state: "open" as const } : e)))
  return Promise.all(ids.map((id) => op("inbox.settle", { item: id, ...(done ? {} : { undo: true }) }))).then(() => true, (e) => { undo(before, done ? "Couldn't settle it" : "Couldn't bring it back")(e); return false })
}

export function unsettle(evs: InboxEvent[]) {
  const pinned = evs.filter((e) => e.pinned).map((e) => e.id)
  return markEventsDone(evs.map((e) => e.id), false).then((ok) => { if (ok && pinned.length) pinEvents(pinned, true) })
}

export const snoozable = (e: InboxEvent) => !e.gate && !e.stays && e.state !== "done" && !(e.state === "open" && e.ask === "permission")

export function snoozeEvents(ids: string[], until: number | null) {
  const want = new Set(ids)
  const before = getEvents().events
  set(before.map((e) => (!want.has(e.id) || e.gate || e.state === "done" || (until !== null && !snoozable(e)) ? e : until !== null ? { ...e, snoozed: until }
    : e.snoozed ? { ...e, state: "open" as const, read: false, snoozed: undefined, t: Date.now() } : e)))
  void post("inbox/events/snooze", { ids, until }).catch(undo(before, "Couldn't snooze it"))
}

export function pinEvents(ids: string[], on: boolean) {
  const want = new Set(ids)
  const before = getEvents().events
  set(before.map((e) => (!want.has(e.id) || (on && e.state === "done") ? e
    : { ...e, pinned: on || undefined, ...(!on && isMessage(e) && !e.gate && e.read && e.state === "open" ? { state: "done" as const } : {}) })))
  void post("inbox/events/pin", { ids, pinned: on }).catch(undo(before, on ? "Couldn't pin it" : "Couldn't unpin it"))
}

export function markSeen() {
  const ids = getEvents().events.filter((e) => !e.read && !e.kept && isMessage(e) && !snoozed(e.snoozed)).map((e) => e.id)
  if (ids.length) markRead(ids)
}

export const answerable = (e: InboxEvent) => e.state === "open" && (e.gate ? !e.answer : !isMessage(e) && e.ask === "permission" && !!(e.terminal || e.host))

export const isSession = (e: InboxEvent) => e.kind === "session"

export const threadTitle = (s: { title: string; terminal?: string; session?: string }, events = getEvents().events) => events.find((x) => x.kind === "session" && !x.machine &&
  ((!!s.terminal && x.terminal === s.terminal) || (!!s.session && x.session === s.session)))?.title ?? s.title

export const openAsker = (e: InboxEvent) => {
  const f = e.from
  if (!f) return
  void openSession({ terminal: f.terminal, session: f.session, agent: f.agent, machine: e.machine, host: !f.terminal }).catch((err) => notifyError(err, "Couldn't open it"))
}

export async function openSession({ terminal = "", session = "", agent = "", machine = "", host = false }: { terminal?: string; session?: string; agent?: string; machine?: string; host?: boolean }) {
  const ms = await fetchMachines()
  const [bare, at] = splitMachine(terminal)
  const there = at || (machine && ms.some((m) => m.id === machine && !m.self) ? machine : "")
  const view = agentsOn().find((a) => a.name === agent)?.session
  if (host && session && view) { openView(`view:${view}/${onMachine(session, there)}`, { newTab: true }); return }
  const { sessions } = await get<{ sessions: { id: string }[] }>(there ? `machines/${encodeURIComponent(there)}/terminals/sessions` : "terminals/sessions")
  if (bare && sessions.some((s) => s.id === bare)) openView(`terminal/${onMachine(bare, there)}`, { newTab: true })
  else if (session && agent) openAgent(agent, { resume: session, machine: there })
  else notify("Its terminal has ended, and it names no session to resume")
}

export function fixEvent(e: InboxEvent) {
  if (!e.fix) return
  haptic("medium")
  void post<{ text: string }>(`inbox/events/${encodeURIComponent(e.id)}/fix`, {}).then((r) => notify(r.text), (err) => notifyError(err, `Couldn't ${e.fix!.label.toLowerCase()} it`))
}

export async function answerAsk(e: InboxEvent, answer: "approve" | "deny") {
  set(getEvents().events.map((x) => (x.id === e.id ? { ...x, answer, read: true, kept: undefined, state: e.gate ? "done" as const : "working" as const } : x)))
  try {
    if (e.gate) await post(`inbox/events/${encodeURIComponent(e.id)}/answer`, { answer })
    else await op("inbox.answer", { id: e.id, answer })
  } catch (err) {
    set(getEvents().events.map((x) => (x.id === e.id ? e : x)))
    throw err
  }
}

export function forget(id?: string) {
  const before = getEvents().events
  set(id ? getEvents().events.filter((e) => e.id !== id) : [])
  const p = del(id ? `inbox/events/${encodeURIComponent(id)}` : "inbox/events")
  p.catch(undo(before, "Couldn't dismiss it"))
  return p
}

const undo = (before: InboxEvent[], what: string) => (e: unknown) => { set(before); notifyError(e, what) }

export const agentOf = (e: InboxEvent, agents: Agent[] = agentsOn()) => agents.find((a) => a.name === e.source) ?? null

export function targetOf(e: InboxEvent): string | null {
  if (e.gate) return `detail:${detailPath(GATE_DETAIL, e.id)}`
  if (e.link) return /^(view:|detail:|https?:)/.test(e.link) ? e.link : `file:${e.link.replace(/^file:/, "")}`
  if (isSession(e)) return `detail:${detailPath(SESSION_DETAIL, e.id)}`
  return viewOf(e)
}

export function viewOf(e: InboxEvent): string | null {
  const a = agentOf(e)
  if (e.terminal && isDesktop() && canRunAgents()) return `view:terminal/${e.terminal}`
  if (e.session && a?.session) return `view:${a.session}/${onMachine(e.session, e.machine)}`
  return null
}

export function openEvent(e: InboxEvent) {
  if (!answerable(e)) markRead([e.id])
  const to = targetOf(e)
  if (!to) return
  const tab = to.startsWith("detail:") && clickOpening() ? viewOf(e) : null
  if (/^https?:/.test(to) || /^view:web\/https?:/.test(to)) openWebLink(to.replace(/^view:web\//, ""))
  else if (tab || to.startsWith("view:")) openView(tab ?? to, { newTab: !isViewOpen(tab ?? to) })
  else if (to.startsWith("detail:")) openDetail(to.slice(7))
  else if (isOutside(to.slice(5))) void openOutside(to.slice(5))
  else openFile(to.slice(5))
}

export function focusedTarget(layout: TabLayout = getTabLayout()): string {
  const t = shownTab(layout)
  return t ? focusedPane(t).to : ""
}

export function useProgress(): Map<string, string> {
  const { events } = useEvents()
  return useMemo(() => {
    const m = new Map<string, string>()
    for (const e of events) {
      if (e.kind !== "session" || e.state === "done" || !e.progress) continue
      if (e.terminal) m.set(e.terminal, e.progress)
      if (e.session) m.set(e.session, e.progress)
    }
    return m
  }, [events])
}
