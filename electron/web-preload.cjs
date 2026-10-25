// A web page's first paint, told by its main frame (electron/web.ts): a new page shows the app's colour till then rather
// than white; and its window's size as a browser tab's. Sandboxed, no Node, in the isolated world.
"use strict"
const { contextBridge, ipcRenderer } = require("electron")

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
}
