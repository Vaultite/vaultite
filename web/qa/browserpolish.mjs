// The Browser's polish, as Chrome's (plugins/core/web-viewer, electron/web.ts), in the desktop app (Electron) against
// pages this script serves on 127.0.0.1: error pages in words with Try again (and again once back online), a certificate
// warning (a self-signed https server: Back to safety, or on to it this session), a page that keeps crashing says so with
// Reload, a loading tab's spinner and the bar's progress line, View page source, Duplicate tab with its history, a tab
// moved to a new window keeping its live page, and typed input a page holds (its tab isn't archived).
// WRITES: the throwaway vault only.
//   node web/qa/browserpolish.mjs <vault copy>
import { _electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import https from "node:https"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-browserpolish-"))
const awake = process.platform !== "darwin" ? null
  : (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "600"], { stdio: "ignore" })
process.on("exit", () => awake?.kill())

// ---------- made-up pages ----------
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:18px/1.5 Georgia,serif;margin:0;padding:40px 60px}</style></head><body>${body}</body></html>`
const ARTICLE = page("Lighthouse field notes", `<h1>Lighthouse field notes</h1><p>The keeper climbs one hundred and twelve steps.</p>
<p>Read <a id="next" href="/two">the second part</a>.</p><form><input id="note" aria-label="Note"></form>`)
const handler = (req, res) => {
  const u = req.url ?? "/"
  if (u.startsWith("/slow")) return void setTimeout(() => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(page("Slow", "<h1>Slow</h1>")) }, 4000)
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(u.startsWith("/two") ? page("Second part", "<h1>Second part</h1>") : ARTICLE)
}
const listen = (s) => new Promise((ok, fail) => { s.once("error", fail); s.listen(0, "127.0.0.1", () => ok(s.address().port)) })
const SITE = `http://127.0.0.1:${await listen(http.createServer(handler))}`
// (a port nothing answers on: refused)
const closed = http.createServer(), DEAD = await listen(closed)
await new Promise((r) => closed.close(r))
// A self-signed certificate, made for this run.
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(TMP, "key.pem"), "-out", path.join(TMP, "cert.pem"),
  "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" })
const SECURE = `https://127.0.0.1:${await listen(https.createServer({ key: fs.readFileSync(path.join(TMP, "key.pem")), cert: fs.readFileSync(path.join(TMP, "cert.pem")) }, handler))}`

// ---------- the app ----------
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus() })
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const open = (url) => ui({ action: "open", path: url, newTab: true })
/** Every web page, in which window (0: the vault's, 1: a pop-out) and whether it's shown. */
const pages = () => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().flatMap((w) => w.contentView.children
  .filter((v) => v.webContents && v.webContents !== w.webContents)
  .map((v) => ({ win: w.webContents?.getURL().includes("popout=") ? 1 : 0, wc: v.webContents.id, url: v.webContents.getURL(), visible: v.getVisible(), crashed: v.webContents.isCrashed(), back: v.webContents.navigationHistory.canGoBack() }))))
const shownPage = async () => (await pages()).find((p) => p.visible && p.win === 0)
const at = async (u) => (await shownPage())?.url === u
const inPage = (wc, code) => app.evaluate(({ webContents }, [wc, code]) => webContents.fromId(wc).executeJavaScript(code), [wc, code])
const tabs = () => win.$$eval("[role=tablist] [role=tab]", (els) => els.map((e) => e.textContent?.trim()))
const tabMenu = async (text, item) => {
  await win.locator("[role=tablist] [role=tab]", { hasText: text }).first().click({ button: "right" })
  await win.getByRole("menuitem", { name: item }).first().click()
}

// ---------- error pages ----------
await open(`http://127.0.0.1:${DEAD}/`)
const error = win.locator("[data-web-error]:visible")
check("refused: says so in words, with Try again", !!(await until(() => error.count(), 15000)) && /refused to connect/.test(await win.locator("[data-web-error-title]:visible").innerText())
  && await win.locator("[data-web-retry]:visible").count() === 1, await error.count() && await error.innerText())
