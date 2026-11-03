/** Dictation (⌘J): the helper (dictation.swift) hears this Mac's microphone and tells the window that asked (events on
 *  `vaultite:dictation`). One session at a time; the helper stays a while after, Parakeet loaded, then goes. */
import { app, systemPreferences } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { AppWindow } from "./appwindow.ts"
import { buildDictation, helperName } from "./dictation-build.ts"

/** Shipped built in the app (tools/build_helpers.ts), else built the first time into userData. */
const SHIPPED = path.join(import.meta.dirname, "bin")
let helper: ChildProcess | null = null
let starting: Promise<ChildProcess> | null = null
let owner: AppWindow | null = null
let idle: ReturnType<typeof setTimeout> | null = null
const IDLE_MS = 15 * 60_000
const watched = new WeakSet<AppWindow>()
/** The session under way's number: what the helper says of an earlier one (its end, after another started) is dropped. */
let sid = 0
let checked: ((msg: Record<string, unknown>) => void)[] = []

async function binary() {
  const shipped = path.join(SHIPPED, helperName())
  if (fs.existsSync(shipped)) return shipped
  return buildDictation(path.join(app.getPath("userData"), "bin"))
}

function start(): Promise<ChildProcess> {
  if (helper && helper.exitCode === null && !helper.killed) return Promise.resolve(helper)
  starting ??= binary().then((bin) => {
    const child = spawn(bin, [], { stdio: ["pipe", "pipe", "ignore"] })
    let buf = ""
    child.stdout!.on("data", (b: Buffer) => {
      buf += b.toString()
      for (let i; (i = buf.indexOf("\n")) >= 0;) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let msg: Record<string, unknown>
        try { msg = JSON.parse(line) } catch { continue }
        heard(msg)
      }
    })
    child.on("error", () => { if (child.exitCode === null && !child.killed) child.kill(); child.emit("exit") })
    child.stdin!.on("error", () => {})
    child.once("exit", () => {
      if (helper !== child) return
      helper = null
      for (const done of checked.splice(0)) done({ apple: false, parakeet: false })
      if (owner) tell({ type: "error", code: "helper", message: "Dictation stopped unexpectedly" }, { type: "end", reason: "error" })
      owner = null
    })
    helper = child
    return child
  }).finally(() => { starting = null })
  return starting
}

function send(cmd: Record<string, unknown>) { helper?.stdin?.write(JSON.stringify(cmd) + "\n") }

function tell(...msgs: Record<string, unknown>[]) {
  const w = owner
  if (!w || w.isDestroyed()) return
  for (const m of msgs) w.webContents.send("vaultite:dictation", m)
}

function heard(m: Record<string, unknown>) {
  if (m.type === "engines") { for (const done of checked.splice(0)) done(m); return }
  if (m.type === "ready" || (typeof m.id === "number" && m.id !== sid)) return
  tell(m)
  if (m.type === "end") {
    owner = null
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => { if (!owner) stopDictation() }, IDLE_MS)
  }
}

// ---------- Parakeet's model: Handy's or Hex's download, used where it is

const MODEL = "parakeet-unified-en-0.6b"
/** The GGUF of parakeet-unified-en-0.6b on this Mac (Q8_0 first): Hex's, Hugging Face's cache (Handy's), Handy's. */
export function parakeetModel(home = os.homedir()): string | null {
  const support = path.join(home, "Library", "Application Support")
  const hub = process.env.HF_HUB_CACHE || path.join(process.env.HF_HOME || path.join(home, ".cache", "huggingface"), "hub")
  const snapshots = path.join(hub, `models--handy-computer--${MODEL}-gguf`, "snapshots")
  const dirs = [path.join(support, "hex", "models"), path.join(support, "com.pais.handy", "models")]
  try { dirs.splice(1, 0, ...fs.readdirSync(snapshots).map((s) => path.join(snapshots, s))) } catch { /* none */ }
  const found = dirs.flatMap((d) => { try { return fs.readdirSync(d).filter((f) => f.startsWith(MODEL) && f.endsWith(".gguf")).map((f) => path.join(d, f)) } catch { return [] } })
    .filter((f) => { try { return fs.statSync(f).size > 100_000_000 } catch { return false } })
  return found.find((f) => f.includes("Q8_0")) ?? found[0] ?? null
}

/** What dictates here: Apple's engine (macOS 26, in `language`), and Parakeet (with its model found). */
async function engines(language: string) {
  try { await start() } catch (e) { return { apple: false, parakeet: false, why: (e as Error).message } }
  const r = await new Promise<Record<string, unknown>>((done) => {
    checked.push(done)
    send({ cmd: "check", language })
    setTimeout(() => { checked = checked.filter((d) => d !== done); done({ apple: false, parakeet: false }) }, 10_000)
  })
  const model = r.parakeet ? parakeetModel() : null
  return { apple: !!r.apple, locale: r.locale, parakeet: !!model, ...(r.parakeet && !model ? { why: "no-model" } : {}) }
}

export const dictationHandlers: Record<string, (win: AppWindow, ...args: unknown[]) => unknown> = {
  "dictation:engines": (_win, language) => engines(typeof language === "string" ? language : ""),
  "dictation:start": async (win, o) => {
    const opts = (o && typeof o === "object" ? o : {}) as Record<string, unknown>
    const engine = opts.engine === "parakeet" ? "parakeet" : "apple"
    if (!process.env.VAULTITE_DICTATION_FILE && !(await systemPreferences.askForMediaAccess("microphone"))) return { ok: false, code: "permission" }
    const model = engine === "parakeet" ? parakeetModel() : null
    if (engine === "parakeet" && !model) return { ok: false, code: "model" }
    try { await start() } catch (e) { return { ok: false, code: "helper", message: (e as Error).message } }
    if (idle) { clearTimeout(idle); idle = null }
    if (owner && owner !== win) tell({ type: "end", reason: "elsewhere" })
    owner = win
    if (!watched.has(win)) { watched.add(win); win.on("closed", () => { watched.delete(win); if (owner === win) { send({ cmd: "cancel" }); owner = null } }) }
    const silence = Number(opts.silence)
    send({ cmd: "start", id: ++sid, engine, language: typeof opts.language === "string" ? opts.language : "", model: model ?? "", silence: Number.isFinite(silence) ? silence : 10,
      // (a script driving the app hears a file instead: web/qa/dictation.mjs)
      ...(process.env.VAULTITE_QUIET && process.env.VAULTITE_DICTATION_FILE ? { file: process.env.VAULTITE_DICTATION_FILE } : {}) })
    return { ok: true }
  },
  "dictation:stop": (win) => { if (owner === win) send({ cmd: "stop" }) },
  "dictation:cancel": (win) => { if (owner === win) send({ cmd: "cancel" }) },
}

export function stopDictation() {
  if (idle) { clearTimeout(idle); idle = null }
  const h = helper
  helper = null
  owner = null
  if (h && h.exitCode === null) { h.stdin?.end(); setTimeout(() => { if (h.exitCode === null) h.kill() }, 3000) }
}
