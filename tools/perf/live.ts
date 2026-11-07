// Live updates under load (writers on disk and through the API, windows on a probe note): write to told, and to drawn.
// node tools/perf/live.ts [--scale 10] [--clients 4] [--writers 8] [--rate 4 (writes/s each)] [--seconds 30] [--out r.json] [--log server.log] [--profile first-window.cpuprofile] [--root <checkout>]
import "../test/isolate.ts" // (first: a run of its own, kept off the user's vaults)
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { chromium } from "playwright-core"
import { freePort, isolated, makeVault } from "./vault.ts"

const arg = (name: string, dflt: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt }
const ROOT = path.resolve(arg("root", path.join(import.meta.dirname, "..", "..")))
const SCALE = Number(arg("scale", "10")), CLIENTS = Number(arg("clients", "4")), WRITERS = Number(arg("writers", "8"))
const RATE = Number(arg("rate", "4")), SECONDS = Number(arg("seconds", "30")), OUT = arg("out", "")
const CHROME = [chromium.executablePath(), "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => fs.existsSync(p))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-live-"))
const VAULT = path.join(tmp, "vault"), PORT = await freePort(), BASE = `http://127.0.0.1:${PORT}/`
makeVault(VAULT, SCALE)
for (const p of [".vaultite/plugins/workspaces", ".vaultite/plugins/machines"]) fs.rmSync(path.join(VAULT, p), { recursive: true, force: true })
const PROBE = "Live probe.md"
fs.writeFileSync(path.join(VAULT, PROBE), "# Live probe\n\nstart\n")
const notes = fs.readdirSync(path.join(VAULT, "Notes")).filter((f) => f.endsWith(".md")).map((f) => `Notes/${f}`)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (s: string) => console.error(`${new Date().toISOString().slice(11, 19)} ${s}`)

const server = spawn(process.execPath, ["server.ts"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, ...isolated(path.join(tmp, "home")), VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: path.join(tmp, "local"), PORT: String(PORT), HOST: "127.0.0.1", VAULTITE_QUIET: "1" } })
let said = ""
server.stderr!.on("data", (b: Buffer) => { said = (said + b).slice(-20000) })
if (arg("log", "")) server.stderr!.pipe(fs.createWriteStream(arg("log", "")))
await new Promise<void>((ok, fail) => {
  let out = ""
  server.stdout!.on("data", (b: Buffer) => { out += b; if (/vaultite on http/.test(out)) ok() })
  server.once("exit", () => fail(new Error(`the server exited: ${said.slice(-2000)}`)))
})
const APP = { "X-Vaultite-Client": "app/web", "Content-Type": "application/json" }
const api = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(BASE + "api/" + p, { method, headers: APP, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`)
  return r.json()
}

// Each window: when the note probe was told (a change naming it), when each probe was first drawn (a frame showing its
// marker), and its main thread's long tasks.
const browser = await chromium.launch({ executablePath: CHROME, args: ["--mute-audio"] })
type Got = { __told: number[]; __drawn: Record<string, number>; __long: number[] }
const pages = []
let profiling: (() => Promise<() => Promise<void>>) | null = null
for (let i = 0; i < CLIENTS; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript((probe: string) => {
    const w = window as unknown as Got
    w.__told = []; w.__drawn = {}; w.__long = []
    const WS = window.WebSocket
    window.WebSocket = class extends WS {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        this.addEventListener("message", (e) => {
          const m = JSON.parse(String(e.data))
          if (m.type === "change" && (m.paths === null || m.paths.includes(probe))) w.__told.push(Date.now())
        })
      }
    }
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__long.push(e.duration) }).observe({ type: "longtask", buffered: true })
    let dirty = true
    const frame = () => {
      if (dirty) {
        dirty = false
        for (const m of (document.body?.textContent ?? "").matchAll(/lv(probe|new)(\d+)x/g)) w.__drawn[m[1] + m[2]] ??= Date.now()
      }
      requestAnimationFrame(frame)
    }
    new MutationObserver(() => { dirty = true }).observe(document, { subtree: true, childList: true, characterData: true })
    requestAnimationFrame(frame)
  }, PROBE)
  const page = await ctx.newPage()
  if (i === 0 && arg("profile", "")) {
    const cdp = await ctx.newCDPSession(page)
    await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 500 })
    profiling = async () => { await cdp.send("Profiler.start") ; return async () => fs.writeFileSync(arg("profile", ""), JSON.stringify((await cdp.send("Profiler.stop")).profile)) }
  }
  await page.goto(`${BASE}#file/${encodeURIComponent(PROBE)}`)
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent?.includes("start"), null, { timeout: 60_000 })
  pages.push(page)
}
log(`${CLIENTS} windows on ${PROBE}, ${notes.length} notes; ${WRITERS} writers at ${RATE}/s for ${SECONDS} s`)

