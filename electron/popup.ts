// A page's sized popup (a sign-in, a call's video popped out): a window of its own at the size it asked, not its opener's
// child, so it stays put as that one moves or minimizes; a Mac's title bar drawn here, hidden on a pop-out (topstrip.ts).
import { app, BaseWindow, Menu, type MenuItemConstructorOptions, screen, type WebContents, WebContentsView, type WebPreferences } from "electron"
import fs from "node:fs"
import path from "node:path"
import { isOnTop, setOnTop, watchFocus } from "./ontop.ts"
import { quiet } from "./quiet.ts"
import { writeAtomic } from "./setup.ts"
import { lightsShown, noStrip, topStrip } from "./topstrip.ts"

const MAC = process.platform === "darwin"
/** Its title bar's height (points), as a Mac's own; the lights in it, and in the top strip while it's hidden. */
const HEAD = 28
const LIGHTS = { x: 9, y: 7 }, STRIP_LIGHTS = { x: 14, y: 13 }
const DARK = ":root { color-scheme: dark; background: #000 }"
const TITLE = `<!doctype html><meta charset="utf-8"><style>
html, body { margin: 0; height: 100%; overflow: hidden; user-select: none; cursor: default }
body { -webkit-app-region: drag; display: grid; place-items: center; box-sizing: border-box; padding: 0 76px; font: 600 13px -apple-system, system-ui;
  background: #ececec; color: #4d4d4d; border-bottom: 1px solid #d6d6d6 }
@media (prefers-color-scheme: dark) { body { background: #2a2a2a; color: #c9c9c9; border-color: #141414 } }
body.away { color: #a6a6a6 } @media (prefers-color-scheme: dark) { body.away { color: #6e6e6e } }
#t { max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis }
</style><body><div id="t"></div>`

/** What the opener's page does for its popup (web.ts): its container's name, another app's address taken elsewhere, a
 *  link opened as the page's would, Leave site's question, its closing; an address's site (web.ts siteOf). */
export type Opener = { name: () => string; away: (url: string) => boolean; link: (url: string) => void; mayLeave: (page: WebContents, win: BaseWindow) => boolean
  closing: (page: WebContents) => void; opener: WebContents; site: (url: string) => string }
type Asked = { webContents: WebContents; webPreferences?: WebPreferences; x?: number; y?: number; width?: number; height?: number }

