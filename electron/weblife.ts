import { BaseWindow, dialog, type WebContents } from "electron"
import { AppWindow } from "./appwindow.ts"
import { mayPicture, pageKept } from "./browser/engine.ts"
import { shown } from "./pagespot.ts"
import { discardable, RECLAIM_MS, unclaimed, windowReloaded } from "./webpages.ts"
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import { MAC, type Page, pages, pagesChanged, playingNow, shows } from "./webbase.ts"
import { endSpare, spare } from "./websession.ts"
import { addPage, raise, run } from "./webstack.ts"
import { fit, move, seeDraws, stow } from "./webspot.ts"
import { fromPlayer, leaveFull } from "./webplayer.ts"

export function moveTo(p: Page, win: AppWindow) {
  const from = p.win
  run(from, { type: "gone", page: p.id })
  if (!from.isDestroyed() && !p.player) from.contentView.removeChildView(p.view)
  if (p.full && !p.player) leaveFull(p)
  p.win = win
  move(p, { type: "hide" })
  if (!p.player) addPage(win, p.view)
  if (!from.isDestroyed()) pagesChanged(from)
}

export function own(p: Page, tab: string) {
  if (!pages.has(p.id) || p.closing) return
  p.tab = tab
  p.agent = !tab
  if (!tab) { p.want = null; fromPlayer(p); if (p.full) leaveFull(p) }
  fit(p)
  pagesChanged(p.win)
}

export function end(p: Page) {
  pages.delete(p.id)
  run(p.win, { type: "gone", page: p.id })
  clearTimeout(p.hush)
  clearTimeout(p.linger)
  fromPlayer(p)
  pagesChanged(p.win)
  keepPast(p, true)
  const shot = keepFrame(p)
  move(p, { type: "hide" })
  const off = () => { if (!p.win.isDestroyed()) p.win.contentView.removeChildView(p.view) }
  const wc = p.view.webContents
  if (!shot) { off(); if (wc) void unload(wc); return }
  void shot.finally(() => { off(); void unload(wc) })
}

/** Close a page as a browser closes a tab: its beforeunload and unload run first (sites save state there, Discord its
 *  sign-in), never asking to stay; 3 s at most. Resolves once it's gone. */
function unload(wc: WebContents) {
  if (wc.isDestroyed()) return Promise.resolve()
  const gone = new Promise<void>((done) => wc.once("destroyed", () => done()))
  unloading.add(wc)
  wc.once("will-prevent-unload", (e) => e.preventDefault())
  wc.close({ waitForBeforeUnload: true })
  const hard = setTimeout(() => { if (!wc.isDestroyed()) wc.close() }, 3000)
  return gone.finally(() => clearTimeout(hard))
}

export const unloading = new WeakSet<WebContents>()
export const reloaded = new WeakMap<WebContents, number>()
/** Whether a page asking to stay (its beforeunload) leaves: at once with nobody to ask (`quiet`, closing), else as the
 *  user answers Chrome's question, the page waiting (Electron takes the answer synchronously). */
export function mayLeave(wc: WebContents, win: BaseWindow, quiet: boolean) {
  if (quiet || unloading.has(wc) || win.isDestroyed()) return true
  const reload = Date.now() - (reloaded.get(wc) ?? 0) < 2000
  return dialog.showMessageBoxSync(win, { type: "question", message: reload ? "Reload site?" : "Leave site?", detail: "Changes you made may not be saved.",
    buttons: [reload ? "Reload" : "Leave", "Cancel"], defaultId: 0, cancelId: 1, noLink: true }) === 0
}

export const unloadPages = async () => {
  for (const p of pages.values()) keepPast(p, true)
  restoreMod?.savePasts()
  await Promise.race([Promise.all([...pages.values()].filter((p) => shown(p.spot)).map(keepFrame)), new Promise((done) => setTimeout(done, 800))])
  return Promise.all([...pages.values()].map((p) => { p.closing = true; return unload(p.view.webContents) })).then(() => {})
}

export async function trim() {
  const keep = (p: Page) => !!p.player || playingNow(p) || pageKept(p.id)
  if ((!spare && !discardable(pages.values(), keep).length) || !(await shortOfMemory())) return
  endSpare()
  for (const p of discardable(pages.values(), keep)) end(p)
}
setInterval(() => void trim(), 60_000).unref()

