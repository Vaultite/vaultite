// Panes as cards in the desktop app (Electron), against a made-up page this script serves on 127.0.0.1: a web page's
// corners follow its card's curve where it meets the card's corners (one radius: the bar shown, its top ones too), square
// in flat panes and full screen; with its bar hidden, the gap above its card brings the bar as the page's top does
// (resting, not a quick pass; its pane's only, per pane in a split; not the tab bar), and right-clicked there has the
// bar's switch.
// WRITES: the throwaway vault only.
//   node web/qa/pagecorners.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait, keepAwake } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-pagecorners-"))
keepAwake(300)

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(`<!doctype html><title>Corners</title><body style="margin:0;background:#fff"><p style="margin:0;padding:8px">Top line</p><div style="height:2000px"></div>`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const SITE = `http://127.0.0.1:${server.address().port}`

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
// (each view's last radius, read back: Electron has no getter)
await app.evaluate(({ BaseWindow, WebContentsView }) => {
  const set = WebContentsView.prototype.setBorderRadius
  WebContentsView.prototype.setBorderRadius = function (r) { this.qaRadius = r; return set.call(this, r) }
  const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus()
})
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const appearance = (o) => fetch(`${origin}/api/config/appearance`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) })
const setting = (o) => fetch(`${origin}/api/config/plugin/web-viewer`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) })

/** The pages shown (window CSS px, left to right) with their radius, and each one's card and bar. */
const look = async () => {
  const views = await app.evaluate(({ BaseWindow }) => {
    const w = BaseWindow.getAllWindows()[0], z = w.webContents.getZoomFactor()
    return w.contentView.children.filter((x) => x.webContents && x.webContents !== w.webContents && x.getVisible() && x.getBounds().x > -1000)
      .map((v) => { const b = v.getBounds(); return { left: b.x / z, top: b.y / z, right: (b.x + b.width) / z, bottom: (b.y + b.height) / z, radius: (v.qaRadius ?? 0) / z } })
      .sort((a, b) => a.left - b.left)
  })
  const cards = await win.evaluate(() => [...document.querySelectorAll("[data-web-page]")].filter((e) => e.getBoundingClientRect().width > 0).map((page) => {
    const c = page.closest("[data-pane-frame]").getBoundingClientRect(), bar = page.querySelector("[data-web-bar]")
    return { left: c.left, top: c.top, bottom: c.bottom, radius: parseFloat(getComputedStyle(page.closest("[data-pane-frame]")).borderBottomLeftRadius) || 0,
      bar: bar?.getAttribute("data-web-bar-hidden") ?? "shown" }
  }).sort((a, b) => a.left - b.left))
  return { views, cards }
}
const near = (a, b) => Math.abs(a - b) <= 1
/** Every page rounded as its card (`on`), or square. */
const rounded = (l, on) => l.views.length === l.cards.length && l.views.length > 0 && l.views.every((v, i) => (on ? near(v.radius, l.cards[i].radius) && v.radius > 0 : v.radius === 0))
const barOf = async (i = 0) => (await look()).cards[i]?.bar

// ---------- cards, the bar shown: rounded, its foot at the card's ----------
await appearance({ paneCards: true, tabBar: true, paneTitles: false })
await ui({ action: "open", path: `view:web/${SITE}/one`, newTab: true })
check("cards, bar shown: the page rounded as its card", await until(async () => { const l = await look(); return rounded(l, true) && near(l.views[0].bottom, l.cards[0].bottom) }, 15000), await look())

// ---------- flat: square ----------
await appearance({ paneCards: false })
check("flat panes: the page square, at once", await until(async () => rounded(await look(), false), 4000), await look())
await appearance({ paneCards: true })
check("… cards again: rounded again", await until(async () => rounded(await look(), true), 4000), await look())

// ---------- the bar hidden: the page fills its card, rounded ----------
await setting({ pageBar: "hidden" })
check("bar hidden: the page fills its card, rounded", await until(async () => { const l = await look(); return rounded(l, true) && l.cards[0].bar === "in" && near(l.views[0].top, l.cards[0].top) }, 8000), await look())

// ---------- the gap above the card ----------
const gap = win.locator("[data-pane-gap]:visible").first()
check("a gap above the card, as wide as it", await until(async () => { const g = await gap.boundingBox(), l = await look(); return g && g.height >= 4 && near(g.x, l.cards[0].left) && near(g.y + g.height, l.cards[0].top) }, 4000), await gap.boundingBox())
const strip = await win.locator("[data-tab-strip]").first().boundingBox()
const mid = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
const away = async () => {
  const v = (await look()).views[0]
  await win.mouse.move(v.left + 300, v.top + 400)
  await win.mouse.move(v.left + 320, v.top + 420)
  return until(async () => (await barOf()) === "in", 4000)
}
let g = await gap.boundingBox()
await win.mouse.move(mid(strip).x, mid(strip).y)
await wait(400)
check("the tab bar doesn't bring it", (await barOf()) === "in", await look())
await win.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
check("the pointer resting in the gap brings the bar", await until(async () => (await barOf()) === "out", 2000), await look())
// (out, the window's over the page: what's behind it is cut away but outside the page's rounded corners)
check("… the window over the page keeps the gaps' colour outside its corners", await until(() => win.evaluate(() =>
  /radial-gradient/.test(document.querySelector("[data-pane-area]").style.getPropertyValue("--web-hole-image"))), 2000))
