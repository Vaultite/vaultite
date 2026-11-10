// The desktop app's updates: a build from source builds its branch's newest (update.sh) and swaps it in; a release
// takes the release feed's (electron-updater). main.ts gives it its windows and state (UpdatesHost) and wires its IPC.
import { app, autoUpdater, dialog, powerMonitor, shell, type WebContents } from "electron"
import type { AppUpdater } from "electron-updater"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { plainError, sentence } from "../core/plainerror.ts"
import { BRANCH, CODE, DEV, SHELL } from "./identity.ts"
import { afterUpdate, installedCommit } from "./installed.ts"

const ROOT = path.dirname(import.meta.dirname)
const MAC = process.platform === "darwin"
const WIN = process.platform === "win32"

/** How this Mac takes updates: "automatic" restarts into one once every window says nothing would be lost, "notify"
 *  (the default) gets it ready and offers Restart to update, "off" checks only when asked (the menu). */
export type UpdateMode = "automatic" | "notify" | "off"
export const UPDATE_MODES: UpdateMode[] = ["automatic", "notify", "off"]

/** A vault's window, as updates see it. */
export type UpdateWindow = { vault: { path: string }; win: { webContents: WebContents }; server: ChildProcess | null; link: unknown; port: number; ready: boolean }
/** What updates need of the app (main.ts). */
export type UpdatesHost = {
  /** The vault windows open, and the pop-outs with the window each came from. */
  windows(): UpdateWindow[]
  popouts(): ReadonlyMap<WebContents, UpdateWindow>
  /** Another machine's window is open (it can't say whether a restart is safe). */
  othersOpen(): boolean
  mode(): UpdateMode
  /** Busy with something a restart would cut short (agents' browser). */
  busy(): boolean
  quitting(): boolean
  /** The app quits for good: its windows close without being forgotten. */
  beginQuit(): void
  /** Pages unloaded and the browser's cookies written, before quitting. */
  flush(): Promise<unknown>
  buildMenu(): void
  nameOf(vault: string): string
}
let host: UpdatesHost
export function initUpdates(h: UpdatesHost) { host = h }

// (Windows updates only from releases: a build from source has no update.sh there)
export const updatable = () => app.isPackaged && !!CODE && (SHELL.release === true || !WIN)
/** A release build updates from the release feed (electron-updater), not by building from git. */
export const RELEASE = app.isPackaged && !!CODE && SHELL.release === true
/** The clone update.sh builds in, and the finished build it leaves next to it (Vaultite Main.app, and its commit).
 *  .noindex: Spotlight skips them (a .metadata_never_index file no longer works), else it indexed every build's files. */
const SOURCE = () => path.join(app.getPath("userData"), "source.noindex")
const NEXT = () => path.join(app.getPath("userData"), "update.noindex")
/** The clone and build from before .noindex, moved in once: no new clone and npm ci. */
function moveUnindexed() {
  for (const [from, to] of [["source", SOURCE()], ["update", NEXT()]]) {
    const old = path.join(app.getPath("userData"), from)
    if (fs.existsSync(old) && !fs.existsSync(to)) try { fs.renameSync(old, to) } catch { /* a fresh clone then */ }
  }
}
/** This app's bundle (…/Vaultite Main.app), which an update replaces; on Linux its folder (npm run app:install's). */
const BUNDLE = MAC ? path.resolve(app.getPath("exe"), "..", "..", "..") : path.dirname(app.getPath("exe"))
/** What update.sh build leaves in NEXT: the .app, or (Linux) the unpacked app's folder. */
const BUILT = () => path.join(NEXT(), MAC ? `${app.getName()}.app` : app.getName())
/** update.sh runs in a login shell, so git, node and npm are on the PATH as in the user's terminal. */
const LOGIN_SHELL = MAC ? "/bin/zsh" : "/bin/bash"
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

/** What this app's updates are doing, for its server's app.version (vau version). */
export function appUpdates() {
  return { mode: host.mode(), available: updatable(), from: RELEASE ? "releases" : BRANCH, ready, doing: status }
}

function updateLog() {
  const dir = app.getPath("logs")
  fs.mkdirSync(dir, { recursive: true })
  return fs.openSync(path.join(dir, "update.log"), "a")
}

/** Build the newest main if this app doesn't run it. By hand (the menu), say how it went; on the timer, only a toast
 *  when there's a new build. */
