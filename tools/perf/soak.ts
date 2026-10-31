// Long desktop session on a made-up vault (notes, tabs, panes, terminals, an agent writing; idle still, shown, hidden, a graph): each process's memory and CPU, heaps, DOM, timers; growth an hour, heap survivors between cycles.
// node tools/perf/soak.ts [--minutes 30 (0: idle only)] [--scale 10] [--idle 3 (min a phase)] [--phases still,shown,hidden,graph] [--translucent] [--snapshots] [--profile] [--out dir] [--root <checkout>]   heavy: check `uptime`
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { _electron, type ElectronApplication, type Page, type CDPSession } from "playwright-core"
import { WebSocket } from "ws"
import { isolated, makeVault } from "./vault.ts"

const args = process.argv.slice(2)
const arg = (name: string, dflt: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt }
const ROOT = path.resolve(arg("root", path.join(import.meta.dirname, "..", "..")))
const MINUTES = Number(arg("minutes", "30")), SCALE = Number(arg("scale", "10")), IDLE = Number(arg("idle", "3"))
const SNAPSHOTS = args.includes("--snapshots"), PROFILE = args.includes("--profile"), TRANSLUCENT = args.includes("--translucent")
const PHASES = arg("phases", "still,shown,hidden,graph").split(",") as Phase[]
type Phase = "still" | "shown" | "hidden" | "graph"
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-soak-"))
const OUT = path.resolve(arg("out", path.join(tmp, "out")))
fs.mkdirSync(OUT, { recursive: true })
const VAULT = path.join(tmp, "vault")
const MAC = process.platform === "darwin"
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const step = (what: string) => console.error(`${new Date().toISOString().slice(11, 19)} ${what}`)

// ---------- in the page: timers, frames and sockets, counted (installed before the app's scripts run)
const COUNTERS = () => {
  const w = window as unknown as Record<string, unknown>
  const live = new Map<number, string>() // interval id -> where it was made
  const sites = new Map<string, number>() // timeout and frame callers, while counting
  let timeouts = 0, frames = 0, wsMade = 0, counting = false
  const sockets = new Set<WebSocket>()
  const site = (kind: string) => { if (!counting) return; const s = `${kind} ${(new Error().stack ?? "").split("\n")[3]?.trim() ?? "?"}`; sites.set(s, (sites.get(s) ?? 0) + 1) }
  const [si, ci, st, ct, raf] = [setInterval, clearInterval, setTimeout, clearTimeout, requestAnimationFrame]
  w.setInterval = (fn: TimerHandler, ms?: number, ...a: unknown[]) => { const id = si(fn, ms, ...a); live.set(id, `${ms}ms ${(new Error().stack ?? "").split("\n")[2]?.trim()}`); return id }
  w.clearInterval = (id?: number) => { if (id !== undefined) live.delete(id); ci(id) }
  w.setTimeout = (fn: TimerHandler, ms?: number, ...a: unknown[]) => { timeouts++; site("timeout"); return st(fn, ms, ...a) }
  w.clearTimeout = (id?: number) => { if (id !== undefined) live.delete(id); ct(id) }
  w.requestAnimationFrame = (cb: FrameRequestCallback) => { frames++; site("frame"); return raf(cb) }
  const WS = WebSocket
  w.WebSocket = class extends WS {
    constructor(url: string | URL, p?: string | string[]) { super(url, p); wsMade++; sockets.add(this); this.addEventListener("close", () => sockets.delete(this)) }
  }
  // Playwright's attached pages stay "visible" through hide, minimize and ⌘H (a plain Electron window doesn't): the soak
  // says hidden itself, which is what the app's own work keys on.
  let hidden: boolean | null = null
  for (const [k, v] of [["hidden", () => hidden ?? false], ["visibilityState", () => (hidden ? "hidden" : "visible")]] as const) {
    const real = Object.getOwnPropertyDescriptor(Document.prototype, k)!
    Object.defineProperty(Document.prototype, k, { configurable: true, get() { return hidden === null ? real.get!.call(this) : v() } })
  }
  w.__soakHide = (h: boolean) => { hidden = h; document.dispatchEvent(new Event("visibilitychange")) }
  w.__soak = (reset: boolean | "count") => {
    const r = { intervals: live.size, timeouts, frames, ws: sockets.size, wsMade, sites: [...sites].sort((a, b) => b[1] - a[1]).slice(0, 15), where: [...new Set(live.values())] }
    if (reset === "count") { sites.clear(); counting = true } else if (reset) { counting = false }
    return r
  }
}

