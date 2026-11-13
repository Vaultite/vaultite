import { BaseWindow, powerSaveBlocker } from "electron"
import { type Page, pages, pagesChanged, sendState } from "./webbase.ts"
import { addPage } from "./webstack.ts"
import { fit, move } from "./webspot.ts"

// ---------- players: a call's window picker finds one by its title ----------

let kit: typeof import("./player.ts") | undefined, pageKit: typeof import("./playerpage.ts") | undefined
export const playerKit = async () => { await stripKit(); pageKit ??= await import("./playerpage.ts"); return (kit ??= await import("./player.ts")) }

export let strips: typeof import("./topstrip.ts") | undefined
export const stripKit = async () => (strips ??= await import("./topstrip.ts"))
let napBlock: number | null = null
const players = () => [...pages.values()].some((p) => p.player)

export function leaveFull(p: Page) {
  if (!p.view.webContents.isDestroyed()) void p.view.webContents.executeJavaScriptInIsolatedWorld(1004, [{ code: "document.fullscreenElement && void document.exitFullscreen().catch(() => {})" }]).catch(() => {})
}

export async function toPlayer(p: Page, fullScreen: boolean) {
  if (p.player) { if (!p.player.isDestroyed()) { p.player.show(); p.player.focus() } return }
  const wc = p.view.webContents
  if (wc.isDestroyed() || p.win.isDestroyed()) return
  if (p.full) leaveFull(p)
  const k = await playerKit(), pg = pageKit!
  const [css, found] = await Promise.all([wc.insertCSS(pg.FILL_CSS, { cssOrigin: "user" }).catch(() => undefined),
    wc.executeJavaScriptInIsolatedWorld(1004, [{ code: pg.FILL }], true).catch(() => null), wc.executeJavaScript(pg.FULL_GUARD).catch(() => {})])
  const aspect = typeof found === "number" && found > 0.2 && found < 5 ? found : null
  if (p.player || wc.isDestroyed() || p.win.isDestroyed() || !pages.has(p.id)) { if (css && !p.player) void wc.removeInsertedCSS(css).catch(() => {}); return }
  const w = k.playerWindow(k.placeFor(aspect ?? 16 / 9, p.win.getBounds()), () => [{ label: "Back to its tab", click: () => fromPlayer(p, true) }])
  p.player = w
  p.fillCss = css
  if (aspect) w.setAspectRatio(aspect)
  p.win.contentView.removeChildView(p.view)
  w.contentView.addChildView(p.view)
  wc.setBackgroundThrottling(false)
  // (as its content is laid out: on Linux its menu bar comes and goes with no resize)
  w.contentView.on("bounds-changed", () => fit(p))
  w.on("leave-full-screen", () => { if (p.full) leaveFull(p) })
  w.on("close", () => fromPlayer(p, true))
  fit(p)
  w.show()
  if (fullScreen) w.setFullScreen(true)
  wc.focus()
  napBlock ??= powerSaveBlocker.start("prevent-app-suspension")
  sendState(p)
  pagesChanged(p.win)
  void follow(p, w)
}

async function follow(p: Page, w: BaseWindow) {
  while (p.player === w) {
    const a = await p.view.webContents.executeJavaScriptInIsolatedWorld(1004, [{ code: "window.__vaultitePlayer?.next()" }]).catch(() => undefined)
    if (p.player !== w || typeof a !== "number" || !(a > 0.2 && a < 5)) return
    kit?.setAspect(w, a)
  }
}

export function fromPlayer(p: Page, user = false) {
  const w = p.player
  if (!w) return
  p.player = undefined
  // (none once the page is gone: `end` from its destroyed, where a throw would skip `unload`'s listener and hang a quit)
  const wc = p.view.webContents
  if (wc && !wc.isDestroyed()) {
    wc.setBackgroundThrottling(!p.drawn)
    if (pageKit) void wc.executeJavaScriptInIsolatedWorld(1004, [{ code: pageKit.UNFILL }]).catch(() => {})
    if (p.fillCss) void wc.removeInsertedCSS(p.fillCss).catch(() => {})
  }
  p.fillCss = undefined
  if (!w.isDestroyed()) { w.contentView.removeChildView(p.view); setImmediate(() => { if (!w.isDestroyed()) w.close() }) }
  if (pages.has(p.id) && !p.win.isDestroyed()) {
    move(p, { type: "hide" })
    p.want = null
    addPage(p.win, p.view)
    if (p.drawn) move(p, { type: "park", now: Date.now() })
    sendState(p)
    pagesChanged(p.win)
    if (user) { p.win.show(); p.win.focus() }
  }
  if (napBlock !== null && !players()) { powerSaveBlocker.stop(napBlock); napBlock = null }
}
