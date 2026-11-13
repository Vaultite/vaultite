import { monitorEventLoopDelay } from "node:perf_hooks"
import { localDate, spans, type RequestEnd, type RequestStart, type Span } from "../../../core/plugins.ts"
import type { Actor, ClientPerf, Minute, Perf, RouteStat, SlowRequest, Timing } from "./model.ts"
import { append, DAY, MINUTE, plugin, readDay } from "./store.ts"

export const SLOW = 300

export const clients = new Map<string, ClientPerf>()

type Agg = { n: number; errors: number; total: number; max: number; recent: number[] }
const routes = new Map<string, Agg>()
const slow: SlowRequest[] = []
let reqs = 0, errs = 0, syncs = 0
let cur: { t: number; ms: number[]; errors: number } = { t: Math.floor(Date.now() / MINUTE) * MINUTE, ms: [], errors: 0 }
let minutes: Minute[] | null = null
const lag = monitorEventLoopDelay({ resolution: 20 })
let busyAt = 0
export const busy = () => { if (!busyAt) lag.enable(); busyAt = Date.now() }
plugin.onUnload(() => lag.disable())
plugin.onSync(() => { syncs++ })

export function routeOf(route: string) {
  if (/^ops\/[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(route)) return route
  return route.split("/").map((s) => (/^[a-z][a-z-]*$/.test(s) && s.length <= 24 ? s : "*")).slice(0, 4).join("/") || "/"
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0)
const r1 = (n: number) => Math.round(n * 10) / 10
const mb = (n: number) => Math.round(n / 1048576)

export function timing(s: RequestStart, end: RequestEnd, actor: Actor): SlowRequest | null {
  if (end.ms >= 20 || (s.method !== "GET" && s.method !== "HEAD" && !s.route.startsWith("activity"))) busy()
  rollMinute()
  const key = `${s.method} ${routeOf(s.route)}`
  const a = routes.get(key) ?? { n: 0, errors: 0, total: 0, max: 0, recent: [] }
  const err = end.status >= 500
  a.n++; a.total += end.ms; a.max = Math.max(a.max, end.ms)
  if (err) a.errors++
  a.recent.push(end.ms)
  if (a.recent.length > 200) a.recent.shift()
  routes.set(key, a)
  reqs++
  if (err) errs++
  cur.ms.push(end.ms)
  if (err) cur.errors++
  if (end.ms < SLOW || s.route.startsWith("activity")) return null
  const row = { t: s.t, method: s.method, route: s.route.slice(0, 120), ms: Math.round(end.ms), status: end.status, who: actor.name }
  slow.push(row)
  if (slow.length > 30) slow.shift()
  return row
}

function loadMinutes() {
  if (minutes) return minutes
  const now = Date.now()
  minutes = [...readDay("perf", localDate(now - DAY)), ...readDay("perf", localDate(now))] as Minute[]
  minutes = minutes.filter((m) => m && now - m.t < DAY).sort((a, b) => a.t - b.t)
  return minutes
}

export function rollMinute(force = false) {
  const now = Math.floor(Date.now() / MINUTE) * MINUTE
  if (!force && now === cur.t) return
  const ms = cur.ms.sort((a, b) => a - b)
  const mem = process.memoryUsage()
  const m: Minute = { t: cur.t, n: ms.length, errors: cur.errors, p50: r1(pct(ms, 0.5)), p95: r1(pct(ms, 0.95)), max: r1(ms[ms.length - 1] ?? 0),
    lag: r1(lag.percentile(99) / 1e6), lagMax: r1(lag.max / 1e6), rss: mb(mem.rss), heap: mb(mem.heapUsed) }
  lag.reset()
  if (busyAt && Date.now() - busyAt > MINUTE) { lag.disable(); busyAt = 0 }
  cur = { t: now, ms: [], errors: 0 }
  if (!plugin.loaded) return
  const list = loadMinutes()
  list.push(m)
  while (list.length && Date.now() - list[0].t > DAY) list.shift()
  append("perf", m.t, [m])
}
const roller = setInterval(() => { if (plugin.loaded) rollMinute() }, 15_000)
roller.unref()
plugin.onUnload(() => clearInterval(roller))

export function perf(window: number): Perf {
  rollMinute()
  const mem = process.memoryUsage()
  const rs: RouteStat[] = [...routes].map(([route, a]) => {
    const s = [...a.recent].sort((x, y) => x - y)
    return { route, n: a.n, errors: a.errors, avg: r1(a.total / a.n), p50: r1(pct(s, 0.5)), p95: r1(pct(s, 0.95)), max: r1(a.max) }
  }).sort((a, b) => b.avg * b.n - a.avg * a.n)
  const since = Date.now() - window * MINUTE
  const byName = new Map<string, Span[]>()
  for (const s of spans()) byName.set(s.name, [...(byName.get(s.name) ?? []), s])
  const timings: Timing[] = [...byName].map(([name, list]) => {
    const ms = list.map((s) => s.ms).sort((a, b) => a - b)
    return { name, n: list.length, p50: r1(pct(ms, 0.5)), p95: r1(pct(ms, 0.95)), last: list[list.length - 1] }
  })
  return {
    now: Date.now(), uptime: Math.round(process.uptime()), node: process.version, pid: process.pid,
    rss: mb(mem.rss), heap: mb(mem.heapUsed),
    lag: { p50: r1(lag.percentile(50) / 1e6), p99: r1(lag.percentile(99) / 1e6), max: r1(lag.max / 1e6) },
    requests: reqs, errors: errs, syncs, routes: rs, slow: [...slow].reverse(), timings,
    minutes: loadMinutes().filter((m) => m.t >= since),
    clients: [...clients.values()].sort((a, b) => b.t - a.t),
  }
}

plugin.route("GET", "activity/perf", (req) => perf(Math.min(1440 * 7, Math.max(10, Number(req.query.minutes) || 1440))))