// ---------- processes
type Proc = { pid: number; ppid: number; rss: number; cpu: number; cmd: string }
const cpuMs = (t: string) => t.split(/[-:]/).reverse().reduce((ms, part, i) => ms + Number(part) * [1000, 60000, 3600000, 86400000][i], 0)
function ps(): Proc[] {
  return execFileSync("/bin/ps", ["-Aww", "-o", "pid=,ppid=,rss=,time=,command="], { encoding: "utf8" }).split("\n").filter(Boolean).map((l) => {
    const [pid, ppid, rss, time, ...cmd] = l.trim().split(/\s+/)
    return { pid: Number(pid), ppid: Number(ppid), rss: Number(rss) * 1024, cpu: cpuMs(time), cmd: cmd.join(" ") }
  })
}
const tree = (all: Proc[], root: number) => { const out = new Set([root]); for (let grew = true; grew; ) { grew = false; for (const p of all) if (out.has(p.ppid) && !out.has(p.pid)) { out.add(p.pid); grew = true } } return out }

let app: ElectronApplication, page: Page, cdp: CDPSession, port = 0, mainPid = 0, serverPid = 0
const keeperFile = () => path.join(MAC ? os.tmpdir() : `/tmp/vaultite-${process.getuid?.()}`, `vaultite-ptyd1-vaultite-${port}.sock.pid`)
const keeperPid = () => { try { return Number(fs.readFileSync(keeperFile(), "utf8")) || 0 } catch { return 0 } }
const tmuxPid = () => { try { return Number(execFileSync("tmux", ["-L", `vaultite-${port}`, "display", "-p", "#{pid}"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) || 0 } catch { return 0 } }

/** Every process the app runs, by role: RSS and CPU ms (Electron's own from its metrics, the rest from ps). */
async function processes() {
  const metrics = await app.evaluate(({ app, webContents }) => {
    const pages = new Map(webContents.getAllWebContents().map((w) => [w.getOSProcessId(), w.getURL()]))
    return app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, cpu: m.cpu.cumulativeCPUUsage ?? 0, url: pages.get(m.pid) ?? "" }))
  })
  const all = ps(), byPid = new Map(all.map((p) => [p.pid, p]))
  // RSS says little on macOS (compressed and swapped pages leave it): memory is each process's footprint, as Activity Monitor's.
  const wanted = [...metrics.map((m) => m.pid), ...tree(all, serverPid), keeperPid(), ...(tmuxPid() ? tree(all, tmuxPid()) : [])].filter(Boolean)
  const foot = new Map<number, number>()
  if (MAC) {
    const out = execFileSync("/usr/bin/footprint", wanted.flatMap((p) => ["-p", String(p)]), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    for (const m of out.matchAll(/\[(\d+)\]: .*?Footprint: ([\d.]+) (B|KB|MB|GB)/g)) foot.set(Number(m[1]), Number(m[2]) * { B: 1, KB: 1024, MB: 1048576, GB: 1073741824 }[m[3]]!)
  }
  for (const p of all) if (foot.has(p.pid)) p.rss = foot.get(p.pid)!
  const roles: Record<string, { rss: number; cpu: number; n: number }> = {}
  const add = (role: string, pid: number, cpu?: number) => {
    const p = byPid.get(pid); if (!p) return
    const r = (roles[role] ??= { rss: 0, cpu: 0, n: 0 }); r.rss += p.rss; r.cpu += cpu ?? p.cpu; r.n++
  }
  const mine = new URL(page.url()).port
  for (const m of metrics) {
    const role = m.type === "Browser" ? "main" : m.type === "GPU" ? "gpu" : m.type === "Tab" ? (m.url.includes(`:${mine}/`) ? "renderer" : "other tabs") : m.type.toLowerCase()
    add(role, m.pid, m.cpu * 1000)
  }
  for (const pid of tree(all, serverPid)) add(pid === serverPid ? "server" : "server children", pid)
  const k = keeperPid(), t = tmuxPid()
  if (k) add("keeper", k)
  if (t) for (const pid of tree(all, t)) add(pid === t ? "tmux" : "shells", pid)
  return roles
}

