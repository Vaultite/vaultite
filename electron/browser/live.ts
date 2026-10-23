// A page watched and driven by its owner from the app's web client (a phone, another Mac: plugins/core/web-viewer's
// live routes, owner only, never ops): its frames pushed to the server while someone watches, their input made real.
import type { NativeImage } from "electron"
import { agentState, helped, press, setPaused } from "./agent.ts"
import { allPages, busyWhen, cdp, eachPage, handle, mayOpen, tellServer, type EnginePage } from "./engine.ts"

/** At most this many frames a second reach the server, at most this big (device pixels). */
const FPS = 8
const MAX_W = 1280, MAX_H = 1600
/** A watch the server stopped renewing (it went away) ends after this. */
const RENEW_MS = 30_000
/** Without a frame this long (a hidden page doesn't paint, a still one sends none), the page is drawn for it. */
const STILL_MS = 1000

/** `cast` and `drawn`: the last frame each way (a drawing makes the page paint a frame too: each is sent once). */
type Watch = { p: EnginePage; css: { w: number; h: number }; frame: string; cast: string; drawn: string; sent: number; checked: number
  trailing: ReturnType<typeof setTimeout> | null
  tick: ReturnType<typeof setInterval>; renewed: number; state: string; onMessage: (...a: unknown[]) => void }
const watches = new Map<number, Watch>()
// (an update's restart waits while the user watches or drives a tab from another device)
busyWhen(() => watches.size ? "the user is watching a tab live" : null)
const opened = new Map<number, number>()
const queues = new Map<number, Promise<unknown>>()
eachPage((p) => {
  opened.set(p.id, Date.now())
  p.wc.once("destroyed", () => { opened.delete(p.id); queues.delete(p.id); stop(p.id, true) })
})

/** Page `tab`, if its owner may watch it: a web page, its container not locked. */
function pageOf(tab: unknown): EnginePage {
  const p = allPages().find((x) => x.id === Number(tab))
  if (!p || p.wc.isDestroyed()) throw new Error(`no tab ${String(tab)}: it was closed`)
  if (!/^https?:/i.test(p.wc.getURL() || p.url)) throw new Error("only a web page shows here, not an extension's or the app's")
  if (!mayOpen(p.profile)) throw new Error("its container is locked: unlock it on the Mac")
  return p
}

const containerOf = (p: EnginePage) => (p.profile.startsWith("c-") ? p.profile.slice(2) : null)
function stateOf(p: EnginePage) {
  const a = agentState(p.id)
  return { tab: p.id, url: p.wc.getURL() || p.url, title: p.wc.getTitle(), loading: p.wc.isLoading(), paused: a.paused, asking: a.ask?.reason ?? null,
    askedBy: a.ask?.by ?? null }
}

function send(w: Watch, jpeg: string) {
  w.frame = jpeg
  w.sent = Date.now()
  tellServer(w.p.win, "live:frame", { tab: w.p.id, jpeg, w: w.css.w, h: w.css.h })
}
/** A frame, throttled: one coming too soon waits, the newest replacing it, so the last one always arrives. */
function offer(w: Watch, jpeg: string) {
  const wait = w.sent + 1000 / FPS - Date.now()
  if (wait <= 0 && !w.trailing) return send(w, jpeg)
  w.frame = jpeg
  w.trailing ??= setTimeout(() => { w.trailing = null; if (watches.get(w.p.id) === w) send(w, w.frame) }, Math.max(0, wait))
}

async function measure(w: Watch) {
  const m = await cdp<{ cssVisualViewport?: { clientWidth: number; clientHeight: number } }>(w.p.wc, "Page.getLayoutMetrics").catch(() => null)
  if (m?.cssVisualViewport) w.css = { w: m.cssVisualViewport.clientWidth, h: m.cssVisualViewport.clientHeight }
}
const jpegOf = (img: NativeImage) => {
  const { width, height } = img.getSize()
  const scale = Math.min(1, MAX_W / width, MAX_H / height)
  return (scale < 1 ? img.resize({ width: Math.round(width * scale) }) : img).toJPEG(60).toString("base64")
}

