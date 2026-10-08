// The Web viewer's logins in the desktop app (Electron), end to end on a throwaway vault, against a made-up site this
// script serves on 127.0.0.1 (a cookie login): signed in on a page in workspace 1, a page in workspace 2 isn't (its own
// session, persist:web-2) and workspace 1 still is (persist:web, the one pages shared before); the Web pages panel (in
// a tab) lists the open pages and the site signed in to (a tracker's cookie as one line, Clear), and Sign out (after
// asking) clears it; with logins "shared", a page in workspace 2 gets workspace 1's session. Notifications: a page's becomes an Inbox event linking to its tab
// (one from another workspace's logins says so and links nowhere), a frame inside the page can't make one, none with
// notifications off, and a burst is cut short.
// WRITES: the throwaway vault only.
//   node web/qa/weblogins.mjs <vault copy> [port for the site, default 8862]
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT, PORT_ARG], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-weblogins-"))
const PORT = Number(PORT_ARG || 8862)
const SITE = `http://127.0.0.1:${PORT}`
const awake = (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "600"], { stdio: "ignore" })
process.on("exit", () => awake.kill())

// ---------- a made-up site with a cookie login ----------
const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? "/", SITE)
  const who = /(?:^|; )who=([^;]+)/.exec(req.headers.cookie ?? "")?.[1]
  const headers = { "Content-Type": "text/html; charset=utf-8" }
  if (u.pathname === "/login") headers["Set-Cookie"] = `who=${u.searchParams.get("u")}; Path=/; Max-Age=3600`
  // (a tracker's pixel: another site's cookie, left by this site's page)
  if (u.pathname === "/pixel") { res.writeHead(200, { "Content-Type": "image/gif", "Set-Cookie": "trk=1; Path=/; Max-Age=3600; SameSite=None; Secure" }); return res.end() }
  res.writeHead(200, headers)
  res.end(`<!doctype html><title>Who</title><p id="who">${u.pathname === "/login" ? `signed in` : `who:${who ?? "nobody"}`}</p>${u.pathname === "/login" ? `<img src="http://localhost:${PORT}/pixel" alt="">` : ""}`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(PORT, "127.0.0.1", ok) })
// Workspaces on (the calm sandbox has it off): pages' logins are per workspace.
const pluginsFile = path.join(VAULT, ".vaultite/plugins.json")
if (fs.existsSync(pluginsFile)) {
  const p = JSON.parse(fs.readFileSync(pluginsFile, "utf8"))
  fs.writeFileSync(pluginsFile, JSON.stringify({ ...p, disabled: (p.disabled ?? []).filter((x) => x !== "workspaces") }, null, 2) + "\n")
}
fs.mkdirSync(path.join(VAULT, "Notes"), { recursive: true })
fs.writeFileSync(path.join(VAULT, "Notes/Site.md"), `# Site\n\nSee [who](${SITE}/whoami) and [who again](${SITE}/whoami?again).\n`)

// ---------- the app ----------
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus() })
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const command = async (id) => { await ui({ action: "command", id }); await wait(700) }

/** The visible web page: its address, what it says, and its session's partition. */
const visible = () => app.evaluate(async ({ BrowserWindow, session }) => {
  const w = BrowserWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  if (!v) return null
  const parts = ["persist:web", "persist:web-2", "persist:web-3"]
  const partition = parts.find((p) => session.fromPartition(p) === v.webContents.session) ?? "?"
  const text = await v.webContents.executeJavaScript("document.getElementById('who')?.textContent ?? ''")
  return { url: v.webContents.getURL(), text, partition }
})
const cookiesIn = (partition) => app.evaluate(async ({ session }, p) => (await session.fromPartition(p).cookies.get({})).map((c) => `${c.name}=${c.value}`), partition)
/** Open the note and click its nth web link (a web tab, in the current workspace). */
async function openLink(n) {
  await ui({ action: "open", path: "Notes/Site.md" })
  await win.waitForSelector("section [data-pane] .cm-link[data-url]", { timeout: 15000 })
  await win.locator(".cm-line", { hasText: "Site" }).first().click()
  await wait(300)
  await win.locator("section [data-pane] .cm-link[data-url]").nth(n).click()
  await win.mouse.move(5, 400) // (off the link: its preview would cover the page)
}
/** Every web page over the window (for a failure's message). */
const all = () => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  return w.contentView.children.filter((x) => x.webContents && x.webContents !== w.webContents).map((v) => ({ url: v.webContents.getURL(), visible: v.getVisible() }))
})
const inPage = (code) => app.evaluate(({ BrowserWindow }, code) => {
  const w = BrowserWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  return v ? v.webContents.executeJavaScript(code) : null
}, code)

// ---------- workspace 1: sign in ----------
await openLink(0)
check("workspace 1: a web page in persist:web", await until(async () => (await visible())?.partition === "persist:web", 15000), [await visible(), await all(), await win.evaluate(() => [...document.querySelectorAll("[role=tab]")].map((t) => t.textContent))])
await inPage(`location.href = ${JSON.stringify(`${SITE}/login?u=Alice`)}`)
await until(async () => (await visible())?.text === "signed in", 10000)
await inPage(`location.href = ${JSON.stringify(`${SITE}/whoami`)}`)
check("… signed in there", await until(async () => (await visible())?.text === "who:Alice", 10000), await visible())

