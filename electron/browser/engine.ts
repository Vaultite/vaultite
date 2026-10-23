// The browser engine's hooks: each feature (blocking, extensions, history...) adds itself here for every web session
// and page as they're made, so web.ts makes them once and doesn't know the features.
import type { OnBeforeRequestListenerDetails, Session, WebContents } from "electron"
import type { AppWindow } from "../appwindow.ts"

type SessionSetup = (s: Session, profile: string) => void | Promise<void>
/** A page as features see it: its contents, its logins (profile) and the window it's in. */
export type EnginePage = { id: number; wc: WebContents; profile: string; win: AppWindow
  /** The address it was opened at. */
  url: string
  /** Take it off the screen (its tab shows it again when it asks to). */
  hide: () => void
  /** It's on screen now, in a tab or its player. */
  visible: () => boolean
  /** Into a window of its own to watch it in (`fullScreen`: on a Space of its own), or back in its tab. */
  player: (on: boolean, fullScreen: boolean) => void
  /** The app's tab it's for ("": none). */
  tab: () => string }
type PageSetup = (p: EnginePage) => void

const sessionSetups: SessionSetup[] = []
const pageSetups: PageSetup[] = []
const made = new Map<string, Session>()
const pages = new Map<number, EnginePage>()

const run = (fn: () => void | Promise<void>) => {
  try { void Promise.resolve(fn()).catch((e) => console.error("vaultite: a browser feature's setup failed:", e)) }
  catch (e) { console.error("vaultite: a browser feature's setup failed:", e) }
}

/** `fn` runs for each web session, the ones made already included. */
export function eachSession(fn: SessionSetup) {
  sessionSetups.push(fn)
  for (const [profile, s] of made) run(() => fn(s, profile))
}
/** `fn` runs for each page as it's made, the open ones included. */
export function eachPage(fn: PageSetup) {
  pageSetups.push(fn)
  for (const p of pages.values()) run(() => fn(p))
}

/** A web session was made (web.ts webSession): every feature sets it up. */
export function sessionMade(s: Session, profile: string) {
  made.set(profile, s)
  for (const fn of sessionSetups) run(() => fn(s, profile))
  wire(s)
}

// ---------- requests: Electron takes one webRequest listener per event and session, so the engine holds them ----------

export type RequestEvent = "onBeforeRequest" | "onBeforeSendHeaders" | "onSendHeaders" | "onHeadersReceived" | "onResponseStarted"
  | "onBeforeRedirect" | "onCompleted" | "onErrorOccurred"
/** A request as Electron tells it, for any event (each event's own fields are there only for it). */
export type RequestDetails = OnBeforeRequestListenerDetails & { requestHeaders?: Record<string, string>; responseHeaders?: Record<string, string[]>
  statusLine?: string; statusCode?: number; redirectURL?: string; error?: string; fromCache?: boolean; ip?: string }
export type RequestAnswer = { cancel?: boolean; redirectURL?: string; requestHeaders?: Record<string, string | string[]>
  responseHeaders?: Record<string, string | string[]>; statusLine?: string }
type ResourceType = NonNullable<Electron.WebRequestFilter["types"]>[number]
type RequestHook = { event: RequestEvent; fn: (d: RequestDetails, s: Session) => RequestAnswer | void | Promise<RequestAnswer | void>; on: (s: Session) => boolean
  types?: ResourceType[] }

const EVENTS: RequestEvent[] = ["onBeforeRequest", "onBeforeSendHeaders", "onSendHeaders", "onHeadersReceived", "onResponseStarted", "onBeforeRedirect", "onCompleted", "onErrorOccurred"]
const ANSWERED = new Set<RequestEvent>(["onBeforeRequest", "onBeforeSendHeaders", "onHeadersReceived"])
const hooks: RequestHook[] = []
/** Each session's hooks by event, as `on` said, and the resource types they want ("": all): Electron listens only for
 *  those (each request a listener sees is a round trip through the main process, most of a page's cost here). */
const wired = new WeakMap<Session, Map<RequestEvent, RequestHook[]>>()
const wiredTypes = new WeakMap<Session, Map<RequestEvent, string>>()
const wiredSessions = new Set<Session>()

