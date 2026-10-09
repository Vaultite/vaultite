// Inbox: what agents tell the user. Events stay on this machine (one per turn would churn iCloud), shown with the other
// machines' as one inbox, written only by the owner; results are Inbox/ files.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { type RawData, WebSocket } from "ws"
import { startAgent } from "../../../core/codingagents.ts"
import { AGENT, agentIn, newTerminalId, parseTerminal, resumeTerminalId } from "../../../core/terminalids.ts"
import {
  bullets, hookCommand, HTTPError, LOADED, localDate, localTime, MACHINE_CLIENT, machineSocket, OpError, Plugin, reply, splitMachine, type Machine,
  type OpCtx, type Request,
} from "../../../core/plugins.ts"
import { isArchived, type Item, Kind, localStamp, nowUtc, sortBy, str, truthy, writeAtomic } from "../../../core/vault.ts"
import * as push from "./push.ts"

export const plugin = new Plugin(import.meta.url)

const FOLDER = "Inbox"
const MAX = 200 // read events kept: unread ones stay until they're read or dismissed
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
      machine: truthy(fm.machine) ? str(fm.machine) : "", body,
    }, STATUSES.includes(status) ? [] : [`status \`${status}\` is not one of ['new', 'done']`]]
  },
  render: (r) => [{ status: r.status || "new", from: r.from || null, source: r.source || null, created: r.created, updated: r.updated || null, origin: r.origin || null,
    agent: r.agent || null, session: r.session || null, terminal: r.terminal || null, machine: r.machine || null }, r.body || ""],
  // Done is archived and archived is done: one state, the file in Inbox/.archive/ (out of the way), whichever key said
  // so. Taking either back (Back to review, Undo, the same page added again) makes it new, out of the archive.
  prepare(r, old) {
    r.created = r.created || nowUtc()
    r.status = r.status || "new"
    const reopened = old && ((old.status === "done" && r.status === "new") || (isArchived(old) && !isArchived(r)))
    const done = !reopened && (r.status === "done" || isArchived(r))
    if (done) r.status = "done"
    else if (reopened) r.status = "new"
    r.archived = done
    return r
  },
  // New first, the latest first within each (a thread by its last report).
  order: (rs) => sortBy(sortBy(rs, latest, true), (r) => (r.status === "new" ? 0 : 1)),
  // Where it came from (a page's address): adding the same page again updates it.
  key: (r) => (truthy(r.source) ? str(r.source) : null),
  stamps: ["created", "updated"],
}))

/** When a result last had news: its thread's latest report (`updated`), else when it came. */
export const latest = (r: Item) => str(r.updated || r.created || "")

/** Where results go (where the Inbox's files are, else Inbox/): the clipper asks (its `inbox` option), only while this
 *  plugin is on. */
plugin.provide("inbox:folder", () => plugin.vault.home("inbox") ?? FOLDER)

// ---------- events, kept on this machine

export type InboxEvent = {
  id: string; t: number
  /** Who: a coding agent's name (claude, codex), or anything that posts ("vau", "backup"). */
  source: string
  /** What: done, waiting, error, or info (anything else reads as info). */
  kind: string
  title: string; body?: string
  /** What a click opens: a vault path, a view ("view:terminal/<id>"), a sheet ("detail:review") or a web address. */
  link?: string
  /** One of a kind: a new event with its source and key takes the place of the one before (Lessons' "cards due"). */
  key?: string
  /** The app's terminal it happened in, and the agent's session: a click goes there. */
  terminal?: string; session?: string
  /** What a waiting agent asks: permission (to run a tool: Approve and Deny answer it), question, plan. */
  ask?: string
  /** A permission the server itself waits on (not a terminal's: the service "inbox:ask", e.g. an app connected to the
   *  MCP asking to run what can run code here), and once answered, the answer. */
  gate?: boolean
  answer?: "approve" | "deny"
  read?: boolean
  /** Marked unread by hand: the Inbox seen doesn't read it, only opening it or marking it read. */
  kept?: boolean
  /** Another machine's (Machines): its id there is `<id>@<machine>` here, its terminal too. */
  machine?: string; machineLabel?: string
}

/** This vault's folder here: <LOCAL>/inbox/<vault key>/ (made when an event is saved). */
const dir = () => plugin.localDir(false)

function settings() {
  const s = plugin.loaded ? plugin.settings({}) : {}
  return { keep: Math.max(1, Number(s.keep_days) || 7), push: ["all", "waiting", "off"].includes(str(s.push)) ? str(s.push) : "all",
    turns: str(s.turns) === "notify" ? "notify" : "quiet", audio: s.voice_audio !== false,
    dispatch: AGENT.test(str(s.dispatch).trim()) ? str(s.dispatch).trim() : "",
    prompt: str(s.dispatch_prompt).trim() || str(plugin.manifest.settings?.dispatch_prompt?.default) }
}

let events: InboxEvent[] | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function list(): InboxEvent[] {
  if (events) return events
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir(), "events.json"), "utf8"))
    events = Array.isArray(data.events) ? data.events.filter((e: InboxEvent) => e && typeof e.id === "string") : []
  } catch {
    events = []
  }
  return events!
}

/** Read ones go after keep_days, past the latest MAX read; an unread one stays until it's read or dismissed. */
export function prune(es: InboxEvent[]) {
  const since = Date.now() - settings().keep * DAY
  let read = 0
  return es.filter((e) => !e.read || (e.t >= since && ++read <= MAX))
}

function save() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      fs.mkdirSync(dir(), { recursive: true })
      writeAtomic(path.join(dir(), "events.json"), JSON.stringify({ events: list() }))
    } catch (e) { console.error("inbox:", e) }
  }, 200)
}
plugin.onUnload(() => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null } })

