// Long desktop session on a made-up vault (notes, tabs, panes, panels, terminals, an agent writing; idle still, shown, hidden, a graph), driven through the app's ops with nothing attached (a debugger keeps what the page logs and compiles, so its heap grows by itself): each process's memory and CPU, the page's heap, DOM and timers; growth an hour.
// node tools/perf/soak.ts [--minutes 30 (0: idle only)] [--scale 10] [--idle 3 (min a phase)] [--phases still,shown,hidden,graph] [--snapshots (attaches CDP from the first)] [--budget (exit 1 past it: nightly CI)] [--out dir] [--root <checkout>]   not as root; heavy: check `uptime`
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { WebSocket } from "ws"
import { freePort, isolated, makeVault } from "./vault.ts"

const args = process.argv.slice(2)
const arg = (name: string, dflt: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt }
const ROOT = path.resolve(arg("root", path.join(import.meta.dirname, "..", "..")))
const MINUTES = Number(arg("minutes", "30")), SCALE = Number(arg("scale", "10")), IDLE = Number(arg("idle", "3"))
const SNAPSHOTS = args.includes("--snapshots"), BUDGET = args.includes("--budget")
const PHASES = arg("phases", "still,shown,hidden,graph").split(",").filter(Boolean) as Phase[]
type Phase = "still" | "shown" | "hidden" | "graph"
const MAC = process.platform === "darwin"
if (process.getuid?.() === 0) { console.error("soak: Electron's sandbox won't start as root: run it as a user"); process.exit(2) }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-soak-"))
const OUT = path.resolve(arg("out", path.join(tmp, "out")))
fs.mkdirSync(OUT, { recursive: true })
const VAULT = path.join(tmp, "vault")
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const step = (what: string) => console.error(`${new Date().toISOString().slice(11, 19)} ${what}`)

// ---------- in the page: timers, frames and sockets, counted from when the soak installs it (dev.eval, after load)
const COUNTERS = () => {
  const w = window as unknown as Record<string, unknown>
  if (w.__soak) return
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
  // Hidden as the app's own work sees it (document.hidden, visibilitychange), without a hand on the window.
  let hidden: boolean | null = null
  for (const [k, v] of [["hidden", () => hidden ?? false], ["visibilityState", () => (hidden ? "hidden" : "visible")]] as const) {
    const real = Object.getOwnPropertyDescriptor(Document.prototype, k)!
    Object.defineProperty(Document.prototype, k, { configurable: true, get() { return hidden === null ? real.get!.call(this) : v() } })
  }
  w.__soakHide = (h: boolean) => { hidden = h; document.dispatchEvent(new Event("visibilitychange")) }
  w.__soak = (reset: boolean | "count") => {
    const r = { intervals: live.size, timeouts, frames, wsOpen: sockets.size, wsMade, sites: [...sites].sort((a, b) => b[1] - a[1]).slice(0, 15), where: [...new Set(live.values())] }
    if (reset === "count") { sites.clear(); counting = true } else if (reset) { counting = false }
    return r
  }
}
/** What the page holds after a full collection (--expose-gc), measured by the page itself. */
const MEASURE = () => {
  (window as unknown as { gc: () => void }).gc()
  const soak = (window as unknown as { __soak: (r: boolean) => Record<string, number> }).__soak(false)
  const mem = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory
  return { heap: mem.usedJSHeapSize, nodes: document.getElementsByTagName("*").length, iframes: document.getElementsByTagName("iframe").length,
    intervals: soak.intervals, timeouts: soak.timeouts, frames: soak.frames, ws: soak.wsOpen, wsMade: soak.wsMade,
    xterms: document.querySelectorAll(".xterm").length, editors: document.querySelectorAll(".cm-editor").length, tabs: document.querySelectorAll("[role=tab]").length }
}

