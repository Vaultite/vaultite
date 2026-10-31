// The window's page stays over the browser's pages while it's raised (a tooltip, a toast, a menu over one), however a
// page comes back: an agent's page opened as a tab is parked while its tab is hidden and put back among the window's
// views as it's shown again. Put over the window, it took the clicks meant for what the app drew there (a slid-in
// sidebar). A page in a pane beside it, with a float over it, keeps the window raised meanwhile.
// WRITES: the throwaway vault only.
//   node web/qa/pageorder.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-pageorder-"))
const site = http.createServer((q, r) => { r.writeHead(200, { "Content-Type": "text/html" }); r.end(`<!doctype html><title>${q.url === "/b" ? "Beacon" : "Lighthouse"}</title><body style='margin:0;height:100vh;background:#cde'>Site`) })
await new Promise((ok) => site.listen(0, "127.0.0.1", ok))
const SITE = `http://127.0.0.1:${site.address().port}/`
fs.writeFileSync(path.join(VAULT, "Alice Park.md"), "Notes on Alice.\n")

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

  // The agent's page as a tab, and a note's tab beside it in the same pane.
  const T = (await op("web-viewer.open", { url: `${SITE}b`, task: "order status" }))?.tab
  check("an agent opens a page in the background", typeof T === "number", T)
  await win.locator("[data-agent-open]").click()
  check("Open as tab: a tab shows it", await until(async () => (await win.locator(`[data-web-page="${T}"]`).count()) === 1, 8000), await order())
  await op("ui.open", { path: "Alice Park.md", newTab: true })
  // Another page in a pane to the right, with a float (as a tooltip is, layers.ts) over it: the window stays raised.
  await op("ui.open", { path: SITE, split: "right" })
  check("a page in a pane beside it", await until(async () => (await order()) === "app page", 8000), await order())
  await win.evaluate(() => {
    const d = Object.assign(document.createElement("div"), { id: "qa-float" })
    d.dataset.floats = ""
    d.style.cssText = "position:fixed;right:60px;top:50%;width:200px;height:40px;background:#333;pointer-events:none"
    document.body.append(d)
  })
  check("a float over it raises the window", await until(async () => (await raised()) && (await order()) === "page app", 3000), await order())

  for (const round of [1, 2]) {
    await tab("Alice Park").click()
    check(`${round}: the note's tab picked, the agent's page is parked`, await until(async () => (await order()) === "page app", 5000), await order())
    await tab("Beacon").click()
    check(`${round}: its tab picked again, it shows under the raised window`,
      await until(async () => (await win.locator(`[data-web-page="${T}"]`).isVisible()) && (await order()).split(" ").length === 3, 5000) && (await order()) === "page page app", await order())
    await wait(300)
    check(`${round}: … and stays there`, (await raised()) && (await order()) === "page page app", await order())
  }
  await win.evaluate(() => document.getElementById("qa-float").remove())
  // (once the toasts opening them left too)
  check("nothing over them: the pages over the window again", await until(async () => !(await raised()) && (await order()) === "app page page", 15000), await order())
} finally {
  await app.close()
  site.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
