// Zen's sidebars over a browser tab in the desktop app: its page is a native view the window doesn't hear, yet the
// pointer at an edge slides the sidebar in (moves sent with sendInputEvent). Writes the throwaway vault only.
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
  for (const side of ["left", "right"]) {
    for (const x of [width / 2, width / 2 + 5]) await over(x)
    await wait(400)
    check(`${side}: in the middle of the page, still hidden`, (await peekOf(side)) === "false", await peekOf(side))
    const edge = side === "left" ? 1 : width - 1
    for (const x of side === "left" ? [40, 10, 4, edge] : [width - 40, width - 10, width - 2, edge]) await over(x)
    check(`${side}: at the window's edge over the page, it slides in`, await until(async () => (await peekOf(side)) === "true", 3000), await peekOf(side))
    await wait(400)
    await win.mouse.move(side === "left" ? 1 : width - 1, 400)
    await win.mouse.move(640, 400, { steps: 10 })
    check(`${side}: away from it, it slides out`, await until(async () => (await peekOf(side)) === "false", 3000), await peekOf(side))
  }
  console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
} finally {
  await app.close()
  server.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
