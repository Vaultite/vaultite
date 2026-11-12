// What reference flows move over an emulated network (netem.ts), per flow: bytes, requests, round trips, time to usable.
// node tools/perf/transfer.ts [--root <checkout>]... [--from <checkout>] [--runs 3] [--profiles cellular,tailnet] [--flows a,b] [--idle 60] [--out r.json] [--print]
import "../test/isolate.ts" // (first: a run of its own, kept off the user's vaults)
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { chromium, type Browser, type CDPSession, type Page } from "playwright-core"
import { gitEnv } from "../../core/gitenv.ts"
import { slot } from "../qa_slots.ts"
import { backendName, serverFiles } from "../../plugins/core/terminal/backend.ts"
import { PROTOCOL } from "../../plugins/core/terminal/termd/protocol.ts"
import { netem, PROFILES, type Netem, type Profile } from "./netem.ts"
import { freePort, isolated, makeVault } from "./vault.ts"

const args = process.argv.slice(2)
const arg = (name: string, dflt: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt }
const roots = args.flatMap((a, i) => (a === "--root" ? [path.resolve(args[i + 1])] : []))
if (!roots.length) roots.push(path.join(import.meta.dirname, "..", ".."))
const RUNS = Number(arg("runs", "3")), IDLE_S = Number(arg("idle", "60")), OUT = arg("out", ""), PRINT = args.includes("--print")
const profiles = arg("profiles", "cellular,tailnet").split(",").map((p) => PROFILES[p] ?? (() => { throw new Error(`no profile ${p}`) })())
export const FLOWS = ["cold", "warm", "open", "switch", "search", "today", "rich", "terminal", "idle", "phone-cold", "phone-resume", "update"] as const
type Flow = (typeof FLOWS)[number]
const only = arg("flows", "").split(",").filter(Boolean) as Flow[]
/** --from: the build a phone's cache holds before a deploy (update); without it, no update flow. */
const FROM = arg("from", "") && path.resolve(arg("from", ""))
const FLOWS_ = (only.length ? only : [...FLOWS]).filter((f) => f !== "update" || FROM), flows = FLOWS_
const CHROME = [process.env.VAULTITE_CHROME, chromium.executablePath(), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"]
  .find((p) => p && fs.existsSync(p))!
/** Where a failed flow's screenshot goes (kept after the run's own temp folder is gone). */
const SHOTS = path.join(import.meta.dirname, "..", "..", "web", "qa", "shots")
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Bytes split by what they carried. */
type Kinds = { js: number; css: number; api: number; html: number; media: number; other: number; socket: number }
const kinds = (): Kinds => ({ js: 0, css: 0, api: 0, html: 0, media: 0, other: 0, socket: 0 })
export type Measure = {
  /** On the wire, both ways: TLS, headers and compressed bodies. */
  wire: number; down: number; up: number
  /** Bodies as sent (compressed) and as decoded, by kind; sockets' messages as their text. */
  sent: Kinds; decoded: Kinds
  requests: number; api: number; cached: number
  /** The longest chain of requests each asked only after the one before it was answered. */
  serial: number
  socketMsgs: number
  /** ms from the flow's start until it's usable (its marker drawn). */
  ms: number
}

// ---- the vault: the sample, generated notes, and a few made for the flows

function fixture(vault: string) {
  const w = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true }); fs.writeFileSync(path.join(vault, rel), text) }
  const lines = (n: number, s: string) => Array.from({ length: n }, (_, i) => `${s} ${i + 1}: the transfer harness's text, long enough to wrap on a phone's screen.`).join("\n\n")
  w("Transfer/Alpha.md", `---\ntype: note\ntags: [transfer]\n---\n\n# Alpha\n\n${lines(40, "Alpha paragraph")}\n`)
  w("Transfer/Beta.md", `---\ntype: note\ntags: [transfer]\n---\n\n# Beta\n\nLinks to [[Alpha]].\n\n${lines(40, "Beta paragraph")}\n`)
  // (an image, an embedded note, a query, a table: what a note's body asks the server for)
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")
  fs.mkdirSync(path.join(vault, "Transfer"), { recursive: true })
  fs.writeFileSync(path.join(vault, "Transfer/pixel.png"), png)
  w("Transfer/Rich.md", `---\ntype: note\n---\n\n# Rich\n\n![[pixel.png]]\n\n![[Beta]]\n\n\`\`\`query\ntype: note\ntag: transfer\n\`\`\`\n\n` +
    `| Name | Value |\n| --- | --- |\n${Array.from({ length: 20 }, (_, i) => `| Row ${i} | ${i * 7} |`).join("\n")}\n\n${lines(10, "Rich paragraph")}\n`)
}

