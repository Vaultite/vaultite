// A window whose page is a view among the Browser's pages: a BrowserWindow's own page is always under its views.
import { BaseWindow, type BaseWindowConstructorOptions, type WebContents, WebContentsView, type WebPreferences } from "electron"

export type AppWindowOptions = BaseWindowConstructorOptions & { webPreferences?: WebPreferences }

const byPage = new WeakMap<WebContents, AppWindow>()
const made: ((w: AppWindow) => void)[] = []

export class AppWindow extends BaseWindow {
  readonly view: WebContentsView
  readonly ready: Promise<void>

  constructor({ webPreferences, ...options }: AppWindowOptions, adopt?: WebContents) {
    super({ ...options, show: false })
    // (Electron leaves the preload out of a page whose window it didn't make)
    this.view = new WebContentsView(adopt ? { webContents: adopt, webPreferences } : { webPreferences })
    this.view.setBackgroundColor("#00000000")
    this.contentView.addChildView(this.view)
    const wc = this.view.webContents
    byPage.set(wc, this)
    const fit = () => { const [width, height] = this.getContentSize(); this.view.setBounds({ x: 0, y: 0, width, height }) }
    fit()
    // (Linux shows its menu bar again after full screen with no resize)
    this.contentView.on("bounds-changed", fit)
    this.ready = new Promise((ok) => wc.once("did-finish-load", () => ok()))
    this.on("focus", () => { if (!wc.isDestroyed() && !this.contentView.children.some((v) => v instanceof WebContentsView && v.webContents.isFocused())) wc.focus() })
    this.on("closed", () => { if (!wc.isDestroyed()) wc.close() })
    wc.once("destroyed", () => { if (!this.isDestroyed()) this.close() })
    for (const fn of made) fn(this)
    if (options.show !== false) this.show()
  }

  get webContents() { return this.view.webContents }
  loadURL(url: string) { return this.webContents.loadURL(url) }
  loadFile(file: string) { return this.webContents.loadFile(file) }

  static fromWebContents(wc: WebContents) { const w = byPage.get(wc); return w && !w.isDestroyed() ? w : null }
  static getAllWindows() { return BaseWindow.getAllWindows().filter((w): w is AppWindow => w instanceof AppWindow) }
  static getFocusedWindow() { const w = BaseWindow.getFocusedWindow(); return w instanceof AppWindow ? w : null }
  static each(fn: (w: AppWindow) => void) { made.push(fn); for (const w of AppWindow.getAllWindows()) fn(w) }
}
