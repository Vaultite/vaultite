import { clipboard, Menu, type MenuItemConstructorOptions, WebContentsView, type WebContents } from "electron"
import { AppWindow } from "./appwindow.ts"
import { openedByAgent, pageHeld, pageMade } from "./browser/engine.ts"
import { openElsewhere } from "./browser/default.ts"
import { HIDDEN, shown } from "./pagespot.ts"
import { flowOn, hear, LINGER_MS, media, outlasted, playback, quietEnds, RECLAIM_MS } from "./webpages.ts"
import crypto from "node:crypto"
import { hostOfUrl, siteOf } from "./webwire.ts"
import { blankWindow, canBack, MAC, nextId, type Page, pages, pagesChanged, sendState, shows, tabOf, tell, toVault, web } from "./webbase.ts"
import { BROWSER_KEYS, keysOf, OWN_KEYS, PAGE_KEYS, stepOf } from "./webkeys.ts"
import { emptyError, lookOf, painted } from "./webpaint.ts"
import { otherApp } from "./webpermissions.ts"
import { makeSpare, newView, prefsOf, takeSpare } from "./websession.ts"
import { iconFrom } from "./webicons.ts"
import { noteVisit } from "./webaccounts.ts"
import { addPage, restack } from "./webstack.ts"
import { fit, move, place, wake } from "./webspot.ts"
import { fromPlayer, strips, toPlayer } from "./webplayer.ts"
import { end, keepPast, mayLeave, own, restoreMod, revive, unloading } from "./weblife.ts"
import { go, unsafeOk, zoomOf, zoomTo } from "./webgo.ts"
import { menus, tellGlance } from "./webmenus.ts"

const ACTIVATION_MS = 5000
const BLANK_MS = 30_000
const EDGE = 12
const TOP = 8, TOP_MS = 100
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

export function make(win: AppWindow, url: string, profile: string, tab: string, { agent = false, adopt, opener, ready }: { agent?: boolean; adopt?: WebContents; opener?: number; ready?: WebContentsView } = {}): Page {
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

let popups: typeof import("./popup.ts") | undefined
