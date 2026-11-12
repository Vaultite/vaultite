// VAULTITE_QUIET=1 (web/qa's desktop scripts): windows draw as usual but are never seen or felt (transparent,
// click-through, never focused, no Dock icon), so a test never pops up over the user's work.
import { type BaseWindow, type Rectangle, screen, type WebContents } from "electron"

export const QUIET = !!process.env.VAULTITE_QUIET

/** What a quiet copy was asked to show and didn't, for the scripts: on globalThis, so this file keeps no state (the
 *  menu-bar helper reloaded from another code root runs its own copy of it). */
const shownInstead = () => ((globalThis as { vaultiteQuiet?: { lookUps: number } }).vaultiteQuiet ??= { lookUps: 0 })

/** Page `wc` quiet, under VAULTITE_QUIET: Look up's popover, the system's over the user's work, only counted. */
export function quietPage(wc: WebContents) {
  if (!QUIET) return
  wc.showDefinitionForSelection = () => { shownInstead().lookUps++ }
}

/** Window `w` takes the pointer, or lets it through to what's under it (its page still hears the moves). The one way a
 *  window's pointer is set: a quiet copy never takes it nor hears the user's moves. */
export function takePointer(w: BaseWindow, on: boolean) {
  if (!w.isDestroyed()) w.setIgnoreMouseEvents(QUIET || !on, { forward: !QUIET })
}

/** Window `w` (its page `page`) quiet, under VAULTITE_QUIET. */
export function quiet(w: BaseWindow, page?: WebContents) {
  if (!QUIET) return
  w.setOpacity(process.platform === "linux" ? 0.01 : 0) // (X11 stops painting a window at 0: screenshots of it then never come)
  takePointer(w, false)
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
