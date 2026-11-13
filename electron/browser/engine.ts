// The browser engine: each feature adds itself here for every web session and page as they are made.
import type { AuthInfo, AuthenticationResponseDetails, BaseWindow, OnBeforeRequestListenerDetails, Session, WebContents } from "electron"
import { messageOf } from "./messageof.ts"
import { logger, logTo, unlogged, type Logger } from "./enginelog.ts"
export { logger }

export type EngineWindow = BaseWindow & { readonly webContents: WebContents }
/** What the engine needs of the app (main.ts hands it once, before any page opens). `localUrl`: whether an address is
 *  this machine's or its network's (core/web.ts). */
export type EngineHost = { windows: () => EngineWindow[]; localUrl: (url: string) => boolean; logger: (area: string) => Logger }
let host: EngineHost = { windows: () => [], localUrl: () => true, logger: unlogged }
export const setEngineHost = (h: EngineHost) => { host = h; logTo(h.logger) }
const log = logger("browser")
export const localUrl = (url: string) => host.localUrl(url)
export const appWindows = () => host.windows().filter((w) => !w.isDestroyed())
export const focusedWindow = () => appWindows().find((w) => w.isFocused()) ?? null
export const windowById = (id: number) => appWindows().find((w) => w.id === id) ?? null
export const windowOfPage = (wc: WebContents) => appWindows().find((w) => w.webContents === wc) ?? null

const PARTITION = "persist:web"
export const partitionOf = (profile: string) => (/^[a-z0-9-]{1,32}$/.test(profile) ? `${PARTITION}-${profile}` : PARTITION)

type SessionSetup = (s: Session, profile: string) => void | Promise<void>
export type EnginePage = { id: number; wc: WebContents; profile: string; win: EngineWindow
  url: string
  /** Take it off the screen (its tab shows it again when it asks to). */
  hide: () => void
  visible: () => boolean
  /** Into a window of its own to watch it in (`fullScreen`: on a Space of its own), or back in its tab. */
  player: (on: boolean, fullScreen: boolean) => void
  /** The app's tab it's for ("": none). */
  tab: () => string
  opener?: number
  /** Give it to the app's tab `tab` (opened as a tab), or to the background ("": an agent's, with no tab). */
  own: (tab: string) => void
  close: () => void
  /** An agent's page in the background: resting (hidden, throttled: it draws nothing) after a while unused, woken (its
   *  next frame drawn, when the promise settles) for whatever needs it. Others are always awake. */
  rest: () => void; wake: () => Promise<void>; resting: () => boolean
  /** Placed again as its tab wants it: whether an agent holds it (`pageHeld`) changed. */
  refit: () => void }
type PageSetup = (p: EnginePage) => void

const sessionSetups: SessionSetup[] = []
const pageSetups: PageSetup[] = []
const made = new Map<string, Session>()
const pages = new Map<number, EnginePage>()

const run = (fn: () => void | Promise<void>): Promise<void> => {
  try { return Promise.resolve(fn()).catch((e) => log.error("a browser feature's setup failed", e)) }
  catch (e) { log.error("a browser feature's setup failed", e); return Promise.resolve() }
}

/** `fn` runs for each web session, the ones made already included. What it returns, the session's pages wait for
 *  (`sessionReady`): a setup that returns a promise keeps it short. */
export function eachSession(fn: SessionSetup) {
  sessionSetups.push(fn)
  for (const [profile, s] of made) run(() => fn(s, profile))
}
/** `fn` runs for each page as it's made, the open ones included. */
export function eachPage(fn: PageSetup) {
  pageSetups.push(fn)
  for (const p of pages.values()) run(() => fn(p))
}

export function sessionMade(s: Session, profile: string) {
  made.set(profile, s)
  ready.set(profile, Promise.all(sessionSetups.map((fn) => run(() => fn(s, profile)))))
  wire(s)
}
const ready = new Map<string, Promise<unknown>>()

const flushers: (() => Promise<unknown>)[] = []
/** `fn` writes what a feature keeps, now: the app awaits it before it restarts (`engineFlush`). */
export const onFlush = (fn: () => Promise<unknown>) => { flushers.push(fn) }
/** What the browser keeps, on disk before the app quits (at most `ms`): every session's cookies (Chromium writes them
 *  in batches) and what features keep. */
export function engineFlush(ms = 2000): Promise<void> {
  const all = [...[...made.values()].map((s) => s.cookies.flushStore()), ...flushers.map((fn) => fn())]
  return Promise.race([Promise.all(all.map((p) => p.catch((e) => log.error("the browser couldn't save", e)))).then(() => {}),
    new Promise<void>((done) => setTimeout(done, ms))])
}
/** A profile's session is set up: what features do as it's made (its session cookies set again) is done, so its pages'
 *  first requests have it (web.ts awaits it before a page opens, or reading its cookies). */
