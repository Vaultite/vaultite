// The Browser's pages: a WebContentsView over a tab's pane, which the page places and covers; sandboxed, a session
// per profile, http(s) only. What it does and why: plugins/core/web-viewer/CLAUDE.md.
import { app, BaseWindow, clipboard, dialog, type Input, Menu, type MenuItemConstructorOptions, nativeImage, powerSaveBlocker, screen, session, shell, type Session, systemPreferences, WebContentsView, type WebContents } from "electron"
import { AppWindow } from "./appwindow.ts"
import { engineCall, engineLoaded, engineOpens, mayOpen, pageMade, sessionMade } from "./browser/engine.ts"
import { openElsewhere } from "./browser/default.ts"
import { writeAtomic } from "./setup.ts"
import { claim, discardable, hear, letGo, media, playback, playing, quietEnds, RECLAIM_MS, tabGone, unclaimed, windowReloaded, type Owned, type Playback } from "./webpages.ts"
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export type WebRect = { x: number; y: number; width: number; height: number }
export type WebState = { url: string; title: string; back: boolean; forward: boolean; loading: boolean; error?: string; playing?: boolean; muted?: boolean
  player?: boolean }
type Page = Owned<AppWindow> & { view: WebContentsView; error?: string
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
  /** It's the spare's, its first load not in yet: the spare's about:blank is no page to go back to (gone once it is). */
  blankBehind?: boolean }
/** A site a profile keeps cookies for, who's signed in there when we know how to ask, and `other` when no page of it
 *  was opened (its cookies came with other sites' pages: trackers). */
export type WebSite = { site: string; account?: string; other?: boolean }

const PARTITION = "persist:web"
/** The session's partition for a profile ("" or a workspace's "2"; anything else is the shared one). */
export const partitionOf = (profile: string) => (/^[a-z0-9-]{1,32}$/.test(profile) ? `${PARTITION}-${profile}` : PARTITION)
const profileOf = (x: unknown) => (typeof x === "string" && /^[a-z0-9-]{1,32}$/.test(x) ? x : "")
const MAC = process.platform === "darwin"
/** Keys a page keeps even when the app has a shortcut on them: editing text, finding, a rich editor's marks. */
// (⌘Y isn't redo on a Mac: it's History there, as in Chrome)
const PAGE_KEYS = new Set(["a", "c", "v", "x", "z", "shift+z", ...(MAC ? [] : ["y"]), "f", "g", "shift+g", "b", "i", "u", "k", "shift+v", "arrowleft",
  "arrowright", "arrowup", "arrowdown", "backspace", "delete", "enter", "shift+enter", "tab"].map((k) => `mod+${k}`))

const pages = new Map<number, Page>()
/** Each window's app shortcuts with ⌘, ⌃ or ⌥ (web:keys). */
const keysOf = new WeakMap<AppWindow, Set<string>>()
let next = 1
const sessions = new Map<string, Session>()

const web = (u: string) => /^https?:\/\//i.test(u)
/** What a page may show: the web, and what a feature of the engine adds (an extension's own pages). */
const shows = (u: string) => web(u) || engineOpens(u)
/** Images asked for with Save image to vault (their addresses), whose downloads go to the window instead. */
const toVault = new Set<string>()
const pageOf = (wc: WebContents) => [...pages.values()].find((p) => p.view.webContents === wc)

/** A profile's session, set up once. */
function webSession(profile: string) {
  const had = sessions.get(profile)
  if (had) return had
  const s = session.fromPartition(partitionOf(profile))
  // A plain Chrome: some sites turn away "embedded" browsers by their user agent.
  s.setUserAgent(s.getUserAgent().replace(/\s(Electron|vaultite|Vaultite)\/\S+/g, ""))
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
    item.once("done", (_ev, state) => {
      if (p && !p.win.isDestroyed()) tell(p.win, { type: "download", name: path.basename(file), path: file, ok: state === "completed" })
    })
  })
  sessions.set(profile, s)
  sessionMade(s, profile)
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
  const kinds = perm === "media" ? [...new Set((details.mediaTypes ?? []).map((t) => (t === "video" ? "camera" : "microphone")))] : [perm]
  if (!kinds.length || kinds.some((k) => !ASKED[k])) return false
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
      const what = kinds.map((k) => ASKED[k]).join(" and ").replace(/ and use your /, " and ")
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

