// An open app over the network (desktop and phone windows): first load, idle a minute with an agent writing, back online.
// node tools/perf/idle.ts [--scale 1] [--minutes 2] [--root <checkout>] [--out r.json] [--compare before.json] [--quiet]
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { chromium, devices, type Browser, type BrowserContext, type Page } from "playwright-core"
import { slot } from "../qa_slots.ts"
import { freePort, isolated, makeVault } from "./vault.ts"

const args = process.argv.slice(2)
const arg = (name: string, dflt: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt }
const ROOT = path.resolve(arg("root", path.join(import.meta.dirname, "..", "..")))
const SCALE = Number(arg("scale", "1")), MINUTES = Number(arg("minutes", "2")), OUT = arg("out", ""), COMPARE = arg("compare", "")
const QUIET = args.includes("--quiet") // no agent writing: the app alone
const PORT = await freePort()
const BASE = `http://127.0.0.1:${PORT}/`
const CHROME = [chromium.executablePath(), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((p) => fs.existsSync(p))!

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-idle-"))
const VAULT = path.join(tmp, "vault")

/** A process's CPU time so far (user + system), in ms. */
function cpu(c: ChildProcess) {
  const t = execFileSync("/bin/ps", ["-o", "time=", "-p", String(c.pid)], { encoding: "utf8" }).trim()
  return t.split(":").reduce((acc, x) => acc * 60 + Number(x), 0) * 1000
}

/** A request's name in the tally: its route, with what's per-file left out ("state?since", "config/plugin/*"). */
function routeOf(u: URL) {
  if (!u.pathname.startsWith("/api/")) return u.pathname.startsWith("/assets/") ? "(assets)" : u.pathname
  const r = u.pathname.slice(5).replace(/^(config\/plugin|file|raw|themes)\/.+/, "$1/*")
  return u.searchParams.has("since") ? `${r}?since` : r
}

type Tally = Record<string, { n: number; bytes: number }>
type Client = { name: string; page: Page; tally: Tally; ws: number; wsBytes: number }
const add = (t: Tally, k: string, bytes: number) => { t[k] ??= { n: 0, bytes: 0 }; t[k].n++; t[k].bytes += bytes }

/** A window asking as over the tailnet (X-Forwarded-For: compressed answers with ETags), counting each request's bytes
 *  on the wire (headers and the body as sent) and the live socket's frames. */
async function open(browser: Browser, name: string, options: Parameters<Browser["newContext"]>[0]): Promise<Client> {
  const ctx: BrowserContext = await browser.newContext({ ...options, extraHTTPHeaders: { "X-Forwarded-For": "100.64.0.1" } })
  const page = await ctx.newPage()
  const c: Client = { name, page, tally: {}, ws: 0, wsBytes: 0 }
  page.on("requestfinished", (req) => {
    void req.sizes().then((s) => add(c.tally, `${req.method()} ${routeOf(new URL(req.url()))}`, s.responseHeadersSize + s.responseBodySize), () => {})
  })
  page.on("websocket", (ws) => ws.on("framereceived", (f) => { c.ws++; c.wsBytes += typeof f.payload === "string" ? Buffer.byteLength(f.payload) : f.payload.length }))
  return c
}

const total = (t: Tally) => Object.values(t).reduce((a, x) => ({ n: a.n + x.n, bytes: a.bytes + x.bytes }), { n: 0, bytes: 0 })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** An agent at work, as on a real Mac: a note edited now and then, its terminal tab's settings file rewritten (atomically,
 *  as plugins do) and iCloud touching the folders above it, which FSEvents reports as changes of their own. */
function agent() {
  const note = path.join(VAULT, "Notes", fs.readdirSync(path.join(VAULT, "Notes")).sort()[0])
  const dir = path.join(VAULT, ".vaultite/plugins/tabs")
  fs.mkdirSync(dir, { recursive: true })
  let i = 0
  const id = setInterval(() => {
    i++
    const file = path.join(dir, "device-perf.json")
    fs.writeFileSync(`${file}.tmp-perf`, JSON.stringify({ tabs: [`t${i % 3}`] }))
    fs.renameSync(`${file}.tmp-perf`, file)
    const t = new Date()
    for (const d of [dir, path.dirname(dir), path.join(VAULT, ".vaultite"), VAULT]) fs.utimesSync(d, t, t)
    if (i % 3 === 0) fs.appendFileSync(note, `\nEdited ${i}.\n`)
  }, 5000)
  return () => clearInterval(id)
}

