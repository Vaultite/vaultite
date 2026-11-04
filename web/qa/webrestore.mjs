// The Browser coming back as Chrome's does (electron/web.ts): after a relaunch the web tab on screen shows at once (its
// last frame while it loads), with its Back and Forward and its scroll; tabs not shown load only when shown; the HTTP
// cache and sign-ins are still there; Back is quick (the back/forward cache); a web tab closed and reopened (⌘⇧T)
// comes back the same way. Prints the times (TIMES=1 skips the checks on them: a measurement run).
// Made-up pages answer slowly (DELAY ms, 600 by default), as a real site does. WRITES: the throwaway vault only.
//   node web/qa/webrestore.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-webrestore-"))
const DELAY = Number(process.env.DELAY ?? 600)

// ---------- made-up pages: slow to answer; a script kept a day in the HTTP cache; a sign-in's cookies ----------
const asked = new Map()
const page = (title, body, bg) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:18px/1.5 Georgia,serif;margin:0;padding:40px 60px;background:${bg};color:#222}.tall{height:5000px}</style>
<script src="/app.js"></script><script>addEventListener("pageshow", (e) => { window.__persisted = e.persisted })</script></head><body><h1>${title}</h1>${body}<div class="tall"></div><p id="end">The end.</p></body></html>`
const server = http.createServer((req, res) => {
  const u = req.url ?? "/"
  asked.set(u, (asked.get(u) ?? 0) + 1)
  if (u.startsWith("/app.js")) { res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "max-age=86400" }); return res.end("window.appLoaded = 1") }
  const html = u.startsWith("/login") ? page("Signed in", "<p>Welcome back, Alice Park.</p>", "#e8f0e0")
    : u.startsWith("/b") ? page("Second part", "<p>The second part.</p>", "#f3e8d8")
    : u.startsWith("/c") ? page("Third part", "<p>The third part.</p>", "#dde8f3")
    : page("Lighthouse field notes", `<p style="position:fixed;top:8px;right:16px">Read <a id="next" href="/b">the second part</a>.</p>`, "#f6f1e3")
  // (the page a relaunch shows can't come from the cache, as a signed-in site's pages can't)
  const head = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": u.startsWith("/b") ? "no-store" : "no-cache" }
  if (u.startsWith("/login")) head["Set-Cookie"] = ["sess=alice; Path=/", "keep=alice; Path=/; Max-Age=86400"]
  setTimeout(() => { res.writeHead(200, head); res.end(html) }, DELAY)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const SITE = `http://127.0.0.1:${server.address().port}`

fs.mkdirSync(path.join(VAULT, ".vaultite"), { recursive: true })
let app, win, launched = 0
async function launch() {
  launched = Date.now()
  app = await _electron.launch({
    executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
    env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
  })
  if (process.env.DEBUG) app.process().stderr.on("data", (d) => process.stderr.write(d)), app.process().stdout.on("data", (d) => process.stdout.write(d))
  win = await app.firstWindow()
  watch(win, { console: true, fail: false })
}
const origin = () => new URL(win.url()).origin
const openWeb = (url, background = false) => fetch(`${origin()}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "open", path: url, newTab: true, ...(background ? { background: true } : {}) }) })
/** The vault window's web pages. */
const pages = () => app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0]
  return w ? w.contentView.children.filter((v) => v.webContents && v.webContents !== w.webContents && !v.webContents.isDestroyed())
    .map((v) => ({ url: v.webContents.getURL(), visible: v.getVisible(), n: v.webContents.navigationHistory.length(), at: v.webContents.navigationHistory.getActiveIndex() })) : []
})
/** In the shown page: `code`'s value (null: none shown). */
const inPage = (code) => app.evaluate(({ BaseWindow }, code) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w?.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible() && x.webContents.getURL().startsWith("http"))
  return v ? v.webContents.executeJavaScript(code).catch(() => null) : null
}, code)
const goBack = () => app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0]
  w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible()).webContents.navigationHistory.goBack()
})
const clickInPage = (sel) => app.evaluate(async ({ BaseWindow }, sel) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  const [x, y] = (await v.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getClientRects()[0]; return [r.left + r.width / 2, r.top + r.height / 2] })()`)).map(Math.round)
  v.webContents.sendInputEvent({ type: "mouseMove", x, y })
  v.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 })
  v.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 })
}, sel)
/** The shown page has painted `path` (ms since `from`), or null. */
async function paintedAt(p, from, ms = 30000) {
  const ok = await until(async () => (await inPage(`location.pathname === ${JSON.stringify(p)} && performance.getEntriesByType("paint").length > 0 && !!document.body`)) === true, ms, 10)
  return ok ? Date.now() - from : null
}
/** The window shows the page's last frame in its place (ms since `from`), or null. */
async function frameAt(from, ms = 30000) {
  const ok = await until(() => win.evaluate(() => [...document.querySelectorAll("[data-web-frame]")].some((e) => e.getBoundingClientRect().width > 0 && e.complete)).catch(() => false), ms, 10)
  return ok ? Date.now() - from : null
}
const times = {}

