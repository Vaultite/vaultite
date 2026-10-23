// The Browser in the desktop app (Electron) against pages this script serves on 127.0.0.1: a web link opens a web
// tab, a native view laid over its pane (splits, sidebar, dividers, zoom), live under the window's page while the
// palette, a menu, a drag or a toast is over it (the window raised, see-through there, a toast's pointer passed on), kept on tab switches; links, back, new tabs (a middle-click on Back, a ⌘-click on Reload) and other schemes; no bridge into the app; app
// shortcuts from the page; Save to vault, downloads, an image's menu; a tab's page is its own (a slow one switched away
// from and back, two tabs of one address, ⌘⇧T); closing ends the page. SHOW=1 shows the window;
// screenshots (screencapture, so the native view is in them) go to <out dir>.
// WRITES: the throwaway vault only.
//   node web/qa/webviewer.mjs <vault copy> <out dir>
import { _electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT, OUT_ARG], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const OUT = path.resolve(OUT_ARG)
fs.mkdirSync(OUT, { recursive: true })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-webviewer-"))

// The display stays awake (a window on a sleeping display is hidden: no frames, no screenshots).
const awake = process.platform !== "darwin" ? null
  : (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "900"], { stdio: "ignore" })
process.on("exit", () => awake?.kill())

// ---------- made-up pages ----------
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="author" content="Alice Park"><meta name="description" content="A made-up article for the Browser's QA.">
<style>body{font:18px/1.5 Georgia,serif;margin:0;padding:40px 60px;background:#1d1f21;color:#d6d3cc}a{color:#8ab4f8}h1{font-size:40px}.box{height:900px}</style></head>
<body>${body}</body></html>`
const ARTICLE = page("Lighthouse field notes", `<article><h1>Lighthouse field notes</h1>
<p>The keeper climbs one hundred and twelve steps every evening to light the lamp. This article is long enough to be read as an article: it has
several paragraphs, each of them saying something about the lighthouse, its keeper, and the sea around it.</p>
<p>In winter the fog comes in from the north and the horn sounds every thirty seconds. Ships keep well away from the rocks below.</p>
<p>Read <a id="next" href="/two">the second part</a>, or <a id="blank" href="/three" target="_blank">the third part in a new tab</a>,
or <a id="file" href="/file.txt" download>the log book</a>.</p><img id="pic" src="/lamp.png" width="80" height="80"><div class="box"></div></article>`)
// (a 1x1 PNG)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")
const server = http.createServer((req, res) => {
  const u = req.url ?? "/"
  if (u.startsWith("/lamp.png")) { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(PNG) }
  // (a page that takes a while: nothing of it has loaded while its tab is switched away from and back)
  if (u.startsWith("/slow")) return void setTimeout(() => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(page("Slow part", "<h1>Slow part</h1>")) }, 5000)
  if (u.startsWith("/file.txt")) { res.writeHead(200, { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=\"log book.txt\"" }); return res.end("Day one: calm.\n") }
  const html = u.startsWith("/two") ? page("Second part", "<h1>Second part</h1><p>The second part.</p>")
    : u.startsWith("/three") ? page("Third part", "<h1>Third part</h1><p>The third part.</p>")
    : ARTICLE
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(html)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const PORT = server.address().port
const SITE = `http://127.0.0.1:${PORT}`

// A note with a web link (the second line, so the cursor isn't on it).
fs.mkdirSync(path.join(VAULT, "Notes"), { recursive: true })
fs.writeFileSync(path.join(VAULT, "Notes/Reading list.md"), `# Reading list\n\nStart with [the field notes](${SITE}/article) today.\n`)

// (Dark, the app and its pages: SHOW puts the window in front of whoever runs it, often at night.)
fs.mkdirSync(path.join(VAULT, ".vaultite"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite/appearance.json"), JSON.stringify({ theme: "dark" }))

// ---------- the app ----------
const DOWNLOADS = path.join(TMP, "Downloads")
fs.mkdirSync(DOWNLOADS)
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
// The system browser and Downloads are stand-ins: nothing leaves this run.
await app.evaluate(({ app: a, shell }, dl) => {
  globalThis.__opened = []
  shell.openExternal = async (u) => { globalThis.__opened.push(u) }
  shell.showItemInFolder = (p) => { globalThis.__opened.push(`reveal:${p}`) }
  a.setPath("downloads", dl)
}, DOWNLOADS)
const opened = () => app.evaluate(() => globalThis.__opened)
// (SHOW: the app comes to the front, so the keyboard is really its own: started from a terminal, macOS leaves it behind)
await app.evaluate(({ app: a, BaseWindow, nativeTheme }, show) => { nativeTheme.themeSource = "dark"; const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); if (show) a.focus({ steal: true }); w.focus() }, !!process.env.SHOW)
const menuClick = (label) => app.evaluate(({ Menu, BaseWindow }, label) => {
  const find = (items) => { for (const i of items) { if (i.label === label) return i; const s = i.submenu && find(i.submenu.items); if (s) return s } }
  find(Menu.getApplicationMenu().items).click(undefined, BaseWindow.getAllWindows()[0])
}, label)
/** The web pages laid over the vault window (its own page left out). */
const pages = () => app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows().find((x) => x.contentView.children.length > 1) ?? BaseWindow.getAllWindows()[0]
  return w.contentView.children.filter((v) => v.webContents && v.webContents !== w.webContents)
    .map((v) => ({ url: v.webContents.getURL(), visible: v.getVisible(), bounds: v.getBounds(), wc: v.webContents.id }))
})
/** Run JavaScript in the visible page. */
const inPage = (code) => app.evaluate(({ BaseWindow }, code) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  return v ? v.webContents.executeJavaScript(code) : null
}, code)
/** Click an element of the visible page as a person would (a real input event: a page's own .click() has no user
 *  activation, and Chromium then skips its history entry for Back). */
