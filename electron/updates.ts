// The desktop app's updates (update.sh's builds, the store's, a release's): updatelogic.ts decides, this runs its effects.
import { app, autoUpdater, dialog, powerMonitor, shell, type WebContents } from "electron"
import type { AppUpdater } from "electron-updater"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { Readable } from "node:stream"
import type { AppUpdates, UpdateStatus } from "../core/contracts/version.ts"
import { plainError, sentence } from "../core/plainerror.ts"
import { BRANCH, CODE, DEV, SHELL, WORKTREE } from "./identity.ts"
import { relaunchSoon, storeLook, storeOn, storeReady, storeStatus, type StoreHost } from "./storehost.ts"
import { relaunchOptions } from "./argv.ts"
import { describe, menuItem, offerMessage, restartWaitsOn, START, statusOf, step, type Current, type Effect, type How, type Leave, type ReleaseOutcome,
  type UpdateEvent, type Updates } from "./updatelogic.ts"

const LOOK_EVERY = 3 * 60_000
const BUILD_EVERY = 60 * 60_000

const ROOT = path.dirname(import.meta.dirname)
const MAC = process.platform === "darwin"
const WIN = process.platform === "win32"

export type UpdateMode = "automatic" | "notify" | "off"
export const UPDATE_MODES: UpdateMode[] = ["automatic", "notify", "off"]

export type UpdateWindow = { vault: { path: string }; win: { webContents: WebContents }; server: ChildProcess | null; link: unknown; port: number; ready: boolean }
export type UpdatesHost = {
  windows(): UpdateWindow[]
  popouts(): ReadonlyMap<WebContents, UpdateWindow>
  othersOpen(): boolean
  mode(): UpdateMode
  busy(): string | null
  quitting(): boolean
  beginQuit(): void
  handOver(): void
  flush(): Promise<unknown>
  buildMenu(): void
  nameOf(vault: string): string
  helper(): boolean
  helperCommit: StoreHost["helper"]
  reloadHelper: StoreHost["reloadHelper"]
  /** Its own server (started, or taken over from its last launch) never pins its updates (attached.ts). */
  ownsServer(w: UpdateWindow): boolean
  servers: StoreHost["servers"]
  restartServers(): void
  adoptWeb(dist: string, commit: string): void
  path(): string
}
let host: UpdatesHost
export function initUpdates(h: UpdatesHost) { host = h }

export const updatable = () => !WORKTREE && app.isPackaged && !!CODE && (SHELL.release === true || !WIN)
export const RELEASE = app.isPackaged && !!CODE && SHELL.release === true
// (.noindex: Spotlight skips them, a .metadata_never_index file no longer works; else it indexed every build's files)
const SOURCE = () => path.join(app.getPath("userData"), "source.noindex")
const NEXT = () => path.join(app.getPath("userData"), "update.noindex")
function moveUnindexed() {
  for (const [from, to] of [["source", SOURCE()], ["update", NEXT()]]) {
    const old = path.join(app.getPath("userData"), from)
    if (fs.existsSync(old) && !fs.existsSync(to)) try { fs.renameSync(old, to) } catch { /* a fresh clone then */ }
  }
}
const BUNDLE = MAC ? path.resolve(app.getPath("exe"), "..", "..", "..") : path.dirname(app.getPath("exe"))
const BUILT = () => path.join(NEXT(), MAC ? `${app.getName()}.app` : app.getName())
const LOGIN_SHELL = MAC ? "/bin/zsh" : "/bin/bash"
// (an AppImage is read-only)
const replaceable = () => MAC ? BUNDLE.endsWith(".app") : !process.env.APPIMAGE && fs.existsSync(app.getPath("exe"))
const UPDATED = () => path.join(app.getPath("userData"), "updated")
const BUILT_AT = () => path.join(app.getPath("userData"), "update-started")
const said = (e: unknown) => (e instanceof Error ? e.message : String(e))

let state: Updates = START
function send(e: UpdateEvent) {
  const from = state, r = step(from, e)
  state = r.to
  const a = describe(from), b = describe(r.to)
  if (r.ignored || a !== b) logUpdate(`updates: ${a} --${e.type}--> ${r.ignored ? "ignored" : b}`)
  for (const fx of r.do) run(fx)
}

