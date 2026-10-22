// Cloud sessions (plugins/core/cloud-sessions, electron/web.ts CLOUD), end to end on a throwaway vault, against a
// made-up claude.ai this script serves on 127.0.0.1 (VAULTITE_TEST_CLAUDE_URL): its /code page signs a profile in (a
// cookie: ?as=team, the team's login), /api/organizations and /v1/sessions answer as claude.ai's do. Signed out, nothing
// is asked and the panel says nothing; signed in, it asks first, and nothing is read till the yes. Then every account
// shows under its name (a personal one by its email, a team's by its name; an API-only one never asked, one turned away
// not listed), news reaches the Inbox (running -> idle "finished", -> requires_action "needs you"; none with
// notifications off), a click opens a session in its own logins, a hidden account isn't read, and after a restart
// they're read from the start.
// WRITES: the throwaway vault only.
//   node web/qa/webwatch.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-webwatch-"))

// ---------- a made-up claude.ai ----------
const ago = (ms) => new Date(Date.now() - ms).toISOString()
/** Each login's organizations: Alice's own, an API-only one, and a team's; another team without Claude Code. */
const LOGINS = {
  alice: [{ uuid: "org-alice", name: "alice@example.com's Organization", capabilities: ["chat", "claude_max"] }, { uuid: "org-api", name: "Lighthouse API", capabilities: ["api"] }],
  team: [{ uuid: "org-team", name: "Lighthouse", capabilities: ["chat"] }, { uuid: "org-nocode", name: "Harbor", capabilities: ["chat"] }],
}
const sessions = {
  "org-alice": [
    { id: "session_a", title: "Fix the build", session_status: "idle", updated_at: ago(120_000) },
    { id: "session_b", title: "Write the docs", session_status: "idle", updated_at: ago(60_000) },
  ],
  "org-team": [{ id: "session_t", title: "Ship the release", session_status: "idle", updated_at: ago(30_000) }],
}
/** What claude.ai was asked, by organization ("orgs": the organizations' list). */
let asked = {}
const count = (k) => (k ? asked[k] ?? 0 : Object.values(asked).reduce((a, b) => a + b, 0))
const server = http.createServer((req, res) => {
  const login = /(^|; )sessionKey=(\w+)/.exec(req.headers.cookie ?? "")?.[2]
  const json = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)) }
  if (req.url.startsWith("/api/organizations")) {
    asked.orgs = count("orgs") + 1
    return LOGINS[login] ? json(200, LOGINS[login]) : json(401, { error: { type: "authentication_error" } })
  }
  if (req.url.startsWith("/v1/sessions")) {
    const org = req.headers["x-organization-uuid"]
    asked[org] = count(org) + 1
    if (!LOGINS[login]) return json(401, { error: { type: "authentication_error" } })
    const ok = req.headers["anthropic-version"] && /ccr-byoc/.test(req.headers["anthropic-beta"] ?? "") && LOGINS[login].some((o) => o.uuid === org)
    if (!ok || !sessions[org]) return json(403, { error: { type: "permission_error" } })
    return json(200, { data: sessions[org], has_more: false })
  }
  const as = new URL(req.url, "http://x").searchParams.get("as") ?? "alice"
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...(req.url.startsWith("/code") && !req.url.startsWith("/code/") ? { "Set-Cookie": `sessionKey=${as}; Path=/; Max-Age=86400` } : {}) })
  res.end(req.url.startsWith("/code") ? "<!doctype html><title>Claude Code</title><main>Signed in</main>" : `<!doctype html><title>Other ${req.url}</title><p>Another page</p>`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const PORT = server.address().port
const SITE = `http://127.0.0.1:${PORT}`
/** A session's status as claude.ai would say it. */
const setState = (id, status) => { const s = Object.values(sessions).flat().find((x) => x.id === `session_${id}`); s.session_status = status; s.updated_at = new Date().toISOString() }
// The Browser and workspaces on (both off by default).
const pluginsFile = path.join(VAULT, ".vaultite/plugins.json")
const p = fs.existsSync(pluginsFile) ? JSON.parse(fs.readFileSync(pluginsFile, "utf8")) : {}
fs.mkdirSync(path.dirname(pluginsFile), { recursive: true })
fs.writeFileSync(pluginsFile, JSON.stringify({ ...p, enabled: [...(p.enabled ?? []).filter((x) => x !== "workspaces" && x !== "web-viewer"), "workspaces", "web-viewer"] }, null, 2) + "\n")

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
await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }) })
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const events = async () => (await (await fetch(`${origin}/api/inbox/events?limit=100`)).json()).events
const titled = async (t) => (await events()).filter((e) => e.title === t)
const setting = (id, o) => fetch(`${origin}/api/config/plugin/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) })
/** Every web page over the window, with its logins (the profile its partition is named for). */
const all = () => app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0]
  return w.contentView.children.filter((x) => x.webContents && x.webContents !== w.webContents)
    .map((v) => ({ url: v.webContents.getURL(), visible: v.getVisible(), profile: (v.webContents.session.storagePath ?? "").split("/").pop() }))
})
/** The rows in the Cloud sessions tab: [id, state]; the accounts' names over them. */
const rows = () => win.$$eval("[data-cloud-view] [data-cloud]", (els) => els.map((e) => [e.getAttribute("data-cloud"), e.getAttribute("data-state")]))
const named = () => win.$$eval("[data-cloud-view] [data-cloud-heading]", (els) => els.map((e) => e.textContent))
const list = () => ui({ action: "command", id: "cloud-sessions:open-list" })

await list()
await wait(4000)
check("signed out: nothing asked, no rows, no question", count() === 0 && (await rows()).length === 0 && !(await win.$("[data-cloud-ask]")), { asked, rows: await rows() })

await ui({ action: "open", path: `view:web/${SITE}/code`, newTab: true })
check("the made-up claude.ai page opens (signing in)", await until(async () => (await all()).some((p) => p.url === `${SITE}/code` && p.visible), 15000), await all())
await list()
check("signed in: it asks first", await until(async () => !!(await win.$("[data-cloud-view] [data-cloud-ask]")), 10000))
check("… and nothing was read", count() === 0, asked)
await win.locator("[data-cloud-view] [data-cloud-ask] button", { hasText: "Show them" }).click()
check("yes: the sessions show", await until(async () => (await rows()).length === 2, 10000), await rows())
check("… most recent first", JSON.stringify((await rows()).map((r) => r[0])) === JSON.stringify(["session_b", "session_a"]), await rows())
check("… the API-only organization is never asked", count("org-api") === 0 && count("org-alice") > 0, asked)
check("… one account: no names over them", (await named()).length === 0, await named())

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
await setting("web-viewer", { notifications: false })
await wait(1500)
const before = (await events()).length
setState("b", "running")
await wait(3000)
setState("b", "idle")
await wait(3000)
check("notifications off: none", (await events()).length === before, await events())
await setting("web-viewer", { notifications: null })

// The team's login in the Work container: a second account, under its name; the team without Claude Code isn't listed.
await ui({ action: "open", path: `view:web/@work/${SITE}/code?as=team`, newTab: true })
check("the team signs in in Work", await until(async () => (await all()).some((p) => p.url === `${SITE}/code?as=team` && p.profile === "web-c-work"), 15000), await all())
await list()
check("two accounts, each under its name", await until(async () => JSON.stringify(await named()) === JSON.stringify(["alice@example.com", "Lighthouse"]), 10000), await named())
check("… the team's session with them", await until(async () => (await rows()).some((r) => r[0] === "session_t"), 8000), await rows())
check("… the organization without Claude Code isn't listed", !(await named()).includes("Harbor") && count("org-nocode") === 1, { named: await named(), asked })
await win.locator("[data-cloud-view] [data-cloud=session_t]").first().click()
check("a click opens it in its own logins (Work's)", await until(async () => (await all()).some((p) => p.url === `${SITE}/code/session_t` && p.visible && p.profile === "web-c-work"), 15000), await all())
await list()
await win.locator("[data-cloud-view] [data-cloud=session_b]").first().click()
check("… and Alice's in the workspace's", await until(async () => (await all()).some((p) => p.url === `${SITE}/code/session_b` && p.visible && p.profile === "web"), 15000), await all())

await setting("cloud-sessions", { hidden: ["Lighthouse"] })
await list()
check("hidden: its rows go", await until(async () => !(await rows()).some((r) => r[0] === "session_t") && JSON.stringify(await named()) === JSON.stringify([]), 8000), { rows: await rows(), named: await named() })
const team = count("org-team")
await wait(4000)
check("… and it isn't read", count("org-team") === team, asked)
await setting("cloud-sessions", { hidden: null })

// A restart with another tab in front: said yes, so they're read from the start, no claude.ai page needed.
await ui({ action: "open", path: "view:terminals", newTab: true })
await app.close()
asked = {}
await launch()
await list()
check("after a restart: read from the start", await until(async () => (await rows()).length === 3, 15000), { rows: await rows(), asked })
check("… with no claude.ai page open", !(await all()).some((p) => p.url.startsWith(`${SITE}/code`)), await all())

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
