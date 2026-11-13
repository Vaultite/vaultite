import crypto from "node:crypto"
import { type Handler, HTTPError, NOT_THE_USER, reply, type RouteOptions, splitMachine, userSurface, whoOf } from "../../../core/plugins.ts"
import { type Item, str } from "../../../core/vault.ts"
import { byMachine, isOne, onMachine, others } from "./live.ts"
import { doneAs, type InboxEvent, pinnedAs, readThere, snoozedAs, unreadThere } from "./model.ts"
import { holdNow, owner, plugin } from "./server.ts"
import { askerOf } from "./sessions.ts"
import { addEvent, changed, eventOf, gates, list, markDone, markRead, markUnread, needing, pin, remotes, sameKey, shown, snooze, told, unread } from "./store.ts"

export async function postEvent(b: Item) {
  const e = eventOf(b)
  const from = e.kind === "waiting" && !(e.terminal || e.session) ? await askerOf() : undefined
  return addEvent(from ? { ...e, from } : e)
}

export async function askGate(b: Item) {
  const e = eventOf({ ...b, kind: "waiting", ask: "permission" })
  const asked = e.key ? list().find((x) => x.gate && sameKey(x, e.source, e.key!)) : null
  if (asked) return asked.id
  const from = await askerOf()
  return addEvent({ ...e, session: `gate-${crypto.randomBytes(6).toString("hex")}`, gate: true, ...(from ? { from } : {}) }).id
}

const ROUTES: [string, string, Handler, RouteOptions?][] = [
  ["GET", "inbox/events", async (req) => {
    if (plugin.isOff()) throw new HTTPError(404, "the Inbox plugin is off (Plugins)")
    const limit = req.query.all ? Infinity : Math.max(Math.trunc(Number(req.query.limit)) || 50, 1)
    const local = !!req.query.local
    if (!local) await others()
    const es = req.query.open ? shown(local).filter((e) => e.state !== "done") : shown(local)
    return { events: es.slice(0, limit), unread: unread(local), needs: needing(local), hold: holdNow() }
  }],
  ["POST", "inbox/events", async (req) => {
    await owner(req)
    return reply(201, { event: addEvent(eventOf(req.body ?? {})) })
  }],
  ["POST", "inbox/events/read", async (req) => {
    await owner(req)
    const ids = req.body?.ids
    const local = !!req.query.local
    if (!Array.isArray(ids)) {
      markRead(null)
      if (!local) await Promise.all([...remotes.keys()].map((m) => onMachine(m, "POST", "inbox/events/read?local=1", {}, (e) => (e.read ? e : readThere(e))).catch(() => {})))
      return { unread: unread(local) }
    }
    for (const [m, some] of byMachine(ids.map(String))) {
      if (!m) markRead(new Set(some))
      else if (!local) await onMachine(m, "POST", "inbox/events/read?local=1", { ids: some }, (e) => (isOne(e, some) && !e.read ? readThere(e) : e))
    }
    return { unread: unread(local) }
  }],
  ["POST", "inbox/events/unread", async (req) => {
    await owner(req)
    const ids = req.body?.ids
    if (!Array.isArray(ids) || !ids.length) throw new HTTPError(400, "ids: which events to mark unread")
    const local = !!req.query.local
    for (const [m, some] of byMachine(ids.map(String))) {
      if (!m) markUnread(new Set(some))
      else if (!local) await onMachine(m, "POST", "inbox/events/unread?local=1", { ids: some }, (e) => (isOne(e, some) ? unreadThere(e) : e))
    }
    return { unread: unread(local) }
  }],
  ["POST", "inbox/events/done", async (req) => {
    await owner(req)
    const b = req.body ?? {}
    if (!Array.isArray(b.ids) || !b.ids.length) throw new HTTPError(400, "ids: which events are done")
    const done = b.done !== false
    const local = !!req.query.local
    for (const [m, some] of byMachine(b.ids.map(String))) {
      if (!m) markDone(new Set(some), done)
      else if (!local) await onMachine(m, "POST", "inbox/events/done?local=1", { ids: some, done }, (e) => (isOne(e, some) ? doneAs(e, done) : e))
    }
    return { needs: needing(local) }
  }],
  /** Snooze events until `until` (ms; null: back now). A permission the server waits on can't be: it'd wait unseen. */
  ["POST", "inbox/events/snooze", async (req) => {
    await owner(req)
    const b = req.body ?? {}
    if (!Array.isArray(b.ids) || !b.ids.length) throw new HTTPError(400, "ids: which events to snooze")
    const until = b.until === null ? null : Number(b.until)
    if (until !== null && !(until > Date.now())) throw new HTTPError(400, "until: when it comes back (ms), to come; null: back now")
    const local = !!req.query.local
    for (const [m, some] of byMachine(b.ids.map(String))) {
      if (!m) snooze(new Set(some), until)
      else if (!local) await onMachine(m, "POST", "inbox/events/snooze?local=1", { ids: some, until }, (e) => (isOne(e, some) ? snoozedAs(e, until) ?? e : e))
    }
    return { unread: unread(local) }
  }],
  ["POST", "inbox/events/pin", async (req) => {
    await owner(req)
    const b = req.body ?? {}
    if (!Array.isArray(b.ids) || !b.ids.length) throw new HTTPError(400, "ids: which events to pin")
    const on = b.pinned !== false
    const local = !!req.query.local
    for (const [m, some] of byMachine(b.ids.map(String))) {
      if (!m) pin(new Set(some), on)
      else if (!local) await onMachine(m, "POST", "inbox/events/pin?local=1", { ids: some, pinned: on }, (e) => (isOne(e, some) ? pinnedAs(e, on) : e))
    }
    return { pinned: on }
  }],
  /** Answer a permission the server waits on (gate: the service "inbox:ask"): approve or deny. The owner's only, so what
 *  asked can't answer itself. */
  ["POST", "inbox/events/*/answer", async (req) => {
    await owner(req)
    const h = (k: string) => { const v = req.http?.headers[k]; return typeof v === "string" ? v : null }
    if (req.http && !userSurface(whoOf(h("x-vaultite-client"), h("x-vaultite-agent")))) throw new HTTPError(403, NOT_THE_USER)
    const answer = str(req.body?.answer)
    if (answer !== "approve" && answer !== "deny") throw new HTTPError(400, "answer: approve or deny")
    const [bare, there] = splitMachine(req.arg(0))
    if (there) {
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
  }],
  ["DELETE", "inbox/events", async (req) => {
    await owner(req)
    const done = !!req.query.done
    changed(done ? list().filter((e) => e.state !== "done") : [])
    if (!req.query.local) await Promise.all([...remotes.keys()].map((m) => onMachine(m, "DELETE", `inbox/events?local=1${done ? "&done=1" : ""}`, null,
      (e) => (done && e.state !== "done" ? e : null)).catch(() => {})))
    return { ok: true }
  }],
  ["DELETE", "inbox/events/*", async (req) => {
    await owner(req)
    const [id, there] = splitMachine(req.arg(0))
    if (there) {
      await onMachine(there, "DELETE", `inbox/events/${encodeURIComponent(id)}`, null, (e) => (isOne(e, [id]) ? null : e))
      return { ok: true }
    }
    const before = list().length
    changed(list().filter((e) => e.id !== id))
    return { ok: list().length < before }
  }],
]

export function register() {
  for (const [method, pattern, fn, options] of ROUTES) plugin.route(method, pattern, fn, options)
}
