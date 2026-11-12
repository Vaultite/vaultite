// The Browser's downloads in the desktop app (electron/downloads.ts, plugins/core/web-viewer/downloads.tsx, downloadlist.ts), against
// files this script serves on 127.0.0.1: a toast as one starts and as it ends (Open), the page bar's Downloads button
// and the status bar's while it goes, the list's progress (known and unknown sizes), Cancel, a broken one (Retry), and
// Open from the list; the finished ones kept in userData. SHOTS=<dir> keeps pictures of the button and the list.
// WRITES: the throwaway vault only.
//   node web/qa/downloads.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait, keepAwake } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-downloads-"))
const SHOTS = process.env.SHOTS
keepAwake(600)

// ---------- made-up files ----------
const MB = 1000 * 1000
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Lighthouse</title>
<style>body{font:18px/1.6 system-ui;margin:40px}a{display:block;margin:14px 0;font-size:18px}</style></head><body><h1>Lighthouse</h1>
<a id="big" href="/Lighthouse.dmg">Get the app</a><a id="slow" href="/slow.zip">The archive</a>
<a id="nosize" href="/notes.txt">Notes, no size</a><a id="broken" href="/broken.zip">A broken one</a></body></html>`
/** `total` bytes over `ms`, `length` said or not, cut off halfway when `cut`. */
function stream(res, name, total, ms, { length = true, cut = false } = {}) {
  res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${name}"`, ...(length ? { "Content-Length": total } : {}) })
  const steps = 40, chunk = Buffer.alloc(Math.ceil(total / steps), 7)
  let i = 0
  const t = setInterval(() => {
    if (res.destroyed) return clearInterval(t)
    if (cut && i === steps / 2) { clearInterval(t); return res.destroy() }
    res.write(chunk.subarray(0, Math.min(chunk.length, total - i * chunk.length)))
    if (++i >= steps) { clearInterval(t); res.end() }
  }, ms / steps)
}
const server = http.createServer((req, res) => {
  const u = req.url ?? "/"
  if (u.startsWith("/Lighthouse.dmg")) return stream(res, "Lighthouse.dmg", 6 * MB, 6000)
  if (u.startsWith("/slow.zip")) return stream(res, "slow.zip", 20 * MB, 60000)
  if (u.startsWith("/notes.txt")) return stream(res, "notes.txt", 2 * MB, 3000, { length: false })
  if (u.startsWith("/broken.zip")) return stream(res, "broken.zip", 4 * MB, 2000, { cut: true })
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(PAGE)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const SITE = `http://127.0.0.1:${server.address().port}`

const plugins = path.join(VAULT, ".vaultite/plugins.json")
const on = fs.existsSync(plugins) ? JSON.parse(fs.readFileSync(plugins, "utf8")) : { enabled: [], disabled: [] }
fs.writeFileSync(plugins, JSON.stringify({ ...on, enabled: [...new Set([...(on.enabled ?? []), "web-viewer"])] }))

// ---------- the app ----------
const DOWNLOADS = path.join(TMP, "Downloads"), USER = path.join(TMP, "userData")
fs.mkdirSync(DOWNLOADS)
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: USER, VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ app: a, BaseWindow, BrowserWindow, shell }, dl) => {
  globalThis.__opened = []
  shell.openPath = async (p) => { globalThis.__opened.push(p); return "" }
  shell.showItemInFolder = (p) => { globalThis.__opened.push(`show:${p}`) }
  a.setPath("downloads", dl)
  const w = BaseWindow.getAllWindows().find((x) => !(x instanceof BrowserWindow) && x.webContents); w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus()
}, DOWNLOADS)
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const pages = () => app.evaluate(({ BaseWindow, BrowserWindow }) => {
  const w = BaseWindow.getAllWindows().find((x) => !(x instanceof BrowserWindow) && x.webContents)
  return w.contentView.children.filter((v) => v.webContents && v.webContents !== w.webContents).map((v) => ({ url: v.webContents.getURL(), visible: v.getVisible() && v.getBounds().x > -1000 }))
})
const clickInPage = (sel) => app.evaluate(async ({ BaseWindow, BrowserWindow }, sel) => {
  const w = BaseWindow.getAllWindows().find((x) => !(x instanceof BrowserWindow) && x.webContents)
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible() && x.getBounds().x > -1000)
  const [x, y] = (await v.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getClientRects()[0]; return [r.left + 20, r.top + r.height / 2] })()`)).map(Math.round)
  v.webContents.sendInputEvent({ type: "mouseMove", x, y })
  v.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 })
  v.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 })
}, sel)
const toast = (text) => until(async () => (await win.locator("[data-sonner-toast]", { hasText: text }).count()) > 0, 10000)
const button = win.locator("[data-web-bar] [data-web-downloads]").first()
// (a closed menu's picture lingers as it fades, inert: never the one open)
const MENU = "[role=menu]:not([inert] *)"
const menu = win.locator(MENU).first()
const row = (name) => menu.locator("button[data-index]", { hasText: name }).first()
const openList = async () => { await button.click(); await menu.waitFor({ timeout: 5000 }) }
const closeList = async () => { await win.keyboard.press("Escape"); await until(async () => !(await menu.count()), 3000) }
const shot = async (loc, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await loc.screenshot({ path: path.join(SHOTS, name) }) } }

await ui({ action: "open", path: `${SITE}/`, newTab: true })
check("(the page is shown)", await until(async () => (await pages()).some((p) => p.visible && p.url === `${SITE}/`), 30000), await pages())
await wait(500)
check("before any download: no Downloads button in the page bar", !(await button.count()))
if (SHOTS) await shot(win.locator("[data-web-bar]").first(), "bar-before.png")

// ---------- one with its size: started, going, done ----------
await clickInPage("#big")
check("a download starts: a toast says so", await toast("Downloading Lighthouse.dmg"))
check("… the page bar shows Downloads, going", await until(async () => (await button.getAttribute("data-web-downloads").catch(() => null)) === "going", 5000))
check("… and the status bar says which", await until(async () => (await win.locator("[data-ambient-downloads=going]", { hasText: "Lighthouse.dmg" }).count()) > 0, 5000))
await wait(2000)
await openList()
const pct = Number(await row("Lighthouse.dmg").locator("[data-menu-progress]").getAttribute("data-menu-progress"))
check("its list: the row's bar part filled", pct > 0 && pct < 100, pct)
check("… and how far in words", /\d.* of 6 MB/.test(await row("Lighthouse.dmg").innerText()), await row("Lighthouse.dmg").innerText())
await shot(win.locator("[data-web-bar]").first(), "bar-going.png")
if (SHOTS) {
  const r = await menu.boundingBox(), b = await win.locator("[data-web-bar]").first().boundingBox()
  await win.screenshot({ path: path.join(SHOTS, "list-going.png"), clip: { x: Math.max(0, r.x - 260), y: b.y, width: r.width + 280, height: r.y + r.height - b.y + 12 } })
}
const later = Number(await until(async () => {
  const v = Number(await row("Lighthouse.dmg").locator("[data-menu-progress]").getAttribute("data-menu-progress").catch(() => 0))
  return v > pct ? v : 0
}, 4000))
check("… live: the open list moves on", later > pct, [pct, later])
await closeList()
check("done: a toast says so, with Open", await until(async () => (await win.locator("[data-sonner-toast]", { hasText: "Downloaded Lighthouse.dmg" }).locator("button", { hasText: "Open" }).count()) > 0, 15000))
check("… the file is whole in Downloads", fs.existsSync(path.join(DOWNLOADS, "Lighthouse.dmg")) && fs.statSync(path.join(DOWNLOADS, "Lighthouse.dmg")).size === 6 * MB)
check("… the button shows it done", (await button.getAttribute("data-web-downloads")) === "done")
check("… and the status bar too", await until(async () => (await win.locator("[data-ambient-downloads=done]").count()) > 0, 3000))
await win.locator("[data-sonner-toast]", { hasText: "Downloaded Lighthouse.dmg" }).locator("button", { hasText: "Open" }).click()
check("the toast's Open opens the file", await until(() => app.evaluate(() => globalThis.__opened.slice()).then((l) => l.includes(path.join(DOWNLOADS, "Lighthouse.dmg"))), 5000))
await wait(2800)
check("… then the button rests", (await button.getAttribute("data-web-downloads")) === "idle")
await openList()
check("in the list: its size, and a click opens it", /6 MB/.test(await row("Lighthouse.dmg").innerText()), await row("Lighthouse.dmg").innerText())
await win.evaluate(() => { globalThis.__x = 0 })
await app.evaluate(() => { globalThis.__opened = [] })
await row("Lighthouse.dmg").hover()
const sub = win.locator(MENU).nth(1)
await sub.waitFor({ timeout: 3000 })
await sub.locator("button", { hasText: /^Show in/ }).click()
check("… Show in Finder from its menu", await until(() => app.evaluate(() => globalThis.__opened.slice()).then((l) => l.includes(`show:${path.join(DOWNLOADS, "Lighthouse.dmg")}`)), 5000))

// ---------- no size: an unknown bar ----------
await clickInPage("#nosize")
await toast("Downloading notes.txt")
await wait(800)
await openList()
check("one that doesn't say its size: a bar going, how far unknown", (await row("notes.txt").locator("[data-menu-progress]").getAttribute("data-menu-progress")) === "unknown")
await closeList()
check("… and it finishes", await toast("Downloaded notes.txt"))

// ---------- cancelled from the list ----------
await clickInPage("#slow")
await toast("Downloading slow.zip")
await wait(1000)
await openList()
await row("slow.zip").hover()
await win.locator(MENU).nth(1).locator("button", { hasText: "Cancel download" }).click()
check("Cancel download: a toast says it's cancelled", await toast("Cancelled slow.zip"))
await openList()
check("… the list says so", /Cancelled/.test(await row("slow.zip").innerText()), await row("slow.zip").innerText())
await closeList()
check("… and nothing's left of it", await until(() => !fs.readdirSync(DOWNLOADS).some((f) => f.startsWith("slow")), 5000), fs.readdirSync(DOWNLOADS))

// ---------- broken: failed, Retry ----------
await clickInPage("#broken")
check("a download that breaks off: a toast says it failed, with Retry", await until(async () => (await win.locator("[data-sonner-toast]", { hasText: "Couldn't download broken.zip" }).locator("button", { hasText: /^(Retry|Resume)$/ }).count()) > 0, 20000))
await openList()
check("… the list says Failed", /Failed/.test(await row("broken.zip").innerText()), await row("broken.zip").innerText())
if (SHOTS) {
  const r = await menu.boundingBox(), b = await win.locator("[data-web-bar]").first().boundingBox()
  await win.screenshot({ path: path.join(SHOTS, "list-done.png"), clip: { x: Math.max(0, r.x - 260), y: b.y, width: r.width + 280, height: r.y + r.height - b.y + 12 } })
}
await closeList()

// ---------- kept ----------
const kept = JSON.parse(fs.readFileSync(path.join(USER, "web-downloads.json"), "utf8"))
check("the finished ones are kept on this Mac", ["Lighthouse.dmg", "notes.txt", "slow.zip", "broken.zip"].every((n) => kept.some((d) => d.name === n)), kept.map((d) => `${d.name} ${d.state}`))

await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
