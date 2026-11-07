/** Dictation: dictation.swift hears the microphone for a window (`vaultite:dictation`) or the menu-bar helper (helper.ts),
 *  one session at a time, through Soniox or this Mac's engine; it stays a while after, Parakeet loaded, then goes. */
import { app, systemPreferences } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { AppWindow } from "./appwindow.ts"
import { dictationSwift, parakeetModel } from "./dictation-build.ts"
import { replacer } from "../core/dictationtext.ts"
import { pickMic, type Devices, type MicPick } from "./miclogic.ts"
import type { Keeping } from "./dictationkeep.ts"

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
      keeping?.end("error")
      keeping = null
      owner = null
    })
    helper = child
    return child
  }).finally(() => { starting = null })
  return starting
}

function send(cmd: Record<string, unknown>) { if (TEXT) return typed(cmd); helper?.stdin?.write(JSON.stringify(cmd) + "\n") }

/** A script on a Mac with no recognizer here (macOS 15, Linux): the words "heard" at each start, read from this file
 *  then (web/qa/helper-offer.mjs), no helper; its session ends when stopped, as a file's does. */
const TEXT = process.env.VAULTITE_QUIET ? process.env.VAULTITE_DICTATION_TEXT : undefined
function typed(cmd: Record<string, unknown>) {
  const id = sid, words = () => { try { return fs.readFileSync(TEXT!, "utf8").trim() } catch { return "" } }
  if (cmd.cmd === "start") return void setTimeout(() => { if (sid === id) heard({ type: "pending", id, text: words() }) }, 300)
  if (cmd.cmd !== "stop" && cmd.cmd !== "cancel") return
  if (cmd.cmd === "stop") { heard({ type: "final", id, text: words() }); heard({ type: "pending", id, text: "" }) }
  heard({ type: "end", id, reason: cmd.cmd })
}

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
    win.on("closed", () => { if (owner === sink) { send({ cmd: "cancel" }); keeping?.end("closed"); keeping = null; owner = null } })
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
  if (keeping && (m.type === "final" || m.type === "pending")) {
    const text = String(swapped(m).text ?? "")
    // (a window's words are typed in as they settle; the helper's land when it stops)
    if (m.type === "final") keeping.words(text, !!owner?.win && !owner.win.isDestroyed())
    else keeping.pending(text)
  }
  if (m.type === "end") {
    keeping?.end(String(m.reason ?? ""))
    keeping = null
    owner = null
    if (idle) clearTimeout(idle)
    rest()
  }
}

