// chrome.webRequest for extensions: Electron gives them no events beside a session's own listeners (the engine's), so
// its request hooks relay them to what extensions.preload.cjs adds; onAuthRequired comes from Electron's `login`.
import { app, type Session, type WebFrameMain } from "electron"
import { allPages, onRequest, requestsChanged, type RequestAnswer, type RequestDetails, type RequestEvent } from "./engine.ts"
import { addCalls, onUnlisten, permsOf, workerOf, type Ctx } from "./extapi.ts"
import { dirOf, manifestOf } from "./extstore.ts"

type Event = RequestEvent | "onAuthRequired"
const EVENTS: Event[] = ["onBeforeRequest", "onBeforeSendHeaders", "onSendHeaders", "onHeadersReceived", "onAuthRequired", "onResponseStarted",
  "onBeforeRedirect", "onCompleted", "onErrorOccurred"]
const BLOCKABLE = new Set<Event>(["onBeforeRequest", "onBeforeSendHeaders", "onHeadersReceived", "onAuthRequired"])
const TYPES: Record<string, string> = { mainFrame: "main_frame", subFrame: "sub_frame", xhr: "xmlhttprequest", cspReport: "csp_report", webSocket: "websocket" }

type Listener = { ext: string; lid: string; event: Event; urls: Match[]; types: Set<string> | null; tabId?: number; windowId?: number
  spec: Set<string>; blocking: boolean; hosts: Match[]; to: { frame: WebFrameMain } | { scope: string } }
type Match = (u: URL) => boolean

// ---------- who listens ----------

const listeners = new WeakMap<Session, Map<string, Listener>>()
/** Each session's listeners by event, rebuilt as they change: what every request looks through. */
const byEvent = new WeakMap<Session, Map<Event, Listener[]>>()
const of = (s: Session, ev: Event) => byEvent.get(s)?.get(ev) ?? []

function changed(s: Session) {
  const m = new Map<Event, Listener[]>()
  for (const l of listeners.get(s)?.values() ?? []) m.set(l.event, [...(m.get(l.event) ?? []), l])
  byEvent.set(s, m)
  requestsChanged(s)
}
function drop(s: Session, which: (l: Listener) => boolean) {
  const all = listeners.get(s)
  let any = false
  for (const [k, l] of all ?? []) if (which(l)) { all!.delete(k); any = true }
  if (any) changed(s)
}

