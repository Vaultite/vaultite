/** The menu-bar helper (a Mac's; one per Mac, a lock): the app and its home vault's server kept with no window. It has fn,
 *  the companion's cursor over the screen (overlay.ts), screen reading and what's in front. See electron/CLAUDE.md. */
import { app, Menu, Notification, nativeImage, screen, shell, Tray, type WebContents } from "electron"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { WebSocket } from "ws"
import { fnActsToo, fnKey, type FnAction } from "../core/fnkey.ts"
import { joinText, parseReplacement, replacer } from "../core/dictationtext.ts"
import { privateApp } from "../core/privateapps.ts"
import { dictate, dictating, stopFor, dictationEngines, type DictationSink } from "./dictation.ts"
import { hunksOf, pointIn, prefsOf, type Prefs, type Scene, type ScreenAgent } from "./helperlogic.ts"
import { overlayActs, showOverlay } from "./overlay.ts"
import { fnUsage, onScreenEvent, screenAsk as askHelper, startScreen, stopScreen, windowShot as shoot, type AppWindowInfo, type Focus, type Rect } from "./screen.ts"

/** The vault the helper serves: its server's port, and how it's called. */
export type Home = { port: number; path: string; name: string }
/** This Mac's say (vaults.json): open at login, and the fn notice shown. */
export type HelperPrefs = { login?: boolean; fnNotice?: boolean }
export type HelperHost = {
  home: () => Home | null
  /** Open (or bring forward) the home vault's window; none known: the vaults list. */
  openHome: () => void
  /** The focused vault window's page while this app is in front: fn is its ⌘J there. */
  focusedPage: () => WebContents | null
  /** Tell every vault's server unasked (core/desktopapp.ts onDesktopEvent). */
  event: (name: string, data: unknown) => void
  prefs: () => HelperPrefs
  setPrefs: (p: HelperPrefs) => void
  quit: () => void
  /** The tray's icon (a template image). */
  icon: string
}

const QUIET = !!process.env.VAULTITE_QUIET
// (a scripted copy's own: never the user's app's)
const LOCK = path.join(os.tmpdir(), QUIET ? `vaultite-helper-${process.pid}.sock` : "vaultite-helper.sock")
let host: HelperHost | null = null
/** A scripted copy's stand-ins for the screen helper's answers (web/qa/helper.mjs): it never reads or types into the
 *  user's apps. */
const stubs = new Map<string, Record<string, unknown>>()
const screenAsk = <T = Record<string, unknown>>(op: string, req: Record<string, unknown> = {}): Promise<T> =>
  QUIET ? Promise.resolve((stubs.get(op) ?? { ok: false, why: "quiet", window: 0 }) as T) : askHelper<T>(op, req)
const windowShot = (window: number, dir: string) => (QUIET ? Promise.resolve(null) : shoot(window, dir))
let lock: net.Server | null = null
let tray: Tray | null = null
const SHOTS = () => path.join(app.getPath("userData"), "screens")

export const helperOn = () => !!host

/** The lock: a socket only one app can listen on; a dead app's is taken over. */
function takeLock(): Promise<net.Server | null> {
  const listen = () => new Promise<net.Server | null>((done) => {
    const s = net.createServer((c) => c.end())
    s.once("error", () => done(null))
    s.listen(LOCK, () => done(s))
  })
  return listen().then((s) => s ?? new Promise((done) => {
    const probe = net.connect(LOCK)
    probe.once("connect", () => { probe.destroy(); done(null) })
    probe.once("error", () => { fs.rmSync(LOCK, { force: true }); void listen().then(done) })
  }))
}

