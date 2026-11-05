// The overlay's page (web/screen.html, electron/overlay.ts): what to draw, and what the user does to the cursor.
const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("vaultiteScreen", {
  on(fn) {
    const h = (_e, m) => fn(m)
    ipcRenderer.on("vaultite:screen", h)
    return () => { ipcRenderer.removeListener("vaultite:screen", h) }
  },
  // (only the places changed: the pointer's trail, a window moved)
  onAt(fn) {
    const h = (_e, m) => fn(m)
    ipcRenderer.on("vaultite:screen-at", h)
    return () => { ipcRenderer.removeListener("vaultite:screen-at", h) }
  },
  grab: (on) => ipcRenderer.send("screen:grab", !!on),
  drop: (name, x, y) => ipcRenderer.send("screen:drop", { name, x, y }),
  dismiss: (id) => ipcRenderer.send("screen:dismiss", id),
  stop: () => ipcRenderer.send("screen:stop"),
})
