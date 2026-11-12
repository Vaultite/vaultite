// Inbox: what agents tell the user. Events stay on this machine (iCloud would churn), shown with the other machines' as
// one inbox; results are Inbox/ files. A session is one thread (open, working, done), its report file its record.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { type RawData, WebSocket } from "ws"
import { type Asking, choiceOf, type Question, startAgent, TERMINAL_AGENT, agentIn, agentName, newTerminalId, parseTerminal, resumeTerminalId, type SampleAsk } from "../../../core/agents.ts"
import {
  bullets, fmtAgo, stampMs, HTTPError, LOADED, localDate, localTime, MACHINE_CLIENT, machineSocket, OpError, Plugin, quoted, reply, splitMachine,
  type Machine, NOT_THE_USER, type OpCtx, type Request, userSurface, whoOf,
} from "../../../core/plugins.ts"
import { archiveTwin, inArchive, isArchived, type Item, Kind, localStamp, nowStamp, requestWriter, safeName, sortBy, str, truthy, writeAtomic } from "../../../core/vault.ts"
import { answerOf, type DecisionSpec, overlap, sameQuestion, specOf } from "./decisions.ts"
import { judge, type Need, type Turn } from "./needs.ts"
import * as push from "./push.ts"
import { parseUntil, snoozed, snoozeMs, stampOf, whenText } from "./snooze.ts"
import { isMessage, lists, waitsOnYou } from "./threads.ts"
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const plugin = new Plugin(import.meta.url)

const FOLDER = "Inbox"
const MAX = 200 // done events kept: the rest stay until they're done
const MERGE = 60_000 // the same thing again within this long updates the event
const DAY = 86_400_000

// ---------- results: Inbox/<Title>.md

const STATUSES = ["new", "done"]

plugin.kind(new Kind({
  type: "inbox", collection: "inbox", folder: FOLDER,
  parse(fm, body, stem) {
    const status = truthy(fm.status) ? str(fm.status) : "new"
    return [{
      title: truthy(fm.title) ? str(fm.title) : stem, status, from: truthy(fm.from) ? str(fm.from) : "",
      source: truthy(fm.source) ? str(fm.source) : "", created: fm.created ?? null, updated: fm.updated ?? null, origin: truthy(fm.origin) ? str(fm.origin) : "",
      agent: truthy(fm.agent) ? str(fm.agent) : "", session: truthy(fm.session) ? str(fm.session) : "", terminal: truthy(fm.terminal) ? str(fm.terminal) : "",
      machine: truthy(fm.machine) ? str(fm.machine) : "", snoozed: truthy(fm.snoozed) ? str(fm.snoozed) : null, pinned: fm.pinned === true, do: truthy(fm.do) ? str(fm.do) : "", body,
      work: truthy(fm.work) ? str(fm.work) : "",
      ...decisionOf(fm), ...(tldrOf(body) ? { tldr: tldrOf(body) } : {}),
    }, STATUSES.includes(status) ? [] : [`status \`${status}\` isn't one of \`new\` or \`done\``]]
  },
  render: (r) => [{ status: r.status || "new", from: r.from || null, source: r.source || null, created: r.created, updated: r.updated || null, origin: r.origin || null,
    agent: r.agent || null, session: r.session || null, terminal: r.terminal || null, machine: r.machine || null, snoozed: r.snoozed || null, pinned: r.pinned === true || null, do: r.do || null,
    work: r.work || null, question: r.question || null, options: truthy(r.question) && Array.isArray(r.options) ? r.options : null,
    effects: truthy(r.question) && Array.isArray(r.effects) && r.effects.some(truthy) ? r.effects : null, default: r.question ? r.default || null : null,
    blocking: r.question ? r.blocking === true : null, answer: r.answer || null, answered: r.answered || null, closed: r.closed || null, report: r.report || null,
    also: Array.isArray(r.also) && r.also.length ? r.also : null, gist: r.question ? r.gist || null : null, where: r.question ? r.where || null : null }, r.body || ""],
  // (a decision's file draws its question and its answers on top)
  blocks: (fm) => (truthy(fm.question) ? ["decisions"] : []),
  // Done is archived and archived is done: one state, the file in Inbox/.archive/ (out of the way), whichever key said
  // so. Taking either back (Back to review, Undo, the same page added again) makes it new, out of the archive.
  prepare(r, old) {
    r.created = r.created || nowStamp()
    r.status = r.status || "new"
    const reopened = old && ((old.status === "done" && r.status === "new") || (isArchived(old) && !isArchived(r)))
    const done = !reopened && (r.status === "done" || isArchived(r))
    if (done) r.status = "done"
    else if (reopened) r.status = "new"
    r.archived = done
    // (what's dealt with isn't waiting to come back, nor kept on top)
    if (done || reopened) r.snoozed = null
    if (done) r.pinned = null
    return r
  },
  // To review first, the latest first (a thread by its last report); then what's dealt with, the last done first. An
  // archived one is dealt with whatever its status says (archived by hand), so it can't bury what was just done.
  order: (rs) => {
    const open = (r: Item) => r.status === "new" && !isArchived(r)
    return [...sortBy(rs.filter(open), latest, true), ...sortBy(rs.filter((r) => !open(r)), (r) => str(r.modified || latest(r)), true)]
  },
  // Where it came from (a page's address): adding the same page again updates it.
  key: (r) => (truthy(r.source) ? str(r.source) : null),
  stamps: ["created", "updated", "snoozed", "answered"],
}))

/** A decision's fields as its frontmatter has them (decisions.ts), or none. */
function decisionOf(fm: Item): Item {
  if (!truthy(fm.question)) return {}
  const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : truthy(v) ? [str(v)] : [])
  return { question: str(fm.question), options: list(fm.options), effects: Array.isArray(fm.effects) ? fm.effects.map(str) : [], default: str(fm.default), blocking: fm.blocking === true, answer: truthy(fm.answer) ? str(fm.answer) : "",
    answered: truthy(fm.answered) ? str(fm.answered) : null, closed: truthy(fm.closed) ? str(fm.closed) : "", report: truthy(fm.report) ? str(fm.report) : "", also: list(fm.also),
    gist: truthy(fm.gist) ? str(fm.gist) : "", where: truthy(fm.where) ? str(fm.where) : "" }
}

/** A result's TL;DR, its `> [!tldr]` callout as one line (kept when the state leaves an archived body out). */
export function tldrOf(body: string, last = false) {
  const ms = [...body.matchAll(/^> \[!tldr\][^\n]*\n((?:>.*(?:\n|$))+)/gm)]
  const m = last ? ms.at(-1) : ms[0]
  return m ? m[1].split("\n").map((l) => l.replace(/^>\s?/, "").trim()).filter(Boolean).join(" ").slice(0, 400) : ""
}

// The app's results: an archived one without its body (a kept inbox's reports were most of a big vault's first load;
// no list reads an archived body, and its file keeps it), the same objects while their files are (core/statepatch.ts).
const slim = new WeakMap<Item, Item>()
let stated: { rs: readonly Item[]; out: Item } | null = null
plugin.state(() => {
  const rs = plugin.vault.shared("inbox")
  if (stated?.rs === rs) return stated.out
  const out = rs.map((r) => {
    if (!isArchived(r) || !r.body) return r
    let s = slim.get(r)
    if (!s) slim.set(r, s = Object.freeze({ ...r, body: "" }))
    return s
  })
  stated = { rs, out: { inbox: Object.freeze(out) } }
  return stated.out
})

/** When a result last had news: its thread's latest report (`updated`), else when it came, or its snooze's end once
 *  that's past (it came back then). */
export const latest = (r: Item) => {
  const at = str(r.updated || r.created || ""), back = str(r.snoozed || "")
  return back > at && !snoozed(back) ? back : at
}

/** Results as the inbox's lists read them (threads.ts). */
type Listed = Item & { id: string; status: string; archived: boolean; snoozed: string | null; created: string | null; updated: string | null; pinned: boolean }
const asResults = (items: Item[]) => items.map((r): Listed => ({ ...r, id: str(r.id), status: str(r.status), archived: isArchived(r),
  snoozed: truthy(r.snoozed) ? str(r.snoozed) : null, created: truthy(r.created) ? str(r.created) : null, updated: truthy(r.updated) ? str(r.updated) : null, pinned: r.pinned === true }))

/** Where results go (where the Inbox's files are, else Inbox/): the clipper asks (its `inbox` option), only while this
 *  plugin is on. */
plugin.provide("inbox:folder", () => plugin.vault.home("inbox") ?? FOLDER)
/** Whether the inbox is held now (inbox.hold; the menu bar's Mute for an hour): the companion says nothing on its own. */
plugin.provide("inbox:held", () => !!holdNow())

// ---------- events, kept on this machine

/** Where an event stands for the user: open (in the inbox: a session or an ask needs them, a message is to read),
 *  working (they answered, its agent is on it) or done (dealt with: kept keep_days, under Done). */
export type State = "open" | "working" | "done"
const STATES: State[] = ["open", "working", "done"]

export type InboxEvent = {
  id: string; t: number
  /** Who: a coding agent's name (claude, codex), or anything that posts ("vau", "backup"). */
  source: string
  /** What: session (a coding agent's session, one thread each), waiting (something asks the user: a permission the
   *  server waits on, a browser's ask, a paused plugin), else a message (info, error, done...: news to read). */
  kind: string
  state: State
  title: string; body?: string
  /** What a click opens: a vault path, a view ("view:terminal/<id>"), a sheet ("detail:review") or a web address. A
   *  session's report (Inbox/<Title>.md) is its record: the thread is listed in its place. */
  link?: string
  /** One of a kind: a new event with its source and key takes the place of the one before (Lessons' "cards due"). */
  key?: string
  /** The app's terminal it happened in, and the agent's session: a click goes there. */
  terminal?: string; session?: string
  /** Its host tells its state and answers it (inbox:session; agent-reply, agent-answer), not a terminal. */
  host?: boolean
  /** Why a session needs the user (needs.ts' Need): permission (to run a tool: Approve and Deny answer it), question,
   *  auth, plan, answer (its last message is for them to read), report (an Inbox/ result: link), error. */
  ask?: string
  /** What a session asks, in its own words (its agent's "agent-asking"): picked from its sheet, or a reply. */
  questions?: Question[]
  /** Its body as one plain line, for what can't draw Markdown (the phone's widgets, the watch, push). */
  preview?: string
  /** The user's last message in the turn that opened it (its start): a quiet turn after another of theirs closes it. */
  turn?: string
  /** When it last told the user (a toast, the Mac's and the phone's notifications): set only when it may, so every app
   *  announces the same news once. */
  nt?: number
  /** A permission the server itself waits on (not a terminal's: the service "inbox:ask", e.g. an app connected to the
   *  MCP asking to run what can run code here), and once answered, the answer. */
  gate?: boolean
  answer?: "approve" | "deny"
  /** Seen: drawn plain rather than bold. Only a message is dealt with by it (done once read). */
  read?: boolean
  /** Marked unread by hand: the Inbox seen doesn't read it, only opening it or marking it read. */
  kept?: boolean
  /** Another machine's (Machines): its id there is `<id>@<machine>` here, its terminal too. */
  machine?: string; machineLabel?: string
  /** Snoozed until then (ms): out of the lists till it comes back unread, on top, told again. News from its session
   *  wakes it. */
  snoozed?: number
  /** Pinned by the user: on top of the inbox whatever it waits on, until it's done or unpinned. */
  pinned?: boolean
  /** The session that delegated this one its task (Delegation), by its name then: the thread says "from" it. */
  parent?: { title: string; agent: string; terminal?: string; session?: string }
  /** The session that asked (a gate's, a waiting ask's made in its request), by its name then: "Go to session" opens it. */
  from?: { title: string; agent: string; terminal?: string; session?: string }
  /** Its latest progress line (inbox.progress), each replacing the last: on its row, never told. */
  progress?: string
}

/** This vault's folder here: <LOCAL>/inbox/<vault key>/ (made when an event is saved). */
const dir = () => plugin.localDir(false)

function settings() {
  const s = plugin.loaded ? plugin.settings({}) : {}
  return { keep: Math.max(1, Number(s.keep_days) || 7), push: ["all", "waiting", "off"].includes(str(s.push)) ? str(s.push) : "waiting",
    audio: s.voice_audio !== false, answers: s.answers === "inbox" ? "inbox" : "quiet",
    muted: (Array.isArray(s.muted) ? s.muted : []).map((x: unknown) => str(x).trim().toLowerCase()).filter(Boolean) as string[],
    dispatch: TERMINAL_AGENT.test(str(s.dispatch).trim()) ? str(s.dispatch).trim() : "",
    prompt: str(s.dispatch_prompt).trim() || str(plugin.manifest.settings?.dispatch_prompt?.default) }
}

let events: InboxEvent[] | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function list(): InboxEvent[] {
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
/** Events from before sessions were rows (one per turn: "Claude Code finished", "… is waiting for you", a report's), as
 *  one row per session: its newest, named after the session (the body those titles had) or the report. */
export function byThread(es: InboxEvent[]): InboxEvent[] {
  const seen = new Set<string>()
  const out: InboxEvent[] = []
  for (const e of [...es].sort((a, b) => b.t - a.t)) {
    const thread = !e.gate && (e.kind === "done" || e.kind === "waiting") && (e.session || e.terminal)
    if (!thread) { out.push(e); continue }
    const k = `${e.source}\0${e.session || e.terminal}`
    if (seen.has(k)) continue
    seen.add(k)
    const reported = /^[^:]{1,40}: (.+)$/.exec(e.link ? e.title : "")
    const turn = / (finished|is waiting for you)$/.test(e.title)
    out.push({ ...e, title: reported ? reported[1] : turn && e.kind === "done" && e.body ? e.body : e.title,
      ...(reported ? { ask: "report" } : turn && e.kind === "done" ? { body: undefined } : {}) })
  }
  return out
}

/** Version 2's events with their state: read had hidden one (dealt with), unread is open. A session's row is its
 *  thread; a browser's session (its page's address) stays the message or ask it was. */
export function asThreads(es: InboxEvent[]): InboxEvent[] {
  return es.map((e) => {
    if (STATES.includes(e.state)) return e
    const session = !e.gate && (e.kind === "waiting" || e.kind === "done") && !!(e.terminal || e.session) && !/^https?:/.test(e.session ?? "")
    const open = e.gate ? !e.answer : !!e.snoozed || (!e.read && !(session && e.kind === "done"))
    const { kept, ...rest } = e
    return { ...rest, kind: session ? "session" : e.kind, state: open ? "open" : "done", ...(open && kept ? { kept } : {}) } as InboxEvent
  })
}

/** Done ones go after keep_days, past the latest MAX; open and working ones stay until they're done. */
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
plugin.onUnload(() => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null } })

/** This machine's events and the other machines' (newest first), or only this one's (`local`: what another machine follows). */
const shown = (local = false) => current(local || !remotes.size ? list() : [...list(), ...[...remotes.values()].flatMap((r) => r.events)].sort((a, b) => b.t - a.t))

// ---------- an event about a result goes where the result went: Done archives it, Back to review brings it back

const fileOf = (link?: string) => (link && !/^(view:|detail:|https?:)/.test(link) ? link.replace(/^file:/, "") : null)

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

/** The thread a result is the record of (a session's report): its event, not done, linking it, on any machine shown. */
export const threadOf = (r: Item) => shown().find((e) => e.state !== "done" && fileOf(e.link) === `${r.id}.md`) ?? null

/** A file moved here (a result done, filed or renamed): this machine's events about it follow it. Archived (done), its
 *  thread is done too, here and on the machine that keeps it; brought back to review, it's open again. */
plugin.onMove((from, to) => {
  if (!to) return
  const at = (link?: string) => { const f = fileOf(link); return f === from ? to : f?.startsWith(`${from}/`) ? to + f.slice(from.length) : null }
  const done = inArchive(to) && !inArchive(from), back = inArchive(from) && !inArchive(to)
  let n = 0
  const next = list().map((e) => {
    const l = at(e.link)
    if (!l) return e
    n++
    return done ? { ...doneAs(e, true), link: l } : back && e.state === "done" ? { ...doneAs(e, false), link: l } : { ...e, link: l }
  })
  if (n) changed(next)
  if (!done) return
  const theirs = [...remotes.values()].flatMap((r) => r.events).filter((e) => e.state !== "done" && at(e.link)).map((e) => e.id)
  for (const [m, some] of byMachine(theirs)) {
    if (m) void onMachine(m, "POST", "inbox/events/done?local=1", { ids: some }, (e) => (isOne(e, some) ? doneAs(e, true) : e)).catch(() => {})
  }
})
const unread = (local = false) => shown(local).filter((e) => !e.read).length
/** What waits on the user, on every machine shown (or this one's): the badge's events. */
const needing = (local = false) => shown(local).filter((e) => waitsOnYou(e) && !snoozed(e.snoozed)).length

function changed(next: InboxEvent[]) {
  events = prune(next)
  save()
  watchAsks()
  broadcast()
  // The phone's agents widget shows what waits on the user: only a change there reloads it.
  const now = list().filter(waitsOnYou).map((e) => e.id).join()
  if (now !== waitingSeen) { waitingSeen = now; refreshWidgets() }
}
let waitingSeen = ""

const clip = (v: unknown, n = Infinity) => str(v).replace(/\s+/g, " ").trim().slice(0, n)
const TERMINAL = /^[\w-]{1,64}(@[a-z0-9][a-z0-9-]{0,62})?$/

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
const newId = (now: number) => `${now.toString(36)}-${crypto.randomBytes(3).toString("hex")}`

/** Add an event, open and unread (or update the same one, still open, from within a minute: a message sent twice).
 *  Returns it. */
