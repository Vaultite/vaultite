// A page's sized popup (a sign-in, a call's video popped out): a window of its own at the size it asked, not its opener's
// child, so it stays put as that one moves or minimizes; a Mac's title bar drawn here, so it can hide (topstrip.ts).
import { BaseWindow, Menu, type MenuItemConstructorOptions, screen, type WebContents, WebContentsView, type WebPreferences } from "electron"
import { isOnTop, setOnTop, watchFocus } from "./ontop.ts"
import { quiet } from "./quiet.ts"
import { lightsShown, noStrip, topStrip } from "./topstrip.ts"

const MAC = process.platform === "darwin"
/** Its title bar's height (points), as a Mac's own; the lights in it, and in the top strip while it's hidden. */
const HEAD = 28
const LIGHTS = { x: 9, y: 7 }, STRIP_LIGHTS = { x: 14, y: 13 }
const TITLE = `<!doctype html><meta charset="utf-8"><style>
html, body { margin: 0; height: 100%; overflow: hidden; user-select: none; cursor: default }
body { -webkit-app-region: drag; display: grid; place-items: center; box-sizing: border-box; padding: 0 76px; font: 600 13px -apple-system, system-ui;
  background: #ececec; color: #4d4d4d; border-bottom: 1px solid #d6d6d6 }
@media (prefers-color-scheme: dark) { body { background: #2a2a2a; color: #c9c9c9; border-color: #141414 } }
body.away { color: #a6a6a6 } @media (prefers-color-scheme: dark) { body.away { color: #6e6e6e } }
#t { max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis }
</style><body><div id="t"></div>`

/** What the opener's page does for its popup (web.ts): its container's name, an address not for the web (another app's)
 *  taken elsewhere, a link opened as the page's would (a tab in its container), Leave site's question, its closing. */
export type Opener = { name: () => string; away: (url: string) => boolean; link: (url: string) => void; mayLeave: (page: WebContents, win: BaseWindow) => boolean
  closing: (page: WebContents) => void; opener: WebContents }
type Asked = { webContents: WebContents; webPreferences?: WebPreferences; x?: number; y?: number; width?: number; height?: number }

/** The popup for window.open's contents (`asked`: its features' size and place), titled with its site and container,
 *  its right-click its window's (Keep on top, Hide title bar), closed with the page that opened it. Answers the contents. */
export function popup(asked: Asked, o: Opener) {
  const pop = popupWindow(asked.webContents, asked.webPreferences, asked), { win, page } = pop
  const host = () => { try { return new URL(page.getURL()).hostname } catch { return "" } }
  const titled = () => { if (!win.isDestroyed() && !page.isDestroyed()) pop.setTitle([host() || "Sign in", o.name()].filter(Boolean).join(" · ")) }
  page.on("page-title-updated", titled)
  page.on("did-navigate", titled)
  page.on("will-navigate", (e) => { if (o.away(e.url)) e.preventDefault() })
  page.setWindowOpenHandler(({ url }) => { o.link(url); return { action: "deny" } })
  page.on("will-prevent-unload", (e) => { if (o.mayLeave(page, win)) e.preventDefault() })
  page.on("context-menu", (_e, c) => {
    const items: MenuItemConstructorOptions[] = c.isEditable ? [{ role: "cut" }, { role: "copy" }, { role: "paste" }, { type: "separator" }]
      : c.selectionText.trim() ? [{ role: "copy" }, { type: "separator" }] : []
    items.push({ label: "Keep window on top", type: "checkbox", checked: isOnTop(win), click: () => setOnTop(win, !isOnTop(win)) })
    if (MAC) items.push(pop.bare() ? { label: "Show title bar", click: () => pop.setBare(false) } : { label: "Hide title bar", click: () => pop.setBare(true) })
    items.push({ type: "separator" }, { label: "Reload", click: () => page.reload() }, { label: "Inspect element", click: () => page.inspectElement(c.x, c.y) })
    Menu.buildFromTemplate(items).popup({ window: win })
  })
  const close = () => { if (!win.isDestroyed()) { o.closing(page); win.close() } }
  o.opener.once("destroyed", close)
  win.once("closed", () => { if (!o.opener.isDestroyed()) o.opener.off("destroyed", close) })
  titled()
  return page
}

type Popup = { win: BaseWindow; page: WebContents; setTitle: (title: string) => void; bare: () => boolean; setBare: (on: boolean) => void }

/** The popup's window for `page`, at `asked`: what its features said (its content's size, its place). Shown at once. */
function popupWindow(page: WebContents, webPreferences: WebPreferences | undefined, asked: { x?: number; y?: number; width?: number; height?: number }): Popup {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const size = (v: number | undefined, d: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, Number.isFinite(v) && v! > 0 ? v! : d)))
  const head = MAC ? HEAD : 0
  const width = size(asked.width, 520, 200, area.width), height = size(asked.height, 700, 120, area.height - head) + head
  const place = Number.isFinite(asked.x) && Number.isFinite(asked.y) ? { x: Math.round(asked.x!), y: Math.round(asked.y!) } : {}
  const win = new BaseWindow({ width, height, ...place, useContentSize: true, minWidth: 200, minHeight: 120 + head, show: false, autoHideMenuBar: true,
    ...(MAC ? { titleBarStyle: "hidden" as const, trafficLightPosition: LIGHTS } : {}) })
  quiet(win)
  const view = new WebContentsView({ webContents: page, webPreferences })
  win.contentView.addChildView(view)
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

  let bare = false
  const lay = () => {
    if (win.isDestroyed()) return
    const [w, h] = win.getContentSize(), top = title && !bare && !win.isFullScreen() ? HEAD : 0
    title?.setVisible(top > 0)
    title?.setBounds({ x: 0, y: 0, width: w, height: HEAD })
    view.setBounds({ x: 0, y: top, width: w, height: h - top })
  }
  const lights = () => {
    if (!MAC || win.isDestroyed()) return
    win.setWindowButtonPosition(bare ? STRIP_LIGHTS : LIGHTS)
    win.setWindowButtonVisibility(lightsShown(win))
  }
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
  const setBare = (on: boolean) => {
    if (!MAC || on === bare || win.isDestroyed()) return
    bare = on
    if (on) topStrip(win, lights, { page, pin: () => setOnTop(win, !isOnTop(win)), menu: () => [
      { label: "Show title bar", click: () => setBare(false) },
      { label: "Keep window on top", type: "checkbox", checked: isOnTop(win), click: () => setOnTop(win, !isOnTop(win)) },
    ] }); else noStrip(win)
    lay()
    lights()
  }
  watchFocus(win)
  win.show()
  return {
    win, page,
    setTitle: (t) => { named = t; if (!win.isDestroyed()) win.setTitle(t); said() },
    bare: () => bare,
    setBare,
  }
}
