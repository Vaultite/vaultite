// The Browser's pages: a WebContentsView over a tab's pane, which the page places and covers; sandboxed, a session
// per profile, http(s) only. What it does and why: plugins/core/web-viewer/CLAUDE.md.
import { app, BaseWindow, type BrowserWindow, clipboard, dialog, type Input, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, powerSaveBlocker, safeStorage, screen, session, shell, type Session, systemPreferences, WebContentsView, type WebContents } from "electron"
import { AppWindow } from "./appwindow.ts"
import { allPages, cdp, engineCall, engineLoaded, engineOpens, handle, mayOpen, openedByAgent, pageKept, pageMade, partitionOf, sessionMade, sessionReady, setEngineHost, setOpener } from "./browser/engine.ts"
import { openElsewhere } from "./browser/default.ts"
import { lastVisits } from "./browser/history.ts"
import { newKeys, open as openSealed, seal } from "./browser/sealed.ts"
import { ACCOUNTS, covers, nonempty, type Rule, type Who } from "./siteaccounts.ts"
import { writeAtomic } from "./setup.ts"
import { claim, discardable, hear, letGo, media, MOVE_MS, playback, playing, quietEnds, RECLAIM_MS, tabGone, tabMoved, unclaimed, unmoved, windowReloaded, type Owned, type Playback } from "./webpages.ts"
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

setEngineHost({ windows: () => AppWindow.getAllWindows() })

export type WebRect = { x: number; y: number; width: number; height: number }
export type WebState = { url: string; title: string; back: boolean; forward: boolean; loading: boolean; error?: string; playing?: boolean; muted?: boolean
  player?: boolean; zoom?: number; unsafe?: boolean; crashed?: boolean; typed?: boolean }
type Page = Owned<AppWindow> & { view: WebContentsView; error?: string
  /** Its address failed on a certificate it may choose to trust for this session (`allow-cert`). */
  cert?: { url: string; host: string; fp: string }
  /** Its renderer kept dying: it shows "This page crashed" till a reload. */
  crashed?: boolean
  /** Its frames holding typed, unsent input (web-preload.cjs), by frame: its tab isn't archived meanwhile. */
  typed: Map<string, boolean>
  /** Where its tab last asked it to be (null: hidden): where it goes back to from full screen. */
  want: WebRect | null
  /** Its player: a window of its own it fills (see the player's section below), still its tab's. */
  player?: BaseWindow
  /** It's full screen (the page asked: a video's button), filling its window or its player. */
  full?: boolean
  /** Its full screen made the window full screen: leaving it, the window goes back. */
  madeFull?: boolean
  /** The style its player added (its main video's fill), taken out as it's back. */
  fillCss?: string
  /** Its player's video is full screen in it: leaving that leaves the player. */
  filled?: boolean
  /** The address it was last sent to: what it shows until a load commits (getURL is "" till then). */
  target: string
  /** The icon addresses it last told (page-favicon-updated), so the same list isn't fetched again. */
  icons?: string
  /** It had the keyboard when it was last hidden. */
  hadFocus?: boolean
  /** Whether it plays sound, as its tab shows it (webpages.ts), and the timer that ends a quiet stretch's. */
  sound: Playback; hush?: NodeJS.Timeout
  /** Its first load was a download, before a tab had it: the tab it's handed to closes. */
  downloaded?: boolean
  /** Its history is being put back (a tab come back): what it shows is `target` till that's in. */
  restoring?: boolean
  /** It's the spare's, its first load not in yet: the spare's about:blank is no page to go back to (gone once it is). */
  blankBehind?: boolean
  /** No page of its own has painted yet: it shows the window's colour (`looks`) rather than white. */
  fresh: boolean
  /** An agent's: out of sight it's parked (see `park`) rather than hidden, so it draws on. `parked`: it is now;
   *  `resting`: hidden there a while (`rest`), `woke` when it last woke. */
  drawn?: boolean; parked?: boolean; resting?: boolean; woke?: number }
/** A site a profile keeps cookies for: whether it's signed in and who as, when we know how to ask, sites the same login covers (`with`),
 *  its last visit, and `other` when no page of it was opened (its cookies came with other sites' pages: trackers). */
export type WebSite = { site: string; signed?: boolean; account?: string; more?: string[]; avatar?: string; with?: string[]; last?: number; other?: boolean }

const profileOf = (x: unknown) => (typeof x === "string" && /^[a-z0-9-]{1,32}$/.test(x) ? x : "")
const MAC = process.platform === "darwin"
/** The browser's keys a page may take first, as in Chrome (a doc's own find, a map's zoom): one it leaves alone is the
 *  app's (its preload says so, web-preload.cjs), never the menu bar's. */
const BROWSER_KEYS = new Set(["f", "g", "shift+g", "=", "shift+=", "-", "0"].map((k) => `mod+${k}`))
/** Keys a page keeps even when the app has a shortcut on them: editing text, a rich editor's marks, the browser's. */
// (⌘Y isn't redo on a Mac: it's History there, as in Chrome)
const PAGE_KEYS = new Set([...["a", "c", "v", "x", "z", "shift+z", ...(MAC ? [] : ["y"]), "b", "i", "u", "k", "shift+v", "arrowleft",
  "arrowright", "arrowup", "arrowdown", "backspace", "delete", "enter", "shift+enter", "tab"].map((k) => `mod+${k}`), ...BROWSER_KEYS])
/** The page's own keys, as Chrome's: reload, reload past the cache, its DevTools. */
const OWN_KEYS: Record<string, string> = { "mod+r": "reload", "mod+shift+r": "hard-reload", [MAC ? "mod+alt+i" : "mod+shift+i"]: "devtools", [MAC ? "mod+alt+u" : "mod+u"]: "source" }

const pages = new Map<number, Page>()
/** Each window's app shortcuts with ⌘, ⌃ or ⌥ (web:keys). */
const keysOf = new WeakMap<AppWindow, Set<string>>()
let next = 1
const sessions = new Map<string, Session>()

const web = (u: string) => /^https?:\/\//i.test(u)
/** What a page may show: the web, and what a feature of the engine adds (an extension's own pages). */
const shows = (u: string) => web(u) || engineOpens(u) || /^view-source:https?:\/\//i.test(u)
/** Images asked for with Save image to vault (their addresses), whose downloads go to the window instead. */
const toVault = new Set<string>()
const pageOf = (wc: WebContents) => [...pages.values()].find((p) => p.view.webContents === wc)

/** Each page's frames: its main frame tells when it first paints (`painted`). */
const PRELOAD = fileURLToPath(new URL("./web-preload.cjs", import.meta.url))
/** A profile's session, set up once. */
function webSession(profile: string) {
  const had = sessions.get(profile)
  if (had) return had
  const s = session.fromPartition(partitionOf(profile))
  // A plain Chrome: some sites turn away "embedded" browsers by their user agent (the app's name is its channel's too:
  // VaultiteMain/0.7.0). Cloudflare's check is told the truth (browser/challenges.ts).
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
        // (any size; when there's none, the window says why)
        let data: Buffer | null = null, error = state === "completed" ? "" : `the download was ${state}`
        try { if (!error) data = fs.readFileSync(tmp) } catch (e) { error = (e as Error).message }
        fs.rm(tmp, { force: true }, () => {})
        if (p && !p.win.isDestroyed()) tell(p.win, { type: "image", id: p.id, name: item.getFilename(), mime: item.getMimeType(), data, ...(error ? { error } : {}) })
      })
      return
    }
    const dir = app.getPath("downloads")
    const file = path.join(dir, freeName(dir, item.getFilename() || "download"))
    item.setSavePath(file)
    // (a tab opened for it, nothing of its own shown yet, closes, as Chrome's does: no empty tab left behind; one not
    // handed to its tab yet closes as it is)
    if (p && !p.agent && wc && !shows(wc.getURL())) { if (p.tab) tell(p.win, { type: "close", tab: p.tab }); else p.downloaded = true }
    item.once("done", (_ev, state) => {
      if (p && !p.win.isDestroyed()) tell(p.win, { type: "download", name: path.basename(file), path: file, ok: state === "completed" })
    })
  })
  sessions.set(profile, s)
  sessionMade(s, profile)
  return s
}
/** A profile's session once the engine set it up (the cookies it keeps across restarts back in): before its first page
 *  opens, or its cookies are read. */
async function readySession(profile: string) {
  const s = webSession(profile)
  await sessionReady(profile)
  return s
}

// ---------- what sites may use: asked once per site and profile, like a browser, kept in userData web-permissions.json

/** Allowed without asking, as browsers do. */
const FREE = new Set(["clipboard-sanitized-write", "notifications", "fullscreen", "pointerLock", "keyboardLock", "speaker-selection",
  "storage-access", "top-level-storage-access"])
/** Asked: what the question says the site wants to do. Anything else is refused. */
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
/** Questions on screen, so a site asking twice at once gets one. */
const asking = new Map<string, Promise<boolean>>()

/** Whether a page may do `perm`: free, else its site's answer, else asked in a box over its window (Allow, Don't allow;
 *  remembered unless unticked). The camera and microphone then need macOS's yes too. */
async function askPermission(profile: string, wc: WebContents, perm: string, details: { mediaTypes?: string[]; requestingUrl?: string; externalURL?: string }) {
  if (FREE.has(perm)) return true
  // (another app by its scheme, said in the question: a yes to zoommtg: is none to ms-msdt:)
  const scheme = perm === "openExternal" ? (/^([a-z][a-z0-9+.-]*):/i.exec(details.externalURL ?? "")?.[1] ?? "").toLowerCase() : ""
  if (perm === "openExternal" && !scheme) return false
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
        if (r.checkboxChecked) for (const k of kinds) answer(profile, site, k, allow)
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

/** "name.pdf", else "name 1.pdf"... like Finder. */
function freeName(dir: string, name: string) {
  const clean = path.basename(name).replace(/^\.+/, "") || "download"
  const ext = path.extname(clean), stem = ext ? clean.slice(0, -ext.length) : clean
  let out = clean, n = 1
  while (fs.existsSync(path.join(dir, out))) out = `${stem} ${n++}${ext}`
  return out
}

/** How long a click or key lets a page open a tab or window (Chromium's user activation). */
const ACTIVATION_MS = 5000
/** How near the window's left or right edge (CSS px) a page's pointer is told to the window. */
const EDGE = 12
/** How near its own top (CSS px) a page's pointer is told to the window (a hidden page bar). */
const TOP = 4
const tell = (win: AppWindow, msg: Record<string, unknown>) => { if (!win.isDestroyed()) win.webContents.send("vaultite:web", msg) }

const canBack = (p: Page) => !p.blankBehind && p.view.webContents.navigationHistory.canGoBack()
const playingNow = (p: Page) => !p.view.webContents.isDestroyed() && playing(p.sound, p.view.webContents.isCurrentlyAudible(), Date.now())
function stateOf(p: Page): WebState {
  const wc = p.view.webContents
  const h = wc.navigationHistory
  // (the spare's about:blank is no address: the one it's loading shows till it's in)
  const blank = p.blankBehind || p.restoring
  const zoom = wc.getZoomFactor()
  return { url: (!blank && wc.getURL()) || p.target, title: (!blank && wc.getTitle()) || "", back: canBack(p), forward: h.canGoForward(), loading: wc.isLoading(), ...(p.error ? { error: p.error } : {}),
    ...(playingNow(p) ? { playing: true } : {}), ...(wc.isAudioMuted() ? { muted: true } : {}), ...(p.player ? { player: true } : {}), ...(Math.abs(zoom - 1) > 0.001 ? { zoom } : {}),
    ...(p.cert && p.error ? { unsafe: true } : {}), ...(p.crashed ? { crashed: true } : {}), ...([...p.typed.values()].some(Boolean) ? { typed: true } : {}) }
}
/** A page's notification, as its stand-in logs it (see the head of this file). */
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
/** Notifications a page sends a minute; more wait their turn (past QUEUED, they're told as one, with how many). */
const RATE = 6
const QUEUED = 200

const sendState = (p: Page) => tell(p.win, { type: "state", id: p.id, state: stateOf(p) })
/** The window's pages came or went, or one was hidden or shown again (the Web pages panel). */
const pagesChanged = (win: AppWindow) => tell(win, { type: "pages" })

/** A shortcut as the app's commands name it (web/src/core/commands.ts: canonical, lower case): "mod+shift+t". */
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

/** A page's link to another app (zoommtg://, slack://), opened once the site may (asked by scheme, as browsers do);
 *  mailto: opens Mail. Never file:, network shares or Windows' schemes that run code. */
async function otherApp(p: Page, to: string) {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(to) || /^(javascript|data|vbscript|blob|file|about|chrome|devtools|view-source|ms-msdt|search-ms|search|ms-officecmd|shell|hcp|ms-help|res|smb|cifs|nfs|afp|disks?):/i.test(to)) return
  if (/^mailto:/i.test(to)) return void shell.openExternal(to)
  const wc = p.view.webContents
  if (wc.isDestroyed()) return
  if (await askPermission(p.profile, wc, "openExternal", { requestingUrl: wc.getURL(), externalURL: to }).catch(() => false)) await shell.openExternal(to).catch(console.error)
}

