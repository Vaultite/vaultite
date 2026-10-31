// Machine health: a sample a minute of load, memory and the busiest processes, kept on this machine, never the vault
// (a write a minute into iCloud adds to the very churn it's there to catch). Read it with `vau machines health`.
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"

export type Pressure = "normal" | "warn" | "critical"
/** A process at a sample: its CPU % over the last minute (100 is one core) and its resident memory in MB. */
export type Top = { name: string; pid: number; cpu: number; rss: number }
export type Sample = {
  t: number; load: number[]
  /** Memory in MB; `free` the % free (macOS' memorystatus level, Linux's MemAvailable). */
  mem: { total: number; free: number; pressure: Pressure }
  swap: { used: number; total: number }
  procs: Top[]
}
type Row = { pid: number; name: string; pcpu: number; secs: number; rss: number }

export const EVERY = 60_000
export const KEEP_DAYS = 7
const TOP = 5
const HOG_CPU = 50, HOG_MIN = 5 // a report's sustained hog: this % (or a tenth of RAM) for this many samples
export const ALERT_CPU = 80, ALERT_SAMPLES = 10, ALERT_GAP = 6 * 3600_000

const run = (cmd: string, args: string[]) => new Promise<string>((resolve) =>
  execFile(cmd, args, { timeout: 5000, maxBuffer: 8 << 20, env: { ...process.env, LC_ALL: "C" } }, (_e, out) => resolve(String(out ?? ""))))

/** ps' cumulative CPU time in seconds: macOS' "2266:09.79", procps' "01:02:03" or "1-02:03:04". */
export function cpuSeconds(s: string) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(s.trim())
  return m ? Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]) : 0
}

/** `ps -A -o pid=,pcpu=,time=,rss=,comm=` as rows (comm last: macOS gives a path, with spaces). */
export function parsePs(text: string): Row[] {
  const out: Row[] = []
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+([\d.]+)\s+(\S+)\s+(\d+)\s+(.+)$/.exec(line)
    if (m) out.push({ pid: Number(m[1]), pcpu: Number(m[2]), secs: cpuSeconds(m[3]), rss: Math.round(Number(m[4]) / 1024), name: m[5].trim().split("/").pop()! })
  }
  return out
}

/** The top processes by CPU and by memory, CPU from the time each used since the last sample (ps' own % is a decayed
 *  average on macOS and a lifetime one on Linux); a process new since then has ps' %. */
export function topOf(rows: Row[], prev: Map<number, number>, ms: number): Top[] {
  const all = rows.map((r) => {
    const was = prev.get(r.pid)
    const cpu = was !== undefined && ms > 0 && r.secs >= was ? (r.secs - was) / (ms / 1000) * 100 : r.pcpu
    return { name: r.name, pid: r.pid, cpu: Math.round(cpu), rss: r.rss }
  })
  const byCpu = [...all].sort((a, b) => b.cpu - a.cpu).slice(0, TOP).filter((p) => p.cpu >= 1)
  const byRss = [...all].sort((a, b) => b.rss - a.rss).slice(0, TOP)
  return [...new Set([...byCpu, ...byRss])]
}

/** macOS' `sysctl -n hw.memsize vm.swapusage kern.memorystatus_vm_pressure_level kern.memorystatus_level`. */
export function parseSysctl(text: string) {
  const [mem, swap, level, free] = text.trim().split("\n")
  const mb = (k: string) => { const m = new RegExp(`${k} = ([\\d.]+)([MG])`).exec(swap ?? ""); return m ? Math.round(Number(m[1]) * (m[2] === "G" ? 1024 : 1)) : 0 }
  const pressure: Pressure = level?.trim() === "4" ? "critical" : level?.trim() === "2" ? "warn" : "normal"
  return { mem: { total: Math.round(Number(mem) / 1048576) || 0, free: Number(free) || 0, pressure }, swap: { used: mb("used"), total: mb("total") } }
}

/** Linux's /proc/meminfo: pressure from what's available (under 5% critical, 15% warn). */
export function parseMeminfo(text: string) {
  const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(text)?.[1] ?? 0)
  const total = kb("MemTotal"), free = total ? Math.round(kb("MemAvailable") / total * 100) : 0
  const pressure: Pressure = free < 5 ? "critical" : free < 15 ? "warn" : "normal"
  return { mem: { total: Math.round(total / 1024), free, pressure }, swap: { used: Math.round((kb("SwapTotal") - kb("SwapFree")) / 1024), total: Math.round(kb("SwapTotal") / 1024) } }
}

