// Terminal benchmark on a throwaway server: opening, keystroke echo, output bursts, a 60 fps program, reattach, terminal.list.
// node tools/perf/terminal.ts [--runs 200] [--out r.json] [--compare b.json] [--root <dir>] [--browser (page side)] [--dotfiles]
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { WebSocket } from "ws"
import { freePort, isolated, makeVault } from "./vault.ts"

const arg = (name: string, dflt: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt }
const flag = (name: string) => process.argv.includes(`--${name}`)
const ROOT = path.resolve(arg("root", path.join(import.meta.dirname, "..", "..")))
const RUNS = Number(arg("runs", "200")), OUT = arg("out", ""), COMPARE = arg("compare", "")
const PORT = await freePort()
const BASE = `http://127.0.0.1:${PORT}`, WSBASE = `ws://127.0.0.1:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-termperf-"))
const VAULT = path.join(tmp, "vault"), LOCAL = path.join(tmp, "local"), ZDOT = path.join(tmp, "zdot")
const KEEPER = path.join(os.platform() === "darwin" ? os.tmpdir() : `/tmp/vaultite-${process.getuid?.()}`, `vaultite-ptyd1-vaultite-${PORT}.sock`)

const step = (what: string) => console.error(`${new Date().toISOString().slice(11, 19)} ${what}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** A process's CPU time so far (user + system), in ms; 0 when it's gone. */
function cpu(pid: number | undefined) {
  if (!pid) return 0
  try {
    const t = execFileSync("/bin/ps", ["-o", "time=", "-p", String(pid)], { encoding: "utf8" }).trim() // [h:]m:ss.cc
    return t.split(":").reduce((acc, x) => acc * 60 + Number(x), 0) * 1000
  } catch { return 0 }
}
const keeperPid = () => { try { return Number(fs.readFileSync(`${KEEPER}.pid`, "utf8")) || undefined } catch { return undefined } }
let server: ChildProcess
/** CPU the server and the keeper spend in `fn`. */
async function cpuOf<T>(fn: () => Promise<T>): Promise<{ r: T; server: number; keeper: number }> {
  const s0 = cpu(server.pid), k0 = cpu(keeperPid())
  const r = await fn()
  return { r, server: cpu(server.pid) - s0, keeper: cpu(keeperPid()) - k0 }
}
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const q = (p: number) => +(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? NaN).toFixed(2)
  return { n: s.length, median: q(0.5), p90: q(0.9), p99: q(0.99), min: q(0) }
}