/** Each window's colour as its page tells it (`web:look`: the app's background), shown by a new page till its site
 *  first paints rather than white, which flashed in a dark app while the site answered. */
const looks = new WeakMap<AppWindow, string>()
const lookOf = (win: AppWindow) => looks.get(win) ?? win.getBackgroundColor()
/** Its site painted: white from now on, what the web's pages expect under what they leave unpainted. Not at commit:
 *  the page shows its colour from then till its first paint. */
function painted(p: Page) {
  if (!p.fresh || p.view.webContents.isDestroyed()) return
  p.fresh = false
  p.view.setBackgroundColor("#ffffff")
}
ipcMain.on("vaultite:web:painted", (e) => { const p = pageOf(e.sender); if (p && shows(e.sender.getURL())) painted(p) })
// One of the browser's keys a page left alone (BROWSER_KEYS), or the mouse's back or forward button in it: the app's,
// as its other shortcuts are (Back walks the page's history first, then the tab's).
ipcMain.on("vaultite:web:key", (e, k: { key?: unknown; code?: unknown; meta?: unknown; ctrl?: unknown; alt?: unknown; shift?: unknown }) => {
  const p = pageOf(e.sender)
  if (!p || p.agent || p.player || !k || typeof k.key !== "string" || typeof k.code !== "string") return
  const key = { key: k.key, code: k.code, meta: k.meta === true, ctrl: k.ctrl === true, alt: k.alt === true, shift: k.shift === true }
  if (BROWSER_KEYS.has(stepOf({ ...key, control: key.ctrl }))) tell(p.win, { type: "key", id: p.id, ...key })
})
// Typed input a frame holds, unsent (or none now): the tab isn't archived while it does, as Chrome doesn't discard it.
ipcMain.on("vaultite:web:typed", (e, on) => {
  const p = pageOf(e.sender), key = `${e.processId}:${e.frameId}`
  if (!p || (p.typed.get(key) ?? false) === (on === true)) return
  p.typed.set(key, on === true)
  sendState(p)
})
ipcMain.on("vaultite:web:nav", (e, dir) => { const p = pageOf(e.sender); if (p && !p.agent && !p.player) tell(p.win, { type: "nav", id: p.id, dir: dir < 0 ? -1 : 1 }) })

// A page's settings, sandboxed ("in sub frames" only lets the engine's preloads reach an extension's page embedded in it);
// its full screen never resizes the window by itself (fit() fills its window or player).
const prefsOf = (profile: string) => ({ session: webSession(profile), sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: true,
  webSecurity: true, spellcheck: true, disableHtmlFullscreenWindowResize: true })
/** A page's view in a profile's session (`adopt`: the contents a page's window.open made, kept, so `window.opener` works). */
const newView = (profile: string, adopt?: WebContents) => new WebContentsView({ ...(adopt ? { webContents: adopt } : {}), webPreferences: prefsOf(profile) })

// ---------- a spare page: the next tab's renderer started ahead, as Chrome does (Electron turns Chrome's off) ----------

/** A view on about:blank in the last page's profile, its renderer running: the next page there takes it, saving the
 *  process's start (much of a new tab's wait). Made a moment after a page opens; `trim` ends it under memory pressure. */
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
    // (its renderer gone, it's no spare)
    view.webContents.once("render-process-gone", () => { if (spare?.view === view) endSpare() })
    spare = { profile, view }
    void view.webContents.loadURL("about:blank").catch(() => { if (spare?.view === view) endSpare() })
  }, SPARE_MS)
  spareTimer.unref?.()
}
/** The spare, if it's for `profile` and alive: taken (the next is made a moment later). */
function takeSpare(profile: string) {
  const s = spare
  if (!s || s.profile !== profile || s.view.webContents.isDestroyed() || s.view.webContents.isCrashed()) return null
  spare = null
  return s.view
}

/** `agent`: an agent's, in the background (no tab). `adopt`: the contents a page's window.open made (`opener`'s), already
 *  loading `url`. */
