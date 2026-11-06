/** The menu-bar helper (a Mac's; one per Mac, a lock): the app and its home vault's server kept with no window: the keys
 *  (dictation's; the companion summoned over the screen, overlay.ts), screen reading, what's in front. electron/CLAUDE.md. */
import { app, Menu, Notification, nativeImage, screen, shell, Tray, type BrowserWindow, type WebContents } from "electron"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { WebSocket } from "ws"
import { ALONE_MS, fnActsToo, fnKey, isChord, keyCodes, modKeys, talkGesture, type FnAction, type FnEvent, type ModEvent, type TalkAction } from "../core/fnkey.ts"
import { joinText, parseReplacement, replacer } from "../core/dictationtext.ts"
import { privateApp } from "../core/privateapps.ts"
import { dictate, dictating, stopFor, dictationEngines, type DictationSink } from "./dictation.ts"
import { howWith } from "../plugins/core/companion/look.ts"
import { icon } from "./menu.ts"
import { atOffset, badgeOf, type HelperJob, inkOf, jobNews, jobsShown, offsetIn, pointIn, prefsOf, type Point, type Prefs, type Scene, type ScreenAgent } from "./helperlogic.ts"
import { closePanel, drawingActs, endDrawing, onPanel, openPanel, overlayActs, ownWindows, panelBounds, panelData, panelFocused, panelMenuClosed, panelOpen, showDrawing, showOverlay, type PanelData } from "./overlay.ts"
import { displayShot as shootDisplay, fnUsage, onScreenEvent, screenAsk as askHelper, startScreen, stopScreen, windowShot as shoot, type AppWindowInfo, type Focus, type Rect } from "./screen.ts"
import { elementPlaces } from "./drawing.ts"

