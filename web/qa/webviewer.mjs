// The Web viewer in the desktop app (Electron) against pages this script serves on 127.0.0.1: a web link opens a web
// tab, a native view laid over its pane (splits, sidebar, dividers, zoom), hidden behind a picture of itself under the
// palette or a menu, kept on tab switches; links, back, new tabs and other schemes; no bridge into the app; app
// shortcuts from the page; Save to vault, downloads, an image's menu; closing ends the page. SHOW=1 shows the window;
// screenshots (screencapture, so the native view is in them) go to <out dir>.
// WRITES: the throwaway vault only.
//   node web/qa/webviewer.mjs <vault copy> <out dir> [port for the pages, default 8861]
import { _electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT, OUT_ARG, PORT_ARG], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const OUT = path.resolve(OUT_ARG)
fs.mkdirSync(OUT, { recursive: true })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-webviewer-"))
const PORT = Number(PORT_ARG || 8861)
const SITE = `http://127.0.0.1:${PORT}`

// The display stays awake (a window on a sleeping display is hidden: no frames, no screenshots).
const awake = (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "900"], { stdio: "ignore" })
process.on("exit", () => awake.kill())

// ---------- made-up pages ----------
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="author" content="Alice Park"><meta name="description" content="A made-up article for the web viewer's QA.">
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
  if (u.startsWith("/file.txt")) { res.writeHead(200, { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=\"log book.txt\"" }); return res.end("Day one: calm.\n") }
  const html = u.startsWith("/two") ? page("Second part", "<h1>Second part</h1><p>The second part.</p>")
    : u.startsWith("/three") ? page("Third part", "<h1>Third part</h1><p>The third part.</p>")
    : ARTICLE
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(html)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(PORT, "127.0.0.1", ok) })

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
await app.evaluate(({ app: a, BrowserWindow, nativeTheme }, show) => { nativeTheme.themeSource = "dark"; const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); if (show) a.focus({ steal: true }); w.focus() }, !!process.env.SHOW)
const menuClick = (label) => app.evaluate(({ Menu, BrowserWindow }, label) => {
  const find = (items) => { for (const i of items) { if (i.label === label) return i; const s = i.submenu && find(i.submenu.items); if (s) return s } }
  find(Menu.getApplicationMenu().items).click(undefined, BrowserWindow.getAllWindows()[0])
}, label)
/** The web pages laid over the vault window (its own page left out). */
const pages = () => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x.contentView.children.length > 1) ?? BrowserWindow.getAllWindows()[0]
  // (not the float above the pages, electron/web.ts's FLOAT_PAGE: toasts and tooltips copied over them)
  return w.contentView.children.filter((v) => v.webContents && v.webContents !== w.webContents && !v.webContents.getURL().startsWith("data:"))
    .map((v) => ({ url: v.webContents.getURL(), visible: v.getVisible(), bounds: v.getBounds(), wc: v.webContents.id }))
})
/** Run JavaScript in the visible page. */
const inPage = (code) => app.evaluate(({ BrowserWindow }, code) => {
  const w = BrowserWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible() && !x.webContents.getURL().startsWith("data:"))
  return v ? v.webContents.executeJavaScript(code) : null
}, code)
/** Click an element of the visible page as a person would (a real input event: a page's own .click() has no user
 *  activation, and Chromium then skips its history entry for Back). */