function addEvent(given: Omit<InboxEvent, "id" | "t">): InboxEvent {
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

/** Keep event `e` (in place of `old`, at the top of `es`), the user told of it when it's news (it's open for them,
 *  unread) and they may be (nt). News wakes what's snoozed. */
function put(e: InboxEvent, old: InboxEvent | null, es: InboxEvent[], news: boolean): InboxEvent {
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

/** One plain line of Markdown: what a widget, the watch or a push shows. */
export const previewOf = (md: string) => md.replace(/```[\s\S]*?```/g, " ").replace(/!?\[\[([^\]|]*)(\|[^\]]*)?\]\]/g, "$1").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/^\s*(#+|>|[-*+]|\d+\.)\s+/gm, "").replace(/[*_`~]+/g, "").replace(/\s+/g, " ").trim().slice(0, 300)

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

const sameKey = (e: InboxEvent, source: string, key: string) => e.source === source && e.key === key

/** Take away the event with this source and key, if there's one (what it said isn't so anymore). */
function dropEvent(source: string, key: string) {
  const es = list()
  if (es.some((e) => sameKey(e, source, key))) changed(es.filter((e) => !sameKey(e, source, key)))
}

/** The vault's events hear of it (`inbox.event`: core/events.ts), so an agent or a script can wait for another agent
 *  to finish or ask something (`vau events --type inbox.event`, the op events.wait). */
function told(e: InboxEvent) {
  try {
    plugin.emit("inbox.event", { id: e.id, kind: e.kind, state: e.state, source: e.source, title: e.title, ...(e.terminal ? { terminal: e.terminal } : {}),
      ...(e.session ? { session: e.session } : {}), ...(e.link ? { link: e.link } : {}), ...(e.ask ? { ask: e.ask, body: e.body ?? "" } : {}) })
  } catch { /* not loaded by an App (a test calling it alone) */ }
}

/** `e` seen: a message is dealt with by it (done), unless pinned; a session or an ask stays open until it's done. */
const readThere = (e: InboxEvent): InboxEvent => {
  const { kept: _, ...rest } = e
  return { ...rest, read: true, ...(isMessage(e) && e.state === "open" && !e.pinned ? { state: "done" as const } : {}) }
}
/** `e` marked unread by hand (kept so), back if it was snoozed: a message read is open again. */
const unreadThere = (e: InboxEvent): InboxEvent => {
  const { snoozed: _, ...rest } = e
  return { ...rest, read: false, kept: true, ...(isMessage(e) && !e.gate ? { state: "open" as const } : {}) }
}
/** `e` done (dealt with: no longer snoozed, nothing left to pick), or open again (`done` false: Back to inbox). */
const doneAs = (e: InboxEvent, done: boolean): InboxEvent => {
  if (!done) return e.state === "done" ? { ...e, state: "open" } : e
  const { snoozed: _, kept: __, questions: ___, pinned: ____, ...rest } = e
  return { ...rest, state: "done", read: true }
}

/** Mark events read: these ids, or all (null). */
function markRead(ids: Set<string> | null) {
  let n = 0
  const next = list().map((e) => (e.read || (ids && !ids.has(e.id)) ? e : (n++, readThere(e))))
  if (n) changed(next)
  return n
}

/** Mark events unread by hand (kept so). */
function markUnread(ids: Set<string>) {
  let n = 0
  const next = list().map((e) => (ids.has(e.id) && (e.read || !e.kept) ? (n++, unreadThere(e)) : e))
  if (n) changed(next)
  return n
}

/** Mark events done (or, `done` false, open again): these ids. */
function markDone(ids: Set<string>, done = true) {
  let n = 0
  const next = list().map((e) => (ids.has(e.id) && (done ? e.state !== "done" : e.state === "done") ? (n++, doneAs(e, done)) : e))
  if (n) changed(next)
  return n
}

/** Set rows' state (and more: `patch`) quietly, as their session moved on: working is the user's answer, so it's read. */
function moveOn(hit: InboxEvent[], state: State, patch: Partial<InboxEvent> = {}) {
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
setTimeout(watchAsks, 0).unref?.()
plugin.onUnload(() => { if (waitTimer) clearInterval(waitTimer) })

/** A terminal ended: what its agent worked on is done; one the user ended (End session) was dealt with, one that ended
 *  by itself (crashed, exited) keeps what's to read. A report stays open: the reply resumes its session. */
plugin.onEvent({ types: ["terminal.ended"] }, (ev) => {
  if (typeof ev.id !== "string") return
  moveOn(list().filter((e) => e.kind === "session" && !e.machine && e.terminal === ev.id &&
    (e.state === "working" || (e.state === "open" && ev.onPurpose === true && e.ask !== "report"))), "done")
})

/** What an agent asks before it goes on: answered, it works again. */
const BLOCKED = new Set(["permission", "question", "auth", "plan"])

/** Its question answered (blocked, then working; `to` done: refused), or the user wrote to it (`user`): its open thread
 *  is working. Not for an answer it left: it may go on by itself (a background task), which isn't the user's doing. */
function resolve(terminal: string, session: string, user = false, to: State = "working") {
  moveOn(list().filter((e) => e.kind === "session" && e.state === "open" && (user ? e.ask !== "report" : BLOCKED.has(str(e.ask))) &&
    ((terminal && e.terminal === terminal) || (session && e.session === session))), to, { questions: undefined })
}

// ---------- live: /api/inbox/live (?local=1: this machine's events only, what another machine follows)

const watchers = new Map<WebSocket, boolean>() // socket -> this machine's events only
let sendTimer: ReturnType<typeof setTimeout> | null = null

const message = (local: boolean) => JSON.stringify({ t: "events", events: shown(local), unread: unread(local), needs: needing(local), hold: holdNow() })

let mineChanged = false
/** Tell the watchers (within 30 ms). `mine`: this machine's events changed; else only the followed machines' did, which
 *  the other machines (local=1) aren't told: telling them made two machines that follow each other echo forever. */
function broadcast(mine = true) {
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
plugin.onUnload(() => { if (sendTimer) clearTimeout(sendTimer); for (const ws of watchers.keys()) ws.close() })

plugin.socket("inbox/live", (ws, _req, { query }) => {
  const local = !!query.local
  watchers.set(ws, local)
  if (!local) void others().then(() => { if (ws.readyState === ws.OPEN) ws.send(message(false)) })
  else ws.send(message(true))
  ws.on("close", () => watchers.delete(ws))
  alive(ws)
})

/** Sockets that stopped answering are ended: a laptop that slept, or a network that changed, leaves its connection open
 *  on the other end, silent (no close comes). Each is pinged every PING; one that didn't answer the last is dead. */
const PING = 15_000
const answered = new WeakMap<WebSocket, boolean>()
function alive(ws: WebSocket) {
  answered.set(ws, true)
  ws.on("pong", () => answered.set(ws, true))
}
function pingAll(socks: Iterable<WebSocket>) {
  for (const ws of socks) {
    if (ws.readyState !== ws.OPEN) continue
    if (!answered.get(ws)) { ws.terminate(); continue }
    answered.set(ws, false)
    try { ws.ping() } catch { ws.terminate() }
  }
}
const pingTimer = setInterval(() => { pingAll(watchers.keys()); pingAll([...remotes.values()].map((r) => r.sock)) }, PING)
pingTimer.unref?.()
plugin.onUnload(() => clearInterval(pingTimer))

// ---------- the vault's other machines (Machines): their events followed here, so every app shows one inbox; a change
// to one of theirs (`<id>@<machine>`) is made there, which keeps it.

/** Each followed machine's socket and events, as its last list said. */
const remotes = new Map<string, { sock: WebSocket; events: InboxEvent[]; raw?: string }>()
const FOLLOW = 30_000


/** Another machine's event as this one shows it: its id and terminal say whose. */
const theirs = (e: InboxEvent, m: Machine): InboxEvent => ({ ...e, id: `${e.id}@${m.id}`, machine: m.id, machineLabel: m.label,
  ...(e.terminal && !e.terminal.includes("@") ? { terminal: `${e.terminal}@${m.id}` } : {}) })

const machineList = () => plugin.ask<Machine[]>("machines", [])

/** Follow every other machine with the Inbox on (and drop the ones gone); resolves once each new one said its list. */
export async function followMachines() {
  const want = plugin.isOff() ? [] : (await machineList()).filter((m) => !m.self && m.online && m.plugins?.includes(plugin.id))
  for (const [id, r] of remotes) if (!want.some((m) => m.id === id)) { r.sock.terminate(); remotes.delete(id); broadcast(false) }
  await Promise.all(want.filter((m) => !remotes.has(m.id)).map((m) => new Promise<void>((resolve) => {
    const sock = machineSocket(m, "inbox/live", { local: "1" })
    const r: { sock: WebSocket; events: InboxEvent[]; raw?: string } = { sock, events: [] }
    remotes.set(m.id, r)
    alive(sock)
    let opened = false
    sock.on("open", () => { opened = true })
    const timer = setTimeout(resolve, 2500)
    sock.on("message", (data: RawData) => {
      // (the same list again changes nothing)
      const raw = String(data)
      if (raw === r.raw) return
      r.raw = raw
      let msg: { t?: string; events?: InboxEvent[] }
      try { msg = JSON.parse(raw) } catch { return }
      if (msg.t !== "events" || !Array.isArray(msg.events)) return
      // (one that doesn't know local=1 sends what it follows too: only its own)
      r.events = msg.events.filter((e) => e && typeof e.id === "string" && typeof e.t === "number" && !e.id.includes("@")).map((e) => theirs(e, m))
      broadcast(false)
      clearTimeout(timer); resolve()
    })
    const gone = () => {
      clearTimeout(timer); resolve()
      if (remotes.get(m.id) !== r) return
      remotes.delete(m.id); broadcast(false)
      // (one that was there followed again soon, not at the next round: what it says meanwhile would wait half a minute)
      if (opened && plugin.loaded && first) setTimeout(() => { if (plugin.loaded && first) void followMachines() }, 3000).unref?.()
    }
    sock.on("close", gone)
    sock.on("error", gone)
  })))
}

let first: Promise<void> | null = null
let followTimer: ReturnType<typeof setInterval> | null = null
/** The other machines' events (followed from the first ask on, checked again every 30 s). */
async function others() {
  if (!first) {
    first = followMachines()
    followTimer = setInterval(() => { if (plugin.loaded) void followMachines() }, FOLLOW)
    followTimer.unref?.()
  }
  await first
}
plugin.onUnload(() => {
  if (followTimer) clearInterval(followTimer)
  followTimer = null; first = null
  for (const r of remotes.values()) r.sock.terminate()
  remotes.clear()
})

/** Make a change on the machine whose events these are (`ids` bare); its own copy here changes at once, its socket
 *  confirms. Throws a 502 when it doesn't answer. */
async function onMachine(id: string, method: string, route: string, body: unknown, local: (e: InboxEvent) => InboxEvent | null) {
  const m = await plugin.ask<Machine | null>("machines:machine", null, id)
  if (!m || m.self) throw new HTTPError(404, `no machine '${id}' (Machines)`)
  let r: Response
  try {
    r = await fetch(`${m.url}/api/${route}`, { method, headers: { ...MACHINE_CLIENT, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000) })
  } catch {
    throw new HTTPError(502, `${m.label} doesn't answer: its events are kept there`)
  }
  if (!r.ok) {
    let why = ""
    try { why = str(((await r.json()) as Item).error) } catch { /* not JSON */ }
    throw new HTTPError(r.status, `${m.label}: ${why || `answered ${r.status}`}`)
  }
  const kept = remotes.get(m.id)
  if (kept) { kept.events = kept.events.map(local).filter((e): e is InboxEvent => !!e); broadcast(false) }
  return r
}

/** Ids by machine: "" is this one's, bare ids for the others'. */
function byMachine(ids: string[]) {
  const out = new Map<string, string[]>()
  for (const full of ids) { const [id, at] = splitMachine(full); out.set(at, [...out.get(at) ?? [], id]) }
  return out
}
/** An event of another machine's by its bare id there. */
const isOne = (e: InboxEvent, ids: string[]) => ids.includes(splitMachine(e.id)[0])

// ---------- routes


/** Only this machine's owner (core/owner.ts) writes events: they're toasts and notifications on their screen. */
async function owner(req: Request) {
  if (plugin.isOff()) throw new HTTPError(404, "the Inbox plugin is off (Plugins)")
  await plugin.ownerOnly(req, "the inbox")
}

/** The events, newest first (`open`: only what isn't done, as the phone's widgets and the watch list them). */
plugin.route("GET", "inbox/events", async (req) => {
  if (plugin.isOff()) throw new HTTPError(404, "the Inbox plugin is off (Plugins)")
  const limit = req.query.all ? Infinity : Math.max(Math.trunc(Number(req.query.limit)) || 50, 1)
  const local = !!req.query.local
  if (!local) await others()
  const es = req.query.open ? shown(local).filter((e) => e.state !== "done") : shown(local)
  return { events: es.slice(0, limit), unread: unread(local), needs: needing(local), hold: holdNow() }
})

plugin.route("POST", "inbox/events", async (req) => {
  await owner(req)
  return reply(201, { event: addEvent(eventOf((req.body ?? {}) as Item)) })
})

plugin.route("POST", "inbox/events/read", async (req) => {
  await owner(req)
  const ids = (req.body as Item)?.ids
  const local = !!req.query.local
  if (!Array.isArray(ids)) {
    // Every event: this machine's, and the others' there (each one that answers).
    markRead(null)
    if (!local) await Promise.all([...remotes.keys()].map((m) => onMachine(m, "POST", "inbox/events/read?local=1", {}, (e) => (e.read ? e : readThere(e))).catch(() => {})))
    return { unread: unread(local) }
  }
  for (const [m, some] of byMachine(ids.map(String))) {
    if (!m) markRead(new Set(some))
    else if (!local) await onMachine(m, "POST", "inbox/events/read?local=1", { ids: some }, (e) => (isOne(e, some) && !e.read ? readThere(e) : e))
  }
  return { unread: unread(local) }
})

plugin.route("POST", "inbox/events/unread", async (req) => {
  await owner(req)
  const ids = (req.body as Item)?.ids
  if (!Array.isArray(ids) || !ids.length) throw new HTTPError(400, "ids: which events to mark unread")
  const local = !!req.query.local
  for (const [m, some] of byMachine(ids.map(String))) {
    if (!m) markUnread(new Set(some))
    else if (!local) await onMachine(m, "POST", "inbox/events/unread?local=1", { ids: some }, (e) => (isOne(e, some) ? unreadThere(e) : e))
  }
  return { unread: unread(local) }
})

/** Mark events done (dealt with), or open again (`done` false: Back to inbox). */
plugin.route("POST", "inbox/events/done", async (req) => {
  await owner(req)
  const b = (req.body ?? {}) as Item
  if (!Array.isArray(b.ids) || !b.ids.length) throw new HTTPError(400, "ids: which events are done")
  const done = b.done !== false
  const local = !!req.query.local
  for (const [m, some] of byMachine(b.ids.map(String))) {
    if (!m) markDone(new Set(some), done)
    else if (!local) await onMachine(m, "POST", "inbox/events/done?local=1", { ids: some, done }, (e) => (isOne(e, some) ? doneAs(e, done) : e))
  }
  return { needs: needing(local) }
})

/** Snooze events until `until` (ms; null: back now). A permission the server waits on can't be: it'd wait unseen. */
plugin.route("POST", "inbox/events/snooze", async (req) => {
  await owner(req)
  const b = (req.body ?? {}) as Item
  if (!Array.isArray(b.ids) || !b.ids.length) throw new HTTPError(400, "ids: which events to snooze")
  const until = b.until === null ? null : Number(b.until)
  if (until !== null && !(until > Date.now())) throw new HTTPError(400, "until: when it comes back (ms), to come; null: back now")
  const local = !!req.query.local
  for (const [m, some] of byMachine(b.ids.map(String))) {
    if (!m) snooze(new Set(some), until)
    else if (!local) await onMachine(m, "POST", "inbox/events/snooze?local=1", { ids: some, until }, (e) => (isOne(e, some) ? snoozedAs(e, until) ?? e : e))
  }
  return { unread: unread(local) }
})

/** Pin events (on top until done or unpinned), or unpin them (`pinned` false); what's done can't be. */
plugin.route("POST", "inbox/events/pin", async (req) => {
  await owner(req)
  const b = (req.body ?? {}) as Item
  if (!Array.isArray(b.ids) || !b.ids.length) throw new HTTPError(400, "ids: which events to pin")
  const on = b.pinned !== false
  const local = !!req.query.local
  for (const [m, some] of byMachine(b.ids.map(String))) {
    if (!m) pin(new Set(some), on)
    else if (!local) await onMachine(m, "POST", "inbox/events/pin?local=1", { ids: some, pinned: on }, (e) => (isOne(e, some) ? pinnedAs(e, on) : e))
  }
  return { pinned: on }
})

/** `e` pinned (or not): only what isn't done yet. */
export function pinnedAs(e: InboxEvent, on: boolean): InboxEvent {
  if (on) return e.state === "done" ? e : { ...e, pinned: true }
  const { pinned: _, ...rest } = e
  // (a message read while pinned was kept for it: unpinned, it's settled as a read one is)
  return isMessage(e) && !e.gate && e.read && e.state === "open" ? { ...rest, state: "done" } : rest
}
function pin(ids: Set<string>, on: boolean) {
  for (const old of list().filter((e) => ids.has(e.id) && !!e.pinned !== on)) put(pinnedAs(old, on), old, list(), false)
}

/** `e` snoozed till `until` (out of the lists meanwhile), or woken (null: open, unread, on top, told again); null when
 *  it can't be (a gate or a permission would wait unseen; what's done isn't to come back). */
function snoozedAs(e: InboxEvent, until: number | null): InboxEvent | null {
  if (e.gate || e.state === "done" || (until !== null && e.state === "open" && e.ask === "permission")) return null
  if (until !== null) return { ...e, snoozed: until }
  if (!e.snoozed) return null
  const { snoozed: _, ...rest } = e
  return { ...rest, state: "open", read: false, t: Date.now() }
}

/** Snooze these events, or (null) bring them back now: the user did, so it's no news. */
function snooze(ids: Set<string>, until: number | null) {
  for (const old of list().filter((e) => ids.has(e.id))) {
    const e = snoozedAs(old, until)
    if (e) put(e, old, list(), false)
  }
}

// ---------- snoozed results and events come back: on top, unread, told again. A result needs no write: its snooze's
// end past, it's to review again (`latest`); here the phones are told.

const WAKE = 30_000
/** Results whose return was told, by id and time. */
const toldBack = new Set<string>()
export async function wake() {
  const now = Date.now()
  await holdEnds(now)
  if (holdNow(now)) return
  for (const old of list().filter((e) => e.snoozed && e.snoozed <= now)) {
    const e = put(snoozedAs(old, null)!, old, list(), true)
    // (asked back, so it rings even where only what waits on the user does)
    if (e.nt === e.t && settings().push === "waiting" && !waitsOnYou(e)) pushBack(e.title, e.preview || e.body, { event: e.id })
  }
  // (results are the vault's, which every machine's server reads: the first of them by id tells, once)
  const back = plugin.vault.items("inbox").filter((r) => r.status === "new" && !isArchived(r) && r.snoozed && !toldBack.has(`${r.id}\0${r.snoozed}`) &&
    !snoozed(r.snoozed, now) && snoozeMs(r.snoozed) > now - 2 * WAKE)
  if (!back.length || !(await firstMachine())) return
  for (const r of back) { toldBack.add(`${r.id}\0${r.snoozed}`); if (!threadOf(r)) pushBack("Back in your inbox", str(r.title)) }
}
const wakeTimer = setInterval(() => { if (plugin.loaded && !plugin.isOff()) void wake().catch((e) => console.error("inbox: wake:", e)) }, WAKE)
wakeTimer.unref?.()
plugin.onUnload(() => clearInterval(wakeTimer))

// ---------- hold: nothing is told (toasts, notifications, the phone) until a time, then one line of what came. It's
// kept by the server and shared (core/kept.ts), so every machine's server keeps it; each sums up its own events.

export type Hold = { until: string; from: string; label?: string }
/** The hold on now, if any. */
export function holdNow(now = Date.now()): Hold | null {
  const h = (plugin.loaded ? plugin.kept("hold", {}) : {}) as Partial<Hold>
  return h.until && h.from && snoozeMs(h.until) > now ? h as Hold : null
}

/** Hold until `until` (null: end it now), saying what for. */
export function hold(until: Date | null, label = "") {
  const was = holdNow()
  if (!until) { if (was) { plugin.keep("hold", { ...was, until: stampOf(new Date()) }, { shared: true }); broadcast() } return null }
  const h: Hold = { until: stampOf(until), from: was?.from ?? stampOf(new Date()), ...(label ? { label } : {}) }
  plugin.keep("hold", h, { shared: true })
  heldSince = h
  broadcast()
  return h
}

// hold.json from before (iCloud carried it between machines): taken in, then removed.
let lookedAt = ""
plugin.onSync((vault) => {
  const key = `${vault.path}:${vault.settingsVersion}`
  if (lookedAt === key) return
  lookedAt = key
  let old: Item | null
  try { old = plugin.readSettings("hold") } catch { return } // (mid-sync: the next change)
  if (!old) return
  plugin.keep("hold", old, { shared: true }) // (the file is the latest word: an old app wrote it since)
  plugin.saveSettings(null, "hold")
})

/** The hold this machine last saw on, summed up once it's over. */
let heldSince: Hold | null = null
async function holdEnds(now = Date.now()) {
  const h = holdNow(now)
  if (h) { heldSince = h; return }
  if (!heldSince) return
  const from = snoozeMs(heldSince.from), what = heldSince.label
  heldSince = null
  broadcast()
  const came = list().filter((e) => !e.read && e.t >= from && e.source !== "inbox")
  // (results are the vault's: the first machine counts them)
  const results = (await firstMachine()) ? plugin.vault.items("inbox").filter((r) => r.status === "new" && !isArchived(r) && !r.session && !r.terminal && stampMs(str(r.created)) >= from).length : 0
  const n = came.length + results, waiting = came.filter(waitsOnYou).length
  if (!n) return
  const e = addEvent({ source: "inbox", kind: "info", state: "open", title: `${what ? `During ${what}` : "While on hold"}: ${n} new${waiting ? `, ${waiting} waiting on you` : ""}` })
  if (e.nt === e.t && settings().push === "waiting") pushBack(e.title, undefined, { event: e.id })
}

/** This machine is the first online one with the Inbox on (by id), or Machines is off. */
async function firstMachine() {
  const self = await selfMachine()
  return !self || !(await machineList()).some((m) => !m.self && m.online && m.plugins?.includes(plugin.id) && m.id < self)
}

/** Answer a permission the server waits on (gate: the service "inbox:ask"): approve or deny. The owner's only, so what
 *  asked can't answer itself. */
plugin.route("POST", "inbox/events/*/answer", async (req) => {
  await owner(req)
  const h = (k: string) => { const v = req.http?.headers[k]; return typeof v === "string" ? v : null }
  // (callers can still lie about who they are: a yes that must be the user's takes a passkey, as browser logins do)
  if (req.http && !userSurface(whoOf(h("x-vaultite-client"), h("x-vaultite-agent")))) throw new HTTPError(403, NOT_THE_USER)
  const answer = str((req.body as Item)?.answer)
  if (answer !== "approve" && answer !== "deny") throw new HTTPError(400, "answer: approve or deny")
  const [bare, there] = splitMachine(req.arg(0))
  if (there) {
    // Its gate waits on that machine's server.
    await onMachine(there, "POST", `inbox/events/${encodeURIComponent(bare)}/answer`, { answer }, (x) => (isOne(x, [bare]) ? { ...doneAs(x, true), answer } : x))
    return { id: req.arg(0), answer }
  }
  const e = list().find((x) => x.id === bare)
  if (!e?.gate) throw new HTTPError(404, "no permission waits with that id")
  if (e.answer) throw new HTTPError(409, "it was answered already")
  const done: InboxEvent = { ...doneAs(e, true), answer }
  changed(list().map((x) => (x === e ? done : x)))
  for (const settle of [...gates.get(e.id) ?? []]) settle(answer)
  told(done)
  return { id: e.id, answer }
})

/** Forget every event (`done`: only the done ones), on every machine. */
plugin.route("DELETE", "inbox/events", async (req) => {
  await owner(req)
  const done = !!req.query.done
  changed(done ? list().filter((e) => e.state !== "done") : [])
  if (!req.query.local) await Promise.all([...remotes.keys()].map((m) => onMachine(m, "DELETE", `inbox/events?local=1${done ? "&done=1" : ""}`, null,
    (e) => (done && e.state !== "done" ? e : null)).catch(() => {})))
  return { ok: true }
})

plugin.route("DELETE", "inbox/events/*", async (req) => {
  await owner(req)
  const [id, there] = splitMachine(req.arg(0))
  if (there) {
    await onMachine(there, "DELETE", `inbox/events/${encodeURIComponent(id)}`, null, (e) => (isOne(e, [id]) ? null : e))
    return { ok: true }
  }
  const before = list().length
  changed(list().filter((e) => e.id !== id))
  return { ok: list().length < before }
})

// ---------- phone push (push.ts): each new event on the phone, and on the watch

/** Something snoozed is back: to the phones, unless push is off (the user asked for it back). `data`: its event's. */
function pushBack(title: string, body?: string, data?: { event: string }) {
  if (settings().push === "off" || !push.devices().length) return
  void push.send(apns(), { title, body, thread: "inbox", ...(data ? { category: "event" as const, data } : {}) })
    .then((x) => { if (x.failed.length) console.error(`inbox: push failed: ${x.failed.join(", ")}`) }, (err) => console.error("inbox: push failed:", err))
}

const apns = () => ((plugin.secrets().inbox ?? {}) as Item).apns as push.Apns ?? null

/** The buttons a notification of `e` gets (Push.swift's categories): Approve and Deny for a permission it shows whole,
 *  Reply for a session's answer or question (typed back into it), else Done. */
export function categoryOf(e: InboxEvent): push.Note["category"] {
  if (e.ask === "permission" && (e.terminal || e.gate || e.host) && (e.body ?? "").length <= push.BODY_MAX) return "permission"
  if (e.kind === "session" && e.ask !== "permission") return "reply"
  return "event"
}

/** Event `e`, just told (nt), to the phones (the setting `push`). Only this machine's own: the others only show it, so a
 *  phone several servers know rings once. Never fails the event. */
function pushed(e: InboxEvent) {
  const mode = settings().push
  if (e.read || mode === "off" || (mode === "waiting" && !waitsOnYou(e)) || !push.devices().length) return
  void push.send(apns(), {
    title: e.title, body: e.questions ? questionLine(e.questions, true) : [e.from && `From ${e.from.title}`, e.preview || e.body].filter(Boolean).join("\n"), category: categoryOf(e),
    thread: e.terminal || e.session || e.source, urgent: e.kind === "session" && BLOCKED.has(str(e.ask)),
    data: { event: e.id },
  }).then((r) => { if (r.failed.length) console.error(`inbox: push failed: ${r.failed.join(", ")}`) }, (err) => console.error("inbox: push failed:", err))
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null
/** The phones' widgets reload (push.refresh), a few changes at once as one push. */
function refreshWidgets() {
  if (refreshTimer || !push.devices().some((d) => d.widgets)) return
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void push.refresh(apns()).then((r) => { if (r.failed.length) console.error(`inbox: widget push failed: ${r.failed.join(", ")}`) }, (err) => console.error("inbox: widget push failed:", err))
  }, 2000)
}
plugin.onUnload(() => { if (refreshTimer) clearTimeout(refreshTimer) })
/** Another plugin's data the widgets show changed (a routine ticked). */
plugin.provide("widgets:refresh", refreshWidgets)

/** The phone app tells where to reach it (its push token, or its widgets'): this machine's owner only. */
plugin.route("POST", "inbox/devices", async (req) => {
  await owner(req)
  try {
    return reply(201, { device: push.register((req.body ?? {}) as Item), ready: push.configured(apns()) })
  } catch (e) {
    throw new HTTPError(400, (e as Error).message)
  }
})

plugin.route("GET", "inbox/devices", async (req) => {
  await owner(req)
  return { devices: push.devices().map((d) => ({ ...d, token: `${d.token.slice(0, 8)}…` })), ready: push.configured(apns()) }
})

plugin.route("DELETE", "inbox/devices/*", async (req) => {
  await owner(req)
  return { ok: push.forget(req.arg(0)) }
})

plugin.route("POST", "inbox/push", async (req) => {
  await owner(req)
  const b = (req.body ?? {}) as Item
  const r = await push.send(apns(), { title: clip(b.title, 200) || "Vaultite", body: clip(b.body, 500), category: "event" })
  if (!r.ready) throw new HTTPError(409, "push isn't set up on this machine: data/config.json's inbox.apns (vau docs inbox)")
  return r
})

// ---------- agents' sessions (Terminal's stream, a hook, or a host: inbox:session), one thread each: open when it needs
// the user (it asks, or a turn ended with something for them: needs.ts), working once they answer, done when settled

/** A change of an app terminal's state, as Terminal tells it (the service "inbox:state"; Terminal's StateChange): `was`
 *  the state it told before, `from` "shell" its program gone back to its shell (quit, crashed, interrupted). */
export type StateChange = { terminal: string; agent: string; state: "idle" | "working" | "blocked" | "done" | "error"
  kind?: string; msg?: string; from: "osc7501" | "hooks" | "screen" | "agent" | "backend" | "shell"; was?: string; at: number }
/** A change as the inbox hears it: an agent's own hook says its session, folder and last message; one outside the
 *  app's terminals has only its session. */
export type Heard = Omit<StateChange, "terminal" | "at"> & { terminal?: string; session?: string; cwd?: string; text?: string; prompt?: string
  /** An agent's own hook (`vau inbox hook`) or host (inbox:session): it says a turn ended, or it asks, each time news. */
  own?: boolean
  /** What it asks, in its own words, and its name, when its host says them (else its agent's plugin is asked). */
  questions?: Question[]; title?: string
  /** Its thread's id, when its host names it (inbox:session's `thread`). */
  thread?: string }

/** Each session's last state (by terminal, else by session), and since when it works: its turn's start. */
const states = new Map<string, { state: string; kind?: string; msg?: string; since: number }>()
/** What the inbox is still working out (a turn's message read, then judged): tests wait for it. */
const pending = new Set<Promise<unknown>>()
const track = (p: Promise<unknown>) => {
  const q = p.catch((e) => console.error("inbox:", e)).finally(() => pending.delete(q))
  pending.add(q)
}
export const settled = async () => { while (pending.size) await Promise.all([...pending]) }

/** What an agent's own hook said (`j`: Claude Code's JSON or Codex's notify), as a change, or null (nothing to tell). */
export function fromHook(j: Item): Omit<Heard, "agent" | "from"> | null {
  const hook = str(j.hook_event_name)
  const session = clip(j.session_id ?? j["thread-id"] ?? j.thread_id ?? j.sessionID, 120)
  const message = clip(j.message, 300)
  const said = j.last_assistant_message ?? j["last-assistant-message"]
  const asked = (j["input-messages"] as unknown[] | undefined)?.at?.(-1)
  const turn = { ...(typeof said === "string" ? { text: said.trim() } : {}), ...(typeof asked === "string" ? { prompt: asked } : {}) }
  const where = { ...(session ? { session } : {}), ...(str(j.cwd) ? { cwd: str(j.cwd) } : {}) }
  const asks = (): Pick<Heard, "kind" | "msg"> => {
    const input = (j.tool_input ?? {}) as Item
    const question = Array.isArray(input.questions) ? clip((input.questions[0] as Item)?.question, 200) : ""
    const kind = j.notification_type === "permission_prompt" ? "permission" : j.tool_name === "ExitPlanMode" ? "plan" : "question"
    const msg = message || (question ? `Asks: ${question}` : j.tool_name === "ExitPlanMode" ? "A plan to approve" : j.tool_name ? `Wants to use ${clip(j.tool_name, 40)}` : "")
    return { kind, ...(msg ? { msg } : {}) }
  }
  if (hook === "Stop" || j.type === "agent-turn-complete") return { state: "done", own: true, ...where, ...turn }
  // (sitting at its prompt for a minute isn't news: Stop said it finished)
  if (hook === "Notification") return j.notification_type === "idle_prompt" || /waiting for your input/i.test(message) ? null : { state: "blocked", own: true, ...where, ...asks() }
  if (hook === "UserPromptSubmit") return { state: "working", own: true, ...where }
  return null
}

/** A session's state changed: a question it asks is its row, needing the user; answered, read; a turn that ended is
 *  judged. Never throws, and the terminal never waits on it. */
export async function heard(h: Heard) {
  const key = h.terminal || (h.session ? `session:${h.session}` : "")
  if (!key || !h.agent || await muted(h.agent, h.terminal ?? "", h.session ?? "")) return
  const was = states.get(key)
  // (the same said twice: once; an agent's own hook says only that a turn ended or that it asks, each news; after a
  // restart, what its terminal told before)
  const prev = was?.state ?? h.was
  const own = !!h.own
  if (!own && h.terminal && was && was.state === h.state && was.kind === h.kind && was.msg === h.msg) return
  const now = Date.now()
  states.set(key, { state: h.state, kind: h.kind, msg: h.msg, since: h.state === "working" && was?.state !== "working" ? now : was?.since ?? now })
  if (states.size > 500) states.delete(states.keys().next().value!)
  const who: Who = { agent: h.agent, terminal: h.terminal ?? "", session: h.session ?? "", ...(h.from === "agent" && !h.terminal ? { host: true } : {}),
    ...(h.thread ? { thread: h.thread } : {}) }
  if (h.title) name(who, h.title)
  // (working after it asked: the user answered; after a prompt its own hook saw: the user wrote to it)
  if (h.state === "working") {
    if (prev === "blocked" || own) resolve(who.terminal, who.session, own)
    // (a subagent's thread is there from its start, working for the session that delegated it)
    if (!list().some(rowOf(who)) && (await lineageOf(who))?.parent) await sessionRow(who, { state: "working", read: true }, false, h.cwd)
    return
  }
  if (h.state === "blocked") {
    const said = BLOCKED.has(str(h.kind)) ? str(h.kind) : "question"
    const asking: Asking | null = h.questions?.length ? { kind: "question", questions: h.questions } : await askingOf(who, said), ask = asking?.kind ?? said
    await sessionRow(who, { state: "open", ask, read: false, link: undefined, questions: asking?.kind === "question" ? asking.questions : undefined,
      body: asking?.kind === "question" ? questionsText(asking.questions) : asking?.kind === "plan" ? asking.plan : h.msg || ASKING[ask] }, true, h.cwd)
    return
  }
  // Out of a question without working again: refused or interrupted, which the user did.
  if (prev === "blocked" && h.state !== "error" && !own) return resolve(who.terminal, who.session, false, "done")
  if (prev === "working" || own) await turnEnded(who, h, was?.since ?? now)
}

/** Whether the session runs in an account the user muted (the setting `muted`: by its name or id), as its agent's plugin
 *  says ("agent-account:<agent>"). */
async function muted(agent: string, terminal: string, session: string) {
  const names = settings().muted
  if (!names.length) return false
  const a = await plugin.ask<{ id: string; label: string } | null>(`agent-account:${agent}`, null, terminal, session).catch(() => null)
  return !!a && names.some((n) => n === a.id.toLowerCase() || n === a.label.toLowerCase())
}

/** Why a row needs the user, in a word or two (vau inbox). */
const NEEDS: Record<string, string> = { permission: "asks permission", question: "asks", auth: "sign in", plan: "plan", reply: "asks you", answer: "answered", report: "report", error: "failed" }
const ASKING: Record<string, string> = { permission: "Asks permission", question: "Asks you something", auth: "Needs you to sign in", plan: "A plan to approve" }

/** What a blocked session asks, in its own words (its agent's "agent-asking"): a question its hooks call a permission
 *  (Claude Code's says so of its own questions) is one. Its transcript can trail its screen a moment. */
async function askingOf(who: Who, said: string): Promise<Asking | null> {
  if (said === "auth") return null
  for (let i = 0; i < (said === "permission" ? 1 : 4); i++) {
    if (i) await new Promise((r) => setTimeout(r, 400))
    const a = await plugin.ask<Asking | null>(`agent-asking:${who.agent}`, null, who.terminal, who.session).catch(() => null)
    if (a) return a
  }
  return null
}

const or = (xs: string[], word = "or") => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${word} ${xs.at(-1)}`)
/** Questions as Markdown: each, then its options numbered as they're picked. */
export const questionsText = (qs: Question[]) => qs.map((q) => `${q.question}${q.multi ? " (any of them)" : ""}\n\n` +
  q.options.map((o, i) => `${i + 1}. **${o.label}**${o.description ? `: ${o.description}` : ""}`).join("\n")).join("\n\n")
/** The first question and its options in a line (the row, the toast); `lines`: an option a line, for a notification. */
export function questionLine(qs: Question[], lines = false) {
  const q = qs[0], more = qs.length > 1 ? ` (${qs.length - 1} more question${qs.length > 2 ? "s" : ""})` : ""
  const labels = q.options.map((o) => o.label)
  return lines ? `${q.question}${more}\n${labels.map((l, i) => `${i + 1}. ${l}`).join("\n")}` : `${q.question} ${or(labels, q.multi ? "and" : "or")}${more}`.slice(0, 300)
}

type Who = { agent: string; terminal: string; session: string; host?: boolean
  /** Its thread's id, when its host names it (a fork or a resume gave the session a new id). */
  thread?: string }
/** An agent's last turn as its plugin reads it (the service "agent-turn:<agent>"): the user's message, its last answer. */
type Last = { session: string; prompt: string; text: string; at: number; final: boolean
  /** The session itself started the turn (its task's notice, a schedule), not the user: `prompt` is what did. */
  auto?: boolean
  /** The session's own name, for an agent whose terminal isn't titled by it (Codex's thread name, else first prompt). */
  title?: string }
const BODY = 8000

/** A turn that ended: its last message read (the hook's, else the agent's transcript), judged; needing the user, its
 *  row says so (and tells them); else the row, unless still to read, keeps it quietly. */
async function turnEnded(who: Who, h: Heard, since: number) {
  let { text, prompt } = h, auto = false
  if (text === undefined || prompt === undefined) {
    const t = await lastTurn(who, since, text === undefined)
    // (back to idle with no session to read: it was starting up, as Codex says it works while it does)
    if (!t && h.from === "osc7501" && h.state === "idle" && text === undefined && prompt === undefined) return
    if (t) { text ??= t.text; prompt ??= t.prompt; auto = !!t.auto && h.prompt === undefined; who = { ...who, session: who.session || t.session } }
    if (t?.title) name(who, t.title)
  }
  text = (text ?? h.msg ?? "").trim()
  // Its report (inbox.report) this turn is what it had to say: the row is the report's.
  const row = list().find(rowOf(who))
  if (row?.ask === "report" && row.state !== "working" && row.t >= since - 2000) return void endHanded(who.terminal)
  const body = text ? (text.length > BODY ? `${text.slice(0, BODY)}\n\n…` : text) : undefined
  // A subagent's turn is its parent's to read; a session whose subagents still work hears from them, so it's on it.
  const line = await lineageOf(who)
  if (line?.consumes || line?.waits) {
    await sessionRow(who, { state: line.consumes ? "done" : "working", ask: line.consumes && h.state === "error" ? "error" : undefined, body, read: true, questions: undefined,
      turn: line.consumes ? undefined : turnOf(prompt) }, false, h.cwd)
    return void endHanded(who.terminal)
  }
  const sample = plugin.service("sample") as ((a: SampleAsk) => Promise<{ text: string; truncated: boolean }>) | null
  const v = await judge({ prompt, text, error: h.state === "error", auto } satisfies Turn, sample)
  const now = list().find(rowOf(who)), turn = turnOf(prompt)
  // (an answer that only tells, the setting `answers` quiet: done on its agent's row, unread, never told)
  if (v.needs && v.why === "answer" && settings().answers === "quiet") await sessionRow(who, { state: "done", ask: "answer", body, read: false, link: undefined, questions: undefined, turn: undefined }, false, h.cwd)
  else if (v.needs) await sessionRow(who, { state: "open", ask: v.why as Need, body, read: false, link: undefined, questions: undefined, turn }, true, h.cwd)
  // (a turn it started itself settles nothing the user hasn't answered)
  else if (!now || !(auto ? now.state === "open" && !BLOCKED.has(str(now.ask)) : stillOpen(now, turn))) await sessionRow(who, { state: "done", ask: undefined, body, read: true, questions: undefined, turn: undefined }, false, h.cwd)
  else told(now) // (still to read: it stays as it was)
  endHanded(who.terminal)
}

/** A short key for the user's message a turn answered (the same message: the same turn going on). */
const turnOf = (prompt?: string) => (prompt?.trim() ? crypto.createHash("sha1").update(prompt.trim()).digest("hex").slice(0, 12) : undefined)

/** Whether open thread `e` still needs the user after a quiet turn (answering `turn`): what it left stays to read while
 *  the same turn goes on (a background task); a new message from the user, or its ask gone, settles it. */
export const stillOpen = (e: Pick<InboxEvent, "state" | "ask" | "turn">, turn?: string) =>
  e.state === "open" && !BLOCKED.has(str(e.ask)) && (e.ask === "report" || !turn || !e.turn || turn === e.turn)

/** The agent's last turn: once its transcript has this turn's final answer (OSC 7501's done comes before the agent has
 *  written it, so asked again for a few seconds), else this turn's latest words, else none. */
async function lastTurn(who: Who, since: number, wantText: boolean): Promise<Last | null> {
  let t: Last | null = null
  for (let i = 0; i < 10; i++) {
    t = await plugin.ask<Last | null>(`agent-turn:${who.agent}`, null, who.terminal, who.session).catch(() => null)
    if (!t || !wantText || (t.final && t.at >= since - 1000)) return t
    await new Promise((r) => setTimeout(r, 500))
  }
  return t && (t.at >= since - 1000 ? t : { ...t, text: "" })
}

const rowOf = (k: Who) => (e: InboxEvent) => !e.gate && !e.machine && e.source === k.agent &&
  ((!!k.thread && e.id === k.thread) || (!k.thread && ((!!k.session && e.session === k.session) || (!!k.terminal && e.terminal === k.terminal))))

/** The name a session's agent gave it as its last turn ended (agent-turn's `title`, or its host's), by terminal, else session. */
const named = new Map<string, string>()
function name(k: Who, title: string) {
  if (!(k.terminal || k.session)) return
  named.set(k.terminal || k.session, clip(title, 200))
  if (named.size > 500) named.delete(named.keys().next().value!)
}

/** What the user knows a session by: the name its agent gave it, else its terminal's (Claude Code names it after the
 *  session), else its folder. */
async function sessionTitle(k: Who, cwd?: string) {
  const own = named.get(k.terminal || k.session)
  if (own) return own
  const term = k.terminal ? await plugin.ask<{ title?: string } | null>("terminal:info", null, k.terminal).catch(() => null) : null
  return str(term?.title).replace(/^[^\p{L}\p{N}]+/u, "").trim() || (cwd ? path.basename(cwd) : "")
}

/** Where a session stands among delegated tasks (the service "delegate:lineage"): who delegated it its task, and
 *  whether that one waits on this turn; how many of its own subagents still work, which will tell it when they're done. */
type Lineage = { parent: { agent: string; terminal?: string; session?: string; task: string } | null; consumes: boolean; waits: number }
const lineageOf = (k: Who) => plugin.ask<Lineage | null>("delegate:lineage", null, k.agent, k.terminal, k.session)

/** A subagent's parent, by the name of its own thread (else what its session is called), and its task's title. */
async function parentOf(k: Who): Promise<{ parent: InboxEvent["parent"]; task: string } | null> {
  const p = (await lineageOf(k))?.parent
  if (!p) return null
  const them: Who = { agent: p.agent, terminal: p.terminal ?? "", session: p.session ?? "" }
  const title = list().find(rowOf(them))?.title || await sessionTitle(them) || `${agentLabel(p.agent)} session`
  return { parent: { title, agent: p.agent, ...(p.terminal ? { terminal: p.terminal } : {}), ...(p.session ? { session: p.session } : {}) }, task: p.task }
}

/** Session `k`'s row, made or changed (`patch`; undefined takes a field away), at the top; `news`: the user is told. */
async function sessionRow(k: Who, patch: Partial<InboxEvent>, news: boolean, cwd?: string) {
  const line = await parentOf(k), parent = line?.parent
  // (a subagent is called by its task until its agent names it)
  const title = (line?.task && !named.has(k.terminal || k.session) ? line.task : "") || await sessionTitle(k, cwd)
  const es = list()
  const old = es.find(rowOf(k)) ?? null
  const e = { ...(old ?? { id: newId(Date.now()) }), t: Date.now(), source: k.agent, kind: "session", title: title || old?.title || `${agentLabel(k.agent)} session`, ...patch,
    ...(k.terminal ? { terminal: k.terminal } : {}), ...(k.session ? { session: k.session } : {}), ...(k.host ? { host: true } : {}), ...(parent ? { parent } : {}) } as InboxEvent
  if (e.questions) e.preview = questionLine(e.questions)
  else if (e.body) e.preview = previewOf(e.body)
  else delete e.preview
  for (const f of Object.keys(e) as (keyof InboxEvent)[]) if (e[f] === undefined) delete e[f]
  return put(e, old, es, news)
}

/** Handed terminals about to end (endHanded), by id: a reply typed meanwhile keeps it (keepHanded). */
const endingSoon = new Map<string, ReturnType<typeof setTimeout>>()
/** A handed terminal whose turn reported: it ends, once the agent has written it down. */
function endHanded(terminal: string) {
  const at = terminal ? ending.get(terminal) : undefined
  if (at === undefined) return
  ending.delete(terminal)
  if (Date.now() - at >= ENDING) return
  hand(terminal, false)
  clearTimeout(endingSoon.get(terminal))
  endingSoon.set(terminal, setTimeout(() => { endingSoon.delete(terminal); void plugin.runOp("terminal.end", { id: terminal, keepTabs: true }).catch(() => {}) }, 2000))
}
/** A reply goes to `terminal`: the end its last report set off (with that turn's end, or about to) is called off; still
 *  handed, it ends once it reports again. */
function keepHanded(terminal: string) {
  ending.delete(terminal)
  const t = endingSoon.get(terminal)
  if (t) { clearTimeout(t); endingSoon.delete(terminal) }
}

/** A coding agent's name ("Claude Code") by its name in a terminal: one Vaultite knows, else its plugin's name. */
function agentLabel(name: string) {
  const p = LOADED.find((x) => Object.hasOwn(x.services, `agent:${name}`))
  return agentName(name) ?? (p ? str(p.manifest.name) : name ? name[0].toUpperCase() + name.slice(1) : "An agent")
}

/** Whether an agent's session (by its terminal, or its own session id) has a thread that needs the user, unread:
 *  Terminal's list says so (its tab's dot, Terminals' first rows). */
plugin.provide("inbox:needs", (terminal: string, session = "") => list().some((e) => !e.read && e.kind === "session" && e.state === "open" &&
  ((!!terminal && e.terminal === terminal) || (!!session && e.session === session))))

/** Terminal's stream of its terminals' states. */
plugin.provide("inbox:state", (c: StateChange) => { track(heard(c)) })

/** A session's state as its host tells it (an agent run outside a terminal, as the Agent SDK runs one): AGENTS.md's
 *  "A session's state". The same as a hook's: a turn that ends is judged, a question needs the user. */
export type SessionState = { agent: string; session: string; terminal?: string; thread?: string; state: "waiting" | "working" | "done" | "error"
  ask?: string; text?: string; prompt?: string; title?: string; questions?: Question[]; cwd?: string }
const HOST_STATES = { waiting: "blocked", working: "working", done: "done", error: "error" } as const

/** A session's state as given (the API's body, a host's), checked, as the inbox hears it. Throws a 400 for a bad one. */
export function sessionOf(b: Item): Heard {
  const agent = clip(b.agent, 40).toLowerCase(), session = clip(b.session, 120)
  const terminal = TERMINAL.test(str(b.terminal)) ? str(b.terminal) : ""
  const state = HOST_STATES[str(b.state) as keyof typeof HOST_STATES]
  if (!/^[a-z][\w-]*$/.test(agent)) throw new HTTPError(400, "agent: who runs it (claude, codex...)")
  if (!session && !terminal) throw new HTTPError(400, "session: its id")
  if (!state) throw new HTTPError(400, "state: waiting, working, done or error")
  if (b.ask !== undefined && !BLOCKED.has(str(b.ask))) throw new HTTPError(400, "ask: what it waits on (permission, question, auth, plan)")
  const qs = Array.isArray(b.questions) ? (b.questions as Item[]).filter((q) => str(q?.question) && Array.isArray(q.options)).map((q) => ({
    question: clip(q.question, 500), ...(str(q.header) ? { header: clip(q.header, 60) } : {}), ...(q.multi === true ? { multi: true } : {}), ...(q.closed === true ? { closed: true } : {}),
    options: (q.options as Item[]).map((o) => ({ label: clip(o?.label, 200), ...(str(o?.description) ? { description: clip(o.description, 500) } : {}) })).filter((o) => o.label),
  })) : []
  const thread = /^[a-z0-9]{6,12}-[0-9a-f]{6}$/.test(str(b.thread)) ? str(b.thread) : ""
  return { agent, state, from: "agent", own: true, ...(session ? { session } : {}), ...(terminal ? { terminal } : {}), ...(thread ? { thread } : {}),
    ...(b.ask !== undefined ? { kind: str(b.ask) } : {}), ...(typeof b.text === "string" ? { text: b.text.trim() } : {}),
    ...(typeof b.prompt === "string" ? { prompt: b.prompt } : {}), ...(str(b.title) ? { title: clip(b.title, 200) } : {}),
    ...(state === "blocked" && str(b.text) ? { msg: clip(b.text, 300) } : {}), ...(qs.length ? { questions: qs } : {}), ...(str(b.cwd) ? { cwd: str(b.cwd) } : {}) }
}

/** Tell the inbox a session's state (SessionState): the thread it's in, once worked out (a turn's end is judged first). */
plugin.provide("inbox:session", async (b: Item): Promise<InboxEvent | null> => {
  const h = sessionOf(b)
  const p = heard(h)
  track(p)
  await p
  return list().find(rowOf({ agent: h.agent, terminal: h.terminal ?? "", session: h.session ?? "", ...(h.thread ? { thread: h.thread } : {}) })) ?? null
})

/** A session's state from a host outside this server (SessionState): answered at once, the thread worked out after. */
plugin.route("POST", "inbox/sessions", async (req) => {
  await owner(req)
  track(heard(sessionOf((req.body ?? {}) as Item)))
  return reply(202, { ok: true })
}, { sync: false })

/** An agent's own hook (`vau inbox hook`): its news; Terminal tells the rest ("inbox:state"). A terminal started before
 *  that has a state command posting here (`state`): its state file says it now. */
plugin.route("POST", "inbox/hook", async (req) => {
  await owner(req)
  const q = req.query
  if (q.state) return { ok: true }
  const j = (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Item
  const agent = clip(q.agent, 40).toLowerCase() || "agent"
  const terminal = TERMINAL.test(str(q.terminal)) ? str(q.terminal) : ""
  const h = fromHook(j)
  if (h) track(heard({ ...h, agent, ...(terminal ? { terminal } : {}), from: "hooks" }))
  return { ok: true }
}, { sync: false }) // (an agent waits on its hook, which reads nothing of the vault)

// ---------- operations (core/ops.ts): `vau inbox ...` (cli.ts routes to them), MCP's inbox_add


plugin.op({
  id: "inbox.list",
  cli: "inbox",
  mcp: "inbox",
  summary: "What's in the inbox: what needs the user (agents' sessions asking, answering or reporting; requests), results to review (Inbox/), what agents are working on since the user answered, and messages to read, newest first.",
  help: `A coding agent's session is one thread, its report (a file in Inbox/) its record: open (needs you) while it asks
something, its last answer or report is for the user, or it failed; working once they answer; done once a turn after
ends with nothing for them, or they mark it done. Reading never settles a thread (* is unread); a message (vau notify)
is done once read. Results are files in Inbox/ to review. Events are kept on the machine they happened on (another
machine's id ends in @<machine>), done ones for keep_days, each with its id (inbox.settle, inbox.answer, inbox.reply,
inbox.snooze take it). done: the latest done ones too.

  vau inbox
  vau inbox --done`,
  kind: "read",
  params: {
    limit: { type: "integer", minimum: 1, default: 20, description: "at most this many in each list" },
    done: { type: "boolean", description: "the latest done events too" },
  },
  run: async ({ limit, done }, ctx) => {
    const [ev, items] = await Promise.all([ctx.api("GET", "inbox/events?all=1"), ctx.api("GET", "inbox")]) as [Item, Item[]]
    // (a report whose thread is listed is that thread's: one row a session)
    const l = lists(ev.events as InboxEvent[], asResults(items ?? []))
    const row = (r: Item) => ({ path: `${r.id}.md`, title: r.title, from: r.from ?? null, created: r.created ?? null, updated: r.updated ?? null })
    const cut = <T>(xs: T[]) => xs.slice(0, limit)
    return { decisions: cut(l.decisions.map(decisionRow)), pinned: [...l.pinned.events, ...l.pinned.results.map(row)], needs: cut(l.needs), results: cut(l.review.map(row)), working: cut(l.working), messages: cut(l.messages),
      snoozed: [...l.snoozed.results.map((r) => ({ ...row(r), until: str(r.snoozed) })),
        ...l.snoozed.events.map((e) => ({ id: e.id, title: e.title, until: stampOf(new Date(e.snoozed!)) }))],
      done: done ? cut(l.done.events) : l.done.events.length }
  },
  text: (r) => {
    const out: string[] = []
    const line = (e: InboxEvent) => `  ${localTime(e.t)}  ${e.read ? " " : "*"} ${e.title}${e.state === "open" && e.ask ? ` [${NEEDS[e.ask] ?? e.ask}]` : ""}` +
      `${e.preview || e.body ? `: ${clip(e.preview || e.body, 160)}` : ""}${e.machineLabel ? ` (on ${e.machineLabel})` : ""}  (${e.id})`
    const list = (title: string, xs: string[]) => { if (xs.length) out.push(`${out.length ? "\n" : ""}${title}:`, ...xs) }
    list("Decisions", r.decisions.map((d: Item) => `  ${d.blocking ? "[waits on you]" : `[went with ${d.default}]`} ${d.question}  (${d.path})`))
    list("Pinned", r.pinned.map((x: Item) => (x.path ? `  ${x.path}${x.from ? `  (from ${x.from})` : ""}` : line(x as InboxEvent))))
    list("Needs you", r.needs.map(line))
    list("To review", r.results.map((x: Item) => `  ${x.path}${x.from ? `  (from ${x.from})` : ""}`))
    list("Working on it", r.working.map((e: InboxEvent) => (e.progress ? line({ ...e, preview: e.progress }) : line(e))))
    list("Messages", r.messages.map(line))
    list("Snoozed", r.snoozed.map((x: Item) => `  until ${x.until}  ${x.path ?? `${x.title}  (${x.id})`}`))
    if (Array.isArray(r.done)) list("Settled", r.done.map(line))
    else if (r.done) out.push(`${out.length ? "\n" : ""}Settled: ${r.done} (vau inbox --done lists them).`)
    if (r.decisions.length) out.push(`\nAnswer one: vau inbox decide <path> <answer> (vau inbox decisions has their options).`)
    return out.length ? out.join("\n") : "Nothing new."
  },
})

plugin.op({
  id: "inbox.add",
  home: true,
  cli: "inbox add",
  mcp: "inbox_add",
  summary: "Leave something in the user's inbox to review later: research you did, a summary, a draft, links worth reading.",
  help: `A Markdown file in Inbox/, marked new: the user gets a toast and a badge, then marks it done (into Inbox/.archive/) or
files it into a folder. For what they should look at, not facts to remember (people.remember) or notes they asked for
(note.create). For a web page, clipper.save with inbox keeps its content. From a terminal the body may come on stdin.
tldr goes on top, so the user knows what it says before reading it: two or three plain sentences, no jargon.

  vau inbox add "Plant care apps compared" --tldr "Planta is the best fit: ..." --body "## Findings ..."
  echo "## Findings" | vau inbox add "Plant care apps compared"`,
  kind: "write",
  params: {
    title: { type: "string", required: true, description: "its title (the file's name), in sentence case" },
    body: { type: "string", stdin: true, description: "what it says, as Markdown (## headings, bullets, links)" },
    tldr: { type: "string", description: "what it says in short, on top: two or three plain sentences the user reads first" },
    source: { type: "string", description: "where it came from, when it's about one page: its address" },
    from: { type: "string", description: "who it's from (default: you, as the server knows the caller)" },
    do: { type: "string", description: "a task a worker could do alone, standing alone: the item gets a Do it that hands it over (a suggestion)" },
  },
  args: ["title"],
  run: async (p, ctx) => {
    const r = await ctx.api("POST", "inbox", { title: p.title.trim(), body: withTldr(str(p.tldr), str(p.body).trim()), from: str(p.from).trim() || ctx.who.label,
      ...(str(p.source).trim() ? { source: str(p.source).trim() } : {}), ...(str(p.do).trim() ? { do: str(p.do).trim() } : {}) })
    return { path: `${r.id}.md`, title: r.title }
  },
  text: (r) => `In the user's inbox: ${r.path} (they'll see it marked new).`,
  did: (p) => ({ action: "create", text: `Left ${quoted(p.title)} in the inbox` }),
})

/** A result's body with its TL;DR on top, a callout (Obsidian's `[!tldr]`): what it says in short, read first. */
function withTldr(tldr: string, body: string) {
  const t = tldr.trim()
  if (!t) return body
  return [`> [!tldr] In short\n${t.split(/\r?\n/).map((l) => `> ${l}`.trimEnd()).join("\n")}`, body].filter(Boolean).join("\n\n")
}

// ---------- reports: what an agent handed a task did, in the inbox, and the user's reply back into its session

/** What a report is about and where it stands, said first in its title ("Feature done · Sidebar scrolls again"), so
 *  the inbox reads at a glance. */
const WORK: Record<string, string> = { feature: "Feature", fix: "Fix", change: "Change", research: "Research", plan: "Plan", answer: "Answer" }
const STATE: Record<string, string> = { done: "done", waiting: "needs you", stuck: "stuck" }
const reportTitle = (work: string, state: string, title: string) => `${WORK[work] ?? "Work"} ${STATE[state] ?? state} · ${title}`
/** What a report's title is about, without its work and state ("Sidebar scrolls again"); a title named by hand whole. */
const subjectOf = (title: string) => {
  const m = /^(\S+) (.+?) · (.+)$/.exec(title)
  return m && Object.values(WORK).concat("Work").includes(m[1]) && Object.values(STATE).includes(m[2]) ? m[3] : title
}

const IMAGE = /\.(png|jpe?g|gif|webp)$/i, VIDEO = /\.(mp4|m4v|mov|webm)$/i
const REPLY_BLOCK = "```block-reply\n```"
const DECISIONS_BLOCK = "```block-decisions\n```"
/** A report's details at most (about 1,500 words): a report reads in a minute; files hold the rest. */
const SUMMARY_MAX = 10_000
/** Markdown folded under a title (a callout that starts closed). */
const folded = (title: string, md: string) => `> [!info]- ${title}\n${md.trim().split(/\r?\n/).map((l) => `> ${l}`.trimEnd()).join("\n")}`

/** The agent a terminal runs, by its id (claude-k3j2h1g0, claude_personal-k3j2h1g0, resume-claude-<session>). */
const agentOfTerminal = (t: string) => parseTerminal(t)?.agent ?? ""

/** This machine's id in the vault's machines (Machines plugin), or null (off, or not listed). */
const selfMachine = async () => str(await plugin.ask("machines:self", "")) || null

/** A result by its path (Inbox/Title.md, with or without .md; done ones too, in Inbox/.archive/). */
function resultAt(p: string): Item | undefined {
  const id = p.replace(/\.md$/i, "")
  return plugin.vault.items("inbox").find((r) => r.id === id || `${r.id}.md` === p)
}

/** Change a result's text as it is now, while no other write runs: `edit` gets its body (after the frontmatter). */
async function editBody(id: string, edit: (body: string) => string) {
  const vault = plugin.vault
  await vault.lock(async () => {
    await vault.sync()
    const abs = vault.abs(`${id}.md`)
    if (!fs.existsSync(abs)) return
    const text = fs.readFileSync(abs, "utf8")
    const fm = /^---\n[\s\S]*?\n---\n/.exec(text)?.[0] ?? ""
    const next = fm + edit(text.slice(fm.length))
    if (next !== text) writeAtomic(abs, next)
    await vault.sync()
  })
}

// Terminals handed a task to do alone (a dispatch, a voice note, a reply's session): the turn that reports is their
// last, then the terminal ends (a reply resumes the session, or starts a new one). Kept here: terminals outlive a restart.
const handedFile = () => path.join(dir(), "handed.json")
function handed(): string[] {
  try {
    const v = JSON.parse(fs.readFileSync(handedFile(), "utf8"))
    return Array.isArray(v) ? v.filter((t) => typeof t === "string") : []
  } catch { return [] }
}
function hand(terminal: string, on = true) {
  if (!TERMINAL.test(terminal)) return
  const all = handed().filter((t) => t !== terminal)
  if (on) all.push(terminal)
  fs.mkdirSync(dir(), { recursive: true })
  writeAtomic(handedFile(), JSON.stringify(all.slice(-MAX)))
}
/** Dispatch marks the terminals it starts. */
plugin.provide("inbox:handed", (terminal: string) => hand(terminal))
/** Handed terminals that reported, by when: their turn's end (the hook's Stop) ends them. A turn ends in minutes. */
const ending = new Map<string, number>()
const ENDING = 30 * 60_000

/** The terminals a reply may be typed into: its agent running in it, never a shell at its prompt, which would run the
 *  line (a report names its terminal, and anyone who writes the vault can write a report). */
type Live = { id: string; agent?: string | null; busy?: boolean; state?: string }
export const typable = (sessions: Live[]) => (id: string) => !!id && sessions.some((s) => s.id === id && !!s.agent && s.busy === true)

/** Where a reply to a report goes: typed into its terminal still running (`live`: typable); else its session resumed while
 *  the prompt cache lasts (cheap), else a new session told to read the report. `want`: resume or new, whatever the cache. */
type Plan = { how: "type" | "resume" | "new" | "host"; to: string; ago: number | null; ttl: number | null; transcript: string; account?: string }
async function replyPlan(r: Item, live: (id: string) => boolean, want = ""): Promise<Plan | null> {
  const terminal = str(r.terminal), session = str(r.session), agent = str(r.agent) || agentOfTerminal(terminal)
  const resume = session && agent ? resumeTerminalId(agent, session) : ""
  const none = { ago: null, ttl: null, transcript: "" }
  if (want !== "new") for (const to of [terminal, resume]) if (to && live(to)) return { how: "type", to, ...none }
  type Session = { transcript?: string; last?: number; ttl?: number; account?: string }
  const info = session && agent ? await plugin.ask<Session | null>(`agent-session:${agent}`, null, session) : null
  const ago = info?.last ? Math.max(0, Math.round((Date.now() - info.last) / 1000)) : null
  const ttl = Number(info?.ttl) || null
  const known = { ago, ttl, transcript: str(info?.transcript) }
  // A twelfth of it to spare (five minutes of an hour): the reply takes a moment to reach the agent.
  const cached = ago === null || !ttl ? null : ago < ttl - ttl / 12
  const named = str(info?.account) || parseTerminal(terminal)?.profile || ""
  const account = /^[a-z0-9]{1,32}$/.test(named) && named !== "default" ? named : ""
  const fresh = agent ? newTerminalId(agentIn(agent, account)) : ""
  if (resume && want !== "new" && (want === "resume" || cached !== false)) return { how: "resume", to: resume, ...known }
  if (fresh) return { how: "new", to: fresh, ...known, ...(account ? { account } : {}) }
  return null
}

// ---------- decisions: what an agent asks the user, a file each (decisions.ts), the answer sent back to its session

/** Decisions not dealt with yet: open, not archived (snoozed ones too). */
const openDecisions = () => plugin.vault.items("inbox").filter((r) => truthy(r.question) && str(r.status) === "new" && !isArchived(r))
/** A file's name as a link names it (Inbox/.archive/Fix done · A -> Fix done · A). */
const baseOf = (p: string) => path.posix.basename(p.replace(/\.md$/i, ""))
const linkTo = (p: string) => /^\[\[([^\]|#]+)/.exec(p.trim())?.[1]?.trim() ?? p.trim()
/** The result a decision's `report` (or an `also`) links to, wherever it is now. */
const reportOf = (link: string) => {
  const name = baseOf(linkTo(link))
  return name ? plugin.vault.items("inbox").find((r) => baseOf(str(r.id)) === name && !truthy(r.question)) : undefined
}

/** Who asks: the session to send the answer to, and who the user sees it's from. */
type Asker = { agent: string; session: string; terminal: string; machine: string | null; from: string }
const askerFields = (w: Asker) => ({ ...(w.agent ? { agent: w.agent } : {}), ...(w.session ? { session: w.session } : {}), ...(w.terminal ? { terminal: w.terminal } : {}),
  ...(w.machine ? { machine: w.machine } : {}) })

/** A decision that waits on the user is told (toast, notifications) by an event linking its file: not listed apart, done
 *  once the file is archived, and not its session's (whose row is its thread). */
function tellDecision(r: Item, w: Asker) {
  const options = (r.options as string[]) ?? []
  addEvent({ source: w.agent || "vau", kind: "waiting", state: "open", ask: "question", title: str(r.question), link: `${r.id}.md`,
    body: options.map((o) => (o === r.default ? `${o} (default)` : o)).join(" · ") })
}

/** Ask the user `specs`: each a file, or merged into the same question already open (from another agent or note: its
 *  report added to `also`, waiting if this one waits). `report`: the report asking them (its basename). */
async function askAll(ctx: OpCtx, specs: DecisionSpec[], w: Asker, report: string, gist = "") {
  await plugin.vault.sync()
  // (read cold days later: which session asked, and what its report said then, kept with it)
  const k: Who = { agent: w.agent, terminal: w.terminal, session: w.session }
  const where = w.terminal || w.session ? clip(list().find(rowOf(k))?.title || await sessionTitle(k), 120) : ""
  const out: { path: string; question: string; merged: boolean; blocking: boolean }[] = []
  for (const d of specs) {
    const same = openDecisions().find((r) => sameQuestion(str(r.question), d.question)) ??
      out.map((x) => resultAt(x.path)).find((r) => r && sameQuestion(str(r.question), d.question))
    if (same) {
      const link = report ? `[[${report}]]` : ""
      const also = (same.also as string[] | undefined) ?? []
      const more = link && baseOf(linkTo(str(same.report))) !== report && !also.some((l) => baseOf(linkTo(l)) === report)
      const waits = d.blocking && same.blocking !== true
      if (more || waits) await ctx.api("PUT", `inbox/${encodeURIComponent(same.id)}`, { ...(more ? { also: [...also, link] } : {}), ...(waits ? { blocking: true } : {}) })
      if (waits) tellDecision({ ...same, blocking: true }, w)
      out.push({ path: `${same.id}.md`, question: str(same.question), merged: true, blocking: waits || same.blocking === true })
      continue
    }
    const r = await ctx.api("POST", "inbox", { title: d.title, body: d.why, from: w.from, question: d.question, options: d.options, effects: d.effects, default: d.default, blocking: d.blocking,
      ...(report ? { report: `[[${report}]]` } : {}), ...(gist ? { gist: clip(gist, 400) } : {}), ...(where ? { where } : {}), ...askerFields(w) }) as Item
    if (d.blocking) tellDecision(r, w)
    out.push({ path: `${r.id}.md`, question: d.question, merged: false, blocking: d.blocking })
  }
  knockSoon(out.some((x) => x.blocking))
  const fresh = out.filter((x) => !x.merged).map((x) => x.path)
  if (fresh.length) track(mergeAlike(ctx, fresh))
  return out
}

/** The same question said another way ("Keep the quieter island?", "Should the island stay quieter?"): a small model
 *  matches new decisions against the open ones, and a match is merged into the one asked first, saying so. */
async function mergeAlike(ctx: OpCtx, made: string[]) {
  const sample = plugin.service("sample") as ((a: SampleAsk) => Promise<{ text: string }>) | null
  const fresh = made.map(resultAt).filter((r): r is Item => !!r && str(r.status) === "new")
  const open = openDecisions().filter((r) => !fresh.some((f) => f.id === r.id)).slice(0, 40)
  if (!sample || !fresh.length || !open.length) return
  const L = "ABCDEFGHIJ"
  const prompt = `New questions:\n${fresh.slice(0, 10).map((r, i) => `${L[i]}. ${str(r.question)} (options: ${((r.options as string[]) ?? []).join(" / ")})`).join("\n")}\n\n` +
    `Questions already open:\n${open.map((r, i) => `${i + 1}. ${str(r.question)} (options: ${((r.options as string[]) ?? []).join(" / ")})`).join("\n")}`
  let text = ""
  try {
    text = (await sample({ tier: "quick", signal: AbortSignal.timeout(60_000), prompt,
      system: "You keep a user's open questions free of duplicates. A new question is a duplicate when it asks for the same decision as an open one, whatever the wording: answering one would answer the other. Different parts of a feature, or related but separate choices, aren't. Reply with one line per duplicate, \"<letter>: <number>\", or the word NONE." })).text
  } catch { return }
  for (const m of text.matchAll(/^\s*([A-J])\s*[:=-]\s*(\d+)/gm)) {
    const r = fresh[L.indexOf(m[1])], into = open[Number(m[2]) - 1]
    // (the model's match alone merged unrelated questions: the same question shares some of its words)
    if (!r || !into || str(into.status) !== "new" || overlap(str(r.question), str(into.question)) < 0.2) continue
    const link = str(r.report)
    const also = [...((into.also as string[] | undefined) ?? []), ...(link && baseOf(linkTo(link)) !== baseOf(linkTo(str(into.report))) ? [link] : [])]
    await ctx.api("PUT", `inbox/${encodeURIComponent(into.id)}`, { also, ...(r.blocking === true && into.blocking !== true ? { blocking: true } : {}) }).catch(() => {})
    await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { status: "done", closed: `Same as [[${baseOf(str(into.id))}]]` }).catch(() => {})
  }
}

/** The decisions given to an op (an object each, or "Question? | Option* | Option"), checked: an OpError says what's wrong. */
function specsOf(given: unknown, blocking: boolean): DecisionSpec[] {
  const xs = Array.isArray(given) ? given : given === undefined || given === null || given === "" ? [] : [given]
  try { return xs.map((x) => specOf(x, blocking)) } catch (e) { throw new OpError(`decision: ${(e as Error).message}`) }
}

/** The sessions a decision's answer goes to: its report's (the reply goes on in it), else its own; and those of the
 *  reports that asked it too. Each once, by the file the reply goes into. */
function answerTargets(d: Item): string[] {
  const out: string[] = [], seen = new Set<string>()
  for (const r of [reportOf(str(d.report)) ?? d, ...((d.also as string[] | undefined) ?? []).map(reportOf)]) {
    const key = r ? str(r.session) || str(r.terminal) : ""
    if (!r || !key || seen.has(key)) continue
    seen.add(key)
    out.push(`${r.id}.md`)
  }
  return out
}

/** What its agent is told of an answer: a decision it waits on, or a default it took that the user changed; nothing
 *  when they kept the default it took. */
const toldOf = (d: Item, answer: string) => d.blocking === true
  ? `"${str(d.question)}": ${answer}`
  : answer !== str(d.default) ? `"${str(d.question)}": you went with "${str(d.default)}"; the user wants "${answer}" instead, so change it` : ""

/** Answers to the sessions that asked, one reply each (inbox.reply: typed in, resumed, or a new session reading the
 *  report). Never fails the answer: what couldn't be sent is said. */
async function sendAnswers(ctx: OpCtx, answered: { d: Item; answer: string }[]) {
  const by = new Map<string, string[]>()
  for (const { d, answer } of answered) {
    const line = toldOf(d, answer)
    if (line) for (const to of answerTargets(d)) by.set(to, [...by.get(to) ?? [], line])
  }
  const sent: string[] = [], failed: string[] = []
  for (const [to, lines] of by) {
    const text = `The user decided${lines.length > 1 ? ` ${lines.length} of your questions` : ""}: ${lines.map((l, i) => (lines.length > 1 ? `${i + 1}. ${l}` : l)).join(" ")}`
    try { await ctx.op("inbox.reply", { to, text }); sent.push(to) } catch (e) { failed.push(`${to}: ${(e as Error).message}`) }
  }
  return { sent, failed }
}

/** Open decisions that later work settled (a report, another answer) close themselves, saying why: a small model reads
 *  what was done against them, and only what it clearly settles goes. Runs after its op has answered. */
async function closeSettled(ctx: OpCtx, said: string, by: string, skip: Set<string>) {
  const sample = plugin.service("sample") as ((a: SampleAsk) => Promise<{ text: string }>) | null
  const open = openDecisions().filter((r) => !skip.has(str(r.id))).slice(0, 30)
  if (!sample || !open.length || !said.trim()) return
  const prompt = `What was just done or decided (${by}):\n<done>\n${said.slice(0, 6000)}\n</done>\n\nQuestions still open for the user:\n` +
    open.map((r, i) => `${i + 1}. ${str(r.question)} (options: ${((r.options as string[]) ?? []).join(" / ")})`).join("\n")
  let text = ""
  try {
    text = (await sample({ tier: "quick", signal: AbortSignal.timeout(60_000), prompt,
      system: "You keep a user's list of open questions tidy. A question is settled when what was just done answers it, does what it asks or decides it, or makes it moot (the thing it's about was removed or replaced). Only clear cases: when unsure, leave it open. Reply with one line per settled question, \"<number>: <why, in a few plain words>\", or the word NONE." })).text
  } catch { return }
  for (const m of text.matchAll(/^\s*(\d+)\s*[:.)-]\s*(.+)$/gm)) {
    const r = open[Number(m[1]) - 1]
    if (!r || str(r.status) !== "new") continue
    await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { status: "done", closed: clip(`Settled by ${by}: ${m[2]}`, 300) }).catch(() => {})
  }
}

// The companion says what's waiting at a pause (a knock by the notch), once a burst of decisions has come: told again
// only when there are more than it said.
let knockTimer: ReturnType<typeof setTimeout> | null = null
let knocked = 0, knockWaits = false
function knockSoon(waits: boolean) {
  knockWaits ||= waits
  if (knockTimer) clearTimeout(knockTimer)
  knockTimer = setTimeout(() => { knockTimer = null; void knockNow().catch(() => {}) }, 20_000)
  knockTimer.unref?.()
}
plugin.onUnload(() => { if (knockTimer) clearTimeout(knockTimer) })
const NUMBERS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"]
async function knockNow() {
  const open = openDecisions().filter((r) => !snoozed(str(r.snoozed)))
  const waits = knockWaits
  knockWaits = false
  if (open.length <= knocked && !waits) { knocked = open.length; return }
  knocked = open.length
  if (!open.length || holdNow()) return
  const n = open.length
  const line = n === 1 ? `A decision waiting: ${str(open[0].question)}` : `${NUMBERS[n] ?? n} decisions waiting`
  await plugin.runOp("companion.knock", { line: clip(line, 140), who: "Inbox", open: "view:inbox", urgency: waits ? "high" : "low", for: waits ? "1h" : "4h" })
}

/** A decision by its path (Inbox/<Title>.md, with or without .md, archived or not) or its file's name. */
function decisionAt(p: string): Item | undefined {
  const r = resultAt(p) ?? (() => { const n = baseOf(p); return plugin.vault.items("inbox").find((x) => truthy(x.question) && baseOf(str(x.id)) === n) })()
  return r && truthy(r.question) ? r : undefined
}

/** A decision's options as text, each with what it causes: "Keep (default): the island stays quiet · Go back: ...". */
const optionsText = (r: Item, sep = " · ") => ((r.options as string[]) ?? []).map((o, i) => {
  const does = str(((r.effects as string[] | undefined) ?? [])[i])
  return `${o}${o === r.default ? " (default)" : ""}${does ? `: ${does}` : ""}`
}).join(sep)

const decisionRow = (r: Item) => ({ path: `${r.id}.md`, question: str(r.question), options: (r.options as string[]) ?? [], effects: (r.effects as string[] | undefined) ?? [], default: str(r.default), blocking: r.blocking === true,
  from: str(r.from) || null, where: str(r.where) || null, report: str(r.report) || null, gist: str(r.gist) || null, why: previewOf(str(r.body).replace(/```[\s\S]*?```/g, "")).slice(0, 300) || null, created: r.created ?? null,
  ...(str(r.answer) ? { answer: str(r.answer), answered: r.answered ?? null } : {}), ...(str(r.closed) ? { closed: str(r.closed) } : {}),
  ...(snoozed(str(r.snoozed)) ? { snoozed: str(r.snoozed) } : {}) })

plugin.op({
  id: "inbox.decisions",
  cli: "inbox decisions",
  summary: "The decisions waiting on the user: each question an agent asked, its options and the default it takes; the ones an agent waits on first.",
  help: `Each is a file in Inbox/ (vau docs inbox): a question, its options, its default, and whether its agent waits on it
(blocking) or already went with the default. The user answers with vau inbox decide; recent: the last day's answered and
closed ones too. The companion walks the user through these by voice.

  vau inbox decisions
  vau inbox decisions --recent`,
  kind: "read",
  params: { recent: { type: "boolean", description: "the last day's answered and closed ones too" } },
  run: async ({ recent }) => {
    await plugin.vault.sync()
    const open = sortBy(openDecisions(), (r) => `${r.blocking === true ? 1 : 0}${latest(r)}`, true)
    const since = stampOf(new Date(Date.now() - DAY))
    const past = recent ? plugin.vault.items("inbox").filter((r) => truthy(r.question) && str(r.status) === "done" && str(r.answered || r.modified || "") >= since) : []
    return { decisions: open.map(decisionRow), ...(recent ? { recent: past.map(decisionRow) } : {}) }
  },
  text: (r) => {
    const line = (d: Item, i: number) => `${i + 1}. ${d.blocking ? "[waits on you] " : `[went with ${d.default}] `}${d.question}\n   ${optionsText(d)}` +
      `${d.why ? `\n   ${d.why}` : ""}${d.gist ? `\n   Its report: ${d.gist}` : ""}\n   ${d.path}${d.from ? ` · from ${d.from}` : ""}${d.where ? ` (${d.where})` : ""}${d.snoozed ? ` · snoozed until ${d.snoozed}` : ""}`
    const out = [r.decisions.length ? `Waiting on the user (${r.decisions.length}):\n${r.decisions.map(line).join("\n")}` : "No decision waits on the user."]
    if (r.recent?.length) out.push(`Dealt with in the last day:\n${r.recent.map((d: Item) => `  ${d.question}: ${d.answer ? `answered ${d.answer}` : `closed (${d.closed})`}  (${d.path})`).join("\n")}`)
    return out.join("\n\n")
  },
})

plugin.op({
  id: "inbox.ask",
  home: true,
  cli: "inbox ask",
  owner: "files on this machine",
  lock: false,
  summary: "Ask the user one decision: a question with its options as buttons and the default you take if they don't answer; their answer comes back to this session.",
  help: `A file in Inbox/ the user answers with a tap (or by voice, through the companion). blocking: you're stopped on
it (it comes first, with a toast and a push to the phone); else you've gone with the default already, and it reads "Went
with X; change it?", quietly. The same question open already (from another agent or report) is that one, not a second.
They read it cold: the question names its subject (the feature, the note, never "it" or "the first two steps"), each
option says what it causes after a colon (shown under its button), and why says what it's about and who asks.
Ending a task, ask them in your report instead (vau inbox report --decision). The answer is typed into this session (or
resumes it): a default they kept isn't sent.

  vau inbox ask "Ship the new sidebar to the phone too?" --options "Ship it: the phone gets it today" "Not yet: desktop only for now" \\
    --default "Not yet" --blocking --why "The Lighthouse sidebar job finished on desktop; the phone build is untested."
  vau inbox ask "Keep the quieter island by the notch?" --options "Keep: the spinner shows only on hover" "Go back: it spins all the time" \\
    --default Keep --why "The notch job made the island quieter."`,
  kind: "write",
  params: {
    question: { type: "string", required: true, description: "the question, one sentence that stands alone (the user may not remember the task)" },
    options: { type: "array", items: { type: "string" }, commas: false, required: true, description: "2 to 6 options, each \"<button>: <what it causes, a few words>\"" },
    default: { type: "string", required: true, description: "the option you take (or took) if the user doesn't answer" },
    blocking: { type: "boolean", description: "you wait on it: it comes first and pushes to the phone (default: you went with the default already)" },
    why: { type: "string", required: true, description: "one or two plain sentences: what it's about (which agent, project or note asks) and what the choice changes for them" },
    title: { type: "string", description: "its file's name, a few words (default: the question's)" },
    report: { type: "string", description: "the report it's about (Inbox/<Title>.md)" },
    from: { type: "string", description: "who asks (default: you, as the server knows the caller)" },
    terminal: { type: "string", env: "VAULTITE_TERMINAL", description: "the app terminal you run in (filled in from VAULTITE_TERMINAL)" },
    session: { type: "string", env: "CLAUDE_CODE_SESSION_ID", description: "your session's id, for the answer (filled in from CLAUDE_CODE_SESSION_ID)" },
    agent: { type: "string", env: "VAULTITE_AGENT", description: "who you are (claude, codex): from VAULTITE_AGENT, else the terminal's id" },
  },
  args: ["question"],
  run: async (p, ctx) => {
    const [spec] = specsOf([{ question: p.question, options: p.options, default: p.default, blocking: p.blocking === true, why: p.why, title: p.title }], false)
    const terminal = TERMINAL.test(str(p.terminal).trim()) ? str(p.terminal).trim() : ""
    const session = clip(p.session, 120), agent = clip(p.agent, 40).toLowerCase() || agentOfTerminal(terminal)
    const rep = str(p.report).trim() ? reportOf(str(p.report)) : undefined
    if (str(p.report).trim() && !rep) throw new OpError(`no report ${p.report} in the inbox`, 404)
    const w: Asker = { agent, session, terminal, machine: terminal || session ? await selfMachine() : null, from: str(p.from).trim() || (agent ? agentLabel(agent) : ctx.who.label) }
    const [made] = await askAll(ctx, [spec], w, rep ? baseOf(str(rep.id)) : "", rep ? tldrOf(str(rep.body), true) : "")
    return { ...made, session: !!(terminal || session), ...(spec.warn ? { warn: spec.warn } : {}) }
  },
  text: (r) => (r.merged ? `The same question was open already: ${r.path} (it says you asked it too).` : `Asked: ${r.path}${r.blocking ? " (it comes first, with a push to the phone)" : ""}.`) +
    (r.session ? " Their answer comes back to this session." : "") + (r.warn ? `\nWarning: ${r.warn}` : ""),
  did: (p) => ({ action: "create", text: `Asked ${quoted(p.question)}` }),
})

plugin.op({
  id: "inbox.decide",
  cli: "inbox decide",
  owner: "the terminal",
  lock: false,
  summary: "Answer a decision for the user (their pick, by its option's words or number), accept its default, accept every default at once, or close one that's moot.",
  help: `The user's answer, as their buttons give it (or their words to the companion): the decision is archived with its
answer, and its agent told when it waits on it or the user changed a default it took (one reply per session, into its
report). A default they keep isn't sent: the agent went with it already. moot closes one that later work settled, saying
why; undo opens it again. Only with the user's own answer: never decide for them.

  vau inbox decide "Inbox/Keep the quieter island.md" "Go back"
  vau inbox decide "Inbox/Keep the quieter island.md" 2
  vau inbox decide "Inbox/Keep the quieter island.md" --default
  vau inbox decide --defaults                     every open decision's default (Accept all defaults)
  vau inbox decide "Inbox/Faces by the notch.md" --moot "The island was removed in 3f2a1c"`,
  kind: "write",
  params: {
    item: { type: "string", description: "the decision (Inbox/<Title>.md, vau inbox decisions lists them)" },
    answer: { type: "string", description: "the user's answer: an option's words or its number; other words are their own answer" },
    default: { type: "boolean", description: "accept its default" },
    defaults: { type: "boolean", description: "accept the default of every open decision (not snoozed ones)" },
    moot: { type: "string", description: "close it without an answer: why it no longer matters" },
    undo: { type: "boolean", description: "open it again (its answer taken back; its agent isn't told)" },
  },
  args: ["item", "answer"],
  run: async (p, ctx) => {
    await plugin.vault.sync()
    const all = p.defaults === true
    const items = all ? openDecisions().filter((r) => !snoozed(str(r.snoozed))) : (() => {
      const r = decisionAt(str(p.item).trim())
      if (!str(p.item).trim()) throw new OpError("`item`: the decision (vau inbox decisions lists them), or --defaults for all")
      if (!r) throw new OpError(`no decision ${p.item} (vau inbox decisions lists them)`, 404)
      return [r]
    })()
    if (p.undo === true) {
      const r = items[0]
      const back = await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { status: "new", archived: false, answer: null, answered: null, closed: null }) as Item
      return { decided: [{ path: `${back.id}.md`, question: str(back.question), reopened: true }], sent: [], failed: [] }
    }
    const moot = str(p.moot).trim()
    if (!all && !moot && p.default !== true && !str(p.answer).trim()) throw new OpError("`answer`: the user's pick (an option's words or number), --default, or --moot \"<why>\"")
    const done: { d: Item; answer: string }[] = [], rows: Item[] = []
    for (const r of items) {
      if (str(r.status) !== "new" || isArchived(r)) throw new OpError(`${r.id}.md was dealt with already${str(r.answer) ? ` (answered ${str(r.answer)})` : ""}: --undo opens it again`, 409)
      if (moot) {
        const out = await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { status: "done", closed: clip(moot, 300) }) as Item
        rows.push({ path: `${out.id}.md`, question: str(r.question), closed: clip(moot, 300) })
        continue
      }
      const answer = all || p.default === true ? str(r.default) : answerOf((r.options as string[]) ?? [], str(p.answer)).answer
      const out = await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { status: "done", answer, answered: nowStamp() }) as Item
      done.push({ d: { ...r, ...out }, answer })
      rows.push({ path: `${out.id}.md`, question: str(r.question), answer, told: !!toldOf(r, answer) })
    }
    const { sent, failed } = await sendAnswers(ctx, done)
    // (an answer may settle another question: the rest are read against it)
    const said = done.map(({ d, answer }) => `${str(d.question)} The user answered: ${answer}`).join("\n")
    if (said && !all) track(closeSettled(ctx, said, "your answer", new Set(done.map(({ d }) => str(d.id)))))
    knocked = Math.min(knocked, openDecisions().length)
    return { decided: rows, sent, failed }
  },
  text: (r) => {
    if (!r.decided.length) return "No decision was open."
    const lines = r.decided.map((d: Item) => `  ${d.reopened ? "Open again" : d.closed ? "Closed" : `Answered ${quoted(d.answer)}`}: ${d.question}${d.told === false ? " (kept the default: nothing to tell)" : ""}`)
    return [`${r.decided.length === 1 ? "Done" : `${r.decided.length} done`}:`, ...lines,
      ...(r.sent.length ? [`Sent to ${r.sent.length === 1 ? "its session" : `${r.sent.length} sessions`}.`] : []), ...(r.failed.length ? [`Couldn't send: ${r.failed.join("; ")}`] : [])].join("\n")
  },
  did: (p) => ({ action: "edit", text: p.defaults ? "Accepted every default" : `Decided ${quoted(str(p.item))}` }),
})