// ---------- the panel, in a tab ----------
await command("web:pages-tab")
check("Web pages: the open page", await until(async () => (await win.locator("[data-web-pages-panel] [data-web-page-row]").count()) === 1, 10000), await win.locator("[data-web-pages-panel]").innerText().catch(() => ""))
check("… and the site signed in to", await until(async () => (await win.locator("[data-web-pages-panel] [data-web-site='127.0.0.1']").count()) === 1, 10000),
  await win.locator("[data-web-pages-panel]").innerText().catch(() => ""))
check("… a tracker's cookie as a tracker, not a site", await until(async () => (await win.locator("[data-web-pages-panel] [data-web-trackers='1']").count()) === 1
  && (await win.locator("[data-web-pages-panel] [data-web-site='localhost']").count()) === 0, 10000), await win.locator("[data-web-pages-panel]").innerText().catch(() => ""))
await win.locator("[data-web-trackers]").click()
await win.locator("dialog[open] button", { hasText: "Clear" }).click()
check("Clear: the tracker's cookie goes, the site's stays", await until(async () => (await win.locator("[data-web-trackers]").count()) === 0, 10000)
  && (await cookiesIn("persist:web")).join() === "who=Alice", await cookiesIn("persist:web"))

// ---------- workspace 2: logins of its own ----------
await command("workspace:2")
await openLink(0)
check("workspace 2: a web page in persist:web-2", await until(async () => (await visible())?.partition === "persist:web-2", 15000), await visible())
check("… not signed in", await until(async () => (await visible())?.text === "who:nobody", 10000), await visible())
await command("web:pages-tab")
check("… its panel: its page, no sites", await until(async () => (await win.locator("[data-web-pages-panel] [data-web-page-row]").count()) === 1
  && (await win.locator("[data-web-pages-panel] [data-web-site]").count()) === 0, 10000), await win.locator("[data-web-pages-panel]").innerText().catch(() => ""))
check("workspace 1's logins kept", (await cookiesIn("persist:web")).includes("who=Alice"), await cookiesIn("persist:web"))

// ---------- sign out, in workspace 1 ----------
await command("workspace:1")
await until(async () => (await win.locator("[data-web-pages-panel] [data-web-site='127.0.0.1']").count()) === 1, 10000)
await win.locator("[data-web-site='127.0.0.1']").hover()
await win.locator("[aria-label='Sign out of 127.0.0.1']").click()
check("Sign out asks first", await until(async () => (await win.locator("dialog[open]").count()) > 0, 10000), null)
await win.locator("dialog[open] button", { hasText: "Sign out" }).click()
check("… then the site's cookies go", await until(async () => !(await cookiesIn("persist:web")).includes("who=Alice"), 10000), await cookiesIn("persist:web"))
check("… and it leaves the panel", await until(async () => (await win.locator("[data-web-pages-panel] [data-web-site]").count()) === 0, 10000), null)

// ---------- logins shared ----------
await fetch(`${origin}/api/config/plugin/web-viewer`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ logins: "shared" }) })
await wait(1500)
await command("workspace:2")
await openLink(1)
check("logins shared: a new page in workspace 2 is in persist:web", await until(async () => (await visible())?.url.endsWith("?again") && (await visible())?.partition === "persist:web", 15000), await visible())

// ---------- notifications ----------
const events = async () => (await (await fetch(`${origin}/api/inbox/events?limit=100`)).json()).events
const eventNamed = async (title) => (await events()).find((e) => e.title === title)
const setting = (o) => fetch(`${origin}/api/config/plugin/web-viewer`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) })
check("a page sees notifications granted", await inPage("Notification.permission") === "granted", await inPage("Notification.permission"))
const page = `${SITE}/whoami?again`
/** Run JavaScript in the page at `page`, on screen or not. */
const inThat = (code) => app.evaluate(({ BrowserWindow }, [code, url]) => {
  const w = BrowserWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.webContents.getURL() === url)
  return v ? v.webContents.executeJavaScript(code) : null
}, [code, page])
await inThat(`new Notification("Looked at"); 1`)
await wait(1500)
check("while you're looking at the page: none", !(await eventNamed("Looked at")), await events())
await command("web:pages-tab") // (another tab in front: the page is put away, and still runs)
await inThat(`new Notification("Build done", { body: "All green" }); 1`)
check("a page's notification: an Inbox event", await until(async () => !!(await eventNamed("Build done")), 10000), await events())
const ev = await eventNamed("Build done")
check("… its body, its site, linking to its tab", ev?.body === "All green" && ev?.source === "127.0.0.1" && ev?.link === `view:web/${page}`, ev)
await inThat(`const f = document.createElement("iframe"); f.srcdoc = '<script>console.debug("__vaultite_notify__" + JSON.stringify({ title: "From a frame" }))<\\/script>'; document.body.append(f); 1`)
await wait(1500)
check("a frame in the page can't make one", !(await eventNamed("From a frame")), await events())
await setting({ logins: null })
await wait(1500)
await inThat(`new Notification("Elsewhere"); 1`)
check("one from another workspace's logins says which, links nowhere", await until(async () => (await eventNamed("Elsewhere"))?.body === "In workspace 1" && !(await eventNamed("Elsewhere")).link, 10000), await eventNamed("Elsewhere"))
await setting({ notifications: false })
await wait(1500)
await inThat(`new Notification("Muted"); 1`)
await wait(1500)
check("notifications off: none", !(await eventNamed("Muted")), await events())
await setting({ notifications: null })
await wait(1000)
await inThat(`for (let i = 0; i < 10; i++) new Notification("Burst " + i); 1`)
await wait(2000)
const burst = (await events()).filter((e) => e.title.startsWith("Burst ")).length
check("a burst is cut short", burst > 0 && burst <= 2, burst)

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