// ---- a server per root, with the network in front of it

type Server = { root: string; child: ChildProcess; base: string; port: number; dir: string }
async function serve(root: string, dir: string): Promise<Server> {
  const port = await freePort()
  const child = spawn(process.execPath, ["server.ts"], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...isolated(path.join(dir, "home")), VAULTITE_VAULT: path.join(dir, "vault"), VAULTITE_LOCAL: path.join(dir, "local"),
      PORT: String(port), HOST: "127.0.0.1" },
  })
  let log = ""
  await new Promise<void>((resolve, reject) => {
    const on = (b: Buffer) => { log = (log + b).slice(-20_000); if (/vaultite on http/.test(log)) resolve() }
    child.stdout!.on("data", on); child.stderr!.on("data", (b: Buffer) => { log = (log + b).slice(-20_000) })
    child.on("exit", () => reject(new Error(`the server at ${root} exited:\n${log.slice(-2000)}`)))
  })
  // (the vault read and indexed before any flow: the first answer isn't the vault's first read)
  for (let t = Date.now(); Date.now() - t < 60_000; await wait(200)) {
    const r = await fetch(`http://127.0.0.1:${port}/api/loading`).then((x) => x.json(), () => null) as { ready?: boolean } | null
    if (r?.ready) break
  }
  // (the page comes through a proxy, as a phone's does through Tailscale Serve, but has no tailnet login to be the owner
  // by: this throwaway server's terminals answer whoever reaches it, set from this machine)
  await fetch(`http://127.0.0.1:${port}/api/config/plugin/terminal`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowRemote: true }) })
  return { root, child, base: `http://127.0.0.1:${port}/`, port, dir }
}
async function stop(s: Server) {
  await new Promise<void>((r) => { if (s.child.exitCode !== null) return r(); s.child.once("exit", () => r()); s.child.kill() })
  // (and its terminal server, which outlives it: this protocol's or, for an older checkout, the one before)
  for (const v of [PROTOCOL, PROTOCOL - 1]) {
    try { process.kill(Number(fs.readFileSync(`${serverFiles(backendName(s.port), v).files}.pid`, "utf8")), "SIGTERM") } catch { /* none */ }
  }
}

// ---- one flow's accounting, from the DevTools protocol and the relay