plugin.op({
  id: "inbox.reports",
  cli: "inbox reports",
  summary: "The reports agents filed lately, one line each linking the whole report: what the morning brief's digest lists (results go there, not in the inbox).",
  help: `Each report agents ended a task with (vau inbox report), since a time (default: the last day), newest first, as
one line: its title and TL;DR, linked. The morning brief puts these under its digest. A failed one, or one that went out
publicly, stayed in the inbox and says so.

  vau inbox reports
  vau inbox reports --since 2026-11-06`,
  kind: "read",
  params: { since: { type: "string", description: "from when: YYYY-MM-DD, a local stamp, or a span back (12h, 2d; default 24h)" } },
  run: async ({ since }) => {
    await plugin.vault.sync()
    const s = str(since).trim()
    const span = /^(\d+)\s*([hd])$/.exec(s)
    const from = !s ? stampOf(new Date(Date.now() - DAY)) : span ? stampOf(new Date(Date.now() - Number(span[1]) * (span[2] === "d" ? DAY : 3600_000))) : /^\d{4}-\d\d-\d\d/.test(s) ? s : null
    if (!from) throw new OpError(`since: YYYY-MM-DD, a local stamp or a span back (12h, 2d), not ${s}`)
    const rs = sortBy(plugin.vault.items("inbox").filter((r) => !truthy(r.question) && truthy(r.work || r.agent || r.session || r.terminal) && latest(r) >= from), latest, true)
    return { since: from, reports: rs.map((r) => ({ path: `${r.id}.md`, title: str(r.title), tldr: str(r.tldr) || null, at: latest(r), inbox: str(r.status) === "new" && !isArchived(r) })) }
  },
  text: (r) => r.reports.length
    ? r.reports.map((x: Item) => `- [[${baseOf(str(x.path))}]]${x.tldr ? `: ${x.tldr}` : ""}${x.inbox ? " (in the inbox)" : ""}`).join("\n")
    : `No reports since ${r.since}.`,
})

