// The sidebars moving beside and over a web page in the desktop app: a pinned one opening and closing (the panes are
// laid out once and slide there, core/panemotion.ts; the page's picture slides in its place, WebPage.tsx), a hidden one
// sliding in and out over it (core/peek.ts). Per motion: frames presented and dropped (Chromium's frame reporter), the
// app's layout time, and how often the page was moved. HEAVY=<n> adds n spans to a pane, as a well-used vault's page.
// WRITES: the throwaway vault only.
//   node web/qa/sidebarmotion.mjs <vault copy> [runs]
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, apiAt, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT, RUNS = "3"], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-sidebarmotion-"))
// (a window on a sleeping display draws no frames)
const awake = (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "600"], { stdio: "ignore" })
process.on("exit", () => awake.kill())

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(`<!doctype html><title>Field notes</title><body style="margin:0;font:15px system-ui;background:#fafaf8;color:#222">
    <aside style="position:fixed;inset:0 auto 0 0;width:260px;background:#f0efe9">Sections</aside><main style="margin-left:280px">
    ${Array.from({ length: 200 }, (_, i) => `<p>Line ${i}: tomatoes along the fence, basil between them, where it's sunny.</p>`).join("")}</main></body>`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const SITE = `http://127.0.0.1:${server.address().port}`
fs.mkdirSync(path.join(VAULT, ".vaultite"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite/appearance.json"), JSON.stringify({ rails: false, animation: "natural", tabBar: false, paneTitles: false,
  peekShade: true, dimPanes: true, fileBarFade: "always", density: "compact" }))
