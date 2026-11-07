/** Dictation: dictation.swift hears the microphone for a window (`vaultite:dictation`) or the menu-bar helper (helper.ts),
 *  one session at a time, through Soniox or this Mac's engine; it stays a while after, Parakeet loaded, then goes. */
import { app, systemPreferences } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"
import type { AppWindow } from "./appwindow.ts"
import { dictationSwift, parakeetModel } from "./dictation-build.ts"
import { replacer } from "../core/dictationtext.ts"
import { pickMic, type Devices, type MicPick } from "./miclogic.ts"

/** Shipped built in the app (tools/build_helpers.ts), else built the first time into userData. */
let helper: ChildProcess | null = null
let starting: Promise<ChildProcess> | null = null
/** Who hears the session under way: a window, or the menu-bar helper. */
export type DictationSink = { tell: (m: Record<string, unknown>) => void; win?: AppWindow
  /** The microphone's audio as it comes (16-bit, 16 kHz), when its session was started with `tap`. */
  audio?: (pcm: Buffer) => void }
let owner: DictationSink | null = null
let idle: ReturnType<typeof setTimeout> | null = null
const IDLE_MS = 15 * 60_000
/** The session under way's number: what the helper says of an earlier one (its end, after another started) is dropped. */
let sid = 0
let checked: ((msg: Record<string, unknown>) => void)[] = []
/** This Mac's audio devices as the helper last told them (again at each change), and who waits for the first list. */
let devices: Devices | null = null
let listed: (() => void)[] = []
const deviceWatchers = new Set<(d: Devices) => void>()
/** Told the devices as they change (while the helper runs): what the mic would be now. */
export const onAudioDevices = (fn: (d: Devices) => void) => { deviceWatchers.add(fn); if (devices) fn(devices); return () => deviceWatchers.delete(fn) }
/** A Bluetooth mic held open past its session (dictation.swift `hold`), till releaseMic. */
let heldMic = ""

const binary = () => dictationSwift.binary(path.join(app.getPath("userData"), "bin"))

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
      devices = null
      heldMic = ""
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

/** The session's replacements (the dictionary's "said: written", the server's), applied to what it hears. */
let swap: [RegExp, string][] = []
const swapped = (m: Record<string, unknown>) => (swap.length && (m.type === "pending" || m.type === "final") && typeof m.text === "string"
  ? { ...m, text: swap.reduce((x, [re, to]) => x.replace(re, to), m.text) } : m)
function tell(...msgs: Record<string, unknown>[]) {
  const o = owner
  if (o) for (const m of msgs) o.tell(swapped(m))
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
  if (m.type === "devices") {
    devices = { devices: Array.isArray(m.devices) ? m.devices : [], input: String(m.input ?? ""), output: String(m.output ?? "") }
    for (const done of listed.splice(0)) done()
    for (const fn of deviceWatchers) fn(devices)
    return
  }
  if (m.type === "mic-held") { heldMic = String(m.name ?? ""); return }
  if (m.type === "mic-released") { heldMic = ""; return }
  if (m.type === "ready" || (typeof m.id === "number" && m.id !== sid)) return
  if (m.type === "audio") return void owner?.audio?.(Buffer.from(String(m.data ?? ""), "base64"))
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
type Words = { terms: string[]; replacements: [string, string][] }
/** What the vault's server last said to expect, for the realtime voice (its instructions name them). */
let lastWords: Words = { terms: [], replacements: [] }
export const expectedWords = () => lastWords
/** Soniox's key when the vault's server says it hears this one (plugins/core/dictation/plugin.ts), else why not; and
 *  the words to expect and what's written for what's said (the dictionary's, Vaultite's, the vault's names). */
async function cloudFor(sink: DictationSink, language: string): Promise<{ cloud?: Cloud; why?: string } & Words> {
  const port = serverOf(sink.win)
  if (!port) return lastWords
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/dictation/cloud`, { headers: { "X-Vaultite-Client": "app/desktop" }, signal: AbortSignal.timeout(2000) })
    const c = (r.ok ? await r.json() : {}) as Partial<Cloud> & { why?: string; terms?: unknown; replacements?: unknown }
    const terms = Array.isArray(c.terms) ? c.terms.filter((t): t is string => typeof t === "string") : []
    const replacements = Array.isArray(c.replacements) ? c.replacements.filter((x): x is [string, string] => Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "string") : []
    if (r.ok) lastWords = { terms, replacements }
    const words = lastWords
    if (!c.url || !c.key) return { why: c.why ?? (r.ok ? undefined : `Vaultite's server answered ${r.status}`), ...words }
    // (no languages set: the one asked for and the Mac's, as hints; Soniox switches between them on its own)
    const said = c.languages?.length ? c.languages : [language, ...app.getPreferredSystemLanguages()]
    const languages = [...new Set(said.map((l) => l.split(/[-_]/)[0].toLowerCase()).filter((l) => /^[a-z]{2,3}$/.test(l)))].slice(0, 6)
    return { cloud: { url: c.url, key: c.key, model: c.model, languages }, ...words }
  } catch (e) { return { why: `Vaultite's server didn't answer (${(e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message})`, ...lastWords } }
}

/** The words a recognizer is told to expect, cleaned. */
export const termsOf = (terms: string[]) => [...new Set(terms.filter((w) => !!w.trim()).map((w) => w.trim().slice(0, 100)))].slice(0, 100)