// ---------- the server's heap, over its inspector (opened with SIGUSR1, on 9229: Electron drops NODE_OPTIONS, so one soak at a time)
let serverWs = null as WebSocket | null, rid = 0
const pending = new Map<number, (r: unknown) => void>()
const chunks: string[] = []
async function serverInspector() {
  process.kill(serverPid, "SIGUSR1")
  for (let i = 0; i < 300 && !serverWs; i++) {
    await wait(200)
    const ports = execFileSync("/usr/sbin/lsof", ["-a", "-p", String(serverPid), "-iTCP", "-sTCP:LISTEN", "-Fn", "-P"], { encoding: "utf8" })
      .split("\n").filter((l) => l.startsWith("n")).map((l) => Number(l.split(":").pop())).filter((p) => p && p !== port)
    for (const p of ports) {
      try {
        const [t] = await (await fetch(`http://127.0.0.1:${p}/json/list`)).json() as { webSocketDebuggerUrl: string }[]
        const ws = new WebSocket(t.webSocketDebuggerUrl)
        await new Promise((ok, fail) => { ws.once("open", ok); ws.once("error", fail) })
        ws.on("message", (b) => {
          const m = JSON.parse(String(b))
          if (m.id) { pending.get(m.id)?.(m.result); pending.delete(m.id) } else if (m.method === "HeapProfiler.addHeapSnapshotChunk") chunks.push(m.params.chunk)
        })
        serverWs = ws
      } catch { /* not it */ }
    }
  }
  if (!serverWs) throw new Error("the server's inspector didn't open (is 127.0.0.1:9229 taken? another soak?)")
}
const serverCall = (method: string, params = {}) => new Promise<Record<string, number>>((ok) => { const id = ++rid; pending.set(id, ok as (r: unknown) => void); serverWs!.send(JSON.stringify({ id, method, params })) })

// ---------- one sample
type Sample = { t: number; phase: string; procs: Awaited<ReturnType<typeof processes>>; page: Record<string, number>; server: Record<string, number>; main: Record<string, number> }
const samples: Sample[] = []
async function sample(phase: string) {
  // (heaps after a full GC: what's held, not when the collector last ran)
  await Promise.all([cdp.send("HeapProfiler.collectGarbage"), serverCall("HeapProfiler.collectGarbage")])
  const [procs, heap, dom, perf, soak, server, main] = await Promise.all([
    processes(),
    cdp.send("Runtime.getHeapUsage"),
    cdp.send("Memory.getDOMCounters"),
    cdp.send("Performance.getMetrics"),
    page.evaluate(() => (window as unknown as { __soak: (r: boolean) => Record<string, number> }).__soak(false)),
    serverCall("Runtime.getHeapUsage"),
    app.evaluate(({ app, ipcMain, webContents }) => ({
      heap: process.memoryUsage().heapUsed, webContents: webContents.getAllWebContents().length,
      ipc: ipcMain.eventNames().reduce((n, e) => n + ipcMain.listenerCount(e), 0), appListeners: app.eventNames().reduce((n, e) => n + app.listenerCount(e as "ready"), 0),
    })),
  ])
  const m = Object.fromEntries(perf.metrics.map((x) => [x.name, x.value]))
  const s: Sample = { t: Date.now(), phase, procs,
    page: { heap: heap.usedSize, nodes: dom.nodes, documents: dom.documents, listeners: dom.jsEventListeners, layouts: m.LayoutCount, styles: m.RecalcStyleCount,
      task: m.TaskDuration * 1000, script: m.ScriptDuration * 1000, intervals: soak.intervals, timeouts: soak.timeouts, frames: soak.frames, ws: soak.ws, wsMade: soak.wsMade,
      xterms: await page.locator(".xterm").count(), editors: await page.locator(".cm-editor").count() },
    server: { heap: server.usedSize }, main }
  samples.push(s)
  fs.appendFileSync(path.join(OUT, "samples.jsonl"), JSON.stringify(s) + "\n")
  return s
}