export const sessionReady = (profile: string) => ready.get(profile) ?? Promise.resolve()

// ---------- requests: Electron takes one webRequest listener per event and session, so the engine holds them ----------

export type RequestEvent = "onBeforeRequest" | "onBeforeSendHeaders" | "onSendHeaders" | "onHeadersReceived" | "onResponseStarted"
  | "onBeforeRedirect" | "onCompleted" | "onErrorOccurred"
export type RequestDetails = OnBeforeRequestListenerDetails & { requestHeaders?: Record<string, string>; responseHeaders?: Record<string, string[]>
  statusLine?: string; statusCode?: number; redirectURL?: string; error?: string; fromCache?: boolean; ip?: string }
export type RequestAnswer = { cancel?: boolean; redirectURL?: string; requestHeaders?: Record<string, string | string[]>
  responseHeaders?: Record<string, string | string[]>; statusLine?: string }
type ResourceType = NonNullable<Electron.WebRequestFilter["types"]>[number]
type RequestHook = { event: RequestEvent; fn: (d: RequestDetails, s: Session) => RequestAnswer | void | Promise<RequestAnswer | void>; on: (s: Session) => boolean
  types?: ResourceType[]; urls?: string[] }

const EVENTS: RequestEvent[] = ["onBeforeRequest", "onBeforeSendHeaders", "onSendHeaders", "onHeadersReceived", "onResponseStarted", "onBeforeRedirect", "onCompleted", "onErrorOccurred"]
const ANSWERED = new Set<RequestEvent>(["onBeforeRequest", "onBeforeSendHeaders", "onHeadersReceived"])
const hooks: RequestHook[] = []
/** Each session's hooks by event, as `on` said, and the resource types and addresses they want: Electron listens only for
 *  those (each request a listener sees is a round trip through the main process, most of a page's cost here). */
const wired = new WeakMap<Session, Map<RequestEvent, RequestHook[]>>()
const wiredTypes = new WeakMap<Session, Map<RequestEvent, { types: string; urls: string }>>()
const wiredSessions = new Set<Session>()

/** `fn` sees each request's `event` (of `types`, at `urls`, if given; others' hooks may bring it more) in the sessions `on`
 *  picks, after earlier hooks. A cancel or redirect ends the request there; headers it sets are what later hooks see. */
export function onRequest(event: RequestEvent, fn: RequestHook["fn"], on: RequestHook["on"] = () => true, types?: ResourceType[], urls?: string[]) {
  hooks.push({ event, fn, on, types, urls })
  for (const s of wiredSessions) wire(s)
}
/** What a hook's `on` says for `s` changed: Electron's listeners follow, so an event no hook wants costs nothing. */
export const requestsChanged = (s: Session) => wire(s)

function wire(s: Session) {
  const had = wiredTypes.get(s), now = new Map<RequestEvent, RequestHook[]>(), types = new Map<RequestEvent, { types: string; urls: string }>()
  for (const h of hooks) if (h.on(s)) now.set(h.event, [...(now.get(h.event) ?? []), h])
  const union = (list: RequestHook[], k: "types" | "urls") => (list.some((h) => !h[k]) ? "" : [...new Set(list.flatMap((h) => h[k]!))].sort().join(" "))
  for (const [ev, list] of now) types.set(ev, { types: union(list, "types"), urls: union(list, "urls") })
  wired.set(s, now)
  wiredTypes.set(s, types)
  wiredSessions.add(s)
  const wr = s.webRequest as unknown as Record<RequestEvent, (...a: unknown[]) => void>
  for (const ev of EVENTS) {
    const was = had?.get(ev), want = types.get(ev)
    if (was?.types === want?.types && was?.urls === want?.urls) continue
    const filter = { urls: want?.urls ? want.urls.split(" ") : ["<all_urls>"], ...(want?.types ? { types: want.types.split(" ") } : {}) }
    if (!now.has(ev)) wr[ev](null)
    else if (ANSWERED.has(ev)) wr[ev](filter, (d: RequestDetails, done: (r: RequestAnswer) => void) => answer(wired.get(s)?.get(ev) ?? [], d, s, done))
    else wr[ev](filter, (d: RequestDetails) => { for (const h of wired.get(s)?.get(ev) ?? []) if (wants(h, d)) try { void h.fn(d, s) } catch (e) { log.error("a browser feature's request hook failed", e) } })
  }
}
const wants = (h: RequestHook, d: RequestDetails) => !h.types || h.types.includes(d.resourceType as ResourceType)

