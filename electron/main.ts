// Vaultite as a desktop app (Electron): each vault a window with its server (its own, or one here: host.ts); see CLAUDE.md.
// Env: VAULTITE_USER_DATA, _DEBUG_PORT, _LOCAL, _QUIET, _UPDATE_URL, _SETUP_HOME (tests); `--vault <path>` opens one.
import "../core/winspawn.ts" // (first: on Windows no program the main process starts opens a console window)
import "./dockenv.ts" // (before anything reads the environment)
import { app, BaseWindow, type BaseWindowConstructorOptions, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, session, shell, systemPreferences, type IpcMainInvokeEvent, type Rectangle, type WebContents, type WebPreferences } from "electron"
import { AppWindow } from "./appwindow.ts"
import { relaunchOptions, vaultArg } from "./argv.ts"
import { QUIET, quiet, quietPage } from "./quiet.ts"
import { execFile, execFileSync, fork, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { menuTemplate, type MenuSnapshot } from "./menu.ts"
import { revive, stripKit, unloadPages, webHandlers, webWindow } from "./web.ts"
import "./browser/index.ts"
import { engineBusy, engineFlush, serverCall, setServerSink } from "./browser/engine.ts"
import { attach, attachable, servedHere, type Call, type Link } from "./host.ts"
import type { Adopted } from "./heir.ts"
import { servingOf, type Serving } from "../core/serving.ts"
import { talkCall } from "./talklog.ts"
import { CODE, DEV, HOST, WORKTREE } from "./identity.ts"
import { codeRoot, commitAt, hold } from "./storehost.ts"
import { DESKTOP_PROTOCOL } from "../core/desktopapp.ts"
import { appUpdates, checkInstalled, initUpdates, launchedFrom, logUpdate, lookNow, mainBehind, updatesReady, modeChanged, pageSafe, quitUpdates, RELEASE, restartToUpdate, scheduleUpdates, updatable, UPDATE_MODES, updateMenuItem, worktreeChanged, worktreeNow,
  windowReady, type UpdateMode } from "./updates.ts"
import { appHandlers, appsOn, appsWindow, stopApps } from "./apps.ts"
import { dictationHandlers, setDictationServer, stopDictation } from "./dictation.ts"
import type { HelperHost, HelperPrefs } from "./helper.ts"
import type { HelperSlot } from "./helperload.ts"
import { setTranslucent, translucentAt, translucentWindow } from "./translucency.ts"
import { hideGhost, showGhost, type GhostLook } from "./dragghost.ts"
import { openSandbox, refreshSandbox, sandboxPath } from "./sandbox.ts"
import { parseRepo, repoText } from "../core/bundlelinks.ts"
import { plainError, plainText, sentence } from "../core/plainerror.ts"
import { inVault, otherAppScheme, runsCode } from "../core/opening.ts"
import { permissionFor, whose } from "./apppermissions.ts"
import * as Setup from "./setup.ts"
import { gitEnv } from "../core/gitenv.ts"
import { vauEntry } from "../core/appentry.ts"
import { strings } from "../core/values.ts"

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PRELOAD = path.join(ROOT, "electron", "preload.cjs")
const DIST = path.join(ROOT, "web", "dist")
const ICON = path.join(ROOT, "web", "public", "icon-512.png")
const MAC = process.platform === "darwin"
// Where a Mac window's traffic lights sit (points from its top-left corner) until its page places them
// (window:lights): web/src/index.css lays the sidebar's top row out around them.
const LIGHTS = { x: 16, y: 14 }
// Each button (points), to centre them on a row and for the page's stand-ins (core/peek.ts): macOS 26 draws a 14pt
// circle filling its frame, 23pt apart; before it, a 12pt circle in a 14×16 frame, 20pt apart.
const BUTTONS = MAC && Number(process.getSystemVersion().split(".")[0]) >= 26
  ? { width: 14, height: 14, size: 14, pitch: 23 } : { width: 14, height: 16, size: 12, pitch: 20 }
const LINUX = process.platform === "linux"
const WIN = process.platform === "win32"
/** The window's own title bar: the Mac's traffic lights over the page; Windows' controls drawn over its top-right corner
 *  (titleBarOverlay, coloured as the page tells: window:controls); Linux keeps its system title bar. */
const CONTROLS_HEIGHT = 40
const chrome = (): BaseWindowConstructorOptions => WIN
  ? { titleBarStyle: "hidden", titleBarOverlay: { color: background(), symbolColor: nativeTheme.shouldUseDarkColors ? "#ffffff" : "#000000", height: CONTROLS_HEIGHT } }
  : { titleBarStyle: "hiddenInset", trafficLightPosition: LIGHTS }

// Under --no-sandbox (an AppImage under AppArmor, Playwright on Linux) renderers no window makes keep Electron's sandboxed
// renderer, which runs service-worker preloads; not as root, where Chromium sandboxes nothing and each would die.
if (app.commandLine.hasSwitch("no-sandbox") && process.getuid?.() !== 0) app.commandLine.appendSwitch("enable-sandbox")
// VAULTITE_QUIET=1 (web/qa's desktop scripts): quiet.ts.
if (QUIET) {
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows")
  app.commandLine.appendSwitch("disable-renderer-backgrounding")
  app.on("browser-window-created", (_e, w) => quiet(w, w.webContents))
  app.on("web-contents-created", (_e, wc) => quietPage(wc))
  AppWindow.each((w) => quiet(w, w.webContents))
  app.focus = () => {}
  void app.whenReady().then(() => app.dock?.hide())
}
// A copy a script drives (VAULTITE_QUIET, or Playwright's launch, always with a debugging port; the app's own is added
// below) plays nothing aloud, AirPods included: a test's YouTube page would. VAULTITE_SOUND=1 for a test that needs it.
const driven = !!process.env.VAULTITE_QUIET || app.commandLine.hasSwitch("remote-debugging-port")
if (driven && !process.env.VAULTITE_SOUND) app.commandLine.appendSwitch("mute-audio")
// It never asks for the system's keychain either: a password prompt nobody's there to answer hangs the run.
if (driven) { app.commandLine.appendSwitch("use-mock-keychain"); app.commandLine.appendSwitch("password-store", "basic") }
// Under Playwright, a page's frame swapped out as it navigates (RenderDocument) can crash its renderer turning off
// Playwright's focus emulation (Blink's race: QA's "Target crashed"); no user page has it, so only there it's off.
if (app.commandLine.hasSwitch("remote-debugging-port")) {
  app.commandLine.appendSwitch("disable-features", [app.commandLine.getSwitchValue("disable-features"), "RenderDocument"].filter(Boolean).join(","))
}
// A Mac takes a window's icon from the bundle, a packaged Windows app from its .exe; on Linux (and Windows from source)
// each window carries it (the taskbar, Alt+Tab), else Electron's.
if (LINUX || (WIN && !app.isPackaged)) { app.on("browser-window-created", (_e, w) => w.setIcon(ICON)); AppWindow.each((w) => w.setIcon(ICON)) }
// VAULTITE_BEHIND=1 (npm run app:dev): the windows opened at launch wait to be shown until the user switches to the app,
// rather than popping up over their work.
let behind = !!process.env.VAULTITE_BEHIND
// What macOS runs rather than shows when opened (an app, a script, a link to one): a vault file of these, which a
// synced or shared vault may bring, is shown in Finder instead of opened.
function openVaultFile(abs: string) {
  let runs = runsCode(abs)
  try { runs ||= fs.statSync(abs).isDirectory() } catch { return }
  if (runs) shell.showItemInFolder(abs); else void shell.openPath(abs)
}
/** A link the app's page hands to the system, as Obsidian does: any app's scheme the Browser's pages may open too
 *  (obsidian://, tel:); a file:// one as a vault file opens (with the Mac's app for it, an app or a folder in Finder). */
async function openLink(url: string) {
  if (/^file:/i.test(url)) {
    // (one on another computer, file://host/x, is a Windows network path: reaching it sends the user's login hash)
    try { if (["", "localhost"].includes(new URL(url).hostname)) openVaultFile(fileURLToPath(url)) } catch { /* not a file address */ }
    return
  }
  const scheme = otherAppScheme(url)
  if (!scheme) return
  // (another app does what the link says: asked first, as browsers do, whoever wrote the note and however it was clicked)
  if (!["http", "https", "mailto"].includes(scheme)) {
    const { response } = await dialog.showMessageBox({ type: "question", buttons: ["Open", "Cancel"], defaultId: 1, cancelId: 1, message: "Open this link in another app?", detail: url })
    if (response !== 0) return
  }
  shell.openExternal(url).catch((e) => console.error(`couldn't open ${url.split(":")[0]}: link`, e))
}
// An uncaught exception or rejection here goes to the open vaults' Errors, never Electron's error box, which stops
// everything and shows even over the QA scripts' quiet windows.
function uncaught(kind: "uncaught" | "rejection", e: unknown) {
  const err = e instanceof Error ? e : new Error(String(e))
  console.error(`main process, ${kind}:`, err)
  try {
    const body = JSON.stringify({ device: "desktop", errors: [{ kind, t: Date.now(), message: `Main process: ${err.message}`, stack: err.stack ?? "", build: CODE?.commit ?? "" }] })
    for (const w of wins.values()) void fetch(`http://127.0.0.1:${w.port}/api/errors`, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {})
  } catch { /* before the windows exist */ }
}
/** The shell's record (electron/shell/boot.mjs): this run is ready once the first vault window's page is up (its server
 *  answered), or the launch is done with none. What it recorded since then goes to that window's Errors (vau errors). */
let shellTold = false, shellReported = false
function shellReady(w: Win | null) {
  if (!shellTold) { shellTold = true; HOST?.ready(); updatesReady() }
  if (!w || shellReported || !HOST) return
  shellReported = true
  const short = (c: string | null) => c?.slice(0, 7) ?? "this build"
  const events = HOST.events(), passed = events.find((e) => e.kind === "passed")
  launchedFrom({ from: HOST.from, commit: CODE?.commit ?? null, ...(passed ? { fellBack: { commit: passed.commit, why: passed.why } } : {}) })
  const errors = events.map((e) => ({ kind: "boot", t: e.t, stack: "", build: CODE?.commit ?? "",
    message: e.kind === "passed" ? `The app didn't start on ${short(e.commit)}: ${e.why}; it runs ${short(CODE?.commit ?? null)}`
      : `The app ${e.kind === "late" ? "was slow to start" : e.kind === "crashed" ? "crashed starting" : "couldn't start"} on ${short(e.commit)}: ${e.why}` }))
  if (errors.length) void fetch(`http://127.0.0.1:${w.port}/api/errors`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device: "desktop", errors }) }).catch(() => {})
}
const told = new WeakSet<object>()
/** A failure told in a box: what happened in plain words (core/plainerror.ts), `why` when the error has none to give;
 *  the exact text behind Copy details, and a log when there is one. */
function failedBox(title: string, e: unknown, o: { why?: string; log?: string } = {}) {
  // (once: openVault tells its own and rethrows to its caller)
  if (typeof e === "object" && e) { if (told.has(e)) return; told.add(e) }
  const { reason, detail } = plainError(e)
  const box = { type: "warning" as const, message: title, detail: reason ? sentence(reason) : o.why ?? "Something went wrong.",
    buttons: ["OK", "Copy details", ...(o.log ? ["Show log"] : [])], defaultId: 0, cancelId: 0 }
  console.error(`vaultite: ${title}:`, detail)
  void dialog.showMessageBox(box).then((r) => {
    if (r.response === 1) clipboard.writeText(`${title}\n${detail}`)
    if (r.response === 2 && o.log) void shell.openPath(o.log)
  })
}
const serverLog = (p: string) => path.join(app.getPath("logs"), `server-${nameOf(p)}.log`)
process.on("uncaughtException", (e) => uncaught("uncaught", e))
process.on("unhandledRejection", (e) => uncaught("rejection", e))
const LOCAL = process.env.VAULTITE_LOCAL || (app.isPackaged ? path.join(app.getPath("userData"), "local") : path.join(ROOT, "data"))

// ---------- the vault list (this Mac's) ----------
type Known = {
  path: string; port?: number; open?: boolean; last?: number
  bounds?: Rectangle; maximized?: boolean
  /** Its page last hid the traffic lights (a sidebar hidden without rails): its window opens without them. */
  lightsOff?: boolean
  /** Files from outside the vault opened in its window: allowed again when its server starts (tabs come back). */
  outside?: string[]
}
const LIST = () => path.join(app.getPath("userData"), "vaults.json")
/** Zoom steps, like Chrome's. */
const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
let known: Known[] = []
/** Other machines' servers opened here (Set up Vaultite's "Another machine"), like the iPhone app's list. */
type Remote = { url: string; name: string; open?: boolean; last?: number; bounds?: Rectangle }
let remotes: Remote[] = []
/** The interface size, the windows' zoom (web/src/core/zoom.ts), kept for the next launch. One for every window:
 *  Chromium zooms by host, and every vault's server is on 127.0.0.1. */
let zoom = 1
/** Chromium's DevTools protocol on 127.0.0.1:<port> for agents (VAULTITE_DEBUG_PORT, else vaults.json's `debugPort`).
 *  Off unless set: any process on this Mac that reaches the port controls the app. */