makeVault(VAULT, SCALE)
const result: Record<string, unknown> = { scale: SCALE, minutes: MINUTES, agent: !QUIET, node: process.version, date: new Date().toISOString() }
const release = await slot("perf/idle")
const child = spawn(process.execPath, ["server.ts"], {
  cwd: ROOT, stdio: ["ignore", "pipe", "ignore"],
  env: { ...process.env, ...isolated(path.join(tmp, "home")), VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: path.join(tmp, "local"), PORT: String(PORT), HOST: "127.0.0.1" },
})
let browser: Browser | null = null
try {
  await new Promise<void>((resolve, reject) => {
    let out = ""
    child.stdout!.on("data", (b: Buffer) => { out += b; if (/vaultite on http/.test(out)) resolve() })
    child.on("exit", () => reject(new Error("the server exited")))
  })
  browser = await chromium.launch({ executablePath: CHROME })
  const clients = [await open(browser, "desktop", { viewport: { width: 1440, height: 900 } }), await open(browser, "phone", { ...devices["iPhone 13"] })]
  // First load: until nothing was asked for 3 s.
  const c0 = cpu(child)
  await Promise.all(clients.map((c) => c.page.goto(BASE)))
  for (let quiet = 0, last = -1; quiet < 3; ) {
    await wait(1000)
    const n = clients.reduce((a, c) => a + total(c.tally).n, 0)
    quiet = n === last ? quiet + 1 : 0
    last = n
  }
  result.first = Object.fromEntries(clients.map((c) => [c.name, { ...total(c.tally), routes: structuredClone(c.tally) }]))
  result.firstCpu = cpu(child) - c0
  // Idle: the windows stay open and shown; an agent writes meanwhile.
  for (const c of clients) { c.tally = {}; c.ws = 0; c.wsBytes = 0 }
  const stop = QUIET ? () => {} : agent()
  const c1 = cpu(child)
  await wait(MINUTES * 60_000)
  stop()
  result.idleCpuPerMin = Math.round((cpu(child) - c1) / MINUTES)
  result.idle = Object.fromEntries(clients.map((c) => [c.name, { ...total(c.tally), ws: c.ws, wsBytes: c.wsBytes, routes: structuredClone(c.tally) }]))
  // Away: the phone loses the network for 30 s (asleep, in a tunnel) while the agent writes, then is back: what it asks
  // for in the 15 s after.
  const phone = clients[1]
  const stopAway = QUIET ? () => {} : agent()
  await phone.page.context().setOffline(true)
  await wait(30_000)
  phone.tally = {}
  await phone.page.context().setOffline(false)
  await phone.page.evaluate(() => dispatchEvent(new Event("online")))
  await wait(15_000)
  stopAway()
  result.back = { phone: { ...total(phone.tally), routes: phone.tally } }
} finally {
  await browser?.close()
  await new Promise<void>((r) => { if (child.exitCode !== null) r(); else { child.once("exit", () => r()); child.kill() } })
  release()
  fs.rmSync(tmp, { recursive: true, force: true })
}

const fmt = (n: number) => (n >= 1024 * 1024 ? `${(n / 1048576).toFixed(1)}M` : n >= 1024 ? `${(n / 1024).toFixed(0)}K` : `${Math.round(n)}B`)
const before = COMPARE ? JSON.parse(fs.readFileSync(COMPARE, "utf8")) : null
const was = (b: number | undefined) => (b === undefined ? "" : ` (was ${b})`)
const wasB = (b: number | undefined) => (b === undefined ? "" : ` (was ${fmt(b)})`)
type Row = { n: number; bytes: number; ws?: number; wsBytes?: number; routes: Tally }
console.log(`scale ${SCALE}, ${MINUTES} min idle${QUIET ? "" : ", an agent writing every 5 s"}, ${ROOT}`)
console.log(`server CPU: first load ${result.firstCpu}ms${was(before?.firstCpu)}, idle ${result.idleCpuPerMin}ms a minute${was(before?.idleCpuPerMin)}`)
for (const phase of ["first", "idle", "back"] as const) {
  for (const [name, r] of Object.entries(result[phase] as Record<string, Row>)) {
    const b = before?.[phase]?.[name] as Row | undefined, per = phase === "idle" ? MINUTES : 1
    console.log(`\n${phase === "first" ? "first load" : phase === "back" ? "back after 30 s offline" : "idle, a minute"} (${name}): ${+(r.n / per).toFixed(1)} requests${b ? was(+(b.n / per).toFixed(1)) : ""}, ` +
      `${fmt(r.bytes / per)}${b ? wasB(b.bytes / per) : ""}` + (r.ws !== undefined ? `; live socket ${+(r.ws / per).toFixed(1)} messages, ${fmt(r.wsBytes! / per)}` : ""))
    const keys = [...new Set([...Object.keys(r.routes), ...Object.keys(b?.routes ?? {})])]
      .sort((x, y) => (r.routes[y]?.n ?? 0) - (r.routes[x]?.n ?? 0) || (b?.routes[y]?.n ?? 0) - (b?.routes[x]?.n ?? 0))
    for (const k of keys) {
      const e = r.routes[k] ?? { n: 0, bytes: 0 }, o = b?.routes[k]
      console.log(`  ${k.slice(0, 48).padEnd(48)} ${String(+(e.n / per).toFixed(1)).padStart(6)}${o ? was(+(o.n / per).toFixed(1)).padEnd(12) : "".padEnd(12)} ${fmt(e.bytes / per).padStart(7)}${o ? wasB(o.bytes / per) : ""}`)
    }
  }
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 2))
process.exit(0)
