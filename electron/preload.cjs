// The desktop app's bridge into the page (sandboxed, so plain CommonJS): window.vaultite (web/src/core/desktop.ts).
// main.ts checks that the page asking is one of its own windows.
const { contextBridge, ipcRenderer, webUtils } = require("electron")

const MAC = process.platform === "darwin", WIN = process.platform === "win32"
const mark = () => {
  const html = document.documentElement
  if (html) { html.setAttribute("data-electron", ""); html.setAttribute("data-platform", process.platform) }
}
mark()
addEventListener("DOMContentLoaded", mark)
ipcRenderer.on("vaultite:fullscreen", (_e, on) => document.documentElement.toggleAttribute("data-fullscreen", !!on))
ipcRenderer.on("vaultite:key", (_e, on) => document.documentElement.toggleAttribute("data-window-inactive", !on))
// Windows hands a vault window's page the keyboard as if Tab were pressed when it's shown: its first button (the vault
// menu) took it, ringed. Until the user types or clicks, only where text goes keeps it.
if (WIN && location.protocol === "http:") {
  let untouched = true
  const touched = () => { untouched = false }
  addEventListener("keydown", touched, true)
  addEventListener("pointerdown", touched, true)
  addEventListener("focusin", (e) => {
    if (untouched && e.target instanceof HTMLElement && !e.target.matches("input, textarea, select, [contenteditable=true]")) e.target.blur()
  }, true)
}

// Windows' controls (titleBarOverlay) take the colour of the page under them and the height of its title row, as the
// theme, the sidebars and the zoom change; main.ts answers how wide they are, which index.css keeps clear (--window-controls).
if (process.platform === "win32") {
  const hex = (css) => {
    const c = document.createElement("canvas").getContext("2d")
    c.fillStyle = css
    c.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data
    return a < 128 ? null : "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")
  }
  let said = "", timer = 0
  const sync = () => {
    timer = 0
    const html = document.documentElement
    if (!html || !document.body) return
    let color = null
    for (const el of document.elementsFromPoint(innerWidth - 2, 2)) if ((color = hex(getComputedStyle(el).backgroundColor))) break
    color ??= hex(getComputedStyle(document.body).backgroundColor) ?? "#ffffff"
    const symbol = hex(getComputedStyle(document.body).color) ?? "#000000"
    // (a pixel short of the row: its bottom border runs on under them)
    const row = (document.querySelector("[data-titlebar], [data-right-corner] > [role=tablist]")?.getBoundingClientRect().height || 40) - 1
    const now = JSON.stringify([color, symbol, row, innerWidth])
    if (now === said) return
    said = now
    ipcRenderer.invoke("window:controls", { color, symbol, height: row }).then((r) => {
      if (r && Number.isFinite(r.width)) html.style.setProperty("--window-controls", `${r.width}px`)
    }, () => {})
  }
  const soon = () => { if (!timer) timer = setTimeout(sync, 50) }
  addEventListener("DOMContentLoaded", () => {
    new MutationObserver(soon).observe(document.documentElement, { attributes: true })
    new MutationObserver(soon).observe(document.body, { attributes: true, childList: true })
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", soon)
    addEventListener("resize", soon)
    addEventListener("focus", soon)
    // (the app draws its shell a moment after the document loads)
    for (const ms of [0, 300, 1000, 3000]) setTimeout(soon, ms)
  })
}

const call = (name) => (...args) => ipcRenderer.invoke(name, ...args)

