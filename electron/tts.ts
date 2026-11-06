// Cloud voices for the companion (voicelogic.ts' `Cloud`): ElevenLabs' and Soniox's real-time TTS. Another provider
// (Cartesia) is another function here giving the same `Cloud`, picked by `cloudVoice`.
import WebSocket from "ws"
import { type Cloud, type Made, RATE, type Timed } from "./voicelogic.ts"

/** How a cloud voice is reached: its provider's socket and key (the server's, never logged), the voice and its speed. */
export type CloudConfig = { provider: "soniox" | "elevenlabs"; url: string; key: string; model: string; voice: string; speed?: number }

export type CloudVoice = Cloud & {
  /** Its socket opened now, before the first piece (the Talk key pressed): the first audio comes sooner. */
  warm: () => void
  close: () => void
}

export function cloudVoice(c: CloudConfig): CloudVoice {
  return c.provider === "elevenlabs" ? elevenlabs(c) : soniox(c)
}

const KEEP_MS = 20_000, IDLE_MS = 90_000

/** Soniox's TTS (docs.soniox.com/tts): one socket, a stream per piece (5 at most), its config then its text whole; its
 *  audio comes as base64 PCM with each character's timing. A keepalive between streams, closed a while after the last. */
function soniox(c: CloudConfig): CloudVoice {
  let ws: WebSocket | null = null, keep: ReturnType<typeof setInterval> | null = null, idle: ReturnType<typeof setTimeout> | null = null, sid = 0
  const streams = new Map<string, { to: Made; timed: Timed }>()
  const queued: string[] = []

  function open() {
    if (ws && ws.readyState <= WebSocket.OPEN) return ws
    const s = new WebSocket(c.url, { headers: { Authorization: `Bearer ${c.key}` }, handshakeTimeout: 4000 })
    ws = s
    s.on("open", () => { for (const m of queued.splice(0)) s.send(m) })
    s.on("message", (d) => heard(String(d)))
    s.on("error", () => {})
    s.on("close", () => {
      if (ws !== s) return
      ws = null; queued.length = 0
      if (keep) { clearInterval(keep); keep = null }
      for (const [id, x] of streams) { streams.delete(id); x.to.fail("the socket closed") }
    })
    keep ??= setInterval(() => { if (!streams.size) send({ keep_alive: true }) }, KEEP_MS)
    keep.unref?.()
    return s
  }
  function send(m: object) {
    const s = open(), line = JSON.stringify(m)
    if (s.readyState === WebSocket.OPEN) s.send(line); else queued.push(line)
  }
  function rest() {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => { if (!streams.size) close() }, IDLE_MS)
    idle.unref?.()
  }
  function heard(d: string) {
    let m: { stream_id?: string; audio?: string; audio_end?: boolean; terminated?: boolean; error_code?: number; error_type?: string; error_message?: string
      timestamps?: { characters?: string[]; character_end_times_seconds?: number[] } }
    try { m = JSON.parse(d) } catch { return }
    const x = m.stream_id ? streams.get(m.stream_id) : undefined
    if (m.error_code || m.error_type) {
      const why = `${m.error_type ?? "error"} ${m.error_code ?? ""}`.trim()
      // (one with no stream is the connection's: every stream fails)
      for (const [id, s] of m.stream_id ? (x ? [[m.stream_id, x] as const] : []) : [...streams]) { streams.delete(id); s.to.fail(why) }
      if (!streams.size) rest()
      return
    }
    if (!x) return
    if (m.timestamps?.characters && m.timestamps.character_end_times_seconds) { x.timed.chars.push(...m.timestamps.characters); x.timed.ends.push(...m.timestamps.character_end_times_seconds) }
    if (m.audio) x.to.audio(Buffer.from(m.audio, "base64"), x.timed)
    if (m.terminated) { streams.delete(m.stream_id!); x.to.end(); if (!streams.size) rest() }
  }
  function close() {
    if (keep) { clearInterval(keep); keep = null }
    if (idle) { clearTimeout(idle); idle = null }
    const s = ws
    ws = null; queued.length = 0
    for (const [id, x] of streams) { streams.delete(id); x.to.fail("closed") }
    s?.close()
  }
  return {
    make(p, to) {
      const id = `v${++sid}`
      streams.set(id, { to, timed: { chars: [], ends: [] } })
      if (idle) { clearTimeout(idle); idle = null }
      send({ stream_id: id, model: c.model, language: p.language, voice: c.voice, audio_format: "pcm_s16le", sample_rate: RATE, return_timestamps: true,
        ...(c.speed && c.speed !== 1 ? { speed: Math.min(1.3, Math.max(0.7, c.speed)) } : {}), client_reference_id: "vaultite-companion" })
      send({ stream_id: id, text: p.text, text_end: true })
      return () => { if (streams.delete(id)) { send({ stream_id: id, cancel: true }); if (!streams.size) rest() } }
    },
    warm() { open(); rest() },
    reset: close,
    close,
  }
}

