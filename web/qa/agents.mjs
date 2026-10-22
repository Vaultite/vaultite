// Agents in the desktop app's browser (Electron), end to end on a throwaway vault, against a made-up site this script
// serves on 127.0.0.1: through the browser ops (POST /api/ops/web-viewer.*), an agent opens a tab (in the Agents
// container, in a pane beside the user's), snapshots it, fills a form and submits it with real input, reads the result
// and takes a screenshot; it can't use a tab in Personal (no access), nor one the user paused; its steps can be replayed.
// Each act answers what it changed (refs lasting), a whole form fills in one call, a script runs a flow in one call in a
// sandbox (no network, 30 s), a page saves as a PDF, and the cockpit shows the tab live (Pause) and finds past runs.
// Then as Claude Code over MCP (vau mcp, plugins/core/mcp/cli.ts): its tabs grouped by task and marked its own, a
// form filled, a file uploaded and one downloaded, the page searched, a picture, an expression in its own world, the
// user asked for help (Done in the bar), its tab closed; and a server on another machine with no desktop app
// (plugins/core/machines/plugin.ts) isn't answered by this app's, a laptop's (web/qa/attach.mjs: an always-on one's is).
// WRITES: the throwaway vault only.
//   node web/qa/agents.mjs <vault copy>
import { _electron } from "playwright-core"
import { spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"
import { testServer } from "../../tools/test/lib.ts"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-agents-"))
const awake = process.platform !== "darwin" ? null
  : (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "600"], { stdio: "ignore" })
process.on("exit", () => awake?.kill())

// ---------- a made-up site with a form ----------
const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? "/", SITE)
  if (u.pathname === "/file.txt") { res.writeHead(200, { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=\"log book.txt\"" }); return res.end("Day one: calm.\n") }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  if (u.pathname === "/upload") {
    return res.end(`<!doctype html><title>Upload</title><label>Document <input type="file" id="doc"></label><p id="got">none</p><a href="/file.txt">The log book</a>
<script>doc.onchange = () => { got.textContent = "Picked " + doc.files[0].name + ", " + doc.files[0].size + " bytes" }; window.secretOfThePage = 42</script>`)
  }
  if (u.pathname === "/menu") {
    return res.end(`<!doctype html><title>Menu</title><h1>Menu</h1><button id="save">Save</button><div id="out"></div>
<script>save.onclick = () => setTimeout(() => { out.innerHTML = '<p role="status">Saved</p><button>Close</button>' }, 200)</script>`)
  }
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
// (Machines on: a server with no desktop app passes its agents' calls to this one)
const plugins = path.join(VAULT, ".vaultite/plugins.json")
const on = fs.existsSync(plugins) ? JSON.parse(fs.readFileSync(plugins, "utf8")) : { enabled: [], disabled: [] }
fs.writeFileSync(plugins, JSON.stringify({ ...on, enabled: [...new Set([...(on.enabled ?? []), "machines", "web-viewer"])], disabled: (on.disabled ?? []).filter((x) => x !== "machines") }))
fs.mkdirSync(path.join(VAULT, "Attachments"), { recursive: true })
fs.writeFileSync(path.join(VAULT, "Attachments/cv.txt"), "Alice Park, keeper.\n")
const DOWNLOADS = path.join(TMP, "Downloads")
fs.mkdirSync(DOWNLOADS, { recursive: true })
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ app: a, BaseWindow }, dl) => { a.setPath("downloads", dl); const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1400, height: 860 }); w.focus() }, DOWNLOADS)
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

// ---------- act answers what changed; a whole form at once; a script in one call; the cockpit; a PDF ----------
const o3 = await op("open", { url: `${SITE}/menu`, task: "cockpit", summary: "Checking the made-up menu" })
const t3 = o3.tab
const menu = await op("snapshot", { tab: t3 })
const saveRef = /button "Save" \[ref=(e\d+)\]/.exec(menu?.snapshot ?? "")?.[1]
const saved = await op("act", { tab: t3, action: "click", ref: saveRef })
check("act answers the settled diff: what the click drew", saved?.diff?.page === false && saved.diff.lines.some((l) => /^\+ text "Saved"$/.test(l))
  && saved.diff.lines.some((l) => /^\+ button "Close" \[ref=e\d+\]$/.test(l)), saved)
