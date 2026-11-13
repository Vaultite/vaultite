// The Browser's pages, WebContentsViews over tabs' panes: plugins/core/web-viewer/CLAUDE.md says what and why.
import { app, BaseWindow, clipboard, dialog, type Input, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, powerSaveBlocker, safeStorage, screen, session, shell, type Session, systemPreferences, type View, WebContentsView, type WebContents } from "electron"
import { localUrl } from "../core/web.ts"
import { AppWindow } from "./appwindow.ts"
import { allPages, canvasOf, cdp, engineCall, engineLoaded, engineOpens, handle, mayOpen, mayPicture, openedByAgent, pageHeld, pageKept, pageMade, partitionOf, sessionMade, sessionReady, setCanvasHandler, setEngineHost, setOpener } from "./browser/engine.ts"
import { openElsewhere } from "./browser/default.ts"
import { lastVisits } from "./browser/history.ts"
import { newKeys, open as openSealed, seal } from "./browser/sealed.ts"
import { ACCOUNTS, covers, nonempty, type Rule, type Who } from "./siteaccounts.ts"
import { writeAtomic } from "./setup.ts"
import { otherAppScheme } from "../core/opening.ts"
import { QUIET } from "./quiet.ts"
import { HIDDEN, shown, type Spot, type SpotEffect, type SpotEvent, spotStep } from "./pagespot.ts"
import { NO_POINTER, PASSED, type Passed, type Pointer, type PointerEvent, pointerStep, RAISE, type Raise, type Role, stackOrder } from "./stack.ts"
import { claim, discardable, flowOn, hear, letGo, LINGER_MS, media, MOVE_MS, outlasted, playback, playing, quietEnds, RECLAIM_MS, tabGone, tabMoved, unclaimed, unmoved, windowReloaded, type Flow, type Owned, type Playback } from "./webpages.ts"
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { CONTAINER, cookiesFrom, FIND, hostOfUrl, ICONS, KNOWN, knownFrom, MENUS, PAGE_HTML, RECT, SEAL_KEYS, SEALED_LOGIN, siteOf, SITES, ZOOM_FILE, FETCHED, type Known, type WebRect } from "./webwire.ts"

setEngineHost({ windows: () => AppWindow.getAllWindows(), localUrl })

/** `radius`: its corners' (CSS px), where it meets its pane's rounded card's (one radius: Electron rounds all four). */
export type WebState = { url: string; title: string; back: boolean; forward: boolean; loading: boolean; error?: string; playing?: boolean; muted?: boolean
  paused?: boolean; player?: boolean; zoom?: number; unsafe?: boolean; crashed?: boolean; typed?: boolean; painted?: boolean }
