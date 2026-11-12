import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { WebSocket } from "ws"
import { HTTPError } from "../../../core/plugins.ts"
import { archiveTwin, type Item, str, writeAtomic } from "../../../core/vault.ts"
import { asThreads, BLOCKED, byThread, doneAs, type InboxEvent, pinnedAs, previewOf, readThere, snoozedAs, type State, unreadThere } from "./model.ts"
import { pushed, refreshWidgets } from "./phone.ts"
import { clip, DAY, dir, FOLDER, holdNow, MAX, MERGE, plugin, settings, TERMINAL } from "./server.ts"
import { snoozed } from "./snooze.ts"
import { waitsOnYou } from "./threads.ts"

let events: InboxEvent[] | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

export function list(): InboxEvent[] {
  if (events) return events
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir(), "events.json"), "utf8"))
    events = Array.isArray(data.events) ? data.events.filter((e: InboxEvent) => e && typeof e.id === "string") : []
    if (data.v !== VERSION) { events = asThreads(Number(data.v) >= 2 ? events! : byThread(events!)); save() }
  } catch {
    events = []
  }
  return events!
}

/** events.json's shape: 3, every event with its state, a session's row its thread (kind session). */
const VERSION = 3

export function prune(es: InboxEvent[]) {
  const since = Date.now() - settings().keep * DAY
  let done = 0
  return es.filter((e) => e.state !== "done" || (e.t >= since && ++done <= MAX))
}

function save() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      fs.mkdirSync(dir(), { recursive: true })
      writeAtomic(path.join(dir(), "events.json"), JSON.stringify({ v: VERSION, events: list() }))
    } catch (e) { console.error("inbox:", e) }
  }, 200)
}

export const shown = (local = false) => current(local || !remotes.size ? list() : [...list(), ...[...remotes.values()].flatMap((r) => r.events)].sort((a, b) => b.t - a.t))

export const fileOf = (link?: string) => (link && !/^(view:|detail:|https?:)/.test(link) ? link.replace(/^file:/, "") : null)

/** Events whose link is a result that's been archived or brought back since (one another machine keeps, or one from
 *  before its move here), linking where it is now. */
function current(es: InboxEvent[]): InboxEvent[] {
  if (!plugin.loaded || !es.some((e) => fileOf(e.link)?.startsWith(`${FOLDER}/`))) return es
  const ids = new Set(plugin.vault.items("inbox").map((r) => `${r.id}.md`))
  return es.map((e) => {
    const f = fileOf(e.link)
    return f && !ids.has(f) && ids.has(archiveTwin(f)) ? { ...e, link: archiveTwin(f) } : e
  })
}

export const threadOf = (r: Item) => shown().find((e) => e.state !== "done" && fileOf(e.link) === `${r.id}.md`) ?? null

export const unread = (local = false) => shown(local).filter((e) => !e.read).length
export const needing = (local = false) => shown(local).filter((e) => waitsOnYou(e) && !snoozed(e.snoozed)).length

export function changed(next: InboxEvent[]) {
  events = prune(next)
  save()
  watchAsks()
  broadcast()
  // The phone's agents widget shows what waits on the user: only a change there reloads it.
  const now = list().filter(waitsOnYou).map((e) => e.id).join()
  if (now !== waitingSeen) { waitingSeen = now; refreshWidgets() }
}
let waitingSeen = ""

/** An event as given (the API's body, a hook's), checked; its title one line and its body as written, both whole (the
 *  event is their only copy). Throws a 400 for one without a title. */