if (process.env.SHOTS) await win.screenshot({ path: path.join(process.env.SHOTS, "pagecorners-out.png") })
await win.mouse.move(g.x + g.width / 2 + 30, g.y + g.height / 2)
await wait(600)
check("… which stays while the pointer is in the gap", (await barOf()) === "out", await look())
check("… and goes once it's left", await away(), await look())

// A quick pass through the gap onto the page (a frame in the gap, less than the rest): no bar.
await win.mouse.move(mid(strip).x, mid(strip).y)
await win.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
await wait(20)
await app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((c) => c.webContents && c.webContents !== w.webContents && c.getVisible())
  v.webContents.sendInputEvent({ type: "mouseMove", x: 400, y: 200 })
})
await wait(500)
check("a quick pass through the gap into the page: the bar stays away", (await barOf()) === "in", await look())

// From the page's top up into the gap, the page telling it left after the window heard the gap: one band.
await win.mouse.move(mid(strip).x, mid(strip).y)
await app.evaluate(({ BaseWindow }, [x, y]) => {
  const w = BaseWindow.getAllWindows()[0], z = w.webContents.getZoomFactor()
  const v = w.contentView.children.find((c) => c.webContents && c.webContents !== w.webContents && c.getVisible())
  v.webContents.sendInputEvent({ type: "mouseMove", x: 400, y: 2 })
  w.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(x * z), y: Math.round(y * z) })
  v.webContents.sendInputEvent({ type: "mouseLeave", x: 400, y: 0 })
}, [g.x + g.width / 2, g.y + g.height / 2])
check("from the page's top into the gap: the bar comes", await until(async () => (await barOf()) === "out", 2000), await look())
check("… and goes again", await away(), await look())

// A click there brings it at once; its right-click has the bar's switch.
g = await gap.boundingBox()
await win.mouse.click(g.x + g.width / 3, g.y + g.height / 2)
check("a click in the gap brings it", await until(async () => (await barOf()) === "out", 1000), await look())
await win.mouse.click(g.x + g.width / 3, g.y + g.height / 2, { button: "right" })
const items = await until(async () => { const t = await win.locator("[role=menu] [role^=menuitem]").allInnerTexts(); return t.length ? t : null }, 3000) ?? []
check("the gap's right-click: the pane's top's menu, Always show page bar last", items.at(-1)?.startsWith("Always show page bar") && items.some((t) => t.startsWith("Hide tab bar")), items)
await win.keyboard.press("Escape")
await away()

// ---------- a split: each page rounded, each gap its own pane's ----------
await ui({ action: "open", path: `view:web/${SITE}/two`, split: "right" })
check("split: both pages rounded as their cards", await until(async () => { const l = await look(); return l.views.length === 2 && rounded(l, true) }, 15000), await look())
const gaps = win.locator("[data-pane-gap]:visible")
check("… a gap above each", await until(async () => (await gaps.count()) === 2, 3000), await gaps.count())
const right = await gaps.nth(1).boundingBox()
await win.mouse.move(right.x + right.width / 2, right.y + right.height / 2)
check("the right gap brings the right page's bar", await until(async () => (await barOf(1)) === "out", 2000), await look())
check("… not the left's", (await barOf(0)) === "in", await look())
// (the divider between them keeps its own place: no gap over it)
const divider = await win.locator("[data-pane-area] [role=separator]").first().boundingBox()
check("the gaps keep clear of the divider", !!divider && (await gaps.nth(0).boundingBox()).x + (await gaps.nth(0).boundingBox()).width <= divider.x + divider.width && right.x >= divider.x, { divider, right })
await away()
await until(async () => (await barOf(1)) === "in", 4000)

// ---------- the page full screen: square ----------
await app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((c) => c.webContents && c.webContents !== w.webContents && c.getVisible())
  void v.webContents.executeJavaScript("document.documentElement.requestFullscreen()", true)
})
const full = async () => app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0], [width] = w.getContentSize()
  const v = w.contentView.children.find((c) => c.webContents && c.webContents !== w.webContents && c.getVisible() && c.getBounds().width === width)
  return v ? v.qaRadius ?? 0 : null
})
check("a page full screen: square", await until(async () => (await full()) === 0, 5000), await full())
await app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0]
  for (const c of w.contentView.children) if (c.webContents && c.webContents !== w.webContents) void c.webContents.executeJavaScript("document.fullscreenElement && document.exitFullscreen()", true).catch(() => {})
})
check("… back in its card: rounded again", await until(async () => { const l = await look(); return l.views.length === 2 && rounded(l, true) }, 8000), await look())

await setting({ pageBar: null })
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
