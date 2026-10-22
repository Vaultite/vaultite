// A web page's first paint, told by its main frame (electron/web.ts): a new page shows the app's colour till then rather
// than white. Sandboxed, no Node, in the isolated world.
"use strict"
const { ipcRenderer } = require("electron")

if (process.isMainFrame && /^https?:/.test(location.href)) {
  try {
    new PerformanceObserver((_list, o) => { o.disconnect(); ipcRenderer.send("vaultite:web:painted") }).observe({ type: "paint", buffered: true })
  } catch { /* no paint timing: web.ts goes white once it's loaded */ }
}