/** ElevenLabs' multi-context socket (elevenlabs.io/docs, multi-stream-input): one socket for a voice and model, a context
 *  per piece, its text flushed and closed at once; PCM at 24 kHz with each character's timing (per chunk: added up). */
function elevenlabs(c: CloudConfig): CloudVoice {
  let ws: WebSocket | null = null, idle: ReturnType<typeof setTimeout> | null = null, cid = 0
  const streams = new Map<string, { to: Made; timed: Timed; bytes: number }>()
  const queued: string[] = []
  const url = () => {
    const u = new URL(`${c.url.replace(/\/$/, "")}/v1/text-to-speech/${encodeURIComponent(c.voice)}/multi-stream-input`)
    u.searchParams.set("model_id", c.model)
    u.searchParams.set("output_format", `pcm_${RATE}`)
    u.searchParams.set("sync_alignment", "true")
    u.searchParams.set("inactivity_timeout", "120")
    return u.toString()
  }
  function open() {
    if (ws && ws.readyState <= WebSocket.OPEN) return ws
    const s = new WebSocket(url(), { headers: { "xi-api-key": c.key }, handshakeTimeout: 4000 })
    ws = s
    s.on("open", () => { for (const m of queued.splice(0)) s.send(m) })
    s.on("message", (d) => heard(String(d)))
    s.on("error", () => {})
    s.on("close", () => {
      if (ws !== s) return
      ws = null; queued.length = 0
      for (const [id, x] of streams) { streams.delete(id); x.to.fail("the socket closed") }
    })
    return s
  }
  function send(m: object) {
    const s = open(), line = JSON.stringify(m)
    if (s.readyState === WebSocket.OPEN) s.send(line); else queued.push(line)
  }
  function rest() {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => { if (!streams.size) close() }, IDLE_MS)
    idle.unref?.()
  }
  function heard(d: string) {
    let m: { contextId?: string; audio?: string | null; isFinal?: boolean; error?: string; message?: string
      alignment?: { chars?: string[]; charStartTimesMs?: number[]; charDurationsMs?: number[] } | null }
    try { m = JSON.parse(d) } catch { return }
    const x = m.contextId ? streams.get(m.contextId) : undefined
    if (m.error) {
      for (const [id, s] of m.contextId ? (x ? [[m.contextId, x] as const] : []) : [...streams]) { streams.delete(id); s.to.fail(String(m.error)) }
      return
    }
    if (!x) return
    if (m.audio) {
      const pcm = Buffer.from(m.audio, "base64"), at = x.bytes / (RATE * 2), a = m.alignment
      if (a?.chars && a.charStartTimesMs && a.charDurationsMs) {
        x.timed.chars.push(...a.chars)
        x.timed.ends.push(...a.charStartTimesMs.map((t, i) => at + (t + (a.charDurationsMs![i] ?? 0)) / 1000))
      }
      x.bytes += pcm.length
      x.to.audio(pcm, x.timed)
    }
    if (m.isFinal) { streams.delete(m.contextId!); x.to.end(); if (!streams.size) rest() }
  }
  function close() {
    if (idle) { clearTimeout(idle); idle = null }
    const s = ws
    ws = null; queued.length = 0
    for (const [id, x] of streams) { streams.delete(id); x.to.fail("closed") }
    if (s?.readyState === WebSocket.OPEN) s.send(JSON.stringify({ close_socket: true }))
    s?.close()
  }
  return {
    make(p, to) {
      const id = `v${++cid}`
      streams.set(id, { to, timed: { chars: [], ends: [] }, bytes: 0 })
      if (idle) { clearTimeout(idle); idle = null }
      send({ text: " ", context_id: id, ...(c.speed && c.speed !== 1 ? { voice_settings: { speed: Math.min(1.2, Math.max(0.7, c.speed)) } } : {}) })
      send({ text: `${p.text} `, context_id: id, flush: true })
      send({ context_id: id, close_context: true })
      return () => { if (streams.delete(id)) { send({ context_id: id, close_context: true }); if (!streams.size) rest() } }
    },
    warm() { open(); rest() },
    reset: close,
    close,
  }
}
