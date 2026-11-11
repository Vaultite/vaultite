// The Browser's keys and navigation act on the page, as Chrome's (plugins/core/web-viewer, electron/web.ts,
// core/workspace.ts navigate and restTab), in the desktop app (Electron) against pages this script serves on 127.0.0.1:
// Back and Forward from the app's keys, the page's, the mouse's buttons (over the page and the app) and the bar (its list
// on a right-click); find in page (⌘F from the page and the app, Enter, ⌘G, Esc, its words kept; a card over the page's
// top right that leaves the page its size and its clicks; a site's own ⌘F left to it); a site's zoom (⌘= in the page and the app, kept per host, said in a toast, the bar's reset), never the app's, and a pinch's
// magnifying (under a toast too, its ⌃ passed on); ⌘R, ⇧⌘R and ⌥⌘I the
// page's, never the app's menu; Esc stops a load; ⇧⌘[ ]; ⌘W on a pinned web tab rests it. WRITES: the throwaway vault.
//   node web/qa/browserkeys.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { BACK_KEY, ROOT, SHOTS, qa, until, wait, keepAwake } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
if (process.platform !== "darwin") { console.log("browserkeys: a Mac's keys, skipped"); process.exit(0) }
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-browserkeys-"))
keepAwake(600)

// ---------- made-up pages ----------
const page = (title, body, script = "") => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:18px/1.5 Georgia,serif;margin:0;padding:40px 60px}</style>${script}</head><body>${body}</body></html>`
const ARTICLE = page("Lighthouse field notes", `<h1>Lighthouse field notes</h1>
<p>The keeper climbs one hundred and twelve steps every evening. In winter its keeper sounds the horn.</p>
<p>Read <a id="next" href="/two">the second part</a>.</p>`)
// (a site with its own find: it takes ⌘F)
const OWN = page("Own find", "<h1>Own find</h1>", `<script>addEventListener("keydown", (e) => { if (e.metaKey && e.code === "KeyF") { e.preventDefault(); window.__ownFind = true } })</script>`)
const server = http.createServer((req, res) => {
  const u = req.url ?? "/"
  if (u.startsWith("/slow")) return void setTimeout(() => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(page("Slow", "<h1>Slow</h1>")) }, 8000)
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(u.startsWith("/two") ? page("Second part", "<h1>Second part</h1>") : u.startsWith("/own") ? OWN : ARTICLE)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const SITE = `http://127.0.0.1:${server.address().port}`
fs.mkdirSync(path.join(VAULT, "Notes"), { recursive: true })
fs.writeFileSync(path.join(VAULT, "Notes/Reading list.md"), `# Reading list\n\nStart with [the field notes](${SITE}/article) today.\n\nMore to read later.\n`)

