// How fast the app is: the server, its routes and each window's reports, three blocks sharing one request every
// 15 s.
import { useState } from "react"
import { MonitorSmartphone, Route, Server } from "lucide-react"
import { Empty, Loading, Panel, Section, Stat, useTick } from "@vaultite"
import type { ClientPerf, Minute, Perf, RouteStat } from "./model"
import { Columns } from "./Columns"
import { TINT } from "./Feed"
import { ago, clock, count, mb, ms, stamp, uptime, usePoll } from "./shared"

const minutesOf = (o: Record<string, unknown>) => Math.min(Math.max(typeof o.minutes === "number" ? Math.round(o.minutes) : 1440, 10), 1440 * 7)
const usePerf = (minutes: number) => usePoll<Perf>(`activity/perf?minutes=${minutes}`, 15_000)
const span = (m: number) => (m % 1440 === 0 ? (m === 1440 ? "Last 24 h" : `Last ${m / 1440} days`) : m % 60 === 0 ? `Last ${m / 60} h` : `Last ${m} min`)
const Waiting = ({ error }: { error: string | null }) => <Loading error={error && "Couldn't read the timings."} />

/** Minutes into at most `n` columns over [now - minutes, now]: requests (answered, failed) and the worst p95. */
function bucket(list: Minute[], minutes: number, now: number, n = 72) {
  const cols = Math.min(n, minutes)
  const size = (minutes * 60_000) / cols
  const start = now - minutes * 60_000
  const out = Array.from({ length: cols }, (_, i) => ({ t: start + i * size, n: 0, errors: 0, p95: 0 }))
  for (const m of list) {
    const i = Math.floor((m.t - start) / size)
    if (i < 0 || i >= cols) continue
    out[i].n += m.n
    out[i].errors += m.errors
    out[i].p95 = Math.max(out[i].p95, m.p95)
  }
  return { out, size }
}

export function PerfServer({ options }: { options: Record<string, unknown> }) {
  const minutes = minutesOf(options)
  const { data, error } = usePerf(minutes)
  if (!data) return <Panel title="Server" icon={Server} tint={TINT}><Waiting error={error} /></Panel>
  const { out, size } = bucket(data.minutes, minutes, data.now)
  const range = (t: number) => `${clock(t)}–${clock(t + size)}`
  const from = clock(data.now - minutes * 60_000)
  return (
    <Panel title="Server" icon={Server} tint={TINT} action={<span className="text-[13px] text-muted-foreground">{span(minutes)}</span>}>
      <div className="mb-5 grid grid-cols-2 gap-4 @2xl:grid-cols-4" data-perf-server>
        <Stat label="Up" value={uptime(data.uptime)} hint={`Node ${data.node.replace(/^v/, "")}`} />
        <Stat label="Memory" value={mb(data.rss)} hint={`${mb(data.heap)} heap`} />
        <Stat label="Event loop delay" value={ms(data.lag.p99)} hint={`p99; p50 ${ms(data.lag.p50)}, max ${ms(data.lag.max)}`} />
        <Stat label="Requests" value={count(data.requests)}
          hint={`${data.errors ? `${count(data.errors)} failed` : "none failed"}, ${count(data.syncs)} syncs`} />
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 @2xl:grid-cols-2">
        <Section title="Response time (p95, the slowest minute)">
          <Columns series={[{ key: "p95", label: "p95", color: TINT }]} format={(v) => ms(v)} height={72} from={from} to="Now"
            cols={out.map((b) => ({ values: [b.p95], tip: range(b.t) }))} />
        </Section>
        <Section title="Requests">
          <Columns series={[{ key: "ok", label: "Answered", color: "var(--gray)" }, { key: "failed", label: "Failed", color: "var(--red)" }]}
            legend="totals" format={count} height={72} from={from} to="Now"
            cols={out.map((b) => ({ values: [b.n - b.errors, b.errors], tip: range(b.t) }))} />
        </Section>
      </div>
    </Panel>
  )
}

const th = "px-2 py-1.5 font-medium whitespace-nowrap first:pl-0 first:text-left last:pr-0 text-right"
const td = "px-2 py-1.5 tabular-nums whitespace-nowrap first:pl-0 first:text-left last:pr-0 text-right"
const wide = "hidden @md:table-cell"

function RouteRows({ routes }: { routes: RouteStat[] }) {
  return (
    <tbody className="hairline">
      {routes.map((r) => (
        <tr key={r.route} data-route={r.route}>
          <td className={`${td} w-full max-w-0`}><div className="truncate font-mono text-[12px]" data-tip={`/api/${r.route}`} data-tip-trunc>{r.route}</div></td>
          <td className={td}>{count(r.n)}</td>
          <td className={`${td} ${wide}`}>{ms(r.avg)}</td>
          <td className={`${td} ${wide}`}>{ms(r.p50)}</td>
          <td className={td}>{ms(r.p95)}</td>
          <td className={`${td} ${wide}`}>{ms(r.max)}</td>
          <td className={`${td} ${r.errors ? "text-[var(--red)]" : "text-muted-foreground"}`}>{r.errors ? count(r.errors) : "–"}</td>
        </tr>
      ))}
    </tbody>
  )
}