contextBridge.exposeInMainWorld("vaultite", {
  desktop: true,
  platform: process.platform,
  vaults: call("vaults:list"),
  openVault: call("vaults:open"),
  createVault: call("vaults:create"),
  removeVault: call("vaults:remove"),
  pickFolder: call("vaults:pick"),
  revealVault: call("vaults:reveal"),
  manageVaults: call("vaults:manage"),
  openSandbox: call("vaults:sandbox"),
  connectServer: call("vaults:connect"),
  setup: call("app:setup"),
  // Set up Vaultite's own window (web/src/onboarding.tsx); the main process answers only that window.
  onboarding: {
    info: call("setup:info"),
    pick: call("setup:pick"),
    choose: call("setup:choose"),
    vau: call("setup:vau"),
    sandbox: call("setup:sandbox"),
    finish: call("setup:finish"),
  },
  welcome: call("app:welcome"),
  computerUse: MAC ? call("app:computer-use") : undefined,
  // (Windows' with forward slashes, as main.ts hands outside files to the page)
  pathOf: (file) => { const p = webUtils.getPathForFile(file); return process.platform === "win32" ? p.replace(/\\/g, "/") : p },
  copyIn: call("files:copy-in"),
  openOutside: call("files:open"),
  pickOutside: call("files:pick"),
  dialogSync: (kind, options) => ipcRenderer.sendSync("dialog:sync", kind, options),
  ready: call("app:ready"),
  restartToUpdate: call("app:update-restart"),
  updates: { get: call("app:updates"), set: call("app:updates-set"), safe: call("app:update-safe") },
  login: MAC || WIN ? { get: call("app:login"), set: call("app:login-set") } : undefined,
  printToPDF: call("print:pdf"),
  revealPdf: call("print:reveal"),
  microphone: call("media:microphone"),
  permission: MAC ? call("app:permission") : undefined,
  notify: call("app:notify"),
  syncMenu: call("menu:sync"),
  // The Dock and other apps' windows (swiftc's helper) are a Mac's only: elsewhere their plugins find nothing.
  dock: MAC ? { set: call("dock:set"), custom: call("dock:custom"), pick: call("dock:pick") } : undefined,
  lookUp: call("text:look-up"),
  learnWord: call("text:learn"),
  capture: call("page:capture"),
  dragGhost: call("drag:ghost"),
  raiseWindow: call("window:raise"),
  lights: call("window:lights"),
  bare: call("window:bare"),
  onTop: call("window:on-top"),
  // The window's chrome see-through to the desktop (electron/translucency.ts): asked for, told whenever it changes.
  translucent: MAC || WIN ? { set: call("window:translucent"), on: (fn) => { ipcRenderer.on("vaultite:translucent", (_e, t) => fn(t)) } } : undefined,
  on: (fn) => { ipcRenderer.on("vaultite", (_e, msg) => fn(msg)) },
  // The whole app's zoom (web/src/core/zoom.ts): asked, stepped, told whenever it changes.
  interfaceSize: { get: call("window:zoom"), step: call("window:zoom-step"), on: (fn) => { ipcRenderer.on("vaultite:zoom", (_e, z) => fn(z)) } },
  // The Browser's pages (electron/web.ts). The pages themselves get no preload: nothing of this reaches them.
  web: {
    open: call("web:open"),
    place: call("web:place"),
    release: call("web:release"),
    close: call("web:close"),
    go: call("web:go"),
    find: call("web:find"),
    player: call("web:player"),
    html: call("web:html"),
    shot: call("web:shot"),
    frame: call("web:frame"),
    titles: call("web:titles"),
    external: call("web:external"),
    keys: call("web:keys"),
    reveal: call("web:reveal"),
    list: call("web:list"),
    sites: call("web:sites"),
    who: call("web:who"),
    forget: call("web:forget"),
    move: call("web:move"),
    seal: call("web:seal"),
    cloud: call("web:cloud"),
    cloudAct: call("web:cloud-act"),
    raise: call("web:raise"),
    look: call("web:look"),
    pointer: call("web:pointer"),
    take: call("web:take"),
    icons: call("web:icons"),
    engine: call("web:engine"),
    on: (fn) => {
      const h = (_e, msg) => fn(msg)
      ipcRenderer.on("vaultite:web", h)
      return () => { ipcRenderer.removeListener("vaultite:web", h) }
    },
  },
  // Dictation into the page (electron/dictation.ts): a Mac's, the helper being Swift.
  dictation: MAC ? {
    engines: call("dictation:engines"),
    start: call("dictation:start"),
    stop: call("dictation:stop"),
    cancel: call("dictation:cancel"),
    roam: call("dictation:roam"),
    free: call("dictation:free"),
    // (this Mac's microphones, for the setting Microphone: listed, then told again as they come and go)
    microphones: call("dictation:microphones"),
    onMicrophones: (fn) => {
      const h = (_e, list) => fn(list)
      ipcRenderer.on("vaultite:microphones", h)
      void ipcRenderer.invoke("dictation:microphones", true).catch(() => {})
      return () => { ipcRenderer.removeListener("vaultite:microphones", h); void ipcRenderer.invoke("dictation:microphones", false).catch(() => {}) }
    },
    // (where a session that left this window lands its words: the helper asks, the page answers)
    onLand: (fn) => {
      const h = async (_e, q) => {
        let r = { ok: false }
        try { r = await fn(q) } catch { /* it took nothing */ }
        ipcRenderer.send("vaultite:dictation-landed", { id: q.id, ...r })
      }
      ipcRenderer.on("vaultite:dictation-land", h)
      return () => { ipcRenderer.removeListener("vaultite:dictation-land", h) }
    },
    on: (fn) => {
      const h = (_e, msg) => fn(msg)
      ipcRenderer.on("vaultite:dictation", h)
      return () => { ipcRenderer.removeListener("vaultite:dictation", h) }
    },
    // (the fn key, heard by the menu-bar helper while this window has the keyboard: its ⌘J)
    onKey: (fn) => {
      const h = (_e, msg) => fn(msg)
      ipcRenderer.on("vaultite:fn", h)
      return () => { ipcRenderer.removeListener("vaultite:fn", h) }
    },
    // (what's at a point of this window, for a Talk key's ask over it: the helper asks, the page answers)
    placeAt: (fn) => {
      const h = async (_e, q) => {
        let place = null
        try { place = await fn(q.x, q.y) } catch { /* nothing known there */ }
        ipcRenderer.send("vaultite:place", { id: q.id, place })
      }
      ipcRenderer.on("vaultite:place-at", h)
      return () => { ipcRenderer.removeListener("vaultite:place-at", h) }
    },
  } : undefined,
  // Other apps' windows in tabs (electron/apps.ts).
  apps: MAC ? {
    list: call("apps:list"),
    trusted: call("apps:trusted"),
    show: call("apps:show"),
    open: call("apps:open"),
    release: call("apps:release"),
    close: call("apps:close"),
    icons: call("apps:icons"),
    focus: call("apps:focus"),
    through: call("apps:through"),
    reopen: call("apps:reopen"),
    on: (fn) => {
      const h = (_e, msg) => fn(msg)
      ipcRenderer.on("vaultite:apps", h)
      return () => { ipcRenderer.removeListener("vaultite:apps", h) }
    },
  } : undefined,
})