let last: { t: number; secs: Map<number, number> } | null = null
/** One sample of this machine now (null on Windows: no ps). */
export async function sample(): Promise<Sample | null> {
  if (process.platform !== "darwin" && process.platform !== "linux") return null
  const t = Date.now()
  const [ps, mem] = await Promise.all([
    run("ps", ["-A", "-o", "pid=,pcpu=,time=,rss=,comm="]),
    process.platform === "darwin" ? run("/usr/sbin/sysctl", ["-n", "hw.memsize", "vm.swapusage", "kern.memorystatus_vm_pressure_level", "kern.memorystatus_level"]).then(parseSysctl)
      : fs.promises.readFile("/proc/meminfo", "utf8").catch(() => "").then(parseMeminfo),
  ])
  const rows = parsePs(ps)
  const procs = topOf(rows, last?.secs ?? new Map(), last ? t - last.t : 0)
  last = { t, secs: new Map(rows.map((r) => [r.pid, r.secs])) }
  return { t, load: os.loadavg().map((x) => Math.round(x * 100) / 100), ...mem, procs }
}

/** What's held this machine over the samples: processes busy (CPU) or big (memory) through many of them, each with when
 *  it was first and last seen so, and how often memory was under pressure. */
export type Hog = { name: string; pid: number; samples: number; cpu: number; rss: number; first: number; last: number }
export type Report = {
  host: string; cores: number; since: number; samples: number; from: number | null; now: Sample | null
  cpu: Hog[]; memory: Hog[]; pressure: { warn: number; critical: number }; swapMax: number
}
export function report(samples: Sample[], since: number, host = os.hostname().replace(/\.local$/, "")): Report {
  const now = samples.at(-1) ?? null
  const big = Math.max(512, (now?.mem.total ?? 0) / 10)
  const cpu = new Map<string, Hog>(), mem = new Map<string, Hog>()
  const add = (m: Map<string, Hog>, s: Sample, p: Top) => {
    const k = `${p.pid}\0${p.name}`, h = m.get(k)
    if (!h) return void m.set(k, { name: p.name, pid: p.pid, samples: 1, cpu: p.cpu, rss: p.rss, first: s.t, last: s.t })
    h.cpu = (h.cpu * h.samples + p.cpu) / (h.samples + 1)
    h.samples++; h.rss = Math.max(h.rss, p.rss); h.last = s.t
  }
  const pressure = { warn: 0, critical: 0 }
  let swapMax = 0
  for (const s of samples) {
    for (const p of s.procs) {
      if (p.cpu >= HOG_CPU) add(cpu, s, p)
      if (p.rss >= big) add(mem, s, p)
    }
    if (s.mem.pressure !== "normal") pressure[s.mem.pressure]++
    swapMax = Math.max(swapMax, s.swap.used)
  }
  const held = (m: Map<string, Hog>, by: (h: Hog) => number) => [...m.values()].filter((h) => h.samples >= HOG_MIN)
    .map((h) => ({ ...h, cpu: Math.round(h.cpu) })).sort((a, b) => b.samples - a.samples || by(b) - by(a)).slice(0, 10)
  return { host, cores: os.cpus().length, since, samples: samples.length, from: samples[0]?.t ?? null, now,
    cpu: held(cpu, (h) => h.cpu), memory: held(mem, (h) => h.rss), pressure, swapMax }
}

