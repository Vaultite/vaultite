/** The companion's voice on this Mac (helper.ts'): voicelogic.ts cuts its answer in pieces, a cloud voice makes them
 *  (tts.ts, the server's Soniox key) and voice.swift plays them, saying what the cloud can't. One answer at a time. */
import { app } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { cloudVoice, type CloudConfig, type CloudVoice } from "./tts.ts"
import { voice, type Voice } from "./voicelogic.ts"
import { buildVoice, voiceHelperName } from "./voice-build.ts"

const SHIPPED = path.join(import.meta.dirname, "bin")
/** Its helper goes after this long unused (its process, and the audio device with it). */
const IDLE_MS = 10 * 60_000

export type VoicePrefs = { mode: "auto" | "always" | "off"; name: string; speed: number }
type Speech = { url: string; key: string; model: string }

export function companionVoice(o: {
  /** The home vault's server's port: its Soniox key (dictation/speech). */
  port: () => number | null
  prefs: () => VoicePrefs
  /** The languages the user speaks, likeliest first (two letters). */
  hints: () => string[]
  /** It's speaking (or stopped), and how loud now (0 to 1). */
  level: (speaking: boolean, v: number) => void
  /** A scripted copy's (VAULTITE_QUIET): what it would play goes here, and nothing plays. */
  record?: (m: Record<string, unknown>) => void
}) {
  let child: ChildProcess | null = null, starting: Promise<ChildProcess | null> | null = null, idle: ReturnType<typeof setTimeout> | null = null
  let speech: { at: number; port: number; s: Speech | null } | null = null, cloud: { config: string; v: CloudVoice } | null = null
  /** Pieces sent to it and not played to their end yet. */
  const playing = new Set<number>()
  let speaking = false
  /** Each answer's number: what an older one still sends is dropped. */
  let gen = 0, ready: Promise<void> = Promise.resolve()

  async function binary() {
    const shipped = path.join(SHIPPED, voiceHelperName())
    return fs.existsSync(shipped) ? shipped : buildVoice(path.join(app.getPath("userData"), "bin"))
  }
  function start(): Promise<ChildProcess | null> {
    if (child && child.exitCode === null && !child.killed) return Promise.resolve(child)
    starting ??= binary().then((bin) => {
      const c = spawn(bin, [], { stdio: ["pipe", "pipe", "ignore"] })
      let buf = ""
      c.stdout!.on("data", (b: Buffer) => {
        buf += b.toString()
        for (let i; (i = buf.indexOf("\n")) >= 0;) {
          const line = buf.slice(0, i)
          buf = buf.slice(i + 1)
          try { heard(JSON.parse(line)) } catch { /* not a line of its */ }
        }
      })
      c.stdin!.on("error", () => {})
      c.on("error", () => {})
      c.once("exit", () => { if (child === c) { child = null; playing.clear(); tell(false, 0) } })
      child = c
      return c
    }, (e) => { console.warn(`voice: its helper isn't here (${(e as Error).message})`); return null }).finally(() => { starting = null })
    return starting
  }
  function heard(m: { type?: string; n?: number; v?: number }) {
    if (m.type === "level") { if (speaking || playing.size) tell(playing.size > 0, Number(m.v) || 0) }
    else if (m.type === "done" && typeof m.n === "number") { playing.delete(m.n); if (!playing.size) tell(false, 0) }
    else if (m.type === "stopped") { playing.clear(); tell(false, 0) }
  }
  function tell(on: boolean, v: number) { speaking = on; o.level(on, on ? v : 0) }
  /** Commands go once its helper is up, in order. */
  let line = Promise.resolve()
  function send(m: Record<string, unknown>) {
    if (o.record) return o.record(m.cmd === "pcm" ? { cmd: "pcm", n: m.n } : m)
    line = line.then(async () => { const c = await start(); c?.stdin?.write(JSON.stringify(m) + "\n") })
    if (idle) clearTimeout(idle)
    idle = setTimeout(quit, IDLE_MS)
    idle.unref?.()
  }

  /** The server's Soniox voice (asked again after a minute; none: this Mac's). */
  async function fetchSpeech() {
    const port = o.port()
    if (!port) return null
    if (speech && speech.port === port && Date.now() - speech.at < 60_000) return speech.s
    let s: Speech | null = null
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/dictation/speech`, { headers: { "X-Vaultite-Client": "app/desktop" }, signal: AbortSignal.timeout(2000) })
      const j = (r.ok ? await r.json() : {}) as Partial<Speech>
      s = j.url && j.key && j.model ? { url: j.url, key: j.key, model: j.model } : null
    } catch { /* this Mac's voice */ }
    speech = { at: Date.now(), port, s }
    return s
  }
  function cloudNow(): CloudVoice | null {
    const s = speech?.s, p = o.prefs()
    if (!s) return null
    const c: CloudConfig = { provider: "soniox", url: s.url, key: s.key, model: s.model, voice: p.name || "Hazel", speed: p.speed }
    const config = JSON.stringify(c)
    if (cloud?.config !== config) { cloud?.v.close(); cloud = { config, v: cloudVoice(c) } }
    return cloud.v
  }

  const v: Voice = voice({
    cloud: () => (o.record ? null : cloudNow()),
    hints: o.hints,
    out: {
      pcm: (n, pcm) => { playing.add(n); send({ cmd: "pcm", n, data: pcm.toString("base64") }) },
      say: (n, text, language) => { playing.add(n); send({ cmd: "say", n, text, language, speed: o.prefs().speed || 1 }) },
      end: (n) => { playing.add(n); send({ cmd: "end", n }) },
      stop: () => { playing.clear(); if (child || o.record) send({ cmd: "stop" }); tell(false, 0) },
    },
  })

  function quit() {
    idle = null
    cloud?.v.close(); cloud = null
    const c = child
    child = null
    if (c && c.exitCode === null) { c.stdin?.end(); setTimeout(() => { if (c.exitCode === null) c.kill() }, 2000) }
  }

  return {
    /** Ready before the answer (its Talk key pressed): the key asked for, the cloud's socket and the helper up. */
    warm() {
      if (o.prefs().mode === "off") return
      void fetchSpeech().then(() => cloudNow()?.warm())
      if (!o.record) void start()
    },
    /** A new answer to `asked` (the ask's words) is to be spoken: what was speaking stops. Its words wait for the
     *  key's answer (asked once a minute), so its first piece knows whether the cloud speaks. */
    begin(asked: string) {
      const g = ++gen
      v.start(asked)
      ready = fetchSpeech().then(() => {}, () => {})
      return g
    },
    text: (id: string, whole: string) => { const g = gen; void ready.then(() => { if (g === gen) v.text(id, whole) }) },
    end: (id?: string) => { const g = gen; void ready.then(() => { if (g === gen) v.end(id) }) },
    /** Silence, at once. */
    stop: () => { gen++; v.stop() },
    /** Whether an answer is being spoken now. */
    on: () => v.on(),
    quit,
  }
}
export type CompanionVoice = ReturnType<typeof companionVoice>
