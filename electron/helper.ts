/** The menu-bar helper (a Mac's; one per Mac, a lock): the app and its home vault's server kept with no window: the keys
 *  (dictation's; the companion summoned over the screen, overlay.ts), screen reading, what's in front. electron/CLAUDE.md. */
import { app, clipboard, ipcMain, Menu, Notification, nativeImage, screen, shell, Tray, type BrowserWindow, type WebContents } from "electron"
import { execFile } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { WebSocket } from "ws"
import { HOLD_MS, fnActsToo, fnKey, isChord, keyCodes, modKeys, talkGesture, type FnAction, type FnEvent, type ModEvent, type TalkAction } from "../core/fnkey.ts"
import { joinText, parseReplacement, replacer } from "../core/dictationtext.ts"
import { privateApp } from "../core/privateapps.ts"
import { dictate, dictating, stopFor, dictationEngines, freeFor, handOver, onAudioDevices, onDictating, onRoam, releaseMic, type DictationSink, type Roam } from "./dictation.ts"
import { land, landedSaid } from "./dictationroam.ts"
import type { AppWindow } from "./appwindow.ts"
import { micSaid, pickMic } from "./miclogic.ts"
import { icon } from "./menu.ts"
import { atOffset, badgeOf, beatsWait, besidePointer, bitmapsDiffer, dictationKeys, drawingHold, drawnShapes, type HelperJob, THUMB, inkOf, jobNews, jobNote, jobsShown, jobSublabel, offsetIn, pointIn, prefsOf, type Point, type Prefs, type Scene, type ScreenAgent, liveInput, shotCrop, tappedKeys, trailStrokes } from "./helperlogic.ts"
import { REAL as captureReal, captureHeard, captureHost, recordingNow, regionAct, regionDrag, regionMoved, regionRect, regionScene, stopCapture } from "./capture.ts"
import { quitRecorder } from "./recorder.ts"
import { happened, keepTimeline, queryTimeline, timelineHost, timelineOn, timelineRefollow } from "./timeline.ts"
import { closePanel, cue as playCue, drawingActs, drawingUp, endDrawing, followPointer, onPanel, openPanel, overlayActs, ownWindows, panelAvoid, panelBounds, panelData, panelFocused, panelMenuClosed, panelOpen, showDrawing, showOverlay, type PanelData } from "./overlay.ts"
import { displayShot as shootDisplay, fnUsage, onScreenEvent, screenAsk as askHelper, startScreen, stopScreen, windowShot as shoot, type AppWindowInfo, type Focus, type Rect } from "./screen.ts"
import { type Drawing, elementPlaces } from "./drawing.ts"
import { byLabel, type Heard, heardBeats } from "../plugins/core/companion/screenmarks.ts"
import { type Press, pressLog } from "./presslog.ts"
import { type Phase, pressMachine, type PressMachine } from "./pressmachine.ts"
import { companionVoice } from "./voice.ts"
import { realtimeFront } from "./realtimefront.ts"
import { stopTakeover, takeoverCaption, takeoverClick, takeoverDriving, takeoverEnded, takeoverHeard } from "./takeover.ts"

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
/** The app the user uses: only it hears their keys (helperlogic.ts liveInput). */
const LIVE = liveInput(process.env, app.isPackaged)
// (a scripted copy's or one run from source: its own lock, never the user's app's)
const LOCK_NAME = LIVE ? "vaultite-helper" : `vaultite-helper-${process.pid}`
// (Windows listens only on a named pipe, never a file's path)
const LOCK = process.platform === "win32" ? `\\\\.\\pipe\\${LOCK_NAME}-${os.userInfo().username}` : path.join(os.tmpdir(), `${LOCK_NAME}.sock`)
let host: HelperHost | null = null
/** A scripted copy's stand-ins for the screen helper's answers (web/qa/helper.mjs): it never reads or types into the
 *  user's apps. */
const stubs = new Map<string, Record<string, unknown>>()
/** What a scripted copy asked of them, and copied. */
const screenAsked: Record<string, unknown>[] = []
const screenAsk = <T = Record<string, unknown>>(op: string, req: Record<string, unknown> = {}): Promise<T> => {
  // (web/qa/dictation-apps.mjs, by hand: a scripted copy on real windows of its own)
  if (!QUIET || process.env.VAULTITE_QA_SCREEN) return askHelper<T>(op, req)
  screenAsked.push({ op, ...req })
  return Promise.resolve((stubs.get(op) ?? { ok: false, why: "quiet", window: 0 }) as T)
}
const windowShot = (window: number, dir: string) => (QUIET ? Promise.resolve(null) : shoot(window, dir))
const displayShot = (p: Point, exclude: number[]) => (QUIET ? Promise.resolve(null) : shootDisplay(p, exclude, SHOTS(), shotCrop(screen.getDisplayNearestPoint(p).bounds, p)))
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
    probe.once("error", () => { if (process.platform !== "win32") fs.rmSync(LOCK, { force: true }); void listen().then(done) })
  }))
}

export async function startHelper(h: HelperHost) {
  if (host) return true
  lock = await takeLock()
  if (!lock) return false
  host = h
  app.on("will-quit", stopHelper)
  if (QUIET) Object.assign(globalThis, { vaultiteHelper: { heard: (m: Record<string, unknown>) => heard(m), stub: (op: string, v: Record<string, unknown>) => stubs.set(op, v), presses: () => presses.read(),
    asked: () => [...asked], screenAsked: () => [...screenAsked], spoken: () => [...spoken], scene: () => lastScene, badge: () => badged, menu: () => menuItems() } })
  onScreenEvent(heard)
  ipcMain.removeAllListeners("vaultite:place")
  ipcMain.on("vaultite:place", (e, m: { id?: unknown; place?: unknown }) => placeTold(e.sender, m))
  ipcMain.removeAllListeners("vaultite:dictation-landed")
  ipcMain.on("vaultite:dictation-landed", (_e, m: { id?: unknown; ok?: boolean; elsewhere?: boolean }) => { if (typeof m?.id === "number") landAsks.get(m.id)?.(m) })
  onRoam({ take: roamIn, stop: () => { if (session?.into !== "field") return false; stopFor(session.sink); return true } })
  onDictating(() => stopVoice())
  // (the mic it would hear with now, for its status: devices plugged, the output changed)
  onAudioDevices((d) => micTold(pickMic(prefs.dictation.microphone, d)))
  overlayActs({ open: openChat, stop: () => { if (session) stopFor(session.sink) }, region: regionMoved, regionAct })
  timelineHost({ exclude: excluded, bundles: () => prefs.privateApps, holding: recordingNow, privateNow: () => hidden(front),
    clicks: (on) => void screenAsk("clicks", { on }).catch(() => {}) })
  captureHost({ exclude: excluded, bundles: () => prefs.privateApps, hint, draw,
    placeAt: async (p) => { const w = await screenAsk<AppWindowInfo>("at", { x: p.x, y: p.y }).catch(() => null); return { ...await pointedAt(live.state.name, p, w?.window ? w : null, false), ...(w?.frame ? { frame: w.frame } : {}) } },
    deliver: async (c) => String((await op("companion.capture", c)).said ?? "Sent") })
  drawingActs((a) => live.say({ t: "drawing-act", ...a }))
  onPanel({ send: (name, text) => void askFrom(name, text), mic: () => act(session || starting ? "stop" : "start"), more: panelMenu,
    // (Esc in its box ends the exchange; the box closed otherwise (clicked away, its close) leaves what it says going on)
    closed: (_name, why) => { if (session?.into === "panel") stopFor(session.sink, true); if (why === "esc") endExchange(); else moveOn(); draw() } })
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
  voiceFront.close()
  speaker.quit()
  live.close()
  closePanel()
  showOverlay(null)
  stopScreen()
  stopTakeover()
  stopCapture()
  keepTimeline(false)
  quitRecorder()
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
    // (the screen kept in memory for "that, just now": said while it is, and turned off here)
    { label: timelineOn() ? "Keeping the last 30 s of screen" : "Keep the last 30 s of screen", icon: icon("history"), sublabel: timelineOn() ? "In memory only, till you send it" : undefined,
      type: "checkbox", checked: prefs.timeline, enabled: !!home, click: setting("plugin/companion", { timeline: !prefs.timeline }) },
    // (what it handed off: a click opens its tab in Vaultite)
    ...(jobs.length ? [{ type: "separator" as const }, { label: jobsHeader(jobs), type: "header" as const },
      ...jobs.map((j) => ({ label: j.title || "A job", sublabel: jobSublabel(j), icon: jobIcon(j.state), enabled: !!j.link, click: () => void openJob(j) }))] : []),
    { type: "separator" },
    { label: "Open at login", icon: icon("power"), type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (i) => { login(i.checked); h.setPrefs({ login: i.checked }) } },
    { label: `Quit ${app.getName()}`, accelerator: "Command+Q", click: () => h.quit() },
  ]
}

const jobIcon = (state: string) => (state === "starting" || state === "working" ? icon("clock") : state === "needs you" ? icon("circle-alert") : state === "ready for review" ? icon("eye")
  : state === "failed" || state === "stopped" ? icon("circle-x") : icon("circle-check"))
/** The Jobs header: how many work, and how many need the user. */
const jobsHeader = (jobs: HelperJob[]) => { const n = (s: string[]) => jobs.filter((j) => s.includes(j.state)).length, w = n(["starting", "working"]), y = n(["needs you"])
  return `Jobs${w || y ? ` (${[w ? `${w} working` : "", y ? `${y} need${y > 1 ? "" : "s"} you` : ""].filter(Boolean).join(", ")})` : ""}` }
/** A job opened: its tab in the home vault's window (opened first if need be; one closed once done resumes), and it's
 *  no longer news. */
async function openJob(j: HelperJob) {
  live.say({ t: "job-seen", ids: [j.id] })
  if (!j.link || !host) return
  host.openHome()
  // (a window just opening has no page to open it in yet)
  for (let i = 0; i < 20; i++) {
    if (await op("companion.job-open", { id: j.id }).catch(() => op("ui.open", { path: j.link })).then(() => true, () => false)) return
    await new Promise((r) => setTimeout(r, 500))
  }
}
/** A job ended or needs them: a notification, whose click opens it; what it waits on, its buttons answer there. */
function jobNotice(j: HelperJob) {
  const note = jobNote(j)
  if (QUIET) return void asked.push({ notice: "job", id: j.id, state: j.state, body: note.body, choices: note.choices })
  if (!Notification.isSupported()) return
  const n = new Notification({ title: note.title, body: note.body, silent: true, actions: note.choices.map((text) => ({ type: "button" as const, text })) })
  n.on("click", () => void openJob(j))
  // (a choice that no longer fits, its prompt gone or changed: the job opens instead)
  n.on("action", (_e, i) => void op("companion.job-answer", { id: j.id, choice: String(i + 1) }).catch(() => openJob(j)))
  n.show()
}