/** What window.open('') opens: a page its opener writes into (or sends somewhere next). */
const blank = (u: string) => !u || /^about:(blank|srcdoc)([?#].*)?$/i.test(u)
/** How long a blank popup waits to be sent somewhere before it shows as what its opener writes (ms), and the longest
 *  any waits for its first page (its redirects done): it shows once it's known which kind it is. */
const BEAT = 200, FIRST_PAGE_MS = 1500

/** A pop-out's window as last left, per opener's site: its title bar hidden or not, kept on top. This Mac's (userData),
 *  as a player keeps its place. */
type Kept = { bare?: boolean; onTop?: boolean }
const keptFile = () => path.join(app.getPath("userData"), "popup-windows.json")
function keptFor(site: string): Kept {
  try { const k = (JSON.parse(fs.readFileSync(keptFile(), "utf8")) as Record<string, Kept>)[site]; return k && typeof k === "object" ? k : {} } catch { return {} }
}
function keep(site: string, k: Kept) {
  let all: Record<string, Kept> = {}
  try { all = JSON.parse(fs.readFileSync(keptFile(), "utf8")) as Record<string, Kept> } catch { /* the first */ }
  all[site] = { ...all[site], ...k }
  try { writeAtomic(keptFile(), JSON.stringify(all)) } catch { /* this run's only */ }
}

let kit: typeof import("./player.ts") | undefined
const playerKit = async () => (kit ??= await import("./player.ts"))

/** The popup for window.open's contents (`asked`: its size and place; `url`: where it was opened to), closed with its
 *  opener. Its kind (electron/CLAUDE.md) decides its look and title. Answers the contents. */
export function popup(asked: Asked, url: string, o: Opener) {
  const from = o.opener.getURL(), site = o.site(from)
  const ours = (u: string) => blank(u) || (!!site && o.site(u.replace(/^blob:/i, "")) === site)
  let signIn = !ours(url)
  const kept = signIn ? {} : keptFor(site)
  const choose = (on: boolean) => { pop.setBare(on); lock(); if (!signIn) keep(site, { bare: on }) }
  const pin = () => { setOnTop(win, !isOnTop(win)); if (!signIn) keep(site, { onTop: isOnTop(win) }) }
  const onTopItem = (): MenuItemConstructorOptions => ({ label: "Keep window on top", type: "checkbox", checked: isOnTop(win), click: pin })
  const pop = popupWindow(asked.webContents, asked.webPreferences, asked, { bare: !signIn && kept.bare !== false, black: !signIn, dark: blank(url), pin,
    menu: () => [{ label: "Show title bar", click: () => choose(false) }, onTopItem()] }), { win, page } = pop
  const hostOf = (u: string) => { try { return new URL(u.replace(/^blob:/i, "")).hostname } catch { return "" } }
  // (the title the page set itself: a page without one gets its address for a title, which says nothing here)
  let said = ""
  const titled = () => {
    if (win.isDestroyed() || page.isDestroyed()) return
    const who = signIn ? hostOf(page.getURL()) : said || hostOf(page.getURL())
    pop.setTitle([who || hostOf(from), o.name()].filter(Boolean).join(" · "))
  }
  page.on("page-title-updated", (_e, t, explicit) => { said = explicit ? t.trim() : ""; titled() })
  page.on("did-navigate", () => { said = ""; titled() })
  page.on("did-navigate-in-page", titled)

  // Its video's aspect, kept: first as the size it asked, then its main video's own, following it as it changes.
  let aspect = !signIn && asked.width && asked.height && asked.width > 0 && asked.height > 0 ? asked.width / asked.height : null
  const lock = () => { if (!kit || win.isDestroyed()) return; kit.setAspect(win, signIn ? null : aspect, pop.top()) }
  win.on("enter-full-screen", lock)
  win.on("leave-full-screen", lock)
  let following = 0
  const follow = async () => {
    const run = ++following, k = await playerKit()
    lock()
    while (run === following && !signIn && !page.isDestroyed()) {
      const a = await page.executeJavaScriptInIsolatedWorld(1004, [{ code: k.nextAspect(aspect) }]).catch(() => undefined)
      if (run !== following || signIn || typeof a !== "number" || !(a > 0.2 && a < 5)) return
      aspect = a
      lock()
    }
  }

  // Which kind it is shows once it's on its first page (or a blank one stays blank), and once on another site it's a
  // sign-in for good: the sign-in's last step back on the opener's site is its own page's no more than a moment.
  let shown = false, pinned = false
  const show = () => {
    if (shown || win.isDestroyed()) return
    shown = true
    clearTimeout(wait)
    pop.show()
    if (!signIn && kept.onTop) { setOnTop(win, true); pinned = true }
    if (!signIn) void follow()
  }
  let wait = setTimeout(show, blank(url) ? BEAT : FIRST_PAGE_MS)
  const went = (u: string) => {
    if (signIn || ours(u) || !/^https?:/i.test(u)) return
    signIn = true
    following++
    if (pinned) setOnTop(win, false)
    pop.setBare(false)
    lock()
    titled()
  }
  // (a blank one commits about:blank first, whether it's written into or sent on)
  page.on("did-start-navigation", (d) => {
    if (!d.isMainFrame || d.isSameDocument || blank(d.url)) return
    went(d.url)
    if (!shown) { clearTimeout(wait); wait = setTimeout(show, FIRST_PAGE_MS) }
  })
  page.on("did-redirect-navigation", (d) => { if (d.isMainFrame) went(d.url) })
  // (a page its opener wrote is drawn dark, as a player; one of the web's as it draws itself)
  page.on("did-navigate", (_e, u) => {
    if (blank(u)) return
    pop.setDark(false)
    went(u)
    if (!shown) show(); else if (!signIn) void follow()
  })
  page.on("did-fail-load", (_e, _c, _d, _u, main) => { if (main) show() })

  page.on("will-navigate", (e) => { if (o.away(e.url)) e.preventDefault() })
  page.setWindowOpenHandler(({ url }) => { o.link(url); return { action: "deny" } })
  page.on("will-prevent-unload", (e) => { if (o.mayLeave(page, win)) e.preventDefault() })
  page.on("context-menu", (_e, c) => {
    const items: MenuItemConstructorOptions[] = c.isEditable ? [{ role: "cut" }, { role: "copy" }, { role: "paste" }, { type: "separator" }]
      : c.selectionText.trim() ? [{ role: "copy" }, { type: "separator" }] : []
    items.push(onTopItem())
    if (MAC) items.push(pop.bare() ? { label: "Show title bar", click: () => choose(false) } : { label: "Hide title bar", click: () => choose(true) })
    items.push({ type: "separator" }, { label: "Reload", click: () => page.reload() }, { label: "Inspect element", click: () => page.inspectElement(c.x, c.y) })
    Menu.buildFromTemplate(items).popup({ window: win })
  })
  const close = () => { if (!win.isDestroyed()) { o.closing(page); win.close() } }
  o.opener.once("destroyed", close)
  win.once("closed", () => { following++; clearTimeout(wait); if (!o.opener.isDestroyed()) o.opener.off("destroyed", close) })
  titled()
  return page
}

type Popup = { win: BaseWindow; page: WebContents; show: () => void; setTitle: (title: string) => void; bare: () => boolean; setBare: (on: boolean) => void
  /** Points over its page: its title bar's, or none. */
  top: () => number
  setDark: (on: boolean) => void }
type Look = { bare: boolean; black: boolean; dark: boolean; pin: () => void; menu: () => MenuItemConstructorOptions[] }

/** The popup's window for `page`, at `asked`: what its features said (its content's size, its place), its page's size
 *  whether its title bar shows or not. `look`: bare (its top strip's pin and right-click), a black window, its page drawn dark. Hidden till shown. */
function popupWindow(page: WebContents, webPreferences: WebPreferences | undefined, asked: { x?: number; y?: number; width?: number; height?: number }, look: Look): Popup {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const size = (v: number | undefined, d: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, Number.isFinite(v) && v! > 0 ? v! : d)))
  let bare = MAC && look.bare
  const head = MAC && !bare ? HEAD : 0
  const width = size(asked.width, 520, 200, area.width), height = size(asked.height, 700, 120, area.height - head) + head
  const place = Number.isFinite(asked.x) && Number.isFinite(asked.y) ? { x: Math.round(asked.x!), y: Math.round(asked.y!) } : {}
  const win = new BaseWindow({ width, height, ...place, useContentSize: true, minWidth: 200, minHeight: 120, show: false, autoHideMenuBar: true,
    ...(look.black ? { backgroundColor: "#000000" } : {}), ...(MAC ? { titleBarStyle: "hidden" as const, trafficLightPosition: bare ? STRIP_LIGHTS : LIGHTS } : {}) })
  quiet(win)
  const view = new WebContentsView({ webContents: page, webPreferences })
  win.contentView.addChildView(view)
  // (black where the page draws no background of its own, with light text and controls to go on it, as a player's)
  let darkCss: Promise<string> | null = null
  const setDark = (on: boolean) => {
    if (on === !!darkCss || page.isDestroyed()) return
    view.setBackgroundColor(on ? "#000000" : "#ffffff")
    if (on) darkCss = page.insertCSS(DARK, { cssOrigin: "user" })
    else { const css = darkCss; darkCss = null; void css?.then((k) => { if (!page.isDestroyed()) void page.removeInsertedCSS(k) }).catch(() => {}) }
  }
  setDark(look.dark)
  const title = MAC ? new WebContentsView({ webPreferences: { partition: "vaultite-player-bar", sandbox: true, contextIsolation: true, spellcheck: false } }) : null
  let named = ""
  const said = () => { if (title && !title.webContents.isDestroyed()) void title.webContents.executeJavaScript(`document.getElementById("t").textContent = ${JSON.stringify(named)}; document.body.classList.toggle("away", ${!win.isFocused()})`).catch(() => {}) }
  if (title) {
    title.webContents.on("did-finish-load", said)
    void title.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(TITLE)}`)
    win.contentView.addChildView(title)
    win.on("focus", said)
    win.on("blur", said)
  }

  const top = () => (title && !bare && !win.isFullScreen() ? HEAD : 0)
  const lay = () => {
    if (win.isDestroyed()) return
    const [w, h] = win.getContentSize(), t = top()
    title?.setVisible(t > 0)
    title?.setBounds({ x: 0, y: 0, width: w, height: HEAD })
    view.setBounds({ x: 0, y: t, width: w, height: h - t })
  }
  const lights = () => {
    if (!MAC || win.isDestroyed()) return
    win.setWindowButtonPosition(bare ? STRIP_LIGHTS : LIGHTS)
    win.setWindowButtonVisibility(lightsShown(win))
  }
  const strip = () => topStrip(win, lights, { page, pin: look.pin, menu: look.menu })
  if (bare) strip()
  lay()
  win.contentView.on("bounds-changed", lay)
  win.on("enter-full-screen", lay)
  win.on("leave-full-screen", lay)
  // (a video's own full screen: the window's too, where it can be; leaving the window's leaves the page's)
  let full = false
  page.on("enter-html-full-screen", () => { full = true; if (win.isFullScreenable()) win.setFullScreen(true) })
  page.on("leave-html-full-screen", () => { full = false; if (win.isFullScreen()) win.setFullScreen(false) })
  win.on("leave-full-screen", () => { if (full && !page.isDestroyed()) void page.executeJavaScript("document.exitFullscreen?.()", true).catch(() => {}) })

  win.once("closed", () => {
    if (!page.isDestroyed()) page.close()
    if (title && !title.webContents.isDestroyed()) title.webContents.close()
  })
  page.once("destroyed", () => { if (!win.isDestroyed()) win.close() })
  // (its page stays the size it was, and where it was on the screen: the window grows or shrinks by its title bar, above)
  const setBare = (on: boolean) => {
    if (!MAC || on === bare || win.isDestroyed()) return
    const was = top()
    bare = on
    if (on) strip(); else noStrip(win)
    const by = top() - was
    if (by && !win.isMaximized() && !win.isFullScreen()) {
      const b = win.getContentBounds(), y = win.isVisible() ? b.y - by : b.y
      win.setContentBounds({ ...b, y: Math.max(screen.getDisplayMatching(b).workArea.y, y), height: b.height + by })
    }
    lay()
    lights()
  }
  watchFocus(win)
  return {
    win, page,
    show: () => { if (!win.isDestroyed()) { win.show(); lights() } },
    setTitle: (t) => { named = t; if (!win.isDestroyed()) win.setTitle(t); said() },
    bare: () => bare,
    setBare,
    top,
    setDark,
  }
}
