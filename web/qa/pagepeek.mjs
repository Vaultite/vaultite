// Zen's sidebars over a browser tab in the desktop app: its page is a native view the window doesn't hear, yet the
// pointer at an edge slides the sidebar in (moves sent with sendInputEvent), and the window is over the page for all of its
// slide, in and out, not only once it stopped (the part over the page slid under it). Writes the throwaway vault only.
//   node web/qa/pagepeek.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-pagepeek-"))
const awake = process.platform !== "darwin" ? null
  : (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "600"], { stdio: "ignore" })
process.on("exit", () => awake?.kill())

const server = http.createServer((_q, r) => { r.writeHead(200, { "Content-Type": "text/html" }); r.end("<!doctype html><title>Site</title><body style='margin:0;height:100vh;background:#cde'>Site") })
await new Promise((ok) => server.listen(0, "127.0.0.1", ok))
const SITE = `http://127.0.0.1:${server.address().port}/`

fs.mkdirSync(path.join(VAULT, ".vaultite"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite/appearance.json"), JSON.stringify({ rails: false, tabBar: false }))
fs.writeFileSync(path.join(VAULT, ".vaultite/sidebars.json"), JSON.stringify({ left: ["pages:pages"], right: ["files:files"], collapsed: [] }))

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
try {
  const win = await app.firstWindow()
  watch(win, { console: true, fail: false })
  await win.waitForSelector("aside[data-side=right]", { timeout: 60000 })
  const origin = new URL(win.url()).origin
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus() })
  await fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "open", path: `view:web/${SITE}` }) })
  for (const t of ["[data-sidebar-toggle='']", "[data-sidebar-toggle=right]"]) await win.click(t)
  await win.mouse.move(640, 400)

  /** The page's view (window points), and the window's width. */
  const view = () => app.evaluate(({ BaseWindow }) => {
    const w = BaseWindow.getAllWindows()[0], v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
    return v ? { ...v.getBounds(), url: v.webContents.getURL(), window: w.getContentSize()[0] } : null
  })
  const placed = await until(async () => { const v = await view(); return v?.url === SITE && v.x <= 1 && v.x + v.width >= v.window - 1 && v }, 20000)
  check("the page fills the window's width, both sidebars hidden", !!placed, await view())
  /** A move over the page at window point `x`, as the Mac sends it. */
  const over = (x) => app.evaluate(({ BaseWindow }, x) => {
    const w = BaseWindow.getAllWindows()[0], v = w.contentView.children.find((c) => c.webContents && c.webContents !== w.webContents && c.getVisible())
    v.webContents.sendInputEvent({ type: "mouseMove", x: x - v.getBounds().x, y: 300 })
  }, x)
  const peekOf = (side) => win.evaluate((side) => document.querySelector(`aside[data-side=${side}]`).dataset.peek, side)
  const width = (await view()).window
  /** Every frame of the window's page (the sidebar's edges, whether it's raised) and the main process's order every few
   *  ms (whether the window's page is over the page's view), on one clock, till `recorded`. */
  const record = (side) => Promise.all([
    win.evaluate((side) => {
      const log = window.qaFrames = [], aside = document.querySelector(`aside[data-side=${side}]`)
      const frame = () => {
        const b = aside.getBoundingClientRect()
        log.push({ t: Date.now(), left: b.left, right: b.right, over: "overPages" in document.documentElement.dataset })
        if (window.qaFrames === log) requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    }, side),
    app.evaluate(({ BaseWindow }) => {
      const w = BaseWindow.getAllWindows()[0], log = globalThis.qaOrder = []
      clearInterval(globalThis.qaTimer)
      globalThis.qaTimer = setInterval(() => {
        const kids = w.contentView.children, own = kids.findIndex((v) => v.webContents === w.webContents)
        const page = kids.findIndex((v) => v.webContents && v.webContents !== w.webContents && v.getVisible() && v.getBounds().x > -1000)
        log.push({ t: Date.now(), up: page >= 0 && own > page })
      }, 3)
    }),
  ])
  const recorded = async () => {
    const frames = await win.evaluate(() => { const f = window.qaFrames; window.qaFrames = null; return f })
    const order = await app.evaluate(() => { clearInterval(globalThis.qaTimer); return globalThis.qaOrder })
    return { frames, order }
  }
  /** Over the page (the whole window's width here) by more than its edge's few pixels. */
  const covers = (f) => f.right > 8 && f.left < width - 8
  // The sidebar mid-slide over the page: the window raised in that frame, and in the main process by the next frames
  // (sent on as it starts); slid out, it drops under the page only once nothing of it covers the page.
  const slid = (side, way, { frames, order }) => {
    if (process.env.QA_DEBUG) console.log(side, way, JSON.stringify(frames.map((f) => [f.t % 100000, Math.round(f.left), f.over])), JSON.stringify(order.filter((o, i) => !i || o.up !== order[i - 1].up).map((o) => [o.t % 100000, o.up])))
    const on = frames.filter(covers)
    const mid = frames.filter((f, i) => covers(f) && i > 0 && frames[i - 1].left !== f.left)
    check(`${side} ${way}: it was seen sliding over the page`, mid.length >= 3, { frames: frames.length, mid: mid.length })
    const bare = mid.filter((f) => !f.over)
    check(`${side} ${way}: the window's page is raised in every frame it slides over the page`, !bare.length && mid.length > 0, bare.slice(0, 3))
    const late = mid.filter((f) => { const s = order.filter((o) => o.t >= f.t + 34)[0]; return s && !s.up })
    check(`${side} ${way}: … and over the page's view in the main process meanwhile`, !late.length && mid.length > 0, late.slice(0, 3))
    if (way === "out") {
      const last = on.at(-1)?.t ?? 0, down = order.find((o, i) => i > 0 && order[i - 1].up && !o.up)
      check(`${side} out: under the page again only once it's slid out`, !!down && down.t >= last, { last, down })
    }
  }
  for (const side of ["left", "right"]) {
    for (const x of [width / 2, width / 2 + 5]) await over(x)
    await wait(400)
    check(`${side}: in the middle of the page, still hidden`, (await peekOf(side)) === "false", await peekOf(side))
    // (once nothing else is over the page: the toasts and tooltips of opening it)
    check(`${side}: nothing over the page, the window under it`, await until(() => win.evaluate(() => !("overPages" in document.documentElement.dataset)), 15000))
    await record(side)
    const edge = side === "left" ? 1 : width - 1
    for (const x of side === "left" ? [40, 10, 4, edge] : [width - 40, width - 10, width - 2, edge]) await over(x)
    check(`${side}: at the window's edge over the page, it slides in`, await until(async () => (await peekOf(side)) === "true", 3000), await peekOf(side))
    await wait(400)
    slid(side, "in", await recorded())
    await record(side)
    await win.mouse.move(side === "left" ? 1 : width - 1, 400)
    await win.mouse.move(640, 400, { steps: 10 })
    check(`${side}: away from it, it slides out`, await until(async () => (await peekOf(side)) === "false", 3000), await peekOf(side))
    await wait(400)
    slid(side, "out", await recorded())
  }
  console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
} finally {
  await app.close()
  server.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
