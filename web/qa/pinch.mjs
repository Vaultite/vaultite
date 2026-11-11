// A real trackpad pinch (the window server's gesture events: lib/pinch.swift) over a Browser page in the desktop app
// magnifies the page (electron/web.ts, gestures.m): with nothing over it; with a toast over it (the window's page raised
// over the page, letting the pointer through), the pointer moved there or resting there as the toast came; not over the
// toast itself; never the app's own page. It shows its window and posts real events at the pointer, so it runs only
// with VAULTITE_REAL_INPUT=1, on a Mac nobody's using (else skipped). WRITES: the throwaway vault.
//   VAULTITE_REAL_INPUT=1 node web/qa/pinch.mjs <vault copy>
import { _electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait, keepAwake, uiAt } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done, skip } = await qa(import.meta.url, { chrome: false })
if (process.platform !== "darwin") await skip("a Mac's trackpad")
if (process.env.VAULTITE_REAL_INPUT !== "1") await skip("posts real trackpad events and shows its window: VAULTITE_REAL_INPUT=1, on a Mac nobody's using")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-pinch-"))
const PINCH = path.join(TMP, "pinch")
execFileSync("/usr/bin/xcrun", ["swiftc", "-O", path.join(import.meta.dirname, "lib", "pinch.swift"), "-o", PINCH], { stdio: "inherit" })
keepAwake(300)

const ARTICLE = `<!doctype html><meta charset="utf-8"><title>Lighthouse field notes</title>
<body style="font:18px/1.5 Georgia,serif;margin:0;padding:40px 60px;height:3000px"><h1>Lighthouse field notes</h1>
<p>The keeper climbs one hundred and twelve steps every evening.</p>
<script>window.wheels = []; addEventListener("wheel", (e) => wheels.push(e.ctrlKey), { passive: true })</script>`
const server = http.createServer((_q, res) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(ARTICLE) })
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const SITE = `http://127.0.0.1:${server.address().port}`
fs.mkdirSync(path.join(VAULT, "Notes"), { recursive: true })
fs.writeFileSync(path.join(VAULT, "Notes/Reading list.md"), `# Reading list\n\nStart with [the field notes](${SITE}/article) today.\n\nMore to read later.\n`)

// (shown, not quiet: macOS routes a gesture to the window under the pointer, and a quiet one lets everything through)
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
try {
  const win = await app.firstWindow()
  watch(win, { console: true, fail: false })
  await win.waitForSelector("[role=tree]", { timeout: 60000 })
  const origin = new URL(win.url()).origin
  const ui = (body) => uiAt(origin)(body)
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.moveTop(); w.focus() })
  await ui({ action: "open", path: "Notes/Reading list.md" })
  await win.waitForSelector(".cm-link[data-url]", { timeout: 15000 })
  await win.locator(".cm-line", { hasText: "More to read later" }).first().click()
  await win.locator(".cm-link[data-url]").first().click()
  /** The shown page: whether the window's page is over it, and its middle on the screen. */
  const shown = () => app.evaluate(({ BaseWindow }) => {
    const w = BaseWindow.getAllWindows()[0], kids = w.contentView.children
    const v = kids.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
    if (!v) return null
    const c = w.getContentBounds(), b = v.getBounds()
    return { url: v.webContents.getURL(), covered: kids.indexOf(w.view) > kids.indexOf(v), middle: [c.x + b.x + b.width / 2, c.y + b.y + b.height / 2] }
  })
  const inPage = (code) => app.evaluate(({ BaseWindow }, code) => {
    const w = BaseWindow.getAllWindows()[0]
    return w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible()).webContents.executeJavaScript(code)
  }, code)
  const toasts = () => win.evaluate(() => document.querySelectorAll("[data-sonner-toast]").length)
  // (the sandbox's own toast over the page first goes)
  check("a web tab at the article", await until(async () => (await shown())?.url === `${SITE}/article`, 15000))
  await until(async () => !(await toasts()), 15000)
  await until(async () => !(await shown())?.covered, 5000)
  const pinch = async (scale, [x, y], rest = false) => {
    execFileSync(PINCH, [String(x), String(y), String(scale), ...(rest ? ["--rest"] : [])], { timeout: 10000 })
    await wait(500)
    return inPage("visualViewport.scale")
  }
  const appScale = () => win.evaluate(() => visualViewport.scale)
  const { middle } = await shown()
  // (the pointer over the page a moment before the first: the window server's first gesture into a window just shown)
  execFileSync("/opt/homebrew/bin/cliclick", [`m:${middle[0]},${middle[1]}`])
  await wait(500)

  // Chromium's own pinch: a little first does nothing (a 1.5x threshold), then it follows the fingers.
  const bare = await pinch(2.5, middle)
  check("a pinch magnifies the page with nothing over it", bare > 1.5, bare)
  check("… and pinches back to its size", Math.abs((await pinch(0.1, middle)) - 1) < 0.01)

  await ui({ action: "notify", text: "Lighthouse lamp lit" })
  check("a toast over the page raises the window's page over it", await until(async () => (await shown()).covered, 4000), await shown())
  await inPage("scrollTo(0, 400); wheels.length = 0")
  const covered = await pinch(2.5, middle)
  check("with the window's page over it, a pinch there still magnifies the page", covered > 1.5, [covered, bare])
  check("… as a pinch, never a scroll of the page", (await inPage("scrollY")) === 400 && (await inPage("wheels.every(Boolean)")), [await inPage("scrollY"), await inPage("wheels")])
  check("… and the app's own page doesn't magnify", Math.abs((await appScale()) - 1) < 0.01)
  await pinch(0.1, middle)
  await until(async () => !(await toasts()) && !(await shown()).covered, 15000)

  // Fingers on the trackpad don't move the pointer: resting over the page as a toast comes, it's the page's all the same.
  const resting = [middle[0], middle[1] + 60]
  execFileSync("/opt/homebrew/bin/cliclick", [`m:${resting[0]},${resting[1]}`])
  await wait(300)
  await ui({ action: "notify", text: "Lighthouse keeper home" })
  await until(async () => (await shown()).covered, 4000)
  const still = await pinch(2.5, resting, true)
  check("with the pointer resting there as the toast came, the pinch is the page's", still > 1.5, still)
  await pinch(0.1, resting, true)
  await until(async () => !(await toasts()), 15000)

  // Over the toast itself: the app's (whose page never magnifies), not the page's.
  await ui({ action: "notify", text: "Lighthouse fog horn" })
  await until(async () => (await shown()).covered && (await toasts()), 4000)
  const t = await win.evaluate(() => { const r = document.querySelector("[data-sonner-toast]").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })
  const c = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].getContentBounds())
  const z = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].webContents.getZoomFactor())
  const onToast = await pinch(2.5, [c.x + t[0] * z, c.y + t[1] * z])
  check("a pinch over the toast leaves the page as it was", Math.abs(onToast - 1) < 0.01 && (await shown()).covered, onToast)
  check("… and the app's own page as it was", Math.abs((await appScale()) - 1) < 0.01)
} finally {
  await app.close().catch(() => {})
  server.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