let retry: NodeJS.Timeout | undefined
let buildChild: ChildProcess | null = null
let storeRun: Promise<void> | null = null
let releases: AppUpdater | null = null

function run(fx: Effect) {
  switch (fx.kind) {
    case "tell": for (const w of host.windows()) tell(w); return
    case "menu": return host.buildMenu()
    case "status": return setStatus()
    case "weigh": return weigh()
    case "arm": retry ??= setTimeout(() => { retry = undefined; weigh() }, 60_000); return
    case "disarm": clearTimeout(retry); retry = undefined; return
    case "check": return checkForUpdate(false)
    case "pin": return void attachedTo().then((want) => send({ type: "pinned", want: want ?? "" }), (e: unknown) => {
      logUpdate(`updates: its servers' commit: ${said(e)}`)
      send({ type: "pin-failed" })
    })
    case "build": return build(fx.byHand, fx.want)
    case "stop-build": if (buildChild?.pid) try { process.kill(-buildChild.pid, "SIGTERM") } catch { /* gone */ } return
    case "store-look": storeRun = storeLook(storeHost()).then((s) => send({ type: "looked", state: s.state, why: s.why, quitting: host.quitting() }), (e: unknown) => {
      logUpdate(`store: the look failed: ${said(e)}`)
      send({ type: "looked", state: null, why: "", quitting: host.quitting() })
    }).finally(() => { storeRun = null }); return
    case "release-look": return void checkRelease()
    case "restart": return restartToUpdate()
    case "stage": return stage(fx.commit, fx.reopen)
    case "hand-over": return host.handOver()
    case "begin-quit": return host.beginQuit()
    case "note": try { fs.writeFileSync(UPDATED(), fx.to) } catch { /* no note, still updates */ } return
    case "unnote": return fs.rmSync(UPDATED(), { force: true })
    case "leave": return afterFlush(leave(fx.then))
    case "current": return upToDate(fx.current)
    case "failed": return updateFailed(fx.why)
    default: return fx satisfies never
  }
}

export function appUpdates(): AppUpdates {
  const store = storeOn() ? storeStatus() : null, o = state.offer
  return { mode: host.mode(), available: updatable(), from: worktree ? "worktree" : RELEASE ? "releases" : BRANCH, ready: o?.commit ?? null,
    doing: statusOf(state, app.getName())?.text ?? null, commit: worktree?.commit ?? CODE?.commit ?? null, helper: host.helper(), ...(worktree ? { worktree } : {}),
    ...(store ? { store, how: o?.how === "relaunch" ? "relaunch" : "install" } : {}), ...(started ? { root: started } : {}), ...(o?.behind ? { behind: o.behind } : {}) }
}

let started: { from: string; commit: string | null; fellBack?: { commit: string | null; why: string } } | null = null
export function launchedFrom(r: NonNullable<typeof started>) { started = r }

const storeHost = (): StoreHost => ({
  attached: attachedTo, servers: () => host.servers(), restartServers: () => host.restartServers(), adoptWeb: (d, c) => host.adoptWeb(d, c),
  offerRelaunch: (c, why) => offer(c, "relaunch", why ?? null), offerInstall: (c) => offer(c, "install"),
  busy: async () => host.busy(), path: () => host.path(),
  helper: () => host.helperCommit(), reloadHelper: (root, commit) => host.reloadHelper(root, commit), log: logUpdate,
})
export function logUpdate(line: string) {
  try { fs.mkdirSync(app.getPath("logs"), { recursive: true }); fs.appendFileSync(path.join(app.getPath("logs"), "update.log"), `${new Date().toISOString()} ${line}\n`) } catch { /* no log */ }
}
function offer(commit: string, how: Exclude<How, "worktree">, behind?: string | null) {
  send({ type: "offered", commit, how: WORKTREE ? "worktree" : how, ...(behind !== undefined ? { behind } : {}) })
}
export async function lookNow(asking?: { port?: unknown; commit?: unknown }): Promise<UpdateStatus | null> {
  if (typeof asking?.port === "number" && typeof asking.commit === "string") told.set(asking.port, asking.commit)
  if (storeOn()) {
    send({ type: "check", byHand: false, via: "store", off: host.mode() === "off", recent: false })
    await storeRun
    told.clear()
    return storeStatus()
  }
  told.clear()
  checkForUpdate(false)
  const building = state.look.kind === "building"
  return { branch: null, state: building ? "updating" : "current", why: building ? "building the newest with update.sh" : "nothing to build now (one an hour at most)", checked: Date.now() }
}
export const mainBehind = (commit: string) => offer(commit, "relaunch")
export function updatesReady() { void storeReady(storeHost()).catch((e: unknown) => logUpdate(`store: ${said(e)}`)) }

