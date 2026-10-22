// A window whose page is a view among the Browser's pages rather than under them, so it can go over them (raise) and
// draw its menus and dialogs above a live page (electron/web.ts); a BrowserWindow's own page is always under its views.
import { BaseWindow, type BaseWindowConstructorOptions, type WebContents, WebContentsView, type WebPreferences } from "electron"

export type AppWindowOptions = BaseWindowConstructorOptions & { webPreferences?: WebPreferences }

const byPage = new WeakMap<WebContents, AppWindow>()
const made: ((w: AppWindow) => void)[] = []

export class AppWindow extends BaseWindow {
  /** Its page's view: the bottom of the window's views, or the top while raised. */
  readonly view: WebContentsView
  /** Its page drew its first frame (a BrowserWindow's ready-to-show). */
  readonly ready: Promise<void>

  /** `adopt`: the page window.open made (a pop-out), shown here rather than in a window of Electron's. */
  constructor({ webPreferences, ...options }: AppWindowOptions, adopt?: WebContents) {
    super(options)
    // (an adopted page takes `webPreferences` too: its preload, which Electron leaves out when it doesn't make the window)
    this.view = new WebContentsView(adopt ? { webContents: adopt, webPreferences } : { webPreferences })
    // (see-through where its page paints nothing: a Browser page under it shows there while it's raised)
    this.view.setBackgroundColor("#00000000")
    this.contentView.addChildView(this.view)
    const wc = this.view.webContents
    byPage.set(wc, this)
    const fit = () => { const [width, height] = this.getContentSize(); this.view.setBounds({ x: 0, y: 0, width, height }) }
    fit()
    // (as its content is laid out, not only as it resizes: Linux shows its menu bar again after full screen with no resize)
    this.contentView.on("bounds-changed", fit)
    this.ready = new Promise((ok) => wc.once("did-finish-load", () => ok()))
    // (a window's page has the keyboard as it's focused, unless a page of its own over it does)
    this.on("focus", () => { if (!wc.isDestroyed() && !this.contentView.children.some((v) => v instanceof WebContentsView && v.webContents.isFocused())) wc.focus() })
    this.on("closed", () => { if (!wc.isDestroyed()) wc.close() })
    // (its page closed itself, a pop-out's window.close(): the window goes too)
    wc.once("destroyed", () => { if (!this.isDestroyed()) this.close() })
    for (const fn of made) fn(this)
  }

  get webContents() { return this.view.webContents }
  loadURL(url: string) { return this.webContents.loadURL(url) }
  loadFile(file: string) { return this.webContents.loadFile(file) }

  static fromWebContents(wc: WebContents) { const w = byPage.get(wc); return w && !w.isDestroyed() ? w : null }
  static getAllWindows() { return BaseWindow.getAllWindows().filter((w): w is AppWindow => w instanceof AppWindow) }
  static fromId(id: number) { const w = BaseWindow.fromId(id); return w instanceof AppWindow ? w : null }
  static getFocusedWindow() { const w = BaseWindow.getFocusedWindow(); return w instanceof AppWindow ? w : null }
  /** Each window as it's made (and every one made before). */
  static each(fn: (w: AppWindow) => void) { made.push(fn); for (const w of AppWindow.getAllWindows()) fn(w) }
}