export async function startHelper(h: HelperHost) {
  if (host) return true
  lock = await takeLock()
  if (!lock) return false
  host = h
  app.on("will-quit", stopHelper)
  if (QUIET) Object.assign(globalThis, { vaultiteHelper: { heard: (m: Record<string, unknown>) => heard(m), stub: (op: string, v: Record<string, unknown>) => stubs.set(op, v),
    asked: () => [...asked], scene: () => lastScene } })
  onScreenEvent(heard)
  overlayActs({ drop: (name, x, y) => void dropAt(name, x, y), dismiss: (id) => live.say({ t: "hide", id }), stop: () => { if (session) stopFor(session.sink) } })
  if (!QUIET) await startScreen().catch((e) => console.error("vaultite: the screen helper didn't start:", e))
  // (a copy a script drives (web/qa/helper.mjs) shows nothing in the menu bar and never hears the user's fn)
  if (!QUIET) {
    void screenAsk("fn")
    const icon = nativeImage.createFromPath(h.icon)
    icon.setTemplateImage(true)
    tray = new Tray(icon)
    tray.setToolTip(app.getName())
    tray.on("click", () => tray?.popUpContextMenu(menu()))
    login(h.prefs().login ?? app.isPackaged)
  }
  setInterval(() => void refresh(), 10_000).unref()
  await refresh()
  return true
}

export function stopHelper() {
  if (!host) return
  host = null
  live.close()
  showOverlay(null)
  stopScreen()
  tray?.destroy()
  tray = null
  lock?.close()
  lock = null
}

// ---------- the menu bar

function menu() {
  const h = host!, home = h.home()
  const setting = (name: string, values: Record<string, unknown>) => () => void op("settings.set", { name, values }).then(refresh)
  return Menu.buildFromTemplate([
    { label: home ? `Open ${home.name}` : `Open ${app.getName()}`, click: () => h.openHome() },
    { type: "separator" },
    { label: "Dictate anywhere with fn", type: "checkbox", checked: prefs.fn, enabled: !!home, click: setting("plugin/dictation", { fn: !prefs.fn }) },
    { label: "Companion's cursor outside Vaultite", enabled: !!home, submenu: [
      { label: "Docked at the screen's edge", type: "radio", checked: prefs.cursor === "dock", click: setting("plugin/companion", { screen_cursor: null }) },
      { label: "Following the pointer", type: "radio", checked: prefs.cursor === "trail", click: setting("plugin/companion", { screen_cursor: "trail" }) },
    ] },
    { type: "separator" },
    { label: "Open at login", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (i) => { login(i.checked); h.setPrefs({ login: i.checked }) } },
    { type: "separator" },
    { label: `Quit ${app.getName()}`, accelerator: "Command+Q", click: () => h.quit() },
  ])
}

function login(on: boolean) {
  if (app.getLoginItemSettings().openAtLogin !== on) app.setLoginItemSettings({ openAtLogin: on })
}

// ---------- the home vault: its settings, and the companion as it knows it

const manifest = (id: string) => {
  try { return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "plugins", "core", id, "manifest.json"), "utf8")).settings ?? {} } catch { return {} }
}
const DEFAULTS = { dictation: manifest("dictation"), companion: manifest("companion"), screen: manifest("screen") }
/** The home vault's settings that the helper follows, their defaults the manifests' (read every 10 s and after a change). */
let prefs: Prefs = { fn: true, cursor: "dock", privateApps: DEFAULTS.screen.private_apps?.default ?? [], dictation: {} }
let based = ""

async function op(id: string, body: Record<string, unknown> = {}) {
  const home = host?.home()
  if (!home) throw new Error("no vault is open")
  const r = await fetch(`http://127.0.0.1:${home.port}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/desktop" }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${id} answered ${r.status}`)
  return r.json() as Promise<Record<string, unknown>>
}

/** The home vault may have changed (a window opened, closed or focused): follow it now. */
export const homeChanged = () => { if (host) void refresh() }
/** Follow the home vault: its server (the overlay's page, the companion's socket) and its settings. */
async function refresh() {
  const home = host?.home()
  const base = home ? `http://127.0.0.1:${home.port}` : ""
  if (base !== based) { based = base; live.open(home ? home.port : null) }
  if (!home) return draw()
  const get = (name: string) => op("settings.get", { name }).catch(() => ({}))
  const [d, c, s] = await Promise.all([get("plugin/dictation"), get("plugin/companion"), get("plugin/screen")])
  prefs = prefsOf(d, c, s, DEFAULTS)
  draw()
}

