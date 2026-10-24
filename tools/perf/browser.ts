// The Browser's speed in the desktop app: tabs, navigation, input, frames, CPU, memory, restore; --engine: a kept Shields engine.
//   node tools/perf/browser.ts [--root <checkout>] [--engine <engine-2.bin>] [--only open,nav,switch,hidden,heavy,preload,keys,chrome,ads,idle,memory,restore,blocker] [--real] [--out r.json]
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { makeVault } from "./vault.ts"

const arg = (name: string, dflt: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt }
const ROOT = path.resolve(arg("root", path.join(import.meta.dirname, "..", "..")))
const OUT = arg("out", ""), REAL = process.argv.includes("--real")
const ONLY = new Set(arg("only", "").split(",").filter(Boolean))
const want = (...k: string[]) => !ONLY.size || k.some((x) => ONLY.has(x))
const ENGINE = path.resolve(arg("engine", path.join(os.tmpdir(), "vaultite-browser-perf-engine-2.bin")))
const now = () => performance.timeOrigin + performance.now()
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-browser-perf-"))
const results: Record<string, unknown> = { root: ROOT, date: new Date().toISOString(), load: +os.loadavg()[0].toFixed(1) }
const say = (k: string, v: unknown) => { results[k] = v; console.log(k, JSON.stringify(v)) }

// ---------- made-up pages, each telling its own times (window.__p) ----------

/** In every page: first paint, visibility changes with the first frame after each, keys to their next frame, frames. */
const INSTR = `<script>
const T = (t) => performance.timeOrigin + t
window.__p = { fcp: 0, vis: [], keys: [], frames: [], rec: false, raf: 0 }
new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") __p.fcp = T(e.startTime) }).observe({ type: "paint", buffered: true })
document.addEventListener("visibilitychange", () => { const v = { state: document.visibilityState, at: T(performance.now()), frame: 0 }; __p.vis.push(v)
  requestAnimationFrame(() => { v.frame = T(performance.now()) }) })
addEventListener("keydown", (e) => { const k = { at: T(e.timeStamp), run: T(performance.now()), frame: 0 }; __p.keys.push(k)
  requestAnimationFrame(() => { k.frame = T(performance.now()) }) })
const tick = (t) => { __p.raf++; if (__p.rec) __p.frames.push(t); requestAnimationFrame(tick) }; requestAnimationFrame(tick)
</script>`
const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<link rel="icon" href="/icon.svg"><style>body{font:16px/1.5 -apple-system,sans-serif;margin:0;padding:24px 40px;background:#fff;color:#222}</style>${INSTR}</head><body>${body}</body></html>`
const words = (n: number, s = 1) => Array.from({ length: n }, (_, i) => ["lighthouse", "keeper", "fog", "harbor", "signal", "tide", "rocks", "lamp"][(i * 7 + s) % 8]).join(" ")
const ARTICLE = (name: string) => page(`Page ${name}`, `<h1>Page ${name}</h1><input id="q">${Array.from({ length: 30 }, (_, i) => `<p>${words(80, i + name.length)}</p>`).join("")}`)
// A feed like YouTube's: thousands of cards with images, a sticky blurred header, and parts changing all the time.
const HEAVY = page("Heavy feed", `<header style="position:sticky;top:0;z-index:2;height:56px;backdrop-filter:blur(20px);background:rgba(255,255,255,.7);display:flex;align-items:center;gap:12px;padding:0 16px">
<b>Feed</b><input id="q" style="flex:1;height:32px"></header><main id="grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px"></main>
<script>
const g = document.getElementById("grid"), f = document.createDocumentFragment()
for (let i = 0; i < 3000; i++) { const d = document.createElement("div"); d.className = "card c" + (i % 50); d.id = "card-" + i
  d.style.cssText = "border-radius:12px;box-shadow:0 1px 6px rgba(0,0,0,.15);overflow:hidden;background:#fafafa"
  d.innerHTML = '<img loading="lazy" src="/img/' + i + '.svg" width="260" height="146" style="display:block;width:100%;height:auto"><div style="padding:8px"><b>' + "Video " + i + '</b><p style="margin:4px 0;color:#666">channel ' + (i % 97) + ' · ' + (i % 30) + 'K views</p><a href="/watch?v=' + i + '">watch</a></div>'
  f.append(d) }
g.append(f)
// (live parts: progress bars, hover previews, counters: classes and text changing ten times a second)
setInterval(() => { for (let k = 0; k < 40; k++) { const c = g.children[(Math.random() * g.children.length) | 0]; c.classList.toggle("hot"); c.querySelector("p").textContent = "channel · " + ((Math.random() * 99) | 0) + "K views" } }, 100)
</script><style>.hot{outline:2px solid #f33}</style>`)
const IMG = (i: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="146"><rect width="260" height="146" fill="hsl(${(i * 37) % 360},55%,60%)"/><circle cx="130" cy="73" r="${20 + (i % 30)}" fill="#fff8"/></svg>`
/** A page asking for many scripts and images, some on paths ad lists name, to cost Shields' matching. */
const ADS = (n: number) => page("Ads", `<h1>Requests</h1>${Array.from({ length: n }, (_, i) => i % 3 === 0 ? `<script src="/static/lib${i}.js"></script>`
  : i % 3 === 1 ? `<img src="/ads/banner_ad_${i}.gif?adunit=top&ad_type=display" width="1" height="1">` : `<img src="/pixel/track.gif?utm_source=x&i=${i}&event=pageview" width="1" height="1">`).join("")}`)

const server = http.createServer((req, res) => {
  const u = req.url ?? "/"
  const send = (type: string, body: string, cache = false) => { res.writeHead(200, { "Content-Type": type, ...(cache ? { "Cache-Control": "max-age=3600" } : {}) }); res.end(body) }
  if (u.startsWith("/icon.svg")) return send("image/svg+xml", IMG(7), true)
  if (u.startsWith("/img/")) return send("image/svg+xml", IMG(Number(/\d+/.exec(u)?.[0] ?? 0)), true)
  if (/\.js(\?|$)/.test(u)) return send("text/javascript", "void 0")
  if (u.includes(".gif")) return send("image/gif", "GIF89a")
  if (u.startsWith("/heavy")) return send("text/html; charset=utf-8", HEAVY)
  if (u.startsWith("/ads")) return send("text/html; charset=utf-8", ADS(Number(new URL(u, "http://x").searchParams.get("n") ?? 300)))
  if (u.startsWith("/clock")) return send("text/html; charset=utf-8", page("Clock", `<h1 id="t"></h1><script>setInterval(() => { document.getElementById("t").textContent = new Date().toLocaleTimeString() }, 1000)</script>`))
  send("text/html; charset=utf-8", ARTICLE(u.slice(1).replace(/\W/g, "-")))
})
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
const SITE = `http://127.0.0.1:${(server.address() as { port: number }).port}`

// ---------- the app, through its main process's inspector ----------

const VAULT = path.join(tmp, "vault")
makeVault(VAULT, 1)
type Reply = { result?: { result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string } } } }
type Win = { webContents: Electron.WebContents }

