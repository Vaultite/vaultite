// Windows for a call (a film shared, a friend's camera beside it) in the desktop app. A pop-out with its bars hidden (Hide
// window bars: core/workspace.ts hideBars), a web page in it: no tab, pane, page or status bar, the page edge to edge;
// its traffic lights hidden, and with the pointer at its top they show with a strip that drags it (electron/topstrip.ts,
// as a player's), always in full screen; the page's right-click brings the bars back, and so does the palette; kept
// across a reload. Keep window on top (core/ontop.ts, electron/ontop.ts): the palette's, the strip's pin, the menu bar's.
// A popup the page opens (electron/popup.ts): a window of its own at the size it asked, its opener still its opener,
// staying as the vault's window minimizes, its title bar hidden and kept on top from its right-click. Mac only (the
// lights; elsewhere windows keep their frames). WRITES: the throwaway vault only. Frames go to [out dir].
//   node web/qa/barewindow.mjs <vault copy> [out dir]
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait, keepAwake } from "./lib/qa.mjs"
import { stopTerminals } from "../../tools/test/lib.ts"

const { args: [VAULT, OUT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
if (process.platform !== "darwin") { console.log("skipped: the traffic lights are a Mac's"); process.exit(0) }
if (OUT) fs.mkdirSync(OUT, { recursive: true })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-barewindow-"))
keepAwake(600)

// A made-up watch party: the page one colour edge to edge, a button in its top corner.
const ROOM = `<!doctype html><title>Lighthouse watch party</title><style>html,body{margin:0;height:100%;background:#2e86c1}
#pop{position:fixed;top:200px;left:200px;width:120px;height:40px}</style><script>window.__token = "room"</script>
<button id="pop" onclick="window.open('/cam', 'cam', 'popup,width=320,height=240')">Pop out</button>`
const CAM = `<!doctype html><title>Alice's camera</title><style>html,body{margin:0;height:100%;background:#c0392b}</style>`
const server = http.createServer((q, res) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(q.url?.startsWith("/cam") ? CAM : ROOM) })
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
  await app.evaluate(({ BaseWindow, Menu, screen }) => {
    BaseWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width: 1280, height: 800 })
    // (the pointer as the test puts it, a pop-out's traffic lights as it shows them, and the menus the pages pop up)
    const cursor = screen.getCursorScreenPoint.bind(screen)
    screen.getCursorScreenPoint = () => globalThis.__cursor ?? cursor()
    globalThis.__lights = []
    const vis = BaseWindow.prototype.setWindowButtonVisibility
    globalThis.__camLights = []
    BaseWindow.prototype.setWindowButtonVisibility = function (on) {
      if (this.webContents?.getURL().includes("?popout=")) globalThis.__lights.push(on)
      else if (this.contentView.children.some((v) => v.webContents?.getURL().includes("/cam"))) globalThis.__camLights.push(on)
      return vis.call(this, on)
    }
    Menu.prototype.popup = function () { globalThis.__menu = this }
  })
  const lights = () => app.evaluate(() => globalThis.__lights.at(-1))
  const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
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
  await app.evaluate((_e, c) => { globalThis.__cursor = c }, { x: at.x + 300, y: at.y + 12 })
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
  await app.evaluate((_e, c) => { globalThis.__cursor = c }, { x: at.x + 300, y: at.y + 300 })
  check("the pointer leaving the top hides them", await until(async () => !(await where()).strip.shown, 2000) && (await lights()) === false)
  // (its own page's pointer too: a note or a terminal there)
  await app.evaluate((_e, c) => { globalThis.__cursor = c }, { x: at.x + 300, y: at.y + 12 })
  await send([{ type: "mouseMove", x: 300, y: 12 }], false)
  check("… over the window's own page too", await until(async () => (await where()).strip.shown, 2000) && (await lights()) === true)
  await app.evaluate((_e, c) => { globalThis.__cursor = c }, { x: at.x + 300, y: at.y + 300 })
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

  // ---------- a popup the page opens ----------
  await until(async () => (await where())?.page?.y >= 30, 5000)
  await send([{ type: "mouseMove", x: 250, y: 220 }, { type: "mouseDown", x: 250, y: 220, button: "left", clickCount: 1 }, { type: "mouseUp", x: 250, y: 220, button: "left", clickCount: 1 }])
  const camWin = (fn) => app.evaluate(({ BaseWindow }, [fn, src]) => {
    const w = BaseWindow.getAllWindows().find((x) => x.contentView.children.some((v) => v.webContents?.getURL().startsWith(src)))
    return w ? new Function("w", `return (${fn})(w)`)(w) : null
  }, [fn.toString(), CAM_URL])
  const cam = await until(() => camWin((w) => { const v = w.contentView.children.find((x) => x.webContents?.getURL().includes("/cam")); const [width, height] = w.getContentSize()
    return { title: w.getTitle(), parent: !!w.getParentWindow?.(), content: { width, height }, page: v.getBounds() } }), 8000)
  check("the page's popup opens in a window of its own, no parent", cam && !cam.parent, cam)
  check("… at the size it asked (320×240), under its title bar", cam?.page.width === 320 && cam?.page.height === 240 && cam?.page.y === 28 && cam?.content.height === 268, cam)
  check("… titled with its site", /127\.0\.0\.1/.test(cam?.title ?? ""), cam?.title)
  const camPage = (code) => app.evaluate(({ webContents }, [code, src]) => webContents.getAllWebContents().find((w) => w.getURL().startsWith(src))?.executeJavaScript(code), [code, CAM_URL])
  check("… its opener still its opener (a stream handed over works)", await camPage("window.opener && window.opener.__token") === "room")
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find((x) => !x.webContents?.getURL().includes("?popout=") && x.webContents?.getURL().startsWith("http")).minimize())
  await wait(500)
  check("… staying as the vault's window minimizes", await camWin((w) => w.isVisible() && !w.isMinimized()))
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find((x) => !x.webContents?.getURL().includes("?popout=") && x.webContents?.getURL().startsWith("http")).restore())
  if (OUT) fs.writeFileSync(path.join(OUT, "5-cam-title.png"), Buffer.from(await camWin((w) => w.contentView.children.find((x) => x.webContents?.getURL().startsWith("data:")).webContents.capturePage().then((i) => i.toPNG().toString("base64"))), "base64"))
  // (its right-click)
  await app.evaluate(() => { globalThis.__menu = null })
  await app.evaluate(({ webContents }, src) => { const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(src)); for (const t of ["mouseDown", "mouseUp"]) wc.sendInputEvent({ type: t, x: 100, y: 100, button: "right", clickCount: 1 }) }, CAM_URL)
  const camMenu = await until(() => app.evaluate(() => globalThis.__menu?.items.map((i) => i.label) ?? null), 3000)
  check("its right-click: Keep window on top and Hide title bar", camMenu?.includes("Keep window on top") && camMenu?.includes("Hide title bar"), camMenu)
  const pick = (label) => app.evaluate((_e, label) => globalThis.__menu.items.find((i) => i.label === label).click(), label)
  await pick("Keep window on top")
  check("… kept on top", await until(() => camWin(floats), 3000))
  await pick("Hide title bar")
  const bareCam = await until(() => camWin((w) => { const v = w.contentView.children.find((x) => x.webContents?.getURL().includes("/cam")); const [width, height] = w.getContentSize(); return { page: v.getBounds(), width, height, strip: w.contentView.children.some((x) => x.webContents?.getURL().startsWith("data:") && x.getBounds().height === 40) } }).then((c) => (c?.strip ? c : null)), 3000) ?? await camWin((w) => w.contentView.children.map((x) => [x.webContents?.getURL().slice(0, 20), x.getBounds()]))
  check("… its title bar hidden: the page fills it, its top strip ready", bareCam?.page.y === 0 && bareCam.page.height === bareCam.height && bareCam.strip, bareCam)
  check("… the traffic lights hidden", (await app.evaluate(() => globalThis.__camLights.at(-1))) === false, await app.evaluate(() => globalThis.__camLights))
  if (OUT) fs.writeFileSync(path.join(OUT, "5-cam.png"), Buffer.from(await app.evaluate(async ({ webContents }, src) => (await webContents.getAllWebContents().find((w) => w.getURL().startsWith(src)).capturePage()).toPNG().toString("base64"), CAM_URL), "base64"))
  await camWin((w) => w.close())

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
