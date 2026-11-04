// VAULTITE_QUIET=1 (web/qa's desktop scripts): windows draw as usual but are never seen or felt (transparent,
// click-through, never focused, no Dock icon), so a test never pops up over the user's work.
import { type BaseWindow, type Rectangle, screen, type WebContents } from "electron"

export const QUIET = !!process.env.VAULTITE_QUIET

/** Window `w` (its page `page`) quiet, under VAULTITE_QUIET. */
export function quiet(w: BaseWindow, page?: WebContents) {
  if (!QUIET) return
  w.setOpacity(process.platform === "linux" ? 0.01 : 0) // (X11 stops painting a window at 0: screenshots of it then never come)
  w.setIgnoreMouseEvents(true)
  w.show = () => w.showInactive()
  w.focus = () => {}
  page?.setBackgroundThrottling(false)
  // (a real full screen takes a Space of the user's screen: it fills its display instead, telling it as one)
  let normal: Rectangle | null = null
  w.isFullScreen = () => !!normal
  w.setFullScreen = (on: boolean) => {
    if (on === !!normal || w.isDestroyed()) return
    if (on) { normal = w.getBounds(); w.setBounds(screen.getDisplayMatching(normal).bounds) } else { const b = normal!; normal = null; w.setBounds(b) }
    w.emit(on ? "enter-full-screen" : "leave-full-screen")
  }
}