// ---------- heap snapshots: what was made between two and still lives at a third
type Snap = { maxId: number; groups: Map<string, { n: number; size: number }>; detached: number }
function readSnapshot(json: string, after = -1, upTo = Infinity): Snap {
  const s = JSON.parse(json), meta = s.snapshot.meta, F = meta.node_fields.length
  const [iType, iName, iId, iSize] = ["type", "name", "id", "self_size"].map((f) => meta.node_fields.indexOf(f)), iDet = meta.node_fields.indexOf("detachedness")
  const types: string[] = meta.node_types[0], strings: string[] = s.strings, nodes: number[] = s.nodes
  const groups = new Map<string, { n: number; size: number }>()
  let maxId = 0, detached = 0
  for (let i = 0; i < nodes.length; i += F) {
    const id = nodes[i + iId]; maxId = Math.max(maxId, id)
    if (iDet >= 0 && nodes[i + iDet] === 2) detached++
    if (id <= after || id > upTo) continue
    const type = types[nodes[i + iType]]
    if (type === "hidden" || type === "synthetic") continue
    const name = type === "object" || type === "closure" || type === "native" ? `${type} ${strings[nodes[i + iName]].slice(0, 60)}` : type
    const g = groups.get(name) ?? { n: 0, size: 0 }; g.n++; g.size += nodes[i + iSize]; groups.set(name, g)
  }
  return { maxId, groups, detached }
}
async function snapshot(which: "page" | "server") {
  chunks.length = 0
  if (which === "page") {
    const got: string[] = []
    const on = (e: { chunk: string }) => got.push(e.chunk)
    cdp.on("HeapProfiler.addHeapSnapshotChunk", on)
    await cdp.send("HeapProfiler.collectGarbage")
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false })
    cdp.off("HeapProfiler.addHeapSnapshotChunk", on)
    return got.join("")
  }
  await serverCall("HeapProfiler.collectGarbage")
  await serverCall("HeapProfiler.takeHeapSnapshot", { reportProgress: false })
  return chunks.join("")
}
const snaps: Record<"page" | "server", string[]> = { page: [], server: [] }
async function takeSnapshots(n: number) {
  for (const which of ["page", "server"] as const) {
    const file = path.join(OUT, `${which}-${n}.heapsnapshot`)
    fs.writeFileSync(file, await snapshot(which))
    snaps[which].push(file)
  }
}
/** Objects made between the first and second snapshot that the third still holds: what a cycle leaves behind. */
function survivors(files: string[]) {
  const [a, b] = files.slice(-3, -1).map((f) => readSnapshot(fs.readFileSync(f, "utf8")).maxId)
  const c = readSnapshot(fs.readFileSync(files[files.length - 1], "utf8"), a, b)
  return { detached: c.detached, top: [...c.groups].sort((x, y) => y[1].size - x[1].size).slice(0, 25).map(([k, v]) => ({ what: k, n: v.n, kb: Math.round(v.size / 1024) })) }
}

// ---------- the user and an agent
const mod = MAC ? "Meta" : "Control"
async function command(name: string) {
  await page.keyboard.press(`${mod}+p`)
  await page.waitForSelector("[role=option]", { timeout: 5000 })
  await page.keyboard.type(name)
  await wait(250)
  const hit = await page.locator("[role=option]", { hasText: name }).count()
  await page.keyboard.press(hit ? "Enter" : "Escape")
  await wait(400)
  if (await page.locator("#palette-results").count()) { await page.keyboard.press("Escape"); await wait(200) }
  return hit > 0
}
const go = (hash: string) => page.evaluate((h) => { location.hash = h }, hash)
const notes = () => fs.readdirSync(path.join(VAULT, "Notes")).filter((f) => f.endsWith(".md")).sort()
let typed = 0
/** Open notes in new tabs, type in each (autosave writes it), then close them: the loop's tabs don't pile up, so what
 *  grows is what's left behind. */
