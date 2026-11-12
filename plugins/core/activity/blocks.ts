import { bullets, fmtAgo, localDate, localTime, section } from "../../../core/plugins.ts"
import { strip } from "./describe.ts"
import type { Actor, ActivityEvent } from "./model.ts"
import { query, summary } from "./reading.ts"
import { plugin } from "./store.ts"
import { perf, SLOW } from "./timings.ts"

const who = (a: Actor) => `${a.name}${a.device && a.kind === "you" ? ` (${a.device})` : ""}${a.session ? ` in "${a.session}"` : ""}`
function line(e: ActivityEvent) {
  let text = e.text
  for (const p of e.paths ?? []) if (/\.md$/.test(p) && !p.startsWith(".")) text = text.replace(p, `[[${strip(p)}]]`)
  return `${localTime(e.t)} · ${who(e.actor)} · ${text}${(e.count ?? 1) > 1 ? ` (×${e.count})` : ""}${e.ms !== undefined && e.ms >= SLOW ? ` · ${e.ms} ms` : ""}`
}

plugin.block("activity", (ctx) => {
  const o = ctx.options
  const pathQ = o.path === "this" ? ctx.path : typeof o.path === "string" ? o.path : ""
  const { events: list } = query({ limit: String(Number(o.limit) || 30), ...(typeof o.actor === "string" ? { actor: o.actor } : {}), ...(pathQ ? { path: pathQ } : {}) })
  const byDay = new Map<string, ActivityEvent[]>()
  for (const e of list) byDay.set(localDate(e.t), [...(byDay.get(localDate(e.t)) ?? []), e])
  if (!byDay.size) return section("Activity", "_Nothing yet._")
  return section("Activity", ...[...byDay].map(([d, es]) => `### ${d}\n\n${bullets(es.map(line))}`))
})

plugin.block("activity-summary", (ctx) => {
  const s = summary(Math.max(1, Number(ctx.options.days) || 1))
  const span = s.bucket === "hour" ? "the last 24 hours" : `the last ${s.buckets.length} days`
  return section(`Activity in ${span}`, `${s.total} things done.`,
    `### Who\n\n${bullets(s.actors.map((a) => `${a.name}: ${a.n}, last ${fmtAgo(a.last)}`))}`,
    `### Files\n\n${bullets(s.files.map((f) => `${/\.md$/.test(f.path) ? `[[${strip(f.path)}]]` : f.path}: ${f.n} (${f.actors.join(", ")})`))}`)
})

const dur = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.floor(s / 86400)} d ${Math.round((s % 86400) / 3600)} h`)

plugin.block("perf-server", (ctx) => {
  const p = perf(Math.max(10, Number(ctx.options.minutes) || 1440))
  const busy = [...p.minutes].sort((a, b) => b.p95 - a.p95)[0]
  return section("Server", bullets([
    `Up ${dur(p.uptime)} (Node ${p.node})`, `Memory: ${p.rss} MB (heap ${p.heap} MB)`,
    `Event loop delay: p50 ${p.lag.p50} ms, p99 ${p.lag.p99} ms, max ${p.lag.max} ms`,
    `Requests: ${p.requests}${p.errors ? `, ${p.errors} failed` : ""}; vault syncs: ${p.syncs}`,
    busy && busy.p95 > 0 ? `Slowest minute: ${localTime(busy.t)}, p95 ${busy.p95} ms over ${busy.n} requests` : "",
  ]))
})

plugin.block("perf-routes", () => {
  const p = perf(60)
  const rows = p.routes.slice(0, 25).map((r) => `| ${r.route} | ${r.n} | ${r.avg} | ${r.p50} | ${r.p95} | ${r.max} | ${r.errors} |`)
  return section("Routes", rows.length ? ["| Route | Count | Avg ms | p50 | p95 | Max | Errors |", "|---|---|---|---|---|---|---|", ...rows].join("\n") : "_No requests yet._",
    `### Slow requests\n\n${bullets(p.slow.slice(0, 10).map((r) => `${localTime(r.t)} · ${r.method} /api/${r.route} · ${r.ms} ms · ${r.who}`), "None over 300 ms.")}`)
})

plugin.block("perf-app", () => {
  const p = perf(60)
  return section("The app", bullets(p.clients.map((c) => [
    `${c.device} (reported ${fmtAgo(c.t)})`,
    c.load !== undefined ? `loaded in ${c.load} ms` : "", c.state !== undefined ? `state ${c.state} ms` : "",
    c.longTasks ? `${c.longTasks} long tasks (${c.longMs} ms)` : "", c.shifts ? `${c.shifts} layout shifts (${c.shift})` : "",
    c.heap !== undefined ? `heap ${c.heap} MB` : "",
  ].filter(Boolean).join(", ")), "No app has reported yet."))
})