const clickInPage = (sel) => app.evaluate(async ({ BrowserWindow }, sel) => {
  const w = BrowserWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible() && !x.webContents.getURL().startsWith("data:"))
  const r = await v.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)
  const [x, y] = r.map(Math.round)
  v.webContents.sendInputEvent({ type: "mouseMove", x, y })
  v.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 })
  v.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 })
}, sel)
const box = () => win.evaluate(() => {
  const el = [...document.querySelectorAll("[data-web-box]")].find((e) => e.getBoundingClientRect().width > 0)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, width: r.width, height: r.height }
})
const zoom = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())
/** The visible page sits exactly on its box (in the window's pixels: the box's times the zoom). */
async function aligned() {
  const [ps, b, z] = [await pages(), await box(), await zoom()]
  const v = ps.find((p) => p.visible)
  if (!v || !b) return { v, b }
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
const picture = () => win.evaluate(() => [...document.querySelectorAll("[data-web-box] img")].some((i) => !i.hidden && i.src.startsWith("blob:")))
/** The real window as it's on screen (the native page is in it, unlike a page screenshot). */
async function shot(name) {
  if (!process.env.SHOW) return // (quiet: the window is transparent, so the screen shows what's behind it)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus())
  try { execFileSync("caffeinate", ["-u", "-t", "2"]) } catch { /* fine */ }
  await wait(250)
  const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
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
const part = await app.evaluate(({ BrowserWindow, session }) => {
  const w = BrowserWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents)
  return { own: v.webContents.session === session.fromPartition("persist:web"), app: w.webContents.session !== v.webContents.session, ua: v.webContents.getUserAgent() }
})
check("its session is its own, persistent (persist:web), apart from the app's", part.own && part.app, part)
check("its user agent doesn't say Electron", !/Electron|vaultite/i.test(part.ua), part.ua)
await inPage("location.href = 'file:///etc/hosts'")
await wait(800)
check("a page can't go to file:", (await pages()).every((p) => p.url.startsWith(SITE)), await pages())

// ---------- overlays ----------
await menuClick("Command palette")
check("the palette over the page: the page hides", await until(async () => !(await shown()), 10000), await pages())
check("… and its picture shows in its place", await picture())
await wait(300)
await shot("2-palette")
await win.keyboard.press("Escape")
check("the palette gone: the page is back", await until(shown, 10000), await pages())
await win.locator("[role=tab]", { hasText: "Lighthouse" }).first().click({ button: "right" })
check("a tab's menu over the page: the page hides", await until(async () => !(await shown()), 10000), await pages())
await wait(200)
await shot("3-tab-menu")
await win.keyboard.press("Escape")
await win.mouse.click(5, 400) // (somewhere in the sidebar, if a menu is still there)
check("the menu gone: the page is back", await until(shown, 10000), await pages())
await win.locator("[data-web-page] button[aria-label=Back]").hover({ force: true })
await win.locator("[data-web-page] button[aria-label='Open in the browser']").hover()
const copies = () => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  return w.contentView.children.filter((v) => v.webContents && v.webContents.getURL().startsWith("data:text/html") && v.getVisible()).length
})
check("a tooltip of the bar over the page: the page stays, a copy of the tooltip shows above it", await until(async () => (await copies()) === 1, 3000) && await shown(), [await pages(), await copies()])
await win.mouse.move(5, 400)
check("… and goes with it", await until(async () => (await copies()) === 0, 10000), await copies())

// A tab dragged over the page: the page gives way, so the pane's drop zones show (and the drag keeps the pointer).
const tb = await win.locator("[role=tab]", { hasText: "Lighthouse" }).first().boundingBox()
await win.mouse.move(tb.x + 40, tb.y + tb.height / 2)
await win.mouse.down()
// (to the pane's left edge: a drop there would split it)
const bx = await box()
for (let i = 1; i <= 12; i++) await win.mouse.move(tb.x + 40 + ((bx.x + 30) - (tb.x + 40)) * i / 12, tb.y + tb.height / 2 + ((bx.y + bx.height / 2) - (tb.y + tb.height / 2)) * i / 12)
check("a tab dragged over the page: the page hides", await until(async () => !(await shown()), 3000), await pages())
check("… and the pane's drop zone shows", await until(async () => (await win.locator("[data-drop-zone]").count()) > 0, 3000))
await shot("3b-drag")
await win.keyboard.press("Escape")
await win.mouse.up()
check("the drag cancelled: the page is back", await until(shown, 10000), await pages())

// A toast over the page: the page stays live (no picture), a copy of the toast shows above it, a click on the copy's
// button acts on the toast, and the copy goes with the toast. The palette over a page that had the keyboard: back to it.
const floatsNow = () => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  return w.contentView.children.filter((v) => v.webContents && v.webContents.getURL().startsWith("data:text/html") && v.getVisible()).map((v) => ({ bounds: v.getBounds(), wc: v.webContents.id }))
})
await fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notify", text: "A toast over the page", button: { label: "Open", open: "Notes/Reading list.md" } }) })
await win.waitForSelector("[data-sonner-toast]:has-text('A toast over the page')", { timeout: 5000 })
await wait(900)
check("a toast over the page: the page stays shown", await shown(), await pages())
check("… and a copy of it is shown above the page", await until(async () => (await floatsNow()).length === 1, 4000), await floatsNow())
const toastBox = await win.locator("[data-sonner-toast]:has-text('A toast over the page')").boundingBox()
const openBox = await win.locator("[data-sonner-toast]:has-text('A toast over the page') button", { hasText: "Open" }).boundingBox()
const [fl] = await floatsNow()
await app.evaluate(({ webContents }, [id, x, y]) => {
  const wc = webContents.fromId(id)
  wc.sendInputEvent({ type: "mouseMove", x, y }); wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 }); wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 })
}, [fl?.wc, Math.round(openBox.x - toastBox.x + openBox.width / 2), Math.round(openBox.y - toastBox.y + openBox.height / 2)])
check("a click on the copy's Open acts on the toast", await until(async () => (await tabTitles()).some((t) => t?.includes("Reading list")) && (await win.evaluate(() => decodeURIComponent(location.hash))).includes("Reading list"), 5000), await tabTitles())
check("… and the copy goes with the toast", await until(async () => (await floatsNow()).length === 0, 6000), await floatsNow())
await win.locator("[role=tab]", { hasText: "Lighthouse" }).first().click()
await until(shown, 10000)
await win.mouse.move(5, 400)
await clickInPage("h1")
const pageFocused = () => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible() && !x.webContents.getURL().startsWith("data:"))
  return !!v && v.webContents.isFocused()
})
// (a window that's never focused, quiet, has no keyboard to give back: only with SHOW=1)
if (process.env.SHOW) {
  // (in front first: whoever runs this may have clicked elsewhere meanwhile)
  // (and the page with the keyboard: a synthetic click doesn't give it)
  await app.evaluate(({ app: a, BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    a.focus({ steal: true }); w.focus()
    w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())?.webContents.focus()
  })
  check("(the page has the keyboard)", await until(pageFocused, 3000))
  await menuClick("Command palette")
  await until(async () => !(await shown()), 10000)
  await win.keyboard.press("Escape")
  check("the palette gone: the keyboard is back in the page", await until(async () => (await shown()) && await pageFocused(), 4000), await pages())
}

