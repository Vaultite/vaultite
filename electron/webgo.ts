import { app } from "electron"
import { pageHeld } from "./browser/engine.ts"
import { writeAtomic } from "./setup.ts"
import { shown } from "./pagespot.ts"
import fs from "node:fs"
import path from "node:path"
import { hostOfUrl, ZOOM_FILE } from "./webwire.ts"
import { canBack, type Page, pages, sendState, shows, tabOf, tell, web } from "./webbase.ts"
import { playerKit } from "./webplayer.ts"
import { keepPast, reloaded, restoreMod } from "./weblife.ts"

export function go(p: Page, action: string, url?: string): unknown {
  const wc = p.view.webContents
  const h = wc.navigationHistory
  if (action === "back") { if (!canBack(p)) return false; p.flow = {}; h.goBack(); return true }
  else if (action === "forward") { if (!h.canGoForward()) return false; p.flow = {}; h.goForward(); return true }
  else if (action === "reload") { reloaded.set(wc, Date.now()); wc.reload() }
  else if (action === "allow-cert" && p.cert && p.error) { unsafeOk.add(`${p.profile} ${p.cert.host} ${p.cert.fp}`); void wc.loadURL(p.cert.url).catch(() => {}) }
  else if (action === "source") { if (web(wc.getURL())) tell(p.win, { type: "source", id: p.id, url: `view-source:${wc.getURL()}` }) }
  else if (action === "duplicate" && url && tabOf(url) && p.tab) {
    keepPast(p)
    restoreMod?.copyPast(p.tab, tabOf(url))
  }
  else if (action === "hard-reload") { reloaded.set(wc, Date.now()); wc.reloadIgnoringCache() }
  // (a page's DevTools are a window of their own: a view has nowhere to dock them)
  else if (action === "devtools") { if (wc.isDevToolsOpened()) wc.closeDevTools(); else wc.openDevTools({ mode: "detach" }) }
  else if (action === "zoom-in" || action === "zoom-out" || action === "zoom-reset") return zoomSite(p, action === "zoom-reset" ? 0 : action === "zoom-in" ? 1 : -1)
  else if (action === "print") wc.print({}, () => {})
  else if (action === "history") return { at: h.getActiveIndex(), entries: h.getAllEntries().map((x, i) => ({ i, url: x.url, title: x.title })).filter((x) => shows(x.url)) }
  else if (action === "go-to") { const i = Number(url); if (Number.isInteger(i) && i >= 0 && i < h.length() && shows(h.getEntryAtIndex(i)?.url ?? "")) { p.flow = {}; h.goToIndex(i) } }
  else if (action === "back-address") return canBack(p) ? h.getEntryAtIndex(h.getActiveIndex() - 1)?.url : undefined
  else if (action === "forward-address") return h.canGoForward() ? h.getEntryAtIndex(h.getActiveIndex() + 1)?.url : undefined
  else if (action === "stop") wc.stop()
  else if (action === "mute" || action === "unmute") { wc.setAudioMuted(action === "mute"); sendState(p) }
  else if (action === "focus") { if (p.player) return; if (shown(p.spot)) wc.focus(); else p.hadFocus = true }
  else if (action === "load" && url && shows(url)) { p.target = url; if (!p.agent) p.flow = { opened: url }; void wc.loadURL(url).catch(() => {}) }
  else if (action === "pip") return playerKit().then((k) => wc.executeJavaScriptInIsolatedWorld(1004, [{ code: k.PIP }], true)).catch(() => null)
  else if (action === "pause" || action === "play") {
    return wc.executeJavaScriptInIsolatedWorld(1006, [{ code: action === "pause" ? PAUSE : PLAY }], true).then((n: unknown) => {
      p.paused = action === "pause" && Number(n) > 0
      sendState(p)
      return n
    }, () => null)
  }
}

const PAUSE = `(() => {
  const all = [], walk = (root) => { all.push(...root.querySelectorAll("video, audio")); for (const e of root.querySelectorAll("*")) if (e.shadowRoot) walk(e.shadowRoot) }
  walk(document)
  const on = all.filter((m) => !m.paused && !m.ended)
  window.__vaultitePaused = on
  for (const m of on) m.pause()
  return on.length
})()`
const PLAY = `(() => {
  const on = (window.__vaultitePaused || []).filter((m) => m.isConnected && m.paused)
  window.__vaultitePaused = []
  for (const m of on) void m.play().catch(() => {})
  return on.length
})()`

export const unsafeOk = new Set<string>()

const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]
let zooms: Record<string, number> | null = null
const zoomFile = () => path.join(app.getPath("userData"), "web-zoom.json")
function zoomsKept() {
  if (!zooms) { try { zooms = ZOOM_FILE.parse(JSON.parse(fs.readFileSync(zoomFile(), "utf8"))) } catch { zooms = {} } }
  return zooms
}
export const zoomOf = (host: string) => { const z = zoomsKept()[host]; return typeof z === "number" && z >= ZOOMS[0] && z <= ZOOMS[ZOOMS.length - 1] ? z : 1 }
export const zoomTo = (p: Page, z: number) => { const wc = p.view.webContents; if (!wc.isDestroyed() && Math.abs(wc.getZoomFactor() - z) > 0.001) wc.setZoomFactor(z) }
function zoomSite(p: Page, step: -1 | 0 | 1) {
  const host = hostOfUrl(p.view.webContents.getURL()), now = p.view.webContents.getZoomFactor()
  if (!host) return null
  const to = step === 0 ? 1 : (step > 0 ? ZOOMS.find((z) => z > now + 0.001) : ZOOMS.findLast((z) => z < now - 0.001)) ?? now
  const k = zoomsKept()
  if (Math.abs(to - 1) < 0.001) delete k[host]; else k[host] = to
  try { writeAtomic(zoomFile(), JSON.stringify(k)) } catch { /* this session's only */ }
  for (const x of pages.values()) if (!x.agent && !pageHeld(x.id) && hostOfUrl(x.view.webContents.getURL()) === host) { zoomTo(x, to); sendState(x) }
  return { host, zoom: to }
}
