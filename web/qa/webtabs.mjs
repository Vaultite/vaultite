// The Browser's new tabs in the desktop app (Electron), against pages this script serves on 127.0.0.1: ⌘-click and a
// middle click open a link behind its page, in click order after it; ⌘⇧-click and target=_blank in front, and closing
// that goes back to the page; window.open keeps window.opener; tabs a page opened outlive it, but a sized popup is a
// window titled with its site and closed with its page; a script opens nothing unclicked; a link that downloads leaves
// no tab; a page's link menu (new tab, a container, to the side, Glance, Copy link text); ⌥-click glances and Open in
// tab keeps the page; links in notes follow the same keys; an agent's page opens its own pages, never the user's tabs;
// ⌘⇧T brings a page back with its history, and after a relaunch the closed tab and each tab's history are still there.
// WRITES: the throwaway vault only.
//   node web/qa/webtabs.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-webtabs-"))
const awake = process.platform !== "darwin" ? null
  : (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "900"], { stdio: "ignore" })
process.on("exit", () => awake?.kill())

// ---------- made-up pages ----------
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:18px/1.6 system-ui;margin:40px}a,button{display:block;margin:10px 0;font-size:18px}</style></head><body>${body}</body></html>`
const OPENER = page("Lighthouse", `<h1>Lighthouse</h1>
<a id="a" href="/one">the first part</a><a id="b" href="/two">the second part</a>
<a id="blank" href="/three" target="_blank">the third part in a new tab</a>
<a id="dl" href="/file.txt" target="_blank">the log book</a>
<button id="pop" onclick="window.kid = window.open('/child')">Open the child</button>
<button id="popclose" onclick="window.open('/closer')">Open one that closes itself</button>
<button id="signin" onclick="window.open('/child', 'signin', 'width=420,height=500')">Sign in</button>
<script>addEventListener("message", (e) => { document.title = "got " + e.data })</script>`)
const server = http.createServer((req, res) => {
  const u = req.url ?? "/"
  if (u.startsWith("/file.txt")) { res.writeHead(200, { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=\"log book.txt\"" }); return res.end("Day one: calm.\n") }
  const html = u.startsWith("/one") ? page("First part", "<h1>First part</h1>") : u.startsWith("/two") ? page("Second part", "<h1>Second part</h1>")
    : u.startsWith("/three") ? page("Third part", "<h1>Third part</h1>")
    : u.startsWith("/child") ? page("Child", `<h1>Child</h1><script>document.title = "child opener=" + !!window.opener; window.opener && window.opener.postMessage("hi", "*")</script>`)
    : u.startsWith("/closer") ? page("Closer", `<h1>Closer</h1><script>setTimeout(() => window.close(), 800)</script>`)
    : u.startsWith("/auto") ? page("Auto", `<h1>Auto</h1><script>setTimeout(() => { window.got = window.open("/two") }, 300)</script>`)
    : OPENER
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(html)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const SITE = `http://127.0.0.1:${server.address().port}`

fs.mkdirSync(path.join(VAULT, "Notes"), { recursive: true })
fs.writeFileSync(path.join(VAULT, "Notes/Qa tabs.md"), `# Qa tabs\n\nRead [the first part](${SITE}/one) today.\n`)
const plugins = path.join(VAULT, ".vaultite/plugins.json")
const on = fs.existsSync(plugins) ? JSON.parse(fs.readFileSync(plugins, "utf8")) : { enabled: [], disabled: [] }
fs.writeFileSync(plugins, JSON.stringify({ ...on, enabled: [...new Set([...(on.enabled ?? []), "web-viewer", "glance"])], disabled: (on.disabled ?? []).filter((x) => x !== "glance") }))

