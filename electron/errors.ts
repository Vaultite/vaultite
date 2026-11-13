import { app, clipboard, dialog, shell } from "electron"
import { AppWindow } from "./appwindow.ts"
import { hangReport, hangStarted, LONG_FRAME_LIST, LONG_FRAMES, MAX_SAMPLES, SAMPLE_EVERY_MS, sampled, type Hang, type HangEnd, type LongFrame } from "./hang.ts"
import os from "node:os"
import { CODE, HOST } from "./identity.ts"
import { launchedFrom, updatesReady } from "./updates.ts"
import { plainError, sentence } from "../core/plainerror.ts"
import { mainLog } from "./mainlog.ts"
import { type Win, wins } from "./servers.ts"

// Electron's error box for an uncaught exception stops everything and shows even over the QA scripts' quiet windows.
export function uncaught(kind: "uncaught" | "rejection", e: unknown) {
  const err = e instanceof Error ? e : new Error(String(e))
  mainLog(`main process, ${kind}: ${err.stack ?? err.message}`)
  reportError(kind, `Main process: ${err.message}`, err.stack ?? "")
}
function reportError(kind: string, message: string, stack: string) {
  try {
    const body = JSON.stringify({ device: "desktop", errors: [{ kind, t: Date.now(), message, stack, build: CODE?.commit ?? "" }] })
    for (const w of wins.values()) void fetch(`http://127.0.0.1:${w.port}/api/errors`, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {})
  } catch {}
}
let shellTold = false, shellReported = false
export function shellReady(w: Win | null) {
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
export function failedBox(title: string, e: unknown, o: { why?: string; log?: string } = {}) {
  if (typeof e === "object" && e) { if (told.has(e)) return; told.add(e) }
  const { reason, detail } = plainError(e)
  const box = { type: "warning" as const, message: title, detail: reason ? sentence(reason) : o.why ?? "Something went wrong.",
    buttons: ["OK", "Copy details", ...(o.log ? ["Show log"] : [])], defaultId: 0, cancelId: 0 }
  mainLog(`told the user: ${title}: ${detail}`)
  void dialog.showMessageBox(box).then((r) => {
    if (r.response === 1) clipboard.writeText(`${title}\n${detail}`)
    if (r.response === 2 && o.log) void shell.openPath(o.log)
  })
}

export function hangs(win: AppWindow, name: string) {
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
export function crashedFor(win: AppWindow, name: string) {
  return () => {
    if (win.isDestroyed()) return
    void dialog.showMessageBox(win, { type: "error", message: `${name} keeps stopping`, detail: "Its page crashed three times in a minute.",
      buttons: ["Reload", "Close window"], defaultId: 0, cancelId: 1 }).then((r) => {
      if (win.isDestroyed()) return
      if (r.response === 0) win.webContents.reload(); else win.close()
    }, () => {})
  }
}
