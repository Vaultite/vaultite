// A page watched, and driven by its owner, from the app's web client or its window: its frames sent while watched.
import type { NativeImage } from "electron"
import { agentState, helped, press, setPaused, setTaken, setWatched } from "./agent.ts"
import { LIVE_INPUT, type LiveInput } from "./agentwire.ts"
import { scrub } from "./pagesecrets.ts"
import { LAYOUT, SCREENCAST_FRAME } from "./cdpwire.ts"
import { cdp, cdpAnswer } from "./cdp.ts"
import { allPages, appWindows, busyWhen, eachPage, handle, mayOpen, tell, tellServer, type EngineWindow, type EnginePage } from "./engine.ts"

const FPS = 8, LOCAL_FPS = 15
const MAX_W = 1280, MAX_H = 1600
const maxOf = (sharp: boolean) => (sharp ? { maxWidth: MAX_W * 2, maxHeight: MAX_H * 2 } : { maxWidth: MAX_W, maxHeight: MAX_H })
const RENEW_MS = 30_000
// Chromium paints nothing for a hidden page and its screencast sends nothing while a page is still.
const STILL_MS = 1000

type Watch = { p: EnginePage; css: { w: number; h: number }; frame: string; cast: string; drawn: string; sent: number; checked: number
  sharp: boolean; trailing: ReturnType<typeof setTimeout> | null
  tick: ReturnType<typeof setInterval>; by: Map<string, number>; state: string; onMessage: (e: Electron.Event, method: string, params: unknown) => void }
const watches = new Map<number, Watch>()
const SERVER = "server"
const viewOf = (id: number, key: unknown) => `${id}:${typeof key === "string" ? key.slice(0, 40) : ""}`
const watchedBy = (w: Watch, win: number) => [...w.by.keys()].some((k) => k.startsWith(`${win}:`))
busyWhen(() => [...watches.values()].some((w) => w.by.has(SERVER)) ? "the user is watching a tab live" : null)
const opened = new Map<number, number>()
const queues = new Map<number, Promise<unknown>>()
eachPage((p) => {
  opened.set(p.id, Date.now())
  p.wc.once("destroyed", () => { opened.delete(p.id); queues.delete(p.id); stop(p.id, true) })
})

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
  const frame = { tab: w.p.id, jpeg, w: w.css.w, h: w.css.h }
  if (w.by.has(SERVER)) tellServer(w.p.win, "live:frame", frame)
  for (const win of appWindows()) if (watchedBy(w, win.id)) tell(win, { type: "engine:live:frame", ...frame })
}
function offer(w: Watch, jpeg: string) {
  const wait = w.sent + 1000 / ([...w.by.keys()].some((k) => k !== SERVER) ? LOCAL_FPS : FPS) - Date.now()
  if (wait <= 0 && !w.trailing) return send(w, jpeg)
  w.frame = jpeg
  w.trailing ??= setTimeout(() => { w.trailing = null; if (watches.get(w.p.id) === w) send(w, w.frame) }, Math.max(0, wait))
}

async function measure(w: Watch) {
  const m = await cdpAnswer(w.p.wc, LAYOUT, "Page.getLayoutMetrics").catch(() => null)
  if (m?.cssVisualViewport) w.css = { w: m.cssVisualViewport.clientWidth, h: m.cssVisualViewport.clientHeight }
}
const jpegOf = (img: NativeImage, sharp: boolean) => {
  const { width, height } = img.getSize(), { maxWidth, maxHeight } = maxOf(sharp)
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  return (scale < 1 ? img.resize({ width: Math.round(width * scale) }) : img).toJPEG(60).toString("base64")
}

