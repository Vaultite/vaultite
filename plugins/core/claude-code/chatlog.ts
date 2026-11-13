import { isRecord, rec, str } from "./inputs.ts"

/** A question as AskUserQuestion asks it (core/agents.ts' Question). */
export type Question = { question: string; header?: string; multi?: boolean; options: { label: string; description?: string }[] }
/** What an ask is: a tool to allow, AskUserQuestion's questions, or ExitPlanMode's plan. */
export type AskKind = "permission" | "question" | "plan"

/** One thing in a conversation, by id: a user message's uuid, `<message id>:<index>`, a tool_use id, `ask:<tool_use id>`. */
export type Entry =
  | { k: "user"; id: string; text: string; at: string
      /** Its pictures, each as `imageSrc` names it (useChat gives the app a URL it loads). */
      images?: { src: string }[] }
  | { k: "text" | "thinking"; id: string; text: string; at: string; live?: boolean; parent?: string }
  | { k: "tool"; id: string; name: string; summary: string; input: unknown; result?: string; error?: boolean; at: string; live?: boolean; parent?: string }
  | { k: "ask"; id: string; kind: AskKind; tool: string; title: string; detail?: string; input?: unknown; questions?: Question[]; plan?: string
      /** What Always allow allows ("git push commands"), when it's offered. */
      always?: string
      /** How it was answered ("Allowed", "Answered"), once it was. */
      answer?: string; at: string }
  | { k: "result"; id: string; ok: boolean; ms: number; error?: string; at: string }
  | { k: "note"; id: string; text: string; tone?: "error"; at: string }

export const clip = (s: string, n = 4000) => (s.length > n ? `${s.slice(0, n)}\n… (${(s.length - n).toLocaleString("en-US")} more characters)` : s)

const PICK = ["description", "command", "file_path", "path", "pattern", "url", "query", "prompt", "skill", "notebook_path", "subject", "task_id"]
/** One line saying what a tool call does: "git status", "src/app.ts", "TODO in *.ts". */
export function summarize(name: string, input: unknown) {
  const o = isRecord(input) ? input : {}
  const text = (v: unknown): v is string => typeof v === "string" && !!v
  let s = typeof input === "string" ? input : PICK.map((k) => o[k]).find(text) ?? Object.values(o).find(text) ?? ""
  if (name === "Grep" && typeof o.pattern === "string") {
    const w = [o.path, o.glob].find(text)
    s = w ? `${o.pattern} in ${w}` : o.pattern
  }
  return s.replace(/\s+/g, " ").trim().slice(0, 200)
}

/** A user message as Markdown: a slash command as "/name args", system reminders and command output left out. */
export function userText(content: unknown, pictures = true): string {
  let s = ""
  if (typeof content === "string") s = content
  else if (Array.isArray(content)) {
    s = content.map((c) => (c?.type === "text" ? String(c.text ?? "") : c?.type === "image" && pictures ? "_(image)_" : "")).filter(Boolean).join("\n\n")
  }
  const cmd = /<command-name>([^<]*)<\/command-name>/.exec(s)
  if (cmd) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(s)?.[1].trim()
    return `\`${cmd[1].trim()}${args ? ` ${args}` : ""}\``
  }
  return s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").replace(/<local-command-(stdout|stderr|caveat)>[\s\S]*?<\/local-command-\1>/g, "").trim()
}

export function resultText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.map((c) => (c?.type === "text" ? String(c.text ?? "") : c?.type === "image" ? "(image)" : "")).filter(Boolean).join("\n")
  return content == null ? "" : JSON.stringify(content)
}

/** The picture types the API takes, at most IMAGES_MAX of IMAGE_MAX bytes each. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const
export type ImageType = (typeof IMAGE_TYPES)[number]
export const IMAGES_MAX = 10, IMAGE_MAX = 5 << 20
export function imageType(b: Uint8Array): ImageType | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, j) => b[i + j] === x)
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png"
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg"
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "image/gif"
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp"
  return null
}
export const imageSrc = (entry: string, n: number) => `image/${encodeURIComponent(entry)}/${n}`
const picturesOf = (id: string, content: unknown) => {
  const n = Array.isArray(content) ? content.filter((c) => c?.type === "image").length : 0
  return n ? { images: Array.from({ length: n }, (_, i) => ({ src: imageSrc(id, i) })) } : {}
}

const words = (v: string, n: number) => v.replace(/\s+/g, " ").trim().slice(0, n)

/** AskUserQuestion's input as questions (at most 4, of 2 to 6 options each), or none when it isn't one. */
export function questionsOf(input: unknown): Question[] {
  const qs = isRecord(input) ? input.questions : undefined
  if (!Array.isArray(qs)) return []
  return qs.slice(0, 4).flatMap((q): Question[] => {
    const question = words(str(q?.question), 500)
    const options = (Array.isArray(q?.options) ? q.options : []).slice(0, 6).flatMap((o: unknown) => {
      const label = words(str(rec(o).label), 120), description = words(str(rec(o).description), 300)
      return label ? [{ label, ...(description && description.toLowerCase() !== label.toLowerCase() ? { description } : {}) }] : []
    })
    const header = words(str(q?.header), 40)
    return question && options.length ? [{ question, ...(header ? { header } : {}), ...(q?.multiSelect === true ? { multi: true } : {}), options }] : []
  })
}