async function editNotes(n: number, offset: number) {
  const list = notes()
  for (let i = 0; i < n; i++) {
    await page.keyboard.press(`${mod}+t`); await wait(300)
    await go(`#file/${encodeURIComponent(`Notes/${list[(offset + i * 7) % list.length]}`)}`)
    const cm = page.locator("[data-pane] .cm-content:visible").first()
    try { await cm.waitFor({ timeout: 8000 }); await cm.click({ position: { x: 5, y: 5 }, timeout: 5000 }) } catch { await page.keyboard.press("Escape"); continue }
    await page.keyboard.press(`${mod}+ArrowDown`)
    await page.keyboard.type(` Soak ${typed++}.`, { delay: 30 })
    await wait(1500)
  }
  for (let i = 0; i < n; i++) { await page.keyboard.press(`${mod}+w`); await wait(250) }
}
/** A terminal in a new tab printing a few thousand lines, then its tab closed and its shell ended. */
async function terminal(i: number) {
  const sid = `soak${i}`
  await page.keyboard.press(`${mod}+t`); await wait(300)
  await go(`#view/terminal%2F${sid}`)
  try { await page.locator(".xterm:visible").first().waitFor({ timeout: 10000 }) } catch { return }
  await wait(1500)
  await page.locator(".xterm:visible").first().click({ timeout: 5000 }).catch(() => {})
  await page.keyboard.type("for i in $(seq 1 3000); do echo line $i of the soak output; done\n")
  await wait(4000)
  await page.keyboard.press(`${mod}+w`); await wait(500)
  await fetch(`http://127.0.0.1:${port}/api/terminals/${sid}`, { method: "DELETE" }).catch(() => {})
}
/** An agent at work: new notes made, others edited, old ones removed (so the vault doesn't only grow). */
function agent() {
  const dir = path.join(VAULT, "Agent"); fs.mkdirSync(dir, { recursive: true })
  let i = 0
  const id = setInterval(() => {
    i++
    fs.writeFileSync(path.join(dir, `Run ${i}.md`), `---\ntype: note\n---\n\nAgent run ${i}: ${"words ".repeat(40)}\n`)
    if (i > 20) fs.rmSync(path.join(dir, `Run ${i - 20}.md`), { force: true })
    const list = notes(); fs.appendFileSync(path.join(VAULT, "Notes", list[i % list.length]), `\nAgent line ${i}.\n`)
  }, 3000)
  return () => clearInterval(id)
}
async function showWindow(shown: boolean) {
  await app.evaluate(({ BaseWindow }, s) => { for (const w of BaseWindow.getAllWindows()) if (s) w.show(); else w.hide() }, shown)
  await page.evaluate((h) => (window as unknown as { __soakHide: (h: boolean) => void }).__soakHide(h), !shown)
  await wait(1500)
  return page.evaluate(() => document.visibilityState)
}

