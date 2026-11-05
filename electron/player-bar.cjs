// A top strip's buttons (topstrip.ts): a player's window controls on Windows and Linux, Keep on top's pin; a click, nothing else of the app's.
"use strict"
const { ipcRenderer } = require("electron")
window.addEventListener("click", (e) => { const b = e.target.closest?.("[data-do]"); if (b) ipcRenderer.send("player:bar", b.dataset.do) })