// ---------- splits, the sidebar, a divider, zoom ----------
await menuClick("Command palette")
await win.waitForSelector("[role=dialog] input:focus")
await win.keyboard.type("Split right")
await win.waitForSelector("[role=option]:has-text('Split right')")
await win.keyboard.press("Enter")
check("split right: the page follows its pane", await until(async () => (await win.locator("section[data-group]").count()) === 2, 10000) && await until(isAligned, 10000), await aligned())
await menuClick("Toggle left sidebar")
await wait(500)
check("the sidebar folded: still over its pane", await until(isAligned, 10000), await aligned())
await shot("4-split-rail")
await menuClick("Toggle left sidebar")
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
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width: 1100, height: 720 }))
check("the window resized: still over its pane", await until(isAligned, 10000), await aligned())

// ---------- navigating ----------
const wcBefore = (await pages()).find((p) => p.visible)?.wc
await clickInPage("#next")
check("a link in the page: the address and the tab follow", await until(async () => (await win.locator("[data-web-address]").inputValue()) === `${SITE}/two`
  && (await win.evaluate(() => decodeURIComponent(location.hash))).includes(`${SITE}/two`), 10000), await win.locator("[data-web-address]").inputValue())
await win.locator("[data-web-page] button[aria-label=Back]").click()
check("Back", await until(async () => (await win.locator("[data-web-address]").inputValue()) === `${SITE}/article`, 10000), await win.locator("[data-web-address]").inputValue())
await win.locator("[data-web-address]").click()
await win.keyboard.type("127.0.0.1:" + PORT + "/two")
await win.keyboard.press("Enter")
check("an address typed in the bar", await until(async () => (await pages()).some((p) => p.visible && p.url === `${SITE}/two`), 10000), await pages())
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
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible() && !x.webContents.getURL().startsWith("data:"))
  v.webContents.focus()
  v.webContents.sendInputEvent({ type: "keyDown", keyCode: "O", modifiers: ["meta"] })
})
check("⌘O pressed in the page opens the app's quick switcher", await until(async () => !(await shown()) && (await win.locator("[role=dialog] input, [role=combobox]").count()) > 0, 4000), await pages())
// The keyboard goes where the app focuses (web/src/core/desktop.ts), not left with the page: ⌘O's search has it, Escape
// gives it back to the page, ⌘L's address has it, and a note picked in ⌘O, its editor. (SHOW=1 only, like the above.)
const appHasKeyboard = async (sel) => await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isFocused())
  && await win.evaluate((sel) => !!document.activeElement?.matches(sel), sel)
// (in front first, the page with the keyboard: whoever runs this may have clicked elsewhere meanwhile)
const pressInPage = (key) => app.evaluate(async ({ app: a, BrowserWindow }, key) => {
  const w = BrowserWindow.getAllWindows()[0]
  a.focus({ steal: true }); w.focus()
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible() && !x.webContents.getURL().startsWith("data:"))
  v.webContents.focus()
  await new Promise((r) => setTimeout(r, 200))
  v.webContents.sendInputEvent({ type: "keyDown", keyCode: key, modifiers: ["meta"] })
}, key)
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
await app.evaluate(async ({ BrowserWindow }) => {
  globalThis.__menu = null
  const w = BrowserWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible() && !x.webContents.getURL().startsWith("data:"))
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
