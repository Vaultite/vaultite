// The server alone for hours (app windows coming and going, an agent writing, idle stretches): its memory, CPU, files, sockets and watches, their growth an hour, the idle CPU.
// node tools/perf/serversoak.ts [--minutes 120] [--scale 30 | --vault <dir>] [--idle 10 (min, every hour)] [--out r.json] [--root <checkout>]   Linux
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { freePort, isolated, makeVault } from "./vault.ts"

const arg = (name: string, dflt = "") => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt }
const ROOT = path.resolve(arg("root", path.join(import.meta.dirname, "..", "..")))
const MINUTES = Number(arg("minutes", "120")), SCALE = Number(arg("scale", "30")), IDLE = Number(arg("idle", "10")), OUT = arg("out")
if (process.platform !== "linux") { console.error("serversoak reads /proc: Linux only"); process.exit(2) }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-serversoak-"))
const VAULT = path.join(tmp, "vault"), PORT = await freePort(), BASE = `http://127.0.0.1:${PORT}/`
if (arg("vault")) fs.cpSync(path.resolve(arg("vault")), VAULT, { recursive: true })
else makeVault(VAULT, SCALE)
for (const p of [".vaultite/plugins/workspaces", ".vaultite/plugins/machines"]) fs.rmSync(path.join(VAULT, p), { recursive: true, force: true })
const APP = { "X-Vaultite-Client": "app/web", "Content-Type": "application/json" }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (s: string) => console.error(`${new Date().toISOString().slice(11, 19)} ${s}`)

const child = spawn(process.execPath, ["server.ts"], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"],
  env: { ...process.env, ...isolated(path.join(tmp, "home")), VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: path.join(tmp, "local"), PORT: String(PORT), HOST: "127.0.0.1", VAULTITE_QUIET: "1" } })
let said = ""
child.stderr!.on("data", (b: Buffer) => { said = (said + b).slice(-20000) })
const errors = () => said.split("\n").filter((l) => /error|Error|EMFILE|ENOSPC|leak/i.test(l) && !l.startsWith('"') && !/^\d{4}-\d\d-\d\d [\d:]+ #\d+ "/.test(l))

// ---------- the process, from /proc
const TICK = 1000 / Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }))
function sample() {
  const pid = child.pid!
  const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ")
  const status = fs.readFileSync(`/proc/${pid}/status`, "utf8")
  const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(status)?.[1] ?? 0)
  let fds = 0, sockets = 0, watches = 0, pipes = 0
  for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
    fds++
    let to = ""
    try { to = fs.readlinkSync(`/proc/${pid}/fd/${fd}`) } catch { continue }
    if (to.startsWith("socket:")) sockets++
    else if (to.startsWith("pipe:")) pipes++
    else if (to === "anon_inode:inotify") try { watches += fs.readFileSync(`/proc/${pid}/fdinfo/${fd}`, "utf8").split("\n").filter((l) => l.startsWith("inotify wd:")).length } catch { /* closed */ }
  }
  return { at: Date.now(), cpu: (Number(stat[11]) + Number(stat[12])) * TICK, rss: Math.round(kb("VmRSS") / 1024), threads: kb("Threads"), fds, sockets, pipes, watches }
}

// ---------- app windows: each on /api/events, refreshing the state as a patch of its own on every change
type Win = { ws: WebSocket; v: string; busy: boolean; again: boolean; closed: boolean }
const wins = new Set<Win>()
let refreshes = 0, slowest = 0
async function refresh(w: Win) {
  if (w.busy) { w.again = true; return }
  w.busy = true
  try {
    do {
      w.again = false
      const t = performance.now()
      const r = await fetch(`${BASE}api/state?since=${encodeURIComponent(w.v)}`, { headers: APP })
      const a = await r.json() as { v: string }
      w.v = a.v; refreshes++; slowest = Math.max(slowest, performance.now() - t)
    } while (w.again && !w.closed)
  } catch { /* the server's gone: the run says so */ } finally { w.busy = false }
}
function open() {
  const w: Win = { ws: new WebSocket(`ws://127.0.0.1:${PORT}/api/events`), v: "0", busy: false, again: false, closed: false }
  w.ws.onmessage = (m) => { if (JSON.parse(String(m.data)).type === "change") void refresh(w) }
  w.ws.onopen = () => void refresh(w)
  w.ws.onclose = () => { w.closed = true; wins.delete(w) }
  wins.add(w)
}
const close = (w: Win) => { w.closed = true; w.ws.close(); wins.delete(w) }

