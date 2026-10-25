// Agents' pages out of the user's tabs (electron/web.ts parks them, electron/browser/agent.ts; AgentsPanel.tsx): an
// agent's page opens with no tab, draws on through a cross-site load (screenshots, the corner card's live picture), its
// pointer in the page; Open as tab hands the same page to a tab and Move to background takes it back; an ask opens it as
// a tab with a card and Done; it outlives the window reloading.
// WRITES: the throwaway vault only.
//   node web/qa/agentpages.mjs <vault copy> [shots dir]   (SHOW=1 on a Mac: on screen, the shots taken by macOS)
import { _electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT, SHOTS], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-agentpages-"))
const awake = process.platform !== "darwin" ? null
  : (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "600"], { stdio: "ignore" })
process.on("exit", () => awake?.kill())
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

// ---------- a made-up site: a button counting its clicks in the title, on two sites (127.0.0.1 and localhost) ----------
const site = http.createServer((_q, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(`<!doctype html><title>clicks=0</title><style>body{font:18px system-ui;margin:40px}button{font-size:20px;padding:12px 24px}</style>
<h1>Lighthouse orders</h1><p>Order 1042 ships Tuesday.</p><button id="b">Track order</button>
<script>let n=0;b.onclick=()=>{n++;document.title="clicks="+n}</script>`)
})
await new Promise((ok) => site.listen(0, "127.0.0.1", ok))
const PORT = site.address().port
const SITE = `http://127.0.0.1:${PORT}/`, OTHER = `http://localhost:${PORT}/other`