/** The vault the helper serves: its server's port, and how it's called. */
export type Home = { port: number; path: string; name: string }
/** This Mac's say (vaults.json): open at login, and the notice about macOS acting on fn too, shown. */
export type HelperPrefs = { login?: boolean; fnNotice?: boolean }
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
const displayShot = (p: Point, exclude: number[]) => (QUIET ? Promise.resolve(null) : shootDisplay(p, exclude, SHOTS()))
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
    asked: () => [...asked], scene: () => lastScene, badge: () => badged, menu: () => menuItems() } })
  onScreenEvent(heard)
  overlayActs({ open: openChat, stop: () => { if (session) stopFor(session.sink) } })
  drawingActs((a) => live.say({ t: "drawing-act", ...a }))
  onPanel({ send: (name, text) => void askFrom(name, text), mic: () => act(session || starting ? "stop" : "start"), more: panelMenu,
    closed: () => { if (session?.into === "panel") stopFor(session.sink, true); endExchange(); draw() } })
  if (!QUIET) await startScreen().catch((e) => console.error("vaultite: the screen helper didn't start:", e))
  // (a copy a script drives (web/qa/helper.mjs) shows nothing in the menu bar and never hears the user's fn)
  if (!QUIET) {
    void listen()
    const icon = nativeImage.createFromPath(h.icon)
    icon.setTemplateImage(true)
    tray = new Tray(icon)
    tray.setToolTip(app.getName())
    tray.on("click", () => tray?.popUpContextMenu(Menu.buildFromTemplate(menuItems())))
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

/** Its cursor off the screen: done there (its exchange over, idle, its words gone). */
function leave(name: string) {
  parks.delete(name)
  live.say({ t: "home", agent: name })
}

/** Its conversation's More. */
function panelMenu(_name: string, at: { window: BrowserWindow; x: number; y: number }) {
  const mode = (m: string) => () => void op("settings.set", { name: "plugin/companion", values: { mode: m } })
  Menu.buildFromTemplate([
    { label: "Quiet", type: "radio", checked: live.state.mode === "quiet", click: mode("quiet") },
    { label: "Pair", type: "radio", checked: live.state.mode === "pair", click: mode("pair") },
  ]).popup({ ...at, callback: panelMenuClosed })
}

// ---------- the menu bar

function menuItems(): Electron.MenuItemConstructorOptions[] {
  const h = host!, home = h.home()
  const setting = (name: string, values: Record<string, unknown>) => () => void op("settings.set", { name, values }).then(refresh)
  const name = live.state.name, unread = unreadSays().length
  const jobs = jobsShown(live.state.jobs ?? [])
  return [
    { label: home ? `Open ${home.name}` : `Open ${app.getName()}`, icon: icon("stone"), click: () => h.openHome() },
    { type: "separator" },
    { label: "Dictate anywhere", icon: icon("mic"), sublabel: keysSaid(prefs.keys), type: "checkbox", checked: prefs.fn, enabled: !!home, click: setting("plugin/dictation", { fn: !prefs.fn }) },
    { type: "separator" },
    { label: name || "Companion", type: "header", sublabel: prefs.talk.length ? `Hold ${keysSaid(prefs.talk)} to talk to it` : undefined },
    // (what it said that wasn't seen: the menu bar icon's badge)
    { label: unread ? `What it said (${unread} new)` : "What it said", icon: icon("message-circle"), enabled: !!name && live.state.said.some((n) => n.agent === name && n.kind === "say"),
      click: () => openChat(name, screen.getCursorScreenPoint()) },
    // (what it handed off: a click opens its tab in Vaultite)
    ...(jobs.length ? [{ type: "separator" as const }, { label: "Jobs", type: "header" as const },
      ...jobs.map((j) => ({ label: j.title || "A job", sublabel: `${JOB_SAID[j.state] ?? j.state}${j.unseen ? ", new" : ""}`, icon: jobIcon(j.state), enabled: !!j.link, click: () => void openJob(j) }))] : []),
    { type: "separator" },
    { label: "Open at login", icon: icon("power"), type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (i) => { login(i.checked); h.setPrefs({ login: i.checked }) } },
    { label: `Quit ${app.getName()}`, accelerator: "Command+Q", click: () => h.quit() },
  ]
}

const JOB_SAID: Record<string, string> = { running: "Working", "needs you": "Needs you", done: "Done", failed: "Failed" }
const jobIcon = (state: string) => (state === "running" ? icon("clock") : state === "needs you" ? icon("circle-alert") : state === "failed" ? icon("circle-x") : icon("circle-check"))
/** A job opened: its tab in the home vault's window (opened first if need be), and it's no longer news. */
async function openJob(j: HelperJob) {
  live.say({ t: "job-seen", ids: [j.id] })
  if (!j.link || !host) return
  host.openHome()
  // (a window just opening has no page to open it in yet)
  for (let i = 0; i < 20; i++) {
    if (await op("ui.open", { path: j.link }).then(() => true, () => false)) return
    await new Promise((r) => setTimeout(r, 500))
  }
}
/** A job ended or needs them: a notification, whose click opens it. */
function jobNotice(j: HelperJob) {
  if (QUIET) return void asked.push({ notice: "job", id: j.id, state: j.state })
  if (!Notification.isSupported()) return
  const n = new Notification({ title: j.state === "needs you" ? "A job needs you" : j.state === "failed" ? "A job stopped" : "A job is done", body: j.title, silent: true })
  n.on("click", () => void openJob(j))
  n.show()
}

/** Keys as a Mac writes them: "fn⌃, right ⌥ or ⌃⌥". */
function keysSaid(keys: string[]) {
  const said = keys.map((k) => ({ fn: "fn", right_option: "right ⌥", right_command: "right ⌘", control_option: "⌃⌥", fn_control: "fn⌃" } as Record<string, string>)[k]).filter(Boolean)
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
let prefs: Prefs = { fn: true, keys: DEFAULTS.dictation.keys?.default ?? [], talk: DEFAULTS.companion.keys?.default ?? [], privateApps: DEFAULTS.screen.private_apps?.default ?? [], dictation: {} }
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
  /** What it points at on screen (an element of an ask's list): its words never cover it. */
  frame?: Rect
  runs?: string; model?: string; effort?: string }
type Note = { id: string; kind: string; agent: string; t: number; text?: string; question?: boolean; dismissed?: number; seen?: boolean }
/** The companion's socket, as the helper (?screen=1): the agents and their bubbles, and what the user asks on screen. */
const live = (() => {
  let ws: WebSocket | null = null, port: number | null = null, wait = 1000, timer: ReturnType<typeof setTimeout> | null = null
  const state = { mode: "quiet", name: "", agents: new Map<string, Agent>(), notes: new Map<string, Note>(),
    /** Each agent's last says and what the user asked it: its conversation. */
    said: [] as Note[], harnesses: [] as Parameters<typeof howWith>[1],
    /** What it handed off (null till the server says): the menu's Jobs. */
    jobs: null as HelperJob[] | null }
  const connect = () => {
    timer = null
    if (port === null) return
    const s = new WebSocket(`ws://127.0.0.1:${port}/api/companion/live?screen=1`)
    ws = s
    s.on("open", () => { wait = 1000 })
    s.on("message", (d) => {
      let m: Record<string, unknown>
      try { m = JSON.parse(String(d)) } catch { return }
      // (the companion's drawing over the screen: the server's, its places found there)
      if (m.t === "drawing") return showDrawing((m.drawing as Parameters<typeof showDrawing>[0]) ?? null, elementPlaces(lastNear))
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
      else if (m.t === "jobs" && Array.isArray(m.jobs)) {
        const jobs = m.jobs as HelperJob[]
        for (const j of jobNews(state.jobs, jobs)) jobNotice(j)
        state.jobs = jobs
        return badge()
      } else return
      draw()
      chatChanged()
    })
    s.on("error", () => {})
    s.on("close", () => { if (ws === s) { ws = null; if (port !== null) { timer = setTimeout(connect, wait); wait = Math.min(wait * 2, 30_000) } } })
  }
  return {
    state,
    open(p: number | null) { this.close(); port = p; if (p !== null) connect() },
    close() { port = null; if (timer) clearTimeout(timer); timer = null; ws?.close(); ws = null; state.agents.clear(); state.notes.clear(); state.said = []; state.jobs = null; showDrawing(null) },
    say(m: object) { if (QUIET) asked.push(m); if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(m)); return true } return false },
  }
})()