function make(win: AppWindow, url: string, profile: string, tab: string, { agent = false, adopt, opener }: { agent?: boolean; adopt?: WebContents; opener?: number } = {}): Page {
  // (a tab whose page went, or moved to other logins, given its history back: Back and Forward as they were)
  const kept = tab && !adopt ? pastOf(tab, profile, url) : null
  const taken = adopt || kept ? null : takeSpare(profile), view = taken ?? newView(profile, adopt)
  makeSpare(profile)
  view.setBackgroundColor(lookOf(win))
  view.setVisible(false)
  // (a size before it's first shown: a page laid out at none has nothing an agent could click)
  const [w, h] = win.getContentSize()
  view.setBounds({ x: 0, y: 0, width: Math.max(320, Math.round(w / 2)), height: Math.max(240, h - 80) })
  addPage(win, view)
  const p: Page = { id: next++, win, view, profile, tab, agent, drawn: agent, holds: 0, closing: false, let: 0, target: url, want: null, sound: playback(),
    blankBehind: !!taken, fresh: true, typed: new Map() }
  pages.set(p.id, p)
  if (agent) park(p)
  const wc = view.webContents
  if (taken) wc.once("did-navigate", () => { wc.navigationHistory.clear(); p.blankBehind = false })
  // (its address mid-restore is any of its entries': the tab mustn't follow it, and load that over it)
  if (kept) {
    p.restoring = true
    const done = () => { if (kept.load && wc.navigationHistory.getActiveIndex() < kept.entries.length) return; p.restoring = false; wc.off("did-navigate", done); sendState(p) }
    wc.on("did-navigate", done)
  }
  // (its window as it is now: a tab moved to another window takes its page along, `moveTo`)
  pageMade({ id: p.id, wc, profile, get win() { return p.win }, url, opener, hide: () => place(p, null), visible: () => shownNow(p), tab: () => p.tab,
    player: (on, fullScreen) => { if (on) void toPlayer(p, fullScreen); else fromPlayer(p) }, own: (to) => own(p, tabOf(to)), close: () => end(p),
    rest: () => rest(p), wake: () => wake(p), resting: () => !!p.resting })

  // Only to the web: another app's link (zoommtg://, slack://, mailto:) goes to that app, as a browser does.
  const refuse = (e: { preventDefault: () => void }, to: string) => {
    if (shows(to)) return
    e.preventDefault()
    void otherApp(p, to)
  }
  wc.on("will-navigate", (e) => refuse(e, e.url))
  wc.on("will-redirect", (e) => refuse(e, e.url))
  // Chrome's popup blocker (Electron has none): a page opens something only just after a click or key in it, else the
  // user's told and may open it. An agent's opens are its own pages.
  let input = 0, toldBlocked = 0
  wc.on("input-event", (_e, i) => { if (["mouseDown", "rawKeyDown", "keyDown", "gestureTap", "touchStart"].includes(i.type)) input = Date.now() })
  wc.setWindowOpenHandler(({ url: to, disposition, features }) => {
    const agents = p.agent || openedByAgent(p.id)
    if (!agents && Date.now() - input > ACTIVATION_MS) {
      if (Date.now() - toldBlocked > 10_000 && web(to)) { toldBlocked = Date.now(); tell(p.win, { type: "blocked", id: p.id, tab: p.tab, url: to, profile }) }
      return { action: "deny" }
    }
    input = 0
    if (!shows(to)) { void otherApp(p, to); return { action: "deny" } }
    // (a sized popup, signing in with another site, is a small window; else a tab behind, in front or (⇧-click) to the
    // side, handed the contents Chromium made so `window.opener` works)
    const popup = disposition === "new-window" && features.split(",").some((f) => !/^\s*(noopener|noreferrer)?\s*$/i.test(f))
    if (popup && !agents) {
      return { action: "allow", overrideBrowserWindowOptions: {
        width: 520, height: 700, parent: p.win, autoHideMenuBar: true, webPreferences: prefsOf(profile),
      } }
    }
    const how = disposition === "background-tab" ? "background" : disposition === "new-window" ? "side" : "foreground"
    // (outliving its page, as a Chrome tab does: Electron closes what window.open made with its opener, which closed every
    // tab opened from a page with it)
    return { action: "allow", outlivesOpener: true, overrideBrowserWindowOptions: { webPreferences: prefsOf(profile) }, createWindow: (o) => {
      const child = make(p.win, to, profile, "", { agent: agents, adopt: (o as { webContents: WebContents }).webContents, opener: p.id })
      pagesChanged(p.win)
      // (the window hands it to the tab it opens for it, `web:adopt`, or it ends)
      if (!agents) {
        child.orphan = Date.now()
        setTimeout(() => { if (child.orphan !== undefined && pages.has(child.id)) end(child) }, RECLAIM_MS).unref()
        tell(p.win, { type: "open", id: p.id, tab: p.tab, url: to, profile, how, page: child.id })
      }
      return child.view.webContents
    } }
  })
  wc.on("did-create-window", (child) => {
    if (pageOf(child.webContents)) return
    popupOf(p, child)
  })

  // (its media pausing as it closes comes after its view let go of its contents)
  const changed = () => { if (p.view.webContents && !wc.isDestroyed()) sendState(p) }
  revive(wc, undefined, () => { p.crashed = true; changed() })
  wc.on("did-start-loading", () => { p.error = undefined; p.crashed = false; changed() })
  // A certificate this Mac doesn't trust: refused, as Chrome does, unless the user chose to go on to that host with that very
  // certificate this session (`allow-cert`, from its tab's warning). Never trusted for them.
  wc.on("certificate-error", (e, to, error, cert, done, main) => {
    const host = hostOfUrl(to)
    if (unsafeOk.has(`${p.profile} ${host} ${cert.fingerprint}`)) { e.preventDefault(); done(true); return }
    done(false)
    if (main && /\bERR_CERT_/.test(error)) p.cert = { url: to, host, fp: cert.fingerprint }
  })
  wc.on("did-start-navigation", (d) => { if (d.isMainFrame && !d.isSameDocument) { p.cert = undefined; if (shows(d.url)) p.target = d.url } })
  wc.on("did-stop-loading", changed)
  wc.on("did-navigate", (_e, to) => { p.sound = playback(); p.typed.clear(); noteVisit(profile, to); if (!p.agent) zoomTo(p, zoomOf(hostOfUrl(to))); changed(); keepPast(p) })
  wc.on("found-in-page", (_e, r) => tell(p.win, { type: "found", id: p.id, request: r.requestId, active: r.activeMatchOrdinal, matches: r.matches, final: r.finalUpdate }))
  // (loaded and still not told it painted, a page with no paint timing (an extension's): white a moment later)
  wc.on("did-finish-load", () => { if (p.fresh && shows(wc.getURL())) setTimeout(() => painted(p), 1000).unref() })
  wc.on("did-navigate-in-page", (_e, _u, main) => { if (main) { changed(); keepPast(p) } })
  wc.on("page-title-updated", () => { changed(); keepPast(p) })
  wc.on("dom-ready", () => tellGlance(wc))
  // (the window's page shows it while it's over this one, passing it the pointer: layers.ts)
  wc.on("cursor-changed", (_e, cursor) => tell(p.win, { type: "cursor", id: p.id, cursor }))
  // (its sound changed: told now, and again when a quiet stretch ends it)
  const sounded = () => {
    clearTimeout(p.hush)
    const ends = quietEnds(p.sound)
    if (ends !== undefined) p.hush = setTimeout(() => { if (!wc.isDestroyed()) changed() }, ends - Date.now()).unref()
    changed()
  }
  wc.on("audio-state-changed", (e) => { hear(p.sound, e.audible, Date.now()); sounded() })
  wc.on("media-started-playing", () => { media(p.sound, true, wc.isCurrentlyAudible()); sounded() })
  wc.on("media-paused", () => { media(p.sound, false, wc.isCurrentlyAudible()); sounded() })
  wc.on("did-fail-load", (_e, code, desc, _u, main) => {
    if (!main || code === -3) return // -3: stopped, or another load took over
    p.error = desc || `error ${code}`
    changed()
  })
  wc.on("focus", () => { if (!p.player) tell(p.win, { type: "focus", id: p.id }) })
  // Full screen (a video's button): it fills its window (made full screen, as Chrome does) or its player, over the rest.
  wc.on("enter-html-full-screen", () => {
    p.full = true
    if (!p.player) {
      p.win.contentView.addChildView(p.view) // (again: over every other page and the window's own, raised or not)
      if (!p.win.isFullScreen()) { p.win.setFullScreen(true); p.madeFull = true }
    }
    fit(p)
  })
  wc.on("leave-html-full-screen", () => {
    p.full = false
    // (its player's video leaving full screen, with Esc or the site's own button, leaves the player: Esc never reaches
    // the page while it's full screen)
    if (p.player && p.filled) { p.filled = false; fromPlayer(p, true); return }
    if (p.madeFull) { p.madeFull = false; if (!p.win.isDestroyed() && p.win.isFullScreen()) p.win.setFullScreen(false) }
    fit(p)
  })
  wc.on("page-favicon-updated", (_e, urls) => void iconFrom(p, urls))

  // Its notifications (see the head of this file).
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

  // The window doesn't hear the pointer over the page: near its edges it's told (web/src/core/peek.ts), and as it
  // leaves them; never from a page out of sight (an agent's, parked at -40000, would be "at the left edge").
  let atEdge = false, atTop = false
  wc.on("before-mouse-event", (_e, m) => {
    if (m.type === "mouseLeave" && atTop) { atTop = false; tell(p.win, { type: "top", id: p.id, at: false }) }
    if (m.type !== "mouseMove" || p.player || p.full || p.win.isDestroyed() || !shownNow(p)) return
    const z = p.win.webContents.getZoomFactor(), b = p.view.getBounds(), [w] = p.win.getContentSize()
    const top = m.y / z <= TOP
    if (top !== atTop) { atTop = top; tell(p.win, { type: "top", id: p.id, at: top }) }
    const x = (b.x + m.x) / z, edge = x <= EDGE || x >= w / z - EDGE
    if (!edge && !atEdge) return
    atEdge = edge
    tell(p.win, { type: "pointer", x, y: (b.y + m.y) / z })
  })

  wc.on("before-input-event", (e, i) => {
    if (i.type !== "keyDown") return
    const step = stepOf(i)
    wc.setIgnoreMenuShortcuts(BROWSER_KEYS.has(step))
    // In its player the page keeps every key but Esc, which brings it back (⌘W closes the player, as the menu has it).
    if (p.player) { if (step === "escape") { e.preventDefault(); fromPlayer(p, true) } return }
    // (Esc stops a load, and still reaches the page)
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
    // (what's opened from here opens in the page's container, unless one is picked)
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
    if (c.isEditable) items.push({ role: "cut" }, { role: "copy" }, { role: "paste" }, { type: "separator" })
    else if (c.selectionText) items.push({ role: "copy" }, { type: "separator" })
    const h = wc.navigationHistory
    if (p.player) items.push({ label: "Back to its tab", click: () => fromPlayer(p, true) }, { type: "separator" })
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
    // (restoring loads where it was; with `load`, the address loads over that before it asks for anything. A restore's
    // promise can fail, ERR_ABORTED, with the page on its way in: loaded afresh only if nothing came)
    const restored = wc.navigationHistory.restore({ entries: kept.entries, index: kept.index })
    if (kept.load) { void restored.catch(() => {}); void wc.loadURL(url).catch(() => {}) }
    else void restored.catch(() => { if (!wc.isDestroyed() && !wc.getURL() && !wc.isLoading()) void wc.loadURL(url).catch(() => {}) })
  } else if (!adopt) void wc.loadURL(url).catch(() => { /* did-fail-load says why */ })
  return p
}

/** A sized popup a page opened (signing in with another site): titled with its site and container, its own links opening
 *  as the page's would (tabs in its container), closed with its page. */
function popupOf(p: Page, child: BrowserWindow) {
  const cw = child.webContents
  const name = () => { const c = p.profile.startsWith("c-") ? menus.containers.find((x) => `c-${x.id}` === p.profile)?.name : ""; return [hostOfUrl(cw.getURL()) || "Sign in", c].filter(Boolean).join(" · ") }
  child.on("page-title-updated", (e) => { e.preventDefault(); child.setTitle(name()) })
  cw.on("did-navigate", () => { if (!child.isDestroyed()) child.setTitle(name()) })
  cw.on("will-navigate", (e) => { if (!shows(e.url)) { e.preventDefault(); void otherApp(p, e.url) } })
  cw.setWindowOpenHandler(({ url: to }) => {
    if (web(to)) tell(p.win, { type: "open", id: p.id, tab: p.tab, url: to, profile: p.profile, how: "foreground" }); else void otherApp(p, to)
    return { action: "deny" }
  })
  const close = () => { if (!child.isDestroyed()) child.close() }
  p.view.webContents.once("destroyed", close)
  child.once("closed", () => { if (!p.view.webContents.isDestroyed()) p.view.webContents.off("destroyed", close) })
}

/** Where an agent's page is out of sight: off the window, shown and unthrottled, so it draws on in a desktop's viewport
 *  (live pictures, screenshots); a hidden view stops drawing at its next cross-site load. */
const PARKED = { x: -40000, y: 0, width: 1280, height: 800 }
const shownNow = (p: Page) => p.view.getVisible() && !p.parked
function park(p: Page) {
  const wc = p.view.webContents
  if ((p.parked && !p.resting) || wc.isDestroyed()) return
  if (wc.isFocused() && !p.win.isDestroyed()) p.win.webContents.focus()
  if (p.resting) p.woke = Date.now()
  p.parked = true
  p.resting = false
  wc.setBackgroundThrottling(false)
  p.view.setBounds(PARKED)
  p.view.setVisible(true)
}
/** A parked page unused a while: hidden and throttled, drawing nothing (a page's ads and animations cost nothing). */
function rest(p: Page) {
  if (!p.parked || p.resting || p.view.webContents.isDestroyed()) return
  p.resting = true
  p.view.setVisible(false)
  p.view.webContents.setBackgroundThrottling(true)
}
/** Awake again: parked and drawing, settled once its first frame since is likely drawn. */
function wake(p: Page) {
  if (p.resting) park(p)
  const left = (p.woke ?? 0) + 100 - Date.now()
  return left > 0 ? new Promise<void>((done) => setTimeout(done, left)) : Promise.resolve()
}
/** Out of sight: parked if it's an agent's, else hidden. */
const stow = (p: Page) => { if (p.drawn) park(p); else p.view.setVisible(false) }

/** Page `p` into window `win`, its tab having moved there (a pop-out): the same page, live, not loaded again. (Not
 *  `web:adopt`, which gives a tab-less page its tab.) */
function moveTo(p: Page, win: AppWindow) {
  const from = p.win
  if (!from.isDestroyed() && !p.player) from.contentView.removeChildView(p.view)
  if (p.full && !p.player) leaveFull(p)
  p.win = win
  p.view.setVisible(false)
  if (!p.player) addPage(win, p.view)
  if (!from.isDestroyed()) pagesChanged(from)
}

/** Page `p` to the app's tab `tab` (opened as a tab: it stays parked till the tab places it), or to the background. */
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
  clearTimeout(p.hush)
  fromPlayer(p)
  pagesChanged(p.win)
  if (!p.win.isDestroyed()) p.win.contentView.removeChildView(p.view)
  // (none once its contents are gone: closed by its own script)
  if (p.view.webContents) void unload(p.view.webContents)
}

/** Close a page as a browser closes a tab: its beforeunload and unload run first (sites save state there, Discord its
 *  sign-in), never asking to stay; 3 s at most. Resolves once it's gone. */
function unload(wc: WebContents) {
  if (wc.isDestroyed()) return Promise.resolve()
  const gone = new Promise<void>((done) => wc.once("destroyed", () => done()))
  wc.once("will-prevent-unload", (e) => e.preventDefault())
  wc.close({ waitForBeforeUnload: true })
  const hard = setTimeout(() => { if (!wc.isDestroyed()) wc.close() }, 3000)
  return gone.finally(() => clearTimeout(hard))
}

/** Before the app quits: every page unloaded, as its tab's close would, its tab kept (closing: not a close by its own
 *  script, which closes its tab too), so the tabs come back at the next launch, as a browser's do. */
export const unloadPages = () => {
  if (pastTimer) savePasts()
  return Promise.all([...pages.values()].map((p) => { p.closing = true; return unload(p.view.webContents) })).then(() => {})
}

/** Background tabs' pages are kept (hidden, so Chromium throttles them) till memory runs short (webpages.ts discardable);
 *  one in a player is on screen, whatever its tab, and an agent's is never let go (browser/agent.ts). */
async function trim() {
  const keep = (p: Page) => !!p.player || playingNow(p) || pageKept(p.id)
  if ((!spare && !discardable(pages.values(), keep).length) || !(await shortOfMemory())) return
  endSpare()
  for (const p of discardable(pages.values(), keep)) end(p)
}
setInterval(() => void trim(), 60_000).unref()