/** A session's latest progress, for the Agents panel's row (its terminal's or its chat's step): while it's on it. */
plugin.provide("inbox:progress", (terminal: string, session?: string) =>
  shown().find((e) => e.kind === "session" && e.state !== "done" && !!e.progress && ((!!terminal && e.terminal === terminal) || (!!session && e.session === session)))?.progress ?? null)

plugin.op({
  id: "inbox.progress",
  home: true,
  cli: "inbox progress",
  owner: "files on this machine",
  lock: false,
  summary: "Say how your work goes (a check-in, still working, a step done): your session's row shows it, each line replacing the last; never told, never in the inbox.",
  help: `For what a watcher or a long task would have said in a report ("still working", "two of five fixes in"): it goes
on your own row in the Agents panel, not to the user. The inbox is for decisions: a question
is vau inbox ask, the end of a task vau inbox report.

  vau inbox progress "Two of five fixes in; CI running on the third"`,
  kind: "write",
  params: {
    text: { type: "string", required: true, description: "where it stands, one line" },
    terminal: { type: "string", env: "VAULTITE_TERMINAL", description: "the app terminal you run in (filled in from VAULTITE_TERMINAL)" },
    session: { type: "string", env: "CLAUDE_CODE_SESSION_ID", description: "your session's id (filled in from CLAUDE_CODE_SESSION_ID)" },
    agent: { type: "string", env: "VAULTITE_AGENT", description: "who you are (claude, codex): from VAULTITE_AGENT, else the terminal's id" },
  },
  args: ["text"],
  run: async (p) => {
    const terminal = TERMINAL.test(str(p.terminal).trim()) ? str(p.terminal).trim() : ""
    const session = clip(p.session, 120), agent = clip(p.agent, 40).toLowerCase() || agentOfTerminal(terminal)
    if (!terminal && !session) throw new OpError("progress is a session's: run it in an app terminal (VAULTITE_TERMINAL), or give --session")
    const text = clip(p.text, 300)
    if (!text) throw new OpError("`text`: where it stands, one line")
    const who = { agent: agent || "vau", terminal, session }
    const row = list().find(rowOf(who))
    // (a row that needs the user stays as it is: only its line changes)
    await sessionRow(who, { progress: text, ...(!row || row.state === "done" ? { state: "working" as const, read: true } : {}) }, false)
    return { ok: true, progress: text }
  },
  text: () => "Shown on your row.",
})