let debugPort: number | undefined
/** How this Mac takes updates (updates.ts). */
let updates: UpdateMode = "notify"
/** The menu-bar helper's, on this Mac (electron/helper.ts). */
let helperPrefs: HelperPrefs = {}
try {
  const v = JSON.parse(fs.readFileSync(LIST(), "utf8"))
  known = Array.isArray(v.vaults) ? v.vaults.filter((x: Known) => x && typeof x.path === "string") : []
  remotes = Array.isArray(v.servers) ? v.servers.filter((x: Remote) => x && typeof x.url === "string" && /^https?:\/\//.test(x.url)) : []
  if (typeof v.zoom === "number" && v.zoom >= ZOOMS[0] && v.zoom <= ZOOMS[ZOOMS.length - 1]) zoom = v.zoom
  if (Number.isInteger(v.debugPort) && v.debugPort > 1024 && v.debugPort < 65536) debugPort = v.debugPort
  if (UPDATE_MODES.includes(v.updates)) updates = v.updates
  if (v.helper && typeof v.helper === "object") helperPrefs = v.helper
} catch { /* first launch */ }
const envPort = Number(process.env.VAULTITE_DEBUG_PORT)
const devtools = Number.isInteger(envPort) && envPort > 1024 && envPort < 65536 ? envPort : debugPort
if (devtools) {
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1")
  app.commandLine.appendSwitch("remote-debugging-port", String(devtools))
}
let saveTimer: ReturnType<typeof setTimeout> | null = null
function save(now = false) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  const write = () => {
    Setup.writeAtomic(LIST(), JSON.stringify({ vaults: known, ...(remotes.length ? { servers: remotes } : {}), ...(zoom === 1 ? {} : { zoom }), ...(debugPort ? { debugPort } : {}),
      ...(updates === "notify" ? {} : { updates }), ...(Object.keys(helperPrefs).length ? { helper: helperPrefs } : {}) }, null, 2) + "\n")
  }
  if (now) write()
  else saveTimer = setTimeout(write, 500)
}
// (the sandbox is the playground wherever its name shows)
const nameOf = (p: string) => (p === sandboxPath() ? "Playground" : path.basename(p) || p)
const find = (p: string) => known.find((v) => v.path === p)
function remember(p: string) {
  let v = find(p)
  if (!v) known.push((v = { path: p }))
  v.last = Date.now()
  save()
  buildMenu()
  return v
}
const real = (p: string) => {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}
/** The known vault a path is in, and its path there. */
function vaultOf(p: string): [Known, string] | null {
  const r = real(p)
  for (const v of known) {
    const root = real(v.path)
    if (r.startsWith(root + path.sep)) return [v, path.relative(root, r).split(path.sep).join("/")]
  }
  return null
}

// ---------- servers ----------
/** A vault's port: its last (localStorage is by origin), else new; never probed (slow at startup): PortTaken. */
function portFor(v: Known, taken = false) {
  if (v.port && !taken) return v.port
  let p: number
  do p = (DEV ? 40000 : 20000) + Math.floor(Math.random() * 20000)
  while (known.some((k) => k.port === p))
  v.port = p
  save()
  return p
}
class PortTaken extends Error {}

/** `server`: the one it started; `link`: the server it attached to instead, one already serving the vault here. */
type Win = { vault: Known; win: AppWindow; server: ChildProcess | null; link: Link | null; port: number; ready: boolean; queue: string[]
  /** Its server goes with it, the helper on or not (it reopens with a new one: apps:reopen). */
  ending?: boolean
  /** Its server was stopped to start again on purpose (a Dev instance's code changed, an update): not a crash. */
  restarting?: boolean
  /** The commit of the web build its server serves, when that isn't its code's (the store's adopt-web). */
  web?: string
  /** Opened by Set up Vaultite: its page shows the welcome card's next pages (asked once, `app:welcome`). */
  welcome?: boolean
  /** What its page last told the menu bar (`menu:sync`): its commands, pins and recent files. */
  menu?: MenuSnapshot }
const wins = new Map<string, Win>() // vault path -> its window
/** Servers kept with no window, while the menu-bar helper runs (its home vault's, any closed since): reopening takes them. */
type Kept = { server: ChildProcess | null; link: Link | null; port: number }
const kept = new Map<string, Kept>()
/** The vault window focused last: the helper's home. */
let lastFocused: string | null = null
/** macOS's permissions (electron/permissions.ts and its native addon's build), loaded when Settings first asks: not at launch. */
const macPermissions = () => import("./permissions.ts")

/** The menu-bar helper (electron/helper.ts), loaded once the app is ready when it's wanted: not at launch's cost. */
let helper: typeof import("./helper.ts") | null = null
/** The helper's code root, swapped by the store's updates (helperload.ts). */
let helperAt: HelperSlot | null = null
const helperOn = () => !!helper?.helperOn()
const homeChanged = () => helper?.homeChanged()
/** Pop-out windows (a tab moved out of a vault's window: the page opens `/?popout=<id>`), by their
 *  page, with the vault window they came from: its server, its IPC. */
const popouts = new Map<WebContents, Win>()

/** Servers on their way up or running, by vault path: each vault's is started once. */
const booting = new Map<string, Promise<[ChildProcess, number]>>()
/** The pids of the servers this app runs: forked, or taken over from its last launch (adopt). */
const ownPids = new Set<number>()
function ownServer(pid: number | undefined, s: { once(e: "exit", fn: () => void): unknown }) {
  if (!pid) return
  ownPids.add(pid)
  s.once("exit", () => ownPids.delete(pid))
}
/** The server serving `p` here to attach to (servedHere): never the one this launch started (at launch, before its
 *  window), which claims the vault too: attached, it would pin the app's updates to its own commit (storepolicy.ts). */
const servedElsewhere = (p: string) => (booting.has(p) ? Promise.resolve(null) : servedHere(p))
function serverFor(v: Known) {
  let b = booting.get(v.path)
  if (!b) {
    b = (async (): Promise<[ChildProcess, number]> => {
      for (let tries = 0; ; tries++) {
        const port = portFor(v, tries > 0)
        try {
          return [await startServer(v, port), port]
        } catch (e) {
          if (!(e instanceof PortTaken) || tries >= 5) throw e
        }
      }
    })()
    booting.set(v.path, b)
    b.catch(() => booting.delete(v.path)) // a failed start is tried again next time
  }
  return b
}

/** Its server's calls to the browser engine (core/desktopapp.ts asks, electron/browser/engine.ts answers), macOS's
 *  permissions (core/coreops/permissions.ts), the app's updates (app.version), the Dictations list (plugins/core/dictation). */
const answerCall = (v: Known, m: Call) => Promise.resolve().then(() => m.name === "app:permissions" ? (MAC ? macPermissions().then((p) => p.macPermissions()) : null)
  : m.name === "app:updates" ? appUpdates()
  : m.name === "app:update-look" ? lookNow(Array.isArray(m.args) ? m.args[0] as { port?: unknown; commit?: unknown } : undefined)
  : typeof m.name === "string" && m.name.startsWith("screen:") ? (helper ? helper.screenCall(m.name, Array.isArray(m.args) ? m.args : []) : null)
  : typeof m.name === "string" && m.name.startsWith("talk:") ? talkCall(m.name, Array.isArray(m.args) ? m.args : [])
  : typeof m.name === "string" && m.name.startsWith("dictations:") ? (MAC ? import("./dictationlist.ts").then((d) => d.dictationsCall(String(m.name), Array.isArray(m.args) ? m.args : [])) : { items: [], total: 0, here: false })
  : typeof m.name === "string" && m.name.startsWith("voice:") ? (helper ? helper.voiceCall(m.name, Array.isArray(m.args) ? m.args : []) : { said: false, why: "no menu-bar helper here" })
  : serverCall(wins.get(v.path)?.win, m.name, Array.isArray(m.args) ? m.args : []))

/** Push an event to a vault's server unasked (core/desktopapp.ts onDesktopEvent): the one way the main process does. */
function desktopEvent(w: Win, name: string, data: unknown) {
  const m = { type: "desktop:event", name, data }
  if (w.server?.connected) w.server.send(m); else w.link?.send(m)
}
setServerSink((win, name, data) => { for (const w of wins.values()) if (w.win === win) desktopEvent(w, name, data) })

/** The root each own server runs (its code's commit: commitAt). */
const rootOf = new WeakMap<ChildProcess, string>()
/** Where each own server's log was when it started: what it said since. */
const logFrom = new WeakMap<ChildProcess, number>()
/** A server the last launch left, taken over (heir.ts: loaded only then). */
const adopted = (s: ChildProcess | null): s is ChildProcess & Adopted => typeof (s as { release?: unknown } | null)?.release === "function"
/** What a server wrote to its log since `from` (its start): the last 2000 characters. */
function logSince(file: string, from: number) {
  try {
    const fd = fs.openSync(file, "r")
    try {
      const end = fs.fstatSync(fd).size, start = Math.max(from, end - 8000), buf = Buffer.alloc(Math.max(0, end - start))
      fs.readSync(fd, buf, 0, buf.length, start)
      return buf.toString("utf8").slice(-2000)
    } finally { fs.closeSync(fd) }
  } catch { return "" }
}
/** Servers are left running through a relaunch (an update's: server.ts waits for the next launch to take them over). */
let handingOver = false
function startServer(v: Known, port: number, own = false): Promise<ChildProcess> {
  const logDir = app.getPath("logs")
  fs.mkdirSync(logDir, { recursive: true })
  // (a file, not a pipe: a server outlives this process through a relaunch, and goes on writing)
  const logFile = serverLog(v.path), fd = fs.openSync(logFile, "a"), from = fs.fstatSync(fd).size
  // (from the store's current root, Main's updates: storehost.ts; else its own)
  const root = own ? ROOT : codeRoot()
  const child = fork(path.join(root, "server.ts"), [], {
    cwd: root, stdio: ["ignore", fd, fd, "ipc"], detached: !WIN,
    env: {
      ...process.env, ELECTRON_RUN_AS_NODE: "1", VAULTITE_DESKTOP: "1", VAULTITE_VAULT: v.path, VAULTITE_LOCAL: LOCAL,
      HOST: "127.0.0.1", PORT: String(port),
      // (Node's compile cache from its first module, kept with the app's data: the temp folder, emptied by restarts and
      // cleanups, made the next launch strip every file's types again)
      NODE_COMPILE_CACHE: process.env.NODE_COMPILE_CACHE || path.join(app.getPath("userData"), "compile-cache"),
      // (for its startup's span, core/spans.ts)
      VAULTITE_LAUNCHED_AT: String(Math.round(Date.now() - process.uptime() * 1000)), VAULTITE_FORKED_AT: String(Date.now()),
    },
  })
  fs.closeSync(fd)
  rootOf.set(child, root)
  logFrom.set(child, from)
  ownServer(child.pid, child)
  if (child.pid) hold(root, child.pid, "server")
  // (one from another root than this process's may speak another protocol: it says first, and one that doesn't match
  // gives way to one of this app's own code, the app offered its relaunch onto the newer)
  let spoke: unknown = root === ROOT ? DESKTOP_PROTOCOL : undefined
  child.on("message", (m: { type?: string; protocol?: unknown }) => { if (m?.type === "desktop:hello") spoke = m.protocol })
  child.on("message", (m: Call) => {
    if (m?.type !== "desktop:call" || typeof m.rid !== "number") return
    const reply = (r: { value?: unknown; error?: string }) => { if (child.connected) child.send({ type: "desktop:reply", rid: m.rid, ...r }) }
    answerCall(v, m).then((value) => reply({ value }), (e) => reply({ error: e instanceof Error ? e.message : String(e) }))
  })
  return new Promise((ok, fail) => {
    const said = () => logSince(logFile, from)
    const timer = setTimeout(() => { clearInterval(look); fail(new Error(`the server didn't start in time\n${said()}`)) }, 120_000)
    let up = false
    const listening = () => {
      if (up) return
      up = true
      clearTimeout(timer)
      clearInterval(look)
      if (spoke === DESKTOP_PROTOCOL) return ok(child)
      console.error(`vaultite: ${nameOf(v.path)}'s server from ${root} speaks protocol ${String(spoke ?? "?")}, this app ${DESKTOP_PROTOCOL}: its own code instead`)
      const c = commitAt(root)
      if (c) mainBehind(c)
      child.removeAllListeners("exit")
      child.once("exit", () => startServer(v, port, true).then(ok, fail))
      child.kill()
    }
    // (it says so; one of an older root only logs it)
    child.on("message", (m: { type?: string }) => { if (m?.type === "desktop:listening") listening() })
    const look = setInterval(() => { if (/vaultite on http/.test(said())) listening() }, 500)
    child.once("exit", (code) => {
      clearTimeout(timer)
      clearInterval(look)
      const out = said()
      fail(/EADDRINUSE/.test(out) ? new PortTaken(`port ${port} is taken`) : new Error(`the server stopped (exit ${code})\n${out}`))
    })
    if (v.outside?.length) child.send({ type: "allow", paths: v.outside })
  })
}

