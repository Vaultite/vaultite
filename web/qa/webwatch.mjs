// Claude Code on the web's sessions (electron/web.ts, CLOUD), end to end on a throwaway vault, against a made-up
// claude.ai this script serves on 127.0.0.1 (VAULTITE_TEST_CLAUDE_URL): its /code page signs in (a cookie), its
// /v1/code/sessions lists the sessions (only with the cookie and an anthropic-version header). Before signing in nothing
// is asked or listed; signed in, the Terminals tab lists them under Cloud and a click opens one in a web tab. A session
// going running -> idle is "Claude Code finished" in the Inbox (named by the session, linking to it), -> requires_action
// "Claude Code needs you"; idle -> running and a first sighting are no news; nothing with notifications off; after a
// restart, no claude.ai page open, they're read with the logins alone; restarted in workspace 2, workspace 1's logins too.
// WRITES: the throwaway vault only.
//   node web/qa/webwatch.mjs <vault copy> [port for the made-up claude.ai, default 8863]
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT, PORT_ARG], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-webwatch-"))
const PORT = Number(PORT_ARG || 8863)
const SITE = `http://127.0.0.1:${PORT}`

// ---------- a made-up claude.ai ----------
const sessions = [
  { id: "session_a", title: "Fix the build", session_status: "idle", updated_at: new Date(Date.now() - 120_000).toISOString() },
  { id: "session_b", title: "Write the docs", session_status: "idle", updated_at: new Date(Date.now() - 60_000).toISOString() },
]
let asked = 0
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/v1/code/sessions")) {
    asked++
    const ok = /(^|; )sessionKey=test/.test(req.headers.cookie ?? "") && req.headers["anthropic-version"]
    res.writeHead(ok ? 200 : 401, { "Content-Type": "application/json" })
    return res.end(JSON.stringify(ok ? { data: sessions, resume_token: "" } : { error: { type: "authentication_error" } }))
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...(req.url.startsWith("/code") ? { "Set-Cookie": "sessionKey=test; Path=/; Max-Age=86400" } : {}) })
  res.end(req.url.startsWith("/code") ? "<!doctype html><title>Claude Code</title><main>Signed in</main>" : `<!doctype html><title>Other ${req.url}</title><p>Another page</p>`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(PORT, "127.0.0.1", ok) })
/** A session's status as claude.ai would say it. */
const setState = (id, status) => { const s = sessions.find((x) => x.id === `session_${id}`); s.session_status = status; s.updated_at = new Date().toISOString() }
// Workspaces on (the calm sandbox has it off): pages' logins are per workspace.
const pluginsFile = path.join(VAULT, ".vaultite/plugins.json")
if (fs.existsSync(pluginsFile)) {
  const p = JSON.parse(fs.readFileSync(pluginsFile, "utf8"))
  fs.writeFileSync(pluginsFile, JSON.stringify({ ...p, disabled: (p.disabled ?? []).filter((x) => x !== "workspaces") }, null, 2) + "\n")
}
fs.mkdirSync(path.join(VAULT, "Notes"), { recursive: true })
fs.writeFileSync(path.join(VAULT, "Notes/Code.md"), `# Code\n\n[code](${SITE}/code) [other](${SITE}/other)\n`)

// ---------- the app ----------
let app, win, origin
async function launch() {
  app = await _electron.launch({
    executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
    env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_TEST_CLAUDE_URL: SITE, VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
  })
  win = await app.firstWindow()
  watch(win, { console: true, fail: false })
  await win.waitForSelector("[role=tree]", { timeout: 60000 })
  origin = new URL(win.url()).origin
}
await launch()
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }) })
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const events = async () => (await (await fetch(`${origin}/api/inbox/events?limit=100`)).json()).events
const titled = async (t) => (await events()).filter((e) => e.title === t)
const setting = (o) => fetch(`${origin}/api/config/plugin/web-viewer`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) })
/** Every web page over the window. */
const all = () => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  return w.contentView.children.filter((x) => x.webContents && x.webContents !== w.webContents).map((v) => ({ url: v.webContents.getURL(), visible: v.getVisible() }))
})
/** The Cloud rows in the Terminals tab: [id, state]. */
const rows = () => win.$$eval("[data-cloud]", (els) => els.map((e) => [e.getAttribute("data-cloud"), e.getAttribute("data-state")]))
/** Open the note's nth web link (a web tab). */
async function openLink(n) {
  await ui({ action: "open", path: "Notes/Code.md" })
  await win.waitForSelector("section [data-pane] .cm-link[data-url]", { timeout: 15000 })
  await win.locator(".cm-line", { hasText: "Code" }).first().click()
  await wait(300)
  await win.locator("section [data-pane] .cm-link[data-url]").nth(n).click()
  await win.mouse.move(5, 400)
}

