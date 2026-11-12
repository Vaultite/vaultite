import { KNOWN_AGENTS, parseTerminal } from "../../../core/agents.ts"
import { str, strip } from "./describe.ts"
import { between, changedPaths, changes, isChange, naming } from "./events.ts"
import { actionsOf, type ActivityEvent, type ActivityList, type ActivitySummary, type FileSession } from "./model.ts"
import { DAY, HOUR, plugin, settings } from "./store.ts"

plugin.provide("activity:changes", changes)

/** The agents' sessions among `events` that changed file `p`, newest first: one per agent's session id, else per
 *  terminal (its events from before the id was known take the terminal's). */
export function sessionsOf(events: ActivityEvent[], p: string): FileSession[] {
  const want = strip(p)
  const mine = events.filter((e) => e.actor.kind === "agent" && e.actor.terminal && isChange(e) && changedPaths(e).some((x) => strip(x) === want)).sort((a, b) => a.t - b.t)
  const sidOf = new Map<string, string>()
  for (const e of mine) if (e.actor.sessionId) sidOf.set(e.actor.terminal!, e.actor.sessionId)
  const by = new Map<string, FileSession>()
  for (const e of mine) {
    const sid = e.actor.sessionId ?? sidOf.get(e.actor.terminal!), k = sid ?? `\0${e.actor.terminal}`, at = e.last ?? e.t
    const s = by.get(k) ?? { agent: e.actor.name, first: e.t, last: 0, n: 0, live: false }
    s.n += e.count ?? 1
    if (at >= s.last) { s.last = at; s.agent = e.actor.name; s.terminal = e.actor.terminal }
    if (e.actor.session) s.title = e.actor.session
    if (sid) s.sessionId = sid
    by.set(k, s)
  }
  return [...by.values()].sort((a, b) => b.last - a.last)
}

/** The sessions that changed `p` in the last `days`, each live when its terminal still runs that session. */
export async function fileSessions(p: string, days: number): Promise<FileSession[]> {
  return Promise.all(sessionsOf(await changes(Date.now() - days * DAY), p).map(async (s) => {
    const t = await plugin.ask<{ session?: string; busy?: boolean } | null>("terminal:info", null, s.terminal).catch(() => null)
    const runs = parseTerminal(s.terminal ?? "")?.agent ?? KNOWN_AGENTS.find((a) => a.name === s.agent)?.terminal
    return { ...s, ...(runs ? { runs } : {}), live: !!t?.busy && (!s.sessionId || !t.session || t.session === s.sessionId) }
  }))
}
plugin.route("GET", "activity/sessions", async (req) => ({ sessions: await fileSessions(str(req.query.path), Math.min(31, Math.max(1, Number(req.query.days) || 30))) }))

export function query(q: Record<string, string>): ActivityList {
  const limit = Math.min(500, Math.max(1, Number(q.limit) || 50))
  const before = Number(q.before) || Infinity
  const since = Number(q.since) || Date.now() - settings().keep * DAY
  const pathQ = q.path ? strip(q.path) : ""
  const acts = actionsOf(q.action)
  const at = (e: ActivityEvent) => e.last ?? e.t
  const all = between(since).filter((e) => at(e) < before &&
    (!q.actor || e.actor.kind === q.actor) && (!acts || acts.has(e.action)) && (!q.name || e.actor.name === q.name) &&
    (!pathQ || (e.paths ?? []).some((p) => strip(p) === pathQ)))
  // By when each last happened: a run still going (an editor's autosaves) stays on top.
  all.sort((a, b) => at(a) - at(b))
  return { events: all.slice(-limit).reverse(), total: all.length }
}

// (`settled`: after the writes just answered are recorded, their callers named: who wrote what the app just read)
plugin.route("GET", "activity", async (req) => {
  if (req.query.settled && naming.size) await Promise.race([Promise.all(naming), new Promise((r) => setTimeout(r, 3000))])
  return query(req.query)
})

export function summary(days: number): ActivitySummary {
  const now = Date.now()
  const bucket = days <= 1 ? "hour" : "day"
  const size = bucket === "hour" ? HOUR : DAY
  // Whole hours (or local days) ending with the current one.
  const n = bucket === "hour" ? 24 : days
  let start: number
  if (bucket === "hour") start = Math.floor(now / HOUR) * HOUR - (n - 1) * HOUR
  else { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (n - 1)); start = +d }
  const list = between(start)
  const buckets = Array.from({ length: n }, (_, i) => ({ t: bucket === "hour" ? start + i * size : +new Date(new Date(start).setDate(new Date(start).getDate() + i)), you: 0, agents: 0, other: 0 }))
  const actors = new Map<string, ActivitySummary["actors"][number]>()
  const files = new Map<string, ActivitySummary["files"][number]>()
  for (const e of list) {
    const c = e.count ?? 1
    let i = buckets.length - 1
    while (i > 0 && buckets[i].t > e.t) i--
    const b = buckets[i]
    if (e.actor.kind === "you") b.you += c; else if (e.actor.kind === "agent") b.agents += c; else b.other += c
    const k = `${e.actor.kind}\0${e.actor.name}`
    const a = actors.get(k) ?? { kind: e.actor.kind, name: e.actor.name, n: 0, last: 0 }
    a.n += c
    if ((e.last ?? e.t) >= a.last) { a.last = e.last ?? e.t; if (e.actor.terminal) { a.terminal = e.actor.terminal; a.session = e.actor.session } }
    actors.set(k, a)
    if (e.action === "read" || e.action === "search" || e.action === "open") continue // looked at, not touched
    for (const p of e.paths ?? []) {
      if (p.startsWith(".vaultite/")) continue
      const f = files.get(p) ?? { path: p, n: 0, last: 0, actors: [] }
      f.n += c
      f.last = Math.max(f.last, e.last ?? e.t)
      if (!f.actors.includes(e.actor.name)) f.actors.push(e.actor.name)
      files.set(p, f)
    }
  }
  return { since: start, total: list.reduce((s, e) => s + (e.count ?? 1), 0), bucket, buckets,
    actors: [...actors.values()].sort((a, b) => b.n - a.n),
    files: [...files.values()].sort((a, b) => b.n - a.n || b.last - a.last).slice(0, 12) }
}

plugin.route("GET", "activity/summary", (req) => summary(Math.min(31, Math.max(1, Number(req.query.days) || 1))))
