/** The menu-bar helper (a Mac's; one per Mac, a lock): the app and its home vault's server kept with no window. It has fn,
 *  the companion's cursor over the screen (overlay.ts), screen reading and what's in front. See electron/CLAUDE.md. */
import { app, Menu, Notification, nativeImage, screen, shell, Tray, type BrowserWindow, type WebContents } from "electron"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { WebSocket } from "ws"
import { ALONE_MS, controlActsToo, fnActsToo, fnKey, keyCodes, modKeys, type FnAction, type FnEvent, type ModEvent } from "../core/fnkey.ts"
import { joinText, parseReplacement, replacer } from "../core/dictationtext.ts"
import { privateApp } from "../core/privateapps.ts"
import { dictate, dictating, stopFor, dictationEngines, type DictationSink } from "./dictation.ts"
import { howWith } from "../plugins/core/companion/look.ts"
import { icon } from "./menu.ts"
import { atOffset, dockAt, dockOf, dockPoint, hunksOf, offsetIn, pointIn, prefsOf, spotIn, type Dock, type Point, type Prefs, type Scene, type ScreenAgent } from "./helperlogic.ts"
import { closePanel, onPanel, openPanel, overlayActs, panelData, panelFocused, panelMenuClosed, panelOpen, showOverlay, type PanelData } from "./overlay.ts"
import { dictationAuto, dictationHotKey, fnUsage, onScreenEvent, screenAsk as askHelper, startScreen, stopScreen, regionShot as shootRegion, windowShot as shoot, type AppWindowInfo, type Focus, type Rect } from "./screen.ts"

/** The vault the helper serves: its server's port, and how it's called. */
export type Home = { port: number; path: string; name: string }
/** This Mac's say (vaults.json): open at login, and the notices about macOS acting too, shown. */
export type HelperPrefs = { login?: boolean; fnNotice?: boolean; controlNotice?: boolean
  /** Where the companion waits outside the app (an edge), as the user left it. */
  dock?: Dock }
export type HelperHost = {
  home: () => Home | null
  /** Open (or bring forward) the home vault's window; none known: the vaults list. */
  openHome: () => void
  /** The focused vault window's page while this app is in front: fn is its ⌘J there. */
  focusedPage: () => WebContents | null
  /** The home vault's window while it's on screen (not minimized): its page, where its page is (points), its zoom. */
  homeWindow: () => { page: WebContents; bounds: Rect; zoom: number } | null
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
const regionShot = (r: Rect, dir: string) => (QUIET ? Promise.resolve(null) : shootRegion(r, dir))
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
  overlayActs({ drop: (name, x, y) => void dropAt(name, x, y), open: openChat, home: comeBack, menu: cursorMenu, stop: () => { if (session) stopFor(session.sink) } })
  onPanel({ send: (name, text) => void askFrom(name, text), mic: () => act(session || starting ? "stop" : "start"), more: cursorMenu,
    closed: () => { if (session?.into === "panel") stopFor(session.sink, true); draw() } })
  if (!QUIET) await startScreen().catch((e) => console.error("vaultite: the screen helper didn't start:", e))
  // (a copy a script drives (web/qa/helper.mjs) shows nothing in the menu bar and never hears the user's fn)
  if (!QUIET) {
    void listen()
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
  closePanel()
  showOverlay(null)
  stopScreen()
  tray?.destroy()
  tray = null
  lock?.close()
  lock = null
}

/** Its cursor called back (a double click on it, Come back): it stops following and waits by the pointer or the edge. */
function comeBack(name: string) {
  if (following?.name === name) unfollow()
  parks.delete(name)
  closePanel()
  live.say({ t: "home", agent: name })
}

/** Right-click on its cursor over the screen. */
function cursorMenu(name: string, at: { window: BrowserWindow; x: number; y: number }) {
  const mode = (m: string) => () => void op("settings.set", { name: "plugin/companion", values: { mode: m } })
  Menu.buildFromTemplate([
    { label: "Come back", click: () => comeBack(name) },
    { type: "separator" },
    { label: "Quiet", type: "radio", checked: live.state.mode === "quiet", click: mode("quiet") },
    { label: "Pair", type: "radio", checked: live.state.mode === "pair", click: mode("pair") },
  ]).popup({ ...at, callback: panelMenuClosed })
}

// ---------- the menu bar

function menu() {
  const h = host!, home = h.home()
  const setting = (name: string, values: Record<string, unknown>) => () => void op("settings.set", { name, values }).then(refresh)
  const place = (label: string, at: Prefs["cursor"], glyph: ReturnType<typeof icon>) => ({ label, icon: glyph, type: "radio" as const, checked: prefs.cursor === at, enabled: !!home,
    click: setting("plugin/companion", { screen_cursor: at === "dock" ? null : at }) })
  return Menu.buildFromTemplate([
    { label: home ? `Open ${home.name}` : `Open ${app.getName()}`, icon: icon("stone"), click: () => h.openHome() },
    { type: "separator" },
    { label: "Dictate anywhere", icon: icon("mic"), sublabel: keysSaid(prefs.keys), type: "checkbox", checked: prefs.fn, enabled: !!home, click: setting("plugin/dictation", { fn: !prefs.fn }) },
    { type: "separator" },
    // (where its cursor waits while another app is in front; each icon draws the place)
    { label: "Companion", type: "header", sublabel: prefs.talk.length ? `${keysSaid(prefs.talk)} to talk to it` : undefined },
    place("Following the pointer", "trail", icon("mouse-pointer-2")),
    place("Docked at the screen's edge", "dock", dockOf(h.prefs().dock).side === "left" ? icon("panel-left") : icon("panel-right")),
    place("Only inside Vaultite", "app", icon("app-window")),
    { type: "separator" },
    { label: "Open at login", icon: icon("power"), type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (i) => { login(i.checked); h.setPrefs({ login: i.checked }) } },
    { label: `Quit ${app.getName()}`, accelerator: "Command+Q", click: () => h.quit() },
  ])
}

/** The dictation keys as a Mac writes them: "fn, right ⌥ or ⌃ twice". */
function keysSaid(keys: string[]) {
  const said = keys.map((k) => ({ fn: "fn", right_option: "right ⌥", right_command: "right ⌘", double_control: "⌃ twice" } as Record<string, string>)[k]).filter(Boolean)
  return said.length ? said.length > 1 ? `${said.slice(0, -1).join(", ")} or ${said.at(-1)}` : said[0] : "No keys picked"
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
let prefs: Prefs = { fn: true, keys: DEFAULTS.dictation.keys?.default ?? [], talk: DEFAULTS.companion.keys?.default ?? [], cursor: "trail", privateApps: DEFAULTS.screen.private_apps?.default ?? [], dictation: {} }
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
  followKeys()
  draw()
}

type Agent = { name: string; tint: string; state: string; t?: number; seen?: boolean; why?: string; app?: string; window?: number; find?: string; sx?: number; sy?: number; display?: number; path?: string
  runs?: string; model?: string; effort?: string }
type Note = { id: string; kind: string; agent: string; t: number; text?: string; question?: boolean; dismissed?: number; seen?: boolean }
/** The companion's socket, as the helper (?screen=1): the agents and their bubbles, and what the user asks on screen. */
const live = (() => {
  let ws: WebSocket | null = null, port: number | null = null, wait = 1000, timer: ReturnType<typeof setTimeout> | null = null
  const state = { mode: "quiet", name: "", agents: new Map<string, Agent>(), notes: new Map<string, Note>(),
    /** Each agent's last says and what the user asked it: its conversation. */
    said: [] as Note[], harnesses: [] as Parameters<typeof howWith>[1] }
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
        state.said = (m.said as Note[] | undefined) ?? []
        state.harnesses = (m.harnesses as typeof state.harnesses | undefined) ?? []
      } else if (m.t === "said") state.said = (m.said as Note[] | undefined) ?? []
      else if (m.t === "agent") { const a = m.agent as Agent; state.agents.set(a.name, a) }
      else if (m.t === "note") { const n = m.note as Note; state.notes.set(n.id, n) }
      else if (m.t === "drop") state.notes.delete(String(m.id))
      else return
      draw()
      chatChanged()
    })
    s.on("error", () => {})
    s.on("close", () => { if (ws === s) { ws = null; if (port !== null) { timer = setTimeout(connect, wait); wait = Math.min(wait * 2, 30_000) } } })
  }
  return {
    state,
    open(p: number | null) { this.close(); port = p; if (p !== null) connect() },
    close() { port = null; if (timer) clearTimeout(timer); timer = null; ws?.close(); ws = null; state.agents.clear(); state.notes.clear(); state.said = [] },
    say(m: object) { if (QUIET) asked.push(m); if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(m)); return true } return false },
  }
})()