class Tally {
  reqs = new Map<string, { url: string; type: string; start: number; end: number; enc: number; dec: number; cached: boolean; api: boolean }>()
  socketSent = 0; socketDec = 0; socketMsgs = 0
  frames: string[] = []
  /** When the network last did anything (performance.now()). */
  last = 0
  down0: number; up0: number; h10: number
  cdp: CDPSession; net: Netem; origin: string; page: Page
  constructor(page: Page, cdp: CDPSession, net: Netem, origin: string) {
    this.page = page; this.cdp = cdp; this.net = net; this.origin = origin
    this.down0 = net.down.bytes; this.up0 = net.up.bytes; this.h10 = net.h1Bytes()
  }
  static async attach(page: Page, net: Netem) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Network.enable")
    const t = new Tally(page, cdp, net, new URL(net.url).origin)
    const r = t.reqs
    cdp.on("Network.requestWillBeSent", (e) => {
      if (!e.request.url.startsWith(t.origin)) return
      t.last = performance.now()
      const u = new URL(e.request.url)
      r.set(e.requestId, { url: u.pathname, type: e.type ?? "Other", start: e.timestamp, end: e.timestamp, enc: 0, dec: 0, cached: false, api: u.pathname.startsWith("/api/") })
    })
    cdp.on("Network.requestServedFromCache", (e) => { const x = r.get(e.requestId); if (x) x.cached = true })
    cdp.on("Network.responseReceived", (e) => { const x = r.get(e.requestId); if (x && (e.response.fromDiskCache || e.response.fromServiceWorker || e.response.fromPrefetchCache)) x.cached = true })
    cdp.on("Network.dataReceived", (e) => { const x = r.get(e.requestId); if (x) x.dec += e.dataLength })
    cdp.on("Network.loadingFinished", (e) => { const x = r.get(e.requestId); if (x) { x.end = e.timestamp; x.enc = e.encodedDataLength; t.last = performance.now() } })
    cdp.on("Network.loadingFailed", (e) => { const x = r.get(e.requestId); if (x) x.end = e.timestamp })
    const frame = (e: { response: { opcode: number; payloadData: string } }) => {
      const n = e.response.opcode === 2 ? Math.floor(e.response.payloadData.length * 3 / 4) : Buffer.byteLength(e.response.payloadData)
      t.socketMsgs++; t.socketDec += n; t.last = performance.now()
      if (PRINT) t.frames.push(`${e.response.opcode === 2 ? "bin " : ""}${String(n).padStart(7)} ${e.response.payloadData.slice(0, 120)}`)
    }
    cdp.on("Network.webSocketFrameReceived", frame)
    cdp.on("Network.webSocketFrameSent", frame)
    return t
  }
  reset() { this.frames = []; this.reqs.clear(); this.socketSent = this.socketDec = this.socketMsgs = 0; this.down0 = this.net.down.bytes; this.up0 = this.net.up.bytes; this.h10 = this.net.h1Bytes() }
  print(name: string) {
    console.log(`  ${name}:`)
    for (const f of this.frames) console.log(`    socket ${f}`)
    for (const x of [...this.reqs.values()].sort((a, b) => b.enc - a.enc)) console.log(`    ${x.cached ? "cached" : String(x.enc).padStart(7)} ${String(x.dec).padStart(8)} ${x.type.padEnd(10)} ${((x.end - x.start) * 1000).toFixed(0).padStart(5)}ms ${x.url.slice(0, 90)}`)
  }
  /** Requests started so far (for waiting until quiet). */
  get count() { return this.reqs.size + this.socketMsgs }
  done(ms: number): Measure {
    const sent = kinds(), decoded = kinds()
    const live = [...this.reqs.values()].filter((x) => !x.cached && x.type !== "WebSocket")
    for (const x of live) {
      const k: keyof Kinds = x.api ? "api" : x.type === "Script" ? "js" : x.type === "Stylesheet" ? "css" : x.type === "Document" ? "html"
        : ["Image", "Font", "Media"].includes(x.type) ? "media" : /\.js$/.test(x.url) ? "js" : /\.css$/.test(x.url) ? "css" : "other"
      sent[k] += x.enc; decoded[k] += x.dec
    }
    const down = this.net.down.bytes - this.down0, up = this.net.up.bytes - this.up0
    sent.socket = this.net.h1Bytes() - this.h10
    decoded.socket = this.socketDec
    return { wire: down + up, down, up, sent, decoded, requests: live.length, api: live.filter((x) => x.api).length,
      cached: [...this.reqs.values()].filter((x) => x.cached).length, serial: serial(live), socketMsgs: this.socketMsgs, ms: Math.round(ms) }
  }
}