// ---------- the app ----------
const USER = path.join(TMP, "userData")
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: USER, VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus() })
const menuClick = (label) => app.evaluate(({ Menu, BaseWindow }, label) => {
  const find = (items) => { for (const i of items) { if (i.label === label) return i; const s = i.submenu && find(i.submenu.items); if (s) return s } }
  find(Menu.getApplicationMenu().items).click(undefined, BaseWindow.getAllWindows()[0])
}, label)
/** The web pages laid over the window. */
const pages = () => app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0]
  return w.contentView.children.filter((v) => v.webContents && v.webContents !== w.webContents)
    .map((v) => ({ url: v.webContents.getURL(), visible: v.getVisible(), zoom: v.webContents.getZoomFactor(), loading: v.webContents.isLoading(), devtools: v.webContents.isDevToolsOpened() }))
})
const shownPage = async () => (await pages()).find((p) => p.visible)
const at = async (p) => (await shownPage())?.url === `${SITE}${p}`
const inPage = (code) => app.evaluate(({ BaseWindow }, code) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  return v ? v.webContents.executeJavaScript(code) : null
}, code)
const clickInPage = (sel) => app.evaluate(async ({ BaseWindow }, sel) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  // (in the page's CSS pixels, which its zoom makes more of the view's)
  const z = v.webContents.getZoomFactor()
  const [x, y] = (await v.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getClientRects()[0]; return [r.left + r.width / 2, r.top + r.height / 2] })()`)).map((n) => Math.round(n * z))
  v.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 })
  v.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 })
}, sel)
/** A key pressed in the shown page, as the Mac's keyboard sends it there (before-input-event, then the page). */
const pressInPage = (keyCode, modifiers = []) => app.evaluate(async ({ BaseWindow }, [keyCode, modifiers]) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  v.webContents.focus()
  await new Promise((r) => setTimeout(r, 100))
  v.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers })
  v.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers })
}, [keyCode, modifiers])
/** The keyboard in the app's own page (the address bar, a field: anything but the web page). */
const appKeys = async (keys) => {
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].webContents.focus())
  await win.evaluate(() => { document.activeElement?.blur?.() })
  await win.keyboard.press(keys)
}
/** A picture of the window with its pages in it (each page is a view of its own, under the window's): in SHOTS. */
const shotWithPages = async (name) => {
  const pics = await app.evaluate(async ({ BaseWindow }) => {
    const w = BaseWindow.getAllWindows()[0]
    const shot = async (v) => (await v.webContents.capturePage()).toDataURL()
    const views = w.contentView.children.filter((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
    return { app: await shot(w), width: w.getContentBounds().width, pages: await Promise.all(views.map(async (v) => ({ src: await shot(v), at: v.getBounds() }))) }
  })
  const png = await win.evaluate(async ({ app, width, pages }) => {
    const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src })
    const top = await load(app), k = top.width / width, c = document.createElement("canvas")
    c.width = top.width; c.height = top.height
    const g = c.getContext("2d")
    for (const p of pages) g.drawImage(await load(p.src), p.at.x * k, p.at.y * k, p.at.width * k, p.at.height * k)
    g.drawImage(top, 0, 0)
    return c.toDataURL("image/png").split(",")[1]
  }, pics)
  fs.mkdirSync(SHOTS, { recursive: true })
  fs.writeFileSync(path.join(SHOTS, `browserkeys-${name}.png`), Buffer.from(png, "base64"))
}
/** Whether a key pressed in the app's page is taken there (so the menu bar never sees it: its Developer reload). */
const takenInApp = (o) => win.evaluate((o) => { const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...o }); document.body.dispatchEvent(e); return e.defaultPrevented }, o)
const tabs = () => win.evaluate(() => {
  const w = JSON.parse(localStorage.getItem("vaultite.tabs")), leaf = (n) => (n.kids ? n.kids.flatMap(leaf) : [n])
  const pane = (t) => leaf(t.root).find((p) => p.id === t.focus) ?? leaf(t.root)[0]
  return { tabs: w.tabs.map((t) => ({ to: pane(t).to, pinned: !!t.pinned, home: pane(t).home })), active: pane(w.tabs.find((t) => t.id === w.active)).to }
})

// ---------- a page, and Back and Forward ----------
await fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "open", path: "Notes/Reading list.md" }) })
await win.waitForSelector(".cm-link[data-url]", { timeout: 15000 })
await win.locator(".cm-line", { hasText: "More to read later" }).first().click()
await win.locator(".cm-link[data-url]").first().click()
check("a web tab at the article", await until(() => at("/article"), 15000), await pages())
await wait(800)
await clickInPage("#next")
check("a link followed in the page", await until(() => at("/two"), 10000), await pages())
const count = (await tabs()).tabs.length
await appKeys("Meta+BracketLeft")
check("⌘[ with the keyboard in the app: the page's Back", await until(() => at("/article"), 5000), await pages())
check("… and the tab stays", (await tabs()).tabs.length === count, await tabs())
await appKeys("Meta+BracketRight")
check("⌘] in the app: the page's Forward", await until(() => at("/two"), 5000), await pages())
await appKeys(BACK_KEY)
check("⌥⌘← in the app: the page's Back", await until(() => at("/article"), 5000), await pages())
// (a real press, through the DevTools protocol: the page heeds only trusted ones, and sendInputEvent has no button 4)
await app.evaluate(async ({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0]
  const d = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible()).webContents.debugger
  const mine = !d.isAttached()
  if (mine) d.attach("1.3")
  for (const type of ["mousePressed", "mouseReleased"]) await d.sendCommand("Input.dispatchMouseEvent", { type, x: 200, y: 200, button: "forward", buttons: type === "mousePressed" ? 16 : 0, clickCount: 1 })
  if (mine) d.detach()
})
check("the mouse's forward button over the page", await until(() => at("/two"), 5000), await pages())
await win.evaluate(() => dispatchEvent(new MouseEvent("mouseup", { button: 3 })))
check("the mouse's back button over the app", await until(() => at("/article"), 5000), await pages())
await appKeys("Meta+BracketRight"); await until(() => at("/two"), 5000)
await pressInPage("[", ["meta"])
check("⌘[ pressed in the page", await until(() => at("/article"), 5000), await pages())
await win.locator("[data-web-page] button[aria-label=Forward]").click()
check("the bar's Forward", await until(() => at("/two"), 5000), await pages())
await win.locator("[data-web-page] button[aria-label=Back]").click({ button: "right" })
const listed = await until(async () => { const l = await win.locator("[role=menuitem]").allTextContents(); return l.length > 1 && l }, 3000)
check("Back's right-click lists its places and the full history", !!listed && listed[0].includes("Lighthouse field notes") && listed.some((t) => t.includes("Show full history")), listed)
await win.locator("[role=menuitem]", { hasText: "Lighthouse field notes" }).first().click()
check("… a place picked goes there", await until(() => at("/article"), 5000), await pages())

// ---------- find in page ----------
/** Where the shown page is in the window. */
const pageBounds = () => app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0]
  return w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())?.getBounds() ?? null
})
const unfound = await pageBounds()
await pressInPage("F", ["meta"])
check("⌘F in the page opens the find bar, the keyboard in it", await until(() => win.evaluate(() => !!document.activeElement?.matches("[data-web-find] input")), 4000))
const card = await win.locator("[data-web-find]").boundingBox()
check("it's a card over the page's top right", !!card && !!unfound && Math.abs(unfound.x + unfound.width - (card.x + card.width) - 12) <= 4 && Math.abs(card.y - unfound.y - 8) <= 4,
  { card, page: unfound })
check("… which keeps its size", JSON.stringify(await pageBounds()) === JSON.stringify(unfound), await pageBounds())
check("… the window raised over it", await until(() => win.evaluate(() => "overPages" in document.documentElement.dataset), 3000))
check("… not the app's own find", (await win.locator("[data-page-find]").count()) === 0)
await win.keyboard.type("keeper")
const counted = (t) => until(async () => (await win.locator("[data-web-find] [data-find-count]").textContent()) === t, 4000)
check("typing finds: 1 of 2", await counted("1 of 2"), await win.locator("[data-web-find] [data-find-count]").textContent())
await win.keyboard.press("Enter")
check("Enter: the next, 2 of 2", await counted("2 of 2"), await win.locator("[data-web-find] [data-find-count]").textContent())
await win.keyboard.press("Meta+G")
check("⌘G: on round, 1 of 2", await counted("1 of 2"), await win.locator("[data-web-find] [data-find-count]").textContent())
await win.keyboard.press("Shift+Enter")
check("⇧Enter: back, 2 of 2", await counted("2 of 2"), await win.locator("[data-web-find] [data-find-count]").textContent())
await win.keyboard.type("x")
check("words in no match: No results", await counted("No results"), await win.locator("[data-web-find] [data-find-count]").textContent())
await win.keyboard.press("Backspace")
await win.keyboard.press("Escape")
check("Esc closes it", await until(async () => (await win.locator("[data-web-find]").count()) === 0, 3000))
await appKeys("Meta+F")
check("⌘F from the app: open again with its words", await until(async () => (await win.locator("[data-web-find] input").count()) === 1 && (await win.locator("[data-web-find] input").inputValue()) === "keeper", 4000))
await shotWithPages("find")
// (dark for a picture only: the vault's scheme picks the look, not the system's)
const dark = await win.evaluate(() => document.documentElement.classList.toggle("dark")); await wait(400)
await shotWithPages(dark ? "find-dark" : "find-light")
await win.evaluate(() => document.documentElement.classList.toggle("dark"))
// (a click beside the card is the page's: the window passes it on)
const link = await inPage(`(() => { const r = document.querySelector("#next").getClientRects()[0]; return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
await win.mouse.click(unfound.x + link.x, unfound.y + link.y)
check("with it open, a click beside it is the page's", await until(() => at("/two"), 5000), await pages())
await appKeys("Meta+BracketLeft"); await until(() => at("/article"), 5000)
if (await win.locator("[data-web-find]").count()) await win.locator("[data-web-find] [data-find-close]").click()
await inPage(`location.href = "${SITE}/own"; 1`)
await until(() => at("/own"), 5000); await wait(500)
await pressInPage("F", ["meta"]); await wait(800)
check("a site's own ⌘F is the site's", (await inPage("window.__ownFind === true")) && (await win.locator("[data-web-find]").count()) === 0, await inPage("!!window.__ownFind"))

// ---------- zoom ----------
await inPage(`location.href = "${SITE}/article"; 1`)
await until(() => at("/article"), 5000); await wait(300)
const appZoom = () => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].webContents.getZoomFactor())
await pressInPage("=", ["meta"])
check("⌘= in the page zooms the page", await until(async () => Math.abs((await shownPage())?.zoom - 1.1) < 0.01, 4000), await pages())
check("… not the app", (await appZoom()) === 1, await appZoom())
check("… and the bar says 110%", await until(async () => (await win.locator("[data-web-zoom='110']").count()) === 1, 3000))
check("… and a toast: its site's 110%", await until(async () => (await win.locator("[data-sonner-toast]", { hasText: "127.0.0.1 110%" }).count()) === 1, 3000))
const kept = () => { try { return JSON.parse(fs.readFileSync(path.join(USER, "web-zoom.json"), "utf8")) } catch { return {} } }
check("… kept for its host, on this Mac", kept()["127.0.0.1"] === 1.1, kept())
await clickInPage("#next")
check("another page of the site keeps it", await until(async () => (await at("/two")) && Math.abs((await shownPage()).zoom - 1.1) < 0.01, 5000), await pages())
await appKeys("Meta+Equal")
check("⌘= from the app: the page's too, 125%", await until(async () => Math.abs((await shownPage())?.zoom - 1.25) < 0.01, 4000) && (await appZoom()) === 1, [await pages(), await appZoom()])
await appKeys("Meta+Minus")
check("⌘- from the app: 110%", await until(async () => Math.abs((await shownPage())?.zoom - 1.1) < 0.01, 4000), await pages())
await win.locator("[data-web-zoom]").click()
check("the bar's 110% clicked: back to 100%, forgotten", await until(async () => (await shownPage())?.zoom === 1 && !kept()["127.0.0.1"] && (await win.locator("[data-web-zoom]").count()) === 0, 4000),
  [await pages(), kept(), await win.locator("[data-web-zoom]").count()])