/** `fn` sees each request's `event` (of `types`, if given) in the sessions `on` picks, after earlier hooks. An answer that
 *  cancels or redirects is the request's, later hooks don't see it; headers it sets are what later hooks see. */
export function onRequest(event: RequestEvent, fn: RequestHook["fn"], on: RequestHook["on"] = () => true, types?: ResourceType[]) {
  hooks.push({ event, fn, on, types })
  for (const s of wiredSessions) wire(s)
}
/** What a hook's `on` says for `s` changed: Electron's listeners follow, so an event no hook wants costs nothing. */
export const requestsChanged = (s: Session) => wire(s)

function wire(s: Session) {
  const had = wiredTypes.get(s), now = new Map<RequestEvent, RequestHook[]>(), types = new Map<RequestEvent, string>()
  for (const h of hooks) if (h.on(s)) now.set(h.event, [...(now.get(h.event) ?? []), h])
  for (const [ev, list] of now) types.set(ev, list.some((h) => !h.types) ? "" : [...new Set(list.flatMap((h) => h.types!))].sort().join(" "))
  wired.set(s, now)
  wiredTypes.set(s, types)
  wiredSessions.add(s)
  const wr = s.webRequest as unknown as Record<RequestEvent, (...a: unknown[]) => void>
  for (const ev of EVENTS) {
    if (had?.get(ev) === types.get(ev)) continue
    const filter = { urls: ["<all_urls>"], ...(types.get(ev) ? { types: types.get(ev)!.split(" ") } : {}) }
    if (!now.has(ev)) wr[ev](null)
    else if (ANSWERED.has(ev)) wr[ev](filter, (d: RequestDetails, done: (r: RequestAnswer) => void) => answer(wired.get(s)?.get(ev) ?? [], d, s, done))
    else wr[ev](filter, (d: RequestDetails) => { for (const h of wired.get(s)?.get(ev) ?? []) if (wants(h, d)) try { void h.fn(d, s) } catch (e) { console.error("vaultite: a browser feature's request hook failed:", e) } })
  }
}
/** Whether a hook wants this request: its types (another hook's may have brought it here). */
const wants = (h: RequestHook, d: RequestDetails) => !h.types || h.types.includes(d.resourceType as ResourceType)

/** The hooks in turn, synchronously while they answer synchronously (Shields does, for every request). */
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
      try { r = list[i++].fn(d, s) } catch (e) { console.error("vaultite: a browser feature's request hook failed:", e); continue }
      if (r instanceof Promise) {
        r.then((v) => { if (!take(v)) next() }, (e) => { console.error("vaultite: a browser feature's request hook failed:", e); next() })
        return
      }
      if (take(r)) return
    }
    done(out)
  }
  next()
}
// ---------- what loads only once the browser is used ----------

const loaders: (() => Promise<unknown>)[] = []
let loading: Promise<unknown> | null = null
/** `load` runs once a page opens or the app asks a name no feature loaded yet answers: what's heavy (extensions, Shields'
 *  lists) costs nothing to whoever never opens a web page. */
export function later(load: () => Promise<unknown>) { loaders.push(load) }
/** The features loaded later, all in (web.ts awaits it before a page's first request). */
export const engineLoaded = () => (loading ??= Promise.all(loaders.map((load) =>
  load().catch((e) => console.error("vaultite: a browser feature couldn't load:", e)))))

/** A page was made (web.ts make): every feature sees it; it leaves the list as its contents go. */
export function pageMade(p: EnginePage) {
  pages.set(p.id, p)
  p.wc.once("destroyed", () => pages.delete(p.id))
  for (const fn of pageSetups) run(() => fn(p))
}

const guards: ((profile: string) => boolean)[] = []
/** A page in `profile` opens only if every guard lets it (a locked container's don't). */
export const guardOpen = (fn: (profile: string) => boolean) => { guards.push(fn) }
export const mayOpen = (profile: string) => guards.every((g) => g(profile))