let worktree: { worktree: string; branch: string; commit: string; dirty: boolean } | null = null
export function worktreeNow(w: NonNullable<typeof worktree>) { worktree = w }
export function worktreeChanged(what: string) { send({ type: "changed", what }) }

function updateLog() {
  const dir = app.getPath("logs")
  fs.mkdirSync(dir, { recursive: true })
  return fs.openSync(path.join(dir, "update.log"), "a")
}

function checkForUpdate(byHand: boolean) {
  const via = RELEASE ? "release" : storeOn() ? "store" : updatable() ? "build" : null
  send({ type: "check", byHand, via, off: host.mode() === "off", recent: via === "build" && Date.now() - lastBuild() < BUILD_EVERY })
}
function lastBuild() {
  try { return Number(fs.readFileSync(BUILT_AT(), "utf8")) || 0 } catch { return 0 }
}

const attachedTo = async () => (await import("./attached.ts")).attachedTo(host, told, logUpdate)
const told = new Map<number, string>()

const restartedOnto = new Set<string>()
export function checkInstalled(w: UpdateWindow) {
  if (!app.isPackaged) return
  setTimeout(() => void (async () => {
    const p = w.vault.path
    if (!host.windows().includes(w) || !w.server || w.server.exitCode !== null) return
    const { afterUpdate, installedCommit } = await import("./installed.ts")
    const installed = installedCommit(ROOT), server = (await (await import("./attached.ts")).serverCommit(w.port, logUpdate)) || null
    const { stale, restart } = afterUpdate({ installed, app: CODE?.commit ?? null, server, restarted: restartedOnto.has(p) })
    if (!stale && !restart) return
    const log = updateLog(), at = new Date().toISOString()
    if (stale) {
      fs.writeSync(log, `${at} this app runs ${CODE?.commit}, but ${installed} is installed: it started from the app an update replaced\n`)
      if (!RELEASE && installed && built() === installed) offer(installed, "install")
    }
    if (restart && w.server?.exitCode === null) {
      restartedOnto.add(p)
      fs.writeSync(log, `${at} ${host.nameOf(p)}'s server runs ${server}, not the installed ${installed}: restarting it\n`)
      w.server.kill()
    }
    fs.closeSync(log)
  })(), 15_000)
}

function build(byHand: boolean, want: string) {
  if (!CODE) return send({ type: "built", code: null, out: "", built: built(), quitting: host.quitting() })
  const log = updateLog()
  fs.writeSync(log, `\n${new Date().toISOString()} checking (running ${CODE.commit.slice(0, 7)}${want ? `, its server ${want.slice(0, 7)}` : ""})\n`)
  let out = ""
  // (-b, background, kept it to the efficiency cores with its disk I/O throttled: on a busy Mac a 30 s build took 20 minutes)
  const low = byHand ? [] : MAC ? ["/usr/sbin/taskpolicy", "-c", "utility"] : ["nice", "-n", "19"]
  const [cmd, ...args] = [...low, LOGIN_SHELL, "-l", path.join(ROOT, "electron", "update.sh"), "build", SOURCE(), CODE.repo, CODE.commit,
    BRANCH, DEV ? "app:build:dev" : "app:build", ...(want ? [want] : [])]
  const child = buildChild = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], detached: true })
  const take = (b: Buffer) => {
    fs.writeSync(log, b)
    out = (out + b.toString()).slice(-4000)
    const building = /^@building (\w+)$/m.exec(b.toString())
    if (!building) return
    try { fs.writeFileSync(BUILT_AT(), String(Date.now())) } catch { /* then the next check may build again */ }
    send({ type: "building", commit: building[1] })
  }
  child.stdout?.on("data", take)
  child.stderr?.on("data", take)
  // (a fetch or npm ci can stall for good)
  const stall = setTimeout(() => { fs.writeSync(log, "stopped: still going after 45 minutes\n"); run({ kind: "stop-build" }) }, 45 * 60_000)
  child.on("close", (code) => {
    clearTimeout(stall)
    fs.writeSync(log, `exit ${code}\n`)
    fs.closeSync(log)
    buildChild = null
    send({ type: "built", code, out, built: built(), quitting: host.quitting() })
  })
}

