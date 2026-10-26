// Clicks into a cross-site frame (a captcha, "Sign in with Google") in the desktop app's Browser reach it even while the
// window's page is raised over it (Chromium runs such frames in a process of their own). WRITES: throwaway vault.
//   node web/qa/frameclicks.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-frameclicks-"))

// The page: a button of its own, and a frame from another site with a button filling it; each counts its clicks.
const server = http.createServer((q, r) => {
  r.writeHead(200, { "Content-Type": "text/html" })
  if (q.url === "/frame") return r.end(`<!doctype html><body style="margin:0"><button id=b style="width:100vw;height:100vh;font:20px sans-serif"
    onclick="this.textContent = 'clicked ' + (++window.n || (window.n = 1)); parent.postMessage('frame:' + window.n, '*')">frame</button>`)
  r.end(`<!doctype html><title>Site</title><body style="margin:0;background:#cde">
    <button id=own style="position:absolute;left:20px;top:20px;width:200px;height:60px" onclick="own.dataset.n = +(own.dataset.n || 0) + 1">own</button>
    <div style="height:3000px"></div>
    <iframe id=f src="http://localhost:${PORT}/frame" style="position:absolute;left:20px;top:120px;width:300px;height:100px;border:0"></iframe>
    <script>addEventListener("message", (e) => { document.body.dataset.frame = String(e.data).slice(6) })</script>`)
})
await new Promise((ok) => server.listen(0, "127.0.0.1", ok))
const PORT = server.address().port
const SITE = `http://127.0.0.1:${PORT}/`

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
try {
  const win = await app.firstWindow()
  watch(win, { console: true, fail: false })
  await win.waitForSelector("aside[data-side=right], main", { timeout: 60000 })
  const origin = new URL(win.url()).origin
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }) })
  await fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "open", path: `view:web/${SITE}` }) })

  /** The page's view (window points), what it counted, and whether its frame runs in a process of its own. */
  const view = () => app.evaluate(async ({ BaseWindow }) => {
    const w = BaseWindow.getAllWindows()[0], v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
    if (!v) return null
    const wc = v.webContents, f = wc.mainFrame.frames[0]
    const counts = await wc.executeJavaScript("({ own: +(own.dataset.n || 0), frame: +(document.body.dataset.frame || 0) })").catch(() => null)
    return { ...v.getBounds(), url: wc.getURL(), oopif: !!f && f.processId !== wc.mainFrame.processId, framed: f?.url ?? "", counts }
  })
  const placed = await until(async () => { const v = await view(); return v?.url === SITE && v.framed.includes("/frame") && v.counts && v }, 30000)
  check("the page shows, its frame loaded", !!placed, await view())
  check("the frame is another site's, in a process of its own", placed?.oopif === true, placed)
  await wait(500)

  // The window raised over the page letting the pointer through, as while a toast is over it (layers.ts).
  await win.evaluate(() => {
    const d = document.createElement("div")
    d.dataset.floats = ""
    d.id = "qa-float"
    d.style.cssText = "position:fixed;right:20px;bottom:20px;width:200px;height:40px;background:#333;pointer-events:none"
    document.body.append(d)
  })
  const through = await until(() => win.evaluate(() => "overPages" in document.documentElement.dataset), 5000)
  check("a float over the page raises the window, letting the pointer through", !!through)

  /** A click at the page's own point (x, y), on the window's page over it. */
  const click = async (x, y) => {
    const b = await view()
    await win.mouse.click(b.x + x, b.y + y)
  }
  await click(120, 50)
  const own = await until(async () => (await view())?.counts?.own === 1, 3000)
  check("through: a click reaches the page's own button", !!own, (await view())?.counts)
  await click(170, 170)
  const frame = await until(async () => (await view())?.counts?.frame === 1, 3000)
  check("through: a click reaches the button in the other site's frame", !!frame, (await view())?.counts)
  await click(170, 170)
  const twice = await until(async () => (await view())?.counts?.frame === 2, 3000)
  check("through: and again", !!twice, (await view())?.counts)
  // (zoomed in, the page's CSS pixels are bigger than the window's: the click still lands where the pointer is)
  await app.evaluate(({ BaseWindow }) => {
    const w = BaseWindow.getAllWindows()[0]
    w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible()).webContents.setZoomFactor(1.5)
  })
  await wait(500)
  await click(300 * 1.5, 210 * 1.5)
  const zoomed = await until(async () => (await view())?.counts?.frame === 3, 3000)
  check("through, the page zoomed in: a click reaches the frame where the pointer is", !!zoomed, (await view())?.counts)
  // (the wheel scrolls the page under it)
  const scrolled = () => app.evaluate(({ BaseWindow }) => {
    const w = BaseWindow.getAllWindows()[0]
    return w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible()).webContents.executeJavaScript("scrollY")
  })
  const b = await view()
  await win.mouse.move(b.x + 600, b.y + 300)
  await win.mouse.wheel(0, 200)
  const down = await until(async () => (await scrolled()) > 0, 3000)
  check("through: the wheel scrolls the page", !!down, await scrolled())
  console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
} finally {
  await app.close()
  server.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
