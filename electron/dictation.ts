/** Dictation: dictation.swift hears the microphone for a window (`vaultite:dictation`) or the menu-bar helper (helper.ts),
 *  one session at a time, through Soniox or this Mac's engine; it stays a while after, Parakeet loaded, then goes. */
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

/** The port of the server a sink's vault is on (main.ts sets it): no window, the home vault's. */
let serverOf: (win?: AppWindow) => number | null = () => null
export const setDictationServer = (f: typeof serverOf) => { serverOf = f }

type Cloud = { url: string; key: string; model?: string; languages: string[] }
/** Soniox's key and settings, when the vault's server says it hears this one (plugins/core/dictation/plugin.ts), or
 *  why it doesn't though asked to. Unanswered, this Mac's engine. */
async function cloudFor(sink: DictationSink, language: string): Promise<{ cloud?: Cloud; why?: string }> {
  const port = serverOf(sink.win)
  if (!port) return {}
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/dictation/cloud`, { headers: { "X-Vaultite-Client": "app/desktop" }, signal: AbortSignal.timeout(2000) })
    const c = (r.ok ? await r.json() : {}) as Partial<Cloud> & { why?: string }
    if (!c.url || !c.key) return { why: c.why }
    // (no languages set: the one asked for and the Mac's, as hints; Soniox switches between them on its own)
    const said = c.languages?.length ? c.languages : [language, ...app.getPreferredSystemLanguages()]
    const languages = [...new Set(said.map((l) => l.split(/[-_]/)[0].toLowerCase()).filter((l) => /^[a-z]{2,3}$/.test(l)))].slice(0, 6)
    return { cloud: { url: c.url, key: c.key, model: c.model, languages } }
  } catch { return {} }
}

const starts = new Set<() => void>()
/** Told as any dictation starts (a window's, the helper's): the companion's voice stops, never heard by the microphone. */
export const onDictating = (fn: () => void) => { starts.add(fn); return () => starts.delete(fn) }

export type DictateOptions = { engine?: unknown; language?: unknown; silence?: unknown; words?: unknown; keep?: unknown }
/** Listen for `sink` (another's session ends, "elsewhere"): through Soniox when its key is set, this Mac's engine
 *  (`engine`) taking over should it fail. */
export async function dictate(sink: DictationSink, opts: DictateOptions) {
  let engine = opts.engine === "parakeet" ? "parakeet" : "apple"
  const language = typeof opts.language === "string" ? opts.language : ""
  const [allowed, { cloud, why }] = await Promise.all([process.env.VAULTITE_DICTATION_FILE ? true : systemPreferences.askForMediaAccess("microphone"), cloudFor(sink, language)])
  if (!allowed) return { ok: false, code: "permission" }
  for (const fn of starts) fn()
  let model = engine === "parakeet" ? parakeetModel() : null
  if (engine === "parakeet" && !model) {
    if (!cloud) return { ok: false, code: "model" }
    engine = "apple"
    model = null
  }
  try { await start() } catch (e) { return { ok: false, code: "helper", message: (e as Error).message } }
  if (idle) { clearTimeout(idle); idle = null }
  if (owner && owner !== sink) tell({ type: "end", reason: "elsewhere" })
  owner = sink
  const silence = Number(opts.silence)
  send({ cmd: "start", id: ++sid, engine, language, model: model ?? "", silence: Number.isFinite(silence) ? silence : 0, ...(cloud ? { cloud } : {}),
    words: Array.isArray(opts.words) ? opts.words.filter((w) => typeof w === "string").slice(0, 100).map((w) => w.slice(0, 100)) : [],
    // (Keep the last dictation's audio: in the app's logs, to replay through tools/dictation_bench.ts)
    ...(opts.keep === true ? { record: path.join(app.getPath("logs"), "dictation-last.wav") } : {}),
    // (a script driving the app hears a file instead: web/qa/dictation.mjs)
    ...(process.env.VAULTITE_QUIET && process.env.VAULTITE_DICTATION_FILE ? { file: process.env.VAULTITE_DICTATION_FILE } : {}) })
  if (why) tell({ type: "fallback", message: why })
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
