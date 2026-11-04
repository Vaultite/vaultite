// A player's window controls on Windows and Linux (player.ts): a button's click, nothing else of the app's.
"use strict"
const { ipcRenderer } = require("electron")
window.addEventListener("click", (e) => { const b = e.target.closest?.("[data-do]"); if (b) ipcRenderer.send("player:bar", b.dataset.do) })