// ---------- windows ----------
const background = () => (nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ffffff")
let quitting = false
let manager: AppWindow | null = null
/** Files to open once a vault window is there (Open with, before anything was open). */
const waiting: string[] = []

/** A window whose page hangs (a plugin in a loop) offers to reload it, rather than freeze until the app is quit; the
 *  box goes if the page comes back on its own. Its crash is `revive`'s to reload. */
function hangs(win: AppWindow, name: string) {
  let asking: AbortController | null = null
  win.webContents.on("unresponsive", async () => {
    if (asking || win.isDestroyed()) return
    const ask = (asking = new AbortController())
    const r = await dialog.showMessageBox(win, { type: "warning", message: `${name} isn't responding`, detail: "Wait for it, or reload its page.",
      buttons: ["Wait", "Reload"], defaultId: 0, cancelId: 0, signal: ask.signal }).catch(() => ({ response: 0 }))
    asking = null
    if (r.response === 1 && !ask.signal.aborted && !win.isDestroyed()) win.webContents.forcefullyCrashRenderer()
  })
  win.webContents.on("responsive", () => asking?.abort())
}
/** A page `revive` gave up on (it kept crashing): say so, with Reload or Close window, never left blank. */
function crashedFor(win: AppWindow, name: string) {
  return () => {
    if (win.isDestroyed()) return
    void dialog.showMessageBox(win, { type: "error", message: `${name} keeps stopping`, detail: "Its page crashed three times in a minute.",
      buttons: ["Reload", "Close window"], defaultId: 0, cancelId: 1 }).then((r) => {
      if (win.isDestroyed()) return
      if (r.response === 0) win.webContents.reload(); else win.close()
    }, () => {})
  }
}

async function openVault(p: string, file?: string) {
  const open = wins.get(p)
  if (open) {
    if (open.win.isMinimized()) open.win.restore()
    open.win.focus()
    if (file) send(open, file)
    return open
  }
  if (!fs.statSync(p, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${p} isn't a folder`)
  // (only a test run's app asks: core/testrun.ts stays out of the app's launch)
  const own = process.env.VAULTITE_TEST === "1" && (await import("../core/testrun.ts")).refuseOwnVault(p, "the desktop app")
  if (own) throw new Error(own)
  const v = remember(p)
  // (its server kept by the helper: taken back; an attached one attaches again, for this window)
  const had = kept.get(p)
  kept.delete(p)
  had?.link?.stop()
  // (served here already, by its service: the window attaches to that server)
  const there = had?.server && had.server.exitCode === null ? null : await servedElsewhere(p).catch((e) => { failedBox(`Couldn't open ${nameOf(p)}`, e, { why: "Its server didn't start." }); throw e })
  const starting = there ? null : serverFor(v)
  // The window (and its renderer process) is made while the server starts; its page loads once the server listens.
  const b = v.bounds
  const apps = appsOn(p), glass = translucentAt(p), clear = apps || (MAC && glass)
  const win = new AppWindow({
    width: b?.width ?? 1280, height: b?.height ?? 820, x: b?.x, y: b?.y, minWidth: 800, minHeight: 480, show: false,
    title: dev?.titled(nameOf(p)) ?? nameOf(p), ...chrome(),
    // (a click in a window that's behind acts too, as in a browser: a web page's field it lands on gets the keyboard,
    // not whatever had it in the app before)
    acceptFirstMouse: true,
    // (App windows on: transparent, the page paints itself and leaves app tabs see-through, electron/apps.ts; translucent:
    // the system's blur shows only through a transparent window, electron/translucency.ts)
    ...(clear ? { transparent: true, backgroundColor: "#00000000" } : { backgroundColor: background() }),
    // bypassHeatCheck: V8 caches the app's compiled scripts on the first launch, not the third (like VS Code).
    webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true, spellcheck: true, v8CacheOptions: "bypassHeatCheck" },
  })
  // (not shown where they sit by default while the page that hides them loads)
  if (MAC && v.lightsOff) setLights(win, null)
  let server: ChildProcess | null = null, link: Link | null = null, port: number, loadFailed = false
  const outside = () => (v.outside?.length ? [{ type: "allow", paths: v.outside }] : [])
  try {
    if (there && heirHere(there)) [server, port] = [await adopt(v, there), there.port]
    else if (there) {
      port = there.port
      // (a page that loaded while its server was down is Chromium's error page: loaded again once it's back)
      link = await attach(p, there, (m) => answerCall(v, m), () => { if (loadFailed && !win.isDestroyed()) void win.loadURL(`http://127.0.0.1:${port}/`).catch(() => {}); return outside() })
    } else [server, port] = await starting!
  } catch (e) {
    win.destroy()
    failedBox(`Couldn't open ${nameOf(p)}`, e, { why: "Its server didn't start.", log: serverLog(p) })
    throw e
  }
  const w: Win = { vault: v, win, server, link, port, ready: false, queue: file ? [file] : [] }
  wins.set(p, w)
  if (server) checkInstalled(w)
  v.open = true
  save()
  // (maximized as it's shown: maximizing shows a hidden window)
  const show = () => { if (win.isDestroyed()) return; if (v.maximized) win.maximize(); win.show() }
  if (v.maximized && !behind) win.maximize()
  void win.ready.then(() => { if (behind) app.once("did-become-active", show); else win.show() })
  // A swipe between pages (the trackpad's, when set to swipe that way): the tab's Back and Forward.
  win.on("swipe", (_e, dir) => { if (dir === "left" || dir === "right") win.webContents.send("vaultite", { type: "command", id: dir === "left" ? "nav:back" : "nav:forward" }) })
  const keep = () => {
    if (win.isDestroyed()) return
    v.maximized = win.isMaximized()
    if (!v.maximized && !win.isFullScreen()) v.bounds = win.getBounds()
    save()
  }
  win.on("resize", keep)
  win.on("move", keep)
  win.on("close", () => {
    keep()
    if (!quitting) v.open = false // closed by hand: not reopened next launch
    save(true)
  })
  win.on("focus", () => { if (lastFocused !== p) { lastFocused = p; homeChanged() } })
  lastFocused = p
  win.on("closed", () => {
    wins.delete(p)
    // (the menu-bar helper keeps it: the companion goes on, and the window reopens at once)
    if (helperOn() && !quitting && !w.ending && (w.link || w.server?.exitCode === null)) keepServer(p, { server: w.server, link: w.link, port: w.port })
    else {
      booting.delete(p)
      if (!handingOver) w.server?.kill()
      else if (adopted(w.server)) w.server.release()
      w.link?.stop()
    }
    homeChanged()
    buildMenu()
  })
  // The server ends on its own only on failure: soon after start, a vault it can't open (say why, close the window);
  // later, a crash: a new one on the same port, which the page reconnects to (errors.ts), three times a minute at most.
  let since = Date.now(), restarts: number[] = []
  const watchServer = (child: ChildProcess) => {
    child.on("exit", (code) => {
      const said = logSince(serverLog(p), logFrom.get(child) ?? Infinity)
      if (win.isDestroyed() || quitting || child !== w.server) return
      const now = Date.now(), meant = !!w.restarting
      w.restarting = false
      restarts = restarts.filter((t) => now - t < 60_000)
      const fail = (why: string) => {
        if (win.isDestroyed()) return
        const starting = now - since < 10_000 && !restarts.length
        failedBox(`Couldn't ${starting ? "open" : "keep running"} ${nameOf(p)}`, new Error(why),
          { why: starting ? "Its server stopped as it started." : "Its server stopped three times in a minute.", log: serverLog(p) })
        win.close()
      }
      if (!meant && (now - since < 10_000 || restarts.length >= 3)) return fail(`the server stopped (exit ${code})\n${said}`)
      if (!meant) restarts.push(now)
      console.error(`vaultite: ${nameOf(p)}'s server stopped (${meant ? "to run new code" : `exit ${code}`}), starting it again`)
      // (its own port, never another: the page's localStorage is kept by it)
      const at = w.port, started = startServer(v, at)
      const up = started.then((c): [ChildProcess, number] => [c, at])
      up.catch(() => {}) // (said below)
      booting.set(p, up)
      started.then((next) => {
        if (win.isDestroyed()) return void next.kill()
        w.server = next
        since = Date.now()
        watchServer(next)
        // (a page that tried to load while it was down is Chromium's error page, which can't reconnect)
        if (!win.webContents.getURL().startsWith(`http://127.0.0.1:${at}/`) || loadFailed) { w.ready = false; void win.loadURL(`http://127.0.0.1:${at}/`).catch(() => {}) }
      }, (e) => { booting.delete(p); fail(String((e as Error).message ?? e)) })
    })
  }
  win.webContents.on("did-start-loading", () => { loadFailed = false })
  win.webContents.on("did-fail-load", (_e, code, _d, _u, main) => { if (main && code !== -3) loadFailed = true })
  if (server) watchServer(server)
  win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(zoom))
  // Its page's process killed or crashed: load the page again (files sent meanwhile wait for it, `app:ready`).
  revive(win.webContents, () => { w.ready = false }, crashedFor(win, nameOf(p)))
  hangs(win, nameOf(p))
  guard(win, `http://127.0.0.1:${port}`)
  webWindow(win)
  translucentWindow(win, clear, glass)
  if (apps) appsWindow(win)
  await win.loadURL(`http://127.0.0.1:${port}/`)
  homeChanged()
  if (manager && !manager.isDestroyed()) manager.close() // opening a vault closes the manager
  buildMenu()
  return w
}

/** Whether `s` is a server this app's last launch left for this one (its relaunch: server.ts). */
const heirHere = (s: Serving) => !!s.heir && s.app && s.heir.app === app.getPath("userData")
/** Take over the server the last launch left (heirHere): this launch's own from now on, as one it forked. */
async function adopt(v: Known, s: Serving): Promise<ChildProcess> {
  let a: Adopted | null = null
  // (one speaking another protocol than this code's gives way to one of this code: watchServer starts it)
  const link = await attach(v.path, s, (m) => answerCall(v, m), () => (v.outside?.length ? [{ type: "allow", paths: v.outside }] : []), () => a?.kill())
  a = new (await import("./heir.ts")).Adopted(s.pid, link)
  const child = a as unknown as ChildProcess // (it stands in for one: heir.ts)
  ownServer(s.pid, a)
  rootOf.set(child, s.heir!.root)
  logFrom.set(child, (() => { try { return fs.statSync(serverLog(v.path)).size } catch { return 0 } })())
  console.error(`vaultite: ${nameOf(v.path)}'s server (pid ${s.pid}) kept running through the relaunch: taken over`)
  return child
}

/** Leave every server running for the next launch (an update's relaunch): each waits a while to be taken over. */
function handOver() {
  handingOver = true
  const m = { type: "desktop:relaunching", app: app.getPath("userData") }
  for (const w of [...wins.values(), ...kept.values()]) if (w.server?.exitCode === null) w.server.send(m)
}

/** A vault's server kept with no window (the helper's): it ends with the app, or on its own (a crash: the next window
 *  starts another). */
function keepServer(p: string, k: Kept) {
  kept.set(p, k)
  k.server?.once("exit", () => { if (kept.get(p) === k) { kept.delete(p); booting.delete(p) } })
}
/** The helper's home vault with no window (the app opened at login, every window closed before): its server started
 *  and kept. False when there's none to keep. */
async function helperHome() {
  if (!helperOn()) return false
  const v = [...known].filter((x) => x.path !== sandboxPath() && fs.statSync(x.path, { throwIfNoEntry: false })?.isDirectory()).sort((a, b) => (b.last ?? 0) - (a.last ?? 0))[0]
  if (!v) return false
  if (MAC) void app.dock?.hide()
  try {
    const there = await servedElsewhere(v.path)
    if (there && heirHere(there)) keepServer(v.path, { server: await adopt(v, there), link: null, port: there.port })
    else if (there) keepServer(v.path, { server: null, link: await attach(v.path, there, (m) => answerCall(v, m), () => []), port: there.port })
    else { const [server, port] = await serverFor(v); keepServer(v.path, { server, link: null, port }) }
    lastFocused = v.path
    homeChanged()
    return true
  } catch (e) { console.error("vaultite: the helper's vault didn't start:", e); return false }
}
/** The Dock icon, and the app clicked again: the helper's vault's window (the vaults list with none). */
function openHome() {
  const p = (lastFocused && (wins.has(lastFocused) || kept.has(lastFocused)) ? lastFocused : null) ?? [...kept.keys()][0]
  if (p) void openVault(p).catch((e) => failedBox(`Couldn't open ${nameOf(p)}`, e))
  else showManager()
}
// With the helper, the app is in the Dock only while a window is open: else it's the menu bar's.
AppWindow.each((w) => {
  if (!MAC || !helperOn()) return
  void app.dock?.show()
  w.on("closed", () => { if (helperOn() && !AppWindow.getAllWindows().some((x) => x !== w && !x.isDestroyed())) app.dock?.hide() })
})

/** The sandbox (electron/sandbox.ts): made fresh unless its window is open; a fresh one gets a new port, so its page
 *  starts on the tour rather than last time's tabs. */
function sandbox() {
  return openSandbox((p) => openVault(p), (p) => wins.has(p), (p) => { const v = find(p); if (v) delete v.port })
}

/** Links leave for the browser; the window never navigates away from its app. A pop-out (`/?popout=<id>`) is a
 *  window of the vault's own. */
function guard(win: AppWindow, origin: string) {
  // Full screen hides the traffic lights: the page stops making room for them (data-fullscreen on <html>, index.css).
  const lights = () => { if (!win.isDestroyed()) win.webContents.send("vaultite:fullscreen", win.isFullScreen()) }
  win.on("enter-full-screen", lights)
  win.on("leave-full-screen", lights)
  win.webContents.on("dom-ready", lights)
  // The Mac lays the title bar out again on these and may put the traffic lights back where they sit by default.
  const again = () => applyLights(win)
  if (MAC) { win.on("focus", again); win.on("blur", again); win.on("show", again); win.on("restore", again); win.on("resized", again); win.on("leave-full-screen", again) }
  // Out of focus, the Mac greys the lights: so do the page's stand-ins for them (data-window-inactive, index.css).
  const key = () => { if (!win.isDestroyed()) win.webContents.send("vaultite:key", win.isFocused()) }
  if (MAC) { win.on("focus", key); win.on("blur", key); win.webContents.on("dom-ready", key) }
  // A pop-out: the page window.open made, in a window of ours (its pages go over it as in the vault's), closed with it.
  // `at`: where the page asked it to open (a tab dragged out of the window: core/workspace.ts popOut).
  const popOut = (w: Win, page: WebContents, webPreferences?: WebPreferences, at?: { x?: number; y?: number }) => {
    const glass = translucentAt(w.vault.path), clear = MAC && glass
    const place = at?.x !== undefined && at.y !== undefined ? { x: at.x, y: at.y } : {}
    const child = new AppWindow({ width: 960, height: 760, ...place, minWidth: 480, minHeight: 360, title: win.getTitle(), ...chrome(),
      acceptFirstMouse: true, webPreferences,
      ...(clear ? { transparent: true, backgroundColor: "#00000000" } : { backgroundColor: background() }) }, page)
    popouts.set(page, w)
    const closeIt = () => { if (!child.isDestroyed()) child.close() }
    win.once("closed", closeIt)
    child.on("closed", () => { popouts.delete(page); if (!win.isDestroyed()) win.off("closed", closeIt) })
    page.on("did-finish-load", () => page.setZoomFactor(zoom))
    revive(page, undefined, crashedFor(child, nameOf(w.vault.path)))
    hangs(child, nameOf(w.vault.path))
    guard(child, origin)
    webWindow(child)
    translucentWindow(child, clear, glass)
    if (appsOn(w.vault.path)) appsWindow(child)
    return page
  }
  // A right-click the page left to the system (the editor's): what the spell checker says of the word under it, for
  // the page's own menu (plugins/core/editing/menu.ts). There's no menu of Electron's.
  win.webContents.on("context-menu", (_e, p) => win.webContents.send("vaultite", { type: "spelling", word: p.misspelledWord, suggestions: p.dictionarySuggestions }))
  win.webContents.on("will-navigate", (e, url) => {
    // (the app's page only: a vault's own file served under its origin, /v/ or /api/raw, would get the bridge)
    if (appPage(url, origin)) return
    e.preventDefault()
    void openLink(url)
  })
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    // The presenter view (plugins/core/slides/Presenter.tsx): a blank window the page draws into itself.
    if ((url === "about:blank" || url === "") && frameName === "vaultite-presenter") {
      return { action: "allow", overrideBrowserWindowOptions: { backgroundColor: background(), autoHideMenuBar: true } }
    }
    if (url.startsWith(`${origin}/?popout=`)) {
      const w = [...wins.values()].find((x) => x.win === win) ?? popouts.get(win.webContents)
      if (!w) return { action: "deny" }
      return { action: "allow", overrideBrowserWindowOptions: { webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true, spellcheck: true } },
        createWindow: (o) => popOut(w, (o as { webContents: WebContents }).webContents, o.webPreferences, o) } // (Electron puts the new page in its options)
    }
    // (the app's own page in a new window, a link's browser default: never the app inside itself; the page opens it)
    if (appPage(url, origin)) return { action: "deny" }
    if (url.startsWith(origin + "/api/raw?")) { // a vault file that isn't text (an image, a PDF): the Mac's app for it
      const w = [...wins.values()].find((x) => x.win === win)
      const rel = new URL(url).searchParams.get("path"), abs = w && rel ? inVault(w.vault.path, rel) : null
      if (abs) openVaultFile(abs)
    } else void openLink(url)
    return { action: "deny" }
  })
}

