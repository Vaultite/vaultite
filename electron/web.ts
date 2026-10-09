// The Web viewer's pages: a WebContentsView over a tab's pane, which the page places and covers; sandboxed, a session
// per profile, http(s) only. What it does and why: plugins/core/web-viewer/CLAUDE.md.
import { app, BrowserWindow, clipboard, dialog, type Input, Menu, type MenuItemConstructorOptions, nativeImage, session, shell, type Session, systemPreferences,
  WebContentsView, type WebContents } from "electron"
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export type WebRect = { x: number; y: number; width: number; height: number }
export type WebState = { url: string; title: string; back: boolean; forward: boolean; loading: boolean; error?: string }
type Page = { id: number; win: BrowserWindow; view: WebContentsView; profile: string; held: boolean; closing: boolean; let: number; error?: string
  /** The icon addresses it last told (page-favicon-updated), so the same list isn't fetched again. */
  icons?: string
  /** It had the keyboard when it was last hidden. */
  hadFocus?: boolean }
/** A site a profile keeps cookies for, who's signed in there when we know how to ask, and `other` when no page of it
 *  was opened (its cookies came with other sites' pages: trackers). */
export type WebSite = { site: string; account?: string; other?: boolean }

const PARTITION = "persist:web"
/** The session's partition for a profile ("" or a workspace's "2"; anything else is the shared one). */
const partitionOf = (profile: string) => (/^[a-z0-9-]{1,32}$/.test(profile) ? `${PARTITION}-${profile}` : PARTITION)
const profileOf = (x: unknown) => (typeof x === "string" && /^[a-z0-9-]{1,32}$/.test(x) ? x : "")
/** Pages let go of that each window keeps even when the Mac runs short of memory (more are kept until it does, the
 *  oldest ending first then, like Chrome's discarding). */
const KEEP = 4
const MAC = process.platform === "darwin"
/** Keys a page keeps even when the app has a shortcut on them: editing text, finding, a rich editor's marks. */
const PAGE_KEYS = new Set(["a", "c", "v", "x", "z", "shift+z", "y", "f", "g", "shift+g", "b", "i", "u", "k", "shift+v", "arrowleft",
  "arrowright", "arrowup", "arrowdown", "backspace", "delete", "enter", "shift+enter", "tab"].map((k) => `mod+${k}`))

const pages = new Map<number, Page>()
/** Each window's app shortcuts with ⌘, ⌃ or ⌥ (web:keys). */
const keysOf = new WeakMap<BrowserWindow, Set<string>>()
let next = 1
const sessions = new Map<string, Session>()

const web = (u: string) => /^https?:\/\//i.test(u)
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
      const win = pageOf(wc)?.win ?? BrowserWindow.fromWebContents(wc) ?? undefined
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

const tell = (win: BrowserWindow, msg: Record<string, unknown>) => { if (!win.isDestroyed()) win.webContents.send("vaultite:web", msg) }

function stateOf(p: Page): WebState {
  const wc = p.view.webContents
  const h = wc.navigationHistory
  return { url: wc.getURL() || "", title: wc.getTitle() || "", back: h.canGoBack(), forward: h.canGoForward(), loading: wc.isLoading(), ...(p.error ? { error: p.error } : {}) }
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
/** The window's pages came or went, or one was let go of or taken back (the Web pages panel). */
const pagesChanged = (win: BrowserWindow) => tell(win, { type: "pages" })

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

/** A page's link to another app (zoommtg://, slack://, obsidian://), opened once the site may (asked like a permission,
 *  as a browser asks first); mailto: opens the mail app. Never file: (a site doesn't open the Mac's files) or what runs
 *  code. */
async function otherApp(p: Page, to: string) {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(to) || /^(javascript|data|vbscript|blob|file|about|chrome|devtools|view-source):/i.test(to)) return
  if (/^mailto:/i.test(to)) return void shell.openExternal(to)
  const wc = p.view.webContents
  if (wc.isDestroyed()) return
  if (await askPermission(p.profile, wc, "openExternal", { requestingUrl: wc.getURL(), externalURL: to }).catch(() => false)) await shell.openExternal(to).catch(console.error)
}