// ---------- the app: Electron as a user starts it, and its ops
let port = 0, mainPid = 0, child: ChildProcess | null = null
const BASE = () => `http://127.0.0.1:${port}/`
const CLI = { "Content-Type": "application/json", "X-Vaultite-Client": "cli" }
async function op(id: string, params: Record<string, unknown> = {}) {
  const r = await fetch(`${BASE()}api/ops/${id}`, { method: "POST", headers: CLI, body: JSON.stringify(params) })
  const body = await r.json() as Record<string, unknown>
  if (!r.ok) throw new Error(`${id}: ${body.error ?? r.status}`)
  return body
}
/** A function run in the page (its source, called with `a`): its value. */
const inPage = async <T>(fn: (a: never) => unknown, a: unknown = null, timeout = 30) =>
  (await op("dev.eval", { code: `(${fn})(${JSON.stringify(a)})`, timeout })).value as T
const command = (id: string) => op("ui.command", { id }).then(() => wait(400), (e: Error) => step(`command ${id}: ${e.message}`))
const go = (hash: string) => inPage((h: string) => { location.hash = h }, hash)
async function until(what: string, f: () => Promise<boolean>, ms: number) {
  for (const end = Date.now() + ms; Date.now() < end; await wait(250)) if (await f().catch(() => false)) return true
  step(`gave up waiting for ${what}`)
  return false
}

