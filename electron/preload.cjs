// The desktop app's bridge into the page (sandboxed, so plain CommonJS): window.vaultite (typed in
// web/src/core/desktop.ts) and data-electron and data-platform on <html>: index.css makes room for the traffic lights
// on a Mac (other systems keep their own title bar), unless data-fullscreen is set (full screen has none).
// Everything goes through electron/main.ts, which checks that the page asking is one of its own windows.
const { contextBridge, ipcRenderer, webUtils } = require("electron")

const MAC = process.platform === "darwin"
const mark = () => {
  const html = document.documentElement
  if (html) { html.setAttribute("data-electron", ""); html.setAttribute("data-platform", process.platform) }
}
mark()
addEventListener("DOMContentLoaded", mark)
ipcRenderer.on("vaultite:fullscreen", (_e, on) => document.documentElement.toggleAttribute("data-fullscreen", !!on))

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
  pathOf: (file) => webUtils.getPathForFile(file),
  copyIn: call("files:copy-in"),
  openOutside: call("files:open"),
  pickOutside: call("files:pick"),
  dialogSync: (kind, options) => ipcRenderer.sendSync("dialog:sync", kind, options),
  ready: call("app:ready"),
  restartToUpdate: call("app:update-restart"),
  printToPDF: call("print:pdf"),
  revealPdf: call("print:reveal"),
  microphone: call("media:microphone"),
  notify: call("app:notify"),
  syncMenu: call("menu:sync"),
  // The Dock and other apps' windows (swiftc's helper) are a Mac's only: elsewhere their plugins find nothing.
  dock: MAC ? { set: call("dock:set"), custom: call("dock:custom"), pick: call("dock:pick") } : undefined,
  lookUp: call("text:look-up"),
  learnWord: call("text:learn"),
  capture: call("page:capture"),
  on: (fn) => { ipcRenderer.on("vaultite", (_e, msg) => fn(msg)) },
  // The Web viewer's pages (electron/web.ts). The pages themselves get no preload: nothing of this reaches them.
  web: {
    open: call("web:open"),
    place: call("web:place"),
    release: call("web:release"),
    close: call("web:close"),
    go: call("web:go"),
    snapshot: call("web:snapshot"),
    html: call("web:html"),
    external: call("web:external"),
    keys: call("web:keys"),
    reveal: call("web:reveal"),
    list: call("web:list"),
    sites: call("web:sites"),
    forget: call("web:forget"),
    cloud: call("web:cloud"),
    float: call("web:float"),
    take: call("web:take"),
    icons: call("web:icons"),
    on: (fn) => {
      const h = (_e, msg) => fn(msg)
      ipcRenderer.on("vaultite:web", h)
      return () => { ipcRenderer.removeListener("vaultite:web", h) }
    },
  },
  // Other apps' windows in tabs (electron/apps.ts).
  apps: MAC ? {
    list: call("apps:list"),
    trusted: call("apps:trusted"),
    show: call("apps:show"),
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