const appPage = (url: string, origin: string) => {
  try { const u = new URL(url); return u.origin === origin && (u.pathname === "/" || u.pathname === "/index.html") } catch { return false }
}

/** Tell a window to open a file (a vault path or an allowed outside file), once its page is listening. */
function send(w: Win, file: string) {
  if (w.ready) w.win.webContents.send("vaultite", { type: "open", path: file })
  else w.queue.push(file)
}

/** A file from outside the vault may be opened in this window: its server may now read and write it. */
function allowIn(w: Win, abs: string) {
  const list = w.vault.outside ?? []
  w.vault.outside = [abs, ...list.filter((x) => x !== abs)]
  save()
  const m = { type: "allow", paths: [abs] }
  if (w.server) w.server.send(m); else w.link?.send(m)
}

function showManager() {
  if (manager && !manager.isDestroyed()) return manager.focus()
  manager = new AppWindow({
    width: 760, height: 500, minWidth: 620, minHeight: 400, show: false, title: "Manage vaults",
    ...chrome(), backgroundColor: background(),
    fullscreenable: false, webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true },
  })
  void manager.ready.then(() => manager?.show())
  manager.on("closed", () => { manager = null })
  guard(manager, pathToFileURL(DIST).href)
  manager.loadFile(path.join(DIST, "vaults.html"))
}

// ---------- other machines' servers ----------
const remoteWins = new Map<string, AppWindow>() // server address -> its window
/** A server's name: its machine's (studio of studio.tailnet.ts.net), as on the iPhone. */
const hostName = (url: string) => new URL(url).hostname.split(".")[0]

/** Another machine's server in a window: its page as on the web (no preload, so no IPC into this Mac), the system's
 *  title bar. */
function openRemote(url: string) {
  const open = remoteWins.get(url)
  if (open) return void open.focus()
  let r = remotes.find((x) => x.url === url)
  if (!r) remotes.push((r = { url, name: hostName(url) }))
  r.last = Date.now()
  r.open = true
  save()
  const b = r.bounds, it = r
  const win = new AppWindow({
    width: b?.width ?? 1280, height: b?.height ?? 820, x: b?.x, y: b?.y, minWidth: 800, minHeight: 480, title: r.name,
    backgroundColor: background(), webPreferences: { sandbox: true, contextIsolation: true, spellcheck: true },
  })
  remoteWins.set(url, win)
  const keep = () => { if (!win.isDestroyed() && !win.isFullScreen()) { it.bounds = win.getBounds(); save() } }
  win.on("resize", keep)
  win.on("move", keep)
  win.on("close", () => { if (!quitting) it.open = false; save(true) })
  // Its server unreachable (asleep, off the tailnet): tried again, from 5 s to a minute apart, until it answers.
  let retry: ReturnType<typeof setTimeout> | null = null, wait = 5000, failed = false
  const load = () => void win.loadURL(`${url}/`).catch(() => { /* did-fail-load retries */ })
  win.webContents.on("did-start-loading", () => { failed = false })
  win.webContents.on("did-fail-load", (_e, code, _d, _u, main) => {
    if (!main || code === -3 || retry || win.isDestroyed()) return // -3: replaced by another load
    failed = true
    retry = setTimeout(() => { retry = null; if (!win.isDestroyed()) load() }, wait)
    wait = Math.min(wait * 2, 60_000)
  })
  win.webContents.on("did-stop-loading", () => { if (!failed) wait = 5000 })
  win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(zoom))
  win.on("closed", () => { remoteWins.delete(url); if (retry) clearTimeout(retry); buildMenu() })
  revive(win.webContents, undefined, crashedFor(win, it.name))
  hangs(win, it.name)
  guard(win, url)
  load()
  buildMenu()
}

/** Is a Vaultite server answering at this address? Its web app's manifest names it (the iPhone app asks the same). */
async function probe(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${url}/manifest.webmanifest`, { signal: AbortSignal.timeout(8000), cache: "no-store" })
    const text = r.ok ? await r.text() : ""
    if (r.ok && text.includes("Vaultite")) return { ok: true }
    return { ok: false, error: r.ok ? "That isn't a Vaultite server" : `It answered ${r.status}` }
  } catch (e) {
    const c = (e as { cause?: { code?: string } }).cause?.code
    return { ok: false, error: (e as Error).name === "TimeoutError" ? "It didn't answer" : c === "ENOTFOUND" ? "No machine has that name" : c === "ECONNREFUSED" ? "Nothing is listening there" : String((e as Error).message) }
  }
}

// ---------- Set up Vaultite ----------
/** userData/setup.json: `done` once finished. */
type SetupState = { done?: string }
const SETUP = () => path.join(app.getPath("userData"), "setup.json")
function setupState(): SetupState {
  try { const j = JSON.parse(fs.readFileSync(SETUP(), "utf8")); return j && typeof j === "object" ? j : {} } catch { return {} }
}
const saveSetup = (st: SetupState) => { fs.mkdirSync(path.dirname(SETUP()), { recursive: true }); fs.writeFileSync(SETUP(), JSON.stringify(st, null, 2) + "\n") }
/** The first launch: never finished, and no vault of the user's yet (the sandbox isn't one). */
const firstRun = () => !setupState().done && !known.some((v) => v.path !== sandboxPath()) && !remotes.length

let setupWin: AppWindow | null = null
/** The note a new vault opens on (core/start.ts writes it). */
const START_HERE = "Start here.md"
/** The vault the window chose (its server started), and what it changed. */
let chosen: { path: string; made: boolean; added: boolean } | null = null

const where = (): Setup.Where => {
  const home = process.env.VAULTITE_SETUP_HOME ? path.resolve(process.env.VAULTITE_SETUP_HOME) : app.getPath("home")
  return {
    home, exe: process.execPath, vau: vauEntry(), userData: app.getPath("userData"),
    env: process.env.VAULTITE_USER_DATA ? { VAULTITE_USER_DATA: app.getPath("userData") } : {},
    ...(process.env.VAULTITE_SETUP_HOME ? {} : { documents: app.getPath("documents") }),
    ...(!process.env.VAULTITE_SETUP_HOME && process.env.CLAUDE_CONFIG_DIR ? { claudeDir: path.resolve(process.env.CLAUDE_CONFIG_DIR) } : {}),
    ...(!process.env.VAULTITE_SETUP_HOME && process.env.CODEX_HOME ? { codexHome: path.resolve(process.env.CODEX_HOME) } : {}),
  }
}
/** The user's PATH, asked of their shell once (it takes a moment). */
let dirs: string[] | null = null
const pathDirs = () => (dirs ??= process.env.VAULTITE_SETUP_HOME ? [] : Setup.shellPath(where()))

// The vault, in a window of its own (no server yet); the rest of the first run is the welcome card in the vault's window
// (web/src/components/Welcome.tsx), where the look it picks shows behind it.
function showSetup() {
  if (setupWin && !setupWin.isDestroyed()) return setupWin.focus()
  setupWin = new AppWindow({
    // (useContentSize: a Linux window frame is outside it, so the page gets its 560×520 as on a Mac)
    width: 560, height: 520, useContentSize: true, resizable: false, maximizable: false, fullscreenable: false, show: false, title: "Set up Vaultite",
    ...chrome(), backgroundColor: background(),
    webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true },
  })
  void setupWin.ready.then(() => setupWin?.show())
  setupWin.on("closed", () => {
    setupWin = null
    dropChosen()
  })
  guard(setupWin, pathToFileURL(DIST).href)
  setupWin.loadFile(path.join(DIST, "onboarding.html"))
}

/** The chosen vault's server, when its window never opened: stopped, and the vault forgotten if setup added it. */
function dropChosen() {
  const p = chosen?.path
  if (p && !wins.has(p)) {
    booting.get(p)?.then(([child]) => child.kill(), () => {})
    booting.delete(p)
    if (chosen!.added) { known = known.filter((v) => v.path !== p); save(); buildMenu() }
  }
  chosen = null
}

/** The address typed as a server's: https unless it says, no path; null when it isn't one. */
function serverUrl(typed: string) {
  const t = typed.trim()
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(t) ? t : `https://${t}`)
    return /^https?:$/.test(u.protocol) && u.hostname ? u.origin : null
  } catch { return null }
}

/** Only the setup window may ask these. */
function setupHandle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, (e, ...args) => {
    if (!setupWin || e.sender !== setupWin.webContents || !(e.senderFrame?.url ?? "").startsWith(pathToFileURL(DIST).href)) throw new Error("not the setup window")
    return fn(...(args as never[]))
  })
}

setupHandle("setup:info", () => {
  const w = where()
  return { places: Setup.places(w), obsidian: Setup.obsidianVaults(w), vau: Setup.vauStatus(w, pathDirs()), vauHome: Setup.vauHome(w), mac: MAC }
})
setupHandle("setup:pick", async () => {
  const r = await dialog.showOpenDialog(setupWin!, { properties: ["openDirectory", "createDirectory"] })
  return r.canceled ? null : r.filePaths[0] ?? null
})
/** Choose the vault: a new folder (made now, empty) or a folder of the user's (none of its files change). Its server
 *  starts, and sets up a vault it has never opened (core/start.ts: Standard, and a new one's Start here). */