const clickInPage = (sel) => app.evaluate(async ({ BaseWindow }, sel) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  // (its first line's box: a link that wraps, as with another platform's fonts, has its middle between its lines)
  const r = await v.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getClientRects()[0]; return [r.left + r.width / 2, r.top + r.height / 2] })()`)
  const [x, y] = r.map(Math.round)
  v.webContents.sendInputEvent({ type: "mouseMove", x, y })
  v.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 })
  v.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 })
}, sel)
/** Where the page goes: its box, above the status bar where that reaches over the box's foot. */
const box = () => win.evaluate(() => {
  const el = [...document.querySelectorAll("[data-web-box]")].find((e) => e.getBoundingClientRect().width > 0)
  if (!el) return null
  const r = el.getBoundingClientRect(), bar = document.querySelector("[data-status-bar]")?.getBoundingClientRect()
  const over = bar?.height && bar.left < r.right && bar.right > r.left && bar.top < r.bottom && bar.bottom > r.top
  return { x: r.left, y: r.top, width: r.width, height: over ? bar.top - r.top : r.height }
})
const zoom = () => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].webContents.getZoomFactor())
/** The visible page sits exactly on its box (in the window's pixels: the box's times the zoom). */
async function aligned() {
  const [ps, b, z] = [await pages(), await box(), await zoom()]
  const v = ps.find((p) => p.visible)
  if (!v || !b) return { v, b, over: await over() }
  const want = { x: Math.round(b.x * z), y: Math.round(b.y * z), width: Math.round(b.width * z), height: Math.round(b.height * z) }
  return ["x", "y", "width", "height"].every((k) => Math.abs(v.bounds[k] - want[k]) <= 1) ? true : { got: v.bounds, want }
}
/** What's over the box, if anything (for a failure's message). */
const over = () => win.evaluate(() => {
  const el = [...document.querySelectorAll("[data-web-box]")].find((e) => e.getBoundingClientRect().width > 0)
  if (!el) return "no box"
  const r = el.getBoundingClientRect(), out = new Set()
  for (let x = r.left + 1; x < r.right; x += 40) for (let y = r.top + 1; y < r.bottom; y += 40) {
    const at = document.elementFromPoint(x, y)
    if (at && at !== el && !el.contains(at)) out.add(`${at.tagName}.${String(at.className).slice(0, 60)} [${at.getAttribute("aria-label") ?? ""}]`)
  }
  for (const f of document.querySelectorAll("[data-floats], [data-sonner-toast]")) out.add(`floats: ${f.tagName} ${JSON.stringify(f.getBoundingClientRect())}`)
  return [...out]
})
const isAligned = async () => (await aligned()) === true
const shown = async () => (await pages()).some((p) => p.visible)
/** The window's page over its pages (electron/web.ts `raise`). */
const raised = () => app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0], kids = w.contentView.children
  return kids.length > 1 && kids.indexOf(w.view) === kids.length - 1
})
/** Nothing of the window's paints behind the shown page (layers.ts cuts it): it shows there while the window's raised. */
const seeThrough = () => win.evaluate(() => {
  const el = [...document.querySelectorAll("[data-web-box]")].find((e) => e.getBoundingClientRect().width > 0)
  const r = el?.getBoundingClientRect()
  if (!r) return "no box"
  const x = r.left + r.width / 2, y = r.top + r.height / 2
  for (let e = el; e; e = e.parentElement) {
    const st = getComputedStyle(e)
    if (st.backgroundImage === "none" && !/^(transparent|rgba\(.*,\s*0\))$/.test(st.backgroundColor)) return `${e.tagName}.${e.className} paints ${st.backgroundColor}`
    if (st.backgroundImage !== "none" && e.hasAttribute("data-web-hole")) {
      // (its strips: none over the page's middle)
      const b = e.getBoundingClientRect(), sizes = st.backgroundSize.split(", "), at = st.backgroundPosition.split(", ")
      for (let i = 0; i < sizes.length; i++) {
        const [w, h] = sizes[i].split(" ").map(parseFloat), [px, py] = at[i].split(" ").map(parseFloat)
        if (x >= b.left + px && x < b.left + px + w && y >= b.top + py && y < b.top + py + h) return `${e.tagName} strip ${i} over the page`
      }
    }
  }
  return true
})
/** The real window as it's on screen (the native page is in it, unlike a page screenshot). */
async function shot(name) {
  if (!process.env.SHOW) return // (quiet: the window is transparent, so the screen shows what's behind it)
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].focus())
  try { execFileSync("caffeinate", ["-u", "-t", "2"]) } catch { /* fine */ }
  await wait(250)
  const b = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].getBounds())
  try { execFileSync("screencapture", ["-x", "-o", `-R${b.x},${b.y},${b.width},${b.height}`, path.join(OUT, `${name}.png`)], { stdio: "ignore" }) } catch (e) { console.log(`(no screenshot: ${e.message})`) }
}
const tabTitles = () => win.evaluate(() => [...document.querySelectorAll("[role=tablist] [role=tab]")].map((t) => t.textContent?.trim()))

// ---------- a link in a note ----------
await fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "open", path: "Notes/Reading list.md" }) })
await win.waitForSelector(".cm-link[data-url]", { timeout: 15000 })
await win.locator(".cm-link[data-url]").first().click({ modifiers: ["ControlOrMeta"] })
check("⌘-click on a web link in a note: the system browser", await until(async () => (await opened()).includes(`${SITE}/article`), 10000), await opened())
check("… and no web tab", (await pages()).length === 0, await pages())
// (the cursor off the link's line, so it's drawn as a link: on its line, only ⌘ follows it)
await win.locator(".cm-line", { hasText: "Reading list" }).first().click()
await wait(300)
await win.locator(".cm-link[data-url]").first().click()
check("a click on a web link in a note opens a web tab", await until(async () => (await pages()).some((p) => p.url === `${SITE}/article` && p.visible), 15000), await pages())
check("the tab is named after the page", await until(async () => (await tabTitles()).some((t) => t?.includes("Lighthouse field notes")), 10000), await tabTitles())
check("the page sits exactly over its pane", await until(isAligned, 10000), [await aligned(), await over()])
check("the address shows where it is", await win.locator("[data-web-address]").inputValue() === `${SITE}/article`)
await wait(600)
await shot("1-page")

// ---------- it's sealed off ----------
const sealed = await inPage("[typeof window.vaultite, typeof require, typeof process].join()")
check("the page has no bridge, no require, no process", sealed === "undefined,undefined,undefined", sealed)
const part = await app.evaluate(({ BaseWindow, session }) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents)
  return { own: v.webContents.session === session.fromPartition("persist:web"), app: w.webContents.session !== v.webContents.session, ua: v.webContents.getUserAgent() }
})
check("its session is its own, persistent (persist:web), apart from the app's", part.own && part.app, part)
check("its user agent doesn't say Electron", !/Electron|vaultite/i.test(part.ua), part.ua)
await inPage("location.href = 'file:///etc/hosts'")
await wait(800)
check("a page can't go to file:", (await pages()).every((p) => p.url.startsWith(SITE)), await pages())

// ---------- overlays ----------
// (once the toasts from the start are gone: a toast over the page raises the window too, below)
check("the shown page: the window under it, see-through behind it", await until(async () => !(await raised()), 15000) && (await seeThrough()) === true, [await raised(), await seeThrough(), await over()])
await menuClick("Command palette")
check("the palette over the page: the window goes over it and the page stays live", await until(raised, 10000) && await shown(), await pages())
check("… and shows through the window", (await seeThrough()) === true, await seeThrough())
await wait(300)
await shot("2-palette")
await win.keyboard.press("Escape")
check("the palette gone: the window back under the page", await until(async () => !(await raised()), 10000) && await shown(), await pages())
await win.locator("[role=tab]", { hasText: "Lighthouse" }).first().click({ button: "right" })
check("a tab's menu over the page: the window goes over it", await until(raised, 10000) && await shown(), await pages())
// (nothing blurs a native page: glass goes solid over one)
const menuFill = await win.evaluate(() => getComputedStyle(document.querySelector("[role=menu]")).backgroundColor)
check("… solid there, not see-through glass", !/rgba|\/ 0?\.\d/.test(menuFill), menuFill)
await wait(200)
await shot("3-tab-menu")
await win.keyboard.press("Escape")
await win.mouse.click(5, 400) // (somewhere in the sidebar, if a menu is still there)
check("the menu gone: the window back under it", await until(async () => !(await raised()), 10000), await pages())
await win.locator("[data-web-page] button[aria-label=Back]").hover({ force: true })
await win.locator("[data-web-page] [data-web-more]").hover()
let tip = null
check("a tooltip of the bar over the page: the window goes over it, the page stays",
  await until(async () => (tip = await win.locator("[role=tooltip]").boundingBox({ timeout: 200 }).catch(() => null)) && await raised(), 3000) && await shown(), [await pages(), tip, await over()])
await win.mouse.move(5, 400)
check("… and back under it as it goes", await until(async () => !(await raised()), 10000))

// A tab dragged over the page: the window goes over it, so the pane's drop zones show (and the drag keeps the pointer).
const tb = await win.locator("[role=tab]", { hasText: "Lighthouse" }).first().boundingBox()
await win.mouse.move(tb.x + 40, tb.y + tb.height / 2)
await win.mouse.down()
// (to the pane's left edge: a drop there would split it)
const bx = await box()
for (let i = 1; i <= 12; i++) await win.mouse.move(tb.x + 40 + ((bx.x + 30) - (tb.x + 40)) * i / 12, tb.y + tb.height / 2 + ((bx.y + bx.height / 2) - (tb.y + tb.height / 2)) * i / 12)
check("a tab dragged over the page: the window goes over it", await until(raised, 3000) && await shown(), await pages())
check("… and the pane's drop zone shows", await until(async () => (await win.locator("[data-drop-zone]").count()) > 0, 3000))
await shot("3b-drag")
await win.keyboard.press("Escape")
await win.mouse.up()
check("the drag cancelled: the window back under the page", await until(async () => !(await raised()), 10000) && await shown(), await pages())

// A toast over the page: the window goes over it, letting the pointer through to the page; its button works; it goes
// back under as the toast goes. The palette over a page that had the keyboard: back to it.
await fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notify", text: "A toast over the page", button: { label: "Open", open: "Notes/Reading list.md" } }) })
await win.waitForSelector("[data-sonner-toast]:has-text('A toast over the page')", { timeout: 5000 })
check("a toast over the page: the window goes over it, the page stays shown", await until(raised, 4000) && await shown(), await pages())
await inPage("window.__downs = 0; addEventListener('mousedown', () => window.__downs++); 1")
const pb = await box()
// (the window's page with the keyboard, as where such a click lands: a note's editor kept it, and got the typing; only
// with SHOW=1, a window that isn't focused has no keyboard to give)
await app.evaluate(({ app: a, BaseWindow }, show) => { const w = BaseWindow.getAllWindows()[0]; if (show) { a.focus({ steal: true }); w.focus() } w.webContents.focus() }, !!process.env.SHOW)
await win.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2)
check("… a click on the page beside it reaches the page", await until(async () => (await inPage("window.__downs")) === 1, 3000), await inPage("window.__downs"))
if (process.env.SHOW) check("… and gives it the keyboard", await until(() => app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0]
  return !!w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())?.webContents.isFocused()
}), 3000))
await win.locator("[data-sonner-toast]:has-text('A toast over the page') button", { hasText: "Open" }).click()
check("a click on the toast's Open acts on it", await until(async () => (await tabTitles()).some((t) => t?.includes("Reading list")) && (await win.evaluate(() => decodeURIComponent(location.hash))).includes("Reading list"), 5000), await tabTitles())
await win.locator("[role=tab]", { hasText: "Lighthouse" }).first().click()
await until(shown, 10000)
check("… and with the toasts gone, the window back under the page", await until(async () => !(await raised()), 10000), [await raised(), await over()])
await win.mouse.move(5, 400)
await clickInPage("h1")
const pageFocused = () => app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  return !!v && v.webContents.isFocused()
})
// (a window that's never focused, quiet, has no keyboard to give back: only with SHOW=1)
if (process.env.SHOW) {
  // (in front first: whoever runs this may have clicked elsewhere meanwhile)
  // (and the page with the keyboard: a synthetic click doesn't give it)
  await app.evaluate(({ app: a, BaseWindow }) => {
    const w = BaseWindow.getAllWindows()[0]
    a.focus({ steal: true }); w.focus()
    w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())?.webContents.focus()
  })
  check("(the page has the keyboard)", await until(pageFocused, 3000))
  await menuClick("Command palette")
  await until(raised, 10000)
  await win.keyboard.press("Escape")
  check("the palette gone: the keyboard is back in the page", await until(async () => (await shown()) && await pageFocused(), 4000), await pages())
}

// ---------- splits, the sidebar, a divider, zoom ----------
await menuClick("Command palette")
await win.waitForSelector("[role=dialog] input:focus")
await win.keyboard.type("Split right")
await win.waitForSelector("[role=option][aria-selected=true]:has-text('Split right')")
await win.keyboard.press("Enter")
check("split right: the page follows its pane", await until(async () => (await win.locator("section[data-group]").count()) === 2, 10000) && await until(isAligned, 10000), await aligned())
await menuClick("Hide left sidebar")
await wait(500)
check("the sidebar folded: still over its pane", await until(isAligned, 10000), await aligned())
await shot("4-split-rail")
await menuClick("Show left sidebar")
await wait(500)
check("the sidebar back: still over its pane", await until(isAligned, 10000), await aligned())
const divider = win.locator("[aria-label='Resize the split']").first()
const d = await divider.boundingBox()
if (d) {
  await win.mouse.move(d.x + d.width / 2, d.y + d.height / 2)
  await win.mouse.down()
  for (let i = 1; i <= 10; i++) await win.mouse.move(d.x + d.width / 2 + i * 15, d.y + d.height / 2)
  await win.mouse.up()
}
check("a divider dragged: still over its pane", !!d && await until(isAligned, 10000), await aligned())
await menuClick("Zoom in")
check("the app zoomed in: still over its pane", await until(isAligned, 10000), await aligned())
await shot("5-zoomed")
await menuClick("Actual size")
check("actual size again", await until(isAligned, 10000), await aligned())
await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width: 1100, height: 720 }))
check("the window resized: still over its pane", await until(isAligned, 10000), await aligned())

// ---------- navigating ----------
const wcBefore = (await pages()).find((p) => p.visible)?.wc
// (its pane focused, as a real click in the page does through the page's focus; a synthetic one in a window that isn't
// focused doesn't, and the divider dragged above may have focused the other pane)
await win.locator("section[data-group]:has([data-web-box]) [role=tab][aria-selected=true]").first().click()
await until(async () => (await win.evaluate(() => decodeURIComponent(location.hash))).includes(`${SITE}/article`), 5000)
await clickInPage("#next")
check("a link in the page: the address and the tab follow", await until(async () => (await win.locator("[data-web-address]").inputValue()) === `${SITE}/two`
  && (await win.evaluate(() => decodeURIComponent(location.hash))).includes(`${SITE}/two`), 10000),
  { address: await win.locator("[data-web-address]").inputValue(), hash: await win.evaluate(() => decodeURIComponent(location.hash)) })
await win.locator("[data-web-page] button[aria-label=Back]").click()
check("Back", await until(async () => (await win.locator("[data-web-address]").inputValue()) === `${SITE}/article`, 10000), await win.locator("[data-web-address]").inputValue())
await win.locator("[data-web-address]").click()
await win.keyboard.type("127.0.0.1:" + PORT + "/two")
await win.keyboard.press("Enter")
check("an address typed in the bar", await until(async () => (await pages()).some((p) => p.visible && p.url === `${SITE}/two`), 10000), await pages())
// A middle-click on Back, a ⌘-click on Reload: that page in a new tab, this one staying where it is.
const newTabOf = async (url) => (await pages()).some((p) => p.visible && p.url === url) && (await pages()).some((p) => !p.visible && p.url === `${SITE}/two`)
await win.locator("[data-web-page] button[aria-label=Back]").click({ button: "middle" })
check("a middle-click on Back: the page before in a new tab", await until(() => newTabOf(`${SITE}/article`), 10000), await pages())
await menuClick("Close tab")
await until(async () => (await pages()).some((p) => p.visible && p.url === `${SITE}/two`), 10000)
await win.locator("[data-web-page] button[aria-label=Reload]").click({ modifiers: ["ControlOrMeta"] })
check("a ⌘-click on Reload: a copy in a new tab", await until(async () => (await pages()).filter((p) => p.url === `${SITE}/two`).length === 2, 10000), await pages())
await menuClick("Close tab")
await until(async () => (await pages()).some((p) => p.visible && p.url === `${SITE}/two`), 10000)
await win.locator("[data-web-page] button[aria-label=Back]").click()
await until(async () => (await pages()).some((p) => p.visible && p.url === `${SITE}/article`), 10000)

// A tab switch keeps the page. (The pointer off the bar first: back on the tab, Back's tooltip would show under it.)
await win.mouse.move(5, 400)
await menuClick("New tab")
check("another tab in its pane: the page is put away", await until(async () => !(await shown()), 10000), await pages())
await menuClick("Close tab")
check("back to it: the same page, in place", await until(async () => (await pages()).some((p) => p.visible && p.wc === wcBefore), 10000) && await until(isAligned, 10000), await pages())

// A link to a new tab, an app shortcut pressed in the page.
await win.mouse.move(5, 400) // (off the bar, its tooltips gone)
await clickInPage("#blank")
check("a link to a new tab opens a web tab", await until(async () => (await pages()).some((p) => p.visible && p.url === `${SITE}/three`), 10000), await pages())
await win.locator("[role=tab]", { hasText: "Lighthouse" }).first().click()
await until(async () => (await pages()).some((p) => p.visible && p.url === `${SITE}/article`), 10000)
// (⌘ on a Mac, Ctrl elsewhere: the app's Mod)
await app.evaluate(({ BaseWindow }, mod) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  v.webContents.focus()
  v.webContents.sendInputEvent({ type: "keyDown", keyCode: "O", modifiers: [mod] })
}, process.platform === "darwin" ? "meta" : "control")
check("⌘O pressed in the page opens the app's quick switcher", await until(async () => (await raised()) && (await win.locator("[role=dialog] input, [role=combobox]").count()) > 0, 4000), await pages())
// The keyboard goes where the app focuses (web/src/core/desktop.ts), not left with the page: ⌘O's search has it, Escape
// gives it back to the page, ⌘L's address has it, and a note picked in ⌘O, its editor. (SHOW=1 only, like the above.)
const appHasKeyboard = async (sel) => await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].webContents.isFocused())
  && await win.evaluate((sel) => !!document.activeElement?.matches(sel), sel)
// (in front first, the page with the keyboard: whoever runs this may have clicked elsewhere meanwhile)
const pressInPage = (key) => app.evaluate(async ({ app: a, BaseWindow }, [key, mod]) => {
  const w = BaseWindow.getAllWindows()[0]
  a.focus({ steal: true }); w.focus()
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  v.webContents.focus()
  await new Promise((r) => setTimeout(r, 200))
  v.webContents.sendInputEvent({ type: "keyDown", keyCode: key, modifiers: [mod] })
}, [key, process.platform === "darwin" ? "meta" : "control"])
if (process.env.SHOW) {
  await win.keyboard.press("Escape")
  await until(shown, 10000)
  await pressInPage("O")
  check("… with the keyboard in its search", await until(() => appHasKeyboard("[role=dialog] input"), 3000), await pages())
  await win.keyboard.press("Escape")
  check("Escape: the keyboard is back in the page", await until(async () => (await shown()) && await pageFocused(), 4000), await pages())
  await pressInPage("L")
  check("⌘L in the page: the keyboard is in the address", await until(() => appHasKeyboard("[data-web-address]"), 3000))
  await win.keyboard.press("Escape")
  check("… Escape: back in the page", await until(pageFocused, 3000))
  await pressInPage("O")
  await win.waitForSelector("[role=dialog] input:focus")
  await win.keyboard.type("Reading list")
  await win.waitForSelector("[role=option]:has-text('Reading list')")
  await win.keyboard.press("ControlOrMeta+Enter")
  check("a note picked in ⌘O from the page: the keyboard is in its editor", await until(() => appHasKeyboard(".cm-content"), 4000))
  await win.locator("[role=tab]", { hasText: "Lighthouse" }).first().click()
} else await win.keyboard.press("Escape")
await until(shown, 10000)

// ---------- Save to vault ----------
await win.locator("[data-web-clip]").click()
const clipped = () => { try { return fs.readdirSync(path.join(VAULT, "Clippings")).filter((f) => f.endsWith(".md")) } catch { return [] } }
check("Save to vault writes a note in Clippings", await until(() => clipped().length === 1, 15000),
  [clipped(), await win.evaluate(() => [...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent)), errs.slice(-3)])
const note = clipped()[0] ? fs.readFileSync(path.join(VAULT, "Clippings", clipped()[0]), "utf8") : ""
check("… from the page as shown: its text, its source and author", note.includes("one hundred and twelve steps") && note.includes(`source: ${SITE}/article`) && note.includes("Alice Park"), note.slice(0, 400))
check("… and a toast with Open", await until(async () => (await win.locator("[data-sonner-toast]", { hasText: "Saved" }).count()) > 0, 10000), null)
await shot("6-saved")
await win.locator("[data-sonner-toast] button", { hasText: "Open" }).first().click()
check("Open: the note beside the page", await until(async () => (await win.evaluate(() => document.body.innerText)).includes("one hundred and twelve steps") && (await win.locator("section[data-group]").count()) >= 2, 10000), null)

// ---------- a download ----------
await win.locator("[role=tab]", { hasText: "Lighthouse" }).first().click()
await until(shown, 10000)
await clickInPage("#file")
check("a download lands in Downloads", await until(() => fs.existsSync(path.join(DOWNLOADS, "log book.txt")), 10000), fs.readdirSync(DOWNLOADS))
check("… and says so", await until(async () => (await win.locator("[data-sonner-toast]", { hasText: "Downloaded" }).count()) > 0, 10000), null)

// ---------- an image's menu ----------
// (the native menu isn't drawn: its items are kept, as the page's right-click made them. Menus are still real ones:
// the menu bar is built with the same function, and a plain object there throws "Invalid menu")
await app.evaluate(({ Menu }) => {
  const build = Menu.buildFromTemplate.bind(Menu)
  Menu.buildFromTemplate = (items) => { const m = build(items); m.popup = () => { globalThis.__menu = items }; return m }
})
await app.evaluate(async ({ BaseWindow }) => {
  globalThis.__menu = null
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  const [x, y] = (await v.webContents.executeJavaScript(`(() => { const r = document.querySelector("#pic").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)).map(Math.round)
  v.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "right", clickCount: 1 })
  v.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "right", clickCount: 1 })
})
const menuLabels = () => app.evaluate(() => (globalThis.__menu ?? []).map((i) => i.label ?? i.role ?? "-"))
check("right-clicking an image: its own items", await until(async () => (await menuLabels()).includes("Save image to vault"), 10000), await menuLabels())
const imageMenu = await menuLabels()
check("… with Download, Copy image and its address, and Save page to vault", ["Download image", "Copy image", "Copy image address", "Save page to vault"].every((l) => imageMenu.includes(l)), imageMenu)
const pick = (label) => app.evaluate((_e, label) => globalThis.__menu.find((i) => i.label === label).click(), label)
await pick("Save image to vault")
const attached = () => { try { return fs.readdirSync(path.join(VAULT, "Attachments")).filter((f) => f.startsWith("lamp")) } catch { return [] } }
check("Save image to vault: the image in Attachments", await until(() => attached().length === 1, 10000), attached())
check("… the same bytes", attached()[0] ? fs.readFileSync(path.join(VAULT, "Attachments", attached()[0])).equals(PNG) : false, attached())
check("… and a toast with Open", await until(async () => (await win.locator("[data-sonner-toast]", { hasText: "Saved lamp" }).count()) > 0, 10000), null)
await pick("Download image")
check("Download image: in Downloads", await until(() => fs.existsSync(path.join(DOWNLOADS, "lamp.png")), 10000), fs.readdirSync(DOWNLOADS))