check("… the code only small, under it", (await error.getAttribute("data-web-error")) === "ERR_CONNECTION_REFUSED", await error.getAttribute("data-web-error"))
await open("http://nowhere.invalid/")
check("a name that doesn't resolve: Can't find it", await until(async () => /Can't find nowhere\.invalid/.test(await win.locator("[data-web-error-title]:visible").innerText().catch(() => "")), 15000),
  await win.locator("[data-web-error]:visible").innerText().catch(() => ""))
const tries = () => app.evaluate(() => globalThis.__starts ?? 0)
await app.evaluate(({ webContents }) => { globalThis.__starts = 0; webContents.getAllWebContents().find((w) => w.getURL().includes("nowhere.invalid"))?.on("did-start-loading", () => { globalThis.__starts++ }) })
await win.evaluate(() => dispatchEvent(new Event("online")))
check("… tried again on its own once the Mac is back online", await until(async () => (await tries()) > 0, 5000), await tries())

// ---------- a certificate this Mac doesn't trust ----------
await open(`${SECURE}/`)
const unsafe = win.locator("[data-web-unsafe]:visible")
check("a self-signed certificate: Your connection isn't private", !!(await until(() => unsafe.count(), 15000)) && /Your connection isn.t private/.test(await unsafe.innerText()), [await unsafe.count(), await win.locator("[data-web-error]:visible").getAttribute("data-web-error").catch(() => null), await pages()])
check("… the page isn't shown under it", !(await pages()).some((p) => p.visible && p.url.startsWith(SECURE)), await pages())
check("… nothing to go on with till Advanced", await win.locator("[data-web-unsafe-go]:visible").count() === 0)
await win.locator("[data-web-unsafe-more]:visible").click()
await win.locator("[data-web-unsafe-go]:visible").click()
check("Continue (unsafe): the page, this time", await until(async () => (await pages()).some((p) => p.visible && p.url === `${SECURE}/`), 15000) && !(await unsafe.count()), await pages())
const sec = (await pages()).find((p) => p.visible && p.url === `${SECURE}/`)
check("… its address shown", (await win.locator("[data-web-address]:visible").inputValue()).includes(SECURE.replace("https://", "")), await win.locator("[data-web-address]:visible").evaluateAll((els) => els.map((e) => e.value)))
check("… trusted only for its host: another site's bad certificate still warns (localhost, the same server)",
  await (async () => { await open(SECURE.replace("127.0.0.1", "localhost") + "/"); return !!(await until(() => unsafe.count(), 15000)) })(), await pages())
await win.locator("[data-web-unsafe-back]:visible").click()
check("Back to safety: no page left at it (a blank tab, nothing back to)", await until(async () => !(await unsafe.count()) && await win.locator("[data-web-address]:visible").inputValue() === "", 5000),
  [await unsafe.count(), await win.locator("[data-web-address]:visible").evaluateAll((els) => els.map((e) => e.value)), await tabs()])

// ---------- a page that keeps crashing ----------
await open(`${SITE}/article`)
await until(() => at(`${SITE}/article`), 15000)
const art = await shownPage()
// Each crash waits for the last to be heard and its reload to be in: a renderer killed again before the app heard it die
// (a slow machine: Linux CI) is one death, not two.
await app.evaluate(({ webContents }, id) => {
  const wc = webContents.fromId(id)
  globalThis.__gone = 0; globalThis.__loads = 0
  wc.on("render-process-gone", () => { globalThis.__gone++ })
  wc.on("did-finish-load", () => { globalThis.__loads++ })
}, art.wc)
const counts = () => app.evaluate(() => ({ gone: globalThis.__gone, loads: globalThis.__loads }))
for (let i = 0; i < 4; i++) {
  const before = await counts()
  await app.evaluate(({ webContents }, id) => webContents.fromId(id).forcefullyCrashRenderer(), art.wc)
  await until(async () => (await counts()).gone > before.gone, 10000)
  // (the first three load again by themselves)
  if (i < 3) await until(async () => (await counts()).loads > before.loads && !(await pages()).find((p) => p.wc === art.wc)?.crashed, 15000)
}
const crashed = win.locator("[data-web-crashed]:visible")
check("crashing again and again: This page crashed, never a blank tab", !!(await until(() => crashed.count(), 8000)) && /This page crashed/.test(await crashed.innerText()), [await counts(), await pages()])
await win.locator("[data-web-reload]:visible").click()
check("… Reload brings it back", await until(async () => !(await crashed.count()) && (await pages()).some((p) => p.wc === art.wc && p.visible && !p.crashed && p.url === `${SITE}/article`), 15000), await pages())

// ---------- a loading tab ----------
await open(`${SITE}/slow`)
check("loading: a spinner for its tab's icon", await until(() => win.locator("[role=tablist] [role=tab] [data-web-loading]").count(), 4000))
check("… and the line under the bar", await win.locator("[data-web-progress=loading]:visible").count() === 1)
check("loaded: its site's icon again, the line gone", await until(async () => !(await win.locator("[role=tablist] [data-web-loading]").count()) && !(await win.locator("[data-web-progress=loading]").count()), 12000))

// ---------- typed input it holds ----------
await open(`${SITE}/article`)
await until(() => at(`${SITE}/article`), 15000)
const typedPage = await shownPage()
const listed = () => win.evaluate(() => window.vaultite.web.list())
await app.evaluate(async ({ webContents }, id) => {
  const wc = webContents.fromId(id)
  const [x, y] = await wc.executeJavaScript(`(() => { const r = document.querySelector("#note").getBoundingClientRect(); return [Math.round(r.left + 10), Math.round(r.top + 5)] })()`)
  wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 }); wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 })
  await new Promise((r) => setTimeout(r, 200))
  for (const c of "half a thought") wc.sendInputEvent({ type: "char", keyCode: c })
}, typedPage.wc)
check("typed and not sent: the page says it holds it (its tab isn't archived)", await until(async () => (await listed()).some((p) => p.id && p.url === `${SITE}/article` && p.typed), 5000), await listed())
await inPage(typedPage.wc, `document.querySelector("#note").value = ""; document.querySelector("#note").blur(); 1`)
check("… cleared: it doesn't any more", await until(async () => !(await listed()).some((p) => p.typed), 5000), await listed())