/** Whether the computer is short of memory: macOS's memory pressure (warn or critical), Linux's and Windows' available
 *  memory. */
function shortOfMemory(): Promise<boolean> {
  if (process.platform === "win32") return Promise.resolve(os.freemem() / os.totalmem() < 0.1)
  if (MAC) return new Promise((done) => execFile("/usr/sbin/sysctl", ["-n", "kern.memorystatus_vm_pressure_level"], { timeout: 2000 }, (e, out) => done(!e && Number(out) >= 2)))
  try {
    const m = fs.readFileSync("/proc/meminfo", "utf8"), kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(m)?.[1] ?? 0)
    return Promise.resolve(kb("MemTotal") > 0 && kb("MemAvailable") / kb("MemTotal") < 0.1)
  } catch { return Promise.resolve(false) }
}

/** The page a window's keyboard last came from as it was hidden, till the window asks (`web:take`) or it's shown. */
const keyboardFrom = new WeakMap<AppWindow, number>()

/** Where its tab wants it (null: hidden); in its player or full screen it stays filling that till it's back. */
function place(p: Page, rect: WebRect | null) {
  p.want = rect && rect.width >= 2 && rect.height >= 2 ? rect : null
  fit(p)
}

function fit(p: Page) {
  const fill = p.player ?? (p.full ? p.win : null)
  if (fill) {
    if (fill.isDestroyed()) return
    const [width, height] = fill.getContentSize()
    p.parked = p.resting = false
    p.view.setBounds({ x: 0, y: 0, width, height })
    p.view.setVisible(true)
    return
  }
  const rect = p.agent ? null : p.want
  if (!rect) {
    if (p.drawn) return park(p)
    if (!p.view.getVisible()) return
    p.hadFocus = p.view.webContents.isFocused()
    p.view.setVisible(false)
    // (a hidden view keeps the keyboard: the window takes it, for what's over the page, the palette's search)
    if (p.hadFocus) { p.win.webContents.focus(); keyboardFrom.set(p.win, p.id) }
    return
  }
  if (keyboardFrom.get(p.win) === p.id) keyboardFrom.delete(p.win) // (shown again: `web:place` gives it back)
  // (from its parking: over the window's other pages, as a page shown afresh is)
  if (p.parked) { p.parked = p.resting = false; p.view.setVisible(false); addPage(p.win, p.view) }
  // The window's page may be zoomed (⌘+): its CSS pixels are that many of the window's.
  const z = p.win.webContents.getZoomFactor()
  p.view.setBounds({ x: Math.round(rect.x * z), y: Math.round(rect.y * z), width: Math.round(rect.width * z), height: Math.round(rect.height * z) })
  p.view.setVisible(true)
}

function go(p: Page, action: string, url?: string): unknown {
  const wc = p.view.webContents
  const h = wc.navigationHistory
  if (action === "back" && canBack(p)) h.goBack()
  else if (action === "forward" && h.canGoForward()) h.goForward()
  // (a page that crashed for good starts a renderer again)
  else if (action === "reload") wc.reload()
  // The user chose to go on past its certificate warning: that host with that certificate, in these logins, this session.
  else if (action === "allow-cert" && p.cert && p.error) { unsafeOk.add(`${p.profile} ${p.cert.host} ${p.cert.fp}`); void wc.loadURL(p.cert.url).catch(() => {}) }
  // (its source in a tab of its own: the window opens it, in its container)
  else if (action === "source") { if (web(wc.getURL())) tell(p.win, { type: "source", id: p.id, url: `view-source:${wc.getURL()}` }) }
  // Tab `url` is to be its copy: Back and Forward too (taken as that tab's page is made, `web:open`).
  // Tab `url` is to be its copy: its kept history is that tab's too, which its page starts from (`pastOf`).
  else if (action === "duplicate" && url && tabOf(url) && p.tab) {
    keepPast(p)
    const k = pastsOf().get(p.tab)
    if (k) { pastsOf().set(tabOf(url), { ...k, at: Date.now() }); pastTimer ??= setTimeout(savePasts, 2000) }
  }
  else if (action === "hard-reload") wc.reloadIgnoringCache()
  // (a page's DevTools are a window of their own: a view has nowhere to dock them)
  else if (action === "devtools") { if (wc.isDevToolsOpened()) wc.closeDevTools(); else wc.openDevTools({ mode: "detach" }) }
  else if (action === "zoom-in" || action === "zoom-out" || action === "zoom-reset") zoomSite(p, action === "zoom-reset" ? 0 : action === "zoom-in" ? 1 : -1)
  else if (action === "print") wc.print({}, () => {})
  // Back's and Forward's lists: each place it can go, by its index (`go-to` goes there), `at` the one it's on.
  else if (action === "history") return { at: h.getActiveIndex(), entries: h.getAllEntries().map((x, i) => ({ i, url: x.url, title: x.title })).filter((x) => shows(x.url)) }
  else if (action === "go-to") { const i = Number(url); if (Number.isInteger(i) && i >= 0 && i < h.length() && shows(h.getEntryAtIndex(i)?.url ?? "")) h.goToIndex(i) }
  // (where Back or Forward would go, for a tab of its own)
  else if (action === "back-address") return canBack(p) ? h.getEntryAtIndex(h.getActiveIndex() - 1)?.url : undefined
  else if (action === "forward-address") return h.canGoForward() ? h.getEntryAtIndex(h.getActiveIndex() + 1)?.url : undefined
  else if (action === "stop") wc.stop()
  else if (action === "mute" || action === "unmute") { wc.setAudioMuted(action === "mute"); sendState(p) }
  // (a hidden page never has the keyboard: it gets it as it's shown, `web:place` answering `focused`)
  else if (action === "focus") { if (p.player) return; if (shownNow(p)) wc.focus(); else p.hadFocus = true }
  else if (action === "load" && url && shows(url)) { p.target = url; void wc.loadURL(url).catch(() => {}) }
  // (answers "none" when the page has no video)
  else if (action === "pip") return wc.executeJavaScriptInIsolatedWorld(1004, [{ code: PIP }], true).catch(() => null)
}

/** Certificates the user went on past, by "<profile> <host> <fingerprint>": for this run of the app only. */
const unsafeOk = new Set<string>()

// ---------- zoom: a site's, as Chrome's, kept per host on this Mac (userData web-zoom.json), never the vault ----------

const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]
let zooms: Record<string, number> | null = null
const zoomFile = () => path.join(app.getPath("userData"), "web-zoom.json")
function zoomsKept() {
  if (!zooms) { try { zooms = JSON.parse(fs.readFileSync(zoomFile(), "utf8")) as Record<string, number> } catch { zooms = {} } }
  return zooms
}
const zoomOf = (host: string) => { const z = zoomsKept()[host]; return typeof z === "number" && z >= ZOOMS[0] && z <= ZOOMS[ZOOMS.length - 1] ? z : 1 }
const zoomTo = (p: Page, z: number) => { const wc = p.view.webContents; if (!wc.isDestroyed() && Math.abs(wc.getZoomFactor() - z) > 0.001) wc.setZoomFactor(z) }
/** Page `p`'s site a step in (1) or out (-1), or back to 100% (0): its other pages follow, in every container. */
function zoomSite(p: Page, step: -1 | 0 | 1) {
  const host = hostOfUrl(p.view.webContents.getURL()), now = p.view.webContents.getZoomFactor()
  if (!host) return
  const to = step === 0 ? 1 : (step > 0 ? ZOOMS.find((z) => z > now + 0.001) : ZOOMS.findLast((z) => z < now - 0.001)) ?? now
  const k = zoomsKept()
  if (Math.abs(to - 1) < 0.001) delete k[host]; else k[host] = to
  try { writeAtomic(zoomFile(), JSON.stringify(k)) } catch { /* this session's only */ }
  for (const x of pages.values()) if (!x.agent && hostOfUrl(x.view.webContents.getURL()) === host) { zoomTo(x, to); sendState(x) }
}

// ---------- players: a page in a window of its own, to watch or share (a call's window picker finds it by its title) ----------

const PLAYER_TITLE = "Vaultite player"
/** The page's main video: the biggest playing (else any), or the biggest frame that may go full screen (an embedded
 *  player), or none (the page itself fills the player). */
const MAIN_VIDEO = `const size = (el) => { const r = el.getBoundingClientRect(); return r.width >= 160 && r.height >= 90 ? r.width * r.height : 0 }
  const videos = [...document.querySelectorAll("video")].map((el) => ({ el, video: el, n: size(el) * (el.paused ? 1 : 2) }))
  const frames = [...document.querySelectorAll("iframe")].filter((f) => f.allowFullscreen || /\bfullscreen\b/.test(f.allow)).map((el) => ({ el, video: null, n: size(el) }))
  const best = [...videos, ...frames].filter((c) => c.n > 0).sort((a, b) => b.n - a.n)[0]`
// (what goes full screen with a video is its site's player, the box around it no bigger than it: its controls, captions)
const FILL = `(() => {
  ${MAIN_VIDEO}
  if (!best) return false
  let el = best.el
  if (best.video) {
    const n = size(best.video)
    while (el.parentElement && el.parentElement !== document.body && size(el.parentElement) <= n * 1.25) el = el.parentElement
    best.video.setAttribute("data-vaultite-player-video", "")
  }
  el.setAttribute("data-vaultite-player", "")
  return el.requestFullscreen({ navigationUI: "hide" }).then(() => true, () => false)
})()`
const FILL_CSS = `[data-vaultite-player]:fullscreen { background: #000 !important }
[data-vaultite-player]:fullscreen [data-vaultite-player-video], video[data-vaultite-player]:fullscreen { width: 100% !important; height: 100% !important;
  max-width: none !important; max-height: none !important; object-fit: contain !important }`
const UNFILL = `(() => { for (const el of document.querySelectorAll("[data-vaultite-player], [data-vaultite-player-video]")) { el.removeAttribute("data-vaultite-player"); el.removeAttribute("data-vaultite-player-video") }
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}) })()`
const PIP = `(() => {
  if (document.pictureInPictureElement) return void document.exitPictureInPicture().catch(() => {})
  ${MAIN_VIDEO}
  const v = videos.filter((c) => c.n > 0).sort((a, b) => b.n - a.n)[0]?.el
  if (!v) return "none"
  return v.requestPictureInPicture().then(() => true, () => false)
})()`
/** While a player is open, macOS doesn't nap the app (it's often in the background, shared in a call). */
let napBlock: number | null = null
const players = () => [...pages.values()].some((p) => p.player)

/** Out of full screen (its player, or Esc, or the window leaving full screen). */
function leaveFull(p: Page) {
  if (!p.view.webContents.isDestroyed()) void p.view.webContents.executeJavaScriptInIsolatedWorld(1004, [{ code: "document.fullscreenElement && void document.exitFullscreen().catch(() => {})" }]).catch(() => {})
}

/** Into its player: the page moves (playing on, not loaded again) into a window of its own, which it fills, its main
 *  video full screen in it; never throttled while hidden or on another Space, nor let go under memory pressure. */