setupHandle("setup:choose", async (c: { kind: "new"; parent: string; name: string; starter?: boolean } | { kind: "open"; path: string } | null) => {
  dropChosen()
  if (!c) return null
  let p: string, made = false
  if (c.kind === "new") {
    const clean = folderName(c.name)
    if (!clean || clean.startsWith(".")) throw new Error("The vault needs a name")
    p = path.join(str(c.parent), clean)
    if (fs.existsSync(p) && fs.readdirSync(p).some((f) => f !== ".DS_Store")) throw new Error(`${p} already exists and isn't empty`)
    fs.mkdirSync(p, { recursive: true })
    made = true
  } else {
    p = path.resolve(str(c.path))
    if (!fs.statSync(p, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${p} isn't a folder`)
  }
  chosen = { path: p, made, added: !find(p) }
  const fresh = !fs.existsSync(path.join(p, ".vaultite"))
  const port = (await servedHere(p))?.port ?? (await serverFor(remember(p)))[1]
  const call = async (opId: string, body: object, what: string) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/ops/${opId}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/desktop" }, body: JSON.stringify(body) })
    if (!r.ok) console.error(`${what}:`, r.status, await r.text())
  }
  // A vault new to the app has AI off until the welcome card asks (nothing of it shows before a yes); one set up before
  // keeps its own.
  if (fresh) await call("ai.set", { on: "off" }, "AI off until asked")
  // Starter content only when the user asked for it (core/start.ts): opening a folder writes nothing outside .vaultite/.
  if (c.kind === "new" && c.starter) await call("vault.starter", {}, "starter content")
  return chosen
})
setupHandle("setup:vau", async (system: boolean) => {
  const r = Setup.installVau(where())
  if (WIN) dirs = null // (Windows' PATH changed in the registry: read again)
  if (system) await Setup.linkSystem(r.path)
  return { did: system ? `Linked /usr/local/bin/vau to ${r.path}` : r.did, vau: Setup.vauStatus(where(), pathDirs()) }
})
// (the playground's window first: closing the last window quits off a Mac, and an AppWindow closes at once)
setupHandle("setup:sandbox", async () => {
  await sandbox()
  setupWin?.close()
})
/** Done: open the vault chosen (a new one on its Start here note), its page going on with the welcome card, and never
 *  show this window by itself again. */
setupHandle("setup:finish", async () => {
  saveSetup({ done: new Date().toISOString() })
  dirs = null // (an agent installed meanwhile is on the PATH next time)
  const c = chosen
  chosen = null // (kept: the window opening now takes its server)
  if (c) {
    const w = await openVault(c.path)
    w.welcome = true
    if (c.made && fs.existsSync(path.join(c.path, START_HERE))) send(w, START_HERE)
  } else showManager()
  setupWin?.close()
})

const focusedVault = () => {
  const f = AppWindow.getFocusedWindow()
  return [...wins.values()].find((w) => w.win === f) ?? [...wins.values()].sort((a, b) => (b.vault.last ?? 0) - (a.vault.last ?? 0))[0] ?? null
}

/** An outside file's path as the page and the server know it: Windows' with forward slashes (the page splits on "/";
 *  Node takes either). */
const slashed = (p: string) => (WIN ? p.replace(/\\/g, "/") : p)

/** Open files (Finder, a drop, the picker): in their own vault's window if they're in one, else as outside files in
 *  `into` (the window asking, or the focused one; with none, the last vault used opens). Returns what `into` opens. */
async function openFiles(paths: string[], into: Win | null): Promise<string[]> {
  const mine: string[] = []
  for (const p of paths) {
    const st = fs.statSync(p, { throwIfNoEntry: false })
    if (!st) continue
    if (st.isDirectory()) { // a folder: open it as a vault
      await openVault(p).catch(() => {})
      continue
    }
    const hit = vaultOf(p)
    if (hit && !hit[1].split("/").some((x) => x.startsWith("."))) {
      if (into && hit[0].path === into.vault.path) mine.push(hit[1])
      else await openVault(hit[0].path, hit[1]).catch(() => {})
      continue
    }
    let w: Win | null = into ?? focusedVault()
    if (!w) {
      const last = [...known].sort((a, b) => (b.last ?? 0) - (a.last ?? 0))[0]
      if (!last) { waiting.push(p); showManager(); continue }
      w = await openVault(last.path).catch(() => null)
      if (!w) continue
    }
    const abs = slashed(p)
    allowIn(w, abs)
    if (w === into) mine.push(abs)
    else { send(w, abs); w.win.focus() }
  }
  return mine
}

// ---------- copying in (a drop on the file tree) ----------
/** "Name", then "Name 1", "Name 2"... like Finder, for a name that's taken. */
function freeIn(dir: string, name: string) {
  const ext = path.extname(name), stem = ext && ext !== name ? name.slice(0, -ext.length) : name
  let out = name, n = 1
  while (fs.existsSync(path.join(dir, out))) out = `${stem} ${n++}${ext && ext !== name ? ext : ""}`
  return out
}

function copyIn(w: Win, paths: string[], folder: string, move: boolean) {
  const parts = folder.split("/").filter(Boolean)
  if (parts.some((x) => x === ".." || x.startsWith("."))) throw new Error("not a folder of the vault")
  const dir = path.join(w.vault.path, ...parts)
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`no folder '${folder}'`)
  const made: string[] = [], failed: string[] = []
  // (each on its own: one that fails doesn't keep the rest, or those already copied, from showing)
  for (const src of paths) {
    try {
      const st = fs.statSync(src, { throwIfNoEntry: false })
      if (!st || !path.isAbsolute(src)) continue
      const from = real(src), into = real(dir)
      if (into === from || into.startsWith(from + path.sep) || path.dirname(from) === into) continue // itself, or already there
      const name = freeIn(dir, path.basename(src))
      const dst = path.join(dir, name)
      if (move) {
        try {
          fs.renameSync(src, dst)
        } catch {
          fs.cpSync(src, dst, { recursive: true, errorOnExist: true, force: false })
          fs.rmSync(src, { recursive: true })
        }
      } else fs.cpSync(src, dst, { recursive: true, errorOnExist: true, force: false })
      made.push([...parts, name].join("/"))
    } catch (e) {
      failed.push(`${path.basename(src)}: ${plainError(e).reason ?? "it couldn't be copied"}`)
    }
  }
  if (failed.length && !made.length) throw new Error(failed[0])
  if (failed.length) {
    void dialog.showMessageBox(w.win, { type: "warning", message: `Couldn't ${move ? "move" : "copy"} ${failed.length} of ${made.length + failed.length} into ${folder || "the vault"}`, detail: failed.slice(0, 10).join("\n") })
  }
  return made
}

