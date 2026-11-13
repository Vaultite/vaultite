import { app, session, WebContentsView, type WebContents } from "electron"
import { AppWindow } from "./appwindow.ts"
import { mayOpen, partitionOf, sessionMade, sessionReady } from "./browser/engine.ts"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { hostOfUrl, siteOf } from "./webwire.ts"
import { dl, loadDownloads, pageOf, sessions, shows, tell, toVault } from "./webbase.ts"
import { askPermission, FREE, permissionOf } from "./webpermissions.ts"

const PRELOAD = fileURLToPath(new URL("./web-preload.cjs", import.meta.url))
export function webSession(profile: string) {
  const had = sessions.get(profile)
  if (had) return had
  const s = session.fromPartition(partitionOf(profile))
  // A plain Chrome: some sites turn away "embedded" browsers by their user agent (the app's name is its channel's too:
  // VaultiteMain/0.7.0). Cloudflare's check hears Electron (browser/challenges.ts), Google's sign-in Firefox (googlesignin.ts).
  s.setUserAgent(s.getUserAgent().replace(/\s(Electron|Vaultite[A-Za-z]*)\/\S+/gi, ""))
  s.registerPreloadScript({ type: "frame", filePath: PRELOAD })
  s.setPermissionRequestHandler((wc, perm, ok, details) => void askPermission(profile, wc, perm, details).then(ok, () => ok(false)))
  s.setPermissionCheckHandler((_wc, perm, origin, details) => {
    if (FREE.has(perm)) return true
    const kind = perm === "media" ? (details.mediaType === "video" ? "camera" : details.mediaType === "audio" ? "microphone" : "") : perm
    return !!kind && permissionOf(profile, siteOf(hostOfUrl(origin)), kind) === true
  })
  s.on("will-download", (_e, item, wc) => {
    const p = wc && pageOf(wc)
    if (toVault.delete(item.getURL())) {
      const tmp = path.join(app.getPath("temp"), `vaultite-image-${crypto.randomUUID()}`)
      item.setSavePath(tmp)
      item.once("done", (_ev, state) => {
        let data: Buffer | null = null, error = state === "completed" ? "" : `the download was ${state}`
        try { if (!error) data = fs.readFileSync(tmp) } catch (e) { error = e instanceof Error ? e.message : String(e) }
        fs.rm(tmp, { force: true }, () => {})
        if (p && !p.win.isDestroyed()) tell(p.win, { type: "image", id: p.id, name: item.getFilename(), mime: item.getMimeType(), data, ...(error ? { error } : {}) })
      })
      return
    }
    const win = p && !p.win.isDestroyed() ? p.win : wc ? AppWindow.fromWebContents(wc) : null
    if (dl) dl.track(item, s, { profile, win, agent: !!p?.agent })
    else item.setSavePath(path.join(app.getPath("downloads"), `${Date.now()} ${path.basename(item.getFilename() || "download")}`))
    if (p && !p.agent && wc && !shows(wc.getURL())) { if (p.tab) tell(p.win, { type: "close", tab: p.tab }); else p.downloaded = true }
  })
  sessions.set(profile, s)
  void loadDownloads().then((m) => m.downloadSession(profile, s))
  sessionMade(s, profile)
  return s
}
export async function readySession(profile: string) {
  const s = webSession(profile)
  await sessionReady(profile)
  return s
}

// A page's settings, sandboxed ("in sub frames" only lets the engine's preloads reach an extension's page embedded in it);
// its full screen never resizes the window by itself (fit() fills its window or player).
export const prefsOf = (profile: string) => ({ session: webSession(profile), sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: true,
  webSecurity: true, spellcheck: true, disableHtmlFullscreenWindowResize: true })
export const newView = (profile: string, adopt?: WebContents) => new WebContentsView({ ...(adopt ? { webContents: adopt } : {}), webPreferences: prefsOf(profile) })

// A spare page, the next tab's renderer started ahead: Electron turns Chrome's off.

export let spare: { profile: string; view: WebContentsView } | null = null
let spareTimer: ReturnType<typeof setTimeout> | null = null
const SPARE_MS = 1500
export function endSpare() {
  if (spareTimer) { clearTimeout(spareTimer); spareTimer = null }
  if (spare && !spare.view.webContents.isDestroyed()) spare.view.webContents.close()
  spare = null
}
export function makeSpare(profile: string) {
  if (spareTimer) clearTimeout(spareTimer)
  spareTimer = setTimeout(() => {
    spareTimer = null
    if (spare?.profile === profile && !spare.view.webContents.isDestroyed()) return
    endSpare()
    if (!mayOpen(profile) || !sessions.has(profile)) return
    const view = newView(profile)
    view.webContents.once("render-process-gone", () => { if (spare?.view === view) endSpare() })
    spare = { profile, view }
    void view.webContents.loadURL("about:blank").catch(() => { if (spare?.view === view) endSpare() })
  }, SPARE_MS)
  spareTimer.unref?.()
}
export function takeSpare(profile: string) {
  const s = spare
  if (!s || s.profile !== profile || s.view.webContents.isDestroyed() || s.view.webContents.isCrashed()) return null
  spare = null
  return s.view
}
/** On a Mac a view parked before its renderer starts never draws (Electron leaves its unthrottled widget unshown). */
export async function readyView(profile: string) {
  const view = takeSpare(profile) ?? newView(profile), wc = view.webContents
  if (!wc.getURL()) void wc.loadURL("about:blank").catch(() => {})
  if (wc.isLoading()) await new Promise<void>((done) => {
    const loaded = () => { clearTimeout(t); done() }
    const t = setTimeout(() => { wc.removeListener("did-stop-loading", loaded); done() }, 2000)
    wc.once("did-stop-loading", loaded)
  })
  return view
}