function make(win: BrowserWindow, url: string, profile: string): Page {
  const view = new WebContentsView({
    webPreferences: { session: webSession(profile), sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true, spellcheck: true },
  })
  view.setBackgroundColor("#ffffff")
  view.setVisible(false)
  win.contentView.addChildView(view)
  const p: Page = { id: next++, win, view, profile, held: true, closing: false, let: 0 }
  pages.set(p.id, p)
  const wc = view.webContents

  // Only to the web: another app's link (zoommtg://, slack://, mailto:) goes to that app, as a browser does.
  const refuse = (e: { preventDefault: () => void }, to: string) => {
    if (web(to)) return
    e.preventDefault()
    void otherApp(p, to)
  }
  wc.on("will-navigate", (e) => refuse(e, e.url))
  wc.on("will-redirect", (e) => refuse(e, e.url))
  wc.setWindowOpenHandler(({ url: to, disposition, features }) => {
    if (!web(to)) { void otherApp(p, to); return { action: "deny" } }
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
    child.webContents.setWindowOpenHandler(({ url: to }) => { if (web(to)) void shell.openExternal(to); else void otherApp(p, to); return { action: "deny" } })
  })

  revive(wc)
  const changed = () => sendState(p)
  wc.on("did-start-loading", () => { p.error = undefined; changed() })
  wc.on("did-stop-loading", changed)
  wc.on("did-navigate", (_e, to) => { noteVisit(profile, to); if (siteOf(hostOfUrl(to)) === CLOUD.site) cloudOpened.add(profile); changed() })
  wc.on("did-navigate-in-page", (_e, _u, main) => { if (main) changed() })
  wc.on("page-title-updated", changed)
  wc.on("did-fail-load", (_e, code, desc, _u, main) => {
    if (!main || code === -3) return // -3: stopped, or another load took over
    p.error = desc || `error ${code}`
    changed()
  })
  wc.on("focus", () => tell(win, { type: "focus", id: p.id }))
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

  wc.on("before-input-event", (e, i) => {
    if (i.type !== "keyDown") return
    const step = stepOf(i)
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
        { label: "Open link in the browser", click: () => void shell.openExternal(c.linkURL) },
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
    items.push(
      { label: "Back", enabled: h.canGoBack(), click: () => go(p, "back") },
      { label: "Forward", enabled: h.canGoForward(), click: () => go(p, "forward") },
      { label: "Reload", click: () => go(p, "reload") },
      { type: "separator" },
      { label: "Save page to vault", click: () => tell(win, { type: "clip", id: p.id }) },
      { label: "Open in the browser", enabled: web(wc.getURL()), click: () => void shell.openExternal(wc.getURL()) },
      { type: "separator" },
      { label: "Inspect element", click: () => wc.inspectElement(c.x, c.y) },
    )
    Menu.buildFromTemplate(items).popup({ window: win })
  })

  void wc.loadURL(url).catch(() => { /* did-fail-load says why */ })
  return p
}

function end(p: Page) {
  pages.delete(p.id)
  pagesChanged(p.win)
  if (!p.win.isDestroyed()) p.win.contentView.removeChildView(p.view)
  if (!p.view.webContents.isDestroyed()) p.view.webContents.close()
}

/** Pages let go of are kept (hidden, so Chromium throttles them): only when memory runs short does each window keep
 *  just its KEEP newest, the older ones ending. */
