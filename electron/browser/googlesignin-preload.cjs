// Google's sign-in, before its scripts run: its navigator says Firefox where googlesignin.ts says so; other sites never ask.
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