// ---------- the app ----------
const DOWNLOADS = path.join(TMP, "Downloads")
fs.mkdirSync(DOWNLOADS)
const MOD = process.platform === "darwin" ? "meta" : "control"
let app, win, origin
async function launch() {
  app = await _electron.launch({
    executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
    env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
  })
  win = await app.firstWindow()
  watch(win, { console: true, fail: false })
  await win.waitForSelector("[role=tree]", { timeout: 60000 })
  origin = new URL(win.url()).origin
  await app.evaluate(({ app: a, BaseWindow, BrowserWindow, shell }, dl) => {
    globalThis.__opened = []
    shell.openExternal = async (u) => { globalThis.__opened.push(u) }
    a.setPath("downloads", dl)
    const w = BaseWindow.getAllWindows().find((x) => !(x instanceof BrowserWindow)); w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus()
  }, DOWNLOADS)
  // (the link menu's native menu isn't drawn: its items are kept as the right-click made them)
  await app.evaluate(({ Menu }) => {
    const build = Menu.buildFromTemplate.bind(Menu)
    Menu.buildFromTemplate = (items) => { const m = build(items); m.popup = () => { globalThis.__menu = items }; return m }
  })
}
await launch()
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const menuClick = (label) => app.evaluate(({ Menu, BaseWindow, BrowserWindow }, label) => {
  const find = (items) => { for (const i of items) { if (i.label === label) return i; const s = i.submenu && find(i.submenu.items); if (s) return s } }
  find(Menu.getApplicationMenu().items).click(undefined, BaseWindow.getAllWindows().find((x) => !(x instanceof BrowserWindow)))
}, label)
/** The web pages over the window: address, title, shown, contents id. */
const pages = () => app.evaluate(({ BaseWindow, BrowserWindow }) => {
  const w = BaseWindow.getAllWindows().find((x) => !(x instanceof BrowserWindow))
  return w.contentView.children.filter((v) => v.webContents && v.webContents !== w.webContents)
    .map((v) => ({ url: v.webContents.getURL(), title: v.webContents.getTitle(), visible: v.getVisible() && v.getBounds().x > -1000, wc: v.webContents.id }))
})
const shownUrl = async () => (await pages()).find((p) => p.visible)?.url
/** The focused pane's tabs (web ones by their address, a container's as @id/address) and the active one. */
const tabs = () => win.evaluate(() => {
  const w = JSON.parse(localStorage.getItem("vaultite.tabs"))
  const g = (function walk(n) { return n.tabs ? n : walk(n.kids.find((k) => JSON.stringify(k).includes(w.focus)) ?? n.kids[0]) })(w.root)
  const name = (t) => t.to.replace(/^view:web\//, "")
  return { list: g.tabs.map(name), active: name(g.tabs.find((t) => t.id === g.active)), ids: g.tabs.map((t) => t.id), activeId: g.active }
})
const paneCount = () => win.locator("section[data-group]").count()
/** A click in the visible page as a person's (real input), with modifiers or another button. */
const clickInPage = (sel, modifiers = [], button = "left") => app.evaluate(async ({ BaseWindow, BrowserWindow }, [sel, modifiers, button]) => {
  const w = BaseWindow.getAllWindows().find((x) => !(x instanceof BrowserWindow))
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible() && x.getBounds().x > -1000)
  const [x, y] = (await v.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getClientRects()[0]; return [r.left + 20, r.top + r.height / 2] })()`)).map(Math.round)
  v.webContents.sendInputEvent({ type: "mouseMove", x, y, modifiers })
  v.webContents.sendInputEvent({ type: "mouseDown", x, y, button, clickCount: 1, modifiers })
  v.webContents.sendInputEvent({ type: "mouseUp", x, y, button, clickCount: 1, modifiers })
}, [sel, modifiers, button])
const menuLabels = (items) => app.evaluate((_e, sub) => { const at = sub ? globalThis.__menu.find((i) => i.label === sub).submenu : globalThis.__menu; return at.map((i) => i.label ?? i.type) }, items)
const pick = (label, sub) => app.evaluate((_e, [label, sub]) => { const at = sub ? globalThis.__menu.find((i) => i.label === sub).submenu : globalThis.__menu; at.find((i) => i.label === label).click() }, [label, sub])
const at = (p) => `${SITE}${p}`
/** Show the tab of an address (the first). */
const showTab = async (to) => { const t = await tabs(); await win.locator(`[data-tab-id="${t.ids[t.list.indexOf(to)]}"]`).first().click() }
async function openOpener() {
  await ui({ action: "open", path: at("/opener"), newTab: true })
  check("(the opener's page is shown)", await until(async () => (await shownUrl()) === at("/opener"), 30000), await pages())
  await wait(500)
}

// ---------- behind and in front ----------
await openOpener()
await clickInPage("#a", [MOD])
await until(async () => (await tabs()).list.includes(at("/one")), 8000)
await clickInPage("#b", [], "middle")
check("⌘-click and a middle click: tabs behind, after the page in the order clicked", await until(async () => {
  const t = await tabs(), i = t.list.indexOf(at("/opener"))
  return t.list[i + 1] === at("/one") && t.list[i + 2] === at("/two") && t.active === at("/opener")
}, 8000), await tabs())
check("… the page stays on screen", (await shownUrl()) === at("/opener"), await pages())
check("… and theirs load behind it", await until(async () => (await pages()).filter((p) => !p.visible && [at("/one"), at("/two")].includes(p.url)).length === 2, 10000), await pages())

await clickInPage("#a", [MOD, "shift"])
check("⌘⇧-click: a tab in front", await until(async () => (await shownUrl()) === at("/one") && (await tabs()).active === at("/one"), 15000), [await tabs(), await pages()])
const kid = (await tabs()).activeId
await menuClick("Close tab")
check("… closed straight away: back to the page it came from", await until(async () => (await tabs()).active === at("/opener") && !(await tabs()).ids.includes(kid), 8000), await tabs())

await clickInPage("#blank")
check("target=_blank: a tab in front", await until(async () => (await shownUrl()) === at("/three"), 15000), await pages())
await menuClick("Close tab")
check("… and back to its page when closed", await until(async () => (await tabs()).active === at("/opener"), 8000), await tabs())

// ---------- window.opener ----------
await clickInPage("#pop")
check("window.open: the child in front, with window.opener", await until(async () => (await pages()).some((p) => p.visible && p.title === "child opener=true"), 10000), await pages())
check("… which reaches its page (postMessage)", await until(async () => (await pages()).some((p) => p.title === "got hi"), 5000), await pages())
await menuClick("Close tab")
await until(async () => (await tabs()).active === at("/opener"), 8000)
const n1 = (await tabs()).list.length
await clickInPage("#popclose")
await until(async () => (await tabs()).list.includes(at("/closer")), 10000)
check("one that window.close()s itself: its tab closes, back to its page", await until(async () => (await tabs()).list.length === n1 && (await tabs()).active === at("/opener"), 10000), await tabs())

// ---------- a link that downloads ----------
const before = (await tabs()).list.length
await clickInPage("#dl")
check("a link to a new tab that downloads: the file lands", await until(() => fs.existsSync(path.join(DOWNLOADS, "log book.txt")), 10000), fs.readdirSync(DOWNLOADS))
check("… and its tab closes itself", await until(async () => (await tabs()).list.length === before && (await tabs()).active === at("/opener"), 8000), await tabs())

// ---------- a page's own script opening a tab with no click (a popup blocker) ----------
await ui({ action: "open", path: at("/auto"), newTab: true })
await until(async () => (await shownUrl()) === at("/auto"), 10000)
await wait(2000)
const unasked = (await tabs()).list.filter((t) => t === at("/two")).length
check("a page's script opening a tab with nobody clicking: blocked", unasked === 1, await tabs())
check("… and the user told, with Open", await until(async () => (await win.locator("[data-sonner-toast]", { hasText: "Blocked a pop-up" }).count()) > 0, 5000))
await menuClick("Close tab")
await showTab(at("/opener"))
await until(async () => (await shownUrl()) === at("/opener"), 8000)

// ---------- the link menu ----------
const rightClick = async (sel) => { await app.evaluate(() => { globalThis.__menu = null }); await clickInPage(sel, [], "right"); return until(() => app.evaluate(() => !!globalThis.__menu), 5000) }
await rightClick("#a")
const labels = await menuLabels()
check("a link's menu: new tab, container, to the side, Glance, another browser, Copy link and its text",
  ["Open link in new tab", "Open link in container", "Open link to the side", "Glance", "Open link in another browser", "Copy link", "Copy link text"].every((l) => labels.includes(l)), labels)
check("… its containers named", (await menuLabels("Open link in container")).includes("Work"), await menuLabels("Open link in container"))
await pick("Work", "Open link in container")
check("Open link in container › Work: a tab behind, in Work", await until(async () => (await tabs()).list.includes(`@work/${at("/one")}`) && (await tabs()).active === at("/opener"), 8000), await tabs())
await rightClick("#b")
await pick("Open link to the side")
check("Open link to the side: in a pane beside", await until(async () => (await paneCount()) === 2 && (await shownUrl()) !== undefined, 8000), await paneCount())
await menuClick("Close pane").catch(() => {})
await until(async () => (await paneCount()) === 1, 5000)
await showTab(at("/opener"))
await until(async () => (await shownUrl()) === at("/opener"), 8000)

// ---------- Glance: ⌥-click in a page, and Open in tab keeps its page ----------
await clickInPage("#b", ["alt"])
const glancing = () => win.evaluate(() => location.hash.includes("/glance/"))
check("⌥-click on a link in a page: a glance at it", await until(glancing, 8000), await win.evaluate(() => location.hash))
check("… its page shown in the sheet", await until(async () => (await pages()).some((p) => p.visible && p.url === at("/two")), 10000), await pages())
const glanced = (await pages()).find((p) => p.visible && p.url === at("/two"))?.wc
await win.locator("dialog[open] button", { hasText: "Open in tab" }).click()
check("Open in tab: a tab of its own, the same page (not loaded again)", await until(async () => !(await glancing()) && (await tabs()).active === at("/two")
  && (await pages()).some((p) => p.visible && p.wc === glanced), 10000), [await tabs(), await pages(), glanced])
await menuClick("Close tab")

// ---------- links in notes ----------
await ui({ action: "open", path: "Notes/Qa tabs.md" })
await win.waitForSelector("section [data-pane] .cm-link[data-url]", { timeout: 10000 })
const n0 = (await tabs()).list.length
// (forced: Playwright counts the link hidden while a page's view is laid over the window, though it's drawn)
const noteLink = () => win.locator("section [data-pane] .cm-link[data-url]").first()
await noteLink().click({ force: true, modifiers: ["ControlOrMeta"] })
check("⌘-click on a web link in a note: a web tab behind it", await until(async () => (await tabs()).list.length === n0 + 1 && (await tabs()).active === "file:Notes/Qa tabs.md", 8000), await tabs())
await noteLink().click({ force: true, modifiers: ["ControlOrMeta", "Shift"] })
check("⌘⇧-click: a web tab in front", await until(async () => (await tabs()).list.length === n0 + 2 && (await tabs()).active === at("/one"), 8000), await tabs())
await menuClick("Close tab")
await until(async () => (await tabs()).active === "file:Notes/Qa tabs.md", 8000)
const out0 = (await app.evaluate(() => globalThis.__opened)).length
await noteLink().click({ force: true, modifiers: ["ControlOrMeta", "Alt"] })
check("⌥⌘-click: the system browser, no tab", await until(async () => (await app.evaluate(() => globalThis.__opened)).length > out0, 8000) && (await tabs()).list.length === n0 + 1,
  [await app.evaluate(() => globalThis.__opened), await tabs()])

// ---------- an agent's page opens its own pages, never the user's tabs ----------
const op = async (id, params) => {
  const r = await fetch(`${origin}/api/ops/web-viewer.${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "mcp", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params ?? {}) })
  const j = await r.json().catch(() => ({}))
  return r.ok ? (j.result ?? j) : { error: j.error ?? r.status }
}
await wait(1000)
const mine = await tabs()
const T = (await op("open", { url: at("/opener"), task: "reading" }))?.tab
check("(an agent's page)", typeof T === "number", T)
const snap = (await op("snapshot", { tab: T }))?.snapshot ?? ""
const ref = /link "the third part in a new tab" \[ref=(e\d+)\]/.exec(snap)?.[1]
await op("act", { tab: T, action: "click", ref })
const theirs = async () => (Array.isArray(await op("tabs")) ? await op("tabs") : []).filter((t) => t.url === at("/three"))
check("an agent's click on a link to a new tab: a page of the agent's", await until(async () => (await theirs()).length === 1, 10000), await op("tabs"))
check("… with no tab of the user's, their tab still in front", JSON.stringify(await tabs()) === JSON.stringify(mine), [await tabs(), mine])
check("… nor shown", !(await pages()).some((p) => p.visible && p.url === at("/three")), await pages())
await op("close", { tab: T })
for (const t of await theirs()) await op("close", { tab: t.tab })

