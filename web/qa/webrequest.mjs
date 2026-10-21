// Extensions' chrome.webRequest beside Shields in the desktop app (Electron), end to end on a throwaway vault, a made-up
// site this script serves on 127.0.0.1 and a filter list of its own (no network). Two made-up extensions
// (tools/fixtures/web-request-mv2, -mv3): Request bender's blocking listeners (Manifest V2) cancel one script, redirect
// another and change a request's and a response's headers, while Shields still blocks the ad and counts it; Request
// watcher's service worker (Manifest V3) sees every event of the page's requests with its tab, never the app's own,
// has a blocking listener refused, and answers an HTTP sign-in (a wrong password asked once more shows the site's 401,
// no loop). Turned off, an extension's listeners go with it; one turned on leaves the other's APIs in place.
// WRITES: the throwaway vault only.
//   node web/qa/webrequest.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-webrequest-"))
const BENDER = { dir: path.join(ROOT, "tools/fixtures/web-request-mv2"), id: "poodmkagplffgghhhofgicilhofjclpb" }
const WATCHER = { dir: path.join(ROOT, "tools/fixtures/web-request-mv3"), id: "gkjoipandpgjijbbngghhhamfiodmnli" }
const awake = process.platform !== "darwin" ? null
  : (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "600"], { stdio: "ignore" })
process.on("exit", () => awake?.kill())

// ---------- the site ----------
const hits = {}
const js = (res, code) => { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(code) }
const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://127.0.0.1")
  hits[u.pathname] = (hits[u.pathname] ?? 0) + 1
  if (u.pathname === "/ads/banner.js") return js(res, "document.documentElement.dataset.ad = 'ran'")
  if (u.pathname === "/ext-block/x.js") return js(res, "document.documentElement.dataset.extBlock = 'ran'")
  if (u.pathname === "/ext-redirect/x.js") return js(res, "document.documentElement.dataset.redirect = 'original'")
  if (u.pathname === "/redirected.js") return js(res, "document.documentElement.dataset.redirect = 'redirected'")
  if (u.pathname === "/moved") { res.writeHead(302, { Location: "/plain" }); return res.end() }
  if (u.pathname === "/echo") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ bender: req.headers["x-bender"] ?? "" })) }
  if (u.pathname.startsWith("/auth")) {
    if (req.headers.authorization === `Basic ${Buffer.from("alice:lighthouse").toString("base64")}`) { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<title>In</title><p id=out>welcome alice") }
    res.writeHead(401, { "Content-Type": "text/html", "WWW-Authenticate": 'Basic realm="Lighthouse"' })
    return res.end("<title>Out</title><p id=out>denied")
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  if (u.pathname !== "/page") return res.end("<title>Plain</title><p>plain")
  res.end(`<!doctype html><title>Page</title><p>A page.</p>
<script src="/ads/banner.js"></script><script src="/ext-block/x.js"></script><script src="/ext-redirect/x.js"></script>
<script>fetch("/echo").then(async (r) => { const j = await r.json(); Object.assign(document.documentElement.dataset, { bender: j.bender, bent: r.headers.get("x-bent") ?? "" }) })
fetch("/moved").then((r) => { document.documentElement.dataset.moved = r.url.endsWith("/plain") ? "yes" : "no" })</script>`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const SITE = `http://127.0.0.1:${server.address().port}`

const LISTS = path.join(TMP, "lists")
fs.mkdirSync(LISTS)
fs.writeFileSync(path.join(LISTS, "filters.txt"), "/ads/banner.js$script\n")
fs.writeFileSync(path.join(LISTS, "resources.json"), JSON.stringify({ redirects: [], scriptlets: [] }))
const pluginsFile = path.join(VAULT, ".vaultite/plugins.json")
const plugins = fs.existsSync(pluginsFile) ? JSON.parse(fs.readFileSync(pluginsFile, "utf8")) : {}
fs.mkdirSync(path.dirname(pluginsFile), { recursive: true })
fs.writeFileSync(pluginsFile, JSON.stringify({ ...plugins, enabled: [...(plugins.enabled ?? []).filter((x) => x !== "web-viewer"), "web-viewer"],
  disabled: (plugins.disabled ?? []).filter((x) => x !== "web-viewer") }, null, 2) + "\n")

// ---------- the app ----------
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local"),
    VAULTITE_ADBLOCK_LISTS: LISTS },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus() })
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const openUrl = async (url) => { await ui({ action: "open", path: `view:web/${url}` }); await wait(500) }
const engine = (...args) => win.evaluate((a) => window.vaultite.web.engine(...a), args)

/** Run JavaScript in the view whose address starts with `prefix` (the visible one first). */
const inView = (prefix, code) => app.evaluate(({ BrowserWindow }, [prefix, code]) => {
  const w = BrowserWindow.getAllWindows()[0]
  const all = w.contentView.children.filter((x) => x.webContents && x.webContents !== w.webContents && x.webContents.getURL().startsWith(prefix))
  const v = all.find((x) => x.getVisible()) ?? all[0]
  return v ? v.webContents.executeJavaScript(code) : null
}, [prefix, code])
const pageId = (prefix) => app.evaluate(({ BrowserWindow }, prefix) => {
  const w = BrowserWindow.getAllWindows()[0]
  return w.contentView.children.find((x) => x.webContents && x.webContents.getURL().startsWith(prefix))?.webContents.id
}, prefix)
const flags = () => inView(`${SITE}/page`, "({ ...document.documentElement.dataset })")
const reload = () => inView(`${SITE}/page`, "location.reload()").catch(() => {})
/** Run JavaScript in Request bender's background page. */
const inBender = (code) => app.evaluate(({ webContents }, [id, code]) => {
  const bg = webContents.getAllWebContents().find((w) => w.getURL().startsWith(`chrome-extension://${id}/`))
  return bg ? bg.executeJavaScript(code) : null
}, [BENDER.id, code])
/** What its listeners kept. */
const bent = () => inBender("JSON.parse(JSON.stringify(globalThis.seen))")
/** What Request watcher's service worker saw, asked from its own page. */
const watched = async () => inView(`chrome-extension://${WATCHER.id}/seen.html`, "chrome.runtime.sendMessage({ type: 'seen' })")