/** This machine's events and the other machines' (newest first), or only this one's (`local`: what another machine follows). */
const shown = (local = false) => local || !remotes.size ? list() : [...list(), ...[...remotes.values()].flatMap((r) => r.events)].sort((a, b) => b.t - a.t)
const unread = (local = false) => shown(local).filter((e) => !e.read).length

function changed(next: InboxEvent[]) {
  events = prune(next)
  save()
  broadcast()
  // The phone's agents widget shows who's waiting: only a change there reloads it.
  const now = list().filter((e) => !e.read && e.kind === "waiting").map((e) => e.id).join()
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
  const e: Omit<InboxEvent, "id" | "t"> = {
    source: clip(b.source, 40).toLowerCase() || "vau",
    kind: /^[a-z][a-z-]{0,19}$/.test(str(b.kind)) ? str(b.kind) : "info",
    title,
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

const ASKS = ["permission", "question", "plan"]

/** Add an event (or update the same one, unread, from within a minute: a hook that fired twice, Claude Code's own hook
 *  and the user's both reporting a turn). Returns it. */
function addEvent(given: Omit<InboxEvent, "id" | "t">): InboxEvent {
  const now = Date.now()
  const es = list().filter((e) => !given.key || !sameKey(e, given.source, given.key))
  // The same thing: an agent's turn (done, waiting) from the same session or terminal, however its hooks word it; a
  // message (info, error: `vau notify`) only with the same words too, so a few told in a row from one terminal each show.
  const who = (e: Omit<InboxEvent, "id" | "t">) => e.kind === "done" || e.kind === "waiting"
    ? e.session || e.terminal || e.title
    : `${e.session || e.terminal || ""}\0${e.title}`
  const same = es.find((e) => !e.read && now - e.t < MERGE && e.source === given.source && e.kind === given.kind && who(e) === who(given))
  if (same) {
    const merged: InboxEvent = { ...same, ...given, id: same.id, t: now,
      terminal: given.terminal ?? same.terminal, session: given.session ?? same.session, body: given.body ?? same.body, link: given.link ?? same.link }
    changed([merged, ...es.filter((e) => e !== same)])
    told(merged)
    return merged
  }
  const e: InboxEvent = { id: `${now.toString(36)}-${crypto.randomBytes(3).toString("hex")}`, t: now, ...given }
  changed([e, ...es])
  told(e)
  pushed(e)
  return e
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
    plugin.emit("inbox.event", { id: e.id, kind: e.kind, source: e.source, title: e.title, ...(e.terminal ? { terminal: e.terminal } : {}),
      ...(e.session ? { session: e.session } : {}), ...(e.link ? { link: e.link } : {}) })
  } catch { /* not loaded by an App (a test calling it alone) */ }
}

const readThere = (e: InboxEvent): InboxEvent => { const { kept: _, ...rest } = e; return { ...rest, read: true } }

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
  const next = list().map((e) => (ids.has(e.id) && (e.read || !e.kept) ? (n++, { ...e, read: false, kept: true }) : e))
  if (n) changed(next)
  return n
}

/** The agent's question was answered (its terminal went from waiting back to working): its waiting events are read. */
function resolve(terminal: string, session: string) {
  const hit = list().filter((e) => !e.read && e.kind === "waiting" && ((terminal && e.terminal === terminal) || (session && e.session === session)))
  if (hit.length) markRead(new Set(hit.map((e) => e.id)))
}

// ---------- live: /api/inbox/live (?local=1: this machine's events only, what another machine follows)

const watchers = new Map<WebSocket, boolean>() // socket -> this machine's events only
let sendTimer: ReturnType<typeof setTimeout> | null = null

const message = (local: boolean) => JSON.stringify({ t: "events", events: shown(local), unread: unread(local) })

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
})

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
      if (remotes.get(m.id) === r) { remotes.delete(m.id); broadcast(false) }
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
  if (plugin.isOff()) throw new HTTPError(404, "the Inbox plugin is off (Settings > Plugins)")
  const why = req.http ? await plugin.refusal(req.http, "the inbox") : ""
  if (why) throw new HTTPError(403, why)
}

plugin.route("GET", "inbox/events", async (req) => {
  if (plugin.isOff()) throw new HTTPError(404, "the Inbox plugin is off (Settings > Plugins)")
  const limit = req.query.all ? Infinity : Math.max(Math.trunc(Number(req.query.limit)) || 50, 1)
  const local = !!req.query.local
  if (!local) await others()
  return { events: shown(local).slice(0, limit), unread: unread(local) }
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
    else if (!local) await onMachine(m, "POST", "inbox/events/unread?local=1", { ids: some }, (e) => (isOne(e, some) ? { ...e, read: false, kept: true } : e))
  }
  return { unread: unread(local) }
})

/** Answer a permission the server waits on (gate: the service "inbox:ask"): approve or deny. The owner's only, so what
 *  asked can't answer itself. */
plugin.route("POST", "inbox/events/*/answer", async (req) => {
  await owner(req)
  const answer = str((req.body as Item)?.answer)
  if (answer !== "approve" && answer !== "deny") throw new HTTPError(400, "answer: approve or deny")
  const [bare, there] = splitMachine(req.arg(0))
  if (there) {
    // Its gate waits on that machine's server.
    await onMachine(there, "POST", `inbox/events/${encodeURIComponent(bare)}/answer`, { answer }, (x) => (isOne(x, [bare]) ? { ...readThere(x), answer } : x))
    return { id: req.arg(0), answer }
  }
  const e = list().find((x) => x.id === bare)
  if (!e?.gate) throw new HTTPError(404, "no permission waits with that id")
  if (e.answer) throw new HTTPError(409, "it was answered already")
  const done: InboxEvent = { ...readThere(e), answer }
  changed(list().map((x) => (x === e ? done : x)))
  for (const settle of [...gates.get(e.id) ?? []]) settle(answer)
  told(done)
  return { id: e.id, answer }
})