function checkForUpdate(byHand: boolean) {
  if (!byHand && host.mode() === "off") return
  if (RELEASE) return void checkRelease(byHand)
  if (!updatable() || checking || looking) return
  // A build is minutes of compiling and a 20k-file app copied: on the timer, at most one an hour, however often main moves.
  if (!byHand && Date.now() - lastBuild() < BUILD_EVERY) return
  looking = true
  void attachedCommit().then((want) => { looking = false; buildUpdate(byHand, want) })
}
let looking = false
const BUILD_EVERY = 60 * 60_000
/** When the last build started (ms; 0: none yet), kept across restarts: an update's relaunch doesn't build again at once. */
const BUILT_AT = () => path.join(app.getPath("userData"), "update-started")
function lastBuild() {
  try { return Number(fs.readFileSync(BUILT_AT(), "utf8")) || 0 } catch { return 0 }
}

/** The commit the servers its windows attached to run, when every open window is attached: the app updates to that
 *  rather than the branch's newest, so the two are one version. "" otherwise. */
async function attachedCommit() {
  const all = host.windows()
  if (!all.length || all.some((w) => !w.link)) return ""
  const ran = await Promise.all(all.map((w) => serverCommit(w.port)))
  return ran.every((c) => /^[0-9a-f]{40}$/.test(c) && c === ran[0]) ? ran[0] : ""
}
/** The commit the server on `port` runs (its app.version), "" when it doesn't say. */
const serverCommit = (port: number) => fetch(`http://127.0.0.1:${port}/api/ops/app.version`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: "{}", signal: AbortSignal.timeout(5000) }).then((r) => r.json()).then((j: { result?: { commit?: unknown } }) => String(j.result?.commit ?? ""), () => "")

/** Vaults whose server this run restarted onto the installed build (once each). */
const restartedOnto = new Set<string>()
/** A window's own server, once up: on the installed build? One started from the tree an update was replacing restarts
 *  once onto it; the app itself started from there offers a restart. Both logged. */
export function checkInstalled(w: UpdateWindow) {
  if (!app.isPackaged) return
  // (past watchServer's first 10 s, where a server that stops counts as one that couldn't open the vault)
  setTimeout(() => void (async () => {
    const p = w.vault.path
    if (!host.windows().includes(w) || !w.server || w.server.exitCode !== null) return
    const installed = installedCommit(ROOT), server = (await serverCommit(w.port)) || null
    const { stale, restart } = afterUpdate({ installed, app: CODE?.commit ?? null, server, restarted: restartedOnto.has(p) })
    if (!stale && !restart) return
    const log = updateLog(), at = new Date().toISOString()
    if (stale) {
      fs.writeSync(log, `${at} this app runs ${CODE!.commit}, but ${installed} is installed: it started from the app an update replaced\n`)
      if (!RELEASE && built() === installed && ready !== installed) { ready = installed; for (const x of host.windows()) tell(x); host.buildMenu() }
    }
    if (restart && w.server?.exitCode === null) {
      restartedOnto.add(p)
      fs.writeSync(log, `${at} ${host.nameOf(p)}'s server runs ${server}, not the installed ${installed}: restarting it\n`)
      w.server.kill() // (watchServer starts it again, on its port)
    }
    fs.closeSync(log)
  })(), 15_000)
}

function buildUpdate(byHand: boolean, want: string) {
  const log = updateLog()
  fs.writeSync(log, `\n${new Date().toISOString()} checking (running ${CODE!.commit.slice(0, 7)}${want ? `, its server ${want.slice(0, 7)}` : ""})\n`)
  let out = ""
  if (byHand) setStatus("Checking for updates…")
  // On the timer it builds at utility QoS: below the user's apps yet on any core (`-b`, background, kept it to the
  // efficiency cores with its disk I/O throttled: on a busy Mac a 30 s build took 20 minutes).
  const low = byHand ? [] : process.platform === "darwin" ? ["/usr/sbin/taskpolicy", "-c", "utility"] : ["nice", "-n", "19"]
  const [cmd, ...args] = [...low, LOGIN_SHELL, "-l", path.join(ROOT, "electron", "update.sh"), "build", SOURCE(), CODE!.repo, CODE!.commit,
    BRANCH, DEV ? "app:build:dev" : "app:build", ...(want ? [want] : [])]
  const child = checking = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], detached: true })
  host.buildMenu()
  const take = (b: Buffer) => {
    fs.writeSync(log, b)
    out = (out + b.toString()).slice(-4000)
    const building = /^@building (\w+)$/m.exec(b.toString())
    if (building) {
      setStatus(`Updating ${app.getName()} to ${building[1].slice(0, 7)}…`)
      try { fs.writeFileSync(BUILT_AT(), String(Date.now())) } catch { /* then the next check may build again */ }
    }
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
      if (ready !== commit || byHand) { ready = commit; for (const w of host.windows()) tell(w) }
    } else if (byHand && code === 3) {
      dialog.showMessageBox({ message: `${app.getName()} is up to date`, detail: `It runs ${CODE!.commit.slice(0, 7)}, ${want ? "the version its server runs" : `the newest on ${BRANCH}`}.` })
    } else if (byHand && !host.quitting()) {
      updateFailed(/^boot: \d+ failed/m.test(out) ? "The new version didn't pass its startup check."
        : /no code signing identity in the keychain: not building/.test(out) ? "This Mac has no code signing identity, and an update signed without one would sign you out of every site: add one (a self-signed code signing certificate will do)."
        : /not building an update signed ad hoc/.test(out) ? "The new version couldn't be signed: the keychain may be locked. The next check tries again."
        : /from before cookie encryption/.test(out) ? "Its server runs a version from before cookie encryption, which would sign you out of every site: update the server first."
        : "The new version didn't build.")
    }
    if (ready !== built()) ready = null
    host.buildMenu()
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
function tell(w: UpdateWindow) {
  if (!w.ready || !ready) return
  const msg = { type: "update", name: app.getName(), version: RELEASE ? ready : ready.slice(0, 7), auto: host.mode() === "automatic" }
  w.win.webContents.send("vaultite", msg)
  for (const [wc, of] of host.popouts()) if (of === w && !wc.isDestroyed()) wc.send("vaultite", msg)
}

