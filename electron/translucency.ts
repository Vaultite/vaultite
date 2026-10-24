// Translucent windows (appearance `translucent`): the system's blur under the window's page (a Mac's vibrancy, Windows
// 11's Mica). The page draws its chrome see-through only while told it's on here, so it's never see-through over nothing.
import { nativeTheme } from "electron"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { AppWindow } from "./appwindow.ts"

/** Whether a window is translucent now, and why not when it's asked for but solid (web/src/core/desktop.ts). */
export type Translucency = { on: boolean; why?: "system" | "reduced" | "apps" | "reopen" }

const MAC = process.platform === "darwin", WIN = process.platform === "win32"
// (Mica is Windows 11 22H2's and later, build 22621; Linux has no material Electron can ask for)
const SUPPORTED = MAC || (WIN && Number(os.release().split(".")[2]) >= 22621)
/** The windows whose page asked for it, those showing another app's window in a tab (its hole would be blurred over),
 *  and what each was told last. */
const wanted = new WeakSet<AppWindow>(), covered = new WeakSet<AppWindow>()
/** A Mac's windows made transparent: an opaque one draws its page over its own colour, never over the blur. */
const clear = new WeakSet<AppWindow>()
const told = new WeakMap<AppWindow, boolean>(), solid = new WeakMap<AppWindow, string>()
const asking = new Set<AppWindow>()

function stateOf(win: AppWindow): Translucency {
  if (!wanted.has(win)) return { on: false }
  if (!SUPPORTED) return { on: false, why: "system" }
  if (nativeTheme.prefersReducedTransparency) return { on: false, why: "reduced" }
  if (MAC && !clear.has(win)) return { on: false, why: "reopen" }
  return covered.has(win) ? { on: false, why: "apps" } : { on: true }
}

function material(win: AppWindow, on: boolean) {
  if (win.isDestroyed() || !SUPPORTED) return
  if (MAC) return win.setVibrancy(on ? "sidebar" : null)
  if (on && !solid.has(win)) solid.set(win, win.getBackgroundColor())
  win.setBackgroundMaterial(on ? "mica" : "none")
  win.setBackgroundColor(on ? "#00000000" : solid.get(win) ?? "#ffffff")
}

/** Puts the window's material in step and tells its page: on, the blur first; off, the page first (solid a moment
 *  later), so its chrome is never see-through over the window's plain colour. */
function update(win: AppWindow, tell = true) {
  if (win.isDestroyed()) return { on: false }
  const s = stateOf(win)
  if (told.get(win) !== s.on) {
    told.set(win, s.on)
    if (s.on) material(win, true)
    else setTimeout(() => { if (!win.isDestroyed() && told.get(win) === false) material(win, false) }, 120)
  }
  if (tell) win.webContents.send("vaultite:translucent", s)
  return s
}

/** A window's page asking for it (`window:translucent`) or not: its state now. */
export function setTranslucent(win: AppWindow, on: boolean) {
  if (!asking.has(win)) { asking.add(win); win.once("closed", () => asking.delete(win)) }
  if (on) wanted.add(win)
  else wanted.delete(win)
  return update(win, false)
}

/** Another app's window shows in one of the window's tabs (electron/apps.ts), or no longer does. */
export function coverTranslucent(win: AppWindow, on: boolean) {
  if (covered.has(win) === on) return
  if (on) covered.add(win)
  else covered.delete(win)
  if (wanted.has(win)) update(win)
}

/** Whether a vault's windows open translucent (its appearance.json): a Mac's are then made transparent. */
export function translucentAt(vault: string) {
  try {
    return SUPPORTED && JSON.parse(fs.readFileSync(path.join(vault, ".vaultite", "appearance.json"), "utf8")).translucent === true
  } catch { return false } // (none, or not JSON: the page asks)
}

/** A new window, made `transparent` or not: translucent from the start when `on`, before its page has loaded. */
export function translucentWindow(win: AppWindow, transparent: boolean, on: boolean) {
  if (transparent) clear.add(win)
  if (on) setTranslucent(win, true)
}

// Reduce transparency turned on or off in the system's settings.
nativeTheme.on("updated", () => { for (const w of asking) if (wanted.has(w)) update(w) })