type Page = Owned<AppWindow> & { view: WebContentsView; error?: string
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

const profileOf = (x: unknown) => (typeof x === "string" && /^[a-z0-9-]{1,32}$/.test(x) ? x : "")
const MAC = process.platform === "darwin"
const BROWSER_KEYS = new Set(["f", "g", "shift+g", "=", "shift+=", "-", "0"].map((k) => `mod+${k}`))
// (⌘Y isn't redo on a Mac: it's History there, as in Chrome)
const PAGE_KEYS = new Set([...["a", "c", "v", "x", "z", "shift+z", ...(MAC ? [] : ["y"]), "b", "i", "u", "k", "shift+v", "arrowleft",
  "arrowright", "arrowup", "arrowdown", "backspace", "delete", "enter", "shift+enter", "tab"].map((k) => `mod+${k}`), ...BROWSER_KEYS])
const OWN_KEYS: Record<string, string> = { "mod+r": "reload", "mod+shift+r": "hard-reload", [MAC ? "mod+alt+i" : "mod+shift+i"]: "devtools", [MAC ? "mod+alt+u" : "mod+u"]: "source" }

const pages = new Map<number, Page>()
const keysOf = new WeakMap<AppWindow, Set<string>>()
let next = 0
function nextId() {
  const file = path.join(app.getPath("userData"), "web-next-id")
  if (!next) { try { next = Number(fs.readFileSync(file, "utf8")) || 1 } catch { next = 1 } }
  const id = next
  next = next >= 999_999 ? 1 : next + 1
  try { fs.writeFileSync(file, String(next)) } catch { /* this run's only */ }
  return id
}
const sessions = new Map<string, Session>()

const web = (u: string) => /^https?:\/\//i.test(u)
const shows = (u: string) => web(u) || engineOpens(u) || /^(view-source|blob):https?:\/\//i.test(u)
const blankWindow = (u: string) => !u || /^about:blank([?#].*)?$/i.test(u)
let dl: typeof import("./downloads.ts") | null = null
const loadDownloads = async () => (dl ??= await import("./downloads.ts"))
const toVault = new Set<string>()
const pageOf = (wc: WebContents) => [...pages.values()].find((p) => p.view.webContents === wc)

const PRELOAD = fileURLToPath(new URL("./web-preload.cjs", import.meta.url))
function webSession(profile: string) {
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
async function readySession(profile: string) {
  const s = webSession(profile)
  await sessionReady(profile)
  return s
}


const FREE = new Set(["clipboard-sanitized-write", "notifications", "fullscreen", "pointerLock", "keyboardLock", "speaker-selection",
  "storage-access", "top-level-storage-access"])
const ASKED: Record<string, string> = {
  camera: "use your camera", microphone: "use your microphone", geolocation: "know your location", "clipboard-read": "see what you copy",
  midi: "use your MIDI devices", midiSysex: "control your MIDI devices", "idle-detection": "know when you're away from the computer",
  "window-management": "see your screens and place windows on them", fileSystem: "edit files on this Mac", openExternal: "open another app",
}
type Answers = Record<string, Record<string, Record<string, boolean>>> // profile -> site -> what -> allowed
let answers: Answers | null = null
const answersFile = () => path.join(app.getPath("userData"), "web-permissions.json")
function loadAnswers(): Answers {
  if (answers) return answers
  try { const j = JSON.parse(fs.readFileSync(answersFile(), "utf8")); answers = j && typeof j === "object" ? j : {} } catch { answers = {} }
  return answers!
}
const permissionOf = (profile: string, site: string, kind: string): boolean | undefined => loadAnswers()[profile]?.[site]?.[kind]
function answer(profile: string, site: string, kind: string, yes: boolean | null) {
  const all = loadAnswers(), of = (all[profile] ??= {}), at = (of[site] ??= {})
  if (yes === null) delete at[kind]; else at[kind] = yes
  if (!Object.keys(at).length) delete of[site]
  try { fs.writeFileSync(answersFile(), JSON.stringify(all)) } catch { /* asked again next time */ }
}
const asking = new Map<string, Promise<boolean>>()

/** The camera and microphone also need macOS's yes. */
async function askPermission(profile: string, wc: WebContents, perm: string, details: { mediaTypes?: string[]; requestingUrl?: string; externalURL?: string }) {
  if (FREE.has(perm)) return true
  // (another app by its scheme, said in the question: a yes to zoommtg: is none to ms-msdt:; a frame's link to another
  // app comes only here, never past otherApp)
  const scheme = perm === "openExternal" ? otherAppScheme(details.externalURL ?? "") : ""
  if (perm === "openExternal" && !scheme) return false
  // (media with no camera or microphone is sharing the screen: its picker asks, browser/screenshare.ts)
  if (perm === "media" && !details.mediaTypes?.length) return true
  const kinds = perm === "media" ? [...new Set((details.mediaTypes ?? []).map((t) => (t === "video" ? "camera" : "microphone")))] : [scheme ? `openExternal:${scheme}` : perm]
  if (!kinds.length || kinds.some((k) => !ASKED[k.split(":")[0]])) return false
  const site = siteOf(hostOfUrl(details.requestingUrl || wc.getURL()))
  if (!site) return false
  const known = kinds.map((k) => permissionOf(profile, site, k))
  if (known.some((k) => k === false)) return false
  let yes = known.every((k) => k === true)
  if (!yes) {
    const key = `${profile} ${site} ${kinds.join(",")}`
    let q = asking.get(key)
    if (!q) {
      const win = pageOf(wc)?.win ?? AppWindow.fromWebContents(wc) ?? undefined
      const what = kinds.map((k) => (scheme ? `open ${scheme}: links in another app` : ASKED[k])).join(" and ").replace(/ and use your /, " and ")
      const box = { type: "question" as const, message: `${site} wants to ${what}`, buttons: ["Allow", "Don't allow"], defaultId: 1, cancelId: 1,
        checkboxLabel: "Remember for this site", checkboxChecked: true }
      q = (win ? dialog.showMessageBox(win, box) : dialog.showMessageBox(box)).then((r) => {
        const allow = r.response === 0
        if (r.checkboxChecked && (allow || !scheme)) for (const k of kinds) answer(profile, site, k, allow)
        return allow
      }).finally(() => asking.delete(key))
      asking.set(key, q)
    }
    yes = await q
  }
  if (yes && MAC && perm === "media") {
    for (const k of kinds) if (!(await systemPreferences.askForMediaAccess(k === "camera" ? "camera" : "microphone"))) return false
  }
  return yes
}

const ACTIVATION_MS = 5000
const BLANK_MS = 30_000
const EDGE = 12
const TOP = 8, TOP_MS = 100
const tell = (win: AppWindow, msg: { type: string; [k: string]: unknown }) => { if (!win.isDestroyed()) win.webContents.send("vaultite:web", msg) }

const canBack = (p: Page) => !p.blankBehind && p.view.webContents.navigationHistory.canGoBack()
const playingNow = (p: Page) => !p.view.webContents.isDestroyed() && playing(p.sound, p.view.webContents.isCurrentlyAudible(), Date.now())
function stateOf(p: Page): WebState {
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
const NOTIFY = "__vaultite_notify__"
const notifyShim = (mark: string) => `(() => {
  if (window.__vaultiteNotify) return
  Object.defineProperty(window, "__vaultiteNotify", { value: true })
  const log = console.debug.bind(console)
  const send = (title, o) => { try { log(${JSON.stringify(mark)} + JSON.stringify({ title: String(title ?? ""), body: String((o && o.body) ?? "") })) } catch {} }
  class Notification extends EventTarget {
    static get permission() { return "granted" }
    static requestPermission(done) { if (typeof done === "function") done("granted"); return Promise.resolve("granted") }
    static get maxActions() { return 0 }
    constructor(title, o = {}) {
      super()
      Object.assign(this, { title: String(title), body: o.body ?? "", tag: o.tag ?? "", data: o.data ?? null, icon: o.icon ?? "", onclick: null, onshow: null, onclose: null, onerror: null })
      send(title, o)
      queueMicrotask(() => { const e = new Event("show"); this.dispatchEvent(e); if (typeof this.onshow === "function") this.onshow(e) })
    }
    close() {}
  }
  window.Notification = Notification
  if (window.ServiceWorkerRegistration) ServiceWorkerRegistration.prototype.showNotification = function (title, o) { send(title, o); return Promise.resolve() }
})()`
const RATE = 6
const QUEUED = 200

const sendState = (p: Page) => tell(p.win, { type: "state", id: p.id, state: stateOf(p) })

const EMPTY = `(() => { const b = document.body; return !document.querySelector("script") && (!b || (!b.children.length && !b.textContent.trim())) })()`
async function emptyError(p: Page, status: number) {
  const wc = p.view.webContents, url = wc.getURL()
  const empty = await wc.executeJavaScriptInIsolatedWorld(1005, [{ code: EMPTY }]).catch(() => false)
  if (empty !== true || wc.isDestroyed() || wc.isLoading() || wc.getURL() !== url || p.status !== status || p.error) return
  p.error = `HTTP ERROR ${status}`
  sendState(p)
}
const pagesChanged = (win: AppWindow) => tell(win, { type: "pages" })

function stepOf(i: Pick<Input, "key" | "code" | "meta" | "control" | "alt" | "shift">) {
  if (["Meta", "Control", "Alt", "Shift", "CapsLock", "Fn", "OS"].includes(i.key)) return ""
  const CODES: Record<string, string> = { Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/" }
  const byCode = /^Key[A-Z]$/.test(i.code) ? i.code.slice(3) : /^Digit\d$/.test(i.code) ? i.code.slice(5) : CODES[i.code]
  const key = i.key === " " || i.code === "Space" ? "Space"
    : byCode && (i.alt || (i.shift && !/^[a-z]$/i.test(i.key))) ? byCode
    : i.key.length === 1 ? i.key.toUpperCase() : i.key
  const mod = MAC ? i.meta : i.control
  return [mod && "mod", MAC && i.control && "ctrl", i.alt && "alt", i.shift && "shift", key].filter(Boolean).join("+").toLowerCase()
}

async function otherApp(p: Page, to: string) {
  const scheme = otherAppScheme(to)
  if (!scheme) return
  if (scheme === "mailto") return void shell.openExternal(to)
  const wc = p.view.webContents
  if (wc.isDestroyed()) return
  if (await askPermission(p.profile, wc, "openExternal", { requestingUrl: wc.getURL(), externalURL: to }).catch(() => false)) await shell.openExternal(to).catch(console.error)
}

const looks = new WeakMap<AppWindow, string>()
const lookOf = (win: AppWindow) => looks.get(win) ?? win.getBackgroundColor()
function painted(p: Page) {
  if (!p.fresh || p.view.webContents.isDestroyed()) return
  p.fresh = false
  p.view.setBackgroundColor(canvasOf(p.id))
  sendState(p)
}
setCanvasHandler((id) => { const p = pages.get(id); if (p && !p.fresh && !p.view.webContents.isDestroyed()) p.view.setBackgroundColor(canvasOf(id)) })
ipcMain.on("vaultite:web:painted", (e) => { const p = pageOf(e.sender); if (p && shows(e.sender.getURL())) painted(p) })
ipcMain.on("vaultite:web:key", (e, k: { key?: unknown; code?: unknown; meta?: unknown; ctrl?: unknown; alt?: unknown; shift?: unknown }) => {
  const p = pageOf(e.sender)
  if (!p || p.agent || p.player || !k || typeof k.key !== "string" || typeof k.code !== "string") return
  const key = { key: k.key, code: k.code, meta: k.meta === true, ctrl: k.ctrl === true, alt: k.alt === true, shift: k.shift === true }
  if (BROWSER_KEYS.has(stepOf({ ...key, control: key.ctrl }))) tell(p.win, { type: "key", id: p.id, ...key })
})
ipcMain.on("vaultite:web:typed", (e, on) => {
  const p = pageOf(e.sender), key = `${e.processId}:${e.frameId}`
  if (!p || (p.typed.get(key) ?? false) === (on === true)) return
  p.typed.set(key, on === true)
  sendState(p)
})
// A press in one of its frames from another site, whose input events never reach the page's (web-preload.cjs).
ipcMain.on("vaultite:web:input", (e) => { const p = pageOf(e.sender); if (p) p.input = Date.now() })
ipcMain.on("vaultite:web:nav", (e, dir) => { const p = pageOf(e.sender); if (p && !p.agent && !p.player) tell(p.win, { type: "nav", id: p.id, dir: dir < 0 ? -1 : 1 }) })

// A page's settings, sandboxed ("in sub frames" only lets the engine's preloads reach an extension's page embedded in it);
// its full screen never resizes the window by itself (fit() fills its window or player).
const prefsOf = (profile: string) => ({ session: webSession(profile), sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: true,
  webSecurity: true, spellcheck: true, disableHtmlFullscreenWindowResize: true })
const newView = (profile: string, adopt?: WebContents) => new WebContentsView({ ...(adopt ? { webContents: adopt } : {}), webPreferences: prefsOf(profile) })

// A spare page, the next tab's renderer started ahead: Electron turns Chrome's off.

let spare: { profile: string; view: WebContentsView } | null = null
let spareTimer: ReturnType<typeof setTimeout> | null = null
const SPARE_MS = 1500
function endSpare() {
  if (spareTimer) { clearTimeout(spareTimer); spareTimer = null }
  if (spare && !spare.view.webContents.isDestroyed()) spare.view.webContents.close()
  spare = null
}
function makeSpare(profile: string) {
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
function takeSpare(profile: string) {
  const s = spare
  if (!s || s.profile !== profile || s.view.webContents.isDestroyed() || s.view.webContents.isCrashed()) return null
  spare = null
  return s.view
}
/** On a Mac a view parked before its renderer starts never draws (Electron leaves its unthrottled widget unshown). */
async function readyView(profile: string) {
  const view = takeSpare(profile) ?? newView(profile), wc = view.webContents
  if (!wc.getURL()) void wc.loadURL("about:blank").catch(() => {})
  if (wc.isLoading()) await new Promise<void>((done) => {
    const loaded = () => { clearTimeout(t); done() }
    const t = setTimeout(() => { wc.removeListener("did-stop-loading", loaded); done() }, 2000)
    wc.once("did-stop-loading", loaded)
  })
  return view
}

function make(win: AppWindow, url: string, profile: string, tab: string, { agent = false, adopt, opener, ready }: { agent?: boolean; adopt?: WebContents; opener?: number; ready?: WebContentsView } = {}): Page {
  if (!popups) void import("./popup.ts").then((k) => { popups = k })
  const kept = tab && !adopt ? restoreMod?.pastOf(tab, profile, url) ?? null : null
  const taken = adopt || kept ? null : ready ?? takeSpare(profile), view = taken ?? newView(profile, adopt)
  makeSpare(profile)
  view.setBackgroundColor(kept && !kept.load && restoreMod?.frameFor(tab, url, profile) ? "#00000000" : lookOf(win))
  view.setVisible(false)
  // (a size before it's first shown: a page laid out at none has nothing an agent could click)
  const [w, h] = win.getContentSize()
  view.setBounds({ x: 0, y: 0, width: Math.max(320, Math.round(w / 2)), height: Math.max(240, h - 80) })
  addPage(win, view)
  const p: Page = { id: nextId(), win, view, profile, tab, agent, drawn: agent, holds: 0, closing: false, let: 0, target: url, want: null, sound: playback(),
    blankBehind: !!taken, fresh: true, typed: new Map(), input: 0, spot: HIDDEN, flow: !kept && !agent && shows(url) ? { opened: url } : {} }
  pages.set(p.id, p)
  if (agent) move(p, { type: "park", now: Date.now() })
  const wc = view.webContents
  if (taken) wc.once("did-navigate", () => { wc.navigationHistory.clear(); p.blankBehind = false })
  wc.on("did-navigate", () => { p.drew = undefined })
  let restored = () => {}
  if (kept) {
    p.restoring = true
    restored = () => { if (!p.restoring) return; p.restoring = false; wc.off("did-navigate", done); if (!wc.isDestroyed()) sendState(p) }
    const done = () => { if (wc.navigationHistory.getActiveIndex() >= kept.index) restored() }
    wc.on("did-navigate", done)
  }
  pageMade({ id: p.id, wc, profile, get win() { return p.win }, url, opener, hide: () => place(p, null), visible: () => shown(p.spot), tab: () => p.tab,
    player: (on, fullScreen) => { if (on) void toPlayer(p, fullScreen); else fromPlayer(p) }, own: (to) => own(p, tabOf(to)), close: () => end(p),
    rest: () => move(p, { type: "rest" }), wake: () => wake(p), resting: () => p.spot.at === "resting", refit: () => fit(p) })

  const refuse = (e: { preventDefault: () => void }, to: string) => {
    if (shows(to)) return
    e.preventDefault()
    void otherApp(p, to)
  }
  wc.on("will-navigate", (e) => refuse(e, e.url))
  wc.on("will-redirect", (e) => refuse(e, e.url))
  // A page asking to stay (unsaved changes): Chrome's question. Unanswered, Electron cancels the navigation without a word
  // (claude.ai's invitations did nothing); an agent's page, nobody there to ask, leaves.
  wc.on("will-prevent-unload", (e) => { if (mayLeave(wc, p.player ?? p.win, p.agent || pageHeld(p.id) || p.closing)) e.preventDefault() })
  // Chrome's popup blocker (Electron has none): a page opens something only just after a click or key in it (or in one
  // of its frames: web-preload.cjs), else the user's told and may open it. An agent's opens are its own pages.
  let toldBlocked = 0
  wc.on("input-event", (_e, i) => { if (["mouseDown", "rawKeyDown", "keyDown", "gestureTap", "touchStart"].includes(i.type)) p.input = Date.now() })
  wc.setWindowOpenHandler(({ url: to, disposition, features }) => {
    const agents = p.agent || openedByAgent(p.id)
    if (!agents && Date.now() - p.input > ACTIVATION_MS) {
      if (Date.now() - toldBlocked > 10_000 && web(to)) { toldBlocked = Date.now(); tell(p.win, { type: "blocked", id: p.id, tab: p.tab, url: to, profile }) }
      return { action: "deny" }
    }
    p.input = 0
    const blank = blankWindow(to)
    if (!blank && !shows(to)) { void otherApp(p, to); return { action: "deny" } }
    // (a sized popup, signing in with another site or a video popped out, is a window of its own (popup.ts); else a tab
    // behind, in front or (⇧-click) to the side; both handed the contents Chromium made so `window.opener` works)
    const popup = disposition === "new-window" && features.split(",").some((f) => !/^\s*(noopener|noreferrer)?\s*$/i.test(f))
    if (popup && !agents) {
      const k = popups
      // (Electron puts the new page and what the features asked, its size and place, in its options)
      if (k) return { action: "allow", overrideBrowserWindowOptions: { webPreferences: prefsOf(profile) }, createWindow: (o) => k.popup(o as Parameters<typeof k.popup>[0], to, {
        name: () => (p.profile.startsWith("c-") ? menus.containers.find((x) => `c-${x.id}` === p.profile)?.name : "") ?? "",
        away: (u) => { if (shows(u)) return false; void otherApp(p, u); return true },
        link: (u) => { if (web(u)) tell(p.win, { type: "open", id: p.id, tab: p.tab, url: u, profile: p.profile, how: "foreground" }); else void otherApp(p, u) },
        mayLeave: (wc, w) => mayLeave(wc, w, false), closing: (wc) => unloading.add(wc), opener: p.view.webContents, site: (u) => siteOf(hostOfUrl(u)),
      }) }
    }
    const how = disposition === "background-tab" ? "background" : disposition === "new-window" ? "side" : "foreground"
    // (outliving its page, as a Chrome tab does: Electron closes what window.open made with its opener, which closed every
    // tab opened from a page with it)
    return { action: "allow", outlivesOpener: true, overrideBrowserWindowOptions: { webPreferences: prefsOf(profile) }, createWindow: (o) => {
      const child = make(p.win, blank ? "" : to, profile, "", { agent: agents, adopt: (o as { webContents: WebContents }).webContents, opener: p.id })
      pagesChanged(p.win)
      const hand = (url: string) => {
        child.orphan = Date.now()
        setTimeout(() => { if (child.orphan !== undefined && pages.has(child.id)) end(child) }, RECLAIM_MS).unref()
        tell(p.win, { type: "open", id: p.id, tab: p.tab, url, profile, how, page: child.id })
      }
      if (!agents && !blank) hand(to)
      else if (!agents) {
        const cw = child.view.webContents
        const sent = (d: { url: string; isMainFrame: boolean }) => { if (d.isMainFrame && shows(d.url)) { cw.off("did-start-navigation", sent); child.target = d.url; child.flow = { opened: d.url }; hand(d.url) } }
        cw.on("did-start-navigation", sent)
        child.orphan = Date.now()
        setTimeout(() => { if (child.orphan !== undefined && !child.tab && pages.has(child.id) && !shows(cw.isDestroyed() ? "" : cw.getURL())) end(child) }, BLANK_MS).unref()
      }
      return child.view.webContents
    } }
  })

  // (its media pausing as it closes comes after its view let go of its contents)
  const changed = () => { if (p.view.webContents && !wc.isDestroyed()) sendState(p) }
  const flowTo = (to: string) => {
    const was = p.flow
    p.flow = flowOn(was, to, Date.now() - p.input < ACTIVATION_MS, siteOf)
    if (p.flow.signIn !== was.signIn || !p.flow.opened !== !was.opened) changed()
  }
  revive(wc, undefined, () => { p.crashed = true; changed() })
  wc.on("did-start-loading", () => { p.error = undefined; p.crashed = false; changed() })
  wc.on("certificate-error", (e, to, error, cert, done, main) => {
    const host = hostOfUrl(to)
    if (unsafeOk.has(`${p.profile} ${host} ${cert.fingerprint}`)) { e.preventDefault(); done(true); return }
    done(false)
    if (main && /\bERR_CERT_/.test(error)) p.cert = { url: to, host, fp: cert.fingerprint }
  })
  wc.on("did-start-navigation", (d) => { if (d.isMainFrame && !d.isSameDocument) { p.cert = undefined; if (shows(d.url)) { p.target = d.url; flowTo(d.url) } } })
  wc.on("did-redirect-navigation", (d) => { if (d.isMainFrame && shows(d.url)) flowTo(d.url) })
  wc.on("did-stop-loading", changed)
  // A pinch magnifies the page, as Safari's does (Electron turns it off); each new renderer is told again.
  void wc.setVisualZoomLevelLimits(1, 3).catch(() => {})
  wc.on("did-navigate", (_e, to, code) => { p.status = code; p.sound = playback(); p.paused = false; p.typed.clear(); noteVisit(profile, to); if (!p.agent && !pageHeld(p.id)) zoomTo(p, zoomOf(hostOfUrl(to))); void wc.setVisualZoomLevelLimits(1, 3).catch(() => {}); changed(); keepPast(p) })
  wc.on("found-in-page", (_e, r) => tell(p.win, { type: "found", id: p.id, request: r.requestId, active: r.activeMatchOrdinal, matches: r.matches, final: r.finalUpdate }))
  // (loaded and still not told it painted, a page with no paint timing (an extension's): its canvas a moment later)
  wc.on("did-finish-load", () => {
    if (p.fresh && shows(wc.getURL())) setTimeout(() => painted(p), 1000).unref()
    if (p.status !== undefined && p.status >= 400) void emptyError(p, p.status)
  })
  wc.on("did-navigate-in-page", (_e, to, main) => { if (main) { flowTo(to); changed(); keepPast(p) } })
  wc.on("page-title-updated", () => { changed(); keepPast(p) })
  wc.on("dom-ready", () => tellGlance(wc))
  wc.on("cursor-changed", (_e, cursor) => tell(p.win, { type: "cursor", id: p.id, cursor }))
  const sounded = () => {
    clearTimeout(p.hush)
    const ends = quietEnds(p.sound)
    if (ends !== undefined) p.hush = setTimeout(() => { if (!wc.isDestroyed()) changed() }, ends - Date.now()).unref()
    changed()
  }
  wc.on("audio-state-changed", (e) => { hear(p.sound, e.audible, Date.now()); sounded() })
  wc.on("media-started-playing", () => { p.paused = false; media(p.sound, true, wc.isCurrentlyAudible()); sounded() })
  wc.on("media-paused", () => {
    const audible = wc.isCurrentlyAudible()
    media(p.sound, false, audible)
    sounded()
    clearTimeout(p.linger)
    if (audible) p.linger = setTimeout(() => { if (!wc.isDestroyed() && outlasted(p.sound, wc.isCurrentlyAudible())) sounded() }, LINGER_MS).unref()
  })
  wc.on("did-fail-load", (_e, code, desc, _u, main) => {
    if (!main || code === -3) return // -3: stopped, or another load took over
    p.error = desc || `error ${code}`
    changed()
  })
  wc.on("focus", () => { if (!p.player) tell(p.win, { type: "focus", id: p.id }) })
  wc.on("enter-html-full-screen", () => {
    p.full = true
    const w = p.player
    if (w) { if (!w.isDestroyed() && !w.isFullScreen()) w.setFullScreen(true) }
    else {
      restack(p.win)
      if (!p.win.isFullScreen()) { p.win.setFullScreen(true); p.madeFull = true }
    }
    fit(p)
  })
  wc.on("leave-html-full-screen", () => {
    p.full = false
    if (p.madeFull) { p.madeFull = false; if (!p.win.isDestroyed() && p.win.isFullScreen()) p.win.setFullScreen(false) }
    const w = p.player
    if (w && !w.isDestroyed() && w.isFullScreen()) w.setFullScreen(false)
    if (!w) restack(p.win)
    fit(p)
  })
  wc.on("page-favicon-updated", (_e, urls) => void iconFrom(p, urls))

  let mark = ""
  wc.on("dom-ready", () => {
    mark = `${NOTIFY}${crypto.randomUUID()}:`
    void wc.executeJavaScript(notifyShim(mark)).catch(() => {})
  })
  const sent: number[] = []
  const waiting: { title: string; body: string; url: string }[] = []
  let more = 0, timer: ReturnType<typeof setTimeout> | null = null
  const send = (n: { title: string; body: string; url: string }) => {
    sent.push(Date.now())
    tell(p.win, { type: "notify", id: p.id, profile: p.profile, url: n.url, site: siteOf(hostOfUrl(n.url)), title: n.title, body: n.body })
  }
  const drain = () => {
    if (timer) { clearTimeout(timer); timer = null }
    const now = Date.now()
    while (sent.length && now - sent[0] > 60_000) sent.shift()
    while (waiting.length && sent.length < RATE) send(waiting.shift()!)
    if (!waiting.length && more && sent.length < RATE) { send({ title: `${more} more notifications`, body: "", url: wc.isDestroyed() ? "" : wc.getURL() }); more = 0 }
    if ((waiting.length || more) && !timer) timer = setTimeout(drain, sent[0] + 60_000 - now + 50)
  }
  wc.on("destroyed", () => { if (timer) clearTimeout(timer) })
  // (closed by its own script, window.close() in a page window.open made, or by Chromium after a download: its tab too)
  wc.once("destroyed", () => {
    if (pages.get(p.id) !== p) return
    if (p.tab && !p.closing && !p.agent) tell(p.win, { type: "close", tab: p.tab })
    end(p)
  })
  wc.on("console-message", (e) => {
    if (!mark || !e.message.startsWith(mark)) return
    let j: { title?: unknown; body?: unknown }
    try { j = JSON.parse(e.message.slice(mark.length)) } catch { return }
    const text = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "")
    const title = text(j.title, 200), body = text(j.body, 500), url = wc.getURL()
    if (!title && !body) return
    if (waiting.length < QUEUED) waiting.push({ title, body, url }); else more++
    drain()
  })

  // The window doesn't hear the pointer over a page: near its edges and top the page tells it; never one out of sight.
  let atEdge = false, atTop: boolean | null = null, toldTop = 0
  wc.on("before-mouse-event", (_e, m) => {
    if (m.type === "mouseLeave") { if (atTop) tell(p.win, { type: "top", id: p.id, at: false, left: true }); atTop = null }
    if (p.player) { if (m.type === "mouseMove") strips?.pointerAt(p.player, m.y); return }
    if ((m.type !== "mouseMove" && m.type !== "mouseDown") || p.full || p.win.isDestroyed() || !shown(p.spot)) return
    const z = p.win.webContents.getZoomFactor(), b = p.view.getBounds(), [w] = p.win.getContentSize()
    if (m.type === "mouseMove") strips?.pointerAt(p.win, b.y + m.y)
    const top = m.y / z <= TOP, down = m.type === "mouseDown", now = Date.now()
    if (top !== atTop || (top && (down || now - toldTop >= TOP_MS))) {
      atTop = top; toldTop = now
      tell(p.win, { type: "top", id: p.id, at: top, ...(top && down ? { now: true } : {}) })
    }
    if (down) return
    const x = (b.x + m.x) / z, edge = x <= EDGE || x >= w / z - EDGE
    if (!edge && !atEdge) return
    atEdge = edge
    tell(p.win, { type: "pointer", x, y: (b.y + m.y) / z })
  })

  wc.on("before-input-event", (e, i) => {
    if (i.type !== "keyDown") return
    const step = stepOf(i)
    wc.setIgnoreMenuShortcuts(BROWSER_KEYS.has(step))
    if (p.player) { if (step === "escape" && p.player.isFullScreen()) { e.preventDefault(); p.player.setFullScreen(false) } return }
    if (step === "escape" && !p.full && wc.isLoadingMainFrame()) wc.stop()
    const own = OWN_KEYS[step]
    if (own) { e.preventDefault(); go(p, own); return }
    if (step === "mod+l") { e.preventDefault(); tell(p.win, { type: "address", id: p.id }); return }
    if (!step || PAGE_KEYS.has(step) || !keysOf.get(p.win)?.has(step)) return
    e.preventDefault()
    tell(p.win, { type: "key", id: p.id, key: i.key, code: i.code, meta: i.meta, ctrl: i.control, alt: i.alt, shift: i.shift })
  })

  wc.on("context-menu", (_e, c) => {
    const items: MenuItemConstructorOptions[] = []
    const open = (url: string, how: string, container?: string | null) => tell(p.win, { type: "open", id: p.id, tab: p.tab, url, profile: p.profile, how,
      ...(container !== undefined ? { container } : {}) })
    if (c.linkURL && web(c.linkURL)) {
      const link = c.linkURL, text = c.linkText.trim()
      items.push(
        { label: "Open link in new tab", click: () => open(link, "background") },
        ...(menus.containers.length ? [{ label: "Open link in container", submenu: [{ id: "", name: "No container" }, ...menus.containers]
          .map((x): MenuItemConstructorOptions => ({ label: x.name, click: () => open(link, "background", x.id || null) })) }] : []),
        { label: "Open link to the side", click: () => open(link, "side") },
        ...(menus.glance ? [{ label: "Glance", click: () => open(link, "glance") }] : []),
        { label: "Open link in another browser", click: () => openElsewhere(link) },
        { type: "separator" },
        { label: "Copy link", click: () => clipboard.writeText(link) },
        ...(text ? [{ label: "Copy link text", click: () => clipboard.writeText(text) }] : []),
        { type: "separator" },
      )
    }
    if (c.mediaType === "image" && c.srcURL && (web(c.srcURL) || /^data:image\//i.test(c.srcURL))) {
      const src = c.srcURL
      items.push(
        { label: "Save image to vault", click: () => { toVault.add(src); wc.downloadURL(src) } },
        { label: "Download image", click: () => wc.downloadURL(src) },
        { label: "Copy image", click: () => wc.copyImageAt(c.x, c.y) },
        ...(web(src) ? [
          { label: "Copy image address", click: () => clipboard.writeText(src) },
          { label: "Open image in new tab", click: () => open(src, "background") },
        ] : []),
        { type: "separator" },
      )
    }
    if (c.isEditable && c.misspelledWord) {
      const word = c.misspelledWord
      items.push(...c.dictionarySuggestions.slice(0, 5).map((g): MenuItemConstructorOptions => ({ label: g, click: () => wc.replaceMisspelling(g) })),
        ...(c.dictionarySuggestions.length ? [] : [{ label: "No guesses found", enabled: false }]),
        { label: "Add to dictionary", click: () => { wc.session.addWordToSpellCheckerDictionary(word) } }, { type: "separator" })
    }
    const said = c.selectionText.trim().replace(/\s+/g, " "), quoted = said.length > 24 ? `${said.slice(0, 23)}…` : said
    const lookUp: MenuItemConstructorOptions[] = MAC && said ? [{ label: `Look up “${quoted}”`, click: () => wc.showDefinitionForSelection() }] : []
    if (c.isEditable) items.push({ role: "cut" }, { role: "copy" }, { role: "paste" }, ...lookUp, { type: "separator" })
    else if (said) items.push({ role: "copy" }, ...lookUp, { type: "separator" })
    const h = wc.navigationHistory
    if (p.player) items.push({ label: "Back to its tab", click: () => fromPlayer(p, true) }, { type: "separator" })
    else if (strips?.hasStrip(p.win)) {
      const run = (id: string) => () => p.win.webContents.send("vaultite", { type: "command", id })
      items.push({ label: "Show window bars", click: run("window:bars") }, { label: "Keep window on top", type: "checkbox", checked: p.win.isAlwaysOnTop(), click: run("window:on-top") }, { type: "separator" })
    }
    items.push(
      { label: "Back", enabled: canBack(p), click: () => go(p, "back") },
      { label: "Forward", enabled: h.canGoForward(), click: () => go(p, "forward") },
      { label: "Reload", click: () => go(p, "reload") },
      { type: "separator" },
      { label: "Save page to vault", click: () => tell(p.win, { type: "clip", id: p.id }) },
      { label: "Open in another browser", enabled: web(wc.getURL()), click: () => openElsewhere(wc.getURL()) },
      { type: "separator" },
      ...(/^https?:/i.test(wc.getURL()) ? [{ label: "Block element…", click: () => tell(p.win, { type: "block", id: p.id, x: c.x, y: c.y }) }] : []),
      ...(web(wc.getURL()) ? [{ label: "View page source", click: () => go(p, "source") }] : []),
      { label: "Inspect element", click: () => wc.inspectElement(c.x, c.y) },
    )
    Menu.buildFromTemplate(items).popup({ window: p.player ?? p.win })
  })

  if (kept) {
    // (its entry at `index` is the only load. Failed (ERR_ABORTED) with the page on its way, loaded afresh only if nothing
    // came; either way restoring ends with that load: an error page never reaches `index`)
    void wc.navigationHistory.restore({ entries: kept.entries, index: kept.index }).then(restored, () => {
      if (wc.isDestroyed()) return
      if (!wc.getURL() && !wc.isLoading()) void wc.loadURL(url).catch(() => {})
      if (wc.isLoading()) wc.once("did-stop-loading", restored); else restored()
    })
  } else if (!adopt) void wc.loadURL(url).catch(() => { /* did-fail-load says why */ })
  return p
}

/** Off the window but shown: a hidden view stops drawing at its next cross-site load. */
const PARKED = { x: -40000, y: 0, width: 1280, height: 800 }
/** Its spot now (read again after a `move`, which narrowing doesn't see). */
const spotOf = (p: Page): Spot => p.spot
function move(p: Page, e: SpotEvent) {
  if (e.type !== "hide" && p.view.webContents.isDestroyed()) return
  const r = spotStep(p.spot, e)
  p.spot = r.to
  for (const d of r.do) SPOT_DOES[d](p)
}
const SPOT_DOES: Record<SpotEffect, (p: Page) => void> = {
  "show": (p) => p.view.setVisible(true),
  "hide": (p) => p.view.setVisible(false),
  "throttle": (p) => p.view.webContents.setBackgroundThrottling(true),
  "unthrottle": (p) => p.view.webContents.setBackgroundThrottling(false),
  "to-parked": (p) => p.view.setBounds(PARKED),
  "to-fill": (p) => {
    const [width, height] = (p.player ?? p.win).getContentSize()
    round(p, 0)
    p.view.setBounds({ x: 0, y: 0, width, height })
  },
  "to-tab": (p) => {
    if (!p.want) return
    if (keyboardFrom.get(p.win) === p.id) keyboardFrom.delete(p.win)
    // (the window's page may be zoomed, ⌘+: its CSS pixels are that many of the window's)
    const z = p.win.webContents.getZoomFactor(), rect = p.want
    round(p, Math.round((rect.radius ?? 0) * z))
    p.view.setBounds({ x: Math.round(rect.x * z), y: Math.round(rect.y * z), width: Math.round(rect.width * z), height: Math.round(rect.height * z) })
  },
  "raise": (p) => addPage(p.win, p.view),
  "unfocus": (p) => { if (p.view.webContents.isFocused() && !p.win.isDestroyed()) p.win.webContents.focus() },
  "keys-out": (p) => {
    p.hadFocus = p.view.webContents.isFocused()
    if (p.hadFocus) { p.win.webContents.focus(); keyboardFrom.set(p.win, p.id) }
  },
  "see": (p) => void seeDraws(p),
}
async function wake(p: Page) {
  if (p.spot.at === "resting") move(p, { type: "park", now: Date.now() })
  const left = (p.spot.at === "parked" ? p.spot.woke : 0) + 100 - Date.now()
  if (left > 0) await new Promise<void>((done) => setTimeout(done, left))
  if (p.spot.at === "parked" && Date.now() - (p.drew ?? 0) > SEEN_MS) await seeDraws(p)
}
const askPage = (p: Page, code: string, ms: number) => Promise.race([new Promise<null>((done) => setTimeout(done, ms, null)),
  p.view.webContents.executeJavaScriptInIsolatedWorld(1018, [{ code }]).catch(() => null)])
const frameIn = async (p: Page, ms: number) => (await askPage(p, "new Promise((done) => requestAnimationFrame(() => done(true)))", ms)) === true
const SEEN_MS = 5000
const seeDraws = (p: Page) => (p.seeing ??= drawing(p).finally(() => { p.seeing = undefined }))
/** An unthrottled page that stopped drawing for good (Electron on a Mac keeps its widget shown, not its compositor) takes
 *  no press: it's hidden and throttled, then, once its page is hidden, shown unthrottled again, which shows both. */
async function drawing(p: Page) {
  const wc = p.view.webContents
  if (wc.isDestroyed()) return
  if (await frameIn(p, 300)) { p.drew = Date.now(); return }
  if (!p.drawn || p.player || p.spot.at === "resting" || p.spot.at === "hidden" || !p.view.getVisible() || wc.isDestroyed()) return
  const parked = p.spot.at === "parked"
  if (parked) move(p, { type: "rest" })
  else { p.view.setVisible(false); wc.setBackgroundThrottling(true) }
  for (const until = Date.now() + 1000; Date.now() < until;) {
    if (await askPage(p, "document.visibilityState", 200) === "hidden") break
    await new Promise((done) => setTimeout(done, 30))
  }
  if (wc.isDestroyed()) return
  if (parked && spotOf(p).at === "resting") move(p, { type: "park", now: Date.now() })
  else if (!parked && shown(p.spot) && !p.view.getVisible() && !p.player) { wc.setBackgroundThrottling(false); p.view.setVisible(true) }
  await frameIn(p, 1000)
  p.drew = Date.now()
}
const stow = (p: Page) => move(p, { type: "stow", drawn: !!p.drawn, now: Date.now() })

function moveTo(p: Page, win: AppWindow) {
  const from = p.win
  run(from, { type: "gone", page: p.id })
  if (!from.isDestroyed() && !p.player) from.contentView.removeChildView(p.view)
  if (p.full && !p.player) leaveFull(p)
  p.win = win
  move(p, { type: "hide" })
  if (!p.player) addPage(win, p.view)
  if (!from.isDestroyed()) pagesChanged(from)
}

function own(p: Page, tab: string) {
  if (!pages.has(p.id) || p.closing) return
  p.tab = tab
  p.agent = !tab
  if (!tab) { p.want = null; fromPlayer(p); if (p.full) leaveFull(p) }
  fit(p)
  pagesChanged(p.win)
}

function end(p: Page) {
  pages.delete(p.id)
  run(p.win, { type: "gone", page: p.id })
  clearTimeout(p.hush)
  clearTimeout(p.linger)
  fromPlayer(p)
  pagesChanged(p.win)
  keepPast(p, true)
  const shot = keepFrame(p)
  move(p, { type: "hide" })
  const off = () => { if (!p.win.isDestroyed()) p.win.contentView.removeChildView(p.view) }
  const wc = p.view.webContents
  if (!shot) { off(); if (wc) void unload(wc); return }
  void shot.finally(() => { off(); void unload(wc) })
}

/** Close a page as a browser closes a tab: its beforeunload and unload run first (sites save state there, Discord its
 *  sign-in), never asking to stay; 3 s at most. Resolves once it's gone. */
function unload(wc: WebContents) {
  if (wc.isDestroyed()) return Promise.resolve()
  const gone = new Promise<void>((done) => wc.once("destroyed", () => done()))
  unloading.add(wc)
  wc.once("will-prevent-unload", (e) => e.preventDefault())
  wc.close({ waitForBeforeUnload: true })
  const hard = setTimeout(() => { if (!wc.isDestroyed()) wc.close() }, 3000)
  return gone.finally(() => clearTimeout(hard))
}

const unloading = new WeakSet<WebContents>()
const reloaded = new WeakMap<WebContents, number>()
/** Whether a page asking to stay (its beforeunload) leaves: at once with nobody to ask (`quiet`, closing), else as the
 *  user answers Chrome's question, the page waiting (Electron takes the answer synchronously). */
function mayLeave(wc: WebContents, win: BaseWindow, quiet: boolean) {
  if (quiet || unloading.has(wc) || win.isDestroyed()) return true
  const reload = Date.now() - (reloaded.get(wc) ?? 0) < 2000
  return dialog.showMessageBoxSync(win, { type: "question", message: reload ? "Reload site?" : "Leave site?", detail: "Changes you made may not be saved.",
    buttons: [reload ? "Reload" : "Leave", "Cancel"], defaultId: 0, cancelId: 1, noLink: true }) === 0
}

export const unloadPages = async () => {
  for (const p of pages.values()) keepPast(p, true)
  restoreMod?.savePasts()
  await Promise.race([Promise.all([...pages.values()].filter((p) => shown(p.spot)).map(keepFrame)), new Promise((done) => setTimeout(done, 800))])
  return Promise.all([...pages.values()].map((p) => { p.closing = true; return unload(p.view.webContents) })).then(() => {})
}

async function trim() {
  const keep = (p: Page) => !!p.player || playingNow(p) || pageKept(p.id)
  if ((!spare && !discardable(pages.values(), keep).length) || !(await shortOfMemory())) return
  endSpare()
  for (const p of discardable(pages.values(), keep)) end(p)
}
setInterval(() => void trim(), 60_000).unref()

function shortOfMemory(): Promise<boolean> {
  if (process.platform === "win32") return Promise.resolve(os.freemem() / os.totalmem() < 0.1)
  if (MAC) return new Promise((done) => execFile("/usr/sbin/sysctl", ["-n", "kern.memorystatus_vm_pressure_level"], { timeout: 2000 }, (e, out) => done(!e && Number(out) >= 2)))
  try {
    const m = fs.readFileSync("/proc/meminfo", "utf8"), kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(m)?.[1] ?? 0)
    return Promise.resolve(kb("MemTotal") > 0 && kb("MemAvailable") / kb("MemTotal") < 0.1)
  } catch { return Promise.resolve(false) }
}

const keyboardFrom = new WeakMap<AppWindow, number>()

function place(p: Page, rect: WebRect | null) {
  p.want = rect && rect.width >= 2 && rect.height >= 2 ? rect : null
  fit(p)
}

function fit(p: Page) {
  const fill = p.player ?? (p.full ? p.win : null)
  if (fill?.isDestroyed()) return
  const held = pageHeld(p.id)
  if (held) p.drawn = true
  move(p, { type: "fit", fill: !!fill, rect: !p.agent && !held && !!p.want, drawn: !!p.drawn, now: Date.now() })
}
const round = (p: Page, r: number) => { if ((p.radius ?? 0) !== r) { p.radius = r; p.view.setBorderRadius(r) } }

function go(p: Page, action: string, url?: string): unknown {
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

const unsafeOk = new Set<string>()


const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]
let zooms: Record<string, number> | null = null
const zoomFile = () => path.join(app.getPath("userData"), "web-zoom.json")
function zoomsKept() {
  if (!zooms) { try { zooms = ZOOM_FILE.parse(JSON.parse(fs.readFileSync(zoomFile(), "utf8"))) } catch { zooms = {} } }
  return zooms
}
const zoomOf = (host: string) => { const z = zoomsKept()[host]; return typeof z === "number" && z >= ZOOMS[0] && z <= ZOOMS[ZOOMS.length - 1] ? z : 1 }
const zoomTo = (p: Page, z: number) => { const wc = p.view.webContents; if (!wc.isDestroyed() && Math.abs(wc.getZoomFactor() - z) > 0.001) wc.setZoomFactor(z) }
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

// ---------- players: a call's window picker finds one by its title ----------

let kit: typeof import("./player.ts") | undefined
const playerKit = async () => { await stripKit(); return (kit ??= await import("./player.ts")) }
let strips: typeof import("./topstrip.ts") | undefined, popups: typeof import("./popup.ts") | undefined
export const stripKit = async () => (strips ??= await import("./topstrip.ts"))
let napBlock: number | null = null
const players = () => [...pages.values()].some((p) => p.player)

function leaveFull(p: Page) {
  if (!p.view.webContents.isDestroyed()) void p.view.webContents.executeJavaScriptInIsolatedWorld(1004, [{ code: "document.fullscreenElement && void document.exitFullscreen().catch(() => {})" }]).catch(() => {})
}

async function toPlayer(p: Page, fullScreen: boolean) {
  if (p.player) { if (!p.player.isDestroyed()) { p.player.show(); p.player.focus() } return }
  const wc = p.view.webContents
  if (wc.isDestroyed() || p.win.isDestroyed()) return
  if (p.full) leaveFull(p)
  const k = await playerKit()
  const [css, found] = await Promise.all([wc.insertCSS(k.FILL_CSS, { cssOrigin: "user" }).catch(() => undefined),
    wc.executeJavaScriptInIsolatedWorld(1004, [{ code: k.FILL }], true).catch(() => null), wc.executeJavaScript(k.FULL_GUARD).catch(() => {})])
  const aspect = typeof found === "number" && found > 0.2 && found < 5 ? found : null
  if (p.player || wc.isDestroyed() || p.win.isDestroyed() || !pages.has(p.id)) { if (css && !p.player) void wc.removeInsertedCSS(css).catch(() => {}); return }
  const w = k.playerWindow(k.placeFor(aspect ?? 16 / 9, p.win.getBounds()), () => [{ label: "Back to its tab", click: () => fromPlayer(p, true) }])
  p.player = w
  p.fillCss = css
  if (aspect) w.setAspectRatio(aspect)
  p.win.contentView.removeChildView(p.view)
  w.contentView.addChildView(p.view)
  wc.setBackgroundThrottling(false)
  // (as its content is laid out: on Linux its menu bar comes and goes with no resize)
  w.contentView.on("bounds-changed", () => fit(p))
  w.on("leave-full-screen", () => { if (p.full) leaveFull(p) })
  w.on("close", () => fromPlayer(p, true))
  fit(p)
  w.show()
  if (fullScreen) w.setFullScreen(true)
  wc.focus()
  napBlock ??= powerSaveBlocker.start("prevent-app-suspension")
  sendState(p)
  pagesChanged(p.win)
  void follow(p, w)
}

async function follow(p: Page, w: BaseWindow) {
  while (p.player === w) {
    const a = await p.view.webContents.executeJavaScriptInIsolatedWorld(1004, [{ code: "window.__vaultitePlayer?.next()" }]).catch(() => undefined)
    if (p.player !== w || typeof a !== "number" || !(a > 0.2 && a < 5)) return
    kit?.setAspect(w, a)
  }
}

function fromPlayer(p: Page, user = false) {
  const w = p.player
  if (!w) return
  p.player = undefined
  // (none once the page is gone: `end` from its destroyed, where a throw would skip `unload`'s listener and hang a quit)
  const wc = p.view.webContents
  if (wc && !wc.isDestroyed()) {
    wc.setBackgroundThrottling(!p.drawn)
    if (kit) void wc.executeJavaScriptInIsolatedWorld(1004, [{ code: kit.UNFILL }]).catch(() => {})
    if (p.fillCss) void wc.removeInsertedCSS(p.fillCss).catch(() => {})
  }
  p.fillCss = undefined
  if (!w.isDestroyed()) { w.contentView.removeChildView(p.view); setImmediate(() => { if (!w.isDestroyed()) w.close() }) }
  if (pages.has(p.id) && !p.win.isDestroyed()) {
    move(p, { type: "hide" })
    p.want = null
    addPage(p.win, p.view)
    if (p.drawn) move(p, { type: "park", now: Date.now() })
    sendState(p)
    pagesChanged(p.win)
    if (user) { p.win.show(); p.win.focus() }
  }
  if (napBlock !== null && !players()) { powerSaveBlocker.stop(napBlock); napBlock = null }
}

const str = (x: unknown) => { if (typeof x !== "string") throw new Error("expected text"); return x }
const tabOf = (x: unknown) => (typeof x === "string" && /^[\w-]{1,64}$/.test(x) ? x : "")
function mine(win: AppWindow, id: unknown) {
  const p = pages.get(Number(id))
  if (!p || p.win !== win) throw new Error("no such page")
  return p
}

export function revive(wc: WebContents, gone?: () => void, giveUp?: () => void) {
  let times: number[] = []
  wc.on("render-process-gone", (_e, d) => {
    if (d.reason === "clean-exit" || wc.isDestroyed()) return
    gone?.()
    const now = Date.now()
    times = times.filter((t) => now - t < 60_000)
    console.error(`vaultite: a page's process ended (${d.reason}, exit ${d.exitCode}): ${times.length < 3 ? "reloading" : "left, it keeps ending"}`)
    if (times.length >= 3) return giveUp?.()
    times.push(now)
    setTimeout(() => { if (!wc.isDestroyed()) wc.reload() }, 300)
  })
}

export function webWindow(win: AppWindow) {
  win.contentView.on("bounds-changed", () => { for (const p of pages.values()) if (p.win === win && p.full && !p.player) fit(p) })
  win.on("leave-full-screen", () => { for (const p of pages.values()) if (p.win === win && p.full && !p.player) leaveFull(p) })
  win.on("focus", () => { for (const p of pages.values()) if (p.win === win && p.drawn && shown(p.spot)) void seeDraws(p) })
  win.on("closed", () => {
    for (const p of [...pages.values()]) if (p.win === win && p.moving === undefined) end(p)
    if (!pages.size) endSpare()
  })
  win.webContents.on("did-start-navigation", (d) => {
    if (!d.isMainFrame || d.isSameDocument) return
    raise(win, null)
    for (const p of pages.values()) if (p.win === win && !p.player) { if (p.full) leaveFull(p); p.want = null; stow(p) }
    for (const p of windowReloaded(pages.values(), win, Date.now())) end(p)
    setTimeout(() => { for (const p of unclaimed(pages.values(), Date.now(), (x) => pageKept(x.id))) end(p) }, RECLAIM_MS + 100)
  })
}

setOpener(async (win, url, profile) => {
  await engineLoaded()
  if (!shows(url)) throw new Error("only http and https pages")
  await readySession(profile)
  if (!mayOpen(profile)) throw new Error("this container is locked")
  const p = make(win as AppWindow, url, profile, "", { agent: true, ready: await readyView(profile) })
  pagesChanged(p.win)
  return allPages().find((x) => x.id === p.id)!
})

let menus: { containers: { id: string; name: string }[]; glance: boolean } = { containers: [], glance: false }
const tellGlance = (wc: WebContents) => { if (!wc.isDestroyed()) wc.send("vaultite:web:glance", menus.glance) }
handle("web:menus", (_win, m) => {
  const o = MENUS.parse(m)
  const containers = o.containers.flatMap((x) => { const c = CONTAINER.safeParse(x); return c.success && profileOf(c.data.id) ? [{ id: c.data.id, name: c.data.name.slice(0, 80) }] : [] }).slice(0, 50)
  const glance = o.glance === true, changed = glance !== menus.glance
  menus = { containers, glance }
  if (changed) for (const p of pages.values()) tellGlance(p.view.webContents)
})
ipcMain.on("vaultite:web:glance", (e, url) => {
  const p = pageOf(e.sender)
  if (p && !p.agent && menus.glance && e.senderFrame === e.sender.mainFrame && typeof url === "string" && web(url)) {
    tell(p.win, { type: "open", id: p.id, tab: p.tab, url, profile: p.profile, how: "glance" })
  }
})
handle("web:adopt", (win, id, tab) => {
  const p = pages.get(Number(id)), to = tabOf(tab)
  if (!p || p.win !== win || p.closing || !to || p.agent) throw new Error("that page is gone")
  p.orphan = undefined
  own(p, to)
  if (p.downloaded) tell(p.win, { type: "close", tab: to })
})


let restoreMod: typeof import("./webrestore.ts") | null = null
const restore = async () => (restoreMod ??= await import("./webrestore.ts"))
function keepPast(p: Page, settle = false) {
  const wc = p.view.webContents
  if (!p.tab || p.agent || !wc || wc.isDestroyed() || p.blankBehind || p.restoring || !restoreMod) return
  const h = wc.navigationHistory
  restoreMod.keepPast(p.tab, p.profile, h.getAllEntries(), h.getActiveIndex(), shows, settle)
}
const FRAME_MS = 1500
function keepFrame(p: Page): Promise<void> | null {
  const wc = p.view.webContents
  if (!p.tab || p.agent || p.fresh || p.error || p.crashed || !wc || wc.isDestroyed() || p.win.isDestroyed() || !shows(wc.getURL()) || !mayPicture(p.profile)) return null
  const tab = p.tab, b = p.view.getBounds(), z = p.win.webContents.getZoomFactor()
  const f = { url: wc.getURL(), profile: p.profile, width: Math.round(b.width / z), height: Math.round(b.height / z) }
  if (b.width < 2 || b.height < 2) return null
  // (bounded: on Linux a page just back from its closing player never gets its capture, and its close waits on this)
  const img = Promise.race([wc.capturePage(), new Promise<null>((r) => setTimeout(r, FRAME_MS, null).unref())])
  return img.then(async (i) => { if (i) (await restore()).keepFrame(tab, i, f) }).catch(() => {})
}

let cloudLoaded: Promise<ReturnType<typeof import("./cloud.ts").cloudHandlers>> | null = null
const cloudNow = () => (cloudLoaded ??= import("./cloud.ts").then(({ cloudHandlers }) => cloudHandlers({
  page: (profile, site) => [...pages.values()].find((p) => p.profile === profile && !p.view.webContents.isDestroyed() && siteOf(hostOfUrl(p.view.webContents.getURL())) === site)?.view.webContents,
  session: readySession,
  used: (profile) => sessions.has(profile) || fs.existsSync(path.join(app.getPath("userData"), "Partitions", partitionOf(profile).replace(/^persist:/, ""))),
  tell, profileOf,
})))
const cloud = {
  "web:cloud": async (win: AppWindow, want: unknown) => (await cloudNow())["web:cloud"](win, want),
  "web:cloud-act": async (win: AppWindow, action: unknown, id: unknown, value: unknown) => (await cloudNow())["web:cloud-act"](win, action, id, value),
}

const closedTabs = new WeakMap<AppWindow, Map<string, number>>()
export const webHandlers: Record<string, (win: AppWindow, ...args: unknown[]) => unknown> = {
  "web:open": async (win, url, rect, profile, tab) => {
    const asked = Date.now()
    await Promise.all([engineLoaded(), restore()])
    const u = str(url), prof = profileOf(profile), owner = tabOf(tab)
    if (!shows(u)) throw new Error("only http and https pages")
    await readySession(prof)
    if (!mayOpen(prof)) throw new Error("this container is locked")
    if (owner && (closedTabs.get(win)?.get(owner) ?? 0) >= asked) throw new Error("its tab closed")
    const { reuse, end: other } = claim(pages.values(), win, owner, prof)
    for (const x of other) { keepPast(x); end(x) }
    const p = reuse ?? make(win, u, prof, owner)
    if (p.win !== win) moveTo(p, win)
    p.holds++
    p.orphan = undefined
    pagesChanged(win)
    const r = RECT.safeParse(rect).data ?? null, wasHidden = !shown(p.spot)
    place(p, r)
    let focused = false
    if (r && wasHidden && shown(p.spot)) { focused = !!p.hadFocus; p.hadFocus = false }
    return { id: p.id, state: stateOf(p), focused }
  },
  "web:frame": async (win, tab, url, profile) => {
    const m = await restore(), t = tabOf(tab), f = m.frameFor(t, str(url), profileOf(profile))
    if (!f || [...pages.values()].some((p) => p.win === win && p.tab === t && !p.closing && !p.fresh)) return null
    return m.readFrame(t, f)
  },
  "web:titles": async () => (await restore()).pastTitles(),
  "web:place": (win, id, rect) => {
    const p = mine(win, id), r = mayOpen(p.profile) ? RECT.safeParse(rect).data ?? null : null, wasHidden = !shown(p.spot)
    place(p, r)
    if (r && wasHidden && shown(p.spot)) { const had = !!p.hadFocus; p.hadFocus = false; return { focused: had, shown: true } }
    return { focused: false, shown: shown(p.spot) }
  },
  "web:take": (win) => {
    const p = [...pages.values()].find((x) => x.win === win && x.view.webContents.isFocused())
    if (p) win.webContents.focus()
    const from = p?.id ?? keyboardFrom.get(win) ?? null
    keyboardFrom.delete(win)
    return from
  },
  "web:look": (win, color) => {
    const c = str(color)
    if (!/^#[0-9a-f]{6}$/i.test(c)) return
    looks.set(win, c)
    for (const p of pages.values()) if (p.win === win && p.fresh) p.view.setBackgroundColor(c)
  },
  "web:raise": (win, how) => raise(win, RAISE.parse(how)),
  "web:pointer": (win, id, m) => { const e = PASSED.safeParse(m); if (e.success) pointer(mine(win, id), e.data) },
  "web:release": (win, id) => {
    const p = pages.get(Number(id))
    if (!p || p.win !== win) return
    if (letGo(p, Date.now())) return end(p)
    if (p.holds) return
    p.want = null
    if (p.full && !p.player) leaveFull(p)
    if (!p.player) stow(p)
    void trim()
    pagesChanged(win)
  },
  "web:player": (win, id, on, fullScreen) => { const p = mine(win, id); if (on) return toPlayer(p, fullScreen === true); fromPlayer(p, true) },
  "web:close": (win, tab, moved) => {
    if (moved !== true) {
      const closed = closedTabs.get(win) ?? new Map<string, number>()
      closedTabs.set(win, closed)
      if (tabOf(tab)) closed.set(tabOf(tab), Date.now())
      for (const [t, at] of closed) if (Date.now() - at > 60_000) closed.delete(t)
      for (const p of pages.values()) if (p.win === win && p.tab && p.tab === tabOf(tab) && pageKept(p.id)) void engineCall(win, "agents:own", [p.id, ""]).catch(() => {})
      for (const p of tabGone(pages.values(), win, tabOf(tab))) end(p)
      return
    }
    tabMoved(pages.values(), win, tabOf(tab), Date.now())
    setTimeout(() => { for (const p of unmoved(pages.values(), Date.now())) end(p) }, MOVE_MS + 100).unref()
  },
  "web:go": (win, id, action, url) => go(mine(win, id), str(action), typeof url === "string" ? url : undefined),
  "web:find": (win, id, text, o) => {
    const wc = mine(win, id).view.webContents, t = str(text).slice(0, 1000), x = FIND.parse(o)
    if (!t) { wc.stopFindInPage("keepSelection"); return null }
    return wc.findInPage(t, { forward: x.forward !== false, findNext: x.next !== true, matchCase: x.matchCase === true })
  },
  "web:shot": async (win, id) => {
    const p = mine(win, id)
    if (!shown(p.spot)) return null
    const img = await p.view.webContents.capturePage()
    return img.isEmpty() ? null : img.toJPEG(90)
  },
  "web:html": async (win, id) => {
    const p = mine(win, id)
    // In a world of its own: the page's scripts can't stand in for what's read.
    const r = await p.view.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: "({ url: location.href, title: document.title, html: '<!doctype html>' + document.documentElement.outerHTML })" }])
    return PAGE_HTML.parse(r)
  },
  "web:external": (_win, url) => { const u = str(url); if (web(u)) openElsewhere(u); else if (/^mailto:/i.test(u)) void shell.openExternal(u) },
  "web:keys": (win, steps) => { keysOf.set(win, new Set(Array.isArray(steps) ? steps.filter((s): s is string => typeof s === "string") : [])) },
  "web:list": (win) => [...pages.values()].filter((p) => p.win === win && !p.closing)
    .map((p) => ({ id: p.id, profile: p.profile, tab: p.tab, shown: p.holds > 0, ...stateOf(p) })),
  "web:sites": (_win, profile) => sitesOf(profileOf(profile)),
  "web:who": (_win, site, profiles) => whoIn(str(site), Array.isArray(profiles) ? profiles.map(profileOf).filter(Boolean).slice(0, 40) : []),
  "web:forget": async (_win, profile, site) => forgetSite(profileOf(profile), str(site).toLowerCase()),
  "web:move": (_win, from, to, sites, copy) => moveLogins(profileOf(from), profileOf(to),
    SITES.parse(sites), copy === true),
  "web:seal": (_win, from, sites, to, key) => sealLogin(profileOf(from), SITES.parse(sites), profileOf(to), str(key)),
  ...cloud,
  "web:icons": (_win, hosts) => {
    const all = loadIcons(), keys = (Array.isArray(hosts) ? hosts : []).slice(0, 500).filter((h): h is string => typeof h === "string")
    for (const h of keys) if (!h.includes("/") && /^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?$|^localhost(:\d+)?$/i.test(h) && (!all.has(h) || staleIcons.has(h))) void hostIcon(webSession(""), h)
    return Object.fromEntries(keys.map((h) => [h, all.get(h) ?? ""]))
  },
  "web:engine": (win, name, ...args) => engineCall(win, name, args),
  "web:reveal": (_win, p) => {
    const file = path.resolve(str(p))
    if (path.dirname(file) === app.getPath("downloads") && fs.existsSync(file)) shell.showItemInFolder(file)
  },
  "web:downloads": async () => (await loadDownloads()).downloads(),
  "web:download": async (_win, id, what) => {
    const m = await loadDownloads()
    return typeof id === "number" ? m.act(id, str(what)) : what === "clear" ? (m.clearDownloads(), true) : what === "folder" ? (m.openDownloadsFolder(), true) : false
  },
}



const accounts = new Map<string, { at: number; login: string; who: Who | null }>()
const ASK_NAMED = 6 * 3_600_000, ASK_UNNAMED = 30 * 60_000, ASK_LOOK = 60_000

let known: Known | null = null
const knownFile = () => path.join(app.getPath("userData"), "web-accounts.json")
function loadKnown(): Known {
  if (!known) { try { known = KNOWN.parse(JSON.parse(fs.readFileSync(knownFile(), "utf8"))) } catch { known = {} } }
  return known
}
function keepKnown(profile: string, site: string, login: string, who: Who | null) {
  const k = loadKnown(), had = k[profile]?.[site]
  if (who ? had?.login === login && JSON.stringify(had.who) === JSON.stringify(who) && Date.now() - (had.at ?? 0) < ASK_NAMED / 2 : !had) return
  if (who) (k[profile] ??= {})[site] = { login, who, at: Date.now() }
  else delete k[profile]?.[site]
  try { writeAtomic(knownFile(), JSON.stringify(k)) } catch { /* asked again next time */ }
}
const loginHash = (value: string) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)
function loginOf(how: Rule, mine: Electron.Cookie[], login?: Electron.Cookie) {
  if (login) return loginHash(login.value)
  return how.url || how.read ? loginHash(mine.map((c) => c.name).sort().join(" ")) : "look"
}

async function accountOf(profile: string, site: string, cookies: Electron.Cookie[]): Promise<Who | null> {
  const how = ACCOUNTS[site]
  if (!how) return null
  const key = `${profile} ${site}`, now = Date.now()
  const mine = cookies.filter((c) => siteOf(c.domain ?? "") === site)
  const login = how.signed ? mine.find((c) => c.name.startsWith(how.signed!) && c.value) : undefined
  if (how.signed && !login) { accounts.set(key, { at: now, login: "", who: null }); keepKnown(profile, site, "", null); return null }
  const id = loginOf(how, mine, login), lookOnly = id === "look"
  const open = [...pages.values()].find((p) => p.profile === profile && !p.view.webContents.isDestroyed() && siteOf(hostOfUrl(p.view.webContents.getURL())) === site)
  const had = accounts.get(key), kept = loadKnown()[profile]?.[site]
  const wait = lookOnly ? ASK_LOOK : had?.who?.account ? ASK_NAMED : ASK_UNNAMED
  if (had && (had.login === id ? now - had.at < wait : now - had.at < ASK_LOOK)) return had.who
  if (!had && !lookOnly && kept?.login === id && now - (kept.at ?? 0) < ASK_NAMED) { accounts.set(key, { at: kept.at!, login: id, who: kept.who }); return kept.who }
  if (lookOnly && !open) return kept?.who ?? null // (as an open page last showed it)

  const s = webSession(profile)
  const found = await askWho(s, how, open).catch(() => null)
  let who: Who | null = null
  if (found === false) keepKnown(profile, site, "", null)
  else if (found?.account) {
    who = { account: found.account.slice(0, 200), ...(found.more?.length ? { more: found.more.map((m) => m.slice(0, 200)).slice(0, 9) } : {}) }
    const pic = found.avatar && /^https:\/\//.test(found.avatar) ? await iconBytes(s, found.avatar).then((b) => b && iconOf(b), () => null) : null
    if (pic && isIcon(pic)) who.avatar = pic
    keepKnown(profile, site, id, who)
  }
  else if (kept?.login === id && (!lookOnly || found === null)) who = kept.who
  else if (found || login) who = { account: "" }
  accounts.set(key, { at: now, login: id, who })
  return who
}

/** What a site's rule finds: who (an empty account: signed in, not named), false: signed out, null: it can't tell. */
async function askWho(s: Electron.Session, how: Rule, open: Page | undefined): Promise<Who | false | null> {
  const inPage = <T>(code: string, as: z.ZodType<T>) => open!.view.webContents.executeJavaScriptInIsolatedWorld(1002, [{ code }]).then((v) => as.parse(v))
  const cookie = async (domain: string, name: string) => (await s.cookies.get({ domain, name }).catch(() => []))[0]?.value ?? ""
  if (how.look && open) {
    const w = how.look.read(await inPage(how.look.code, z.unknown()).catch(() => null))
    if (w !== null || !how.read) return w
  }
  if (!how.read) return null
  let res: z.infer<typeof FETCHED> = null
  if (how.url) {
    const as = how.text ? "text" : "json", headers = { accept: how.text ? "text/html,*/*" : "application/json", ...how.headers }
    if (how.page && open && !how.method) res = await inPage(`fetch(${JSON.stringify(how.url)}, { credentials: "include", headers: ${JSON.stringify(headers)} })
      .then(async (r) => r.ok ? { url: r.url, body: await r.${as}() } : null).catch(() => null)`, FETCHED).catch(() => null)
    res ??= await s.fetch(how.url, { method: how.method ?? "GET", credentials: "include", signal: AbortSignal.timeout(8000), headers })
      .then(async (r) => (r.ok ? { url: r.url, body: await (as === "text" ? r.text() : r.json()) } : null)).catch(() => null)
    if (!res?.body) return null
  }
  const v = await how.read(res?.body ?? null, cookie, res?.url ?? "")
  return typeof v === "string" ? (v ? { account: v } : null) : v && nonempty(v.account) ? { ...v, account: nonempty(v.account) } : null
}

async function sitesOf(profile: string): Promise<WebSite[]> {
  const cookies = await (await readySession(profile)).cookies.get({})
  const names = [...new Set(cookies.map((c) => siteOf(c.domain ?? "")).filter(Boolean))]
  const been = visitedOf(profile)
  for (const p of pages.values()) if (p.profile === profile) been.add(siteOf(hostOfUrl(p.view.webContents.getURL())))
  const last = new Map<string, number>()
  for (const [host, at] of lastVisits(profile)) { const site = siteOf(host); if (at > (last.get(site) ?? 0)) last.set(site, at) }
  const out = await Promise.all(names.map(async (site): Promise<WebSite> => {
    const who = await accountOf(profile, site, cookies)
    const at = last.get(site)
    return { site, ...(who ? { signed: true, ...who, account: who.account || undefined } : {}), ...(at ? { last: at } : {}), ...(!who && !been.has(site) ? { other: true } : {}) }
  }))
  const joined = new Set<string>()
  for (const s of out) {
    const also = s.signed ? ACCOUNTS[s.site]?.with : undefined
    if (!also) continue
    const sites = names.filter((site) => site !== s.site && Object.entries(also).some(([k, name]) => covers(k, site) && cookies.some((c) => siteOf(c.domain ?? "") === site && c.name === name)))
    if (!sites.length) continue
    s.with = sites
    for (const x of sites) { joined.add(x); s.last = Math.max(s.last ?? 0, last.get(x) ?? 0) || undefined }
  }
  return out.filter((s) => !joined.has(s.site))
    .sort((a, b) => Number(!b.signed) - Number(!a.signed) || (b.last ?? 0) - (a.last ?? 0) || a.site.localeCompare(b.site))
}

const WHO_MS = 1500
async function whoIn(site: string, profiles: string[]): Promise<Record<string, { account: string; more?: string[] } | null>> {
  const name = ACCOUNTS[site] ? site : Object.keys(ACCOUNTS).find((k) => Object.keys(ACCOUNTS[k].with ?? {}).some((w) => covers(w, site)))
  const used = (p: string) => sessions.has(p) || fs.existsSync(path.join(app.getPath("userData"), "Partitions", partitionOf(p).replace(/^persist:/, "")))
  const out: Record<string, { account: string; more?: string[] } | null> = {}
  await Promise.all([...new Set(profiles)].map(async (p) => {
    if (!name || !used(p) || !mayOpen(p)) return void (out[p] = null)
    const cookies = await (await readySession(p)).cookies.get({ domain: name }).catch(() => [])
    const late = new Promise<Who | null>((r) => setTimeout(() => r(loadKnown()[p]?.[name]?.who ?? null), WHO_MS).unref())
    const who = cookies.length ? await Promise.race([accountOf(p, name, cookies).catch(() => null), late]) : null
    out[p] = who ? { account: who.account, ...(who.more?.length ? { more: who.more } : {}) } : null
  }))
  return out
}

async function forgetSite(prof: string, name: string) {
  const s = await readySession(prof)
  for (const c of await s.cookies.get({})) {
    const host = (c.domain ?? "").replace(/^\./, "")
    if (siteOf(host) !== name) continue
    await s.cookies.remove(`http${c.secure ? "s" : ""}://${host}${c.path ?? "/"}`, c.name).catch(() => {})
  }
  // (an address's site, 127.0.0.1, has no www.: clearData throws on an origin it can't parse)
  const origins = /^[\d.]+$|^localhost$/.test(name) ? [`http://${name}`, `https://${name}`] : [`https://${name}`, `https://www.${name}`]
  await Promise.resolve().then(() => s.clearData({ origins, dataTypes: ["cookies", "localStorage", "indexedDB", "serviceWorkers", "cache", "fileSystems"] })).catch(() => {})
  accounts.delete(`${prof} ${name}`)
  keepKnown(prof, name, "", null)
  for (const k of Object.keys(loadAnswers()[prof]?.[name] ?? {})) answer(prof, name, k, null) // what it may use is asked again
  reloadSite(prof, name)
}
const reloadSite = (prof: string, name: string) => {
  for (const p of pages.values()) if (p.profile === prof && siteOf(hostOfUrl(p.view.webContents.getURL())) === name) p.view.webContents.reload()
}

/** cookies.set for a cookie read from another session: a host-only one names no domain (a __Host- one must not). */
const setOfCookie = (c: Electron.Cookie): Electron.CookiesSetDetails => ({
  url: `${c.secure ? "https" : "http"}://${(c.domain ?? "").replace(/^\./, "")}${c.path || "/"}`, name: c.name, value: c.value,
  path: c.path || "/", secure: !!c.secure, httpOnly: !!c.httpOnly, sameSite: c.sameSite,
  ...(c.hostOnly ? {} : { domain: c.domain }), ...(c.session || !c.expirationDate ? {} : { expirationDate: c.expirationDate }) })
async function setCookies(s: Session, list: Electron.Cookie[]) {
  let failed = 0
  for (const c of list) await s.cookies.set(setOfCookie(c)).catch(() => { failed++ })
  return failed
}
async function dropCookies(s: Session, names: string[]) {
  for (const c of await s.cookies.get({})) {
    if (!names.includes(siteOf(c.domain ?? ""))) continue
    await s.cookies.remove(`http${c.secure ? "s" : ""}://${(c.domain ?? "").replace(/^\./, "")}${c.path ?? "/"}`, c.name).catch(() => {})
  }
}

type Leaving = { names: string[]; cookies: Electron.Cookie[]; account: string | null; known: Record<string, { login: string; who: Who }>; visited: string[] }

async function loginOut(from: string, names: string[]): Promise<Leaving> {
  if (!names.length) throw new Error("nothing to move")
  if (!mayOpen(from)) throw new Error("this container is locked")
  const src = await readySession(from)
  const cookies = (await src.cookies.get({})).filter((c) => names.includes(siteOf(c.domain ?? "")))
  if (!cookies.length) throw new Error("no cookies to move")
  const how = ACCOUNTS[names[0]]
  const before = (how?.url ? await askWho(src, how, undefined).catch(() => null) : null) || null
  const known: Leaving["known"] = {}
  for (const n of names) { const k = loadKnown()[from]?.[n]; if (k) known[n] = { login: k.login, who: k.who } }
  return { names, cookies, account: before?.account ?? null, known, visited: names.filter((n) => visitedOf(from).has(n)) }
}

async function loginIn(to: string, l: Leaving): Promise<{ ok: boolean; account?: string }> {
  if (!mayOpen(to)) throw new Error("this container is locked")
  const { names } = l, dst = await readySession(to)
  const had = (await dst.cookies.get({})).filter((c) => names.includes(siteOf(c.domain ?? "")))
  const how = ACCOUNTS[names[0]]
  await dropCookies(dst, names)
  if (await setCookies(dst, l.cookies) > l.cookies.length / 2) { await dropCookies(dst, names); await setCookies(dst, had); throw new Error("couldn't set its cookies") }
  if (l.account && how) {
    const after = await askWho(dst, how, undefined).catch(() => null)
    if (!after || after.account !== l.account) {
      await dropCookies(dst, names)
      await setCookies(dst, had)
      return { ok: false, account: l.account }
    }
  }
  for (const n of names) {
    accounts.delete(`${to} ${n}`)
    const k = l.known[n]
    if (k) keepKnown(to, n, k.login, k.who)
  }
  addVisited(to, l.visited.concat(names[0]))
  for (const n of names) reloadSite(to, n)
  return { ok: true, account: l.account ?? undefined }
}

async function moveLogins(from: string, to: string, names: string[], copy: boolean): Promise<{ ok: boolean; account?: string }> {
  if (from === to) throw new Error("nothing to move")
  if (!mayOpen(to)) throw new Error("this container is locked")
  const r = await loginIn(to, await loginOut(from, names))
  if (r.ok && !copy) for (const n of names) await forgetSite(from, n)
  return r
}


// A login leaves only sealed for the other app (browser/sealed.ts), on the user's act in this window; taking one in
// (remote:take) the server may ask: like an agent signing in, it adds a login of the sites named and reads none.

const SEALED_MS = 5 * 60_000
const taken = new Map<string, number>()

/** This app's key pair for sealed logins, made once and kept encrypted with the keyring's key (userData). With no keyring
 *  (a Linux without a Secret Service), held only till the app quits, as agents' logins are (browser/logins.ts). */
let sealKeys: { pub: string; priv: string } | null = null
function keysForSealing() {
  if (sealKeys) return sealKeys
  if (!safeStorage.isEncryptionAvailable()) return (sealKeys = newKeys())
  const file = path.join(app.getPath("userData"), "Login Key.vaultite")
  try { sealKeys = SEAL_KEYS.parse(JSON.parse(safeStorage.decryptString(fs.readFileSync(file)))) }
  catch {
    sealKeys = newKeys()
    fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(sealKeys)), { mode: 0o600 })
  }
  return sealKeys
}

const sealedFor = (to: string) => `vaultite login for ${to}`

handle("remote:key", () => ({ key: keysForSealing().pub }))
handle("remote:sites", async (_win, profiles) => {
  const out: Record<string, WebSite[]> = {}
  for (const p of new Set((Array.isArray(profiles) ? profiles : []).slice(0, 50).map(profileOf))) {
    if (!mayOpen(p)) continue
    const sites = (await sitesOf(p)).filter((s) => !s.other) // (trackers stay this Mac's business)
    if (sites.length) out[p] = sites
  }
  return out
})
handle("remote:take", async (_win, to, sealed) => {
  const prof = profileOf(to)
  const { data, from } = openSealed(keysForSealing(), str(sealed).slice(0, 4 << 20), sealedFor(prof))
  const d = SEALED_LOGIN.parse(data)
  const now = Date.now()
  for (const [k, at] of taken) if (now - at > SEALED_MS) taken.delete(k)
  if (typeof d.at !== "number" || Math.abs(now - d.at) > SEALED_MS) throw new Error("the login took too long to come: copy it again")
  if (taken.has(from)) throw new Error("that login was copied here already")
  taken.set(from, now)
  const names = d.names ?? []
  const cookies = cookiesFrom(d.cookies ?? [], names)
  if (!names.length || !cookies.length) throw new Error("no cookies to move")
  const known = knownFrom(d.known ?? {}, names)
  return loginIn(prof, { names, cookies, account: typeof d.account === "string" ? d.account : null, known, visited: (d.visited ?? []).filter((n) => names.includes(n)) })
})

async function sealLogin(from: string, names: string[], to: string, key: string) {
  const l = await loginOut(from, names)
  return seal(key, { ...l, at: Date.now() }, sealedFor(to))
}

type Visited = { sites: Record<string, string[]> }
let visited: Visited | null = null
const visitedFile = () => path.join(app.getPath("userData"), "web-sites.json")
function loadVisited(): Visited {
  if (!visited) {
    let j: Partial<Visited> = {}
    try { j = JSON.parse(fs.readFileSync(visitedFile(), "utf8")) } catch { /* none yet */ }
    visited = { sites: j.sites && typeof j.sites === "object" ? j.sites : {} }
  }
  return visited
}
const saveVisited = () => { try { fs.writeFileSync(visitedFile(), JSON.stringify(visited)) } catch { /* only the panel's split is lost */ } }
const visitedOf = (profile: string) => new Set(loadVisited().sites[profile] ?? [])
function addVisited(profile: string, sites: string[]) {
  const v = loadVisited(), been = visitedOf(profile)
  if (sites.every((s) => been.has(s))) return
  v.sites[profile] = [...new Set([...been, ...sites])].sort()
  saveVisited()
}
function noteVisit(profile: string, url: string) {
  const site = web(url) ? siteOf(hostOfUrl(url)) : ""
  if (site) addVisited(profile, [site])
}


let icons: Map<string, string> | null = null
const staleIcons = new Set<string>()
const iconSrc = new Map<string, string>()
const iconAsked = new Set<string>()
const ICON_MAX = 256 * 1024
const ICONS_KEPT = 300
const ICONS_VERSION = 2
const iconsFile = () => path.join(app.getPath("userData"), "web-icons.json")
function iconKey(u: string, page = false) {
  try {
    const x = new URL(u), host = x.host.replace(/^www\./, "")
    const seg = page ? x.pathname.split("/")[1] ?? "" : ""
    return seg ? `${host}/${seg}` : host
  } catch { return "" }
}
const isIcon = (s: string) => s.length < ICON_MAX * 1.4 && /^data:image\/(png|jpeg|gif|webp|x-icon|svg\+xml);base64,[A-Za-z0-9+/]+=*$/.test(s)
function loadIcons() {
  if (!icons) {
    icons = new Map()
    try {
      const j = ICONS.parse(JSON.parse(fs.readFileSync(iconsFile(), "utf8")))
      for (const [h, v] of Object.entries(j?.icons ?? {})) if (typeof v === "string" && isIcon(v)) icons.set(h, v)
      if (j?.v !== ICONS_VERSION) for (const h of icons.keys()) staleIcons.add(h)
    } catch { /* none yet, or unreadable: they're fetched again */ }
  }
  return icons
}
let iconsSaving: ReturnType<typeof setTimeout> | null = null
function saveIcons() {
  iconsSaving ??= setTimeout(() => {
    iconsSaving = null
    try { writeAtomic(iconsFile(), JSON.stringify({ v: ICONS_VERSION, icons: Object.fromEntries(loadIcons()) })) } catch { /* kept in memory */ }
  }, 2000)
}
function setIcon(key: string, icon: string | null) {
  const all = loadIcons()
  staleIcons.delete(key)
  if ((all.get(key) ?? null) === icon) return
  all.delete(key)
  if (icon) all.set(key, icon)
  for (const h of [...all.keys()].slice(0, Math.max(0, all.size - ICONS_KEPT))) all.delete(h)
  saveIcons()
  for (const w of AppWindow.getAllWindows()) tell(w, { type: "icon", host: key, icon: icon ?? "" })
}

/** An image's bytes as an icon: PNG or JPEG redrawn at 64px at most, the formats a page's <img> reads (ICO, SVG,
 *  GIF, WebP) as they are; null for anything else (an HTML error page, an empty answer). */
function iconOf(buf: Buffer): string | null {
  if (!buf.length || buf.length > ICON_MAX) return null
  const img = nativeImage.createFromBuffer(buf)
  if (!img.isEmpty()) {
    const { width, height } = img.getSize()
    if (width < 1 || height < 1) return null
    return (Math.max(width, height) > 64 ? img.resize(width >= height ? { width: 64, quality: "best" } : { height: 64, quality: "best" }) : img).toDataURL()
  }
  const head = buf.subarray(0, 512).toString("latin1")
  const mime = buf.length >= 4 && buf.readUInt32BE(0) === 0x00000100 ? "x-icon"
    : head.startsWith("GIF8") ? "gif"
    : head.startsWith("RIFF") && head.slice(8, 12) === "WEBP" ? "webp"
    : /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(head) ? "svg+xml" : ""
  return mime ? `data:image/${mime};base64,${buf.toString("base64")}` : null
}

async function iconBytes(s: Session, url: string): Promise<Buffer | null> {
  const data = /^data:image\/[\w.+-]+(;[\w-]+=[\w-]+)*(;base64)?,/i.exec(url)
  if (data) {
    const body = url.slice(data[0].length)
    try { return data[2] ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body), "utf8") } catch { return null }
  }
  if (!web(url)) return null
  try {
    const r = await s.fetch(url, { signal: AbortSignal.timeout(8000), credentials: "include" })
    if (!r.ok || Number(r.headers.get("content-length") ?? 0) > ICON_MAX) return null
    return Buffer.from(await r.arrayBuffer())
  } catch { return null }
}
async function firstIcon(s: Session, urls: string[], still = () => true) {
  for (const u of urls) {
    if (!still()) return null
    let icon: string | null = null
    try { const b = await iconBytes(s, u); icon = b && iconOf(b) } catch { icon = null }
    if (icon && isIcon(icon)) return { icon, from: u }
  }
  return null
}

