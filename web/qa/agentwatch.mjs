// Watching an agent never disturbs it: its page keeps the agent's size and zoom through Open as tab, resizes and the
// user's own tab of the site; its tab shows a picture till Take over; closing the tab keeps the page. Throwaway vault only.
//   node web/qa/agentwatch.mjs <vault copy> [shots dir]
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT, SHOTS], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-agentwatch-"))

// ---------- a made-up site whose layout follows its width (as a doc's or a store's does), with a button ----------
const site = http.createServer((_q, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(`<!doctype html><title>clicks=0</title><style>body{font:16px system-ui;margin:24px}button{font-size:18px;padding:10px 20px}
@media (max-width:1000px){#wide{display:none}}@media (min-width:1001px){#narrow{display:none}}</style>
<h1>Orders</h1><button id="b">Track order</button><button id="wide">Wide only</button><button id="narrow">Narrow only</button>
<script>let n=0;b.onclick=()=>{n++;document.title="clicks="+n}</script>`)
})
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
  watch(win, { console: true, fail: false })
  await win.waitForSelector("[role=tree]", { timeout: 60000 })
  const origin = new URL(win.url()).origin
  const setBounds = (b) => app.evaluate(({ BaseWindow }, b) => BaseWindow.getAllWindows()[0].setBounds(b), b)
  await setBounds({ x: 40, y: 40, width: 1400, height: 860 })
  const op = async (id, params) => {
    const r = await fetch(`${origin}/api/ops/web-viewer.${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "mcp", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params ?? {}) })
    const j = await r.json().catch(() => ({}))
    return r.ok ? (j.result ?? j) : { error: j.error ?? r.status, status: r.status }
  }
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await win.screenshot({ path: path.join(SHOTS, `${name}.png`) }) } }
  const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  await wait(2000) // (the app tells the desktop app what agents may do as it starts)
  for (let i = 0; i < 5 && await until(() => win.locator("[data-confirm-ok]").count(), i ? 1500 : 4000); i++) { await win.getByRole("button", { name: "Not now" }).first().click().catch(() => {}); await wait(300) }

  const opened = await op("open", { url: SITE, task: "orders", summary: "Tracking an order" })
  const T = opened?.tab
  check("an agent opens a page", typeof T === "number", opened)
  const tabOf = async () => (await op("tabs")).find?.((t) => t.tab === T)
  const size = async () => (await op("evaluate", { tab: T, expression: "innerWidth + 'x' + innerHeight + '@' + devicePixelRatio" }))?.value?.replace(/"/g, "")
  const agentSize = (s) => /^1280x800@/.test(s ?? "")
  const ref = async (name) => new RegExp(`button "${name}" \\[ref=(e\\d+)\\]`).exec((await op("snapshot", { tab: T }))?.snapshot ?? "")?.[1]
  const click = async () => op("act", { tab: T, action: "click", ref: await ref("Track order") })
  const clicks = async () => Number(/clicks=(\d+)/.exec((await tabOf())?.title ?? "")?.[1] ?? NaN)
  const pngSize = (r) => { try { const b = fs.readFileSync(r.path); return [b.readUInt32BE(16), b.readUInt32BE(20)] } catch { return null } }

  check("its page is laid out at the agent's size, 1280×800", agentSize(await size()), await size())
  check("… its wide layout, what the agent snapshots", !!(await ref("Wide only")) && !(await ref("Narrow only")))
  const png = pngSize(await op("screenshot", { tab: T }))
  check("… and a screenshot is the whole of it", png?.[0] === 1280 && png?.[1] === 800, png)

  // ---------- the user's own tab of the site, zoomed: Chromium shares a site's zoom among its pages ----------
  const container = (await tabOf())?.container
  await ui({ action: "open", path: `view:web/${container ? `@${container}/` : ""}${SITE}mine`, newTab: true })
  const mine = await until(async () => (await op("tabs")).find?.((t) => t.tab !== T && t.url.startsWith(SITE)), 15000)
  check("the user opens the same site in a tab of their own", !!mine, await op("tabs"))
  await app.evaluate(({ webContents }, u) => { for (const w of webContents.getAllWebContents()) if (w.getURL() === u) w.setZoomFactor(1.5) }, `${SITE}mine`)
  await wait(500)
  check("… and zooms it: the agent's page keeps its size", agentSize(await size()), await size())

  // ---------- Open as tab: a picture of it, the page untouched ----------
  await win.locator("[data-agent-open]").first().click()
  const watching = win.locator("[data-web-agent-watch]")
  check("Open as tab: the tab shows it live, as a picture", await until(() => watching.locator("img[data-web-agent-frame]").count(), 8000), await watching.count())
  check("… saying it's the agent's, with Take over", /working here|paused here/.test(await watching.innerText().catch(() => "")) && await win.locator("[data-web-agent-take]").count() === 1)
  check("… the page itself isn't placed in the tab", (await tabOf())?.shown === false, await tabOf())
  check("… and keeps the agent's size", agentSize(await size()), await size())
  await shot("1-watching")
  check("… the corner card leaving it out, seen here", await until(async () => (await win.locator("[data-agents-card]").count()) === 0, 5000))
  await click()
  check("the agent's clicks land meanwhile", await until(async () => (await clicks()) === 1, 5000), await tabOf())
  await setBounds({ x: 40, y: 40, width: 900, height: 600 })
  await wait(800)
  check("a window resizing changes nothing of its size", agentSize(await size()), await size())
  await setBounds({ x: 40, y: 40, width: 1400, height: 860 })

  // ---------- Take over: the page itself, the agent paused; Give back ----------
  await win.locator("[data-web-agent-take]").click()
  check("Take over: the page itself in the tab", await until(async () => (await tabOf())?.shown === true, 8000), await tabOf())
  check("… the picture gone", await until(async () => (await watching.count()) === 0, 5000))
  check("… laid out at the tab's size now", await until(async () => !agentSize(await size()), 5000), await size())
  check("… listed as taken over for agents", (await tabOf())?.taken === true && (await tabOf())?.paused === true, await tabOf())
  const refused = await op("act", { tab: T, action: "click", ref: await ref("Track order") })
  check("… an agent acting there hears the user took it over", /took this page over/.test(String(refused?.error ?? "")), refused)
  await shot("2-taken-over")
  await win.locator("[data-web-agent-give]").click()
  check("Give back: the picture again", await until(() => watching.count(), 8000))
  check("… the page out of the tab, at the agent's size", await until(async () => (await tabOf())?.shown === false && agentSize(await size()), 8000), [await tabOf(), await size()])
  await click()
  check("… and the agent acts again", await until(async () => (await clicks()) === 2, 5000), await tabOf())

  // ---------- the tab closed: the page goes on in the background ----------
  const closeKey = process.platform === "darwin" ? "Meta+w" : "Control+w"
  await win.locator("[data-web-agent-watch]").click({ position: { x: 5, y: 5 } }).catch(() => {})
  await win.keyboard.press(closeKey)
  check("closing its tab: the tab goes", await until(async () => (await win.locator(`[data-web-page="${T}"]`).count()) === 0, 5000))
  check("… the agent's page goes on, in the background", await until(async () => (await tabOf())?.shown === false, 5000) && (await clicks()) === 2, await tabOf())
  await click()
  check("… where the agent still acts", await until(async () => (await clicks()) === 3, 5000), await tabOf())
  check("… at its size", agentSize(await size()), await size())

  // ---------- the agent closing it ends it ----------
  check("the agent closing its page ends it", !(await op("close", { tab: T })).error && !(await tabOf()))
} finally {
  await app.close().catch(() => {})
  site.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
