// Vaultite as a Mac app (Electron): each vault a window with its server (its own, or one here: host.ts); see CLAUDE.md.
// Env: VAULTITE_USER_DATA, _DEBUG_PORT, _LOCAL, _QUIET, _UPDATE_URL, _SETUP_HOME (tests); `--vault <path>` opens one.
import { app, autoUpdater, type BaseWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, shell, systemPreferences, type IpcMainInvokeEvent, type Rectangle, type WebContents, type WebPreferences } from "electron"
import { AppWindow } from "./appwindow.ts"
import { execFile, execFileSync, fork, spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { menuTemplate, type MenuSnapshot } from "./menu.ts"
import { revive, webHandlers, webWindow } from "./web.ts"
import "./browser/index.ts"
import { engineBusy, serverCall, setServerSink } from "./browser/engine.ts"
import { attach, attachable, servedHere, type Call, type Link } from "./host.ts"
import { appHandlers, appsOn, appsWindow, stopApps } from "./apps.ts"
import { openSandbox, refreshSandbox, sandboxPath } from "./sandbox.ts"
import { macPermissions, permissionAct } from "./permissions.ts"
import { parseRepo, repoText } from "../core/bundlelinks.ts"
import { plainError, sentence } from "../core/plainerror.ts"
import { RUNS_CODE } from "../core/filetypes.ts"
import * as Setup from "./setup.ts"
import type { AppUpdater } from "electron-updater"

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PRELOAD = path.join(ROOT, "electron", "preload.cjs")
const DIST = path.join(ROOT, "web", "dist")
const ICON = path.join(ROOT, "web", "public", "icon-512.png")
const MAC = process.platform === "darwin"
// Where a Mac window's traffic lights sit (points from its top-left corner) until its page places them
// (window:lights): web/src/index.css lays the sidebar's top row out around them.
const LIGHTS = { x: 16, y: 14 }
// Their height (points), to centre them on a row: each button's frame on macOS 15 (a 12pt circle in 14×16).
const LIGHTS_HEIGHT = 16
const LINUX = process.platform === "linux"

// A build named otherwise (electron-builder's extraMetadata.productName: a test release) keeps a userData of its own.
app.setName(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).productName ?? "Vaultite")
if (process.env.VAULTITE_USER_DATA) app.setPath("userData", path.resolve(process.env.VAULTITE_USER_DATA))
// Under --no-sandbox (an AppImage under AppArmor, Playwright on Linux) renderers no window makes (extensions' workers) keep
// Electron's sandboxed renderer, the one that runs service-worker preloads (app.enableSandbox() would drop --no-sandbox).
if (app.commandLine.hasSwitch("no-sandbox")) app.commandLine.appendSwitch("enable-sandbox")
// VAULTITE_QUIET=1 (web/qa's desktop scripts): windows draw as usual but are never seen or felt (transparent,
// click-through, never focused, no Dock icon), so a test never pops up over the user's work.
if (process.env.VAULTITE_QUIET) {
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows")
  app.commandLine.appendSwitch("disable-renderer-backgrounding")
  const quiet = (w: BaseWindow, page: WebContents) => {
    w.setOpacity(LINUX ? 0.01 : 0) // (X11 stops painting a window at 0: screenshots of it then never come)
    w.setIgnoreMouseEvents(true)
    w.show = () => w.showInactive()
    w.focus = () => {}
    page.setBackgroundThrottling(false)
  }
  app.on("browser-window-created", (_e, w) => quiet(w, w.webContents))
  AppWindow.each((w) => quiet(w, w.webContents))
  app.focus = () => {}
  void app.whenReady().then(() => app.dock?.hide())
}
// A copy a script drives (VAULTITE_QUIET, or Playwright's launch, always with a debugging port; the app's own is added
// below) plays nothing aloud, AirPods included: a test's YouTube page would. VAULTITE_SOUND=1 for a test that needs it.
if ((process.env.VAULTITE_QUIET || app.commandLine.hasSwitch("remote-debugging-port")) && !process.env.VAULTITE_SOUND) app.commandLine.appendSwitch("mute-audio")
// A Mac takes a window's icon from the bundle; on Linux each window carries it (the taskbar, Alt+Tab), else Electron's.
if (LINUX) { app.on("browser-window-created", (_e, w) => w.setIcon(ICON)); AppWindow.each((w) => w.setIcon(ICON)) }
// VAULTITE_BEHIND=1 (npm run app:dev): the windows opened at launch wait to be shown until the user switches to the app,
// rather than popping up over their work.
let behind = !!process.env.VAULTITE_BEHIND
// What macOS runs rather than shows when opened (an app, a script, a link to one): a vault file of these, which a
// synced or shared vault may bring, is shown in Finder instead of opened.
function openVaultFile(abs: string) {
  let runs = RUNS_CODE.test(abs)
  try { const st = fs.statSync(abs); runs ||= st.isDirectory() || (st.mode & 0o111) !== 0 } catch { return }
  if (runs) shell.showItemInFolder(abs); else void shell.openPath(abs)
}
/** A link the app's page hands to the system, as Obsidian does: any app's scheme (obsidian://, zotero://, tel:), never
 *  one that runs code; a file:// one as a vault file opens (with the Mac's app for it, an app or a folder shown in Finder). */