const gb = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
const when = (t: number) => { const d = new Date(t), p = (n: number) => String(n).padStart(2, "0"); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}` }

export function reportText(r: Report) {
  if (!r.now) return `${r.host}: no samples yet (one a minute while the server runs, on macOS and Linux).`
  const n = r.now
  const out = [`${r.host} at ${when(n.t)}: load ${n.load.join(" ")} (${r.cores} cores), memory ${n.mem.total ? `${n.mem.pressure} (${n.mem.free}% free of ${gb(n.mem.total)})` : "unread"}, swap ${gb(n.swap.used)}${n.swap.total ? ` of ${gb(n.swap.total)}` : ""}`,
    `Top now: ${[...n.procs].sort((a, b) => b.cpu - a.cpu).map((p) => `${p.name} (${p.pid}) ${p.cpu}% ${gb(p.rss)}`).join(", ")}`, ""]
  const since = (h: Hog) => `${h.first === r.from ? "since before " : "from "}${when(h.first)}${n.t - h.last < 2 * EVERY ? ", still now" : ` to ${when(h.last)}`}`
  out.push(`Since ${when(r.from!)} (${r.samples} sample${r.samples === 1 ? "" : "s"}, a minute apart):`)
  out.push(r.cpu.length ? "Sustained CPU:" : `No process held ${HOG_CPU}% CPU for ${HOG_MIN} min.`)
  for (const h of r.cpu) out.push(`- ${h.name} (${h.pid}): ${h.cpu}% for ${h.samples} min, ${since(h)}`)
  out.push(r.memory.length ? "Big in memory:" : "No process held a tenth of the memory.")
  for (const h of r.memory) out.push(`- ${h.name} (${h.pid}): up to ${gb(h.rss)} for ${h.samples} min, ${since(h)}`)
  out.push(`Memory pressure: critical ${r.pressure.critical} min, warn ${r.pressure.warn} min; swap up to ${gb(r.swapMax)}`)
  return out.join("\n")
}

/** What to tell the user after a sample: a process over ALERT_CPU or memory critical (pressure, or swap past 3/4 of RAM)
 *  for ALERT_SAMPLES in a row, each once per ALERT_GAP. `state` is kept between calls. */
export type Watch = { streaks: Map<string, { since: number; n: number; cpu: number }>; told: Map<string, number> }
export const watch = (): Watch => ({ streaks: new Map(), told: new Map() })
export type Alert = { key: string; title: string; body: string }
export function alerts(w: Watch, s: Sample, host: string): Alert[] {
  const out: Alert[] = []
  const memBad = s.mem.pressure === "critical" || (s.mem.total > 0 && s.swap.used >= s.mem.total * 0.75)
  const seen = new Set<string>()
  const step = (key: string, on: boolean, cpu: number) => {
    if (!on) return void w.streaks.delete(key)
    seen.add(key)
    const st = w.streaks.get(key) ?? { since: s.t, n: 0, cpu: 0 }
    st.cpu = (st.cpu * st.n + cpu) / (st.n + 1); st.n++
    w.streaks.set(key, st)
    if (st.n < ALERT_SAMPLES || s.t - (w.told.get(key) ?? -Infinity) < ALERT_GAP) return null
    w.told.set(key, s.t)
    return st
  }
  for (const p of s.procs) {
    if (seen.has(`cpu-${p.name}`)) continue // (one streak a name: a sample's second Chrome helper isn't another minute)
    const st = step(`cpu-${p.name}`, p.cpu >= ALERT_CPU, p.cpu)
    if (st) out.push({ key: `cpu-${p.name}`, title: `${host}: ${p.name} has used ${Math.round(st.cpu)}% CPU for ${Math.round((s.t - st.since) / EVERY) + 1} min`,
      body: `Since ${when(st.since)}, pid ${p.pid}, ${gb(p.rss)}. \`vau machines health\` on ${host} says what else.` })
  }
  for (const k of [...w.streaks.keys()]) if (k.startsWith("cpu-") && !seen.has(k)) w.streaks.delete(k)
  const st = step("memory", memBad, 0)
  if (st) out.push({ key: "memory", title: `${host}: memory critical for ${Math.round((s.t - st.since) / EVERY) + 1} min`,
    body: `${s.mem.free}% free of ${gb(s.mem.total)}, swap ${gb(s.swap.used)}; biggest: ${[...s.procs].sort((a, b) => b.rss - a.rss).slice(0, 3).map((p) => `${p.name} ${gb(p.rss)}`).join(", ")}.` })
  return out
}

/** "6h", "30m", "2d" as ms. */
export function duration(s: string) {
  const m = /^(\d+(?:\.\d+)?)\s*([mhd])$/.exec(s.trim())
  if (!m) throw new Error(`'${s}' isn't a duration like 30m, 6h or 2d`)
  return Number(m[1]) * { m: 60_000, h: 3600_000, d: 86400_000 }[m[2] as "m" | "h" | "d"]
}
