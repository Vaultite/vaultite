import { useSyncExternalStore } from "react"

const ua = typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent

/** A Mac, iPhone or iPad: ⌘ is the app's Mod key. */
export const isMac = /Mac|iPhone|iPad/.test(ua)
/** A Linux computer (not Android). */
export const isLinux = /Linux/.test(ua) && !/Android/.test(typeof navigator === "undefined" ? "" : navigator.userAgent)
/** A Windows computer. */
export const isWindows = /Win/.test(ua)

/** Showing a file where it is: Finder on a Mac, Explorer on Windows, the file manager elsewhere. */
export const revealLabel = isMac ? "Reveal in Finder" : isWindows ? "Show in Explorer" : "Show in folder"
/** The same for a toast's action, on something just saved. */
export const showLabel = isMac ? "Show in Finder" : isWindows ? "Show in Explorer" : "Show in folder"
/** The app's Mod key in words, for "⌘-click" / "Ctrl-click". */
export const modKey = isMac ? "⌘" : "Ctrl"

const GLYPH: Record<string, string> = { "⌃": "Ctrl", "⌘": "Ctrl", "⌥": "Alt", "⇧": "Shift" }
/** A Mac's key glyphs in text (a manifest's "⌥⌘F", "⌘-click") as this computer names them: "Ctrl+Alt+F", "Ctrl-click". */
export const keysText = (s: string, mac = isMac) => mac ? s : s.replace(/([⌃⌘⌥⇧]+)(?=([^\s\-.,;:)]?))/g, (g, _m, next: string) => {
  const names = [...new Set([...g].map((c) => GLYPH[c]))].sort((a, b) => ["Ctrl", "Alt", "Shift"].indexOf(a) - ["Ctrl", "Alt", "Shift"].indexOf(b))
  return names.join("+") + (next ? "+" : "")
})

const DESKTOP = "(min-width: 768px)"
/** A computer's width (the desktop's panes), not a phone's. */
export const isDesktop = () => matchMedia(DESKTOP).matches
/** isDesktop that follows the window: a phone's width and a computer's swap as it's resized. */
export const useDesktop = () => useSyncExternalStore((f) => { const m = matchMedia(DESKTOP); m.addEventListener("change", f); return () => m.removeEventListener("change", f) }, isDesktop)

let measuredAt = 0
const probe = () => {
  const el = document.createElement("div")
  el.style.cssText = "position:fixed;top:-200px;width:100px;height:100px;overflow:scroll;visibility:hidden"
  return el
}
function measureScrollbars(again = false) {
  if (!again && measuredAt === devicePixelRatio) return
  measuredAt = devicePixelRatio
  const html = document.documentElement
  // ::-webkit-scrollbar rules don't reach into a shadow root: the system's own bar
  const host = html.appendChild(document.createElement("div")), native = host.attachShadow({ mode: "open" }).appendChild(probe())
  const classic = native.offsetWidth > native.clientWidth
  host.remove()
  if (classic !== html.hasAttribute("data-classic-scrollbars")) html.toggleAttribute("data-classic-scrollbars", classic)
  let room = "0px"
  if (classic) { const ours = html.appendChild(probe()); room = `${ours.offsetWidth - ours.clientWidth}px`; ours.remove() }
  if (html.style.getPropertyValue("--scrollbar-room") !== room) html.style.setProperty("--scrollbar-room", room)
  if (classic) addEventListener("scroll", scrolled, { capture: true, passive: true })
  else removeEventListener("scroll", scrolled, { capture: true })
}
const scrolling = new Map<Element, number>()
function scrolled(e: Event) {
  const el = e.target
  if (!(el instanceof Element)) return
  const was = scrolling.get(el)
  if (was) clearTimeout(was)
  else el.setAttribute("data-scrolling", "")
  scrolling.set(el, window.setTimeout(() => { scrolling.delete(el); el.removeAttribute("data-scrolling") }, 1000))
}
if (typeof document !== "undefined" && typeof devicePixelRatio === "number") {
  measureScrollbars()
  addEventListener("resize", () => measureScrollbars())
  // macOS's "Show scroll bars", or a mouse plugged in, changes them while the app runs
  addEventListener("focus", () => measureScrollbars(true))
}
