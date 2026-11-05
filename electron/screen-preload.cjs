// The overlay's page (web/screen.html, electron/overlay.ts): what to draw, and what the user does to the cursor; and a
// cursor's conversation, its own window.
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
  home: (name) => ipcRenderer.send("screen:home", name),
  menu: (name, x, y) => ipcRenderer.send("screen:menu", { name, x, y }),
  open: (name, x, y) => ipcRenderer.send("screen:open", { name, x, y }),
  stop: () => ipcRenderer.send("screen:stop"),
  // (a cursor's conversation, its own window: screen.html#panel)
  panel: {
    on(fn) {
      const h = (_e, m) => fn(m)
      ipcRenderer.on("vaultite:panel", h)
      return () => { ipcRenderer.removeListener("vaultite:panel", h) }
    },
    size: (h) => ipcRenderer.send("panel:size", h),
    send: (text) => ipcRenderer.send("panel:send", text),
    close: () => ipcRenderer.send("panel:close"),
    mic: () => ipcRenderer.send("panel:mic"),
    more: (x, y) => ipcRenderer.send("panel:more", { x, y }),
  },
})