const again = await op("snapshot", { tab: t3 })
check("… and refs last: Save keeps its ref", again?.snapshot?.includes(`button "Save" [ref=${saveRef}]`), again?.snapshot)
const capped = await op("act", { tab: t3, action: "click", ref: saveRef, diff: "1" })
check("… capped by diff (a number of lines), none when nothing changed", capped?.diff?.lines?.length <= 1, capped)
const quiet = await op("act", { tab: t3, action: "hover", ref: saveRef, diff: "none" })
check("… diff none: no diff", !quiet.error && quiet.diff === undefined, quiet)
await op("navigate", { tab: t3, to: `${SITE}/form` })
const form = (await op("snapshot", { tab: t3 }))?.snapshot ?? ""
const fref = (re) => re.exec(form)?.[1]
const whole = await op("act", { tab: t3, action: "fill", fields: [{ ref: fref(/textbox "Name" \[ref=(e\d+)\]/), value: "Carol" },
  { ref: fref(/checkbox "News" \[ref=(e\d+)\]/), value: "true" }, { ref: fref(/combobox "Size" \[ref=(e\d+)\]/), value: "Medium" }] })
check("fields: a whole form in one call", !whole.error && whole.diff?.lines?.some((l) => l.includes("Carol")), whole)
const wrong = await op("act", { tab: t3, action: "fill", fields: [{ ref: "e9999", value: "x" }] })
check("… a wrong ref fills nothing", /no ref e9999/.test(String(wrong.error)), wrong)
await op("act", { tab: t3, action: "click", ref: fref(/button "Send" \[ref=(e\d+)\]/) })
check("… sent as filled", /Hello Carol, subscribed, Medium/.test((await op("read", { tab: t3 }))?.text ?? ""), null)
const ran = await op("run", { tab: t3, script: `await go(${JSON.stringify(`${SITE}/form`)})
await fill({ [await ref("Name")]: "Dana" })
await act("click", await ref("Send", "button"))
await wait({ text: "Hello Dana" })
console.log("sent")
return (await read()).trim()` })
check("run: a whole flow in one call, its log and answer", ran?.logs?.[0] === "sent" && /Hello Dana, Small/.test(ran?.value ?? ""), ran)
const net = await op("run", { tab: t3, script: `return await fetch(${JSON.stringify(SITE)}).then(() => "reached", () => "blocked")` })
check("… in a sandbox with no network", net?.value === '"blocked"', net)
const node = await op("run", { tab: t3, script: "return [typeof require, typeof process, location.href]" })
check("… nor Node, nor the page's world", node?.value === '["undefined","undefined","about:blank"]', node)
const failed = await op("run", { tab: t3, script: "console.log('before'); throw new Error('nope')" })
check("… a script's error, with what it logged", /the script failed: nope/.test(String(failed.error)) && /before/.test(String(failed.error)), failed)
const t0run = Date.now()
const stuck = await op("run", { tab: t3, script: "while (true) {}" })
check("… stopped at 30 s", /over 30 s/.test(String(stuck.error)) && Date.now() - t0run < 40_000, [stuck, Date.now() - t0run])
check("… and the browser still answers", !(await op("snapshot", { tab: t3 })).error, null)
const refusedRun = await op("run", { tab: mine?.tab, script: "return 1" })
check("… needing Act, as act", /may not use this tab/.test(String(refusedRun.error)), refusedRun)
const pdf = await op("pdf", { tab: t3 })
check("pdf: the page into the vault's attachments", typeof pdf?.path === "string" && pdf.path.startsWith("Attachments/") && pdf.path.endsWith(".pdf")
  && fs.readFileSync(path.join(VAULT, pdf.path)).subarray(0, 4).toString() === "%PDF", pdf)
const live = await win.evaluate(() => window.vaultite.web.engine("agents:live"))
const l3 = live.find?.((l) => l.tab === t3)
check("the cockpit's live list: the tab, its summary, last step and picture", l3?.summary === "Checking the made-up menu" && l3.task === "cockpit" && l3.step?.action === "pdf"
  && /^data:image\/jpeg;base64,/.test(l3.shot ?? ""), l3 && { ...l3, shot: l3.shot?.slice(0, 40) })
check("… past runs say their task and summary", (await runs()).some((r) => r.task === "cockpit" && r.summary === "Checking the made-up menu"), await runs())
await ui({ action: "command", id: "web:agent-runs" })
// (still at the run replayed above: back to the list)
await win.locator("[data-web-replay-steps] button", { hasText: "Runs" }).click()
check("… the view shows it live", await until(async () => (await win.locator(`[data-web-live="${t3}"] img`).count()) === 1, 5000), null)
await win.locator(`[data-web-live="${t3}"] [data-web-live-pause]`).click()
check("… Pause there pauses agents in it", await until(async () => /paused/.test(String((await op("act", { tab: t3, action: "press", key: "Tab" })).error)), 5000), null)
await win.locator(`[data-web-live="${t3}"] [data-web-live-pause="resume"]`).click()
await win.locator("[data-web-replays] input[type=search]").fill("made-up menu")
check("… runs searched by summary", await until(async () => (await win.locator("[data-web-replay]").count()) === 1, 5000), await win.locator("[data-web-replay]").count())
await op("close", { tab: t3 })