/** Chrome's match patterns: `*` as a scheme is the web's (http, https, ws, wss); ports aren't matched. */
function pattern(p: string): Match {
  if (p === "<all_urls>") return (u) => /^(https?|wss?|ftp|file):$/.test(u.protocol)
  const m = /^(\*|https?|wss?|ftp|file):\/\/(\*|\*\.[^/]+|[^/*]*)(\/.*)$/.exec(p)
  if (!m) return () => false
  const [, scheme, host, path] = m
  const re = new RegExp(`^${path.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`)
  return (u) => {
    const sc = u.protocol.slice(0, -1)
    if (scheme === "*" ? !/^(https?|wss?)$/.test(sc) : scheme !== sc) return false
    if (host !== "*" && !(host.startsWith("*.") ? u.hostname === host.slice(2) || u.hostname.endsWith(host.slice(1)) : u.hostname === host)) return false
    return re.test(u.pathname + u.search)
  }
}

for (const ev of EVENTS) if (ev !== "onAuthRequired") {
  // (a 401's headers say which request the `login` after them is for)
  onRequest(ev, (d, s) => relay(ev, d, s), (s) => of(s, ev).length > 0 || (ev === "onHeadersReceived" && of(s, "onAuthRequired").length > 0))
}
onUnlisten((s, ext) => {
  drop(s, (l) => l.ext === ext)
  for (const p of [...pending.values()]) if (p.s === s && p.ext === ext) p.done(null)
})

// ---------- a request, told ----------

type Source = { tabId: number; windowId: number }
/** The tab a request is from; null for what extensions never see: the app's own requests (no initiator, no page), and
 *  extensions' (theirs is the initiator: a tab's address is still the last page's while it navigates). */
function sourceOf(d: RequestDetails): Source | null {
  if (d.initiatorOrigin?.startsWith("chrome-extension:")) return null
  if (!d.webContentsId) return d.initiatorOrigin ? { tabId: -1, windowId: -1 } : null
  const page = allPages().find((p) => p.wc.id === d.webContentsId)
  return page ? { tabId: page.wc.id, windowId: page.win.id } : { tabId: -1, windowId: -1 }
}

const listOf = (h?: Record<string, string | string[]>) =>
  Object.entries(h ?? {}).flatMap(([name, v]) => (Array.isArray(v) ? v : [v]).map((value) => ({ name, value: String(value) })))

/** Chrome's details for `ev` (each listener's own extras added by `forListener`). */
function detailsOf(ev: Event, d: RequestDetails, src: Source) {
  let frameId = 0, parentFrameId = -1
  try {
    const f = d.resourceType === "mainFrame" ? null : d.frame
    if (f?.parent) { frameId = f.frameTreeNodeId; parentFrameId = f.parent.parent ? f.parent.frameTreeNodeId : 0 }
  } catch { /* the frame went */ }
  const x: Record<string, unknown> = {
    requestId: String(d.id), url: d.url, method: d.method, frameId, parentFrameId, tabId: src.tabId, type: TYPES[d.resourceType] ?? d.resourceType,
    timeStamp: d.timestamp, frameType: frameId === 0 ? "outermost_frame" : "sub_frame", documentLifecycle: "active",
  }
  if (d.initiatorOrigin && d.initiatorOrigin !== "null") x.initiator = d.initiatorOrigin
  if (d.statusCode !== undefined && ev !== "onErrorOccurred") { x.statusCode = d.statusCode; x.statusLine = d.statusLine ?? "" }
  if (ev === "onResponseStarted" || ev === "onCompleted" || ev === "onBeforeRedirect" || ev === "onErrorOccurred") {
    x.fromCache = !!d.fromCache
    if (d.ip) x.ip = d.ip
  }
  if (ev === "onBeforeRedirect") x.redirectUrl = d.redirectURL
  if (ev === "onErrorOccurred") x.error = d.error
  return x
}
function forListener(ev: Event, base: Record<string, unknown>, d: RequestDetails, l: Listener) {
  const x = { ...base }
  if (l.spec.has("requestHeaders") && (ev === "onBeforeSendHeaders" || ev === "onSendHeaders")) x.requestHeaders = listOf(d.requestHeaders)
  if (l.spec.has("responseHeaders") && d.responseHeaders && ev !== "onBeforeRequest" && ev !== "onErrorOccurred") x.responseHeaders = listOf(d.responseHeaders)
  if (l.spec.has("requestBody") && ev === "onBeforeRequest" && d.uploadData?.length) {
    x.requestBody = { raw: d.uploadData.map((u) => (u.bytes ? { bytes: u.bytes } : u.file ? { file: u.file } : {})) }
  }
  return x
}

const wants = (l: Listener, u: URL, type: string, src: Source) =>
  (!l.types || l.types.has(type)) && (l.tabId === undefined || l.tabId === src.tabId) && (l.windowId === undefined || l.windowId === src.windowId)
  && l.urls.some((m) => m(u)) && l.hosts.some((m) => m(u))

type Reply = { cancel?: boolean; redirectUrl?: string; requestHeaders?: { name: string; value?: string }[]
  responseHeaders?: { name: string; value?: string }[]; authCredentials?: { username: string; password: string } } | null

/** Tells the extensions listening for `ev`: an answer only when a blocking listener gives one. */
function relay(ev: Event, d: RequestDetails, s: Session, extra?: Record<string, unknown>): Promise<Answer | void> | void {
  if (ev === "onHeadersReceived" && (d.statusCode === 401 || d.statusCode === 407) && d.webContentsId) challenged(d)
  const list = of(s, ev)
  if (!list.length) return
  const src = sourceOf(d)
  let u: URL
  try { u = new URL(d.url) } catch { return }
  if (!src) return
  const type = TYPES[d.resourceType] ?? d.resourceType
  let base: Record<string, unknown> | null = null
  const asked: Promise<Reply>[] = []
  for (const l of list) {
    if (!wants(l, u, type, src)) continue
    base ??= { ...detailsOf(ev, d, src), ...extra }
    const x = forListener(ev, base, d, l)
    if (l.blocking) asked.push(ask(s, l, x))
    else send(s, l, [l.lid, x])
  }
  if (asked.length) return Promise.all(asked).then((rs) => answerOf(ev, rs, d))
}

type Answer = RequestAnswer & { authCredentials?: { username: string; password: string } }
/** Chrome's way with several: a cancel wins, else the last redirect (or headers, or credentials) given. */
function answerOf(ev: Event, rs: Reply[], d: RequestDetails): Answer | void {
  if (rs.some((r) => r?.cancel === true)) return { cancel: true }
  const last = <K extends keyof NonNullable<Reply>>(k: K) => rs.map((r) => r?.[k]).filter((v) => v !== undefined).pop() as NonNullable<Reply>[K] | undefined
  if (ev === "onAuthRequired") {
    const a = last("authCredentials")
    return a && typeof a === "object" ? { authCredentials: { username: String(a.username ?? ""), password: String(a.password ?? "") } } : undefined
  }
  const to = last("redirectUrl")
  const redirect = typeof to === "string" && /^(https?|data|chrome-extension|about):/i.test(to) ? to : ""
  if (ev === "onBeforeRequest") return redirect ? { redirectURL: redirect } : undefined
  if (ev === "onBeforeSendHeaders") {
    const h = last("requestHeaders")
    return Array.isArray(h) ? { requestHeaders: Object.fromEntries(h.map((x) => [String(x.name), String(x.value ?? "")])) } : undefined
  }
  if (ev === "onHeadersReceived") {
    const h = last("responseHeaders")
    const headers: Record<string, string[]> = {}
    for (const x of Array.isArray(h) ? h : redirect ? listOf(d.responseHeaders) : []) {
      const k = Object.keys(headers).find((n) => n.toLowerCase() === String(x.name).toLowerCase()) ?? String(x.name)
      ;(headers[k] ??= []).push(String(x.value ?? ""))
    }
    // (Electron can't redirect a response: it becomes one that redirects)
    if (redirect) {
      for (const k of Object.keys(headers)) if (k.toLowerCase() === "location") delete headers[k]
      return { statusLine: "HTTP/1.1 302 Found", responseHeaders: { ...headers, Location: [redirect] } }
    }
    return Array.isArray(h) ? { responseHeaders: headers } : undefined
  }
}

// ---------- to the extension and back ----------

const pending = new Map<string, { s: Session; ext: string; done: (r: Reply) => void }>()
let seq = 0

function send(s: Session, l: Listener, args: unknown[], failed?: () => void) {
  if ("frame" in l.to) {
    const f = l.to.frame
    try {
      if (f.isDestroyed() || f.detached) throw new Error("gone")
      f.send("vaultite:ext:event", "vaultite.webRequest", args)
    } catch {
      // (its page went: its listeners go with it)
      drop(s, (x) => "frame" in x.to && x.to.frame === f)
      failed?.()
    }
    return
  }
  void workerOf(s, l.to.scope).then((w) => { if (w) w.send("vaultite:ext:event", "vaultite.webRequest", args); else failed?.() })
}

/** A blocking listener's answer; none (as if it gave nothing) if it never comes. */
function ask(s: Session, l: Listener, x: Record<string, unknown>) {
  return new Promise<Reply>((done) => {
    const rid = `${++seq}`
    // (a password manager may wait on its app asking the user)
    const t = setTimeout(() => finish(null), l.event === "onAuthRequired" ? 5 * 60_000 : 30_000)
    const finish = (r: Reply) => { clearTimeout(t); if (pending.delete(rid)) done(r) }
    pending.set(rid, { s, ext: l.ext, done: finish })
    send(s, l, [l.lid, x, rid], () => finish(null))
  })
}

const allowedBlocking = (m: ReturnType<typeof manifestOf>, ev: Event) => {
  const perms = m.permissions ?? []
  return ((m.manifest_version ?? 2) < 3 && perms.includes("webRequestBlocking")) || (ev === "onAuthRequired" && perms.includes("webRequestAuthProvider"))
}

addCalls({
  "webRequest.addListener": (c: Ctx, event: unknown, lid: unknown, filter: { urls?: unknown; types?: unknown; tabId?: unknown; windowId?: unknown } = {}, spec: unknown) => {
    const ev = EVENTS.find((e) => e === event)
    const m = manifestOf(dirOf(c.ext))
    if (!ev || typeof lid !== "string" || !(m.permissions ?? []).includes("webRequest")) throw new Error("webRequest isn't allowed")
    const specs = new Set(Array.isArray(spec) ? spec.map(String) : [])
    const blocking = specs.has("blocking") || specs.has("asyncBlocking")
    if (blocking && !allowedBlocking(m, ev)) throw new Error("You do not have permission to use blocking webRequest listeners.")
    const to = c.frame ? { frame: c.frame } : c.scope ? { scope: c.scope } : null
    if (!to) throw new Error("webRequest isn't allowed here")
    const urls = Array.isArray(filter.urls) ? filter.urls.map(String) : []
    let all = listeners.get(c.s)
    if (!all) listeners.set(c.s, (all = new Map()))
    all.set(`${c.ext.id} ${lid}`, {
      ext: c.ext.id, lid, event: ev, urls: urls.map(pattern), types: Array.isArray(filter.types) ? new Set(filter.types.map(String)) : null,
      tabId: typeof filter.tabId === "number" ? filter.tabId : undefined, windowId: typeof filter.windowId === "number" ? filter.windowId : undefined,
      spec: specs, blocking: blocking && BLOCKABLE.has(ev), hosts: permsOf(c.ext).origins.map(pattern), to,
    })
    changed(c.s)
  },
  "webRequest.removeListener": (c: Ctx, lid: unknown) => { if (listeners.get(c.s)?.delete(`${c.ext.id} ${String(lid)}`)) changed(c.s) },
  "webRequest.reply": (c: Ctx, rid: unknown, r: unknown) => {
    const p = pending.get(String(rid))
    if (p && p.ext === c.ext.id) p.done(r && typeof r === "object" ? (r as Reply) : null)
  },
})

// ---------- onAuthRequired, from Electron's `login` ----------

/** The latest 401 and 407 responses, by page and address: Electron's `login` doesn't say its request's id. */
const challenges = new Map<string, RequestDetails>()
function challenged(d: RequestDetails) {
  const k = `${d.webContentsId} ${d.url}`
  challenges.delete(k)
  challenges.set(k, d)
  if (challenges.size > 50) challenges.delete(challenges.keys().next().value!)
}

app.on("login", (e, wc, det, info, callback) => {
  const s = wc?.session
  if (!s || !of(s, "onAuthRequired").length) return
  const k = `${wc.id} ${det.url}`
  const d: RequestDetails = challenges.get(k) ?? {
    id: -++seq, url: det.url, method: "GET", webContentsId: wc.id, resourceType: det.isRequestForNavigation ? "mainFrame" : "other", referrer: "",
    timestamp: Date.now(), uploadData: [], statusCode: info.isProxy ? 407 : 401, statusLine: info.isProxy ? "HTTP/1.1 407 Proxy Authentication Required" : "HTTP/1.1 401 Unauthorized",
    responseHeaders: Object.fromEntries(Object.entries(det.responseHeaders ?? {}).map(([n, v]) => [n, ([] as string[]).concat(v)])),
  }
  const r = relay("onAuthRequired", d, s, { scheme: info.scheme, realm: info.realm || undefined, challenger: { host: info.host, port: info.port }, isProxy: info.isProxy })
  if (!r) return
  // (the app has no prompt of its own: without credentials the page shows the site's 401, as without extensions)
  e.preventDefault()
  void r.then((a) => { if (a?.authCredentials) callback(a.authCredentials.username, a.authCredentials.password); else callback() })
})