async function start(p: EnginePage) {
  const w: Watch = { p, css: { w: 0, h: 0 }, frame: "", cast: "", drawn: "", sent: 0, checked: 0, sharp: false, trailing: null, by: new Map(), state: "", tick: setInterval(() => void tick(w), 700),
    onMessage: (_e, method, params) => {
      if (method !== "Page.screencastFrame") return
      const frame = SCREENCAST_FRAME.safeParse(params)
      if (!frame.success) return
      const f = frame.data
      void cdp(p.wc, "Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {})
      if (f.metadata?.deviceWidth) w.css = { w: f.metadata.deviceWidth, h: f.metadata.deviceHeight }
      if (f.data !== w.cast) offer(w, (w.cast = f.data))
    } }
  watches.set(p.id, w)
  try {
    await p.wake()
    await measure(w)
    p.wc.debugger.on("message", w.onMessage)
    await cdp(p.wc, "Page.startScreencast", { format: "jpeg", quality: 60, ...maxOf(false) })
    await still(w)
  } catch (e) { stop(p.id); throw e }
  return w
}

async function still(w: Watch) {
  w.checked = Date.now()
  const img = await w.p.wc.capturePage(undefined, { stayHidden: true }).catch(() => null)
  if (!img || img.isEmpty() || watches.get(w.p.id) !== w) return
  await measure(w)
  const jpeg = jpegOf(img, w.sharp)
  if (jpeg !== w.drawn) offer(w, (w.drawn = jpeg))
}

async function tick(w: Watch) {
  for (const [k, at] of w.by) if (Date.now() - at > RENEW_MS) w.by.delete(k)
  if (w.p.wc.isDestroyed() || !w.by.size) return stop(w.p.id)
  watchedAs(w)
  const s = JSON.stringify({ ...stateOf(w.p), w: w.css.w, h: w.css.h })
  if (s !== w.state) { w.state = s; if (w.by.has(SERVER)) tellServer(w.p.win, "live:state", JSON.parse(s)) }
  if (Date.now() - Math.max(w.sent, w.checked) > STILL_MS) await still(w)
}

function stop(id: number, gone = false) {
  const w = watches.get(id)
  if (!w) return
  watches.delete(id)
  setWatched(id, null)
  clearInterval(w.tick)
  if (w.trailing) clearTimeout(w.trailing)
  if (gone && w.by.has(SERVER)) tellServer(w.p.win, "live:gone", { tab: id })
  if (w.p.wc.isDestroyed()) return
  w.p.wc.debugger.removeListener("message", w.onMessage)
  void cdp(w.p.wc, "Page.stopScreencast").catch(() => {})
}

function queued(id: number, fn: () => Promise<unknown>) {
  const run = (queues.get(id) ?? Promise.resolve()).then(fn, fn)
  queues.set(id, run.catch(() => {}))
  return run
}

const BUTTONS: Record<string, number> = { none: 0, left: 1, right: 2, middle: 4 }
const MOUSE: Record<string, string> = { down: "mousePressed", up: "mouseReleased", move: "mouseMoved" }

async function input(p: EnginePage, e: LiveInput) {
  const w = watches.get(p.id)
  if (w && !w.css.w) await measure(w)
  const css = w?.css.w ? w.css : { w: 1280, h: 800 }
  const fx = Math.min(1, Math.max(0, Number(e.x) || 0)), fy = Math.min(1, Math.max(0, Number(e.y) || 0))
  const x = fx * css.w, y = fy * css.h
  const modifiers = Math.max(0, Math.min(15, Number(e.modifiers) || 0))
  const button = typeof e.button === "string" && e.button in BUTTONS ? e.button : "left"
  switch (e.type) {
    case "tap": {
      const clickCount = Math.min(3, Math.max(1, Number(e.count) || 1))
      await cdp(p.wc, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
      await cdp(p.wc, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount })
      await cdp(p.wc, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount })
      return
    }
    case "mouse": {
      const type = MOUSE[String(e.action)]
      if (!type) throw new Error("a mouse action is down, up or move")
      const held = type === "mouseReleased" ? 0 : type === "mousePressed" || button !== "none" ? BUTTONS[button] : 0
      await cdp(p.wc, "Input.dispatchMouseEvent", { type, x, y, modifiers, button: type === "mouseMoved" && !held ? "none" : button, buttons: held,
        clickCount: type === "mouseMoved" ? 0 : Math.min(3, Math.max(1, Number(e.count) || 1)) })
      return
    }
    case "wheel":
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

function entryOf(p: EnginePage) {
  const by = agentState(p.id).by
  return { ...stateOf(p), container: containerOf(p), by: by ? by.name || "An agent" : null, task: by?.task ?? "", summary: by?.summary ?? "",
    shown: p.visible(), opened: opened.get(p.id) ?? null, appTab: p.tab() }
}
handle("agent:live:tabs", () => allPages().filter((p) => !p.wc.isDestroyed() && /^https?:/i.test(p.wc.getURL() || p.url) && mayOpen(p.profile)).map(entryOf))
async function watch(p: EnginePage, who: string) {
  const w = watches.get(p.id) ?? await start(p)
  w.by.set(who, Date.now())
  watchedAs(w)
  return w
}
const watchedAs = (w: Watch) => setWatched(w.p.id, w.by.has(SERVER) ? "elsewhere" : "here")
function unwatch(id: number, who: string) {
  const w = watches.get(id)
  if (!w) return
  w.by.delete(who)
  if (!w.by.size) stop(id)
  else watchedAs(w)
}
handle("agent:live:watch", async (_win, tab) => {
  const p = pageOf(tab)
  const w = await watch(p, SERVER)
  return { ...entryOf(p), frame: w.frame, w: w.css.w, h: w.css.h }
})
handle("agent:live:sharp", async (_win, tab, on) => {
  const w = watches.get(pageOf(tab).id)
  if (!w || w.sharp === (on === true)) return null
  w.sharp = on === true
  w.cast = w.drawn = ""
  await cdp(w.p.wc, "Page.stopScreencast").catch(() => {})
  await cdp(w.p.wc, "Page.startScreencast", { format: "jpeg", quality: 60, ...maxOf(w.sharp) })
  await still(w)
  return null
})
handle("agent:live:unwatch", (_win, tab) => unwatch(Number(tab), SERVER))
handle("agents:watch", async (win: EngineWindow, tab, key) => {
  const p = pageOf(tab)
  if (p.win !== win) throw new Error("that page is another window's")
  const w = await watch(p, viewOf(win.id, key))
  return { frame: w.frame, w: w.css.w, h: w.css.h }
})
handle("agents:unwatch", (win: EngineWindow, tab, key) => unwatch(Number(tab), viewOf(win.id, key)))
handle("agent:live:input", (_win, tab, e) => {
  const p = pageOf(tab)
  const a = agentState(p.id), m = LIVE_INPUT.parse(e)
  const meant = m.type !== "mouse" || m.action === "down"
  if (meant && a.by && !a.paused && !a.ask) {
    setTaken(p.id, true)
    const w = watches.get(p.id)
    if (w) void tick(w)
  }
  return queued(p.id, () => input(p, m)).then(() => null)
})
const SELECTION = `(() => { const e = document.activeElement
  if (e && (e.tagName === "TEXTAREA" || (e.tagName === "INPUT" && e.type !== "password")) && e.selectionEnd > e.selectionStart) return e.value.slice(e.selectionStart, e.selectionEnd)
  return String(getSelection() || "") })()`
handle("agent:live:selection", async (_win, tab) => {
  const p = pageOf(tab)
  const text = String(await p.wc.executeJavaScriptInIsolatedWorld(1016, [{ code: SELECTION }]).catch(() => "") ?? "")
  return { text: scrub(text).slice(0, 100_000) }
})
handle("agent:live:pause", (_win, tab, on) => { setPaused(pageOf(tab).id, on !== false); return stateOf(pageOf(tab)) })
handle("agent:live:done", (_win, tab) => { helped(pageOf(tab).id); return stateOf(pageOf(tab)) })