// ---------- the report
const roleKeys = () => [...new Set(samples.flatMap((s) => Object.keys(s.procs)))]
/** Least-squares slope per hour of `f` over samples of a phase. */
function perHour(phase: string, f: (s: Sample) => number | undefined) {
  const xs = samples.filter((s) => s.phase === phase && f(s) !== undefined)
  if (xs.length < 3) return NaN
  const t = xs.map((s) => (s.t - xs[0].t) / 3600000), y = xs.map((s) => f(s)!)
  const mt = t.reduce((a, b) => a + b) / t.length, my = y.reduce((a, b) => a + b) / y.length
  return t.reduce((a, ti, i) => a + (ti - mt) * (y[i] - my), 0) / t.reduce((a, ti) => a + (ti - mt) ** 2, 0)
}
/** CPU ms a minute of `f` across a phase. */
function perMinute(phase: string, f: (s: Sample) => number | undefined) {
  const xs = samples.filter((s) => s.phase === phase)
  if (xs.length < 2) return NaN
  const a = xs[0], b = xs[xs.length - 1]
  return ((f(b) ?? 0) - (f(a) ?? 0)) / ((b.t - a.t) / 60000)
}
const MB = (n: number) => `${(n / 1048576).toFixed(1)}MB`
function report() {
  const last = samples[samples.length - 1]
  const lines = [`soak: ${MINUTES} min loop, scale ${SCALE}, idle ${IDLE} min still, shown and hidden (an agent writing), a still graph${TRANSLUCENT ? ", translucent" : ""}, ${ROOT}`, "",
    "process        memory now  growth/h (loop)  cpu ms/min: loop  idle still  idle shown  idle hidden  graph shown"]
  for (const r of roleKeys()) {
    const rss = (s: Sample) => s.procs[r]?.rss, cpu = (s: Sample) => s.procs[r]?.cpu
    lines.push(`${r.padEnd(16)} ${MB(last.procs[r]?.rss ?? 0).padStart(8)} ${MB(perHour("loop", rss)).padStart(12)}   ${perMinute("loop", cpu).toFixed(0).padStart(12)}  ${perMinute("still", cpu).toFixed(0).padStart(10)}  ${perMinute("shown", cpu).toFixed(0).padStart(10)}  ${perMinute("hidden", cpu).toFixed(0).padStart(11)}  ${perMinute("graph", cpu).toFixed(0).padStart(11)}`)
  }
  lines.push("", "page and server        now     growth/h (loop)  a minute: idle still  idle shown  idle hidden  graph shown")
  const rows: [string, (s: Sample) => number, boolean, boolean][] = [
    ["page JS heap", (s) => s.page.heap, true, false], ["server JS heap", (s) => s.server.heap, true, false], ["main JS heap", (s) => s.main.heap, true, false],
    ["DOM nodes", (s) => s.page.nodes, false, false], ["documents", (s) => s.page.documents, false, false], ["JS listeners", (s) => s.page.listeners, false, false],
    ["intervals", (s) => s.page.intervals, false, false], ["sockets", (s) => s.page.ws, false, false], ["xterms", (s) => s.page.xterms, false, false],
    ["editors", (s) => s.page.editors, false, false], ["main ipc listeners", (s) => s.main.ipc, false, false], ["webContents", (s) => s.main.webContents, false, false],
    ["page task ms", (s) => s.page.task, false, true], ["page script ms", (s) => s.page.script, false, true], ["timeouts", (s) => s.page.timeouts, false, true],
    ["frames", (s) => s.page.frames, false, true], ["layouts", (s) => s.page.layouts, false, true], ["style recalcs", (s) => s.page.styles, false, true],
  ]
  for (const [name, f, bytes, rate] of rows) {
    const now = f(last), g = perHour("loop", f)
    const at = (ph: string, w: number) => (bytes ? "" : perMinute(ph, f).toFixed(1)).padStart(w)
    lines.push(`${name.padEnd(20)} ${(bytes ? MB(now) : String(Math.round(now))).padStart(9)} ${(rate ? "" : bytes ? MB(g) : g.toFixed(1)).padStart(14)}   ${at("still", 14)}  ${at("shown", 10)}  ${at("hidden", 11)}  ${at("graph", 11)}`)
  }
  return lines.join("\n")
}