async function toPlayer(p: Page, fullScreen: boolean) {
  if (p.player) { if (!p.player.isDestroyed()) { p.player.show(); p.player.focus() } return }
  const wc = p.view.webContents
  if (wc.isDestroyed() || p.win.isDestroyed()) return
  const area = screen.getDisplayMatching(p.win.getBounds()).workArea
  const width = Math.min(1280, Math.round(area.width * 0.8)), height = Math.round(width * 9 / 16)
  const w = new BaseWindow({ title: PLAYER_TITLE, width, height, x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2),
    minWidth: 320, minHeight: 180, backgroundColor: "#000000", show: false })
  p.player = w
  p.win.contentView.removeChildView(p.view)
  w.contentView.addChildView(p.view)
  wc.setBackgroundThrottling(false)
  // (full screen in its tab already: it stays so, filling the player, and the window it made full screen goes back)
  if (p.full) { p.filled = true; if (p.madeFull) { p.madeFull = false; p.win.setFullScreen(false) } }
  // (as its content is laid out: on Linux its menu bar comes and goes with no resize)
  w.contentView.on("bounds-changed", () => fit(p))
  w.on("close", () => fromPlayer(p, true))
  fit(p)
  w.show()
  if (fullScreen) w.setFullScreen(true)
  wc.focus()
  napBlock ??= powerSaveBlocker.start("prevent-app-suspension")
  sendState(p)
  pagesChanged(p.win)
  if (p.filled) return
  p.fillCss = await wc.insertCSS(FILL_CSS, { cssOrigin: "user" }).catch(() => undefined)
  const filled = p.player === w && await wc.executeJavaScriptInIsolatedWorld(1004, [{ code: FILL }], true).catch(() => false) === true
  if (filled && p.player === w) p.filled = true
}

/** Back in its tab, still playing: hidden till the tab places it (shown or not), the player closed. `user`: they asked,
 *  so its window comes to the front. */
function fromPlayer(p: Page, user = false) {
  const w = p.player
  if (!w) return
  p.player = undefined
  p.filled = false
  const wc = p.view.webContents
  if (!wc.isDestroyed()) {
    wc.setBackgroundThrottling(!p.drawn)
    void wc.executeJavaScriptInIsolatedWorld(1004, [{ code: UNFILL }]).catch(() => {})
    if (p.fillCss) void wc.removeInsertedCSS(p.fillCss).catch(() => {})
  }
  p.fillCss = undefined
  // (closed after this turn: this may be its own close)
  if (!w.isDestroyed()) { w.contentView.removeChildView(p.view); setImmediate(() => { if (!w.isDestroyed()) w.close() }) }
  if (pages.has(p.id) && !p.win.isDestroyed()) {
    p.view.setVisible(false)
    p.want = null
    addPage(p.win, p.view)
    if (p.drawn) { p.parked = p.resting = false; park(p) }
    sendState(p)
    pagesChanged(p.win)
    if (user) { p.win.show(); p.win.focus() }
  }
  if (napBlock !== null && !players()) { powerSaveBlocker.stop(napBlock); napBlock = null }
}

const str = (x: unknown) => { if (typeof x !== "string") throw new Error("expected text"); return x }
/** A tab's id as the app's tabs make them (core/layout.ts newId); anything else is no tab. */
const tabOf = (x: unknown) => (typeof x === "string" && /^[\w-]{1,64}$/.test(x) ? x : "")
const rectOf = (r: unknown): WebRect | null => {
  if (!r || typeof r !== "object") return null
  const o = r as Record<string, unknown>
  return ["x", "y", "width", "height"].every((k) => typeof o[k] === "number" && Number.isFinite(o[k])) ? o as WebRect : null
}
/** A page of this window. */
function mine(win: AppWindow, id: unknown) {
  const p = pages.get(Number(id))
  if (!p || p.win !== win) throw new Error("no such page")
  return p
}

/** A page whose renderer died (a stray `pkill -f`, memory, a crash) loads again, three times a minute at most so one
 *  dying as it loads doesn't loop. `gone` hears each death, `giveUp` the last (the window says so, not blank). */
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

/** Wire a vault window: its pages end with it; as its page reloads, its tabs take their pages back or they end. */
export function webWindow(win: AppWindow) {
  // (a page full screen in it follows it as it goes full screen; the window leaving full screen takes the page out too)
  win.contentView.on("bounds-changed", () => { for (const p of pages.values()) if (p.win === win && p.full && !p.player) fit(p) })
  win.on("leave-full-screen", () => { for (const p of pages.values()) if (p.win === win && p.full && !p.player) leaveFull(p) })
  win.on("closed", () => {
    // (a page on its way to another window goes on: that window takes it, else it ends)
    for (const p of [...pages.values()]) if (p.win === win && p.moving === undefined) end(p)
    // (no page left anywhere: no spare kept for one)
    if (!pages.size) endSpare()
  })
  win.webContents.on("did-start-navigation", (d) => {
    if (!d.isMainFrame || d.isSameDocument) return
    raise(win, null)
    for (const p of pages.values()) if (p.win === win && !p.player) { if (p.full) leaveFull(p); p.want = null; stow(p) }
    for (const p of windowReloaded(pages.values(), win, Date.now())) end(p)
    setTimeout(() => { for (const p of unclaimed(pages.values(), Date.now())) end(p) }, RECLAIM_MS + 100)
  })
}

// An agent's page in the background (browser/agent.ts): no tab, parked.
setOpener(async (win, url, profile) => {
  await engineLoaded()
  if (!shows(url)) throw new Error("only http and https pages")
  await readySession(profile)
  if (!mayOpen(profile)) throw new Error("this container is locked")
  const p = make(win as AppWindow, url, profile, "", { agent: true })
  pagesChanged(p.win)
  return allPages().find((x) => x.id === p.id)!
})

/** What a page's right-click offers besides its own: the containers to open a link in, and Glance (a plugin, when on),
 *  which ⌥-click on a link in a page also opens (web-preload.cjs). The window tells them as they change. */
let menus: { containers: { id: string; name: string }[]; glance: boolean } = { containers: [], glance: false }
const tellGlance = (wc: WebContents) => { if (!wc.isDestroyed()) wc.send("vaultite:web:glance", menus.glance) }
handle("web:menus", (_win, m) => {
  const o = (m && typeof m === "object" ? m : {}) as { containers?: unknown; glance?: unknown }
  const containers = (Array.isArray(o.containers) ? o.containers : []).flatMap((c) => (c && typeof c.id === "string" && profileOf(c.id) && typeof c.name === "string"
    ? [{ id: c.id as string, name: (c.name as string).slice(0, 80) }] : [])).slice(0, 50)
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
// A page made for a tab the window opens after (a page's link to a new tab, a glance's page kept as a tab): the tab's now.
handle("web:adopt", (win, id, tab) => {
  const p = pages.get(Number(id)), to = tabOf(tab)
  if (!p || p.win !== win || p.closing || !to || p.agent) throw new Error("that page is gone")
  p.orphan = undefined
  own(p, to)
  if (p.downloaded) tell(p.win, { type: "close", tab: to })
})

// ---------- each tab's page history, kept on this Mac for it to come back with (⌘⇧T, a relaunch, a page let go) ----------

type Past = { profile: string; index: number; entries: { url: string; title: string; pageState?: string }[]; at: number }
const pastFile = () => path.join(app.getPath("userData"), "web-tab-history.json")
let pasts: Map<string, Past> | null = null
const pastsOf = () => {
  if (pasts) return pasts
  try { pasts = new Map(Object.entries(JSON.parse(fs.readFileSync(pastFile(), "utf8")) as Record<string, Past>)) } catch { pasts = new Map() }
  return pasts
}
let pastTimer: NodeJS.Timeout | null = null
function savePasts() {
  if (pastTimer) { clearTimeout(pastTimer); pastTimer = null }
  const old = Date.now() - 30 * 86400_000
  const list = [...pastsOf()].filter(([, v]) => v.at > old).sort((a, b) => b[1].at - a[1].at).slice(0, 500)
  pasts = new Map(list)
  try { writeAtomic(pastFile(), JSON.stringify(Object.fromEntries(list))) } catch (e) { console.error("vaultite: tabs' page history wasn't kept:", e) }
}
/** Page `p`'s history as it is now, kept for its tab (its own addresses only: no spare's about:blank, 50 around where it is). */
function keepPast(p: Page) {
  const wc = p.view.webContents
  if (!p.tab || p.agent || wc.isDestroyed() || p.blankBehind || p.restoring) return
  const h = wc.navigationHistory, all = h.getAllEntries(), at = h.getActiveIndex()
  if (!shows(all[at]?.url ?? "")) return
  // (a page's state, its scroll and form, only while small: the file is rewritten as pages move on)
  const mine = all.map((e, i) => ({ url: e.url, title: e.title, ...(e.pageState && e.pageState.length < 8000 ? { pageState: e.pageState } : {}), i })).filter((e) => shows(e.url))
  const i = mine.findIndex((e) => e.i === at), from = Math.max(0, i - 40), was = pastsOf().get(p.tab)
  const next = { profile: p.profile, index: i - from, entries: mine.slice(from, i + 10).map(({ i: _, ...e }) => e), at: Date.now() }
  pastsOf().set(p.tab, next)
  // (a title changing alone, as some sites' do every second, waits for the next move to be written)
  if (!was || was.index !== next.index || was.entries.map((e) => e.url).join() !== next.entries.map((e) => e.url).join()) pastTimer ??= setTimeout(savePasts, 2000)
}
/** How tab `tab`'s page starts in `profile` at `url`, from its kept history: as it was (its page come back), or, in other
 *  logins or at another address (moved to another container), its places up to there with `url` loaded after (`load`). */
function pastOf(tab: string, profile: string, url: string) {
  const k = pastsOf().get(tab)
  if (!k) return null
  if (k.profile === profile && k.entries[k.index]?.url === url) return k.entries.length > 1 ? { entries: k.entries, index: k.index, load: false } : null
  // (without what sites keep in them: another session's)
  const back = k.entries.slice(0, k.index + 1).map(({ url, title }) => ({ url, title }))
  if (back.at(-1)?.url === url) back.pop()
  return back.length ? { entries: back, index: back.length - 1, load: true } : null
}

/** The IPC handlers (main.ts checks the asking page is a vault window's and gives its AppWindow). */
export const webHandlers: Record<string, (win: AppWindow, ...args: unknown[]) => unknown> = {
  // (a tab's page is the tab's: shown again, it's the same one, wherever it went since)
  "web:open": async (win, url, rect, profile, tab) => {
    await engineLoaded()
    const u = str(url), prof = profileOf(profile), owner = tabOf(tab)
    if (!shows(u)) throw new Error("only http and https pages")
    await readySession(prof)
    if (!mayOpen(prof)) throw new Error("this container is locked")
    const { reuse, end: other } = claim(pages.values(), win, owner, prof)
    // (the tab moved to another container: its history as it is now, for Back to go where it went before)
    for (const x of other) { keepPast(x); end(x) }
    const p = reuse ?? make(win, u, prof, owner)
    if (p.win !== win) moveTo(p, win)
    p.holds++
    p.orphan = undefined
    pagesChanged(win)
    // (shown at once where its tab asks, a page shown again or a new one, rather than after the tab draws: as `web:place`)
    const r = rectOf(rect), wasHidden = !shownNow(p)
    place(p, r)
    let focused = false
    if (r && wasHidden && shownNow(p)) { focused = !!p.hadFocus; p.hadFocus = false }
    return { id: p.id, state: stateOf(p), focused }
  },
  "web:place": (win, id, rect) => {
    const p = mine(win, id), r = rectOf(rect) && mayOpen(p.profile) ? rectOf(rect) : null, wasHidden = !shownNow(p)
    place(p, r)
    // (shown again: whether it had the keyboard when it was hidden)
    if (r && wasHidden && shownNow(p)) { const had = !!p.hadFocus; p.hadFocus = false; return { focused: had, shown: true } }
    return { focused: false, shown: shownNow(p) }
  },
  // The window focused something of its own (desktop.ts): the keyboard comes to it from a page that has it.
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
  "web:raise": (win, how) => raise(win, how === "app" || how === "through" ? how : null),
  "web:pointer": (win, id, m) => pointer(mine(win, id), m),
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
  // Its player: on (`fullScreen`: on a Space of its own) or back in its tab.
  "web:player": (win, id, on, fullScreen) => { const p = mine(win, id); if (on) return toPlayer(p, fullScreen !== false); fromPlayer(p, true) },
  // (`moved`: its tab went on in another of this vault's windows, which takes its page as it shows it, `adopt`)
  "web:close": (win, tab, moved) => {
    if (moved !== true) { for (const p of tabGone(pages.values(), win, tabOf(tab))) end(p); return }
    tabMoved(pages.values(), win, tabOf(tab), Date.now())
    setTimeout(() => { for (const p of unmoved(pages.values(), Date.now())) end(p) }, MOVE_MS + 100).unref()
  },
  "web:go": (win, id, action, url) => go(mine(win, id), str(action), typeof url === "string" ? url : undefined),
  // Find in the page (`found` events answer): `next` goes on from the match it's at, else a new search; "" stops it, the
  // match it was at left selected, as Chrome's Esc does.
  "web:find": (win, id, text, o) => {
    const wc = mine(win, id).view.webContents, t = str(text).slice(0, 1000), x = (o ?? {}) as { forward?: unknown; next?: unknown; matchCase?: unknown }
    if (!t) { wc.stopFindInPage("keepSelection"); return null }
    return wc.findInPage(t, { forward: x.forward !== false, findNext: x.next !== true, matchCase: x.matchCase === true })
  },
  "web:html": async (win, id) => {
    const p = mine(win, id)
    // In a world of its own: the page's scripts can't stand in for what's read.
    const r = await p.view.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: "({ url: location.href, title: document.title, html: '<!doctype html>' + document.documentElement.outerHTML })" }])
    return r as { url: string; title: string; html: string }
  },
  "web:external": (_win, url) => { const u = str(url); if (web(u)) openElsewhere(u); else if (/^mailto:/i.test(u)) void shell.openExternal(u) },
  "web:keys": (win, steps) => { keysOf.set(win, new Set(Array.isArray(steps) ? steps.filter((s): s is string => typeof s === "string") : [])) },
  "web:list": (win) => [...pages.values()].filter((p) => p.win === win && !p.closing)
    .map((p) => ({ id: p.id, profile: p.profile, tab: p.tab, shown: p.holds > 0, ...stateOf(p) })),
  "web:sites": (_win, profile) => sitesOf(profileOf(profile)),
  "web:forget": async (_win, profile, site) => forgetSite(profileOf(profile), str(site).toLowerCase()),
  "web:move": (_win, from, to, sites, copy) => moveLogins(profileOf(from), profileOf(to),
    (Array.isArray(sites) ? sites : []).filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()).slice(0, 20), copy === true),
  "web:seal": (_win, from, sites, to, key) => sealLogin(profileOf(from), sitesList(sites), profileOf(to), str(key)),
  // Claude Code on the web's sessions in the profiles the app names: the window is told them from now on, as they
  // change (`cloud`) and their news. Asked again with what changed (a workspace, the user's yes, an account hidden).
  "web:cloud": (win, want) => {
    cloudWindows.add(win)
    cloudWant = cloudWantOf(want)
    if (!cloudTimer) cloudTimer = setInterval(() => void cloudRead(), 1000)
    void cloudRead()
    return cloudState()
  },
  // (anything but a host is answered "", never the whole list refused)
  // A host with no icon of its own yet (a site only its cookies name, one kept before) is asked for its /favicon.ico.
  "web:icons": (_win, hosts) => {
    const all = loadIcons(), keys = (Array.isArray(hosts) ? hosts : []).slice(0, 500).filter((h): h is string => typeof h === "string")
    for (const h of keys) if (!h.includes("/") && /^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?$|^localhost(:\d+)?$/i.test(h) && (!all.has(h) || staleIcons.has(h))) void hostIcon(webSession(""), h)
    return Object.fromEntries(keys.map((h) => [h, all.get(h) ?? ""]))
  },
  // The browser engine's features (electron/browser/): each answers its own names.
  "web:engine": (win, name, ...args) => engineCall(win, name, args),
  "web:reveal": (_win, p) => {
    const file = path.resolve(str(p))
    if (path.dirname(file) === app.getPath("downloads") && fs.existsSync(file)) shell.showItemInFolder(file)
  },
}