const plugins = path.join(VAULT, ".vaultite/plugins.json")
const on = fs.existsSync(plugins) ? JSON.parse(fs.readFileSync(plugins, "utf8")) : { enabled: [], disabled: [] }
fs.writeFileSync(plugins, JSON.stringify({ ...on, enabled: [...new Set([...(on.enabled ?? []), "web-viewer"])] }))
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
const BOUNDS = { x: 40, y: 40, width: 1400, height: 860 }
await app.evaluate(({ BaseWindow }, b) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds(b); w.focus() }, BOUNDS)
const op = async (id, params) => {
  const r = await fetch(`${origin}/api/ops/web-viewer.${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "mcp", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params ?? {}) })
  const j = await r.json().catch(() => ({}))
  return r.ok ? (j.result ?? j) : { error: j.error ?? r.status, status: r.status }
}
/** The window as macOS draws it, pages and all (a page's own screenshot leaves the native pages out). */
async function shot(name) {
  if (!SHOTS) return
  if (process.env.SHOW && process.platform === "darwin") {
    await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].focus())
    await wait(400)
    execFileSync("screencapture", ["-x", "-R", `${BOUNDS.x},${BOUNDS.y},${BOUNDS.width},${BOUNDS.height}`, path.join(SHOTS, `${name}.png`)])
  } else await win.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}
await wait(2000) // (the app tells the desktop app what agents may do as it starts)
const tabOf = async (T) => (await op("tabs")).find?.((t) => t.tab === T)
const pageTabs = () => win.locator("[data-web-page]").count()
const card = win.locator("[data-agents-card]")

// ---------- in the background ----------
const opened = await op("open", { url: SITE, task: "order status", summary: "Checking where order 1042 is" })
const T = opened?.tab
check("an agent opens a page: its number", typeof T === "number", opened)
check("… with no tab of the user's", await pageTabs() === 0, await pageTabs())
check("… listed, not shown", (await tabOf(T))?.shown === false, await tabOf(T))
check("a card in the corner shows it, who and what for", await until(async () => /Claude Code\/order status/.test(await card.locator("[data-agent-who]").first().innerText().catch(() => "")), 5000),
  await card.innerText().catch(() => ""))
const png = (r) => typeof r?.path === "string" && fs.existsSync(r.path) && fs.readFileSync(r.path).subarray(1, 4).toString() === "PNG"
check("a screenshot of it", png(await op("screenshot", { tab: T })))
const snap = await op("snapshot", { tab: T })
const ref = /button "Track order" \[ref=(e\d+)\]/.exec(snap?.snapshot ?? "")?.[1]
const clicked = await op("act", { tab: T, action: "click", ref })
check("a click in it, with real input", (await tabOf(T))?.title === "clicks=1", [clicked, await tabOf(T)])
const pointer = await op("evaluate", { tab: T, expression: "!!document.querySelector('vaultite-agent')" })
check("… its pointer drawn in the page, in a root of its own", pointer?.value === "true", pointer)

// ---------- live in the card ----------
const live = card.locator("[data-agent-live] img")
check("the card shows the page live", await until(async () => /^data:image\/jpeg/.test(await live.getAttribute("src").catch(() => "") ?? ""), 8000))
await op("act", { tab: T, action: "hover", ref })
await wait(900)
await shot("1-panel")

// ---------- a cross-site load: it still draws ----------
await op("navigate", { tab: T, to: OTHER })
check("after a cross-site load it still draws: a screenshot", png(await op("screenshot", { tab: T })))
const before = await live.getAttribute("src")
await op("act", { tab: T, action: "click", ref: /button "Track order" \[ref=(e\d+)\]/.exec((await op("snapshot", { tab: T }))?.snapshot ?? "")?.[1] })
check("… and its live picture moves on", await until(async () => (await live.getAttribute("src")) !== before, 5000))

// ---------- open as tab, and back ----------
await card.locator("[data-agent-open]").click()
check("Open as tab: a tab shows the page", await until(async () => (await win.locator(`[data-web-page="${T}"]`).count()) === 1, 8000), await pageTabs())
check("… the same page, not loaded again", (await tabOf(T))?.title === "clicks=1" && (await tabOf(T))?.shown === true, await tabOf(T))
await op("act", { tab: T, action: "hover", ref: /button "Track order" \[ref=(e\d+)\]/.exec((await op("snapshot", { tab: T }))?.snapshot ?? "")?.[1] })
check("… its bar says an agent's at work", await until(() => win.locator(`[data-web-page="${T}"] [data-web-agent]`).isVisible(), 5000))
check("… and the corner card goes, the page being on screen", await until(async () => (await card.count()) === 0, 5000))
await shot("2-as-tab")
await win.locator(`[data-web-page="${T}"] [data-web-agent]`).click()
await win.getByRole("menuitem", { name: "Move to background" }).click()
check("Move to background: its tab closes", await until(async () => (await pageTabs()) === 0, 5000), await pageTabs())
check("… the page goes on", (await tabOf(T))?.title === "clicks=1" && (await tabOf(T))?.shown === false, await tabOf(T))
check("… back in the corner card", await until(() => card.isVisible(), 5000))

// ---------- closed, then an ask ----------
await card.locator("[aria-label=Close]").click()
check("the card closes", await until(async () => (await card.count()) === 0, 5000))

// ---------- unused and unwatched a minute, it rests (hidden, throttled), till an agent needs it ----------
const throttled = () => app.evaluate(({ webContents }, u) => webContents.getAllWebContents().find((w) => w.getURL().startsWith(u))?.getBackgroundThrottling(), OTHER)
check("in use, a page in the background isn't throttled", await throttled() === false)
check("unused a minute, it rests", await until(async () => (await throttled()) === true, 90_000), await throttled())
check("… and wakes for a screenshot, drawn", png(await op("screenshot", { tab: T })) && await throttled() === false)
await op("ask", { tab: T, reason: "Sign in to Lighthouse, then press Done" })
check("an ask opens it as a tab", await until(async () => (await win.locator(`[data-web-page="${T}"]`).count()) === 1, 8000))
const ask = win.locator(`[data-web-page="${T}"] [data-web-agent-ask]`)
check("… a card at the tab's foot says who asks and what", await until(async () => /Claude Code needs you\s*Sign in to Lighthouse/.test(await ask.innerText().catch(() => "")), 5000), await ask.innerText().catch(() => ""))
check("… the corner card staying out of its way", (await card.count()) === 0, await card.count())
await wait(500)
await shot("3-ask")
check("… no toast of it (the Inbox has it), which hid Done", (await win.locator("[data-sonner-toast]", { hasText: "needs you in the browser" }).count()) === 0)
const waiting = op("wait", { tab: T, helped: true, timeout: 20 })
await ask.locator("[data-web-agent-done]").dispatchEvent("click") // (the playground's own toast stays over the corner)
check("… Done ends the agent's wait", !(await waiting).error, await waiting)
check("… and the card goes", await until(async () => (await ask.count()) === 0, 5000))

// ---------- the window reloading ----------
await win.locator(`[data-web-page="${T}"] [data-web-agent]`).click()
await win.getByRole("menuitem", { name: "Move to background" }).click()
await until(async () => (await pageTabs()) === 0, 5000)
await win.reload()
await win.waitForSelector("[role=tree]", { timeout: 60000 })
await wait(10_000) // (past the time a reloaded window's tabs have to take their pages back)
check("a window reloading keeps the agent's page in the background", (await tabOf(T))?.title === "clicks=1", await tabOf(T))
check("… and the corner card shows it again", await until(() => card.isVisible(), 5000))

// ---------- closed by the agent ----------
check("the agent closes it", !(await op("close", { tab: T })).error && !(await tabOf(T)))
check("… and the card goes", await until(async () => (await card.count()) === 0, 5000))

await app.close()
site.close()
try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* a server still writing its folder */ }
await done()
