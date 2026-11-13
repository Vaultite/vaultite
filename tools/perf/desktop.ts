// Desktop app cold start (spawn to window, page load, first paint, usable, each part's CPU), then idle: CPU, memory,
// requests, IPC and React commits. node tools/perf/desktop.ts [--scale 1] [--launches 5] [--settle 10] [--idle 30] [--roots <a>,<b>] [--out r.json]
import "../test/isolate.ts" // (first: a run of its own, kept off the user's vaults)
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { _electron, type ElectronApplication } from "playwright-core"
import { makeVault } from "./vault.ts"

const arg = (name: string, dflt: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt }
const SCALE = Number(arg("scale", "1")), LAUNCHES = Number(arg("launches", "5")), SETTLE = Number(arg("settle", "10")), IDLE = Number(arg("idle", "30")), OUT = arg("out", "")
const ROOTS = arg("roots", path.join(import.meta.dirname, "..", "..")).split(",").map((r) => path.resolve(r))
const WIN = process.platform === "win32"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-desktop-perf-"))

type Launch = {
  window: number; page: number; paint: number; ready: number; renderer: number; app: number; server: number
  requests: number; ipc: number; commits: number
  idleRenderer: number; idleApp: number; idleServer: number; idleRequests: number; idleIpc: number; idleCommits: number
  memRenderer: number; memApp: number; memServer: number; memTotal: number
}
type Extra = { parts: Record<string, Record<string, number>>; memory: Record<string, number>; private: number; server: string; channels: Record<string, number>; idleChannels: Record<string, number>; idleRoutes: Record<string, number> }

type Proc = { pid: number; ppid: number; cpu: number; mem: number; name: string }
/** Every process: CPU ms, memory MB. Linux's /proc (ps there counts whole seconds), Windows' CIM, else ps. */
function processes(): Proc[] {
  if (process.platform === "linux") {
    return fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d)).flatMap((pid) => {
      try {
        // (after the command's closing paren: ppid is field 4, utime and stime 14 and 15 in clock ticks (100 a second))
        const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8"), f = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
        const rss = Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0)
        return [{ pid: Number(pid), ppid: Number(f[1]), cpu: (Number(f[11]) + Number(f[12])) * 10, mem: rss / 1024, name: stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")")) }]
      } catch { return [] }
    })
  }
  if (WIN) {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | % { \"$($_.ProcessId) $($_.ParentProcessId) $($_.UserModeTime + $_.KernelModeTime) $($_.WorkingSetSize) $($_.Name)\" }"],
      { encoding: "utf8", windowsHide: true, maxBuffer: 16 << 20 })
    return out.trim().split(/\r?\n/).map((l) => { const [pid, ppid, t, ws, name] = l.trim().split(/\s+/); return { pid: +pid, ppid: +ppid, cpu: +t / 1e4, mem: +ws / 1048576, name } })
  }
  // ([[dd-]hh:]mm:ss.cc, resident KB)
  return execFileSync("/bin/ps", ["-A", "-o", "pid=,ppid=,time=,rss=,comm="], { encoding: "utf8" }).trim().split("\n").map((l) => {
    const [pid, ppid, time, rss, ...name] = l.trim().split(/\s+/)
    return { pid: +pid, ppid: +ppid, cpu: time.split(/[-:]/).reverse().reduce((ms, part, i) => ms + Number(part) * [1000, 60000, 3600000, 86400000][i], 0), mem: +rss / 1024, name: name.join(" ") }
  })
}
function usage(pid: number) {
  const all = processes(), tree = new Set([pid])
  for (let grew = true; grew;) { grew = false; for (const p of all) if (!tree.has(p.pid) && tree.has(p.ppid)) { tree.add(p.pid); grew = true } }
  const mine = all.filter((p) => tree.has(p.pid))
  return { cpu: mine.reduce((n, p) => n + p.cpu, 0), mem: mine.reduce((n, p) => n + p.mem, 0), count: mine.length, names: mine.map((p) => p.name).join(",") }
}

const PAGE = `(() => {
  performance.setResourceTimingBufferSize(100000)
  const P = window.__perf = { commits: 0 }
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { renderers: new Map(), supportsFiber: true, inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id },
    onScheduleFiberRoot() {}, onCommitFiberRoot() { P.commits++ }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {} }
})()`