export function eventOf(b: Item): Omit<InboxEvent, "id" | "t"> {
  const title = clip(b.title)
  if (!title) throw new HTTPError(400, "title: what happened, one line")
  if (b.kind === "session") throw new HTTPError(400, "kind: a coding agent's session tells its state to inbox/sessions (vau docs inbox)")
  const e: Omit<InboxEvent, "id" | "t"> = {
    source: clip(b.source, 40).toLowerCase() || "vau",
    kind: /^[a-z][a-z-]{0,19}$/.test(str(b.kind)) ? str(b.kind) : "info",
    state: "open", title,
  }
  const body = str(b.body).trim()
  if (body) e.body = body
  const link = str(b.link).trim()
  if (link && link.length <= 1000) e.link = link
  if (TERMINAL.test(str(b.terminal))) e.terminal = str(b.terminal)
  const session = clip(b.session, 120)
  if (session) e.session = session
  if (ASKS.includes(str(b.ask))) e.ask = str(b.ask)
  const key = clip(b.key, 60)
  if (key) e.key = key
  return e
}

const ASKS = ["permission", "question", "auth", "plan", "reply", "answer", "report", "error"]
export const newId = (now: number) => `${now.toString(36)}-${crypto.randomBytes(3).toString("hex")}`

export function addEvent(given: Omit<InboxEvent, "id" | "t">): InboxEvent {
  const now = Date.now()
  const es = list().filter((e) => !given.key || !sameKey(e, given.source, given.key))
  // A browser's session (claude.ai's, by its address) is one row however often it's told: finishing a turn is its
  // progress, quietly (a looping session finishes one an hour); needing the user opens it again.
  if (given.session && /^https?:/.test(given.session) && (given.kind === "done" || given.kind === "waiting") && !given.gate) {
    const was = es.find((e) => !e.gate && e.source === given.source && e.session === given.session && (e.kind === "done" || e.kind === "waiting")) ?? null
    const quiet = given.kind === "done"
    const e: InboxEvent = { ...(was ?? {}), ...given, id: was?.id ?? newId(now), t: now, state: quiet ? "done" : "open", read: quiet, body: given.body ?? was?.body, link: given.link ?? was?.link }
    if (e.body) e.preview = previewOf(e.body)
    return put(e, was, es, !quiet)
  }
  // (a message, `vau notify`'s, only with the same words: a few told in a row from one terminal each show)
  const who = (e: Omit<InboxEvent, "id" | "t">) => `${e.session || e.terminal || ""}\0${e.title}`
  const same = es.find((e) => e.state === "open" && now - e.t < MERGE && e.source === given.source && e.kind === given.kind && who(e) === who(given))
  const e: InboxEvent = same
    ? { ...same, ...given, id: same.id, t: now, read: false, terminal: given.terminal ?? same.terminal, session: given.session ?? same.session, body: given.body ?? same.body, link: given.link ?? same.link }
    : { id: newId(now), t: now, ...given }
  if (e.body) e.preview = previewOf(e.body)
  return put(e, same ?? null, es, true)
}

export function put(e: InboxEvent, old: InboxEvent | null, es: InboxEvent[], news: boolean): InboxEvent {
  if (e.read) delete e.kept
  // (settled is unpinned, however it got there: the user, or a quiet turn)
  if (e.state === "done") delete e.pinned
  if (news && e.state === "open") delete e.snoozed
  if (news && e.state === "open" && !e.read && !holdNow() && mayTell(old, e)) e.nt = e.t
  changed([e, ...es.filter((x) => x !== old)])
  told(e)
  if (e.nt === e.t) pushed(e)
  return e
}

/** How often the user is told: the same need of one row once a minute while unread, and six sessions a minute at most
 *  (a burst of agents finishing at once is listed, not rung; a message sent on purpose, `vau notify`'s, always is). */
const TELL_GAP = 60_000, TELL_BURST = 6
const toldAt: number[] = []
function mayTell(old: InboxEvent | null, e: InboxEvent) {
  const now = Date.now()
  if (old?.nt && old.state === "open" && !old.read && !old.snoozed && old.ask === e.ask && now - old.nt < TELL_GAP) return false
  if (!(e.terminal || e.session) || e.gate) return true
  while (toldAt.length && now - toldAt[0] > 60_000) toldAt.shift()
  if (toldAt.length >= TELL_BURST) return false
  toldAt.push(now)
  return true
}