const openers: ((url: string) => boolean)[] = []
/** Addresses besides the web's that a page may show (an extension's own pages): `fn` says which. */
export function opens(fn: (url: string) => boolean) { openers.push(fn) }
export const engineOpens = (url: string) => openers.some((fn) => { try { return fn(url) } catch { return false } })

/** Every web session made so far, by profile. */
export const allSessions = () => made
/** Every open page. */
export const allPages = () => [...pages.values()]

// ---------- talking with the app ----------

type Handler = (win: AppWindow, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
/** What the app may ask a feature (`webPages.engine(name, ...args)` in the window, through `web:engine`). */
export function handle(name: string, fn: Handler) { handlers.set(name, fn) }
export async function engineCall(win: AppWindow, name: unknown, args: unknown[]) {
  if (typeof name === "string" && !handlers.has(name)) await engineLoaded()
  const fn = typeof name === "string" ? handlers.get(name) : undefined
  if (!fn) throw new Error(`no browser feature answers ${String(name)}`)
  return fn(win, ...args)
}
/** What the vault's server may ask (its agents' calls, core/desktopapp.ts): only the `agent:` names, never the app's own
 *  (unlocking a container, its access, clearing logins). */
export function serverCall(win: AppWindow | undefined, name: unknown, args: unknown[]) {
  if (typeof name !== "string" || !name.startsWith("agent:")) throw new Error(`the server can't ask ${String(name)}`)
  if (!win || win.isDestroyed()) throw new Error("the vault's window isn't open")
  return engineCall(win, name, args)
}

// ---------- busy: what a restart (an update) would cut short ----------

const keeps: ((id: number) => boolean)[] = []
/** `fn` says page `id` mustn't be discarded under memory pressure (an agent's: its tab number and ask would go). */
export const keepPage = (fn: (id: number) => boolean) => { keeps.push(fn) }
export const pageKept = (id: number) => keeps.some((fn) => fn(id))

const holds: { fn: () => string | null; appOnly: boolean }[] = []
/** `fn` says why the browser is busy now (null: it isn't): an automatic update waits till none says so. `appOnly`:
 *  what only the app's restart loses (a pending ask), not its server's (the app attaches again). */
export const busyWhen = (fn: () => string | null, appOnly = false) => { holds.push({ fn, appOnly }) }
/** Why the browser is busy, or null when a restart (of the app, or of its server) loses nothing. */
export function engineBusy(of: "app" | "server" = "app"): string | null {
  for (const h of holds) {
    if (of === "server" && h.appOnly) continue
    try { const why = h.fn(); if (why) return why } catch (e) { console.error("vaultite: a browser feature couldn't say if it's busy:", e) }
  }
  return null
}

/** Tell a window something: the Browser hears it as a `WebEvent` whose `type` starts "engine:". */
export const tell = (win: AppWindow, msg: { type: `engine:${string}` } & Record<string, unknown>) => { if (!win.isDestroyed()) win.webContents.send("vaultite:web", msg) }

type ServerSink = (win: AppWindow, name: string, data: unknown) => void
let sink: ServerSink = () => {}
/** How to reach a window's vault server: main.ts hands it (core/desktopapp.ts onDesktopEvent hears it there). */
export const setServerSink = (fn: ServerSink) => { sink = fn }
/** Tell the server of `win`'s vault something unasked (the live view's frames). */
export const tellServer = (win: AppWindow, name: string, data: unknown) => { if (!win.isDestroyed()) sink(win, name, data) }

// ---------- the DevTools protocol, one session per page (agents' input and snapshots, the window's passed pointer) ----------

const attached = new WeakSet<WebContents>()
export async function cdp<T = Record<string, unknown>>(wc: WebContents, method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!attached.has(wc)) {
    try { wc.debugger.attach("1.3") } catch (e) {
      if (!wc.debugger.isAttached()) throw new Error(`couldn't attach to the page (${(e as Error).message}): is its DevTools open?`)
    }
    attached.add(wc)
    wc.debugger.on("detach", () => attached.delete(wc))
  }
  return (await wc.debugger.sendCommand(method, params)) as T
}