// ---------- IPC (the preload's window.vaultite) ----------
/** The vault window a request came from (null: the manager), after checking it's our page asking. */
function who(e: IpcMainInvokeEvent): Win | null {
  const url = e.senderFrame?.url ?? ""
  for (const w of wins.values()) if (w.win.webContents === e.sender && appPage(url, `http://127.0.0.1:${w.port}`)) return w
  const pop = popouts.get(e.sender)
  if (pop && appPage(url, `http://127.0.0.1:${pop.port}`)) return pop
  if (manager && e.sender === manager.webContents && url.startsWith(pathToFileURL(DIST).href)) return null
  throw new Error("not a Vaultite window")
}
/** What a pop-out's page doesn't do for its vault's window: take the files waiting for it, set its menu bar. */
const MAIN_ONLY: Record<string, unknown> = { "app:ready": [], "menu:sync": undefined }
function handle(name: string, fn: (w: Win | null, ...args: never[]) => unknown) {
  ipcMain.handle(name, (e, ...args) => {
    const w = who(e)
    if (name in MAIN_ONLY && popouts.has(e.sender)) return MAIN_ONLY[name]
    return fn(w, ...(args as never[]))
  })
}
const str = (x: unknown) => { if (typeof x !== "string") throw new Error("expected text"); return x }
/** A new vault folder's name as typed, without the characters a file name can't have. */
const folderName = (x: unknown) => str(x).replace(/[/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim()

handle("vaults:list", (w) => ({
  current: w?.vault.path ?? null, home: app.getPath("home"),
  vaults: [...known].sort((a, b) => (b.last ?? 0) - (a.last ?? 0))
    .map((v) => ({ path: v.path, name: nameOf(v.path), open: wins.has(v.path), ...(v.path === sandboxPath() ? { sandbox: true } : {}) }))
    .concat(remotes.map((r) => ({ path: r.url, name: r.name, open: remoteWins.has(r.url), remote: true }))),
}))
handle("vaults:open", async (_w, p: string) => {
  if (remotes.some((r) => r.url === p)) return openRemote(p)
  await openVault(str(p))
  for (const f of waiting.splice(0)) await openFiles([f], null)
})
handle("vaults:create", async (_w, parent: string, name: string) => {
  const clean = folderName(name)
  if (!clean || clean.startsWith(".")) throw new Error("the vault needs a name")
  const p = path.join(str(parent), clean)
  if (fs.existsSync(p) && fs.readdirSync(p).length) throw new Error(`${p} already exists and isn't empty`)
  fs.mkdirSync(p, { recursive: true })
  await openVault(p)
})
handle("vaults:sandbox", async () => { await sandbox() })
/** Another machine's server (Manage vaults' Connect): checked, then opened in a window and kept in the list. */
handle("vaults:connect", async (_w, typed: string) => {
  const url = serverUrl(str(typed))
  if (!url) throw new Error("That isn't a web address")
  const r = await probe(url)
  if (!r.ok) throw new Error(`${r.error}. Is it on, and is Tailscale on here?`)
  openRemote(url)
})
handle("vaults:remove", (_w, p: string) => {
  known = known.filter((v) => v.path !== str(p))
  remotes = remotes.filter((r) => r.url !== p)
  save()
  buildMenu()
})
handle("vaults:pick", async (w) => {
  const opts = { properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] }
  const parent = w?.win ?? manager
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
  return r.canceled ? null : r.filePaths[0] ?? null
})
handle("vaults:reveal", (_w, p: string) => { if (find(str(p))) shell.showItemInFolder(p) })
handle("vaults:manage", () => showManager())
/** Set up Vaultite again (the menu, the playground's notice). */
handle("app:setup", () => showSetup())
/** Whether Set up Vaultite opened this window, so its page goes on with the welcome card: once. */
handle("app:welcome", (w) => {
  if (!w?.welcome) return false
  w.welcome = false
  return true
})
/** The welcome card's permissions, pressed: Claude Code's computer use on for this vault, and Codex's (it comes with
 *  the Codex app), where they're here and off. Their errors, by agent. */
handle("app:computer-use", async (w) => {
  if (!w || !MAC) return {}
  const at = where(), vault = w.vault.path, failed: Record<string, string> = {}
  for (const h of Setup.harnesses(at, pathDirs(), vault)) {
    if (!h.path || h.extra?.kind !== "computer-use" || h.extra.state !== "off") continue
    try { await (h.id === "codex" ? Setup.setCodexComputerUse(at, h.path) : Setup.setClaudeComputerUse(at, vault)) } catch (e) { failed[h.id] = plainText(e, "Couldn't turn on computer use") }
  }
  return failed
})
handle("files:copy-in", (w, paths: string[], folder: string, move: boolean) => {
  if (!w) throw new Error("no vault here")
  return copyIn(w, strings(paths), str(folder), !!move)
})
handle("files:open", (w, paths: string[]) => openFiles(strings(paths), w))
handle("files:pick", async (w) => pickOutside(w))
// A page's own dialogs (an Obsidian plugin's open/save/message box), answered while it waits: Electron's sync dialogs,
// on its window, with only the options that shape a dialog.
const DIALOG_KEYS = ["title", "defaultPath", "buttonLabel", "filters", "properties", "message", "detail", "nameFieldLabel", "showsTagField", "buttons", "type", "defaultId", "cancelId", "checkboxLabel", "noLink"]
ipcMain.on("dialog:sync", (e, kind: unknown, options: unknown) => {
  try {
    const w = who(e)
    const o = Object.fromEntries(Object.entries(options && typeof options === "object" ? options : {}).filter(([k]) => DIALOG_KEYS.includes(k)))
    const parent = w?.win ?? AppWindow.fromWebContents(e.sender)
    if (!parent) throw new Error("no window")
    e.returnValue = kind === "open" ? dialog.showOpenDialogSync(parent, o) ?? null
      : kind === "save" ? dialog.showSaveDialogSync(parent, o) || null
        : kind === "message" ? dialog.showMessageBoxSync(parent, { message: "", ...o }) : null
  } catch { e.returnValue = null }
})
handle("app:ready", (w) => {
  if (!w) return []
  w.ready = true
  windowReady(w)
  shellReady(w)
  return w.queue.splice(0)
})
handle("app:update-restart", () => restartToUpdate(true))
handle("app:updates", () => ({ mode: updates, available: updatable() }))
handle("app:updates-set", (_w, mode: UpdateMode) => {
  if (!UPDATE_MODES.includes(mode) || mode === updates) return
  updates = mode
  save()
  modeChanged()
})
// (Open at login, Settings > About: this Mac's, kept with the helper's prefs so the helper doesn't turn it back)
handle("app:login", () => ({ on: app.getLoginItemSettings().openAtLogin }))
handle("app:login-set", (_w, on: boolean) => {
  if (typeof on !== "boolean") return
  if (app.getLoginItemSettings().openAtLogin !== on) app.setLoginItemSettings({ openAtLogin: on })
  helperPrefs = { ...helperPrefs, login: on }
  save()
})
ipcMain.handle("app:update-safe", (e, safe: boolean) => {
  if (!who(e)) return
  pageSafe(e.sender, safe === true)
})
// The page's commands, pins and recent files for the menu bar (web/src/core/desktop.ts): kept, and shown while it's focused.
handle("menu:sync", (w, snap: MenuSnapshot) => {
  if (!w || !snap || !Array.isArray(snap.commands)) return
  const list = <T,>(x: unknown, ok: (v: T) => boolean): T[] => (Array.isArray(x) ? (x as T[]).filter(ok) : [])
  w.menu = {
    commands: list<MenuSnapshot["commands"][number]>(snap.commands, (c) => typeof c?.id === "string" && typeof c.name === "string" && Array.isArray(c.keys))
      .map((c) => ({ id: c.id, name: c.name, keys: c.keys.filter((k) => typeof k === "string"), custom: !!c.custom, on: !!c.on })),
    pinned: list<{ path: string; title: string }>(snap.pinned, (f) => typeof f?.path === "string" && typeof f.title === "string").slice(0, 40),
    recent: list<{ path: string; title: string }>(snap.recent, (f) => typeof f?.path === "string" && typeof f.title === "string").slice(0, 15),
  }
  if (focusedVault() === w) buildMenu()
})
// Export to PDF: the page as it prints (the app shows only the note while printing: plugins/core/export-pdf), saved
// where the user picks. Answers the file's path, or null when they cancelled.
handle("print:pdf", async (w, name: string) => {
  if (!w) throw new Error("no vault here")
  const file = `${str(name).replace(/[/\\:*?"<>|]/g, " ").trim() || "Untitled"}.pdf`
  const r = await dialog.showSaveDialog(w.win, { defaultPath: path.join(app.getPath("downloads"), file), filters: [{ name: "PDF", extensions: ["pdf"] }] })
  if (r.canceled || !r.filePath) return null
  const letter = ["US", "CA", "MX", "PH"].includes(app.getLocaleCountryCode())
  const pdf = await w.win.webContents.printToPDF({ printBackground: true, pageSize: letter ? "Letter" : "A4", preferCSSPageSize: true })
  fs.writeFileSync(r.filePath, pdf)
  return r.filePath
})
// The audio recorder: macOS asks once whether Vaultite may use the microphone (the page's getUserMedia then works).
handle("media:microphone", async () => !MAC || systemPreferences.askForMediaAccess("microphone"))
// Settings > Permissions' buttons (electron/permissions.ts): macOS's prompt, the drag helper, a folder read, or a pane.
handle("app:permission", (_w, id: string) => { if (MAC) return macPermissions().then((p) => p.permissionAct(str(id))) })
handle("print:reveal", (_w, p: string) => { if (str(p).endsWith(".pdf")) shell.showItemInFolder(p) })
// The Mac's notification (the Inbox, window not in front): true once clicked, false when closed. Kept in `shown`
// until then: one nothing refers to is collected, and its click lost.
const shown = new Set<Notification>()
// ---------- Dock icon ----------
// Another picture in the Dock (the Dock icon plugin), kept in userData; never the bundle's (its signature, updates).
const DOCK_ICON = () => path.join(app.getPath("userData"), "dock-icon.png")
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp" }
/** The Dock's icon as set: the user's, else the app's (a checkout's own PNG; a packaged app's bundle icon). */
function applyDockIcon() {
  if (!MAC || !app.dock) return
  if (fs.existsSync(DOCK_ICON())) app.dock.setIcon(DOCK_ICON())
  else if (!app.isPackaged && fs.existsSync(ICON)) app.dock.setIcon(ICON)
  else app.dock.setIcon(nativeImage.createEmpty())
}
handle("dock:set", (_w, png: string | null) => {
  if (png === null) fs.rmSync(DOCK_ICON(), { force: true })
  else {
    const img = nativeImage.createFromDataURL(str(png))
    if (img.isEmpty()) throw new Error("not an image")
    fs.writeFileSync(DOCK_ICON(), img.toPNG())
  }
  applyDockIcon()
})
handle("dock:custom", () => fs.existsSync(DOCK_ICON()))
/** Pick an image anywhere on the Mac: its bytes as a data: URL (the page draws it), or null. */
handle("dock:pick", async (w) => {
  const opts = { properties: ["openFile"] as "openFile"[], filters: [{ name: "Images", extensions: Object.keys(IMAGE_TYPES) }] }
  const r = w ? await dialog.showOpenDialog(w.win, opts) : await dialog.showOpenDialog(opts)
  const file = r.canceled ? null : r.filePaths[0]
  const type = file && IMAGE_TYPES[path.extname(file).slice(1).toLowerCase()]
  return file && type ? `data:${type};base64,${fs.readFileSync(file).toString("base64")}` : null
})
// ---------- the editor's menu ----------
// The asking page's own window (a pop-out's too, which `handle` answers as its vault's).
ipcMain.handle("text:look-up", (e) => { who(e); e.sender.showDefinitionForSelection() })
ipcMain.handle("text:learn", (e, word: string) => { who(e); e.sender.session.addWordToSpellCheckerDictionary(str(word)) })
// ---------- the traffic lights ----------
/** Each window's traffic lights as its page last placed them (points; null: hidden), put back after the Mac moves them. */
const lightsOf = new WeakMap<AppWindow, { x: number; y: number } | null>()
function setLights(w: AppWindow, at: { x: number; y: number } | null) {
  lightsOf.set(w, at)
  applyLights(w)
}
function applyLights(w: AppWindow) {
  const at = lightsOf.get(w)
  if (at === undefined || w.isDestroyed()) return
  // (a pop-out with its bars hidden: only while the pointer is at its top, topstrip.ts)
  const shown = !!at && (bare.get(w)?.lightsShown(w) ?? true)
  if (at) w.setWindowButtonPosition(at)
  w.setWindowButtonVisibility(shown)
  // (shown again, the Mac lays them out where they sit by default: placed once more)
  if (shown) w.setWindowButtonPosition(at)
}
// The traffic lights in the page's sidebar's top row (`at`, CSS px: `x` right of LIGHTS, centred on `mid` down), hidden
// while it is (no rails); an older page sends a boolean. Answers how they're drawn, for the page's stand-ins.
ipcMain.handle("window:lights", (e, at: boolean | { x: number; mid: number } | null) => {
  who(e)
  const w = AppWindow.fromWebContents(e.sender)
  if (!MAC || !w) return
  if (at && typeof at === "object" && Number.isFinite(at.x) && Number.isFinite(at.mid)) {
    const z = e.sender.getZoomFactor()
    setLights(w, { x: Math.round(LIGHTS.x + at.x * z), y: Math.round(at.mid * z - BUTTONS.height / 2) })
  } else if (at) w.setWindowButtonVisibility(true)
  else setLights(w, null)
  const v = [...wins.values()].find((x) => x.win === w)?.vault
  if (v && !!v.lightsOff !== !at) { if (at) delete v.lightsOff; else v.lightsOff = true; save() }
  return { zoom: e.sender.getZoomFactor(), inset: LIGHTS.x, ...BUTTONS }
})
// A pop-out with its bars hidden (Hide window bars): its lights only with the pointer in its top strip, which drags it
// (topstrip.ts). Keep window on top (core/ontop.ts keeps it): `on` sets it, else it's asked. Both answer whether it's on.
const bare = new WeakMap<AppWindow, typeof import("./topstrip.ts")>()
ipcMain.handle("window:bare", async (e, on: unknown) => {
  who(e)
  const w = AppWindow.fromWebContents(e.sender)
  if (!MAC || !w || !popouts.has(e.sender)) return false
  const k = await stripKit()
  if (on !== true) { k.noStrip(w); bare.delete(w) }
  else if (!k.hasStrip(w)) {
    bare.set(w, k)
    const run = (id: string) => () => { if (!w.isDestroyed()) w.webContents.send("vaultite", { type: "command", id }) }
    k.topStrip(w, () => applyLights(w), { page: w.webContents, pin: run("window:on-top"),
      menu: () => [{ label: "Show window bars", click: run("window:bars") }, { label: "Keep window on top", type: "checkbox", checked: w.isAlwaysOnTop(), click: run("window:on-top") }] })
  }
  applyLights(w)
  return on === true
})
ipcMain.handle("window:on-top", async (e, on: unknown) => {
  who(e)
  const w = AppWindow.fromWebContents(e.sender)
  if (w && typeof on === "boolean") (await import("./ontop.ts")).setOnTop(w, on)
  return !!w?.isAlwaysOnTop()
})
// A drag held over a vault's window or pop-out brings it forward (raise.ts).
ipcMain.handle("window:raise", (e, popout: unknown, focus: unknown) => {
  const w = who(e), pages = w ? [w.win.webContents, ...[...popouts].filter(([, of]) => of === w).map(([wc]) => wc)] : []
  return import("./raise.ts").then((m) => m.raise(pages, popout, focus === true))
})
// The page's appearance `translucent` (electron/translucency.ts): what the window can do of it, now.
ipcMain.handle("window:translucent", (e, on: unknown) => {
  who(e)
  const w = AppWindow.fromWebContents(e.sender)
  return w ? setTranslucent(w, on === true) : { on: false }
})
// Windows' controls over the window's top-right corner (preload.cjs): the page's colours there and its title row's
// height (CSS px); answers their width in CSS px, which the page keeps clear.
const CONTROLS_WIDTH = 138 // (three caption buttons of 46 DIP)
ipcMain.handle("window:controls", (e, o: { color?: unknown; symbol?: unknown; height?: unknown }) => {
  who(e)
  const w = AppWindow.fromWebContents(e.sender)
  if (!WIN || !w || !o || typeof o !== "object") return null
  const z = e.sender.getZoomFactor()
  const color = (x: unknown) => (typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x) ? x : undefined)
  const height = typeof o.height === "number" && Number.isFinite(o.height) ? Math.round(Math.min(64, Math.max(28, o.height * z))) : CONTROLS_HEIGHT
  w.setTitleBarOverlay({ color: color(o.color), symbolColor: color(o.symbol), height })
  return { width: Math.ceil(CONTROLS_WIDTH / z) }
})
// `vau dev screenshot` (core/coreops/dev.ts, owner-only): the asking page as a PNG, halved while it's too big for the socket back.
ipcMain.handle("page:capture", async (e, rect?: { x: number; y: number; width: number; height: number }) => {
  who(e)
  const r = rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width >= 1 && rect.height >= 1
    ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : undefined
  let img = await e.sender.capturePage(r)
  while (img.toPNG().length > 20 << 20 && img.getSize().width > 200) img = img.resize({ width: Math.round(img.getSize().width / 2) })
  return { png: img.toPNG().toString("base64"), ...img.getSize() }
})

// A tab dragged past its window's edge (electron/dragghost.ts): its card shown following the pointer, or (null) hidden.
ipcMain.handle("drag:ghost", (e, look: GhostLook | null) => {
  who(e)
  const n = (x: unknown) => typeof x === "number" && Number.isFinite(x)
  if (look && [look.x, look.y, look.width, look.height, look.radius, look.grab?.x, look.grab?.y].every(n)) return showGhost(e.sender, look)
  hideGhost()
  return false
})

handle("app:notify", (w, title: string, body: string) => new Promise<boolean>((resolve) => {
  if (!w || !Notification.isSupported()) return resolve(false)
  const n = new Notification({ title: str(title).slice(0, 120), body: typeof body === "string" ? body.slice(0, 300) : "" })
  const done = (clicked: boolean) => { shown.delete(n); resolve(clicked) }
  n.on("click", () => {
    if (w.win.isMinimized()) w.win.restore()
    w.win.show()
    w.win.focus()
    app.focus({ steal: true })
    done(true)
  })
  n.on("close", () => done(false))
  n.on("failed", () => done(false))
  shown.add(n)
  n.show()
}))
// The Browser's pages (electron/web.ts). App windows turned on after the window opened: it reopens once its
// server is gone (the new one takes its port, so the tabs come back).
handle("apps:reopen", (w) => {
  if (!w) throw new Error("no vault here")
  const p = w.vault.path, server = w.server
  w.ending = true
  const gone = new Promise<void>((ok) => { if (!server || server.exitCode !== null || server.signalCode) ok(); else server.once("exit", () => ok()) })
  w.win.once("closed", () => void gone.then(() => openVault(p)).catch((e) => console.error(e)))
  w.win.close()
})
// (the window asking, a pop-out's own: its pages and apps' windows go over its tabs, not its vault window's)
for (const [name, fn] of Object.entries({ ...webHandlers, ...appHandlers, ...(MAC ? dictationHandlers : {}) })) {
  ipcMain.handle(name, (e, ...args) => {
    const w = who(e), win = AppWindow.fromWebContents(e.sender)
    if (!w || !win) throw new Error("no vault here")
    return fn(win, ...args)
  })
}

async function pickOutside(w: Win | null) {
  const target = w ?? focusedVault()
  const opts = {
    properties: ["openFile", "multiSelections"] as ("openFile" | "multiSelections")[],
    filters: [{ name: "Notes and tables", extensions: ["md", "markdown", "txt", "csv", "html", "htm", "json"] }, { name: "All files", extensions: ["*"] }],
  }
  const r = target ? await dialog.showOpenDialog(target.win, opts) : await dialog.showOpenDialog(opts)
  if (r.canceled) return []
  const mine = await openFiles(r.filePaths, target)
  if (target) for (const f of mine) send(target, f)
  return []
}

