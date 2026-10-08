// The Web viewer watching work in a page (electron/web.ts, WATCH: Claude Code on the web), end to end on a throwaway
// vault, against a made-up page this script serves on 127.0.0.1 standing in for claude.ai/code (a sidebar of sessions,
// each with a status icon named for its state; VAULTITE_TEST_CLAUDE_HOST). With the page in a hidden tab: a session
// going Running -> Unread response is "Claude Code finished" in the Inbox (named by the session, linking to it), Awaiting
// input "needs your approval", Awaiting answer "has a question"; Idle -> Done and a session first seen are no news;
// nothing with notifications off; the page outlives other web pages let go of (KEEP); and after a restart, with its
// tab not shown, it gets a page and is read, in another workspace too.
// WRITES: the throwaway vault only.
//   node web/qa/webwatch.mjs <vault copy> [port for the page, default 8863]
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

// ---------- a made-up Claude Code page, and other pages ----------
const CODE = `<!doctype html><title>Claude Code</title><body>
<aside aria-label="Sidebar">
  <a href="/code/session_a"><span role="img" aria-label="Idle"></span>Fix the build</a>
  <a href="/code/session_b"><span role="img" aria-label="Idle"></span>Write the docs</a>
</aside><main>Session</main>
<script>window.setState = (s, state) => document.querySelector('a[href="/code/session_' + s + '"] [aria-label]').setAttribute("aria-label", state)</script>`
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(req.url.startsWith("/code") ? CODE : `<!doctype html><title>Other ${req.url}</title><p>Another page</p>`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(PORT, "127.0.0.1", ok) })
// Workspaces on (the calm sandbox has it off): pages' logins are per workspace.
const pluginsFile = path.join(VAULT, ".vaultite/plugins.json")
if (fs.existsSync(pluginsFile)) {
  const p = JSON.parse(fs.readFileSync(pluginsFile, "utf8"))
  fs.writeFileSync(pluginsFile, JSON.stringify({ ...p, disabled: (p.disabled ?? []).filter((x) => x !== "workspaces") }, null, 2) + "\n")
}
fs.mkdirSync(path.join(VAULT, "Notes"), { recursive: true })
fs.writeFileSync(path.join(VAULT, "Notes/Code.md"), `# Code\n\n[code](${SITE}/code) ${[1, 2, 3, 4, 5].map((n) => `[other ${n}](${SITE}/other${n})`).join(" ")}\n`)

// ---------- the app ----------
let app, win, origin
async function launch() {
  app = await _electron.launch({
    executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
    env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_TEST_CLAUDE_HOST: "127.0.0.1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
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
/** Set a session's state on the made-up page, wherever it is. */
const setState = (s, state) => app.evaluate(({ BrowserWindow }, [s, state, url]) => {
  const w = BrowserWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.webContents.getURL() === url)
  return v ? v.webContents.executeJavaScript(`setState(${JSON.stringify(s)}, ${JSON.stringify(state)}); 1`) : null
}, [s, state, `${SITE}/code`])
/** Open the note's nth web link (a web tab). */
async function openLink(n) {
  await ui({ action: "open", path: "Notes/Code.md" })
  await win.waitForSelector("section [data-pane] .cm-link[data-url]", { timeout: 15000 })
  await win.locator(".cm-line", { hasText: "Code" }).first().click()
  await wait(300)
  await win.locator("section [data-pane] .cm-link[data-url]").nth(n).click()
  await win.mouse.move(5, 400)
}

await openLink(0)
check("the made-up Claude Code page opens", await until(async () => (await all()).some((p) => p.url === `${SITE}/code` && p.visible), 15000), await all())
await wait(4000) // (read once: where things stand)
await ui({ action: "command", id: "web:pages-tab" }) // (another tab in front: the page is hidden, still read)
await until(async () => !(await all()).some((p) => p.visible), 10000)

await setState("a", "Running")
await wait(4000)
await setState("a", "Unread response")
check("Running -> Unread response: \"Claude Code finished\"", await until(async () => (await titled("Claude Code finished")).length === 1, 8000), await events())
const finished = (await titled("Claude Code finished"))[0]
check("… named by the session, linking to it, kind done", finished?.body === "Fix the build" && finished?.link === `view:web/${SITE}/code/session_a` && finished?.kind === "done" && finished?.source === "127.0.0.1", finished)
await setState("b", "Awaiting input")
check("Awaiting input: \"needs your approval\"", await until(async () => (await titled("Claude Code needs your approval")).length === 1, 8000), await events())
await setState("a", "Awaiting answer")
check("Awaiting answer: \"has a question\"", await until(async () => (await titled("Claude Code has a question")).some((e) => e.body === "Fix the build"), 8000), await events())
const count = (await events()).length
await setState("b", "Idle")
await wait(4000)
await setState("b", "Done")
await wait(4000)
check("Awaiting -> Idle -> Done: no news", (await events()).length === count, await events())
await setting({ notifications: false })
await wait(1500)
await setState("b", "Running")
await wait(4000)
await setState("b", "Unread response")
await wait(4000)
check("notifications off: none", (await titled("Claude Code finished")).length === 1, await events())
await setting({ notifications: null })

// Other web pages let go of: the watched one stays.
for (let n = 1; n <= 5; n++) { await openLink(n); await until(async () => (await all()).some((p) => p.url === `${SITE}/other${n}` && p.visible), 10000) }
await ui({ action: "command", id: "web:pages-tab" })
await wait(1500)
check("the watched page outlives other pages let go of", (await all()).some((p) => p.url === `${SITE}/code`), await all())

// A restart, its tab not the one shown: it gets a page anyway, and is read.
await app.close()
await launch()
check("after a restart, the watched tab not shown: it gets a page", await until(async () => (await all()).some((p) => p.url === `${SITE}/code` && !p.visible), 15000), await all())
await wait(4000)
await setState("b", "Running")
await wait(4000)
await setState("b", "Unread response")
check("… and is read", await until(async () => (await titled("Claude Code finished")).some((e) => e.body === "Write the docs"), 8000), await events())

// Restarted in another workspace: workspace 1's watched tab gets a page too (its logins), and is read.
await ui({ action: "command", id: "workspace:2" })
await wait(1500)
await app.close()
await launch()
check("after a restart in workspace 2: workspace 1's watched tab gets a page", await until(async () => (await all()).some((p) => p.url === `${SITE}/code`), 15000), await all())
await wait(4000)
await setState("a", "Running")
await wait(4000)
await setState("a", "Unread response")
check("… and is read, saying whose", await until(async () => (await events()).some((e) => e.body === "Fix the build · In workspace 1"), 8000), await events())

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