// (driven through the main process's inspector only: a DevTools client on the pages, as Playwright's, keeps them visible)
class App {
  child!: ChildProcess
  ws!: WebSocket
  origin = ""
  t0 = 0
  n = 0
  waiting = new Map<number, (v: Reply) => void>()
  dir: string
  constructor(dir: string) { this.dir = dir }

  async launch() {
    this.t0 = now()
    this.child = spawn(path.join(ROOT, "node_modules", ".bin", "electron"), [ROOT, "--vault", VAULT, "--inspect=0", "--use-mock-keychain", "--password-store=basic"], {
      env: { ...process.env, VAULTITE_USER_DATA: path.join(this.dir, "userData"), VAULTITE_LOCAL: path.join(this.dir, "local") },
      stdio: ["ignore", "pipe", "pipe"], detached: true,
    })
    let err = ""
    const url = await new Promise<string>((ok, fail) => {
      this.child.stderr!.on("data", (d) => { err += d; if (process.env.DEBUG) process.stderr.write(d); const m = /Debugger listening on (ws:\S+)/.exec(err); if (m) ok(m[1]) })
      this.child.once("exit", () => fail(new Error(`electron exited: ${err.slice(-500)}`)))
    })
    this.child.stdout!.resume()
    this.ws = new WebSocket(url)
    await new Promise((r) => { this.ws.onopen = r })
    this.ws.onmessage = (e) => { const j = JSON.parse(String(e.data)); if (j.id) this.waiting.get(j.id)?.(j) }
    // (nothing is required before main.ts's imports are in: a require then breaks their named exports; its first lines
    // add this listener)
    await until(() => this.raw("process.listenerCount('uncaughtException') > 0"), 120000, 100)
    for (let i = 0; i < 600 && !this.origin; i++) {
      this.origin = await this.main(({ BaseWindow }) => { const u = (BaseWindow.getAllWindows()[0] as unknown as Partial<Win>)?.webContents?.getURL() ?? ""; return u.startsWith("http://127.0.0.1") ? new URL(u).origin : "" }).catch(() => "")
      if (!this.origin) await wait(200)
    }
    await until(() => this.app("!!document.querySelector('[role=tree]')"), 120000, 100)
    await this.main(({ app, BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 820 }); app.focus({ steal: true }); w.focus() })
    // (when each page's load started, in the main process: a tab's own part of opening, without the app's)
    await this.main(({ app }) => {
      const g = globalThis as unknown as { __navStart: Record<string, number> }
      g.__navStart = {}
      app.on("web-contents-created", (_e, wc) => wc.on("did-start-navigation", (d) => { if (d.isMainFrame && /^http/.test(d.url)) g.__navStart[d.url] ??= performance.timeOrigin + performance.now() }))
    })
    // (a vault plugin's question at the first launch, "Activity wants to write a recap": Not now)
    void until(() => this.app("(() => { const b = [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Not now'); b?.click(); return !!b })()"), 15000, 200)
    await wait(1500)
    return this
  }

  /** `fn(electron, arg)` in the main process. */
  main<T, A = null>(fn: (e: typeof Electron.CrossProcessExports, arg: A) => T | Promise<T>, a?: A): Promise<T> {
    return this.raw(`(async () => (${fn.toString()})(require("electron"), ${JSON.stringify(a ?? null)}))()`)
  }
  /** A command to the main process's inspector (Profiler.start...). */
  async send<T>(method: string, params: object = {}): Promise<T> {
    const id = ++this.n
    this.ws.send(JSON.stringify({ id, method, params }))
    const j = await new Promise<Reply>((r) => this.waiting.set(id, r))
    this.waiting.delete(id)
    return j.result as T
  }
  async raw<T>(expression: string): Promise<T> {
    const id = ++this.n
    this.ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, includeCommandLineAPI: true, awaitPromise: true, returnByValue: true } }))
    const j = await new Promise<Reply>((r) => this.waiting.set(id, r))
    this.waiting.delete(id)
    if (j.result?.exceptionDetails) throw new Error(j.result.exceptionDetails.exception?.description ?? "failed")
    return j.result?.result?.value as T
  }
  /** `code` in the app's own page. */
  app<T>(code: string) {
    return this.main((e, code) => (e.BaseWindow.getAllWindows()[0] as unknown as Win).webContents.executeJavaScript(code), code) as Promise<T>
  }
  /** `code` in the page at an address starting `url` (null: none yet). */
  page<T>(url: string, code: string) {
    return this.main(({ webContents }, [url, code]) => { const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(url)); return wc ? wc.executeJavaScript(code) : null }, [url, code]) as Promise<T | null>
  }
  ui(body: object) { return fetch(`${this.origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) }
  setting(o: object) { return fetch(`${this.origin}/api/config/plugin/web-viewer`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) }) }
  /** A click in the app's page at its CSS pixels, as the OS would send it (through the main process to the page). */
  click(x: number, y: number) {
    return this.main((e, [x, y]) => {
      const wc = (e.BaseWindow.getAllWindows()[0] as unknown as Win).webContents, z = wc.getZoomFactor()
      const at = { x: Math.round(x * z), y: Math.round(y * z) }
      wc.sendInputEvent({ type: "mouseMove", ...at })
      wc.sendInputEvent({ type: "mouseDown", ...at, button: "left", clickCount: 1 })
      wc.sendInputEvent({ type: "mouseUp", ...at, button: "left", clickCount: 1 })
    }, [x, y])
  }
  async close() {
    await this.main(({ app }) => { setTimeout(() => app.quit(), 10) }).catch(() => {})
    const gone = await Promise.race([new Promise((r) => this.child.once("exit", () => r(true))), wait(15000).then(() => false)])
    try { this.ws.close() } catch { /* gone */ }
    // (its own process group: everything it started, nothing else)
    if (!gone) try { process.kill(-this.child.pid!, "SIGKILL") } catch { /* gone */ }
  }
}

async function until<T>(fn: () => Promise<T>, ms = 20000, every = 20): Promise<T> {
  const end = Date.now() + ms
  for (;;) { let v: T | undefined; try { v = await fn() } catch { v = undefined } if (v || Date.now() > end) return v as T; await wait(every) }
}
type Metrics = Record<string, { cpu: number; mem: number; n: number }>
/** Each kind of process's CPU (ms) and memory (MB): the main process, the GPU, the app's page, the web pages, the rest. */
const metrics = (a: App) => a.main(({ app, BaseWindow, webContents }) => {
  const appPid = (BaseWindow.getAllWindows()[0] as unknown as Win).webContents.getOSProcessId()
  const webPids = new Set(webContents.getAllWebContents().filter((w) => /^https?:/.test(w.getURL()) && w.getOSProcessId() !== appPid).map((w) => w.getOSProcessId()))
  const out: Record<string, { cpu: number; mem: number; n: number }> = {}
  for (const m of app.getAppMetrics()) {
    const k = m.type === "Browser" ? "main" : m.type === "GPU" ? "gpu" : m.pid === appPid ? "app" : webPids.has(m.pid) ? "pages" : m.type === "Tab" ? "otherRenderers" : "other"
    const o = (out[k] ??= { cpu: 0, mem: 0, n: 0 })
    o.cpu += 1000 * (m.cpu.cumulativeCPUUsage ?? 0); o.mem += (m.memory.workingSetSize ?? 0) / 1024; o.n++
  }
  return out
}) as Promise<Metrics>
const cpuDelta = (a: Metrics, b: Metrics) => Object.fromEntries(Object.keys(b).map((k) => [k, Math.round(b[k].cpu - (a[k]?.cpu ?? 0))]))
const pct = (xs: number[], p: number) => { const s = [...xs].filter(Number.isFinite).sort((a, b) => a - b); return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1) : NaN }
const med = (xs: number[]) => pct(xs, 0.5)
const r1 = (x: number) => +x.toFixed(1)

/** Open `url` in a new tab: ms from asking to the page's first paint. */
async function openTab(a: App, url: string) {
  const t0 = now()
  await a.ui({ action: "open", path: `view:web/${url}`, newTab: true })
  const fcp = await until(() => a.page<number>(url, "window.__p && __p.fcp"))
  const start = await a.main((_e, url) => (globalThis as unknown as { __navStart: Record<string, number> }).__navStart[url] ?? 0, url)
  return { total: fcp ? fcp - t0 : NaN, load: fcp && start ? fcp - start : NaN }
}
/** The tab strip's tab whose text has `text`: its centre. */
const tabAt = (a: App, text: string) => a.app<{ x: number; y: number } | null>(`(() => { const t = [...document.querySelectorAll("[data-tab-id]")].find((t) => t.getBoundingClientRect().width > 0 && t.textContent.includes(${JSON.stringify(text)}))
  if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)

const engineInto = (dir: string) => {
  const d = path.join(dir, "userData", "adblock")
  fs.mkdirSync(d, { recursive: true })
  if (fs.existsSync(ENGINE)) fs.copyFileSync(ENGINE, path.join(d, "engine-2.bin"))
  return dir
}

// ---------- the measures ----------

async function measure(a: App) {
  // Shields' engine: waited for once (built from the lists online when none was given), kept for the next run.
  const kept = path.join(a.dir, "userData", "adblock", "engine-2.bin")
  if (!fs.existsSync(ENGINE)) {
    console.log("(building Shields' engine from the lists online, once)")
    await openTab(a, `${SITE}/warm`)
    await until(async () => fs.existsSync(kept), 300000, 500)
    fs.copyFileSync(kept, ENGINE)
  }

  if (want("open")) {
    // The first tab waits for the engine (Ghostery and its kept lists loaded); then the others.
    const first = await openTab(a, `${SITE}/first`)
    const next: { total: number; load: number }[] = []
    for (let i = 0; i < 8; i++) { await wait(2500); next.push(await openTab(a, `${SITE}/open${i}`)) }
    // (total: asked to first paint; load: the page's load starting to its first paint, the browser's own part)
    say("open", { firstMs: r1(first.total), totalMedianMs: med(next.map((x) => x.total)), loadMedianMs: med(next.map((x) => x.load)), load: next.map((x) => r1(x.load)) })
  }

  if (want("nav")) {
    // A page going to another address (as the bar's Enter does): to its load and its first paint.
    await openTab(a, `${SITE}/nav0`)
    const loads: number[] = [], paints: number[] = []
    for (let i = 1; i <= 8; i++) {
      const to = `${SITE}/nav${i}`
      const t0 = now()
      await a.main(({ webContents }, [from, to]) => { void webContents.getAllWebContents().find((w) => w.getURL().startsWith(from))?.loadURL(to) }, [`${SITE}/nav${i - 1}`, to])
      const t = await until(() => a.page<{ load: number; fcp: number }>(to, "performance.getEntriesByType('navigation')[0]?.loadEventEnd > 0 && __p.fcp ? { load: performance.timeOrigin + performance.getEntriesByType('navigation')[0].loadEventEnd, fcp: __p.fcp } : null"), 10000)
      if (t) { loads.push(t.load - t0); paints.push(t.fcp - t0) }
    }
    say("nav", { loadMedianMs: med(loads), paintMedianMs: med(paints), n: loads.length })
  }

  if (want("switch", "hidden")) {
    await openTab(a, `${SITE}/sw-a`)
    await openTab(a, `${SITE}/sw-b`)
    await wait(1000)
    if (want("hidden")) {
      // A background tab's page: hidden (no frames, timers slowed), as in a browser?
      const [f0, s] = (await a.page<[number, string]>(`${SITE}/sw-a`, "[__p.raf, document.visibilityState]")) ?? [0, ""]
      await wait(3000)
      const [f1] = (await a.page<[number]>(`${SITE}/sw-a`, "[__p.raf]")) ?? [0]
      say("hidden", { visibility: s, framesIn3s: f1 - f0 })
    }
    if (want("switch")) {
      // A click on a tab to the first frame its page draws once shown; and the page view's being shown in the window.
      const times: number[] = [], shown: number[] = []
      for (let i = 0; i < 10; i++) {
        const [name, url] = i % 2 ? ["sw-b", `${SITE}/sw-b`] : ["sw-a", `${SITE}/sw-a`]
        const at = await tabAt(a, name)
        if (!at) { times.push(NaN); continue }
        const n = (await a.page<number>(url, "__p.vis.length")) ?? 0
        // (the view's showing, watched in the main process every millisecond)
        const visible = a.main(async ({ BaseWindow, webContents }, url) => {
          const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(url))
          const v = BaseWindow.getAllWindows()[0].contentView.children.find((c) => (c as Electron.WebContentsView).webContents === wc)
          const end = Date.now() + 5000
          while (Date.now() < end) { if (v?.getVisible()) return performance.timeOrigin + performance.now(); await new Promise((r) => setTimeout(r, 1)) }
          return 0
        }, url)
        const t0 = now()
        await a.click(at.x, at.y)
        const v = await until(() => a.page<{ frame: number }>(url, `__p.vis.slice(${n}).find((v) => v.state === "visible" && v.frame) || null`), 5000)
        const vis = await visible
        times.push(v ? v.frame - t0 : NaN)
        shown.push(vis ? vis - t0 : NaN)
        await wait(400)
      }
      say("switch", { toFrameMedianMs: med(times), viewShownMedianMs: med(shown), toFrame: times.map(r1) })
    }
  }

  if (want("heavy", "keys", "chrome", "preload")) {
    const heavy = `${SITE}/heavy`
    await openTab(a, heavy)
    await wait(2000)
    if (want("heavy")) {
      // Scrolling: wheel events at 60 Hz for 4 s, the page's frame intervals, and each process's CPU meanwhile.
      await a.page(heavy, "__p.frames = []; __p.rec = true")
      const m0 = await metrics(a)
      await a.main(async ({ webContents }, url) => {
        const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(url))!
        for (let i = 0; i < 240; i++) { wc.sendInputEvent({ type: "mouseWheel", x: 400, y: 400, deltaX: 0, deltaY: i < 120 ? -40 : 40 }); await new Promise((d) => setTimeout(d, 16)) }
      }, heavy)
      const m1 = await metrics(a)
      const f = (await a.page<number[]>(heavy, "__p.rec = false, __p.frames")) ?? []
      const gaps = f.slice(1).map((t, i) => t - f[i])
      say("scroll", { frames: f.length, p50: pct(gaps, 0.5), p95: pct(gaps, 0.95), over25ms: gaps.filter((g) => g > 25).length, cpu: cpuDelta(m0, m1) })
    }
    if (want("preload")) {
      // What Shields' frame script costs a page that changes all the time: its CPU for 10 s, Shields on, then off.
      const idle = async () => { const m0 = await metrics(a); await wait(10000); return Math.round((await metrics(a)).pages.cpu - m0.pages.cpu) }
      const on = await idle()
      await a.setting({ shields: false }); await wait(1000)
      await a.page(heavy, "location.reload(); 0"); await wait(4000)
      const off = await idle()
      await a.setting({ shields: true }); await wait(1000)
      await a.page(heavy, "location.reload(); 0"); await wait(4000)
      say("heavyPage10s", { shieldsOn: on, shieldsOff: off })
    }
    if (want("keys")) {
      // Keys into the page's search box, sent as the OS's are (through the main process, its key handling, to the page):
      // the event's time to the page's next frame, 40 keys 80 ms apart.
      await a.page(heavy, "document.getElementById('q').focus(); __p.keys = []; 0")
      await a.main(async ({ webContents }, url) => {
        const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(url))!
        wc.focus()
        for (let i = 0; i < 40; i++) { wc.sendInputEvent({ type: "keyDown", keyCode: "a" }); wc.sendInputEvent({ type: "char", keyCode: "a" }); wc.sendInputEvent({ type: "keyUp", keyCode: "a" }); await new Promise((d) => setTimeout(d, 80)) }
      }, heavy)
      await wait(300)
      const k = (await a.page<{ at: number; run: number; frame: number }[]>(heavy, "__p.keys")) ?? []
      say("keys", { n: k.length, inputDelayP50: med(k.map((x) => x.run - x.at)), toFrameP50: med(k.map((x) => x.frame - x.at)), toFrameP95: pct(k.map((x) => x.frame - x.at), 0.95) })
    }
    if (want("chrome")) {
      // The app's own page while a page shows: idle, and while it changes (a toast a second, over the page), profiled.
      await a.app(`window.__muts = {}; new MutationObserver((rs) => { for (const r of rs) { const t = r.target.nodeType === 1 ? r.target : r.target.parentElement
        const k = (t?.closest("[data-web-box]") ? "box" : t?.closest("[data-pane]") ? "pane" : t?.closest("[data-status-bar]") ? "statusbar" : t?.closest("[data-tab-id]") ? "tab" : t?.closest("[data-sonner-toaster]") ? "toast" : (t?.className?.toString?.() || t?.tagName || "?").slice(0, 40)) + " " + r.type + (r.attributeName ? ":" + r.attributeName : "")
        __muts[k] = (__muts[k] ?? 0) + 1 } }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "class", "style", "hidden", "data-dragging", "data-state", "data-visible", "data-removed"] }); 0`)
      const profiled = async (fn: () => Promise<void>) => {
        await a.main(async (e) => { const wc = (e.BaseWindow.getAllWindows()[0] as unknown as Win).webContents; wc.debugger.attach("1.3"); await wc.debugger.sendCommand("Profiler.enable"); await wc.debugger.sendCommand("Profiler.start") })
        const m0 = await metrics(a)
        await fn()
        const m1 = await metrics(a)
        const prof = await a.main(async (e) => { const wc = (e.BaseWindow.getAllWindows()[0] as unknown as Win).webContents; const { profile } = await wc.debugger.sendCommand("Profiler.stop"); wc.debugger.detach(); return profile })
        return { cpu: cpuDelta(m0, m1), top: topFunctions(prof as Profile) }
      }
      const idle = await profiled(async () => { await wait(10000) })
      say("chromeIdle10s", idle.cpu)
      say("chromeIdleTop", idle.top.slice(0, 8))
      say("appMutations10s", await a.app("window.__muts"))
      say("hitTest", await a.app(`(() => { const t = performance.now(); let n = 0; for (let i = 0; i < 200; i++) { document.elementFromPoint(300 + (i % 20) * 30, 200 + (i / 20 | 0) * 40); n++ }
        const per = (performance.now() - t) / n; const t2 = performance.now(); for (let i = 0; i < 200; i++) document.elementFromPoint(20, 20); return { perMs: +per.toFixed(3), samePointMs: +((performance.now() - t2) / 200).toFixed(3), nodes: document.getElementsByTagName("*").length, iframes: document.querySelectorAll("iframe").length } })()`))
      const toasts = await profiled(async () => { for (let i = 0; i < 10; i++) { await a.ui({ action: "notify", text: `Toast ${i}` }); await wait(1000) } })
      say("chromeToasts10s", toasts.cpu)
      say("chromeToastsTop", toasts.top.slice(0, 8))
    }
  }

  if (want("ads")) {
    // Shields' cost: the main process's CPU loading a page of 600 requests, Shields on and off.
    const run = async (label: string) => {
      const url = `${SITE}/ads?n=600&${label}`
      const m0 = await metrics(a)
      await openTab(a, url)
      await until(() => a.page<boolean>(url, "document.readyState === 'complete'"))
      await wait(500)
      const m1 = await metrics(a)
      return { main: Math.round(m1.main.cpu - m0.main.cpu), loaded: await a.page<number>(url, "performance.getEntriesByType('resource').length") }
    }
    const cold = await run("cold")
    await run("warm1")
    await a.send("Profiler.enable"); await a.send("Profiler.start")
    const on = await run("on")
    const { profile } = await a.send<{ profile: Profile }>("Profiler.stop")
    say("adsMainTop", topFunctions(profile).slice(0, 14))
    await a.setting({ shields: false }); await wait(1000)
    const off = await run("off")
    // (no request hooks at all, for what Electron's webRequest costs by itself)
    const hooks = await a.main(({ session }) => { const s = session.fromPartition("persist:web"); const wr = s.webRequest as unknown as Record<string, (f: null) => void>; for (const ev of ["onBeforeRequest", "onBeforeSendHeaders", "onHeadersReceived", "onSendHeaders", "onResponseStarted", "onCompleted", "onErrorOccurred", "onBeforeRedirect"]) wr[ev](null); return true })
    const none = hooks ? await run("none") : null
    await a.setting({ shields: true }); await wait(1000)
    say("ads600", { shieldsCold: cold.main, shieldsOn: on.main, shieldsOff: off.main, noHooks: none?.main })
  }

  if (want("idle", "memory")) {
    // Ten tabs (one ticking, one heavy), all but the last in the background, a minute idle.
    for (let i = 0; i < 8; i++) await openTab(a, `${SITE}/idle${i}`)
    await openTab(a, `${SITE}/clock`)
    await openTab(a, `${SITE}/heavy?2`)
    await wait(5000)
    if (want("idle")) { const m0 = await metrics(a); await wait(60000); const m1 = await metrics(a); say("idle60s", cpuDelta(m0, m1)) }
    if (want("memory")) {
      const m = await metrics(a)
      say("memory", { pagesMB: Math.round(m.pages?.mem ?? 0), pageProcesses: m.pages?.n, perPageMB: Math.round((m.pages?.mem ?? 0) / Math.max(1, m.pages?.n ?? 1)),
        mainMB: Math.round(m.main.mem), appMB: Math.round(m.app?.mem ?? 0), gpuMB: Math.round(m.gpu?.mem ?? 0) })
    }
  }

  if (REAL && want("real")) {
    const real: Record<string, unknown> = {}
    for (const url of ["https://www.youtube.com/", "https://en.wikipedia.org/wiki/Lighthouse", "https://www.theverge.com/"]) {
      const m0 = await metrics(a), t0 = now()
      await a.ui({ action: "open", path: `view:web/${url}`, newTab: true })
      const load = await until(() => a.page<number>(url, "performance.getEntriesByType('navigation')[0]?.loadEventEnd > 0 ? performance.timeOrigin + performance.getEntriesByType('navigation')[0].loadEventEnd : 0"), 30000)
      await wait(3000)
      real[url] = { loadMs: load ? Math.round(load - t0) : null, cpu: cpuDelta(m0, await metrics(a)) }
    }
    say("real", real)
  }
}