const starts = new Set<() => void>()
/** Told as any dictation starts (a window's, the helper's): the companion's voice stops, never heard by the microphone. */
export const onDictating = (fn: () => void) => { starts.add(fn); return () => starts.delete(fn) }

export type DictateOptions = { engine?: unknown; language?: unknown; silence?: unknown; keep?: unknown; tap?: boolean
  /** The setting `microphone` (miclogic.ts); `hold`: a Bluetooth mic stays open after, till releaseMic (a Talk key's). */
  microphone?: unknown; hold?: boolean }
/** The devices: as told, else the first list a fresh helper tells (a moment at most). */
async function listedDevices() {
  if (devices || !helper) return devices
  await new Promise<void>((done) => { listed.push(done); setTimeout(done, 400) })
  return devices
}
/** Listen for `sink` (another's session ends, "elsewhere"): through Soniox when its key is set, this Mac's engine
 *  (`engine`) taking over should it fail. Says which hears (`engine`), and `why` not Soniox when it was asked for. */
export async function dictate(sink: DictationSink, opts: DictateOptions): Promise<{ ok: boolean; code?: string; message?: string; engine?: string; why?: string; mic?: MicPick }> {
  let engine = opts.engine === "parakeet" ? "parakeet" : "apple"
  const language = typeof opts.language === "string" ? opts.language : ""
  // (a copy a script drives hears a file, never the microphone: it can't take the user's)
  if (process.env.VAULTITE_QUIET && !process.env.VAULTITE_DICTATION_FILE) return { ok: false, code: "quiet" }
  const [allowed, { cloud, why, terms, replacements }] = await Promise.all([process.env.VAULTITE_DICTATION_FILE ? true : systemPreferences.askForMediaAccess("microphone"), cloudFor(sink, language)])
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
  const file = !!(process.env.VAULTITE_QUIET && process.env.VAULTITE_DICTATION_FILE)
  const mic = file ? undefined : pickMic(opts.microphone, await listedDevices())
  if (owner && owner !== sink) tell({ type: "end", reason: "elsewhere" })
  owner = sink
  swap = replacer(replacements.map(([s, w]) => `${s}: ${w}`))
  const silence = Number(opts.silence)
  send({ cmd: "start", id: ++sid, engine, language, model: model ?? "", silence: Number.isFinite(silence) ? silence : 0, ...(cloud ? { cloud } : {}), ...(opts.tap ? { tap: true } : {}),
    ...(mic ? { mic: [mic.uid, ...mic.fallback].filter(Boolean), hold: opts.hold === true } : {}),
    words: termsOf(terms),
    // (Keep the last dictation's audio: in the app's logs, to replay through tools/dictation_bench.ts)
    ...(opts.keep === true ? { record: path.join(app.getPath("logs"), "dictation-last.wav") } : {}),
    // (a script driving the app hears a file instead: web/qa/dictation.mjs)
    ...(file ? { file: process.env.VAULTITE_DICTATION_FILE } : {}) })
  if (why && !cloud) tell({ type: "fallback", message: why })
  return { ok: true, engine: cloud ? "soniox" : engine, ...(why && !cloud ? { why } : {}), ...(mic ? { mic } : {}) }
}
/** The Bluetooth mic held past its session closed: its answer is said. */
export const releaseMic = () => { heldMic = ""; send({ cmd: "release" }) }
/** The mic held open past its session, if one is ("" none). */
export const micHeld = () => heldMic
/** Stop (what was heard turns final) or cancel `sink`'s session; another's is left alone. */
export const stopFor = (sink: DictationSink, cancel = false) => { if (owner === sink) send({ cmd: cancel ? "cancel" : "stop" }) }
/** Hands-free: its session stops only when told, whatever the setting `silence`. */
export const freeFor = (sink: DictationSink) => { if (owner === sink) send({ cmd: "free" }) }
/** The session under way goes on for `to`, with what it hears from now. */
export const handOver = (from: DictationSink, to: DictationSink) => { if (owner !== from) return false; owner = to; return true }
/** `pending`: its words not settled yet; `held`: its key is down; `free`: hands-free; `start`: none under way, there's nowhere to dictate in the window. */
export type Roam = { pending?: string; held?: boolean; free?: boolean; start?: boolean }
/** Who takes a window's session when it leaves it (the menu-bar helper), and stops one it has. */
let roamer: { take: (win: AppWindow, sink: DictationSink, o: Roam) => boolean; stop: () => boolean } | null = null
export const onRoam = (r: NonNullable<typeof roamer>) => { roamer = r }
export const dictating = () => owner
export { engines as dictationEngines }

export const dictationHandlers: Record<string, (win: AppWindow, ...args: unknown[]) => unknown> = {
  "dictation:engines": (_win, language) => engines(typeof language === "string" ? language : ""),
  // (one under way with the helper, roaming: this press stops it, as in the window it began in)
  "dictation:start": (win, o) => (roamer?.stop() ? { ok: false, code: "roaming" } : dictate(sinkOf(win), (o && typeof o === "object" ? o : {}) as DictateOptions)),
  "dictation:roam": (win, o) => roamer?.take(win, sinkOf(win), (o && typeof o === "object" ? o : {}) as Roam) ?? false,
  "dictation:free": (win) => freeFor(sinkOf(win)),
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
