/** The companion's voice on this Mac (helper.ts'): voicelogic.ts cuts its answer in pieces, cloud voices make them
 *  (tts.ts, with the server's keys) and voice.swift plays them, saying what no cloud can. One answer at a time. */
import { app } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { cloudVoice, type CloudConfig, type CloudVoice } from "./tts.ts"
import { voice, type Voice } from "./voicelogic.ts"
import type { Heard } from "../plugins/core/companion/screenmarks.ts"
import { buildVoice, voiceHelperName } from "./voice-build.ts"

const SHIPPED = path.join(import.meta.dirname, "bin")
/** Its helper goes after this long unused (its process, and the audio device with it). */
const IDLE_MS = 10 * 60_000

/** `provider`: the cloud voice first tried (auto: ElevenLabs' when this machine has its key, else Soniox's); `name`
 *  Soniox's voice, `eleven` ElevenLabs' voice id and model. */
export type VoicePrefs = { mode: "auto" | "always" | "off"; provider: Provider | "auto"; name: string; eleven: { voice: string; model: string }; speed: number }
export type Provider = "elevenlabs" | "soniox"
/** The server's keys for each cloud voice (companion/voice): what it has. */
type Keys = { elevenlabs?: { url: string; key: string }; soniox?: { url: string; key: string; model: string } }