// A pinch magnifies the page, as Safari's (the layout keeps its width); the app's own page never.
const pinch = (scale, own = false) => app.evaluate(async ({ BaseWindow }, [scale, own]) => {
  const w = BaseWindow.getAllWindows()[0]
  const wc = own ? w.webContents : w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible()).webContents
  // (the app's own debugger may be on it already: then that one)
  const had = wc.debugger.isAttached()
  if (!had) wc.debugger.attach("1.3")
  try { await wc.debugger.sendCommand("Input.synthesizePinchGesture", { x: 300, y: 300, scaleFactor: scale }) } finally { if (!had) wc.debugger.detach() }
  await new Promise((r) => setTimeout(r, 300))
  return wc.executeJavaScript("[visualViewport.scale, innerWidth]")
}, [scale, own])
const width0 = await inPage("innerWidth")
const pinched = await pinch(2)
check("a pinch magnifies the page, not reflowing it", pinched[0] > 1.5 && pinched[1] === width0, [pinched, width0])
const unpinched = await pinch(0.25)
check("… and pinches back to its size, no smaller", Math.abs(unpinched[0] - 1) < 0.01, unpinched)
check("the app's own page doesn't magnify", Math.abs((await pinch(2, true))[0] - 1) < 0.01)
// Under a toast, what the window's page passes on keeps its keys: a pinch it got reaches the page as ⌃-wheels (sites
// that zoom themselves read them). A real pinch is handed to the page natively before that: web/qa/pinch.mjs.
const covered = () => app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0], kids = w.contentView.children
  return kids.indexOf(w.view) > kids.findIndex((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
})
await fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notify", text: "Lighthouse lamp lit" }) })
check("a toast over the page raises the window's page over it", await until(covered, 4000))
await inPage("window.__wheels = []; addEventListener('wheel', (e) => __wheels.push(e.ctrlKey), { passive: true }); true")
await pinch(1.5, true)
const wheels = await inPage("__wheels")
check("… a pinch on the window's page there reaches the page with its ⌃", wheels.length > 0 && wheels.every(Boolean), wheels)
await until(async () => !(await covered()), 15000)