async function boot() {
  makeVault(VAULT, 1)
  fs.mkdirSync(ZDOT, { recursive: true })
  fs.writeFileSync(path.join(ZDOT, ".zshrc"), "PROMPT='$ '\nRPROMPT=''\nunsetopt PROMPT_SP\n")
  server = spawn(process.execPath, ["server.ts"], {
    cwd: ROOT, stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, ...isolated(path.join(tmp, "home")), VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: LOCAL, PORT: String(PORT), HOST: "127.0.0.1",
      SHELL: "/bin/zsh", ...(flag("dotfiles") ? {} : { ZDOTDIR: ZDOT }) },
  })
  let said = ""
  server.stderr!.on("data", (b: Buffer) => { said = (said + b.toString()).slice(-4000) })
  server.once("exit", (code) => { if (code) console.error(`the server stopped (exit ${code}):\n${said}`) })
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${BASE}/api/vault`)).ok) break } catch { /* not yet */ }
    if (server.exitCode !== null || i > 600) throw new Error("the server didn't start")
    await sleep(50)
  }
}

/** Stops the server, its keeper and its tmux (CLAUDE.md: by port and pid, never by pattern). */
async function cleanup() {
  const k = keeperPid()
  if (server && server.exitCode === null) { const gone = new Promise((r) => server.once("exit", r)); server.kill(); await Promise.race([gone, sleep(5000)]) }
  if (k) try { process.kill(k, "SIGTERM") } catch { /* gone */ }
  try { execFileSync("tmux", ["-L", `vaultite-${PORT}`, "kill-server"], { stdio: "ignore" }) } catch { /* none */ }
  fs.rmSync(tmp, { recursive: true, force: true })
}

/** A page's socket on a shell: what it printed (decoded), when each message came, and waits on it. */
class Term {
  ws: WebSocket
  out = ""
  base = 0 // (where `out` starts in all it printed: the start is let go)
  msgs = 0
  bytes = 0
  t0 = performance.now()
  times: Record<string, number> = {}
  private waiters: { test: (fresh: number) => boolean; ok: () => void }[] = []
  private dec = new TextDecoder()
  onChunk: ((s: string, at: number) => void) | null = null
  constructor(id: string, q = "") {
    this.ws = new WebSocket(`${WSBASE}/api/terminal/${id}?cols=120&rows=40${q}`)
    this.ws.on("open", () => { this.times.open = performance.now() - this.t0 })
    this.ws.on("message", (data: Buffer, binary: boolean) => {
      const at = performance.now()
      if (!binary) {
        const m = JSON.parse(data.toString())
        if (m.t === "attached") this.times.attached ??= at - this.t0
        return
      }
      this.times.first ??= at - this.t0
      this.times.last = at - this.t0
      this.msgs++; this.bytes += data.length
      const s = this.dec.decode(data, { stream: true })
      if (this.out.length > 1 << 21) { this.base += this.out.length - (1 << 16); this.out = this.out.slice(-(1 << 16)) }
      this.out += s
      this.onChunk?.(s, at)
      // (only what's new and a little before it is looked at: scanning all of it each time would make this the bottleneck)
      const end = this.base + this.out.length
      this.waiters = this.waiters.filter((w) => { if (w.test(end - s.length)) { w.ok(); return false } return true })
    })
  }
  ready() { return new Promise<void>((ok, fail) => { this.ws.once("open", () => ok()); this.ws.once("error", fail) }) }
  /** Resolves once what it printed from now on passes `test`. */
  until(test: RegExp | string, ms = 20000) {
    const from = this.base + this.out.length
    /** Whether it's in what was printed since `from`, looking only from a little before `fresh` (where the new part starts). */
    const t = (fresh: number) => {
      const at = Math.max(0, Math.max(from, fresh - 4096) - this.base)
      return typeof test === "string" ? this.out.indexOf(test, at) >= 0 : test.test(this.out.slice(at))
    }
    return new Promise<void>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`timed out waiting for ${test}`)), ms)
      this.waiters.push({ test: t, ok: () => { clearTimeout(timer); ok() } })
    })
  }
  type(s: string) { this.ws.send(Buffer.from(s), { binary: true }) }
  /** Runs a command and waits for it to end (a marker it prints after, computed so the typed line doesn't match). */
  async run(cmd: string, ms = 60000) {
    const n = Math.floor(Math.random() * 1e6)
    const done = this.until(`END${n + 1}`, ms)
    this.type(`${cmd}; echo END$((${n}+1))\r`)
    await done
  }
  close() { return new Promise<void>((r) => { if (this.ws.readyState === WebSocket.CLOSED) return r(); this.ws.once("close", () => r()); this.ws.close() }) }
}

let seq = 0
const newId = () => `perf${Date.now().toString(36)}${seq++}`

/** A new shell, from the socket's first byte to a command's answer. */
async function openOne(id = newId()) {
  const t = new Term(id)
  await t.ready()
  await new Promise<void>((r) => { const check = () => (t.times.attached !== undefined ? r() : setTimeout(check, 1)); check() })
  const ready = t.until("R2")
  t.type("echo R$((1+1))\r")
  await ready
  t.times.usable = performance.now() - t.t0
  return { id, t }
}

/** Keystroke echo: a letter and its erase, each waited for (zsh's line editor echoes both). */
async function echo(t: Term, n: number) {
  const ms: number[] = []
  for (let i = 0; i < n; i++) {
    const key = i % 2 ? "\x7f" : "x"
    const t0 = performance.now()
    const got = new Promise<void>((r) => { t.onChunk = () => { t.onChunk = null; r() } })
    t.type(key)
    await got
    ms.push(performance.now() - t0)
  }
  return ms
}

/** The same straight to the keeper's socket (attached to the same shell): the path without the server. */
async function echoKeeper(id: string, n: number) {
  const sock = net.connect(KEEPER)
  await new Promise((r) => sock.once("connect", r))
  sock.setEncoding("utf8")
  let buf = "", waiter: (() => void) | null = null
  sock.on("data", (c: string) => {
    buf += c
    let nl: number
    while ((nl = buf.indexOf("\n")) >= 0) {
      const m = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1)
      if (m.t === "data" || m.re === 1) { const w = waiter; waiter = null; w?.() }
    }
  })
  const attached = new Promise<void>((r) => { waiter = r })
  sock.write(JSON.stringify({ op: "attach", id, re: 1 }) + "\n")
  await attached
  const ms: number[] = []
  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    const got = new Promise<void>((r) => { waiter = r })
    sock.write(JSON.stringify({ op: "input", b64: Buffer.from(i % 2 ? "\x7f" : "x").toString("base64") }) + "\n")
    await got
    ms.push(performance.now() - t0)
  }
  sock.destroy()
  return ms
}

/** A full-screen program redrawing at 60 fps: each frame says when it was written; how late each arrives here. */
const TUI = `import sys,time
w=sys.stdout
for f in range(240):
  t=time.time()*1000
  lines=[('%d '%((f+r)%10))*58 for r in range(38)]
  w.write('\\x1b[H'+'\\r\\n'.join(lines)+'\\r\\n\\x1b[7mFRAME %d AT %.3f END\\x1b[0m'%(f,t)); w.flush()
  time.sleep(1/60)