/** What dictates here: Apple's engine (macOS 26, in `language`), and Parakeet (with its model found). */
async function engines(language: string) {
  if (TEXT) return { apple: true, locale: language || "en-US", parakeet: false }
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
/** What the vault's server last said to expect, for the realtime voice (its instructions name them); `keep`: the
 *  setting Keep dictations. */
let lastWords: Words & { keep?: boolean } = { terms: [], replacements: [] }
export const expectedWords = () => lastWords
/** Soniox's key when the vault's server says it hears this one (plugins/core/dictation/plugin.ts), else why not; and
 *  the words to expect and what's written for what's said (the dictionary's, Vaultite's, the vault's names). */
async function cloudFor(sink: DictationSink, language: string): Promise<{ cloud?: Cloud; why?: string; keep?: boolean } & Words> {
  const port = serverOf(sink.win)
  if (!port) return lastWords
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/dictation/cloud`, { headers: { "X-Vaultite-Client": "app/desktop" }, signal: AbortSignal.timeout(2000) })
    const c = (r.ok ? await r.json() : {}) as Partial<Cloud> & { why?: string; terms?: unknown; replacements?: unknown; keep?: unknown }
    const terms = Array.isArray(c.terms) ? c.terms.filter((t): t is string => typeof t === "string") : []
    const replacements = Array.isArray(c.replacements) ? c.replacements.filter((x): x is [string, string] => Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "string") : []
    if (r.ok) lastWords = { terms, replacements, keep: c.keep !== false }
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
  microphone?: unknown; hold?: boolean
  /** Where its words go, for the Dictations list (dictationkeep.ts); false: not kept (a Talk key's ask: the companion keeps it). */
  where?: unknown }
/** The devices: as told, else the first list a fresh helper tells (a moment at most). */
async function listedDevices(ms = 400) {
  if (devices || !helper) return devices
  await new Promise<void>((done) => { listed.push(done); setTimeout(done, ms) })
  return devices
}
/** Idle, it goes in a while, unless kept (mics.ts). */
const rest = () => { idle = setTimeout(() => { idle = null; if (!owner && !keeps.size) stopDictation() }, IDLE_MS) }
export const keeps = new Set<unknown>()
/** The devices, the helper started for them; null where it can't. */
export async function helperDevices() {
  if (TEXT) return null
  try { await start() } catch { return null }
  if (!owner && !idle) rest()
  return listedDevices(3000)
}
/** Listen for `sink` (another's session ends, "elsewhere"): through Soniox when its key is set, this Mac's engine
 *  (`engine`) taking over should it fail. Says which hears (`engine`), and `why` not Soniox when it was asked for. */
export async function dictate(sink: DictationSink, opts: DictateOptions): Promise<{ ok: boolean; code?: string; message?: string; engine?: string; why?: string; mic?: MicPick }> {
  let engine = opts.engine === "parakeet" ? "parakeet" : "apple"
  const language = typeof opts.language === "string" ? opts.language : ""
  // (a copy a script drives hears a file, never the microphone: it can't take the user's)
  if (process.env.VAULTITE_QUIET && !process.env.VAULTITE_DICTATION_FILE && !TEXT) return { ok: false, code: "quiet" }
  const [allowed, { cloud, why, terms, replacements, keep }] = await Promise.all([process.env.VAULTITE_DICTATION_FILE || TEXT ? true : systemPreferences.askForMediaAccess("microphone"), cloudFor(sink, language)])
  if (!allowed) return { ok: false, code: "permission" }
  for (const fn of starts) fn()
  let model = engine === "parakeet" ? parakeetModel() : null
  if (engine === "parakeet" && !model) {
    if (!cloud) return { ok: false, code: "model" }
    engine = "apple"
    model = null
  }
  try { if (!TEXT) await start() } catch (e) { return { ok: false, code: "helper", message: (e as Error).message } }
  if (idle) { clearTimeout(idle); idle = null }
  const file = !!(process.env.VAULTITE_QUIET && (process.env.VAULTITE_DICTATION_FILE || TEXT))
  const mic = file ? undefined : pickMic(opts.microphone, await listedDevices())
  if (owner && owner !== sink) { tell({ type: "end", reason: "elsewhere" }); keeping?.end("elsewhere") }
  owner = sink
  keeping = keep !== false && opts.where ? (list ?? await loadList()).keepFor(sink, opts.where) : null
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
export const handOver = (from: DictationSink, to: DictationSink) => {
  if (owner !== from) return false
  owner = to
  // (what it typed in the window is that one's; what it hears from now, the helper's, landing where it says)
  if (keeping && list) { keeping.end("moved"); keeping = list.keepFor(to, { kind: "app" }) }
  return true
}
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
  "dictation:microphones": (win, watch) => import("./mics.ts").then((m) => m.microphones(win, watch)),
}

// ---------- the Dictations list: each dictation's words, kept on this Mac (dictationlist.ts, loaded at the first one kept)

/** The session under way's keeping. */
let keeping: Keeping | null = null
let list: typeof import("./dictationlist.ts") | null = null
const loadList = async () => (list ??= await import("./dictationlist.ts"))
/** Where the helper put `sink`'s words once it stopped (dictationroam.ts' `land`), with the words as they landed. */
export const keptLanded = (sink: DictationSink, o: { to: string; name?: string; text?: string; inbox?: boolean }) => list?.keptLanded(sink, o)

export function stopDictation() {
  if (idle) { clearTimeout(idle); idle = null }
  const h = helper
  helper = null
  owner = null
  if (h && h.exitCode === null) { h.stdin?.end(); setTimeout(() => { if (h.exitCode === null) h.kill() }, 3000) }
}
