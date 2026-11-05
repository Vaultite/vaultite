// Keep window on top (any of the app's windows), as a video call's pop-out: over other apps' windows, on every Space and
// beside a full screen one; not full screen itself meanwhile (one that joins others' Spaces can't be one).
import { BaseWindow } from "electron"

const MAC = process.platform === "darwin"
const kept = new WeakSet<BaseWindow>()
const subs = new Set<() => void>()
const told = () => { for (const f of subs) f() }

/** Window `w` kept on top of the others, or not. Leaves full screen first. */
export function setOnTop(w: BaseWindow, on: boolean) {
  if (w.isDestroyed() || on === kept.has(w)) return
  if (on) kept.add(w); else kept.delete(w)
  const apply = () => {
    if (w.isDestroyed()) return
    const now = kept.has(w)
    w.setAlwaysOnTop(now, "floating")
    // (skipTransformProcessType: else macOS takes the app out of the Dock and the menu bar meanwhile)
    if (MAC) { w.setFullScreenable(!now); w.setVisibleOnAllWorkspaces(now, { visibleOnFullScreen: now, skipTransformProcessType: true }) }
  }
  if (on && w.isFullScreen()) { w.once("leave-full-screen", apply); w.setFullScreen(false) } else apply()
  told()
}
export const isOnTop = (w: BaseWindow | null) => !!w && kept.has(w)
/** Run `fn` as a window is kept on top or let go, or another comes to the front (the menu bar's check follows it). */
export function onTopChanged(fn: () => void) { subs.add(fn); return () => { subs.delete(fn) } }
/** Window `w` tells as it comes to the front (one that isn't the app's own: a player, a page's popup). */
export const watchFocus = (w: BaseWindow) => { w.on("focus", told) }