// ---------- reload, DevTools, Esc ----------
await win.evaluate(() => { window.__alive = 1 })
await inPage("window.__mark = 1")
await pressInPage("R", ["meta", "shift"])
check("⇧⌘R in the page reloads the page", await until(async () => (await inPage("typeof window.__mark")) === "undefined", 5000))
await inPage("window.__mark = 1")
await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].webContents.focus())
check("⇧⌘R in the app is taken there, never the menu's reload", await takenInApp({ key: "R", code: "KeyR", metaKey: true, shiftKey: true }))
check("… and reloads the page", await until(async () => (await inPage("typeof window.__mark")) === "undefined", 5000))
check("⌘R in the app is taken there too", await takenInApp({ key: "r", code: "KeyR", metaKey: true }))
check("⌥⌘I in the app is taken there", await takenInApp({ key: "ˆ", code: "KeyI", metaKey: true, altKey: true }))
const appTools = () => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].webContents.isDevToolsOpened())
check("… opening the page's DevTools, never the app's", await until(async () => (await shownPage())?.devtools, 10000) && !(await appTools()), await pages())
await pressInPage("I", ["meta", "alt"])
check("⌥⌘I in the page closes them again", await until(async () => !(await shownPage())?.devtools, 4000) && !(await appTools()), await pages())
check("the app wasn't reloaded", (await win.evaluate(() => window.__alive)) === 1)
await inPage(`location.href = "${SITE}/slow"; 1`)
await until(async () => (await shownPage())?.loading, 3000)
await pressInPage("Escape")
check("Esc while it loads stops it", await until(async () => !(await shownPage())?.loading, 3000) && await at("/two"), await pages())

