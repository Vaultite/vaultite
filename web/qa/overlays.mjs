// What the app draws over a page in the desktop app's Browser (the mini player, a sidebar peeking, a floating pane)
// takes only its own clicks: the page gets the rest, with its cursor, a press dragged out over the overlay let go in
// the page, and a popup it opens not blocked. A menu over it takes every click there. The Browser's tabs outlive a
// quit, as a browser's do. WRITES: throwaway vault.
//   node web/qa/overlays.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-overlays-"))

// The page counts its clicks, presses and lets go; a link for its cursor; a button opening a popup (a new tab).
const server = http.createServer((q, r) => {
  r.writeHead(200, { "Content-Type": "text/html" })
  if (q.url === "/popup") return r.end("<!doctype html><title>Popup</title><body>popup")
  r.end(`<!doctype html><title>Site</title><body style="margin:0;background:#cde">
    <button id=own style="position:absolute;left:20px;top:20px;width:200px;height:60px" onclick="own.dataset.n = +(own.dataset.n || 0) + 1">own</button>
    <a id=link href="#x" style="position:absolute;left:20px;top:120px;width:200px;height:40px;display:block">link</a>
    <button id=pop style="position:absolute;left:20px;top:200px;width:200px;height:40px" onclick="window.open('/popup')">pop</button>
    <script>window.ups = 0; addEventListener("mouseup", () => window.ups++)</script>`)
})
await new Promise((ok) => server.listen(0, "127.0.0.1", ok))
const SITE = `http://127.0.0.1:${server.address().port}/`
const env = { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") }
const launch = () => _electron.launch({ executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT], env })

let app = await launch()
try {
  let win = await app.firstWindow()
  watch(win, { console: true, fail: false })
  await win.waitForSelector("aside[data-side=right], main", { timeout: 60000 })
  const origin = new URL(win.url()).origin
  await app.evaluate(({ BaseWindow }) => { BaseWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width: 1280, height: 800 }) })
  await fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "open", path: `view:web/${SITE}` }) })

  /** The shown page's view (window points) and what it counted. */
  const view = () => app.evaluate(async ({ BaseWindow }) => {
    const w = BaseWindow.getAllWindows()[0], v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
    if (!v) return null
    const counts = await v.webContents.executeJavaScript("({ own: +(own.dataset.n || 0), ups: window.ups })").catch(() => null)
    return { ...v.getBounds(), url: v.webContents.getURL(), counts }
  })
  const placed = await until(async () => { const v = await view(); return v?.url === SITE && v.counts && v }, 30000)
  check("the page shows", !!placed, await view())
  // (once the toasts from the start are gone: they raise the window too)
  const over = () => win.evaluate(() => "overPages" in document.documentElement.dataset)
  check("nothing over the page at first", !!await until(async () => !(await over()), 20000))
  const click = async (x, y) => { const b = await view(); await win.mouse.click(b.x + x, b.y + y) }

  // An overlay that takes the pointer on itself, as a floating pane does: no data-floats, a button of its own, over the
  // page's middle.
  await win.evaluate(({ x, y }) => {
    const d = document.createElement("div")
    d.id = "qa-over"
    d.style.cssText = `position:fixed;left:${x - 170}px;top:${y - 60}px;width:340px;height:120px;background:#333;z-index:19`
    d.innerHTML = `<button id=qa-over-button style="width:100%;height:100%" onclick="this.dataset.n = +(this.dataset.n || 0) + 1">over</button>`
    document.body.append(d)
  }, { x: placed.x + placed.width / 2, y: placed.y + placed.height / 2 })
  check("an overlay over the page raises the window", !!await until(over, 5000))
  await wait(300)
  await click(120, 50)
  check("… a click on the page beside it reaches the page", !!await until(async () => (await view())?.counts?.own === 1, 3000), (await view())?.counts)
  await win.locator("#qa-over-button").click()
  check("… a click on it is its own", await win.evaluate(() => document.getElementById("qa-over-button").dataset.n) === "1" && (await view())?.counts?.own === 1, (await view())?.counts)

  // The page's cursor shows over it.
  const b = await view()
  await win.mouse.move(b.x + 100, b.y + 140)
  const cursor = () => win.evaluate(() => document.querySelector("[data-web-box]")?.style.cursor ?? "")
  check("… the page's cursor shows: a link's hand", await until(async () => (await cursor()) === "pointer", 3000), await cursor())
  await win.mouse.move(b.x + 400, b.y + 60)
  check("… and its arrow off the link", await until(async () => (await cursor()) !== "pointer", 3000), await cursor())

  // A press in the page dragged out over the overlay is let go in the page.
  const ups = (await view()).counts.ups
  await win.mouse.move(b.x + 400, b.y + 60)
  await win.mouse.down()
  const ob = await win.locator("#qa-over").boundingBox()
  await win.mouse.move(ob.x + 50, ob.y + 50, { steps: 4 })
  await win.mouse.up()
  check("… a press dragged out over it is let go in the page", !!await until(async () => (await view())?.counts?.ups === ups + 1, 3000), [(await view())?.counts, ups])

  // A popup opened by a click passed through isn't blocked: it opens as a tab.
  const tabs = () => win.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("vaultite.tabs") ?? "{}")))
  await click(120, 220)
  check("… a popup it opens from a click is a new tab, not blocked", !!await until(async () => (await tabs()).includes("/popup"), 5000), await tabs())
  await win.locator("[role=tab]", { hasText: "Site" }).first().click()
  await until(async () => (await view())?.url === SITE, 5000)
  await wait(300)

  // A menu over the page takes every click there: one beside it doesn't reach the page.
  await win.evaluate(() => document.getElementById("qa-over").remove())
  await win.evaluate(() => {
    const m = document.createElement("div")
    m.id = "qa-menu"
    m.setAttribute("role", "menu")
    m.style.cssText = "position:fixed;right:40px;top:200px;width:200px;height:200px;background:#333;z-index:50"
    document.body.append(m)
  })
  await wait(500)
  const before = (await view()).counts.own
  await click(120, 50)
  await wait(500)
  check("a menu over the page: a click beside it doesn't reach the page", (await view())?.counts?.own === before, (await view())?.counts)
  await win.evaluate(() => document.getElementById("qa-menu").remove())

  // Quit and launch again: the page's tab is still there.
  await wait(1000)
  check("the page's tab is kept before quitting", (await tabs()).includes(`view:web/${SITE}`), await tabs())
  const closed = new Promise((ok) => app.once("close", ok))
  await app.evaluate(({ app: a }) => a.quit())
  await closed
  app = await launch()
  win = await app.firstWindow()
  watch(win, { console: true, fail: false })
  await win.waitForSelector("aside[data-side=right], main", { timeout: 60000 })
  check("after a quit, the Browser's tabs come back", (await tabs()).includes(`view:web/${SITE}`), await tabs())
  check("… its page shows again", !!await until(async () => (await view())?.url?.startsWith(SITE), 30000), await view())
  console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
} finally {
  await app.close().catch(() => {})
  server.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
