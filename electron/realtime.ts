/** An OpenAI Realtime session over its WebSocket (realtimefront.ts'): push to talk, so no server VAD, the turn committed
 *  when the key is let go; a response asked for while one runs waits for it (the API takes one at a time). */
import { WebSocket } from "ws"
import type { Usage } from "./realtimelogic.ts"
import { z } from "zod"

export type RealtimeConfig = { url: string; key: string; model: string; voice: string; instructions: string; tools: object[] }
export type Done = { id: string; status: string; usage?: Usage; error?: string; account?: "quota" | "auth"; calls: { id: string; name: string; args: string }[] }
/** Why every try would fail alike till the user acts: the account can't pay (`quota`), or its key is refused (`auth`). */
export function accountError(e: { code?: unknown; type?: unknown; message?: unknown }): "quota" | "auth" | null {
  const k = `${e.code ?? ""} ${e.type ?? ""}`, m = String(e.message ?? "")
  if (/insufficient_quota|billing|quota_exceeded/i.test(k) || /no credits|exceeded your current quota|billing/i.test(m)) return "quota"
  if (/invalid_api_key|authentication|unauthorized|^auth\b/i.test(k) || /incorrect api key|invalid api key/i.test(m)) return "auth"
  return null
}
export type RealtimeEvents = {
  /** The session is set up (its first `session.updated`). */
  ready: () => void
  /** Audio of response `rid`'s item `item`, 24 kHz pcm16. */
  audio: (b: Buffer, rid: string, item: string) => void
  /** What it's saying, as it's said. */
  said: (delta: string, rid: string) => void
  /** It's calling a tool: `args` is "" when only begun (output_item.added), whole once done. */
  call: (c: { id: string; name: string; args: string; rid: string }) => void
  /** A response began (asked by `ask`'s number) and ended. */
  began: (rid: string, ask: number) => void
  done: (d: Done) => void
  /** Something went wrong: `fatal`, the session is gone. */
  error: (e: { code?: string; message: string; fatal: boolean; account?: "quota" | "auth" }) => void
}

const opt = <T extends z.ZodType>(s: T) => s.optional().catch(undefined)
const ID = z.string().catch(""), N = opt(z.number()), TEXT = z.unknown().optional().transform((v) => String(v ?? ""))
const SPLIT = opt(z.object({ text_tokens: N, audio_tokens: N }))
const USAGE = opt(z.object({ input_tokens: N, output_tokens: N, output_token_details: SPLIT,
  input_token_details: opt(z.object({ text_tokens: N, audio_tokens: N, cached_tokens: N, cached_tokens_details: SPLIT })) })) satisfies z.ZodType<Usage | undefined>
const FAILURE = z.object({ code: opt(z.string()), type: opt(z.string()), message: opt(z.string()) })
const CALL = z.object({ type: opt(z.string()), call_id: z.string(), name: z.string(), arguments: opt(z.string()) })
const EVENT = z.object({ type: z.string(), delta: TEXT, response_id: ID, item_id: ID, call_id: ID, name: ID, arguments: TEXT,
  item: opt(z.object({ type: opt(z.string()), call_id: ID, name: ID })), error: FAILURE.catch({}),
  response: z.object({ id: ID, status: opt(z.string()), usage: USAGE, status_details: opt(z.object({ error: opt(FAILURE) })),
    output: z.array(z.unknown()).catch([]).transform((xs) => xs.flatMap((x) => CALL.safeParse(x).data ?? [])) }).catch({ id: "", output: [] }) })