// ---------- the two extensions, added from their folders ----------
for (const x of [BENDER, WATCHER]) {
  await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }) }, x.dir)
  const added = await engine("ext:add-file")
  check(`added ${added?.name}`, added?.id === x.id, added)
}

// ---------- a page: Shields and the blocking listeners side by side ----------
// (the lists are built as the app starts: reloaded until Shields block)
await openUrl(`${SITE}/page`)
await until(async () => { await reload(); await wait(1200); return (await flags())?.ad === undefined && (await flags())?.redirect }, 30000, 500)
const had = { ...hits }
const fresh = (p) => (hits[p] ?? 0) - (had[p] ?? 0)
await reload()
const ready = (f) => f?.redirect && f.bender !== undefined && f.moved
check("the page loads", await until(async () => ready(await flags()), 15000), await flags())
const f = await flags()
check("Shields: the ad is blocked", f.ad === undefined && !fresh("/ads/banner.js"), [f, hits])
check("… and counted on the page's button", await until(async () => (await win.locator("[data-web-shields]").getAttribute("data-count").catch(() => "")) === "1", 10000),
  await win.locator("[data-web-shields]").getAttribute("data-count").catch(() => null))
check("MV2 blocking onBeforeRequest: a script cancelled", f.extBlock === undefined && !fresh("/ext-block/x.js"), [f, hits])
check("… another redirected", f.redirect === "redirected" && !fresh("/ext-redirect/x.js"), [f, hits])
check("… onBeforeSendHeaders adds a request header", f.bender === "yes", f)
check("… onHeadersReceived adds a response header", f.bent === "yes", f)
const page = await pageId(`${SITE}/page`)
const b = await bent()
check("… its listeners saw them, not the ad", b?.cancelled.length >= 1 && b.redirected.length >= 1 && b.sendHeaders >= 1 && b.headers >= 1, b)

// ---------- the MV3 observer ----------
await app.evaluate(({ session }, url) => session.fromPartition("persist:web").fetch(`${url}/app-own`).then(() => {}, () => {}), SITE)
await openUrl(`chrome-extension://${WATCHER.id}/seen.html`)
const w = await until(async () => { const s = await watched(); return s?.events?.onCompleted ? s : null }, 15000)
check("MV3 observers: every event fires", ["onBeforeRequest", "onSendHeaders", "onHeadersReceived", "onResponseStarted", "onBeforeRedirect", "onCompleted", "onErrorOccurred"]
  .every((e) => w?.events?.[e] > 0), w?.events)
check("… with the page's tab", w?.tabs.includes(page), [w?.tabs, page])
check("… and headers when asked", w?.sendHeaders && w.responseHeaders, w)
check("… the blocked ones as errors", w?.errors.some((e) => e.includes("/ads/banner.js") && e.includes("BLOCKED_BY_CLIENT")) && w.errors.some((e) => e.includes("/ext-block/")), w?.errors)
check("… never the app's own requests", w && !w.urls.some((u) => u.includes("/app-own")) && hits["/app-own"] === 1, [w?.urls, hits["/app-own"]])
check("… a blocking listener refused in Manifest V3", w?.refused === true, w)

// ---------- HTTP sign-in (onAuthRequired) ----------
// (Chromium keeps a sign-in that worked for the site: the wrong one goes first)
await openUrl(`${SITE}/auth-wrong`)
check("onAuthRequired: a wrong password shows the site's 401, asked once more, no loop", await until(async () => (await inView(`${SITE}/auth-wrong`, "document.getElementById('out')?.textContent")) === "denied", 15000),
  await inView(`${SITE}/auth-wrong`, "document.body.innerText"))
await openUrl(`${SITE}/auth`)
check("… the right one signs in", await until(async () => (await inView(`${SITE}/auth`, "document.getElementById('out')?.textContent")) === "welcome alice", 15000),
  await inView(`${SITE}/auth`, "document.body.innerText"))
await openUrl(`chrome-extension://${WATCHER.id}/seen.html`)
const a = (await watched())?.auth ?? []
check("… told with its realm, tab and request", a.length === 3 && a[0].realm === "Lighthouse" && a[0].tabId > 0 && !a[0].again && a[1].again && !a[2].again, a)

// ---------- turned off ----------
await engine("ext:on", BENDER.id, false)
await openUrl(`${SITE}/page`)
await reload()
check("off: its listeners are gone", await until(async () => (await flags())?.extBlock === "ran" && (await flags())?.redirect === "original", 10000), await flags())
check("… Shields still block", (await flags())?.ad === undefined, await flags())

// ---------- on again: Chromium puts its own APIs back on every extension's `chrome` as one loads ----------
await engine("ext:on", BENDER.id, true)
await engine("ext:on", WATCHER.id, false)
await engine("ext:on", WATCHER.id, true)
await wait(1500)
check("on again: another's APIs hold", await inBender("Object.keys(chrome.webRequest.onBeforeRequest).includes('addListener')"))
await inBender("globalThis.late = 0; chrome.webRequest.onBeforeRequest.addListener(() => { late++ }, { urls: ['http://127.0.0.1/*'] })")
await reload()
check("… and a listener it adds now hears the page's requests", await until(() => inBender("globalThis.late > 0"), 10000), await inBender("globalThis.late"))

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