// ---------- the sites a profile keeps cookies for, and who's signed in ----------

/** Hosts under a two-part public suffix ("co.uk"), for which a site is three labels. A short list: the panel only groups
 *  cookies by site, so an unknown suffix just shows one more label than it might. */
const TWO_PART = /\.(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/
/** "chat.example.co.uk" → "example.co.uk", "auth.claude.ai" → "claude.ai". */
function siteOf(host: string) {
  const h = host.toLowerCase().replace(/^\./, "").replace(/\.$/, "")
  if (!h || /^[\d.]+$/.test(h) || !h.includes(".")) return h
  const parts = h.split(".")
  return parts.slice(TWO_PART.test(h) ? -3 : -2).join(".")
}
const hostOfUrl = (u: string) => { try { return new URL(u).hostname } catch { return "" } }

/** Accounts found lately, by "<profile> <site>": `login` the login they were found for (see loginOf). null: nobody
 *  signed in; an empty account: signed in, its name not had. */
const accounts = new Map<string, { at: number; login: string; who: Who | null }>()
/** How long a site isn't asked again for the same login: named, or not (it may say later); a page's look is free. */
const ASK_NAMED = 6 * 3_600_000, ASK_UNNAMED = 30 * 60_000, ASK_LOOK = 60_000

/** The last account named for each login (by profile, site, and a hash of its login, so another login asks again),
 *  for when its site won't say and so a restart doesn't ask again: in userData, never the vault. */
type Known = Record<string, Record<string, { login: string; who: Who; at?: number }>>
let known: Known | null = null
const knownFile = () => path.join(app.getPath("userData"), "web-accounts.json")
function loadKnown(): Known {
  if (!known) { try { known = JSON.parse(fs.readFileSync(knownFile(), "utf8")) as Known } catch { known = {} } }
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
/** What says it's still the same login: its login cookie, else which cookies the site keeps (signing in or out changes
 *  them); a site only an open page tells, its last look. */
function loginOf(how: Rule, mine: Electron.Cookie[], login?: Electron.Cookie) {
  if (login) return loginHash(login.value)
  return how.url || how.read ? loginHash(mine.map((c) => c.name).sort().join(" ")) : "look"
}

/** Who's signed in to `site` in a profile (its cookies given), asked as rarely as its rule allows. A site with a login
 *  cookie is signed in by it alone: its name is asked, else the one last named for that login. */
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
  // Not named now: the name last had for this login, else signed in when its cookie or page says so.
  else if (kept?.login === id && (!lookOnly || found === null)) who = kept.who
  else if (found || login) who = { account: "" }
  accounts.set(key, { at: now, login: id, who })
  return who
}

/** What a site's rule finds: who (an empty account: signed in, not named), false: signed out, null: it can't tell. */
async function askWho(s: Electron.Session, how: Rule, open: Page | undefined): Promise<Who | false | null> {
  const inPage = (code: string) => open!.view.webContents.executeJavaScriptInIsolatedWorld(1002, [{ code }]) as Promise<unknown>
  const cookie = async (domain: string, name: string) => (await s.cookies.get({ domain, name }).catch(() => []))[0]?.value ?? ""
  if (how.look && open) {
    const w = how.look.read(await inPage(how.look.code).catch(() => null))
    if (w !== null || !how.read) return w
  }
  if (!how.read) return null
  let res: { url: string; body: unknown } | null = null
  if (how.url) {
    const as = how.text ? "text" : "json", headers = { accept: how.text ? "text/html,*/*" : "application/json", ...how.headers }
    // (from its open page as its own scripts would, else, or when that page is on another of its hosts, from here)
    if (how.page && open && !how.method) res = await inPage(`fetch(${JSON.stringify(how.url)}, { credentials: "include", headers: ${JSON.stringify(headers)} })
      .then(async (r) => r.ok ? { url: r.url, body: await r.${as}() } : null).catch(() => null)`).catch(() => null) as typeof res
    res ??= await s.fetch(how.url, { method: how.method ?? "GET", credentials: "include", signal: AbortSignal.timeout(8000), headers } as RequestInit)
      .then(async (r) => (r.ok ? { url: r.url, body: await r[as]() as unknown } : null)).catch(() => null)
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
  // A login that signs in to other sites too (Google's: YouTube, google.<country>) is one row for them all.
  const joined = new Set<string>()
  for (const s of out) {
    const also = s.signed ? ACCOUNTS[s.site]?.with : undefined
    if (!also) continue
    const sites = names.filter((site) => site !== s.site && Object.entries(also).some(([k, name]) => covers(k, site) && cookies.some((c) => siteOf(c.domain ?? "") === site && c.name === name)))
    if (!sites.length) continue
    s.with = sites
    for (const x of sites) { joined.add(x); s.last = Math.max(s.last ?? 0, last.get(x) ?? 0) || undefined }
  }
  // Signed in first, then the latest visited, then A to Z.
  return out.filter((s) => !joined.has(s.site))
    .sort((a, b) => Number(!b.signed) - Number(!a.signed) || (b.last ?? 0) - (a.last ?? 0) || a.site.localeCompare(b.site))
}

/** Sign out of a site in a profile: its cookies and storage go, its open pages reload. */
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

/** A login as it leaves a profile: its sites' cookies, who its site said it was (to check it there), what it was named
 *  as here and which of its sites were opened here. */
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

/** A login into a profile: its sites' cookies, replacing any there; taken back when the site then names nobody, or
 *  someone else, where it named someone (its login kept in storage). */
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
  // Named there at once, as it was where it came from; not a tracker there, since it was opened there.
  for (const n of names) {
    accounts.delete(`${to} ${n}`)
    const k = l.known[n]
    if (k) keepKnown(to, n, k.login, k.who)
  }
  addVisited(to, l.visited.concat(names[0]))
  for (const n of names) reloadSite(to, n)
  return { ok: true, account: l.account ?? undefined }
}

/** Move (or copy) a login to another profile; the source signs out only once it's in. */
async function moveLogins(from: string, to: string, names: string[], copy: boolean): Promise<{ ok: boolean; account?: string }> {
  if (from === to) throw new Error("nothing to move")
  if (!mayOpen(to)) throw new Error("this container is locked")
  const r = await loginIn(to, await loginOut(from, names))
  if (r.ok && !copy) for (const n of names) await forgetSite(from, n)
  return r
}

// ---------- another Mac's logins (Machines): who's signed in where, and a login copied there ----------

// A login leaves only sealed for the other app (browser/sealed.ts), on the user's act in this window; taking one in
// (remote:take) the server may ask: like an agent signing in, it adds a login of the sites named and reads none.

/** How long a sealed login may take to arrive, and the boxes taken lately (none is taken twice). */
const SEALED_MS = 5 * 60_000
const taken = new Map<string, number>()

/** This app's key pair for sealed logins, made once and kept encrypted with the keyring's key (userData). With no keyring
 *  (a Linux without a Secret Service), held only till the app quits, as agents' logins are (browser/logins.ts). */
let sealKeys: { pub: string; priv: string } | null = null
function keysForSealing() {
  if (sealKeys) return sealKeys
  if (!safeStorage.isEncryptionAvailable()) return (sealKeys = newKeys())
  const file = path.join(app.getPath("userData"), "Login Key.vaultite")
  try { sealKeys = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))) as { pub: string; priv: string } }
  catch {
    sealKeys = newKeys()
    fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(sealKeys)), { mode: 0o600 })
  }
  return sealKeys
}