fs.writeFileSync(path.join(VAULT, ".vaultite/sidebars.json"), JSON.stringify({ left: ["search:search", "pages:pages", "tabs:tabs", "files:files"],
  right: ["terminal:sessions", "web-viewer:web-pages"], collapsed: [] }))

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const W = 1440, H = 900
try {
  const win = await app.firstWindow()
  watch(win, { console: true, fail: false })
  await win.waitForSelector("aside[data-side=right]", { timeout: 60000 })
  await app.evaluate(({ BaseWindow }, [width, height]) => BaseWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width, height }), [W, H])
  const user = apiAt(`${new URL(win.url()).origin}/`, { "X-Vaultite-Client": "cli" })
  await user("POST", "ops/ui.open", { path: `${SITE}/notes` })
  const note = fs.readdirSync(path.join(VAULT, "Notes")).find((f) => f.endsWith(".md"))
  await user("POST", "ops/ui.open", { path: `Notes/${note}`, split: "right" })
  const pageView = () => app.evaluate(({ BaseWindow }) => {
    const w = BaseWindow.getAllWindows()[0], v = w.contentView.children.find((c) => c.webContents && c !== w.view && c.getVisible())
    return v?.getBounds() ?? null
  })
  check("the web page is shown", await until(pageView, 20000), await pageView())
  // (the shell's first moves are still: main.tsx' data-arriving)
  await until(() => win.evaluate(() => !("arriving" in document.body.dataset)), 10000)
  if (process.env.HEAVY) await win.evaluate((n) => {
    const at = [...document.querySelectorAll("section[data-group] [data-pane-body]")].at(-1), box = document.createElement("div")
    box.style.cssText = "position: absolute; inset: 0; overflow: hidden; pointer-events: none; opacity: 0.02"
    box.innerHTML = Array.from({ length: n }, (_, i) => `<span>Lettuce ${i} along the fence </span>`).join("")
    at.append(box)
  }, +process.env.HEAVY)
  // The page's moves (the window's own page's aren't counted).
  await app.evaluate(({ BaseWindow, WebContentsView }) => {
    const w = BaseWindow.getAllWindows()[0], f = WebContentsView.prototype.setBounds
    globalThis.__moves = 0
    WebContentsView.prototype.setBounds = function (...a) { if (this !== w.view) globalThis.__moves++; return f.apply(this, a) }
  })
  const cdp = await win.context().newCDPSession(win)
  await cdp.send("Performance.enable")
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]))
  /** One motion `go` makes: from the first frame that moves something (the compositor's first), a spring's length. */
  const measure = async (go) => {
    await app.evaluate(() => { globalThis.__moves = 0 })
    const before = await metrics(), events = []
    const collect = (e) => events.push(...e.value)
    cdp.on("Tracing.dataCollected", collect)
    const finished = new Promise((r) => cdp.once("Tracing.tracingComplete", r))
    await cdp.send("Tracing.start", { traceConfig: { includedCategories: ["benchmark", "blink.user_timing"] }, transferMode: "ReportEvents" })
    await win.evaluate(() => performance.mark("motion-go"))
    await go()
    await wait(900)
    await cdp.send("Tracing.end"); await finished
    cdp.off("Tracing.dataCollected", collect)
    const fr = events.filter((e) => e.name === "PipelineReporter" && e.ph === "b").map((e) => ({ t: e.ts / 1000, s: e.args.frame_reporter.state,
      anim: e.args.frame_reporter.has_compositor_animation || e.args.frame_reporter.has_main_animation, comp: e.args.frame_reporter.has_compositor_animation }))
      .sort((a, b) => a.t - b.t)
    const asked = events.find((e) => e.name === "motion-go")?.ts / 1000
    const first = fr.find((f) => f.t >= asked && f.anim)?.t ?? NaN, t0 = fr.find((f) => f.t >= asked && f.comp && f.t < first + 600)?.t ?? first
    const run = fr.filter((f) => f.t >= t0 - 1 && f.t <= t0 + 296)
    // (a frame is reported once for each of its sources: counted once)
    const once = (fs) => new Set(fs.map((f) => Math.round(f.t / 4))).size
    return { wait: Math.round(t0 - asked), presented: once(run.filter((f) => f.s === "STATE_PRESENTED_ALL" || f.s === "STATE_PRESENTED_PARTIAL")),
      dropped: once(run.filter((f) => f.s === "STATE_DROPPED")), layout: Math.round(((await metrics()).LayoutDuration - before.LayoutDuration) * 1000),
      moves: await app.evaluate(() => globalThis.__moves) }
  }
  /** Once still: the page over its box, and no picture of it left there. */
  const settled = async (name) => {
    await wait(300)
    const [v, box] = [await pageView(), await win.evaluate(() => {
      const r = document.querySelector("[data-web-box]").getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), pictures: document.querySelectorAll("[data-web-box] > img").length }
    })]
    check(`${name}: the page is back over its box, its picture gone`, !!v && Math.abs(v.x - box.x) <= 1 && Math.abs(v.width - box.width) <= 1 && !box.pictures, { v, box })
  }
  const results = {}
  const add = (name, r) => (results[name] ??= []).push(r)
  const peekOf = () => win.evaluate(() => document.querySelector("aside[data-side=left]")?.dataset.peek)
  const toggle = (side) => win.evaluate((s) => document.querySelector(s).click(), side === "left" ? "[data-sidebar-toggle='']" : "[data-sidebar-toggle=right]")
  for (let i = 0; i < +RUNS; i++) {
    if ((await peekOf()) === undefined) { await toggle("left"); await wait(800) }
    await win.mouse.move(W / 2, H / 2); await wait(600)
    for (const [name, side] of [["right closes", "right"], ["right opens", "right"], ["left opens", "left"], ["left closes", "left"]]) {
      add(name, await measure(() => toggle(side)))
      if (!i) await settled(name)
    }
    await win.mouse.move(W / 2, H / 2); await wait(600)
    check(`run ${i}: the left sidebar is hidden`, (await peekOf()) === "false", await peekOf())
    add("peek in", await measure(async () => { await win.mouse.move(2, H / 2, { steps: 3 }); await until(async () => (await peekOf()) === "true", 2000) }))
    // (it waits a moment once the pointer has gone, core/peek.ts LINGER: its frames are found within 600ms)
    add("peek out", await measure(() => win.mouse.move(W / 2, H / 2, { steps: 3 })))
  }
  for (const [name, xs] of Object.entries(results)) {
    const med = (k) => { const v = xs.map((x) => x[k]).sort((p, q) => p - q); return v[v.length >> 1] }
    console.log(`${name.padEnd(12)} starts after ${med("wait")}ms; ${med("presented")} frames in 295ms, ${med("dropped")} dropped; layout ${med("layout")}ms; page moved ${med("moves")}x`)
  }
} finally {
  await app.close()
  server.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