function answer(all: RequestHook[], d: RequestDetails, s: Session, done: (r: RequestAnswer) => void) {
  const out: RequestAnswer = {}
  const list = all.some((h) => h.types) ? all.filter((h) => wants(h, d)) : all
  let i = 0
  const take = (r: RequestAnswer | void) => {
    if (!r) return false
    if (r.cancel) { done({ cancel: true }); return true }
    if (r.redirectURL) { done({ ...out, redirectURL: r.redirectURL }); return true }
    if (r.requestHeaders) d.requestHeaders = (out.requestHeaders = r.requestHeaders) as Record<string, string>
    if (r.responseHeaders) d.responseHeaders = (out.responseHeaders = r.responseHeaders) as Record<string, string[]>
    if (r.statusLine) d.statusLine = out.statusLine = r.statusLine
    return false
  }
  const next = (): void => {
    while (i < list.length) {
      let r: ReturnType<RequestHook["fn"]>
      try { r = list[i++].fn(d, s) } catch (e) { log.error("a browser feature's request hook failed", e); continue }
      if (r instanceof Promise) {
        r.then((v) => { if (!take(v)) next() }, (e) => { log.error("a browser feature's request hook failed", e); next() })
        return
      }
      if (take(r)) return
    }
    done(out)
  }
  next()
}

export type Credentials = { username: string; password: string }
/** A feature's answer to a sign-in: credentials, "cancel" (the site's 401), or null for the next one to try; undefined,
 *  it isn't asked. */
type LoginHook = (wc: WebContents, details: AuthenticationResponseDetails, info: AuthInfo) => Promise<Credentials | "cancel" | null> | undefined
const loginHooks: { fn: LoginHook; order: number }[] = []
export function onLogin(fn: LoginHook, order: number) {
  loginHooks.push({ fn, order })
  loginHooks.sort((a, b) => a.order - b.order)
}
export async function answerLogin(wc: WebContents, details: AuthenticationResponseDetails, info: AuthInfo): Promise<Credentials | null> {
  for (const h of loginHooks) {
    try {
      const c = await h.fn(wc, details, info)
      if (c === "cancel") return null
      if (c) return c
    } catch (err) { log.error("a browser feature's sign-in failed", err) }
  }
  return null
}
export const webSessionMade = (s: Session) => [...made.values()].includes(s)

const loaders: (() => Promise<unknown>)[] = []
let loading: Promise<unknown> | null = null
/** `load` runs once a page opens or the app asks a name no feature loaded yet answers: what's heavy (extensions, Shields'
 *  lists) costs nothing to whoever never opens a web page. */
export function later(load: () => Promise<unknown>) { loaders.push(load) }
export const engineLoaded = () => (loading ??= Promise.all(loaders.map((load) =>
  load().catch((e) => log.error("a browser feature couldn't load", e)))))

export function pageMade(p: EnginePage) {
  pages.set(p.id, p)
  p.wc.once("destroyed", () => pages.delete(p.id))
  for (const fn of pageSetups) run(() => fn(p))
}

const guards: ((profile: string) => boolean)[] = []
export const guardOpen = (fn: (profile: string) => boolean) => { guards.push(fn) }
export const mayOpen = (profile: string) => guards.every((g) => g(profile))
const shy: ((profile: string) => boolean)[] = []
/** A page in `profile` is kept as a picture on disk only if every guard lets it. */
export const guardPictures = (fn: (profile: string) => boolean) => { shy.push(fn) }
export const mayPicture = (profile: string) => shy.every((g) => g(profile))

const openers: ((url: string) => boolean)[] = []
/** Addresses besides the web's that a page may show (an extension's own pages): `fn` says which. */
export function opens(fn: (url: string) => boolean) { openers.push(fn) }
export const engineOpens = (url: string) => openers.some((fn) => { try { return fn(url) } catch { return false } })

export const allPages = () => [...pages.values()]

const canvases: ((id: number) => string | null)[] = []
/** `fn` says the colour under page `id` once it painted, what shows where the page paints nothing (null: no say). */
export const canvasFrom = (fn: (id: number) => string | null) => { canvases.push(fn) }
export const canvasOf = (id: number) => {
  for (const fn of canvases) { const c = fn(id); if (c) return c }
  return "#ffffff"
}
let recanvas: (id: number) => void = () => {}
export const setCanvasHandler = (fn: (id: number) => void) => { recanvas = fn }
export const canvasChanged = (id: number) => recanvas(id)

