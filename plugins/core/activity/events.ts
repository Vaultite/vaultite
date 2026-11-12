import { localDate } from "../../../core/plugins.ts"
import { ACTION_KINDS, type ActivityEvent } from "./model.ts"
import { append, DAY, logs, plugin, prune, readDay, settings } from "./store.ts"

const KEEP = 5000 // events in memory (the rest are read from the files when asked)
const MERGE = 90_000 // the same thing again within this long is one event with a count

/** Events in memory, the last two days' then what happened since; each written as it happens and again when it grows,
 *  within FLUSH, so a restart (SIGTERM runs no exit hook) loses at most FLUSH. */
export let events: ActivityEvent[] | null = null
const open = new Map<string, ActivityEvent>()
const dirty = new Set<ActivityEvent>()
const FLUSH = 3000
let seq = 0

function latest(rows: ActivityEvent[]) {
  const by = new Map<string, ActivityEvent>()
  for (const e of rows) if (e && e.id) by.set(e.id, e)
  return [...by.values()]
}

function loaded() {
  if (events) return events
  const now = Date.now()
  events = latest([...readDay("events", localDate(now - DAY)), ...readDay("events", localDate(now))] as ActivityEvent[])
  events.sort((a, b) => a.t - b.t)
  if (events.length > KEEP) events = events.slice(-KEEP)
  return events
}

const keyOf = (e: Pick<ActivityEvent, "actor" | "action" | "text">) => `${e.actor.kind}\0${e.actor.name}\0${e.actor.device ?? ""}\0${e.actor.terminal ?? ""}\0${e.action}\0${e.text}`

/** Record something done: merged into the same thing done by the same one within MERGE, else a new event. */
export function record(e: Omit<ActivityEvent, "id">): ActivityEvent {
  const list = loaded()
  const key = keyOf(e)
  const was = open.get(key)
  if (was && e.t - (was.last ?? was.t) < MERGE) {
    was.last = e.t
    was.count = (was.count ?? 1) + 1
    if (e.ms !== undefined) was.ms = Math.max(was.ms ?? 0, e.ms)
    if (e.status !== undefined && e.status >= 400) was.status = e.status
    for (const p of e.paths ?? []) if (!was.paths?.includes(p)) (was.paths ??= []).push(p)
    for (const p of e.wrote ?? []) if (!was.wrote?.includes(p)) (was.wrote ??= []).push(p)
    changed(was)
    return was
  }
  const ev: ActivityEvent = { id: `${e.t.toString(36)}-${(seq++).toString(36)}`, ...e }
  if (ev.paths && !ev.paths.length) delete ev.paths
  // In time order (a caller looked up answers late).
  let i = list.length
  while (i > 0 && list[i - 1].t > ev.t) i--
  list.splice(i, 0, ev)
  if (list.length > KEEP) list.splice(0, list.length - KEEP)
  open.set(key, ev)
  changed(ev)
  return ev
}

export function changed(e: ActivityEvent) {
  keptChange(e)
  dirty.add(e)
  scheduleFlush()
}

export function flush() {
  const now = Date.now()
  for (const [k, e] of open) if (now - (e.last ?? e.t) >= MERGE) open.delete(k)
  const done = [...dirty]
  dirty.clear()
  const byDay = new Map<string, ActivityEvent[]>()
  for (const e of done.sort((a, b) => a.t - b.t)) {
    const d = localDate(e.t)
    byDay.set(d, [...(byDay.get(d) ?? []), e])
  }
  for (const rows of byDay.values()) append("events", rows[0].t, rows)
  prune()
}

let flushTimer: ReturnType<typeof setTimeout> | null = null
function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => { flushTimer = null; flush() }, FLUSH)
  flushTimer.unref()
}
plugin.onUnload(() => { if (events) flush() })

/** Events waiting to be recorded until their caller is named (its process asked): `activity:changes` waits for them. */
export const naming = new Set<Promise<void>>()

export function between(since: number): ActivityEvent[] {
  const list = loaded()
  const memFrom = list.length ? list[0].t : Date.now()
  if (since >= memFrom) return list.filter((e) => e.t >= since)
  const older: ActivityEvent[] = []
  for (let d = since; localDate(d) <= localDate(memFrom); d += DAY) {
    for (const e of latest(readDay("events", localDate(d)) as ActivityEvent[])) if (e.t >= since && e.t < memFrom) older.push(e)
  }
  return [...older.sort((a, b) => a.t - b.t), ...list]
}

/** What another plugin reads of who changed which files (Provenance's review): the events since `since` (ms) that changed
 *  files, oldest first. Read from the files once, then kept up as events come (changed). */
const CHANGES = new Set<string>([...ACTION_KINDS.find((k) => k.id === "changes")!.actions, "request"])
// (a request's are the files it wrote: one only naming a note, a companion started on it, changed nothing)
export const changedPaths = (e: ActivityEvent) => (e.action === "request" ? e.wrote ?? e.paths : e.paths) ?? []
export const isChange = (e: ActivityEvent) => !!changedPaths(e).length && CHANGES.has(e.action)
let changesKept: { list: ActivityEvent[]; has: Set<ActivityEvent> } | null = null
function keptChange(e: ActivityEvent) {
  if (!changesKept || changesKept.has.has(e) || !isChange(e)) return
  changesKept.has.add(e)
  changesKept.list.push(e)
}
export async function changes(since: number) {
  // (a write just answered is recorded once its caller is named: Review keeping "everything" must see it)
  if (naming.size) await Promise.race([Promise.all(naming), new Promise((r) => setTimeout(r, 3000))])
  if (!changesKept) {
    const list = between(Date.now() - settings().keep * DAY).filter(isChange)
    changesKept = { list, has: new Set(list) }
  }
  const from = Date.now() - settings().keep * DAY
  if (changesKept.list[0] && changesKept.list[0].t < from) {
    changesKept.list = changesKept.list.filter((e) => e.t >= from)
    changesKept.has = new Set(changesKept.list)
  }
  return changesKept.list.filter((e) => e.t >= since && isChange(e)).sort((a, b) => a.t - b.t)
    .map((e) => (e.action === "request" && e.wrote ? { ...e, paths: e.wrote } : e))
}
plugin.route("DELETE", "activity", () => {
  events = []
  changesKept = null
  open.clear()
  for (const l of Object.values(logs)) for (const d of l.days()) l.rewrite(d, [])
  return { ok: true }
})