/** How near the window's left or right edge (CSS px) a page's pointer is told to the window. */
const EDGE = 12
const tell = (win: AppWindow, msg: Record<string, unknown>) => { if (!win.isDestroyed()) win.webContents.send("vaultite:web", msg) }

const canBack = (p: Page) => !p.blankBehind && p.view.webContents.navigationHistory.canGoBack()
const playingNow = (p: Page) => !p.view.webContents.isDestroyed() && playing(p.sound, p.view.webContents.isCurrentlyAudible(), Date.now())
function stateOf(p: Page): WebState {
  const wc = p.view.webContents
  const h = wc.navigationHistory
  return { url: wc.getURL() || p.target, title: wc.getTitle() || "", back: canBack(p), forward: h.canGoForward(), loading: wc.isLoading(), ...(p.error ? { error: p.error } : {}),
    ...(playingNow(p) ? { playing: true } : {}), ...(wc.isAudioMuted() ? { muted: true } : {}), ...(p.player ? { player: true } : {}) }
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
function stepOf(i: Input) {
  if (["Meta", "Control", "Alt", "Shift", "CapsLock", "Fn", "OS"].includes(i.key)) return ""
  const CODES: Record<string, string> = { Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/" }
  const byCode = /^Key[A-Z]$/.test(i.code) ? i.code.slice(3) : /^Digit\d$/.test(i.code) ? i.code.slice(5) : CODES[i.code]
  const key = i.key === " " || i.code === "Space" ? "Space"
    : byCode && (i.alt || (i.shift && !/^[a-z]$/i.test(i.key))) ? byCode
    : i.key.length === 1 ? i.key.toUpperCase() : i.key
  const mod = MAC ? i.meta : i.control
  return [mod && "mod", MAC && i.control && "ctrl", i.alt && "alt", i.shift && "shift", key].filter(Boolean).join("+").toLowerCase()
}

/** A page's link to another app (zoommtg://, slack://), opened once the site may (asked like a permission, as
 *  browsers do); mailto: opens Mail. Never file: (a site doesn't open the Mac's files) or what runs code. */
async function otherApp(p: Page, to: string) {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(to) || /^(javascript|data|vbscript|blob|file|about|chrome|devtools|view-source):/i.test(to)) return
  if (/^mailto:/i.test(to)) return void shell.openExternal(to)
  const wc = p.view.webContents
  if (wc.isDestroyed()) return
  if (await askPermission(p.profile, wc, "openExternal", { requestingUrl: wc.getURL(), externalURL: to }).catch(() => false)) await shell.openExternal(to).catch(console.error)
}

/** A page's view in a profile's session. */
function newView(profile: string) {
  // (sandboxed, so frames get no Node: "in sub frames" only lets the engine's preloads reach a page's frames, an
  // extension's own pages embedded in it)
  return new WebContentsView({
    // (a page's full screen never resizes the window by itself: fit() fills its window or player, which goes full
    // screen only where that's wanted)
    webPreferences: { session: webSession(profile), sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: true, webSecurity: true, spellcheck: true,
      disableHtmlFullscreenWindowResize: true },
  })
}

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

function make(win: AppWindow, url: string, profile: string, tab: string): Page {
  const taken = takeSpare(profile), view = taken ?? newView(profile)
  makeSpare(profile)
  view.setBackgroundColor("#ffffff")
  view.setVisible(false)
  // (a size before it's first shown: a page laid out at none has nothing an agent could click)
  const [w, h] = win.getContentSize()
  view.setBounds({ x: 0, y: 0, width: Math.max(320, Math.round(w / 2)), height: Math.max(240, h - 80) })
  addPage(win, view)
  const p: Page = { id: next++, win, view, profile, tab, holds: 0, closing: false, let: 0, target: url, want: null, sound: playback(), blankBehind: !!taken }
  pages.set(p.id, p)
  const wc = view.webContents
  if (taken) wc.once("did-navigate", () => { wc.navigationHistory.clear(); p.blankBehind = false })
  pageMade({ id: p.id, wc, profile, win, url, hide: () => place(p, null), visible: () => p.view.getVisible(), tab: () => p.tab,
    player: (on, fullScreen) => { if (on) void toPlayer(p, fullScreen); else fromPlayer(p) } })

  // Only to the web: another app's link (zoommtg://, slack://, mailto:) goes to that app, as a browser does.
  const refuse = (e: { preventDefault: () => void }, to: string) => {
    if (shows(to)) return
    e.preventDefault()
    void otherApp(p, to)
  }
  wc.on("will-navigate", (e) => refuse(e, e.url))
  wc.on("will-redirect", (e) => refuse(e, e.url))
  wc.setWindowOpenHandler(({ url: to, disposition, features }) => {
    if (!shows(to)) { void otherApp(p, to); return { action: "deny" } }
    // A popup with a size (signing in with another site): a small window in the same session, which can answer the page.
    if (disposition === "new-window" && features) {
      return { action: "allow", overrideBrowserWindowOptions: {
        width: 520, height: 700, parent: win, autoHideMenuBar: true,
        webPreferences: { session: webSession(profile), sandbox: true, contextIsolation: true, nodeIntegration: false },
      } }
    }
    tell(win, { type: "open", id: p.id, url: to })
    return { action: "deny" }
  })
  wc.on("did-create-window", (child) => {
    child.webContents.on("will-navigate", (e) => refuse(e, e.url))
    child.webContents.setWindowOpenHandler(({ url: to }) => { if (web(to)) openElsewhere(to); else void otherApp(p, to); return { action: "deny" } })
  })

  revive(wc)
  const changed = () => sendState(p)
  wc.on("did-start-loading", () => { p.error = undefined; changed() })
  wc.on("did-start-navigation", (d) => { if (d.isMainFrame && !d.isSameDocument && shows(d.url)) p.target = d.url })
  wc.on("did-stop-loading", changed)
  wc.on("did-navigate", (_e, to) => { p.sound = playback(); noteVisit(profile, to); changed() })
  wc.on("did-navigate-in-page", (_e, _u, main) => { if (main) changed() })
  wc.on("page-title-updated", changed)
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
  wc.on("focus", () => { if (!p.player) tell(win, { type: "focus", id: p.id }) })
  // Full screen (a video's button): it fills its window (made full screen, as Chrome does) or its player, over the rest.
  wc.on("enter-html-full-screen", () => {
    p.full = true
    if (!p.player) {
      win.contentView.addChildView(p.view) // (again: over every other page and the window's own, raised or not)
      if (!win.isFullScreen()) { win.setFullScreen(true); p.madeFull = true }
    }
    fit(p)
  })
  wc.on("leave-html-full-screen", () => {
    p.full = false
    // (its player's video leaving full screen, with Esc or the site's own button, leaves the player: Esc never reaches
    // the page while it's full screen)
    if (p.player && p.filled) { p.filled = false; fromPlayer(p, true); return }
    if (p.madeFull) { p.madeFull = false; if (!win.isDestroyed() && win.isFullScreen()) win.setFullScreen(false) }
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
    tell(win, { type: "notify", id: p.id, profile: p.profile, url: n.url, site: siteOf(hostOfUrl(n.url)), title: n.title, body: n.body })
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

  // The window doesn't hear the pointer over the page: near its edges it's told, for a hidden sidebar to slide in
  // (web/src/core/peek.ts), and once as it leaves them.
  let atEdge = false
  wc.on("before-mouse-event", (_e, m) => {
    if (m.type !== "mouseMove" || p.player || p.full || p.win.isDestroyed()) return
    const z = p.win.webContents.getZoomFactor(), b = p.view.getBounds(), [w] = p.win.getContentSize()
    const x = (b.x + m.x) / z, edge = x <= EDGE || x >= w / z - EDGE
    if (!edge && !atEdge) return
    atEdge = edge
    tell(p.win, { type: "pointer", x, y: (b.y + m.y) / z })
  })

  wc.on("before-input-event", (e, i) => {
    if (i.type !== "keyDown") return
    const step = stepOf(i)
    // In its player the page keeps every key but Esc, which brings it back (⌘W closes the player, as the menu has it).
    if (p.player) { if (step === "escape") { e.preventDefault(); fromPlayer(p, true) } return }
    const nav = { "mod+r": "reload", "mod+[": "back", "mod+]": "forward" }[step]
    if (nav) { e.preventDefault(); go(p, nav); return }
    if (step === "mod+l") { e.preventDefault(); tell(win, { type: "address", id: p.id }); return }
    if (!step || PAGE_KEYS.has(step) || !keysOf.get(win)?.has(step)) return
    e.preventDefault()
    tell(win, { type: "key", id: p.id, key: i.key, code: i.code, meta: i.meta, ctrl: i.control, alt: i.alt, shift: i.shift })
  })

  wc.on("context-menu", (_e, c) => {
    const items: MenuItemConstructorOptions[] = []
    if (c.linkURL && web(c.linkURL)) {
      items.push(
        { label: "Open link in a new tab", click: () => tell(win, { type: "open", id: p.id, url: c.linkURL }) },
        { label: "Open link in another browser", click: () => openElsewhere(c.linkURL) },
        { label: "Copy link", click: () => clipboard.writeText(c.linkURL) },
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
          { label: "Open image in a new tab", click: () => tell(win, { type: "open", id: p.id, url: src }) },
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
      { label: "Save page to vault", click: () => tell(win, { type: "clip", id: p.id }) },
      { label: "Open in another browser", enabled: web(wc.getURL()), click: () => openElsewhere(wc.getURL()) },
      { type: "separator" },
      ...(/^https?:/i.test(wc.getURL()) ? [{ label: "Block element…", click: () => tell(win, { type: "block", id: p.id, x: c.x, y: c.y }) }] : []),
      { label: "Inspect element", click: () => wc.inspectElement(c.x, c.y) },
    )
    Menu.buildFromTemplate(items).popup({ window: p.player ?? win })
  })

  void wc.loadURL(url).catch(() => { /* did-fail-load says why */ })
  return p
}

function end(p: Page) {
  pages.delete(p.id)
  clearTimeout(p.hush)
  fromPlayer(p)
  pagesChanged(p.win)
  if (!p.win.isDestroyed()) p.win.contentView.removeChildView(p.view)
  if (!p.view.webContents.isDestroyed()) p.view.webContents.close()
}

/** Background tabs' pages are kept (hidden, so Chromium throttles them) till memory runs short (webpages.ts discardable);
 *  one in a player is on screen, whatever its tab. */
async function trim() {
  const keep = (p: Page) => !!p.player || playingNow(p)
  if ((!spare && !discardable(pages.values(), keep).length) || !(await shortOfMemory())) return
  endSpare()
  for (const p of discardable(pages.values(), keep)) end(p)
}
setInterval(() => void trim(), 60_000).unref()

/** Whether the computer is short of memory: macOS's memory pressure (warn or critical), Linux's available memory. */
function shortOfMemory(): Promise<boolean> {
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
    p.view.setBounds({ x: 0, y: 0, width, height })
    p.view.setVisible(true)
    return
  }
  const rect = p.want
  if (!rect) {
    if (!p.view.getVisible()) return
    p.hadFocus = p.view.webContents.isFocused()
    p.view.setVisible(false)
    // (a hidden view keeps the keyboard: the window takes it, for what's over the page, the palette's search)
    if (p.hadFocus) { p.win.webContents.focus(); keyboardFrom.set(p.win, p.id) }
    return
  }
  if (keyboardFrom.get(p.win) === p.id) keyboardFrom.delete(p.win) // (shown again: `web:place` gives it back)
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
  else if (action === "reload") wc.reload()
  else if (action === "stop") wc.stop()
  else if (action === "mute" || action === "unmute") { wc.setAudioMuted(action === "mute"); sendState(p) }
  // (a hidden page never has the keyboard: it gets it as it's shown, `web:place` answering `focused`)
  else if (action === "focus") { if (p.player) return; if (p.view.getVisible()) wc.focus(); else p.hadFocus = true }
  else if (action === "load" && url && shows(url)) { p.target = url; void wc.loadURL(url).catch(() => {}) }
  // (answers "none" when the page has no video)
  else if (action === "pip") return wc.executeJavaScriptInIsolatedWorld(1004, [{ code: PIP }], true).catch(() => null)
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
  w.on("resize", () => fit(p))
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
    wc.setBackgroundThrottling(true)
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
  win.on("resize", () => { for (const p of pages.values()) if (p.win === win && p.full && !p.player) fit(p) })
  win.on("leave-full-screen", () => { for (const p of pages.values()) if (p.win === win && p.full && !p.player) leaveFull(p) })
  win.on("closed", () => {
    for (const p of [...pages.values()]) if (p.win === win) end(p)
    // (no page left anywhere: no spare kept for one)
    if (!pages.size) endSpare()
  })
  win.webContents.on("did-start-navigation", (d) => {
    if (!d.isMainFrame || d.isSameDocument) return
    raise(win, null)
    for (const p of pages.values()) if (p.win === win && !p.player) { if (p.full) leaveFull(p); p.view.setVisible(false) }
    for (const p of windowReloaded(pages.values(), win, Date.now())) end(p)
    setTimeout(() => { for (const p of unclaimed(pages.values(), Date.now())) end(p) }, RECLAIM_MS + 100)
  })
}

/** The IPC handlers (main.ts checks the asking page is a vault window's and gives its AppWindow). */
export const webHandlers: Record<string, (win: AppWindow, ...args: unknown[]) => unknown> = {
  // (a tab's page is the tab's: shown again, it's the same one, wherever it went since)
  "web:open": async (win, url, rect, profile, tab) => {
    await engineLoaded()
    const u = str(url), prof = profileOf(profile), owner = tabOf(tab)
    if (!shows(u)) throw new Error("only http and https pages")
    if (!mayOpen(prof)) throw new Error("this container is locked")
    const { reuse, end: other } = claim(pages.values(), win, owner, prof)
    for (const x of other) end(x)
    const p = reuse ?? make(win, u, prof, owner)
    p.holds++
    p.orphan = undefined
    pagesChanged(win)
    // (shown at once where its tab asks, a page shown again or a new one, rather than after the tab draws: as `web:place`)
    const r = rectOf(rect), wasHidden = !p.view.getVisible()
    place(p, r)
    let focused = false
    if (r && wasHidden && p.view.getVisible()) { focused = !!p.hadFocus; p.hadFocus = false }
    return { id: p.id, state: stateOf(p), focused }
  },
  "web:place": (win, id, rect) => {
    const p = mine(win, id), r = rectOf(rect) && mayOpen(p.profile) ? rectOf(rect) : null, wasHidden = !p.view.getVisible()
    place(p, r)
    // (shown again: whether it had the keyboard when it was hidden)
    if (r && wasHidden && p.view.getVisible()) { const had = !!p.hadFocus; p.hadFocus = false; return { focused: had, shown: true } }
    return { focused: false, shown: p.view.getVisible() }
  },
  // The window focused something of its own (desktop.ts): the keyboard comes to it from a page that has it.
  "web:take": (win) => {
    const p = [...pages.values()].find((x) => x.win === win && x.view.webContents.isFocused())
    if (p) win.webContents.focus()
    const from = p?.id ?? keyboardFrom.get(win) ?? null
    keyboardFrom.delete(win)
    return from
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
    if (!p.player) p.view.setVisible(false)
    void trim()
    pagesChanged(win)
  },
  // Its player: on (`fullScreen`: on a Space of its own) or back in its tab.
  "web:player": (win, id, on, fullScreen) => { const p = mine(win, id); if (on) return toPlayer(p, fullScreen !== false); fromPlayer(p, true) },
  "web:close": (win, tab) => { for (const p of tabGone(pages.values(), win, tabOf(tab))) end(p) },
  "web:go": (win, id, action, url) => go(mine(win, id), str(action), typeof url === "string" ? url : undefined),
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
  "web:forget": async (_win, profile, site) => {
    const prof = profileOf(profile), s = webSession(prof), name = str(site).toLowerCase()
    for (const c of await s.cookies.get({})) {
      const host = (c.domain ?? "").replace(/^\./, "")
      if (siteOf(host) !== name) continue
      await s.cookies.remove(`http${c.secure ? "s" : ""}://${host}${c.path ?? "/"}`, c.name).catch(() => {})
    }
    await s.clearData({ origins: [`https://${name}`, `https://www.${name}`], dataTypes: ["cookies", "localStorage", "indexedDB", "serviceWorkers", "cache", "fileSystems"] }).catch(() => {})
    accounts.delete(`${prof} ${name}`)
    for (const k of Object.keys(loadAnswers()[prof]?.[name] ?? {})) answer(prof, name, k, null) // what it may use is asked again
    // Its pages in that profile show it signed out.
    for (const p of pages.values()) if (p.profile === prof && siteOf(hostOfUrl(p.view.webContents.getURL())) === name) p.view.webContents.reload()
  },
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
  "web:icons": (_win, hosts) => {
    const all = loadIcons()
    return Object.fromEntries((Array.isArray(hosts) ? hosts : []).slice(0, 500).filter((h): h is string => typeof h === "string").map((h) => [h, all.get(h) ?? ""]))
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

/** Sites whose account we know how to ask for: where (the site's own address, read with the session's cookies) and
 *  what of its answer names the account. More are a line each. */
const ACCOUNTS: Record<string, { url: string; read: (j: Record<string, unknown>) => unknown }> = {
  "claude.ai": { url: "https://claude.ai/api/account", read: (j) => j.email_address ?? (j.account as Record<string, unknown> | undefined)?.email_address ?? j.full_name },
  "chatgpt.com": { url: "https://chatgpt.com/api/auth/session", read: (j) => (j.user as Record<string, unknown> | undefined)?.email ?? (j.user as Record<string, unknown> | undefined)?.name },
}
/** Accounts found lately, by "<profile> <site>": asked again after a minute. null: asked, nobody signed in. */
const accounts = new Map<string, { at: number; account: string | null }>()

async function accountOf(profile: string, site: string): Promise<string | null> {
  const how = ACCOUNTS[site]
  if (!how) return null
  const key = `${profile} ${site}`, had = accounts.get(key)
  if (had && Date.now() - had.at < 60_000) return had.account
  let account: string | null = null
  try {
    // From one of its pages when one is open (the site's own origin: what its pages ask is never turned away),
    // else with the session's cookies from here.
    const page = [...pages.values()].find((p) => p.profile === profile && siteOf(hostOfUrl(p.view.webContents.getURL())) === site)
    const j = page
      ? await page.view.webContents.executeJavaScriptInIsolatedWorld(1002, [{ code: `fetch(${JSON.stringify(how.url)}, { credentials: "include" }).then((r) => r.ok ? r.json() : null).catch(() => null)` }])
      : await webSession(profile).fetch(how.url, { credentials: "include", headers: { accept: "application/json" } }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    const v = j && typeof j === "object" ? how.read(j as Record<string, unknown>) : null
    account = typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null
  } catch { /* not signed in, or the site changed: no account shown */ }
  accounts.set(key, { at: Date.now(), account })
  return account
}

async function sitesOf(profile: string): Promise<WebSite[]> {
  const cookies = await webSession(profile).cookies.get({})
  const names = [...new Set(cookies.map((c) => siteOf(c.domain ?? "")).filter(Boolean))]
  const been = visitedOf(profile)
  for (const p of pages.values()) if (p.profile === profile) been.add(siteOf(hostOfUrl(p.view.webContents.getURL())))
  const out = await Promise.all(names.map(async (site): Promise<WebSite> => {
    const account = await accountOf(profile, site)
    return account ? { site, account } : been.has(site) ? { site } : { site, other: true }
  }))
  // Signed in first, then A to Z.
  return out.sort((a, b) => Number(!b.account) - Number(!a.account) || a.site.localeCompare(b.site))
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

/** Sites' icons as data URLs by host (no "www."), in userData so a tab whose page isn't loaded shows its site's. */
let icons: Map<string, string> | null = null
/** The address each host's icon came from (this run's), so a page telling the same one isn't fetched again. */
const iconSrc = new Map<string, string>()
const ICON_MAX = 256 * 1024
const ICONS_KEPT = 300
const iconsFile = () => path.join(app.getPath("userData"), "web-icons.json")
/** As the app's tabs name it (web-viewer/address.ts hostOf): with its port, without "www.". */
const iconHost = (u: string) => { try { return new URL(u).host.replace(/^www\./, "") } catch { return "" } }
const isIcon = (s: string) => s.length < ICON_MAX * 1.4 && /^data:image\/(png|jpeg|gif|webp|x-icon|svg\+xml);base64,[A-Za-z0-9+/]+=*$/.test(s)
function loadIcons() {
  if (!icons) {
    icons = new Map()
    try {
      const j = JSON.parse(fs.readFileSync(iconsFile(), "utf8")) as { icons?: Record<string, unknown> }
      for (const [h, v] of Object.entries(j?.icons ?? {})) if (typeof v === "string" && isIcon(v)) icons.set(h, v)
    } catch { /* none yet, or unreadable: they're fetched again */ }
  }
  return icons
}
let iconsSaving: ReturnType<typeof setTimeout> | null = null
function saveIcons() {
  iconsSaving ??= setTimeout(() => {
    iconsSaving = null
    try { writeAtomic(iconsFile(), JSON.stringify({ icons: Object.fromEntries(loadIcons()) })) } catch { /* kept in memory */ }
  }, 2000)
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

/** The page told its icons' addresses: the first that's an image becomes its site's icon, told to every window. */
async function iconFrom(p: Page, urls: unknown) {
  const list = (Array.isArray(urls) ? urls : []).filter((u): u is string => typeof u === "string" && (web(u) || /^data:image\//i.test(u))).slice(0, 4)
  const page = p.view.webContents.getURL(), host = iconHost(page)
  if (!host || !web(page)) return
  // (the site's own /favicon.ico last: a page that names none, or whose named ones fail)
  try { const fav = new URL("/favicon.ico", page).href; if (!list.includes(fav)) list.push(fav) } catch { /* no origin */ }
  const key = list.join(" ")
  if (p.icons === key) return
  p.icons = key
  if (iconSrc.get(host) === list[0] && loadIcons().has(host)) return
  for (const u of list) {
    if (p.view.webContents.isDestroyed() || p.icons !== key) return
    let icon: string | null = null
    try { const b = await iconBytes(p.view.webContents.session, u); icon = b && iconOf(b) } catch { icon = null }
    if (!icon || !isIcon(icon)) continue
    iconSrc.set(host, u)
    const all = loadIcons()
    if (all.get(host) === icon) return
    all.delete(host)
    all.set(host, icon)
    for (const h of [...all.keys()].slice(0, Math.max(0, all.size - ICONS_KEPT))) all.delete(h)
    saveIcons()
    for (const w of AppWindow.getAllWindows()) tell(w, { type: "icon", host, icon })
    return
  }
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
  const r = await webSession(profile).fetch(url, { credentials: "include", headers })
  return { status: r.status, json: r.ok ? await r.json() : null }
}

async function cloudSignedInTo(profile: string) {
  const had = cloudCookies.get(profile)
  if (had && Date.now() - had.at < CLOUD.cookiesFor) return had.in
  // (logins never used have no folder: not made just to look, which would set up a session, extensions and all)
  if (!sessions.has(profile) && !fs.existsSync(path.join(app.getPath("userData"), "Partitions", partitionOf(profile).replace(/^persist:/, "")))) return false
  const cookies = await webSession(profile).cookies.get({ url: CLOUD_BASE })
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
  const at = raised.get(win) ? win.contentView.children.indexOf(win.view) : -1
  if (at >= 0) win.contentView.addChildView(view, at)
  else win.contentView.addChildView(view)
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
  if (e.type === "mouseWheel") wc.sendInputEvent({ type: "mouseWheel", x, y, deltaX: -num(e.dx), deltaY: -num(e.dy), canScroll: true })
  else if (e.type === "mouseMove" || e.type === "mouseDown" || e.type === "mouseUp" || e.type === "mouseLeave") wc.sendInputEvent({ type: e.type, x, y, button, clickCount })
}