function openLink(url: string) {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url) || /^(javascript|data|vbscript|blob|about|chrome|devtools):/i.test(url)) return
  if (/^file:/i.test(url)) {
    try { openVaultFile(fileURLToPath(url)) } catch { /* not a file address */ }
    return
  }
  shell.openExternal(url).catch((e) => console.error(`couldn't open ${url.split(":")[0]}: link`, e))
}
// An uncaught exception or rejection here goes to the open vaults' Errors, never Electron's error box, which stops
// everything and shows even over the QA scripts' quiet windows.
function uncaught(kind: "uncaught" | "rejection", e: unknown) {
  const err = e instanceof Error ? e : new Error(String(e))
  console.error(`main process, ${kind}:`, err)
  try {
    const body = JSON.stringify({ device: "desktop", errors: [{ kind, t: Date.now(), message: `Main process: ${err.message}`, stack: err.stack ?? "", build: BUILD?.commit ?? "" }] })
    for (const w of wins.values()) void fetch(`http://127.0.0.1:${w.port}/api/errors`, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {})
  } catch { /* before the windows exist */ }
}
const told = new WeakSet<object>()
/** A failure told in a box: what happened in plain words (core/plainerror.ts), `why` when the error has none to give;
 *  the exact text behind Copy details, and a log when there is one. */