// ---------- what's in front (awareness: metadata only)

let front: AppWindowInfo | null = null
const hidden = (a: { bundle?: string; name?: string } | null) => !!a && privateApp(a, prefs.privateApps)

function heard(m: Record<string, unknown>) {
  if (m.event === "fn") return prefs.talk.includes("fn") ? talkHeard(m) : prefs.keys.includes("fn") ? fnHeard(m) : undefined
  if (m.event === "mod") return modHeard(m)
  if (m.event === "moved") return windowMoved(m)
  if (m.event === "front") {
    front = m as unknown as AppWindowInfo
    // (another app in front may cover or uncover what the cursors point at: looked at again)
    for (const e of placed.values()) e.at = 0
    host?.event("screen:front", hidden(front) ? { bundle: front.bundle, name: front.name, private: true } : { bundle: front.bundle, name: front.name, title: front.title, window: front.window, vaultite: !!front.vaultite })
    return draw()
  }
  if (m.event === "tap" && m.ok === false) notice("tap", "Dictation keys need Vaultite in Accessibility", "Allow it in System Settings, Privacy & Security, Accessibility, then press one again.",
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility")
  if (m.event === "exit" && host) setTimeout(() => { if (host) void startScreen().then(listen).catch(() => {}) }, 2000)
}

const said = new Set<string>()
/** A notice once a launch (`once`: once ever, kept in vaults.json under that name); a click opens `link`. */
function notice(key: string, title: string, body: string, link?: string, once?: "fnNotice" | "controlNotice") {
  if (QUIET) return void asked.push({ notice: key })
  if (said.has(key) || !Notification.isSupported()) return
  said.add(key)
  const n = new Notification({ title, body, silent: true })
  if (link) n.on("click", () => void shell.openExternal(link))
  n.show()
  if (once) host?.setPrefs({ [once]: true })
}

// ---------- fn: dictation anywhere; the Talk keys: the companion

const key = fnKey(), talkKey = fnKey()
/** The helper's own session: words into another app's field, or into a cursor's conversation (`talk`: a Talk key's,
 *  sent when it stops). */
type Session = { sink: DictationSink; into: "field" | "panel"; focus: Focus; finals: string[]; pending: string; level: number; ready: boolean
  swap: [RegExp, string][]; talk?: boolean }
let session: Session | null = null
/** The window's page that has this press (fn there is its ⌘J; a Talk key its companion's), till it's let go. */
let page: WebContents | null = null, talkPage: WebContents | null = null

/** The screen helper's tap hears the picked keys only: the dictation keys (none while Dictate anywhere is off) and the
 *  Talk keys. */
const heardKeys = () => (prefs.fn ? prefs.keys : [])
const keysNow = () => `${heardKeys().join()}|${prefs.talk.join()}`
const listen = () => screenAsk("fn", { keys: keyCodes([...heardKeys(), ...prefs.talk]) })
let mods = modKeys(heardKeys()), talkMods = modKeys(prefs.talk), followed = keysNow()
function followKeys() {
  if (keysNow() === followed) return
  followed = keysNow()
  mods = modKeys(heardKeys())
  talkMods = modKeys(prefs.talk)
  void listen().catch(() => {})
}

let settling: ReturnType<typeof setTimeout> | null = null, talkSettling: ReturnType<typeof setTimeout> | null = null
const asFn = (events: FnEvent[]) => { for (const e of events) fnHeard(e, false) }
const asTalk = (events: FnEvent[]) => { for (const e of events) talkHeard(e) }
// (each set hears every key: one of the other's between two taps breaks a double Control, as any key does)
function modHeard(m: Record<string, unknown>) {
  const r = mods.heard(m as ModEvent), t = talkMods.heard(m as ModEvent)
  if (settling) clearTimeout(settling)
  settling = r.wait ? setTimeout(() => { settling = null; asFn(mods.settled()) }, ALONE_MS) : null
  if (talkSettling) clearTimeout(talkSettling)
  talkSettling = t.wait ? setTimeout(() => { talkSettling = null; asTalk(talkMods.settled()) }, ALONE_MS) : null
  asFn(r.fn)
  asTalk(t.fn)
  if (r.twice || t.twice) void firstTwice()
}

/** A Talk key: in a Vaultite window, its page's (the companion there); elsewhere, the companion's conversation by the
 *  pointer. A tap starts and the next stops; held, it listens till let go. */
function talkHeard(m: Record<string, unknown>) {
  if (!host?.home()) return
  const to = talkPage && !talkPage.isDestroyed() ? talkPage : null
  if (m.other === true) { if (to) to.send("vaultite:fn", { talk: true, other: true }); else act(talkKey.other(), true); return }
  if (m.down === true) {
    if (!talking()) talkPage = host.focusedPage()
    if (talkPage && !talking()) return void talkPage.send("vaultite:fn", { talk: true, down: true })
    talkPage = null
    return act(talkKey.down(Date.now(), talking()), true)
  }
  if (to) { to.send("vaultite:fn", { talk: true, down: false }); return }
  act(talkKey.up(Date.now()), true)
}
const talking = () => !!session?.talk || (starting && startingTalk)

function fnHeard(m: Record<string, unknown>, byFn = true) {
  if (!prefs.fn || !host?.home()) return
  const to = page && !page.isDestroyed() ? page : null
  if (m.other === true) { if (to) to.send("vaultite:fn", { other: true }); else act(key.other()) ; return }
  if (m.down === true) {
    if (!session) page = host.focusedPage()
    if (page && !session) return void page.send("vaultite:fn", { down: true })
    page = null
    if (byFn) void firstUse()
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
    "x-apple.systempreferences:com.apple.Keyboard-Settings.extension", "fnNotice")
}

let checkedControl = false
/** The first double Control: macOS's own Control-twice shortcut would start its dictation too: say how to stop it, once. */
async function firstTwice() {
  if (checkedControl || !host?.home() || host.prefs().controlNotice) return
  checkedControl = true
  if (controlActsToo(await dictationHotKey(), await dictationAuto())) notice("control-usage", "macOS dictates on double Control too", "In System Settings, Keyboard, Dictation, set Shortcut to Off.",
    "x-apple.systempreferences:com.apple.Keyboard-Settings.extension", "controlNotice")
}

/** A session on its way (the field asked for, the recognizer starting): a release meanwhile waits for it. */
let starting = false, startingTalk = false, after: FnAction = null
function act(a: FnAction, talk = false) {
  if (a === "start") {
    starting = true
    startingTalk = talk
    after = null
    void (talk ? startTalk() : begin()).finally(() => { starting = false; startingTalk = false; const then = after; after = null; if (then) act(then) })
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

const replacements = () => {
  const s = prefs.dictation
  return Array.isArray(s.replacements) ? s.replacements.filter((x): x is string => typeof x === "string") : (DEFAULTS.dictation.replacements?.default as string[] | undefined) ?? []
}

async function begin() {
  // (a cursor's conversation open: the words go in its box)
  if (panelFocused()) return listenFor({ into: "panel", focus: { bundle: "", name: "", pid: 0, window: 0, title: "", field: true } })
  const focus = await screenAsk<Focus>("focus")
  if (focus.vaultite || dictating()) return
  // (a password field gets nothing said; with no field, nothing is heard: talking to the companion is its own keys')
  if (focus.field && focus.secure) return
  if (!focus.field) return hint(prefs.talk.length ? `No text field here: ${keysSaid(prefs.talk)} talks to ${live.state.name || "the companion"}` : "No text field here")
  await listenFor({ into: "field", focus })
}

/** Where the user asked by a Talk key (the pointer then, and the window under it): their ask is about that. */
let talkAt: { p: Point; w: AppWindowInfo | null } | null = null
/** A Talk key pressed outside Vaultite: the companion's conversation opens by the pointer, listening; what's said is
 *  sent when it stops (typed words are sent with Enter). */
async function startTalk() {
  if (dictating()) return
  const name = live.state.name
  if (live.state.mode === "off") return notice("off", "The companion is off", "Turn it on in the companion's settings to talk to it.")
  if (!name) return hint("The companion isn't ready yet: open Vaultite")
  const p = screen.getCursorScreenPoint()
  const w = await screenAsk<AppWindowInfo>("at", { x: p.x, y: p.y }).catch(() => null)
  openChat(name, p)
  if (panelOpen() !== name) return
  talkAt = { p, w }
  await listenFor({ into: "panel", focus: { bundle: "", name: "", pid: 0, window: 0, title: "", field: true }, talk: true })
}

/** A word in the dictation pill's place, a moment: a key pressed where it does nothing. */
let hinted: { text: string; until: number } | null = null
function hint(text: string) {
  hinted = { text, until: Date.now() + 2200 }
  draw()
  setTimeout(draw, 2250)
}

async function listenFor(o: Pick<Session, "into" | "focus" | "talk">) {
  if (dictating()) return
  const s = prefs.dictation, lines = replacements()
  const mine: Session = { sink: { tell: (e) => told(mine, e) }, ...o, finals: [], pending: "", level: 0, ready: false, swap: replacer(lines) }
  session = mine
  draw()
  chatChanged()
  const how = await engineFor(s)
  const r = await dictate(mine.sink, { ...how, silence: s.silence, keep: s.keep_audio === true, words: lines.map(parseReplacement).filter((x) => !!x).map((x) => x[0]) })
  if (r.ok || session !== mine) return
  session = null
  draw()
  chatChanged()
  if (r.code === "permission") notice("mic", "Vaultite isn't allowed to use the microphone", "Allow it in System Settings, Privacy & Security, Microphone.",
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone")
  else if (r.code === "model") notice("model", "Parakeet's model isn't on this Mac", "Handy or Hex downloads it, or pick Apple's recognizer in Dictation's settings.")
}

/** A window's text and picture, and what's at `p` in it: in words, and where in its picture (`frame`, the window's). */
async function context(window: number, p: Point | null, frame?: Rect | null): Promise<{ screen?: string; shot?: string | null; under?: string; spot?: string; sx?: number; sy?: number }> {
  // (no window in front, as on the desktop: what's under the pointer, and the screen around it)
  if (!window) { const { app: _, ...c } = await pointerContext(p ?? screen.getCursorScreenPoint()); return c }
  const [t, shot, under] = await Promise.all([screenAsk<{ ok?: boolean; text?: string }>("text", { window, max: 20_000 }), windowShot(window, SHOTS()), p ? underAt(p) : null])
  const spot = p && frame ? spotIn(frame, p) : null
  return { screen: t.ok ? t.text : undefined, shot, ...(under ? { under: under.text } : {}), ...(shot && spot ? { spot } : {}) }
}

type Under = { ok?: boolean; vaultite?: boolean; bundle?: string; name?: string; role?: string; label?: string; in?: string }
/** What's under a point of the screen, in words (`Finder: folder "Taxes", in "Desktop"`); null on Vaultite, nothing, or a
 *  private app's. */
async function underAt(p: Point): Promise<{ text: string; bundle: string } | null> {
  const u = await screenAsk<Under>("under", { x: p.x, y: p.y }).catch(() => null)
  if (!u?.ok || u.vaultite || hidden(u)) return null
  const what = [u.role, u.label && JSON.stringify(u.label)].filter(Boolean).join(" ")
  if (!what) return null
  return { text: `${u.name || u.bundle}: ${what}${u.in && u.in !== u.label ? `, in ${JSON.stringify(u.in)}` : ""}`, bundle: u.bundle ?? "" }
}

/** Where there's no window (the desktop): what's under the pointer, and a picture of the screen around it. */
async function pointerContext(p: Point) {
  const d = screen.getDisplayNearestPoint(p).bounds, w = Math.min(1200, d.width), h = Math.min(800, d.height)
  const r = { x: Math.max(d.x, Math.min(d.x + d.width - w, p.x - w / 2)), y: Math.max(d.y, Math.min(d.y + d.height - h, p.y - h / 2)), width: w, height: h }
  const [under, shot] = await Promise.all([underAt(p), regionShot(r, SHOTS())])
  return { sx: Math.round(p.x), sy: Math.round(p.y), shot, ...(under ? { under: under.text, app: under.bundle } : {}) }
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
  if (s.into === "panel") chatChanged()
}

/** Its words: into the field (joined to what's before its caret), or into the conversation's box (a Talk key's: sent). */
async function finish(s: Session, cancelled: boolean) {
  const text = s.finals.reduce((all, t) => all + joinText(all, t), "").trim()
  if (s.into === "panel") return chatChanged(cancelled || !text ? undefined : { text, listening: false, done: true, ...(s.talk ? { send: true } : {}) })
  if (cancelled || !text) return
  const r = await screenAsk<{ ok?: boolean; why?: string }>("insert", { text: joinText(s.focus.before ?? "", text) })
  if (!r.ok && r.why === "no-field") notice("lost", "Couldn't put the words in", "The field lost the keyboard while you spoke.")
}

/** What's at a point the user asked about: its window (the cursor left on that spot of it), else what's under it. A
 *  private app's ask is only what they said: not even which app. */
async function pointedAt(name: string, p: Point, w: AppWindowInfo | null): Promise<Record<string, unknown>> {
  if (!w?.window || w.vaultite) return pointerContext(p)
  if (hidden(w)) return { app: "private" }
  if (w.frame) park(name, w.window, offsetIn(w.frame, p))
  const c = await context(w.window, p, w.frame)
  return { app: w.bundle, window: w.window, title: w.title, ...c, shot: c.shot ?? undefined }
}

// ---------- a cursor clicked: its conversation, and a box to ask it (typed, or said into it)

/** The app in front as the conversation opened: a docked companion's ask is about its window. */
let chatFront: AppWindowInfo | null = null
/** Words said into the box, the last time they were done: given it once. */
let chatWords: PanelData["words"] = undefined
let wordsId = 0

function chatOf(name: string): PanelData | null {
  // (the companion not started yet: talking to it starts it, its box there meanwhile)
  const a = live.state.agents.get(name) ?? (name === live.state.name ? { name, tint: "orange", state: "away" } as Agent : null)
  if (!a) return null
  const items = live.state.said.filter((n) => n.agent === name && (n.kind === "say" || n.kind === "ask") && n.text)
    .map((n) => ({ id: n.id, kind: n.kind, text: n.text, t: n.t, ...(n.question ? { question: true } : {}) }))
  const s = session?.into === "panel" ? session : null
  const words = s ? { text: [...s.finals, s.pending].reduce((all, t) => (t ? all + joinText(all, t) : all), "").trim(), listening: true } : chatWords
  const busy = a.state === "thinking" || a.state === "reading" || a.state === "writing" || a.state === "starting"
  return { name, tint: a.tint, how: howWith(a, live.state.harnesses), items, ...(words ? { words } : {}), ...(busy ? { busy } : {}) }
}

/** Its conversation open by its cursor (`at`, the screen's): its bubble goes into it, all of it seen. */
function openChat(name: string, at: Point) {
  if (!based) return
  chatWords = undefined
  talkAt = null
  const d = chatOf(name)
  if (!d) return
  chatFront = front && !front.vaultite ? front : null
  for (const n of live.state.notes.values()) if (n.kind === "say" && n.agent === name && !n.dismissed) live.say({ t: "hide", id: n.id })
  openPanel(based, at, d)
  seeSaid(name)
  draw()
}
function seeSaid(name: string) {
  const ids = live.state.said.filter((n) => n.agent === name && n.kind === "say" && !n.seen).map((n) => n.id)
  if (ids.length) live.say({ t: "saw", ids })
}
/** What it shows changed (its words, dictation into its box); `done`: words said, for its box. */
function chatChanged(done?: PanelData["words"]) {
  const name = panelOpen()
  if (!name) return
  if (done) chatWords = { ...done, id: ++wordsId }
  const d = chatOf(name)
  if (d) panelData(d)
  seeSaid(name)
}

/** An ask typed in a cursor's conversation: about where its cursor is (a window, a point), or, docked, the app that
 *  was in front. */
async function askFrom(name: string, text: string) {
  // (a Talk key's: about the point it was pressed at; what follows there, about where its cursor is then)
  const t = talkAt
  if (t) { talkAt = null; return void live.say({ t: "moment", kind: "ask", agent: name, text, ...(await pointedAt(name, t.p, t.w)) }) }
  const a = live.state.agents.get(name)
  const where = a && onScreen(a) ? drawnAt.get(keyOf(a)) ?? null : null
  const win = a && onScreen(a) ? a.window ?? 0 : chatFront?.window ?? 0
  let place: Record<string, unknown>
  if (a && onScreen(a) && !a.app) place = await pointerContext(where ?? { x: a.sx ?? 0, y: a.sy ?? 0 })
  else if (win) {
    const w = await screenAsk<AppWindowInfo>("window", { window: win, bundle: a?.app ?? chatFront?.bundle ?? "" })
    if (hidden(w)) place = { app: "private" }
    else if (!w.window) place = await pointerContext(screen.getCursorScreenPoint())
    else { const c = await context(w.window, where, w.frame); place = { app: w.bundle, window: w.window, title: w.title, ...c, shot: c.shot ?? undefined } }
  } else place = await pointerContext(screen.getCursorScreenPoint())
  live.say({ t: "moment", kind: "ask", agent: name, text, ...place })
}

// ---------- the cursor over the screen

/** Places on screen resolved to points (an element's frame by its text, a window's), kept a moment: windows move. Each
 *  knows its window and its frame then, so a move of it (told by the screen helper) moves the point at once. */
type Placed = { at: number; p: Point | null; pending: boolean; win?: number; frame?: Rect | null; find?: boolean
  /** Where in its window the user left it (parks): it moves with the window. */
  off?: { dx: number; dy: number }
  /** A window in front covers it (Vaultite's, another app's): it isn't drawn, pointing at nothing seen. */
  covered?: boolean }
const placed = new Map<string, Placed>()
/** Where the user left each agent's cursor in a window (dropped there, or pointed at as they asked): that spot of it, not
 *  its title bar, as the window moves. */
const parks = new Map<string, { window: number; dx: number; dy: number }>()
function park(name: string, window: number, o: { dx: number; dy: number }) {
  parks.set(name, { window, ...o })
  for (const [k, e] of placed) if (k.startsWith(`${name}:`)) e.at = 0
}
const placeKey = (a: Agent) => `${a.name}:${a.app ?? ""}|${a.window ?? ""}|${a.find ?? ""}|${a.sx ?? ""}|${a.sy ?? ""}`
const onScreen = (a: Agent) => !a.path && (!!a.app || (typeof a.sx === "number" && typeof a.sy === "number"))
/** `r` with whether a window in front of its own covers its point. */
async function seen(r: Omit<Placed, "at" | "pending">): Promise<Omit<Placed, "at" | "pending">> {
  if (!r.p) return r
  const c = await screenAsk<{ covered?: boolean }>("covered", { window: r.win ?? 0, x: r.p.x, y: r.p.y }).catch(() => null)
  return { ...r, covered: !!c?.covered }
}
async function resolve(a: Agent): Promise<Omit<Placed, "at" | "pending">> {
  return seen(await find(a))
}
async function find(a: Agent): Promise<Omit<Placed, "at" | "pending">> {
  if (typeof a.sx === "number" && typeof a.sy === "number") return { p: { x: a.sx, y: a.sy } }
  if (!a.app || hidden({ bundle: a.app, name: a.app })) return { p: null }
  if (a.find) {
    const r = await screenAsk<{ ok?: boolean; found?: Rect | null; window?: number; frame?: Rect | null }>("find", { window: a.window ?? 0, bundle: a.app, text: a.find })
    if (r.found) return { p: pointIn(r.found, true), win: r.window, frame: r.frame, find: true }
  }
  const w = await screenAsk<AppWindowInfo>("window", { window: a.window ?? 0, bundle: a.app })
  if (!w.frame) return { p: null }
  const pk = parks.get(a.name), off = pk && pk.window === w.window ? { dx: pk.dx, dy: pk.dy } : undefined
  return { p: off ? atOffset(w.frame, off) : pointIn(w.frame, false), win: w.window, frame: w.frame, ...(off ? { off } : {}) }
}
function pointOf(a: Agent): Placed {
  const k = placeKey(a), had = placed.get(k)
  // (a plain point is there at once; whether it's covered comes a moment later)
  if (typeof a.sx === "number" && typeof a.sy === "number" && !had) {
    const p = { x: a.sx, y: a.sy }
    placed.set(k, { p, at: Date.now(), pending: false })
    void seen({ p }).then((r) => { placed.set(k, { ...r, at: Date.now(), pending: false }); draw() })
    return placed.get(k)!
  }
  if (!had || (!had.pending && Date.now() - had.at > (a.find ? 3000 : 1000))) {
    placed.set(k, { ...(had ?? { p: null }), at: Date.now(), pending: true })
    const done = (r: Omit<Placed, "at" | "pending">) => { placed.set(k, { ...r, at: Date.now(), pending: false }); draw() }
    void resolve(a).then(done, () => done({ p: null }))
  }
  return placed.get(k)!
}

/** The windows the cursors point at are watched for moves and resizes (screen.swift's AXObservers), only those. */
let watched = ""
function watchWindows() {
  const used = new Set([...live.state.agents.values()].filter(onScreen).map(placeKey))
  for (const [k, e] of placed) if (!used.has(k) && Date.now() - e.at > 60_000) placed.delete(k)
  const wins = [...new Set([...placed].filter(([k, e]) => used.has(k) && e.win).map(([, e]) => e.win!))].sort()
  if (wins.join() === watched) return
  watched = wins.join()
  void screenAsk("watch", { windows: wins }).catch(() => {})
}
const refinding = new Map<number, ReturnType<typeof setTimeout>>()
/** A watched window moved or resized: its points move with it now; an element in a resized one is found again once it settles. */
function windowMoved(m: Record<string, unknown>) {
  const win = Number(m.window) || 0, f = m.frame as Rect | null
  for (const e of placed.values()) {
    if (win && e.win !== win) continue
    if (m.gone || !f) { e.at = 0; continue }
    if (!e.find) e.p = e.off ? atOffset(f, e.off) : pointIn(f, false)
    else if (e.p && e.frame) e.p = { x: e.p.x + f.x - e.frame.x, y: e.p.y + f.y - e.frame.y }
    const resized = !!e.frame && (e.frame.width !== f.width || e.frame.height !== f.height)
    e.frame = f
    if (e.find && resized) {
      clearTimeout(refinding.get(win))
      refinding.set(win, setTimeout(() => { refinding.delete(win); for (const x of placed.values()) if (x.win === win) x.at = 0; draw() }, 300))
    }
  }
  draw()
}

/** Where each cursor (`agent:<name>`, or `idle`: the companion waiting) was drawn last, and where it came from a
 *  moment ago: one new to a display glides in from there. */
const drawnAt = new Map<string, Point>(), cameFrom = new Map<string, { p: Point; until: number }>()
const FROM_MS = 900
let fromTimer: ReturnType<typeof setTimeout> | undefined
function cameFromAt(key: string, p: Point) {
  cameFrom.set(key, { p, until: Date.now() + FROM_MS })
  clearTimeout(fromTimer)
  fromTimer = setTimeout(draw, FROM_MS + 20)
}
function movedFrom(key: string, p: Point) {
  const was = drawnAt.get(key)
  drawnAt.set(key, p)
  if (was && (was.x !== p.x || was.y !== p.y)) cameFromAt(key, was)
  const c = cameFrom.get(key)
  if (c && c.until < Date.now()) cameFrom.delete(key)
  return c && c.until >= Date.now() ? c.p : undefined
}

// ---------- one cursor, two drawers: the window draws its agents in it, this the rest; between them it glides, never jumps

/** Where the window's own cursors are (plugins/core/companion/Overlay.tsx), in screen points: `at` where each is drawn
 *  now (mid-glide too), `to` where it's going. Read from its page's DOM, never its code; none while it isn't on screen. */
async function inApp(): Promise<Map<string, { at: Point; to: Point }>> {
  const w = host?.homeWindow()
  if (!w || w.page.isDestroyed()) return new Map()
  const code = `[...document.querySelectorAll(".companion-cursor[data-agent]")].map((el) => { const r = el.getBoundingClientRect(),
    m = /^(-?[\\d.]+),(-?[\\d.]+)$/.exec(el.dataset.to ?? ""); return [el.dataset.agent, r.left, r.top, m ? +m[1] : r.left, m ? +m[2] : r.top] })`
  const rows = await w.page.executeJavaScriptInIsolatedWorld(1007, [{ code }]).catch(() => []) as [string, number, number, number, number][]
  // (its tip: 3, 2 into the box, as both draw the arrow)
  const pt = (x: number, y: number) => ({ x: Math.round(w.bounds.x + (x + 3) * w.zoom), y: Math.round(w.bounds.y + (y + 2) * w.zoom) })
  return new Map((Array.isArray(rows) ? rows : []).map(([name, x, y, tx, ty]) => [name, { at: pt(x, y), to: pt(tx, ty) }]))
}

/** A cursor new on screen whose agent was in the window: shown once where it was there is known (a few ms). */
const fromWindow = new Map<string, { p: Point | null; asked: number }>()
/** Cursors gone from the screen into the window: drawn a moment longer, gliding to where the window draws them, fading. */
const intoWindow = new Map<string, { item: ScreenAgent | NonNullable<Scene["idle"]>; to: Point | null; until: number }>()
const INTO_MS = 450
let drawnKeys = new Map<string, string>()
const keyOf = (x: { name: string }, idle = false) => (idle ? "idle" : `agent:${x.name}`)

/** The scene as wanted, made one cursor: a cursor that appears comes from where its agent was (its other form on screen,
 *  else the window's cursor), and one that goes into the window glides there first. */
function handOff(agents: ScreenAgent[], idle: Scene["idle"]): { agents: ScreenAgent[]; idle: Scene["idle"] } {
  const items = new Map<string, ScreenAgent | NonNullable<Scene["idle"]>>(agents.map((a) => [keyOf(a), a]))
  if (idle) items.set("idle", idle)
  const shown = !!host?.homeWindow()
  for (const k of fromWindow.keys()) if (!items.has(k)) fromWindow.delete(k)
  for (const [k, it] of [...items]) {
    if (drawnKeys.has(k)) continue
    // (its other form, the cursor or the companion waiting, was drawn: from there)
    const twin = [...drawnKeys].find(([k2, name]) => k2 !== k && name === it.name && !items.has(k2))
    if (twin && drawnAt.has(twin[0])) { cameFromAt(k, drawnAt.get(twin[0])!); continue }
    const asked = fromWindow.get(k)
    if (asked && (asked.p || asked.asked === 0 || Date.now() - asked.asked > 150)) { fromWindow.delete(k); if (asked.p) cameFromAt(k, asked.p); continue }
    if (asked) { items.delete(k); continue }
    if (!shown) continue
    // (asked first: drawn once the window says where it was)
    const ask = { p: null as Point | null, asked: Date.now() }
    fromWindow.set(k, ask)
    items.delete(k)
    void inApp().then((m) => { if (fromWindow.get(k) !== ask) return; Object.assign(ask, { p: m.get(it.name)?.at ?? null, asked: 0 }); draw() })
    setTimeout(draw, 160)
  }
  for (const [k, name] of drawnKeys) {
    if (items.has(k) || intoWindow.has(k) || !shown) continue
    const a = live.state.agents.get(name), last = lastScene && (k === "idle" ? lastScene.idle : lastScene.agents.find((x) => x.name === name))
    // (into the window: its place went there, or they came back to it; else it fades where it is)
    const into = k === "idle" ? !!front?.vaultite : !!a && !onScreen(a)
    if (!a || a.state === "away" || !last || !into || [...items.values()].some((x) => x.name === name)) continue
    const going = { item: last, to: null as Point | null, until: Date.now() + INTO_MS }
    intoWindow.set(k, going)
    // (a moment for the window to draw it where it's going)
    setTimeout(() => void inApp().then((m) => { going.to = m.get(name)?.to ?? null; draw() }), 60)
    setTimeout(draw, INTO_MS + 20)
  }
  drawnKeys = new Map([...items].map(([k, it]) => [k, it.name]))
  for (const k of new Set([...drawnAt.keys(), ...cameFrom.keys()])) if (!items.has(k)) { drawnAt.delete(k); cameFrom.delete(k) }
  for (const [k, into] of intoWindow) {
    if (items.has(k) || Date.now() > into.until) { intoWindow.delete(k); continue }
    const p = into.to ?? { x: into.item.sx, y: into.item.sy }
    items.set(k, { ...into.item, sx: p.x, sy: p.y, from: undefined, leaving: true })
  }
  const out = [...items].map(([k, it]) => {
    const from = it.leaving ? undefined : movedFrom(k, { x: it.sx, y: it.sy })
    return [k, from ? { ...it, from } : it] as const
  })
  return { agents: out.filter(([k]) => k !== "idle").map(([, it]) => it as ScreenAgent), idle: (out.find(([k]) => k === "idle")?.[1] as Scene["idle"]) ?? null }
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
    // (a new place being found: it stays where it was meanwhile, or where it waited)
    const e = pointOf(a), p = e.p ?? (e.pending ? drawnAt.get(keyOf(a)) ?? (a.name === live.state.name ? drawnAt.get("idle") : undefined) : null)
    if (!p || e.covered) continue
    // (its conversation open: its words are there)
    const say = panelOpen() === a.name ? undefined : says.filter((n) => n.agent === a.name).at(-1)
    agents.push({ name: a.name, tint: a.tint, state: a.state, sx: p.x, sy: p.y, t: a.t, ...(a.seen ? { seen: true } : {}), ...(a.why ? { why: a.why } : {}),
      ...(say?.text ? { say: { id: say.id, text: say.text, ...(say.question ? { question: true } : {}) } } : {}) })
  }
  const own = live.state.agents.get(live.state.name)
  // (waiting while they're in another app: the window draws its own while Vaultite's in front)
  const idleOn = !!own && own.state !== "away" && live.state.mode !== "off" && prefs.cursor !== "app" && !onScreen(own) && !!front && !front.vaultite
  const want = idleOn && prefs.cursor === "trail"
  if (want && !trailing) trailing = setInterval(draw, 33)
  else if (!want && trailing) { clearInterval(trailing); trailing = null }
  let idle: Scene["idle"] = null
  if (idleOn) {
    const ptr = screen.getCursorScreenPoint()
    const unread = live.state.said.some((n) => n.agent === own!.name && n.kind === "say" && !n.seen)
    if (prefs.cursor === "trail") idle = { name: own!.name, tint: own!.tint, sx: ptr.x + 14, sy: ptr.y + 16, docked: false, ...(unread ? { unread: true } : {}) }
    else {
      // (at its edge of the display with the window in front, where the user left it)
      const d = front?.frame ? screen.getDisplayMatching({ x: Math.round(front.frame.x), y: Math.round(front.frame.y), width: Math.max(1, Math.round(front.frame.width)), height: Math.max(1, Math.round(front.frame.height)) }) : screen.getDisplayNearestPoint(ptr)
      const dock = dockOf(host!.prefs().dock), p = dockPoint(d.workArea, dock)
      idle = { name: own!.name, tint: own!.tint, sx: p.x, sy: p.y, docked: true, side: dock.side, ...(unread ? { unread: true } : {}) }
    }
  }
  if (own && prefs.cursor === "trail") returnToPointer(own, says)
  watchWindows()
  const s = session
  const hintNow = hinted && hinted.until > Date.now() ? hinted : null
  const pill: Scene["pill"] = s && s.into !== "panel" ? { level: s.level, text: s.pending || s.finals.at(-1) || "", ready: s.ready, ...(s.focus.frame ? { display: displayOf(s.focus.frame) } : {}) }
    : hintNow ? { level: 0, text: hintNow.text, ready: true, hint: true } : null
  lastScene = { ...handOff(agents, idle), pill }
  showOverlay(based || null, lastScene)
}
/** Following the pointer, the companion only goes off to point: once it's done there (idle a while, its words gone, its
 *  conversation closed), it comes back to the pointer. One the user dropped on a window (it follows it) stays. */
const RETURN_MS = 6000
let returnTimer: ReturnType<typeof setTimeout> | undefined, returned = ""
function returnToPointer(own: Agent, says: Note[]) {
  if (!onScreen(own) || own.state !== "watching" || following?.name === own.name || panelOpen() === own.name || says.some((n) => n.agent === own.name)) return
  const left = RETURN_MS - (Date.now() - (own.t ?? 0)), once = `${own.name}:${own.t ?? 0}`
  clearTimeout(returnTimer)
  if (left > 0) { returnTimer = setTimeout(draw, left + 50); return }
  if (returned === once) return
  returned = once
  comeBack(own.name)
}
const displayOf = (r: Rect) => screen.getDisplayMatching({ x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) }).id

// ---------- dropped on a window: "look at this", then follow it

type Follow = { name: string; info: AppWindowInfo; text: string; changed: string | null; sent: number; timer: ReturnType<typeof setInterval>; until: number }
let following: Follow | null = null
const FOLLOW_MS = 4000, FOLLOW_FOR = 30 * 60_000, FOLLOW_GAP = 20_000

/** The companion's cursor dropped at a point of the screen (the overlay's or a window's drag): the window there. */
export async function dropAt(name: string, x: number, y: number) {
  // (by the screen's left or right edge: it docks there, and waits there from now on)
  const d = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }), dock = dockAt(d.bounds, d.workArea, { x, y })
  if (dock) { host?.setPrefs({ dock }); comeBack(name); return draw() }
  const w = await screenAsk<AppWindowInfo>("at", { x, y })
  unfollow()
  // (on no window, as the desktop's icons or the menu bar: a point at what's there, nothing to follow; with nothing
  // Accessibility reads, its picture alone)
  if (!w.window && !w.vaultite) {
    const c = await pointerContext({ x, y })
    live.say({ t: "moment", kind: "point", agent: name, ...c, shot: c.shot ?? undefined })
    return
  }
  if (!w.window || w.vaultite || hidden(w)) return
  // (it stays where it was let go, on that spot of the window; what's there, in words, is what they point at)
  if (w.frame) park(name, w.window, offsetIn(w.frame, { x, y }))
  const [t, shot, under] = await Promise.all([screenAsk<{ ok?: boolean; text?: string }>("text", { window: w.window, max: 20_000 }), windowShot(w.window, SHOTS()), underAt({ x, y })])
  const text = t.ok ? t.text ?? "" : "", spot = shot && w.frame ? spotIn(w.frame, { x, y }) : null
  live.say({ t: "moment", kind: "point", agent: name, app: w.bundle, window: w.window, title: w.title, screen: text, ...(shot ? { shot } : {}), ...(under ? { under: under.text } : {}), ...(spot ? { spot } : {}) })
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