async function trim(win?: BrowserWindow) {
  const loose = (w: BrowserWindow) => [...pages.values()].filter((p) => p.win === w && !p.held && !p.closing).sort((a, b) => b.let - a.let)
  const wins = win ? [win] : [...new Set([...pages.values()].map((p) => p.win))]
  if (!wins.some((w) => loose(w).length > KEEP) || !(await shortOfMemory())) return
  for (const w of wins) for (const p of loose(w).slice(KEEP)) end(p)
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
const keyboardFrom = new WeakMap<BrowserWindow, number>()

function place(p: Page, rect: WebRect | null) {
  if (!rect || rect.width < 2 || rect.height < 2) {
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

function go(p: Page, action: string, url?: string) {
  const wc = p.view.webContents
  const h = wc.navigationHistory
  if (action === "back" && h.canGoBack()) h.goBack()
  else if (action === "forward" && h.canGoForward()) h.goForward()
  else if (action === "reload") wc.reload()
  else if (action === "stop") wc.stop()
  // (a hidden page never has the keyboard: it gets it as it's shown, `web:place` answering `focused`)
  else if (action === "focus") { if (p.view.getVisible()) wc.focus(); else p.hadFocus = true }
  else if (action === "load" && url && web(url)) void wc.loadURL(url).catch(() => {})
}

const str = (x: unknown) => { if (typeof x !== "string") throw new Error("expected text"); return x }
const rectOf = (r: unknown): WebRect | null => {
  if (!r || typeof r !== "object") return null
  const o = r as Record<string, unknown>
  return ["x", "y", "width", "height"].every((k) => typeof o[k] === "number" && Number.isFinite(o[k])) ? o as WebRect : null
}
/** A page of this window. */
function mine(win: BrowserWindow, id: unknown) {
  const p = pages.get(Number(id))
  if (!p || p.win !== win) throw new Error("no such page")
  return p
}

/** A page whose renderer died (a `pkill -f` that matched Chromium's flags, memory, a crash) loads again, three times
 *  a minute at most so one dying as it loads doesn't loop. `gone` hears of each death first, `giveUp` of the one it's
 *  left at (the window's to say so, rather than stay blank). */
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

/** Wire a vault window: its pages end with it, and a reload of its page lets go of them. */
export function webWindow(win: BrowserWindow) {
  win.on("closed", () => {
    for (const p of [...pages.values()]) if (p.win === win) end(p)
    for (const f of floats.get(win) ?? []) if (!f.view.webContents.isDestroyed()) f.view.webContents.close()
  })
  win.webContents.on("did-start-navigation", (d) => {
    if (!d.isMainFrame || d.isSameDocument) return
    void float(win, [])
    for (const p of pages.values()) if (p.win === win && p.held) { p.held = false; p.let = Date.now(); p.view.setVisible(false) }
    void trim(win)
  })
}

/** The IPC handlers (main.ts checks the asking page is a vault window's and gives its BrowserWindow). */
export const webHandlers: Record<string, (win: BrowserWindow, ...args: unknown[]) => unknown> = {
  "web:open": (win, url, rect, profile) => {
    const u = str(url), prof = profileOf(profile)
    if (!web(u)) throw new Error("only http and https pages")
    let p = [...pages.values()].find((x) => x.win === win && x.profile === prof && !x.held && !x.closing && (x.view.webContents.getURL() || "") === u)
    if (p) { p.held = true } else p = make(win, u, prof)
    pagesChanged(win)
    place(p, rectOf(rect))
    return { id: p.id, state: stateOf(p) }
  },
  "web:place": (win, id, rect) => {
    const p = mine(win, id), r = rectOf(rect), wasHidden = !p.view.getVisible()
    place(p, r)
    // (shown again: whether it had the keyboard when it was hidden)
    if (r && wasHidden && p.view.getVisible()) { const had = !!p.hadFocus; p.hadFocus = false; return { focused: had } }
    return { focused: false }
  },
  // The window focused something of its own (desktop.ts): the keyboard comes to it from a page that has it.
  "web:take": (win) => {
    const p = [...pages.values()].find((x) => x.win === win && x.view.webContents.isFocused())
    if (p) win.webContents.focus()
    const from = p?.id ?? keyboardFrom.get(win) ?? null
    keyboardFrom.delete(win)
    return from
  },
  "web:float": (win, rects) => float(win, Array.isArray(rects)
    ? rects.flatMap((x) => { const r = rectOf(x); return r && r.width >= 2 && r.height >= 2 ? [{ ...r, through: !!(x as { through?: unknown }).through }] : [] })
    : []),
  "web:release": (win, id) => {
    const p = pages.get(Number(id))
    if (!p || p.win !== win) return
    if (p.closing) return end(p)
    p.held = false
    p.let = Date.now()
    p.view.setVisible(false)
    void trim(win)
    pagesChanged(win)
  },
  "web:close": (win, url, profile) => {
    const u = str(url), prof = profileOf(profile)
    for (const p of [...pages.values()]) {
      if (p.win !== win || p.profile !== prof || (p.view.webContents.getURL() || "") !== u) continue
      if (p.held) p.closing = true // its tab goes in a moment: it ends when let go of
      else end(p)
    }
  },
  "web:go": (win, id, action, url) => go(mine(win, id), str(action), typeof url === "string" ? url : undefined),
  "web:snapshot": async (win, id) => {
    const p = mine(win, id)
    if (!p.view.getVisible()) return null
    const img = await p.view.webContents.capturePage()
    return img.isEmpty() ? null : new Uint8Array(img.toJPEG(85))
  },
  "web:html": async (win, id) => {
    const p = mine(win, id)
    // In a world of its own: the page's scripts can't stand in for what's read.
    const r = await p.view.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: "({ url: location.href, title: document.title, html: '<!doctype html>' + document.documentElement.outerHTML })" }])
    return r as { url: string; title: string; html: string }
  },
  "web:external": (_win, url) => { const u = str(url); if (web(u) || /^mailto:/i.test(u)) void shell.openExternal(u) },
  "web:keys": (win, steps) => { keysOf.set(win, new Set(Array.isArray(steps) ? steps.filter((s): s is string => typeof s === "string") : [])) },
  "web:list": (win) => [...pages.values()].filter((p) => p.win === win && !p.closing)
    .map((p) => ({ id: p.id, profile: p.profile, shown: p.held, ...stateOf(p) })),
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
  // Claude Code on the web's sessions: the window is told them from now on, as they change (`cloud`) and their news.
  "web:cloud": (win) => {
    cloudWindows.add(win)
    if (!cloudTimer) { cloudTimer = setInterval(() => void cloudRead(), 1000); void cloudRead() }
    return cloudAll()
  },
  // (anything but a host is answered "", never the whole list refused)
  "web:icons": (_win, hosts) => {
    const all = loadIcons()
    return Object.fromEntries((Array.isArray(hosts) ? hosts : []).slice(0, 500).filter((h): h is string => typeof h === "string").map((h) => [h, all.get(h) ?? ""]))
  },
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
export function siteOf(host: string) {
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
    const tmp = `${iconsFile()}.${process.pid}.tmp`
    try { fs.writeFileSync(tmp, JSON.stringify({ icons: Object.fromEntries(loadIcons()) })); fs.renameSync(tmp, iconsFile()) } catch { fs.rm(tmp, { force: true }, () => {}) }
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
    for (const w of BrowserWindow.getAllWindows()) tell(w, { type: "icon", host, icon })
    return
  }
}

