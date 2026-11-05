// The window's page stays over the browser's pages while it's raised (a tooltip, a toast, a menu over one), however a
// page comes back: an agent's page opened as a tab (and taken over: held, its tab shows a picture) is parked while its
// tab is hidden and put back among the window's views as it's shown again. Put over the window, it took the clicks
// meant for what the app drew there (a slid-in sidebar). A page split beside it, with a float over it, keeps the window
// raised meanwhile. A page leaving full screen while the window stays raised goes back under it (it stayed over it, so a
// sidebar peeking over it was drawn under it), and a sidebar shown beside pages slides over them, never under.
// WRITES: the throwaway vault only.
//   node web/qa/pageorder.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, keepAwake, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-pageorder-"))
const site = http.createServer((q, r) => { r.writeHead(200, { "Content-Type": "text/html" }); r.end(`<!doctype html><title>${q.url === "/b" ? "Beacon" : "Lighthouse"}</title><body style='margin:0;height:100vh;background:#cde'>Site`) })
await new Promise((ok) => site.listen(0, "127.0.0.1", ok))
const SITE = `http://127.0.0.1:${site.address().port}/`
fs.writeFileSync(path.join(VAULT, "Alice Park.md"), "Notes on Alice.\n")
// (no rails: a hidden sidebar peeks at the window's edge)
const LOOK = path.join(VAULT, ".vaultite/appearance.json")
fs.mkdirSync(path.dirname(LOOK), { recursive: true })
fs.writeFileSync(LOOK, JSON.stringify({ ...(fs.existsSync(LOOK) ? JSON.parse(fs.readFileSync(LOOK, "utf8")) : {}), rails: false }))
// (the sidebar's slide is recorded frame by frame: a display asleep draws none)
keepAwake(300)

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
try {
  const win = await app.firstWindow()
  watch(win, { console: true, fail: false })
  await win.waitForSelector("main", { timeout: 60000 })
  const origin = new URL(win.url()).origin
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width: 1280, height: 800 }))
  await wait(2000) // (the app tells the desktop app what agents may do as it starts)
  const op = async (id, params) => {
    const r = await fetch(`${origin}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "mcp", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params ?? {}) })
    const j = await r.json().catch(() => ({}))
    return j.result ?? j
  }
  /** The window's views bottom to top: "app" for its own page, "page" for each shown page (parked ones left out). */
  const order = () => app.evaluate(({ BaseWindow }) => {
    const w = BaseWindow.getAllWindows()[0], own = w.contentView.children.find((v) => v.webContents === w.webContents)
    return w.contentView.children.filter((v) => v === own || (v.getVisible() && v.getBounds().x > -1000)).map((v) => (v === own ? "app" : "page")).join(" ")
  })
  const raised = () => win.evaluate(() => "overPages" in document.documentElement.dataset)
  const tab = (name) => win.locator("[data-tab-id]", { hasText: name }).first()

  // The agent's page as a tab, taken over (so placed in it), and a note's tab beside it.
  const T = (await op("web-viewer.open", { url: `${SITE}b`, task: "order status" }))?.tab
  check("an agent opens a page in the background", typeof T === "number", T)
  await win.locator("[data-agent-open]").click()
  check("Open as tab: a tab shows it", await until(async () => (await win.locator(`[data-web-page="${T}"]`).count()) === 1, 8000), await order())
  await win.locator(`[data-web-page="${T}"] [data-web-agent-take]`).click()
  check("taken over, it's placed in its tab", await until(async () => (await order()) === "app page", 8000), await order())
  await op("ui.open", { path: "Alice Park.md", newTab: true })
  await tab("Beacon").click()
  // Another page split beside it (a tab holds both), with a float (as a tooltip is, layers.ts) over it: the window stays
  // raised. (the toasts saying the agent opened these sit over the new pane, raising the window till they leave: an
  // action's lasts 8 s, and the pointer kept off them so they don't pause)
  await op("ui.open", { path: SITE, split: "right" })
  await win.mouse.move(300, 400)
  check("a page split beside it", await until(async () => (await order()) === "app page page", 15000), await order())
  await win.evaluate(() => {
    const d = Object.assign(document.createElement("div"), { id: "qa-float" })
    d.dataset.floats = ""
    d.style.cssText = "position:fixed;right:60px;top:50%;width:200px;height:40px;background:#333;pointer-events:none"
    document.body.append(d)
  })
  check("a float over it raises the window", await until(async () => (await raised()) && (await order()) === "page page app", 3000), await order())

  for (const round of [1, 2]) {
    await tab("Alice Park").click()
    check(`${round}: the note's tab picked, both pages out of sight`, await until(async () => (await order()) === "app", 5000), await order())
    await tab("Beacon").click()
    check(`${round}: its tab picked again, they show under the raised window`,
      await until(async () => (await win.locator(`[data-web-page="${T}"]`).isVisible()) && (await order()).split(" ").length === 3, 5000) && (await order()) === "page page app", await order())
    await wait(300)
    check(`${round}: … and stay there`, (await raised()) && (await order()) === "page page app", await order())
  }
  await win.evaluate(() => document.getElementById("qa-float").remove())
  // (once the toasts opening them left too)
  check("nothing over them: the pages over the window again", await until(async () => !(await raised()) && (await order()) === "app page page", 15000), await order())

  // Full screen and back with the window raised all along (a float over the pages).
  const B = `${SITE}b`
  /** Page `url`'s view against the window's own page: over it, filling the window, where it is. */
  const where = (url) => app.evaluate(({ BaseWindow }, url) => {
    const w = BaseWindow.getAllWindows()[0], kids = w.contentView.children, [width, height] = w.getContentSize()
    const own = kids.findIndex((v) => v.webContents === w.webContents), at = kids.findIndex((v, i) => i !== own && v.webContents?.getURL() === url)
    const b = at >= 0 ? kids[at].getBounds() : null
    return { over: at > own, fills: !!b && b.x === 0 && b.y === 0 && b.width === width && b.height === height, x: b?.x, width: b?.width }
  }, url)
  const inPage = (url, code) => app.evaluate(({ webContents }, [url, code]) => webContents.getAllWebContents().find((c) => c.getURL() === url)?.executeJavaScript(code, true), [url, code])
  const peekOf = () => win.evaluate(() => document.querySelector("aside[data-side=left]")?.dataset.peek)
  await win.click("[data-sidebar-toggle='']")
  check("the left sidebar hidden", await until(async () => (await peekOf()) === "false" && (await where(B)).x <= 16, 5000), [await peekOf(), await where(B)])
  await win.evaluate(() => {
    const d = Object.assign(document.createElement("div"), { id: "qa-float" })
    d.dataset.floats = ""
    d.style.cssText = "position:fixed;right:60px;top:50%;width:200px;height:40px;background:#333;pointer-events:none"
    document.body.append(d)
  })
  check("a float raises the window again", await until(async () => (await raised()) && (await order()) === "page page app", 15000), await order())
  await inPage(B, "document.documentElement.requestFullscreen().then(() => true)")
  check("a page in full screen: over the window's page, filling it", await until(async () => { const w = await where(B); return w.over && w.fills }, 5000), await where(B))
  await inPage(B, "document.exitFullscreen().then(() => true)")
  check("out of full screen: back in its pane", await until(async () => !(await where(B)).fills, 5000), await where(B))
  check("… under the window's page again, still raised", await until(async () => (await raised()) && (await order()) === "page page app", 3000), await order())
  await wait(300)
  check("… and staying there", (await raised()) && (await order()) === "page page app", await order())
  // A sidebar peeking over it: drawn over it.
  const edge = (x) => app.evaluate(({ BaseWindow }, [url, x]) => {
    const w = BaseWindow.getAllWindows()[0], v = w.contentView.children.find((c) => c.webContents !== w.webContents && c.webContents?.getURL() === url)
    v.webContents.sendInputEvent({ type: "mouseMove", x: x - v.getBounds().x, y: 300 })
  }, [B, x])
  for (const x of [40, 10, 4, 1]) await edge(x)
  await win.mouse.move(1, 400)
  check("the left sidebar peeks over the page", await until(async () => (await peekOf()) === "true", 3000), await peekOf())
  await wait(400)
  check("… over it: the window's page over the page's", (await raised()) && !(await where(B)).over && (await order()) === "page page app", [await order(), await where(B)])
  await win.mouse.move(640, 400, { steps: 10 })
  check("the pointer away, it slides out", await until(async () => (await peekOf()) === "false", 3000), await peekOf())
  await win.evaluate(() => document.getElementById("qa-float").remove())
  check("nothing over the pages: over the window again", await until(async () => !(await raised()) && (await order()) === "app page page", 15000), await order())

  // The left sidebar shown again (a shortcut, no peek first): its pane slides over to make room, the page standing in a
  // picture of itself. Till it's gone, the page's view is under the window's: the sidebar is drawn over it, not under.
  await Promise.all([
    win.evaluate(() => {
      // (whether the sidebar is drawn over where the page was, its left)
      const log = window.qaFrames = [], aside = document.querySelector("aside[data-side=left]")
      const frame = () => { log.push({ t: Date.now(), on: aside.contains(document.elementFromPoint(20, 300)) }); if (window.qaFrames === log) requestAnimationFrame(frame) }
      requestAnimationFrame(frame)
    }),
    app.evaluate(({ BaseWindow }, url) => {
      const w = BaseWindow.getAllWindows()[0], log = globalThis.qaOrder = []
      globalThis.qaTimer = setInterval(() => {
        const kids = w.contentView.children, own = kids.findIndex((v) => v.webContents === w.webContents)
        const at = kids.findIndex((v, i) => i !== own && v.webContents?.getURL() === url), v = kids[at], b = v?.getBounds()
        log.push({ t: Date.now(), up: at > own, shown: !!v && v.getVisible() && b.x > -1000, x: b?.x ?? 0 })
      }, 3)
    }, B),
  ])
  // (as its command does: the toggle rides off the window with the sidebar hidden)
  await win.evaluate(() => document.querySelector("[data-sidebar-toggle='']").click())
  check("the left sidebar shown", await until(async () => (await where(B)).x > 100, 5000), await where(B))
  await wait(800)
  const frames = await win.evaluate(() => { const f = window.qaFrames; window.qaFrames = null; return f })
  const views = await app.evaluate(() => { clearInterval(globalThis.qaTimer); return globalThis.qaOrder })
  const on = frames.filter((f) => f.on)
  check("the sidebar drawn where the page was", on.length >= 3, { frames: frames.length, on: on.length })
  // (the main process a couple of frames behind the window's page)
  const under = on.filter((f) => views.some((v) => v.t >= f.t + 34 && v.t <= f.t + 50 && v.up && v.shown && v.x < 20))
  check("… never under the page's view", on.length > 0 && !under.length, under.slice(0, 3))
} finally {
  await app.close()
  site.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