// ---------- first run: a page with a past, scrolled; a second tab behind; signed in ----------
await launch()
await win.waitForSelector("[role=tree]", { timeout: 60000 })
await openWeb(`${SITE}/login`)
check("a web tab opens", await until(async () => (await pages()).some((p) => p.visible && p.url.endsWith("/login")), 20000), await pages())
await openWeb(`${SITE}/a`)
check("then another", (await paintedAt("/a", Date.now())) !== null)
await inPage("scrollTo(0, 1500)")
await wait(300)
await clickInPage("#next")
check("a link goes on in it", (await paintedAt("/b", Date.now())) !== null)
// Back: the first page as it was, scrolled where it was left.
let t = Date.now()
await goBack()
times.back = await paintedAt("/a", t)
await until(async () => (await inPage("scrollY")) > 1000, 3000, 10)
times.backScrolled = Date.now() - t
console.log(`  back: painted in ${times.back} ms, scrolled back in ${times.backScrolled} ms (back/forward cache: ${await inPage("String(!!window.__persisted)")})`)
check("Back shows the page scrolled where it was", (await inPage("scrollY")) > 1000, await inPage("scrollY"))
// Forward again, and scrolled down a way: what the next launch shows.
await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible()).webContents.navigationHistory.goForward() })
check("Forward", (await paintedAt("/b", Date.now())) !== null)
await inPage("scrollTo(0, 800)")
await openWeb(`${SITE}/c`, true)
await wait(2500) // (its history written: electron/web.ts keeps it 2 s after a move)
const before = (await pages()).length
await app.close()

// ---------- relaunch: the tab on screen at once, its past and scroll; the one behind not loaded ----------
asked.clear()
await launch()
const fromLaunch = launched
const [frame, live] = await Promise.all([frameAt(fromLaunch, 30000), paintedAt("/b", fromLaunch, 40000)])
times.restartFrame = frame
times.restartLive = live
console.log(`  relaunch: first sight of the page ${frame ?? live} ms (its last frame: ${frame ?? "none"}; live and painted ${live} ms)`)
check("relaunched, the tab on screen shows its page", live !== null)
check("… its last frame first, while it loads", process.env.TIMES || (frame !== null && frame < live), { frame, live })
check("… with its Back and Forward", await until(async () => (await pages()).some((p) => p.visible && p.n === 2 && p.at === 1), 5000), await pages())
check("… scrolled where it was", await until(async () => (await inPage("scrollY")) > 600, 5000), await inPage("scrollY"))
check("the tab behind isn't loaded till it's shown", (await pages()).filter((p) => p.url.startsWith(SITE)).length === 1, { pages: await pages(), before })
check("the HTTP cache came through the relaunch (its script not asked again)", !asked.get("/app.js"), Object.fromEntries(asked))
check("the frame goes once the page is live", await until(() => win.evaluate(() => ![...document.querySelectorAll("[data-web-frame]")].some((e) => e.getBoundingClientRect().width > 0)), 5000))

// The sign-in's tab: its cookies, the session's one too (sessioncookies.ts), are still there.
await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].focus())
const titles = () => win.evaluate(() => [...document.querySelectorAll("[role=tablist] [role=tab]")].map((t) => t.textContent?.trim()))
check("the tabs not loaded yet keep their pages' titles", await until(async () => (await titles()).includes("Signed in"), 5000), await titles())
// (by its place, so the run goes on without their titles: Start here, Signed in, Second part, Third part)
await win.locator("[role=tablist] [role=tab]").nth(1).click()
check("the signed-in tab loads when shown", (await paintedAt("/login", Date.now())) !== null, await titles())
const cookies = await inPage("document.cookie")
check("its sign-in's cookies came through, the session's too", /sess=alice/.test(cookies) && /keep=alice/.test(cookies), cookies)

// ---------- ⌘⇧T: a web tab closed comes back with its past and scroll, its last frame first ----------
await win.locator("[role=tablist] [role=tab]", { hasText: "Second part" }).first().click()
await paintedAt("/b", Date.now())
await inPage("scrollTo(0, 900)")
await wait(2500)
await win.keyboard.press("ControlOrMeta+w")
check("closed", await until(async () => !(await pages()).some((p) => p.url.endsWith("/b")), 5000), await pages())
t = Date.now()
await win.keyboard.press("ControlOrMeta+Shift+t")
const [rf, rl] = await Promise.all([frameAt(t, 10000), paintedAt("/b", t, 20000)])
times.reopenFrame = rf
times.reopenLive = rl
console.log(`  reopened: last frame ${rf} ms, live ${rl} ms`)
check("reopened, it shows its page", rl !== null)
check("… its last frame first", process.env.TIMES || (rf !== null && rf < rl), { rf, rl })
check("… with its Back", await until(async () => (await pages()).some((p) => p.visible && p.n === 2), 5000), await pages())
check("… scrolled where it was", await until(async () => (await inPage("scrollY")) > 600, 5000), await inPage("scrollY"))

console.log(`times: ${JSON.stringify(times)}`)
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
