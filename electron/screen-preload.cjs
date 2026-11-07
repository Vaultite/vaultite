// The overlay's page (web/screen.html, electron/overlay.ts): what to draw, and what the user clicks there (a bubble, the
// pill); and a cursor's conversation, its own window.
const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("vaultiteScreen", {
  on(fn) {
    const h = (_e, m) => fn(m)
    ipcRenderer.on("vaultite:screen", h)
    return () => { ipcRenderer.removeListener("vaultite:screen", h) }
  },
  // (only the places changed: the pointer, a window moved)
  onAt(fn) {
    const h = (_e, m) => fn(m)
    ipcRenderer.on("vaultite:screen-at", h)
    return () => { ipcRenderer.removeListener("vaultite:screen-at", h) }
  },
  // (the pointer and the companion's home beside it, while it rides with it: [x, y, homeX, homeY] in this display's points)
  onPointer(fn) {
    const h = (_e, m) => fn(m)
    ipcRenderer.on("vaultite:pointer", h)
    return () => { ipcRenderer.removeListener("vaultite:pointer", h) }
  },
  // (a soft cue to play: listen, sent, answer)
  onCue(fn) {
    const h = (_e, m) => fn(m)
    ipcRenderer.on("vaultite:cue", h)
    return () => { ipcRenderer.removeListener("vaultite:cue", h) }
  },
  // (where the companion is headed or rests while it points, [x, y] here; null: beside the pointer)
  pilot: (to) => ipcRenderer.send("screen:pilot", to),
  grab: (on) => ipcRenderer.send("screen:grab", !!on),
  open: (name, x, y) => ipcRenderer.send("screen:open", { name, x, y }),
  stop: () => ipcRenderer.send("screen:stop"),
  // (the user's box: moved or resized here, in this display's points; a button on it pressed)
  region: (r) => ipcRenderer.send("screen:region", r),
  regionAct: (what) => ipcRenderer.send("screen:region-act", what),
  // (the companion's drawings: this display's, and what the user presses on them)
  draw: {
    on(fn) {
      const h = (_e, m) => fn(m)
      ipcRenderer.on("vaultite:draw", h)
      return () => { ipcRenderer.removeListener("vaultite:draw", h) }
    },
    act: (a) => ipcRenderer.send("screen:draw-act", a),
  },
  // (the sessions by the notch and a knock's line: screen.html#island)
  island: {
    on(fn) {
      const h = (_e, m) => fn(m)
      ipcRenderer.on("vaultite:island", h)
      return () => { ipcRenderer.removeListener("vaultite:island", h) }
    },
    grab: (on) => ipcRenderer.send("island:grab", !!on),
    act: (act, id, mute) => ipcRenderer.send("island:act", { act, id, mute: mute === true }),
    // (where each session shows in it, in its points: a Talk key held over one talks to it)
    faces: (list) => ipcRenderer.send("island:faces", list),
  },
  // (a cursor's conversation, its own window: screen.html#panel)
  panel: {
    on(fn) {
      const h = (_e, m) => fn(m)
      ipcRenderer.on("vaultite:panel", h)
      return () => { ipcRenderer.removeListener("vaultite:panel", h) }
    },
    size: (h) => ipcRenderer.send("panel:size", h),
    send: (text) => ipcRenderer.send("panel:send", text),
    // (`esc`: Esc in it, which ends its exchange; its close leaves what it says going on)
    close: (esc) => ipcRenderer.send("panel:close", esc === true),
    mic: () => ipcRenderer.send("panel:mic"),
    play: () => ipcRenderer.send("panel:play"),
    more: (x, y) => ipcRenderer.send("panel:more", { x, y }),
  },
})
