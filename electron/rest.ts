import { ipcMain } from "electron"
import type { AppWindow } from "./appwindow.ts"

export type Rest = typeof import("./mainrest.ts")
let loaded: Rest | null = null, take: (r: Rest) => void = () => {}
export const rest = new Promise<Rest>((ok) => { take = ok })
export const restNow = () => loaded
export function restIn(r: Rest) {
  loaded = r
  take(r)
}
ipcMain.handle("app:loaded", async () => { await rest })

const alive = (win: AppWindow, fn: (r: Rest) => void) => void rest.then((r) => { if (!win.isDestroyed()) fn(r) })
export const webWindow = (win: AppWindow) => alive(win, (r) => r.webWindow(win))
export const appsWindow = (win: AppWindow) => alive(win, (r) => r.appsWindow(win))
export const checkInstalled = (w: Parameters<Rest["checkInstalled"]>[0]) => void rest.then((r) => r.checkInstalled(w))