/** The longest chain of requests where each starts after the one before it ended: round trips paid one after another. */
function serial(xs: { start: number; end: number }[]) {
  const s = [...xs].sort((a, b) => a.end - b.end)
  const best: number[] = []
  for (let i = 0; i < s.length; i++) {
    best[i] = 1
    for (let j = 0; j < i; j++) if (s[j].end <= s[i].start) best[i] = Math.max(best[i], best[j] + 1)
  }
  return Math.max(0, ...best)
}

/** Nothing new asked for `ms` (at most 15 s). */
async function quiet(t: Tally, ms = 1500) {
  const t0 = performance.now()
  t.last = Math.max(t.last, t0)
  while (performance.now() - t0 < 15_000 && performance.now() - t.last < ms) await wait(Math.max(50, ms - (performance.now() - t.last)))
}

// ---- the flows

const tabText = (page: Page, title: string) => page.waitForFunction((t) =>
  [...document.querySelectorAll("[role=tab][aria-selected=true]")].some((e) => e.textContent?.includes(t)) &&
  [...document.querySelectorAll(".cm-content, [data-pane] article, [data-pane] main")].some((e) => (e as HTMLElement).offsetParent && e.textContent!.length > 40),
title, { timeout: 30_000, polling: "raf" })
/** The app drawn and usable: the open page's content on screen (its heading, or an editor's lines). */
const usable = (page: Page) => page.waitForFunction(() => [...document.querySelectorAll("h1, .cm-line")].some((e) => {
  const r = e.getBoundingClientRect()
  return r.height > 0 && r.bottom > 0 && r.top < innerHeight && e.textContent!.trim().length > 2
}), null, { timeout: 60_000, polling: "raf" })
async function switcher(page: Page, name: string, newTab = false) {
  await page.keyboard.press("ControlOrMeta+o")
  await page.waitForSelector("[role=dialog] input[role=combobox]", { timeout: 10_000 })
  await page.keyboard.type(name)
  await page.waitForFunction((n) => [...document.querySelectorAll("[role=dialog] [role=option]")].some((e) => e.textContent?.includes(n)), name, { timeout: 10_000 })
  await page.keyboard.press(newTab ? "ControlOrMeta+Enter" : "Enter")
}

type Ctx = { server: Server; browser: Browser; net: Netem; from?: Server }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
async function open(c: Ctx, phone: boolean) {
  const ctx = await c.browser.newContext(phone ? PHONE : { viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => { errors.push(e.message); if (errors.length < 5) console.error(`page error: ${e.message}`) })
  const t = await Tally.attach(page, c.net)
  // (a phone's CPU: a few times slower than this machine's)
  if (phone) await t.cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
  return { ctx, page, t }
}

/** Runs `act` and measures from its start until `ready` resolves (or, without one, until the last request ends), then
 *  until the network is quiet. */
async function measure(t: Tally, name: string, act: () => Promise<unknown>, ready?: () => Promise<unknown>, settle = 1500) {
  t.reset()
  const t0 = performance.now()
  try {
    await act()
    if (ready) await ready()
  } catch (e) {
    fs.mkdirSync(SHOTS, { recursive: true })
    const shot = path.join(SHOTS, `transfer-${name}.png`)
    await t.page.screenshot({ path: shot }).catch(() => {})
    throw new Error(`${name}: ${(e as Error).message.split("\n")[0]} (the page: ${shot})`)
  }
  const ms = performance.now() - t0
  await quiet(t, settle)
  if (PRINT) t.print(name)
  if (process.env.VAULTITE_TRANSFER_TRACE) console.error(`${name}: ${Math.round(performance.now() - t0)} ms with settling`)
  return t.done(ready ? ms : Math.max(0, t.last - t0))
}

/** The page as iOS leaves it when the app goes to the background, and back. */
const visible = (page: Page, on: boolean) => page.evaluate((v) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (v ? "visible" : "hidden") })
  Object.defineProperty(document, "hidden", { configurable: true, get: () => !v })
  document.dispatchEvent(new Event("visibilitychange"))
  window.dispatchEvent(new Event(v ? "focus" : "blur"))
}, on)

