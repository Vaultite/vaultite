// Vaultite's desktop app (Electron): each vault a window with its server (electron/CLAUDE.md).
import "../core/winspawn.ts"
import "./dockenv.ts"
import { app, BaseWindow, type BaseWindowConstructorOptions, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, session, shell, systemPreferences, type IpcMainInvokeEvent, type Rectangle, type WebContents, type WebPreferences } from "electron"
import { AppWindow } from "./appwindow.ts"
import { relaunchOptions, vaultArg } from "./argv.ts"
import { QUIET, fakePointer, quiet, quietPage } from "./quiet.ts"
import { hangReport, hangStarted, LONG_FRAME_LIST, LONG_FRAMES, MAX_SAMPLES, SAMPLE_EVERY_MS, sampled, type Hang, type HangEnd, type LongFrame } from "./hang.ts"
import { execFile, execFileSync, fork, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
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
import { appPage, permissionFor, whose } from "./apppermissions.ts"
import * as Setup from "./setup.ts"
import { gitEnv } from "../core/gitenv.ts"
import { vauEntry } from "../core/appentry.ts"
import { strings } from "../core/values.ts"

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PRELOAD = path.join(ROOT, "electron", "preload.cjs")
const DIST = path.join(ROOT, "web", "dist")
const ICON = path.join(ROOT, "web", "public", "icon-512.png")
const MAC = process.platform === "darwin"
const LIGHTS = { x: 16, y: 14 }
// macOS 26 draws a 14pt circle filling its frame, 23pt apart; before it, a 12pt circle in a 14×16 frame, 20pt apart.
const BUTTONS = MAC && Number(process.getSystemVersion().split(".")[0]) >= 26
  ? { width: 14, height: 14, size: 14, pitch: 23 } : { width: 14, height: 16, size: 12, pitch: 20 }
const LINUX = process.platform === "linux"
const WIN = process.platform === "win32"
const CONTROLS_HEIGHT = 40
const chrome = (): BaseWindowConstructorOptions => WIN
  ? { titleBarStyle: "hidden", titleBarOverlay: { color: background(), symbolColor: nativeTheme.shouldUseDarkColors ? "#ffffff" : "#000000", height: CONTROLS_HEIGHT } }
  : { titleBarStyle: "hiddenInset", trafficLightPosition: LIGHTS }

// Under --no-sandbox (an AppImage under AppArmor, Playwright on Linux) renderers no window makes keep Electron's sandboxed
// renderer, which runs service-worker preloads; not as root, where Chromium sandboxes nothing and each would die.
if (app.commandLine.hasSwitch("no-sandbox") && process.getuid?.() !== 0) app.commandLine.appendSwitch("enable-sandbox")
if (QUIET) {
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows")
  app.commandLine.appendSwitch("disable-renderer-backgrounding")
  app.on("browser-window-created", (_e, w) => quiet(w, w.webContents))
  app.on("web-contents-created", (_e, wc) => quietPage(wc))
  AppWindow.each((w) => quiet(w, w.webContents))
  app.focus = () => {}
  void app.whenReady().then(() => { fakePointer(); app.dock?.hide() })
}
const driven = !!process.env.VAULTITE_QUIET || app.commandLine.hasSwitch("remote-debugging-port")
if (driven && !process.env.VAULTITE_SOUND) app.commandLine.appendSwitch("mute-audio")
// A keychain password prompt nobody's there to answer hangs the run.
if (driven) { app.commandLine.appendSwitch("use-mock-keychain"); app.commandLine.appendSwitch("password-store", "basic") }
app.commandLine.appendSwitch("enable-features", [app.commandLine.getSwitchValue("enable-features"), "DocumentPolicyIncludeJSCallStacksInCrashReports"].filter(Boolean).join(","))
// Under Playwright, a page's frame swapped out as it navigates (RenderDocument) can crash its renderer turning off
// Playwright's focus emulation (Blink's race: QA's "Target crashed"); no user page has it, so only there it's off.
if (app.commandLine.hasSwitch("remote-debugging-port")) {
  app.commandLine.appendSwitch("disable-features", [app.commandLine.getSwitchValue("disable-features"), "RenderDocument"].filter(Boolean).join(","))
}
// A Mac takes a window's icon from the bundle, a packaged Windows app from its .exe; on Linux (and Windows from source)
// each window carries it (the taskbar, Alt+Tab), else Electron's.
if (LINUX || (WIN && !app.isPackaged)) { app.on("browser-window-created", (_e, w) => w.setIcon(ICON)); AppWindow.each((w) => w.setIcon(ICON)) }
let behind = !!process.env.VAULTITE_BEHIND
// What macOS runs rather than shows when opened (an app, a script, a link to one).
function openVaultFile(abs: string) {
  let runs = runsCode(abs)
  try { runs ||= fs.statSync(abs).isDirectory() } catch { return }
  if (runs) shell.showItemInFolder(abs); else void shell.openPath(abs)
}
async function openLink(url: string) {
  if (/^file:/i.test(url)) {
    // (one on another computer, file://host/x, is a Windows network path: reaching it sends the user's login hash)
    try { if (["", "localhost"].includes(new URL(url).hostname)) openVaultFile(fileURLToPath(url)) } catch {}
    return
  }
  const scheme = otherAppScheme(url)
  if (!scheme) return
  if (!["http", "https", "mailto"].includes(scheme)) {
    const { response } = await dialog.showMessageBox({ type: "question", buttons: ["Open", "Cancel"], defaultId: 1, cancelId: 1, message: "Open this link in another app?", detail: url })
    if (response !== 0) return
  }
  shell.openExternal(url).catch((e) => console.error(`couldn't open ${url.split(":")[0]}: link`, e))
}
// Electron's error box for an uncaught exception stops everything and shows even over the QA scripts' quiet windows.
function uncaught(kind: "uncaught" | "rejection", e: unknown) {
  const err = e instanceof Error ? e : new Error(String(e))
  console.error(`main process, ${kind}:`, err)
  reportError(kind, `Main process: ${err.message}`, err.stack ?? "")
}
function reportError(kind: string, message: string, stack: string) {
  try {
    const body = JSON.stringify({ device: "desktop", errors: [{ kind, t: Date.now(), message, stack, build: CODE?.commit ?? "" }] })
    for (const w of wins.values()) void fetch(`http://127.0.0.1:${w.port}/api/errors`, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {})
  } catch {}
}
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
function failedBox(title: string, e: unknown, o: { why?: string; log?: string } = {}) {
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

type Known = {
  path: string; port?: number; open?: boolean; last?: number
  bounds?: Rectangle; maximized?: boolean
  lightsOff?: boolean
  outside?: string[]
}
const LIST = () => path.join(app.getPath("userData"), "vaults.json")
const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
let known: Known[] = []
type Remote = { url: string; name: string; open?: boolean; last?: number; bounds?: Rectangle }
let remotes: Remote[] = []
// One for every window: Chromium zooms by host, and every vault's server is on 127.0.0.1.
let zoom = 1
// Off unless set: any process on this Mac that reaches Chromium's DevTools port controls the app.
let debugPort: number | undefined
let updates: UpdateMode = "notify"
let helperPrefs: HelperPrefs = {}
try {
  const v = JSON.parse(fs.readFileSync(LIST(), "utf8"))
  known = Array.isArray(v.vaults) ? v.vaults.filter((x: Known) => x && typeof x.path === "string") : []
  remotes = Array.isArray(v.servers) ? v.servers.filter((x: Remote) => x && typeof x.url === "string" && /^https?:\/\//.test(x.url)) : []
  if (typeof v.zoom === "number" && v.zoom >= ZOOMS[0] && v.zoom <= ZOOMS[ZOOMS.length - 1]) zoom = v.zoom
  if (Number.isInteger(v.debugPort) && v.debugPort > 1024 && v.debugPort < 65536) debugPort = v.debugPort
  if (UPDATE_MODES.includes(v.updates)) updates = v.updates
  if (v.helper && typeof v.helper === "object") helperPrefs = v.helper
} catch {}
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
function vaultOf(p: string): [Known, string] | null {
  const r = real(p)
  for (const v of known) {
    const root = real(v.path)
    if (r.startsWith(root + path.sep)) return [v, path.relative(root, r).split(path.sep).join("/")]
  }
  return null
}

// Its last port: localStorage is by origin.
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

type Win = { vault: Known; win: AppWindow; server: ChildProcess | null; link: Link | null; port: number; ready: boolean; queue: string[]
  ending?: boolean
  restarting?: boolean
  web?: string
  welcome?: boolean
  menu?: MenuSnapshot }
const wins = new Map<string, Win>()
type Kept = { server: ChildProcess | null; link: Link | null; port: number }
const kept = new Map<string, Kept>()
let lastFocused: string | null = null
const macPermissions = () => import("./permissions.ts")

let helper: typeof import("./helper.ts") | null = null
let helperAt: HelperSlot | null = null
const helperOn = () => !!helper?.helperOn()
const homeChanged = () => helper?.homeChanged()
const popouts = new Map<WebContents, Win>()

const booting = new Map<string, Promise<[ChildProcess, number]>>()
const ownPids = new Set<number>()
function ownServer(pid: number | undefined, s: { once(e: "exit", fn: () => void): unknown }) {
  if (!pid) return
  ownPids.add(pid)
  s.once("exit", () => ownPids.delete(pid))
}
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
    b.catch(() => booting.delete(v.path))
  }
  return b
}

const answerCall = (v: Known, m: Call) => Promise.resolve().then(() => m.name === "app:permissions" ? (MAC ? macPermissions().then((p) => p.macPermissions()) : null)
  : m.name === "app:updates" ? appUpdates()
  : m.name === "app:update-look" ? lookNow(Array.isArray(m.args) ? m.args[0] as { port?: unknown; commit?: unknown } : undefined)
  : typeof m.name === "string" && m.name.startsWith("screen:") ? (helper ? helper.screenCall(m.name, Array.isArray(m.args) ? m.args : []) : null)
  : typeof m.name === "string" && m.name.startsWith("talk:") ? talkCall(m.name, Array.isArray(m.args) ? m.args : [])
  : typeof m.name === "string" && m.name.startsWith("dictations:") ? (MAC ? import("./dictationlist.ts").then((d) => d.dictationsCall(String(m.name), Array.isArray(m.args) ? m.args : [])) : { items: [], total: 0, here: false })
  : typeof m.name === "string" && m.name.startsWith("voice:") ? (helper ? helper.voiceCall(m.name, Array.isArray(m.args) ? m.args : []) : { said: false, why: "no menu-bar helper here" })
  : serverCall(wins.get(v.path)?.win, m.name, Array.isArray(m.args) ? m.args : []))

function desktopEvent(w: Win, name: string, data: unknown) {
  const m = { type: "desktop:event", name, data }
  if (w.server?.connected) w.server.send(m); else w.link?.send(m)
}
setServerSink((win, name, data) => { for (const w of wins.values()) if (w.win === win) desktopEvent(w, name, data) })

const rootOf = new WeakMap<ChildProcess, string>()
const logFrom = new WeakMap<ChildProcess, number>()
const adopted = (s: ChildProcess | null): s is ChildProcess & Adopted => typeof (s as { release?: unknown } | null)?.release === "function"
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
let handingOver = false
function startServer(v: Known, port: number, own = false): Promise<ChildProcess> {
  const logDir = app.getPath("logs")
  fs.mkdirSync(logDir, { recursive: true })
  const logFile = serverLog(v.path), fd = fs.openSync(logFile, "a"), from = fs.fstatSync(fd).size
  const root = own ? ROOT : codeRoot()
  const child = fork(path.join(root, "server.ts"), [], {
    cwd: root, stdio: ["ignore", fd, fd, "ipc"], detached: !WIN,
    env: {
      ...process.env, ELECTRON_RUN_AS_NODE: "1", VAULTITE_DESKTOP: "1", VAULTITE_VAULT: v.path, VAULTITE_LOCAL: LOCAL,
      HOST: "127.0.0.1", PORT: String(port),
      // (Node's compile cache out of the temp folder: restarts and cleanups empty it)
      NODE_COMPILE_CACHE: process.env.NODE_COMPILE_CACHE || path.join(app.getPath("userData"), "compile-cache"),
      VAULTITE_LAUNCHED_AT: String(Math.round(Date.now() - process.uptime() * 1000)), VAULTITE_FORKED_AT: String(Date.now()),
    },
  })
  fs.closeSync(fd)
  rootOf.set(child, root)
  logFrom.set(child, from)
  ownServer(child.pid, child)
  if (child.pid) hold(root, child.pid, "server")
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

const background = () => (nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ffffff")
let quitting = false
let manager: AppWindow | null = null
const waiting: string[] = []

function hangs(win: AppWindow, name: string) {
  let asking: AbortController | null = null
  let hang: Hang | null = null, reported = false, timer: NodeJS.Timeout | undefined
  const sample = async () => {
    const pid = win.webContents.getOSProcessId()
    const stack = await Promise.race([win.webContents.mainFrame.collectJavaScriptCallStack(), new Promise<undefined>((r) => setTimeout(r, 2500))]).catch(() => undefined)
    const m = app.getAppMetrics().find((x) => x.pid === pid)
    if (hang) hang = sampled(hang, { at: Date.now(), stack: stack ?? "", cpuSeconds: m?.cpu.cumulativeCPUUsage ?? null, memoryMB: m ? Math.round(m.memory.workingSetSize / 1024) : null })
  }
  const report = async (how: HangEnd) => {
    if (!hang || reported) return
    reported = true
    if (!hang.samples.length && !win.isDestroyed() && how !== "gone") await sample()
    const frames = how === "recovered" && !win.isDestroyed()
      ? await Promise.race([win.webContents.executeJavaScriptInIsolatedWorld(1003, [{ code: LONG_FRAMES }]).then((v) => LONG_FRAME_LIST.parse(v)), new Promise<LongFrame[]>((r) => setTimeout(() => r([]), 3000))]).catch(() => [])
      : []
    const r = hangReport(name, hang, { at: Date.now(), how }, { load: os.loadavg()[0], freeMB: Math.round(os.freemem() / 2 ** 20), totalMB: Math.round(os.totalmem() / 2 ** 20) }, frames)
    reportError("hung", r.message, r.stack)
  }
  const look = async () => {
    if (!hang || reported || win.isDestroyed()) return
    await sample()
    if (!hang || reported) return
    if (hang.samples.length < MAX_SAMPLES) timer = setTimeout(() => void look(), SAMPLE_EVERY_MS)
    else void report("still")
  }
  const ended = async (how: HangEnd) => {
    clearTimeout(timer)
    await report(how)
    hang = null
  }
  win.webContents.on("unresponsive", async () => {
    if (!hang) { hang = hangStarted(Date.now()); reported = false; void look() }
    if (asking || win.isDestroyed()) return
    const ask = (asking = new AbortController())
    const r = await dialog.showMessageBox(win, { type: "warning", message: `${name} isn't responding`, detail: "Wait for it, or reload its page.",
      buttons: ["Wait", "Reload"], defaultId: 0, cancelId: 0, signal: ask.signal }).catch(() => ({ response: 0 }))
    asking = null
    if (r.response === 1 && !ask.signal.aborted && !win.isDestroyed()) { await ended("reloaded"); if (!win.isDestroyed()) win.webContents.forcefullyCrashRenderer() }
  })
  win.webContents.on("responsive", () => { asking?.abort(); void ended("recovered") })
  win.webContents.on("render-process-gone", () => void ended("reloaded"))
  win.on("closed", () => void ended("gone"))
}
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
  const own = process.env.VAULTITE_TEST === "1" && (await import("../core/testrun.ts")).refuseOwnVault(p, "the desktop app")
  if (own) throw new Error(own)
  const v = remember(p)
  const had = kept.get(p)
  kept.delete(p)
  had?.link?.stop()
  const there = had?.server && had.server.exitCode === null ? null : await servedElsewhere(p).catch((e) => { failedBox(`Couldn't open ${nameOf(p)}`, e, { why: "Its server didn't start." }); throw e })
  const starting = there ? null : serverFor(v)
  const b = v.bounds
  const apps = appsOn(p), glass = translucentAt(p), clear = apps || (MAC && glass)
  const win = new AppWindow({
    width: b?.width ?? 1280, height: b?.height ?? 820, x: b?.x, y: b?.y, minWidth: 800, minHeight: 480, show: false,
    title: dev?.titled(nameOf(p)) ?? nameOf(p), ...chrome(),
    acceptFirstMouse: true,
    // (the system's blur shows only through a transparent window)
    ...(clear ? { transparent: true, backgroundColor: "#00000000" } : { backgroundColor: background() }),
    // bypassHeatCheck: V8 caches compiled scripts on the first launch, not the third.
    webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true, spellcheck: true, v8CacheOptions: "bypassHeatCheck" },
  })
  if (MAC && v.lightsOff) setLights(win, null)
  let server: ChildProcess | null = null, link: Link | null = null, port: number, loadFailed = false
  const outside = () => (v.outside?.length ? [{ type: "allow", paths: v.outside }] : [])
  try {
    if (there && heirHere(there)) [server, port] = [await adopt(v, there), there.port]
    else if (there) {
      port = there.port
      // (a page that loaded while its server was down is Chromium's error page)
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
    if (!quitting) v.open = false
    save(true)
  })
  win.on("focus", () => { if (lastFocused !== p) { lastFocused = p; homeChanged() } })
  lastFocused = p
  win.on("closed", () => {
    wins.delete(p)
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
      const at = w.port, started = startServer(v, at)
      const up = started.then((c): [ChildProcess, number] => [c, at])
      up.catch(() => {})
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
  revive(win.webContents, () => { w.ready = false }, crashedFor(win, nameOf(p)))
  hangs(win, nameOf(p))
  guard(win, `http://127.0.0.1:${port}`)
  webWindow(win)
  translucentWindow(win, clear, glass)
  if (apps) appsWindow(win)
  await win.loadURL(`http://127.0.0.1:${port}/`)
  homeChanged()
  if (manager && !manager.isDestroyed()) manager.close()
  buildMenu()
  return w
}

const heirHere = (s: Serving) => !!s.heir && s.app && s.heir.app === app.getPath("userData")
async function adopt(v: Known, s: Serving): Promise<ChildProcess> {
  let a: Adopted | null = null
  const link = await attach(v.path, s, (m) => answerCall(v, m), () => (v.outside?.length ? [{ type: "allow", paths: v.outside }] : []), () => a?.kill())
  a = new (await import("./heir.ts")).Adopted(s.pid, link)
  const child = a as unknown as ChildProcess
  ownServer(s.pid, a)
  rootOf.set(child, s.heir!.root)
  logFrom.set(child, (() => { try { return fs.statSync(serverLog(v.path)).size } catch { return 0 } })())
  console.error(`vaultite: ${nameOf(v.path)}'s server (pid ${s.pid}) kept running through the relaunch: taken over`)
  return child
}

function handOver() {
  handingOver = true
  const m = { type: "desktop:relaunching", app: app.getPath("userData") }
  for (const w of [...wins.values(), ...kept.values()]) if (w.server?.exitCode === null) w.server.send(m)
}

function keepServer(p: string, k: Kept) {
  kept.set(p, k)
  k.server?.once("exit", () => { if (kept.get(p) === k) { kept.delete(p); booting.delete(p) } })
}
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
function openHome() {
  const p = (lastFocused && (wins.has(lastFocused) || kept.has(lastFocused)) ? lastFocused : null) ?? [...kept.keys()][0]
  if (p) void openVault(p).catch((e) => failedBox(`Couldn't open ${nameOf(p)}`, e))
  else showManager()
}
AppWindow.each((w) => {
  if (!MAC || !helperOn()) return
  void app.dock?.show()
  w.on("closed", () => { if (helperOn() && !AppWindow.getAllWindows().some((x) => x !== w && !x.isDestroyed())) app.dock?.hide() })
})

function sandbox() {
  return openSandbox((p) => openVault(p), (p) => wins.has(p), (p) => { const v = find(p); if (v) delete v.port })
}

function guard(win: AppWindow, origin: string) {
  // Full screen hides the traffic lights.
  const lights = () => { if (!win.isDestroyed()) win.webContents.send("vaultite:fullscreen", win.isFullScreen()) }
  win.on("enter-full-screen", lights)
  win.on("leave-full-screen", lights)
  win.webContents.on("dom-ready", lights)
  // The Mac lays the title bar out again on these and may put the traffic lights back where they sit by default.
  const again = () => applyLights(win)
  if (MAC) { win.on("focus", again); win.on("blur", again); win.on("show", again); win.on("restore", again); win.on("resized", again); win.on("leave-full-screen", again) }
  // Out of focus, the Mac greys the lights.
  const key = () => { if (!win.isDestroyed()) win.webContents.send("vaultite:key", win.isFocused()) }
  if (MAC) { win.on("focus", key); win.on("blur", key); win.webContents.on("dom-ready", key) }
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
  win.webContents.on("context-menu", (_e, p) => win.webContents.send("vaultite", { type: "spelling", word: p.misspelledWord, suggestions: p.dictionarySuggestions }))
  win.webContents.on("will-navigate", (e, url) => {
    if (appPage(url, origin)) return
    e.preventDefault()
    void openLink(url)
  })
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if ((url === "about:blank" || url === "") && frameName === "vaultite-presenter") {
      return { action: "allow", overrideBrowserWindowOptions: { backgroundColor: background(), autoHideMenuBar: true } }
    }
    if (url.startsWith(`${origin}/?popout=`)) {
      const w = [...wins.values()].find((x) => x.win === win) ?? popouts.get(win.webContents)
      if (!w) return { action: "deny" }
      return { action: "allow", overrideBrowserWindowOptions: { webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true, spellcheck: true } },
        createWindow: (o) => popOut(w, (o as { webContents: WebContents }).webContents, o.webPreferences, o) } // (Electron puts the new page in its options)
    }
    if (appPage(url, origin)) return { action: "deny" }
    if (url.startsWith(origin + "/api/raw?")) {
      const w = [...wins.values()].find((x) => x.win === win)
      const rel = new URL(url).searchParams.get("path"), abs = w && rel ? inVault(w.vault.path, rel) : null
      if (abs) openVaultFile(abs)
    } else void openLink(url)
    return { action: "deny" }
  })
}

