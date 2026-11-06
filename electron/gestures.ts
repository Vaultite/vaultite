// A Mac's pinch over a page the window's page is raised over goes to the page (gestures.m): which windows pass it now.
import { app, type BaseWindow } from "electron"
import path from "node:path"
import { macAddon, type MacAddon } from "./macaddons.ts"

let addon: Promise<MacAddon | null> | null = null
/** Each window's number (its CGWindowID, as macOS's events name it). */
const ids = new WeakMap<BaseWindow, number>()

/** A pinch in `win` goes to the page under the pointer (on), or to what macOS gives it to (off). */
export function passPinch(win: BaseWindow, on: boolean) {
  if (win.isDestroyed()) return
  addon ??= macAddon("gestures", path.join(app.getPath("userData"), "bin"))
    .catch((e) => { console.warn(`gestures: a pinch over a covered page stays the window's (${(e as Error).message})`); return null })
  const window = idOf(win)
  void addon.then((g) => g?.call({ cmd: "pass", window, on }))
}

function idOf(win: BaseWindow) {
  let id = ids.get(win)
  if (id === undefined) {
    const n = Number(win.getMediaSourceId().split(":")[1])
    ids.set(win, id = n)
    win.once("closed", () => void addon?.then((g) => g?.call({ cmd: "pass", window: n, on: false })))
  }
  return id
}