// ---------- an agent writing (made-up notes of its own: Soak/), and what an open app asks for besides the state
let n = 0
const mine: string[] = []
async function act() {
  const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]
  const r = Math.random()
  if (r < 0.4 || mine.length < 5) {
    const rel = `Soak/Note ${n++}.md`
    fs.mkdirSync(path.join(VAULT, "Soak"), { recursive: true })
    fs.writeFileSync(path.join(VAULT, rel), `---\ntype: note\n---\n\nWritten by the soak, linking [[${mine.length ? pick(mine).slice(5, -3) : "Start here"}]].\n`)
    mine.push(rel)
  } else if (r < 0.75) fs.appendFileSync(path.join(VAULT, pick(mine)), `\nOne more line at ${new Date().toISOString()}.\n`)
  else if (r < 0.85) {
    const from = pick(mine), to = `Soak/Moved ${n++}.md`
    await fetch(`${BASE}api/file/move`, { method: "POST", headers: APP, body: JSON.stringify({ from, to }) }).then((x) => x.arrayBuffer())
    mine[mine.indexOf(from)] = to
  } else if (r < 0.9 && mine.length > 20) {
    const gone = mine.splice(Math.floor(Math.random() * mine.length), 1)[0]
    fs.rmSync(path.join(VAULT, gone), { force: true })
  } else {
    const at = pick(mine)
    for (const u of ["api/graph", `api/graph?path=${encodeURIComponent(at)}&depth=1`, "api/search?q=soak", `api/backlinks/unlinked?path=${encodeURIComponent(at)}`, `api/render?path=${encodeURIComponent(at)}`, "api/files"]) {
      await fetch(BASE + u, { headers: APP }).then((x) => x.arrayBuffer()).catch(() => {})
    }
  }
}

const samples: (ReturnType<typeof sample> & { phase: string; windows: number })[] = []
try {
  const t0 = performance.now()
  for (;;) { try { if ((await fetch(BASE + "api/vault", { headers: APP })).ok) break } catch { /* not up */ } if (child.exitCode !== null) throw new Error(`the server exited:\n${said}`); await wait(100) }
  log(`up in ${Math.round(performance.now() - t0)} ms on ${fs.readdirSync(VAULT, { recursive: true }).length} files; soaking ${MINUTES} min`)
  for (let i = 0; i < 3; i++) open()
  const end = Date.now() + MINUTES * 60_000
  let nextSample = 0, phase = "busy", phaseEnd = Date.now() + Math.max(1, 60 - IDLE) * 60_000
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`the server exited (${child.exitCode}):\n${said}`)
    if (Date.now() >= phaseEnd) {
      phase = phase === "busy" ? "idle" : "busy"
      phaseEnd = Date.now() + (phase === "idle" ? IDLE : Math.max(1, 60 - IDLE)) * 60_000
      log(`${phase} (${wins.size} windows, ${mine.length} notes of its own)`)
    }
    if (Date.now() >= nextSample) {
      samples.push({ ...sample(), phase, windows: wins.size })
      nextSample = Date.now() + 30_000
      const s = samples.at(-1)!
      if (samples.length % 20 === 1) log(`rss ${s.rss} MB, fds ${s.fds} (sockets ${s.sockets}, watches ${s.watches}), ${refreshes} refreshes, slowest ${Math.round(slowest)} ms`)
    }
    if (phase === "busy") {
      await act()
      // Windows come and go: a reload, a phone waking (the server must let go of each socket).
      if (Math.random() < 0.05) { const w = [...wins][0]; if (w) close(w) }
      if (wins.size < 3 || Math.random() < 0.04) open()
      await wait(1000 + Math.random() * 3000)
    } else await wait(1000)
  }
  for (const w of [...wins]) close(w)
  await wait(3000)
  samples.push({ ...sample(), phase: "end", windows: 0 })
} finally {
  await new Promise<void>((r) => { if (child.exitCode !== null) return r(); child.once("exit", () => r()); child.kill() })
  try { execFileSync("tmux", ["-L", `vaultite-${PORT}`, "kill-server"], { stdio: "ignore" }) } catch { /* none */ }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

// ---------- the report: growth an hour (least squares over the busy samples after the first 10 minutes), idle CPU
const warm = samples.filter((s) => s.at - samples[0].at > 10 * 60_000 && s.phase !== "end")
const perHour = (k: "rss" | "fds" | "sockets" | "watches") => {
  if (warm.length < 4) return null
  const xs = warm.map((s) => (s.at - warm[0].at) / 3_600_000), ys = warm.map((s) => s[k])
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0)
  return +slope.toFixed(1)
}
// (CPU over each half minute both of whose ends are idle)
const idle = samples.flatMap((s, i) => (i > 0 && s.phase === "idle" && samples[i - 1].phase === "idle" ? [(s.cpu - samples[i - 1].cpu) / (s.at - samples[i - 1].at)] : []))
const idleCpu = idle.length ? +(idle.reduce((a, b) => a + b, 0) / idle.length * 100).toFixed(2) : null
const first = samples[0], last = samples.at(-1)!
const result = { minutes: MINUTES, refreshes, slowestRefreshMs: Math.round(slowest), first, last, perHour: { rssMb: perHour("rss"), fds: perHour("fds"), sockets: perHour("sockets"), watches: perHour("watches") }, idleCpuPercent: idleCpu, errors: errors().slice(-20) }
console.log(`rss ${first.rss} -> ${last.rss} MB (${result.perHour.rssMb ?? "?"} MB an hour), fds ${first.fds} -> ${last.fds} (${result.perHour.fds ?? "?"} an hour; sockets ${first.sockets} -> ${last.sockets}, ` +
  `watches ${first.watches} -> ${last.watches}), idle CPU ${idleCpu ?? "?"}%, ${refreshes} refreshes (slowest ${result.slowestRefreshMs} ms)`)
if (result.errors.length) console.log(`server errors:\n${result.errors.join("\n")}`)
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ ...result, samples }, null, 2))
process.exit(0)