plugin.op({
  id: "inbox.report",
  home: true,
  cli: "inbox report",
  owner: "files on this machine",
  lock: false,
  summary: "End a task you were handed (a voice note, a dispatch) with a report: a one-line TL;DR, each question for the user as its own decision (options and the default you take), the details folded; the user replies from it into this session.",
  help: `The report is a record, not an inbox item: it goes straight to the archive, and the morning brief lists it in one
line (its TL;DR, linked). What reaches the user's inbox is each decision: a question with its options as buttons and
the default you take if they don't answer. Write it in this order, short:
- tldr: one line, what happened in plain words (the brief and the push say it).
- decision: one per question only the user can settle, never prose questions in the summary. Text "Question? | Option:
  what it causes* | Option: what it causes | why: <what it's about, who asks>" (* marks the default) or JSON {"question",
  "options", "default", "why", "blocking"}. They read it cold, without the report: name its subject. You've gone with its
  default already: it reads "Went with X; change it?", quietly. blocking (or --state waiting for the text ones): you
  stop until they answer; it comes first and pushes to the phone. A question already open (yours or another agent's) is
  the same decision, not a second one.
- summary: the details, folded under the TL;DR: what was asked (link the note), what you did, where (files, repo,
  branch, commit), what's left; enough for a new session to pick it up. At most about 1,500 words: link files for more.
- settles: decisions this work answered or made moot (their paths): they close, saying so.
Stuck (couldn't finish) or public (it went out where others see it: a release, a post, a message) keeps it in the inbox
too, told. Progress on the way is vau inbox progress, never a report.
Its session is named (VAULTITE_TERMINAL, CLAUDE_CODE_SESSION_ID): the user's answers and replies come back here (this
session resumed, or a new one once its context is no longer cached). Handed a task to do alone, your terminal ends once
this turn does: report last. Your session's next report goes on in the same file: one file per exchange. The title
starts with the work and where it stands: "Feature done · Sidebar scrolls again".

  vau inbox report "Sidebar scrolls again" --work fix --tldr "The left sidebar scrolls again, live on the M1." \\
    --summary "The sidebar's list had ..." \\
    --decision "Ship the sidebar fix to the phone too? | Yes: the phone gets it today | Not yet: desktop only for now* | why: It's live on desktop; the phone build is untested." \\
    --images /tmp/before.png /tmp/after.png
A job with a proof embeds its demo video: --video <the path tour-save gave> (Guides/Proofs/...).`,
  kind: "write",
  params: {
    title: { type: "string", required: true, description: "what was done, in a few words, in sentence case (after the work and state: Feature done · <title>)" },
    work: { type: "string", enum: Object.keys(WORK), required: true, description: "what kind of work: feature, fix, change (a refactor, a setting, a cleanup), research, plan (a proposal to approve), answer" },
    state: { type: "string", enum: Object.keys(STATE), description: "where it stands: done, waiting (you stop on its decisions), stuck (couldn't finish); waiting when a decision is blocking, else done" },
    tldr: { type: "string", required: true, description: "one line on top: what happened, in plain words (at most about 60 words)" },
    summary: { type: "string", required: true, description: "the details, folded: what you did and where to look, as Markdown" },
    decision: { type: "array", items: { description: "\"Question? | Option: what it causes* | Option: what it causes | why: <context>\" (* the default), or {question, options, default, why, blocking?}" }, commas: false,
      description: "each question for the user, its options (each saying what it causes), the default you take and a why: one decision each" },
    settles: { type: "array", items: { type: "string" }, commas: false, description: "decisions this work settled (Inbox/<Title>.md): closed, saying so" },
    public: { type: "boolean", description: "it went out where others see it (a release, a post, a message): the report stays in the inbox, told" },
    digest: { type: "boolean", description: "this report is the user's daily digest itself (the morning brief): it stays in the inbox, told" },
    images: { type: "array", items: { type: "string" }, description: "screenshots: files on this machine (absolute paths) or in the vault (png, jpg, gif, webp)" },
    video: { type: "string", description: "a demo video, embedded above the screenshots: a job's proof (its vault path, Guides/Proofs/...) or a file on this machine (mp4, mov, webm)" },
    terminal: { type: "string", env: "VAULTITE_TERMINAL", description: "the app terminal you run in (filled in from VAULTITE_TERMINAL)" },
    session: { type: "string", env: "CLAUDE_CODE_SESSION_ID", description: "your session's id, to resume it (filled in from CLAUDE_CODE_SESSION_ID)" },
    agent: { type: "string", env: "VAULTITE_AGENT", description: "who you are (claude, codex): from VAULTITE_AGENT (a chat session's), else the terminal's id" },
  },
  args: ["title"],
  run: async (p, ctx) => {
    const summary = str(p.summary).trim(), tldr = clip(p.tldr)
    if (!summary) throw new OpError("`summary`: what you did and where to look")
    if (!tldr) throw new OpError("`tldr`: what happened, one line in plain words")
    if (tldr.length > 400) throw new OpError(`\`tldr\`: one line, at most about 60 words (it's ${tldr.split(" ").length}): the rest goes in summary`)
    // (the daily digest is the one long read: three times as long)
    if (summary.length > SUMMARY_MAX * (p.digest === true ? 3 : 1)) throw new OpError(`\`summary\`: at most about 1,500 words (it's ${summary.split(/\s+/).length}): keep what a new session needs, link files for the rest`)
    const specs = specsOf(p.decision, p.state === "waiting")
    const settles = ((p.settles ?? []) as string[]).map((x) => str(x).trim()).filter(Boolean)
    const missing = settles.filter((x) => !decisionAt(x))
    if (missing.length) throw new OpError(`settles: no decision ${missing.join(", ")} (vau inbox decisions lists them)`, 404)
    const state = str(p.state) || (specs.some((d) => d.blocking) ? "waiting" : "done")
    const title = reportTitle(str(p.work), state, str(p.title).trim())
    // What reaches the inbox: a failure, what went out publicly, the daily digest; the rest is a record, archived.
    const told = state === "stuck" || p.public === true || p.digest === true
    // Screenshots into the vault: one already there stays where it is, one on this machine is saved as an attachment.
    const images: string[] = []
    for (const given of (p.images ?? []) as string[]) {
      const f = given.trim()
      if (!IMAGE.test(f)) throw new OpError(`${f}: a screenshot is a png, jpg, gif or webp`)
      if (!path.isAbsolute(f)) {
        if (!fs.existsSync(plugin.vault.abs(f))) throw new OpError(`no ${f} in the vault (a file on this machine: its absolute path)`)
        images.push(f)
        continue
      }
      let data: Buffer
      try { data = fs.readFileSync(f) } catch { throw new OpError(`can't read ${f}`) }
      // (named for the day and the report: agents' "after.png" from different tasks never take each other's place)
      const name = `${localDate(Date.now())} ${safeName(str(p.title).trim()).slice(0, 50).trim()} - ${path.basename(f)}`
      const up = await ctx.op("file.upload", { data: data.toString("base64"), name }) as { path: string }
      images.push(up.path)
    }
    // (a demo video: one in the vault by its path, as its name may be any proof's; one on this machine uploaded)
    let video = str(p.video).trim()
    if (video) {
      if (!VIDEO.test(video)) throw new OpError(`${video}: a video is an mp4, mov or webm`)
      if (!path.isAbsolute(video)) { if (!fs.existsSync(plugin.vault.abs(video))) throw new OpError(`no ${video} in the vault (a file on this machine: its absolute path)`) }
      else {
        let data: Buffer
        try { data = fs.readFileSync(video) } catch { throw new OpError(`can't read ${video}`) }
        video = (await ctx.op("file.upload", { data: data.toString("base64"), name: `${localDate(Date.now())} ${safeName(str(p.title).trim()).slice(0, 50).trim()} - ${path.basename(video)}` }) as { path: string }).path
      }
    }
    const terminal = TERMINAL.test(str(p.terminal).trim()) ? str(p.terminal).trim() : ""
    const session = clip(p.session, 120)
    const agent = clip(p.agent, 40).toLowerCase() || agentOfTerminal(terminal)
    const machine = terminal || session ? await selfMachine() : null
    if (terminal && handed().includes(terminal)) ending.set(terminal, Date.now())
    const who = { ...(agent ? { agent } : {}), ...(session ? { session } : {}), ...(terminal ? { terminal } : {}), ...(machine ? { machine } : {}) }
    // The same session's report before (the one the user replied to): this one goes on in it, so an exchange is one file.
    await plugin.vault.sync()
    const prior = sortBy(plugin.vault.items("inbox").filter((x) => !truthy(x.question) && ((terminal && str(x.terminal) === terminal) || (session && str(x.session) === session))),
      latest, true)[0]
    // TL;DR, its decisions (drawn with their buttons, once a file), screenshots, then the details folded.
    const decisions = specs.length && !(prior && str(prior.body).includes(DECISIONS_BLOCK)) ? DECISIONS_BLOCK : ""
    const round = (head: string) => [withTldr(tldr, ""), head, decisions, video ? `![[${video}]]` : "",
      images.length ? images.map((i) => `![[${path.posix.basename(i)}]]`).join("\n") : "", folded("Details", summary)].filter(Boolean).join("\n\n")
    let r: Item
    if (prior) {
      await editBody(prior.id, (body) => {
        const next = `## ${title}\n\n${round("")}\n\n`
        const at = body.lastIndexOf(REPLY_BLOCK)
        return at < 0 ? `${body.replace(/\n*$/, "")}\n\n${next}${REPLY_BLOCK}\n` : body.slice(0, at) + next + body.slice(at)
      })
      r = await ctx.api("PUT", `inbox/${encodeURIComponent(prior.id)}`, { status: told ? "new" : "done", updated: nowStamp(), snoozed: null, title: reportTitle(str(p.work), state, subjectOf(str(prior.title))), ...who }) as Item
    } else {
      r = await ctx.api("POST", "inbox", { title, work: str(p.work), body: [round(""), terminal || session ? REPLY_BLOCK : ""].filter(Boolean).join("\n\n"), from: agent ? agentLabel(agent) : ctx.who.label, ...who }) as Item
      if (!told) r = await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { status: "done" }) as Item
    }
    const file = `${r.id}.md`
    const w: Asker = { agent, session, terminal, machine, from: agent ? agentLabel(agent) : ctx.who.label }
    const asked = specs.length ? await askAll(ctx, specs, w, baseOf(str(r.id)), tldr) : []
    const closed: string[] = []
    for (const x of settles) {
      const d = decisionAt(x)
      if (!d || str(d.status) !== "new" || isArchived(d)) continue
      await ctx.api("PUT", `inbox/${encodeURIComponent(d.id)}`, { status: "done", closed: clip(`Settled by [[${baseOf(str(r.id))}]]`, 300) })
      closed.push(`${d.id}.md`)
    }
    // Its session's thread is the report: needing the user when it's told, else done with it, quietly (the record is the
    // report, its questions the decisions).
    const report = told
      ? { state: "open" as const, ask: "report", title: str(r.title), body: tldr, link: file, read: false, questions: undefined }
      : { state: "done" as const, ask: "report", title: str(r.title), body: tldr, link: file, read: true, questions: undefined, progress: undefined }
    if (terminal || session) await sessionRow({ agent: agent || "vau", terminal, session }, report, told)
    else if (told) addEvent({ source: agent || "vau", kind: "waiting", ...report })
    // (later work settles what was asked before it: the rest are read against this report)
    track(closeSettled(ctx, `${tldr}\n\n${summary}`, `[[${baseOf(str(r.id))}]]`, new Set(asked.map((x) => x.path.replace(/\.md$/, "")))))
    const warn = specs.map((d) => d.warn).filter(Boolean)
    return { path: file, title: r.title, inbox: told, decisions: asked, closed, ...(warn.length ? { warn } : {}), images, ...(video ? { video } : {}), terminal: terminal || null, session: session || null, ...(prior ? { thread: true } : {}) }
  },
  text: (r) => [`Reported: ${r.path}${r.thread ? " (added to this session's report before)" : ""}, ${r.inbox ? "in the user's inbox" : "archived (the morning brief lists it)"}.`,
    ...r.decisions.map((d: Item) => `  ${d.merged ? "Same as one open already" : d.blocking ? "Asked, waiting on it" : "Asked"}: ${d.question} (${d.path})`),
    ...((r.warn ?? []) as string[]).map((w) => `Warning: ${w}`),
    ...r.closed.map((c: string) => `  Closed: ${c}`),
    r.terminal || r.session ? `Their answers come back to this session${r.terminal && ending.has(r.terminal) ? "; this terminal ends when this turn does." : "."}` : ""].filter(Boolean).join("\n"),
})