// ---------- view source ----------
await win.locator("[data-web-more]:visible").click()
await win.getByRole("menuitem", { name: "View page source" }).click()
check("View page source: a tab of its own at view-source:", await until(async () => (await shownPage())?.url === `view-source:${SITE}/article`, 10000), await pages())
check("… named by it", await until(async () => (await tabs()).some((t) => t?.includes("view-source:")), 5000), await tabs())

// ---------- duplicate tab ----------
await open(`${SITE}/article`)
await until(() => at(`${SITE}/article`), 15000)
const before = await shownPage()
await app.evaluate(async ({ webContents }, id) => {
  const wc = webContents.fromId(id)
  const [x, y] = await wc.executeJavaScript(`(() => { const r = document.querySelector("#next").getClientRects()[0]; return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] })()`)
  wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 }); wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 })
}, before.wc)
await until(() => at(`${SITE}/two`), 10000)
const n = (await tabs()).length
await tabMenu("Second part", "Duplicate tab")
check("Duplicate tab: a tab more, shown, at the same address", await until(async () => (await tabs()).length === n + 1 && (await shownPage())?.wc !== before.wc && await at(`${SITE}/two`), 10000), [await tabs(), await pages()])
check("… with its Back", await until(async () => (await shownPage())?.back, 5000), await pages())
check("… right after it", await until(() => win.evaluate(() => { const t = [...document.querySelectorAll("[role=tablist] [role=tab]")], i = t.findIndex((e) => e.getAttribute("aria-selected") === "true"); return t[i - 1]?.textContent?.includes("Second part") }), 3000),
  await win.evaluate(() => [...document.querySelectorAll("[role=tablist] [role=tab]")].map((e) => `${e.getAttribute("aria-selected")} ${e.textContent}`)))

// ---------- moved to a new window, its page goes along ----------
// (the first of the two: the one duplicated)
const moving = before
await inPage(moving.wc, "window.__kept = 'still here'; 1")
await tabMenu("Second part", "Move to new window")
check("moved to a new window: the same page there, shown, never loaded again",
  await until(async () => (await pages()).some((p) => p.wc === moving.wc && p.win === 1 && p.visible), 20000) && await inPage(moving.wc, "window.__kept") === "still here", await pages())
check("… and gone from this one", !(await pages()).some((p) => p.wc === moving.wc && p.win === 0), await pages())

await app.close()
await done()