// In the main process before the app (Playwright's launch returns once the window has loaded, too late to hook it): every
// IPC message a page sends (send, sendSync, invoke) counted by channel, and PAGE run in every page's own world first.
const HOOK = path.join(tmp, "hook.cjs")
fs.writeFileSync(path.join(tmp, "hook-preload.cjs"), `require("electron").contextBridge.executeInMainWorld({ func: () => { ${PAGE} } })`)
fs.writeFileSync(HOOK, `const { app, ipcMain } = require("electron")
const t0 = Date.now() - process.uptime() * 1000, at = globalThis.__main = { js: Date.now() - t0 }
app.once("ready", () => { at.ready = Date.now() - t0 })
app.once("web-contents-created", () => { at.window = Date.now() - t0 })
const cp = require("node:child_process"), fork = cp.fork
cp.fork = (...a) => { if (!at.fork && String(a[0]).endsWith("server.ts")) at.fork = Date.now() - t0; return fork(...a) }
const counted = globalThis.__ipc = {}
const count = (ch) => { counted[String(ch)] = (counted[String(ch)] || 0) + 1 }
const emit = ipcMain.emit.bind(ipcMain)
ipcMain.emit = (ch, ...a) => { count(ch); return emit(ch, ...a) }
const handlers = ipcMain._invokeHandlers, set = handlers.set.bind(handlers)
handlers.set = (ch, fn) => set(ch, (...a) => { count(ch); return fn(...a) })
app.on("session-created", (s) => s.registerPreloadScript({ type: "frame", filePath: ${JSON.stringify(path.join(tmp, "hook-preload.cjs"))} }))
`)

async function counts(app: ElectronApplication, win: Awaited<ReturnType<ElectronApplication["firstWindow"]>>) {
  const page = await win.evaluate(() => ({
    commits: (window as unknown as { __perf?: { commits: number } }).__perf?.commits ?? 0,
    requests: performance.getEntriesByType("resource").map((e) => new URL(e.name).pathname.replace(/^\/api\//, "").replace(/\/[^/]*\.[a-z0-9]+$/i, "/*")),
  }))
  const channels = await app.evaluate(() => ({ ...(globalThis as unknown as { __ipc: Record<string, number> }).__ipc }))
  return { ...page, channels }
}
const total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)
const tally = (xs: string[]) => xs.reduce<Record<string, number>>((o, x) => ((o[x] = (o[x] ?? 0) + 1), o), {})
const minus = (a: Record<string, number>, b: Record<string, number>) =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v - (b[k] ?? 0)]).filter(([, v]) => (v as number) > 0))

async function launch(root: string, dir: string): Promise<[Launch, Extra]> {
  const t0 = performance.now(), epoch = Date.now()
  const app = await _electron.launch({
    executablePath: createRequire(path.join(root, "package.json"))("electron") as string, args: ["-r", HOOK, root, "--vault", path.join(dir, "vault")],
    // (a temp folder each root's own: Node's compile cache, kept there, is empty for the first launch and never shared)
    env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(dir, "userData"), VAULTITE_LOCAL: path.join(dir, "local"), TMPDIR: path.join(dir, "t"), TEMP: path.join(dir, "t") },
  })
  try {
    const win = await app.firstWindow()
    const window = performance.now() - t0
    await win.waitForSelector("[role=tree]", { timeout: 120000 })
    const ready = performance.now() - t0
    const [origin, fcp, base] = await win.evaluate(() => [performance.timeOrigin, performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0, location.origin] as const)
    const loaded = await counts(app, win)
    const metrics = () => app.evaluate(({ app }) => app.getAppMetrics())
    const perf = await (await fetch(`${base}/api/activity/perf?minutes=10`)).json() as { pid: number; timings: { name: string; last: { parts: Record<string, number>; ms: number } }[] }
    const main = await app.evaluate(() => (globalThis as unknown as { __main: Record<string, number> }).__main)
    const parts = Object.fromEntries(perf.timings.filter((t) => ["server.start", "app.load", "app.open"].includes(t.name)).map((t) => [t.name, { ...t.last.parts, total: t.last.ms }]))
    const cpu = (m: Electron.ProcessMetric[], tab: boolean) => 1000 * m.filter((x) => (x.type === "Tab") === tab).reduce((n, x) => n + x.cpu.cumulativeCPUUsage!, 0)
    const mem = (m: Electron.ProcessMetric[], tab: boolean) => m.filter((x) => (x.type === "Tab") === tab).reduce((n, x) => n + x.memory.workingSetSize, 0) / 1024
    const mr = await metrics(), sr = usage(perf.pid)
    await new Promise((r) => setTimeout(r, SETTLE * 1000))
    const m0 = await metrics(), s0 = usage(perf.pid), settled = await counts(app, win)
    const i0 = performance.now()
    await new Promise((r) => setTimeout(r, IDLE * 1000))
    const secs = (performance.now() - i0) / 1000
    const m1 = await metrics(), s1 = usage(perf.pid), idled = await counts(app, win)
    const pct = (ms: number) => +(ms / secs / 10).toFixed(2)
    return [{
      window, page: origin - epoch, paint: origin - epoch + fcp, ready, renderer: cpu(mr, true), app: cpu(mr, false), server: sr.cpu,
      requests: loaded.requests.length, ipc: total(loaded.channels), commits: loaded.commits,
      idleRenderer: pct(cpu(m1, true) - cpu(m0, true)), idleApp: pct(cpu(m1, false) - cpu(m0, false)), idleServer: pct(s1.cpu - s0.cpu),
      idleRequests: idled.requests.length - settled.requests.length, idleIpc: total(idled.channels) - total(settled.channels), idleCommits: idled.commits - settled.commits,
      memRenderer: mem(m1, true), memApp: mem(m1, false), memServer: s1.mem, memTotal: mem(m1, true) + mem(m1, false) + s1.mem,
    }, {
      // (Windows' working set counts the pages processes share; private bytes, Windows' only, are each one's own)
      parts: { "main (ms since its start)": main, ...parts }, memory: m1.reduce<Record<string, number>>((o, x) => ((o[x.type] = Math.round((o[x.type] ?? 0) + x.memory.workingSetSize / 1024)), o), {}),
      private: m1.reduce((n, x) => n + (x.memory.privateBytes ?? 0), 0) / 1024, server: `${s1.count} (${s1.names})`,
      channels: loaded.channels, idleChannels: minus(idled.channels, settled.channels),
      idleRoutes: tally(idled.requests.slice(settled.requests.length)),
    }]
  } finally {
    await app.close()
  }
}