/** The machine a report's session runs on when it isn't this one (a resume here would find no session), else null. */
async function elsewhere(r: Item, alive: (id: string) => boolean): Promise<{ id: string; m: Machine | null } | null> {
  const terminal = str(r.terminal)
  const self = await selfMachine()
  let there = str(r.machine)
  if (!there && terminal && !alive(terminal)) {
    there = str(await plugin.ask("terminal:locate", "", terminal))
  }
  if (!there || !self || there === self) return null
  return { id: there, m: await plugin.ask<Machine | null>("machines:machine", null, there) }
}

/** Run an inbox op on the machine the report's session runs on (the same vault there), its answer as if run here.
 *  Once only: a call another machine passed on isn't passed on again. */
async function onSessionMachine(ctx: OpCtx, at: { id: string; m: Machine | null }, op: string, params: Item) {
  const { m } = at
  const name = m?.label || at.id
  if (!m) throw new OpError(`its session runs on ${name}, which isn't in Machines`, 409)
  if (ctx.who.client?.startsWith("machine/")) throw new OpError(`its session runs on ${name}, not on this machine`, 409)
  if (!m.online) throw new OpError(`its session runs on ${name}, which is offline`, 502)
  let r: Response
  try {
    r = await fetch(`${m.url}/api/ops/${op}`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" },
      body: JSON.stringify(params), signal: AbortSignal.timeout(30000) })
  } catch {
    throw new OpError(`its session runs on ${name}, which doesn't answer`, 502)
  }
  let out: Item = {}
  try { out = (await r.json()) as Item } catch { /* not JSON */ }
  if (!r.ok) throw new OpError(`${name}: ${str(out.error) || `answered ${r.status}`}`, r.status)
  return out
}

/** An event by the id an app, a watch or a notification gives: as listed here (another machine's `<id>@<machine>`), or
 *  bare as that machine's notification said it (the phone answers through whichever server it opened last). */
export function findEvent(events: InboxEvent[], id: string, self: string | null): InboxEvent | undefined {
  const exact = events.find((e) => e.id === id)
  if (exact) return exact
  const [bare, at] = splitMachine(id)
  if (at) return at === self ? events.find((e) => e.id === bare) : undefined
  const hits = events.filter((e) => splitMachine(e.id)[0] === bare)
  return hits.length === 1 ? hits[0] : undefined
}

async function eventFor(ctx: OpCtx, id: string) {
  const { events } = await ctx.api("GET", "inbox/events?all=1") as { events: InboxEvent[] }
  const e = findEvent(events, id.trim(), await selfMachine())
  if (!e) throw new OpError(`no event ${id} (vau inbox lists them)`, 404)
  return e
}

/** Run an inbox op on the machine that keeps event `e` (another's), with its id there. */
async function onOwner(ctx: OpCtx, e: InboxEvent, op: string, params: Item) {
  const at = e.machine!
  return onSessionMachine(ctx, { id: at, m: await plugin.ask<Machine | null>("machines:machine", null, at) }, op, params)
}

/** Whether `to` names an event (an id vau inbox lists), not a report's path. */
const EVENT_ID = /^[a-z0-9]{6,12}-[0-9a-f]{6}(@[a-z0-9][a-z0-9-]{0,62})?$/
const sessionOfRow = (e: InboxEvent) => ({ terminal: e.terminal ?? "", session: e.session ?? "", agent: e.source })

/** Answer a session's thread: its host takes it (agent-reply:<agent>), else it's typed into its terminal, else its
 *  session resumed (or a new one told its last answer); the thread is working, and follows the terminal that answers. */
async function replyToRow(ctx: OpCtx, e: InboxEvent, text: string, how = "") {
  const line = text.trim().replace(/\s*\n\s*/g, " ")
  if (!line) throw new OpError("`text`: the reply")
  if (!e.terminal && !e.session) throw new OpError("it isn't an agent's session: nothing to reply to", 409)
  const { sessions } = await ctx.api("GET", "terminals/sessions") as { sessions: Live[] }
  const asks = !!e.terminal && sessions.find((s) => s.id === e.terminal)?.state === "blocked"
  // (a reply to its one question is its answer: an option by number or name, else typed as its own where it takes one)
  const one = e.questions?.length === 1 && !e.questions[0].multi ? e.questions[0] : null
  if (asks && one && (!one.closed || typeof choiceOf(one, line, "", false) !== "string")) {
    if (!userSurface(ctx.who)) throw new OpError(NOT_THE_USER, 403)
    return { how: "type", terminal: (await pickIn(ctx, e, [line])).terminal }
  }
  const host = plugin.service(`agent-reply:${e.source}`) as ((session: string, text: string) => Promise<boolean>) | null
  if (host && e.session && !how && await host(e.session, line)) {
    moveOn(list().filter((x) => x.id === e.id), "working")
    return { how: "host", terminal: e.terminal ?? null }
  }
  if (e.terminal) keepHanded(e.terminal)
  const plan = await replyPlan(sessionOfRow(e), typable(sessions), how)
  if (!plan) throw new OpError(`its terminal ${e.terminal} has ended and it names no session to resume`, 409)
  keepHanded(plan.to)
  if (plan.how === "type" && asks && (e.questions || e.ask === "question")) {
    // (its questions put away, as Esc does in its terminal, so the reply is a message, not keys in its choices)
    await ctx.api("POST", `terminals/${encodeURIComponent(plan.to)}/send`, { text: "\x1b", enter: false })
    await new Promise((r) => setTimeout(r, 800))
    await submit(ctx, plan.to, line)
  } else if (plan.how === "type") {
    if (atPrompt(sessions.find((s) => s.id === plan.to)?.state)) await submit(ctx, plan.to, line)
    else await ctx.api("POST", `terminals/${encodeURIComponent(plan.to)}/send`, { text: line, enter: true })
  } else if (plan.how === "resume") await startAgent(ctx, plan.to, line)
  const started = plan.how !== "new" ? null : await startNew(ctx, e.source, plan, `(The user replies to the last answer of an earlier session; you start ` +
    `without its context.${plan.transcript ? ` Its transcript is \`${plan.transcript}\`: search it for what you need, don't read it whole.` : ""} ` +
    `Its last answer:\n\n${clip(e.body, 3000) || "(not kept)"}\n\nThe user's reply:) ${line}`)
  moveOn(list().filter((x) => x.id === e.id), "working", started ?? { terminal: plan.to })
  return { how: plan.how, terminal: started ? started.terminal ?? null : plan.to }
}

/** Start a new session for a reply (plan `new`): its agent's host starts a chat when it has one ("agent-chat-new:<agent>":
 *  {prompt, account?} -> {id}), else a terminal runs it. What the thread follows: its terminal, or its session (hosted). */
async function startNew(ctx: OpCtx, agent: string, plan: Plan, prompt: string): Promise<Pick<InboxEvent, "terminal" | "session" | "host">> {
  const chat = plugin.service(`agent-chat-new:${agent}`) as ((a: Item) => Promise<{ id: string } | null>) | null
  const made = chat ? await chat({ prompt, ...(plan.account ? { account: plan.account } : {}), by: ctx.who.label }) : null
  if (made?.id) return { terminal: undefined, session: made.id, host: true }
  await startAgent(ctx, plan.to, prompt)
  return { terminal: plan.to, session: undefined }
}

/** Answer session row `e`'s questions in its terminal (`picks`, `typed`: choiceOf's per question, or "chat"), with its
 *  agent's keys; first checked on its screen, so an answer can't go into something else it shows by then. */