await ui({ action: "command", id: "terminal:open-list" })
await wait(4000)
check("not signed in: nothing asked, no Cloud rows", asked === 0 && (await rows()).length === 0, { asked, rows: await rows() })

await openLink(0)
check("the made-up claude.ai page opens (signing in)", await until(async () => (await all()).some((p) => p.url === `${SITE}/code` && p.visible), 15000), await all())
await ui({ action: "command", id: "terminal:open-list" })
check("signed in: the Terminals tab lists them under Cloud", await until(async () => (await rows()).length === 2, 10000), await rows())
check("… most recent first", JSON.stringify((await rows()).map((r) => r[0])) === JSON.stringify(["session_b", "session_a"]), await rows())

setState("a", "running")
check("running: its row says so, first", await until(async () => JSON.stringify((await rows())[0]) === JSON.stringify(["session_a", "running"]), 8000), await rows())
check("idle -> running: no news", (await events()).filter((e) => e.title?.startsWith("Claude Code")).length === 0, await events())
setState("a", "idle")
check("running -> idle: \"Claude Code finished\"", await until(async () => (await titled("Claude Code finished")).length === 1, 8000), await events())
const finished = (await titled("Claude Code finished"))[0]
check("… named by the session, linking to it, kind done", finished?.body === "Fix the build" && finished?.link === `view:web/${SITE}/code/session_a` && finished?.kind === "done" && finished?.source === "127.0.0.1", finished)
setState("b", "requires_action")
check("requires_action: \"Claude Code needs you\"", await until(async () => (await titled("Claude Code needs you")).length === 1, 8000), await events())
check("… its row waits", await until(async () => (await rows()).some((r) => r[0] === "session_b" && r[1] === "waiting"), 8000), await rows())
await win.locator("[data-cloud=session_b]").first().click()
check("a click opens it in a web tab", await until(async () => (await all()).some((p) => p.url === `${SITE}/code/session_b` && p.visible), 15000), await all())
await ui({ action: "command", id: "terminal:open-list" })
await setting({ notifications: false })
await wait(1500)
const count = (await events()).length
setState("b", "running")
await wait(3000)
setState("b", "idle")
await wait(3000)
check("notifications off: none", (await events()).length === count, await events())
await setting({ notifications: null })

// A restart with another tab in front: no claude.ai page, read with the logins alone.
await openLink(1)
await until(async () => (await all()).some((p) => p.url === `${SITE}/other` && p.visible), 10000)
await app.close()
await launch()
await wait(2000)
check("after a restart: no claude.ai page", !(await all()).some((p) => p.url.startsWith(`${SITE}/code`)), await all())
const since = Date.now()
setState("a", "running")
await wait(4000)
setState("a", "idle")
// (the Inbox keeps one event a session: this news replaces the last)
check("… and still read", await until(async () => (await titled("Claude Code finished")).some((e) => e.body === "Fix the build" && e.t >= since), 10000), await events())

// Restarted in another workspace: workspace 1's logins are read too, saying whose.
await ui({ action: "command", id: "workspace:2" })
await wait(1500)
await app.close()
await launch()
await wait(3000)
setState("b", "running")
await wait(4000)
setState("b", "idle")
check("in workspace 2: workspace 1's sessions too, saying whose", await until(async () => (await events()).some((e) => e.body === "Write the docs · In workspace 1"), 10000), await events())

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
