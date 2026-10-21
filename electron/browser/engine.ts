// The browser engine's hooks: each feature (blocking, extensions, history...) adds itself here for every web session
// and page as they're made, so web.ts makes them once and doesn't know the features.
import type { BrowserWindow, OnBeforeRequestListenerDetails, Session, WebContents } from "electron"

type SessionSetup = (s: Session, profile: string) => void | Promise<void>
/** A page as features see it: its contents, its logins (profile) and the window it's in. */
export type EnginePage = { id: number; wc: WebContents; profile: string; win: BrowserWindow
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
type RequestHook = { event: RequestEvent; fn: (d: RequestDetails, s: Session) => RequestAnswer | void | Promise<RequestAnswer | void>; on: (s: Session) => boolean }

const EVENTS: RequestEvent[] = ["onBeforeRequest", "onBeforeSendHeaders", "onSendHeaders", "onHeadersReceived", "onResponseStarted", "onBeforeRedirect", "onCompleted", "onErrorOccurred"]
const ANSWERED = new Set<RequestEvent>(["onBeforeRequest", "onBeforeSendHeaders", "onHeadersReceived"])
const hooks: RequestHook[] = []
/** Each session's hooks by event, as `on` said when last asked: Electron listens only for the events in it. */
const wired = new WeakMap<Session, Map<RequestEvent, RequestHook[]>>()
const wiredSessions = new Set<Session>()

/** `fn` sees each request's `event` in the sessions `on` picks (all, unset), after the hooks added before it. An answer that
 *  cancels or redirects is the request's, and later hooks don't see it; headers it sets are what later hooks see. */
export function onRequest(event: RequestEvent, fn: RequestHook["fn"], on: RequestHook["on"] = () => true) {
  hooks.push({ event, fn, on })
  for (const s of wiredSessions) wire(s)
}
/** What a hook's `on` says for `s` changed: Electron's listeners follow, so an event no hook wants costs nothing. */
export const requestsChanged = (s: Session) => wire(s)

function wire(s: Session) {
  const had = wired.get(s), now = new Map<RequestEvent, RequestHook[]>()
  for (const h of hooks) if (h.on(s)) now.set(h.event, [...(now.get(h.event) ?? []), h])
  wired.set(s, now)
  wiredSessions.add(s)
  const wr = s.webRequest as unknown as Record<RequestEvent, (...a: unknown[]) => void>
  for (const ev of EVENTS) {
    if (!!had?.has(ev) === now.has(ev)) continue
    if (!now.has(ev)) wr[ev](null)
    else if (ANSWERED.has(ev)) wr[ev]({ urls: ["<all_urls>"] }, (d: RequestDetails, done: (r: RequestAnswer) => void) => answer(wired.get(s)?.get(ev) ?? [], d, s, done))
    else wr[ev]({ urls: ["<all_urls>"] }, (d: RequestDetails) => { for (const h of wired.get(s)?.get(ev) ?? []) try { void h.fn(d, s) } catch (e) { console.error("vaultite: a browser feature's request hook failed:", e) } })
  }
}

/** The hooks in turn, synchronously while they answer synchronously (Shields does, for every request). */
function answer(list: RequestHook[], d: RequestDetails, s: Session, done: (r: RequestAnswer) => void) {
  const out: RequestAnswer = {}
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

type Handler = (win: BrowserWindow, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
/** What the app may ask a feature (`webPages.engine(name, ...args)` in the window, through `web:engine`). */
export function handle(name: string, fn: Handler) { handlers.set(name, fn) }
export async function engineCall(win: BrowserWindow, name: unknown, args: unknown[]) {
  if (typeof name === "string" && !handlers.has(name)) await engineLoaded()
  const fn = typeof name === "string" ? handlers.get(name) : undefined
  if (!fn) throw new Error(`no browser feature answers ${String(name)}`)
  return fn(win, ...args)
}
/** What the vault's server may ask (its agents' calls, core/desktopapp.ts): only the `agent:` names, never the app's own
 *  (unlocking a container, its access, clearing logins). */
export function serverCall(win: BrowserWindow | undefined, name: unknown, args: unknown[]) {
  if (typeof name !== "string" || !name.startsWith("agent:")) throw new Error(`the server can't ask ${String(name)}`)
  if (!win || win.isDestroyed()) throw new Error("the vault's window isn't open")
  return engineCall(win, name, args)
}

/** Tell a window something: the Browser hears it as a `WebEvent` whose `type` starts "engine:". */
export const tell = (win: BrowserWindow, msg: { type: `engine:${string}` } & Record<string, unknown>) => { if (!win.isDestroyed()) win.webContents.send("vaultite:web", msg) }
