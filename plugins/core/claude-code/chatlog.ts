// A Claude Code conversation as the chat tab draws it, read from the Agent SDK's messages (live, streamed) and from a
// transcript's lines alike: both carry the same ids, so a session's history and its live turn merge by id. Node-free.

/** A question as AskUserQuestion asks it (core/agents.ts' Question). */
export type Question = { question: string; header?: string; multi?: boolean; options: { label: string; description?: string }[] }
/** What an ask is: a tool to allow, AskUserQuestion's questions, or ExitPlanMode's plan. */
export type AskKind = "permission" | "question" | "plan"

/** One thing in a conversation, by id: a user message (its uuid), a block of an answer (`<message id>:<index>`), a tool
 *  call (its tool_use id), what a session asks (`ask:<tool_use id>`), a turn's end, a note. `live`: still streaming. */
export type Entry =
  | { k: "user"; id: string; text: string; at: string }
  | { k: "text" | "thinking"; id: string; text: string; at: string; live?: boolean; parent?: string }
  | { k: "tool"; id: string; name: string; summary: string; input: unknown; result?: string; error?: boolean; at: string; live?: boolean; parent?: string }
  | { k: "ask"; id: string; kind: AskKind; tool: string; title: string; detail?: string; input?: unknown; questions?: Question[]; plan?: string
      /** What Always allow allows ("git push commands"), when it's offered. */
      always?: string
      /** How it was answered ("Allowed", "Answered"), once it was. */
      answer?: string; at: string }
  | { k: "result"; id: string; ok: boolean; ms: number; error?: string; at: string }
  | { k: "note"; id: string; text: string; tone?: "error"; at: string }

/** Long texts cut short: the tab is for reading a conversation, not for the raw data. */
export const clip = (s: string, n = 4000) => (s.length > n ? `${s.slice(0, n)}\n… (${(s.length - n).toLocaleString("en-US")} more characters)` : s)

const PICK = ["description", "command", "file_path", "path", "pattern", "url", "query", "prompt", "skill", "notebook_path", "subject", "task_id"]
/** One line saying what a tool call does: "git status", "src/app.ts", "TODO in *.ts". */
export function summarize(name: string, input: unknown) {
  const o = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
  const text = (v: unknown): v is string => typeof v === "string" && !!v
  let s = typeof input === "string" ? input : PICK.map((k) => o[k]).find(text) ?? Object.values(o).find(text) ?? ""
  if (name === "Grep" && typeof o.pattern === "string") {
    const w = [o.path, o.glob].find(text)
    s = w ? `${o.pattern} in ${w}` : o.pattern
  }
  return s.replace(/\s+/g, " ").trim().slice(0, 200)
}

/** What a user message says, as Markdown: a slash command as "/name args", system reminders and command output left out. */
export function userText(content: unknown): string {
  let s = ""
  if (typeof content === "string") s = content
  else if (Array.isArray(content)) {
    s = content.map((c) => (c?.type === "text" ? String(c.text ?? "") : c?.type === "image" ? "_(image)_" : "")).filter(Boolean).join("\n\n")
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

const words = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "")

/** AskUserQuestion's input as questions (at most 4, of 2 to 6 options each), or none when it isn't one. */
export function questionsOf(input: unknown): Question[] {
  const qs = (input as { questions?: unknown })?.questions
  if (!Array.isArray(qs)) return []
  return qs.slice(0, 4).flatMap((q): Question[] => {
    const question = words(q?.question, 500)
    const options = (Array.isArray(q?.options) ? q.options : []).slice(0, 6).flatMap((o: unknown) => {
      const label = words((o as Json)?.label, 120), description = words((o as Json)?.description, 300)
      // (one that only says its label again says nothing)
      return label ? [{ label, ...(description && description.toLowerCase() !== label.toLowerCase() ? { description } : {}) }] : []
    })
    const header = words(q?.header, 40)
    return question && options.length ? [{ question, ...(header ? { header } : {}), ...(q?.multiSelect === true ? { multi: true } : {}), options }] : []
  })
}

// (an SDK message or a transcript line: untrusted JSON, each field checked where it's read)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

const INTERRUPTED = /^\[Request interrupted by user/

/** A conversation read so far: `feed` takes one SDK message or transcript line and answers the entries it changed. */
export class Reader {
  entries = new Map<string, Entry>()
  /** The last answer's text since the user last spoke, and what they said: a turn's end tells the inbox both. */
  prompt = ""
  text = ""
  /** Blocks of a message seen so far (its next block's index), by message id. */
  private blocks = new Map<string, number>()
  /** The message each stream is in, by the tool call a subagent runs under ("" for the main one). */
  private streaming = new Map<string, string>()
  private partial = new Map<string, string>()
  /** A streamed tool call's id, by its block's (`<message id>:<index>`). */
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
    if (m.type === "user") this.user(m, at, parent, out)
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
    if (parent) return // (a subagent's prompt: its Agent call says it)
    const text = userText(content)
    if (!text) return
    const id = String(m.uuid ?? `user:${at}`)
    if (INTERRUPTED.test(text)) return this.put({ k: "note", id, text: "Interrupted", at }, out)
    this.prompt = text
    this.text = ""
    this.put({ k: "user", id, text: clip(text, 20000), at }, out)
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

  /** One block of an answer, whole (`live` false) or as streamed so far. */
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

  /** A streamed piece (includePartialMessages): the block it's in grows, drawn as it comes. */
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
        // (the command as it's written: the input's first string so far)
        const json = (this.partial.get(e.id) ?? "") + String(d.partial_json ?? "")
        this.partial.set(e.id, json)
        const said = /"(?:command|file_path|path|pattern|url|query|description)"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(json)?.[1]
        if (said) this.put({ ...e, summary: said.replace(/\\n/g, " ").replace(/\\(.)/g, "$1").slice(0, 200) }, out)
      }
    }
  }
}

/** An assistant message's error (the SDK's: "rate_limit", "authentication_failed"...) in words. */
function errorText(e: unknown) {
  const s = String(e)
  if (s === "authentication_failed") return "Claude Code isn't signed in for this account: run claude in a terminal and sign in"
  if (s === "rate_limit") return "The plan's usage limit was reached"
  if (s === "billing_error") return "A billing problem stopped it"
  return `It stopped: ${s.replace(/_/g, " ")}`
}
