import { ipcMain } from "electron"
import { AppWindow } from "./appwindow.ts"
import { canvasOf, setCanvasHandler } from "./browser/engine.ts"
import { type Page, pageOf, pages, sendState, shows } from "./webbase.ts"

const EMPTY = `(() => { const b = document.body; return !document.querySelector("script") && (!b || (!b.children.length && !b.textContent.trim())) })()`
export async function emptyError(p: Page, status: number) {
  const wc = p.view.webContents, url = wc.getURL()
  const empty = await wc.executeJavaScriptInIsolatedWorld(1005, [{ code: EMPTY }]).catch(() => false)
  if (empty !== true || wc.isDestroyed() || wc.isLoading() || wc.getURL() !== url || p.status !== status || p.error) return
  p.error = `HTTP ERROR ${status}`
  sendState(p)
}

export const looks = new WeakMap<AppWindow, string>()
export const lookOf = (win: AppWindow) => looks.get(win) ?? win.getBackgroundColor()
export function painted(p: Page) {
  if (!p.fresh || p.view.webContents.isDestroyed()) return
  p.fresh = false
  p.view.setBackgroundColor(canvasOf(p.id))
  sendState(p)
}
setCanvasHandler((id) => { const p = pages.get(id); if (p && !p.fresh && !p.view.webContents.isDestroyed()) p.view.setBackgroundColor(canvasOf(id)) })
ipcMain.on("vaultite:web:painted", (e) => { const p = pageOf(e.sender); if (p && shows(e.sender.getURL())) painted(p) })
