// A frame on Google's sign-in: its navigator says Firefox (googlesignin.ts), as its requests do, before the page's own
// scripts run. Every other frame is left alone and never asks.
"use strict"
const { contextBridge, ipcRenderer } = require("electron")

if (location.origin === "https://accounts.google.com") {
  const agent = ipcRenderer.sendSync("vaultite:google-agent")
  if (agent) {
    try { contextBridge.executeInMainWorld({ func: firefox, args: [agent] }) } catch { /* the page sees Chrome */ }
  }
}

// (serialized into the page's world: it sees only its argument)
function firefox(agent) {
  const N = Navigator.prototype
  const as = (name, value) => Object.defineProperty(N, name, { get: () => value, configurable: true, enumerable: true })
  as("userAgent", agent)
  as("appVersion", `5.0 (${/Windows/.test(agent) ? "Windows" : agent.match(/\(([^;)]+)/)[1]})`)
  as("vendor", "")
  // (Firefox has no client hints at all)
  delete N.userAgentData
}