// (Chromium won't run as root without its sandbox, and the app keeps the sandbox on)
if (process.platform === "linux" && process.getuid?.() === 0) { console.error("desktop: Electron doesn't run as root: run this as another user"); process.exit(1) }
const runs = ROOTS.map(() => [] as Launch[]), extras = ROOTS.map(() => [] as Extra[])
try {
  ROOTS.forEach((_, i) => { makeVault(path.join(tmp, String(i), "vault"), SCALE); fs.mkdirSync(path.join(tmp, String(i), "t")) })
  for (let n = 0; n < LAUNCHES; n++) {
    for (const [i, root] of ROOTS.entries()) {
      const [l, x] = await launch(root, path.join(tmp, String(i)))
      runs[i].push(l)
      extras[i].push(x)
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

const KEYS = Object.keys(runs[0][0]) as (keyof Launch)[]
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return +s[Math.floor(s.length / 2)].toFixed(1) }
const round = (l: Launch) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, +v.toFixed(1)])) as Launch
const again = (i: number) => (runs[i].length > 1 ? runs[i].slice(1) : runs[i])
const results = ROOTS.map((root, i) => ({
  root, platform: `${process.platform}-${process.arch}`, scale: SCALE, launches: LAUNCHES, settle: SETTLE, idle: IDLE, date: new Date().toISOString(), first: round(runs[i][0]),
  again: Object.fromEntries(KEYS.map((k) => [k, median(again(i).map((r) => r[k]))])) as Launch,
  best: Object.fromEntries(KEYS.map((k) => [k, +Math.min(...again(i).map((r) => r[k])).toFixed(1)])) as Launch,
  runs: runs[i].map(round), last: extras[i][extras[i].length - 1],
}))
const ratio = (a: number, b: number) => ` (${(a / b).toFixed(2)}x)`
for (const r of results) {
  const b = results[0] === r ? null : results[0]
  console.log(`${r.root} (${r.platform})`)
  for (const k of ["first", "again", "best"] as const) {
    const x = r[k], y = b?.[k]
    const part = (name: string, key: keyof Launch, unit = "ms") => `${name} ${x[key]}${unit}${y ? ratio(y[key], x[key]) : ""}`
    const label = { first: "first launch (empty caches)", again: "launch again (median)      ", best: "launch again (best)        " }[k]
    console.log(`  ${label}: ` +
      [part("window", "window"), part("page", "page"), part("first paint", "paint"), part("ready", "ready"),
        `cpu: ${part("renderer", "renderer")}`, part("electron", "app"), part("server", "server"),
        part("requests", "requests", ""), part("ipc", "ipc", ""), part("commits", "commits", "")].join(", "))
    console.log(`  ${" ".repeat(label.length)}  idle ${IDLE}s: cpu ${part("renderer", "idleRenderer", "%")}, ${part("electron", "idleApp", "%")}, ` +
      `${part("server", "idleServer", "%")}; ${part("requests", "idleRequests", "")}, ${part("ipc", "idleIpc", "")}, ${part("commits", "idleCommits", "")}; ` +
      `memory ${part("renderer", "memRenderer", "MB")}, ${part("electron", "memApp", "MB")}, ${part("server", "memServer", "MB")}, ${part("total", "memTotal", "MB")}`)
  }
  console.log(`  last launch's parts: ${JSON.stringify(r.last.parts)}; memory (MB): ${JSON.stringify(r.last.memory)}, Electron's private ${Math.round(r.last.private)}; the server's processes: ${r.last.server}`)
  console.log(`  ipc until ready: ${JSON.stringify(r.last.channels)}; idle: ${JSON.stringify(r.last.idleChannels)}; idle requests: ${JSON.stringify(r.last.idleRoutes)}`)
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2))
