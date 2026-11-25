// What the first window doesn't wait for: main.ts imports it once one is made; calls from before wait (rest.ts).
import { app } from "electron"
import module from "node:module"
import path from "node:path"
import { AppWindow } from "./appwindow.ts"
import "./browser/index.ts"
import { engineBusy, engineFlush, setServerSink } from "./browser/engine.ts"
import { unloadPages } from "./web.ts"
import { initUpdates, logUpdate, quitUpdates, scheduleUpdates } from "./updates.ts"
import { stopApps } from "./apps.ts"
import { setDictationServer, stopDictation } from "./dictation.ts"
import type { HelperHost } from "./helper.ts"
import type { HelperSlot } from "./helperload.ts"
import { servingOf } from "../core/serving.ts"
import { codeRoot, commitAt } from "./storehost.ts"
import { ROOT } from "./mainbase.ts"
import { buildMenu, helperPrefs, nameOf, save, setHelperPrefs, updates } from "./vaultlist.ts"
import { desktopEvent, handOver, helper, kept, ownPids, popouts, rootOf, setHelper, wins } from "./servers.ts"
import { beginQuit, lastFocused, openHome, quitting } from "./vaultwindow.ts"
import { remoteWins } from "./remotewin.ts"
import { onCloud } from "./cloudheard.ts"
import { pathDirs } from "./setupwin.ts"
import { mainLog } from "./mainlog.ts"
import { shellReady } from "./shellready.ts"
import "./appmenu.ts"
import "./handlers.ts"

export { webWindow } from "./web.ts"
export { appsWindow } from "./apps.ts"
export { serverCall } from "./browser/engine.ts"
export { talkCall } from "./talklog.ts"
export { appUpdates, checkInstalled, lookNow, mainBehind, restartToUpdate, worktreeChanged, worktreeNow } from "./updates.ts"

let helperAt: HelperSlot | null = null

// Sites save their sign-ins as their pages unload.
let unloaded = false
export const unloadedAll = () => unloaded
export const unloadOnce = () => (unloaded ? Promise.resolve()
  : Promise.race([unloadPages(), new Promise((done) => setTimeout(done, 5000))]).finally(() => { unloaded = true }))

setServerSink((win, name, data) => { for (const w of wins.values()) if (w.win === win) desktopEvent(w, name, data) })
initUpdates({
  windows: () => [...wins.values()],
  popouts: () => popouts,
  othersOpen: () => remoteWins.size > 0,
  mode: () => updates,
  busy: () => engineBusy() ?? helper?.helperBusy() ?? null,
  talked: () => helper?.helperTalked() ?? Infinity,
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
app.on("will-quit", () => {
  stopApps()
  stopDictation()
  quitUpdates()
})

const homePath = () => lastFocused && (wins.has(lastFocused) || kept.has(lastFocused)) ? lastFocused : [...wins.keys()][0] ?? [...kept.keys()][0]
const helperHost = async (): Promise<HelperHost> => ({
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
  cloud: onCloud,
})

export async function startRest(withHelper: boolean) {
  if (withHelper) setHelper(await import("./helper.ts"))
  setDictationServer((win) => {
    const p = win ? [...wins.values()].find((w) => w.win === win)?.vault.path : homePath()
    return (p ? wins.get(p)?.port ?? kept.get(p)?.port : null) ?? null
  })
  if (helper) {
    const host = await helperHost()
    helperAt = (await import("./helperload.ts")).helperSlot({ now: () => helper, set: setHelper, host, log: logUpdate })
    await helper.startHelper(host)
  }
  buildMenu()
}

export function launchDone() {
  setTimeout(() => { if (!wins.size) shellReady(null) }, 20_000)
  scheduleUpdates()
  setTimeout(() => module.flushCompileCache?.(), 3000)
}
