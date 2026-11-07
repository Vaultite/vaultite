// Every window the companion draws over the screen (its cursors and ink, its box, its cards, what comes next) is made
// here: over every Space and full screen app, never in Mission Control, and kept out of screen shares and recordings.
import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron"

/** Whether its windows stay out of screen shares, recordings and screenshots (the companion's `hide_from_shares`). */
let hidden = true
const made = new Set<BrowserWindow>()

/** A see-through, frameless panel over everything (`level`: its place among the others at the screen saver's level);
 *  `o` adds to or overrides the defaults. Shown by its maker (`showInactive`). */
export function overlayWindow(o: BrowserWindowConstructorOptions, level = 0) {
  const w = new BrowserWindow({ transparent: true, frame: false, hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, show: false, type: "panel", backgroundColor: "#00000000", ...o })
  // (skipTransformProcessType: else macOS takes the app out of the Dock for it)
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  // (not a window to the user: Mission Control leaves it out)
  w.setHiddenInMissionControl(true)
  w.setAlwaysOnTop(true, "screen-saver", level)
  // (sharingType none: macOS leaves it out of every capture, ScreenCaptureKit's too; the user still sees it)
  w.setContentProtection(hidden)
  made.add(w)
  w.once("closed", () => made.delete(w))
  return w
}

/** Its windows hidden from shares or not, those up now too. */
export function hideFromShares(on: boolean) {
  if (on === hidden) return
  hidden = on
  for (const w of made) if (!w.isDestroyed()) w.setContentProtection(on)
}
export const hiddenFromShares = () => hidden
/** Every one there now (its cursors, cards, box, the island, take-over's border), by window number: what the
 *  companion's own pictures and recordings leave out, whether or not they're hidden from shares. */
export const overlayNumbers = () => [...made].filter((w) => !w.isDestroyed()).map((w) => Number(/^window:(\d+)/.exec(w.getMediaSourceId())?.[1] ?? 0)).filter((n) => n > 0)