export function PerfRoutes({ options }: { options: Record<string, unknown> }) {
  const minutes = minutesOf(options)
  const { data, error } = usePerf(minutes)
  const [all, setAll] = useState(false)
  useTick()
  if (!data) return <Panel title="Routes" icon={Route} tint={TINT}><Waiting error={error} /></Panel>
  // The routes that took the server the most time, first.
  const routes = [...data.routes].sort((a, b) => b.n * b.avg - a.n * a.avg)
  const shown = all ? routes : routes.slice(0, 12)
  return (
    <Panel title="Routes" icon={Route} tint={TINT} action={<span className="text-[13px] text-muted-foreground">{span(minutes)}</span>}>
      {!routes.length ? <Empty>No requests yet.</Empty> : (
        <div className="@container" data-perf-routes>
          <table className="w-full border-collapse text-[13px]">
            <thead className="text-muted-foreground">
              <tr>
                <th className={th}>Route</th>
                <th className={th}>Count</th>
                <th className={`${th} ${wide}`}>Avg</th>
                <th className={`${th} ${wide}`}>p50</th>
                <th className={th}>p95</th>
                <th className={`${th} ${wide}`}>Max</th>
                <th className={th}>Errors</th>
              </tr>
            </thead>
            <RouteRows routes={shown} />
          </table>
          {routes.length > 12 && (
            <button type="button" onClick={() => setAll(!all)} className="mt-1 min-h-9 cursor-pointer text-[13px] text-primary hover:underline">
              {all ? "Show fewer" : `Show all ${routes.length}`}
            </button>
          )}
          <p className="mt-1 text-[13px] text-muted-foreground">Sorted by the time the server spent on each, in all.</p>
        </div>
      )}
      <Section title="Slow requests" className="mt-5">
        {!data.slow.length ? <Empty>None over 300 ms.</Empty> : (
          <div className="hairline" data-perf-slow>
            {data.slow.slice(0, 10).map((r, i) => (
              <div key={`${r.t}-${i}`} className="flex min-h-11 items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[13px] leading-[20px]">{r.method} /api/{r.route}</div>
                  <div className="truncate text-[13px] text-muted-foreground">
                    <span data-tip={stamp(r.t)}>{ago(r.t)}</span> · {r.who}{r.status >= 400 ? ` · ${r.status}` : ""}
                  </div>
                </div>
                <span className="shrink-0 text-[14px] text-muted-foreground tabular-nums">{ms(r.ms)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </Panel>
  )
}

const DEVICES: Record<string, string> = { desktop: "Desktop app", web: "Browser", phone: "Phone" }

function Small({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[13px] text-muted-foreground">{label}</div>
      <div className="num text-[17px] leading-[22px] font-semibold">{value}</div>
    </div>
  )
}

function Client({ c }: { c: ClientPerf }) {
  const api = [...(c.api ?? [])].sort((a, b) => b.max - a.max).slice(0, 5)
  return (
    <Section title={<span>{DEVICES[c.device] ?? c.device} · <span className="font-normal" data-tip={stamp(c.t)}>reported {ago(c.t)}</span></span>}>
      <div className="grid grid-cols-3 gap-3 py-2">
        <Small label="Load" value={ms(c.load)} />
        <Small label="First byte" value={ms(c.ttfb)} />
        <Small label="/api/state" value={ms(c.state)} />
        <Small label={c.longTasks ? `Long tasks (${c.longTasks})` : "Long tasks"} value={c.longTasks ? ms(c.longMs) : "None"} />
        <Small label="Page ready" value={ms(c.ready)} />
        <Small label="Memory" value={c.heap !== undefined ? mb(c.heap) : "–"} />
        <Small label={c.shifts ? `Layout shifts (${c.shifts})` : "Layout shifts"} value={c.shifts ? String(c.shift) : "None"} />
      </div>
      {api.length > 0 && (
        <div className="hairline mt-1">
          {api.map((r) => (
            <div key={r.route} className="flex min-h-9 items-center gap-3 py-1.5 text-[13px]">
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{r.route}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums" data-tip={`${r.n} calls: median ${ms(r.p50)}, slowest ${ms(r.max)}`}>
                ×{r.n} · {ms(r.p50)} · <span className="text-foreground">{ms(r.max)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

export function PerfApp({ options }: { options: Record<string, unknown> }) {
  const { data, error } = usePerf(minutesOf(options))
  useTick()
  return (
    <Panel title="The app" icon={MonitorSmartphone} tint={TINT}>
      {!data ? <Waiting error={error} /> : !data.clients.length ? (
        <Empty>No app has reported yet. Each open app reports its own timings once a minute.</Empty>
      ) : (
        <div className="space-y-5" data-perf-app>
          {[...data.clients].sort((a, b) => b.t - a.t).map((c) => <Client key={c.device} c={c} />)}
          <p className="text-[13px] text-muted-foreground">Its API calls since its last report, as the app saw them (the network included): calls, median, slowest.</p>
        </div>
      )}
    </Panel>
  )
}