// ---------- run
const userData = path.join(tmp, "userData")
step(`vault at ${VAULT} (scale ${SCALE}), out ${OUT}`)
makeVault(VAULT, SCALE)
if (TRANSLUCENT) {
  const f = path.join(VAULT, ".vaultite", "appearance.json")
  fs.writeFileSync(f, JSON.stringify({ ...(fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {}), translucent: true }))
}
// (Ctrl-C still cleans up: the finally below)
process.once("SIGINT", () => { aborted = true })
let aborted = false
let stopAgent = () => {}, launched: ElectronApplication | null = null
try {
  app = await _electron.launch({
    executablePath: path.join(ROOT, "node_modules", ".bin", "electron"), args: [ROOT, "--vault", VAULT],
    env: { ...process.env, ...isolated(path.join(tmp, "home")), VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: userData, VAULTITE_LOCAL: path.join(tmp, "local") },
  })
  launched = app
  page = await app.firstWindow()
  await page.waitForSelector("[role=tree]", { timeout: 120000 })
  port = Number(new URL(page.url()).port)
  mainPid = await app.evaluate(() => process.pid)
  serverPid = ps().find((p) => p.ppid === mainPid && p.cmd.includes("server.ts"))!.pid
  await app.context().addInitScript(COUNTERS)
  await page.reload()
  await page.waitForSelector("[role=tree]", { timeout: 120000 })
  cdp = await app.context().newCDPSession(page)
  await cdp.send("Performance.enable")
  await serverInspector()
  step(`app up: main ${mainPid}, server ${serverPid} on ${port}`)
  await wait(10000)
  await command("Split right")

  const t0 = Date.now()
  let cycle = 0
  stopAgent = agent()
  await sample("loop")
  let lastSample = Date.now()
  const snapAt = SNAPSHOTS ? [2, Math.max(4, Math.floor(MINUTES / 6)), Math.max(6, Math.floor(MINUTES / 3))] : []
  while (Date.now() - t0 < MINUTES * 60000 && !aborted) {
    cycle++
    await editNotes(4, cycle * 5)
    await command(cycle % 2 ? "Focus pane to the right" : "Focus pane to the left")
    await editNotes(2, cycle * 3 + 1)
    if (cycle % 2 === 0) await terminal(cycle)
    await wait(20000) // a pause: reading, live updates arriving
    if (Date.now() - lastSample > 30000) { await sample("loop"); lastSample = Date.now() }
    if (snapAt.includes(cycle)) { step(`cycle ${cycle}: heap snapshots`); await takeSnapshots(cycle) }
    step(`cycle ${cycle} (${Math.round((Date.now() - t0) / 60000)} min)`)
  }
  await sample("loop")
  stopAgent()
  // Idle: still (shown, nothing changing), shown with the agent writing (live updates arriving), hidden, a graph.
  await page.keyboard.press("Escape")
  await wait(5000)
  await page.evaluate(() => (window as unknown as { __soak: (r: string) => unknown }).__soak("count"))
  for (const phase of PHASES) {
    if (aborted) break
    if (phase === "shown" || phase === "hidden") { stopAgent(); stopAgent = agent() }
    const vis = await showWindow(phase !== "hidden")
    // (the graph: a tab of it shown, the agent stopped, so it settles and nothing moves; each write moves it again)
    if (phase === "graph") { stopAgent(); await page.keyboard.press(`${mod}+t`); await wait(300); await go("#view/graph"); await wait(30000) }
    step(`idle ${phase} (${vis}) for ${IDLE} min`)
    await page.evaluate(() => (window as unknown as { __soak: (r: string) => unknown }).__soak("count"))
    await sample(phase)
    // (the page's CPU profile over the phase's first half minute, for DevTools: where its idle time goes)
    if (PROFILE) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start") }
    for (let m = 0; m < IDLE * 2; m++) {
      await wait(30000)
      if (PROFILE && m === 0) fs.writeFileSync(path.join(OUT, `page-${phase}.cpuprofile`), JSON.stringify((await cdp.send("Profiler.stop")).profile))
      await sample(phase)
    }
    fs.writeFileSync(path.join(OUT, `sites-${phase}.json`), JSON.stringify(await page.evaluate(() => (window as unknown as { __soak: (r: string) => unknown }).__soak("count")), null, 2))
  }
  stopAgent()
  await showWindow(true)
  const result = report()
  console.log(result)
  fs.writeFileSync(path.join(OUT, "report.txt"), result + "\n")
  if (snaps.page.length >= 3) {
    for (const which of ["page", "server"] as const) {
      const s = survivors(snaps[which])
      const txt = `${which}: made in cycles ${snapAt[0]}-${snapAt[1]}, alive at ${snapAt[2]} (detached DOM now: ${s.detached})\n` + s.top.map((x) => `  ${x.what.padEnd(70)} ${String(x.n).padStart(7)} ${String(x.kb).padStart(7)}KB`).join("\n")
      console.log("\n" + txt)
      fs.writeFileSync(path.join(OUT, `survivors-${which}.txt`), txt + "\n")
    }
  }
} finally {
  stopAgent()
  serverWs?.close()
  const k = port ? keeperPid() : 0
  await launched?.close().catch(() => {})
  if (k) try { process.kill(k, "SIGTERM") } catch { /* gone */ }
  if (port) try { execFileSync("tmux", ["-L", `vaultite-${port}`, "kill-server"], { stdio: "ignore" }) } catch { /* none */ }
  if (serverPid) try { process.kill(serverPid, "SIGTERM") } catch { /* gone with its window */ }
  if (OUT.startsWith(tmp + path.sep)) for (const f of fs.readdirSync(tmp)) { if (f !== "out") fs.rmSync(path.join(tmp, f), { recursive: true, force: true }) }
  else fs.rmSync(tmp, { recursive: true, force: true })
  console.error(`results in ${OUT}`)
}
process.exit(0)