export async function pickIn(ctx: Pick<OpCtx, "api">, e: InboxEvent, picks: string[] | "chat", typed: string[] = []) {
  const qs = e.questions, pick = plugin.service(`agent-pick:${e.source}`)
  if (!qs?.length || !e.terminal || e.kind !== "session" || !pick) throw new OpError("it doesn't ask anything to pick from now", 409)
  if (picks === "chat" && qs.some((q) => q.closed)) throw new OpError("its question takes one of its options: it has no Chat about this", 409)
  if (picks !== "chat" && picks.length !== qs.length) throw new OpError(`\`picks\`: an answer for each of its ${qs.length} questions`)
  const choices = picks === "chat" ? picks : qs.map((q, i) => choiceOf(q, picks[i], typed[i]))
  const t = `terminals/${encodeURIComponent(e.terminal)}`
  const squash = (s: string) => s.replace(/\s+/g, "")
  const { text } = await ctx.api("GET", `${t}/capture?lines=40`).catch(() => ({ text: "" })) as { text: string }
  if (!squash(text).includes(squash(qs[0].question).slice(0, 80))) throw new OpError("its terminal doesn't show that question any more", 409)
  for (const [i, k] of (pick(qs, choices) as string[]).entries()) {
    if (i) await new Promise((r) => setTimeout(r, 200))
    await ctx.api("POST", `${t}/send`, { text: k, enter: false })
  }
  resolve(e.terminal, "")
  return { terminal: e.terminal, choices }
}

plugin.op({
  id: "inbox.reply-plan",
  owner: "the terminal",
  lock: false,
  summary: "Where a reply to an agent's report or session would go now: typed into its running terminal, its session resumed (its context still cached), or a new session.",
  kind: "read",
  params: { to: { type: "string", required: true, description: "the report (Inbox/<Title>.md) or the session's event id (vau inbox lists them)" } },
  args: ["to"],
  run: async (p, ctx) => {
    const to = str(p.to).trim()
    const { sessions } = await ctx.api("GET", "terminals/sessions") as { sessions: Live[] }
    const alive = (id: string) => sessions.some((s) => s.id === id)
    let plan: Plan | null
    if (EVENT_ID.test(to)) {
      const e = await eventFor(ctx, to)
      if (e.machine) return onOwner(ctx, e, "inbox.reply-plan", { to: splitMachine(e.id)[0] })
      plan = await replyPlan(sessionOfRow(e), typable(sessions))
    } else {
      const r = resultAt(to)
      if (!r) throw new OpError(`no report ${to} in the inbox`, 404)
      const at = await elsewhere(r, alive)
      if (at) return onSessionMachine(ctx, at, "inbox.reply-plan", { to: `${r.id}.md` })
      plan = await replyPlan(r, typable(sessions))
    }
    return { how: plan?.how ?? null, ago: plan?.ago ?? null, ttl: plan?.ttl ?? null }
  },
  text: (r) => r.how === "type" ? "Typed into its terminal, still running." : r.how === "resume" ? "Its session resumed" +
    (r.ago !== null && r.ttl ? ` (its context is cached for ${Math.max(0, Math.round((r.ttl - r.ago) / 60))} min more).` : ".")
    : r.how === "new" ? "A new session, told what it's about (its old context is no longer cached)." : "Nowhere: it names no session.",
})

plugin.op({
  id: "inbox.reply",
  cli: "inbox reply",
  owner: "the terminal",
  lock: false,
  summary: "Answer an agent: its report, or its session's row in the inbox; typed into its session if it still runs, else the session resumed while its context is cached, else a new session told what it's about.",
  help: `What a report's Reply box and a session's reply in the inbox do. A terminal still running gets the reply as a new
message. Once it has ended, the session is resumed with it while the agent's prompt cache lasts (Claude Code: an hour,
or five minutes, after its last response): its whole context, cheap. Later, resuming would send the whole conversation
again at full price, so a new session starts, told to read the report (or the session's last answer, and where its
transcript is). Either runs in the background (no tab opens). how: resume or new, whatever the cache.
Its thread is then working (its agent has it) until that turn ends: with something for the user it's open again, else
done. A report: the reply is added to it, and it's archived (into Inbox/.archive/, the thread its item) unless keep; it
names the session answering it, whose next report goes on in it (back to new). A thread whose report it is takes it the
same way. A session on another of the Machines gets it through the app there.

  vau inbox reply "Inbox/Sidebar scrollbar fixed.md" "Yes, ship it to the phone too"
  vau inbox reply lzk3p2-a1b2c3 "Use the second option"`,
  kind: "write",
  params: {
    to: { type: "string", required: true, description: "the report (Inbox/<Title>.md) or the session's event id (vau inbox lists them)" },
    text: { type: "string", required: true, description: "the reply" },
    how: { type: "string", enum: ["auto", "resume", "new"], description: "resume its session, or start a new one (default auto: by its cache)" },
    keep: { type: "boolean", description: "a report: leave it new (not archived)" },
  },
  args: ["to", "text"],
  run: async (p, ctx) => {
    let to = str(p.to).trim()
    const how = p.how === "auto" ? "" : str(p.how)
    if (EVENT_ID.test(to)) {
      const e = await eventFor(ctx, to)
      if (e.machine) return onOwner(ctx, e, "inbox.reply", { to: splitMachine(e.id)[0], text: str(p.text), ...(how ? { how } : {}), ...(p.keep ? { keep: true } : {}) })
      // (a thread whose report it is: the reply goes on in the report, its record)
      const rec = fileOf(e.link) ? resultAt(fileOf(e.link)!) : undefined
      if (!rec || !(rec.terminal || rec.session)) return { to: e.id, ...(await replyToRow(ctx, e, str(p.text), how)), done: false }
      to = `${rec.id}.md`
    }
    // One line for the agent (a newline typed into its terminal would send it early); the report keeps its lines.
    const lines = str(p.text).trim(), text = lines.replace(/\s*\n\s*/g, " ")
    if (!text) throw new OpError("`text`: the reply")
    await plugin.vault.sync()
    const r = resultAt(to)
    if (!r) throw new OpError(`no report ${to} in the inbox`, 404)
    const terminal = str(r.terminal), session = str(r.session), agent = str(r.agent) || agentOfTerminal(terminal)
    if (!terminal && !(session && agent)) throw new OpError("this result doesn't say which session wrote it (only inbox.report's do)", 409)
    if (terminal) keepHanded(terminal)
    const { sessions } = await ctx.api("GET", "terminals/sessions") as { sessions: Live[] }
    const alive = (id: string) => !!id && sessions.some((s) => s.id === id)
    const at = await elsewhere(r, alive)
    if (at) return onSessionMachine(ctx, at, "inbox.reply", { to: `${r.id}.md`, text: str(p.text), ...(how ? { how } : {}), ...(p.keep ? { keep: true } : {}) })
    const again = "when it's done, report again with vau inbox report"
    // (a session its host runs takes it there: agent-reply:<agent>, false when it runs in a terminal)
    const host = session && !how && !typable(sessions)(terminal) ? plugin.service(`agent-reply:${agent}`) as ((s: string, t: string) => Promise<boolean>) | null : null
    const hosted = !!host && await host(session, `(A reply to your report ${r.id}.md; ${again}) ${text}`)
    const plan: Plan | null = hosted ? { how: "host", to: terminal, ago: null, ttl: null, transcript: "" } : await replyPlan(r, typable(sessions), how)
    if (!plan) throw new OpError(`its terminal ${terminal} has ended and the report has no session to resume`, 409)
    let started: Pick<InboxEvent, "terminal" | "session" | "host"> | null = null
    if (plan.how === "type") {
      const said = `(A reply to your report ${r.id}.md; ${again}) ${text}`
      // (at its prompt: sent and checked; while it works, the message waits in its queue)
      if (atPrompt(sessions.find((s) => s.id === plan.to)?.state)) await submit(ctx, plan.to, said)
      else await ctx.api("POST", `terminals/${encodeURIComponent(plan.to)}/send`, { text: said, enter: true })
    } else if (plan.how !== "host") {
      const said = plan.how === "resume" ? `(A reply to your report ${r.id}.md; ${again}) ${text}`
        : `(A reply to the report \`${r.id}.md\`, which an earlier session wrote: you start without its context.) Read the ` +
          `report first: what was asked, what was done, what's left.${plan.transcript ? ` That session's transcript is ` +
          `\`${plan.transcript}\`: search it for a detail the report doesn't give, don't read it whole.` : ""} Then do what ` +
          `the reply asks, and ${again}. The user's reply: ${text}`
      if (plan.how === "resume") await startAgent(ctx, plan.to, said)
      else started = await startNew(ctx, agent, plan, said)
      // (a terminal handed the reply ends once it reports again; a host's chat stays)
      if (!started?.host) hand(plan.to)
    }
    const quoted = lines.split(/\r?\n/).map((l) => `> ${l}`.trimEnd()).join("\n")
    const now = new Date()
    await editBody(r.id, (body) => {
      const note = `> [!note] You replied · ${localDate(now)} ${localTime(now)}\n${quoted}\n\n`
      const at = body.lastIndexOf(REPLY_BLOCK)
      return at < 0 ? `${body.replace(/\n*$/, "")}\n\n${note}` : body.slice(0, at) + note + body.slice(at)
    })
    // The report now names the session that answers it: its next report goes on in this file, and so do later replies.
    const answering = started ? started.terminal ?? "" : plan.to
    const next = { ...(answering !== terminal ? { terminal: answering } : {}), ...(plan.how === "new" ? { session: started?.session ?? "" } : {}) }
    let id = r.id
    if ((!p.keep && r.status !== "done") || Object.keys(next).length) {
      id = str(((await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { ...next, ...(!p.keep ? { status: "done" } : {}) })) as Item)?.id) || id
    }
    // Its thread is working on it (archiving its record made it done), on the terminal that answers.
    moveOn(list().filter((e) => [`${r.id}.md`, `${id}.md`].includes(fileOf(e.link) ?? "")), "working",
      started ?? { terminal: plan.to, ...(plan.how === "new" ? { session: undefined } : {}) })
    return { to: `${r.id}.md`, terminal: answering || null, how: plan.how, done: !p.keep }
  },
  text: (r) => `${r.how === "resume" ? "Resumed its session" : r.how === "new" ? "Started a new session" : r.how === "host" ? "Sent to its session" : "Sent"}${r.terminal ? ` in ${r.terminal}` : ""}${r.done ? "; the report is archived, its thread working" : "; its thread is working"}.`,
})

/** Settle: dealt with, out of the inbox (a result archived, a thread or an event settled). */
const settle: Parameters<typeof plugin.op>[0] = {
  id: "inbox.settle",
  cli: "inbox settle",
  summary: "Settle something in the inbox: a result is archived (into Inbox/.archive/, named anew when given a title); a thread or an event is settled, out of the inbox (its report archived).",
  help: `What the user's Settle does. A result's file moves into Inbox/.archive/, out of what's to review: an agent handed a
voice note ends with it (not by editing its status: that leaves it in the inbox); with title, it's renamed too. A
session's thread (or any event, by its id) is settled: out of what needs the user, kept under Settled for keep_days, and
its report, if it has one to review, archived. Reading never does this: only settling (or the session moving on) does.
undo brings it back: a result to review, a thread open again. (inbox.done, vau inbox done: its old name.)

  vau inbox settle "Inbox/Remind me to call Alice about….md" --title "Call Alice about the trip"
  vau inbox settle lzk3p2-a1b2c3
  vau inbox settle lzk3p2-a1b2c3 --undo`,
  kind: "write",
  params: {
    item: { type: "string", required: true, description: "the result (Inbox/<Title>.md) or the event's id (vau inbox lists them)" },
    title: { type: "string", description: "a result: a better name for it, in a few words, in sentence case" },
    undo: { type: "boolean", description: "bring it back: a result to review, a thread or an event open again" },
  },
  args: ["item"],
  action: { on: ["inbox"], param: "item", label: "Settle", icon: "check-check", menu: false },
  run: async (p, ctx) => {
    const item = str(p.item).trim(), back = p.undo === true
    if (EVENT_ID.test(item)) {
      const e = await eventFor(ctx, item)
      await ctx.api("POST", "inbox/events/done", { ids: [e.id], done: !back })
      // (its report to review goes with it: the thread was its item)
      const rec = !back && fileOf(e.link) ? resultAt(fileOf(e.link)!) : undefined
      if (rec && rec.status === "new" && !isArchived(rec)) await ctx.api("PUT", `inbox/${encodeURIComponent(rec.id)}`, { status: "done" })
      return { id: e.id, title: e.title, done: !back }
    }
    await plugin.vault.sync()
    const r = resultAt(item)
    if (!r) throw new OpError(`no ${item} in the inbox`, 404)
    const title = str(p.title).replace(/\s+/g, " ").trim()
    const done = await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { status: back ? "new" : "done", ...(title ? { title } : {}) }) as Item
    return { path: `${done.id}.md`, done: !back }
  },
  text: (r) => (r.done ? `Settled: ${r.path ?? r.title}.` : `Back in the inbox: ${r.path ?? r.title}.`),
  did: (p) => ({ action: "save", text: `${p.undo ? "Brought back" : "Settled"} ${quoted(p.item)} in the inbox` }),
}
plugin.op(settle)
// (the old name: scripts, hooks and saved prompts call it)
plugin.op({ ...settle, id: "inbox.done", cli: "inbox done", summary: "inbox.settle's old name: settle something in the inbox.", action: undefined })

plugin.op({
  id: "inbox.wake",
  cli: "inbox wake",
  summary: "Wake something snoozed in the inbox: back now, on top (inbox.snooze --until now).",
  kind: "write",
  params: { item: { type: "string", required: true, description: "the result (Inbox/<Title>.md) or the event's id (vau inbox lists them)" } },
  args: ["item"],
  run: async (p, ctx) => {
    const item = str(p.item).trim()
    // (what isn't snoozed has nothing to wake from: said so, rather than "woken")
    const was = EVENT_ID.test(item) ? !!(await eventFor(ctx, item)).snoozed : (await plugin.vault.sync(), snoozed(resultAt(item)?.snoozed))
    return { ...(await ctx.op("inbox.snooze", { item, until: "now" })) as Item, woke: was }
  },
  text: (r) => (r.woke ? `Woken, back on top: ${r.item}.` : `Not snoozed: ${r.item}.`),
  did: (p) => ({ action: "save", text: `Woke ${quoted(p.item)} in the inbox` }),
})

plugin.op({
  id: "inbox.snooze",
  cli: "inbox snooze",
  summary: "Snooze something in the inbox (a result, or an event): out of the way until a time, then back on top, told again.",
  help: `What the user's Snooze does. A result keeps the time in its \`snoozed\` field (past, it's back on top); a thread or
an event is out of the lists meanwhile (still open), and news from its session brings it back early. until: tomorrow, evening, weekend, week (next Monday's
morning), a while (30m, 3h, 2d), a local time (2026-10-24 09:00), or now to bring it back.

  vau inbox snooze "Inbox/Plant care apps compared.md" --until tomorrow
  vau inbox snooze lzk3p2-a1b2c3 --until 3h`,
  kind: "write",
  params: {
    item: { type: "string", required: true, description: "the result (Inbox/<Title>.md) or the event's id (vau inbox lists them)" },
    until: { type: "string", required: true, description: "when it comes back: tomorrow, evening, weekend, week, 3h, 2d, 2026-10-24 09:00, or now" },
  },
  args: ["item"],
  run: async (p, ctx) => {
    const item = str(p.item).trim(), now = /^(now|off|none)$/i.test(str(p.until).trim())
    const at = now ? null : parseUntil(str(p.until))
    if (!now && !at) throw new OpError(`\`until\`: ${quoted(str(p.until))} isn't a time (tomorrow, evening, weekend, week, 3h, 2d, 2026-10-24 09:00, now)`)
    if (at && at.getTime() <= Date.now()) throw new OpError("`until`: that time has passed")
    if (EVENT_ID.test(item)) {
      await ctx.api("POST", "inbox/events/snooze", { ids: [item], until: at ? at.getTime() : null })
      return { item, until: at ? stampOf(at) : null, when: at ? whenText(at) : null }
    }
    await plugin.vault.sync()
    const r = resultAt(item)
    if (!r || r.status !== "new" || isArchived(r)) throw new OpError(`no ${item} to review in the inbox`, 404)
    if (!at && !snoozed(r.snoozed)) return { item: `${r.id}.md`, until: null, when: null }
    // (back now: its snooze ends now, so it's on top)
    await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { snoozed: stampOf(at ?? new Date()) })
    return { item: `${r.id}.md`, until: at ? stampOf(at) : null, when: at ? whenText(at) : null }
  },
  text: (r) => (r.until ? `Snoozed until ${r.when} (${r.until}): ${r.item}.` : `Back in the inbox: ${r.item}.`),
  did: (p) => ({ action: "save", text: `Snoozed ${quoted(p.item)} in the inbox` }),
})

plugin.op({
  id: "inbox.pin",
  cli: "inbox pin",
  summary: "Pin something in the inbox (a result, or a thread or an event) on top of it, whatever it waits on, until it's done or unpinned.",
  help: `What the user's Pin does: it stays on top of the inbox, under Pinned, while it's to review or open, an agent works on
it or it's read; done (or archived) unpins it. off unpins it.

  vau inbox pin "Inbox/Plant care apps compared.md"
  vau inbox pin lzk3p2-a1b2c3 --off`,
  kind: "write",
  params: {
    item: { type: "string", required: true, description: "the result (Inbox/<Title>.md) or the event's id (vau inbox lists them)" },
    off: { type: "boolean", description: "unpin it" },
  },
  args: ["item"],
  run: async (p, ctx) => {
    const item = str(p.item).trim(), on = p.off !== true
    if (EVENT_ID.test(item)) {
      const e = await eventFor(ctx, item)
      if (on && e.state === "done") throw new OpError(`${item} is settled: bring it back first (vau inbox settle ${item} --undo)`)
      await ctx.api("POST", "inbox/events/pin", { ids: [e.id], pinned: on })
      return { item: e.id, title: e.title, pinned: on }
    }
    await plugin.vault.sync()
    const r = resultAt(item)
    if (!r || r.status !== "new" || isArchived(r)) throw new OpError(`no ${item} to review in the inbox`, 404)
    await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { pinned: on || null })
    return { item: `${r.id}.md`, title: r.title, pinned: on }
  },
  text: (r) => `${r.pinned ? "Pinned" : "Unpinned"}: ${r.title ?? r.item}.`,
  did: (p) => ({ action: "save", text: `${p.off ? "Unpinned" : "Pinned"} ${quoted(p.item)} in the inbox` }),
})

plugin.op({
  id: "inbox.hold",
  cli: "inbox hold",
  summary: "Hold the inbox: nothing is told (toasts, the Mac's and the phone's notifications) until a time, then one line of what came meanwhile.",
  help: `Do not disturb for the inbox, on every machine: events and results still come in, unread, told of only when it ends.
until: a while (30m, 2h), a time today (07:30), a local time (2026-10-24 09:00), or off to end it now; left out: the
hold on now, if any. label says what for ("Practice guitar"), in the line at its end.

  vau inbox hold 30m --label "Practice guitar"
  vau inbox hold off`,
  kind: "write",
  params: {
    until: { type: "string", description: "when it ends: 30m, 2h, 07:30, 2026-10-24 09:00, or off; left out: the hold on now" },
    label: { type: "string", description: "what it's for, a few words" },
  },
  args: ["until"],
  run: async (p, ctx) => {
    const v = str(p.until).trim()
    if (!v) return { hold: holdNow() }
    const why = await ctx.refusal?.("the inbox")
    if (why) throw new OpError(why, 403)
    if (/^(off|now|none)$/i.test(v)) { hold(null); return { hold: null } }
    const at = parseUntil(v)
    if (!at) throw new OpError(`\`until\`: ${quoted(v)} isn't a time (30m, 2h, 07:30, 2026-10-24 09:00, off)`)
    if (at.getTime() <= Date.now()) throw new OpError("`until`: that time has passed")
    if (at.getTime() - Date.now() > DAY) throw new OpError("`until`: at most a day away")
    return { hold: hold(at, clip(p.label, 60)) }
  },
  text: (r) => (r.hold ? `Held until ${whenText(new Date(snoozeMs(r.hold.until)))}${r.hold.label ? ` (${r.hold.label})` : ""}: told of what came then.` : "Not held."),
  did: (p) => ({ action: "save", text: str(p.until) ? `Held the inbox: ${str(p.until)}` : "Read the inbox's hold" }),
})

plugin.op({
  id: "inbox.read",
  cli: "inbox read",
  summary: "Mark the inbox's events read (seen: no longer bold), some by id (vau inbox lists them) or all. A message is done once read; a thread stays until it's settled (inbox.settle).",
  kind: "write",
  params: { ids: { type: "array", items: { type: "string" }, description: "the events' ids; none: every event" } },
  args: ["ids"],
  run: async ({ ids }, ctx) => ({ ...(await ctx.api("POST", "inbox/events/read", ids?.length ? { ids } : {})), all: !ids?.length }),
  text: (r) => (r.all ? "Every event is read." : `Read. ${r.unread} unread.`),
  did: ({ ids }) => ({ action: "save", text: ids?.length ? `Marked ${ids.length} inbox event${ids.length === 1 ? "" : "s"} read` : "Marked the inbox read" }),
})

plugin.op({
  id: "inbox.unread",
  cli: "inbox unread",
  summary: "Mark events unread by hand: they stay unread when the Inbox is seen, until opened or marked read (a message read is back in the inbox).",
  kind: "write",
  params: { ids: { type: "array", items: { type: "string" }, required: true, description: "the events' ids (vau inbox lists them)" } },
  args: ["ids"],
  run: async ({ ids }, ctx) => {
    if (!ids.length) throw new OpError("which events: their ids (vau inbox lists them)")
    return await ctx.api("POST", "inbox/events/unread", { ids })
  },
  text: (r) => `Unread. ${r.unread} unread.`,
  did: ({ ids }) => ({ action: "save", text: `Marked ${ids.length || "some"} inbox event${ids.length === 1 ? "" : "s"} unread` }),
})