const SAME_SITE = new Set(["unspecified", "no_restriction", "lax", "strict"])
/** A sealed login's cookies, each of one of its sites, as cookies.get gives them: anything else is left out. */
function cookiesOf(list: unknown, names: string[]): Electron.Cookie[] {
  const ok = (c: Record<string, unknown>) => typeof c.name === "string" && typeof c.value === "string" && typeof c.domain === "string"
    && /^\.?[\w.-]+$/.test(c.domain) && names.includes(siteOf(c.domain)) && typeof c.path === "string" && c.path.startsWith("/")
    && SAME_SITE.has(String(c.sameSite)) && (c.expirationDate === undefined || typeof c.expirationDate === "number")
  return (Array.isArray(list) ? list : []).filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && ok(c)).slice(0, 500)
    .map((c) => ({ name: c.name as string, value: c.value as string, domain: c.domain as string, path: c.path as string, hostOnly: c.hostOnly === true,
      secure: c.secure === true, httpOnly: c.httpOnly === true, session: c.session === true, sameSite: c.sameSite as Electron.Cookie["sameSite"],
      ...(typeof c.expirationDate === "number" ? { expirationDate: c.expirationDate } : {}) }))
}
const sitesList = (v: unknown) => (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()).slice(0, 20)
const sealedFor = (to: string) => `vaultite login for ${to}`

handle("remote:key", () => ({ key: keysForSealing().pub }))
// Who's signed in where, in the profiles asked (a locked container's left out): names only, as the Sites tab shows them.
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
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>
  const now = Date.now()
  for (const [k, at] of taken) if (now - at > SEALED_MS) taken.delete(k)
  if (typeof d.at !== "number" || Math.abs(now - d.at) > SEALED_MS) throw new Error("the login took too long to come: copy it again")
  if (taken.has(from)) throw new Error("that login was copied here already")
  taken.set(from, now)
  const names = sitesList(d.names)
  const cookies = cookiesOf(d.cookies, names)
  if (!names.length || !cookies.length) throw new Error("no cookies to move")
  const known: Leaving["known"] = {}
  for (const [n, k] of Object.entries(d.known && typeof d.known === "object" ? d.known as Record<string, { login?: unknown; who?: Who }> : {})) {
    if (names.includes(n) && typeof k?.login === "string" && typeof k.who?.account === "string") known[n] = { login: k.login, who: k.who }
  }
  return loginIn(prof, { names, cookies, account: typeof d.account === "string" ? d.account : null, known, visited: sitesList(d.visited).filter((n) => names.includes(n)) })
})

/** A login sealed for another Mac's app (`key`, its remote:key), for its profile `to`: the user's act in this window. */
async function sealLogin(from: string, names: string[], to: string, key: string) {
  const l = await loginOut(from, names)
  return seal(key, { ...l, at: Date.now() }, sealedFor(to))
}

/** The sites a page was opened at, by profile (this Mac's, in userData: never the vault). */
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

// ---------- sites' icons, for their tabs ----------

/** Icons as data URLs, in userData: a site's by its host (no "www."), its home page's or /favicon.ico; a page's own by
 *  host and first path segment ("google.com/maps"), only where it differs from its host's. */
let icons: Map<string, string> | null = null
/** Hosts whose icon came from a build that kept any page's as its host's (Maps' pin as google.com's): asked again. */
const staleIcons = new Set<string>()
/** The address each key's icon came from (this run's), so a page telling the same one isn't fetched again. */
const iconSrc = new Map<string, string>()
/** Hosts whose /favicon.ico was asked for this run. */
const iconAsked = new Set<string>()
const ICON_MAX = 256 * 1024
const ICONS_KEPT = 300
const ICONS_VERSION = 2
const iconsFile = () => path.join(app.getPath("userData"), "web-icons.json")
/** As the app's tabs name it (web-viewer/icons.tsx iconKey): with its port, without "www."; `page` adds the first
 *  path segment. */
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
      const j = JSON.parse(fs.readFileSync(iconsFile(), "utf8")) as { v?: number; icons?: Record<string, unknown> }
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
/** Keep `icon` as `key`'s (null: none of its own) and tell every window. */
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

/** An icon's bytes, in the page's session (a signed-in site's icon may need its cookies); null if it can't be had in
 *  a few seconds. */
async function iconBytes(s: Session, url: string): Promise<Buffer | null> {
  const data = /^data:image\/[\w.+-]+(;[\w-]+=[\w-]+)*(;base64)?,/i.exec(url)
  if (data) {
    const body = url.slice(data[0].length)
    try { return data[2] ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body), "utf8") } catch { return null }
  }
  if (!web(url)) return null
  try {
    const r = await s.fetch(url, { signal: AbortSignal.timeout(8000), credentials: "include" } as RequestInit)
    if (!r.ok || Number(r.headers.get("content-length") ?? 0) > ICON_MAX) return null
    return Buffer.from(await r.arrayBuffer())
  } catch { return null }
}
/** The first of `urls` that's an image, as an icon. */
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
/** A host's own icon, its /favicon.ico (once a run; `fallback` when it has none), unless it has one already. */
async function hostIcon(s: Session, host: string, fallback?: string) {
  if (!host || (loadIcons().has(host) && !staleIcons.has(host)) || iconAsked.has(host)) return
  iconAsked.add(host)
  const got = await firstIcon(s, [`${LOCAL_HOST.test(host) ? "http" : "https"}://${host}/favicon.ico`])
  if (got) { iconSrc.set(host, got.from); setIcon(host, got.icon) }
  else if (fallback && !loadIcons().has(host)) setIcon(host, fallback)
}

/** The page told its icons' addresses: the first that's an image is its own icon. At its site's home page it's its
 *  site's; elsewhere (Maps on google.com) it's kept for its path, when it differs from the site's. */