// ---------- what's in front (awareness: metadata only)

let front: AppWindowInfo | null = null
const hidden = (a: { bundle?: string; name?: string } | null) => !!a && privateApp(a, prefs.privateApps)

function heard(m: Record<string, unknown>) {
  if (m.event === "fn") return prefs.talk.includes("fn") ? talkHeard(m as FnEvent) : prefs.keys.includes("fn") ? fnHeard(m) : undefined
  if (m.event === "mod") return modHeard(m)
  if (m.event === "chord") return chordHeard(m)
  if (m.event === "ink") return inkHeard(m)
  if (m.event === "moved") return windowMoved(m)
  // (its answer showing: a click elsewhere or Esc ends the exchange)
  if (m.event === "click") { const b = panelBounds(), x = Number(m.x), y = Number(m.y); if (!b || x < b.x || y < b.y || x > b.x + b.width || y > b.y + b.height) endExchange(); return }
  if (m.event === "esc") return endExchange()
  if (m.event === "front") {
    // (another app in front: they moved on)
    if (exchange && !m.vaultite && front && m.bundle !== front.bundle) endExchange()
    front = m as unknown as AppWindowInfo
    // (another app in front may cover or uncover what the cursors point at: looked at again)
    for (const e of placed.values()) e.at = 0
    host?.event("screen:front", hidden(front) ? { bundle: front.bundle, name: front.name, private: true } : { bundle: front.bundle, name: front.name, title: front.title, window: front.window, vaultite: !!front.vaultite })
    return draw()
  }
  if (m.event === "tap" && (m.ok === false || m.ink === false)) notice("tap", m.ok === false ? "Dictation and Talk keys need Vaultite in Accessibility" : "Drawing while you talk needs Vaultite in Accessibility",
    "Allow it in System Settings, Privacy & Security, Accessibility, then press one again.", "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility")
  if (m.event === "exit" && host) setTimeout(() => { if (host) void startScreen().then(listen).catch(() => {}) }, 2000)
}

const said = new Set<string>()
/** A notice once a launch (`once`: once ever, kept in vaults.json under that name); a click opens `link`. */
function notice(key: string, title: string, body: string, link?: string, once?: "fnNotice") {
  if (QUIET) return void asked.push({ notice: key })
  if (said.has(key) || !Notification.isSupported()) return
  said.add(key)
  const n = new Notification({ title, body, silent: true })
  if (link) n.on("click", () => void shell.openExternal(link))
  n.show()
  if (once) host?.setPrefs({ [once]: true })
}

// ---------- the dictation keys: dictation anywhere

const key = fnKey()
/** The helper's own session: words into another app's field, into a cursor's conversation, or the companion summoned
 *  (`summon`: its words by its cursor, sent when let go); `talk`: a Talk key's, sent when it stops. */
type Session = { sink: DictationSink; into: "field" | "panel" | "summon"; focus: Focus; finals: string[]; pending: string; level: number; ready: boolean
  swap: [RegExp, string][]; talk?: boolean }
let session: Session | null = null
/** The window's page that has this press (fn there is its ⌘J; a Talk key's gesture its companion's), till it's let go. */
let page: WebContents | null = null, talkPage: WebContents | null = null

/** The screen helper's tap hears the picked keys only: the dictation keys (none while Dictate anywhere is off) and the
 *  Talk keys, a key alone by its code, a chord by its name. */