/** A session on a computer: a cold load, then each flow in turn on that page. */
async function desktop(c: Ctx, want: Flow[], out: Partial<Record<Flow, Measure>>) {
  const { ctx, page, t } = await open(c, false)
  try {
    out.cold = await measure(t, "cold", () => page.goto(c.net.url), () => usable(page), 2500)
    if (want.includes("warm")) out.warm = await measure(t, "warm", () => page.reload(), () => usable(page), 2500)
    await dismiss(page)
    if (want.includes("open") || want.includes("switch")) out.open = await measure(t, "open", () => switcher(page, "Alpha"), () => tabText(page, "Alpha"))
    if (want.includes("switch")) {
      await switcher(page, "Beta", true); await tabText(page, "Beta"); await quiet(t)
      const tab = (s: string) => page.locator("[role=tab]").filter({ hasText: s }).first()
      out.switch = await measure(t, "switch", async () => {
        for (let i = 0; i < 3; i++) { await tab("Alpha").click(); await tabText(page, "Alpha"); await tab("Beta").click(); await tabText(page, "Beta") }
      }, async () => {})
    }
    if (want.includes("rich")) out.rich = await measure(t, "rich", () => switcher(page, "Rich"), () => tabText(page, "Rich"), 2500)
    if (want.includes("today")) out.today = await measure(t, "today", () => command(page, "Open today's daily note"), () => page.waitForFunction(() =>
      [...document.querySelectorAll("[role=tab][aria-selected=true]")].some((e) => /\d{4}-\d{2}-\d{2}|Today/.test(e.textContent ?? "")), null, { timeout: 30_000, polling: "raf" }))
    if (want.includes("search")) out.search = await measure(t, "search", async () => {
      await page.keyboard.press("ControlOrMeta+Shift+f")
      await page.waitForSelector("[data-pane] input[type=search], [data-pane] input", { timeout: 10_000 })
      await page.keyboard.type("paragraph", { delay: 40 })
    }, () => page.waitForFunction(() => [...document.querySelectorAll("[data-pane]")].some((e) => (e as HTMLElement).offsetParent && /Alpha paragraph/.test(e.textContent ?? "")),
      null, { timeout: 30_000, polling: "raf" }))
    if (want.includes("terminal")) {
      out.terminal = await measure(t, "terminal", async () => {
        await command(page, "Open terminal on this machine")
        await page.waitForSelector("[data-term-screen]", { timeout: 30_000 })
        await page.waitForFunction(() => /[%$❯#]\s*$/m.test([...document.querySelectorAll("[data-terminal]")].map((e) => (e as unknown as { terminalText?: () => string }).terminalText?.() ?? "").join("\n")), null, { timeout: 30_000 })
        await page.locator("[data-term]").first().click()
        await page.keyboard.type("seq 1 4000 | sed 's/$/ lines of output a program pours out/'", { delay: 20 })
        await page.keyboard.press("Enter")
      }, () => page.waitForFunction(() => /^4000 lines/m.test([...document.querySelectorAll("[data-terminal]")].map((e) => (e as unknown as { terminalText?: () => string }).terminalText?.() ?? "").join("\n")),
        null, { timeout: 60_000, polling: 100 }), 2500)
    }
    if (want.includes("idle")) {
      await quiet(t, 3000)
      t.reset()
      await wait(IDLE_S * 1000)
      const m = t.done(0)
      // (per minute: a CI run idles a minute, a run by hand as long as it likes)
      const per = (n: number) => Math.round((n * 60) / IDLE_S)
      out.idle = { ...m, wire: per(m.wire), down: per(m.down), up: per(m.up), requests: per(m.requests), api: per(m.api), socketMsgs: per(m.socketMsgs) }
    }
  } finally { await ctx.close() }
}

/** A session on a phone: a cold load, then to the background (its socket cut, a file changed meanwhile) and back. */
async function phone(c: Ctx, want: Flow[], out: Partial<Record<Flow, Measure>>) {
  const { ctx, page, t } = await open(c, true)
  try {
    out["phone-cold"] = await measure(t, "phone-cold", () => page.goto(c.net.url), () => usable(page), 2500)
    if (want.includes("phone-resume")) {
      await quiet(t, 2000)
      await visible(page, false)
      await wait(1000)
      c.net.dropSockets()
      await fetch(new URL("api/file", c.server.base), { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/qa" },
        body: JSON.stringify({ path: "Transfer/Written while away.md", text: "Written by an agent while the phone was away.\n" }) })
      await wait(5000)
      out["phone-resume"] = await measure(t, "phone-resume", () => visible(page, true), undefined, 2500)
    }
  } finally { await ctx.close() }
}

/** A deploy as a phone meets it: its cache holds the build before (`from`), and the page reloads into this one. */
async function update(c: Ctx, out: Partial<Record<Flow, Measure>>) {
  const { ctx, page, t } = await open(c, true)
  try {
    c.net.retarget(c.from!.base)
    await page.goto(c.net.url); await usable(page); await quiet(t, 2500)
    c.net.retarget(c.server.base)
    out.update = await measure(t, "update", () => page.reload(), () => usable(page), 2500)
  } finally { await ctx.close() }
}

async function command(page: Page, name: string) {
  await page.keyboard.press("ControlOrMeta+p")
  await page.waitForSelector("[role=dialog] input:focus", { timeout: 10_000 })
  await page.keyboard.type(name)
  await page.waitForFunction((n) => [...document.querySelectorAll("[role=option]")].some((e) => e.textContent?.includes(n)), name, { timeout: 10_000 })
  await page.keyboard.press("Enter")
}

/** Dialogs a fresh vault may show over the app (a plugin asking to write): not now. */
async function dismiss(page: Page) {
  if (await page.$("dialog[data-confirm][open]")) { await page.keyboard.press("Escape"); await wait(300) }
}

/** What the pages threw: a flow with errors isn't measured, it's broken. */
const errors: string[] = []

// ---- the run

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2) }
function medianOf(ms: Measure[]): Measure {
  const pick = (f: (m: Measure) => number) => median(ms.map(f))
  const k = (f: (m: Measure) => Kinds) => Object.fromEntries(Object.keys(kinds()).map((key) => [key, pick((m) => f(m)[key as keyof Kinds])])) as Kinds
  return { wire: pick((m) => m.wire), down: pick((m) => m.down), up: pick((m) => m.up), sent: k((m) => m.sent), decoded: k((m) => m.decoded),
    requests: pick((m) => m.requests), api: pick((m) => m.api), cached: pick((m) => m.cached), serial: pick((m) => m.serial),
    socketMsgs: pick((m) => m.socketMsgs), ms: pick((m) => m.ms) }
}
export type Result = { commit: string; profiles: Record<string, Partial<Record<Flow, Measure>>> }
/** What --out writes (transfer_report.ts reads it): each root's medians, the first the baseline, the last this commit. */
export type Report = { version: 1; runs: number; idleS: number; profiles: Record<string, Profile>; results: Result[] }

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`
async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-transfer-"))
  const release = await slot("transfer")
  const results: Result[] = roots.map((root) => ({ commit: commitOf(root), profiles: {} }))
  try {
    for (const profile of profiles) {
      const all: Partial<Record<Flow, Measure>>[][] = roots.map(() => [])
      for (let run = 0; run < RUNS; run++) {
        for (let i = 0; i < roots.length; i++) {
          const dir = path.join(tmp, `${profile.name}-${run}-${i}`)
          makeVault(path.join(dir, "vault"), 1)
          fixture(path.join(dir, "vault"))
          const s0 = performance.now()
          const server = await serve(roots[i], dir)
          if (process.env.VAULTITE_TRANSFER_TRACE) console.error(`server up: ${Math.round(performance.now() - s0)} ms`)
          const from = FROM ? (fs.cpSync(path.join(dir, "vault"), path.join(dir, "from", "vault"), { recursive: true }), await serve(FROM, path.join(dir, "from"))) : undefined
          const net = await netem(server.base, profile)
          const browser = await chromium.launch({ executablePath: CHROME, headless: true,
            args: ["--mute-audio", `--ignore-certificate-errors-spki-list=${net.spki}`] })
          const out: Partial<Record<Flow, Measure>> = {}
          // (idling is the slowest flow and the steadiest: once)
          const flows = run === 0 ? FLOWS_ : FLOWS_.filter((f) => f !== "idle")
          try {
            const c = { server, browser, net, from }
            if (flows.some((f) => !f.startsWith("phone") && f !== "update")) await desktop(c, flows, out)
            if (flows.some((f) => f.startsWith("phone"))) await phone(c, flows, out)
            if (flows.includes("update")) await update(c, out)
          } finally {
            await browser.close()
            await net.close()
            await stop(server)
            if (from) await stop(from)
          }
          all[i].push(out)
          const m = all[i].at(-1)!
          console.log(`${profile.name} run ${run + 1} ${path.basename(roots[i])}: ` + Object.entries(m).map(([f, x]) => `${f} ${kb(x!.wire)} ${x!.ms}ms`).join(", "))
        }
      }
      roots.forEach((_, i) => {
        const p: Partial<Record<Flow, Measure>> = {}
        for (const f of flows) { const xs = all[i].map((r) => r[f]).filter((x): x is Measure => !!x); if (xs.length) p[f] = medianOf(xs) }
        results[i].profiles[profile.name] = p
      })
    }
  } finally {
    release()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  print(results)
  if (OUT) {
    const report: Report = { version: 1, runs: RUNS, idleS: IDLE_S, profiles: Object.fromEntries(profiles.map((p) => [p.name, p])), results }
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")
  }
  if (errors.length) { console.error(`the pages threw ${errors.length} errors:\n${[...new Set(errors)].slice(0, 5).join("\n")}`); process.exitCode = 1 }
}

function commitOf(root: string) {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", env: gitEnv() }).trim() } catch { return "" }
}

function print(results: Result[]) {
  for (const profile of profiles) {
    console.log(`\n${profile.name} (${profile.rttMs} ms, ${profile.downKbps / 1000}/${profile.upKbps / 1000} Mbit/s), medians of ${RUNS}`)
    console.log(["flow".padEnd(13), "wire".padStart(10), "js".padStart(9), "css".padStart(9), "api".padStart(9), "socket".padStart(9), "decoded".padStart(10), "req".padStart(4), "api".padStart(4), "serial".padStart(6), "msgs".padStart(5), "ms".padStart(6)].join(" "))
    for (const f of flows) {
      results.forEach((r, i) => {
        const m = r.profiles[profile.name]?.[f]
        if (!m) return
        const dec = Object.values(m.decoded).reduce((a, b) => a + b, 0)
        console.log([`${f}${roots.length > 1 ? `#${i}` : ""}`.padEnd(13), kb(m.wire).padStart(10), kb(m.sent.js).padStart(9), kb(m.sent.css).padStart(9), kb(m.sent.api).padStart(9),
          kb(m.sent.socket).padStart(9), kb(dec).padStart(10), String(m.requests).padStart(4), String(m.api).padStart(4), String(m.serial).padStart(6),
          String(m.socketMsgs).padStart(5), String(m.ms).padStart(6)].join(" "))
      })
    }
  }
}

await main()
