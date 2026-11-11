// Clicks on a web page in the desktop app's Browser are the page's at every edge and corner: Electron drags the window
// wherever any of its views has a drag region, even one under the page. So a site's own (ChatGPT's header) is off,
// and the window's regions are cut where a page shows, in every layout: rails on or off, the left sidebar open or
// hidden, the tab bar, pane tab bars, the page bar hidden, a split. The window's region is worked out as Electron does
// (each element's box in document order, drag adds, no-drag cuts, clipping ignored), against the page's native bounds.
// WRITES: the throwaway vault only.
//   node web/qa/pageclicks.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait, uiAt } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-pageclicks-"))

// A page made like ChatGPT's: a header that drags its own app's window, its corner button no-drag but before it.
const server = http.createServer((_q, r) => {
  r.writeHead(200, { "Content-Type": "text/html" })
  r.end(`<!doctype html><title>Corner</title><body style="margin:0;background:#cde">
    <a id=logo href="#" style="position:fixed;z-index:2;left:5px;top:7px;width:34px;height:32px;-webkit-app-region:no-drag">logo</a>
    <header id=head style="position:fixed;left:0;top:0;right:0;height:52px;-webkit-app-region:drag"></header>`)
})
await new Promise((ok) => server.listen(0, "127.0.0.1", ok))
const SITE = `http://127.0.0.1:${server.address().port}`

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BaseWindow }) => { BaseWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width: 1280, height: 800 }) })
const patch = (what, o) => fetch(`${origin}/api/config/${what}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) })
const ui = (body) => uiAt(origin)(body)

/** The pages shown in the window: their webContents ids and bounds (window CSS px). */
const pages = () => app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0], z = w.webContents.getZoomFactor(), [cw, ch] = w.getContentSize()
  return w.contentView.children.filter((v) => v.webContents && v.webContents !== w.webContents && v.getVisible()).map((v) => {
    const b = v.getBounds()
    return { id: v.webContents.id, x: b.x / z, y: b.y / z, w: b.width / z, h: b.height / z }
  }).filter((b) => b.x < cw / z && b.y < ch / z && b.x + b.w > 0 && b.y + b.h > 0)
})
/** Points of each page (its edges and corners closely, its inside coarsely) where the window's region would drag. */
const dragsOver = (shown) => win.evaluate((shown) => {
  const regions = []
  for (const e of document.querySelectorAll("*")) {
    const st = getComputedStyle(e), mode = st.webkitAppRegion
    if ((mode !== "drag" && mode !== "no-drag") || st.visibility !== "visible") continue
    const who = `${e.tagName.toLowerCase()}${[...e.attributes].filter((a) => a.name.startsWith("data-") || a.name === "role").map((a) => `[${a.name}]`).join("")}`
    for (const r of e.getClientRects()) if (r.width > 0 && r.height > 0) regions.push([mode === "drag", r.left, r.top, r.right, r.bottom, who])
  }
  // (the last region over a point says: the element that drags there)
  const drags = (x, y) => regions.reduce((on, [d, l, t, r, b, who]) => (x >= l && x < r && y >= t && y < b ? (d ? who : "") : on), "")
  const out = []
  for (const p of shown) {
    const xs = [], ys = []
    for (let x = p.x + 1; x < p.x + p.w; x += x < p.x + 160 || x > p.x + p.w - 160 ? 6 : 48) xs.push(x)
    for (let y = p.y + 1; y < p.y + p.h; y += y < p.y + 120 || y > p.y + p.h - 60 ? 6 : 48) ys.push(y)
    for (const x of xs) for (const y of ys) { const who = drags(x, y); if (who) { out.push([Math.round(x), Math.round(y), who]); if (out.length > 5) return out } }
  }
  return out
}, shown)
/** Whether the window still drags somewhere (the strip): the check above isn't vacuous. */
const dragsSomewhere = () => win.evaluate(() => [...document.querySelectorAll("*")].some((e) => getComputedStyle(e).webkitAppRegion === "drag" && e.getClientRects().length))
const leftToggle = (open) => win.evaluate((open) => {
  const t = document.querySelector("[data-sidebar-toggle='']")
  if (t && (t.getAttribute("aria-expanded") === "true") !== open) t.click()
}, open)

await ui({ action: "open", path: `view:web/${SITE}/`, newTab: true })
check("the page is shown", !!(await until(async () => (await pages()).length > 0, 15000)))

// ---------- the site's own drag region is off ----------
const site = await app.evaluate(async ({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0], v = w.contentView.children.find((c) => c.webContents && c.webContents !== w.webContents && c.getVisible())
  return v?.webContents.executeJavaScript(`[getComputedStyle(head).webkitAppRegion, getComputedStyle(logo).webkitAppRegion]`)
})
check("a site's drag header drags nothing (its regions are none)", site?.[0] === "none" && site?.[1] === "none", site)

// ---------- the window's regions never reach a page, in every layout ----------
const layouts = []
for (const rails of [false, true]) for (const left of [false, true]) for (const [tabBar, paneTabBars] of [[true, true], [false, true], [false, false]])
  for (const pageBar of [null, "hidden"]) layouts.push({ rails, left, tabBar, paneTabBars, pageBar })
let strip = true
/** The window has the layout's settings: they reach it from the vault a moment after they're written, and a sidebar
 *  hidden before would fold to its rail, then move again as rails go off. */
const applied = (l) => win.evaluate((l) => {
  const p = JSON.parse(localStorage.getItem("vaultite.prefs") ?? "{}")
  return p.rails === l.rails && p.tabBar === l.tabBar && p.paneTabBars === l.paneTabBars && !!document.querySelector("[data-web-bar-hidden]") === (l.pageBar === "hidden")
}, l)
/** No pane moves and the page is back: while its pane slides, a page is a picture of itself and waits off the window. */
const settled = async () => !(await win.evaluate(() => !!document.querySelector("[data-moving]"))) && (await pages()).length > 0
for (const l of layouts) {
  await patch("appearance", { rails: l.rails, tabBar: l.tabBar, paneTabBars: l.paneTabBars })
  await patch("plugin/web-viewer", { pageBar: l.pageBar })
  await until(() => applied(l), 8000)
  await leftToggle(l.left)
  await wait(700)
  await until(settled, 8000)
  const shown = await pages(), bad = await dragsOver(shown)
  const name = `rails ${l.rails ? "on" : "off"}, left ${l.left ? "open" : "hidden"}, tab bar ${l.tabBar ? "on" : "off"}${l.tabBar ? "" : `, pane tab bars ${l.paneTabBars ? "on" : "off"}`}, page bar ${l.pageBar ?? "shown"}`
  check(`${name}: nothing of the window drags over the page`, shown.length > 0 && !bad.length, { shown, bad })
  strip &&= await dragsSomewhere()
}
check("… while the window still drags by its strip", strip)

// ---------- a split: the page beside another pane ----------
await patch("appearance", { rails: false, tabBar: false, paneTabBars: false })
await patch("plugin/web-viewer", { pageBar: null })
await ui({ action: "open", path: `view:web/${SITE}/?2`, split: "right" })
await until(async () => (await pages()).length > 1, 8000)
await wait(700)
const split = await pages()
check("a page in a split, beside another: nothing drags over either", split.length > 1 && !(await dragsOver(split)).length, { split, bad: await dragsOver(split) })

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