const heardKeys = () => (prefs.fn ? prefs.keys : [])
const keysNow = () => `${heardKeys().join()}|${prefs.talk.join()}`
const listen = () => { const all = [...heardKeys(), ...prefs.talk]; return screenAsk("fn", { keys: keyCodes(all), chords: all.filter(isChord) }) }
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
function modHeard(m: Record<string, unknown>) {
  const r = mods.heard(m as ModEvent), t = talkMods.heard(m as ModEvent)
  if (settling) clearTimeout(settling)
  settling = r.wait ? setTimeout(() => { settling = null; asFn(mods.settled()) }, ALONE_MS) : null
  if (talkSettling) clearTimeout(talkSettling)
  talkSettling = t.wait ? setTimeout(() => { talkSettling = null; asTalk(talkMods.settled()) }, ALONE_MS) : null
  asFn(r.fn)
  asTalk(t.fn)
}
/** A chord (⌃⌥, fn⌃): the companion's if it's a Talk key, else dictation's, as a key's press and release. */
function chordHeard(m: Record<string, unknown>) {
  const name = String(m.name), e: FnEvent = m.other === true ? { other: true } : { down: m.on === true }
  if (prefs.talk.includes(name)) talkHeard(e)
  else if (heardKeys().includes(name)) fnHeard(e)
}

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

/** A session on its way (the field asked for, the recognizer starting): a release meanwhile waits for it. */
let starting = false, startingTalk = false, after: FnAction = null
function act(a: FnAction, talk = false) {
  if (a === "start") {
    starting = true
    startingTalk = talk
    after = null
    void (talk ? startSummon() : begin()).finally(() => { starting = false; startingTalk = false; const then = after; after = null; if (then) act(then) })
  } else if (starting && (a === "stop" || a === "cancel")) after = a
  else if (a === "stop" && session) stopFor(session.sink)
  else if (a === "cancel" && session) stopFor(session.sink, true)
}

// ---------- the Talk keys: the companion summoned at the pointer (HeyClicky's gesture, core/fnkey.ts talkGesture)

const gesture = talkGesture()
/** The companion called up outside Vaultite: its cursor at the pointer (listening, then thinking), the window there, the
 *  ink drawn while the key is held; `was`: where its own cursor was, which hides till its ask moves it. */
type Summon = { name: string; tint: string; p: Point; w: AppWindowInfo | null; state: "listening" | "thinking" | "watching"; ink: Point[][]; at: number; was: string; typing?: boolean }
let summon: Summon | null = null
/** The exchange its answer is in: its box open by the point asked about (and the window there), since `since`. */
let exchange: { name: string; p: Point; w: AppWindowInfo | null; since: number } | null = null

/** A Talk key (alone, or a chord), as its gesture: in a Vaultite window with the keyboard, its page's companion; else
 *  the companion summoned here. */
function talkHeard(m: FnEvent) {
  if (!host?.home()) return
  const now = Date.now(), a = "other" in m ? gesture.other() : m.down ? gesture.down(now) : gesture.up(now)
  if (!a) return
  if (a === "listen") talkPage = host.focusedPage()
  const to = talkPage && !talkPage.isDestroyed() ? talkPage : null
  if (to) { to.send("vaultite:fn", { talk: a }); if (a === "send" || a === "cancel") talkPage = null; return }
  talkPage = null
  talkAct(a)
}

function talkAct(a: NonNullable<TalkAction>) {
  if (a === "listen") return act("start", true)
  if (a === "cancel") { void inkOff(); return act("cancel", true) }
  if (a === "send") {
    // (hands-free in its box: what's in it goes; held: let go here, it thinks here)
    if (session?.into === "summon" || (starting && startingTalk)) { if (summon) Object.assign(summon, { p: screen.getCursorScreenPoint(), state: "thinking" }); void inkOff(); draw() }
    else if (!session && summon?.state === "listening") { summon = null; void inkOff(); return draw() }
    return act("stop", true)
  }
  if (a === "type") {
    // (a tap: its box, focused, to type in; nothing heard)
    if (summon) Object.assign(summon, { typing: true, state: "watching" })
    void inkOff()
    act("cancel", true)
    return openTyping()
  }
  void freeTalk()
}