async function start(p: EnginePage) {
  const w: Watch = { p, css: { w: 0, h: 0 }, frame: "", cast: "", drawn: "", sent: 0, checked: 0, trailing: null, renewed: Date.now(), state: "", tick: setInterval(() => void tick(w), 700),
    onMessage: (_e, method, params) => {
      if (method !== "Page.screencastFrame") return
      const f = params as { data: string; sessionId: number; metadata: { deviceWidth: number; deviceHeight: number } }
      void cdp(p.wc, "Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {})
      if (f.metadata?.deviceWidth) w.css = { w: f.metadata.deviceWidth, h: f.metadata.deviceHeight }
      if (f.data !== w.cast) offer(w, (w.cast = f.data))
    } }
  watches.set(p.id, w)
  try {
    await measure(w)
    p.wc.debugger.on("message", w.onMessage as never)
    await cdp(p.wc, "Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: MAX_W, maxHeight: MAX_H })
    await still(w)
  } catch (e) { stop(p.id); throw e }
  return w
}

/** No frame came for a while: the page drawn as it is (it stays hidden), sent only if it changed. */
async function still(w: Watch) {
  w.checked = Date.now()
  const img = await w.p.wc.capturePage(undefined, { stayHidden: true }).catch(() => null)
  if (!img || img.isEmpty() || watches.get(w.p.id) !== w) return
  await measure(w)
  const jpeg = jpegOf(img)
  if (jpeg !== w.drawn) offer(w, (w.drawn = jpeg))
}

async function tick(w: Watch) {
  if (w.p.wc.isDestroyed() || Date.now() - w.renewed > RENEW_MS) return stop(w.p.id)
  const s = JSON.stringify(stateOf(w.p))
  if (s !== w.state) { w.state = s; tellServer(w.p.win, "live:state", JSON.parse(s)) }
  if (Date.now() - Math.max(w.sent, w.checked) > STILL_MS) await still(w)
}

function stop(id: number, gone = false) {
  const w = watches.get(id)
  if (!w) return
  watches.delete(id)
  clearInterval(w.tick)
  if (w.trailing) clearTimeout(w.trailing)
  if (gone) tellServer(w.p.win, "live:gone", { tab: id })
  if (w.p.wc.isDestroyed()) return
  w.p.wc.debugger.removeListener("message", w.onMessage as never)
  void cdp(w.p.wc, "Page.stopScreencast").catch(() => {})
}

/** One input after another per page: a press and its release never cross. */
function queued(id: number, fn: () => Promise<unknown>) {
  const run = (queues.get(id) ?? Promise.resolve()).then(fn, fn)
  queues.set(id, run.catch(() => {}))
  return run
}

type Input = { type?: unknown; x?: unknown; y?: unknown; action?: unknown; button?: unknown; count?: unknown; dx?: unknown; dy?: unknown
  key?: unknown; text?: unknown; modifiers?: unknown }
const BUTTONS: Record<string, number> = { none: 0, left: 1, right: 2, middle: 4 }
const MOUSE: Record<string, string> = { down: "mousePressed", up: "mouseReleased", move: "mouseMoved" }

/** The viewer's input on page `p`: x and y are where on its picture, 0 to 1, made the page's own CSS pixels here. */
async function input(p: EnginePage, e: Input) {
  const w = watches.get(p.id)
  if (w && !w.css.w) await measure(w)
  const css = w?.css.w ? w.css : { w: 1280, h: 800 }
  const fx = Math.min(1, Math.max(0, Number(e.x) || 0)), fy = Math.min(1, Math.max(0, Number(e.y) || 0))
  const x = fx * css.w, y = fy * css.h
  const modifiers = Math.max(0, Math.min(15, Number(e.modifiers) || 0))
  const button = typeof e.button === "string" && e.button in BUTTONS ? e.button : "left"
  switch (e.type) {
    case "tap":
      await cdp(p.wc, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
      await cdp(p.wc, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 })
      await cdp(p.wc, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 })
      return
    case "mouse": {
      const type = MOUSE[String(e.action)]
      if (!type) throw new Error("a mouse action is down, up or move")
      const held = type === "mouseReleased" ? 0 : type === "mousePressed" || button !== "none" ? BUTTONS[button] : 0
      await cdp(p.wc, "Input.dispatchMouseEvent", { type, x, y, modifiers, button: type === "mouseMoved" && !held ? "none" : button, buttons: held,
        clickCount: type === "mouseMoved" ? 0 : Math.min(3, Math.max(1, Number(e.count) || 1)) })
      return
    }
    case "wheel":
      // (by how much of the picture, as x and y)
      await cdp(p.wc, "Input.dispatchMouseEvent", { type: "mouseWheel", x, y, modifiers, deltaX: Math.max(-5, Math.min(5, Number(e.dx) || 0)) * css.w,
        deltaY: Math.max(-5, Math.min(5, Number(e.dy) || 0)) * css.h })
      return
    case "key": return press(p, String(e.key ?? "").slice(0, 40))
    case "text": {
      const text = String(e.text ?? "").slice(0, 5000)
      if (text) await cdp(p.wc, "Input.insertText", { text })
      return
    }
    default: throw new Error("input is a tap, mouse, wheel, key or text")
  }
}

// ---------- the server's, from its owner-only live routes ----------

/** A page as the owner's list shows it: whose (an agent's, its task), its container, paused, what's asked there. */
function entryOf(p: EnginePage) {
  const by = agentState(p.id).by
  return { ...stateOf(p), container: containerOf(p), by: by ? by.name || "An agent" : null, task: by?.task ?? "", summary: by?.summary ?? "",
    shown: p.visible(), opened: opened.get(p.id) ?? null, appTab: p.tab() }
}
handle("agent:live:tabs", () => allPages().filter((p) => !p.wc.isDestroyed() && /^https?:/i.test(p.wc.getURL() || p.url) && mayOpen(p.profile)).map(entryOf))
// (renewed by the server while anyone watches: what it answers is the page now, its last frame among it)
handle("agent:live:watch", async (_win, tab) => {
  const p = pageOf(tab)
  const w = watches.get(p.id) ?? await start(p)
  w.renewed = Date.now()
  return { ...entryOf(p), frame: w.frame }
})
handle("agent:live:unwatch", (_win, tab) => stop(Number(tab)))
handle("agent:live:input", (_win, tab, e) => {
  const p = pageOf(tab)
  return queued(p.id, () => input(p, (e && typeof e === "object" ? e : {}) as Input)).then(() => null)
})
handle("agent:live:pause", (_win, tab, on) => { setPaused(pageOf(tab).id, on !== false); return stateOf(pageOf(tab)) })
handle("agent:live:done", (_win, tab) => { helped(pageOf(tab).id); return stateOf(pageOf(tab)) })
