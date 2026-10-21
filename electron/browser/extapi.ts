// What extensions ask that Electron doesn't answer (extensions.preload.cjs asks): tabs (a page, by its WebContents'
// id) and windows (a vault window), the toolbar button, events about pages, permissions, cookies, native messaging.
import { BrowserWindow, dialog, ipcMain, Notification, webFrameMain, WebContentsView, type IpcMainEvent, type IpcMainInvokeEvent, type ServiceWorkerMain, type Session, type WebContents,
  type WebFrameMain } from "electron"
import { allPages, tell, type EnginePage } from "./engine.ts"
import { dirOf, get, imageOf, manifestOf, nativeHost, said, change, type Installed } from "./extstore.ts"
import { spawn, type ChildProcess } from "node:child_process"
import crypto from "node:crypto"

/** Who asks: the extension, its session, the window and tab it's in (a popup's: its page's), and its frame or worker. */
export type Ctx = { ext: Installed; s: Session; win?: BrowserWindow; tab?: number; frame?: WebFrameMain; scope?: string }

// ---------- tabs and windows ----------

/** Each window's tab in front: the page last focused or whose button was clicked. */
const front = new WeakMap<BrowserWindow, number>()
export const setFront = (p: EnginePage) => {
  const was = front.get(p.win)
  front.set(p.win, p.wc.id)
  if (was !== p.wc.id) emit(p.wc.session, "tabs.onActivated", [{ tabId: p.wc.id, windowId: p.win.id }])
}
const pagesIn = (s: Session) => allPages().filter((p) => !p.wc.isDestroyed() && p.wc.session === s && !p.win.isDestroyed())
const pageOf = (s: Session, tabId: unknown) => pagesIn(s).find((p) => p.wc.id === tabId)
const icons = new Map<number, string>()
export const setIcon = (wc: WebContents, url: string) => { icons.set(wc.id, url) }
/** The window of extensions' "current window": the caller's, else the focused one with this session's pages, else the
 *  last one with any pages, else the focused window (before any page is open, as an extension just added). */
function current(c: Ctx) {
  if (c.win && !c.win.isDestroyed()) return c.win
  const mine = windows(c.s), any = [...new Set(allPages().map((p) => p.win))].filter((w) => !w.isDestroyed())
  const focused = BrowserWindow.getFocusedWindow()
  return mine.find((w) => w.isFocused()) ?? mine[mine.length - 1] ?? any[any.length - 1]
    ?? (focused && !focused.getParentWindow() ? focused : BrowserWindow.getAllWindows().find((w) => !w.getParentWindow()))
}
const windows = (s: Session) => [...new Set(pagesIn(s).map((p) => p.win))]
const frontOf = (win: BrowserWindow, s: Session) => front.get(win) ?? pagesIn(s).filter((p) => p.win === win).pop()?.wc.id

function tabOf(p: EnginePage) {
  const wc = p.wc, s = wc.session
  const same = pagesIn(s).filter((x) => x.win === p.win)
  const active = frontOf(p.win, s) === wc.id
  const [width, height] = p.win.getContentSize()
  return {
    id: wc.id, index: same.indexOf(p), windowId: p.win.id, active, highlighted: active, selected: active, pinned: false, incognito: false,
    url: wc.getURL(), title: wc.getTitle(), ...(icons.get(wc.id) ? { favIconUrl: icons.get(wc.id) } : {}),
    status: wc.isLoading() ? "loading" : "complete", audible: wc.isCurrentlyAudible(), mutedInfo: { muted: wc.isAudioMuted() },
    discarded: false, autoDiscardable: true, frozen: false, groupId: -1, splitViewId: -1, width, height, lastAccessed: Date.now(),
  }
}
function windowOf(win: BrowserWindow, s: Session, populate?: boolean) {
  const b = win.getBounds()
  return {
    id: win.id, focused: win.isFocused(), top: b.y, left: b.x, width: b.width, height: b.height, incognito: false, type: "normal",
    state: win.isFullScreen() ? "fullscreen" : win.isMaximized() ? "maximized" : win.isMinimized() ? "minimized" : "normal", alwaysOnTop: false,
    ...(populate ? { tabs: pagesIn(s).filter((p) => p.win === win).map(tabOf) } : {}),
  }
}

/** Chrome's match patterns ("*://*.youtube.com/*", "<all_urls>") and its query's title globs. */
function matches(pattern: string, url: string) {
  if (pattern === "<all_urls>") return /^(https?|file|ftp|chrome-extension):/.test(url)
  const m = /^(\*|https?|file|ftp|chrome-extension):\/\/([^/]*)(\/.*)$/.exec(pattern)
  if (!m) return false
  let u: URL
  try { u = new URL(url) } catch { return false }
  const scheme = u.protocol.slice(0, -1)
  if (m[1] === "*" ? !/^https?$/.test(scheme) : m[1] !== scheme) return false
  const host = m[2]
  if (host !== "*" && !(host.startsWith("*.") ? u.hostname === host.slice(2) || u.hostname.endsWith(host.slice(1)) : u.hostname === host)) return false
  return glob(m[3]).test(u.pathname + u.search)
}
const glob = (g: string) => new RegExp(`^${g.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`)

