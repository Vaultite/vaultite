// Site styles in each frame of a web page (electron/browser/sitestyles.ts): sandboxed, no Node, in the isolated world.
// The frame's sheet is in before its first paint (no flash of the site's own look), and replaced as the vault changes it.
"use strict"
const { ipcRenderer, webFrame } = require("electron")

let key = ""
const set = (css) => {
  if (key) webFrame.removeInsertedCSS(key)
  key = typeof css === "string" && css ? webFrame.insertCSS(css) : ""
}
if (/^https?:/.test(location.href)) {
  try { set(ipcRenderer.sendSync("vaultite:sitestyles:frame", location.href)) } catch { /* none */ }
  ipcRenderer.on("vaultite:sitestyles:css", (_e, css) => set(css))
}