plugin.route("DELETE", "inbox/events", async (req) => {
  await owner(req)
  changed([])
  if (!req.query.local) await Promise.all([...remotes.keys()].map((m) => onMachine(m, "DELETE", "inbox/events?local=1", null, () => null).catch(() => {})))
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

const apns = () => ((plugin.secrets().inbox ?? {}) as Item).apns as push.Apns ?? null

/** A new event to the phones (the setting `push`: all, waiting, off). A permission an app terminal waits on gets
 *  Approve and Deny (Push.swift's category "permission"); the rest Mark read. Never fails the event. */
function pushed(e: InboxEvent) {
  const mode = settings().push
  if (e.read || mode === "off" || (mode === "waiting" && e.kind !== "waiting" && e.kind !== "error") || !push.devices().length) return
  void push.send(apns(), {
    title: e.title, body: e.body,
    category: e.ask === "permission" && (e.terminal || e.gate) ? "permission" : "event",
    thread: e.terminal || e.session || e.source, urgent: e.kind === "waiting",
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

// ---------- coding agents' hooks

/** What a hook said, as an event's kind and words, or null (nothing to tell), or `resolve` (an answer went in). `q`:
 *  the query (Terminal's `state`, `prev`); `j`: the hook's JSON (Claude Code's or Codex's notify). */
export function fromHook(q: Record<string, string>, j: Item): { kind: "done" | "waiting"; body: string; session: string; cwd: string; ask?: string } | { resolve: true; session: string } | null {
  const hook = str(j.hook_event_name)
  const session = clip(j.session_id ?? j["thread-id"] ?? j.thread_id ?? j.sessionID, 120)
  const cwd = str(j.cwd)
  const message = clip(j.message, 300)
  let kind: "done" | "waiting"
  if (q.state) {
    if (q.state === "idle" && q.prev === "working") kind = "done"
    else if (q.state === "waiting" && q.prev !== "waiting") kind = "waiting"
    else if (q.state === "working" && q.prev === "waiting") return { resolve: true, session }
    else return null
  } else if (hook === "Stop" || j.type === "agent-turn-complete") kind = "done"
  else if (hook === "Notification") {
    // Sitting at its prompt for a minute isn't news: Stop said it finished.
    if (j.notification_type === "idle_prompt" || /waiting for your input/i.test(message)) return null
    kind = "waiting"
  } else if (hook === "UserPromptSubmit") return { resolve: true, session }
  else return null
  let body = "", ask: string | undefined
  if (kind === "waiting") {
    ask = j.notification_type === "permission_prompt" ? "permission" : j.tool_name === "ExitPlanMode" ? "plan" : "question"
    const input = (j.tool_input ?? {}) as Item
    const question = Array.isArray(input.questions) ? clip((input.questions[0] as Item)?.question, 200) : ""
    body = message || (question ? `Asks: ${question}` : j.tool_name === "ExitPlanMode" ? "A plan to approve" : j.tool_name ? `Wants to use ${clip(j.tool_name, 40)}` : "")
  } else {
    const last = str(j.last_assistant_message ?? j["last-assistant-message"]).split("\n").map((l) => l.trim()).find(Boolean) ?? ""
    body = clip(last.replace(/[*_`#>]+/g, ""), 200)
  }
  return { kind, body, session, cwd, ...(ask ? { ask } : {}) }
}

/** A coding agent's name as its plugin calls itself ("Claude Code"), from the plugin that runs it in a terminal. */
function agentLabel(name: string) {
  const p = LOADED.find((x) => Object.hasOwn(x.services, `agent:${name}`))
  return p ? str(p.manifest.name) : name ? name[0].toUpperCase() + name.slice(1) : "An agent"
}

plugin.route("POST", "inbox/hook", async (req) => {
  await owner(req)
  const q = req.query
  const j = (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Item
  const agent = clip(q.agent, 40).toLowerCase() || "agent"
  const terminal = TERMINAL.test(str(q.terminal)) ? str(q.terminal) : ""
  const h = fromHook(q, j)
  if (!h) return { ok: true }
  if ("resolve" in h) { resolve(terminal, h.session); return { ok: true } }
  // A handed terminal's turn that reported ended: so does the terminal, once the agent has written it down.
  const reportedAt = h.kind === "done" && terminal ? ending.get(terminal) : undefined
  if (reportedAt !== undefined) {
    ending.delete(terminal)
    if (Date.now() - reportedAt < ENDING) {
      hand(terminal, false)
      setTimeout(() => void plugin.runOp("terminal.end", { id: terminal, keepTabs: true }, undefined, req.http).catch(() => {}), 2000)
    }
  }
  // What the user knows it by: the terminal's name (Claude Code names it after the session), else its folder.
  const named = terminal ? await plugin.ask<{ title?: string } | null>("terminal:info", null, terminal) : null
  const where = str(named?.title) || (h.cwd ? path.basename(h.cwd) : "")
  const label = agentLabel(agent)
  // Its report (inbox.report) said what it did, with a link to it: the turn ending right after is that, not news.
  const reported = h.kind === "done" && list().find((e) => !e.read && e.kind === "done" && e.link && Date.now() - e.t < MERGE &&
    ((h.session && e.session === h.session) || (terminal && e.terminal === terminal)))
  if (reported) return { ok: true, event: reported }
  // A question says what it asks; a finished turn which session it was (its last words when nothing names it).
  const body = h.kind === "waiting" ? h.body || where : where || h.body
  // A turn that ends isn't the work done (it may go on: a subagent, a background task); its report says that. Kept
  // read, so nothing toasts or pushes, unless the setting `turns` says notify.
  const quiet = h.kind === "done" && settings().turns !== "notify"
  const event = addEvent({ ...(quiet ? { read: true } : {}),
    source: agent, kind: h.kind,
    title: h.kind === "done" ? `${label} finished` : `${label} is waiting for you`,
    ...(body ? { body } : {}), ...(terminal ? { terminal } : {}), ...(h.session ? { session: h.session } : {}),
    ...(h.ask ? { ask: h.ask } : {}),
  })
  return { ok: true, event }
})

/** For Terminal's state command: the shell command that tells the inbox a terminal's new state (hook JSON on stdin,
 *  $prev). Never fails the hook (2 s at most). */
plugin.provide("inbox:hook", (agent: string, terminal: string) => {
  return (state: string) => hookCommand("inbox/hook", { agent, terminal }, `&state=${state}&prev=$prev`)
})

// ---------- operations (core/ops.ts): `vau inbox ...` (cli.ts routes to them), MCP's inbox_add


plugin.op({
  id: "inbox.list",
  cli: "inbox",
  mcp: "inbox",
  summary: "What's new in the inbox: results to review (Inbox/, status new) and what agents said (finished, waiting), newest first.",
  help: `Results are files in Inbox/ the user hasn't reviewed yet; events are what coding agents said (kept on the machine they
happened on until read, then for a week; another machine's id ends in @<machine>), each with its id (inbox.read, inbox.unread take them).

  vau inbox`,
  kind: "read",
  params: { limit: { type: "integer", minimum: 1, default: 20, description: "at most this many events" } },
  run: async ({ limit }, ctx) => {
    const [ev, items] = await Promise.all([ctx.api("GET", `inbox/events?limit=${limit}`), ctx.api("GET", "inbox")]) as [Item, Item[]]
    const results = (items ?? []).filter((r) => r.status === "new" && !isArchived(r)).map((r) => ({ path: `${r.id}.md`, title: r.title, from: r.from ?? null, created: r.created ?? null, updated: r.updated ?? null }))
    return { results, events: ev.events, unread: ev.unread }
  },
  text: (r) => {
    const out: string[] = []
    if (r.results.length) out.push("To review:", ...r.results.map((x: Item) => `  ${x.path}${x.from ? `  (from ${x.from})` : ""}`))
    if (r.events.length) {
      out.push(`${out.length ? "\n" : ""}Events (${r.unread} unread):`,
        ...r.events.map((e: InboxEvent) => `  ${localTime(e.t)}  ${e.read ? " " : "*"} ${e.title}${e.body ? `: ${e.body}` : ""}  (${e.id})`))
    }
    return out.length ? out.join("\n") : "Nothing new."
  },
})

plugin.op({
  id: "inbox.add",
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
  },
  args: ["title"],
  run: async (p, ctx) => {
    const r = await ctx.api("POST", "inbox", { title: p.title.trim(), body: withTldr(str(p.tldr), str(p.body).trim()), from: str(p.from).trim() || ctx.who.label,
      ...(str(p.source).trim() ? { source: str(p.source).trim() } : {}) })
    return { path: `${r.id}.md`, title: r.title }
  },
  text: (r) => `In the user's inbox: ${r.path} (they'll see it marked new).`,
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

const IMAGE = /\.(png|jpe?g|gif|webp)$/i
const REPLY_BLOCK = "```block-reply\n```"

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

/** Where a reply to a report goes: typed into its terminal still running; else its session resumed while the prompt
 *  cache lasts (cheap), else a new session told to read the report. `want`: resume or new, whatever the cache. */
type Plan = { how: "type" | "resume" | "new"; to: string; ago: number | null; ttl: number | null; transcript: string }
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
  if (fresh) return { how: "new", to: fresh, ...known }
  return null
}

plugin.op({
  id: "inbox.report",
  cli: "inbox report",
  owner: "files on this machine",
  lock: false,
  summary: "End a task you were handed (a voice note, a dispatch) with a report in the user's inbox: what you did, open questions, screenshots; they reply from it into this session.",
  help: `A result in Inbox/ (marked new, a toast, a push to the phone and watch) that says which session wrote it (the
terminal and Claude Code's session, from VAULTITE_TERMINAL and CLAUDE_CODE_SESSION_ID): its Reply box sends the
user's answer back here (this session resumed, or a new one once its context is no longer cached). Make it stand
alone, for the user who may not remember asking and for a new session that picks it up without yours: what was asked
(link the note), what you did, where (files, repo, branch, commit), what's left. Questions only you can't settle (a
choice, an approval), one each. Handed a task to do alone (a dispatch, a voice note), your terminal ends once this
turn does: report last. Your session's next report (after the user's reply) goes on in the same file, under its title,
and the file's title says where it stands now: one file per exchange.
The title starts with what kind of work it was and where it stands, so the user reads the inbox at a glance: work
(feature, fix, change, research, plan, answer) and state (done; waiting when you ask questions; stuck when you couldn't
finish) make "Feature done · Sidebar scrolls again". tldr goes on top: what happened and what you need from them, in
two or three plain sentences, no jargon; the push says it too.

  vau inbox report "Sidebar scrolls again" --work fix --tldr "The left sidebar scrolls again. Live on the M1." \\
    --summary "The sidebar's list had ..." --questions "Ship it to the phone too?" --images /tmp/before.png /tmp/after.png`,
  kind: "write",
  params: {
    title: { type: "string", required: true, description: "what was done, in a few words, in sentence case (after the work and state: Feature done · <title>)" },
    work: { type: "string", enum: Object.keys(WORK), required: true, description: "what kind of work: feature, fix, change (a refactor, a setting, a cleanup), research, plan (a proposal to approve), answer" },
    state: { type: "string", enum: Object.keys(STATE), description: "where it stands: done, waiting (on the user: your questions), stuck (couldn't finish); waiting when there are questions, else done" },
    tldr: { type: "string", required: true, description: "on top: what happened and what you need from the user, in two or three plain sentences" },
    summary: { type: "string", required: true, description: "what you did and where to look, as Markdown" },
    questions: { type: "array", items: { type: "string" }, commas: false, description: "open questions for the user, one each" },
    images: { type: "array", items: { type: "string" }, description: "screenshots: files on this machine (absolute paths) or in the vault (png, jpg, gif, webp)" },
    terminal: { type: "string", env: "VAULTITE_TERMINAL", description: "the app terminal you run in (filled in from VAULTITE_TERMINAL)" },
    session: { type: "string", env: "CLAUDE_CODE_SESSION_ID", description: "your session's id, to resume it (filled in from CLAUDE_CODE_SESSION_ID)" },
    agent: { type: "string", description: "who you are (claude, codex): from the terminal's id when left out" },
  },
  args: ["title"],
  run: async (p, ctx) => {
    const summary = str(p.summary).trim(), tldr = str(p.tldr).trim()
    if (!summary) throw new OpError("summary: what you did and where to look")
    if (!tldr) throw new OpError("tldr: what happened and what you need from the user, in two or three plain sentences")
    const questions = ((p.questions ?? []) as string[]).map((q) => q.replace(/\s+/g, " ").trim()).filter(Boolean)
    const title = reportTitle(str(p.work), str(p.state) || (questions.length ? "waiting" : "done"), str(p.title).trim())
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
      const up = await ctx.op("file.upload", { data: data.toString("base64"), name: path.basename(f) }) as { path: string }
      images.push(up.path)
    }
    const terminal = TERMINAL.test(str(p.terminal).trim()) ? str(p.terminal).trim() : ""
    const session = clip(p.session, 120)
    const agent = clip(p.agent, 40).toLowerCase() || agentOfTerminal(terminal)
    const machine = terminal || session ? await selfMachine() : null
    if (terminal && handed().includes(terminal)) ending.set(terminal, Date.now())
    const round = [withTldr(tldr, ""), summary,
      questions.length ? `## Open questions\n\n${questions.map((q) => `- ${q}`).join("\n")}` : "",
      images.length ? `## Screenshots\n\n${images.map((i) => `![[${path.posix.basename(i)}]]`).join("\n\n")}` : ""].filter(Boolean).join("\n\n")
    const who = { ...(agent ? { agent } : {}), ...(session ? { session } : {}), ...(terminal ? { terminal } : {}), ...(machine ? { machine } : {}) }
    // The same session's report before (the one the user replied to): this one goes on in it, so an exchange is one file.
    await plugin.vault.sync()
    const prior = sortBy(plugin.vault.items("inbox").filter((x) => (terminal && str(x.terminal) === terminal) || (session && str(x.session) === session)),
      latest, true)[0]
    let r: Item
    if (prior) {
      await editBody(prior.id, (body) => {
        const next = `## ${title}\n\n${round}\n\n`
        const at = body.lastIndexOf(REPLY_BLOCK)
        return at < 0 ? `${body.replace(/\n*$/, "")}\n\n${next}${REPLY_BLOCK}\n` : body.slice(0, at) + next + body.slice(at)
      })
      r = await ctx.api("PUT", `inbox/${encodeURIComponent(prior.id)}`, { status: "new", updated: nowUtc(), title: reportTitle(str(p.work), str(p.state) || (questions.length ? "waiting" : "done"), subjectOf(str(prior.title))), ...who }) as Item
    } else {
      r = await ctx.api("POST", "inbox", { title, body: [round, terminal || session ? REPLY_BLOCK : ""].filter(Boolean).join("\n\n"), from: agent ? agentLabel(agent) : ctx.who.label, ...who }) as Item
    }
    const file = `${r.id}.md`
    const first = tldr.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim()
    addEvent({ source: agent || "vau", kind: "done", title: `${agent ? `${agentLabel(agent)}: ` : ""}${title}`, link: file,
      ...(first ? { body: clip(first, 200) } : {}), ...(terminal ? { terminal } : {}), ...(session ? { session } : {}) })
    return { path: file, title: r.title, images, terminal: terminal || null, session: session || null, ...(prior ? { thread: true } : {}) }
  },
  text: (r) => `In the user's inbox: ${r.path}${r.thread ? " (added to this session's report before, as a thread)" : ""}.` + (r.terminal || r.session ? " Their reply comes back to this session" +
    (r.terminal && ending.has(r.terminal) ? "; this terminal ends when this turn does." : ".") : ""),
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

plugin.op({
  id: "inbox.reply-plan",
  owner: "the terminal",
  lock: false,
  summary: "Where a reply to an agent's report would go now: typed into its running terminal, its session resumed (its context still cached), or a new session.",
  kind: "read",
  params: { path: { type: "string", format: "path", required: true, description: "the report (Inbox/<Title>.md)" } },
  args: ["path"],
  run: async (p, ctx) => {
    const r = resultAt(str(p.path).trim())
    if (!r) throw new OpError(`no report ${p.path} in the inbox`, 404)
    const { sessions } = await ctx.api("GET", "terminals/sessions") as { sessions: { id: string }[] }
    const alive = (id: string) => sessions.some((s) => s.id === id)
    const at = await elsewhere(r, alive)
    if (at) return onSessionMachine(ctx, at, "inbox.reply-plan", { path: `${r.id}.md` })
    const plan = await replyPlan(r, alive)
    return { how: plan?.how ?? null, ago: plan?.ago ?? null, ttl: plan?.ttl ?? null }
  },
  text: (r) => r.how === "type" ? "Typed into its terminal, still running." : r.how === "resume" ? "Its session resumed" +
    (r.ago !== null && r.ttl ? ` (its context is cached for ${Math.max(0, Math.round((r.ttl - r.ago) / 60))} min more).` : ".")
    : r.how === "new" ? "A new session, told to read the report (its old context is no longer cached)." : "Nowhere: it names no session.",
})

plugin.op({
  id: "inbox.reply",
  cli: "inbox reply",
  owner: "the terminal",
  lock: false,
  summary: "Answer an agent's report: typed into its session if it still runs, else the session resumed while its context is cached, else a new session told to read the report; kept in the report, and the report is done.",
  help: `What the report's Reply box does. The report names its terminal and session (inbox.report writes them): a
terminal still running gets the reply as a new message. Once it has ended, the session is resumed with it while the
agent's prompt cache lasts (Claude Code: an hour, or five minutes, after its last response): its whole context, cheap.
Later, resuming would send the whole conversation again at full price, so a new session starts, told to read the
report (and where the old transcript is). Either runs in the background (no tab opens), and ends once it reports
again. how: resume or new, whatever the cache. The reply is added to the report, which is marked done (into
Inbox/.archive/) unless keep, and names the session answering it: that session's next report goes on in it (back to
new). A session on another of the Machines gets it through the app there.

  vau inbox reply "Inbox/Sidebar scrollbar fixed.md" "Yes, ship it to the phone too"`,
  kind: "write",
  params: {
    path: { type: "string", format: "path", required: true, description: "the report (Inbox/<Title>.md)" },
    text: { type: "string", required: true, description: "the reply" },
    how: { type: "string", enum: ["auto", "resume", "new"], description: "resume its session, or start a new one (default auto: by its cache)" },
    keep: { type: "boolean", description: "leave the report new (not done)" },
  },
  args: ["path", "text"],
  run: async (p, ctx) => {
    // One line for the agent (a newline typed into its terminal would send it early); the report keeps its lines.
    const lines = str(p.text).trim(), text = lines.replace(/\s*\n\s*/g, " ")
    if (!text) throw new OpError("text: the reply")
    await plugin.vault.sync()
    const r = resultAt(str(p.path).trim())
    if (!r) throw new OpError(`no report ${p.path} in the inbox`, 404)
    const terminal = str(r.terminal), session = str(r.session), agent = str(r.agent) || agentOfTerminal(terminal)
    if (!terminal && !(session && agent)) throw new OpError("this result doesn't say which session wrote it (only inbox.report's do)", 409)
    const { sessions } = await ctx.api("GET", "terminals/sessions") as { sessions: { id: string; state?: string }[] }
    const alive = (id: string) => !!id && sessions.some((s) => s.id === id)
    const at = await elsewhere(r, alive)
    if (at) return onSessionMachine(ctx, at, "inbox.reply", { path: `${r.id}.md`, text: str(p.text), ...(p.how ? { how: p.how } : {}), ...(p.keep ? { keep: true } : {}) })
    const plan = await replyPlan(r, alive, str(p.how))
    if (!plan) throw new OpError(`its terminal ${terminal} has ended and the report has no session to resume`, 409)
    const again = "when it's done, report again with vau inbox report"
    if (plan.how === "type") {
      const said = `(A reply to your report ${r.id}.md; ${again}) ${text}`
      // (at its prompt: sent and checked; while it works, the message waits in its queue)
      if (sessions.find((s) => s.id === plan.to)?.state === "idle") await submit(ctx, plan.to, said)
      else await ctx.api("POST", `terminals/${encodeURIComponent(plan.to)}/send`, { text: said, enter: true })
    } else {
      const said = plan.how === "resume" ? `(A reply to your report ${r.id}.md; ${again}) ${text}`
        : `(A reply to the report \`${r.id}.md\`, which an earlier session wrote: you start without its context.) Read the ` +
          `report first: what was asked, what was done, what's left.${plan.transcript ? ` That session's transcript is ` +
          `\`${plan.transcript}\`: search it for a detail the report doesn't give, don't read it whole.` : ""} Then do what ` +
          `the reply asks, and ${again}. The user's reply: ${text}`
      await startAgent(ctx, plan.to, said)
      hand(plan.to)
    }
    const quoted = lines.split(/\r?\n/).map((l) => `> ${l}`.trimEnd()).join("\n")
    const now = new Date()
    await editBody(r.id, (body) => {
      const note = `> [!note] You replied · ${localDate(now)} ${localTime(now)}\n${quoted}\n\n`
      const at = body.lastIndexOf(REPLY_BLOCK)
      return at < 0 ? `${body.replace(/\n*$/, "")}\n\n${note}` : body.slice(0, at) + note + body.slice(at)
    })
    // The report now names the session that answers it: its next report goes on in this file, and so do later replies.
    const next = { ...(plan.to !== terminal ? { terminal: plan.to } : {}), ...(plan.how === "new" ? { session: "" } : {}) }
    if ((!p.keep && r.status !== "done") || Object.keys(next).length) {
      await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { ...next, ...(!p.keep ? { status: "done" } : {}) })
    }
    return { path: `${r.id}.md`, terminal: plan.to, how: plan.how, resumed: plan.how === "resume", done: !p.keep }
  },
  text: (r) => `${r.how === "resume" ? "Resumed its session" : r.how === "new" ? "Started a new session" : "Sent"} in ${r.terminal}${r.done ? "; the report is done" : ""}.`,
})

plugin.op({
  id: "inbox.done",
  cli: "inbox done",
  summary: "Mark a result in the inbox done: it's archived (into Inbox/.archive/), named anew when given a title.",
  help: `What the user's Done does: the file moves into Inbox/.archive/, out of what's to review. An agent handed a voice
note ends with it (not by editing its status: that leaves it in the inbox). With title, it's renamed too.

  vau inbox done "Inbox/Remind me to call Alice about….md" --title "Call Alice about the trip"`,
  kind: "write",
  params: {
    path: { type: "string", format: "path", required: true, description: "the result (Inbox/<Title>.md)" },
    title: { type: "string", description: "a better name for it, in a few words, in sentence case" },
  },
  args: ["path"],
  action: { on: ["inbox"], param: "path", label: "Mark done", icon: "check-check", menu: false },
  run: async (p, ctx) => {
    await plugin.vault.sync()
    const r = resultAt(str(p.path).trim())
    if (!r) throw new OpError(`no ${p.path} in the inbox`, 404)
    const title = str(p.title).replace(/\s+/g, " ").trim()
    const done = await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { status: "done", ...(title ? { title } : {}) }) as Item
    return { path: `${done.id}.md` }
  },
  text: (r) => `Done: ${r.path}.`,
})

plugin.op({
  id: "inbox.read",
  cli: "inbox read",
  summary: "Mark the inbox's events read: some by id (vau inbox lists them), or all.",
  kind: "write",
  params: { ids: { type: "array", items: { type: "string" }, description: "the events' ids; none: every event" } },
  args: ["ids"],
  run: async ({ ids }, ctx) => ({ ...(await ctx.api("POST", "inbox/events/read", ids?.length ? { ids } : {})), all: !ids?.length }),
  text: (r) => (r.all ? "Every event is read." : `Read. ${r.unread} unread.`),
})

plugin.op({
  id: "inbox.unread",
  cli: "inbox unread",
  summary: "Mark events unread by hand: they stay unread when the Inbox is seen, until opened or marked read.",
  kind: "write",
  params: { ids: { type: "array", items: { type: "string" }, required: true, description: "the events' ids (vau inbox lists them)" } },
  args: ["ids"],
  run: async ({ ids }, ctx) => {
    if (!ids.length) throw new OpError("which events: their ids (vau inbox lists them)")
    return await ctx.api("POST", "inbox/events/unread", { ids })
  },
  text: (r) => `Unread. ${r.unread} unread.`,
})

plugin.op({
  id: "inbox.clear",
  cli: "inbox clear",
  summary: "Forget every event in the inbox (results in Inbox/ stay).",
  kind: "destructive",
  run: async (_p, ctx) => await ctx.api("DELETE", "inbox/events"),
  text: () => "Forgot every event.",
})

plugin.op({
  id: "inbox.answer",
  cli: "inbox answer",
  summary: "Answer an event, as its phone notification's buttons do: approve or deny the permission an agent waits on, or read.",
  help: `approve presses Enter in the agent's terminal (its first choice, Yes), deny presses Escape (No); only for an agent
asking permission in an app terminal (the event's ask is permission), and only while its terminal still shows the
question. read marks the event read.

  vau inbox answer lzk3p2-a1b2c3 approve`,
  kind: "write",
  params: {
    id: { type: "string", required: true, description: "the event's id (vau inbox lists them)" },
    answer: { type: "string", enum: ["approve", "deny", "read"], required: true, description: "approve, deny or read" },
  },
  args: ["id", "answer"],
  run: async ({ id, answer }, ctx) => {
    const { events } = await ctx.api("GET", "inbox/events?all=1") as { events: InboxEvent[] }
    const e = events.find((x) => x.id === id)
    if (!e) throw new OpError(`no event ${id} (vau inbox lists them)`, 404)
    if (answer !== "read") {
      if (e.gate) {
        await ctx.api("POST", `inbox/events/${encodeURIComponent(id)}/answer`, { answer })
        return { id, answer, title: e.title, terminal: null }
      }
      if (e.kind !== "waiting" || e.ask !== "permission" || !e.terminal || e.terminal.includes("@")) {
        throw new OpError("only an agent asking permission in this machine's app terminal can be approved or denied", 409)
      }
      if (e.read) throw new OpError("it was answered already", 409)
      const t = encodeURIComponent(e.terminal)
      // Its question at the bottom of the screen (Claude Code's dialog: the question, then its choices), not one above.
      const screen = await ctx.api("GET", `terminals/${t}/screen?lines=12`) as { lines: string[] }
      if (!/Do you want to/.test(screen.lines.slice(-12).join("\n"))) throw new OpError("its terminal isn't asking for a permission now", 409)
      await ctx.api("POST", `terminals/${t}/send`, answer === "approve" ? { text: "", enter: true } : { text: "\x1b", enter: false })
    }
    await ctx.api("POST", "inbox/events/read", { ids: [id] })
    return { id, answer, title: e.title, terminal: e.terminal ?? null }
  },
  text: (r) => (r.answer === "read" ? `Read: ${r.title}.` : `${r.answer === "approve" ? "Approved" : "Denied"}${r.terminal ? ` in ${r.terminal}` : `: ${r.title}`}.`),
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
  text: (r) => `Sent to ${r.sent} device${r.sent === 1 ? "" : "s"}${r.failed.length ? `; failed: ${r.failed.join(", ")}` : ""}.`,
})

/** What the front door (an agent the setting `dispatch` names) is told with a voice note: the setting
 *  `dispatch_prompt`, its {path}, {folder} and {text} filled in. */
const DISPATCH = (file: string, text: string) => settings().prompt.replace(/\{(path|folder|text)\}/g, (_, k: string) =>
  (k === "path" ? file : k === "folder" ? path.posix.dirname(file) : text))

/** Type a message into an agent at its prompt and send it: when it isn't working a few seconds later, its Enter didn't
 *  take (Claude Code's vim mode can keep a long text as typed), so Escape, then Enter again. */
async function submit(ctx: OpCtx, id: string, text: string) {
  const t = encodeURIComponent(id)
  const working = async () => {
    for (let i = 0; i < 8; i++) {
      await new Promise((res) => setTimeout(res, 500))
      const { sessions } = await ctx.api("GET", "terminals/sessions") as { sessions: { id: string; state?: string }[] }
      if (sessions.find((s) => s.id === id)?.state !== "idle") return true
    }
    return false
  }
  await ctx.api("POST", `terminals/${t}/send`, { text, enter: true })
  if (await working()) return
  await ctx.api("POST", `terminals/${t}/send`, { text: "\x1b", enter: false })
  await new Promise((res) => setTimeout(res, 300))
  await ctx.api("POST", `terminals/${t}/send`, { text: "", enter: true })
}

/** Words past which a voice note isn't handed to the front door (about ten minutes of talk). */
const LONG_VOICE = 1500

/** Start the front door with a voice note: a new terminal running the agent (its id), the note its first prompt, given
 *  as it starts (typed in at its prompt, a fresh TUI could drop the start of it). */
async function dispatch(ctx: OpCtx, agent: string, file: string, text: string): Promise<string> {
  const id = newTerminalId(agent)
  await startAgent(ctx, id, DISPATCH(file, text))
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
    audio: { type: "string", description: "the recording, base64: kept as an attachment, embedded above what was said" },
    ext: { type: "string", description: "the recording's extension (m4a, webm)" },
  },
  args: ["text"],
  run: async ({ text, from, audio, ext }, ctx) => {
    const said = text.trim()
    if (!said) throw new OpError("nothing was said")
    const words = said.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim().split(" ")
    const first = words.slice(0, 8).join(" ")
    const title = `${first[0]?.toUpperCase() ?? ""}${first.slice(1)}${words.length > 8 ? "…" : ""}` || "Voice note"
    // The user's own words (Provenance's label for what they write, while it's on); an AI app's (MCP) are its own.
    const origin = (plugin.service(ctx.who.client === "mcp" ? "provenance:agent" : "provenance:user") as (() => string) | null)?.() || undefined
    // The recording above its words, as a note's recording sits above its transcript.
    let body = said
    if (audio && settings().audio) {
      const kind = /^[a-z0-9]{1,5}$/i.test(str(ext)) ? str(ext).toLowerCase() : "m4a"
      const up = await ctx.op("file.upload", { data: audio, name: `Voice note ${localStamp().replace(/(\d\d)(\d\d)(\d\d)$/, "$1.$2.$3")}.${kind}` })
      body = `![[${path.posix.basename(str(up.path))}]]\n\n${said}`
    }
    const r = await ctx.api("POST", "inbox", { title, body, from: str(from).trim() || ctx.who.label, origin })
    const file = `${r.id}.md`
    const agent = settings().dispatch
    let terminal: string | null = null, why = ""
    // Past a few minutes of talk it's a recording left running or a meeting, not a request: kept, not handed on.
    if (agent && words.length > LONG_VOICE) why = `${words.length} words is a recording, not a request: it's in the inbox`
    else if (agent) {
      try { terminal = await dispatch(ctx, agent, file, said) } catch (e) { why = (e as Error).message }
    }
    return { path: file, terminal, why }
  },
  text: (r) => `In the inbox: ${r.path}${r.terminal ? `; the front door has it in ${r.terminal}` : r.why ? ` (not dispatched: ${r.why})` : ""}.`,
})

/** Add an event from another plugin's backend (what it would POST): the service "inbox:event". */
plugin.provide("inbox:event", (b: Item) => addEvent(eventOf(b)))
plugin.provide("inbox:drop", (source: string, key: string) => dropEvent(source, key))

/** Who waits on a gate's answer, by its event's id (in memory: after a restart the answer is still on the event). */
const gates = new Map<string, Set<(answer: "approve" | "deny") => void>>()

/** Ask the user's permission for something the server would do: a waiting event with Approve and Deny (phone and
 *  watch too), answered by the owner only. Returns its id; "inbox:answer" waits for the answer. */
plugin.provide("inbox:ask", (b: Item) =>
  addEvent({ ...eventOf({ ...b, kind: "waiting", ask: "permission" }), session: `gate-${crypto.randomBytes(6).toString("hex")}`, gate: true }).id)

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

function ago(t: number) {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000))
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}
const utcMs = (s: unknown) => { const t = Date.parse(`${str(s).replace(" ", "T")}Z`); return Number.isNaN(t) ? 0 : t }

