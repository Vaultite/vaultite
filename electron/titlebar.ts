import { type BaseWindowConstructorOptions, nativeTheme } from "electron"
import { AppWindow } from "./appwindow.ts"
import { MAC, WIN } from "./mainbase.ts"

export const LIGHTS = { x: 16, y: 14 }
// macOS 26 draws a 14pt circle filling its frame, 23pt apart; before it, a 12pt circle in a 14×16 frame, 20pt apart.
export const BUTTONS = MAC && Number(process.getSystemVersion().split(".")[0]) >= 26
  ? { width: 14, height: 14, size: 14, pitch: 23 } : { width: 14, height: 16, size: 12, pitch: 20 }
export const CONTROLS_HEIGHT = 40
export const chrome = (): BaseWindowConstructorOptions => WIN
  ? { titleBarStyle: "hidden", titleBarOverlay: { color: background(), symbolColor: nativeTheme.shouldUseDarkColors ? "#ffffff" : "#000000", height: CONTROLS_HEIGHT } }
  : { titleBarStyle: "hiddenInset", trafficLightPosition: LIGHTS }

export const background = () => (nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ffffff")
const lightsOf = new WeakMap<AppWindow, { x: number; y: number } | null>()
export function setLights(w: AppWindow, at: { x: number; y: number } | null) {
  lightsOf.set(w, at)
  applyLights(w)
}
export function applyLights(w: AppWindow) {
  const at = lightsOf.get(w)
  if (at === undefined || w.isDestroyed()) return
  const shown = !!at && (bare.get(w)?.lightsShown(w) ?? true)
  if (at) w.setWindowButtonPosition(at)
  w.setWindowButtonVisibility(shown)
  // (shown again, the Mac lays them out where they sit by default)
  if (shown) w.setWindowButtonPosition(at)
}
export const bare = new WeakMap<AppWindow, typeof import("./topstrip.ts")>()
