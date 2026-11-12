// Windows for a call (a film shared, a friend's camera beside it) in the desktop app. A pop-out with its bars hidden (Hide
// window bars: core/workspace.ts hideBars), a web page in it: no tab, pane, page or status bar, the page edge to edge;
// its traffic lights hidden, and with the pointer at its top they show with a strip that drags it (electron/topstrip.ts,
// as a player's), always in full screen; the page's right-click brings the bars back, and so does the palette; kept
// across a reload. Keep window on top (core/ontop.ts, electron/ontop.ts): the palette's, the strip's pin, the menu bar's.
// A popup the page opens (electron/popup.ts): a window of its own at the size it asked, its opener still its opener,
// staying as the vault's window minimizes. One of the page's own (its site's, or one it writes into: a call's video
// popped out) is bare, titled by its page, locked to its video's aspect and kept as last left (title bar, on top);
// another site's (a sign-in) has its title bar, titled by that site. Mac only (the lights; elsewhere windows keep
// their frames). WRITES: the throwaway vault only. Frames go to [out dir].
//   node web/qa/barewindow.mjs <vault copy> [out dir]
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait, keepAwake, uiAt } from "./lib/qa.mjs"
import { stopTerminals } from "../../tools/test/lib.ts"

const { args: [VAULT, OUT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
if (process.platform !== "darwin") { console.log("skipped: the traffic lights are a Mac's"); process.exit(0) }
if (OUT) fs.mkdirSync(OUT, { recursive: true })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-barewindow-"))
keepAwake(600)

// A made-up watch party: the page one colour edge to edge, buttons that open its popups: a camera (a page of its site),
// the room's video popped out (written into a blank window, as video call sites do: a 4:3 camera in a 16:9 window), and
// signing in with another site (localhost), sent there at once or first opened blank.
const ROOM = `<!doctype html><title>Lighthouse watch party</title><style>html,body{margin:0;height:100%;background:#2e86c1}
button{position:fixed;left:200px;width:120px;height:40px}</style><script>window.__token = "room"
function popOut() {
  const w = window.open("", "room-1", "popup,width=480,height=270"), d = w.document
  d.write('<!doctype html><style>body{margin:0}video{display:block;width:100vw;height:100vh}</style><video id="v" autoplay muted playsinline></video>')
  d.close()
  d.title = "Alice's room"
  const c = d.createElement("canvas"); c.width = 400; c.height = 300
  const g = c.getContext("2d"), paint = () => { g.fillStyle = "#27ae60"; g.fillRect(0, 0, 400, 300) }
  paint(); setInterval(paint, 200)
  d.getElementById("v").srcObject = c.captureStream(10)
}
function signIn(blank) { const to = "http://localhost:" + location.port + "/signin"; if (blank) window.open("", "auth", "popup,width=400,height=500").location = to; else window.open(to, "auth", "popup,width=400,height=500") }
</script>
<button id="pop" style="top:200px" onclick="window.open('/cam', 'cam', 'popup,width=320,height=240')">Camera</button>
<button style="top:260px" onclick="popOut()">Pop out</button>
<button style="top:320px" onclick="signIn(false)">Sign in</button>
<button style="top:380px" onclick="signIn(true)">Sign in, blank first</button>`
const CAM = `<!doctype html><title>Alice's camera</title><style>html,body{margin:0;height:100%;background:#c0392b}</style>`
const SIGN_IN = `<!doctype html><title>Sign in to Lighthouse</title><style>html,body{margin:0;height:100%;background:#f4d03f}</style>`
const server = http.createServer((q, res) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(q.url?.startsWith("/cam") ? CAM : q.url?.startsWith("/signin") ? SIGN_IN : ROOM) })
await new Promise((ok) => server.listen(0, "127.0.0.1", ok))
const SITE = `http://127.0.0.1:${server.address().port}/room`, CAM_URL = `http://127.0.0.1:${server.address().port}/cam`

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
try {
  const win = await app.firstWindow()
  watch(win, { console: true, fail: false })
  await win.waitForSelector("[role=tree]", { timeout: 60000 })
  const origin = new URL(win.url()).origin
  await app.evaluate(({ BaseWindow, Menu }) => {
    BaseWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width: 1280, height: 800 })
    // (a pop-out's traffic lights as it shows them, and the menus the pages pop up)
    globalThis.__lights = []
    const vis = BaseWindow.prototype.setWindowButtonVisibility
    globalThis.__popupLights = {}
    BaseWindow.prototype.setWindowButtonVisibility = function (on) {
      if (this.webContents?.getURL().includes("?popout=")) globalThis.__lights.push(on)
      else if (!this.webContents) globalThis.__popupLights[this.id] = on
      return vis.call(this, on)
    }
    Menu.prototype.popup = function () { globalThis.__menu = this }
  })
  const lights = () => app.evaluate(() => globalThis.__lights.at(-1))
  const ui = (body) => uiAt(origin)(body)
  /** The pop-out: its content's size and place, its web page's bounds, its strip (the data: page over it) and drag. */
  const where = () => app.evaluate(async ({ BaseWindow }, src) => {
    const w = BaseWindow.getAllWindows().find((x) => x.webContents?.getURL().includes("?popout="))
    if (!w) return null
    const kids = w.contentView.children, page = kids.find((x) => x.webContents?.getURL().startsWith(src) && x.getVisible())
    const strip = kids.find((x) => x.webContents?.getURL().startsWith("data:"))
    const [width, height] = w.getContentSize()
    return { content: { width, height }, at: w.getContentBounds(), page: page?.getBounds() ?? null, wc: page?.webContents.id,
      strip: strip ? { shown: strip.getVisible(), top: kids.at(-1) === strip, bounds: strip.getBounds(),
        drag: await strip.webContents.executeJavaScript("getComputedStyle(document.body).webkitAppRegion").catch(() => null) } : null }
  }, SITE)
  /** Input events to the pop-out's web page (`page`) or its own page. */
  const send = (events, page = true) => app.evaluate(({ BaseWindow }, [events, page, src]) => {
    const w = BaseWindow.getAllWindows().find((x) => x.webContents?.getURL().includes("?popout="))
    const wc = page ? w.contentView.children.find((x) => x.webContents?.getURL().startsWith(src))?.webContents : w.webContents
    for (const e of events) wc.sendInputEvent(e)
  }, [events, page, SITE])
  const shot = async (name) => {
    if (!OUT) return
    const png = await app.evaluate(async ({ BaseWindow }, src) => {
      const w = BaseWindow.getAllWindows().find((x) => x.webContents?.getURL().includes("?popout="))
      const page = w.contentView.children.find((x) => x.webContents?.getURL().startsWith(src) && x.getVisible())
      return { app: (await w.webContents.capturePage()).toPNG().toString("base64"), page: page ? (await page.webContents.capturePage()).toPNG().toString("base64") : null }
    }, SITE)
    fs.writeFileSync(path.join(OUT, `${name}-app.png`), Buffer.from(png.app, "base64"))
    if (png.page) fs.writeFileSync(path.join(OUT, `${name}-page.png`), Buffer.from(png.page, "base64"))
  }
  const palette = async (p, name) => {
    await p.keyboard.press("ControlOrMeta+P"); await wait(300)
    await p.keyboard.type(name)
    const text = () => p.evaluate(() => document.querySelector("[role=listbox]")?.textContent ?? "")
    const listed = (await until(async () => { const t = await text(); return t.includes(name) ? t : null }, 3000)) ?? await text()
    // (Enter once the row picked is the one asked for)
    await until(() => p.evaluate((n) => document.querySelector("[role=listbox] [aria-selected=true]")?.textContent?.includes(n), name), 3000)
    await p.keyboard.press("Enter"); await wait(400)
    return listed
  }

  // ---------- the page moved into a window of its own ----------
  await ui({ action: "open", path: `view:web/${SITE}`, newTab: true })
  await until(() => win.locator("[data-web-page]:visible").count(), 15000)
  await wait(800)
  await palette(win, "Move current tab to new window")
  const pop = await until(() => app.windows().find((w) => w.url().includes("?popout=")), 15000)
  watch(pop, { label: "popout" })
  await pop.waitForSelector("[data-web-page]", { timeout: 20000 })
  const before = await until(async () => { const w = await where(); return w?.page ? w : null }, 15000)
  check("a pop-out shows the page", before, before)
  check("… under its tab bar or its page bar, the traffic lights shown", before?.page?.y >= 30 && (await lights()) !== false, { page: before?.page, lights: await lights() })
  check("… no strip of its own", before && !before.strip)
  await shot("1-popout")

  // ---------- Hide window bars ----------
  const listed = await palette(pop, "Hide window bars")
  check("the palette offers Hide window bars", /Hide window bars/.test(listed), listed.slice(0, 200))
  const bare = await until(async () => { const w = await where(); return w?.page && w.page.y === 0 && w.strip ? w : null }, 5000)
  check("… the page fills the window edge to edge", bare && bare.page.x === 0 && bare.page.y === 0 && bare.page.width === bare.content.width && bare.page.height === bare.content.height, bare)
  check("… no tab bar, pane bar or status bar", await pop.evaluate(() => document.documentElement.hasAttribute("data-bars-hidden")
    && !document.querySelector("[data-tab-strip], [data-pane-bar], [data-status-bar]")), await pop.evaluate(() => [...document.querySelectorAll("[data-tab-strip], [data-pane-bar], [data-status-bar]")].map((e) => e.outerHTML.slice(0, 80))))
  check("… the page bar hidden", await pop.evaluate(() => document.querySelector("[data-web-bar]")?.dataset.webBarHidden === "in"))
  check("… the traffic lights hidden, and the strip", (await lights()) === false && !bare?.strip.shown, { lights: await lights(), strip: bare?.strip })
  await shot("2-bare")

  // ---------- the pointer at its top ----------
  const at = bare.at
  await app.evaluate((_e, c) => { globalThis.qaPointer = c }, { x: at.x + 300, y: at.y + 12 })
  await send([{ type: "mouseMove", x: 300, y: 12 }])
  const shown = await until(async () => { const w = await where(); return w.strip?.shown ? w : null }, 2000)
  check("the pointer at its top: a strip across it over the page, which drags the window", shown && shown.strip.top && shown.strip.bounds.y === 0
    && shown.strip.bounds.width === shown.content.width && shown.strip.bounds.height === 40 && shown.strip.drag === "drag", shown?.strip)
  check("… and the traffic lights", (await lights()) === true)
  // (its right-click: the window's own, as a title bar's)
  await app.evaluate(({ BaseWindow }) => {
    globalThis.__menu = null
    const wc = BaseWindow.getAllWindows().find((x) => x.webContents?.getURL().includes("?popout=")).contentView.children.find((x) => x.webContents?.getURL().startsWith("data:")).webContents
    for (const type of ["mouseDown", "mouseUp"]) wc.sendInputEvent({ type, x: 300, y: 12, button: "right", clickCount: 1 })
  })
  const stripMenu = await until(() => app.evaluate(() => globalThis.__menu?.items.map((i) => i.label) ?? null), 3000)
  check("the strip's right-click offers Show window bars and Keep window on top", stripMenu?.[0] === "Show window bars" && stripMenu.includes("Keep window on top"), stripMenu)
  await app.evaluate(() => { globalThis.__menu = null })
  await shot("3-top")
  if (OUT) fs.writeFileSync(path.join(OUT, "3-strip.png"), Buffer.from(await app.evaluate(async ({ BaseWindow }) => (await BaseWindow.getAllWindows().find((x) => x.webContents?.getURL().includes("?popout="))
    .contentView.children.find((x) => x.webContents?.getURL().startsWith("data:")).webContents.capturePage()).toPNG().toString("base64")), "base64"))
  await app.evaluate((_e, c) => { globalThis.qaPointer = c }, { x: at.x + 300, y: at.y + 300 })
  check("the pointer leaving the top hides them", await until(async () => !(await where()).strip.shown, 2000) && (await lights()) === false)
  // (its own page's pointer too: a note or a terminal there)
  await app.evaluate((_e, c) => { globalThis.qaPointer = c }, { x: at.x + 300, y: at.y + 12 })
  await send([{ type: "mouseMove", x: 300, y: 12 }], false)
  check("… over the window's own page too", await until(async () => (await where()).strip.shown, 2000) && (await lights()) === true)
  await app.evaluate((_e, c) => { globalThis.qaPointer = c }, { x: at.x + 300, y: at.y + 300 })
  await until(async () => !(await where()).strip.shown, 2000)
  // (lower down, the page has the pointer: its own top is its own)
  await send([{ type: "mouseMove", x: 300, y: 300 }, { type: "mouseDown", x: 300, y: 300, button: "left", clickCount: 1 }, { type: "mouseUp", x: 300, y: 300, button: "left", clickCount: 1 }])
  await wait(300)
  check("… elsewhere nothing shows", !(await where()).strip.shown && (await lights()) === false)

  // ---------- full screen ----------
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find((x) => x.webContents?.getURL().includes("?popout=")).setFullScreen(true))
  await wait(400)
  check("full screen: the traffic lights shown (the system's top)", (await lights()) === true)
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find((x) => x.webContents?.getURL().includes("?popout=")).setFullScreen(false))
  await wait(400)
  check("… out of it, hidden again", (await lights()) === false)

  // ---------- kept ----------
  await pop.reload()
  await pop.waitForSelector("[data-web-page]", { timeout: 20000 })
  const again = await until(async () => { const w = await where(); return w?.page?.y === 0 && w.strip ? w : null }, 10000)
  check("reloaded, its bars stay hidden", again && await pop.evaluate(() => document.documentElement.hasAttribute("data-bars-hidden")), again)
  check("… the traffic lights too", await until(async () => (await lights()) === false, 3000))
  check("… kept with its tabs (the workspace's window)", await pop.evaluate(() => {
    const id = new URLSearchParams(location.search).get("popout"), w = JSON.parse(localStorage.getItem("vaultite.tabs.workspace") ?? localStorage.getItem("vaultite.tabs") ?? "null")
    return w?.windows?.find((x) => x.id === id)?.barsHidden === true
  }))

  // ---------- the page's right-click: Show window bars ----------
  await send([{ type: "mouseDown", x: 300, y: 300, button: "right", clickCount: 1 }, { type: "mouseUp", x: 300, y: 300, button: "right", clickCount: 1 }])
  const menu = await until(() => app.evaluate(() => globalThis.__menu?.items.map((i) => i.label) ?? null), 3000)
  check("the page's right-click offers Show window bars, first", menu?.[0] === "Show window bars", menu)
  await app.evaluate(() => globalThis.__menu.items.find((i) => i.label === "Show window bars").click())
  const back = await until(async () => { const w = await where(); return w?.page?.y >= 30 && !w.strip ? w : null }, 5000)
  check("… which brings them back: the page under its bars, the strip gone", back, await where())
  check("… the traffic lights shown", await until(async () => (await lights()) === true, 2000))
  check("… and not kept hidden", await pop.evaluate(() => !document.documentElement.hasAttribute("data-bars-hidden")))
  await shot("4-back")

  // ---------- the palette, both ways ----------
  check("the palette's Hide window bars again", /Hide window bars/.test(await palette(pop, "Hide window bars")) && await until(async () => (await where())?.page?.y === 0, 5000))
  check("… and Show window bars", /Show window bars/.test(await palette(pop, "Show window bars")) && await until(async () => (await where())?.page?.y >= 30, 5000))
  check("the main window doesn't offer it", !/window bars/.test(await palette(win, "window bars")))
  await win.keyboard.press("Escape")

  // ---------- Keep window on top ----------
  const popWin = (fn) => app.evaluate(({ BaseWindow }, fn) => {
    const w = BaseWindow.getAllWindows().find((x) => x.webContents?.getURL().includes("?popout="))
    return new Function("w", `return (${fn})(w)`)(w)
  }, fn.toString())
  const floats = (w) => w.isAlwaysOnTop() && w.isVisibleOnAllWorkspaces() && !w.isFullScreenable()
  check("the palette's Keep window on top", /Keep window on top/.test(await palette(pop, "Keep window on top")) && await until(() => popWin(floats), 3000))
  check("… that window only", !(await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find((x) => !x.webContents?.getURL().includes("?popout=")).isAlwaysOnTop())))
  await pop.reload()
  await pop.waitForSelector("[data-web-page]", { timeout: 20000 })
  check("… kept for it across a reload", await until(() => popWin(floats), 5000))
  const menuItem = () => app.evaluate(({ Menu }) => {
    const find = (items) => { for (const i of items) { if (i.label === "Keep window on top") return i; const s = i.submenu && find(i.submenu.items); if (s) return s } }
    const i = find(Menu.getApplicationMenu().items)
    return i ? { checked: i.checked, type: i.type } : null
  })
  check("the menu bar's Window menu has it, a check", (await menuItem())?.type === "checkbox", await menuItem())
  await app.evaluate(({ BaseWindow, Menu }) => {
    const w = BaseWindow.getAllWindows().find((x) => x.webContents?.getURL().includes("?popout="))
    const find = (items) => { for (const i of items) { if (i.label === "Keep window on top") return i; const s = i.submenu && find(i.submenu.items); if (s) return s } }
    find(Menu.getApplicationMenu().items).click(undefined, w)
  })
  check("… its click lets that window go", await until(async () => !(await popWin((w) => w.isAlwaysOnTop() || w.isVisibleOnAllWorkspaces())), 3000))
  // (the strip's pin, its bars hidden)
  await palette(pop, "Hide window bars")
  await until(async () => (await where())?.strip, 3000)
  await app.evaluate(({ BaseWindow }) => {
    const w = BaseWindow.getAllWindows().find((x) => x.webContents?.getURL().includes("?popout="))
    return w.contentView.children.find((x) => x.webContents?.getURL().startsWith("data:")).webContents.executeJavaScript("document.querySelector('[data-do=on-top]').click()")
  })
  check("the top strip's pin keeps it on top", await until(() => popWin(floats), 3000))
  check("… drawn pinned", await until(() => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find((x) => x.webContents?.getURL().includes("?popout="))
    .contentView.children.find((x) => x.webContents?.getURL().startsWith("data:")).webContents.executeJavaScript("document.body.classList.contains('on')")), 3000))
  await palette(pop, "Stop keeping window on top")
  check("… and the palette lets it go", await until(async () => !(await popWin((w) => w.isAlwaysOnTop())), 3000))
  await palette(pop, "Show window bars")

  // ---------- the page's popups ----------
  await until(async () => (await where())?.page?.y >= 30, 5000)
  const click = (y) => send([{ type: "mouseMove", x: 250, y }, { type: "mouseDown", x: 250, y, button: "left", clickCount: 1 }, { type: "mouseUp", x: 250, y, button: "left", clickCount: 1 }])
  /** A popup's window (`by`: its title, or an address its page is at) through `fn`, or null. */
  const popupDo = (by, fn) => app.evaluate(({ BaseWindow }, [by, fn]) => {
    const w = BaseWindow.getAllWindows().find((x) => !x.webContents && (by.title ? x.getTitle() === by.title : x.contentView.children.some((v) => v.webContents?.getURL().includes(by.url))))
    return w ? new Function("w", `return (${fn})(w)`)(w) : null
  }, [by, fn.toString()])
  /** Its size and place, its page's bounds, its title bar (the drawn one) or its top strip, its traffic lights. */
  const popupState = (by) => popupDo(by, (w) => {
    const kids = w.contentView.children, page = kids.find((v) => v.webContents && !v.webContents.getURL().startsWith("data:"))
    const data = kids.filter((v) => v.webContents?.getURL().startsWith("data:"))
    const [width, height] = w.getContentSize()
    return { id: w.id, title: w.getTitle(), visible: w.isVisible(), content: { width, height }, at: w.getContentBounds(), page: page.getBounds(), url: page.webContents.getURL(),
      bar: data.some((v) => v.getBounds().height === 28 && v.getVisible()), strip: data.some((v) => v.getBounds().height === 40),
      lights: globalThis.__popupLights[w.id], onTop: w.isAlwaysOnTop() }
  })
  const popupMenu = async (by) => {
    await app.evaluate(() => { globalThis.__menu = null })
    await app.evaluate(({ BaseWindow }, by) => {
      const w = BaseWindow.getAllWindows().find((x) => !x.webContents && (by.title ? x.getTitle() === by.title : x.contentView.children.some((v) => v.webContents?.getURL().includes(by.url))))
      const wc = w.contentView.children.find((v) => v.webContents && !v.webContents.getURL().startsWith("data:")).webContents
      for (const t of ["mouseDown", "mouseUp"]) wc.sendInputEvent({ type: t, x: 100, y: 100, button: "right", clickCount: 1 })
    }, by)
    return until(() => app.evaluate(() => globalThis.__menu?.items.map((i) => i.label) ?? null), 3000)
  }
  const pick = (label) => app.evaluate((_e, label) => globalThis.__menu.items.find((i) => i.label === label).click(), label)
  // (its page gone too, so the next window.open by its name makes a new one)
  const closePopup = async (by) => {
    const id = await popupDo(by, (w) => { const id = w.contentView.children.find((v) => v.webContents && !v.webContents.getURL().startsWith("data:")).webContents.id; w.close(); return id })
    await until(() => app.evaluate(({ webContents }, id) => !webContents.fromId(id) || webContents.fromId(id).isDestroyed(), id), 3000)
  }
  // (a frame, when it's been painted: a quiet window's first may not have been yet)
  const shotOf = async (by, name) => {
    if (!OUT) return
    const png = await popupDo(by, (w) => w.contentView.children.find((v) => v.webContents && !v.webContents.getURL().startsWith("data:")).webContents.capturePage().then((i) => i.toPNG().toString("base64"))).catch(() => null)
    if (png) fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(png, "base64"))
  }

  // ---------- a page of its site: a pop-out ----------
  const CAM_BY = { url: "/cam" }
  await click(220)
  const cam = await until(async () => { const c = await popupState(CAM_BY); return c?.visible && c.title === "Alice's camera" && c.strip ? c : null }, 8000) ?? await popupState(CAM_BY)
  check("a page's popup of its own site opens in a window of its own, no parent", cam && !(await popupDo(CAM_BY, (w) => !!w.getParentWindow?.())), cam)
  check("… bare: the page at the size it asked (320×240), no title bar, its top strip ready", cam?.page.y === 0 && cam.page.width === 320 && cam.page.height === 240
    && cam.content.height === 240 && !cam.bar && cam.strip, cam)
  check("… the traffic lights hidden till the pointer's at its top", cam?.lights === false, cam?.lights)
  check("… titled by its page", cam?.title === "Alice's camera", cam?.title)
  const camPage = (code) => app.evaluate(({ webContents }, [code, src]) => webContents.getAllWebContents().find((w) => w.getURL().startsWith(src))?.executeJavaScript(code), [code, CAM_URL])
  check("… its opener still its opener (a stream handed over works)", await camPage("window.opener && window.opener.__token") === "room")
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find((x) => !x.webContents?.getURL().includes("?popout=") && x.webContents?.getURL().startsWith("http")).minimize())
  await wait(500)
  check("… staying as the vault's window minimizes", await popupDo(CAM_BY, (w) => w.isVisible() && !w.isMinimized()))
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find((x) => !x.webContents?.getURL().includes("?popout=") && x.webContents?.getURL().startsWith("http")).restore())
  const camMenu = await popupMenu(CAM_BY)
  check("its right-click: Keep window on top and Show title bar", camMenu?.includes("Keep window on top") && camMenu?.includes("Show title bar"), camMenu)
  // (the strip's own right-click, as a title bar's)
  await app.evaluate(() => { globalThis.__menu = null })
  await popupDo(CAM_BY, (w) => { const wc = w.contentView.children.find((v) => v.webContents?.getURL().startsWith("data:") && v.getBounds().height === 40).webContents; for (const type of ["mouseDown", "mouseUp"]) wc.sendInputEvent({ type, x: 100, y: 12, button: "right", clickCount: 1 }) })
  const camStripMenu = await until(() => app.evaluate(() => globalThis.__menu?.items.map((i) => i.label) ?? null), 3000)
  check("… and its top strip's: Show title bar, Keep window on top", camStripMenu?.[0] === "Show title bar" && camStripMenu.includes("Keep window on top"), camStripMenu)
  await shotOf(CAM_BY, "5-cam")
  await closePopup(CAM_BY)

  // ---------- written into a blank window: a pop-out ----------
  const ROOM_BY = { title: "Alice's room" }
  await click(280)
  const room = await until(async () => { const r = await popupState(ROOM_BY); return r?.visible && r.strip ? r : null }, 8000) ?? await popupState(ROOM_BY)
  check("a video the page popped out into a blank window: titled by what it wrote (document.title)", room?.title === "Alice's room", room ?? await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().map((w) => w.getTitle())))
  check("… bare: no title bar, its top strip ready, the traffic lights hidden", room && !room.bar && room.strip && room.page.y === 0 && room.lights === false, room)
  const roomPage = (code) => app.evaluate(({ BaseWindow }, code) => BaseWindow.getAllWindows().find((x) => !x.webContents && x.getTitle() === "Alice's room")
    ?.contentView.children.find((v) => v.webContents && !v.webContents.getURL().startsWith("data:")).webContents.executeJavaScript(code), code)
  check("… drawn dark, as a player: black where the page has no background of its own", await roomPage("(() => { const s = getComputedStyle(document.documentElement); return s.colorScheme + ' ' + s.backgroundColor })()") === "dark rgb(0, 0, 0)",
    await roomPage("getComputedStyle(document.documentElement).colorScheme"))
  const locked = await until(async () => { const r = await popupState(ROOM_BY); return r && Math.abs(r.content.height - 360) <= 1 ? r : null }, 6000) ?? await popupState(ROOM_BY)
  check("… asked 480×270, locked to its video's own aspect (4:3): 480×360", locked?.content.width === 480 && Math.abs(locked.content.height - 360) <= 1, { content: locked?.content, video: await roomPage("[document.getElementById('v').videoWidth, document.getElementById('v').videoHeight]") })
  await shotOf(ROOM_BY, "6-room")
  check("its right-click: Keep window on top and Show title bar", (await popupMenu(ROOM_BY))?.includes("Show title bar"))
  await pick("Show title bar")
  const titledRoom = await until(async () => { const r = await popupState(ROOM_BY); return r?.bar ? r : null }, 3000)
  check("… Show title bar: the title bar over the video, the video's size and place on the screen kept", titledRoom?.page.y === 28 && titledRoom.page.height === locked?.content.height
    && titledRoom.content.height === locked.content.height + 28 && titledRoom.at.y + 28 === locked.at.y && !titledRoom.strip && titledRoom.lights === true, { titledRoom, locked })
  await popupMenu(ROOM_BY)
  await pick("Keep window on top")
  check("… Keep window on top", await until(() => popupDo(ROOM_BY, floats), 3000))
  await closePopup(ROOM_BY)
  await click(280)
  const reopened = await until(async () => { const r = await popupState(ROOM_BY); return r?.visible ? r : null }, 8000)
  check("opened again from that site: as it was left, its title bar shown and kept on top", reopened?.bar && reopened.page.y === 28 && await until(() => popupDo(ROOM_BY, floats), 3000), reopened)
  await popupMenu(ROOM_BY)
  await pick("Hide title bar")
  const bareAgain = await until(async () => { const r = await popupState(ROOM_BY); return r && !r.bar && r.strip ? r : null }, 3000)
  check("… Hide title bar: bare again, the video kept where it was", bareAgain?.page.y === 0 && reopened && bareAgain.at.y === reopened.at.y + 28 && bareAgain.content.height === reopened.content.height - 28, { bareAgain, reopened })
  const keptFile = path.join(TMP, "userData", "popup-windows.json")
  const keptNow = fs.existsSync(keptFile) ? JSON.parse(fs.readFileSync(keptFile, "utf8")) : null
  check("… kept for its opener's site, on this machine (not the vault)", keptNow?.["127.0.0.1"]?.bare === true && keptNow["127.0.0.1"].onTop === true, keptNow)
  await closePopup(ROOM_BY)

  // ---------- another site's: a sign-in ----------
  for (const [y, how] of [[340, "sent there at once"], [400, "opened blank, then sent there"]]) {
    const SIGN_BY = { url: "/signin" }
    await click(y)
    const s = await until(async () => { const r = await popupState(SIGN_BY); return r?.visible ? r : null }, 8000)
    check(`a sign-in with another site (${how}): its title bar, the page at the size it asked (400×500) under it`, s?.bar && !s.strip && s.page.y === 28 && s.page.height === 500 && s.content.height === 528 && s.lights === true, s)
    check("… titled by the site asking, not its page", /^localhost/.test(s?.title ?? ""), s?.title)
    check("… not kept on top as the opener's pop-outs are", s && !s.onTop, s)
    if (y === 340) {
      await shotOf(SIGN_BY, "7-signin")
      const bar = OUT && await popupDo(SIGN_BY, (w) => w.contentView.children.find((x) => x.webContents?.getURL().startsWith("data:")).webContents.capturePage().then((i) => i.toPNG().toString("base64"))).catch(() => null)
      if (bar) fs.writeFileSync(path.join(OUT, "7-signin-title.png"), Buffer.from(bar, "base64"))
    }
    await closePopup(SIGN_BY)
  }

  // ---------- back to the main window, its page live ----------
  // (its only tab: the pop-out closes as it goes, which mustn't take the page with it)
  await palette(pop, "Hide window bars")
  await until(async () => (await where())?.page?.y === 0, 5000)
  const pageJs = (code) => app.evaluate(({ webContents }, [code, src]) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(src) && !w.getURL().includes("/cam"))
    return wc ? wc.executeJavaScript(code).then((v) => ({ id: wc.id, v })) : null
  }, [code, SITE])
  const marked = await pageJs("window.__alive = 'still'")
  const closed = pop.waitForEvent("close", { timeout: 10000 }).catch(() => null)
  await palette(pop, "Move current tab to main window")
  check("moved back to the main window, the pop-out closes", await closed !== null)
  const live = await until(async () => {
    const r = await pageJs("window.__alive ?? 'reloaded'")
    const shown = await app.evaluate(({ BaseWindow }, [id, src]) => BaseWindow.getAllWindows().find((x) => !x.webContents?.getURL().includes("?popout=") && x.webContents?.getURL().startsWith("http"))
      ?.contentView.children.some((v) => v.webContents?.id === id && v.getVisible() && v.webContents.getURL().startsWith(src)), [r?.id, SITE])
    return r && shown ? r : null
  }, 10000)
  check("… its page shown there is the same, live: not loaded again", live?.id === marked?.id && live?.v === "still", { marked, live })

  check("no page errors", !errs.filter((e) => !/favicon|ERR_/i.test(e)).length, errs.slice(0, 5))
} finally {
  const port = await app.evaluate(({ BaseWindow }) => new URL(BaseWindow.getAllWindows().find((x) => x.webContents)?.webContents.getURL() ?? "http://x:0").port).catch(() => "")
  await app.close().catch(() => {})
  // (and its terminal keeper, which outlives the app: CLAUDE.md, Running and verifying)
  if (port) stopTerminals(port)
  server.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