const LOCAL_HOST = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|(\d{1,3}\.){3}\d{1,3})(:\d+)?$/i
async function hostIcon(s: Session, host: string, fallback?: string) {
  if (!host || (loadIcons().has(host) && !staleIcons.has(host)) || iconAsked.has(host)) return
  iconAsked.add(host)
  const got = await firstIcon(s, [`${LOCAL_HOST.test(host) ? "http" : "https"}://${host}/favicon.ico`])
  if (got) { iconSrc.set(host, got.from); setIcon(host, got.icon) }
  else if (fallback && !loadIcons().has(host)) setIcon(host, fallback)
}

async function iconFrom(p: Page, urls: unknown) {
  const list = (Array.isArray(urls) ? urls : []).filter((u): u is string => typeof u === "string" && (web(u) || /^data:image\//i.test(u))).slice(0, 4)
  const page = p.view.webContents.getURL(), host = iconKey(page), key = iconKey(page, true)
  if (!host || !web(page)) return
  try { const fav = new URL("/favicon.ico", page).href; if (!list.includes(fav)) list.push(fav) } catch { /* no origin */ }
  const told = list.join(" ")
  if (p.icons === told) return
  p.icons = told
  if (iconSrc.get(key) === list[0] && loadIcons().has(key)) return
  const s = p.view.webContents.session
  const got = await firstIcon(s, list, () => !p.view.webContents.isDestroyed() && p.icons === told)
  if (!got) return
  iconSrc.set(key, got.from)
  if (key === host) { iconAsked.add(host); setIcon(host, got.icon); return }
  await hostIcon(s, host, got.icon)
  setIcon(key, loadIcons().get(host) === got.icon ? null : got.icon)
}

// ---------- the window's page over its pages: stack.ts decides ----------

const pointers = new WeakMap<AppWindow, Pointer>()
const pointerOf = (win: AppWindow) => pointers.get(win) ?? NO_POINTER

const pageViews = new WeakSet<WebContentsView>()

function addPage(win: AppWindow, view: WebContentsView) {
  pageViews.add(view)
  restack(win, view)
}

function restack(win: AppWindow, top?: WebContentsView) {
  if (win.isDestroyed()) return
  const full = new Set<WebContentsView>()
  for (const p of pages.values()) if (p.win === win && p.full && !p.player) full.add(p.view)
  const roleOf = (v: View): Role => v === win.view ? "window" : v instanceof WebContentsView && pageViews.has(v) ? (full.has(v) ? "full" : "page") : "chrome"
  const want = stackOrder(win.contentView.children, roleOf, pointerOf(win).raise, top)
  for (const [i, v] of want.entries()) if (win.contentView.children[i] !== v) win.contentView.addChildView(v, i)
}

const raise = (win: AppWindow, how: Raise) => { if (!win.isDestroyed()) run(win, { type: "raise", how }) }

const pointer = (p: Page, e: Passed) => run(p.win, { type: "pass", page: p.id, kind: e.kind, button: e.button }, p, e)

function run(win: AppWindow, e: PointerEvent, p?: Page, m?: Passed) {
  const r = pointerStep(pointerOf(win), e)
  pointers.set(win, r.to)
  for (const x of r.do) {
    if (x.do === "restack") restack(win)
    else if (x.do === "pinch") { if (MAC && !win.isDestroyed()) void import("./gestures.ts").then((g) => g.passPinch(win, x.on)) }
    else if (x.do === "hover") hover(win)
    else if (p && m) send(p, m, x.do === "send" ? x.buttons : null)
  }
}

/** The pointer resting over a page as the window goes over it (fingers leaving the trackpad) is told to the window's
 *  page, which then says what's under it. A quiet copy's pointer isn't the user's (quiet.ts). */
function hover(win: AppWindow) {
  if (!MAC || QUIET) return
  const at = screen.getCursorScreenPoint(), b = win.getContentBounds()
  if (at.x >= b.x && at.y >= b.y && at.x < b.x + b.width && at.y < b.y + b.height) win.webContents.sendInputEvent({ type: "mouseMove", x: at.x - b.x, y: at.y - b.y })
}

const CDP_TYPE = { mouseMove: "mouseMoved", mouseDown: "mousePressed", mouseUp: "mouseReleased", mouseWheel: "mouseWheel" } as const
const KEY_BITS = { alt: 1, control: 2, meta: 4, shift: 8 }

function send(p: Page, m: Passed, buttons: number | null) {
  const wc = p.view.webContents, z = p.win.webContents.getZoomFactor()
  const x = Math.round(m.x * z), y = Math.round(m.y * z)
  // (the click landed on the window's view, which macOS gave the keyboard: a press in the page takes it, as a real one does)
  if (m.kind === "mouseDown" && !wc.isFocused()) wc.focus()
  const direct = () => {
    if (m.kind === "mouseWheel") wc.sendInputEvent({ type: "mouseWheel", x, y, deltaX: -m.dx, deltaY: -m.dy, canScroll: true, modifiers: m.keys })
    else wc.sendInputEvent({ type: m.kind, x, y, button: m.button, clickCount: m.clickCount, modifiers: m.keys })
  }
  if (buttons === null || m.kind === "mouseLeave") return direct()
  // Over the DevTools protocol, which finds the frame under the pointer as the Mac's input does: sendInputEvent never
  // reaches a frame from another site (a captcha, "Sign in with Google").
  const type = CDP_TYPE[m.kind], pz = wc.getZoomFactor() || 1, modifiers = m.keys.reduce((n, k) => n | KEY_BITS[k], 0)
  const at = { x: Math.round(m.x * z / pz), y: Math.round(m.y * z / pz) }
  const params = type === "mouseWheel" ? { type, ...at, modifiers, deltaX: m.dx * z / pz, deltaY: m.dy * z / pz }
    : type === "mouseMoved" ? { type, ...at, modifiers, button: buttons ? (buttons & 1 ? "left" : buttons & 2 ? "right" : "middle") : "none", buttons }
    : { type, ...at, modifiers, button: m.button, buttons, clickCount: m.clickCount }
  void cdp(wc, "Input.dispatchMouseEvent", params).catch(direct)
}