async function restore() {
  // Fifteen tabs, the app closed and opened again: the shown tab's first paint, how many pages were made, their cost.
  const dir = engineInto(path.join(tmp, "b"))
  const a = await new App(dir).launch()
  try { for (let i = 0; i < 15; i++) await openTab(a, `${SITE}/r${i}`); await wait(3000) } finally { await a.close() }
  const b = await new App(dir).launch()
  const ready = now()
  try {
    const shown = await until(() => b.main(({ webContents }) => webContents.getAllWebContents().find((w) => /\/r\d+$/.test(w.getURL()))?.getURL() ?? ""))
    const fcp = shown ? await until(() => b.page<number>(shown, "window.__p && __p.fcp")) : 0
    const m0 = await metrics(b)
    await wait(8000)
    const m1 = await metrics(b)
    const made = await b.main(({ webContents }) => webContents.getAllWebContents().filter((w) => /\/r\d+$/.test(w.getURL())).length)
    say("restore", { toFirstPaintMs: fcp ? Math.round(fcp - b.t0) : null, appReadyMs: Math.round(ready - b.t0), pagesMade: made, cpuNext8s: cpuDelta(m0, m1), pagesMB: Math.round(m1.pages?.mem ?? 0) })
  } finally { await b.close() }
}

type Profile = { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number }; children?: number[] }[]; samples: number[]; timeDeltas: number[] }
/** The functions the app's page spent the most time in (self time, ms). */
function topFunctions(p: Profile) {
  const self = new Map<number, number>()
  p.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (p.timeDeltas[i] ?? 0) / 1000))
  const by = new Map<string, number>()
  for (const n of p.nodes) {
    const name = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`
    if (/^\((idle|program|root)\)/.test(name)) continue
    by.set(name, (by.get(name) ?? 0) + (self.get(n.id) ?? 0))
  }
  // (and who called the costliest, two frames up)
  const parent = new Map<number, number>()
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
  const node = new Map(p.nodes.map((n) => [n.id, n]))
  const top = [...by].sort((a, b) => b[1] - a[1])
  const callers = new Map<string, number>()
  for (const n of p.nodes) {
    if (`${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}` !== top[0]?.[0]) continue
    const up = [parent.get(n.id), parent.get(parent.get(n.id) ?? -1)].map((i) => node.get(i ?? -1)?.callFrame).map((c) => c ? `${c.functionName || "(anon)"} ${c.url.split("/").pop()}:${c.lineNumber}:${c.columnNumber}` : "").join(" < ")
    callers.set(up, (callers.get(up) ?? 0) + (self.get(n.id) ?? 0))
  }
  return [...top.slice(0, 15).map(([k, v]) => `${k}: ${v.toFixed(1)}`), ...[...callers].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `  called by ${k}: ${v.toFixed(1)}`)]
}

/** Shields' engine on its own (Node, no Electron): load time and the cost of matching a request. */
function blockerBench() {
  const code = `
    const { FiltersEngine, Request } = await import("@ghostery/adblocker")
    const fs = await import("node:fs")
    const bytes = fs.readFileSync(${JSON.stringify(ENGINE)})
    let t = performance.now(); const e = FiltersEngine.deserialize(new Uint8Array(bytes)); const load = performance.now() - t
    const urls = []
    for (let i = 0; i < 5000; i++) urls.push(["https://www.example.com/static/app" + i + ".js", "https://cdn.site" + (i % 50) + ".com/img/" + i + ".png", "https://securepubads.g.doubleclick.net/tag/js/gpt.js?i=" + i, "https://www.google-analytics.com/collect?v=1&i=" + i][i % 4])
    t = performance.now(); let hits = 0
    for (const u of urls) { const r = Request.fromRawDetails({ url: u, type: "script", sourceUrl: "https://www.example.com/" }); if (e.match(r).match) hits++ }
    const per = (performance.now() - t) / urls.length
    t = performance.now(); for (let i = 0; i < 200; i++) e.getCosmeticsFilters({ url: "https://www.youtube.com/watch?v=" + i, hostname: "www.youtube.com", domain: "youtube.com", getBaseRules: true, getInjectionRules: true, getRulesFromHostname: true, getRulesFromDOM: false, getExtendedRules: true })
    const cosmetic = (performance.now() - t) / 200
    console.log(JSON.stringify({ engineMB: +(bytes.length / 1048576).toFixed(1), loadMs: +load.toFixed(1), perRequestUs: +(per * 1000).toFixed(1), blocked: hits + "/" + urls.length, frameRulesMs: +cosmetic.toFixed(2) }))`
  try { return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").pop()!) }
  catch (e) { return { error: String(e).slice(0, 300) } }
}

const awake = process.platform === "darwin" ? spawn("caffeinate", ["-u", "-d", "-t", "1800"], { stdio: "ignore" }) : null
try {
  if (want("open", "nav", "switch", "hidden", "heavy", "preload", "keys", "chrome", "ads", "idle", "memory", "real")) {
    const a = await new App(engineInto(path.join(tmp, "a"))).launch()
    try { await measure(a) } finally { await a.close() }
  }
  if (want("restore")) await restore()
  if (want("blocker")) say("blocker", blockerBench())
} finally {
  awake?.kill()
  server.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2))
process.exit(0)