function failedBox(title: string, e: unknown, o: { win?: AppWindow; why?: string; log?: string } = {}) {
  // (once: openVault tells its own and rethrows to its caller)
  if (typeof e === "object" && e) { if (told.has(e)) return; told.add(e) }
  const { reason, detail } = plainError(e)
  const box = { type: "warning" as const, message: title, detail: reason ? sentence(reason) : o.why ?? "Something went wrong.",
    buttons: ["OK", "Copy details", ...(o.log ? ["Show log"] : [])], defaultId: 0, cancelId: 0 }
  console.error(`vaultite: ${title}:`, detail)
  void (o.win && !o.win.isDestroyed() ? dialog.showMessageBox(o.win, box) : dialog.showMessageBox(box)).then((r) => {
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
/** The windows' zoom (View > Zoom in/out, ⌘+ ⌘- ⌘0: the whole app; notes and terminals have text sizes of their own, web/src/core/textsize.ts), kept for the next launch. One for
 *  every window: Chromium zooms by host, and every vault's server is on 127.0.0.1. */
let zoom = 1
/** Chromium's DevTools protocol on 127.0.0.1:<port> for agents (VAULTITE_DEBUG_PORT, else vaults.json's `debugPort`).
 *  Off unless set: any process on this Mac that reaches the port controls the app. */
let debugPort: number | undefined
/** How this Mac takes updates: "automatic" restarts into one once every window says nothing would be lost, "notify"
 *  (the default) gets it ready and offers Restart to update, "off" checks only when asked (the menu). */
type UpdateMode = "automatic" | "notify" | "off"
const UPDATE_MODES: UpdateMode[] = ["automatic", "notify", "off"]
let updates: UpdateMode = "notify"
try {
  const v = JSON.parse(fs.readFileSync(LIST(), "utf8"))
  known = Array.isArray(v.vaults) ? v.vaults.filter((x: Known) => x && typeof x.path === "string") : []
  remotes = Array.isArray(v.servers) ? v.servers.filter((x: Remote) => x && typeof x.url === "string" && /^https?:\/\//.test(x.url)) : []
  if (typeof v.zoom === "number" && v.zoom >= ZOOMS[0] && v.zoom <= ZOOMS[ZOOMS.length - 1]) zoom = v.zoom
  if (Number.isInteger(v.debugPort) && v.debugPort > 1024 && v.debugPort < 65536) debugPort = v.debugPort
  if (UPDATE_MODES.includes(v.updates)) updates = v.updates
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
      ...(updates === "notify" ? {} : { updates }) }, null, 2) + "\n")
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
  /** What its page last told the menu bar (`menu:sync`): its commands, pins and recent files. */
  menu?: MenuSnapshot }
const wins = new Map<string, Win>() // vault path -> its window
/** Pop-out windows (a tab moved out of a vault's window: the page opens `/?popout=<id>`), by their
 *  page, with the vault window they came from: its server, its IPC. */
const popouts = new Map<WebContents, Win>()

/** Servers on their way up or running, by vault path: each vault's is started once. */
const booting = new Map<string, Promise<[ChildProcess, number]>>()
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

/** Its server's calls to the browser engine (core/desktopapp.ts asks, electron/browser/engine.ts answers), and macOS's
 *  permissions (app.permissions: core/coreops/permissions.ts). */
const answerCall = (v: Known, m: Call) => Promise.resolve().then(() => m.name === "app:permissions" ? (MAC ? macPermissions() : null)
  : serverCall(wins.get(v.path)?.win, m.name, Array.isArray(m.args) ? m.args : []))

/** Push an event to a vault's server unasked (core/desktopapp.ts onDesktopEvent): the one way the main process does. */
function desktopEvent(w: Win, name: string, data: unknown) {
  const m = { type: "desktop:event", name, data }
  if (w.server?.connected) w.server.send(m); else w.link?.send(m)
}
setServerSink((win, name, data) => { for (const w of wins.values()) if (w.win === win) desktopEvent(w, name, data) })

function startServer(v: Known, port: number): Promise<ChildProcess> {
  const logDir = app.getPath("logs")
  fs.mkdirSync(logDir, { recursive: true })
  const log = fs.createWriteStream(serverLog(v.path), { flags: "a" })
  const child = fork(path.join(ROOT, "server.ts"), [], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env, ELECTRON_RUN_AS_NODE: "1", VAULTITE_DESKTOP: "1", VAULTITE_VAULT: v.path, VAULTITE_LOCAL: LOCAL,
      HOST: "127.0.0.1", PORT: String(port),
      // (for its startup's span, core/spans.ts)
      VAULTITE_LAUNCHED_AT: String(Math.round(Date.now() - process.uptime() * 1000)), VAULTITE_FORKED_AT: String(Date.now()),
    },
  })
  child.stderr!.pipe(log)
  child.on("message", (m: Call) => {
    if (m?.type !== "desktop:call" || typeof m.rid !== "number") return
    const reply = (r: { value?: unknown; error?: string }) => { if (child.connected) child.send({ type: "desktop:reply", rid: m.rid, ...r }) }
    answerCall(v, m).then((value) => reply({ value }), (e) => reply({ error: e instanceof Error ? e.message : String(e) }))
  })
  return new Promise((ok, fail) => {
    let out = ""
    const timer = setTimeout(() => fail(new Error(`the server didn't start in time\n${out.slice(-2000)}`)), 120_000)
    child.stdout!.on("data", (b: Buffer) => {
      log.write(b)
      if (out.length < 100_000) out += b.toString()
      if (/vaultite on http/.test(out)) { clearTimeout(timer); ok(child) }
    })
    child.stderr!.on("data", (b: Buffer) => { if (out.length < 100_000) out += b.toString() })
    child.once("exit", (code) => {
      clearTimeout(timer)
      fail(/EADDRINUSE/.test(out) ? new PortTaken(`port ${port} is taken`) : new Error(`the server stopped (exit ${code})\n${out.slice(-2000)}`))
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
  const v = remember(p)
  // (served here already, by its service: the window attaches to that server)
  const there = await servedHere(p).catch((e) => { failedBox(`Couldn't open ${nameOf(p)}`, e, { why: "Its server didn't start." }); throw e })
  const starting = there ? null : serverFor(v)
  // The window (and its renderer process) is made while the server starts; its page loads once the server listens.
  const b = v.bounds
  const apps = appsOn(p)
  const win = new AppWindow({
    width: b?.width ?? 1280, height: b?.height ?? 820, x: b?.x, y: b?.y, minWidth: 800, minHeight: 480, show: false,
    title: nameOf(p), titleBarStyle: "hiddenInset", trafficLightPosition: LIGHTS,
    // (a click in a window that's behind acts too, as in a browser: a web page's field it lands on gets the keyboard,
    // not whatever had it in the app before)
    acceptFirstMouse: true,
    // (App windows on: transparent, the page paints itself and leaves app tabs see-through, electron/apps.ts)
    ...(apps ? { transparent: true, backgroundColor: "#00000000" } : { backgroundColor: background() }),
    // bypassHeatCheck: V8 caches the app's compiled scripts on the first launch, not the third (like VS Code).
    webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true, spellcheck: true, v8CacheOptions: "bypassHeatCheck" },
  })
  // (not shown where they sit by default while the page that hides them loads)
  if (MAC && v.lightsOff) setLights(win, null)
  let server: ChildProcess | null = null, link: Link | null = null, port: number, loadFailed = false
  const outside = () => (v.outside?.length ? [{ type: "allow", paths: v.outside }] : [])
  try {
    if (there) {
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
  win.on("closed", () => {
    wins.delete(p)
    booting.delete(p)
    w.server?.kill()
    w.link?.stop()
    buildMenu()
  })
  // The server ends on its own only on failure: soon after start, a vault it can't open (say why, close the window);
  // later, a crash: a new one on the same port, which the page reconnects to (errors.ts), three times a minute at most.
  let said = "", since = Date.now(), restarts: number[] = []
  const watchServer = (child: ChildProcess) => {
    child.stderr!.on("data", (b: Buffer) => { said = (said + b.toString()).slice(-2000) })
    child.on("exit", (code) => {
      if (win.isDestroyed() || quitting || child !== w.server) return
      const now = Date.now()
      restarts = restarts.filter((t) => now - t < 60_000)
      const fail = (why: string) => {
        if (win.isDestroyed()) return
        const starting = now - since < 10_000 && !restarts.length
        failedBox(`Couldn't ${starting ? "open" : "keep running"} ${nameOf(p)}`, new Error(why),
          { why: starting ? "Its server stopped as it started." : "Its server stopped three times in a minute.", log: serverLog(p) })
        win.close()
      }
      if (now - since < 10_000 || restarts.length >= 3) return fail(`the server stopped (exit ${code})\n${said}`)
      restarts.push(now)
      console.error(`vaultite: ${nameOf(p)}'s server stopped (exit ${code}), starting it again`)
      // (its own port, never another: the page's localStorage is kept by it)
      const at = w.port, started = startServer(v, at)
      const up = started.then((c): [ChildProcess, number] => [c, at])
      up.catch(() => {}) // (said below)
      booting.set(p, up)
      started.then((next) => {
        if (win.isDestroyed()) return void next.kill()
        w.server = next
        since = Date.now()
        said = ""
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
  if (apps) appsWindow(win)
  await win.loadURL(`http://127.0.0.1:${port}/`)
  if (manager && !manager.isDestroyed()) manager.close() // opening a vault closes the manager
  buildMenu()
  return w
}

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
  // A pop-out: the page window.open made, in a window of ours (its pages go over it as in the vault's), closed with it.
  const popOut = (w: Win, page: WebContents, webPreferences?: WebPreferences) => {
    const child = new AppWindow({ width: 960, height: 760, minWidth: 480, minHeight: 360, title: win.getTitle(), titleBarStyle: "hiddenInset",
      trafficLightPosition: LIGHTS, backgroundColor: background(), acceptFirstMouse: true, webPreferences }, page)
    popouts.set(page, w)
    const closeIt = () => { if (!child.isDestroyed()) child.close() }
    win.once("closed", closeIt)
    child.on("closed", () => { popouts.delete(page); if (!win.isDestroyed()) win.off("closed", closeIt) })
    page.on("did-finish-load", () => page.setZoomFactor(zoom))
    revive(page, undefined, crashedFor(child, nameOf(w.vault.path)))
    hangs(child, nameOf(w.vault.path))
    guard(child, origin)
    webWindow(child)
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
    openLink(url)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${origin}/?popout=`)) {
      const w = [...wins.values()].find((x) => x.win === win) ?? popouts.get(win.webContents)
      if (!w) return { action: "deny" }
      return { action: "allow", overrideBrowserWindowOptions: { webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true, spellcheck: true } },
        createWindow: (o) => popOut(w, (o as { webContents: WebContents }).webContents, o.webPreferences) } // (Electron puts the new page in its options)
    }
    if (url.startsWith(origin + "/api/raw?")) { // a vault file that isn't text (an image, a PDF): the Mac's app for it
      const w = [...wins.values()].find((x) => x.win === win)
      const rel = new URL(url).searchParams.get("path")
      if (w && rel && !rel.split("/").includes("..")) openVaultFile(path.join(w.vault.path, rel))
    } else openLink(url)
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
    titleBarStyle: "hiddenInset", trafficLightPosition: LIGHTS, backgroundColor: background(),
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
/** What Set up Vaultite has done (userData/setup.json): `done` once finished. */
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
    home, exe: process.execPath, root: ROOT, userData: app.getPath("userData"),
    env: process.env.VAULTITE_USER_DATA ? { VAULTITE_USER_DATA: app.getPath("userData") } : {},
  }
}
/** The user's PATH, asked of their shell once (it takes a moment). */
let dirs: string[] | null = null
const pathDirs = () => (dirs ??= process.env.VAULTITE_SETUP_HOME ? [] : Setup.shellPath(where()))

function showSetup() {
  if (setupWin && !setupWin.isDestroyed()) return setupWin.focus()
  setupWin = new AppWindow({
    // (useContentSize: a Linux window frame is outside it, so the page gets its 560×600 as on a Mac)
    width: 560, height: 600, useContentSize: true, resizable: false, maximizable: false, fullscreenable: false, show: false, title: "Set up Vaultite",
    titleBarStyle: "hiddenInset", trafficLightPosition: LIGHTS, backgroundColor: background(),
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
  return { places: Setup.places(w), obsidian: Setup.obsidianVaults(w), vau: Setup.vauStatus(w, pathDirs()) }
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
  const port = (await servedHere(p))?.port ?? (await serverFor(remember(p)))[1]
  // Starter content only when the user asked for it (core/start.ts): opening a folder writes nothing outside .vaultite/.
  if (c.kind === "new" && c.starter) {
    const r = await fetch(`http://127.0.0.1:${port}/api/ops/vault.starter`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/desktop" }, body: "{}" })
    if (!r.ok) console.error("starter content:", r.status, await r.text())
  }
  return chosen
})
setupHandle("setup:vau", async (system: boolean) => {
  const r = Setup.installVau(where())
  if (system) await Setup.linkSystem(r.path)
  return { did: system ? `Linked /usr/local/bin/vau to ${r.path}` : r.did, vau: Setup.vauStatus(where(), pathDirs()) }
})
// (the playground's window first: closing the last window quits off a Mac, and an AppWindow closes at once)
setupHandle("setup:sandbox", async () => {
  await sandbox()
  setupWin?.close()
})
/** Done: open the vault chosen (a new one on its Start here note), and never show this window by itself again. */
setupHandle("setup:finish", async () => {
  saveSetup({ done: new Date().toISOString() })
  const c = chosen
  chosen = null // (kept: the window opening now takes its server)
  if (c) {
    const w = await openVault(c.path)
    if (c.made && fs.existsSync(path.join(c.path, START_HERE))) send(w, START_HERE)
  } else showManager()
  setupWin?.close()
})

const focusedVault = () => {
  const f = AppWindow.getFocusedWindow()
  return [...wins.values()].find((w) => w.win === f) ?? [...wins.values()].sort((a, b) => (b.vault.last ?? 0) - (a.vault.last ?? 0))[0] ?? null
}

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
    allowIn(w, p)
    if (w === into) mine.push(p)
    else { send(w, p); w.win.focus() }
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
/** A list's text items (anything else left out, never the whole list refused). */
const strings = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [])

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
handle("app:setup", () => showSetup())
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
  setTimeout(() => { tellStatus(w); if (ready) tell(w) }, 0)
  return w.queue.splice(0)
})
handle("app:update-restart", () => restartToUpdate())
handle("app:updates", () => ({ mode: updates, available: updatable() }))
handle("app:updates-set", (_w, mode: UpdateMode) => {
  if (!UPDATE_MODES.includes(mode) || mode === updates) return
  updates = mode
  save()
  for (const w of wins.values()) tell(w)
  if (mode !== "off" && !ready) checkForUpdate(false)
})
ipcMain.handle("app:update-safe", (e, safe: boolean) => {
  if (!who(e)) return
  if (safe === true) safeNow.add(e.sender); else safeNow.delete(e.sender)
  restartIfSafe()
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
// Settings > Permissions' buttons (electron/permissions.ts): macOS's prompt, a folder read, or its System Settings pane.
handle("app:permission", (_w, id: string) => { if (MAC) return permissionAct(str(id)) })
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
  if (at) w.setWindowButtonPosition(at)
  w.setWindowButtonVisibility(!!at)
  // (shown again, the Mac lays them out where they sit by default: placed once more)
  if (at) w.setWindowButtonPosition(at)
}
// The traffic lights in the page's sidebar's top row (`at`, CSS px: `x` right of LIGHTS, centred on the line `mid`
// down), hidden while it is (no rails). An older page sends a boolean: they stay put.
ipcMain.handle("window:lights", (e, at: boolean | { x: number; mid: number } | null) => {
  who(e)
  const w = AppWindow.fromWebContents(e.sender)
  if (!MAC || !w) return
  if (at && typeof at === "object" && Number.isFinite(at.x) && Number.isFinite(at.mid)) {
    const z = e.sender.getZoomFactor()
    setLights(w, { x: Math.round(LIGHTS.x + at.x * z), y: Math.round(at.mid * z - LIGHTS_HEIGHT / 2) })
  } else if (at) w.setWindowButtonVisibility(true)
  else setLights(w, null)
  const v = [...wins.values()].find((x) => x.win === w)?.vault
  if (v && !!v.lightsOff !== !at) { if (at) delete v.lightsOff; else v.lightsOff = true; save() }
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
  const gone = new Promise<void>((ok) => { if (!server || server.exitCode !== null || server.signalCode) ok(); else server.once("exit", () => ok()) })
  w.win.once("closed", () => void gone.then(() => openVault(p)).catch((e) => console.error(e)))
  w.win.close()
})
// (the window asking, a pop-out's own: its pages and apps' windows go over its tabs, not its vault window's)
for (const [name, fn] of Object.entries({ ...webHandlers, ...appHandlers })) {
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
/** Which commit of which repo this app was built from (electron/stamp.ts, part of npm run app:build). */
const BUILD = (() => {
  try {
    const b = JSON.parse(fs.readFileSync(path.join(ROOT, "electron", "build.json"), "utf8"))
    return typeof b.commit === "string" && typeof b.repo === "string" ? b as { commit: string; repo: string; release?: boolean; channel?: "dev" | "nightly" | "main"; branch?: string } : null
  } catch {
    return null
  }
})()
const updatable = () => app.isPackaged && !!BUILD
/** A release build updates from the release feed (electron-updater), not by building from git. */
const RELEASE = app.isPackaged && BUILD?.release === true
/** Vaultite Dev (see the head of this file); the branch it updates from. */
const DEV = BUILD?.channel === "dev"
const BRANCH = (DEV && BUILD?.branch) || "main"
/** The clone update.sh builds in, and the finished build it leaves next to it (Vaultite Main.app, and its commit). */
const SOURCE = () => path.join(app.getPath("userData"), "source")
const NEXT = () => path.join(app.getPath("userData"), "update")
/** This app's bundle (…/Vaultite Main.app), which an update replaces; on Linux its folder (npm run app:install's). */
const BUNDLE = MAC ? path.resolve(app.getPath("exe"), "..", "..", "..") : path.dirname(app.getPath("exe"))
/** What update.sh build leaves in NEXT: the .app, or (Linux) the unpacked app's folder. */
const BUILT = () => path.join(NEXT(), MAC ? `${app.getName()}.app` : app.getName())
/** update.sh runs in a login shell, so git, node and npm are on the PATH as in the user's terminal. */
const SHELL = MAC ? "/bin/zsh" : "/bin/bash"
/** An update can replace this app where it is: a .app, or an unpacked Linux app (not an AppImage, read-only). */
const replaceable = () => MAC ? BUNDLE.endsWith(".app") : !process.env.APPIMAGE && fs.existsSync(app.getPath("exe"))
/** update.sh build while it runs (its own process group, so quitting ends npm and the rest with it). */
let checking: ChildProcess | null = null
/** The commit of a finished build waiting for a restart (a release's: its version). */
let ready: string | null = null
/** What the update is doing now, shown in the windows as a toast that stays (null: nothing). */
let status: string | null = null
/** Written as the app quits to update (what it updates to), read and removed by the first window after the restart. */
const UPDATED = () => path.join(app.getPath("userData"), "updated")

function updateLog() {
  const dir = app.getPath("logs")
  fs.mkdirSync(dir, { recursive: true })
  return fs.openSync(path.join(dir, "update.log"), "a")
}

/** Build the newest main if this app doesn't run it. By hand (the menu), say how it went; on the timer, only a toast
 *  when there's a new build. */
function checkForUpdate(byHand: boolean) {
  if (!byHand && updates === "off") return
  if (RELEASE) return void checkRelease(byHand)
  if (!updatable() || checking || looking) return
  looking = true
  void attachedCommit().then((want) => { looking = false; buildUpdate(byHand, want) })
}
let looking = false

/** The commit the servers its windows attached to run, when every open window is attached: the app updates to that
 *  rather than the branch's newest, so the two are one version. "" otherwise. */
async function attachedCommit() {
  const all = [...wins.values()]
  if (!all.length || all.some((w) => !w.link)) return ""
  const ran = await Promise.all(all.map((w) => fetch(`http://127.0.0.1:${w.port}/api/ops/app.version`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: "{}", signal: AbortSignal.timeout(5000) }).then((r) => r.json()).then((j: { result?: { commit?: unknown } }) => String(j.result?.commit ?? ""), () => "")))
  return ran.every((c) => /^[0-9a-f]{40}$/.test(c) && c === ran[0]) ? ran[0] : ""
}

function buildUpdate(byHand: boolean, want: string) {
  const log = updateLog()
  fs.writeSync(log, `\n${new Date().toISOString()} checking (running ${BUILD!.commit.slice(0, 7)}${want ? `, its server ${want.slice(0, 7)}` : ""})\n`)
  let out = ""
  if (byHand) setStatus("Checking for updates…")
  // On the timer it builds at a low priority: its minutes of compiling never compete with what the user is doing.
  const low = byHand ? [] : process.platform === "darwin" ? ["/usr/sbin/taskpolicy", "-c", "utility"] : ["nice", "-n", "10"]
  const [cmd, ...args] = [...low, SHELL, "-l", path.join(ROOT, "electron", "update.sh"), "build", SOURCE(), BUILD!.repo, BUILD!.commit,
    BRANCH, DEV ? "app:build:dev" : "app:build", ...(want ? [want] : [])]
  const child = checking = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], detached: true })
  buildMenu()
  const take = (b: Buffer) => {
    fs.writeSync(log, b)
    out = (out + b.toString()).slice(-4000)
    const building = /^@building (\w+)$/m.exec(b.toString())
    if (building) setStatus(`Updating ${app.getName()} to ${building[1].slice(0, 7)}…`)
  }
  child.stdout!.on("data", take)
  child.stderr!.on("data", take)
  // (a fetch or npm ci that stalls is stopped: else no check would run again, and the menu stayed on Checking)
  const stall = setTimeout(() => { fs.writeSync(log, "stopped: still going after 45 minutes\n"); stopChecking() }, 45 * 60_000)
  child.on("close", (code) => {
    clearTimeout(stall)
    fs.writeSync(log, `exit ${code}\n`)
    fs.closeSync(log)
    checking = null
    setStatus(null)
    const commit = out.trim().split("\n").pop()?.trim() ?? ""
    if (code === 0 && commit === built()) {
      if (ready !== commit || byHand) { ready = commit; for (const w of wins.values()) tell(w) }
    } else if (byHand && code === 3) {
      dialog.showMessageBox({ message: `${app.getName()} is up to date`, detail: `It runs ${BUILD!.commit.slice(0, 7)}, ${want ? "the version its server runs" : `the newest on ${BRANCH}`}.` })
    } else if (byHand && !quitting) {
      updateFailed(/^boot: \d+ failed/m.test(out) ? "The new version didn't pass its startup check."
        : /not building an update signed ad hoc/.test(out) ? "The new version couldn't be signed: the keychain may be locked. The next check tries again."
        : "The new version didn't build.")
    }
    if (ready !== built()) ready = null
    buildMenu()
  })
}

/** Asked by hand, an update that failed: what went wrong in a line, the details in update.log. */
function updateFailed(why: string) {
  void dialog.showMessageBox({ type: "warning", message: `Couldn't update ${app.getName()}`, buttons: ["OK", "Show log"],
    detail: `${why} ${app.getName()} keeps this version and tries again later.` })
    .then((r) => { if (r.response === 1) void shell.openPath(path.join(app.getPath("logs"), "update.log")) })
}

/** The commit of the finished build in NEXT, when it's all there. */
function built() {
  try {
    return fs.existsSync(BUILT()) ? fs.readFileSync(path.join(NEXT(), "commit"), "utf8").trim() : null
  } catch {
    return null
  }
}

/** Offer the update in a window (a toast with Restart); automatic, the window says when it's safe to restart. */
function tell(w: Win) {
  if (!w.ready || !ready) return
  const msg = { type: "update", version: RELEASE ? ready : ready.slice(0, 7), auto: updates === "automatic" }
  w.win.webContents.send("vaultite", msg)
  for (const [wc, of] of popouts) if (of === w && !wc.isDestroyed()) wc.send("vaultite", msg)
}

/** The pages that said a restart would lose nothing now (`app:update-safe`). */
const safeNow = new WeakSet<WebContents>()
let idleRetry: NodeJS.Timeout | undefined
/** Automatic: restart into the update once every window (pop-outs too) said so and the browser is idle (agents done);
 *  another machine's window can't say, so not while one is open. */
function restartIfSafe() {
  if (updates !== "automatic" || !ready || remoteWins.size) return
  const pages = [...[...wins.values()].map((w) => w.win.webContents), ...popouts.keys()].filter((wc) => !wc.isDestroyed())
  if (!pages.length || !pages.every((wc) => safeNow.has(wc))) return
  if (!engineBusy()) return restartToUpdate()
  // (nothing tells when the busy window ends, so look again a little later)
  idleRetry ??= setTimeout(() => { idleRetry = undefined; restartIfSafe() }, 30_000)
}

/** Show (or, null, take down) what the update is doing in every window. */
function setStatus(text: string | null, restart = false) {
  status = text
  for (const w of wins.values()) if (w.ready) w.win.webContents.send("vaultite", { type: "update-status", text, restart })
}

/** A window that just opened: what the update is doing, and, the first one after an update, what it updated to. */
function tellStatus(w: Win) {
  if (status) w.win.webContents.send("vaultite", { type: "update-status", text: status })
  try {
    const to = fs.readFileSync(UPDATED(), "utf8").trim()
    fs.rmSync(UPDATED(), { force: true })
    if (to) w.win.webContents.send("vaultite", { type: "update-status", text: `Vaultite updated to ${to}`, done: true })
  } catch { /* not just updated */ }
}

/** Mark the restart as an update (the next launch says so) and say it's under way. */
function restarting(to: string) {
  try { fs.writeFileSync(UPDATED(), to) } catch { /* no note, still updates */ }
  setStatus("Restarting to update…", true)
}

function stopChecking() {
  if (checking?.pid) try { process.kill(-checking.pid, "SIGTERM") } catch { /* gone */ }
}

/** Quit, put the new app in this one's place, and open it again (update.sh install waits for this process to end). A
 *  newer build under way is dropped (the next check starts it again). */
function restartToUpdate() {
  if (status === "Restarting to update…") return // pressed twice
  if (RELEASE) {
    if (!ready || !releases) return
    quitting = true // its windows close before the app quits: they're reopened after
    restarting(ready)
    // A beat for the toast to draw before the windows close.
    return void setTimeout(() => releases!.quitAndInstall(), 150)
  }
  if (!ready || ready !== built() || !replaceable()) return
  stopChecking()
  const log = updateLog()
  fs.writeSync(log, `${new Date().toISOString()} installing ${ready} into ${BUNDLE}\n`)
  spawn(SHELL, [path.join(ROOT, "electron", "update.sh"), "install", String(process.pid), BUILT(), BUNDLE, path.basename(app.getPath("exe"))],
    { detached: true, stdio: ["ignore", log, log] }).unref()
  fs.closeSync(log)
  restarting(ready.slice(0, 7))
  setTimeout(() => app.quit(), 150)
}

/** electron-updater, once a release build first checks. */
let releases: AppUpdater | null = null
let fetching = false
async function releaseUpdater() {
  if (releases) return releases
  const updater = await import("electron-updater")
  const url = process.env.VAULTITE_UPDATE_URL
  // Linux: the AppImage's updater, or the .deb's (it asks for the password to install, pkexec), as electron-updater picks.
  const u: AppUpdater = MAC ? new updater.MacUpdater(url ? { provider: "generic", url } : undefined) : updater.autoUpdater
  if (!MAC && url) u.setFeedURL({ provider: "generic", url })
  const log = (level: string) => (m: unknown) => {
    try { fs.mkdirSync(app.getPath("logs"), { recursive: true }); fs.appendFileSync(path.join(app.getPath("logs"), "update.log"), `${new Date().toISOString()} ${level} ${m}\n`) } catch { /* no log */ }
  }
  u.logger = { info: log("info"), warn: log("warn"), error: log("error"), debug: () => {} }
  // Unheard, an "error" (no feed yet, a failed download) would throw in the main process: it only goes to the log.
  u.on("error", (e) => log("error")(e?.message ?? e))
  // electron-updater's update-downloaded comes before Squirrel.Mac has unpacked it (a quit then installs nothing): the
  // toast waits for Squirrel's own.
  let version = ""
  const downloaded = () => {
    ready = version || "new"
    for (const w of wins.values()) tell(w)
    buildMenu()
  }
  u.on("update-downloaded", (info) => { version = info.version; if (!MAC) downloaded() })
  // (Squirrel is a Mac's: on Linux electron-updater's own event is the one.)
  if (MAC) autoUpdater.on("update-downloaded", downloaded)
  return (releases = u)
}

/** A promise, or `why` once `ms` pass (a stalled feed or download doesn't hold the toast and the menu forever). */
function within<T>(p: Promise<T>, ms: number, why: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  return Promise.race([p, new Promise<never>((_ok, fail) => { t = setTimeout(() => fail(new Error(why)), ms) })]).finally(() => clearTimeout(t))
}

/** Look for a newer release and download it (the toast comes with update-downloaded). By hand, say how it went. */
async function checkRelease(byHand: boolean) {
  if (fetching) return
  fetching = true
  buildMenu()
  if (byHand) setStatus("Checking for updates…")
  try {
    const u = await releaseUpdater()
    const r = await within(u.checkForUpdates(), 2 * 60_000, "The update feed didn't answer")
    if (r?.isUpdateAvailable) {
      setStatus(`Downloading ${app.getName()} ${r.updateInfo.version}…`)
      if (r.downloadPromise) await within(r.downloadPromise, 30 * 60_000, "The download stalled")
    }
    else if (byHand) dialog.showMessageBox({ message: `${app.getName()} is up to date`, detail: `It runs ${app.getVersion()}, the newest ${BUILD?.channel === "nightly" ? "nightly" : "release"}.` })
  } catch (e) {
    if (byHand && !quitting) updateFailed(sentence(plainError(e).reason ?? "something went wrong while getting it"))
  } finally {
    fetching = false
    setStatus(null)
    buildMenu()
  }
}

// ---------- the menu ----------
/** Run one of the app's commands in the focused vault window (the manager just closes on ⌘W). */
function command(id: string) {
  return (_item: unknown, from?: BaseWindow) => {
    const f = from ?? AppWindow.getFocusedWindow()
    const w = [...wins.values()].find((x) => x.win === f)
    if (w) w.win.webContents.send("vaultite", { type: "command", id })
    else if (f instanceof AppWindow && popouts.has(f.webContents)) f.webContents.send("vaultite", { type: "command", id })
    else if (id === "tab:close") f?.close()
  }
}

/** Zoom every vault window a step in (1) or out (-1), or back to actual size (0). */
function zoomBy(step: -1 | 0 | 1) {
  return () => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 0.001)
    zoom = step === 0 ? 1 : ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.length - 1 : i) + step))]
    for (const w of wins.values()) w.win.webContents.setZoomFactor(zoom)
    save()
  }
}

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
  let repo = BUILD?.repo ?? ""
  if (!repo) try { repo = execFileSync("git", ["-C", ROOT, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() } catch { /* not a checkout */ }
  const m = /github\.com[/:]([^/]+\/[^/]+?)(\.git)?$/.exec(repo)
  return m ? `https://github.com/${m[1]}/issues` : null
})()