`

const result: Record<string, unknown> = { runs: RUNS, node: process.version, date: new Date().toISOString(), load: os.loadavg()[0] }
try {
  await boot()
  step("opening")
  // Opening: new shells (no spare), then ones the page's list socket keeps ready.
  const cold: Record<string, number>[] = []
  for (let i = 0; i < 5; i++) { const { t } = await openOne(); cold.push(t.times); await t.close() }
  const watcher = new WebSocket(`${WSBASE}/api/terminals`)
  await new Promise((r) => watcher.once("message", r))
  const warm: Record<string, number>[] = []
  for (let i = 0; i < 5; i++) { await sleep(3000); const { t } = await openOne(); warm.push(t.times); await t.close() }
  const col = (rows: Record<string, number>[], k: string) => stats(rows.map((r) => r[k]).filter((x) => x !== undefined)).median
  const opening = (rows: Record<string, number>[]) => Object.fromEntries(["open", "attached", "first", "usable"].map((k) => [k, col(rows, k)]))
  result.open = { new: opening(cold), spare: opening(warm) }

  step("typing")
  // Typing.
  const { id, t } = await openOne()
  await t.run("clear")
  await echo(t, 20) // warm-up
  const e = await cpuOf(() => echo(t, RUNS))
  result.echo = { ...stats(e.r), serverCpuPerKey: +(e.server / RUNS).toFixed(3), keeperCpuPerKey: +(e.keeper / RUNS).toFixed(3) }
  const k = await cpuOf(() => echoKeeper(id, RUNS))
  result.echoKeeper = { ...stats(k.r), keeperCpuPerKey: +(k.keeper / RUNS).toFixed(3) }

  step("bursts")
  // Output in a burst: 2 MB of lines, and many short lines.
  for (const [name, cmd] of [["yes 2MB", "yes | head -c 2000000"], ["seq 100k", "seq 1 100000"]] as const) {
    const m0 = t.msgs, b0 = t.bytes, t0 = performance.now()
    const r = await cpuOf(() => t.run(cmd, 120000))
    const ms = performance.now() - t0, bytes = t.bytes - b0
    ;(result.burst ??= {} as Record<string, unknown>) && ((result.burst as Record<string, unknown>)[name] = {
      ms: +ms.toFixed(0), mbps: +(bytes / 1048576 / (ms / 1000)).toFixed(2), msgs: t.msgs - m0, avgMsg: Math.round(bytes / (t.msgs - m0)),
      serverCpu: r.server, keeperCpu: r.keeper })
  }

  step("typing while busy")
  // Typing while a program prints (a busy agent): a line of output every 5 ms in the background.
  await t.run("clear")
  t.type("(for i in $(seq 1 600); do echo tick $i; sleep 0.005; done) &\r")
  await sleep(300)
  const busy: number[] = []
  let missed = 0
  for (let i = 0; i < 60; i++) {
    const t0 = performance.now(), mark = `Q${i}Z`
    const got = t.until(mark, 5000)
    t.type(mark)
    // (zsh may redraw the line between ticks in pieces that never show it whole: counted, not fatal)
    if (await got.then(() => true, () => false)) busy.push(performance.now() - t0); else missed++
    t.type("\x15") // (the line erased again)
    await sleep(20)
  }
  result.echoBusy = { ...stats(busy), missed }
  t.type("\x15")
  await t.run("wait; clear", 120000) // (the ticks end by themselves: a kill typed among them may not arrive whole)

  step("60 fps program")
  // A full-screen program's frames: how late each reaches the page.
  fs.writeFileSync(path.join(tmp, "tui.py"), TUI)
  const late: number[] = []
  t.onChunk = null
  const seen = new Set<number>()
  const re = /FRAME (\d+) AT ([\d.]+) END/g
  let tail = ""
  const t0 = performance.now(), epoch = Date.now() - performance.now()
  t.onChunk = (s, at) => {
    tail = (tail + s).slice(-200 - s.length)
    for (const m of tail.matchAll(re)) { const f = Number(m[1]); if (!seen.has(f)) { seen.add(f); late.push(epoch + at - Number(m[2])) } }
    tail = tail.slice(-120)
  }
  const tu = await cpuOf(() => t.run(`python3 ${path.join(tmp, "tui.py")}`, 60000))
  t.onChunk = null
  result.tui = { frames: seen.size, ...stats(late), ms: Math.round(performance.now() - t0), serverCpu: tu.server, keeperCpu: tu.keeper }

  step("reattach")
  // Reattaching to a shell with a full history (its 10,000 lines kept).
  await t.run("seq 1 10000 | sed 's/$/ some text to fill a line of the history/'", 180000)
  await t.close()
  const back: Record<string, number>[] = []
  for (let i = 0; i < 5; i++) {
    const r = new Term(id, "&attach=1")
    // (the picture, then nothing for half a second)
    while (r.times.first === undefined || performance.now() - r.t0 - (r.times.last ?? 0) < 500) await sleep(20)
    back.push({ ...r.times, bytes: r.bytes })
    await r.close()
  }
  result.reattach = { attached: col(back, "attached"), picture: col(back, "first"), bytes: col(back, "bytes") }

  step("list")
  // terminal.list with 10 shells.
  const many: Term[] = []
  for (let i = 0; i < 9; i++) many.push((await openOne()).t)
  const list: number[] = [], sessions: number[] = []
  const lc = await cpuOf(async () => {
    for (let i = 0; i < 20; i++) {
      let t1 = performance.now()
      await (await fetch(`${BASE}/api/ops/terminal.list`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json()
      list.push(performance.now() - t1)
      t1 = performance.now()
      await (await fetch(`${BASE}/api/terminals/sessions`)).json()
      sessions.push(performance.now() - t1)
    }
  })
  result.list = { op: stats(list), sessions: stats(sessions), cpuPerPair: +(lc.server / 20).toFixed(1) }
  for (const m of many) await m.close()
  watcher.close()

  if (flag("browser")) result.browser = await browserSide()
} catch (e) {
  console.error(e)
  result.failed = String(e)
} finally {
  await cleanup()
}

/** The page's side: keystroke to echo drawn, and frames while a shell prints fast, in Playwright's Chromium. */
async function browserSide() {
  const { launch } = await import("../../web/qa/lib/qa.mjs")
  const browser = await launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>
      w.__msgs = [] as number[]
      const W = window.WebSocket
      window.WebSocket = class extends W {
        constructor(url: string | URL, p?: string | string[]) {
          super(url, p)
          if (/\/api\/terminal\//.test(String(url))) this.addEventListener("message", () => (w.__msgs as number[]).push(performance.now()))
        }
      } as typeof WebSocket
    })
    const id = newId()
    await page.goto(`${BASE}/#view/terminal%2F${id}`)
    const text = () => page.evaluate(() => [...document.querySelectorAll("[data-terminal]")].map((e) => (e as unknown as { terminalText?: () => string }).terminalText?.() ?? "").join("\n"))
    for (let i = 0; i < 100 && !/\$ /.test(await text()); i++) await sleep(100)
    // (the made-up vault's plugins may ask something first: a dialog over the page)
    for (let i = 0; i < 10 && await page.locator("dialog[open]").count(); i++) { await page.keyboard.press("Escape"); await sleep(300) }
    await page.locator(".xterm").click()
    // Input to echo drawn: the key's event, then the frame after the echo is parsed (the row shows it).
    const keys: number[] = []
    for (let i = 0; i < 40; i++) {
      const ch = String.fromCharCode(97 + (i % 26))
      const p = page.evaluate((ch) => new Promise<number>((resolve) => {
        let t0 = 0
        addEventListener("keydown", () => { t0 = performance.now() }, { capture: true, once: true })
        const el = document.querySelector("[data-terminal]") as unknown as { terminalText: () => string }
        const before = el.terminalText().split("\n").filter((l) => l.startsWith("$ ")).at(-1) ?? ""
        const step = () => {
          const now = el.terminalText().split("\n").filter((l) => l.startsWith("$ ")).at(-1) ?? ""
          if (t0 && now.length > before.length && now.endsWith(ch)) return requestAnimationFrame(() => resolve(performance.now() - t0))
          requestAnimationFrame(step)
        }
        step()
      }), ch)
      await sleep(30)
      await page.keyboard.type(ch)
      keys.push(await p)
      await sleep(30)
    }
    await page.keyboard.press("Control+U")
    // Frames under heavy output: rAF gaps and long tasks while 2 MB scroll by.
    const frames = page.evaluate(() => new Promise<{ gaps: number[]; long: number[]; ms: number }>((resolve) => {
      const gaps: number[] = [], long: number[] = []
      new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(e.duration) }).observe({ type: "longtask", buffered: false })
      let last = performance.now(), quiet = 0
      const t0 = performance.now(), msgs = (window as unknown as { __msgs: number[] }).__msgs, n0 = msgs.length
      const step = () => {
        const now = performance.now()
        gaps.push(now - last); last = now
        quiet = msgs.length > n0 && now - msgs.at(-1)! > 1000 ? quiet + 1 : 0
        if (quiet > 30 || now - t0 > 60000) return resolve({ gaps, long, ms: msgs.at(-1)! - t0 })
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    }))
    await sleep(100)
    await page.keyboard.type("yes | head -c 2000000\n")
    const r = await frames
    const busy = r.gaps.slice(0, Math.max(1, r.gaps.length - 31))
    return { echoDrawn: stats(keys), frame: stats(busy), longTasks: r.long.length, longTaskMs: Math.round(r.long.reduce((a, b) => a + b, 0)), outputMs: Math.round(r.ms) }
  } finally { await browser.close() }
}

