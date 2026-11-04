// A question sheet's answer (sheet.ts): its page has this one function, nothing else of the app's.
"use strict"
const { contextBridge, ipcRenderer } = require("electron")
contextBridge.exposeInMainWorld("sheet", { answer: (v) => ipcRenderer.send("vaultite:sheet", v ?? null) })
