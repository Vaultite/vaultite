// An agent's page draws, so its clicks land (electron/web.ts readyView, drawing): pages opened at once (no spare to
// take, each view new) draw and take their first click. A page that draws no frame drops presses (Chromium), so an act
// "changed nothing". (Under Playwright a hidden view's page never hides, so a page that stopped drawing isn't made here.)
// WRITES: the throwaway vault only.
//   node web/qa/agentdraws.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-agentdraws-"))

const PAGE = `<!doctype html><title>Lighthouse</title><body style="margin:0;font:16px system-ui">
<button id="ship" style="position:absolute;left:100px;top:100px;width:180px;height:32px">Ship order 1042</button>
<p id="out" style="position:absolute;left:100px;top:180px"></p>
<script>let n = 0; ship.onclick = () => { out.textContent = "Shipped " + (++n) }</script>`
const site = http.createServer((_q, res) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(PAGE) })
await new Promise((ok) => site.listen(0, "127.0.0.1", ok))
const SITE = `http://127.0.0.1:${site.address().port}/`

const plugins = path.join(VAULT, ".vaultite/plugins.json")
const on = fs.existsSync(plugins) ? JSON.parse(fs.readFileSync(plugins, "utf8")) : { enabled: [], disabled: [] }
fs.writeFileSync(plugins, JSON.stringify({ ...on, enabled: [...new Set([...(on.enabled ?? []), "web-viewer"])] }))
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
try {
  const win = await app.firstWindow()
  await win.waitForSelector("[role=tree]", { timeout: 60000 })
  const origin = new URL(win.url()).origin
  const op = async (id, params) => {
    const r = await fetch(`${origin}/api/ops/web-viewer.${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "mcp", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params ?? {}) })
    const j = await r.json().catch(() => ({}))
    return r.ok ? (j.result ?? j) : { error: j.error ?? r.status, status: r.status }
  }
  /** What the page at `url` answers to `code`, asked from the app's side: an agent's call would wake it. */
  const ask = (url, code) => app.evaluate(({ BaseWindow }, [url, code]) => {
    const v = BaseWindow.getAllWindows()[0].contentView.children.find((x) => x.webContents?.getURL() === url)
    return v ? v.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }]) : null
  }, [url, code])
  /** Whether the page at `url` draws a frame within a second. */
  const draws = (url) => ask(url, "new Promise((done) => { const t = setTimeout(() => done(false), 1000); requestAnimationFrame(() => { clearTimeout(t); done(true) }) })")
  const shipped = (url) => ask(url, "document.getElementById('out').textContent")
  const click = async (tab) => {
    const ref = /button "Ship order 1042" \[ref=(e\d+)\]/.exec((await op("snapshot", { tab }))?.snapshot ?? "")?.[1]
    return op("act", { tab, action: "click", ref })
  }
  await wait(2000)

  // Three at once: the spare goes to one, the others' views are new.
  const urls = [1, 2, 3].map((n) => `${SITE}?n=${n}`)
  const tabs = (await Promise.all(urls.map((url) => op("open", { url, task: "draws", summary: "Shipping orders" })))).map((r) => r?.tab)
  check("pages opened at once all open", tabs.every((t) => typeof t === "number"), tabs)
  for (const [i, t] of tabs.entries()) {
    await click(t)
    check(`page ${t}: its first click lands`, await shipped(urls[i]) === "Shipped 1", await shipped(urls[i]))
    check(`… and it draws`, await draws(urls[i]))
  }

} finally {
  await app.close().catch(() => {})
  site.closeAllConnections(); site.close()
  await done()
}