// ---------- as Claude Code over MCP (vau mcp, on stdio) ----------
/** An MCP client on stdio, as Claude Code runs `vau mcp`: its JSON-RPC calls, and a tool's result. */
function stdio(url) {
  const p = spawn(process.execPath, [path.join(ROOT, "bin/vau"), "mcp"], { env: { ...process.env, VAULTITE_URL: url, CLAUDECODE: "" }, stdio: ["pipe", "pipe", "inherit"] })
  let buf = "", n = 0
  const waiting = new Map()
  p.stdout.on("data", (d) => {
    buf += d
    for (let i; (i = buf.indexOf("\n")) >= 0; buf = buf.slice(i + 1)) { const m = JSON.parse(buf.slice(0, i)); waiting.get(m.id)?.(m); waiting.delete(m.id) }
  })
  const rpc = (method, params) => new Promise((ok) => { const id = ++n; waiting.set(id, ok); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n") })
  return { rpc, close: () => p.kill(), tool: async (name, args = {}) => (await rpc("tools/call", { name, arguments: args })).result }
}
const text = (r) => r?.content?.find((c) => c.type === "text")?.text ?? ""
const mcp = stdio(origin)
await mcp.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "1" } })
const tools = (await mcp.rpc("tools/list", {})).result?.tools?.map((t) => t.name) ?? []
const want = ["browser_tabs", "browser_open", "browser_close", "browser_snapshot", "browser_act", "browser_run", "browser_navigate", "browser_read", "browser_screenshot", "browser_pdf", "browser_wait", "browser_evaluate", "browser_ask_user"]
check("MCP: the browser's tools", want.every((t) => tools.includes(t)), tools.filter((t) => t.startsWith("browser")))
const o1 = await mcp.tool("browser_open", { url: `${SITE}/form`, task: "form test" })
const t1 = Number(/^Tab (\d+)/.exec(text(o1))?.[1])
const o2 = await mcp.tool("browser_open", { url: `${SITE}/upload`, task: "form test" })
const t2 = Number(/^Tab (\d+)/.exec(text(o2))?.[1])
check("MCP: browser_open answers its tab, each time", !o1.isError && t1 > 0 && !o2.isError && t2 > t1, [text(o1), text(o2)])
const groups = await until(async () => {
  const r = await fetch(`${origin}/api/ops/tabs.list`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((x) => x.json())
  const g = r.panes?.flatMap((p) => p.groups).find((x) => x.name === "Claude Code/form test")
  return g?.tabs === 2 ? g : null
}, 5000)
check("MCP: its two tabs in one tab group, Claude Code/form test", !!groups, groups)
const listed = text(await mcp.tool("browser_tabs", { task: "form test" }))
check("MCP: browser_tabs marks them its own, the user's as theirs", listed.split("\n").filter((l) => /\(yours\)$/.test(l)).length === 2 && /\(the user's\)/.test(listed), listed)
const snap2 = text(await mcp.tool("browser_snapshot", { tab: t1 }))
const ref2 = (re) => re.exec(snap2)?.[1]
await mcp.tool("browser_act", { tab: t1, action: "fill", ref: ref2(/textbox "Name" \[ref=(e\d+)\]/), value: "Bob" })
const sent2 = await mcp.tool("browser_act", { tab: t1, action: "click", ref: ref2(/button "Send" \[ref=(e\d+)\]/) })
check("MCP: a form filled and sent", /Went to another page/.test(text(sent2)), text(sent2))
const found = text(await mcp.tool("browser_read", { tab: t1, find: "hello bob" }))
check("MCP: browser_read finds a line", /^1: Hello Bob, Small$/m.test(found), found)
const shot2 = await mcp.tool("browser_screenshot", { tab: t1 })
const img = shot2?.content?.find((c) => c.type === "image")
check("MCP: browser_screenshot is a picture", img?.mimeType === "image/png" && Buffer.from(img.data, "base64").subarray(1, 4).toString() === "PNG", shot2?.content?.map((c) => c.type))
const tabsNow = await op("tabs")
check("… of a tab in the background too", tabsNow.find?.((t) => t.tab === t1)?.shown === false && !shot2.isError, tabsNow)
const snap3 = text(await mcp.tool("browser_snapshot", { tab: t2 }))
const fileRef = /button "Document" \[ref=(e\d+)\]/.exec(snap3)?.[1] ?? /\[ref=(e\d+)\]/.exec(snap3)?.[1]
const up = await mcp.tool("browser_act", { tab: t2, action: "upload", ref: fileRef, files: ["Attachments/cv.txt"] })
check("MCP: a vault file uploaded into a file input", !up.isError && await until(async () => /Picked cv\.txt, 20 bytes/.test(text(await mcp.tool("browser_read", { tab: t2 }))), 5000), [text(up), snap3])
const ev = await mcp.tool("browser_evaluate", { tab: t2, expression: "({ title: document.title, page: typeof window.secretOfThePage })" })
check("MCP: an expression in its own world: the DOM, not the page's scripts", text(ev) === '{"title":"Upload","page":"undefined"}', text(ev))
const linkRef = /link "The log book" \[ref=(e\d+)\]/.exec(text(await mcp.tool("browser_snapshot", { tab: t2 })))?.[1]
const dl = text(await mcp.tool("browser_act", { tab: t2, action: "click", ref: linkRef }))
check("MCP: a click that downloads says where it went", dl.includes(`Downloaded log book.txt to ${path.join(DOWNLOADS, "log book.txt")}`), dl)
const asked = await mcp.tool("browser_ask_user", { tab: t1, reason: "Sign in to the made-up site" })
check("MCP: asking the user: its bar says so", !asked.isError && await until(async () => /Claude Code needs you:\s*Sign in to the made-up site/.test(await win.locator("[data-web-agent-ask]").innerText().catch(() => "")), 5000), text(asked))
const events = await fetch(`${origin}/api/inbox/events?local=1`).then((r) => r.json())
check("… and the Inbox", events.events?.some((e) => e.source === "browser" && e.kind === "waiting" && /Sign in/.test(e.body)), events.events?.slice(0, 3))
const waited2 = mcp.tool("browser_wait", { tab: t1, helped: true, timeout: 20 })
await wait(500)
const t0 = Date.now()
await win.locator("[data-web-agent-done]").click()
const w2 = await waited2
check("… its Done ends the agent's wait at once", !w2.isError && Date.now() - t0 < 3000, [text(w2), Date.now() - t0])
const after = await fetch(`${origin}/api/inbox/events?local=1`).then((r) => r.json())
check("… and its Inbox event goes", !after.events?.some((e) => e.source === "browser" && /Sign in/.test(e.body ?? "")), after.events?.slice(0, 3))
const userTab = (await op("tabs")).find((t) => t.url.endsWith("?mine"))
const notMine = await mcp.tool("browser_close", { tab: userTab.tab })
check("MCP: closing the user's tab is refused", notMine.isError && /the user's/.test(text(notMine)), text(notMine))
const closed = await mcp.tool("browser_close", { tab: t2 })
check("MCP: its own tab closes", !closed.isError && !(await op("tabs")).some((t) => t.tab === t2), text(closed))

// ---------- a server on another machine (its own TMPDIR) with no desktop app: a laptop's app doesn't answer it ----------
const PLAIN = 20000 + Math.floor(Math.random() * 20000)
fs.mkdirSync(path.join(TMP, "run-plain"))
const plain = testServer({ stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: path.join(TMP, "local-plain"), HOST: "127.0.0.1", PORT: String(PLAIN), VAULTITE_DESKTOP: "", TMPDIR: path.join(TMP, "run-plain"), XDG_RUNTIME_DIR: path.join(TMP, "run-plain") } })
let plainOut = ""
plain.stdout.on("data", (d) => { plainOut += d })
plain.stderr.on("data", (d) => { plainOut += d })
await until(() => /vaultite on http/.test(plainOut), 60000)
const machinesFile = path.join(VAULT, ".vaultite/plugins/machines/data.json")
fs.mkdirSync(path.dirname(machinesFile), { recursive: true })
const list = (ms) => fs.writeFileSync(machinesFile, JSON.stringify({ machines: ms }))
list([{ id: "plain", label: "Plain", url: `http://127.0.0.1:${PLAIN}` }])
const http2 = async (name, args) => {
  const r = await fetch(`http://127.0.0.1:${PLAIN}/api/mcp`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }).then((x) => x.json())
  return r.result
}
const none = await http2("browser_tabs", {})
check("no desktop app: says none is attached", none?.isError && /none is attached to this server/.test(text(none)), text(none))
list([{ id: "plain", label: "Plain", url: `http://127.0.0.1:${PLAIN}` }, { id: "desk", label: "Desk", url: origin }])
const relayed = await http2("browser_tabs", {})
check("a laptop's desktop app listed in Machines: answers only its own agents", relayed?.isError && /Desk \(a laptop's app/.test(text(relayed)), text(relayed))
plain.kill()
mcp.close()

const held = (await fetch(`${origin}/api/ops/errors.list`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json())).groups ?? []
check("agents' calls never held the vault's writes", !held.some((g) => /vault: held/.test(g.message)), held.map((g) => g.message))
console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
