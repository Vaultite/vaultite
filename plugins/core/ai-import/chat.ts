// What both exports become before they're written: a chat (the branch the user last saw) and memory candidates.

/** A piece of a message. */
export type Part =
  | { kind: "text"; text: string }
  /** Code the AI ran or wrote (a tool call, an artifact): `title` says what it is. */
  | { kind: "code"; text: string; lang?: string; title?: string; open?: boolean }
  /** What a tool answered (code's output, a page it read). */
  | { kind: "output"; text: string; title?: string }
  | { kind: "thinking"; text: string }
  /** An image: `ref` is the export's id for its file (ChatGPT's file-...), null when the export has no bytes for it. */
  | { kind: "image"; ref: string | null; name?: string; size?: number }
  /** A file the user attached: its text when the export has it (Claude's extracted_content); `saved`, the vault file
   *  a long one went to. */
  | { kind: "file"; name: string; text?: string; saved?: string }
  /** Something the AI saved to its memory during the chat. */
  | { kind: "memory"; text: string }
  /** A one-line note about what happened (a web search, an edit to an artifact). */
  | { kind: "note"; text: string }

export type Message = {
  role: "user" | "assistant" | "tool"
  /** A tool's name (python, web_search). */
  name?: string
  /** ms since the epoch, when known. */
  at?: number
  model?: string
  parts: Part[]
}

export type Chat = {
  source: "chatgpt" | "claude"
  /** The export's id for it. */
  id: string
  title: string
  created?: number
  updated?: number
  /** Models that answered, in the order they first did. */
  models: string[]
  messages: Message[]
  /** Branches not shown (edited prompts, regenerated answers): the transcript is the one the user last saw. */
  otherBranches: number
  url?: string
  /** Its project's id (Claude), linked to the project's note when the export has it. */
  project?: string
}

/** Who a memory is about, as the review list labels it: the user, how they want AIs to work, or a person's name. */
export type MemoryAbout = "me" | "preference" | string

export type Memory = { text: string; about: MemoryAbout; from: string; at?: number }

export type Project = { id: string; name: string; description?: string; instructions?: string; created?: number; updated?: number
  docs: { name: string; text: string; saved?: string }[] }

/** An import as the API reports it (importer.ts runs it, plugin.ts serves it, the app follows it). */
export type Job = {
  id: string
  state: "queued" | "running" | "done" | "failed"
  /** The file's name as uploaded. */
  name: string
  source: "chatgpt" | "claude" | null
  /** conversations.json read so far and its size, in bytes (progress). */
  read: number
  total: number
  chats: number; created: number; updated: number; unchanged: number; skipped: number
  images: number; projects: number
  /** Attachments and project files too long to read inline, written as files of their own. */
  files: number
  /** Memories added to the review list, and the list's path. */
  memories: number
  review: string | null
  /** Where the chats went (<folder>/<ChatGPT>). */
  folder: string | null
  /** Conversations that couldn't be read (the first few). */
  problems: string[]
  error?: string
  started: number
  finished?: number
}

// ---------- helpers both formats use ----------

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
export const text = (v: unknown) => (typeof v === "string" ? v : "")
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** A time in the export (seconds since the epoch, ms, or ISO text) as ms, or undefined. */
export function timeOf(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v < 1e11 ? Math.round(v * 1000) : Math.round(v)
  if (typeof v === "string" && v.trim()) {
    const t = Date.parse(v)
    return Number.isNaN(t) ? undefined : t
  }
  return undefined
}

/** Messages that count: the user's and the AI's with something in them. */
export const said = (c: Chat) => c.messages.filter((m) => m.role !== "tool" && m.parts.some(filled)).length
const filled = (p: Part) => p.kind === "image" || p.kind === "file" || !!p.text.trim()

/** Text split into memory candidates: list items and the sentences of paragraphs; headings and bold-only lines (a
 *  section's name) left out. */
export function factsOf(raw: string): string[] {
  const out: string[] = []
  const add = (s: string) => {
    const t = s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim()
    if (t.length >= 3 && /[a-z]/i.test(t)) out.push(t)
  }
  let para: string[] = []
  const flush = () => {
    const p = para.join(" ").trim()
    para = []
    if (!p) return
    for (const s of p.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)) add(s)
  }
  for (const line of raw.replace(/\r\n?/g, "\n").split("\n")) {
    const l = line.trim()
    if (!l) { flush(); continue }
    if (/^#{1,6}\s/.test(l) || /^\*\*[^*]+\*\*:?$/.test(l) || /^[-=*_]{3,}$/.test(l)) { flush(); continue }
    const item = /^(?:[-*+•]|\d+[.)])\s+(.*)$/.exec(l)
    if (item) { flush(); add(item[1]); continue }
    para.push(l)
  }
  flush()
  return out
}

/** Who a memory sentence is probably about: a preference for how AIs should answer, else the user. (A person's name is
 *  for the user to set in the review list: guessing it is how facts land on the wrong person.) */
export function aboutOf(fact: string): MemoryAbout {
  return /\b(prefers?|preference|would like (you|chatgpt|claude)|wants? (you|chatgpt|claude|responses|answers)|respond|responses?|answers? (in|with|to be)|replies|tone|concise|verbose|bullet points|format(ting)?|call (me|them|him|her)|address (me|them)|don'?t (use|say|include)|avoid using|always (use|answer|reply)|never (use|say))\b/i.test(fact)
    ? "preference" : "me"
}