let agentActing: (id: number) => boolean = () => false
/** Whether what page `id` opens now is an agent's doing (its own page, or one it's acting in), so it opens as that
 *  agent's page in the background, never the user's tab: agent.ts says. */
export const setAgentActing = (fn: (id: number) => boolean) => { agentActing = fn }
export const openedByAgent = (id: number) => agentActing(id)
let agentOwned: (id: number) => boolean = () => false
export const setAgentOwned = (fn: (id: number) => boolean) => { agentOwned = fn }
export const ownedByAgent = (id: number) => agentOwned(id)

type Opener = (win: EngineWindow, url: string, profile: string) => Promise<EnginePage>
let opener: Opener = () => Promise.reject(new Error("no pages here"))
export const setOpener = (fn: Opener) => { opener = fn }
export const openInBackground: Opener = (...a) => opener(...a)

type Handler = (win: EngineWindow, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
/** What the app may ask a feature (`webPages.engine(name, ...args)` in the window, through `web:engine`). */
export function handle(name: string, fn: Handler) { handlers.set(name, fn) }
export async function engineCall(win: EngineWindow, name: unknown, args: unknown[]) {
  if (typeof name === "string" && !handlers.has(name)) await engineLoaded()
  const fn = typeof name === "string" ? handlers.get(name) : undefined
  if (!fn) throw new Error(`no browser feature answers ${String(name)}`)
  return fn(win, ...args)
}
/** What the vault's server may ask: agents' calls (`agent:`) and other Macs' (`remote:`, who's signed in, a sealed login
 *  in), never the app's own (unlocking a container, its access, clearing logins) nor a cookie out. */
export function serverCall(win: EngineWindow | undefined, name: unknown, args: unknown[]) {
  if (typeof name !== "string" || !/^(agent|remote):/.test(name)) throw new Error(`the server can't ask ${String(name)}`)
  if (!win || win.isDestroyed()) throw new Error("the vault's window isn't open")
  return engineCall(win, name, args)
}

const keeps: ((id: number) => boolean)[] = []
/** `fn` says page `id` mustn't be discarded under memory pressure (an agent's: its tab number and ask would go). */
export const keepPage = (fn: (id: number) => boolean) => { keeps.push(fn) }
export const pageKept = (id: number) => keeps.some((fn) => fn(id))
const holders: ((id: number) => boolean)[] = []
/** `fn` says an agent holds page `id` now: its tab shows a picture of it, never the page (nothing the user does lands
 *  mid-act), its size is the agent's, not the tab's, and no site zoom applies. */
export const holdPage = (fn: (id: number) => boolean) => { holders.push(fn) }
export const pageHeld = (id: number) => holders.some((fn) => fn(id))

const holds: { fn: (of: "app" | "server") => string | null; appOnly: boolean }[] = []
/** `fn` says why the browser is busy now (null: it isn't): an automatic update waits till none says so. `appOnly`:
 *  what only the app's restart loses (a pending ask), not its server's (the app attaches again). */
export const busyWhen = (fn: (of: "app" | "server") => string | null, appOnly = false) => { holds.push({ fn, appOnly }) }
export function engineBusy(of: "app" | "server" = "app"): string | null {
  for (const h of holds) {
    if (of === "server" && h.appOnly) continue
    try { const why = h.fn(of); if (why) return why } catch (e) { log.error("a browser feature couldn't say if it's busy", e) }
  }
  return null
}

/** Tell a window something: the Browser hears it as a `WebEvent` whose `type` starts "engine:". */
export const tell = (win: EngineWindow, msg: EngineEvent) => { if (!win.isDestroyed()) win.webContents.send("vaultite:web", msg) }
type EngineEvent = { type: `engine:${string}` } & Record<string, unknown>
export const tellAll = (msg: EngineEvent) => { for (const w of appWindows()) tell(w, msg) }

type ServerSink = (win: EngineWindow, name: string, data: unknown) => void
let sink: ServerSink = () => {}
export const setServerSink = (fn: ServerSink) => { sink = fn }
export const tellServer = (win: EngineWindow, name: string, data: unknown) => { if (!win.isDestroyed()) sink(win, name, data) }

const attached = new WeakSet<WebContents>()
export async function cdp<T = Record<string, unknown>>(wc: WebContents, method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!attached.has(wc)) {
    try { wc.debugger.attach("1.3") } catch (e) {
      if (!wc.debugger.isAttached()) throw new Error(`couldn't attach to the page (${messageOf(e)}): is its DevTools open?`)
    }
    attached.add(wc)
    wc.debugger.on("detach", () => attached.delete(wc))
  }
  return (await wc.debugger.sendCommand(method, params)) as T
}