function shortOfMemory(): Promise<boolean> {
  if (process.platform === "win32") return Promise.resolve(os.freemem() / os.totalmem() < 0.1)
  if (MAC) return new Promise((done) => execFile("/usr/sbin/sysctl", ["-n", "kern.memorystatus_vm_pressure_level"], { timeout: 2000 }, (e, out) => done(!e && Number(out) >= 2)))
  try {
    const m = fs.readFileSync("/proc/meminfo", "utf8"), kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(m)?.[1] ?? 0)
    return Promise.resolve(kb("MemTotal") > 0 && kb("MemAvailable") / kb("MemTotal") < 0.1)
  } catch { return Promise.resolve(false) }
}

export function revive(wc: WebContents, gone?: () => void, giveUp?: () => void) {
  let times: number[] = []
  wc.on("render-process-gone", (_e, d) => {
    if (d.reason === "clean-exit" || wc.isDestroyed()) return
    gone?.()
    const now = Date.now()
    times = times.filter((t) => now - t < 60_000)
    console.error(`vaultite: a page's process ended (${d.reason}, exit ${d.exitCode}): ${times.length < 3 ? "reloading" : "left, it keeps ending"}`)
    if (times.length >= 3) return giveUp?.()
    times.push(now)
    setTimeout(() => { if (!wc.isDestroyed()) wc.reload() }, 300)
  })
}

export function webWindow(win: AppWindow) {
  win.contentView.on("bounds-changed", () => { for (const p of pages.values()) if (p.win === win && p.full && !p.player) fit(p) })
  win.on("leave-full-screen", () => { for (const p of pages.values()) if (p.win === win && p.full && !p.player) leaveFull(p) })
  win.on("focus", () => { for (const p of pages.values()) if (p.win === win && p.drawn && shown(p.spot)) void seeDraws(p) })
  win.on("closed", () => {
    for (const p of [...pages.values()]) if (p.win === win && p.moving === undefined) end(p)
    if (!pages.size) endSpare()
  })
  win.webContents.on("did-start-navigation", (d) => {
    if (!d.isMainFrame || d.isSameDocument) return
    raise(win, null)
    for (const p of pages.values()) if (p.win === win && !p.player) { if (p.full) leaveFull(p); p.want = null; stow(p) }
    for (const p of windowReloaded(pages.values(), win, Date.now())) end(p)
    setTimeout(() => { for (const p of unclaimed(pages.values(), Date.now(), (x) => pageKept(x.id))) end(p) }, RECLAIM_MS + 100)
  })
}

export let restoreMod: typeof import("./webrestore.ts") | null = null
export const restore = async () => (restoreMod ??= await import("./webrestore.ts"))
export function keepPast(p: Page, settle = false) {
  const wc = p.view.webContents
  if (!p.tab || p.agent || !wc || wc.isDestroyed() || p.blankBehind || p.restoring || !restoreMod) return
  const h = wc.navigationHistory
  restoreMod.keepPast(p.tab, p.profile, h.getAllEntries(), h.getActiveIndex(), shows, settle)
}
const FRAME_MS = 1500
function keepFrame(p: Page): Promise<void> | null {
  const wc = p.view.webContents
  if (!p.tab || p.agent || p.fresh || p.error || p.crashed || !wc || wc.isDestroyed() || p.win.isDestroyed() || !shows(wc.getURL()) || !mayPicture(p.profile)) return null
  const tab = p.tab, b = p.view.getBounds(), z = p.win.webContents.getZoomFactor()
  const f = { url: wc.getURL(), profile: p.profile, width: Math.round(b.width / z), height: Math.round(b.height / z) }
  if (b.width < 2 || b.height < 2) return null
  // (bounded: on Linux a page just back from its closing player never gets its capture, and its close waits on this)
  const img = Promise.race([wc.capturePage(), new Promise<null>((r) => setTimeout(r, FRAME_MS, null).unref())])
  return img.then(async (i) => { if (i) (await restore()).keepFrame(tab, i, f) }).catch(() => {})
}