export const sameKey = (e: InboxEvent, source: string, key: string) => e.source === source && e.key === key

export function dropEvent(source: string, key: string) {
  const es = list()
  if (es.some((e) => sameKey(e, source, key))) changed(es.filter((e) => !sameKey(e, source, key)))
}

/** The vault's events hear of it (`inbox.event`: core/events.ts), so an agent or a script can wait for another agent
 *  to finish or ask something (`vau events --type inbox.event`, the op events.wait). */
export function told(e: InboxEvent) {
  try {
    plugin.emit("inbox.event", { id: e.id, kind: e.kind, state: e.state, source: e.source, title: e.title, ...(e.terminal ? { terminal: e.terminal } : {}),
      ...(e.session ? { session: e.session } : {}), ...(e.link ? { link: e.link } : {}), ...(e.ask ? { ask: e.ask, body: e.body ?? "" } : {}) })
  } catch { /* not loaded by an App (a test calling it alone) */ }
}

export function markRead(ids: Set<string> | null) {
  let n = 0
  const next = list().map((e) => (e.read || (ids && !ids.has(e.id)) ? e : (n++, readThere(e))))
  if (n) changed(next)
  return n
}

export function markUnread(ids: Set<string>) {
  let n = 0
  const next = list().map((e) => (ids.has(e.id) && (e.read || !e.kept) ? (n++, unreadThere(e)) : e))
  if (n) changed(next)
  return n
}

export function markDone(ids: Set<string>, done = true) {
  let n = 0
  const next = list().map((e) => (ids.has(e.id) && (done ? e.state !== "done" : e.state === "done") ? (n++, doneAs(e, done)) : e))
  if (n) changed(next)
  return n
}

/** Set rows' state (and more: `patch`) quietly, as their session moved on: working is the user's answer, so it's read. */
export function moveOn(hit: InboxEvent[], state: State, patch: Partial<InboxEvent> = {}) {
  if (!hit.length) return
  const to = (e: InboxEvent): InboxEvent => { const { kept: _, ...rest } = state === "done" ? doneAs(e, true) : e; return { ...rest, state, read: true, ...patch } }
  changed(list().map((e) => (hit.includes(e) ? to(e) : e)))
  for (const e of list()) if (hit.some((h) => h.id === e.id)) told(e)
}

/** A permission asked in a terminal here that no longer waits ("terminal:waits") was answered: its agent goes on, or
 *  its terminal is gone (done). Checked every few seconds, a new one left to show first. */
const ASKED = 5000
const asked = (e: InboxEvent) => e.state === "open" && e.kind === "session" && e.ask === "permission" && !!e.terminal && !e.terminal.includes("@")
export async function stillWaiting(after = ASKED) {
  const waits = plugin.service("terminal:waits")
  if (!waits) return
  const on: string[] = [], gone: string[] = []
  for (const e of list()) {
    if (!asked(e) || Date.now() - e.t < after) continue
    if (await waits(e.terminal!, e.source)) continue
    ;(await plugin.ask("terminal:info", null, e.terminal!).catch(() => null) ? on : gone).push(e.id)
  }
  moveOn(list().filter((e) => on.includes(e.id)), "working")
  moveOn(list().filter((e) => gone.includes(e.id)), "done")
}
// (only while one is asked: every 5 s with none, it woke an idle server for nothing)
let waitTimer: ReturnType<typeof setInterval> | null = null
function watchAsks() {
  if (waitTimer || !list().some(asked)) return
  waitTimer = setInterval(() => {
    if (!list().some(asked)) { clearInterval(waitTimer!); waitTimer = null } else if (plugin.loaded) void stillWaiting().catch(() => {})
  }, ASKED)
  waitTimer.unref?.()
}

