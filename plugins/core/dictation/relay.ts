import crypto from "node:crypto"
import type { IncomingMessage } from "node:http"
import type { RawData } from "ws"
import { z } from "zod"
import { HTTPError, type Plugin, type ServedSocket } from "../../../core/plugins.ts"
import type { Heard, Provider, Stream } from "./providers/provider.ts"

export const RELAY = "/api/dictation/live"
const TOKEN_MS = 60_000
const WAIT_MS = 2500, QUIET_MS = 800

type Grant = { provider: Provider; key: string; until: number }
const grants = new Map<string, Grant>()
const granted = new WeakMap<IncomingMessage, Grant>()

export function grant(provider: Provider, key: string) {
  const now = Date.now()
  for (const [t, g] of grants) if (g.until < now) grants.delete(t)
  const token = crypto.randomBytes(24).toString("base64url")
  grants.set(token, { provider, key, until: now + TOKEN_MS })
  return token
}

const Config = z.object({
  language_hints: z.array(z.string()).catch([]).default([]),
  context: z.object({ terms: z.array(z.string()).catch([]).default([]) }).catch({ terms: [] }).default({ terms: [] }),
})
const Control = z.object({ type: z.string() })
const bytes = (d: RawData) => (Array.isArray(d) ? Buffer.concat(d) : Buffer.isBuffer(d) ? d : Buffer.from(d))
function parsed<T>(schema: z.ZodType<T>, s: string): T | undefined {
  try { return schema.safeParse(JSON.parse(s)).data } catch { return undefined }
}
const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter(Boolean)

export function relaySocket(plugin: Plugin) {
  plugin.socket("dictation/live", (ws, req) => {
    const g = granted.get(req)
    if (g) new Relay(ws, g).listen()
    else ws.close(1008, "no token")
  }, {
    accept: (req) => {
      const token = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ""))?.[1] ?? ""
      const g = grants.get(token)
      grants.delete(token)
      if (!g || g.until < Date.now()) throw new HTTPError(401, "dictation's relay takes a token from /api/dictation/cloud, once, within a minute")
      granted.set(req, g)
    },
  })
}

type Token = { text: string; is_final: boolean; end_ms?: number }
type Out = { tokens: Token[]; finished?: true; error_code?: number; error_type?: string; error_message?: string }
type Flush = { at: number; end: boolean; answered: boolean; timer?: ReturnType<typeof setTimeout> }
const settled = (text: string, endMs?: number): Token => (endMs === undefined ? { text, is_final: true } : { text, is_final: true, end_ms: endMs })

class Relay {
  ws: ServedSocket
  g: Grant
  stream: Stream | null = null
  over = false
  ms = 0
  unflushed = 0
  pending = ""
  heardSinceFlush = false
  promoted: string[] = []
  flushes: Flush[] = []
  constructor(ws: ServedSocket, g: Grant) { this.ws = ws; this.g = g }

  send(m: Out) { if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(m)) }
  tokens(finals: Token[], finished = false) {
    const tokens = this.pending ? [...finals, { text: ` ${this.pending}`, is_final: false }] : finals
    this.send(finished ? { tokens, finished } : { tokens })
  }
  withoutPromoted(text: string, final: boolean) {
    const w = words(text), n = this.promoted.length
    const same = n > 0 && w.length >= n && this.promoted.every((x, i) => x === w[i])
    if (final) this.promoted = []
    return (same ? text.split(/\s+/).slice(n).join(" ") : text).trim()
  }
  close() {
    if (this.over) return
    this.over = true
    for (const f of this.flushes) clearTimeout(f.timer)
    this.stream?.close()
    if (this.ws.readyState === this.ws.OPEN) this.ws.close()
  }
  fail(code: number, message: string) {
    if (this.over) return
    this.send({ tokens: [], error_code: code, error_type: code === 401 ? "unauthenticated" : "provider_error", error_message: message })
    this.close()
  }
  drain() {
    while (this.flushes[0]?.answered) {
      const f = this.flushes.shift()!
      if (f.end) { this.tokens([settled("", f.at)], true); return this.close() }
      this.tokens([settled("", f.at), settled("<fin>")])
    }
  }
  answer(f: Flush) { f.answered = true; clearTimeout(f.timer); this.drain() }
  heard(): Heard {
    return {
      pending: (text) => { this.heardSinceFlush = true; this.pending = this.withoutPromoted(text.trim(), false); this.tokens([]) },
      final: (text, endMs) => {
        this.heardSinceFlush = true
        const t = this.withoutPromoted(text.trim(), true)
        if (t) this.tokens([settled(` ${t}`, endMs)])
      },
      flushed: () => { const f = this.flushes.find((x) => !x.answered); if (f) this.answer(f) },
      failed: (code, message) => this.fail(code, message),
    }
  }
  settleUnanswered(f: Flush) {
    const shown = this.pending
    this.pending = ""
    if (shown) { this.promoted = words(shown); this.tokens([settled(` ${shown}`)]) }
    this.answer(f)
  }
  flush(end: boolean) {
    const f: Flush = { at: Math.round(this.ms), end, answered: false }
    this.flushes.push(f)
    const asked = this.unflushed > 0 && !!this.stream?.flush()
    this.unflushed = 0
    if (!asked) return this.answer(f)
    f.timer = setTimeout(() => this.settleUnanswered(f), this.heardSinceFlush || this.pending ? WAIT_MS : QUIET_MS)
    this.heardSinceFlush = false
  }
  started(text: string) {
    const c = parsed(Config, text)
    if (!c) return this.fail(400, "the stream starts with its config (JSON)")
    this.stream = this.g.provider.open({ key: this.g.key, model: this.g.provider.model, languages: c.language_hints, terms: c.context.terms }, this.heard())
  }
  control(text: string) {
    if (!text) return this.flush(true)
    const type = parsed(Control, text)?.type
    if (type === "finalize") this.flush(false)
    else if (type === "keepalive") this.stream?.keepalive()
    else this.fail(400, `Control request type is invalid. Valid values: "finalize", "keepalive".`)
  }
  audio(b: Buffer) {
    if (!b.length) return
    this.ms += b.length / 32
    this.unflushed += b.length
    this.stream?.audio(b)
  }
  listen() {
    this.ws.on("message", (data: RawData, binary: boolean) => {
      if (this.over) return
      const b = bytes(data)
      if (!this.stream) return binary ? this.fail(400, "the stream starts with its config (JSON)") : this.started(b.toString())
      if (binary) this.audio(b); else this.control(b.toString())
    })
    this.ws.on("close", () => this.close())
  }
}