// ---------- processes
type Proc = { pid: number; ppid: number; rss: number; cpu: number; cmd: string }
const cpuMs = (t: string) => t.split(/[-:]/).reverse().reduce((ms, part, i) => ms + Number(part) * [1000, 60000, 3600000, 86400000][i], 0)
const TICK = MAC ? 0 : 1000 / Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }))
/** CPU ms from /proc on Linux (ps rounds to the second there). */
function cpuOf(p: Proc) {
  if (MAC) return p.cpu
  try { const f = fs.readFileSync(`/proc/${p.pid}/stat`, "utf8").split(") ")[1].split(" "); return (Number(f[11]) + Number(f[12])) * TICK } catch { return p.cpu }
}
function ps(): Proc[] {
  return execFileSync("/bin/ps", ["-Aww", "-o", "pid=,ppid=,rss=,time=,command="], { encoding: "utf8" }).split("\n").filter(Boolean).map((l) => {
    const [pid, ppid, rss, time, ...cmd] = l.trim().split(/\s+/)
    return { pid: Number(pid), ppid: Number(ppid), rss: Number(rss) * 1024, cpu: cpuMs(time), cmd: cmd.join(" ") }
  })
}
const tree = (all: Proc[], root: number) => { const out = new Set([root]); for (let grew = true; grew; ) { grew = false; for (const p of all) if (out.has(p.ppid) && !out.has(p.pid)) { out.add(p.pid); grew = true } } return out }
const keeperFile = () => path.join(MAC ? os.tmpdir() : `/tmp/vaultite-${process.getuid?.()}`, `vaultite-ptyd1-vaultite-${port}.sock.pid`)
const keeperPid = () => { try { return Number(fs.readFileSync(keeperFile(), "utf8")) || 0 } catch { return 0 } }
const tmuxPid = () => { try { return Number(execFileSync("tmux", ["-L", `vaultite-${port}`, "display", "-p", "#{pid}"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) || 0 } catch { return 0 } }

/** Every process the app runs, by role (from ps: nothing asked of Electron): memory and CPU ms. The app's page is the
 *  biggest renderer; the others (web pages, pop-outs) are "other renderers". */
function processes() {
  const all = ps(), byPid = new Map(all.map((p) => [p.pid, p]))
  const mine = tree(all, mainPid), k = keeperPid(), t = tmuxPid()
  // RSS says little on macOS (compressed and swapped pages leave it): memory is each process's footprint, as Activity Monitor's.
  if (MAC) {
    const wanted = [...mine, k, ...(t ? tree(all, t) : [])].filter(Boolean)
    const out = execFileSync("/usr/bin/footprint", wanted.flatMap((p) => ["-p", String(p)]), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    for (const m of out.matchAll(/\[(\d+)\]: .*?Footprint: ([\d.]+) (B|KB|MB|GB)/g)) { const p = byPid.get(Number(m[1])); if (p) p.rss = Number(m[2]) * { B: 1, KB: 1024, MB: 1048576, GB: 1073741824 }[m[3]]! }
  }
  const roles: Record<string, { rss: number; cpu: number; n: number }> = {}
  const add = (role: string, pid: number) => {
    const p = byPid.get(pid); if (!p) return
    const r = (roles[role] ??= { rss: 0, cpu: 0, n: 0 }); r.rss += p.rss; r.cpu += cpuOf(p); r.n++
  }
  const server = [...mine].find((pid) => byPid.get(pid)?.cmd.includes("server.ts"))
  const inServer = server ? tree(all, server) : new Set<number>()
  const renderers = [...mine].filter((pid) => byPid.get(pid)?.cmd.includes("--type=renderer")).sort((a, b) => byPid.get(b)!.rss - byPid.get(a)!.rss)
  for (const pid of mine) {
    if (inServer.has(pid)) { add(pid === server ? "server" : "server children", pid); continue }
    const type = /--type=([\w-]+)/.exec(byPid.get(pid)?.cmd ?? "")?.[1]
    add(pid === mainPid ? "main" : type === "renderer" ? (pid === renderers[0] ? "renderer" : "other renderers") : type === "gpu-process" ? "gpu" : type ?? "other", pid)
  }
  if (k) add("keeper", k)
  if (t) for (const pid of tree(all, t)) add(pid === t ? "tmux" : "shells", pid)
  return roles
}

// ---------- heap snapshots (--snapshots): over CDP from the first snapshot to the last (a session's end forgets the
// heap's object ids, which tell what a cycle made); nothing attached before it
type Session = { snapshot: () => Promise<string>; close: () => void }
async function session(wsUrl: string): Promise<Session> {
  const ws = new WebSocket(wsUrl, { maxPayload: 2 ** 31 })
  await new Promise((ok, fail) => { ws.once("open", ok); ws.once("error", fail) })
  let id = 0
  const pending = new Map<number, () => void>(), chunks: string[] = []
  ws.on("message", (b) => {
    const m = JSON.parse(String(b))
    if (m.id) { pending.get(m.id)?.(); pending.delete(m.id) } else if (m.method === "HeapProfiler.addHeapSnapshotChunk") chunks.push(m.params.chunk)
  })
  const call = (method: string, params = {}) => new Promise<void>((ok) => { const i = ++id; pending.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })) })
  return {
    snapshot: async () => { chunks.length = 0; await call("HeapProfiler.collectGarbage"); await call("HeapProfiler.takeHeapSnapshot", { reportProgress: false }); return chunks.join("") },
    close: () => ws.close(),
  }
}
let debugPort = 0
const sessions: Partial<Record<"page" | "server", Session>> = {}
async function pageTarget() {
  const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as { url: string; webSocketDebuggerUrl: string }[]
  return list.find((t) => t.url.startsWith(BASE()))!.webSocketDebuggerUrl
}
/** The server's inspector (SIGUSR1 opens it on 9229): one soak with --snapshots at a time. */
async function serverTarget() {
  const server = ps().find((p) => p.ppid === mainPid && p.cmd.includes("server.ts"))!
  process.kill(server.pid, "SIGUSR1")
  for (let i = 0; i < 100; i++) {
    try { return ((await (await fetch("http://127.0.0.1:9229/json/list")).json()) as { webSocketDebuggerUrl: string }[])[0].webSocketDebuggerUrl } catch { await wait(200) }
  }
  throw new Error("the server's inspector didn't open (is 127.0.0.1:9229 taken? another soak?)")
}
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
const snaps: Record<"page" | "server", string[]> = { page: [], server: [] }
async function takeSnapshots(n: number) {
  sessions.page ??= await session(await pageTarget())
  sessions.server ??= await session(await serverTarget())
  for (const which of ["page", "server"] as const) {
    const file = path.join(OUT, `${which}-${n}.heapsnapshot`)
    fs.writeFileSync(file, await sessions[which]!.snapshot())
    snaps[which].push(file)
  }
}
/** Objects made between the first and second snapshot that the third still holds: what a cycle leaves behind. */
function survivors(files: string[]) {
  const [a, b] = files.slice(-3, -1).map((f) => readSnapshot(fs.readFileSync(f, "utf8")).maxId)
  const c = readSnapshot(fs.readFileSync(files[files.length - 1], "utf8"), a, b)
  return { detached: c.detached, top: [...c.groups].sort((x, y) => y[1].size - x[1].size).slice(0, 25).map(([k, v]) => ({ what: k, n: v.n, kb: Math.round(v.size / 1024) })) }
}