type Agent = { name: string; tint: string; state: string; app?: string; window?: number; find?: string; sx?: number; sy?: number; display?: number; path?: string }
type Note = { id: string; kind: string; agent: string; text?: string; question?: boolean; dismissed?: number }
/** The companion's socket, as the helper (?screen=1): the agents and their bubbles, and what the user asks on screen. */
const live = (() => {
  let ws: WebSocket | null = null, port: number | null = null, wait = 1000, timer: ReturnType<typeof setTimeout> | null = null
  const state = { mode: "quiet", name: "", agents: new Map<string, Agent>(), notes: new Map<string, Note>() }
  const connect = () => {
    timer = null
    if (port === null) return
    const s = new WebSocket(`ws://127.0.0.1:${port}/api/companion/live?screen=1`)
    ws = s
    s.on("open", () => { wait = 1000 })
    s.on("message", (d) => {
      let m: Record<string, unknown>
      try { m = JSON.parse(String(d)) } catch { return }
      if (m.t === "state") {
        state.mode = String(m.mode); state.name = String(m.name)
        state.agents = new Map((m.agents as Agent[]).map((a) => [a.name, a]))
        state.notes = new Map((m.notes as Note[]).map((n) => [n.id, n]))
      } else if (m.t === "agent") { const a = m.agent as Agent; state.agents.set(a.name, a) }
      else if (m.t === "note") { const n = m.note as Note; state.notes.set(n.id, n) }
      else if (m.t === "drop") state.notes.delete(String(m.id))
      else return
      draw()
    })
    s.on("error", () => {})
    s.on("close", () => { if (ws === s) { ws = null; if (port !== null) { timer = setTimeout(connect, wait); wait = Math.min(wait * 2, 30_000) } } })
  }
  return {
    state,
    open(p: number | null) { this.close(); port = p; if (p !== null) connect() },
    close() { port = null; if (timer) clearTimeout(timer); timer = null; ws?.close(); ws = null; state.agents.clear(); state.notes.clear() },
    say(m: object) { if (QUIET) asked.push(m); if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(m)); return true } return false },
  }
})()

// ---------- what's in front (awareness: metadata only)

let front: AppWindowInfo | null = null
const hidden = (a: { bundle?: string; name?: string } | null) => !!a && privateApp(a, prefs.privateApps)