// ---------- tabs ----------
const active = async () => (await tabs()).active
const web = await active()
await appKeys("Meta+Shift+BracketLeft")
check("⇧⌘[ the previous tab", await until(async () => (await active()) !== web, 3000), await tabs())
await appKeys("Meta+Shift+BracketRight")
check("⇧⌘] the next", await until(async () => (await active()) === web, 3000), await tabs())
await menuClick("Pin tab")
const pinned = async () => (await tabs()).tabs.find((t) => t.pinned)
check("Pin tab keeps where it was pinned", await until(async () => (await pinned())?.home === `view:web/${SITE}/two`, 3000), await tabs())
await win.locator("[data-web-page] button[aria-label=Back]").click()
await until(() => at("/article"), 5000)
await menuClick("Close tab")
check("⌘W on a pinned web tab: the next tab shows, the pin stays", await until(async () => (await active()) !== web && !!(await pinned()), 4000), await tabs())
check("… back where it was pinned, its page ended", await until(async () => (await pinned())?.to === `view:web/${SITE}/two` && !(await pages()).some((p) => p.url.endsWith("/article")), 4000),
  [await tabs(), await pages()])
await appKeys(`Meta+${(await tabs()).tabs.findIndex((t) => t.pinned) + 1}`)
check("… shown again, it loads that afresh", await until(() => at("/two"), 8000), await pages())

await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