// ---------- Claude Code on the web's sessions ----------

/** A session of Claude Code on the web, as its own sidebar has it: `state` from its `session_status` (running,
 *  requires_action, anything else idle), `updated` in ms, `url` its page. */
export type CloudSession = { id: string; title: string; state: "running" | "waiting" | "idle"; updated: number; url: string; profile: string }
/** Asked of claude.ai with a profile's logins, no page needed. VAULTITE_TEST_CLAUDE_URL: web/qa/webwatch.mjs's stand-in. */
const CLOUD_BASE = process.env.VAULTITE_TEST_CLAUDE_URL || "https://claude.ai"
const CLOUD = {
  list: `${CLOUD_BASE}/v1/code/sessions?statuses=active&statuses=paused&limit=50`,
  page: (id: string) => `${CLOUD_BASE}/code/${encodeURIComponent(id)}`,
  site: siteOf(hostOfUrl(CLOUD_BASE)),
  // (read again sooner while a session is working or waiting: its news comes sooner)
  busy: process.env.VAULTITE_TEST_CLAUDE_URL ? 1500 : 5000,
  idle: process.env.VAULTITE_TEST_CLAUDE_URL ? 1500 : 15_000,
}
/** The windows that asked (`web:cloud`): they're told the list as it changes, and its news. */
const cloudWindows = new Set<BrowserWindow>()
/** Each profile's sessions as last read (null: not signed in), and when to read it next (later after a failure). */
const cloudLists = new Map<string, CloudSession[] | null>()
const cloudNext = new Map<string, { at: number; wait: number }>()
let cloudTimer: ReturnType<typeof setInterval> | undefined
let cloudReading = false

/** The profiles with a claude.ai page opened since the app started: only theirs are asked, never on load alone. */
const cloudOpened = new Set<string>()
const cloudProfiles = () => [...cloudOpened]

/** A profile's sessions, or null when it isn't signed in to claude.ai. From one of its claude.ai pages when one is open
 *  (the site's own origin), else with the session's cookies from here, like accountOf. */