export function companionVoice(o: {
  /** The home vault's server's port: its keys for the cloud voices (companion/voice). */
  port: () => number | null
  prefs: () => VoicePrefs
  /** The languages the user speaks, likeliest first (two letters). */
  hints: () => string[]
  /** It's speaking (or stopped), and how loud now (0 to 1). */
  level: (speaking: boolean, v: number) => void
  /** Each sentence as it's heard: when it began (ms, the clock's) and how long it takes (a drawing's pen keeps to it). */
  heard?: (h: Heard & { say: string }) => void
  /** What happened to an answer, for the press log: its first sound heard (`at`, the clock's ms) and whose voice it
   *  was, or a cloud voice failing and the next taking over. */
  told?: (e: { t: "sound"; at: number; by: string } | { t: "fallback"; why: string; to: string }) => void
  /** A scripted copy's (VAULTITE_QUIET): what it would play goes here, and nothing plays. */
  record?: (m: Record<string, unknown>) => void
}) {
  let child: ChildProcess | null = null, starting: Promise<ChildProcess | null> | null = null, idle: ReturnType<typeof setTimeout> | null = null
  let keys: { at: number; port: number; k: Keys } | null = null
  const clouds = new Map<string, CloudVoice>()
  /** A sample's provider, for that answer alone. */
  let only: Provider | null = null
  /** Pieces sent to it and not played to their end yet. */
  const playing = new Set<number>()
  let speaking = false
  /** Each answer's number: what an older one still sends is dropped; `waiting`: its words given, not yet past `ready`. */
  let gen = 0, ready: Promise<void> = Promise.resolve(), waiting = 0
  /** The realtime voice's pieces, numbered far from voicelogic's. */
  let streamed = 1_000_000
  /** The answer whose first sound was told (its gen); a scripted copy's pieces heard so far. */
  let sounded = -1
  const recorded = new Set<number>()

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
  function heard(m: { type?: string; n?: number; v?: number; at?: number }) {
    if (m.type === "start" && typeof m.n === "number" && typeof m.at === "number") {
      v.played(m.n, m.at)
      if (sounded !== gen && m.n < 1_000_000) { sounded = gen; o.told?.({ t: "sound", at: m.at, by: whose(v.tier()) }) }
    }
    else if (m.type === "level") { if (speaking || playing.size) tell(playing.size > 0, Number(m.v) || 0) }
    else if (m.type === "done" && typeof m.n === "number") { playing.delete(m.n); if (!playing.size) tell(false, 0) }
    else if (m.type === "stopped") { playing.clear(); tell(false, 0) }
  }
  function tell(on: boolean, v: number) { speaking = on; o.level(on, on ? v : 0) }
  /** Commands go once its helper is up, in order. */
  let line = Promise.resolve()
  function send(m: Record<string, unknown>) {
    // (a scripted copy plays nothing: a piece is heard as it's given, as a file is written (VOICE_OUT), and played once ended)
    if (o.record) {
      o.record(m.cmd === "pcm" ? { cmd: "pcm", n: m.n } : m)
      if ((m.cmd === "pcm" || m.cmd === "say") && !recorded.has(m.n as number)) { recorded.add(m.n as number); heard({ type: "start", n: m.n as number, at: Date.now() }) }
      if (m.cmd === "end") heard({ type: "done", n: m.n as number })
      if (m.cmd === "stop") recorded.clear()
      return
    }
    line = line.then(async () => { const c = await start(); c?.stdin?.write(JSON.stringify(m) + "\n") })
    if (idle) clearTimeout(idle)
    idle = setTimeout(quit, IDLE_MS)
    idle.unref?.()
  }

  /** The server's keys (asked again after a minute; none: this Mac's voice). */
  async function fetchKeys() {
    const port = o.port()
    if (!port) return
    if (keys && keys.port === port && Date.now() - keys.at < 60_000) return
    let k: Keys = {}
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/companion/voice`, { headers: { "X-Vaultite-Client": "app/desktop" }, signal: AbortSignal.timeout(2000) })
      if (r.ok) k = await r.json() as Keys
    } catch { /* this Mac's voice */ }
    keys = { at: Date.now(), port, k }
  }
  /** Each provider's cloud voice, by what it's set to (one kept while that stays). */
  function cloudOf(p: Provider): CloudVoice | null {
    const k = keys?.k, pr = o.prefs()
    const c: CloudConfig | null = p === "elevenlabs" ? (k?.elevenlabs ? { provider: p, url: k.elevenlabs.url, key: k.elevenlabs.key, model: pr.eleven.model || "eleven_flash_v2_5", voice: pr.eleven.voice || "nPczCjzI2devNBz1zQrb", speed: pr.speed } : null)
      : k?.soniox ? { provider: p, url: k.soniox.url, key: k.soniox.key, model: k.soniox.model, voice: pr.name || "Adrian", speed: pr.speed } : null
    if (!c) return null
    const config = JSON.stringify(c)
    let v = clouds.get(config)
    if (!v) {
      for (const [x, old] of clouds) if (x.includes(`"provider":"${p}"`)) { old.close(); clouds.delete(x) }
      v = cloudVoice(c)
      clouds.set(config, v)
    }
    return v
  }
  /** The providers tried, in order, of those with a key: the one picked (auto: ElevenLabs'), then the other. */
  function chain(): Provider[] {
    if (o.record) return []
    const p = only ?? o.prefs().provider
    const order: Provider[] = only ? [only] : p === "soniox" ? ["soniox", "elevenlabs"] : ["elevenlabs", "soniox"]
    return order.filter((x) => !!keys?.k[x])
  }
  const cloudsNow = () => chain().map(cloudOf).filter((x): x is CloudVoice => !!x)
  /** Whose voice is at `tier` of the chain: a provider's, else this Mac's. */
  const whose = (tier: number) => chain().filter((p) => !!cloudOf(p))[tier] ?? "mac"

  const v: Voice = voice({
    clouds: cloudsNow,
    heard: (h) => o.heard?.(h),
    told: (e) => { if (e.t === "fallback") o.told?.({ t: "fallback", why: e.why, to: whose(e.to) }) },
    hints: o.hints,
    out: {
      pcm: (n, pcm) => { playing.add(n); send({ cmd: "pcm", n, data: pcm.toString("base64") }) },
      say: (n, text, language) => { playing.add(n); send({ cmd: "say", n, text, language, speed: o.prefs().speed || 1 }) },
      end: (n) => { playing.add(n); send({ cmd: "end", n }) },
      stop: () => hush(),
    },
  })

  /** Its helper silenced, what's queued there dropped (voicelogic's pieces and the realtime voice's streams alike). */
  function hush() {
    playing.clear()
    if (child || o.record) send({ cmd: "stop" })
    tell(false, 0)
  }

  function quit() {
    idle = null
    for (const c of clouds.values()) c.close()
    clouds.clear()
    const c = child
    child = null
    if (c && c.exitCode === null) { c.stdin?.end(); setTimeout(() => { if (c.exitCode === null) c.kill() }, 2000) }
  }

  return {
    /** Ready before the answer (its Talk key pressed): the key asked for, the cloud's socket and the helper up. */
    warm() {
      if (o.prefs().mode === "off") return
      void fetchKeys().then(() => cloudsNow()[0]?.warm())
      if (!o.record) void start()
    },
    /** A new answer to `asked` (the ask's words) is to be spoken: what was speaking stops. Its words wait for the
     *  key's answer (asked once a minute), so its first piece knows whether the cloud speaks. */
    begin(asked: string, lang?: string) {
      const g = ++gen
      only = null
      v.start(asked, lang)
      ready = fetchKeys().then(() => {}, () => {})
      return g
    },
    /** `text` said now through `provider` alone (none: as answers are), for the user to hear a voice: what voice said it. */
    async sample(text: string, provider?: Provider) {
      const g = ++gen
      await fetchKeys()
      if (g !== gen) return { said: false }
      only = provider ?? null
      const by = chain()[0] ?? "this Mac"
      v.start(text)
      v.text("sample", text)
      v.end("sample")
      return { said: true, by }
    },
    text: (id: string, whole: string) => { const g = gen; waiting++; void ready.then(() => { waiting--; if (g === gen) v.text(id, whole) }) },
    end: (id?: string) => { const g = gen; waiting++; void ready.then(() => { waiting--; if (g === gen) v.end(id) }) },
    /** Audio made elsewhere (the realtime voice: 24 kHz pcm16), played in order after what's playing, as its own
     *  piece; stop() silences it too. */
    stream() {
      const n = ++streamed
      return { pcm: (b: Buffer) => { playing.add(n); send({ cmd: "pcm", n, data: b.toString("base64") }) }, end: () => { playing.add(n); send({ cmd: "end", n }) } }
    },
    /** Silence, at once: an answer's pieces, and audio streamed from elsewhere (voicelogic knows only its own). */
    stop: () => { gen++; const had = playing.size > 0; v.stop(); if (had) hush() },
    /** Whether any of its words are still to be said: playing, made or being made, or on their way to it. */
    saying: () => playing.size > 0 || waiting > 0 || v.ahead(),
    quit,
  }
}
export type CompanionVoice = ReturnType<typeof companionVoice>