async function iconFrom(p: Page, urls: unknown) {
  const list = (Array.isArray(urls) ? urls : []).filter((u): u is string => typeof u === "string" && (web(u) || /^data:image\//i.test(u))).slice(0, 4)
  const page = p.view.webContents.getURL(), host = iconKey(page), key = iconKey(page, true)
  if (!host || !web(page)) return
  // (the site's own /favicon.ico last: a page that names none, or whose named ones fail)
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

// ---------- Claude Code on the web's sessions ----------

/** A claude.ai organization whose sessions are read: `label` its name, or its login's email for a personal one
 *  ("<email>'s Organization"); `profiles` the logins it's in, in the order the app named them. */
export type CloudAccount = { id: string; label: string; profiles: string[] }
/** A session of Claude Code on the web, as its own sidebar has it: `state` from its `session_status`, `updated` in ms,
 *  `url` its page, `account` its organization's id, `profile` the first logins it's in. */
export type CloudSession = { id: string; title: string; state: "running" | "waiting" | "idle"; updated: number; url: string; profile: string; account: string }
/** What the app tells: `signedIn`, some profile it named is signed in to claude.ai (known from its cookies, nothing
 *  asked); the accounts and their sessions only once the user said yes; `base`, claude.ai's address. */
export type CloudState = { signedIn: boolean; accounts: CloudAccount[]; sessions: CloudSession[]; base: string }
/** What the app asks for: the profiles to look in, whether they may be read (the user's yes), accounts not to read. */
type CloudWant = { profiles: string[]; read: boolean; hidden: string[] }

/** Asked of claude.ai with a profile's logins, no page needed. VAULTITE_TEST_CLAUDE_URL: web/qa/webwatch.mjs's stand-in. */
const CLOUD_BASE = process.env.VAULTITE_TEST_CLAUDE_URL || "https://claude.ai"
const CLOUD = {
  orgs: `${CLOUD_BASE}/api/organizations`,
  // (what claude.ai's own sidebar lists: /v1/code/sessions no longer says whether one is working)
  list: `${CLOUD_BASE}/v1/sessions?limit=50`,
  headers: (org: string) => ({ accept: "application/json", "anthropic-version": "2023-06-01", "anthropic-beta": "ccr-byoc-2025-07-29", "x-organization-uuid": org }),
  page: (id: string) => `${CLOUD_BASE}/code/${encodeURIComponent(id)}`,
  site: siteOf(hostOfUrl(CLOUD_BASE)),
  // (read again sooner while a session is working or waiting: its news comes sooner)
  busy: process.env.VAULTITE_TEST_CLAUDE_URL ? 1500 : 5000,
  idle: process.env.VAULTITE_TEST_CLAUDE_URL ? 1500 : 15_000,
  // (a profile's organizations, and whether it's signed in at all, change rarely)
  orgsFor: process.env.VAULTITE_TEST_CLAUDE_URL ? 1500 : 600_000,
  cookiesFor: process.env.VAULTITE_TEST_CLAUDE_URL ? 500 : 10_000,
}
let cloudWant: CloudWant = { profiles: [], read: false, hidden: [] }
const cloudWantOf = (x: unknown): CloudWant => {
  const w = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [])
  return { profiles: [...new Set(strs(w.profiles).filter((p) => p === "" || profileOf(p) === p))].slice(0, 50), read: w.read === true, hidden: strs(w.hidden) }
}
/** The windows that asked (`web:cloud`): they're told the state as it changes, and its news. */
const cloudWindows = new Set<AppWindow>()
/** Whether a profile is signed in to claude.ai, by its cookies, looked at lately. */
const cloudCookies = new Map<string, { at: number; in: boolean }>()
/** A profile's claude.ai organizations (the ones with claude.ai's apps, not an API-only one), read lately. */
const cloudOrgs = new Map<string, { at: number; orgs: { id: string; name: string }[] }>()
/** Each account's sessions as last read, and when to read it next (later after a failure). */
const cloudLists = new Map<string, CloudSession[]>()
const cloudNext = new Map<string, { at: number; wait: number }>()
/** Accounts claude.ai turned away (no Claude Code in that organization): not listed, asked again in an hour. */
const cloudNone = new Set<string>()
let cloudAccounts: CloudAccount[] = []
let cloudSignedIn = false
let cloudTimer: ReturnType<typeof setInterval> | undefined
let cloudReading = false

/** `url` asked with a profile's logins: from one of its claude.ai pages when one is open (the site's own origin: what its
 *  pages ask is never turned away), else with the session's cookies from here, like accountOf. */
async function cloudGet(profile: string, url: string, headers: Record<string, string>): Promise<{ status: number; json: unknown }> {
  const page = [...pages.values()].find((p) => p.profile === profile && !p.view.webContents.isDestroyed() && siteOf(hostOfUrl(p.view.webContents.getURL())) === CLOUD.site)
  if (page) return await page.view.webContents.executeJavaScriptInIsolatedWorld(1003, [{ code: `fetch(${JSON.stringify(url)}, { credentials: "include", headers: ${JSON.stringify(headers)} }).then(async (r) => ({ status: r.status, json: r.ok ? await r.json() : null }))` }])
  const r = await (await readySession(profile)).fetch(url, { credentials: "include", headers })
  return { status: r.status, json: r.ok ? await r.json() : null }
}

async function cloudSignedInTo(profile: string) {
  const had = cloudCookies.get(profile)
  if (had && Date.now() - had.at < CLOUD.cookiesFor) return had.in
  // (logins never used have no folder: not made just to look, which would set up a session, extensions and all)
  if (!sessions.has(profile) && !fs.existsSync(path.join(app.getPath("userData"), "Partitions", partitionOf(profile).replace(/^persist:/, "")))) return false
  const cookies = await (await readySession(profile)).cookies.get({ url: CLOUD_BASE })
  const signed = cookies.some((c) => c.name.startsWith("sessionKey"))
  cloudCookies.set(profile, { at: Date.now(), in: signed })
  return signed
}

/** Its organizations; [] signed out, or when they couldn't be had (asked again a minute later). */
async function cloudOrgsOf(profile: string) {
  const had = cloudOrgs.get(profile)
  if (had && Date.now() < had.at) return had.orgs
  let orgs: { id: string; name: string }[] = [], next = CLOUD.orgsFor
  try {
    const r = await cloudGet(profile, CLOUD.orgs, { accept: "application/json" })
    if (!Array.isArray(r.json)) throw new Error(String(r.status))
    orgs = (r.json as Record<string, unknown>[]).flatMap((o) => typeof o?.uuid === "string" && Array.isArray(o.capabilities) && o.capabilities.includes("chat")
      ? [{ id: o.uuid, name: typeof o.name === "string" ? o.name : "" }] : [])
  } catch { next = 60_000 }
  cloudOrgs.set(profile, { at: Date.now() + next, orgs })
  return orgs
}
const cloudLabel = (name: string) => name.replace(/'s Organization$/, "").trim() || "Claude"

/** An account's sessions, read with `profile`'s logins when they're due; null when they weren't read now. */
async function cloudReadAccount(profile: string, account: string): Promise<CloudSession[] | null> {
  const due = cloudNext.get(account)
  if (due && Date.now() < due.at) return null
  let r: { status: number; json: unknown }
  try { r = await cloudGet(profile, CLOUD.list, CLOUD.headers(account)) } catch { r = { status: 0, json: null } }
  if (r.status === 401 || r.status === 403 || r.status === 404) {
    // (signed out since: its organizations are asked again; turned away: none here)
    if (r.status === 401) cloudOrgs.delete(profile); else cloudNone.add(account)
    cloudNext.set(account, { at: Date.now() + (r.status === 401 ? 60_000 : 3_600_000), wait: CLOUD.idle })
    cloudLists.delete(account)
    return null
  }
  const data = (r.json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    // (a failure: asked again later and later, up to five minutes; the list stays as it was)
    const wait = Math.min(300_000, (due?.wait ?? CLOUD.idle) * 2)
    cloudNext.set(account, { at: Date.now() + wait, wait })
    return null
  }
  cloudNone.delete(account)
  const list = (data as Record<string, unknown>[]).flatMap((x): CloudSession[] => {
    if (typeof x?.id !== "string" || x.session_status === "archived") return []
    const at = Date.parse(String(x.updated_at ?? ""))
    return [{
      id: x.id, title: typeof x.title === "string" && x.title.trim() ? x.title.trim().slice(0, 200) : "Claude Code session",
      state: x.session_status === "running" ? "running" : x.session_status === "requires_action" ? "waiting" : "idle",
      updated: Number.isFinite(at) ? at : 0, url: CLOUD.page(x.id), profile, account,
    }]
  })
  const wait = list.some((c) => c.state !== "idle") ? CLOUD.busy : CLOUD.idle
  cloudNext.set(account, { at: Date.now() + wait, wait })
  return list
}

/** Every account's sessions, most recent first. */
const cloudState = (): CloudState => ({
  signedIn: cloudSignedIn, accounts: cloudAccounts, base: CLOUD_BASE,
  sessions: [...cloudLists.values()].flat().sort((a, b) => b.updated - a.updated),
})

/** What a session going from one state to another is worth telling, if anything. */
function newsOf(was: CloudSession["state"], now: CloudSession["state"]): { kind: "done" | "waiting"; title: string } | null {
  if (was === now) return null
  if (now === "waiting") return { kind: "waiting", title: "Claude Code needs you" }
  if (was === "running") return { kind: "done", title: "Claude Code finished" }
  return null
}
const cloudNews = (s: CloudSession, kind: "done" | "waiting", title: string) => {
  for (const w of cloudWindows) tell(w, { type: "session", id: 0, profile: s.profile, site: CLOUD.site, url: s.url, kind, title, body: s.title })
}

/** Each named profile signed in to claude.ai, each of its organizations once (in the first profile that has it), each
 *  account's sessions when due, with news of what changed; the windows told when anything did. */
async function cloudRead() {
  for (const w of cloudWindows) if (w.isDestroyed()) cloudWindows.delete(w)
  if (!cloudWindows.size) { clearInterval(cloudTimer); cloudTimer = undefined; return }
  if (cloudReading) return
  cloudReading = true
  try {
    const before = JSON.stringify(cloudState())
    const want = cloudWant, hidden = new Set(want.hidden)
    const seen = new Map<string, CloudAccount>()
    let signedIn = false
    for (const profile of want.profiles) {
      if (!(await cloudSignedInTo(profile))) continue
      signedIn = true
      if (!want.read) continue
      for (const o of await cloudOrgsOf(profile)) {
        const had = seen.get(o.id)
        if (had) { had.profiles.push(profile); continue }
        const account = { id: o.id, label: cloudLabel(o.name), profiles: [profile] }
        seen.set(o.id, account)
        if (hidden.has(account.label)) continue
        const was = cloudLists.get(o.id)
        const list = await cloudReadAccount(profile, o.id)
        if (!list) continue
        cloudLists.set(o.id, list)
        // (an account's first read is where things stand, not news; a running session that left the list is done)
        if (!was) continue
        const now = new Map(list.map((c) => [c.id, c]))
        for (const c of was) {
          const n = now.get(c.id), news = newsOf(c.state, n?.state ?? "idle")
          if (news) cloudNews(n ?? c, news.kind, news.title)
        }
        for (const n of list) if (n.state === "waiting" && !was.some((c) => c.id === n.id)) cloudNews(n, "waiting", "Claude Code needs you")
      }
    }
    // (hidden, turned away or gone: their sessions go, and a hidden one shows again from a fresh read)
    for (const id of [...cloudLists.keys()]) if (!seen.has(id) || hidden.has(seen.get(id)!.label) || cloudNone.has(id)) { cloudLists.delete(id); cloudNext.delete(id) }
    cloudAccounts = [...seen.values()].filter((a) => !cloudNone.has(a.id))
    cloudSignedIn = signedIn
    const after = cloudState()
    if (JSON.stringify(after) !== before) for (const w of cloudWindows) tell(w, { type: "cloud", ...after })
  } finally { cloudReading = false }
}

// ---------- the window's page over its pages ----------

/** How the window's page is over its pages: not (null), taking the pointer (a menu, the palette, a drag), or letting it
 *  through to them (a toast, a tooltip: `pointer` passes on what it gets there). */
type Raise = "app" | "through" | null
const raised = new WeakMap<AppWindow, Raise>()

/** A page into the window: over the others, under the window's page while that's raised. */
function addPage(win: AppWindow, view: WebContentsView) {
  const kids = win.contentView.children, at = raised.get(win) ? kids.indexOf(win.view) : -1
  if (at < 0) return win.contentView.addChildView(view)
  // (one already in it, from parking, moves to that index counted without it: from below the window's page, one less,
  // else it went over the window's page and took the clicks meant for what's drawn there)
  const was = kids.indexOf(view)
  win.contentView.addChildView(view, was >= 0 && was < at ? at - 1 : at)
}

function raise(win: AppWindow, how: Raise) {
  if (win.isDestroyed() || (raised.get(win) ?? null) === how) return
  const was = raised.get(win) ?? null
  raised.set(win, how)
  if (!!was === !!how) return
  if (!how) return win.contentView.addChildView(win.view, 0)
  win.contentView.addChildView(win.view)
  // (a page full screen stays over it)
  for (const p of pages.values()) if (p.win === win && p.full && !p.player) win.contentView.addChildView(p.view)
}

/** The pointer over a page while the window's page lets it through, at the page's own CSS pixels from its corner. */
function pointer(p: Page, m: unknown) {
  if (raised.get(p.win) !== "through" || !m || typeof m !== "object") return
  const e = m as { type?: unknown; x?: unknown; y?: unknown; button?: unknown; clickCount?: unknown; dx?: unknown; dy?: unknown }
  const z = p.win.webContents.getZoomFactor(), num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
  const x = Math.round(num(e.x) * z), y = Math.round(num(e.y) * z)
  const button = e.button === "right" || e.button === "middle" ? e.button : "left", clickCount = Math.max(1, Math.min(3, num(e.clickCount)))
  const wc = p.view.webContents
  // (the click landed on the window's view, which macOS gave the keyboard: a press in the page takes it, as a real one does)
  if (e.type === "mouseDown" && !wc.isFocused()) wc.focus()
  const direct = () => {
    if (e.type === "mouseWheel") wc.sendInputEvent({ type: "mouseWheel", x, y, deltaX: -num(e.dx), deltaY: -num(e.dy), canScroll: true })
    else if (e.type === "mouseMove" || e.type === "mouseDown" || e.type === "mouseUp" || e.type === "mouseLeave") wc.sendInputEvent({ type: e.type, x, y, button, clickCount })
  }
  // Over the DevTools protocol, which finds the frame under the pointer as the Mac's input does: sendInputEvent never
  // reaches a frame from another site (a captcha, "Sign in with Google"). At the page's CSS pixels; a leave has none.
  const type = ({ mouseMove: "mouseMoved", mouseDown: "mousePressed", mouseUp: "mouseReleased", mouseWheel: "mouseWheel" } as const)[e.type as string]
  if (!type) { if (e.type === "mouseLeave") { held.delete(wc); direct() } return }
  const bit = { left: 1, right: 2, middle: 4 }[button]
  const was = held.get(wc) ?? 0, now = type === "mousePressed" ? was | bit : type === "mouseReleased" ? was & ~bit : was
  held.set(wc, now)
  const pz = wc.getZoomFactor() || 1
  const at = { x: Math.round(num(e.x) * z / pz), y: Math.round(num(e.y) * z / pz) }
  const params = type === "mouseWheel" ? { type, ...at, deltaX: num(e.dx) * z / pz, deltaY: num(e.dy) * z / pz }
    : type === "mouseMoved" ? { type, ...at, button: now ? (now & 1 ? "left" : now & 2 ? "right" : "middle") : "none", buttons: now }
    : { type, ...at, button, buttons: now, clickCount }
  void cdp(wc, "Input.dispatchMouseEvent", params).catch(direct)
}
/** The buttons held in each page, by the window's passed pointer. */
const held = new WeakMap<WebContents, number>()