// ---------- updates ----------
initUpdates({
  windows: () => [...wins.values()],
  popouts: () => popouts,
  othersOpen: () => remoteWins.size > 0,
  mode: () => updates,
  busy: () => !!engineBusy(),
  quitting: () => quitting,
  beginQuit: () => { quitting = true },
  handOver,
  flush: () => unloadOnce().then(() => engineFlush()),
  buildMenu,
  nameOf,
  ownsServer: (w) => { const s = servingOf(w.vault.path); return !!s && ownPids.has(s.pid) },
  helper: () => !!helper,
  helperCommit: () => helperAt?.commit() ?? null,
  reloadHelper: (root, commit) => helperAt?.reload(root, commit),
  servers: () => {
    const own = [...wins.values()].filter((w) => w.server?.exitCode === null)
    const root = own[0]?.server ? rootOf.get(own[0].server) : undefined
    if (!root) return null
    const code = commitAt(root)
    return { code, web: own[0].web ?? code }
  },
  restartServers: () => { for (const w of wins.values()) if (w.server?.exitCode === null) { w.restarting = true; w.web = undefined; w.server.kill() } },
  adoptWeb: (dist, commit) => { for (const w of wins.values()) if (w.server?.exitCode === null && w.server.connected) { w.server.send({ type: "adopt-web", dist }); w.web = commit } },
  path: () => [...pathDirs(), process.env.PATH].filter(Boolean).join(path.delimiter),
})

// (a scripted copy from source, QA's: an update's relaunch on a signal, web/qa/relaunch.mjs)
if (!app.isPackaged && QUIET) process.on("SIGUSR2", () => { handOver(); quitting = true; app.relaunch(relaunchOptions()); app.quit() })

// ---------- a Dev instance on a worktree (electron/devroot.ts) ----------
let dev: typeof import("./devroot.ts") | null = null
async function startWorktree() {
  dev = await import("./devroot.ts")
  await dev.startDev({
    root: WORKTREE!, userData: app.getPath("userData"), headless: QUIET, debugPort: devtools ?? null, shellPrint: HOST?.shell.fingerprint,
    info: worktreeNow,
    // (headless, an agent's: it relaunches at once)
    changed: (what) => { worktreeChanged(what); if (QUIET) restartToUpdate() },
    restartServers: () => { for (const w of wins.values()) if (w.server?.exitCode === null) { w.restarting = true; w.server.kill() } },
    say: (text) => { for (const w of wins.values()) if (w.ready) w.win.webContents.send("vaultite", { type: "update-status", text, done: true }) },
  })
}

// ---------- quitting ----------

/** Web pages unloaded before quitting, as closing their tabs would (sites save their sign-ins then): once, by whichever
 *  quit comes first. */
let unloaded = false
const unloadOnce = () => (unloaded ? Promise.resolve()
  // (bounded: a page that never says it's gone must not keep the app from quitting)
  : Promise.race([unloadPages(), new Promise((done) => setTimeout(done, 5000))]).finally(() => { unloaded = true }))

// ---------- the menu ----------
/** Run one of the app's commands in the focused vault window (the manager just closes on ⌘W). */
function command(id: string) {
  return (_item: unknown, from?: BaseWindow) => {
    const f = from ?? AppWindow.getFocusedWindow()
    const w = [...wins.values()].find((x) => x.win === f)
    if (w) w.win.webContents.send("vaultite", { type: "command", id })
    else if (f instanceof AppWindow && popouts.has(f.webContents)) f.webContents.send("vaultite", { type: "command", id })
    else if (id === "tab:close") f?.close()
    else if (id in ZOOM_STEPS) zoomBy(ZOOM_STEPS[id])
  }
}

/** The interface size a step bigger (1), smaller (-1) or back to actual size (0), in every window; answers it. */
function zoomBy(step: -1 | 0 | 1) {
  const i = ZOOMS.findIndex((z) => z >= zoom - 0.001)
  const to = step === 0 ? 1 : ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.length - 1 : i) + step))]
  if (to === zoom) return zoom
  zoom = to
  const pages = [...[...wins.values()].map((w) => w.win.webContents), ...popouts.keys(), ...[...remoteWins.values()].map((w) => w.webContents)]
  for (const wc of pages) if (!wc.isDestroyed()) { wc.setZoomFactor(zoom); wc.send("vaultite:zoom", zoom) }
  save()
  return zoom
}
handle("window:zoom", () => zoom)
handle("window:zoom-step", (_w, step: unknown) => zoomBy(step === 1 || step === -1 ? step : 0))
/** The menu's zoom items in a window with no page of ours to ask (another machine's): the interface size. */
const ZOOM_STEPS: Record<string, -1 | 0 | 1> = { "zoom:in": 1, "zoom:out": -1, "zoom:reset": 0, "interface-size:increase": 1, "interface-size:decrease": -1, "interface-size:reset": 0 }

/** Help's documents (README.md, CHANGELOG.md, shipped with the app) open in a tab of the focused vault's window, like
 *  a file from outside the vault. */
async function openDoc(name: string) {
  const file = path.join(ROOT, name)
  if (!fs.existsSync(file)) return
  const w = focusedVault()
  if (!w) return void openFiles([file], null)
  for (const f of await openFiles([file], w)) send(w, f)
  w.win.focus()
}

/** The repo's issues page (its GitHub address: the build's, else the checkout's origin), or null. */
const issues = (() => {
  let repo = CODE?.repo ?? ""
  if (!repo) try { repo = execFileSync("git", ["-C", ROOT, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: gitEnv() }).trim() } catch { /* not a checkout */ }
  const m = /github\.com[/:]([^/]+\/[^/]+?)(\.git)?$/.exec(repo)
  return m ? `https://github.com/${m[1]}/issues` : null
})()

/** The menu bar (electron/menu.ts), for the focused vault window's commands (its last `menu:sync`). */
let menuShown = ""
function buildMenu() {
  const recent = [...known].sort((a, b) => (b.last ?? 0) - (a.last ?? 0))
  const w = focusedVault()
  const update = updateMenuItem()
  const template = menuTemplate({
    snap: w?.menu ?? null,
    run: command,
    go: (p) => { const f = focusedVault(); if (f?.ready) f.win.webContents.send("vaultite", { type: "go", path: p }) },
    update,
    vaults: [...recent.map((v) => ({ label: nameOf(v.path), sublabel: v.path, type: "checkbox" as const, checked: wins.has(v.path),
      click: () => openVault(v.path).catch((e) => failedBox(`Couldn't open ${nameOf(v.path)}`, e)) })),
      ...remotes.map((r) => ({ label: r.name, sublabel: r.url, type: "checkbox" as const, checked: remoteWins.has(r.url), click: () => openRemote(r.url) }))],
    manageVaults: showManager,
    setup: () => showSetup(),
    pickOutside: () => { void pickOutside(null) },
    openDoc: (name) => { void openDoc(name) },
    issues,
    openExternal: (url) => { void shell.openExternal(url) },
    maximize: () => { const f = AppWindow.getFocusedWindow(); if (f) { if (f.isMaximized()) f.unmaximize(); else f.maximize() } },
    showLogs: () => { fs.mkdirSync(app.getPath("logs"), { recursive: true }); void shell.openPath(app.getPath("logs")) },
    sandbox: () => { sandbox().catch(() => {}) },
    // (an app window's page keeps it for that window: its command; another window, as it is)
    onTop: (_i, from) => {
      const f = from ?? BaseWindow.getFocusedWindow()
      if (f instanceof AppWindow && ([...wins.values()].some((x) => x.win === f) || popouts.has(f.webContents))) f.webContents.send("vaultite", { type: "command", id: "window:on-top" })
      else if (f) void import("./ontop.ts").then((k) => k.setOnTop(f, !f.isAlwaysOnTop()))
    },
  })
  // (The same menu again isn't set: setting it closes one that's open.)
  const key = JSON.stringify([w?.menu ?? null, recent.map((v) => [v.path, wins.has(v.path)]), remotes.map((r) => [r.url, remoteWins.has(r.url)]), update && [update.label, update.enabled]])
  if (key === menuShown && Menu.getApplicationMenu()) return
  menuShown = key
  const menu = Menu.buildFromTemplate(template), top = menu.getMenuItemById("on-top")
  // (checked as the window in front is when it opens)
  top?.menu?.on("menu-will-show", () => { top.checked = !!BaseWindow.getFocusedWindow()?.isAlwaysOnTop() })
  Menu.setApplicationMenu(menu)
}
AppWindow.each((w) => w.on("focus", () => buildMenu()))
// Windows draws no menu bar (the title bar is the page's, with its controls): Alt pressed and let go alone opens its menus
// where it would be, as apps that hide theirs do; their keys work either way.
if (WIN) AppWindow.each((w) => {
  let alone = false
  w.webContents.on("before-input-event", (_e, i) => {
    if (i.key !== "Alt") alone = false
    else if (i.type === "keyDown" && !i.isAutoRepeat) alone = true
    else if (i.type === "keyUp" && alone) { alone = false; Menu.getApplicationMenu()?.popup({ window: w, x: 8, y: CONTROLS_HEIGHT }) }
  })
  // (Alt with a click: the editor's cursors, not the menu)
  w.webContents.on("input-event", (_e, i) => { if (i.type === "mouseDown") alone = false })
})

/** An AppImage on a system that keeps it from Chromium's sandbox (Ubuntu 24.04+'s AppArmor) runs without it (its AppRun
 *  adds --no-sandbox): said once, with the two ways to have it, the .deb or a profile for AppImages' mounts. */
function unsandboxedNotice() {
  const seen = path.join(app.getPath("userData"), "unsandboxed-notice")
  if (!process.env.APPIMAGE || !app.commandLine.hasSwitch("no-sandbox") || fs.existsSync(seen)) return
  try { fs.writeFileSync(seen, new Date().toISOString() + "\n") } catch { /* said again next time */ }
  const profile = `abi <abi/4.0>,\ninclude <tunables/global>\n\nprofile vaultite-appimage /tmp/.mount_Vault*/vaultite flags=(unconfined) {\n  userns,\n}\n`
  const command = `printf '${profile.replace(/\n/g, "\\n")}' | sudo tee /etc/apparmor.d/vaultite-appimage >/dev/null && sudo apparmor_parser -r /etc/apparmor.d/vaultite-appimage`
  void dialog.showMessageBox({ type: "warning", message: "Vaultite is running without its sandbox",
    detail: "This system's AppArmor keeps AppImages from Chromium's sandbox, so Vaultite started without it. Install the .deb " +
      "instead (it sets this up), or allow it for Vaultite's AppImage with one command in a terminal, then open Vaultite again.",
    buttons: ["Copy the command", "OK"], defaultId: 1, cancelId: 1 }).then((r) => { if (r.response === 0) clipboard.writeText(command) })
}

// ---------- the app ----------
/** The vault asked for on the command line (`--vault <path>`, a relaunch's `--vault=<path>`: argv.ts). */
const asked = () => vaultArg(process.argv)
/** A vault asked for that isn't there (a typo, a drive not connected) is made only once the user says so. */
async function madeIfAsked(p: string) {
  if (fs.existsSync(p)) return true
  const r = await dialog.showMessageBox({ type: "question", message: `There's no folder ${p}`, detail: "Create a new vault there?",
    buttons: ["Create vault", "Cancel"], defaultId: 0, cancelId: 1 })
  if (r.response !== 0) return false
  fs.mkdirSync(p, { recursive: true })
  return true
}
/** The vaults to open at launch: the one asked for, else those open when the app last quit. */
const reopening = () => { const a = asked(); return a ? [a] : known.filter((v) => v.open).map((v) => v.path) }

/** Files and folders named on a command line: Linux's Open with (the desktop file's %U: file:// URLs), Windows' (a
 *  path) and `vaultite <file>`, the app's own and a second launch's. A Mac sends open-file instead. */
function argFiles(argv: string[], cwd: string) {
  const out: string[] = []
  for (let i = app.isPackaged ? 1 : 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--vault") { i++; continue }
    if (a.startsWith("-") || /^vaultite:/i.test(a)) continue
    let p = a
    if (p.startsWith("file://")) try { p = fileURLToPath(p) } catch { continue }
    p = path.resolve(cwd, p)
    if (p !== ROOT && fs.existsSync(p)) out.push(p)
  }
  return out
}

/** vaultite:// links on a command line: how Windows and Linux hand the app one (a Mac sends open-url). */
const argLinks = (argv: string[]) => argv.slice(1).filter((a) => /^vaultite:/i.test(a))

// Finder's Open with (and files dropped on the Dock icon): can come before the app is ready.
const early: string[] = MAC ? [] : argFiles(process.argv, process.cwd())
let started = false
app.on("open-file", (e, p) => {
  e.preventDefault()
  if (started) openFiles([p], null).catch(() => {})
  else early.push(p)
})