// ---------- one sample
type Sample = { t: number; phase: string; procs: ReturnType<typeof processes>; page: ReturnType<typeof MEASURE> }
const samples: Sample[] = []
async function sample(phase: string) {
  const s: Sample = { t: Date.now(), phase, page: await inPage<ReturnType<typeof MEASURE>>(MEASURE), procs: processes() }
  samples.push(s)
  fs.appendFileSync(path.join(OUT, "samples.jsonl"), JSON.stringify(s) + "\n")
  return s
}

// ---------- the user and an agent
const notes = () => fs.readdirSync(path.join(VAULT, "Notes")).filter((f) => f.endsWith(".md")).sort()
let typed = 0, tried = 0, terminals = 0, terminalsTried = 0
/** Typed at the end of the focused pane's editor, a key at a time, as the editor's input does (the soak's window is
 *  shown inactive, so it can't take focus for real keys). */
const TYPE = async (text: string) => {
  const pane = document.activeElement?.closest("[data-pane]") ?? document
  type View = { state: { doc: { length: number } }; dispatch: (t: object) => void }
  const visible = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>(".cm-content")].find((e) => e.offsetParent)
  const view = ((visible(pane) ?? visible(document)) as { cmTile?: { root?: { view?: View } } } | undefined)?.cmTile?.root?.view
  if (!view) return false
  for (const ch of text) {
    const at = view.state.doc.length
    view.dispatch({ changes: { from: at, insert: ch }, selection: { anchor: at + 1 }, userEvent: "input.type", scrollIntoView: true })
    await new Promise((r) => setTimeout(r, 30))
  }
  return true
}
const editorShown = () => inPage<boolean>(() => [...document.querySelectorAll<HTMLElement>("[data-pane] .cm-content")].some((e) => e.offsetParent))
/** Open notes in new tabs, type in each (autosave writes it), then close them: the loop's tabs don't pile up, so what
 *  grows is what's left behind. */