function heard(m: Record<string, unknown>) {
  if (m.event === "fn") return fnHeard(m)
  if (m.event === "front") {
    front = m as unknown as AppWindowInfo
    host?.event("screen:front", hidden(front) ? { bundle: front.bundle, name: front.name, private: true } : { bundle: front.bundle, name: front.name, title: front.title, window: front.window, vaultite: !!front.vaultite })
    return draw()
  }
  if (m.event === "tap" && m.ok === false) notice("tap", "fn needs Vaultite in Accessibility", "Allow it in System Settings, Privacy & Security, Accessibility, then press fn again.",
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility")
  if (m.event === "exit" && host) setTimeout(() => { if (host) void startScreen().then(() => screenAsk("fn")).catch(() => {}) }, 2000)
}

const said = new Set<string>()
/** A notice once a launch (`once`: once ever, kept in vaults.json); a click opens `link`. */
function notice(key: string, title: string, body: string, link?: string, once = false) {
  if (QUIET) return void asked.push({ notice: key })
  if (said.has(key) || !Notification.isSupported()) return
  said.add(key)
  const n = new Notification({ title, body, silent: true })
  if (link) n.on("click", () => void shell.openExternal(link))
  n.show()
  if (once) host?.setPrefs({ fnNotice: true })
}

// ---------- fn: dictation anywhere

const key = fnKey()
/** The helper's own session: words into another app's field, or an ask about the window in front. */
type Session = { sink: DictationSink; into: "field" | "ask"; focus: Focus; finals: string[]; pending: string; level: number; ready: boolean
  context: Promise<{ screen?: string; shot?: string | null }> | null; swap: [RegExp, string][] }
let session: Session | null = null
/** The window's page that has this press (fn there is its ⌘J), till it's let go. */
let page: WebContents | null = null

function fnHeard(m: Record<string, unknown>) {
  if (!prefs.fn || !host?.home()) return
  const to = page && !page.isDestroyed() ? page : null
  if (m.other === true) { if (to) to.send("vaultite:fn", { other: true }); else act(key.other()) ; return }
  if (m.down === true) {
    if (!session) page = host.focusedPage()
    if (page && !session) return void page.send("vaultite:fn", { down: true })
    page = null
    void firstUse()
    return act(key.down(Date.now(), !!session || starting))
  }
  if (to) { to.send("vaultite:fn", { down: false }); return }
  act(key.up(Date.now()))
}

let checkedFn = false
/** The first press: macOS's own action for the key (an emoji picker, the input source) would come too: say how to stop it, once. */
async function firstUse() {
  if (checkedFn || host?.prefs().fnNotice) return
  checkedFn = true
  if (fnActsToo(await fnUsage())) notice("fn-usage", "macOS acts on fn too", "In System Settings, Keyboard, set \"Press globe key to\" to \"Do nothing\".",
    "x-apple.systempreferences:com.apple.Keyboard-Settings.extension", true)
}

/** A session on its way (the field asked for, the recognizer starting): a release meanwhile waits for it. */
let starting = false, after: FnAction = null
function act(a: FnAction) {
  if (a === "start") {
    starting = true
    after = null
    void begin().finally(() => { starting = false; const then = after; after = null; if (then) act(then) })
  } else if (starting && (a === "stop" || a === "cancel")) after = a
  else if (a === "stop" && session) stopFor(session.sink)
  else if (a === "cancel" && session) stopFor(session.sink, true)
}

/** The recognizer, as the page picks it (plugins/core/dictation): Parakeet for English when it's here, else Apple's. */
async function engineFor(s: Record<string, unknown>) {
  const language = typeof s.language === "string" ? s.language.trim() : ""
  if (s.engine === "apple" || s.engine === "parakeet") return { engine: s.engine, language }
  if (language && !/^en\b/i.test(language)) return { engine: "apple", language }
  const e: { parakeet: boolean; locale?: unknown } = await dictationEngines(language)
  return { engine: e.parakeet && (language || !e.locale || /^en\b/i.test(String(e.locale))) ? "parakeet" : "apple", language }
}

async function begin() {
  const focus = await screenAsk<Focus>("focus")
  if (focus.vaultite || dictating()) return
  // (a password field gets nothing said)
  if (focus.field && focus.secure) return
  const priv = hidden(focus)
  const s = prefs.dictation
  const lines = Array.isArray(s.replacements) ? s.replacements.filter((x): x is string => typeof x === "string") : (DEFAULTS.dictation.replacements?.default as string[] | undefined) ?? []
  const into = focus.field ? "field" : "ask"
  const mine: Session = { sink: { tell: (e) => told(mine, e) }, into, focus, finals: [], pending: "", level: 0, ready: false, swap: replacer(lines),
    // (what they're looking at as they start speaking: its text and one picture, never a private app's)
    context: into === "ask" && !priv && focus.window ? context(focus.window) : null }
  session = mine
  draw()
  const how = await engineFor(s)
  const r = await dictate(mine.sink, { ...how, silence: s.silence, keep: s.keep_audio === true, words: lines.map(parseReplacement).filter((x) => !!x).map((x) => x[0]) })
  if (r.ok || session !== mine) return
  session = null
  draw()
  if (r.code === "permission") notice("mic", "Vaultite isn't allowed to use the microphone", "Allow it in System Settings, Privacy & Security, Microphone.",
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone")
  else if (r.code === "model") notice("model", "Parakeet's model isn't on this Mac", "Handy or Hex downloads it, or pick Apple's recognizer in Dictation's settings.")
}

async function context(window: number) {
  const [t, shot] = await Promise.all([screenAsk<{ ok?: boolean; text?: string }>("text", { window, max: 20_000 }), windowShot(window, SHOTS())])
  return { screen: t.ok ? t.text : undefined, shot }
}

function told(s: Session, e: Record<string, unknown>) {
  if (session !== s) return
  const said = (t: unknown) => s.swap.reduce((x, [re, to]) => x.replace(re, to), String(t ?? ""))
  if (e.type === "start") s.ready = true
  else if (e.type === "level") s.level = Number(e.v) || 0
  else if (e.type === "pending") s.pending = said(e.text)
  else if (e.type === "final") { const t = said(e.text).trim(); if (t) s.finals.push(t); s.pending = "" }
  else if (e.type === "end") { session = null; void finish(s, e.reason === "cancel") }
  draw()
}

/** Its words: into the field (joined to what's before its caret), or an ask to the companion with what's on screen. */
async function finish(s: Session, cancelled: boolean) {
  const text = s.finals.reduce((all, t) => all + joinText(all, t), "").trim()
  if (cancelled || !text) return
  if (s.into === "field") {
    const r = await screenAsk<{ ok?: boolean; why?: string }>("insert", { text: joinText(s.focus.before ?? "", text) })
    if (!r.ok && r.why === "no-field") notice("lost", "Couldn't put the words in", "The field lost the keyboard while you spoke.")
    return
  }
  if (live.state.mode === "off") return notice("off", "The companion is off", "Turn it on in the companion's settings to ask it about your screen.")
  const c = (await s.context) ?? {}
  const priv = hidden(s.focus)
  // (a private app's ask is only what they said: not even which app)
  live.say({ t: "moment", kind: "ask", text, ...(priv ? { app: "private" } : { app: s.focus.bundle, window: s.focus.window, title: s.focus.title, ...c, shot: c.shot ?? undefined }) })
}

// ---------- the cursor over the screen

/** Places on screen resolved to points (an element's frame by its text, a window's), kept a moment: windows move. */
const placed = new Map<string, { at: number; p: { x: number; y: number } | null }>()
const placeKey = (a: Agent) => `${a.app ?? ""}|${a.window ?? ""}|${a.find ?? ""}|${a.sx ?? ""}|${a.sy ?? ""}`
const onScreen = (a: Agent) => !a.path && (!!a.app || (typeof a.sx === "number" && typeof a.sy === "number"))
async function resolve(a: Agent) {
  if (typeof a.sx === "number" && typeof a.sy === "number") return { x: a.sx, y: a.sy }
  if (!a.app || hidden({ bundle: a.app, name: a.app })) return null
  if (a.find) {
    const r = await screenAsk<{ ok?: boolean; found?: Rect | null }>("find", { window: a.window ?? 0, bundle: a.app, text: a.find })
    if (r.found) return pointIn(r.found, true)
  }
  const w = await screenAsk<AppWindowInfo>("window", { window: a.window ?? 0, bundle: a.app })
  return w.frame ? pointIn(w.frame, false) : null
}
function pointOf(a: Agent) {
  const k = `${a.name}:${placeKey(a)}`, had = placed.get(k)
  if (!had || Date.now() - had.at > (a.find ? 3000 : 1000)) {
    placed.set(k, { at: Date.now(), p: had?.p ?? null })
    void resolve(a).then((p) => { placed.set(k, { at: Date.now(), p }); draw() }, () => {})
  }
  return had?.p ?? null
}

let trailing: ReturnType<typeof setInterval> | null = null
/** What a scripted copy said and drew last (web/qa/helper.mjs). */
const asked: object[] = []
let lastScene: Scene | null = null
/** What the overlay draws now (overlay.ts gives each display its part). */
function draw() {
  if (!host) return
  const agents: ScreenAgent[] = []
  const says = [...live.state.notes.values()].filter((n) => n.kind === "say" && !n.dismissed)
  for (const a of live.state.agents.values()) {
    if (a.state === "away" || !onScreen(a)) continue
    const p = pointOf(a)
    if (!p) continue
    const say = says.filter((n) => n.agent === a.name).at(-1)
    agents.push({ name: a.name, tint: a.tint, state: a.state, sx: p.x, sy: p.y, ...(say?.text ? { say: { id: say.id, text: say.text, ...(say.question ? { question: true } : {}) } } : {}) })
  }
  const own = live.state.agents.get(live.state.name)
  // (waiting while they're in another app: the window draws its own while Vaultite's in front)
  const idleOn = !!own && own.state !== "away" && live.state.mode !== "off" && !onScreen(own) && !!front && !front.vaultite
  const want = idleOn && prefs.cursor === "trail"
  if (want && !trailing) trailing = setInterval(draw, 33)
  else if (!want && trailing) { clearInterval(trailing); trailing = null }
  let idle: Scene["idle"] = null
  if (idleOn) {
    const ptr = screen.getCursorScreenPoint()
    if (prefs.cursor === "trail") idle = { name: own!.name, tint: own!.tint, sx: ptr.x + 14, sy: ptr.y + 16, docked: false }
    else {
      // (at the right edge of the display with the window in front, a third of the way down)
      const d = front?.frame ? screen.getDisplayMatching({ x: Math.round(front.frame.x), y: Math.round(front.frame.y), width: Math.max(1, Math.round(front.frame.width)), height: Math.max(1, Math.round(front.frame.height)) }) : screen.getDisplayNearestPoint(ptr)
      idle = { name: own!.name, tint: own!.tint, sx: d.workArea.x + d.workArea.width - 22, sy: d.workArea.y + Math.round(d.workArea.height / 3), docked: true }
    }
  }
  const s = session
  const pill: Scene["pill"] = s ? { level: s.level, text: s.pending || s.finals.at(-1) || "", ready: s.ready, ...(s.focus.frame ? { display: displayOf(s.focus.frame) } : {}) } : null
  lastScene = { agents, idle, pill }
  showOverlay(based || null, lastScene)
}
const displayOf = (r: Rect) => screen.getDisplayMatching({ x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) }).id

// ---------- dropped on a window: "look at this", then follow it

type Follow = { name: string; info: AppWindowInfo; text: string; changed: string | null; sent: number; timer: ReturnType<typeof setInterval>; until: number }
let following: Follow | null = null
const FOLLOW_MS = 4000, FOLLOW_FOR = 30 * 60_000, FOLLOW_GAP = 20_000

/** The companion's cursor dropped at a point of the screen (the overlay's or a window's drag): the window there. */
export async function dropAt(name: string, x: number, y: number) {
  const w = await screenAsk<AppWindowInfo>("at", { x, y })
  unfollow()
  if (!w.window || w.vaultite || hidden(w)) return
  const [t, shot] = await Promise.all([screenAsk<{ ok?: boolean; text?: string }>("text", { window: w.window, max: 20_000 }), windowShot(w.window, SHOTS())])
  const text = t.ok ? t.text ?? "" : ""
  live.say({ t: "moment", kind: "point", agent: name, app: w.bundle, window: w.window, title: w.title, screen: text, ...(shot ? { shot } : {}) })
  const f: Follow = { name, info: w, text, changed: null, sent: Date.now(), until: Date.now() + FOLLOW_FOR, timer: setInterval(() => void watch(f), FOLLOW_MS) }
  following = f
}
function unfollow() { if (following) clearInterval(following.timer); following = null }

/** A followed window's text read again: a change is told once it settles (unchanged a read later), at most every 20 s. */
async function watch(f: Follow) {
  if (following !== f) return
  if (Date.now() > f.until || !host) return unfollow()
  const r = await screenAsk<{ ok?: boolean; text?: string; why?: string }>("text", { window: f.info.window, max: 20_000 })
  if (following !== f) return
  if (!r.ok) return unfollow()
  const now = r.text ?? ""
  if (now !== f.text && now !== f.changed) { f.changed = now; return }
  if (f.changed === null || now !== f.changed || Date.now() - f.sent < FOLLOW_GAP) return
  const hunks = hunksOf(f.text.split("\n"), now.split("\n"))
  f.text = now
  f.changed = null
  f.sent = Date.now()
  if (hunks.length) live.say({ t: "moment", kind: "edit", agent: f.name, app: f.info.bundle, window: f.info.window, title: f.info.title, hunks })
}

// ---------- the server's calls (screen.text, screen.shot: plugins/core/screen)

export async function screenCall(name: string, args: unknown[]) {
  const o = (args[0] && typeof args[0] === "object" ? args[0] : {}) as { app?: unknown; window?: unknown; max?: unknown }
  const window = Number.isInteger(o.window) ? o.window as number : 0, bundle = typeof o.app === "string" ? o.app : ""
  // (whose window it is first: a private app's is never read)
  const w = await screenAsk<AppWindowInfo>("window", { window, bundle })
  if (!w.window) return { ok: false, why: "no-window" }
  if (hidden(w)) return { ok: false, why: "private" }
  if (name === "screen:text") return screenAsk("text", { window: w.window, max: Number(o.max) || 20_000 })
  if (name === "screen:shot") {
    const file = await windowShot(w.window, SHOTS())
    return file ? { ok: true, file, bundle: w.bundle, name: w.name, title: w.title, window: w.window } : { ok: false, why: "no picture: Vaultite needs screen recording (System Settings, Privacy & Security)" }
  }
  throw new Error(`no screen call ${name}`)
}