/** A Talk key held outside Vaultite: its cursor at the pointer, listening, the words by it; drags meanwhile are ink. */
async function startSummon() {
  if (dictating()) return
  const name = live.state.name
  if (live.state.mode === "off") return notice("off", "The companion is off", "Turn it on in the companion's settings to talk to it.")
  if (!name) return hint("The companion isn't ready yet: open Vaultite")
  const p = screen.getCursorScreenPoint(), at = Date.now(), own = live.state.agents.get(name)
  const s: Summon = { name, tint: own?.tint ?? "orange", p, w: null, state: "listening", ink: [], at, was: own ? placeKey(own) : "" }
  summon = s
  live.say({ t: "summoning" })
  void screenAsk("ink", { on: true })
  void screenAsk<AppWindowInfo>("at", { x: p.x, y: p.y }).then((w) => { s.w = w.window ? w : null }, () => {})
  draw()
  await listenFor({ into: "summon", focus: { bundle: "", name: "", pid: 0, window: 0, title: "", field: true }, talk: true })
}
const inkOff = () => screenAsk("ink", { on: false }).catch(() => {})
let inkDrawn: ReturnType<typeof setTimeout> | null = null
/** A point of ink: a stroke begun, drawn on, ended (screen points). */
function inkHeard(m: Record<string, unknown>) {
  const s = summon
  if (!s || s.state !== "listening") return
  const p = { x: Number(m.x), y: Number(m.y) }
  if (m.phase === "down" || !s.ink.length) s.ink.push([p]); else s.ink.at(-1)!.push(p)
  s.p = p
  inkDrawn ??= setTimeout(() => { inkDrawn = null; draw() }, 16)
}

/** The summoned companion's ask (`text`; none, a point at what the ink marks): about the point let go at, with what's
 *  there, the display's picture and what Accessibility finds near it; its answer comes in its box, open by it. */
async function sendSummon(s: Summon, text: string) {
  const ink = s.ink.filter((k) => k.length > 1)
  if (!text && !ink.length) { summon = summon === s ? null : summon; return draw() }
  Object.assign(s, { state: "thinking" })
  draw()
  const w = s.w ?? await screenAsk<AppWindowInfo>("at", { x: s.p.x, y: s.p.y }).catch(() => null)
  const place = await pointedAt(s.name, s.p, w?.window ? w : null)
  live.say({ t: "moment", kind: text ? "ask" : "point", agent: s.name, ...(text ? { text } : {}), ...place, ...(ink.length ? { ink: inkOf(ink) } : {}) })
  // (held again in an exchange: the same thread)
  openAnswer(s.name, s.p, w?.window ? w : null, exchange?.name === s.name ? exchange.since : s.at)
}

/** A tap: its box at the pointer, focused, to type the ask in. */
function openTyping() {
  const name = live.state.name
  if (!name) return
  const p = summon?.p ?? screen.getCursorScreenPoint(), w = summon?.w ?? null
  openChat(name, p)
  if (panelOpen() !== name) return
  exchange = { name, p, w, since: Date.now() }
  void screenAsk("exchange", { on: true })
}
/** A double tap: hands-free, into its box, till the next double tap. */
async function freeTalk() {
  if (panelOpen() !== live.state.name) openTyping()
  for (let i = 0; i < 20 && dictating(); i++) await new Promise((r) => setTimeout(r, 50))
  if (panelOpen()) await listenFor({ into: "panel", focus: { bundle: "", name: "", pid: 0, window: 0, title: "", field: true }, talk: true })
}

/** Its answer's box, by where it was asked, unfocused till clicked: typing there, or holding the key again, goes on; Esc,
 *  a click elsewhere or another app ends it. */