// (an SDK message or a transcript line: untrusted JSON, each field checked where it's read)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

const INTERRUPTED = /^\[Request interrupted by user/
/** A user line that isn't the user's: a background task's notice, another session's or a teammate's message. */
export const NOT_SAID = /^(?:<(?:agent-message|cross-session-message|teammate-message|task-notification)\b|Another Claude session sent a message)/

/** The user's own latest message in a transcript's lines: not a notice, another session's message or a subagent's prompt. */
export function userSaid(lines: string[]): { text: string; at: number } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"user"') && !lines[i].includes("queued_command")) continue
    let m: Json
    try { m = JSON.parse(lines[i]) } catch { continue }
    if (!m || typeof m !== "object" || m.isMeta || m.isSidechain || m.isSynthetic) continue
    const q = m.type === "attachment" && m.attachment?.type === "queued_command" && m.attachment.commandMode === "prompt" ? m.attachment : null
    if (!q && (m.type !== "user" || m.parent_tool_use_id)) continue
    // (newer transcripts say where a prompt came from: only a person's is theirs)
    const origin = m.origin?.kind
    if (typeof origin === "string" && origin !== "human") continue
    const content = q ? q.prompt : m.message?.content
    if (Array.isArray(content) && content.some((c: Json) => c?.type === "tool_result")) continue
    const text = userText(content)
    if (!text || NOT_SAID.test(text) || INTERRUPTED.test(text)) continue
    return { text, at: Date.parse(String(q?.timestamp ?? m.timestamp ?? "")) || 0 }
  }
  return null
}

/** A conversation read so far: `feed` takes an SDK message or transcript line and answers the entries it changed. */
export class Reader {
  entries = new Map<string, Entry>()
  prompt = ""
  text = ""
  private blocks = new Map<string, number>()
  private streaming = new Map<string, string>()
  private partial = new Map<string, string>()
  private calls = new Map<string, string>()

  private put(e: Entry, out: Entry[]) {
    this.entries.set(e.id, e)
    out.push(e)
  }

  feed(m: Json): Entry[] {
    const out: Entry[] = []
    if (!m || typeof m !== "object" || m.isMeta || m.isSidechain || m.isSynthetic) return out
    const at = typeof m.timestamp === "string" ? m.timestamp : new Date().toISOString()
    const parent = typeof m.parent_tool_use_id === "string" && m.parent_tool_use_id ? m.parent_tool_use_id : undefined
    if (m.type === "attachment") this.queued(m.attachment, out)
    else if (m.type === "user") this.user(m, at, parent, out)
    else if (m.type === "assistant") this.assistant(m, at, parent, out)
    else if (m.type === "stream_event") this.stream(m, at, parent, out)
    else if (m.type === "result") {
      const ok = m.subtype === "success" && !m.is_error
      const error = ok ? undefined : clip(String((Array.isArray(m.errors) && m.errors.join("\n")) || m.result || m.subtype || "It stopped"), 600)
      this.put({ k: "result", id: String(m.uuid ?? `result:${at}`), ok, ms: Math.max(0, Number(m.duration_ms) || 0), ...(error ? { error } : {}), at }, out)
    } else if (m.type === "system" && m.subtype === "compact_boundary") this.put({ k: "note", id: String(m.uuid ?? `compact:${at}`), text: "Conversation compacted", at }, out)
    return out
  }

  private user(m: Json, at: string, parent: string | undefined, out: Entry[]) {
    const content = m.message?.content
    if (Array.isArray(content) && content.some((c) => c?.type === "tool_result")) {
      for (const c of content) {
        if (c?.type !== "tool_result") continue
        const t = this.entries.get(String(c.tool_use_id))
        if (t?.k === "tool") this.put({ ...t, result: clip(resultText(c.content)), error: !!c.is_error, live: undefined }, out)
      }
      return
    }
    if (parent) return
    const text = userText(content, false), id = String(m.uuid ?? `user:${at}`), pics = picturesOf(id, content)
    if (!text && !pics.images) return
    if (INTERRUPTED.test(text)) return this.put({ k: "note", id, text: "Interrupted", at }, out)
    this.prompt = text || "(a picture)"
    this.text = ""
    this.put({ k: "user", id, text: clip(text, 20000), at, ...pics }, out)
  }

