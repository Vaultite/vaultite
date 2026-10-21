// Agents in the desktop app's browser (Electron), end to end on a throwaway vault, against a made-up site this script
// serves on 127.0.0.1: through the browser ops (POST /api/ops/web-viewer.*), an agent opens a tab (in the Agents
// container, in a pane beside the user's), snapshots it, fills a form and submits it with real input, reads the result
// and takes a screenshot; it can't use a tab in Personal (no access), nor one the user paused; its steps can be replayed.
// WRITES: the throwaway vault only.
//   node web/qa/agents.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-agents-"))
const awake = process.platform !== "darwin" ? null
  : (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "600"], { stdio: "ignore" })
process.on("exit", () => awake?.kill())

// ---------- a made-up site with a form ----------
const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? "/", SITE)
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  if (u.pathname === "/hello") {
    return res.end(`<!doctype html><title>Hello</title><h1 id="out">Hello ${u.searchParams.get("name")}${u.searchParams.get("news") ? ", subscribed" : ""}, ${u.searchParams.get("size")}</h1>`)
  }
  res.end(`<!doctype html><title>Form</title><form action="/hello"><label>Name <input name="name"></label>
<label><input type="checkbox" name="news" value="1"> News</label>
<label>Size <select name="size"><option>Small</option><option>Medium</option><option>Large</option></select></label>
<button>Send</button></form>`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const SITE = `http://127.0.0.1:${server.address().port}`

// ---------- the app ----------
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1400, height: 860 }); w.focus() })
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
/** A browser op, as an agent calls it: its answer, or { error } with its status. */
const op = async (id, params) => {
  const r = await fetch(`${origin}/api/ops/web-viewer.${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "mcp", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params ?? {}) })
  const j = await r.json().catch(() => ({}))
  return r.ok ? (j.result ?? j) : { error: j.error ?? r.status, status: r.status }
}
await wait(2000) // (the app tells the desktop app what agents may do as it starts)

// ---------- open, snapshot, fill, submit ----------
const opened = await op("open", { url: `${SITE}/form` })
check("an agent opens a tab: its number", typeof opened?.tab === "number", opened)
await wait(1500)
const panes = await win.locator("[data-pane]").count()
check("… in a pane beside the user's", panes >= 2, panes)
const tabs = await op("tabs")
check("tabs lists it, in Agents, with act", Array.isArray(tabs) && tabs.some((t) => t.tab === opened.tab && t.container === "agents" && t.access === "act"), tabs)
const snap = await op("snapshot", { tab: opened.tab })
check("a snapshot: the form's controls with refs", /textbox "Name" \[ref=e\d+\]/.test(snap?.snapshot ?? "") && /button "Send" \[ref=e\d+\]/.test(snap?.snapshot ?? ""), snap?.snapshot ?? snap)
const ref = (re) => re.exec(snap?.snapshot ?? "")?.[1]
const filled = await op("act", { tab: opened.tab, action: "fill", ref: ref(/textbox "Name" \[ref=(e\d+)\]/), value: "Alice" })
check("fill", !filled.error, filled)
check("check", !(await op("act", { tab: opened.tab, action: "check", ref: ref(/checkbox "News" \[ref=(e\d+)\]/) })).error, null)
const picked = await op("act", { tab: opened.tab, action: "select", ref: ref(/combobox "Size" \[ref=(e\d+)\]/), value: "Large" })
check("select", !picked.error, picked)
const sent = await op("act", { tab: opened.tab, action: "click", ref: ref(/button "Send" \[ref=(e\d+)\]/) })
check("click Send: it went to another page", sent?.navigated === true && /\/hello\?/.test(sent?.url ?? ""), sent)
const waited = await op("wait", { tab: opened.tab, text: "Hello Alice" })
check("wait for its text", !waited.error, waited)
const read = await op("read", { tab: opened.tab })
check("read: what the form sent", /Hello Alice, subscribed, Large/.test(read?.text ?? ""), read)
const shot = await op("screenshot", { tab: opened.tab })
check("a screenshot, as a PNG file", typeof shot?.path === "string" && fs.existsSync(shot.path) && fs.readFileSync(shot.path).subarray(1, 4).toString() === "PNG", shot)
check("the bar says an agent is at work", await until(async () => (await win.locator("[data-web-agent]:visible").count()) === 1, 5000), null)

// ---------- what agents may not do ----------
await ui({ action: "open", path: `view:web/@personal/${SITE}/form?mine`, newTab: true })
const mine = await until(async () => (await op("tabs")).find?.((t) => t.url.endsWith("?mine")), 15000)
check("a tab in Personal: no access", mine?.access === "none", mine)
const refused = await op("snapshot", { tab: mine?.tab })
check("… its snapshot is refused", !!refused.error && /may not use this tab/.test(String(refused.error)), refused)
await win.evaluate((id) => window.vaultite.web.engine("agents:pause", id, true), opened.tab)
const paused = await op("act", { tab: opened.tab, action: "press", key: "Tab" })
check("a tab the user paused: acting is refused", /paused/.test(String(paused.error)), paused)
await win.evaluate((id) => window.vaultite.web.engine("agents:pause", id, false), opened.tab)
check("resumed: it acts again", !(await op("act", { tab: opened.tab, action: "press", key: "Tab" })).error, null)

// ---------- replay ----------
const runs = () => win.evaluate(() => window.vaultite.web.engine("agents:runs"))
check("its steps are kept to replay", await until(async () => { const r = await runs(); return r.length === 1 && r[0].steps >= 6 }, 5000), await runs())
await ui({ action: "command", id: "web:agent-runs" })
await win.locator("[data-web-replay]").first().click()
check("the replay shows its steps, with pictures", await until(async () => Number(await win.locator("[data-web-replay-steps]").getAttribute("data-web-replay-steps").catch(() => 0)) >= 6
  && (await win.locator("[data-web-replay-steps] img").count()) === 1, 10000), null)

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
