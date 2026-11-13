/** The companion's voice on this Mac (helper.ts'): voicelogic.ts cuts its answer in pieces, cloud voices make them
 *  (tts.ts, with the server's keys) and voice.swift plays them, saying what no cloud can. One answer at a time. */
import { app } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"
import { cloudVoice, type CloudConfig, type CloudVoice } from "./tts.ts"
import { voice, type Voice } from "./voicelogic.ts"
import type { Heard } from "../core/desktop/screenmarks.ts"
import { voiceSwift } from "./swiftbuild.ts"
import { messageOf } from "./browser/messageof.ts"
import { logger } from "../core/log.ts"
import { z } from "zod"

const log = logger("voice")

/** Its helper goes after this long unused (its process, and the audio device with it). */
const IDLE_MS = 10 * 60_000

/** `provider`: the cloud voice first tried (auto: ElevenLabs' when this machine has its key, else Soniox's); `name`
 *  Soniox's voice, `eleven` ElevenLabs' voice id and model. */
export type VoicePrefs = { mode: "auto" | "always" | "off"; provider: Provider | "auto"; name: string; eleven: { voice: string; model: string }; speed: number }
export type Provider = "elevenlabs" | "soniox"
/** The server's keys for each cloud voice (companion/voice): what it has. */
const CLOUD = z.object({ url: z.string(), key: z.string() })
const KEYS = z.object({ elevenlabs: CLOUD.optional().catch(undefined), soniox: CLOUD.extend({ model: z.string() }).optional().catch(undefined) }).catch({})

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
  /** What happened to an answer, for the press log: its first sound (`at`, the clock's ms) and whose voice, a cloud
   *  voice failing over, or its output device changing as it played (said again from `again` s before). */
  told?: (e: { t: "sound"; at: number; by: string; out?: string } | { t: "fallback"; why: string; from: string; to: string; slow?: true } | { t: "reroute"; why: string; again: number }
    | { t: "silent"; by: string; why?: string }) => void
  /** A scripted copy's (VAULTITE_QUIET): what it would play goes here, and nothing plays. */
  record?: (m: Record<string, unknown>) => void
}) {
  let child: ChildProcess | null = null, starting: Promise<ChildProcess | null> | null = null, idle: ReturnType<typeof setTimeout> | null = null
  let keys: { at: number; port: number; k: z.infer<typeof KEYS> } | null = null
  const clouds = new Map<string, CloudVoice>()
  /** A sample's provider, for that answer alone; the Soniox voice of an answer by another agent than the companion. */
  let only: Provider | null = null, as: string | null = null
  /** Pieces sent to it and not played to their end yet (the player's numbers). */
  const playing = new Set<number>()
  /** Pieces given words (audio, or text to say) and those heard to start: one given words that ends unheard said nothing. */
  const worded = new Set<number>(), begun = new Set<number>()
  let speaking = false
  /** Each answer's number: what an older one still sends is dropped; `waiting`: its words given, not yet past `ready`. */
  let gen = 0, ready: Promise<void> = Promise.resolve(), waiting = 0
  /** The player plays pieces in the order of their numbers, so each gets one as it first goes there: the realtime
   *  voice's few words, then the answer said after them. `v3` is voicelogic's piece 3, `s2` a stream. */
  let numbered = 0, streamed = 0
  const toPlayer = new Map<string, number>(), ofPlayer = new Map<number, string>()
  const pn = (k: string) => { let n = toPlayer.get(k); if (n === undefined) { n = ++numbered; toPlayer.set(k, n); ofPlayer.set(n, k) } return n }
  const forget = (n: number) => { const k = ofPlayer.get(n); if (k) toPlayer.delete(k); ofPlayer.delete(n) }
  /** An answer held back (its words made, not played) till the realtime voice says whose turn it is: what it would
   *  send the player, in order. */
  let held: (() => void)[] | null = null
  /** The answer whose first sound was told (its gen); a scripted copy's pieces heard so far. */
  let sounded = -1
  /** Where it plays now, as its helper last said (a Bluetooth headset at 24 kHz is in its call profile). */
  let output = ""
  const recorded = new Set<number>()

  const binary = () => voiceSwift.binary(path.join(app.getPath("userData"), "bin"))
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
      c.on("error", (e) => log.warn(`its player didn't run (${e.message})`))
      c.once("exit", (code, signal) => {
        if (child !== c) return
        // (gone mid-answer: what it had is lost, and the user is told; the next answer starts another)
        if (playing.size) o.told?.({ t: "silent", by: "player", why: `its player quit (${signal ?? `exit ${code}`})` })
        child = null; playing.clear(); worded.clear(); begun.clear(); tell(false, 0)
      })
      child = c
      return c
    }, (e) => { log.warn(`its helper isn't here (${messageOf(e)})`); return null }).finally(() => { starting = null })
    return starting
  }
  function heard(m: { type?: string; n?: number; v?: number; at?: number; s?: number; why?: string; again?: number; name?: string; transport?: string; rate?: number }) {
    const k = typeof m.n === "number" ? ofPlayer.get(m.n) : undefined, mine = k?.startsWith("v") ? Number(k.slice(1)) : null
    if (m.type === "start" && typeof m.n === "number" && typeof m.at === "number") {
      begun.add(m.n)
      if (mine !== null) v.played(mine, m.at)
      if (sounded !== gen && mine !== null) { sounded = gen; o.told?.({ t: "sound", at: m.at, by: whose(v.tier()), ...(output ? { out: output } : {}) }) }
    }
    else if (m.type === "length" && typeof m.n === "number" && typeof m.s === "number") { if (mine !== null) v.length(mine, m.s) }
    else if (m.type === "level") { if (speaking || playing.size) tell(playing.size > 0, Number(m.v) || 0) }
    else if (m.type === "done" && typeof m.n === "number") {
      if (worded.has(m.n) && !begun.has(m.n) && mine !== null) o.told?.({ t: "silent", by: whose(v.tier()) })
      worded.delete(m.n); begun.delete(m.n)
      playing.delete(m.n); forget(m.n); if (!playing.size) tell(false, 0)
    }
    else if (m.type === "stopped") { playing.clear(); worded.clear(); begun.clear(); tell(false, 0) }
    else if (m.type === "output") output = `${m.name} (${m.transport}${m.rate ? `, ${Math.round(Number(m.rate) / 1000)} kHz` : ""})`
    else if (m.type === "rerouted") o.told?.({ t: "reroute", why: String(m.why ?? ""), again: Number(m.again) || 0 })
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
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/companion/voice`, { headers: { "X-Vaultite-Client": "app/desktop" }, signal: AbortSignal.timeout(2000) })
      if (!r.ok) throw new Error(`${r.status}`)
      keys = { at: Date.now(), port, k: KEYS.parse(await r.json()) }
    } catch {
      // (its server busy or restarting: the keys it had stay, asked again soon; none known, this Mac's voice)
      keys = { at: Date.now() - 50_000, port, k: keys?.port === port ? keys.k : {} }
    }
  }
  /** Each provider's cloud voice, by what it's set to (one kept while that stays). */
  function cloudOf(p: Provider): CloudVoice | null {
    const k = keys?.k, pr = o.prefs()
    const c: CloudConfig | null = p === "elevenlabs" ? (k?.elevenlabs ? { provider: p, url: k.elevenlabs.url, key: k.elevenlabs.key, model: pr.eleven.model || "eleven_flash_v2_5", voice: pr.eleven.voice || "nPczCjzI2devNBz1zQrb", speed: pr.speed } : null)
      : k?.soniox ? { provider: p, url: k.soniox.url, key: k.soniox.key, model: k.soniox.model, voice: as || pr.name || "Adrian", speed: pr.speed } : null
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
    // (another agent's answer is Soniox's, the only cloud with its own voice for it)
    const p = only ?? (as ? "soniox" : o.prefs().provider)
    const order: Provider[] = only ? [only] : p === "soniox" ? ["soniox", "elevenlabs"] : ["elevenlabs", "soniox"]
    return order.filter((x) => !!keys?.k[x])
  }
  const cloudsNow = () => chain().map(cloudOf).filter((x): x is CloudVoice => !!x)
  /** Whose voice is at `tier` of the chain: a provider's, else this Mac's. */
  const whose = (tier: number) => chain().filter((p) => !!cloudOf(p))[tier] ?? "mac"

  const v: Voice = voice({
    clouds: cloudsNow,
    heard: (h) => o.heard?.(h),
    told: (e) => { if (e.t === "fallback") o.told?.({ t: "fallback", why: e.why, from: whose(e.to - 1), to: whose(e.to), ...(e.slow ? { slow: e.slow } : {}) }) },
    hints: o.hints,
    out: {
      pcm: (n, pcm) => out(() => { const p = pn(`v${n}`); playing.add(p); worded.add(p); send({ cmd: "pcm", n: p, data: pcm.toString("base64") }) }),
      say: (n, text, language) => out(() => { const p = pn(`v${n}`); playing.add(p); worded.add(p); send({ cmd: "say", n: p, text, language, speed: o.prefs().speed || 1 }) }),
      end: (n) => out(() => { const p = pn(`v${n}`); playing.add(p); send({ cmd: "end", n: p }) }),
      // (held, nothing of it reached the player: the realtime voice's words there go on)
      stop: () => { if (held) held = []; else hush() },
    },
  })
  const out = (f: () => void) => { if (held) held.push(f); else f() }

  /** Its helper silenced, what's queued there dropped (voicelogic's pieces and the realtime voice's streams alike). */
  function hush() {
    playing.clear(); worded.clear(); begun.clear()
    toPlayer.clear(); ofPlayer.clear()
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
    /** A new answer to `asked` (the ask's words): what was speaking stops (`after`: the realtime voice's words go on);
     *  `voice`: Soniox's voice for it (another agent's). Its words wait for the keys (asked once a minute). */
    begin(asked: string, lang?: string, after = false, voice?: string | null) {
      const g = ++gen
      only = null
      as = voice || null
      if (after) { const h = held; held = []; v.start(asked, lang); held = h } else v.start(asked, lang)
      ready = fetchKeys().then(() => {}, () => {})
      return g
    },
    /** `text` said now through `provider` alone (none: as answers are), for the user to hear a voice: what voice said it. */
    async sample(text: string, provider?: Provider) {
      const g = ++gen
      await fetchKeys()
      if (g !== gen) return { said: false }
      only = provider ?? null
      as = null
      const by = chain()[0] ?? "this Mac"
      v.start(text)
      v.text("sample", text)
      v.end("sample")
      return { said: true, by }
    },
    text: (id: string, whole: string) => { const g = gen; waiting++; void ready.then(() => { waiting--; if (g === gen) v.text(id, whole) }) },
    end: (id?: string) => { const g = gen; waiting++; void ready.then(() => { waiting--; if (g === gen) v.end(id) }) },
    /** Audio made elsewhere (the realtime voice: 24 kHz pcm16), played in order after what's playing, as its own
     *  piece; stop() silences it too. `yield`: an answer said after it cuts it short (at a pause, past `grace` s). */
    stream() {
      const n = pn(`s${++streamed}`)
      return { pcm: (b: Buffer) => { playing.add(n); send({ cmd: "pcm", n, data: b.toString("base64") }) }, end: () => { playing.add(n); send({ cmd: "end", n }) },
        yield: (grace = 0.4) => send({ cmd: "yield", n, grace }) }
    },
    /** The next answer is held back as it's made: its words wait for whose turn it is (the realtime voice's). */
    hold() { held ??= [] },
    /** It's this answer's turn: what was held goes to the player, after what plays there. */
    through() { const h = held; held = null; for (const f of h ?? []) f() },
    /** Not its turn (the realtime voice answered alone): what was held, and what's still to come of it, goes. */
    drop() { if (!held) return; gen++; v.stop(); held = null },
    /** Silence, at once: an answer's pieces, and audio streamed from elsewhere (voicelogic knows only its own). */
    stop: () => { gen++; held = null; const had = playing.size > 0; v.stop(); if (had) hush() },
    /** Whether any of its words are still to be said: playing, made or being made, held, or on their way to it. */
    saying: () => playing.size > 0 || waiting > 0 || v.ahead() || !!held?.length,
    quit,
  }
}
export type CompanionVoice = ReturnType<typeof companionVoice>