async function readCloud(profile: string): Promise<CloudSession[] | null> {
  const s = webSession(profile)
  if (!(await s.cookies.get({ url: CLOUD_BASE })).length) return null
  const headers = { accept: "application/json", "anthropic-version": "2023-06-01" }
  const page = [...pages.values()].find((p) => p.profile === profile && !p.view.webContents.isDestroyed() && siteOf(hostOfUrl(p.view.webContents.getURL())) === CLOUD.site)
  const j = (page
    ? await page.view.webContents.executeJavaScriptInIsolatedWorld(1003, [{ code: `fetch(${JSON.stringify(CLOUD.list)}, { credentials: "include", headers: ${JSON.stringify(headers)} }).then((r) => r.status === 401 || r.status === 403 ? { out: true } : r.ok ? r.json() : Promise.reject(new Error(String(r.status))))` }])
    : await s.fetch(CLOUD.list, { credentials: "include", headers }).then((r) => (r.status === 401 || r.status === 403 ? { out: true } : r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))) as { out?: boolean; data?: unknown }
  if (j?.out) return null
  if (!Array.isArray(j?.data)) throw new Error("no sessions list")
  return (j.data as Record<string, unknown>[]).flatMap((x): CloudSession[] => {
    if (typeof x?.id !== "string" || x.session_status === "archived") return []
    const at = Date.parse(String(x.updated_at ?? ""))
    return [{
      id: x.id, title: typeof x.title === "string" && x.title.trim() ? x.title.trim().slice(0, 200) : "Claude Code session",
      state: x.session_status === "running" ? "running" : x.session_status === "requires_action" ? "waiting" : "idle",
      updated: Number.isFinite(at) ? at : 0, url: CLOUD.page(x.id), profile,
    }]
  })
}

/** Every profile's sessions, one per session (the first profile's), most recent first. */
const cloudAll = () => {
  const seen = new Map<string, CloudSession>()
  for (const list of cloudLists.values()) for (const c of list ?? []) if (!seen.has(c.id)) seen.set(c.id, c)
  return [...seen.values()].sort((a, b) => b.updated - a.updated)
}

/** What a session going from one state to another is worth telling, if anything. */
function newsOf(was: CloudSession["state"], now: CloudSession["state"]): { kind: "done" | "waiting"; title: string } | null {
  if (was === now) return null
  if (now === "waiting") return { kind: "waiting", title: "Claude Code needs you" }
  if (was === "running") return { kind: "done", title: "Claude Code finished" }
  return null
}

async function cloudRead() {
  for (const w of cloudWindows) if (w.isDestroyed()) cloudWindows.delete(w)
  if (!cloudWindows.size) { clearInterval(cloudTimer); cloudTimer = undefined; return }
  if (cloudReading) return
  cloudReading = true
  try {
    const before = JSON.stringify(cloudAll())
    for (const profile of cloudProfiles()) {
      const due = cloudNext.get(profile)
      if (due && Date.now() < due.at) continue
      let list: CloudSession[] | null
      try { list = await readCloud(profile) } catch {
        // (a failure: asked again later and later, up to five minutes; the list stays as it was)
        const wait = Math.min(300_000, (due?.wait ?? CLOUD.idle) * 2)
        cloudNext.set(profile, { at: Date.now() + wait, wait })
        continue
      }
      // (signed out: asked again in a minute)
      const wait = !list ? 60_000 : list.some((c) => c.state !== "idle") ? CLOUD.busy : CLOUD.idle
      cloudNext.set(profile, { at: Date.now() + wait, wait })
      const had = cloudLists.get(profile)
      cloudLists.set(profile, list)
      // (a profile's first read is where things stand, not news; a running session that left the list is done)
      if (!had || !list) continue
      const now = new Map(list.map((c) => [c.id, c]))
      for (const c of had) {
        const n = now.get(c.id)
        const news = newsOf(c.state, n?.state ?? "idle")
        if (news) for (const w of cloudWindows) tell(w, { type: "session", id: 0, profile, site: CLOUD.site, url: c.url, kind: news.kind, title: news.title, body: (n ?? c).title })
      }
      for (const n of list) if (!had.some((c) => c.id === n.id) && n.state === "waiting")
        for (const w of cloudWindows) tell(w, { type: "session", id: 0, profile, site: CLOUD.site, url: n.url, kind: "waiting", title: "Claude Code needs you", body: n.title })
    }
    const after = cloudAll()
    if (JSON.stringify(after) !== before) for (const w of cloudWindows) tell(w, { type: "cloud", sessions: after })
  } finally { cloudReading = false }
}

// ---------- toasts over pages ----------

/** A window's copies of what floats over its pages (see the head of this file): a transparent view each, drawn last.
 *  `through`: the pointer goes to the page under it (a tooltip), else to the window (a toast). */