// vaultite:// from another app or a link: the iPhone app's addresses (ios/App/Shared/Links.swift), `command/<id>`,
// `open/<path>` and `bundle/<owner>/<name>` (a bundle's preview, never applied by the link), in the focused vault's window.
const earlyLinks: string[] = MAC ? [] : argLinks(process.argv)
app.on("open-url", (e, url) => {
  e.preventDefault()
  if (started) void appLink(url).catch(() => {})
  else earlyLinks.push(url)
})
async function appLink(url: string) {
  let u: URL
  try { u = new URL(url) } catch { return }
  // A web link from another app, Vaultite being the Mac's browser: a web tab in the focused vault's window.
  if (u.protocol === "http:" || u.protocol === "https:") {
    const w = focusedVault() ?? await (async () => { const last = [...known].sort((a, b) => (b.last ?? 0) - (a.last ?? 0))[0]; return last ? openVault(last.path).catch(() => null) : null })()
    if (!w) return showManager()
    const go = (n = 0) => { if (w.win.isDestroyed()) return; if (w.ready) { w.win.webContents.send("vaultite", { type: "web", url: u.href }); w.win.show(); w.win.focus() } else if (n < 150) setTimeout(() => go(n + 1), 200) }
    return go()
  }
  if (u.protocol !== "vaultite:") return
  let rest = ""
  try { rest = decodeURIComponent(u.pathname.replace(/^\/+/, "")) } catch { return }
  const what = u.hostname.toLowerCase()
  if (what === "bundle") { const r = parseRepo(rest); if (!r) return; rest = repoText(r) }
  else if (what === "command" ? !/^[\w:.-]+$/.test(rest) : what !== "open" || !rest || rest.split(/[\\/]/).some((x) => x === ".." || x.startsWith("."))) return
  let w: Win | null = focusedVault()
  if (!w) {
    const last = [...known].sort((a, b) => (b.last ?? 0) - (a.last ?? 0))[0]
    if (!last) return showManager()
    w = await openVault(last.path).catch(() => null)
  }
  if (!w) return
  if (what === "open") {
    // (a note named without its .md, as a [[link]] names it)
    const abs = inVault(w.vault.path, rest)
    if (!abs) return
    if (!path.extname(rest) && fs.existsSync(`${abs}.md`)) rest += ".md"
    if (!fs.existsSync(path.join(w.vault.path, rest))) return
    send(w, rest)
  } else {
    const to = w
    // (a window still loading takes it once its page listens; the page tries until the command is there)
    const msg = what === "bundle" ? { type: "link", bundle: rest } : { type: "link", id: rest }
    const go = (n = 0) => { if (to.win.isDestroyed()) return; if (to.ready) to.win.webContents.send("vaultite", msg); else if (n < 150) setTimeout(() => go(n + 1), 200) }
    go()
  }
  if (w.win.isMinimized()) w.win.restore()
  w.win.focus()
}

/** The sandbox among the vaults reopening, made again first when stale (refreshSandbox): its window waits for it. */
let refreshed: Promise<unknown> = Promise.resolve()
if (!app.requestSingleInstanceLock()) app.quit()
else {
  // The vaults open last time start their servers now, before Electron is ready: a server takes longer to start than
  // the app, and they start together. (A vault opened with --vault that isn't known yet starts when its window does.)
  const start = (p: string) => {
    const v = find(p)
    if (v && !attachable(p) && fs.statSync(p, { throwIfNoEntry: false })?.isDirectory()) serverFor(v).catch(() => {})
  }
  for (const p of reopening()) {
    if (p !== sandboxPath()) { start(p); continue }
    refreshed = refreshSandbox(p).then((made) => { const v = find(p); if (made && v) delete v.port }, (e) => console.error(e)).then(() => start(p))
  }
}
// Launched again (Linux and Windows: the app's icon, Open with, a vaultite:// link, `vaultite <file>`): this one opens
// what it was given, else comes forward.
app.on("second-instance", (_e, argv, cwd) => {
  const p = vaultArg(argv, cwd)
  const files = MAC ? [] : argFiles(argv, cwd), links = MAC ? [] : argLinks(argv)
  if (links.length) for (const u of links) void appLink(u).catch(() => {})
  else if (p) {
    void madeIfAsked(p).then(async (go) => { if (go) await openVault(p) }).catch((e) => failedBox("Couldn't open the vault", e))
  }
  else if (files.length) void openFiles(files, null)
  else {
    const w = focusedVault()?.win ?? manager ?? setupWin
    if (w) { if (w.isMinimized()) w.restore(); w.focus() } else showManager()
  }
})

app.on("before-quit", (e) => {
  quitting = true
  if (unloaded) return
  e.preventDefault()
  void unloadOnce().finally(() => app.quit())
})
app.on("will-quit", () => {
  for (const w of [...wins.values(), ...kept.values()]) {
    if (!handingOver) w.server?.kill()
    else if (adopted(w.server)) w.server.release()
    w.link?.stop()
  }
  stopApps()
  stopDictation()
  quitUpdates()
})
/** The launch's windows are open (or failed): from then on, closing the last window quits off a Mac. */
let launched = false
app.on("window-all-closed", () => {
  // As Mac apps do, the app stays there; the Dock icon brings back the manager. Elsewhere there's no Dock to: it quits
  // (its terminals live on in their keeper).
  if (!MAC && launched) app.quit()
})
app.on("activate", () => { if (!wins.size && !manager && !setupWin && !remoteWins.size) openHome() })

/** Opened from its disk image (or Downloads): offer to move into Applications (a copy there: movelogic.ts), never to a
 *  copy a script drives. True: it moved, and relaunches from there, which ejects the image it came from. */
async function offerMove(): Promise<boolean> {
  const moved = path.join(app.getPath("userData"), "moved-from-dmg")
  if (fs.existsSync(moved)) {
    fs.rmSync(moved, { force: true })
    ejectImages()
  }
  const never = path.join(app.getPath("userData"), "never-move")
  if (!MAC || !RELEASE || driven || app.isInApplicationsFolder() || fs.existsSync(never)) return false
  const r = await dialog.showMessageBox({ message: `Move ${app.getName()} to Applications?`,
    detail: "It runs from there, so it's still there after you eject the disk image, and it can update itself.",
    buttons: ["Move to Applications", "Not now"], defaultId: 0, cancelId: 1, checkboxLabel: "Don't ask again" })
  if (r.response !== 0) {
    if (r.checkboxChecked) fs.writeFileSync(never, "")
    return false
  }
  fs.mkdirSync(app.getPath("userData"), { recursive: true })
  fs.writeFileSync(moved, "")
  try {
    const { moveConflict, plistVersion } = await import("./movelogic.ts")
    // (the copy there: the one Electron would trash, by this bundle's name)
    const there = path.join("/Applications", path.basename(path.resolve(app.getPath("exe"), "../../..")))
    const conflictHandler = (type: "exists" | "existsAndRunning") => {
      let plist = ""
      try { plist = fs.readFileSync(path.join(there, "Contents", "Info.plist"), "utf8") } catch { /* unread: asked */ }
      const c = moveConflict(app.getName(), app.getVersion(), { version: plistVersion(plist), running: type === "existsAndRunning" })
      if (c.kind === "replace") return true
      if (c.kind === "say") { dialog.showMessageBoxSync({ type: "info", message: c.message, detail: c.detail }); return false }
      return dialog.showMessageBoxSync({ type: "warning", message: c.message, detail: c.detail, buttons: c.buttons!, defaultId: 0, cancelId: 0 }) === 1
    }
    if (app.moveToApplicationsFolder({ conflictHandler })) return true
    fs.rmSync(moved, { force: true })
    return false
  } catch (e) {
    fs.rmSync(moved, { force: true })
    void dialog.showMessageBox({ type: "warning", message: `Couldn't move ${app.getName()} to Applications`, detail: String((e as Error).message) })
    return false
  }
}

/** The disk images still holding a copy of this app (the one it was moved out of), ejected. */
function ejectImages() {
  try {
    const info = JSON.parse(execFileSync("/bin/sh", ["-c", "hdiutil info -plist | plutil -convert json -o - -"], { encoding: "utf8", timeout: 10_000 }))
    for (const image of info.images ?? []) {
      for (const e of image["system-entities"] ?? []) {
        const at = e["mount-point"]
        if (at && fs.existsSync(path.join(at, `${app.getName()}.app`))) execFile("hdiutil", ["detach", "-quiet", at], () => {})
      }
    }
  } catch (e) {
    console.error("eject:", e)
  }
}

// A page that sets no window.open handler of its own opens nothing (one it sets later replaces this), and none attaches a
// <webview> (the app has none).
app.on("web-contents-created", (_e, wc) => {
  wc.setWindowOpenHandler(() => ({ action: "deny" }))
  wc.on("will-attach-webview", (e) => e.preventDefault())
})

/** The default session's permissions (the app's windows, another machine's, the frames a note shows): electron/apppermissions.ts.
 *  Another machine's window asks for the microphone, camera and location, once a launch per site. */
const remoteAsked = new Map<string, Promise<boolean>>(), remoteYes = new Set<string>()
function guardPermissions() {
  const s = session.defaultSession
  const decide = (url: string, perm: string) => permissionFor(perm, whose(url, remotes.map((r) => r.url), DIST, [...wins.values()].map((w) => w.port)))
  s.setPermissionRequestHandler((wc, perm, ok, details) => {
    const url = details.requestingUrl || wc.getURL(), d = decide(url, perm)
    if (d !== "ask") return ok(d === "allow")
    const site = new URL(url).origin, key = `${site} ${perm} ${(details as { mediaTypes?: string[] }).mediaTypes?.join(",") ?? ""}`
    if (!remoteAsked.has(key)) {
      const what = perm === "geolocation" ? "know your location" : (details as { mediaTypes?: string[] }).mediaTypes?.includes("video") ? "use your camera" : "use your microphone"
      const win = AppWindow.fromWebContents(wc) ?? undefined, box = { type: "question" as const, message: `${new URL(url).hostname} wants to ${what}`, buttons: ["Allow", "Don't allow"], defaultId: 1, cancelId: 1 }
      remoteAsked.set(key, (win ? dialog.showMessageBox(win, box) : dialog.showMessageBox(box)).then((r) => {
        if (r.response === 0) remoteYes.add(`${site} ${perm}`)
        return r.response === 0
      }, () => false))
    }
    void remoteAsked.get(key)!.then(ok)
  })
  s.setPermissionCheckHandler((_wc, perm, origin) => {
    const d = decide(origin, perm)
    if (d !== "ask") return d === "allow"
    try { return remoteYes.has(`${new URL(origin).origin} ${perm}`) } catch { return false }
  })
}

app.whenReady().then(async () => {
  guardPermissions()
  if (await offerMove()) return
  if (fs.existsSync(DOCK_ICON()) || !app.isPackaged) applyDockIcon()
  app.setAboutPanelOptions({ applicationName: app.getName(), applicationVersion: app.getVersion() })
  if (WORKTREE) await startWorktree()
  if (DEV) app.dock?.setBadge(dev?.badge() ?? "dev")
  // (a Mac's, but for a copy a script drives or Vaultite Dev, unless VAULTITE_HELPER=1)
  if (process.env.VAULTITE_HELPER === "1" || (MAC && !driven && !DEV && process.env.VAULTITE_HELPER !== "0")) helper = await import("./helper.ts")
  const homePath = () => lastFocused && (wins.has(lastFocused) || kept.has(lastFocused)) ? lastFocused : [...wins.keys()][0] ?? [...kept.keys()][0]
  setDictationServer((win) => {
    const p = win ? [...wins.values()].find((w) => w.win === win)?.vault.path : homePath()
    return (p ? wins.get(p)?.port ?? kept.get(p)?.port : null) ?? null
  })
  const helperHost: HelperHost = {
    dictation: await import("./dictation.ts"),
    home: () => {
      const p = homePath()
      const port = p ? wins.get(p)?.port ?? kept.get(p)?.port : undefined
      return p && port ? { port, path: p, name: nameOf(p) } : null
    },
    homeWindow: () => {
      const p = homePath(), w = p ? wins.get(p)?.win : undefined
      if (!w || w.isDestroyed() || !w.isVisible() || w.isMinimized()) return null
      return { page: w.webContents, bounds: w.getContentBounds(), zoom: w.webContents.getZoomFactor() }
    },
    openHome, quit: () => app.quit(),
    focusedPage: () => AppWindow.getFocusedWindow()?.webContents ?? null,
    event: (name, data) => { for (const w of [...wins.values(), ...kept.values()]) { const m = { type: "desktop:event", name, data }; if (w.server?.connected) w.server.send(m); else w.link?.send(m) } },
    prefs: () => helperPrefs, setPrefs: (x) => { helperPrefs = { ...helperPrefs, ...x }; save() },
    icon: path.join(ROOT, "electron", "tray", "stoneTemplate.png"),
  }
  if (helper) helperAt = (await import("./helperload.ts")).helperSlot({ now: () => helper, set: (h) => { helper = h }, host: helperHost, log: logUpdate })
  if (helper) await helper.startHelper(helperHost)
  // (a Mac's Info.plist and Linux's desktop file name the scheme; the installer can't on Windows)
  if (WIN && app.isPackaged && !app.isDefaultProtocolClient("vaultite")) app.setAsDefaultProtocolClient("vaultite")
  buildMenu()
  const a = asked()
  started = true
  const go = !a || await madeIfAsked(a) // (else the vaults list)
  await refreshed
  await Promise.all((go ? reopening() : []).map((p) => openVault(p).catch((e) => console.error(e))))
  if (!asked()) for (const r of remotes.filter((x) => x.open)) openRemote(r.url)
  if (firstRun() && !asked() && DEV) await sandbox().catch((e) => console.error(e))
  else if (firstRun() && !asked()) showSetup()
  else if (!wins.size && !remoteWins.size && !early.length && !(await helperHome())) showManager()
  if (early.length) await openFiles(early.splice(0), null)
  for (const u of earlyLinks.splice(0)) await appLink(u).catch(() => {})
  behind = false
  launched = true
  setTimeout(() => { if (!wins.size) shellReady(null) }, 20_000)
  if (!MAC && !AppWindow.getAllWindows().length) showManager() // (every window the launch opened failed)
  if (LINUX) unsandboxedNotice()
  scheduleUpdates()
})