/** The menu bar (electron/menu.ts), for the focused vault window's commands (its last `menu:sync`). */
let menuShown = ""
function buildMenu() {
  const recent = [...known].sort((a, b) => (b.last ?? 0) - (a.last ?? 0))
  const w = focusedVault()
  const template = menuTemplate({
    snap: w?.menu ?? null,
    run: command,
    go: (p) => { const f = focusedVault(); if (f?.ready) f.win.webContents.send("vaultite", { type: "go", path: p }) },
    update: updatable() ? (ready
      ? { label: "Restart to update", click: restartToUpdate }
      : { label: checking || fetching ? "Checking for updates…" : "Check for updates…", enabled: !checking && !fetching, click: () => checkForUpdate(true) }) : null,
    vaults: [...recent.map((v) => ({ label: nameOf(v.path), sublabel: v.path, type: "checkbox" as const, checked: wins.has(v.path),
      click: () => openVault(v.path).catch((e) => failedBox(`Couldn't open ${nameOf(v.path)}`, e)) })),
      ...remotes.map((r) => ({ label: r.name, sublabel: r.url, type: "checkbox" as const, checked: remoteWins.has(r.url), click: () => openRemote(r.url) }))],
    manageVaults: showManager,
    setup: showSetup,
    pickOutside: () => { void pickOutside(null) },
    zoom: zoomBy,
    openDoc: (name) => { void openDoc(name) },
    issues,
    openExternal: (url) => { void shell.openExternal(url) },
    maximize: () => { const f = AppWindow.getFocusedWindow(); if (f) { if (f.isMaximized()) f.unmaximize(); else f.maximize() } },
    showLogs: () => { fs.mkdirSync(app.getPath("logs"), { recursive: true }); void shell.openPath(app.getPath("logs")) },
    sandbox: () => { sandbox().catch(() => {}) },
  })
  // (The same menu again isn't set: setting it closes one that's open.)
  const key = JSON.stringify([w?.menu ?? null, recent.map((v) => [v.path, wins.has(v.path)]), remotes.map((r) => [r.url, remoteWins.has(r.url)]), ready, !!checking || fetching])
  if (key === menuShown && Menu.getApplicationMenu()) return
  menuShown = key
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
AppWindow.each((w) => w.on("focus", () => buildMenu()))

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
/** The vault asked for on the command line (`--vault <path>`). */
function asked() {
  const i = process.argv.indexOf("--vault")
  return i > 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : null
}
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

/** Files and folders named on a command line: Linux's Open with (the desktop file's %U: file:// URLs) and `vaultite
 *  <file>`, the app's own and a second launch's. A Mac sends open-file instead. */
function argFiles(argv: string[], cwd: string) {
  const out: string[] = []
  for (let i = app.isPackaged ? 1 : 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--vault") { i++; continue }
    if (a.startsWith("-")) continue
    let p = a
    if (p.startsWith("file://")) try { p = fileURLToPath(p) } catch { continue }
    p = path.resolve(cwd, p)
    if (p !== ROOT && fs.existsSync(p)) out.push(p)
  }
  return out
}

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
const earlyLinks: string[] = []
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
  else if (what === "command" ? !/^[\w:.-]+$/.test(rest) : what !== "open" || !rest || rest.split("/").some((x) => x === ".." || x.startsWith("."))) return
  let w: Win | null = focusedVault()
  if (!w) {
    const last = [...known].sort((a, b) => (b.last ?? 0) - (a.last ?? 0))[0]
    if (!last) return showManager()
    w = await openVault(last.path).catch(() => null)
  }
  if (!w) return
  if (what === "open") {
    // (a note named without its .md, as a [[link]] names it)
    if (!path.extname(rest) && fs.existsSync(path.join(w.vault.path, `${rest}.md`))) rest += ".md"
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

if (!app.requestSingleInstanceLock()) app.quit()
else {
  // The vaults open last time start their servers now, before Electron is ready: a server takes longer to start than
  // the app, and they start together. (A vault opened with --vault that isn't known yet starts when its window does.)
  for (const p of reopening()) {
    try { if (refreshSandbox(p)) { const v = find(p); if (v) delete v.port } } catch (e) { console.error(e) }
    const v = find(p)
    if (v && !attachable(p) && fs.statSync(p, { throwIfNoEntry: false })?.isDirectory()) serverFor(v).catch(() => {})
  }
}
// Launched again (Linux: the app's icon, Open with, `vaultite <file>`): this one opens what it was given, else comes forward.
app.on("second-instance", (_e, argv, cwd) => {
  const i = argv.indexOf("--vault")
  const files = MAC ? [] : argFiles(argv, cwd)
  if (i > 0 && argv[i + 1]) {
    const p = path.resolve(cwd, argv[i + 1])
    void madeIfAsked(p).then(async (go) => { if (go) await openVault(p) }).catch((e) => failedBox("Couldn't open the vault", e))
  }
  else if (files.length) void openFiles(files, null)
  else {
    const w = focusedVault()?.win ?? manager ?? setupWin
    if (w) { if (w.isMinimized()) w.restore(); w.focus() } else showManager()
  }
})

app.on("before-quit", () => { quitting = true })
app.on("will-quit", () => { for (const w of wins.values()) { w.server?.kill(); w.link?.stop() } stopChecking(); stopApps() })
/** The launch's windows are open (or failed): from then on, closing the last window quits off a Mac. */
let launched = false
app.on("window-all-closed", () => {
  // As Mac apps do, the app stays there; the Dock icon brings back the manager. Elsewhere there's no Dock to: it quits
  // (its terminals live on in their keeper).
  if (!MAC && launched) app.quit()
})
app.on("activate", () => { if (!wins.size && !manager && !setupWin && !remoteWins.size) showManager() })

/** Opened from its disk image (or Downloads): offer to move into Applications, as Finder's drag would. True: it moved,
 *  and relaunches from there. The relaunched app ejects the image it came from. */
async function offerMove(): Promise<boolean> {
  const moved = path.join(app.getPath("userData"), "moved-from-dmg")
  if (fs.existsSync(moved)) {
    fs.rmSync(moved, { force: true })
    ejectImages()
  }
  const never = path.join(app.getPath("userData"), "never-move")
  if (!MAC || !RELEASE || app.isInApplicationsFolder() || fs.existsSync(never)) return false
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
    if (app.moveToApplicationsFolder({ conflictHandler: () => true })) return true
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

app.whenReady().then(async () => {
  if (await offerMove()) return
  if (fs.existsSync(DOCK_ICON()) || !app.isPackaged) applyDockIcon()
  app.setAboutPanelOptions({ applicationName: app.getName(), applicationVersion: app.getVersion() })
  if (DEV) app.dock?.setBadge("dev")
  buildMenu()
  const a = asked()
  started = true
  const go = !a || await madeIfAsked(a) // (else the vaults list)
  await Promise.all((go ? reopening() : []).map((p) => openVault(p).catch((e) => console.error(e))))
  if (!asked()) for (const r of remotes.filter((x) => x.open)) openRemote(r.url)
  if (firstRun() && !asked() && DEV) await sandbox().catch((e) => console.error(e))
  else if (firstRun() && !asked()) showSetup()
  else if (!wins.size && !remoteWins.size && !early.length) showManager()
  if (early.length) await openFiles(early.splice(0), null)
  for (const u of earlyLinks.splice(0)) await appLink(u).catch(() => {})
  behind = false
  launched = true
  if (!MAC && !AppWindow.getAllWindows().length) showManager() // (every window the launch opened failed)
  if (LINUX) unsandboxedNotice()
  if (RELEASE) {
    setTimeout(() => checkForUpdate(false), 10_000)
    setInterval(() => checkForUpdate(false), 4 * 60 * 60_000)
  } else if (updatable()) {
    setTimeout(() => checkForUpdate(false), 60_000)
    setInterval(() => checkForUpdate(false), 30 * 60_000)
  }
})