/** Its question answered (blocked, then working; `to` done: refused), or the user wrote to it (`user`): its open thread
 *  is working. Not for an answer it left: it may go on by itself (a background task), which isn't the user's doing. */
export function resolve(terminal: string, session: string, user = false, to: State = "working") {
  moveOn(list().filter((e) => e.kind === "session" && e.state === "open" && (user ? e.ask !== "report" : BLOCKED.has(str(e.ask))) &&
    ((terminal && e.terminal === terminal) || (session && e.session === session))), to, { questions: undefined })
}

export const watchers = new Map<WebSocket, boolean>() // socket -> this machine's events only
let sendTimer: ReturnType<typeof setTimeout> | null = null

export const message = (local: boolean) => JSON.stringify({ t: "events", events: shown(local), unread: unread(local), needs: needing(local), hold: holdNow() })

let mineChanged = false
/** Tell the watchers (within 30 ms). `mine`: this machine's events changed; else only the followed machines' did, which
 *  the other machines (local=1) aren't told: telling them made two machines that follow each other echo forever. */
export function broadcast(mine = true) {
  if (!watchers.size) return
  mineChanged ||= mine
  if (sendTimer) return
  sendTimer = setTimeout(() => {
    sendTimer = null
    const toLocal = mineChanged
    mineChanged = false
    const text = new Map<boolean, string>()
    for (const [ws, local] of watchers) {
      if (ws.readyState !== ws.OPEN || (local && !toLocal)) continue
      if (!text.has(local)) text.set(local, message(local))
      ws.send(text.get(local)!)
    }
  }, 30)
}

export const remotes = new Map<string, { sock: WebSocket; events: InboxEvent[]; raw?: string }>()

export function pin(ids: Set<string>, on: boolean) {
  for (const old of list().filter((e) => ids.has(e.id) && !!e.pinned !== on)) put(pinnedAs(old, on), old, list(), false)
}

/** Snooze these events, or (null) bring them back now: the user did, so it's no news. */
export function snooze(ids: Set<string>, until: number | null) {
  for (const old of list().filter((e) => ids.has(e.id))) {
    const e = snoozedAs(old, until)
    if (e) put(e, old, list(), false)
  }
}

/** Who waits on a gate's answer, by its event's id (in memory: after a restart the answer is still on the event). */
export const gates = new Map<string, Set<(answer: "approve" | "deny") => void>>()

export function gateAnswer(id: string, ms = 0): Promise<"approve" | "deny" | "waiting" | "gone"> {
  const e = list().find((x) => x.id === id)
  if (!e?.gate) return Promise.resolve("gone")
  if (e.answer || ms <= 0) return Promise.resolve(e.answer ?? "waiting")
  return new Promise((done) => {
    const set = gates.get(id) ?? new Set()
    gates.set(id, set)
    const settle = (a: "approve" | "deny" | "waiting") => {
      clearTimeout(timer)
      set.delete(settle)
      if (!set.size) gates.delete(id)
      done(a)
    }
    const timer = setTimeout(() => settle("waiting"), ms)
    set.add(settle)
  })
}

export function register() {
  plugin.onUnload(() => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null } })

  setTimeout(watchAsks, 0).unref?.()
  plugin.onUnload(() => { if (waitTimer) clearInterval(waitTimer) })

  /** A terminal ended: what its agent worked on is done; one the user ended (End session) was dealt with, one that ended
   *  by itself (crashed, exited) keeps what's to read. A report stays open: the reply resumes its session. */
  plugin.onEvent({ types: ["terminal.ended"] }, (ev) => {
    if (typeof ev.id !== "string") return
    moveOn(list().filter((e) => e.kind === "session" && !e.machine && e.terminal === ev.id &&
      (e.state === "working" || (e.state === "open" && ev.onPurpose === true && e.ask !== "report"))), "done")
  })

  plugin.onUnload(() => { if (sendTimer) clearTimeout(sendTimer); for (const ws of watchers.keys()) ws.close() })
}
