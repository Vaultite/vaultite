// A page's prompt(), which Electron answers null at once: the question sheet over its window, the page waiting for the
// answer as in Chrome (web-preload.cjs asks synchronously). An agent's page, nobody there to answer, hears null.
import { BrowserWindow, ipcMain } from "electron"
import { allPages, pageHeld } from "./engine.ts"
import { askSheet } from "./sheet.ts"

ipcMain.on("vaultite:web:prompt", (e, message: unknown, value: unknown) => {
  const p = allPages().find((x) => x.wc === e.sender), win = p ? p.win : BrowserWindow.fromWebContents(e.sender)
  const text = (v: unknown) => (typeof v === "string" ? v : "")
  let site = "This page"
  try { site = new URL(e.senderFrame?.url ?? "").hostname || site } catch { /* a blank frame's */ }
  if (!win || win.isDestroyed() || (p && (!p.tab() || pageHeld(p.id)))) { e.returnValue = null; return }
  void askSheet(win, { title: `${site} says`, message: text(message), fields: [{ name: "value", value: text(value) }], ok: "OK", until: e.sender })
    .then((r) => { e.returnValue = r ? r.value : null }, () => { e.returnValue = null })
})