plugin.op({
  id: "inbox.clear",
  cli: "inbox clear",
  summary: "Forget the inbox's events: every one, or only the settled ones (results in Inbox/ stay).",
  kind: "destructive",
  params: { done: { type: "boolean", description: "only the settled ones" } },
  run: async ({ done }, ctx) => ({ ...(await ctx.api("DELETE", `inbox/events${done ? "?done=1" : ""}`)), done: !!done }),
  text: (r) => (r.done ? "Forgot the settled events." : "Forgot every event."),
  did: ({ done }) => ({ action: "delete", text: done ? "Cleared the inbox's settled events" : "Cleared the inbox's events" }),
})

plugin.op({
  id: "inbox.answer",
  cli: "inbox answer",
  summary: "Answer an event, as its notification's buttons do: approve or deny the permission an agent waits on, pick answers to its questions, reply to a session that needs you, mark it done, or read.",
  help: `approve and deny press the keys the agent's plugin gives for the question its terminal shows (Claude Code's
permission: Enter, its first choice Yes, or Escape): for an agent asking permission in an app terminal (the event's ask
is permission) while its terminal still shows the question, or a question the server waits on (an app's tool). reply
(with text) is inbox.reply to its session (to a session asking one question, its answer). pick answers the questions it
asks (the event's questions): picks, one per question, an option's number or name (several, comma-separated, in a
multi-select), or text typed as its own answer; typed, one per question, what's typed in its Type something row (with a
multi-select's picks; "" for none). chat is its Chat about this: the questions put aside, it asks what to clarify (not
for a closed question, a dialog's). approve, deny, pick and chat are the user's alone: only from the app or their
phone, never an agent nor vau. Approved, denied, picked or replied to, a session's thread is working (its agent goes on);
settle settles it (inbox.settle; done, its old name), read only marks it read. A session run outside a terminal is answered by its host
(agent-reply:<agent>, agent-answer:<agent>). Another machine's event is answered there, where its session runs; a bare
id from a notification another machine sent is found too.

  vau inbox answer lzk3p2-a1b2c3 approve
  vau inbox answer lzk3p2-a1b2c3 pick --picks 2
  vau inbox answer lzk3p2-a1b2c3 pick --picks "Local cert" --picks "1,3"
  vau inbox answer lzk3p2-a1b2c3 pick --picks "1,3" --typed "Feta"
  vau inbox answer lzk3p2-a1b2c3 chat
  vau inbox answer lzk3p2-a1b2c3 reply --text "Yes, the second one"`,
  kind: "write",
  params: {
    id: { type: "string", required: true, description: "the event's id (vau inbox lists them)" },
    answer: { type: "string", enum: ["approve", "deny", "pick", "chat", "reply", "settle", "done", "read"], required: true, description: "approve, deny, pick, chat (Chat about this), reply, settle (done, its old name) or read" },
    picks: { type: "array", items: { type: "string" }, description: "with pick: an answer for each question, in order" },
    typed: { type: "array", items: { type: "string" }, commas: false, description: "with pick: what's typed in each question's Type something row, in order (\"\" for none)" },
    text: { type: "string", description: "with reply: what to tell it" },
  },
  args: ["id", "answer"],
  run: async ({ id, answer, text, picks, typed }, ctx) => {
    const e = await eventFor(ctx, id)
    // (a gate, an agent's permission or its questions: the user's alone, never an agent saying yes to itself or another)
    if (((answer === "approve" || answer === "deny") && (e.gate || e.ask === "permission") || answer === "pick" || answer === "chat") && !userSurface(ctx.who)) throw new OpError(NOT_THE_USER, 403)
    const bare = splitMachine(e.id)[0]
    if (e.machine) return onOwner(ctx, e, "inbox.answer", { id: bare, answer, ...(text ? { text } : {}), ...(picks?.length ? { picks } : {}), ...(typed?.length ? { typed } : {}) })
    if (answer === "reply") return { id: e.id, answer, title: e.title, ...(await ctx.op("inbox.reply", { to: e.id, text: str(text) })) }
    if (answer === "settle" || answer === "done") return { id: e.id, answer, title: e.title, ...(await ctx.op("inbox.settle", { item: e.id })) }
    if (answer === "read") {
      await ctx.api("POST", "inbox/events/read", { ids: [e.id] })
      return { id: e.id, answer, title: e.title, terminal: e.terminal ?? null }
    }
    // (a session run outside a terminal: its host answers it)
    const host = e.host && e.session ? plugin.service(`agent-answer:${e.source}`) as ((session: string, a: Item) => Promise<boolean>) | null : null
    if (answer === "pick" || answer === "chat") {
      const given = answer === "chat" ? "chat" as const : (picks ?? []).map(str), texts = (typed ?? []).map(str)
      if (!host) return { id: e.id, answer, title: e.title, ...(await pickIn(ctx, e, given, texts)) }
      const qs = e.questions ?? []
      if (!qs.length || e.state !== "open") throw new OpError("it doesn't ask anything to pick from now", 409)
      if (given !== "chat" && given.length !== qs.length) throw new OpError(`\`picks\`: an answer for each of its ${qs.length} questions`)
      const a = given === "chat" ? { chat: true } : { picks: qs.map((q, i) => choiceOf(q, given[i], texts[i])) }
      if (!(await host(e.session!, a))) throw new OpError("its session no longer asks that", 409)
      moveOn(list().filter((x) => x.id === e.id), "working")
      return { id: e.id, answer, title: e.title, terminal: null }
    }
    if (e.gate) {
      await ctx.api("POST", `inbox/events/${encodeURIComponent(e.id)}/answer`, { answer })
      return { id: e.id, answer, title: e.title, terminal: null }
    }
    if (e.ask !== "permission" || e.kind === "info" || !(e.terminal || host)) throw new OpError("only an agent asking permission can be approved or denied", 409)
    if (e.state !== "open") throw new OpError("it was answered already", 409)
    if (host) {
      if (!(await host(e.session!, { answer }))) throw new OpError("its session no longer asks that", 409)
    } else await ctx.api("POST", `terminals/${encodeURIComponent(e.terminal!)}/answer`, { answer, agent: e.source })
    // (its agent goes on, or stops at no)
    moveOn(list().filter((x) => x.id === e.id), "working")
    return { id: e.id, answer, title: e.title, terminal: e.terminal ?? null }
  },
  text: (r) => (r.answer === "read" ? `Read: ${r.title}.` : r.answer === "settle" || r.answer === "done" ? `Settled: ${r.title}.` : r.answer === "reply" || r.answer === "pick" || r.answer === "chat" ? `Sent${r.terminal ? ` to ${r.terminal}` : ""}.`
    : `${r.answer === "approve" ? "Approved" : "Denied"}${r.terminal ? ` in ${r.terminal}` : `: ${r.title}`}.`),
})

plugin.op({
  id: "inbox.push",
  cli: "inbox push",
  summary: "Send a notification to the user's phone (and watch) now, not kept in the inbox: to try push, or for what can't wait.",
  help: `For news worth keeping, vau notify (an event: in the inbox, and pushed too). Needs push set up on the server's machine
(vau docs inbox).

  vau inbox push "Backup finished" --body "12 GB, 4 min"`,
  kind: "write",
  params: {
    title: { type: "string", required: true, description: "what it says, one line" },
    body: { type: "string", description: "a line or two more" },
  },
  args: ["title"],
  run: async ({ title, body }, ctx) => await ctx.api("POST", "inbox/push", { title, body }),
  // (no phone or watch signed up yet: nothing went anywhere, and it says so)
  text: (r) => (!r.sent && !r.failed.length ? "Nothing sent: no phone has signed up for notifications on this machine yet (the iPhone app does, once it connects; the watch shows the phone's)."
    : `Sent to ${r.sent} device${r.sent === 1 ? "" : "s"}${r.failed.length ? `; failed: ${r.failed.join(", ")}` : ""}.`),
})

/** What the front door (an agent the setting `dispatch` names) is told with a voice note: the setting
 *  `dispatch_prompt`, its {path}, {folder} and {text} filled in. */
const DISPATCH = (file: string, text: string) => settings().prompt.replace(/\{(path|folder|text)\}/g, (_, k: string) =>
  (k === "path" ? file : k === "folder" ? path.posix.dirname(file) : text))

/** A terminal's state (the terminals list's): its agent at its prompt, or working on a turn (or asking, in one). */
const atPrompt = (state?: string) => state === "idle" || state === "done"
const busy = (state?: string) => state === "working" || state === "blocked"

/** Type a message into an agent at its prompt, Enter once it shows (a dialog's Enter would pick an option); not working a
 *  few seconds later, Escape, then Enter again (vim mode); not shown or still not working, an error: not lost. */
export async function submit(ctx: Pick<OpCtx, "api">, id: string, text: string, tick = 500) {
  const t = encodeURIComponent(id)
  const working = async () => {
    for (let i = 0; i < 8; i++) {
      await new Promise((res) => setTimeout(res, tick))
      const { sessions } = await ctx.api("GET", "terminals/sessions") as { sessions: { id: string; state?: string }[] }
      if (busy(sessions.find((s) => s.id === id)?.state)) return true
    }
    return false
  }
  // (shown: its end in the lines that changed, spaces aside as the agent wraps it, or a long one as a paste's marker)
  const screen = async () => String(((await ctx.api("GET", `terminals/${t}/capture?lines=200`)) as { text: string }).text).split("\n")
  const squash = (s: string) => s.replace(/\s+/g, "")
  const end = squash(text).slice(-24)
  const before = new Set(await screen())
  await ctx.api("POST", `terminals/${t}/send`, { text, enter: false })
  let shown = false
  for (let i = 0; i < 8 && !shown; i++) {
    await new Promise((res) => setTimeout(res, tick / 2))
    const changed = (await screen()).filter((l) => !before.has(l)).join("")
    shown = squash(changed).includes(end) || /\[Pasted /.test(changed)
  }
  if (!shown) throw new OpError(`the agent didn't take it (something over ${id}'s prompt, a question or an offer, has the keys): open its session to see it, then send it again`, 409)
  await ctx.api("POST", `terminals/${t}/send`, { text: "", enter: true })
  if (await working()) return
  await ctx.api("POST", `terminals/${t}/send`, { text: "\x1b", enter: false })
  await new Promise((res) => setTimeout(res, 300))
  await ctx.api("POST", `terminals/${t}/send`, { text: "", enter: true })
  if (await working()) return
  throw new OpError(`the agent didn't start on it (${id} is still at its prompt): open its session to see why, then send it again`, 409)
}

/** Words past which a voice note isn't handed to the front door (about ten minutes of talk). */
const LONG_VOICE = 1500

/** Start the front door with a voice note: a new terminal running the agent (its id), the note its first prompt, given
 *  as it starts (typed in at its prompt, a fresh TUI could drop the start of it). */
async function dispatch(ctx: OpCtx, agent: string, file: string, text: string): Promise<string> {
  const id = newTerminalId(agent)
  const parsed = parseTerminal(id)
  // (its host starts a chat when it has one: agent-chat-new, as a reply's new session)
  const made = await startNew(ctx, parsed?.agent ?? agent, { how: "new", to: id, ago: null, ttl: null, transcript: "", ...(parsed?.profile ? { account: parsed.profile } : {}) }, DISPATCH(file, text))
  if (made.host) return made.session!
  hand(id)
  return id
}

plugin.op({
  id: "inbox.voice",
  cli: "inbox voice",
  summary: "What the user said into their watch, phone or the app: kept in the inbox, and handed to the front-door agent when the setting dispatch names one.",
  help: `The iPhone app sends it (from the watch's microphone, transcribed on the phone), and so does the app's Record a
voice note for your inbox. The recording (audio) is kept as an attachment, embedded above what was said, unless the
setting voice_audio is off. With dispatch set (claude, codex...), a new terminal runs that agent with the note, to write
it down, do it, or say what it would do; one past 1,500 words (a recording left running, a meeting) is only kept.

  vau inbox voice "Remind me to call Alice about the trip on Friday"`,
  kind: "write",
  params: {
    text: { type: "string", required: true, description: "what was said, transcribed" },
    from: { type: "string", description: "where it was said (Apple Watch, iPhone)" },
    audio: { type: "string", description: "the recording, base64 (a short one; any size goes as the op's input): kept as an attachment, embedded above what was said" },
    ext: { type: "string", description: "the recording's extension (m4a, webm)" },
    keep: { type: "boolean", description: "only kept: never handed to the agent dispatch names" },
  },
  args: ["text"],
  input: "the recording, any size (instead of audio)",
  run: async ({ text, from, audio, ext, keep }, ctx) => {
    const said = text.trim()
    if (!said) throw new OpError("nothing was said")
    const words = said.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim().split(" ")
    const first = words.slice(0, 8).join(" ")
    const title = `${first[0]?.toUpperCase() ?? ""}${first.slice(1)}${words.length > 8 ? "…" : ""}` || "Voice note"
    // The user's own words (Provenance's label for what they write, while it's on); an AI app's (MCP) are its own.
    const origin = (plugin.service(ctx.who.client === "mcp" ? "provenance:agent" : "provenance:user") as (() => string) | null)?.() || undefined
    // The recording above its words, as a note's recording sits above its transcript.
    let body = said
    if ((audio || ctx.input) && settings().audio) {
      const kind = /^[a-z0-9]{1,5}$/i.test(str(ext)) ? str(ext).toLowerCase() : "m4a"
      const name = `Voice note ${localStamp().replace(/(\d\d)(\d\d)(\d\d)$/, "$1.$2.$3")}.${kind}`
      const up = ctx.input ? await ctx.op("file.upload", { name }, ctx.input) : await ctx.op("file.upload", { data: audio, name })
      body = `![[${path.posix.basename(str(up.path))}]]\n\n${said}`
    }
    const r = await ctx.api("POST", "inbox", { title, body, from: str(from).trim() || ctx.who.label, origin })
    const file = `${r.id}.md`
    const agent = keep ? "" : settings().dispatch
    let terminal: string | null = null, why = ""
    // Past a few minutes of talk it's a recording left running or a meeting, not a request: kept, not handed on.
    if (agent && words.length > LONG_VOICE) why = `${words.length} words is a recording, not a request: it's in the inbox`
    else if (agent) {
      try { terminal = await dispatch(ctx, agent, file, said) } catch (e) { why = (e as Error).message }
    }
    return { path: file, terminal, why }
  },
  text: (r) => `In the inbox: ${r.path}${r.terminal ? `; ${cap(String(r.terminal).split(/[-_]/)[0])} has it in ${r.terminal}` : r.why ? ` (not dispatched: ${r.why})` : ""}.`,
})

/** Add an event from another plugin's backend or the core (what it would POST); returns it. One asking the user, made
 *  in a session's request, says which session asked. */
plugin.provide("inbox:event", async (b: Item) => {
  const e = eventOf(b)
  const from = e.kind === "waiting" && !(e.terminal || e.session) ? await askerOf() : undefined
  return addEvent(from ? { ...e, from } : e)
})
/** Take away the event of this source and key (what it said isn't so anymore). */
plugin.provide("inbox:drop", (source: string, key: string) => dropEvent(source, key))
/** Mark the event of this source and key done (the core's notice of a paused plugin, once it's allowed again). */
plugin.provide("inbox:done", (source: string, key: string) => markDone(new Set(list().filter((e) => sameKey(e, source, key)).map((e) => e.id))))

/** Who waits on a gate's answer, by its event's id (in memory: after a restart the answer is still on the event). */
const gates = new Map<string, Set<(answer: "approve" | "deny") => void>>()

/** Ask the user's permission for something the server would do: a waiting event with Approve and Deny (phone and
 *  watch too), answered by the owner only. Returns its id; "inbox:answer" waits for the answer. */
plugin.provide("inbox:ask", async (b: Item) => {
  const e = eventOf({ ...b, kind: "waiting", ask: "permission" })
  // (the same ask, by its key, is the one already waiting: answered there, it stays so until inbox:drop)
  const asked = e.key ? list().find((x) => x.gate && sameKey(x, e.source, e.key!)) : null
  if (asked) return asked.id
  const from = await askerOf()
  return addEvent({ ...e, session: `gate-${crypto.randomBytes(6).toString("hex")}`, gate: true, ...(from ? { from } : {}) }).id
})

/** The session whose request this is (its app terminal, its agent's session), by the name the user knows it by. */
async function askerOf(): Promise<InboxEvent["from"]> {
  const w = requestWriter.getStore()
  if (!w || !(w.terminal || w.session)) return undefined
  const agent = whoOf(w.client, w.agent).source
  const k: Who = { agent, terminal: w.terminal ?? "", session: w.session ?? "" }
  const row = list().find((x) => x.kind === "session" && !x.gate && !x.machine && ((!!k.terminal && x.terminal === k.terminal) || (!!k.session && x.session === k.session)))
  const title = row?.title || await sessionTitle(k).catch(() => "") || `${agentLabel(row?.source ?? agent)} session`
  return { title, agent: row?.source ?? agent, ...(k.terminal ? { terminal: k.terminal } : {}), ...(k.session ? { session: k.session } : {}) }
}

/** A gate's answer (approve, deny), or "waiting" once `ms` passed without one; "gone" when the event isn't kept. */
plugin.provide("inbox:answer", (id: string, ms = 0): Promise<"approve" | "deny" | "waiting" | "gone"> => {
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
})

// ---------- the block as text (GET /api/render)

const stampAt = (s: unknown) => stampMs(str(s)) || 0

plugin.block("inbox", (ctx) => {
  const o = ctx.options
  const nr = Number(o.results ?? 10), ne = Number(o.events ?? 5)
  const l = lists(plugin.isOff() ? [] : shown(), asResults(plugin.vault.items("inbox")))
  const results = [...l.pinned.results, ...l.review].slice(0, nr)
  // (what's pinned and what needs the user first, then messages: what agents work on is the Agents panel's)
  const es = [...l.pinned.events, ...l.needs, ...l.messages].slice(0, ne)
  ctx.source([...l.decisions, ...(nr > 0 ? results : [])])
  const parts: string[] = []
  if (l.decisions.length) parts.push(`Decisions:\n${bullets(l.decisions.map(decisionLine))}`)
  if (ne > 0 && es.length) {
    parts.push(`From your agents:\n${bullets(es.map((e) => [fmtAgo(e.t), `${e.title}${e.preview || e.body ? `: ${clip(e.preview || e.body, 200)}` : ""}`,
      e.pinned && "pinned", waitsOnYou(e) ? "needs you" : e.state === "working" ? "working on it" : !e.read && "unread", e.machineLabel && `on ${e.machineLabel}`].filter(Boolean).join(" · ")))}`)
  }
  if (nr > 0 && results.length) {
    parts.push(`To review:\n${bullets(results.map((r) => [`[[${r.id}|${r.title}]]`, r.from && `from ${r.from}`, latest(r) && fmtAgo(stampAt(latest(r)))].filter(Boolean).join(" · ")))}`)
  }
  return [`## ${str(o.title) || "Inbox"}`, parts.length ? parts.join("\n\n") : "_Nothing needs you. When an agent asks you something or leaves you a report, it shows here._"].join("\n\n")
})

/** A decision as one line of text: its question, what it stands at, its options. */
const decisionLine = (r: Item) => {
  const why = previewOf(str(r.body).replace(/```[\s\S]*?```/g, "")).slice(0, 300), gist = str(r.gist) || tldrOf(str(reportOf(str(r.report))?.body ?? ""))
  return [`[[${r.id}|${str(r.question)}]]`, str(r.answer) ? `answered: ${str(r.answer)}` : str(r.closed) ? `closed: ${str(r.closed)}` : r.blocking ? "waits on you" : `went with ${str(r.default)}`,
    `options: ${optionsText(r, " / ")}`, ...(str(r.from) ? [`from ${str(r.from)}${str(r.where) ? ` (${str(r.where)})` : ""}`] : [])].join(" · ") +
    (why ? `\n  - Why: ${why}` : "") + (gist ? `\n  - Its report: ${gist}` : "")
}

/** The decisions a file asks: a decision's own file, itself; a report, the ones it asked (its `report`, or `also`). */
export function decisionsIn(p: string): Item[] {
  const name = baseOf(p)
  const all = plugin.vault.items("inbox").filter((r) => truthy(r.question))
  const own = all.find((r) => `${r.id}.md` === p || r.id === p.replace(/\.md$/, ""))
  if (own) return [own]
  const asks = (r: Item) => baseOf(linkTo(str(r.report))) === name || ((r.also as string[] | undefined) ?? []).some((l) => baseOf(linkTo(l)) === name)
  return sortBy(all.filter(asks), (r) => str(r.created), false)
}

plugin.block("decisions", (ctx) => {
  const ds = decisionsIn(ctx.path)
  ctx.source(ds)
  if (!ds.length) return "_The decisions a report asks the user, each with its options (inbox.report writes them)._"
  return `${bullets(ds.map(decisionLine))}\n\n_Answer one: \`vau inbox decide "<its path>" "<option>"\`._`
})

plugin.block("reply", (ctx) => {
  const r = resultAt(ctx.path)
  if (!r || !(r.terminal || r.session)) return "_A reply box, for an agent's report (inbox.report writes one)._"
  ctx.source([r])
  return `_Reply to ${str(r.from) || "the agent"}: \`vau inbox reply "${ctx.path}" "<text>"\` types it into its session${r.terminal ? ` (${r.terminal})` : ""}._`
})