function upToDate(c: Current) {
  const runs = CODE?.commit.slice(0, 7) ?? ""
  const detail = c.via === "store" ? `It runs ${runs}: ${c.why}.`
    : c.via === "build" ? `It runs ${runs}, ${c.pinned ? "the version its server runs" : `the newest on ${BRANCH}`}.`
    : `It runs ${app.getVersion()}, the newest ${SHELL.channel === "nightly" ? "nightly" : "release"}.`
  void dialog.showMessageBox({ message: `${app.getName()} is up to date`, detail })
}

function updateFailed(why: string) {
  void dialog.showMessageBox({ type: "warning", message: `Couldn't update ${app.getName()}`, buttons: ["OK", "Show log"],
    detail: `${why} ${app.getName()} keeps this version and tries again later.` })
    .then((r) => { if (r.response === 1) void shell.openPath(path.join(app.getPath("logs"), "update.log")) })
}

function built() {
  try {
    return fs.existsSync(BUILT()) ? fs.readFileSync(path.join(NEXT(), "commit"), "utf8").trim() : null
  } catch {
    return null
  }
}

function tell(w: UpdateWindow) {
  if (!w.ready || !state.offer) return
  const msg = offerMessage(state.offer, app.getName(), host.mode() === "automatic")
  w.win.webContents.send("vaultite", msg)
  for (const [wc, of] of host.popouts()) if (of === w && !wc.isDestroyed()) wc.send("vaultite", msg)
}

const safeNow = new WeakSet<WebContents>()
function weigh() {
  const auto = host.mode() === "automatic" && !host.quitting()
  if (!auto || !state.offer) return send({ type: "weighed", auto, why: null })
  const pages = [...host.windows().map((w) => w.win.webContents), ...host.popouts().keys()].filter((wc) => !wc.isDestroyed())
  send({ type: "weighed", auto, why: restartWaitsOn({ othersOpen: host.othersOpen(), pages: pages.length, safe: pages.filter((wc) => safeNow.has(wc)).length,
    idle: powerMonitor.getSystemIdleTime(), busy: host.busy() }) })
}

function setStatus() {
  const s = statusOf(state, app.getName())
  for (const w of host.windows()) if (w.ready) w.win.webContents.send("vaultite", { type: "update-status", text: s?.text ?? null, restart: s?.restart ?? false })
}

function tellStatus(w: UpdateWindow) {
  const s = statusOf(state, app.getName())
  if (s) w.win.webContents.send("vaultite", { type: "update-status", text: s.text })
  try {
    const to = fs.readFileSync(UPDATED(), "utf8").trim()
    fs.rmSync(UPDATED(), { force: true })
    if (to) w.win.webContents.send("vaultite", { type: "update-status", text: `Vaultite updated to ${to}`, done: true })
  } catch { /* not just updated */ }
}

export function restartToUpdate(byHand = false) {
  send({ type: "restart", byHand, built: built(), replaceable: replaceable(), releases: !!releases })
}

function leave(then: Leave): () => void {
  if (then === "relaunch") return () => { app.relaunch(relaunchOptions()); app.quit() }
  if (then === "relaunch-soon") return () => { relaunchSoon(); app.quit() }
  // (Windows: the installer runs silently and opens the app again, rather than showing its window)
  if (then === "release") return () => releases?.quitAndInstall(WIN, WIN)
  return () => app.quit()
}