function send(w: Win, file: string) {
  if (w.ready) w.win.webContents.send("vaultite", { type: "open", path: file })
  else w.queue.push(file)
}

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

const remoteWins = new Map<string, AppWindow>()
const hostName = (url: string) => new URL(url).hostname.split(".")[0]

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
  let retry: ReturnType<typeof setTimeout> | null = null, wait = 5000, failed = false
  const load = () => void win.loadURL(`${url}/`).catch(() => {})
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

type SetupState = { done?: string }
const SETUP = () => path.join(app.getPath("userData"), "setup.json")
function setupState(): SetupState {
  try { const j = JSON.parse(fs.readFileSync(SETUP(), "utf8")); return j && typeof j === "object" ? j : {} } catch { return {} }
}
const saveSetup = (st: SetupState) => { fs.mkdirSync(path.dirname(SETUP()), { recursive: true }); fs.writeFileSync(SETUP(), JSON.stringify(st, null, 2) + "\n") }
const firstRun = () => !setupState().done && !known.some((v) => v.path !== sandboxPath()) && !remotes.length

let setupWin: AppWindow | null = null
const START_HERE = "Start here.md"
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
let dirs: string[] | null = null
const pathDirs = () => (dirs ??= process.env.VAULTITE_SETUP_HOME ? [] : Setup.shellPath(where()))

