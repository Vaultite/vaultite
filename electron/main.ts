// Vaultite's desktop app (Electron): each vault a window with its server (electron/CLAUDE.md).
import "../core/winspawn.ts"
import "./dockenv.ts"
import { app, clipboard, dialog, Menu, session } from "electron"
import { AppWindow } from "./appwindow.ts"
import { relaunchOptions, vaultArg } from "./argv.ts"
import { QUIET, fakePointer, quiet, quietPage } from "./quiet.ts"
import { execFile, execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { unloadPages } from "./web.ts"
import "./browser/index.ts"
import { engineBusy, engineFlush } from "./browser/engine.ts"
import { attachable } from "./host.ts"
import { servingOf } from "../core/serving.ts"
import { CODE, DEV, WORKTREE } from "./identity.ts"
import { codeRoot, commitAt } from "./storehost.ts"
import { initUpdates, logUpdate, quitUpdates, RELEASE, scheduleUpdates } from "./updates.ts"
import { stopApps } from "./apps.ts"
import { setDictationServer, stopDictation } from "./dictation.ts"
import type { HelperHost } from "./helper.ts"
import type { HelperSlot } from "./helperload.ts"
import { refreshSandbox, sandboxPath } from "./sandbox.ts"
import { permissionFor, whose } from "./apppermissions.ts"
import { mainLog, openMainLog } from "./mainlog.ts"
import { DIST, ICON, LINUX, MAC, ROOT, WIN } from "./mainbase.ts"
import { CONTROLS_HEIGHT } from "./titlebar.ts"
import { buildMenu, devtools, find, helperPrefs, known, nameOf, remotes, save, setHelperPrefs, updates } from "./vaultlist.ts"
import { adopted, handingOver, handOver, helper, helperOn, kept, ownPids, popouts, rootOf, serverFor, setHelper, wins } from "./servers.ts"
import { failedBox, shellReady, uncaught } from "./errors.ts"
import { beginQuit, dev, focusedVault, helperHome, lastFocused, manager, openHome, openVault, quitting, sandbox, setBehind, showManager, startWorktree } from "./vaultwindow.ts"
import { openRemote, remoteWins } from "./remotewin.ts"
import { firstRun, pathDirs, setupWin, showSetup } from "./setupwin.ts"
import { appLink, argFiles, argLinks, openFiles } from "./fromoutside.ts"
import { applyDockIcon, DOCK_ICON } from "./appmenu.ts"
import "./handlers.ts"

openMainLog(app.getPath("logs"))
mainLog(`started: ${CODE?.commit.slice(0, 7) ?? "no build stamp"} from ${ROOT}`)

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
process.on("uncaughtException", (e) => uncaught("uncaught", e))
process.on("unhandledRejection", (e) => uncaught("rejection", e))
if (devtools) {
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1")
  app.commandLine.appendSwitch("remote-debugging-port", String(devtools))
}
let helperAt: HelperSlot | null = null
AppWindow.each((w) => {
  if (!MAC || !helperOn()) return
  void app.dock?.show()
  w.on("closed", () => { if (helperOn() && !AppWindow.getAllWindows().some((x) => x !== w && !x.isDestroyed())) app.dock?.hide() })
})

initUpdates({
  windows: () => [...wins.values()],
  popouts: () => popouts,
  othersOpen: () => remoteWins.size > 0,
  mode: () => updates,
  busy: () => engineBusy(),
  quitting: () => quitting,
  beginQuit: () => { mainLog("quitting for an update"); beginQuit() },
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
  restartServers: () => { for (const w of wins.values()) { w.watch?.restart("an update", (s) => rootOf.get(s) !== codeRoot()); w.web = undefined } },
  restartServer: (u, why) => { for (const w of wins.values()) if (w === u) w.watch?.restart(why) },
  adoptWeb: (dist, commit) => { for (const w of wins.values()) if (w.server?.exitCode === null && w.server.connected) { w.server.send({ type: "adopt-web", dist }); w.web = commit } },
  path: () => [...pathDirs(), process.env.PATH].filter(Boolean).join(path.delimiter),
})

if (!app.isPackaged && QUIET) process.on("SIGUSR2", () => { handOver(); beginQuit(); app.relaunch(relaunchOptions()); app.quit() })

// Sites save their sign-ins as their pages unload.
let unloaded = false
const unloadOnce = () => (unloaded ? Promise.resolve()
  : Promise.race([unloadPages(), new Promise((done) => setTimeout(done, 5000))]).finally(() => { unloaded = true }))
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
  if (!quitting) mainLog("quitting")
  beginQuit()
  if (unloaded) return
  e.preventDefault()
  void unloadOnce().finally(() => app.quit())
})
app.on("will-quit", () => {
  mainLog(handingOver ? "quit: its servers left running for the next launch" : "quit: its servers stopped")
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
  if (process.env.VAULTITE_HELPER === "1" || (MAC && !driven && !DEV && process.env.VAULTITE_HELPER !== "0")) setHelper(await import("./helper.ts"))
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
    prefs: () => helperPrefs, setPrefs: (x) => { setHelperPrefs({ ...helperPrefs, ...x }); save() },
    icon: path.join(ROOT, "electron", "tray", "stoneTemplate.png"),
  }
  if (helper) helperAt = (await import("./helperload.ts")).helperSlot({ now: () => helper, set: setHelper, host: helperHost, log: logUpdate })
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
  setBehind(false)
  launched = true
  setTimeout(() => { if (!wins.size) shellReady(null) }, 20_000)
  if (!MAC && !AppWindow.getAllWindows().length) showManager()
  if (LINUX) unsandboxedNotice()
  scheduleUpdates()
})