plugin.block("inbox", (ctx) => {
  const o = ctx.options
  const nr = Number(o.results ?? 10), ne = Number(o.events ?? 5)
  const results = plugin.vault.items("inbox").filter((r) => r.status === "new" && !isArchived(r)).slice(0, nr)
  const es = plugin.isOff() ? [] : shown().slice(0, ne)
  ctx.source(nr > 0 ? results : [])
  const parts: string[] = []
  if (nr > 0 && results.length) {
    parts.push(`To review:\n${bullets(results.map((r) => [`[[${r.id}|${r.title}]]`, r.from && `from ${r.from}`, latest(r) && ago(utcMs(latest(r)))].filter(Boolean).join(" · ")))}`)
  }
  if (ne > 0 && es.length) {
    parts.push(`Events:\n${bullets(es.map((e) => [ago(e.t), `${e.title}${e.body ? `: ${e.body}` : ""}`, !e.read && "unread"].filter(Boolean).join(" · ")))}`)
  }
  return [`## ${str(o.title) || "Inbox"}`, parts.length ? parts.join("\n\n") : "_Nothing new._"].join("\n\n")
})

plugin.block("reply", (ctx) => {
  const r = resultAt(ctx.path)
  if (!r || !(r.terminal || r.session)) return "_A reply box, for an agent's report (inbox.report writes one)._"
  ctx.source([r])
  return `_Reply to ${str(r.from) || "the agent"}: \`vau inbox reply "${ctx.path}" "<text>"\` types it into its session${r.terminal ? ` (${r.terminal})` : ""}._`
})