function openAnswer(name: string, p: Point, w: AppWindowInfo | null, since: number) {
  if (!based) return
  exchange = { name, p, w, since }
  const d = chatOf(name)
  if (!d) return
  openPanel(based, p, d, false)
  void screenAsk("exchange", { on: true })
  draw()
}
/** The exchange over: its box closed, its cursor gone once it's done there. */
function endExchange() {
  if (!exchange && !summon) return
  exchange = null
  summon = null
  endDrawing()
  gesture.reset()
  void screenAsk("exchange", { on: false }).catch(() => {})
  if (panelOpen()) closePanel()
  draw()
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
  if (dictating()) return
  // (a window of Vaultite's that isn't a vault's, a Quick Look: it says so rather than nothing)
  if (focus.vaultite) return hint("Click where the words should go, then dictate")
  // (a password field gets nothing said; with no field, nothing is heard: talking to the companion is its own keys')
  if (focus.field && focus.secure) return
  if (!focus.field) return hint(prefs.talk.length ? `No text field here: ${keysSaid(prefs.talk)} talks to ${live.state.name || "the companion"}` : "No text field here")
  await listenFor({ into: "field", focus })
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
  if (mine.into === "summon" && summon?.state === "listening") { summon = null; void inkOff() }
  draw()
  chatChanged()
  if (r.code === "permission") notice("mic", "Vaultite isn't allowed to use the microphone", "Allow it in System Settings, Privacy & Security, Microphone.",
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone")
  else if (r.code === "model") notice("model", "Parakeet's model isn't on this Mac", "Handy or Hex downloads it, or pick Apple's recognizer in Dictation's settings.")
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

/** The display under `p` as a picture, without our windows nor a private app's. */
async function shotAt(p: Point) {
  const all = await screenAsk<{ windows?: { window: number; bundle: string; name: string }[] }>("windows").catch(() => ({ windows: [] }))
  return displayShot(p, [...ownWindows(), ...(all.windows ?? []).filter((w) => hidden(w)).map((w) => w.window)])
}
type Near = { role: string; label: string; frame: Rect }
/** The last ask's elements near the pointer, by id (global screen points): what `--ax` and drawings point at. */
let lastNear: (Near & { id: string })[] = []
/** What Accessibility finds near `p`, nearest first, each with an id the agent points by (companion say --ax a3). */
async function nearAt(p: Point) {
  const r = await screenAsk<{ elements?: Near[] }>("near", { x: p.x, y: p.y, radius: 260, max: 30 }).catch(() => null)
  lastNear = (r?.elements ?? []).map((e, i) => ({ id: `a${i + 1}`, role: e.role, label: e.label, frame: e.frame }))
  return lastNear
}

/** What's at a point the user asked about: its window (the cursor left on that spot of it) and what it says, what's under
 *  the point and near it, and the display's picture. A private app's ask is only what they said: not even which app. */
async function pointedAt(name: string, p: Point, w: AppWindowInfo | null): Promise<Record<string, unknown>> {
  const win = w?.window && !w.vaultite ? w : null
  if (win && hidden(win)) return { app: "private" }
  if (win?.frame) park(name, win.window, offsetIn(win.frame, p))
  const [text, shot, under, near] = await Promise.all([win ? screenAsk<{ ok?: boolean; text?: string }>("text", { window: win.window, max: 20_000 }) : null, shotAt(p), underAt(p), nearAt(p)])
  return { ...(win ? { app: win.bundle, window: win.window, title: win.title } : under ? { app: under.bundle } : {}), sx: Math.round(p.x), sy: Math.round(p.y),
    ...(text?.ok && text.text ? { screen: text.text } : {}), ...(shot ? { shot: shot.file, shotAt: shot.frame } : {}), ...(under ? { under: under.text } : {}), ...(near.length ? { near } : {}) }
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

/** Its words: into the field (joined to what's before its caret), into the conversation's box (a Talk key's: sent), or
 *  the summoned companion's ask. */
async function finish(s: Session, cancelled: boolean) {
  const text = s.finals.reduce((all, t) => all + joinText(all, t), "").trim()
  if (s.into === "panel") return chatChanged(cancelled || !text ? undefined : { text, listening: false, done: true, ...(s.talk ? { send: true } : {}) })
  if (s.into === "summon") {
    const m = summon
    if (!m || m.typing) return
    if (cancelled) { summon = null; return draw() }
    return sendSummon(m, text)
  }
  if (cancelled || !text) return
  const r = await screenAsk<{ ok?: boolean; why?: string }>("insert", { text: joinText(s.focus.before ?? "", text) })
  if (!r.ok && r.why === "no-field") notice("lost", "Couldn't put the words in", "The field lost the keyboard while you spoke.")
}

// ---------- its conversation: the answer's box, or a bubble clicked open (typed, or said into it)

/** Words said into the box, the last time they were done: given it once. */
let chatWords: PanelData["words"] = undefined
let wordsId = 0

function chatOf(name: string): PanelData | null {
  // (the companion not started yet: talking to it starts it, its box there meanwhile)
  const a = live.state.agents.get(name) ?? (name === live.state.name ? { name, tint: "orange", state: "away" } as Agent : null)
  if (!a) return null
  // (an exchange's box: only what was asked and said in it, its words as a caption)
  const since = exchange?.name === name ? exchange.since - 1000 : 0
  const items = live.state.said.filter((n) => n.agent === name && (n.kind === "say" || n.kind === "ask") && n.text && n.t >= since)
    .map((n) => ({ id: n.id, kind: n.kind, text: n.text, t: n.t, ...(n.question ? { question: true } : {}) }))
  const s = session?.into === "panel" ? session : null
  const words = s ? { text: [...s.finals, s.pending].reduce((all, t) => (t ? all + joinText(all, t) : all), "").trim(), listening: true } : chatWords
  const busy = a.state === "thinking" || a.state === "reading" || a.state === "writing" || a.state === "starting"
  return { name, tint: a.tint, how: howWith(a, live.state.harnesses), items, ...(words ? { words } : {}), ...(busy ? { busy } : {}) }
}

/** Its conversation open by its cursor (`at`, the screen's), taking the keyboard: its bubble goes into it, all of it seen. */
function openChat(name: string, at: Point) {
  if (!based) return
  chatWords = undefined
  const d = chatOf(name)
  if (!d) return
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

/** An ask typed (or said) in its conversation: about the point of its exchange, else where its cursor is on screen,
 *  else the pointer. */
async function askFrom(name: string, text: string) {
  const a = live.state.agents.get(name), x = exchange?.name === name ? exchange : null
  const p = x?.p ?? (a && onScreen(a) ? drawnAt.get(keyOf(a)) : undefined) ?? screen.getCursorScreenPoint()
  const w = x ? x.w : await screenAsk<AppWindowInfo>("at", { x: p.x, y: p.y }).catch(() => null)
  live.say({ t: "moment", kind: "ask", agent: name, text, ...(await pointedAt(name, p, w?.window ? w : null)) })
  if (!x) { exchange = { name, p, w: w?.window ? w : null, since: Date.now() }; void screenAsk("exchange", { on: true }) }
}

// ---------- the cursor over the screen

/** Places on screen resolved to points (an element's frame by its text, a window's), kept a moment: windows move. Each
 *  knows its window and its frame then, so a move of it (told by the screen helper) moves the point at once. */
type Placed = { at: number; p: Point | null; pending: boolean; win?: number; frame?: Rect | null; find?: boolean
  /** The element found (`find`): its words never cover it. */
  target?: Rect
  /** Where in its window the user left it (parks): it moves with the window. */
  off?: { dx: number; dy: number }
  /** A window in front covers it (Vaultite's, another app's): it isn't drawn, pointing at nothing seen. */
  covered?: boolean }
const placed = new Map<string, Placed>()
/** Where each agent's cursor was asked about in a window: that spot of it, not its title bar, as the window moves. */
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
    if (r.found) return { p: pointIn(r.found, true), win: r.window, frame: r.frame, find: true, target: r.found }
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
    else if (e.p && e.frame) {
      const dx = f.x - e.frame.x, dy = f.y - e.frame.y
      e.p = { x: e.p.x + dx, y: e.p.y + dy }
      if (e.target) e.target = { ...e.target, x: e.target.x + dx, y: e.target.y + dy }
    }
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
const intoWindow = new Map<string, { item: ScreenAgent; to: Point | null; until: number }>()
const INTO_MS = 450
let drawnKeys = new Map<string, string>()
const keyOf = (x: { name: string }) => `agent:${x.name}`
type Summoned = NonNullable<Scene["summon"]>

/** The scene made one cursor: an agent's that appears comes from where it was (summoned there, else the window's cursor),
 *  one going into the window glides there first; the summoned one is at the pointer at once. */
function handOff(agents: ScreenAgent[], called: Scene["summon"]): { agents: ScreenAgent[]; summon: Scene["summon"] } {
  const items = new Map<string, ScreenAgent | Summoned>(agents.map((a) => [keyOf(a), a]))
  if (called) items.set("summon", called)
  const shown = !!host?.homeWindow()
  for (const k of fromWindow.keys()) if (!items.has(k)) fromWindow.delete(k)
  for (const [k, it] of [...items]) {
    if (drawnKeys.has(k) || k === "summon") continue
    // (summoned there a moment ago: from there)
    if (drawnKeys.get("summon") === it.name && !items.has("summon") && drawnAt.has("summon")) { cameFromAt(k, drawnAt.get("summon")!); continue }
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
    if (k === "summon" || items.has(k) || intoWindow.has(k) || !shown) continue
    const a = live.state.agents.get(name), last = lastScene?.agents.find((x) => x.name === name)
    // (into the window: its place went there; else it fades where it is)
    if (!a || a.state === "away" || !last || onScreen(a) || [...items.values()].some((x) => x.name === name)) continue
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
    const from = it.leaving || k === "summon" ? undefined : movedFrom(k, { x: it.sx, y: it.sy })
    if (k === "summon") drawnAt.set(k, { x: it.sx, y: it.sy })
    return [k, from ? { ...it, from } : it] as const
  })
  return { agents: out.filter(([k]) => k !== "summon").map(([, it]) => it as ScreenAgent), summon: (out.find(([k]) => k === "summon")?.[1] as Summoned | undefined) ?? null }
}

let following: ReturnType<typeof setInterval> | null = null
/** What a scripted copy said and drew last (web/qa/helper.mjs), and its menu bar badge. */
const asked: object[] = []
let lastScene: Scene | null = null, badged = ""
/** Its words not seen yet: the menu bar icon's badge. */
const unreadSays = () => live.state.said.filter((n) => n.agent === live.state.name && n.kind === "say" && !n.seen)
/** What the overlay draws now (overlay.ts gives each display its part): only what's at work, nothing at rest. */
function draw() {
  if (!host) return
  const agents: ScreenAgent[] = []
  const says = [...live.state.notes.values()].filter((n) => n.kind === "say" && !n.dismissed)
  const s = summon
  for (const a of live.state.agents.values()) {
    if (a.state === "away" || !onScreen(a)) continue
    // (summoned: its own cursor waits till the ask moves it)
    if (s?.name === a.name && placeKey(a) === s.was) continue
    // (a new place being found: it stays where it was meanwhile, or where it was summoned)
    const e = pointOf(a), p = e.p ?? (e.pending ? drawnAt.get(keyOf(a)) ?? (s?.name === a.name ? s.p : undefined) : null)
    if (!p || e.covered) continue
    // (its conversation open: its words are there)
    const say = panelOpen() === a.name ? undefined : says.filter((n) => n.agent === a.name).at(-1)
    const target = a.frame ?? e.target
    agents.push({ name: a.name, tint: a.tint, state: a.state, sx: p.x, sy: p.y, t: a.t, ...(a.seen ? { seen: true } : {}), ...(a.why ? { why: a.why } : {}), ...(target ? { target } : {}),
      ...(say?.text ? { say: { id: say.id, text: say.text, ...(say.question ? { question: true } : {}) } } : {}) })
  }
  // (held: it follows the pointer, as a pen; a press that's a shortcut shows nothing: it waits a moment to appear)
  const listening = s?.state === "listening" && !s.typing
  if (listening && !inkDrawn && !s.ink.length) s.p = screen.getCursorScreenPoint()
  if (listening && !following) following = setInterval(draw, 33)
  else if (!listening && following) { clearInterval(following); following = null }
  const words = session?.into === "summon" ? [...session.finals, session.pending].reduce((all, t) => (t ? all + joinText(all, t) : all), "").trim() : ""
  const called: Scene["summon"] = s && !agents.some((a) => a.name === s.name) && (!listening || Date.now() - s.at > 120)
    ? { name: s.name, tint: s.tint, state: s.state, sx: Math.round(s.p.x), sy: Math.round(s.p.y), ...(words ? { words } : {}) } : null
  for (const a of live.state.agents.values()) if (a.state !== "away") leaveWhenDone(a, says)
  watchWindows()
  const d = session
  const hintNow = hinted && hinted.until > Date.now() ? hinted : null
  const pill: Scene["pill"] = d && d.into === "field" ? { level: d.level, text: d.pending || d.finals.at(-1) || "", ready: d.ready, ...(d.focus.frame ? { display: displayOf(d.focus.frame) } : {}) }
    : hintNow ? { level: 0, text: hintNow.text, ready: true, hint: true } : null
  const ink = s && s.ink.length && (exchange || s.state !== "watching") ? { tint: s.tint, strokes: s.ink } : null
  lastScene = { ...handOff(agents, called), ink, pill }
  showOverlay(based || null, lastScene)
  badge()
}
/** The menu bar icon's badge: how many of its words weren't seen, and jobs ended that weren't opened. */
function badge() {
  const b = live.state.mode === "off" ? "" : badgeOf(unreadSays().length, live.state.jobs ?? [])
  if (b === badged) return
  badged = b
  tray?.setTitle(b, { fontType: "monospacedDigit" })
}
/** Its cursor shows on screen only while it works, answers or points: idle a while there after, its words gone and its
 *  exchange over, it leaves. */
const DONE_MS = 6000
const leaving = new Map<string, ReturnType<typeof setTimeout>>(), left = new Set<string>()
function leaveWhenDone(a: Agent, says: Note[]) {
  if (!onScreen(a) || a.state !== "watching" || exchange?.name === a.name || summon?.name === a.name || panelOpen() === a.name || says.some((n) => n.agent === a.name)) return
  const wait = DONE_MS - (Date.now() - (a.t ?? 0)), once = `${a.name}:${a.t ?? 0}`
  clearTimeout(leaving.get(a.name))
  if (wait > 0) { leaving.set(a.name, setTimeout(draw, wait + 50)); return }
  if (left.has(once)) return
  left.add(once)
  leave(a.name)
}
const displayOf = (r: Rect) => screen.getDisplayMatching({ x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) }).id

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