const opening: { win: BrowserWindow; done: (p: EnginePage) => void }[] = []
/** A page was made: an extension waiting for the tab it asked for gets it. */
export function tabMade(p: EnginePage) {
  const i = opening.findIndex((o) => o.win === p.win)
  if (i >= 0) opening.splice(i, 1)[0].done(p)
  emit(p.wc.session, "tabs.onCreated", [tabOf(p)])
}

/** A new web tab in `win` (as web.ts's `open`), resolved with its tab once the window made it. */
function openTab(win: BrowserWindow, s: Session, url: string, active = true) {
  return new Promise<(ReturnType<typeof tabOf> & { pendingUrl: string }) | null>((done) => {
    const o = { win, done: (p: EnginePage) => { clearTimeout(t); done({ ...tabOf(p), url, pendingUrl: url }) } }
    const t = setTimeout(() => { opening.splice(opening.indexOf(o), 1); done(null) }, 5000)
    opening.push(o)
    tell(win, { type: "engine:ext:open", url, active, profile: profileOf(s) })
  })
}
/** An address an extension may open: the web, or its own pages (relative ones are its own). */
function addressFor(c: Ctx, url: unknown) {
  const base = `chrome-extension://${c.ext.id}/`
  const u = typeof url === "string" && url ? new URL(url, base).href : ""
  if (!u) return ""
  if (/^https?:\/\//i.test(u) || u.startsWith(base)) return u
  throw new Error("only web pages and the extension's own can be opened")
}

// ---------- the toolbar button ----------

type Action = { title?: string; icon?: string; badge?: string; badgeColor?: string; badgeTextColor?: string; popup?: string; enabled?: boolean }
/** Each session's buttons by extension: the extension-wide state, and each tab's own over it. */
const actions = new WeakMap<Session, Map<string, { all: Action; tabs: Map<number, Action> }>>()
function actionOf(s: Session, ext: string) {
  let bySession = actions.get(s)
  if (!bySession) actions.set(s, (bySession = new Map()))
  let a = bySession.get(ext)
  if (!a) bySession.set(ext, (a = { all: {}, tabs: new Map() }))
  return a
}
let changing: ReturnType<typeof setTimeout> | null = null
/** The buttons changed: windows ask again (once for a burst). */
export function actionsChanged() {
  changing ??= setTimeout(() => {
    changing = null
    for (const w of BrowserWindow.getAllWindows()) tell(w, { type: "engine:ext:changed" })
  }, 50)
}
export const forgetActions = (ext: string) => { for (const s of sessionsOf()) actions.get(s)?.delete(ext) }
let profiles = new Map<Session, string>()
const sessionsOf = () => [...profiles.keys()]
/** The sessions extensions are in, and each one's profile (a workspace's logins, a container's "c-<id>"). */
export const setSessions = (map: Map<Session, string>) => { profiles = map }
export const profileOf = (s: Session) => profiles.get(s) ?? ""

/** An extension's button as a page shows it: the manifest's, then what it set, then what it set for that tab. */
export function buttonOf(x: Installed, s: Session, tabId: number) {
  const dir = dirOf(x), m = manifestOf(dir), a = m.action ?? m.browser_action ?? {}
  const st = actions.get(s)?.get(x.id), mine = { ...st?.all, ...st?.tabs.get(tabId) }
  return {
    id: x.id, name: x.name, pinned: x.pinned,
    title: mine.title ?? (said(dir, a.default_title) || x.name),
    icon: mine.icon || imageOf(dir, a.default_icon, 32) || imageOf(dir, m.icons, 32),
    badge: mine.badge ?? "", badgeColor: mine.badgeColor ?? "", badgeTextColor: mine.badgeTextColor ?? "",
    popup: (mine.popup ?? a.default_popup ?? "") !== "", enabled: mine.enabled ?? true,
  }
}
export function popupOf(x: Installed, s: Session, tabId: number) {
  const m = manifestOf(dirOf(x)), a = m.action ?? m.browser_action ?? {}
  const st = actions.get(s)?.get(x.id)
  const p = st?.tabs.get(tabId)?.popup ?? st?.all.popup ?? a.default_popup ?? ""
  return p ? new URL(p, `chrome-extension://${x.id}/`).href : ""
}

const color = (c: unknown) => {
  if (typeof c === "string") return c.slice(0, 40)
  if (Array.isArray(c) && c.length >= 3) return `rgba(${c.slice(0, 3).map(Number).join(",")},${c.length > 3 ? Number(c[3]) / 255 : 1})`
  return ""
}
function setAction(c: Ctx, details: unknown, patch: Action) {
  const d = (details ?? {}) as { tabId?: unknown }
  const a = actionOf(c.s, c.ext.id)
  if (typeof d.tabId === "number") a.tabs.set(d.tabId, { ...a.tabs.get(d.tabId), ...patch })
  else Object.assign(a.all, patch)
  actionsChanged()
}
function readAction<K extends keyof Action>(c: Ctx, details: unknown, k: K, fallback: Action[K]) {
  const d = (details ?? {}) as { tabId?: unknown }
  const a = actionOf(c.s, c.ext.id)
  return (typeof d.tabId === "number" ? a.tabs.get(d.tabId)?.[k] : undefined) ?? a.all[k] ?? fallback
}
function iconFrom(c: Ctx, d: { path?: unknown; imageData?: Record<string, Uint8Array> }) {
  if (d.imageData && typeof d.imageData === "object") {
    const sizes = Object.keys(d.imageData).map(Number).sort((a, b) => a - b)
    const size = sizes.find((n) => n >= 32) ?? sizes[sizes.length - 1]
    const png = d.imageData[String(size)]
    return png?.length && png.length < 512 * 1024 ? `data:image/png;base64,${Buffer.from(png).toString("base64")}` : ""
  }
  return imageOf(dirOf(c.ext), d.path, 32)
}

// ---------- events ----------

type Target = { frame: WebFrameMain; background?: boolean } | { worker: true }
/** Who listens for what, by session and extension. */
const listening = new WeakMap<Session, Map<string, Map<string, Target[]>>>()
function listen(s: Session, ext: string, name: string, t: Target) {
  let byExt = listening.get(s)
  if (!byExt) listening.set(s, (byExt = new Map()))
  let byName = byExt.get(ext)
  if (!byName) byExt.set(ext, (byName = new Map()))
  const list = (byName.get(name) ?? []).filter((x) => ("frame" in x ? !x.frame.isDestroyed() && x.frame.detached !== true : true))
  if ("worker" in t ? !list.some((x) => "worker" in x) : !list.some((x) => "frame" in x && x.frame === t.frame)) list.push(t)
  byName.set(name, list)
  // Its background (worker or page) listening for what loading it was: told now, once.
  const due = expected.get(s)?.get(ext)
  if (due?.name === name && ("worker" in t || t.background)) {
    expected.get(s)!.delete(ext)
    setTimeout(() => emit(s, name, due.args, ext), 0)
  }
}
/** What a session's loading of an extension waits to tell its background: onInstalled or onStartup (Electron sends
 *  neither), as soon as the background listens. */
const expected = new WeakMap<Session, Map<string, { name: string; args: unknown[] }>>()
export function expect(s: Session, ext: string, name: string, args: unknown[]) {
  let byExt = expected.get(s)
  if (!byExt) expected.set(s, (byExt = new Map()))
  byExt.set(ext, { name, args })
}
const forgets: ((s: Session, ext: string) => void)[] = []
/** `fn` runs as an extension leaves a session, to drop what another file kept for it there. */
export const onUnlisten = (fn: (s: Session, ext: string) => void) => { forgets.push(fn) }
export const unlisten = (s: Session, ext: string) => { listening.get(s)?.delete(ext); for (const fn of forgets) fn(s, ext) }

/** Tell the extensions of `s` listening for `name` (all of them, or `only`); a stopped service worker is started. */
export function emit(s: Session, name: string, args: unknown[], only?: string) {
  for (const [ext, byName] of listening.get(s) ?? []) {
    if (only && ext !== only) continue
    for (const t of byName.get(name) ?? []) {
      if ("frame" in t) { if (!t.frame.isDestroyed()) try { t.frame.send("vaultite:ext:event", name, args) } catch { /* gone */ } }
      else void workerOf(s, `chrome-extension://${ext}/`).then((w) => w?.send("vaultite:ext:event", name, args))
    }
  }
}
export const emitAll = (name: string, args: unknown[]) => { for (const s of sessionsOf()) emit(s, name, args) }

/** A page's comings and goings, as tabs and webNavigation events. */
export function watchPage(p: EnginePage) {
  const wc = p.wc, s = wc.session, id = wc.id
  const updated = (change: Record<string, unknown>) => { if (!wc.isDestroyed()) emit(s, "tabs.onUpdated", [id, change, tabOf(p)]) }
  wc.on("did-start-loading", () => updated({ status: "loading" }))
  wc.on("did-stop-loading", () => updated({ status: "complete" }))
  wc.on("did-navigate", (_e, url) => updated({ url }))
  wc.on("did-navigate-in-page", (_e, url, main) => { if (main) updated({ url }) })
  wc.on("page-title-updated", (_e, title) => updated({ title }))
  wc.on("page-favicon-updated", (_e, list) => { if (list[0]) { icons.set(id, list[0]); updated({ favIconUrl: list[0] }) } })
  wc.on("audio-state-changed", (e) => updated({ audible: e.audible }))
  wc.on("focus", () => setFront(p))
  const frameId = (main: boolean, pid: number, rid: number) => (main ? 0 : webFrameMain.fromId(pid, rid)?.frameTreeNodeId ?? -1)
  const nav = (name: string, x: Record<string, unknown>) => emit(s, `webNavigation.${name}`, [{ tabId: id, processId: -1, timeStamp: Date.now(), ...x }])
  wc.on("did-start-navigation", (d) => {
    if (d.isSameDocument) return
    nav("onBeforeNavigate", { url: d.url, frameId: d.isMainFrame ? 0 : d.frame?.frameTreeNodeId ?? -1, parentFrameId: d.isMainFrame ? -1 : 0 })
  })
  wc.on("did-frame-navigate", (_e, url, _code, _text, main, pid, rid) =>
    nav("onCommitted", { url, frameId: frameId(main, pid, rid), parentFrameId: main ? -1 : 0, transitionType: "link", transitionQualifiers: [] }))
  wc.on("dom-ready", () => nav("onDOMContentLoaded", { url: wc.getURL(), frameId: 0, parentFrameId: -1 }))
  wc.on("did-frame-finish-load", (_e, main, pid, rid) => nav("onCompleted", { url: main ? wc.getURL() : webFrameMain.fromId(pid, rid)?.url ?? "", frameId: frameId(main, pid, rid), parentFrameId: main ? -1 : 0 }))
  wc.on("did-navigate-in-page", (_e, url, main, pid, rid) => nav("onHistoryStateUpdated", { url, frameId: frameId(main, pid, rid), parentFrameId: main ? -1 : 0, transitionType: "link", transitionQualifiers: [] }))
  wc.on("did-fail-load", (_e, code, desc, url, main, pid, rid) => { if (code !== -3) nav("onErrorOccurred", { url, error: desc || String(code), frameId: frameId(main, pid, rid), parentFrameId: main ? -1 : 0 }) })
  const win = p.win
  wc.once("destroyed", () => {
    icons.delete(id)
    for (const a of actions.get(s)?.values() ?? []) a.tabs.delete(id)
    emit(s, "tabs.onRemoved", [id, { windowId: win.isDestroyed() ? -1 : win.id, isWindowClosing: win.isDestroyed() }])
  })
}

// ---------- native messaging ----------

type Native = { proc: ChildProcess; s: Session; ext: string; event: string }
const natives = new Map<string, Native>()
function nativeStart(c: Ctx, app: string) {
  const host = nativeHost(app, c.ext.id)
  if (!host) throw new Error(`Specified native messaging host not found: ${app}`)
  return spawn(host.path, [`chrome-extension://${c.ext.id}/`], { stdio: ["pipe", "pipe", "ignore"] })
}
/** A native app's replies: 4-byte lengths (this machine's order), then JSON. */
function readFrames(proc: ChildProcess, each: (m: unknown) => void) {
  let buf = Buffer.alloc(0)
  proc.stdout?.on("data", (d: Buffer) => {
    buf = Buffer.concat([buf, d])
    while (buf.length >= 4) {
      const n = buf.readUInt32LE(0)
      if (n > 64 * 1024 * 1024) { proc.kill(); return }
      if (buf.length < 4 + n) break
      const text = buf.toString("utf8", 4, 4 + n)
      buf = buf.subarray(4 + n)
      try { each(JSON.parse(text)) } catch { /* not JSON: dropped, as Chrome does */ }
    }
  })
}
function writeFrame(proc: ChildProcess, m: unknown) {
  const body = Buffer.from(JSON.stringify(m ?? null)), len = Buffer.alloc(4)
  len.writeUInt32LE(body.length)
  proc.stdin?.write(Buffer.concat([len, body]))
}
export function closeNatives(s: Session, ext?: string) {
  for (const [id, n] of natives) if (n.s === s && (!ext || n.ext === ext)) { n.proc.kill(); natives.delete(id) }
}

// ---------- the calls ----------

/** Each session's offscreen documents, by extension: hidden pages, never in a window. */
const offscreen = new WeakMap<Session, Map<string, WebContentsView>>()
export const closeOffscreen = (s: Session, ext: string) => { const v = offscreen.get(s)?.get(ext); if (v && !v.webContents.isDestroyed()) v.webContents.close() }
const cookieOf = (x: Electron.Cookie) => ({ ...x, hostOnly: !!x.hostOnly, session: !!x.session, storeId: "0", sameSite: x.sameSite === "unspecified" ? "unspecified" : x.sameSite })

export const permsOf = (x: Installed) => {
  const m = manifestOf(dirOf(x))
  return { permissions: [...(m.permissions ?? []).filter((p) => !p.includes("/") && p !== "<all_urls>"), ...(x.granted ?? []).filter((p) => !p.includes("/"))],
    origins: [...(m.host_permissions ?? []), ...(m.permissions ?? []).filter((p) => p.includes("/") || p === "<all_urls>"), ...(x.granted ?? []).filter((p) => p.includes("/"))] }
}
const has = (x: Installed, want: { permissions?: string[]; origins?: string[] }) => {
  const mine = permsOf(x)
  return (want.permissions ?? []).every((p) => mine.permissions.includes(p))
    && (want.origins ?? []).every((o) => mine.origins.some((h) => h === o || h === "<all_urls>" || h === "*://*/*" || matches(h, o.replace(/\*/g, "x"))))
}

export type Call = (c: Ctx, ...args: any[]) => unknown // eslint-disable-line @typescript-eslint/no-explicit-any
const CALLS: Record<string, Call> = {
  "action.setTitle": (c, d) => setAction(c, d, { title: String(d?.title ?? "").slice(0, 200) }),
  "action.getTitle": (c, d) => readAction(c, d, "title", buttonOf(c.ext, c.s, -1).title),
  "action.setIcon": (c, d) => setAction(c, d, { icon: iconFrom(c, d ?? {}) }),
  "action.setBadgeText": (c, d) => setAction(c, d, { badge: String(d?.text ?? "").slice(0, 8) }),
  "action.getBadgeText": (c, d) => readAction(c, d, "badge", ""),
  "action.setBadgeBackgroundColor": (c, d) => setAction(c, d, { badgeColor: color(d?.color) }),
  "action.getBadgeBackgroundColor": (c, d) => readAction(c, d, "badgeColor", "") || [0, 0, 0, 0],
  "action.setBadgeTextColor": (c, d) => setAction(c, d, { badgeTextColor: color(d?.color) }),
  "action.getBadgeTextColor": (c, d) => readAction(c, d, "badgeTextColor", "") || [255, 255, 255, 255],
  "action.setPopup": (c, d) => setAction(c, d, { popup: String(d?.popup ?? "") }),
  "action.getPopup": (c, d) => { const p = readAction(c, d, "popup", undefined); return p === undefined ? popupOf(c.ext, c.s, Number(d?.tabId ?? -1)) : p ? new URL(p, `chrome-extension://${c.ext.id}/`).href : "" },
  "action.enable": (c, tabId) => setAction(c, typeof tabId === "number" ? { tabId } : {}, { enabled: true }),
  "action.disable": (c, tabId) => setAction(c, typeof tabId === "number" ? { tabId } : {}, { enabled: false }),
  "action.isEnabled": (c, tabId) => readAction(c, typeof tabId === "number" ? { tabId } : {}, "enabled", true),
  "action.getUserSettings": (c) => ({ isOnToolbar: c.ext.pinned }),
  "action.openPopup": (c) => { const w = current(c); if (w) tell(w, { type: "engine:ext:popup-ask", ext: c.ext.id }) },

  "tabs.query": (c, q: Record<string, unknown> = {}) => {
    const win = current(c)
    const urls = q.url === undefined ? null : ([] as unknown[]).concat(q.url).map(String)
    return pagesIn(c.s).map(tabOf).filter((t) => {
      if (q.active !== undefined && t.active !== q.active) return false
      if (q.highlighted !== undefined && t.highlighted !== q.highlighted) return false
      if ((q.currentWindow === true || q.lastFocusedWindow === true || q.windowId === -2) && t.windowId !== win?.id) return false
      if (typeof q.windowId === "number" && q.windowId >= 0 && t.windowId !== q.windowId) return false
      if (typeof q.status === "string" && t.status !== q.status) return false
      if (typeof q.title === "string" && !glob(q.title).test(t.title)) return false
      if (typeof q.index === "number" && t.index !== q.index) return false
      if (typeof q.audible === "boolean" && t.audible !== q.audible) return false
      if (q.pinned === true || q.discarded === true) return false
      return !urls || urls.some((u) => matches(u, t.url))
    })
  },
  "tabs.get": (c, id) => { const p = pageOf(c.s, id); if (!p) throw new Error(`No tab with id: ${id}.`); return tabOf(p) },
  "tabs.getCurrent": (c) => { const p = c.tab === undefined ? undefined : pageOf(c.s, c.tab); return p ? tabOf(p) : undefined },
  "tabs.create": async (c, o: Record<string, unknown> = {}) => {
    const win = (typeof o.windowId === "number" && BrowserWindow.fromId(o.windowId)) || current(c)
    if (!win) throw new Error("No current window")
    return openTab(win, c.s, addressFor(c, o.url) || "https://duckduckgo.com/", o.active !== false)
  },
  "tabs.update": async (c, a, b) => {
    const [id, o] = typeof a === "number" ? [a, (b ?? {}) as Record<string, unknown>] : [c.tab ?? frontOf(current(c)!, c.s), (a ?? {}) as Record<string, unknown>]
    const p = pageOf(c.s, id)
    if (!p) throw new Error(`No tab with id: ${id}.`)
    if (o.url) await p.wc.loadURL(addressFor(c, o.url)).catch(() => {})
    if (typeof o.muted === "boolean") p.wc.setAudioMuted(o.muted)
    if (o.active === true || o.highlighted === true) { setFront(p); tell(p.win, { type: "engine:ext:show", url: p.wc.getURL(), profile: profileOf(c.s) }) }
    return tabOf(p)
  },
  "tabs.highlight": (c, o: { tabs?: number | number[] } = {}) => {
    const p = pageOf(c.s, ([] as number[]).concat(o.tabs ?? [])[0])
    if (p) { setFront(p); tell(p.win, { type: "engine:ext:show", url: p.wc.getURL(), profile: profileOf(c.s) }); return windowOf(p.win, c.s, true) }
  },
  "tabs.remove": (c, ids) => {
    for (const id of ([] as unknown[]).concat(ids)) { const p = pageOf(c.s, id); if (p) tell(p.win, { type: "engine:ext:close", url: p.wc.getURL(), profile: profileOf(c.s) }) }
  },

  "windows.get": (c, id, o?: { populate?: boolean }) => { const w = id === -2 ? current(c) : windows(c.s).find((x) => x.id === id); if (!w) throw new Error(`No window with id: ${id}.`); return windowOf(w, c.s, o?.populate) },
  "windows.getCurrent": (c, o?: { populate?: boolean }) => { const w = current(c); if (!w) throw new Error("No current window"); return windowOf(w, c.s, o?.populate) },
  "windows.getLastFocused": (c, o?: { populate?: boolean }) => CALLS["windows.getCurrent"](c, o),
  "windows.getAll": (c, o?: { populate?: boolean }) => windows(c.s).map((w) => windowOf(w, c.s, o?.populate)),
  "windows.create": async (c, o: { url?: string | string[] } = {}) => {
    const win = current(c)
    if (!win) throw new Error("No current window")
    for (const u of ([] as string[]).concat(o.url ?? [])) await openTab(win, c.s, addressFor(c, u))
    win.focus()
    return windowOf(win, c.s, true)
  },
  "windows.update": (c, id, o: { focused?: boolean } = {}) => { const w = windows(c.s).find((x) => x.id === id) ?? current(c); if (w && o.focused) w.focus(); return w ? windowOf(w, c.s) : undefined },
  // (an extension never closes a vault's window)
  "windows.remove": () => undefined,

  "permissions.getAll": (c) => permsOf(c.ext),
  "permissions.contains": (c, want = {}) => has(c.ext, want),
  "permissions.request": async (c, want: { permissions?: string[]; origins?: string[] } = {}) => {
    if (has(c.ext, want)) return true
    const m = manifestOf(dirOf(c.ext)), optional = [...(m.optional_permissions ?? []), ...((m.optional_host_permissions as string[] | undefined) ?? [])]
    const asked = [...(want.permissions ?? []), ...(want.origins ?? [])]
    const allowedAsk = asked.every((p) => optional.includes(p) || p.includes("/"))
    if (!allowedAsk) return false
    const win = current(c)
    const box = { type: "question" as const, message: `${c.ext.name} asks for more access`, detail: asked.join("\n"), buttons: ["Allow", "Don't allow"], defaultId: 1, cancelId: 1 }
    const r = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box)
    if (r.response !== 0) return false
    change(c.ext.id, { granted: [...new Set([...(c.ext.granted ?? []), ...asked])] })
    emit(c.s, "permissions.onAdded", [{ permissions: want.permissions ?? [], origins: want.origins ?? [] }], c.ext.id)
    return true
  },
  "permissions.remove": (c, want: { permissions?: string[]; origins?: string[] } = {}) => {
    const drop = new Set([...(want.permissions ?? []), ...(want.origins ?? [])])
    change(c.ext.id, { granted: (c.ext.granted ?? []).filter((p) => !drop.has(p)) })
    return true
  },

  "webNavigation.getFrame": (c, d: { tabId?: number; frameId?: number } = {}) => {
    const p = pageOf(c.s, d.tabId)
    const f = p && (d.frameId === 0 ? p.wc.mainFrame : p.wc.mainFrame.framesInSubtree.find((x) => x.frameTreeNodeId === d.frameId))
    return f ? { url: f.url, frameId: d.frameId, parentFrameId: f.parent ? (f.parent === p!.wc.mainFrame ? 0 : f.parent.frameTreeNodeId) : -1, errorOccurred: false } : null
  },
  "webNavigation.getAllFrames": (c, d: { tabId?: number } = {}) => {
    const p = pageOf(c.s, d.tabId)
    if (!p) return null
    const main = p.wc.mainFrame
    return main.framesInSubtree.map((f) => ({ url: f.url, frameId: f === main ? 0 : f.frameTreeNodeId, parentFrameId: !f.parent ? -1 : f.parent === main ? 0 : f.parent.frameTreeNodeId, errorOccurred: false }))
  },

  "contextMenus.noop": () => undefined,
  "runtime.noop": () => undefined,
  "runtime.false": () => false,
  "commands.getAll": (c) => Object.entries(manifestOf(dirOf(c.ext)).commands ?? {}).map(([name, x]) => ({ name, description: said(dirOf(c.ext), x?.description), shortcut: "" })),
  "fontSettings.getFontList": () => ["Helvetica", "Arial", "Georgia", "Times New Roman", "Verdana", "Menlo", "Courier New", "system-ui", "serif", "sans-serif", "monospace"]
    .map((f) => ({ fontId: f, displayName: f })),

  // (a session's cookie jar, as Chrome's cookies API has it: its one store, "0")
  "cookies.get": async (c, d: { url?: string; name?: string } = {}) => {
    const [x] = await c.s.cookies.get({ url: String(d.url ?? ""), name: String(d.name ?? "") })
    return x ? cookieOf(x) : null
  },
  "cookies.getAll": async (c, d: Record<string, unknown> = {}) => {
    const { storeId: _s, partitionKey: _p, ...filter } = d
    return (await c.s.cookies.get(filter as Electron.CookiesGetFilter)).map(cookieOf)
  },
  "cookies.set": async (c, d: Record<string, unknown> = {}) => {
    const { storeId: _s, partitionKey: _p, ...details } = d
    await c.s.cookies.set(details as unknown as Electron.CookiesSetDetails)
    const [x] = await c.s.cookies.get({ url: String(d.url ?? ""), name: String(d.name ?? "") })
    return x ? cookieOf(x) : null
  },
  "cookies.remove": async (c, d: { url?: string; name?: string } = {}) => {
    await c.s.cookies.remove(String(d.url ?? ""), String(d.name ?? ""))
    return { url: d.url, name: d.name, storeId: "0" }
  },
  "cookies.getAllCookieStores": (c) => [{ id: "0", tabIds: pagesIn(c.s).map((p) => p.wc.id) }],

  "offscreen.createDocument": (c, d: { url?: string } = {}) => {
    const key = `${c.ext.id}`
    let byExt = offscreen.get(c.s)
    if (!byExt) offscreen.set(c.s, (byExt = new Map()))
    if (byExt.has(key)) throw new Error("Only a single offscreen document may be created.")
    const view = new WebContentsView({ webPreferences: { session: c.s, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    byExt.set(key, view)
    view.webContents.once("destroyed", () => byExt.delete(key))
    return view.webContents.loadURL(new URL(String(d.url ?? ""), `chrome-extension://${c.ext.id}/`).href).then(() => undefined)
  },
  "offscreen.closeDocument": (c) => { const v = offscreen.get(c.s)?.get(c.ext.id); if (v && !v.webContents.isDestroyed()) v.webContents.close() },
  "offscreen.hasDocument": (c) => !!offscreen.get(c.s)?.get(c.ext.id),

  "notifications.create": (c, a, b) => {
    const [id, o] = typeof a === "string" ? [a, (b ?? {}) as Record<string, unknown>] : [crypto.randomUUID(), (a ?? {}) as Record<string, unknown>]
    if (!Notification.isSupported()) return id
    const n = new Notification({ title: String(o.title ?? c.ext.name), body: String(o.message ?? ""), silent: !!o.silent })
    n.on("click", () => emit(c.s, "notifications.onClicked", [id], c.ext.id))
    n.on("close", () => emit(c.s, "notifications.onClosed", [id, true], c.ext.id))
    n.show()
    return id
  },
  "notifications.clear": () => true,
  "notifications.update": () => true,
  "notifications.getAll": () => ({}),
  "notifications.getPermissionLevel": () => "granted",

  "runtime.openOptionsPage": async (c) => {
    const m = manifestOf(dirOf(c.ext)), page = m.options_ui?.page ?? m.options_page
    if (!page) throw new Error("Could not create an options page.")
    const win = current(c)
    if (win) await openTab(win, c.s, new URL(page, `chrome-extension://${c.ext.id}/`).href)
  },
  "runtime.connectNative": (c, app: string, event: string) => {
    const proc = nativeStart(c, String(app)), id = crypto.randomUUID()
    natives.set(id, { proc, s: c.s, ext: c.ext.id, event: String(event) })
    readFrames(proc, (m) => emit(c.s, String(event), ["message", m], c.ext.id))
    const end = () => { if (natives.delete(id)) emit(c.s, String(event), ["disconnect"], c.ext.id) }
    proc.on("exit", end)
    proc.on("error", end)
    return id
  },
  "runtime.nativePost": (c, id: string, m: unknown) => { const n = natives.get(id); if (n && n.ext === c.ext.id) writeFrame(n.proc, m) },
  "runtime.nativeClose": (c, id: string) => { const n = natives.get(id); if (n && n.ext === c.ext.id) { n.proc.kill(); natives.delete(id) } },
  "runtime.sendNativeMessage": (c, app: string, m: unknown) => new Promise((done, fail) => {
    const proc = nativeStart(c, String(app))
    const t = setTimeout(() => { proc.kill(); fail(new Error("Native host has exited.")) }, 30_000)
    readFrames(proc, (reply) => { clearTimeout(t); proc.kill(); done(reply) })
    proc.on("exit", () => { clearTimeout(t); fail(new Error("Native host has exited.")) })
    writeFrame(proc, m)
  }),
}

/** Calls another file answers (extwebrequest.ts). */
export const addCalls = (more: Record<string, Call>) => { Object.assign(CALLS, more) }

// ---------- who's asking ----------

/** The popups open, by their contents: their page is their tab and window. */
export const popups = new Map<number, EnginePage>()

const extOfUrl = (u: string | undefined) => /^chrome-extension:\/\/([a-p]{32})\//.exec(u ?? "")?.[1]
function ctxOfFrame(e: IpcMainInvokeEvent | IpcMainEvent): Ctx | null {
  const ext = get(extOfUrl(e.senderFrame?.url) ?? "")
  if (!ext?.on) return null
  const wc = e.sender, s = wc.session
  const page = popups.get(wc.id) ?? allPages().find((p) => p.wc === wc)
  return { ext, s, win: page?.win ?? BrowserWindow.fromWebContents(wc) ?? undefined, tab: page?.wc.id, frame: e.senderFrame ?? undefined }
}

async function answer(c: Ctx | null, name: unknown, args: unknown) {
  if (!c) throw new Error("not an extension")
  const fn = typeof name === "string" ? CALLS[name] : undefined
  if (!fn) throw new Error(`${String(name)} isn't supported`)
  return fn(c, ...(Array.isArray(args) ? args : []))
}

ipcMain.handle("vaultite:ext", (e, name, args) => answer(ctxOfFrame(e), name, args))
ipcMain.on("vaultite:ext:listen", (e, name) => {
  const c = ctxOfFrame(e)
  if (c && typeof name === "string" && e.senderFrame) listen(c.s, c.ext.id, name, { frame: e.senderFrame, background: e.sender.getType() === "backgroundPage" })
})

/** Each session's extension workers by scope: the one running, those starting (by version), what waits for one to run
 *  and the starts asked for. */
type Workers = { running: Map<string, ServiceWorkerMain>; starting: Map<number, string>; waiting: Map<string, ((w: ServiceWorkerMain | null) => void)[]>
  asked: Set<string> }
const workers = new WeakMap<Session, Workers>()
function workersOf(s: Session) {
  let x = workers.get(s)
  if (!x) workers.set(s, (x = { running: new Map(), starting: new Map(), waiting: new Map(), asked: new Set() }))
  return x
}
const startingFor = (x: Workers, scope: string) => [...x.starting.values()].includes(scope)
function settle(s: Session, scope: string, w: ServiceWorkerMain | null) {
  const x = workersOf(s), list = x.waiting.get(scope) ?? []
  x.waiting.delete(scope)
  for (const done of list) done(w)
}
/** Start a scope's worker for what waits: a start already under way refuses another, so then its running settles it. */
function start(s: Session, scope: string, again: boolean) {
  const x = workersOf(s)
  x.asked.add(scope)
  s.serviceWorkers.startWorkerForScope(scope).then((w) => { x.asked.delete(scope); settle(s, scope, w) }, () => {
    x.asked.delete(scope)
    if (startingFor(x, scope)) return
    // (once more: the "starting" of the one under way may not have come yet)
    if (again) setTimeout(() => { if (x.waiting.has(scope) && !startingFor(x, scope) && !x.asked.has(scope)) start(s, scope, false) }, 250)
    else settle(s, scope, null)
  })
}
/** An extension's worker once it runs, started when it's stopped (as Chrome wakes one for its events): what's for it is
 *  never dropped for its being on its way up. Null if it can't start. */
export function workerOf(s: Session, scope: string): Promise<ServiceWorkerMain | null> {
  const x = workersOf(s), w = x.running.get(scope)
  if (w && !w.isDestroyed()) return Promise.resolve(w)
  return new Promise((done) => {
    const list = x.waiting.get(scope)
    if (list) return void list.push(done)
    x.waiting.set(scope, [done])
    start(s, scope, true)
  })
}
/** A worker's running status, as `workerOf` needs it. */
function workerStatus(s: Session, status: string, versionId: number, w: ServiceWorkerMain | undefined) {
  const x = workersOf(s)
  const scope = w?.scope ?? x.starting.get(versionId) ?? [...x.running].find(([, r]) => r.versionId === versionId)?.[0]
  if (!scope || !extOfUrl(scope)) return
  if (status === "starting") return void x.starting.set(versionId, scope)
  x.starting.delete(versionId)
  if (status === "running" && w) { x.running.set(scope, w); settle(s, scope, w) }
  else if (x.running.get(scope)?.versionId === versionId) x.running.delete(scope)
  // (one that stopped before it ran: started again for what waits)
  if (status === "stopped" && x.waiting.has(scope) && !startingFor(x, scope) && !x.asked.has(scope)) start(s, scope, false)
}

/** An extension's service worker as it starts: its calls answered, its listeners kept (it's started again for them). */
export function watchWorkers(s: Session) {
  const seen = new WeakSet<ServiceWorkerMain>()
  s.serviceWorkers.on("running-status-changed", ({ runningStatus, versionId }) => {
    const w = s.serviceWorkers.getWorkerFromVersionID(versionId)
    workerStatus(s, runningStatus, versionId, w)
    if (runningStatus !== "starting" || !w || seen.has(w)) return
    seen.add(w)
    // (every worker's preload asks, sites' too: it acts only in an extension's)
    w.ipc.on("vaultite:ext:scope", (e) => { e.returnValue = w.scope })
    const id = extOfUrl(w.scope)
    if (!id) return
    const ctx = (): Ctx | null => { const ext = get(id); return ext?.on ? { ext, s, scope: w.scope } : null }
    w.ipc.handle("vaultite:ext", (_e, name, args) => answer(ctx(), name, args))
    w.ipc.on("vaultite:ext:listen", (_e, name) => { if (ctx() && typeof name === "string") listen(s, id, name, { worker: true }) })
  })
}

/** A session's cookies changing, for cookies.onChanged. */
export function watchCookies(s: Session) {
  s.cookies.on("changed", (_e, cookie, cause, removed) => emit(s, "cookies.onChanged", [{ cookie: cookieOf(cookie), cause, removed }]))
}

/** Windows' focus, for windows.onFocusChanged. */
export function watchWindow(win: BrowserWindow) {
  if (watched.has(win)) return
  watched.add(win)
  win.on("focus", () => emitAll("windows.onFocusChanged", [win.id]))
  win.on("blur", () => { if (!BrowserWindow.getFocusedWindow()) emitAll("windows.onFocusChanged", [-1]) })
}
const watched = new WeakSet<BrowserWindow>()