// ---------- links to the browser (openLinks: browser) ----------
await fetch(`${origin}/api/config/plugin/web-viewer`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ openLinks: "browser" }) })
await wait(1500)
const before = (await pages()).length
await fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "open", path: "Notes/Reading list.md" }) })
await win.waitForSelector("section [data-pane] .cm-link[data-url]", { timeout: 10000 })
const n = (await opened()).length
await win.locator(".cm-link[data-url]").first().click()
check("openLinks: browser: a click goes to the browser", await until(async () => (await opened()).length > n, 10000), await opened())
check("… and opens no web tab", (await pages()).length === before, await pages())

// ---------- a tab's page is its own ----------
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const n0 = (await pages()).length
await ui({ action: "open", path: `${SITE}/slow`, newTab: true })
// (its page still loading: nothing in yet, or the spare's about:blank it was started in)
check("a slow page: its address shows while it loads", await until(async () => (await win.locator("[data-web-address]:visible").inputValue().catch(() => "")) === `${SITE}/slow`, 4000)
  && (await pages()).some((p) => p.url === "" || p.url === "about:blank"), await pages())
// (named by its site till its title comes)
for (let i = 0; i < 3; i++) {
  await win.locator("[role=tab]", { hasText: "Lighthouse" }).first().click(); await wait(150)
  await win.locator("[role=tab]", { hasText: `127.0.0.1:${PORT}` }).first().click(); await wait(150)
}
check("… switched away and back while it loads: still one page", (await pages()).length === n0 + 1, await pages())
check("… and it comes in", await until(async () => (await pages()).some((p) => p.visible && p.url === `${SITE}/slow`), 10000), await pages())
await menuClick("Close tab")
check("… closed: its page ends", await until(async () => (await pages()).length === n0, 5000), await pages())
await menuClick("Reopen closed tab")
check("⌘⇧T: the tab again, with one page at its address", await until(async () => (await pages()).some((p) => p.visible && p.url === `${SITE}/slow`), 15000)
  && (await pages()).length === n0 + 1, await pages())
await menuClick("Close tab")
await until(async () => (await pages()).length === n0, 5000)

const threes = async () => (await pages()).filter((p) => p.url === `${SITE}/three`).length, t0 = await threes()
await ui({ action: "open", path: `${SITE}/three`, newTab: true })
await until(async () => (await threes()) === t0 + 1, 10000)
await ui({ action: "open", path: `${SITE}/three`, newTab: true })
check("two more tabs of one address: two more pages", await until(async () => (await threes()) === t0 + 2, 10000), await pages())
await menuClick("Close tab")
check("… closing one leaves the others'", await until(async () => (await threes()) === t0 + 1, 5000) && (await wait(500), (await threes()) === t0 + 1), await pages())
await menuClick("Close tab")
await until(async () => (await pages()).length === n0, 5000)

// ---------- closing ----------
const count = (await pages()).length
await win.locator("[role=tab]", { hasText: "Lighthouse" }).first().click()
await until(shown, 10000)
await menuClick("Close tab")
check("closing a web tab ends its page", await until(async () => (await pages()).length === count - 1, 10000), await pages())

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
