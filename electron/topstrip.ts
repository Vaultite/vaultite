// A window with nothing over its page (a player, a pop-out with its bars hidden): its controls (the Mac's lights, ours
// elsewhere: player-bar.cjs) show with a shade that drags it only while the pointer is at its top, or in full screen.
import { type BaseWindow, Menu, type MenuItemConstructorOptions, screen, type WebContents, WebContentsView } from "electron"
import { fileURLToPath } from "node:url"
import { isOnTop, onTopChanged } from "./ontop.ts"

const MAC = process.platform === "darwin"
/** The top strip (points) where the controls show and the window drags. */
export const STRIP = 40
const PRELOAD = fileURLToPath(new URL("./player-bar.cjs", import.meta.url))
// (a shade for the controls to read on; Windows' and Linux's buttons on its right, as their title bars have them; Keep
// on top's pin before them, filled while it is)
const BUTTONS = MAC ? "" : `<div class="b" data-do="minimize"><svg viewBox="0 0 10 10"><path d="M0 5.5h10"/></svg></div>
<div class="b" data-do="maximize"><svg viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9"/></svg></div>
<div class="b x" data-do="close"><svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10"/></svg></div>`
const PIN = `<div class="b p" data-do="on-top" role="button" aria-label="Keep window on top"><svg viewBox="0 0 24 24"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg></div>`
const BAR = (pin: boolean) => `<!doctype html><meta charset="utf-8"><style>
html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; user-select: none; cursor: default }
body { display: flex; justify-content: flex-end; -webkit-app-region: drag; background: linear-gradient(rgb(0 0 0 / .55), rgb(0 0 0 / 0)) }
.b { -webkit-app-region: no-drag; width: 46px; display: grid; place-items: center; color: #fff }
.b:hover { background: rgb(255 255 255 / .14) } .x:hover { background: #c42b1c }
svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1 }
.p svg { width: 14px; height: 14px; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round } .on .p svg { fill: currentColor }
${MAC ? ".p { width: 28px; height: 28px; margin: 6px 8px; border-radius: 6px }" : ""}
</style><body>${pin ? PIN : ""}${BUTTONS}</body>`

type Strip = { reveal: (on: boolean) => void; shown: () => boolean; bar: WebContentsView; off: () => void }
const strips = new WeakMap<BaseWindow, Strip>()

/** Window `w`'s top strip, hidden till the pointer is there (`pointerAt`, or over `page`); `lights` lays the Mac's lights
 *  out again as it shows or hides (`lightsShown`); `pin`: Keep on top's button (ontop.ts); `menu`: its right-click's. */
export function topStrip(w: BaseWindow, lights: () => void, { page, pin, menu }: { page?: WebContents; pin?: () => void; menu?: () => MenuItemConstructorOptions[] } = {}) {
  const bar = new WebContentsView({ webPreferences: { partition: "vaultite-player-bar", sandbox: true, contextIsolation: true, spellcheck: false, ...(MAC && !pin ? {} : { preload: PRELOAD }) } })
  bar.setBackgroundColor("#00000000")
  bar.setVisible(false)
  const pinned = () => { if (!bar.webContents.isDestroyed()) void bar.webContents.executeJavaScript(`document.body.classList.toggle("on", ${isOnTop(w)})`).catch(() => {}) }
  bar.webContents.on("did-finish-load", pinned)
  void bar.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(BAR(!!pin))}`)
  bar.webContents.ipc.on("player:bar", (_e, what) => {
    if (what === "minimize") w.minimize()
    else if (what === "maximize") { if (w.isMaximized()) w.unmaximize(); else w.maximize() }
    else if (what === "close") w.close()
    else if (what === "on-top") pin?.()
  })
  // (the top of a window is where a right-click looks for the window's own commands, as on a title bar)
  bar.webContents.on("context-menu", () => { const items = menu?.() ?? []; if (items.length && !w.isDestroyed()) Menu.buildFromTemplate(items).popup({ window: w }) })
  const unpinned = onTopChanged(pinned)
  w.contentView.addChildView(bar)

  // Shown while the pointer is in the strip, hidden once it's left it: the window watches the pointer itself, so its
  // controls come whatever its page does (a page telling it, `pointerAt`, only shows them sooner).
  let shown = false
  const inStrip = () => {
    if (w.isDestroyed() || !w.isVisible()) return false
    const c = screen.getCursorScreenPoint(), b = w.getContentBounds()
    return c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + STRIP
  }
  const reveal = (on: boolean) => {
    if (w.isDestroyed() || (on && w.isFullScreen()) || on === shown) return
    shown = on
    // (over whatever came into the window since: a page)
    if (on) w.contentView.addChildView(bar)
    bar.setVisible(on)
    lights()
  }
  const timer = setInterval(() => { if (!w.isDestroyed() && w.isVisible()) reveal(inStrip()) }, 120)
  const lay = () => { if (!w.isDestroyed()) { const [width] = w.getContentSize(); bar.setBounds({ x: 0, y: 0, width, height: STRIP }) } }
  const full = () => { reveal(false); lights() }
  const moved = (_e: unknown, m: { type: string; y: number }) => { if (m.type === "mouseMove") pointerAt(w, m.y) }
  lay()
  w.contentView.on("bounds-changed", lay)
  w.on("enter-full-screen", full)
  // (the Mac lays its title bar out again on these, its lights put back)
  if (MAC) w.on("focus", lights).on("blur", lights).on("show", lights).on("restore", lights).on("resized", lights).on("leave-full-screen", lights)
  page?.on("before-mouse-event", moved)
  const off = () => {
    if (strips.get(w) !== strip) return
    strips.delete(w)
    clearInterval(timer)
    if (!w.isDestroyed()) {
      w.contentView.off("bounds-changed", lay)
      w.off("enter-full-screen", full)
      if (MAC) w.off("focus", lights).off("blur", lights).off("show", lights).off("restore", lights).off("resized", lights).off("leave-full-screen", lights)
      w.contentView.removeChildView(bar)
    }
    if (page && !page.isDestroyed()) page.off("before-mouse-event", moved)
    unpinned()
    if (!bar.webContents.isDestroyed()) bar.webContents.close()
  }
  w.once("close", off)
  const strip: Strip = { reveal, shown: () => shown, bar, off }
  strips.set(w, strip)
  lights()
  return strip
}

/** Window `w`'s top strip taken away: its page's own controls again. */
export const noStrip = (w: BaseWindow) => strips.get(w)?.off()
/** Window `w` has a top strip. */
export const hasStrip = (w: BaseWindow) => strips.has(w)
/** Whether the Mac's traffic lights show in window `w`: always, unless it has a top strip that's hidden (out of full screen). */
export const lightsShown = (w: BaseWindow) => { const s = strips.get(w); return !s || s.shown() || w.isFullScreen() }
/** The pointer moved over window `w`, `y` points from its top: in its top strip, its controls show till it leaves. */
export const pointerAt = (w: BaseWindow, y: number) => { if (y <= STRIP) strips.get(w)?.reveal(true) }