// ---------- the report
const before = COMPARE ? JSON.parse(fs.readFileSync(COMPARE, "utf8")) : null
const vs = (a?: number, b?: number) => (a && b ? ` (${(a / b).toFixed(1)}x)` : "")
const get = (o: unknown, p: string) => p.split(".").reduce((x: unknown, k) => (x as Record<string, unknown> | undefined)?.[k], o) as number | undefined
const row = (label: string, p: string, unit = "ms") => {
  const v = get(result, p)
  if (v === undefined) return
  console.log(`${label.padEnd(44)} ${String(v).padStart(9)}${unit}${before ? vs(get(before, p), v) : ""}`)
}
console.log(`terminal perf: node ${process.version}, load ${os.loadavg()[0].toFixed(1)}, ${ROOT}`)
for (const how of ["new", "spare"]) for (const k of ["attached", "first", "usable"]) row(`open (${how}): ${k}`, `open.${how}.${k}`)
for (const k of ["median", "p90", "p99"]) row(`keystroke echo ${k}`, `echo.${k}`)
row("  server cpu per key", "echo.serverCpuPerKey"); row("  keeper cpu per key", "echo.keeperCpuPerKey")
for (const k of ["median", "p99"]) row(`keystroke echo, keeper only ${k}`, `echoKeeper.${k}`)
for (const k of ["median", "p90", "p99"]) row(`typing while it prints ${k}`, `echoBusy.${k}`)
for (const name of Object.keys((result.burst ?? {}) as object)) {
  row(`${name}: time`, `burst.${name}.ms`); row(`${name}: throughput`, `burst.${name}.mbps`, "MB/s"); row(`${name}: messages`, `burst.${name}.msgs`, "")
  row(`${name}: server cpu`, `burst.${name}.serverCpu`); row(`${name}: keeper cpu`, `burst.${name}.keeperCpu`)
}
row("60 fps program: frames seen", "tui.frames", ""); for (const k of ["median", "p90", "p99"]) row(`  frame lateness ${k}`, `tui.${k}`)
row("  server cpu", "tui.serverCpu"); row("  keeper cpu", "tui.keeperCpu")
row("reattach (10k lines): attached", "reattach.attached"); row("reattach: picture", "reattach.picture"); row("reattach: bytes", "reattach.bytes", "")
row("terminal.list (10 shells) median", "list.op.median"); row("terminal.list p90", "list.op.p90"); row("GET terminals/sessions median", "list.sessions.median")
row("  server cpu per list + sessions", "list.cpuPerPair")
for (const k of ["median", "p90"]) row(`browser: key to echo drawn ${k}`, `browser.echoDrawn.${k}`)
for (const k of ["median", "p90", "p99"]) row(`browser: frame during 2 MB ${k}`, `browser.frame.${k}`)
row("browser: long tasks", "browser.longTasks", ""); row("browser: long tasks total", "browser.longTaskMs")
if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 2))
process.exit(0)
