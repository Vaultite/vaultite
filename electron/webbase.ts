import { app, BaseWindow, type Session, WebContentsView, type WebContents } from "electron"
import { localUrl } from "../core/web.ts"
import { logger } from "../core/log.ts"
import { AppWindow } from "./appwindow.ts"
import { engineOpens, setEngineHost } from "./browser/engine.ts"
import type { Spot } from "./pagespot.ts"
import { playing, type Flow, type Owned, type Playback } from "./webpages.ts"
import fs from "node:fs"
import path from "node:path"
import type { WebRect } from "./webwire.ts"

setEngineHost({ windows: () => AppWindow.getAllWindows(), localUrl, logger })

/** `radius`: its corners' (CSS px), where it meets its pane's rounded card's (one radius: Electron rounds all four). */
export type WebState = { url: string; title: string; back: boolean; forward: boolean; loading: boolean; error?: string; playing?: boolean; muted?: boolean
  paused?: boolean; player?: boolean; zoom?: number; unsafe?: boolean; crashed?: boolean; typed?: boolean; painted?: boolean }
export type Page = Owned<AppWindow> & { view: WebContentsView; error?: string
  cert?: { url: string; host: string; fp: string }
  crashed?: boolean
  status?: number
  typed: Map<string, boolean>
  want: WebRect | null
  player?: BaseWindow
  full?: boolean
  madeFull?: boolean
  fillCss?: string
  /** The address it was last sent to: what it shows until a load commits (getURL is "" till then). */
  target: string
  icons?: string
  hadFocus?: boolean
  radius?: number
  sound: Playback; hush?: NodeJS.Timeout; linger?: NodeJS.Timeout
  paused?: boolean
  downloaded?: boolean
  restoring?: boolean
  blankBehind?: boolean
  fresh: boolean
  drawn?: boolean; spot: Spot; drew?: number; seeing?: Promise<void>
  input: number
  flow: Flow }
/** A site a profile keeps cookies for: whether it's signed in and who as, when we know how to ask, sites the same login covers (`with`),
 *  its last visit, and `other` when no page of it was opened (its cookies came with other sites' pages: trackers). */
export type WebSite = { site: string; signed?: boolean; account?: string; more?: string[]; avatar?: string; with?: string[]; last?: number; other?: boolean }

export const profileOf = (x: unknown) => (typeof x === "string" && /^[a-z0-9-]{1,32}$/.test(x) ? x : "")
export const MAC = process.platform === "darwin"

export const pages = new Map<number, Page>()
let next = 0
export function nextId() {
  const file = path.join(app.getPath("userData"), "web-next-id")
  if (!next) { try { next = Number(fs.readFileSync(file, "utf8")) || 1 } catch { next = 1 } }
  const id = next
  next = next >= 999_999 ? 1 : next + 1
  try { fs.writeFileSync(file, String(next)) } catch { /* this run's only */ }
  return id
}
export const sessions = new Map<string, Session>()

export const web = (u: string) => /^https?:\/\//i.test(u)
export const shows = (u: string) => web(u) || engineOpens(u) || /^(view-source|blob):https?:\/\//i.test(u)
export const blankWindow = (u: string) => !u || /^about:blank([?#].*)?$/i.test(u)
export let dl: typeof import("./downloads.ts") | null = null
export const loadDownloads = async () => (dl ??= await import("./downloads.ts"))
export const toVault = new Set<string>()
export const pageOf = (wc: WebContents) => [...pages.values()].find((p) => p.view.webContents === wc)
export const tell = (win: AppWindow, msg: { type: string; [k: string]: unknown }) => { if (!win.isDestroyed()) win.webContents.send("vaultite:web", msg) }

export const canBack = (p: Page) => !p.blankBehind && p.view.webContents.navigationHistory.canGoBack()
export const playingNow = (p: Page) => !p.view.webContents.isDestroyed() && playing(p.sound, p.view.webContents.isCurrentlyAudible(), Date.now())
export function stateOf(p: Page): WebState {
  const wc = p.view.webContents
  const h = wc.navigationHistory
  const blank = p.blankBehind || p.restoring
  const zoom = wc.getZoomFactor()
  return { url: (!blank && wc.getURL()) || p.target, title: (!blank && wc.getTitle()) || "", back: canBack(p), forward: h.canGoForward(), loading: wc.isLoading(), ...(p.error ? { error: p.error } : {}),
    ...(playingNow(p) ? { playing: true } : {}), ...(wc.isAudioMuted() ? { muted: true } : {}), ...(p.paused ? { paused: true } : {}), ...(p.player ? { player: true } : {}), ...(Math.abs(zoom - 1) > 0.001 ? { zoom } : {}),
    ...(p.cert && p.error ? { unsafe: true } : {}), ...(p.crashed ? { crashed: true } : {}), ...([...p.typed.values()].some(Boolean) ? { typed: true } : {}),
    ...(p.fresh ? {} : { painted: true }),
    ...(p.flow.opened && p.flow.opened !== wc.getURL() ? { opened: p.flow.opened } : {}), ...(p.flow.signIn ? { signIn: p.flow.signIn } : {}) }
}

export const sendState = (p: Page) => tell(p.win, { type: "state", id: p.id, state: stateOf(p) })
export const pagesChanged = (win: AppWindow) => tell(win, { type: "pages" })

export const str = (x: unknown) => { if (typeof x !== "string") throw new Error("expected text"); return x }
export const tabOf = (x: unknown) => (typeof x === "string" && /^[\w-]{1,64}$/.test(x) ? x : "")
export function mine(win: AppWindow, id: unknown) {
  const p = pages.get(Number(id))
  if (!p || p.win !== win) throw new Error("no such page")
  return p
}