type Float = { view: WebContentsView; ready: Promise<unknown>; shown: boolean; through: boolean }
export type FloatRect = WebRect & { through?: boolean }
const floats = new WeakMap<BrowserWindow, Float[]>()
/** At most this many toasts are copied (sonner shows three). */
const FLOATS = 4
const POINTER = "__vaultite_float__"
const FLOAT_PAGE = "data:text/html," + encodeURIComponent(`<!doctype html><style>html,body{margin:0;background:transparent;overflow:hidden}
img{display:block;width:100vw;height:100vh;border-radius:8px;-webkit-user-drag:none;user-select:none}</style><img id="i" alt="">
<script>
const tell = (e, type) => console.debug(${JSON.stringify(POINTER)} + JSON.stringify({ type, x: e.clientX, y: e.clientY, button: ["left", "middle", "right"][e.button] || "left", clickCount: e.detail || 1, dx: e.deltaX || 0, dy: e.deltaY || 0 }))
for (const [ev, type] of [["mousemove", "mouseMove"], ["mousedown", "mouseDown"], ["mouseup", "mouseUp"], ["mouseleave", "mouseLeave"], ["wheel", "mouseWheel"]])
  addEventListener(ev, (e) => { if (ev === "mousedown" || ev === "wheel") e.preventDefault(); tell(e, type) }, { passive: false })
addEventListener("contextmenu", (e) => e.preventDefault())
</script>`)
/** Copying is in turns: a newer set of toasts waits for the one being copied (they come every frame while one moves). */
const floatTurn = new WeakMap<BrowserWindow, Promise<unknown>>()

function floatView(win: BrowserWindow, i: number): Float {
  const list = floats.get(win) ?? []
  floats.set(win, list)
  if (list[i]) return list[i]
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  view.setBackgroundColor("#00000000")
  view.setVisible(false)
  const f: Float = { view, ready: view.webContents.loadURL(FLOAT_PAGE).catch(() => {}), shown: false, through: false }
  view.webContents.on("console-message", (e) => {
    if (!e.message.startsWith(POINTER) || win.isDestroyed()) return
    let m: { type: string; x: number; y: number; button: "left" | "middle" | "right"; clickCount: number; dx: number; dy: number }
    try { m = JSON.parse(e.message.slice(POINTER.length)) } catch { return }
    const b = view.getBounds(), x = Math.round(b.x + m.x), y = Math.round(b.y + m.y)
    // A tooltip's: to the page under it, at the same place in it.
    const under = f.through ? [...pages.values()].find((p) => p.win === win && p.view.getVisible() && inside(p.view.getBounds(), x, y)) : undefined
    const to = under ? under.view.webContents : win.webContents
    const at = under ? { x: x - under.view.getBounds().x, y: y - under.view.getBounds().y } : { x, y }
    if (m.type === "mouseLeave") {
      // Off a toast's copy: off the toast too (sonner pauses while it's hovered).
      if (!f.through) win.webContents.sendInputEvent({ type: "mouseMove", x: Math.max(0, b.x - 24), y: b.y + Math.round(b.height / 2) })
    } else if (m.type === "mouseWheel") to.sendInputEvent({ type: "mouseWheel", ...at, deltaX: -m.dx, deltaY: -m.dy, canScroll: true })
    else if (m.type === "mouseMove" || m.type === "mouseDown" || m.type === "mouseUp") to.sendInputEvent({ type: m.type, ...at, button: m.button, clickCount: m.clickCount })
  })
  list[i] = f
  return f
}

const inside = (b: Electron.Rectangle, x: number, y: number) => x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height

function float(win: BrowserWindow, rects: FloatRect[]) {
  const turn = (floatTurn.get(win) ?? Promise.resolve()).then(async () => {
    if (win.isDestroyed()) return
    const z = win.webContents.getZoomFactor()
    const list = floats.get(win) ?? []
    const want = rects.slice(0, FLOATS)
    for (let i = 0; i < Math.max(want.length, list.length); i++) {
      const r = want[i]
      if (!r) { const f = list[i]; if (f?.shown) { f.view.setVisible(false); f.shown = false } continue }
      const b = { x: Math.round(r.x * z), y: Math.round(r.y * z), width: Math.round(r.width * z), height: Math.round(r.height * z) }
      const img = await win.webContents.capturePage(b).catch(() => null)
      if (!img || img.isEmpty() || win.isDestroyed()) continue
      const f = floatView(win, i)
      f.through = !!r.through
      await f.ready
      await f.view.webContents.executeJavaScript(`document.getElementById("i").src = ${JSON.stringify(img.toDataURL())}; 1`).catch(() => {})
      f.view.setBounds(b)
      win.contentView.addChildView(f.view) // (again: on top of every page)
      if (!f.shown) { f.view.setVisible(true); f.shown = true }
    }
  })
  floatTurn.set(win, turn.catch(() => {}))
  return turn
}
