import { useSyncExternalStore } from "react"

// Which computer the page runs on, asked once: keys, labels and gestures differ on a Mac (⌘, Finder, ⌃-click).
const ua = typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent

/** A Mac, iPhone or iPad: ⌘ is the app's Mod key. */
export const isMac = /Mac|iPhone|iPad/.test(ua)
/** A Linux computer (not Android). */
export const isLinux = /Linux/.test(ua) && !/Android/.test(typeof navigator === "undefined" ? "" : navigator.userAgent)

/** Showing a file where it is: Finder on a Mac, the file manager elsewhere. */
export const revealLabel = isMac ? "Reveal in Finder" : "Show in folder"
/** The same for a toast's action, on something just saved. */
export const showLabel = isMac ? "Show in Finder" : "Show in folder"
/** The app's Mod key in words, for "⌘-click" / "Ctrl-click". */
export const modKey = isMac ? "⌘" : "Ctrl"

const DESKTOP = "(min-width: 768px)"
/** A computer's width (the desktop's panes), not a phone's. */
export const isDesktop = () => matchMedia(DESKTOP).matches
/** isDesktop that follows the window: a phone's width and a computer's swap as it's resized. */
export const useDesktop = () => useSyncExternalStore((f) => { const m = matchMedia(DESKTOP); m.addEventListener("change", f); return () => m.removeEventListener("change", f) }, isDesktop)
