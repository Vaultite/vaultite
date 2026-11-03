/** Dictation: dictation.swift hears the microphone for a window (`vaultite:dictation`) or the menu-bar helper (helper.ts),
 *  one session at a time; it stays a while after, Parakeet loaded, then goes. */
import { app, systemPreferences } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { AppWindow } from "./appwindow.ts"
import { buildDictation, helperName, parakeetModel } from "./dictation-build.ts"

/** Shipped built in the app (tools/build_helpers.ts), else built the first time into userData. */
const SHIPPED = path.join(import.meta.dirname, "bin")
let helper: ChildProcess | null = null
let starting: Promise<ChildProcess> | null = null
/** Who hears the session under way: a window, or the menu-bar helper. */
export type DictationSink = { tell: (m: Record<string, unknown>) => void; win?: AppWindow }
let owner: DictationSink | null = null
let idle: ReturnType<typeof setTimeout> | null = null
const IDLE_MS = 15 * 60_000
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
  const o = owner
  if (o) for (const m of msgs) o.tell(m)
}
const sinks = new WeakMap<AppWindow, DictationSink>()
/** A window's sink: what it's told goes to its page. */
function sinkOf(win: AppWindow) {
  let s = sinks.get(win)
  if (!s) {
    const sink: DictationSink = { win, tell: (m) => { if (!win.isDestroyed()) win.webContents.send("vaultite:dictation", m) } }
    sinks.set(win, sink)
    win.on("closed", () => { if (owner === sink) { send({ cmd: "cancel" }); owner = null } })
    s = sink
  }
  return s
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

export type DictateOptions = { engine?: unknown; language?: unknown; silence?: unknown; words?: unknown; keep?: unknown }
/** Listen for `sink` (another's session ends, "elsewhere"). */
export async function dictate(sink: DictationSink, opts: DictateOptions) {
  const engine = opts.engine === "parakeet" ? "parakeet" : "apple"
  if (!process.env.VAULTITE_DICTATION_FILE && !(await systemPreferences.askForMediaAccess("microphone"))) return { ok: false, code: "permission" }
  const model = engine === "parakeet" ? parakeetModel() : null
  if (engine === "parakeet" && !model) return { ok: false, code: "model" }
  try { await start() } catch (e) { return { ok: false, code: "helper", message: (e as Error).message } }
  if (idle) { clearTimeout(idle); idle = null }
  if (owner && owner !== sink) tell({ type: "end", reason: "elsewhere" })
  owner = sink
  const silence = Number(opts.silence)
  send({ cmd: "start", id: ++sid, engine, language: typeof opts.language === "string" ? opts.language : "", model: model ?? "", silence: Number.isFinite(silence) ? silence : 0,
    words: Array.isArray(opts.words) ? opts.words.filter((w) => typeof w === "string").slice(0, 100).map((w) => w.slice(0, 100)) : [],
    // (Keep the last dictation's audio: in the app's logs, to replay through tools/dictation_bench.ts)
    ...(opts.keep === true ? { record: path.join(app.getPath("logs"), "dictation-last.wav") } : {}),
    // (a script driving the app hears a file instead: web/qa/dictation.mjs)
    ...(process.env.VAULTITE_QUIET && process.env.VAULTITE_DICTATION_FILE ? { file: process.env.VAULTITE_DICTATION_FILE } : {}) })
  return { ok: true }
}
/** Stop (what was heard turns final) or cancel `sink`'s session; another's is left alone. */
export const stopFor = (sink: DictationSink, cancel = false) => { if (owner === sink) send({ cmd: cancel ? "cancel" : "stop" }) }
export const dictating = () => owner
export { engines as dictationEngines }

export const dictationHandlers: Record<string, (win: AppWindow, ...args: unknown[]) => unknown> = {
  "dictation:engines": (_win, language) => engines(typeof language === "string" ? language : ""),
  "dictation:start": (win, o) => dictate(sinkOf(win), (o && typeof o === "object" ? o : {}) as DictateOptions),
  "dictation:stop": (win) => stopFor(sinkOf(win)),
  "dictation:cancel": (win) => stopFor(sinkOf(win), true),
}

export function stopDictation() {
  if (idle) { clearTimeout(idle); idle = null }
  const h = helper
  helper = null
  owner = null
  if (h && h.exitCode === null) { h.stdin?.end(); setTimeout(() => { if (h.exitCode === null) h.kill() }, 3000) }
}
