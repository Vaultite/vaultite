// Two web pages side by side in the desktop app: the keyboard moving between them (each going to the other at once, as
// a stale focus does) settles in one, its pane focused, and they don't trade it back and forth after.
// WRITES: the throwaway vault only.
//   node web/qa/webpanes.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, apiAt, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-webpanes-"))

const server = http.createServer((req, res) => {
  const name = req.url?.startsWith("/two") ? "Second part" : "Field notes"
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(`<!doctype html><title>${name}</title><body style="background:#1d1f21;color:#d6d3cc"><h1>${name}</h1></body>`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const SITE = `http://127.0.0.1:${server.address().port}`
fs.mkdirSync(path.join(VAULT, ".vaultite"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite/appearance.json"), JSON.stringify({ theme: "dark" }))

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
await app.evaluate(({ app: a, BaseWindow }, show) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); if (show) a.focus({ steal: true }); w.focus() }, !!process.env.SHOW)
const user = apiAt(`${new URL(win.url()).origin}/`, { "X-Vaultite-Client": "cli" })

await user("POST", "ops/ui.open", { path: `${SITE}/one` })
await user("POST", "ops/ui.open", { path: `${SITE}/two`, split: "right" })
/** The two pages' views, left to right: their webContents ids, and how often each took the keyboard. */
const views = () => app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0]
  return w.contentView.children.filter((v) => v.webContents && v.webContents !== w.webContents && v.getVisible())
    .sort((a, b) => a.getBounds().x - b.getBounds().x)
    .map((v) => { const wc = v.webContents; if (!wc.__took) { wc.__took = { n: 0 }; wc.on("focus", () => wc.__took.n++) } return { id: wc.id, took: wc.__took.n, focused: wc.isFocused() } })
})
check("two pages side by side", await until(async () => (await views()).length === 2, 20000), await views())

// The keyboard to the left page, then straight to the right one: the app hears of both after the fact.
await app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0]
  const [a, b] = w.contentView.children.filter((v) => v.webContents && v.webContents !== w.webContents && v.getVisible()).sort((x, y) => x.getBounds().x - y.getBounds().x)
  a.webContents.focus()
  b.webContents.focus()
})
await wait(500)
const before = (await views()).reduce((n, v) => n + v.took, 0)
await wait(1500)
const after = await views()
check("the pages don't trade the keyboard back and forth", after.reduce((n, v) => n + v.took, 0) - before <= 1, { before, after })
const focusedPane = () => win.evaluate(() => [...document.querySelectorAll("section[data-group]")].sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)
  .findIndex((s) => s.querySelector("#main-scroll")))
const keyboardIn = after.findIndex((v) => v.focused)
check("the focused pane is the one whose page has the keyboard", keyboardIn < 0 || await focusedPane() === keyboardIn, { keyboardIn, pane: await focusedPane() })

await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