async function editNotes(n: number, offset: number) {
  const list = notes()
  for (let i = 0; i < n; i++) {
    await command("tab:new")
    await go(`#file/${encodeURIComponent(`Notes/${list[(offset + i * 7) % list.length]}`)}`)
    if (!(await until("an editor", editorShown, 8000))) continue
    if (await inPage<boolean>(TYPE, ` Soak ${typed}.`)) typed++
    tried++
    await wait(1500)
  }
  for (let i = 0; i < n; i++) await command("tab:close")
}
/** A terminal in a new tab printing a few thousand lines, then its tab closed and its shell ended. */
async function terminal(i: number) {
  const sid = `soak${i}`
  await command("tab:new")
  await go(`#view/terminal%2F${sid}`)
  if (!(await until("a terminal", () => inPage<boolean>(() => !!document.querySelector(".xterm")), 10000))) return
  await wait(1500)
  await fetch(`${BASE()}api/terminals/${sid}/send`, { method: "POST", headers: CLI,
    body: JSON.stringify({ text: "for i in $(seq 1 3000); do echo line $i of the soak output; done", enter: true }) }).catch(() => {})
  await wait(4000)
  terminalsTried++
  if (/line 3000 of/.test(JSON.stringify(await op("terminal.capture", { id: sid, lines: 5 }).catch(() => "")))) terminals++
  await command("tab:close")
  await fetch(`${BASE()}api/terminals/${sid}`, { method: "DELETE", headers: CLI }).catch(() => {})
}
/** Panels opened as tabs, looked at, closed. */
async function panels(cycle: number) {
  const ids = ["search:open-tab", "outline:open-tab", "backlinks:open-tab", "recent:open-tab", "graph:local", "properties:open-tab"]
  for (const id of [ids[cycle % ids.length], ids[(cycle + 3) % ids.length]]) { await command(id); await wait(1500); await command("tab:close") }
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
const hide = (h: boolean) => inPage<string>((x: boolean) => { (window as unknown as { __soakHide: (h: boolean) => void }).__soakHide(x); return document.visibilityState }, h)
const soakCall = (r: boolean | "count") => inPage((x: boolean | "count") => (window as unknown as { __soak: (r: boolean | "count") => unknown }).__soak(x), r)

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
/** How much `f` changed a minute across a phase. */
function perMinute(phase: string, f: (s: Sample) => number | undefined) {
  const xs = samples.filter((s) => s.phase === phase)
  if (xs.length < 2) return NaN
  const a = xs[0], b = xs[xs.length - 1]
  return ((f(b) ?? 0) - (f(a) ?? 0)) / ((b.t - a.t) / 60000)
}
const MB = (n: number) => `${(n / 1048576).toFixed(1)}MB`
function report() {
  const last = samples[samples.length - 1]
  const saved = notes().filter((f) => fs.readFileSync(path.join(VAULT, "Notes", f), "utf8").includes(" Soak ")).length
  const lines = [`soak (nothing attached): ${MINUTES} min loop, scale ${SCALE}, idle ${IDLE} min ${PHASES.join(", ")}, ${ROOT}`,
    `typed in ${typed} of ${tried} notes (${saved} saved with it), ${terminals} terminals printed all their lines`, "",
    "process          memory now  growth/h (loop)  cpu ms/min: loop  idle still  idle shown  idle hidden  graph shown"]
  for (const r of roleKeys()) {
    const rss = (s: Sample) => s.procs[r]?.rss, cpu = (s: Sample) => s.procs[r]?.cpu
    lines.push(`${r.padEnd(16)} ${MB(last.procs[r]?.rss ?? 0).padStart(8)} ${MB(perHour("loop", rss)).padStart(12)}   ${perMinute("loop", cpu).toFixed(0).padStart(12)}  ${perMinute("still", cpu).toFixed(0).padStart(10)}  ${perMinute("shown", cpu).toFixed(0).padStart(10)}  ${perMinute("hidden", cpu).toFixed(0).padStart(11)}  ${perMinute("graph", cpu).toFixed(0).padStart(11)}`)
  }
  lines.push("", "page                   now     growth/h (loop)  a minute: idle still  idle shown  idle hidden  graph shown")
  const rows: [string, (s: Sample) => number, boolean, boolean][] = [
    ["JS heap", (s) => s.page.heap, true, false], ["DOM nodes", (s) => s.page.nodes, false, false], ["iframes", (s) => s.page.iframes, false, false],
    ["intervals", (s) => s.page.intervals, false, false], ["sockets", (s) => s.page.ws, false, false], ["xterms", (s) => s.page.xterms, false, false],
    ["editors", (s) => s.page.editors, false, false], ["tabs", (s) => s.page.tabs, false, false],
    ["timeouts", (s) => s.page.timeouts, false, true], ["frames", (s) => s.page.frames, false, true], ["sockets made", (s) => s.page.wsMade, false, true],
  ]
  for (const [name, f, bytes, rate] of rows) {
    const now = f(last), g = perHour("loop", f)
    const at = (ph: string, w: number) => (bytes ? "" : perMinute(ph, f).toFixed(1)).padStart(w)
    lines.push(`${name.padEnd(20)} ${(bytes ? MB(now) : String(Math.round(now))).padStart(9)} ${(rate ? "" : bytes ? MB(g) : g.toFixed(1)).padStart(14)}   ${at("still", 14)}  ${at("shown", 10)}  ${at("hidden", 11)}  ${at("graph", 11)}`)
  }
  return lines.join("\n")
}

/** The budget (--budget): what the loop may leave behind past its first third, what it must have done, idle CPU. */
function budget() {
  const loop = samples.filter((s) => s.phase === "loop"), warm = loop[Math.floor(loop.length / 3)], end = loop[loop.length - 1]
  const idle = (role: string) => Math.max(...PHASES.filter((p) => p !== "graph").map((p) => perMinute(p, (s) => s.procs[role]?.cpu)).filter((x) => !isNaN(x)), 0)
  const saved = notes().filter((f) => fs.readFileSync(path.join(VAULT, "Notes", f), "utf8").includes(" Soak ")).length
  const checks: [string, number, number][] = [
    ["page JS heap growth after the warm-up (MB)", (end.page.heap - warm.page.heap) / 1048576, 8],
    ["DOM nodes growth after the warm-up", end.page.nodes - warm.page.nodes, 300],
    ["intervals growth after the warm-up", end.page.intervals - warm.page.intervals, 2],
    ["sockets left open", end.page.ws, 2], ["terminals left", end.page.xterms, 0], ["editors left", end.page.editors, 0],
    ["notes not typed in", tried - typed, 0], ["notes typed in, none saved", tried && !saved ? 1 : 0, 0], ["terminals that didn't print", terminalsTried - terminals, 0],
    ["renderer idle CPU (ms a minute)", idle("renderer"), 3000], ["server idle CPU (ms a minute)", idle("server"), 3000],
  ]
  const failed = checks.filter(([, v, max]) => !(v <= max))
  console.log(`\nbudget: ${failed.length ? `${failed.length} over` : "ok"}\n` + checks.map(([what, v, max]) => `  ${v <= max ? "ok  " : "OVER"} ${what}: ${Math.round(v * 10) / 10} (at most ${max})`).join("\n"))
  return failed.length === 0
}

// ---------- run
step(`vault at ${VAULT} (scale ${SCALE}), out ${OUT}`)
makeVault(VAULT, SCALE)
const userData = path.join(tmp, "userData")
port = await freePort()
// (the window's server on a port of the soak's choosing: the vault list keeps one per vault)
fs.mkdirSync(userData, { recursive: true })
fs.writeFileSync(path.join(userData, "vaults.json"), JSON.stringify({ vaults: [{ path: VAULT, port, open: true, last: Date.now() }] }))
process.once("SIGINT", () => { aborted = true })
let aborted = false, within = true
let stopAgent = () => {}
try {
  if (SNAPSHOTS) debugPort = await freePort()
  const electron = path.join(ROOT, "node_modules", "electron", "dist", MAC ? "Electron.app/Contents/MacOS/Electron" : "electron")
  const flags = ["--js-flags=--expose-gc", "--enable-precise-memory-info", ...(SNAPSHOTS ? [`--remote-debugging-port=${debugPort}`] : []), ROOT, "--vault", VAULT]
  const headless = process.platform === "linux" && !process.env.DISPLAY
  // (its own process group: the soak ends xvfb-run, Electron and the server it forked together)
  child = spawn(headless ? "xvfb-run" : electron, headless ? ["-a", electron, ...flags] : flags, { stdio: ["ignore", "ignore", "pipe"], detached: true,
    env: { ...process.env, ...isolated(path.join(tmp, "home")), VAULTITE_QUIET: "1", VAULTITE_USER_DATA: userData, VAULTITE_LOCAL: path.join(tmp, "local") } })
  let said = ""
  child.stderr!.on("data", (b: Buffer) => { said = (said + b).slice(-20000) })
  const up = await until("the app", async () => {
    if (child!.exitCode !== null) throw new Error(`the app exited:\n${said}`)
    return await inPage<boolean>(() => !!document.querySelector("[role=tree]"))
  }, 120000)
  if (!up) throw new Error(`the app didn't come up:\n${said}`)
  mainPid = [...tree(ps(), child.pid!)].map((pid) => ps().find((p) => p.pid === pid)!).find((p) => p && p.cmd.startsWith(electron) && !p.cmd.includes("--type="))!.pid
  await inPage(COUNTERS)
  step(`app up: main ${mainPid} on ${port}`)
  await wait(10000)
  await command("split:right")

  const t0 = Date.now()
  let cycle = 0
  stopAgent = agent()
  await sample("loop")
  let lastSample = Date.now()
  // (cycles take about 45 s: past the warm-up, mid-run and near the end)
  const snapAt = SNAPSHOTS ? [Math.max(2, Math.ceil(MINUTES * 0.3)), Math.max(4, Math.ceil(MINUTES * 0.6)), Math.max(6, Math.floor(MINUTES * 1.1))] : []
  while (Date.now() - t0 < MINUTES * 60000 && !aborted) {
    cycle++
    await editNotes(4, cycle * 5)
    await command(cycle % 2 ? "split:focus-left" : "split:focus-right")
    await editNotes(2, cycle * 3 + 1)
    await panels(cycle)
    if (cycle % 2 === 0) await terminal(cycle)
    await wait(20000) // a pause: reading, live updates arriving
    if (Date.now() - lastSample > 30000) { await sample("loop"); lastSample = Date.now() }
    if (snapAt.includes(cycle)) { step(`cycle ${cycle}: heap snapshots`); await takeSnapshots(cycle) }
    if (cycle === snapAt.at(-1)) for (const s of Object.values(sessions)) s.close()
    step(`cycle ${cycle} (${Math.round((Date.now() - t0) / 60000)} min)`)
  }
  await sample("loop")
  stopAgent()
  // Idle: still (shown, nothing changing), shown with the agent writing (live updates arriving), hidden, a graph.
  await wait(5000)
  for (const phase of PHASES) {
    if (aborted) break
    if (phase === "shown" || phase === "hidden") { stopAgent(); stopAgent = agent() }
    const vis = await hide(phase === "hidden")
    // (the graph: a tab of it shown, the agent stopped, so it settles and nothing moves; each write moves it again)
    if (phase === "graph") { stopAgent(); await command("tab:new"); await go("#view/graph"); await wait(30000) }
    step(`idle ${phase} (${vis}) for ${IDLE} min`)
    await soakCall("count")
    await sample(phase)
    for (let m = 0; m < IDLE * 2; m++) { await wait(30000); await sample(phase) }
    fs.writeFileSync(path.join(OUT, `sites-${phase}.json`), JSON.stringify(await soakCall(true), null, 2))
  }
  stopAgent()
  await hide(false)
  const result = report()
  console.log(result)
  fs.writeFileSync(path.join(OUT, "report.txt"), result + "\n")
  if (BUDGET) within = budget()
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
  for (const s of Object.values(sessions)) s.close()
  const k = port ? keeperPid() : 0
  if (child?.pid) try { process.kill(-child.pid, "SIGTERM") } catch { /* gone */ }
  if (k) try { process.kill(k, "SIGTERM") } catch { /* gone */ }
  if (port) try { execFileSync("tmux", ["-L", `vaultite-${port}`, "kill-server"], { stdio: "ignore" }) } catch { /* none */ }
  await wait(2000)
  if (OUT.startsWith(tmp + path.sep)) for (const f of fs.readdirSync(tmp)) { if (f !== "out") fs.rmSync(path.join(tmp, f), { recursive: true, force: true }) }
  else fs.rmSync(tmp, { recursive: true, force: true })
  console.error(`results in ${OUT}`)
}
process.exit(within ? 0 : 1)
