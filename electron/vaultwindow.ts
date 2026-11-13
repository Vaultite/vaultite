import { app } from "electron"
import { AppWindow } from "./appwindow.ts"
import { QUIET } from "./quiet.ts"
import type { ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { revive, webWindow } from "./web.ts"
import { attach, type Link } from "./host.ts"
import { answers } from "../core/serving.ts"
import { HOST, WORKTREE } from "./identity.ts"
import { checkInstalled, restartToUpdate, worktreeChanged, worktreeNow } from "./updates.ts"
import { appsOn, appsWindow } from "./apps.ts"
import { translucentAt, translucentWindow } from "./translucency.ts"
import { openSandbox, sandboxPath } from "./sandbox.ts"
import { mainLog } from "./mainlog.ts"
import { ServerWatch } from "./serverwatch.ts"
import { DIST, MAC, PRELOAD } from "./mainbase.ts"
import { background, chrome, setLights } from "./titlebar.ts"
import { buildMenu, devtools, find, known, nameOf, remember, save, zoom } from "./vaultlist.ts"
import { adopt, adopted, answerCall, booting, handingOver, heirHere, helperOn, homeChanged, keepServer, kept, logFrom, logSince, servedElsewhere, serverFor, serverLog, startServer, type Win, wins } from "./servers.ts"
import { crashedFor, failedBox, hangs } from "./errors.ts"
import { guard } from "./guard.ts"

export let behind = !!process.env.VAULTITE_BEHIND
export const setBehind = (to: boolean) => { behind = to }
export let lastFocused: string | null = null
export let quitting = false
export const beginQuit = () => { quitting = true }
export let manager: AppWindow | null = null
export const waiting: string[] = []

export async function openVault(p: string, file?: string) {
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
    w.watch?.stop()
    if (helperOn() && !quitting && !w.ending && (w.link || w.server?.exitCode === null)) keepServer(p, { server: w.server, link: w.link, port: w.port })
    else {
      if (w.server) mainLog(`${nameOf(p)}: its window closed: server pid ${w.server.pid} ${handingOver ? "left for the next launch" : "stopped"}`)
      booting.delete(p)
      if (!handingOver) w.server?.kill()
      else if (adopted(w.server)) w.server.release()
      w.link?.stop()
    }
    homeChanged()
    buildMenu()
  })
  win.webContents.on("did-start-loading", () => { loadFailed = false })
  win.webContents.on("did-fail-load", (_e, code, _d, _u, main) => { if (main && code !== -3) loadFailed = true })
  if (server) w.watch = watchServer(w, server, () => loadFailed)
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

function watchServer(w: Win, first: ChildProcess, loadFailed: () => boolean) {
  const p = w.vault.path, name = nameOf(p)
  return new ServerWatch<ChildProcess>(first, {
    start: () => {
      const at = w.port, started = startServer(w.vault, at)
      const up = started.then((c): [ChildProcess, number] => [c, at])
      up.catch(() => booting.delete(p))
      booting.set(p, up)
      return started
    },
    answers: () => answers(w.port),
    took: (next) => {
      w.server = next
      // (a page that tried to load while it was down is Chromium's error page, which can't reconnect)
      const url = `http://127.0.0.1:${w.port}/`
      if (!w.win.webContents.getURL().startsWith(url) || loadFailed()) { w.ready = false; void w.win.loadURL(url).catch(() => {}) }
    },
    failed: (why, starting) => {
      if (w.win.isDestroyed()) return
      const said = why.includes("\n") ? "" : `\n${logSince(serverLog(p), (w.server && logFrom.get(w.server)) ?? Infinity)}`
      failedBox(`Couldn't ${starting ? "open" : "keep running"} ${name}`, new Error(why + said),
        { why: starting ? "Its server stopped as it started." : "Its server kept stopping, or didn't start again.", log: serverLog(p) })
      w.win.close()
    },
    over: () => (w.win.isDestroyed() ? "its window closed" : quitting ? "the app quits" : null),
    log: (line) => mainLog(`${name}: ${line}`),
  })
}
export async function helperHome() {
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
  } catch (e) { mainLog(`the helper's vault didn't start: ${e instanceof Error ? e.stack : String(e)}`); return false }
}
export function openHome() {
  const p = (lastFocused && (wins.has(lastFocused) || kept.has(lastFocused)) ? lastFocused : null) ?? [...kept.keys()][0]
  if (p) void openVault(p).catch((e) => failedBox(`Couldn't open ${nameOf(p)}`, e))
  else showManager()
}

export function sandbox() {
  return openSandbox((p) => openVault(p), (p) => wins.has(p), (p) => { const v = find(p); if (v) delete v.port })
}

export function send(w: Win, file: string) {
  if (w.ready) w.win.webContents.send("vaultite", { type: "open", path: file })
  else w.queue.push(file)
}

export function allowIn(w: Win, abs: string) {
  const list = w.vault.outside ?? []
  w.vault.outside = [abs, ...list.filter((x) => x !== abs)]
  save()
  const m = { type: "allow", paths: [abs] }
  if (w.server) w.server.send(m); else w.link?.send(m)
}

export function showManager() {
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

export const focusedVault = () => {
  const f = AppWindow.getFocusedWindow()
  return [...wins.values()].find((w) => w.win === f) ?? [...wins.values()].sort((a, b) => (b.vault.last ?? 0) - (a.vault.last ?? 0))[0] ?? null
}

export let dev: typeof import("./devroot.ts") | null = null
export async function startWorktree() {
  dev = await import("./devroot.ts")
  await dev.startDev({
    root: WORKTREE!, userData: app.getPath("userData"), headless: QUIET, debugPort: devtools ?? null, shellPrint: HOST?.shell.fingerprint,
    info: worktreeNow,
    changed: (what) => { worktreeChanged(what); if (QUIET) restartToUpdate() },
    restartServers: () => { for (const w of wins.values()) w.watch?.restart("the worktree changed") },
    say: (text) => { for (const w of wins.values()) if (w.ready) w.win.webContents.send("vaultite", { type: "update-status", text, done: true }) },
  })
}