export function realtimeSession(c: RealtimeConfig, on: Partial<RealtimeEvents>) {
  const u = new URL(c.url)
  u.searchParams.set("model", c.model)
  const ws = new WebSocket(u, { headers: { Authorization: `Bearer ${c.key}` } })
  let open = false, closed = false, active: string | null = null, asking = 0, asked = 0
  const early: string[] = []
  /** Responses asked for while one ran: each goes once the one before is done. */
  const waiting: { n: number; r: object }[] = []
  const send = (e: object) => {
    if (closed) return
    const s = JSON.stringify(e)
    if (open) ws.send(s); else early.push(s)
  }
  const fail = (message: string, code?: string, account: "quota" | "auth" | null = null) => {
    if (closed) return
    closed = true
    on.error?.({ message, fatal: true, ...(code ? { code } : {}), ...(account ? { account } : {}) })
    try { ws.terminate() } catch { /* gone */ }
  }

  ws.on("open", () => {
    open = true
    ws.send(JSON.stringify({ type: "session.update", session: {
      type: "realtime", output_modalities: ["audio"], instructions: c.instructions, tools: c.tools, tool_choice: "auto",
      audio: { input: { format: { type: "audio/pcm", rate: 24_000 }, turn_detection: null }, output: { format: { type: "audio/pcm", rate: 24_000 }, voice: c.voice } },
    } }))
    for (const s of early.splice(0)) ws.send(s)
  })
  ws.on("unexpected-response", (_req, res) => fail(`OpenAI answered ${res.statusCode}`, res.statusCode === 401 ? "auth" : String(res.statusCode),
    res.statusCode === 401 || res.statusCode === 403 ? "auth" : res.statusCode === 429 ? "quota" : null))
  ws.on("error", (e) => fail(e.message))
  ws.on("close", () => fail("its socket closed"))
  let readied = false
  ws.on("message", (data) => {
    let json: unknown
    try { json = JSON.parse(String(data)) } catch { return }
    const parsed = EVENT.safeParse(json)
    if (!parsed.success) return
    const m = parsed.data
    switch (m.type) {
      case "session.updated": if (!readied) { readied = true; on.ready?.() } break
      case "response.created": active = m.response.id || "?"; on.began?.(active, asking); break
      // (the GA names, and the beta's)
      case "response.output_audio.delta": case "response.audio.delta":
        on.audio?.(Buffer.from(m.delta, "base64"), m.response_id, m.item_id); break
      case "response.output_audio_transcript.delta": case "response.audio_transcript.delta": on.said?.(m.delta, m.response_id); break
      case "response.output_item.added": if (m.item?.type === "function_call") on.call?.({ id: m.item.call_id, name: m.item.name, args: "", rid: m.response_id }); break
      case "response.function_call_arguments.done": on.call?.({ id: m.call_id, name: m.name, args: m.arguments, rid: m.response_id }); break
      case "response.done": {
        const r = m.response
        if (active === r.id || active === "?") active = null
        const calls = r.output.flatMap((x) => (x.type === "function_call" ? [{ id: x.call_id, name: x.name, args: x.arguments ?? "" }] : []))
        const err = r.status_details?.error
        on.done?.({ id: r.id, status: r.status ?? "completed", usage: r.usage, calls, ...(err?.message ? { error: err.message } : {}), ...(err && accountError(err) ? { account: accountError(err)! } : {}) })
        next()
        break
      }
      case "error": {
        const e = m.error
        // (a cancel with nothing running, a truncate past what was made: no matter)
        if (e.code === "response_cancel_not_active" || /truncat/i.test(String(e.message))) break
        // (the response asked for refused: the next may go)
        if (active === "?") { active = null; queueMicrotask(next) }
        const account = accountError(e)
        on.error?.({ message: String(e.message ?? "error"), code: e.code, fatal: false, ...(account ? { account } : {}) })
        break
      }
    }
  })
  function next() {
    if (active || !waiting.length) return
    const w = waiting.shift()!
    asking = w.n
    active = "?"
    send(w.r)
  }

  return {
    /** Whether it can still be used. */
    alive: () => !closed,
    /** Mic audio, 24 kHz pcm16. */
    append: (b: Buffer) => { if (b.length) send({ type: "input_audio_buffer.append", audio: b.toString("base64") }) },
    clear: () => send({ type: "input_audio_buffer.clear" }),
    commit: () => send({ type: "input_audio_buffer.commit" }),
    /** Words for it to read with the next turn (where the user is). */
    note: (text: string) => send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } }),
    output: (call: string, text: string) => send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call, output: text } }),
    /** A response (after the one running, if one is): its number, which `began` tells. */
    respond(r: { instructions?: string; tool_choice?: "auto" | "none"; output_modalities?: string[]; conversation?: "none"; max_output_tokens?: number } = {}) {
      const n = ++asked
      waiting.push({ n, r: { type: "response.create", ...(Object.keys(r).length ? { response: r } : {}) } })
      next()
      return n
    },
    /** What's running stops, and what waited goes. */
    cancel() { waiting.length = 0; if (active) send({ type: "response.cancel" }) },
    truncate: (item: string, ms: number) => send({ type: "conversation.item.truncate", item_id: item, content_index: 0, audio_end_ms: Math.max(0, Math.floor(ms)) }),
    close() { if (closed) return; closed = true; try { ws.close() } catch { /* gone */ } },
  }
}
export type RealtimeSession = ReturnType<typeof realtimeSession>