// Writers: half on disk (as an editor or an AI's file tool), half through the API; one in ten makes a new note.
let stop = false, writes = 0, failed = 0
const writer = async (n: number) => {
  for (let i = 0; !stop; i++) {
    const t = Date.now()
    try {
      if (i % 10 === 9) {
        const rel = `Notes/Live ${n} ${i}.md`
        if (n % 2) fs.writeFileSync(path.join(VAULT, rel), `---\ntype: note\n---\n\nNew ${i}.\n`)
        else await api("POST", "file", { path: rel, text: `---\ntype: note\n---\n\nNew ${i}.\n` })
      } else {
        const rel = notes[(n * 31 + i * 7) % notes.length]
        if (n % 2) fs.appendFileSync(path.join(VAULT, rel), `\nWriter ${n} line ${i}.\n`)
        else {
          const { text } = await api("GET", `file?path=${encodeURIComponent(rel)}`)
          await api("PUT", "file", { path: rel, base: text, text: `${text}\nWriter ${n} line ${i}.\n` })
        }
      }
      writes++
    } catch { failed++ }
    await wait(Math.max(0, 1000 / RATE - (Date.now() - t)))
  }
}
const profiled = await profiling?.()
const writing = Array.from({ length: WRITERS }, (_, n) => writer(n))

// The probes, every 700 ms, alternately on disk and through the API: a line in the open note (drawn by its editor), then
// a new note beside it in place of the last (drawn by the file tree, from the store).
const probes: { id: string; at: number; via: string }[] = []
const end = Date.now() + SECONDS * 1000
for (let n = 0; Date.now() < end; n++) {
  const via = n % 4 < 2 ? "disk" : "api", kind = n % 2 ? "new" : "probe", id = `${kind}${n}`
  const rel = kind === "new" ? `Live probe lv${id}x.md` : PROBE, was = n > 2 ? `Live probe lvnew${n - 2}x.md` : null
  if (via === "disk") {
    probes.push({ id, at: Date.now(), via })
    if (kind === "new") { fs.writeFileSync(path.join(VAULT, rel), "New.\n"); if (was) fs.rmSync(path.join(VAULT, was)) }
    else fs.appendFileSync(path.join(VAULT, PROBE), `\nlv${id}x\n`)
  } else if (kind === "new") {
    probes.push({ id, at: Date.now(), via })
    await api("POST", "file", { path: rel, text: "New.\n" }).catch(() => failed++)
    if (was) await api("DELETE", `file?path=${encodeURIComponent(was)}`).catch(() => failed++)
  } else {
    const { text } = await api("GET", `file?path=${encodeURIComponent(PROBE)}`)
    probes.push({ id, at: Date.now(), via })
    await api("PUT", "file", { path: PROBE, base: text, text: `${text}\nlv${id}x\n` }).catch(() => failed++)
  }
  await wait(700)
}
stop = true
await profiled?.()
await Promise.all(writing)
await wait(10_000) // (the last ones' time to arrive)

const got = await Promise.all(pages.map((p) => p.evaluate(() => { const w = window as unknown as Got; return { told: w.__told, drawn: w.__drawn, long: w.__long } })))
const pct = (xs: number[], q: number) => xs.length ? Math.round([...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))]) : NaN
const drawn: Record<string, number[]> = { probe: [], new: [] }, told: number[] = []
let missed = 0
for (const g of got) {
  for (const p of probes) {
    const d = g.drawn[p.id]
    if (d === undefined) missed++
    else drawn[p.id.replace(/\d+/, "")].push(d - p.at)
    const t = g.told.find((x) => x >= p.at)
    if (t !== undefined && p.id.startsWith("probe")) told.push(t - p.at)
  }
}
const blocked = got.flatMap((g) => g.long)
const stats = (xs: number[]) => ({ p50: pct(xs, 0.5), p90: pct(xs, 0.9), max: pct(xs, 1) })
const result = {
  scale: SCALE, clients: CLIENTS, writers: WRITERS, rate: RATE, seconds: SECONDS, writes, failed, probes: probes.length,
  told: stats(told), "note drawn": stats(drawn.probe), "tree drawn": stats(drawn.new), missed,
  "main thread blocked": { "ms/s": Math.round(blocked.reduce((a, b) => a + b, 0) / CLIENTS / SECONDS), max: pct(blocked, 1) },
}
console.log(JSON.stringify(result, null, 2))
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ ...result, probes: probes, windows: got }, null, 2) + "\n")
await browser.close()
await new Promise<void>((r) => { server.once("exit", () => r()); server.kill() })
fs.rmSync(tmp, { recursive: true, force: true })