function stage(commit: string, reopen: boolean) {
  const log = updateLog()
  fs.writeSync(log, `${new Date().toISOString()} installing ${commit} into ${BUNDLE}${reopen ? "" : " as the app quits"}\n`)
  const child = spawn(LOGIN_SHELL, [path.join(ROOT, "electron", "update.sh"), "install", String(process.pid), BUILT(), BUNDLE, path.basename(app.getPath("exe")), ...(reopen ? [] : ["stay"])],
    { detached: true, stdio: ["ignore", log, log, reopen ? "pipe" : "ignore"] })
  child.unref()
  fs.closeSync(log)
  if (!reopen) return
  const pipe = child.stdio[3]
  void new Promise<boolean>((done) => {
    if (!(pipe instanceof Readable)) return done(false)
    const stall = setTimeout(() => {
      logUpdate(`not installed: staging ${commit.slice(0, 7)} beside the app took over 10 minutes`)
      try { if (child.pid) process.kill(-child.pid, "SIGTERM") } catch { /* gone */ }
      done(false)
    }, 10 * 60_000)
    pipe.on("data", (b: Buffer) => { if (/staged/.test(b.toString())) { clearTimeout(stall); done(true) } })
    pipe.on("error", () => {})
    child.once("exit", () => { clearTimeout(stall); done(false) })
  }).then((ok) => send({ type: "staged", ok }))
}
/** Chromium writes cookies in batches; session cookies are the engine's to keep (browser/sessioncookies.ts). */
function afterFlush(quit: () => void) {
  void Promise.all([host.flush(), new Promise((done) => setTimeout(done, 150))]).then(quit, quit)
}
async function releaseUpdater() {
  if (releases) return releases
  const updater = await import("electron-updater")
  const url = process.env.VAULTITE_UPDATE_URL
  const u: AppUpdater = MAC ? new updater.MacUpdater(url ? { provider: "generic", url } : undefined) : updater.autoUpdater
  if (!MAC && url) u.setFeedURL({ provider: "generic", url })
  const log = (level: string) => (m: unknown) => logUpdate(`${level} ${m}`)
  u.logger = { info: log("info"), warn: log("warn"), error: log("error"), debug: () => {} }
  // (unheard, an "error" would throw in the main process)
  u.on("error", (e) => log("error")(e?.message ?? e))
  // (electron-updater's update-downloaded comes before Squirrel.Mac has unpacked it: a quit then installs nothing)
  let version = ""
  const downloaded = () => offer(version || "new", "release")
  u.on("update-downloaded", (info) => { version = info.version; if (!MAC) downloaded() })
  if (MAC) autoUpdater.on("update-downloaded", downloaded)
  return (releases = u)
}

function within<T>(p: Promise<T>, ms: number, why: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  return Promise.race([p, new Promise<never>((_ok, fail) => { t = setTimeout(() => fail(new Error(why)), ms) })]).finally(() => clearTimeout(t))
}

async function checkRelease() {
  let outcome: ReleaseOutcome = { kind: "current" }
  try {
    const u = await releaseUpdater()
    const r = await within(u.checkForUpdates(), 2 * 60_000, "The update feed didn't answer")
    if (r?.isUpdateAvailable) {
      send({ type: "release-found", version: r.updateInfo.version })
      if (r.downloadPromise) await within(r.downloadPromise, 30 * 60_000, "The download stalled")
      outcome = { kind: "downloaded" }
    }
  } catch (e) {
    outcome = { kind: "failed", why: sentence(plainError(e).reason ?? "something went wrong while getting it") }
  }
  send({ type: "release-looked", outcome, quitting: host.quitting() })
}

export function updateMenuItem() {
  const item = menuItem(state, { worktree: !!WORKTREE, updatable: updatable() })
  if (!item) return null
  const click = item.act === "restart" ? () => restartToUpdate(true) : () => checkForUpdate(true)
  return { label: item.label, ...(item.enabled === undefined ? {} : { enabled: item.enabled }), click }
}

export function windowReady(w: UpdateWindow) {
  setTimeout(() => { tellStatus(w); tell(w) }, 0)
}

export function modeChanged() { send({ type: "mode-changed", off: host.mode() === "off" }) }

export function pageSafe(page: WebContents, safe: boolean) {
  if (safe) safeNow.add(page); else safeNow.delete(page)
  weigh()
}

export function scheduleUpdates() {
  if (RELEASE) {
    setTimeout(() => checkForUpdate(false), 10_000)
    setInterval(() => checkForUpdate(false), 4 * 60 * 60_000)
  } else if (updatable()) {
    moveUnindexed()
    const old = () => { if (!storeOn()) checkForUpdate(false) }, store = () => { if (storeOn()) checkForUpdate(false) }
    setTimeout(old, 60_000)
    setInterval(old, 30 * 60_000)
    setTimeout(store, 60_000)
    setInterval(store, LOOK_EVERY)
  }
}

export function quitUpdates() {
  send({ type: "quit", off: host.mode() === "off", updatable: updatable(), built: built(), replaceable: replaceable() })
}