/** Keys as a Mac writes them: "fn⌃, right ⌥ or ⌃⌥". */
function keysSaid(keys: string[]) {
  const said = keys.map((k) => ({ fn: "fn", right_option: "right ⌥", right_command: "right ⌘", left_control: "left ⌃", right_control: "right ⌃", control_option: "⌃⌥", fn_control: "fn⌃" } as Record<string, string>)[k]).filter(Boolean)
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
let prefs: Prefs = { fn: true, keys: DEFAULTS.dictation.keys?.default ?? [], talk: DEFAULTS.companion.keys?.default ?? [], privateApps: DEFAULTS.screen.private_apps?.default ?? [], dictation: {},
  voice: { mode: "auto", provider: "auto", name: "", eleven: { voice: "", model: "" }, speed: 1 }, sounds: true,
  realtime: { front: "realtime", model: "gpt-realtime-2.1-mini", voice: "cedar" }, jobNews: String(DEFAULTS.companion.job_news?.default ?? "quiet"), timeline: false }
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
  ringFollows()
  draw()
}
/** The screen's timeline kept in memory only while asked for (the setting), the companion on, and this the app that
 *  hears the keys. */
const ringFollows = () => keepTimeline(((LIVE && !QUIET) || (QUIET && captureReal)) && prefs.timeline && !!live.state.name && live.state.mode !== "off")

type Agent = { name: string; tint: string; state: string; t?: number; seen?: boolean; why?: string; app?: string; window?: number; find?: string; sx?: number; sy?: number; display?: number; path?: string
  /** Its place in the app, off a note: a pane (a terminal's row), the app's UI; a note's line. */
  line?: number; pane?: string; row?: number; ui?: string
  /** What it points at on screen (an element of an ask's list): its words never cover it. */
  frame?: Rect
  runs?: string; model?: string; effort?: string }
type Note = { id: string; kind: string; agent: string; t: number; text?: string; question?: boolean; dismissed?: number; seen?: boolean
  /** A say answering a Talk key's ask (on screen or in the app): when it was asked, whether it was said, its language;
   *  `realtime`: the realtime voice's own words, said already. */
  answers?: { t: number; voice?: boolean; lang?: string; realtime?: boolean } }
