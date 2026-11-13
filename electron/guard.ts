import { dialog, shell, type WebContents, type WebPreferences } from "electron"
import { AppWindow } from "./appwindow.ts"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { revive, webWindow } from "./web.ts"
import { appsOn, appsWindow } from "./apps.ts"
import { translucentAt, translucentWindow } from "./translucency.ts"
import { inVault, otherAppScheme, runsCode } from "../core/opening.ts"
import { appPage } from "./apppermissions.ts"
import { MAC, PRELOAD } from "./mainbase.ts"
import { applyLights, background, chrome } from "./titlebar.ts"
import { nameOf, zoom } from "./vaultlist.ts"
import { popouts, type Win, wins } from "./servers.ts"
import { crashedFor, hangs } from "./errors.ts"
import { logger } from "../core/log.ts"
import { openedPage } from "./opened.ts"

const log = logger("links")

// What macOS runs rather than shows when opened (an app, a script, a link to one).
function openVaultFile(abs: string) {
  let runs = runsCode(abs)
  try { runs ||= fs.statSync(abs).isDirectory() } catch { return }
  if (runs) shell.showItemInFolder(abs); else void shell.openPath(abs)
}
async function openLink(url: string) {
  if (/^file:/i.test(url)) {
    // (one on another computer, file://host/x, is a Windows network path: reaching it sends the user's login hash)
    try { if (["", "localhost"].includes(new URL(url).hostname)) openVaultFile(fileURLToPath(url)) } catch {}
    return
  }
  const scheme = otherAppScheme(url)
  if (!scheme) return
  if (!["http", "https", "mailto"].includes(scheme)) {
    const { response } = await dialog.showMessageBox({ type: "question", buttons: ["Open", "Cancel"], defaultId: 1, cancelId: 1, message: "Open this link in another app?", detail: url })
    if (response !== 0) return
  }
  shell.openExternal(url).catch((e) => log.error(`couldn't open ${url.split(":")[0]}: link`, e))
}

export function guard(win: AppWindow, origin: string) {
  // Full screen hides the traffic lights.
  const lights = () => { if (!win.isDestroyed()) win.webContents.send("vaultite:fullscreen", win.isFullScreen()) }
  win.on("enter-full-screen", lights)
  win.on("leave-full-screen", lights)
  win.webContents.on("dom-ready", lights)
  // The Mac lays the title bar out again on these and may put the traffic lights back where they sit by default.
  const again = () => applyLights(win)
  if (MAC) { win.on("focus", again); win.on("blur", again); win.on("show", again); win.on("restore", again); win.on("resized", again); win.on("leave-full-screen", again) }
  // Out of focus, the Mac greys the lights.
  const key = () => { if (!win.isDestroyed()) win.webContents.send("vaultite:key", win.isFocused()) }
  if (MAC) { win.on("focus", key); win.on("blur", key); win.webContents.on("dom-ready", key) }
  const popOut = (w: Win, page: WebContents, webPreferences?: WebPreferences, at?: { x?: number; y?: number }) => {
    const glass = translucentAt(w.vault.path), clear = MAC && glass
    const place = at?.x !== undefined && at.y !== undefined ? { x: at.x, y: at.y } : {}
    const child = new AppWindow({ width: 960, height: 760, ...place, minWidth: 480, minHeight: 360, title: win.getTitle(), ...chrome(),
      acceptFirstMouse: true, webPreferences,
      ...(clear ? { transparent: true, backgroundColor: "#00000000" } : { backgroundColor: background() }) }, page)
    popouts.set(page, w)
    const closeIt = () => { if (!child.isDestroyed()) child.close() }
    win.once("closed", closeIt)
    child.on("closed", () => { popouts.delete(page); if (!win.isDestroyed()) win.off("closed", closeIt) })
    page.on("did-finish-load", () => page.setZoomFactor(zoom))
    revive(page, undefined, crashedFor(child, nameOf(w.vault.path)))
    hangs(child, nameOf(w.vault.path))
    guard(child, origin)
    webWindow(child)
    translucentWindow(child, clear, glass)
    if (appsOn(w.vault.path)) appsWindow(child)
    return page
  }
  win.webContents.on("context-menu", (_e, p) => win.webContents.send("vaultite", { type: "spelling", word: p.misspelledWord, suggestions: p.dictionarySuggestions }))
  win.webContents.on("will-navigate", (e, url) => {
    if (appPage(url, origin)) return
    e.preventDefault()
    void openLink(url)
  })
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if ((url === "about:blank" || url === "") && frameName === "vaultite-presenter") {
      return { action: "allow", overrideBrowserWindowOptions: { backgroundColor: background(), autoHideMenuBar: true } }
    }
    if (url.startsWith(`${origin}/?popout=`)) {
      const w = [...wins.values()].find((x) => x.win === win) ?? popouts.get(win.webContents)
      if (!w) return { action: "deny" }
      return { action: "allow", overrideBrowserWindowOptions: { webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true, spellcheck: true } },
        createWindow: (o) => popOut(w, openedPage(o), o.webPreferences, o) }
    }
    if (appPage(url, origin)) return { action: "deny" }
    if (url.startsWith(origin + "/api/raw?")) {
      const w = [...wins.values()].find((x) => x.win === win)
      const rel = new URL(url).searchParams.get("path"), abs = w && rel ? inVault(w.vault.path, rel) : null
      if (abs) openVaultFile(abs)
    } else void openLink(url)
    return { action: "deny" }
  })
}