  // Claude Code's transcript keeps a message sent mid-turn as an attachment, not a user line
  private queued(a: Json, out: Entry[]) {
    if (a?.type !== "queued_command" || a.commandMode !== "prompt" || !a.source_uuid) return
    const text = userText(a.prompt, false), id = String(a.source_uuid), pics = picturesOf(id, a.prompt)
    if ((!text && !pics.images) || /^<(agent-message|cross-session-message|teammate-message|task-notification)\b/.test(text)) return
    this.put({ k: "user", id, text: clip(text, 20000), at: typeof a.timestamp === "string" ? a.timestamp : new Date().toISOString(), ...pics }, out)
  }

  private assistant(m: Json, at: string, parent: string | undefined, out: Entry[]) {
    const msg = m.message ?? {}
    const mid = String(msg.id ?? m.uuid ?? at)
    if (m.error && !Array.isArray(msg.content)) return this.put({ k: "note", id: String(m.uuid ?? `error:${at}`), text: errorText(m.error), tone: "error", at }, out)
    for (const c of Array.isArray(msg.content) ? msg.content : []) {
      const i = this.blocks.get(mid) ?? 0
      this.blocks.set(mid, i + 1)
      this.block(c, `${mid}:${i}`, at, parent, false, out)
    }
    if (this.streaming.get(parent ?? "") === mid) this.streaming.delete(parent ?? "")
  }

  private block(c: Json, id: string, at: string, parent: string | undefined, live: boolean, out: Entry[]) {
    const was = this.entries.get(id) ?? (c?.id ? this.entries.get(String(c.id)) : undefined)
    const own = { at: was?.at ?? at, ...(parent ? { parent } : {}), ...(live ? { live: true } : {}) }
    if (c?.type === "text") {
      const text = String(c.text ?? "")
      if (!text.trim() && !live) return
      if (!parent && !live) this.text = text.trim()
      this.put({ k: "text", id, text: clip(text, 40000), ...own }, out)
    } else if (c?.type === "thinking") {
      const text = String(c.thinking ?? "")
      if (!text.trim() && !live) return
      this.put({ k: "thinking", id, text: clip(text, 20000), ...own }, out)
    } else if (c?.type === "tool_use") {
      const name = String(c.name ?? "Tool"), input = c.input ?? {}
      const old = was?.k === "tool" ? was : null
      this.put({ k: "tool", id: String(c.id ?? id), name, summary: summarize(name, input), input, ...own,
        ...(old?.result !== undefined ? { result: old.result, error: old.error } : {}) }, out)
    }
  }

  private stream(m: Json, at: string, parent: string | undefined, out: Entry[]) {
    const ev = m.event ?? {}, key = parent ?? ""
    if (ev.type === "message_start") { this.streaming.set(key, String(ev.message?.id ?? m.api_message_id ?? "")); return }
    const mid = String(m.api_message_id ?? this.streaming.get(key) ?? "")
    if (!mid || typeof ev.index !== "number") return
    const id = `${mid}:${ev.index}`
    if (ev.type === "content_block_start") {
      const c = ev.content_block ?? {}
      if (c.type === "tool_use") { this.partial.set(String(c.id), ""); this.calls.set(id, String(c.id)) }
      this.block(c.type === "tool_use" ? { ...c, input: {} } : c, id, at, parent, true, out)
    } else if (ev.type === "content_block_delta") {
      const e = this.entries.get(this.calls.get(id) ?? id), d = ev.delta ?? {}
      if (!e || !("live" in e) || !e.live) return
      if (e.k === "text" && d.type === "text_delta") this.put({ ...e, text: e.text + String(d.text ?? "") }, out)
      else if (e.k === "thinking" && d.type === "thinking_delta") this.put({ ...e, text: e.text + String(d.thinking ?? "") }, out)
      else if (e.k === "tool" && d.type === "input_json_delta") {
        const json = (this.partial.get(e.id) ?? "") + String(d.partial_json ?? "")
        this.partial.set(e.id, json)
        const said = /"(?:command|file_path|path|pattern|url|query|description)"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(json)?.[1]
        if (said) this.put({ ...e, summary: said.replace(/\\n/g, " ").replace(/\\(.)/g, "$1").slice(0, 200) }, out)
      }
    }
  }
}

function errorText(e: unknown) {
  const s = String(e)
  if (s === "authentication_failed") return "Claude Code isn't signed in for this account: run claude in a terminal and sign in"
  if (s === "rate_limit") return "The plan's usage limit was reached"
  if (s === "billing_error") return "A billing problem stopped it"
  return `It stopped: ${s.replace(/_/g, " ")}`
}