/** The companion's socket, as the helper (?screen=1): the agents and their bubbles, and what the user asks on screen. */
const live = (() => {
  let ws: WebSocket | null = null, port: number | null = null, wait = 1000, timer: ReturnType<typeof setTimeout> | null = null
  const state = { mode: "quiet", name: "", agents: new Map<string, Agent>(), notes: new Map<string, Note>(),
    /** Each agent's last says and what the user asked it: its conversation. */
    said: [] as Note[],
    /** What it handed off (null till the server says): the menu's Jobs. */
    jobs: null as HelperJob[] | null }
  const connect = () => {
    timer = null
    if (port === null) return
    const s = new WebSocket(`ws://127.0.0.1:${port}/api/companion/live?screen=1`)
    ws = s
    s.on("open", () => { wait = 1000; if (realtimePaused) s.send(JSON.stringify({ t: "realtime", paused: realtimePaused })); if (micSent) s.send(JSON.stringify({ t: "mic", mic: micSent })) })
    s.on("message", (d) => {
      let m: Record<string, unknown>
      try { m = JSON.parse(String(d)) } catch { return }
      // (the companion's drawing over the screen: the server's, its places found there)
      if (m.t === "drawing") { const d = (m.drawing as Drawing | undefined) ?? null; if (d) { answerArrived(); drawingCame(d) } drawn = d; return paceDrawing() }
      if (m.t === "state") {
        state.mode = String(m.mode); state.name = String(m.name)
        state.agents = new Map((m.agents as Agent[]).map((a) => [a.name, a]))
        state.notes = new Map((m.notes as Note[]).map((n) => [n.id, n]))
        state.said = (m.said as Note[] | undefined) ?? []
        // (connected again: the server hears who rides with the pointer now)
        ridingSaid = null
      } else if (m.t === "said") state.said = (m.said as Note[] | undefined) ?? []
      else if (m.t === "agent") { const a = m.agent as Agent; state.agents.set(a.name, a); voiceHeardAgent(a); if (waited && drawn?.agent === a.name && !BUSY.has(a.state)) paceDrawing(false) }
      else if (m.t === "note") { const n = m.note as Note; state.notes.set(n.id, n); voiceHeard(n); if (n.kind === "say" && n.agent === exchange?.name && n.t >= exchange.since) answerArrived() }
      else if (m.t === "drop") state.notes.delete(String(m.id))
      // (its answer stopped in the app: Esc, its box closed)
      else if (m.t === "hush") return stopVoice()
      // (a step in another app, or their spoken answer to its offer: takeover.ts')
      else if (m.t === "takeover" || m.t === "takeover-answer") return takeoverHeard(m, { reply: (r) => live.say(r), isPrivate: hidden, near: nearAt, redraw: draw })
      // (a web page asked for in their browser: opened there)
      else if (m.t === "open-url") return openIn(m)
      // (words a mark names, found in the window asked about)
      else if (m.t === "find") return void findIn(m)
      else if (m.t === "jobs" && Array.isArray(m.jobs)) {
        const jobs = m.jobs as HelperJob[]
        for (const j of jobNews(state.jobs, jobs, prefs.jobNews)) jobNotice(j)
        state.jobs = jobs
        return badge()
      } else return
      draw()
      chatChanged()
    })
    s.on("error", () => {})
    s.on("close", () => { if (ws === s) { ws = null; if (port !== null) { timer = setTimeout(connect, wait); wait = Math.min(wait * 2, 5000) } } })
  }
  return {
    state,
    open(p: number | null) { this.close(); port = p; if (p !== null) connect() },
    close() { port = null; if (timer) clearTimeout(timer); timer = null; ws?.close(); ws = null; state.agents.clear(); state.notes.clear(); state.said = []; state.jobs = null; drawn = null; showDrawing(null) },
    /** Not connected: try again now, not at the next backoff (a press is waiting for it). */
    now() { if (ws || port === null) return; if (timer) clearTimeout(timer); wait = 1000; connect() },
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
  if (m.event === "moved") return windowMoved(m)
  if (m.event === "ink") return inkHeard(m)
  // (its exchange on: a click elsewhere moves on, Esc ends it, its voice with it)
  if (m.event === "click") { void clicked(Number(m.x), Number(m.y)); if (m.exchange === false) return; if (takeoverClick(Number(m.x), Number(m.y))) return; const b = panelBounds(), x = Number(m.x), y = Number(m.y); if (!b || x < b.x || y < b.y || x > b.x + b.width || y > b.y + b.height) moveOn(); return }
  if (m.event === "esc") return endExchange()
  if (m.event === "front") {
    // (another app in front: they moved on)
    if (exchange && !m.vaultite && front && m.bundle !== front.bundle && !takeoverDriving()) moveOn()
    front = m as unknown as AppWindowInfo
    happened({ t: Date.now(), kind: "app", ...(hidden(front) ? { app: "", name: "", private: true } : { app: front.bundle, name: front.name, title: front.title }) })
    timelineRefollow()
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
  swap: [RegExp, string][]; talk?: boolean
  /** The mic it hears with is a Bluetooth one: held open after, till its answer is said (holdMic). */
  bluetooth?: boolean
  /** The summoned companion its words are for (a new press may summon another before they're done). */
  of?: Summon
  /** Hands-free (a double tap): on till the next press. */
  free?: boolean
  /** It began in a window of ours (a note, a terminal, a field): that page keeps where. */
  origin?: WebContents
  /** Why it stopped by itself: said once it's over. */
  failed?: string
  log?: Press }
let session: Session | null = null
/** The window's page that has this press (fn there is its ⌘J), till it's let go. */
let page: WebContents | null = null

/** The screen helper's tap hears the picked keys only: the dictation keys (none while Dictate anywhere is off) and the
 *  Talk keys, a key alone by its code, a chord by its name. */
const heardKeys = () => dictationKeys(prefs)
const keysNow = () => `${heardKeys().join()}|${prefs.talk.join()}`
const listen = () => { const all = tappedKeys(prefs); return LIVE ? screenAsk("fn", { keys: keyCodes(all), chords: all.filter(isChord) }) : Promise.resolve({}) }
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
  settling = r.wait ? setTimeout(() => { settling = null; asFn(mods.settled()) }, r.wait) : null
  if (talkSettling) clearTimeout(talkSettling)
  talkSettling = t.wait ? setTimeout(() => { talkSettling = null; asTalk(talkMods.settled()) }, t.wait) : null
  asFn(r.fn)
  asTalk(t.fn)
}
/** A chord (⌃⌥, fn⌃): the companion's if it's a Talk key, else dictation's, as a key's press and release. */
function chordHeard(m: Record<string, unknown>) {
  const name = String(m.name), e: FnEvent = m.other === true ? { other: true } : { down: m.on === true, ...typeof m.t === "number" ? { t: m.t } : {} }
  if (prefs.talk.includes(name)) talkHeard(e)
  else if (heardKeys().includes(name)) fnHeard(e)
}

function fnHeard(m: Record<string, unknown>, byFn = true) {
  if (!prefs.fn || !host?.home()) return
  const to = page && !page.isDestroyed() ? page : null
  // (Control's double tap: hands-free, or off)
  if (m.double === true) {
    if (to) return void to.send("vaultite:fn", { double: true })
    if (session || starting) return act("stop")
    act("start")
    return act("free")
  }
  if (m.other === true) { const shortcut = m.shortcut === true; if (to) to.send("vaultite:fn", { other: true, shortcut }); else act(key.other(Date.now(), shortcut)); return }
  if (m.down === true) {
    if (!session) page = host.focusedPage()
    if (page && !session) return void page.send("vaultite:fn", { down: true, held: m.held === true })
    page = null
    if (byFn) void firstUse()
    return act(key.down(Date.now(), !!session || starting, m.held === true))
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
  } else if (starting && (a === "stop" || a === "cancel" || a === "free")) after = a
  else if (a === "free" && session) { session.free = true; freeFor(session.sink); session.log?.step("free"); draw() }
  else if (a === "stop" && session) stopFor(session.sink)
  else if (a === "cancel" && session) stopFor(session.sink, true)
}

// ---------- the Talk keys: the companion summoned at the pointer (HeyClicky's gesture, core/fnkey.ts talkGesture)

const gesture = talkGesture()
/** What each press of the Talk key did, a day at a time beside the app's own (presslog.ts); `press`: the latest. */
const presses = pressLog(() => path.join(app.getPath("userData"), "talk"), "talk")
let press: Press | null = null
/** How long its cursor says a press went nowhere. */
const MISSED_MS = 2400
/** A press of the Talk key that went nowhere (`why`, logged): its cursor says so a moment (`words`) with a soft cue,
 *  then goes (or rides on, its exchange on); its audio is kept beside the log, to hear again. Never silence. */
function missed(s: Summon | null, why: string, words = "Didn't catch that") {
  endMissed(s, why)
  if (!s || summon !== s || !s.m.send("miss", why)) return draw()
  s.missed = words
  cue("missed")
  draw()
  setTimeout(() => {
    if (summon !== s || s.m.phase !== "missed") return
    s.missed = undefined
    if (exchange) s.m.send("shown")
    else closeSummon(s, "missed shown")
    draw()
  }, MISSED_MS)
}
/** The press logged as missed (`why`), its audio kept beside the log: once. */
function endMissed(s: Summon | null, why: string) {
  const kept = s?.press && !s.press.ended() ? keepAudio(s.press.id) : null
  s?.press?.end("missed", { why, ...(kept ? { audio: kept } : {}) })
}
/** Held, but nothing hears any more (the recognizer didn't start, or stopped): its cursor says so till it's let go, then
 *  what was heard goes (`heard`), else it's missed. Never sent while held. */
function failed(s: Summon, why: string, words: string, heard = "") {
  if (!heard) endMissed(s, why)
  if (!s.m.send("fail", why)) return
  Object.assign(s, { missed: words, heard })
  cue("missed")
  draw()
}
/** A summon over (its exchange ended, its miss shown, cancelled, a new press): its machine closed, the cursor gone. */
function closeSummon(s: Summon, why: string) {
  s.m.send("close", why)
  if (summon === s) summon = null
}
/** The last press's audio (dictation.ts keeps it in the logs), copied beside the log as `<press>.wav`; the last few kept. */
function keepAudio(id: string) {
  try {
    const from = path.join(app.getPath("logs"), "dictation-last.wav"), dir = path.join(app.getPath("userData"), "talk")
    if (!fs.existsSync(from) || Date.now() - fs.statSync(from).mtimeMs > 60_000) return null
    fs.mkdirSync(dir, { recursive: true })
    const to = path.join(dir, `${id}.wav`)
    fs.copyFileSync(from, to)
    const wavs = fs.readdirSync(dir).filter((f) => f.endsWith(".wav")).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)
    for (const w of wavs.slice(10)) fs.rmSync(path.join(dir, w.f), { force: true })
    return to
  } catch { return null }
}
/** The companion called up outside Vaultite: its cursor at the pointer (listening, then thinking), the window there, the
 *  pointer's trail while the key is held (`released`: when it was let go); `was`: where its own cursor was. */
type Summon = { name: string; tint: string; p: Point; w: AppWindowInfo | null; trail: (Point & { t: number })[]; released?: number
  at: number; was: string
  /** Where the press is (pressmachine.ts), each move in its log. */
  m: PressMachine
  /** Words heard before the recognizer stopped while it was held: sent once it's let go. */
  heard?: string
  /** Its turn on the ask seen at work (the agent's state, the server's): only then can it be over. */
  begun?: boolean
  /** Its press went nowhere: what its cursor says a moment ("Didn't catch that"). */
  missed?: string
  /** Its press, in the log of presses. */
  press?: Press | null
  /** Its coming was cued. */
  cued?: boolean
  /** Its words are in the timeline. */
  told?: boolean
  /** What's at the point let go at, gathered as its words are finished (not after). */
  place?: Promise<{ w: AppWindowInfo | null; place: Record<string, unknown> }>
  /** The display as the key went down: a toast or a menu there then may be gone by the let-go. */
  down?: Promise<Shot | null> }
let summon: Summon | null = null
/** The exchange its answer is in: its box open by the point asked about (and the window there), since `since`. */
type Exchange = { name: string; p: Point; w: AppWindowInfo | null; since: number
  /** Its answer is spoken: no box (its cursor, its voice and its marks say it); a tap of the key opens one. */
  spoken?: boolean
  /** Its answer began coming (its first words, a drawing). */
  arrived?: boolean }
let exchange: Exchange | null = null

/** A Talk key (alone, or a chord), as its gesture: the companion summoned at the pointer, in any app and in Vaultite's
 *  windows alike (one companion, over the screen: the page never gets the key). */
function talkHeard(m: FnEvent) {
  // (Control's double tap: no Talk key is Control)
  if (!host?.home() || "double" in m) return
  // (pressed again: its voice stops at once, and gets ready for the next answer)
  if ("down" in m && m.down) { stopVoice(); live.say({ t: "interrupt" }); speaker.warm(); voiceFront.warm(); lastAsk = null }
  const now = "t" in m && m.t ? m.t : Date.now(), kind = "other" in m ? "other" : m.down ? "down" : "up", a = "other" in m ? gesture.other() : m.down ? gesture.down(now) : gesture.up(now)
  // (each press logged, what it did or that it did nothing: presses that go nowhere can be traced)
  if (a === "listen") press = presses.start("talk", "down", { front: front?.bundle ?? "" })
  else if (kind === "down" && !a) presses.start("talk", "down", { front: front?.bundle ?? "" }).end("ignored", { gesture: gesture.state })
  else press?.step(kind, { action: a ?? "none" })
  if (!a) return
  talkAct(a)
}

function talkAct(a: NonNullable<TalkAction>) {
  if (a === "listen") return act("start", true)
  if (a === "cancel") { void inkOff(); press?.end("cancelled", { why: "another key with it" }); return act("cancel", true) }
  if (a === "send") {
    // (hands-free in its box: what's in it goes; held: let go here, it thinks here)
    if (session?.into === "summon" || (starting && startingTalk)) {
      if (summon?.m.send("up")) { Object.assign(summon, { p: screen.getCursorScreenPoint(), released: Date.now() }); summon.place = gather(summon); if (!recordingNow()) voiceFront.release(whereOf(summon)) }
      // (something to send, said or drawn: it's heard as it's let go)
      if (summon && ((session && (session.finals.length || session.pending.trim())) || trailStrokes(summon.trail, Date.now()).length)) cue("sent")
      void inkOff(); draw()
    }
    // (let go with nothing listening: it never started or stopped early, and nothing's coming of it)
    else if (!session && summon?.m.phase === "listening") { void inkOff(); return missed(summon, "no recognizer running at let-go") }
    // (held after the recognizer stopped: what it heard goes now, else it's missed)
    else if (summon?.m.phase === "failed") {
      const s = summon
      void inkOff()
      if (!s.heard) return missed(s, "nothing heard: the recognizer had stopped", s.missed)
      s.m.send("up")
      Object.assign(s, { p: screen.getCursorScreenPoint(), released: Date.now() })
      s.place = gather(s)
      return void sendSummon(s, s.heard)
    }
    return act("stop", true)
  }
  if (a === "type") {
    // (a tap: its box, focused, to type in; nothing heard)
    summon?.m.send("tap")
    press?.end("typed")
    void inkOff()
    act("cancel", true)
    return openTyping()
  }
  void freeTalk()
}

/** A Talk key held: its cursor at the pointer, listening, the words by it; the pointer leaves a trail
 *  meanwhile (drags too: the screen helper keeps them from the app). */
async function startSummon() {
  // (the server's socket reconnecting (a restart): it's asked again at once, and the press waits a moment for it)
  if (!live.state.name) { live.now(); for (let i = 0; i < 30 && !live.state.name && press && !press.ended(); i++) await new Promise((r) => setTimeout(r, 50)) }
  const name = live.state.name
  if (live.state.mode === "off") { press?.end("dropped", { why: "the companion is off" }); return notice("off", "The companion is off", "Turn it on in the companion's settings to talk to it.") }
  if (!name) { press?.end("dropped", { why: "no companion yet" }); return hint("The companion isn't ready yet: open Vaultite") }
  const p = screen.getCursorScreenPoint(), at = Date.now(), own = live.state.agents.get(name)
  const mine = press
  const m = pressMachine({ log: (t) => mine?.after("state", t), stuck: (phase) => stuck(s, phase) })
  const s: Summon = { name, tint: own?.tint ?? "orange", p, w: null, m, trail: [], at, was: own ? placeKey(own) : "", press }
  // (one still sending goes on to be sent, then closes: a newer press has the cursor)
  if (summon && summon.m.phase !== "sending") closeSummon(summon, "a new press")
  summon = s
  s.down = shotAt(p).catch(() => null)
  live.say({ t: "summoning" })
  // (a press that's a shortcut shows nothing: it appears after a moment)
  setTimeout(draw, 130)
  void screenAsk("ink", { on: true })
  void screenAsk<AppWindowInfo>("at", { x: p.x, y: p.y }).then((w) => { s.w = w.window ? w : null }, () => {})
  draw()
  // (its realtime turn begins now: a let-go while the last press's words finish is this one's)
  // (while it records, their words are narration: the realtime voice never answers them)
  if (!recordingNow()) voiceFront.press(s)
  // (pressed again as its last words are still being finished (or it speaks): those go first, then this one listens)
  for (let i = 0; i < 60 && session?.into === "summon"; i++) await new Promise((r) => setTimeout(r, 25))
  if (session?.into === "summon") s.press?.step("took over a press still finishing")
  await listenFor({ into: "summon", focus: { bundle: "", name: "", pid: 0, window: 0, title: "", field: true }, talk: true, of: s })
}
const inkOff = () => screenAsk("ink", { on: false }).catch(() => {})
/** A press stuck in a phase past its limit (pressmachine.ts LIMITS): held 10 min (a lost key-up), let go with nothing
 *  sent, or asked with no turn begun. Its cursor never stays stuck. */
function stuck(s: Summon, phase: Phase) {
  s.press?.after("stuck", { phase })
  if (phase === "listening") { s.m.send("stuck"); if (session?.of === s) stopFor(session.sink, true); void inkOff(); if (summon === s) summon = null; return draw() }
  missed(s, `stuck ${phase}`, phase === "thinking" ? "No answer came" : "Something went wrong")
  if (phase === "thinking") setTimeout(() => { if (summon === s) endExchange(false) }, MISSED_MS + 50)
}
/** A drag while the Talk key is held: a box (capture.ts), the pointer leaving no trail meanwhile. */
let inkDown = false
function inkHeard(m: Record<string, unknown>) {
  const s = summon, phase = m.phase as "down" | "move" | "up", p = { x: Number(m.x), y: Number(m.y) }
  if (phase === "up") inkDown = false
  if (!s || !HELD.has(s.m.phase) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return
  if (phase === "down") inkDown = true
  regionDrag(phase, p, s.tint)
}
/** The pointer moved while it's fed: held, its trail (the last few seconds). */
function trailed(p: Point, t: number) {
  const s = summon
  if (!s || s.m.phase !== "listening" || inkDown) return
  s.trail.push({ x: p.x, y: p.y, t })
  if (s.trail.length > 400 || t - s.trail[0].t > 4000) s.trail = s.trail.filter((q) => t - q.t <= 4000).slice(-400)
}
/** The summoned companion's ask (`text`; none, a point at what its trail marks): about the point let go at, with what's
 *  there, the display's picture and what Accessibility finds near it; its answer comes in its box, open by it. */
async function sendSummon(s: Summon, text: string, how: { front?: "realtime"; talk?: string[] } = {}) {
  if (captured(s, text)) return
  const ink = drawnShapes(inkOf(trailStrokes(s.trail, s.released ?? Date.now())))
  if (!text && !ink.length) return missed(s, "nothing heard nor drawn")
  draw()
  const { w, place } = await (s.place ?? gather(s))
  const win = w?.window && !w.vaultite && place.app !== "private" ? w : null
  if (win?.frame) park(s.name, win.window, offsetIn(win.frame, s.p))
  // (the realtime voice's press: its few words go on, this answer said after them)
  if (!how.front) stopVoice()
  const sent = live.say({ t: "moment", kind: text ? "ask" : "point", agent: s.name, ...(text ? { text } : {}), ...place, ...(ink.length ? { ink } : {}), ...(regionRect() ? { region: regionRect() } : {}), voice: true, ...(s.released ? { keyUp: s.released } : {}),
    ...(how.front ? { front: how.front, ...(how.talk?.length ? { talk: how.talk } : {}) } : {}) })
  if (!sent) return missed(s, "Vaultite's server isn't connected", "Can't reach Vaultite")
  s.press?.end("sent", { chars: text.length, drew: ink.length, shot: !!place.shot, ...(how.front ? { front: how.front } : {}) })
  s.m.send("sent")
  if (summon !== s) s.m.send("close", "a newer press")
  if (s.press) lastAsk = { press: s.press, up: s.released ?? Date.now() }
  askedAloud = true
  // (held again in an exchange: the same thread)
  openAnswer(s.name, s.p, w?.window ? w : null, exchange?.name === s.name ? exchange.since : s.at)
}

/** Words for region capture (record this, stop, that just now; anything while it records is narration): handled
 *  there, never an ask. */
function captured(s: Summon, text: string) {
  if (text && !s.told) { s.told = true; happened({ t: s.at, kind: "said", text }) }
  if (!text || !captureHeard(text, s.at)) return false
  voiceFront.stop()
  s.press?.end("capture")
  closeSummon(s, "capture")
  draw()
  return true
}
/** The window at the point let go at and what's there (pointedAt), its cursor left there only once it's asked. */
async function gather(s: Summon) {
  const w = s.w ?? await screenAsk<AppWindowInfo>("at", { x: s.p.x, y: s.p.y }).catch(() => null)
  const place = await pointedAt(s.name, s.p, w?.window ? w : null, false), down = await s.down
  // (the screen changed as they spoke: the picture from the key-down too, what they meant may be only there)
  if (down && place.shot && place.app !== "private" && shotChanged(down, { file: String(place.shot), frame: place.shotAt as Rect })) Object.assign(place, { shotDown: down.file, shotDownAt: down.frame })
  return { w, place }
}
type Shot = { file: string; frame: Rect }
/** Whether two pictures of the display differ where they overlap (a toast, a menu: not a caret's blink), each read
 *  small; mostly apart, they're taken as changed. */
function shotChanged(a: Shot, b: Shot) {
  const x = Math.max(a.frame.x, b.frame.x), y = Math.max(a.frame.y, b.frame.y)
  const w = Math.min(a.frame.x + a.frame.width, b.frame.x + b.frame.width) - x, h = Math.min(a.frame.y + a.frame.height, b.frame.y + b.frame.height) - y
  if (w < a.frame.width / 2 || h < a.frame.height / 2) return true
  const small = (s: Shot) => {
    const img = nativeImage.createFromPath(s.file), k = img.getSize().width / s.frame.width
    if (img.isEmpty() || !k) return null
    return img.crop({ x: Math.round((x - s.frame.x) * k), y: Math.round((y - s.frame.y) * k), width: Math.round(w * k), height: Math.round(h * k) }).resize({ width: THUMB.w, height: THUMB.h, quality: "good" }).toBitmap()
  }
  const [p, q] = [small(a), small(b)]
  return !!p && !!q && bitmapsDiffer(p, q)
}
/** Where a summon is, as words for the realtime voice (it never sees the screen): the app and its window's title. */
function whereOf(s: Summon) {
  const w = s.w, drew = drawnShapes(inkOf(trailStrokes(s.trail, s.released ?? Date.now()))).length > 0
  const app = w && !w.vaultite ? (hidden(w) ? "a private app" : `${w.name}${w.title ? `, its window "${w.title.slice(0, 120)}"` : ""}`) : ""
  return app || drew ? `(Where they are: ${app || "their screen"}${drew ? "; they drew on the screen as they spoke" : ""}.)` : undefined
}

/** A tap: its box at the pointer, focused, to type the ask in (its answer's box already up: into its field). */
function openTyping() {
  const name = live.state.name
  if (!name) return
  const p = summon?.p ?? screen.getCursorScreenPoint(), w = summon?.w ?? null
  if (exchange?.name === name && panelOpen() === name) { const d = chatOf(name); if (d && based) openPanel(based, besidePointer(screen.getCursorScreenPoint(), screen.getDisplayNearestPoint(p).bounds), d, true, true); return }
  openChat(name, p, !!summon)
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

/** Its answer's box, by where it was asked, unfocused till clicked (spoken: none, its voice says it): typing there, or
 *  holding the key again, goes on; Esc ends it, a click elsewhere or another app moves on (moveOn). */
function openAnswer(name: string, p: Point, w: AppWindowInfo | null, since: number) {
  if (!based) return
  // (an answer said aloud needs no box: the box comes only by a tap of the key)
  const spoken = prefs.voice.mode !== "off"
  exchange = { name, p, w, since, ...(spoken ? { spoken } : {}) }
  void screenAsk("exchange", { on: true })
  if (spoken) return draw()
  answerBox()
}
/** The exchange's box, beside the pointer, unfocused: its words and its reply field. */
function answerBox() {
  if (!based || !exchange) return
  const d = chatOf(exchange.name)
  if (!d) return
  // (it travels with the companion beside the pointer; its field is there, the keyboard left with their app)
  const now = screen.getCursorScreenPoint()
  openPanel(based, besidePointer(now, screen.getDisplayNearestPoint(now).bounds), d, false, true)
  draw()
}
/** The exchange's answer began coming: a soft cue. */
function answerArrived() {
  const x = exchange
  if (!x || x.arrived) return
  x.arrived = true
  if (summon?.name === x.name) summon.m.send("arrived")
  cue("answer")
}
/** A soft cue (the companion's `sounds`; a scripted copy only notes it). */
function cue(name: "listen" | "sent" | "answer" | "missed") {
  if (QUIET) return void asked.push({ cue: name })
  if (prefs.sounds) playCue(name)
}
/** The exchange over (Esc; `stop`: its voice too): its box closed, its cursor gone (at once when it's done; else once it is). */
function endExchange(stop = true) {
  // (Esc: its words and its turn on them stop)
  if (stop) { stopVoice(); live.say({ t: "interrupt" }) }
  if (settleTimer) { clearTimeout(settleTimer); settleTimer = null }
  if (!exchange && !summon) return
  const name = exchange?.name ?? summon?.name
  exchange = null
  if (summon) closeSummon(summon, stop ? "esc" : "over")
  takeoverEnded()
  inAppSpots.clear()
  const a = name ? live.state.agents.get(name) : undefined
  if (a && onScreen(a) && a.state === "watching") leave(a.name)
  endDrawing()
  gesture.reset()
  void screenAsk("exchange", { on: false }).catch(() => {})
  if (panelOpen()) closePanel()
  draw()
}
/** Its spoken answer still going: being said (or still to be), or its turn still at work on it. */
function going(x: Exchange) {
  if (!x.spoken) return false
  const a = live.state.agents.get(x.name), s = summon?.name === x.name ? summon : null
  return !!speakingNow || speaker.saying() || (!!a && BUSY.has(a.state)) || (!!s && waiting(s))
}
/** They clicked elsewhere, went to another app, or its box closed: the box goes, but a spoken answer goes on to its end
 *  (only the Talk key, Esc or a new ask stop it), its cursor leaving once it's said (settle). */
function moveOn() {
  const x = exchange
  // (held: the press is theirs, a drag its trail)
  if (summon && HELD.has(summon.m.phase)) return
  if (x && going(x)) { if (panelOpen()) closePanel(); return draw() }
  endExchange(false)
}
/** How long its cursor stays once its spoken answer is said, before it leaves. */
const LINGER_MS = 1500
let settleTimer: ReturnType<typeof setTimeout> | null = null
/** A spoken exchange done (its words said to their end, its turn over), its box not open: a moment on, its cursor leaves. */
function settle() {
  const x = exchange
  const done = (): boolean => !!x && exchange === x && !going(x) && panelOpen() !== x.name && !(summon && HELD.has(summon.m.phase)) && (x.arrived || !!summon?.begun) &&
    !(drawn?.agent === x.name && drawingUp() === drawn.id && Date.now() < drawingSeen)
  if (!x?.spoken || settleTimer || !done()) return
  settleTimer = setTimeout(() => { settleTimer = null; if (done()) endExchange(false); else settle() }, LINGER_MS)
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
  // (kept: where its words go if no other field has them when it stops)
  const focus = await screenAsk<Focus>("focus", { keep: true })
  if (dictating()) return
  // (a password field gets nothing said; with no field it listens: one may be clicked by the time it stops)
  if (focus.field && focus.secure) return
  await listenFor({ into: "field", focus })
}

/** A window's session (or one with nowhere in it to go, `start`) carries on here, the words in the box: its page keeps
 *  where it began. The page's key goes with it. False: it can't, and the page does as it can. */
function roamIn(win: AppWindow, sink: DictationSink, o: Roam) {
  if (session?.into === "field") { if (o.start) stopFor(session.sink); return !!o.start }
  if (session || starting) return false
  if (o.start) {
    if (!prefs.fn) return false
    page = null
    if (o.held) key.down(Date.now(), false)
    act("start")
    return true
  }
  const mine: Session = { sink: { tell: (e) => told(mine, e) }, into: "field", focus: { bundle: "", name: "", pid: 0, window: 0, title: "", field: false }, finals: [], pending: o.pending ?? "", level: 0, ready: true,
    swap: replacer(replacements()), free: o.free, origin: win.webContents, log: dictations.start("dictation", "roam", { from: "window", ...(o.free ? { free: true } : {}) }) }
  if (!handOver(sink, mine.sink)) return false
  session = mine
  page = null
  // (still held: letting go stops it, however long it's been)
  if (o.held) key.down(Date.now() - HOLD_MS, false)
  draw()
  return true
}

/** A word in the dictation pill's place, a moment: a key pressed where it does nothing. */
let hinted: { text: string; until: number } | null = null
function hint(text: string) {
  hinted = { text, until: Date.now() + 2200 }
  draw()
  setTimeout(draw, 2250)
}

async function listenFor(o: Pick<Session, "into" | "focus" | "talk" | "of">) {
  // (a Talk key's is the companion's, whatever else listens: that ends, its words landing; other keys leave a session under way alone)
  if (dictating() && !o.talk) return
  if (session?.into === "field") { const was = session; session = null; void finish(was, false) }
  stopVoice()
  holdEnd()
  const s = prefs.dictation, lines = replacements()
  // (held over the screen: the realtime voice hears the microphone too)
  const tap = o.into === "summon" && prefs.realtime.front === "realtime" && voiceFront.available()
  const mine: Session = { sink: { tell: (e) => told(mine, e), ...(tap ? { audio: (b: Buffer) => voiceFront.audio(b) } : {}) }, ...o, finals: [], pending: "", level: 0, ready: false, swap: replacer(lines),
    ...(o.into === "field" ? { log: dictations.start("dictation", "start", { front: o.focus.bundle, field: !!o.focus.field }) } : {}) }
  session = mine
  draw()
  chatChanged()
  const how = await engineFor(s)
  // (a Talk key's audio is kept a while: a press that went nowhere can be heard again)
  // (an answer said aloud follows a Talk key's: a Bluetooth mic stays open till it's said, holdMic)
  const answered = mine.into === "summon" || !!mine.talk
  const r = await dictate(mine.sink, { ...how, silence: s.silence, keep: s.keep_audio === true || mine.into === "summon", words: lines.map(parseReplacement).filter((x) => !!x).map((x) => x[0]), ...(tap ? { tap } : {}),
    microphone: s.microphone, hold: answered })
  if (r.mic) { mine.bluetooth = r.mic.bluetooth; micTold(r.mic) }
  // (the recognizer that hears it: Soniox, or this Mac's and why not Soniox; one failing later logs stt-fallback; the mic
  // and why that one, mic-change should it go mid-press)
  if (mine.into === "summon") mine.of?.press?.step("stt", { engine: r.engine ?? how.engine, ...(r.why ? { why: r.why } : {}), ...(r.ok ? {} : { failed: r.code ?? "?" }),
    ...(r.mic ? { mic: r.mic.name, micWhy: r.mic.why, ...(r.mic.bluetooth ? { bluetooth: true } : {}) } : {}) })
  if (r.ok || session !== mine) return
  session = null
  const of = mine.into === "summon" ? mine.of : undefined, why = `the recognizer didn't start (${r.code ?? "?"})`
  // (still held: said so till it's let go; let go already: missed)
  if (of?.m.phase === "listening") failed(of, why, r.code === "permission" ? "Vaultite can't use the mic" : "The mic didn't start")
  else if (of?.m.phase === "sending") { void inkOff(); missed(of, why) }
  draw()
  chatChanged()
  if (r.code === "permission") notice("mic", "Vaultite isn't allowed to use the microphone", "Allow it in System Settings, Privacy & Security, Microphone.",
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone")
  else if (r.code === "model") notice("model", "Parakeet's model isn't on this Mac", "Handy or Hex downloads it, or pick Apple's recognizer in Dictation's settings.")
}

/** A web page the companion opens in the app the user asked from (their browser): a new tab there, in front. */
function openIn(m: Record<string, unknown>) {
  const url = String(m.url ?? ""), bundle = String(m.app ?? ""), reply = (r: object) => live.say({ t: "takeover-done", id: m.id, ...r })
  if (!/^https?:\/\/\S+$/i.test(url) || !/^[\w.-]+$/.test(bundle)) return void reply({ ok: false, why: "failed", text: "that isn't a web address and an app" })
  if (QUIET) return void reply({ ok: true, how: "open" })
  execFile("/usr/bin/open", ["-b", bundle, url], { timeout: 10_000 }, (e) => reply(e ? { ok: false, why: "failed", text: `${bundle} couldn't open it` } : { ok: true, how: "open" }))
}

/** The element saying a mark's words in the window the last ask was over: its whole Accessibility tree, not only by
 *  the pointer. Answered as a step is. */
async function findIn(m: Record<string, unknown>) {
  const p = nearPoint ?? screen.getCursorScreenPoint()
  const r = await screenAsk<{ elements?: Near[] }>("near", { x: p.x, y: p.y, radius: 5000, max: 400 }).catch(() => null)
  const el = byLabel(r?.elements ?? [], String(m.text ?? ""))
  live.say({ t: "takeover-done", id: m.id, ...(el ? { ok: true, found: { id: "", ...el } } : { ok: false, why: "none" }) })
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
/** What a recording leaves out: our windows and a private app's (capture.swift leaves out their whole app too). */
async function excluded() {
  const all = await screenAsk<{ windows?: { window: number; bundle: string; name: string }[] }>("windows").catch(() => ({ windows: [] }))
  return [...ownWindows(), ...(all.windows ?? []).filter((w) => hidden(w)).map((w) => w.window)]
}
type Near = { role: string; label: string; frame: Rect }
/** The last ask's elements near the pointer, by id (global screen points): what `--ax` and drawings point at. */
let lastNear: (Near & { id: string })[] = []
/** Where the last ask's elements were looked for: the window a find searches. */
let nearPoint: Point | null = null
/** What Accessibility finds near `p`, nearest first, each with an id the agent points by (companion say --ax a3). */
async function nearAt(p: Point) {
  nearPoint = p
  const r = await screenAsk<{ elements?: Near[] }>("near", { x: p.x, y: p.y, radius: 260, max: 30 }).catch(() => null)
  lastNear = (r?.elements ?? []).map((e, i) => ({ id: `a${i + 1}`, role: e.role, label: e.label, frame: e.frame }))
  return lastNear
}

/** What's at a point asked about: its window (its cursor left there, `parks`), what it says, what's under and near the
 *  point, and the display's picture. A private app's ask is only what they said: not even which app. */
async function pointedAt(name: string, p: Point, w: AppWindowInfo | null, parks = true): Promise<Record<string, unknown>> {
  const win = w?.window && !w.vaultite ? w : null
  if (win && hidden(win)) return { app: "private" }
  if (parks && win?.frame) park(name, win.window, offsetIn(win.frame, p))
  const [text, shot, under, axNear, inApp] = await Promise.all([win ? screenAsk<{ ok?: boolean; text?: string }>("text", { window: win.window, max: 20_000 }) : null, shotAt(p), underAt(p), nearAt(p),
    w?.vaultite ? inAppAt(p) : null])
  // (over Vaultite's window, Accessibility reads nothing of it: its page names what's near, by the same ids)
  const { near: appNear, ...there } = inApp ?? {}, near = Array.isArray(appNear) && appNear.length ? pageNear(appNear) : axNear
  return { ...there, ...(win ? { app: win.bundle, window: win.window, title: win.title } : under ? { app: under.bundle } : {}), sx: Math.round(p.x), sy: Math.round(p.y),
    ...(text?.ok && text.text ? { screen: text.text } : {}), ...(shot ? { shot: shot.file, shotAt: shot.frame } : {}), ...(under ? { under: under.text } : {}), ...(near.length ? { near } : {}),
    displays: screen.getAllDisplays().map((d) => d.bounds) }
}

/** What's at a screen point of the home vault's window, as its page knows it (a note's line, a pane's row, the app's UI):
 *  a Talk key's ask there is about that too. Null off it, or when the page doesn't say in time. */
const placeAsked = new Map<number, (place: Record<string, unknown> | null) => void>()
let placeAsks = 0
function inAppAt(p: Point): Promise<Record<string, unknown> | null> {
  const w = host?.homeWindow(), b = w?.bounds
  if (!w || !b || w.page.isDestroyed() || p.x < b.x || p.y < b.y || p.x >= b.x + b.width || p.y >= b.y + b.height) return Promise.resolve(null)
  const id = ++placeAsks
  return new Promise((done) => {
    const late = setTimeout(() => { placeAsked.delete(id); done(null) }, 400)
    placeAsked.set(id, (place) => { clearTimeout(late); placeAsked.delete(id); done(place) })
    w.page.send("vaultite:place-at", { id, x: (p.x - b.x) / w.zoom, y: (p.y - b.y) / w.zoom })
  })
}
const PLACE_KEYS = new Set(["path", "line", "find", "selection", "pane", "ui", "row", "x", "y", "under", "title", "notices"])
/** The page's elements near the point (CSS px of its window) as an ask's, in screen points, by id: what `--ax` and a
 *  drawing's `el` point at, as in another app. */
function pageNear(els: unknown[]): (Near & { id: string })[] {
  const w = host?.homeWindow(), b = w?.bounds
  if (!w || !b) return lastNear
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN)
  lastNear = els.slice(0, 40).flatMap((e) => {
    const o = (e ?? {}) as { role?: unknown; label?: unknown; frame?: Record<string, unknown> }, f = o.frame ?? {}, r = [n(f.x), n(f.y), n(f.width), n(f.height)]
    if (typeof o.label !== "string" || !o.label || r.some(Number.isNaN)) return []
    return [{ role: String(o.role ?? "").slice(0, 80), label: o.label.slice(0, 120),
      frame: { x: Math.round(b.x + r[0] * w.zoom), y: Math.round(b.y + r[1] * w.zoom), width: Math.round(r[2] * w.zoom), height: Math.round(r[3] * w.zoom) } }]
  }).map((e, i) => ({ id: `a${i + 1}`, ...e }))
  return lastNear
}
/** The home window's page answering inAppAt: only what a place has (its elements near, as they are). */
function placeTold(from: WebContents, m: { id?: unknown; place?: unknown }) {
  if (from !== host?.homeWindow()?.page || typeof m?.id !== "number") return
  const got = m.place && typeof m.place === "object" ? m.place as Record<string, unknown> : null
  const place = got ? { ...Object.fromEntries(Object.entries(got).filter(([k, v]) => PLACE_KEYS.has(k) && (typeof v === "string" || typeof v === "number"))),
    ...(Array.isArray(got.near) ? { near: got.near } : {}) } : null
  placeAsked.get(m.id)?.(place && Object.keys(place).length ? place : null)
}

function told(s: Session, e: Record<string, unknown>) {
  if (session !== s) return
  const said = (t: unknown) => s.swap.reduce((x, [re, to]) => x.replace(re, to), String(t ?? ""))
  if (s.into === "summon" && (e.type === "start" || e.type === "error" || e.type === "end" || e.type === "fallback"))
    s.of?.press?.step(`stt-${e.type}`, { ...(e.reason ? { reason: e.reason } : {}), ...(e.code ? { code: e.code } : {}), ...(e.message ? { message: String(e.message).slice(0, 200) } : {}),
      ...(e.type === "end" ? { chars: s.finals.join(" ").length } : {}) })
  if (e.type === "mic") {
    // (its device gone or changed mid-press, it went on with the next; or the one picked wasn't there by the start)
    s.bluetooth = e.bluetooth === true
    if ((e.why || e.missing) && s.into === "summon") s.of?.press?.step("mic-change", { name: String(e.name ?? ""), why: String(e.why ?? "not there at the start"), ...(e.bluetooth ? { bluetooth: true } : {}) })
    if (e.why || e.missing) micTold({ name: String(e.name ?? ""), why: `${e.why ?? "the one picked wasn't there"}: went on with it` })
  } else if (e.type === "error" && s.into === "field") {
    s.failed = String(e.message ?? "the recognizer stopped")
    s.log?.step("error", { code: String(e.code ?? ""), message: s.failed.slice(0, 200) })
  } else if (e.type === "start") s.ready = true
  else if (e.type === "level") s.level = Number(e.v) || 0
  else if (e.type === "speech" && s.into === "summon") voiceFront.speech()
  else if (e.type === "pending") s.pending = said(e.text)
  else if (e.type === "final") { const t = said(e.text).trim(); if (t) s.finals.push(t); s.pending = "" }
  else if (e.type === "end") {
    session = null
    // (cut short: what it had heard counts)
    if ((e.reason === "error" || e.reason === "elsewhere") && s.pending.trim()) s.finals.push(s.pending.trim())
    s.log?.step("end", { reason: String(e.reason ?? "") })
    if (s.bluetooth) holdMic(s.of?.press ?? undefined)
    void finish(s, e.reason === "cancel")
  }
  draw()
  if (s.into === "panel") chatChanged()
}

/** Its words: into the field (joined to what's before its caret), into the conversation's box (a Talk key's: sent), or
 *  the summoned companion's ask. */
async function finish(s: Session, cancelled: boolean) {
  const text = s.finals.reduce((all, t) => all + joinText(all, t), "").trim()
  if (s.into === "panel") {
    if (!cancelled && text) saidInBox = Date.now()
    return chatChanged(cancelled || !text ? undefined : { text, listening: false, done: true, ...(s.talk ? { send: true } : {}) })
  }
  if (s.into === "summon") {
    const m = s.of ?? summon
    if (!m || !HELD.has(m.m.phase) && m.m.phase !== "sending") return
    if (cancelled) { m.press?.end("cancelled"); closeSummon(m, "cancelled"); return draw() }
    // (the recognizer stopped while it's still held (an error, its silence): what it heard waits for the let-go)
    if (HELD.has(m.m.phase)) return failed(m, `the recognizer stopped while held${text ? "" : ", nothing heard"}`, "Stopped hearing you", text)
    // (the realtime voice gives its first sound: the summoned session is asked at once all the same, its answer said
    // after the realtime voice's few words, or dropped if it answered alone)
    if (captured(m, text)) return
    const front = voiceFront.heard(m, text)
    if (front === "done") { m.press?.end("realtime", { front: "talk" }); return }
    if (!front) return sendSummon(m, text)
    m.press?.step("realtime", { route: front === "held" ? "waiting" : "look" })
    fronted = { s: m }
    if (front === "held") speaker.hold()
    return sendSummon(m, text, { front: "realtime", talk: voiceFront.talk() })
  }
  if (cancelled || !text) {
    s.log?.end(cancelled ? "cancelled" : "nothing said")
    if (s.failed) hint(`Dictation stopped: ${s.failed}`)
    return dropOrigin(s)
  }
  const to = await land(text, {
    // (a scripted copy's window never has the keyboard: a stub says it does)
    page: async (t) => { const p = host?.focusedPage() ?? (QUIET && stubs.has("page") ? host?.homeWindow()?.page : null); return p ? askPage(p, "here", t) : null },
    front: () => screenAsk<Focus>("focus"),
    insert: (t) => screenAsk("insert", { text: t }),
    origin: (t) => backWhereItBegan(s, t),
    copy: (t) => { if (QUIET) screenAsked.push({ op: "copy", text: t }); else clipboard.writeText(t) },
    capture: async (t) => !!(await op("inbox.voice", { text: t, from: "Dictation", keep: true })),
    secret: (f) => hidden(f) || hidden(s.focus),
  })
  s.log?.end("landed", { to: to.to, chars: text.length, ...(to.how ? { how: to.how } : {}), ...(to.to === "clipboard" ? { kept: !!to.kept } : {}) })
  dropOrigin(s)
  const said = landedSaid(to, s.focus.name)
  if (s.failed) hint(`Dictation stopped: ${s.failed}`)
  else if (said) hint(said)
}
const dropOrigin = (s: Session) => { if (s.origin) void askPage(s.origin, "drop") }

/** What dictation logs, beside the Talk key's (no words: what happened, and where they went). */
const dictations = pressLog(() => path.join(app.getPath("userData"), "talk"), "dictation")

const landAsks = new Map<number, (r: { ok?: boolean; elsewhere?: boolean }) => void>()
let landIds = 0
/** A window's page, on dictated words: `here` where its keyboard is, `origin` where its session began, `drop` it's over. */
function askPage(to: WebContents, where: "here" | "origin" | "drop", text?: string): Promise<{ ok: boolean; elsewhere?: boolean } | null> {
  if (to.isDestroyed()) return Promise.resolve(null)
  const id = ++landIds
  return new Promise((done) => {
    const late = setTimeout(() => { landAsks.delete(id); done(null) }, 1500)
    landAsks.set(id, (r) => { clearTimeout(late); landAsks.delete(id); done({ ok: r.ok === true, elsewhere: r.elsewhere === true }) })
    to.send("vaultite:dictation-land", { id, where, text })
  })
}
/** Into the field it began in: where it is if that field lets it (in the background); else brought to the front and pasted. */
async function backWhereItBegan(s: Session, text: string): Promise<{ ok: boolean; name?: string }> {
  if (s.origin) return { ok: (await askPage(s.origin, "origin", text))?.ok === true }
  if (!s.focus.field) return { ok: false }
  const f = await screenAsk<{ ok?: boolean; before?: string; name?: string }>("kept", { do: "info" })
  if (!f.ok) return { ok: false }
  const words = joinText(f.before ?? "", text)
  if ((await screenAsk<{ ok?: boolean }>("kept", { do: "insert", text: words })).ok) return { ok: true, name: f.name }
  if (!(await screenAsk<{ ok?: boolean }>("kept", { do: "front" })).ok) return { ok: false }
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 100))
    if ((await screenAsk<{ ok?: boolean }>("kept", { do: "paste", text: words })).ok) return { ok: true, name: f.name }
  }
  return { ok: false }
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
  const busy = BUSY.has(a.state)
  // (an answer's box: how to reply without reaching for the mouse)
  const talk = prefs.talk.length ? keysSaid(prefs.talk.slice(0, 1)) : ""
  const hint = since && talk ? `Reply, or tap ${talk} to type, hold to talk` : undefined
  return { name, tint: a.tint, items, ...(words ? { words } : {}), ...(busy ? { busy } : {}), ...(hint ? { hint } : {}) }
}

/** Its conversation open by its cursor (`at`, the screen's), taking the keyboard: its bubble goes into it, all of it seen;
 *  `travels`: summoned, it goes with the companion. */
function openChat(name: string, at: Point, travels = false) {
  if (!based) return
  chatWords = undefined
  const d = chatOf(name)
  if (!d) return
  for (const n of live.state.notes.values()) if (n.kind === "say" && n.agent === name && !n.dismissed) live.say({ t: "hide", id: n.id })
  openPanel(based, at, d, true, travels)
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
  // (said into its box a moment ago: spoken; typed, its answer stays silent unless its voice is always on)
  const said = Date.now() - saidInBox < 60_000
  saidInBox = 0
  stopVoice()
  askedAloud = said
  live.say({ t: "moment", kind: "ask", agent: name, text, ...(await pointedAt(name, p, w?.window ? w : null)), summoned: true, ...(said ? { voice: true } : {}) })
  if (!x) { exchange = { name, p, w: w?.window ? w : null, since: Date.now() }; void screenAsk("exchange", { on: true }) }
}

// ---------- its voice: an answer to an ask by voice said aloud as it's written (voice.ts), stopped at once

/** What a scripted copy would have said aloud (it plays nothing). */
const spoken: Record<string, unknown>[] = []
/** The press whose ask went last, and when its key was let go: its answer's first sound is logged with it (`sounded`),
 *  and what its voice went through. */
let lastAsk: { press: Press; up: number; sounded?: boolean } | null = null
/** The languages the user speaks, likeliest first (two letters): dictation's hints, then the Mac's. */
const hints = () => [...new Set([...(Array.isArray(prefs.dictation.languages) ? prefs.dictation.languages.map(String) : []), ...app.getPreferredSystemLanguages()]
  .map((l) => l.split(/[-_]/)[0].toLowerCase()).filter((l) => /^[a-z]{2}$/.test(l)))]
const speaker = companionVoice({
  port: () => host?.home()?.port ?? null,
  prefs: () => prefs.voice,
  hints,
  level: (on, v) => voiceLevel(on, v),
  heard: (h) => voiceHeardLine(h),
  // (the press's log: how long from letting the key go to the answer's first sound, a voice failing over, and its
  // output changing under it (said again from a little before))
  told: (e) => {
    voiceTrouble(e)
    const x = lastAsk
    if (!x) return
    if (e.t === "fallback") return x.press.after("voice-fallback", { why: e.why, from: e.from, to: e.to })
    if (e.t === "silent") return x.press.after("voice-silent", { by: e.by, ...(e.why ? { why: e.why } : {}) })
    if (e.t === "reroute") return x.press.after("voice-reroute", { why: e.why, again: e.again })
    if (x.sounded) return
    x.sounded = true
    x.press.after("sound", { by: e.by, afterUp: Math.round(e.at - x.up), ...(e.out ? { out: e.out } : {}) })
  },
  ...(QUIET ? { record: (m: Record<string, unknown>) => void spoken.push(m) } : {}),
})
const VOICES: Record<string, string> = { elevenlabs: "ElevenLabs", soniox: "Soniox", mac: "this Mac" }
/** Its voice failing, told once a run: a cloud voice that didn't speak (not one merely slow), or none making a sound,
 *  whose answer then shows in its box by the pointer. */
function voiceTrouble(e: Parameters<NonNullable<Parameters<typeof companionVoice>[0]["told"]>>[0]) {
  if (e.t === "fallback" && !e.slow) notice(`voice-fallback-${e.from}`, `${VOICES[e.from] ?? e.from}'s voice didn't speak`,
    `${e.why[0].toUpperCase()}${e.why.slice(1)}: maybe its credits ran out or its key was refused. ${VOICES[e.to] ?? e.to}'s voice speaks meanwhile.`)
  if (e.t !== "silent") return
  const why = e.why ? `${e.why[0].toUpperCase()}${e.why.slice(1)}` : `${VOICES[e.by] ?? e.by}'s voice made no sound`
  notice("voice-silent", "The companion can't speak", `${why.replace(/^this/, "This")}, so its answer shows in its box by your pointer. vau companion status says what its voice runs on.`)
  if (exchange?.spoken && panelOpen() !== exchange.name) answerBox()
}
/** The realtime voice (realtimefront.ts): a spoken ask over the screen, its first sound at once: small talk it answers
 *  alone; for the screen two words, the summoned answer (asked at once) said after them. Callbacks are each press's. */
const voiceFront = realtimeFront<Summon>({
  config: realtimeConfig,
  name: () => live.state.name,
  languages: hints,
  player: speaker,
  route: (s, r) => {
    const mine = fronted?.s === s
    if (r.to !== "talk") { if (mine) speaker.through(); return }
    // (it answered alone: the summoned session's answer, asked meanwhile, goes unsaid and unkept)
    if (mine) { fronted = null; hushed = Date.now(); if (voiced?.quiet) clearTimeout(voiced.quiet); voiced = null; speaker.drop() }
    if (r.said) live.say({ t: "answered", agent: s.name, heard: r.heard, said: r.said, ...(mine ? { withdraw: true } : {}) })
    if (summon !== s) return
    // (its answer is whole already, said as it plays)
    s.m.send("arrived", "the realtime voice answered alone")
    s.m.send("done")
    const x = exchange?.name === s.name ? exchange : null
    openAnswer(s.name, s.p, s.w, x ? x.since : s.at)
    // (heard already: no cue for it)
    if (exchange) exchange.arrived = true
  },
  notice: (account) => notice("realtime-paused", `Realtime voice paused: ${account === "quota" ? "OpenAI account has no credits" : "OpenAI refused its key"}`,
    "The companion answers through dictation and its cloud voice meanwhile, and tries again every 10 minutes.",
    account === "quota" ? "https://platform.openai.com/settings/organization/billing" : "https://platform.openai.com/api-keys"),
  // (the server's status says so: vau companion status)
  paused: (p) => { realtimePaused = p; live.say({ t: "realtime", paused: p }) },
  // (in the press's log: what its part did, and cost)
  log: (s, t) => s.press?.after("realtime", { kind: t.kind, model: t.model, cost: Number(t.cost.toFixed(5)), ...(t.firstMs !== undefined ? { firstMs: t.firstMs } : {}), ...(t.failed ? { failed: t.failed } : {}) }),
})
/** The press the realtime voice gives the first sound for, its summoned answer said after it (held till its route);
 *  `begun`, that answer's voice begun. */
let fronted: { s: Summon; begun?: boolean } | null = null
let realtimePaused: { account: string; why: string; until: number } | null = null
/** The realtime voice's key and settings: none when it's off (voice_front pipeline, the voice off, no OpenAI key). */
async function realtimeConfig() {
  const r = prefs.realtime, port = host?.home()?.port
  if (r.front !== "realtime" || prefs.voice.mode === "off" || !port) return null
  const res = await fetch(`http://127.0.0.1:${port}/api/companion/realtime`, { headers: { "X-Vaultite-Client": "app/desktop" }, signal: AbortSignal.timeout(2000) })
  const k = (res.ok ? await res.json() : {}) as { url?: string; key?: string }
  return k.url && k.key ? { url: k.url, key: k.key, model: r.model, voice: r.voice } : null
}

/** The answer being said: the ask it answers (when it came), its says (the last still growing). Answers to asks before
 *  `hushed` are silent: stopped (the Talk key, Esc), or a newer ask came. */
let voiced: { name: string; asked: number; notes: string[]; quiet: ReturnType<typeof setTimeout> | null; texts?: Map<string, string>
  /** The press the realtime voice spoke first for: told this answer once it's whole. */
  fronted?: Summon } | null = null
let hushed = 0
/** When words were last said into a cursor's box: the ask they make is a spoken one. */
let saidInBox = 0
let speakingNow: Scene["speaking"] = null

/** One of its says, as its words come: an answer to a Talk key's ask said aloud as the setting says (`auto`: one asked
 *  by voice); its last words when the next say begins, or after a pause. */
function voiceHeard(n: Note) {
  const a = n.answers, mode = prefs.voice.mode
  if (n.kind !== "say" || !a || a.realtime || !n.text || n.dismissed || a.t < hushed || (voiced && a.t < voiced.asked)) return
  if (!voiced || voiced.asked !== a.t) {
    // (a newer ask's answer: the last one stops, said or not; the realtime voice's few words before it go on)
    const after = !!fronted && !fronted.begun && a.t >= (lastAsk?.up ?? Infinity)
    if (after) { fronted!.begun = true; hushed = Math.max(hushed, a.t); if (voiced?.quiet) clearTimeout(voiced.quiet); voiced = null } else stopVoice(a.t)
    if (mode === "off" || (mode === "auto" && !a.voice)) return
    speaker.begin("", a.lang, after)
    heardLines = []
    voiced = { name: n.agent, asked: a.t, notes: [], quiet: null, ...(after ? { fronted: fronted!.s } : {}) }
  }
  const v = voiced
  if (!v.notes.includes(n.id)) { const was = v.notes.at(-1); if (was) speaker.end(was); v.notes.push(n.id) }
  if (v.fronted) (v.texts ??= new Map()).set(n.id, n.text)
  speaker.text(n.id, n.text)
  if (v.quiet) clearTimeout(v.quiet)
  v.quiet = setTimeout(() => { if (voiced === v) speaker.end(n.id) }, 1500)
}
/** Its turn over: what it wrote last is said to its end. */
function voiceHeardAgent(a: Agent) {
  const v = voiced
  if (v?.name !== a.name || !v.notes.length || (a.state !== "watching" && a.state !== "away")) return
  speaker.end()
  // (the realtime voice's conversation told what was said after its few words, so a follow-up knows)
  if (v.fronted) { voiceFront.answer(v.fronted, [...v.texts?.values() ?? []].join(" ")); v.fronted = undefined }
}
/** The drawing up, as the server sent it; the sentences of the answer said aloud so far, as heard (any voice's), and
 *  when its pacing last learnt something (a sentence heard, the drawing come). */
let drawn: Drawing | null = null, heardLines: Heard[] = [], pacedAt = 0, waited = false, repace: ReturnType<typeof setTimeout> | null = null
/** The last ask was spoken (its answer is said aloud, as the setting `voice` is `auto`). */
let askedAloud = false
/** Until when the drawing up is held for the user to see it (drawingHold): a spoken exchange doesn't settle sooner. */
let drawingSeen = 0
function drawingCame(d: Drawing) {
  if (drawn?.id === d.id && drawn.marks.length === d.marks.length) return
  drawingSeen = Date.now() + drawingHold(Math.max(0, ...d.marks.map((m) => m.beat ?? 0)))
  setTimeout(settle, drawingSeen - Date.now() + 20).unref?.()
}
/** How long a beat waits for its sentence to be heard, with nothing heard meanwhile, before it goes by the reading time. */
const WAIT_HEARD_MS = 4000
/** A sentence heard (the companion's voice, or another that plays its answer): its drawing's pen keeps to it. */
export function voiceHeardLine(h: Heard) {
  heardLines.push({ text: h.text, at: h.at, dur: h.dur })
  // (only the one still up: one cleared or ended stays gone)
  if (drawn && drawingUp() === drawn.id) paceDrawing(true)
}
/** The drawing, each beat timed to when its sentence is heard (overlay: the pen draws while those words are said); while
 *  its words are still being said, a beat not heard yet waits for them. */
function paceDrawing(learnt = true) {
  if (learnt) pacedAt = Date.now()
  if (repace) { clearTimeout(repace); repace = null }
  // (its words still to come, or being said: its answer's voice not begun yet, or not done)
  const aloud = prefs.voice.mode === "always" || (prefs.voice.mode === "auto" && askedAloud)
  const a = drawn && live.state.agents.get(drawn.agent)
  const waits = waited = !!drawn && Date.now() - pacedAt < WAIT_HEARD_MS && beatsWait({ saying: voiced ? voiced.name === drawn.agent && speaker.saying() : null,
    aloud: aloud && exchange?.name === drawn.agent, words: !!drawn.caption, working: !!a && BUSY.has(a.state) })
  if (waits) { repace = setTimeout(() => { repace = null; paceDrawing(false) }, pacedAt + WAIT_HEARD_MS - Date.now() + 20); repace.unref?.() }
  showDrawing(drawn && (heardLines.length || waits ? { ...drawn, spoken: heardBeats(drawn.caption ?? "", heardLines), ...(waits ? { waits } : {}) } : drawn), elementPlaces(lastNear))
}
/** Silence, at once: what's said now, and what's still to come of answers asked before `until` (now). */
function stopVoice(until = Date.now()) {
  hushed = Math.max(hushed, until)
  fronted = null
  if (voiced?.quiet) clearTimeout(voiced.quiet)
  voiced = null
  speaker.stop()
  voiceFront.stop()
}
/** A Bluetooth mic stays open past its press (dictation.swift `hold`): closing it would take the headset out of its call
 *  profile ~2 s on, cutting the answer said meanwhile. Released once nothing is listened for, worked on or said, a moment on. */
let holding: ReturnType<typeof setInterval> | null = null
const HOLD_TAIL_MS = 1000, HOLD_MOST_MS = 60_000
function holdMic(press?: Press) {
  holdEnd()
  const since = Date.now()
  let quietFrom = 0
  holding = setInterval(() => {
    const x = exchange
    const busy = !!session || (!!summon && ACTIVE.has(summon.m.phase)) || (!!x && going(x)) || speaker.saying() || voiceFront.speaking()
    if (busy) quietFrom = 0
    else quietFrom ||= Date.now()
    if (Date.now() - since < HOLD_MOST_MS && (busy || Date.now() - quietFrom < HOLD_TAIL_MS)) return
    holdEnd()
    releaseMic()
    press?.after("mic-release", { heldMs: Date.now() - since })
  }, 250)
}
/** A new press takes the held mic on (or another is opened): no release meanwhile. */
function holdEnd() { if (holding) { clearInterval(holding); holding = null } }
/** The mic it hears with here and why, for its status (vau companion status), told when it changes. */
let micSent = ""
function micTold(m: { name: string; why: string }) {
  const said = micSaid(m)
  if (said === micSent) return
  micSent = said
  live.say({ t: "mic", mic: said })
}

/** Its cursor shows it speaking, its level as it goes: only the level changed, the overlay is told that alone. */
function voiceLevel(on: boolean, v: number) {
  const name = voiced?.name ?? speakingNow?.name ?? (voiceFront.speaking() ? live.state.name : undefined)
  const was = speakingNow
  speakingNow = on && name ? { name, level: Math.round(v * 20) / 20 } : null
  // (quiet now: said to its end, maybe, its exchange over, once the voice has moved on; its drawing waits no more)
  if (!on) setTimeout(() => { settle(); if (waited) paceDrawing(false) }, 50)
  if (!!was !== !!speakingNow || was?.name !== speakingNow?.name) return draw()
  if (lastScene && speakingNow && was?.level !== speakingNow.level) { lastScene = { ...lastScene, speaking: speakingNow }; showOverlay(based || null, lastScene) }
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
const placeKey = (a: Agent) => `${a.name}:${a.app ?? ""}|${a.window ?? ""}|${a.find ?? ""}|${a.sx ?? ""}|${a.sy ?? ""}|${a.path ?? ""}|${a.line ?? ""}|${a.pane ?? ""}|${a.row ?? ""}|${a.ui ?? ""}`
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

/** Where the window's cursors are (Overlay.tsx; its page's DOM, never its code), in screen points: `at` drawn now, `to`
 *  where it's going. None off screen, nor one faded where it last was (`data-faded`): none flies to or from it. */
async function inApp(): Promise<Map<string, { at: Point; to: Point }>> {
  const w = host?.homeWindow()
  if (!w || w.page.isDestroyed()) return new Map()
  const code = `[...document.querySelectorAll(".companion-cursor[data-agent]:not([data-faded])")].map((el) => { const r = el.getBoundingClientRect(),
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

const BUSY = new Set(["thinking", "reading", "writing", "starting"])
/** A press's phases: held; let go with nothing come yet; anything still to hear or say. */
const HELD = new Set<Phase>(["listening", "failed"]), WAITING = new Set<Phase>(["sending", "thinking"])
/** Let go and its turn not seen yet: words may have come before the agent's state says it's at work. */
const waiting = (s: Summon) => WAITING.has(s.m.phase) || (s.m.phase === "answering" && !s.begun)
const ACTIVE = new Set<Phase>(["listening", "failed", "sending", "thinking", "working", "answering"])
/** Whether its own place, in the exchange of summon `s`, points at something (an element, a found text, another spot,
 *  a place in Vaultite's window): not where it was summoned nor where the ask parked it. */
const pointing = (a: Agent, s: Summon) => placeKey(a) !== s.was && (!onScreen(a) || !!a.frame || !!a.find || (typeof a.sx === "number" && typeof a.sy === "number" && Math.hypot(a.sx - s.p.x, a.sy! - s.p.y) > 4))
/** Where the window would draw its place there (a pane's row, the app's UI, a note's line), in screen points: its own
 *  cursor hides while it rides with the pointer, and the riding one flies there. Asked once a place, again after a while. */
const inAppSpots = new Map<string, { p: Point | null; at: number; pending: boolean }>()
function inAppPoint(a: Agent) {
  const k = placeKey(a), had = inAppSpots.get(k)
  if (!had || (!had.pending && Date.now() - had.at > 1000)) {
    const mine = { p: had?.p ?? null, at: Date.now(), pending: true }
    inAppSpots.set(k, mine)
    // (a moment for the window to place it: the agent's news reaches it as it reaches here)
    setTimeout(() => void inApp().then((m) => { if (inAppSpots.get(k) !== mine) return; inAppSpots.set(k, { p: m.get(a.name)?.to ?? null, at: Date.now(), pending: false }); draw() }), 60)
  }
  return inAppSpots.get(k)!.p
}
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
  let aimed: { id: string; x: number; y: number; frame?: Rect } | null = null
  // (driving another app: what it does now, or that it waits for their hands, by its cursor)
  const tc = takeoverCaption(), doing = (name: string) => (tc?.agent === name ? { doing: tc.text, ...(tc.paused ? { paused: true } : {}) } : {})
  for (const a of live.state.agents.values()) {
    if (a.state === "away") continue
    // (summoned: one cursor, the summoned one, which flies to what its own place points at, on screen or in the window)
    if (s?.name === a.name) {
      if (!pointing(a, s)) continue
      if (!onScreen(a)) { const p = inAppPoint(a); if (p) aimed = { id: placeKey(a), x: p.x, y: p.y }; continue }
      const e = pointOf(a)
      if (e.p && !e.covered) aimed = { id: placeKey(a), x: e.p.x, y: e.p.y, frame: a.frame ?? e.target }
      continue
    }
    if (!onScreen(a)) continue
    // (a new place being found: it stays where it was meanwhile, or where it was summoned)
    const e = pointOf(a), p = e.p ?? (e.pending ? drawnAt.get(keyOf(a)) ?? (s?.name === a.name ? s.p : undefined) : null)
    if (!p || e.covered) continue
    // (its conversation open: its words are there)
    const say = panelOpen() === a.name ? undefined : says.filter((n) => n.agent === a.name).at(-1)
    const target = a.frame ?? e.target
    agents.push({ name: a.name, tint: a.tint, state: a.state, sx: p.x, sy: p.y, t: a.t, ...(a.seen ? { seen: true } : {}), ...(a.why ? { why: a.why } : {}), ...(target ? { target } : {}), ...doing(a.name),
      ...(say?.text ? { say: { id: say.id, text: say.text, ...(say.question ? { question: true } : {}) } } : {}) })
  }
  // (held: it rides beside the pointer through the exchange, the overlay fed the pointer; a press that's a shortcut
  // shows nothing: it waits a moment to appear)
  const ph = s?.m.phase, listening = ph === "listening"
  if (s && listening) s.p = screen.getCursorScreenPoint()
  const words = session?.into === "summon" ? [...session.finals, session.pending].reduce((all, t) => (t ? all + joinText(all, t) : all), "").trim() : ""
  const own = s ? live.state.agents.get(s.name) : undefined, busy = !!own && BUSY.has(own.state)
  if (s && busy && (ph === "thinking" || ph === "answering")) { s.begun = true; s.m.send("busy") }
  // (its turn over and nothing still said: answered, its exchange open)
  else if (s?.begun && (ph === "working" || ph === "answering") && !busy && !speakingNow && !speaker.saying() && !voiceFront.speaking()) s.m.send("done")
  // (once its turn is seen at work, it's as busy as the agent is)
  const state = !s ? "watching" : listening ? "listening" : ph === "missed" || ph === "failed" ? "missed" : busy || (s && waiting(s)) ? "thinking" : "watching"
  const home = s && besidePointer(s.p, screen.getDisplayNearestPoint(s.p).bounds)
  const called: Scene["summon"] = s && home && (!listening || Date.now() - s.at > 120)
    ? { name: s.name, tint: s.tint, state, sx: home.x, sy: home.y, follow: true, ...(words ? { words } : {}), ...doing(s.name), ...(state === "missed" && s.missed ? { missed: s.missed } : {}), ...(listening && session?.into === "summon" ? { level: Math.round(session.level * 20) / 20 } : {}), ...(aimed && !listening ? { aim: { id: aimed.id, x: Math.round(aimed.x), y: Math.round(aimed.y) } } : {}), ...(inkDown && listening ? { drag: true } : {}) } : null
  followPointer(!!called, trailed)
  // (it came: a soft cue, once a press)
  if (called && s && !s.cued) { s.cued = true; if (listening) cue("listen") }
  panelAvoid(aimed?.frame ? [aimed.frame] : [])
  for (const a of live.state.agents.values()) if (a.state !== "away") leaveWhenDone(a, says)
  watchWindows()
  const d = session
  const hintNow = hinted && hinted.until > Date.now() ? hinted : null
  const pill: Scene["pill"] = d && d.into === "field" ? { level: d.level, text: boxWords(d), pending: d.pending, ready: d.ready, ...(d.free ? { free: true } : {}) }
    : hintNow ? { level: 0, text: hintNow.text, ready: true, hint: true } : null
  lastScene = { ...handOff(agents, called), pill, speaking: speakingNow, region: regionScene() }
  ringFollows()
  showOverlay(based || null, lastScene)
  badge()
  rides()
  settle()
}
/** Who rides with the pointer now (summoned: listening, thinking, its exchange on), as the server was last told: the
 *  windows draw no cursor of its, nor its arrow at work in the status bar, meanwhile. */
let ridingSaid: string | null = null
function rides() {
  const now = summon?.name ?? ""
  if (now === ridingSaid) return
  if (live.say({ t: "riding", agent: now })) ridingSaid = now
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
/** What its box shows of the settled words: their end, as many as fit. */
const boxWords = (s: Session) => s.finals.reduce((all, t) => all + joinText(all, t), "").slice(-800)

// ---------- the server's calls (screen.text, screen.shot: plugins/core/screen)

/** Whether its voice and the Talk key's exchange went quiet within `ms`: nothing said, listened for or worked on. */
async function quiet(ms: number) {
  const busy = () => speaker.saying() || voiceFront.speaking() || (!!summon && ACTIVE.has(summon.m.phase)) || (!!exchange && going(exchange))
  for (const end = Date.now() + ms; busy(); await new Promise((r) => setTimeout(r, 250))) if (Date.now() > end) return false
  return true
}
/** The server's calls to its voice (companion.voice-sample): a sample said aloud now, for the user to hear. */
export async function voiceCall(name: string, args: unknown[]) {
  const o = (args[0] && typeof args[0] === "object" ? args[0] : {}) as { text?: unknown; provider?: unknown; after?: unknown }
  if (name !== "voice:sample" || typeof o.text !== "string" || !o.text.trim()) throw new Error(`no voice call ${name}`)
  // (news, a job's: said once its answer is, never over it; a sample asked for is said now)
  if (o.after === true && !await quiet(60_000)) return { said: false, why: "it was still speaking" }
  stopVoice()
  return speaker.sample(o.text.slice(0, 2000), o.provider === "elevenlabs" || o.provider === "soniox" ? o.provider : undefined)
}

/** A click anywhere, while the timeline keeps them: where, and what's there (Accessibility's; never a private app's). */
async function clicked(x: number, y: number) {
  if (!timelineOn() || hidden(front)) return
  const t = Date.now(), under = await underAt({ x, y }).catch(() => null)
  happened({ t, kind: "click", x, y, ...(under ? { under: under.text } : {}) })
}
/** The timeline asked (screen.timeline): a stretch of what happened, its clip saved only when asked. */
async function timelineCall(a: unknown) {
  const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined), r = o.box as Rect | undefined
  const box = r && [r.x, r.y, r.width, r.height].every((n) => typeof n === "number") ? r : undefined
  return queryTimeline({ last: num(o.last), from: num(o.from), to: num(o.to), said: typeof o.said === "string" ? o.said : undefined,
    kinds: Array.isArray(o.kinds) ? o.kinds.map(String) as never : undefined, clip: o.clip === true, ...(box ? { box } : {}) })
}
export async function screenCall(name: string, args: unknown[]) {
  if (name === "screen:timeline") return timelineCall(args[0])
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
