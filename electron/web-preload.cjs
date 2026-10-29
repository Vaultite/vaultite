// A web page's first paint, told by its main frame (electron/web.ts): a new page shows the app's colour till then rather
// than white; its window's size as a browser tab's; ⌥-click on a link; and, from every frame, the browser's keys it left
// alone, the mouse's back and forward buttons and typed input it holds. Sandboxed, no Node, in the isolated world.
"use strict"
const { contextBridge, ipcRenderer } = require("electron")

// ⌘F, ⌘G, ⇧⌘G and zoom: the page's first (a doc's own find), the app's once every listener let it be (web.ts BROWSER_KEYS).
const MAC = process.platform === "darwin"
addEventListener("keydown", (e) => {
  if ((MAC ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) || e.altKey) return
  const c = e.code
  if (!(c === "KeyF" || c === "KeyG" || c === "Equal" || c === "Minus" || c === "Digit0")) return
  setTimeout(() => {
    if (!e.defaultPrevented) ipcRenderer.send("vaultite:web:key", { key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey })
  })
}, true)
// (a page never keeps them, as in Chrome)
addEventListener("mouseup", (e) => { if (e.button === 3 || e.button === 4) ipcRenderer.send("vaultite:web:nav", e.button === 3 ? -1 : 1) }, true)

// Typed input still in its fields, unsent: told as it starts and ends (web.ts), so the tab isn't archived meanwhile. Only
// what the user typed (trusted input), and only while it's still there (a chat box cleared after Enter isn't).
const typedIn = new Set()
let typed = false
const filled = (el) => el.isConnected && (el.isContentEditable ? !!el.textContent.trim() : !!el.value && el.type !== "hidden")
const recheck = () => {
  for (const el of typedIn) if (!filled(el)) typedIn.delete(el)
  if (typed === typedIn.size > 0) return
  typed = !typed
  ipcRenderer.send("vaultite:web:typed", typed)
}
addEventListener("input", (e) => {
  const el = e.composedPath()[0]
  if (!e.isTrusted || !(el instanceof HTMLElement) || !(el.isContentEditable || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return
  if (el instanceof HTMLInputElement && /^(checkbox|radio|range|color|file|button|submit)$/.test(el.type)) return
  typedIn.add(el.isContentEditable ? el.closest("[contenteditable]:not([contenteditable=false])") ?? el : el)
  recheck()
}, true)
addEventListener("submit", (e) => { for (const el of typedIn) if (e.target instanceof HTMLFormElement && e.target.contains(el)) typedIn.delete(el); setTimeout(recheck) }, true)
for (const ev of ["focusout", "keyup"]) addEventListener(ev, () => { if (typedIn.size) setTimeout(recheck, 50) }, true)

if (process.isMainFrame && /^https?:/.test(location.href)) {
  try {
    new PerformanceObserver((_list, o) => { o.disconnect(); ipcRenderer.send("vaultite:web:painted") }).observe({ type: "paint", buffered: true })
  } catch { /* no paint timing: web.ts goes white once it's loaded */ }
  // (the app's sidebars aren't the page's window: sites take a window much wider than the page for DevTools docked open,
  // and Discord then keeps its sign-in only in memory, gone with the tab)
  try {
    contextBridge.executeInMainWorld({ func: () => {
      const size = (name, get) => Object.defineProperty(window, name, { get, set: () => {}, configurable: true, enumerable: true })
      size("outerWidth", () => window.innerWidth)
      size("outerHeight", () => window.innerHeight + 85)
    } })
  } catch { /* the window's own sizes */ }
  // ⌥-click on a link: Glance, when that plugin is on (web.ts tells), rather than Chromium's download of it.
  let glance = false
  ipcRenderer.on("vaultite:web:glance", (_e, on) => { glance = on === true })
  addEventListener("click", (e) => {
    if (!glance || e.button !== 0 || !e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null
    if (!a || !/^https?:/i.test(a.href)) return
    e.preventDefault()
    e.stopImmediatePropagation()
    ipcRenderer.send("vaultite:web:glance", a.href)
  }, true)
}