/** The pages that said a restart would lose nothing now (`app:update-safe`). */
const safeNow = new WeakSet<WebContents>()
let idleRetry: NodeJS.Timeout | undefined
/** Automatic: restart into the update once every window (pop-outs too) said so, the user is away from the computer (not
 *  just this app) and the browser is idle (agents done); another machine's window can't say, so not while one is open. */
function restartIfSafe() {
  if (host.mode() !== "automatic" || !ready || host.othersOpen()) return
  const pages = [...host.windows().map((w) => w.win.webContents), ...host.popouts().keys()].filter((wc) => !wc.isDestroyed())
  if (!pages.length || !pages.every((wc) => safeNow.has(wc))) return
  if (powerMonitor.getSystemIdleTime() >= 10 * 60 && !host.busy()) return restartToUpdate()
  // (nothing tells when the user steps away or the busy window ends, so look again a little later)
  idleRetry ??= setTimeout(() => { idleRetry = undefined; restartIfSafe() }, 60_000)
}

/** Show (or, null, take down) what the update is doing in every window. */
function setStatus(text: string | null, restart = false) {
  status = text
  for (const w of host.windows()) if (w.ready) w.win.webContents.send("vaultite", { type: "update-status", text, restart })
}

/** A window that just opened: what the update is doing, and, the first one after an update, what it updated to. */
function tellStatus(w: UpdateWindow) {
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

/** Quit once the new app is staged beside this one, which update.sh install then swaps in and opens (it waits for this
 *  process to end). A newer build under way is dropped (the next check starts it again). */
export function restartToUpdate(byHand = false) {
  if (status === "Restarting to update…") return // pressed twice
  if (RELEASE) {
    if (!ready || !releases) return
    host.beginQuit() // its windows close before the app quits: they're reopened after
    restarting(ready)
    // A beat for the toast to draw before the windows close, and the browser's logins on disk.
    // (Windows: the installer runs silently and opens the app again, rather than showing its window)
    return void afterFlush(() => releases!.quitAndInstall(WIN, WIN))
  }
  // (already installing: an earlier restart whose quit didn't go through, its install still waiting for this one)
  const to = ready, staged = install(true)
  if (!to || !staged) return
  restarting(to.slice(0, 7))
  void staged.then((ok) => {
    if (ok) return afterFlush(() => app.quit())
    // (not offered again until the next check: an automatic restart would copy it again every minute)
    fs.rmSync(UPDATED(), { force: true })
    ready = null
    setStatus(null)
    host.buildMenu()
    if (byHand) updateFailed("The new version couldn't be put in place (update.log says why).")
  })
}
/** update.sh install, once: it copies the new app beside this one and checks it (staged: true; false, it isn't and this
 *  app stays as it is), waits for this process to end, swaps it in and opens it (`reopen`). */
let installing: Promise<boolean> | null = null
function install(reopen: boolean): Promise<boolean> | null {
  if (installing) return installing
  if (!ready || ready !== built() || !replaceable()) return null
  stopChecking()
  const log = updateLog()
  fs.writeSync(log, `${new Date().toISOString()} installing ${ready} into ${BUNDLE}${reopen ? "" : " as the app quits"}\n`)
  // (fd 3: where it says it's staged; quitting, nobody waits)
  const child = spawn(LOGIN_SHELL, [path.join(ROOT, "electron", "update.sh"), "install", String(process.pid), BUILT(), BUNDLE, path.basename(app.getPath("exe")), ...(reopen ? [] : ["stay"])],
    { detached: true, stdio: ["ignore", log, log, reopen ? "pipe" : "ignore"] })
  child.unref()
  fs.closeSync(log)
  if (!reopen) return (installing = Promise.resolve(true))
  const said = child.stdio[3] as NodeJS.ReadableStream
  installing = new Promise<boolean>((done) => {
    // (a copy that stalls, say a disk gone: given up, the app untouched)
    const stall = setTimeout(() => { try { process.kill(-child.pid!, "SIGTERM") } catch { /* gone */ } done(false) }, 10 * 60_000)
    said.on("data", (b: Buffer) => { if (/staged/.test(b.toString())) { clearTimeout(stall); done(true) } })
    said.on("error", () => {})
    child.once("exit", () => { clearTimeout(stall); done(false) })
  })
  void installing.then((ok) => { if (!ok) installing = null })
  return installing
}
/** `quit` once the toast had a beat to draw and the browser's cookies are written (Chromium writes them in batches;
 *  session cookies are the engine's to keep, browser/sessioncookies.ts). */
function afterFlush(quit: () => void) {
  void Promise.all([host.flush(), new Promise((done) => setTimeout(done, 150))]).then(quit, quit)
}
/** electron-updater, once a release build first checks. */
let releases: AppUpdater | null = null
let fetching = false
async function releaseUpdater() {
  if (releases) return releases
  const updater = await import("electron-updater")
  const url = process.env.VAULTITE_UPDATE_URL
  // Linux: the AppImage's updater, or the .deb's (it asks for the password to install, pkexec), as electron-updater picks;
  // Windows: the NSIS installer's, its architecture's file from the feed's list (tools/feed.ts).
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
    for (const w of host.windows()) tell(w)
    host.buildMenu()
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
  host.buildMenu()
  if (byHand) setStatus("Checking for updates…")
  try {
    const u = await releaseUpdater()
    const r = await within(u.checkForUpdates(), 2 * 60_000, "The update feed didn't answer")
    if (r?.isUpdateAvailable) {
      setStatus(`Downloading ${app.getName()} ${r.updateInfo.version}…`)
      if (r.downloadPromise) await within(r.downloadPromise, 30 * 60_000, "The download stalled")
    }
    else if (byHand) dialog.showMessageBox({ message: `${app.getName()} is up to date`, detail: `It runs ${app.getVersion()}, the newest ${SHELL.channel === "nightly" ? "nightly" : "release"}.` })
  } catch (e) {
    if (byHand && !host.quitting()) updateFailed(sentence(plainError(e).reason ?? "something went wrong while getting it"))
  } finally {
    fetching = false
    setStatus(null)
    host.buildMenu()
  }
}

/** The menu's update item: Restart to update, else Check for updates (null: this app doesn't update itself). */
export function updateMenuItem() {
  if (!updatable()) return null
  return ready ? { label: "Restart to update", click: () => restartToUpdate(true) }
    : { label: checking || fetching ? "Checking for updates…" : "Check for updates…", enabled: !checking && !fetching, click: () => checkForUpdate(true) }
}

/** A window's page is up: what the update is doing, and the update waiting, if any. */
export function windowReady(w: UpdateWindow) {
  setTimeout(() => { tellStatus(w); if (ready) tell(w) }, 0)
}

/** The mode was changed (Settings): every window told, and a check now unless off. */
export function modeChanged() {
  for (const w of host.windows()) tell(w)
  if (host.mode() !== "off" && !ready) checkForUpdate(false)
}

/** A page says whether a restart would lose nothing now (`app:update-safe`). */
export function pageSafe(page: WebContents, safe: boolean) {
  if (safe) safeNow.add(page); else safeNow.delete(page)
  restartIfSafe()
}

/** Once the launch's windows are open: checks on a timer. */
export function scheduleUpdates() {
  if (RELEASE) {
    setTimeout(() => checkForUpdate(false), 10_000)
    setInterval(() => checkForUpdate(false), 4 * 60 * 60_000)
  } else if (updatable()) {
    moveUnindexed()
    setTimeout(() => checkForUpdate(false), 60_000)
    setInterval(() => checkForUpdate(false), 30 * 60_000)
  }
}

/** The app quits: a build under way stops; one ready goes in now, while nothing is open, and the next launch runs it. */
export function quitUpdates() {
  stopChecking()
  if (!RELEASE && host.mode() !== "off" && updatable()) install(false)
}