// ---------- a sized popup (signing in with another site): a window titled with its site, closed with its page ----------
await openOpener()
await clickInPage("#signin")
const popup = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.webContents.getURL().includes("/child")).map((w) => w.getTitle()))
check("a sized popup: a window of its own, titled with its site", await until(async () => (await popup())[0] === "127.0.0.1", 10000), await popup())
check("… which reaches its page", await until(async () => (await pages()).some((p) => p.title === "got hi"), 5000), await pages())
await menuClick("Close tab")
check("… and closes with it", await until(async () => (await popup()).length === 0, 8000), await popup())

// ---------- tabs a page opened outlive it, as Chrome's do ----------
await openOpener()
await clickInPage("#a", [MOD])
await clickInPage("#pop")
await until(async () => (await pages()).some((p) => p.visible && p.title === "child opener=true"), 10000)
await showTab(at("/opener"))
await until(async () => (await shownUrl()) === at("/opener"), 8000)
const opener = (await tabs()).activeId, rest = (await tabs()).list.filter((t) => t !== at("/opener"))
const opened = (await pages()).filter((p) => [at("/one"), at("/two"), at("/child")].includes(p.url)).length
await menuClick("Close tab")
await wait(1500)
check("closing a page: the tabs it opened stay, behind and in front", await until(async () => {
  const t = await tabs()
  return !t.ids.includes(opener) && JSON.stringify(t.list.filter((x) => x !== at("/opener"))) === JSON.stringify(rest)
}, 3000), [rest, await tabs()])
check("… their pages too", (await pages()).filter((p) => [at("/one"), at("/two"), at("/child")].includes(p.url)).length === opened, [opened, await pages()])