function showSetup() {
  if (setupWin && !setupWin.isDestroyed()) return setupWin.focus()
  setupWin = new AppWindow({
    // (useContentSize: a Linux window frame is outside it)
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

function dropChosen() {
  const p = chosen?.path
  if (p && !wins.has(p)) {
    booting.get(p)?.then(([child]) => child.kill(), () => {})
    booting.delete(p)
    if (chosen!.added) { known = known.filter((v) => v.path !== p); save(); buildMenu() }
  }
  chosen = null
}

function serverUrl(typed: string) {
  const t = typed.trim()
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(t) ? t : `https://${t}`)
    return /^https?:$/.test(u.protocol) && u.hostname ? u.origin : null
  } catch { return null }
}

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
  if (fresh) await call("ai.set", { on: "off" }, "AI off until asked")
  if (c.kind === "new" && c.starter) await call("vault.starter", {}, "starter content")
  return chosen
})
setupHandle("setup:vau", async (system: boolean) => {
  const r = Setup.installVau(where())
  if (WIN) dirs = null
  if (system) await Setup.linkSystem(r.path)
  return { did: system ? `Linked /usr/local/bin/vau to ${r.path}` : r.did, vau: Setup.vauStatus(where(), pathDirs()) }
})
setupHandle("setup:sandbox", async () => {
  await sandbox()
  setupWin?.close()
})
setupHandle("setup:finish", async () => {
  saveSetup({ done: new Date().toISOString() })
  dirs = null
  const c = chosen
  chosen = null
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

const slashed = (p: string) => (WIN ? p.replace(/\\/g, "/") : p)

async function openFiles(paths: string[], into: Win | null): Promise<string[]> {
  const mine: string[] = []
  for (const p of paths) {
    const st = fs.statSync(p, { throwIfNoEntry: false })
    if (!st) continue
    if (st.isDirectory()) {
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
  for (const src of paths) {
    try {
      const st = fs.statSync(src, { throwIfNoEntry: false })
      if (!st || !path.isAbsolute(src)) continue
      const from = real(src), into = real(dir)
      if (into === from || into.startsWith(from + path.sep) || path.dirname(from) === into) continue
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

function who(e: IpcMainInvokeEvent): Win | null {
  const url = e.senderFrame?.url ?? ""
  for (const w of wins.values()) if (w.win.webContents === e.sender && appPage(url, `http://127.0.0.1:${w.port}`)) return w
  const pop = popouts.get(e.sender)
  if (pop && appPage(url, `http://127.0.0.1:${pop.port}`)) return pop
  if (manager && e.sender === manager.webContents && url.startsWith(pathToFileURL(DIST).href)) return null
  throw new Error("not a Vaultite window")
}
const MAIN_ONLY: Record<string, unknown> = { "app:ready": [], "menu:sync": undefined }
function handle(name: string, fn: (w: Win | null, ...args: never[]) => unknown) {
  ipcMain.handle(name, (e, ...args) => {
    const w = who(e)
    if (name in MAIN_ONLY && popouts.has(e.sender)) return MAIN_ONLY[name]
    return fn(w, ...(args as never[]))
  })
}
const str = (x: unknown) => { if (typeof x !== "string") throw new Error("expected text"); return x }
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
handle("app:setup", () => showSetup())
handle("app:welcome", (w) => {
  if (!w?.welcome) return false
  w.welcome = false
  return true
})
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
// macOS asks once whether Vaultite may use the microphone; the page's getUserMedia works only after.
handle("media:microphone", async () => !MAC || systemPreferences.askForMediaAccess("microphone"))
handle("app:permission", (_w, id: string) => { if (MAC) return macPermissions().then((p) => p.permissionAct(str(id))) })
handle("print:reveal", (_w, p: string) => { if (str(p).endsWith(".pdf")) shell.showItemInFolder(p) })
// A Notification nothing refers to is collected, and its click lost.
const shown = new Set<Notification>()
// Never the bundle's icon: changing the bundle breaks its signature and updates.
const DOCK_ICON = () => path.join(app.getPath("userData"), "dock-icon.png")
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp" }
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
handle("dock:pick", async (w) => {
  const opts = { properties: ["openFile"] as "openFile"[], filters: [{ name: "Images", extensions: Object.keys(IMAGE_TYPES) }] }
  const r = w ? await dialog.showOpenDialog(w.win, opts) : await dialog.showOpenDialog(opts)
  const file = r.canceled ? null : r.filePaths[0]
  const type = file && IMAGE_TYPES[path.extname(file).slice(1).toLowerCase()]
  return file && type ? `data:${type};base64,${fs.readFileSync(file).toString("base64")}` : null
})
ipcMain.handle("text:look-up", (e) => { who(e); e.sender.showDefinitionForSelection() })
ipcMain.handle("text:learn", (e, word: string) => { who(e); e.sender.session.addWordToSpellCheckerDictionary(str(word)) })
const lightsOf = new WeakMap<AppWindow, { x: number; y: number } | null>()
function setLights(w: AppWindow, at: { x: number; y: number } | null) {
  lightsOf.set(w, at)
  applyLights(w)
}
function applyLights(w: AppWindow) {
  const at = lightsOf.get(w)
  if (at === undefined || w.isDestroyed()) return
  const shown = !!at && (bare.get(w)?.lightsShown(w) ?? true)
  if (at) w.setWindowButtonPosition(at)
  w.setWindowButtonVisibility(shown)
  // (shown again, the Mac lays them out where they sit by default)
  if (shown) w.setWindowButtonPosition(at)
}
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
ipcMain.handle("window:raise", (e, popout: unknown, focus: unknown) => {
  const w = who(e), pages = w ? [w.win.webContents, ...[...popouts].filter(([, of]) => of === w).map(([wc]) => wc)] : []
  return import("./raise.ts").then((m) => m.raise(pages, popout, focus === true))
})
ipcMain.handle("window:translucent", (e, on: unknown) => {
  who(e)
  const w = AppWindow.fromWebContents(e.sender)
  return w ? setTranslucent(w, on === true) : { on: false }
})
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
ipcMain.handle("page:capture", async (e, rect?: { x: number; y: number; width: number; height: number }) => {
  who(e)
  const r = rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width >= 1 && rect.height >= 1
    ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : undefined
  let img = await e.sender.capturePage(r)
  while (img.toPNG().length > 20 << 20 && img.getSize().width > 200) img = img.resize({ width: Math.round(img.getSize().width / 2) })
  return { png: img.toPNG().toString("base64"), ...img.getSize() }
})

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
handle("apps:reopen", (w) => {
  if (!w) throw new Error("no vault here")
  const p = w.vault.path, server = w.server
  w.ending = true
  const gone = new Promise<void>((ok) => { if (!server || server.exitCode !== null || server.signalCode) ok(); else server.once("exit", () => ok()) })
  w.win.once("closed", () => void gone.then(() => openVault(p)).catch((e) => console.error(e)))
  w.win.close()
})
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

initUpdates({
  windows: () => [...wins.values()],
  popouts: () => popouts,
  othersOpen: () => remoteWins.size > 0,
  mode: () => updates,
  busy: () => engineBusy(),
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

if (!app.isPackaged && QUIET) process.on("SIGUSR2", () => { handOver(); quitting = true; app.relaunch(relaunchOptions()); app.quit() })

let dev: typeof import("./devroot.ts") | null = null
async function startWorktree() {
  dev = await import("./devroot.ts")
  await dev.startDev({
    root: WORKTREE!, userData: app.getPath("userData"), headless: QUIET, debugPort: devtools ?? null, shellPrint: HOST?.shell.fingerprint,
    info: worktreeNow,
    changed: (what) => { worktreeChanged(what); if (QUIET) restartToUpdate() },
    restartServers: () => { for (const w of wins.values()) if (w.server?.exitCode === null) { w.restarting = true; w.server.kill() } },
    say: (text) => { for (const w of wins.values()) if (w.ready) w.win.webContents.send("vaultite", { type: "update-status", text, done: true }) },
  })
}

// Sites save their sign-ins as their pages unload.
let unloaded = false
const unloadOnce = () => (unloaded ? Promise.resolve()
  : Promise.race([unloadPages(), new Promise((done) => setTimeout(done, 5000))]).finally(() => { unloaded = true }))

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
const ZOOM_STEPS: Record<string, -1 | 0 | 1> = { "zoom:in": 1, "zoom:out": -1, "zoom:reset": 0, "interface-size:increase": 1, "interface-size:decrease": -1, "interface-size:reset": 0 }

async function openDoc(name: string) {
  const file = path.join(ROOT, name)
  if (!fs.existsSync(file)) return
  const w = focusedVault()
  if (!w) return void openFiles([file], null)
  for (const f of await openFiles([file], w)) send(w, f)
  w.win.focus()
}

const issues = (() => {
  let repo = CODE?.repo ?? ""
  if (!repo) try { repo = execFileSync("git", ["-C", ROOT, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: gitEnv() }).trim() } catch {}
  const m = /github\.com[/:]([^/]+\/[^/]+?)(\.git)?$/.exec(repo)
  return m ? `https://github.com/${m[1]}/issues` : null
})()

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
  top?.menu?.on("menu-will-show", () => { top.checked = !!BaseWindow.getFocusedWindow()?.isAlwaysOnTop() })
  Menu.setApplicationMenu(menu)
}
AppWindow.each((w) => w.on("focus", () => buildMenu()))
if (WIN) AppWindow.each((w) => {
  let alone = false
  w.webContents.on("before-input-event", (_e, i) => {
    if (i.key !== "Alt") alone = false
    else if (i.type === "keyDown" && !i.isAutoRepeat) alone = true
    else if (i.type === "keyUp" && alone) { alone = false; Menu.getApplicationMenu()?.popup({ window: w, x: 8, y: CONTROLS_HEIGHT }) }
  })
  w.webContents.on("input-event", (_e, i) => { if (i.type === "mouseDown") alone = false })
})

// Ubuntu 24.04+'s AppArmor keeps an AppImage from Chromium's sandbox: its AppRun adds --no-sandbox.
function unsandboxedNotice() {
  const seen = path.join(app.getPath("userData"), "unsandboxed-notice")
  if (!process.env.APPIMAGE || !app.commandLine.hasSwitch("no-sandbox") || fs.existsSync(seen)) return
  try { fs.writeFileSync(seen, new Date().toISOString() + "\n") } catch {}
  const profile = `abi <abi/4.0>,\ninclude <tunables/global>\n\nprofile vaultite-appimage /tmp/.mount_Vault*/vaultite flags=(unconfined) {\n  userns,\n}\n`
  const command = `printf '${profile.replace(/\n/g, "\\n")}' | sudo tee /etc/apparmor.d/vaultite-appimage >/dev/null && sudo apparmor_parser -r /etc/apparmor.d/vaultite-appimage`
  void dialog.showMessageBox({ type: "warning", message: "Vaultite is running without its sandbox",
    detail: "This system's AppArmor keeps AppImages from Chromium's sandbox, so Vaultite started without it. Install the .deb " +
      "instead (it sets this up), or allow it for Vaultite's AppImage with one command in a terminal, then open Vaultite again.",
    buttons: ["Copy the command", "OK"], defaultId: 1, cancelId: 1 }).then((r) => { if (r.response === 0) clipboard.writeText(command) })
}

const asked = () => vaultArg(process.argv)
async function madeIfAsked(p: string) {
  if (fs.existsSync(p)) return true
  const r = await dialog.showMessageBox({ type: "question", message: `There's no folder ${p}`, detail: "Create a new vault there?",
    buttons: ["Create vault", "Cancel"], defaultId: 0, cancelId: 1 })
  if (r.response !== 0) return false
  fs.mkdirSync(p, { recursive: true })
  return true
}
const reopening = () => { const a = asked(); return a ? [a] : known.filter((v) => v.open).map((v) => v.path) }

// Linux's Open with passes file:// URLs (the desktop file's %U), Windows' a path; a Mac sends open-file instead.
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

// Windows and Linux hand the app a vaultite:// link on its command line; a Mac sends open-url.
const argLinks = (argv: string[]) => argv.slice(1).filter((a) => /^vaultite:/i.test(a))

// Finder's Open with (and a drop on the Dock icon) can come before the app is ready.
const early: string[] = MAC ? [] : argFiles(process.argv, process.cwd())
let started = false
app.on("open-file", (e, p) => {
  e.preventDefault()
  if (started) openFiles([p], null).catch(() => {})
  else early.push(p)
})

const earlyLinks: string[] = MAC ? [] : argLinks(process.argv)
app.on("open-url", (e, url) => {
  e.preventDefault()
  if (started) void appLink(url).catch(() => {})
  else earlyLinks.push(url)
})
async function appLink(url: string) {
  let u: URL
  try { u = new URL(url) } catch { return }
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
    const abs = inVault(w.vault.path, rest)
    if (!abs) return
    if (!path.extname(rest) && fs.existsSync(`${abs}.md`)) rest += ".md"
    if (!fs.existsSync(path.join(w.vault.path, rest))) return
    send(w, rest)
  } else {
    const to = w
    const msg = what === "bundle" ? { type: "link", bundle: rest } : { type: "link", id: rest }
    const go = (n = 0) => { if (to.win.isDestroyed()) return; if (to.ready) to.win.webContents.send("vaultite", msg); else if (n < 150) setTimeout(() => go(n + 1), 200) }
    go()
  }
  if (w.win.isMinimized()) w.win.restore()
  w.win.focus()
}

let refreshed: Promise<unknown> = Promise.resolve()
if (!app.requestSingleInstanceLock()) app.quit()
else {
  const start = (p: string) => {
    const v = find(p)
    if (v && !attachable(p) && fs.statSync(p, { throwIfNoEntry: false })?.isDirectory()) serverFor(v).catch(() => {})
  }
  for (const p of reopening()) {
    if (p !== sandboxPath()) { start(p); continue }
    refreshed = refreshSandbox(p).then((made) => { const v = find(p); if (made && v) delete v.port }, (e) => console.error(e)).then(() => start(p))
  }
}
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
let launched = false
app.on("window-all-closed", () => {
  if (!MAC && launched) app.quit()
})
app.on("activate", () => { if (!wins.size && !manager && !setupWin && !remoteWins.size) openHome() })

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
      try { plist = fs.readFileSync(path.join(there, "Contents", "Info.plist"), "utf8") } catch {}
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

app.on("web-contents-created", (_e, wc) => {
  wc.setWindowOpenHandler(() => ({ action: "deny" }))
  wc.on("will-attach-webview", (e) => e.preventDefault())
})

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
  const go = !a || await madeIfAsked(a)
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
  if (!MAC && !AppWindow.getAllWindows().length) showManager()
  if (LINUX) unsandboxedNotice()
  scheduleUpdates()
})