// ---------- ⌘⇧T: back with its history, after a relaunch too ----------
await openOpener()
await clickInPage("#a")
await until(async () => (await shownUrl()) === at("/one"), 8000)
await menuClick("Close tab")
await wait(500)
await menuClick("Reopen closed tab")
check("⌘⇧T: the tab back at its page", await until(async () => (await shownUrl()) === at("/one"), 10000), await pages())
/** The shown page's history (its addresses, where it is), and Back in it. */
const past = () => app.evaluate(({ BaseWindow, BrowserWindow }) => {
  const w = BaseWindow.getAllWindows().find((x) => !(x instanceof BrowserWindow))
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible() && x.getBounds().x > -1000)
  return v ? { urls: v.webContents.navigationHistory.getAllEntries().map((e) => e.url), at: v.webContents.navigationHistory.getActiveIndex() } : null
})
const hadPast = async (from, to) => { const h = await past(); return !!h && h.urls[h.at] === at(to) && h.urls[h.at - 1] === at(from) }
// (its Back as entries: Back clicked in a restored page crashes it only while Playwright's DevTools session is attached
// as it's made, as here; a plain Electron restore, preloads and all, goes back fine)
check("… with its history", await until(() => hadPast("/opener", "/one"), 8000), await past())
// Closed before a relaunch, the tab closed last with history: ⌘⇧T after it brings both back, the page's history too
// (kept on the Mac by its tab, as a tab not shown since the relaunch would come back).
await openOpener()
await clickInPage("#b")
await until(async () => (await shownUrl()) === at("/two"), 8000)
await menuClick("Close other tabs")
await ui({ action: "open", path: at("/three"), newTab: true })
await until(async () => (await shownUrl()) === at("/three"), 15000)
await menuClick("Close tab")
await until(async () => (await shownUrl()) === at("/two"), 8000)
await menuClick("Close tab")
await wait(2500) // (the page histories are written a moment later)
// (a playground vault starts afresh on another port: what the app keeps in localStorage is carried over)
const kept = await win.evaluate(() => ["vaultite.tabs.closed"].map((k) => [k, localStorage.getItem(k)]))
await app.close()
await launch()
await win.evaluate((kv) => { for (const [k, v] of kv) localStorage.setItem(k, v) }, kept)
await win.reload()
await win.waitForSelector("[role=tree]", { timeout: 60000 })
await menuClick("Reopen closed tab")
check("relaunched: ⌘⇧T reopens the tab closed last", await until(async () => (await shownUrl()) === at("/two"), 15000), [await tabs(), await pages()])
check("… with its page's history", await until(() => hadPast("/opener", "/two"), 10000), await past())
await menuClick("Reopen closed tab")
check("… and again, the one closed before", await until(async () => (await shownUrl()) === at("/three"), 15000), [await tabs(), await pages()])

await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
