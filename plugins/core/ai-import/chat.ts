export type Part =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string; lang?: string; title?: string; open?: boolean }
  | { kind: "output"; text: string; title?: string }
  | { kind: "thinking"; text: string }
  | { kind: "image"; ref: string | null; name?: string; size?: number }
  | { kind: "file"; name: string; text?: string; saved?: string }
  | { kind: "memory"; text: string }
  | { kind: "note"; text: string }

export type Message = {
  role: "user" | "assistant" | "tool"
  name?: string
  at?: number
  model?: string
  parts: Part[]
}

export type Chat = {
  source: "chatgpt" | "claude"
  id: string
  title: string
  created?: number
  updated?: number
  models: string[]
  messages: Message[]
  otherBranches: number
  url?: string
  project?: string
}

export type MemoryAbout = "me" | "preference" | string

export type Memory = { text: string; about: MemoryAbout; from: string; at?: number }

export type Project = { id: string; name: string; description?: string; instructions?: string; created?: number; updated?: number
  docs: { name: string; text: string; saved?: string }[] }

export type Job = {
  id: string
  state: "queued" | "running" | "done" | "failed"
  name: string
  source: "chatgpt" | "claude" | null
  read: number
  total: number
  chats: number; created: number; updated: number; unchanged: number; skipped: number
  images: number; projects: number
  files: number
  memories: number
  review: string | null
  folder: string | null
  problems: string[]
  error?: string
  started: number
  finished?: number
}

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
export const text = (v: unknown) => (typeof v === "string" ? v : "")
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export function timeOf(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v < 1e11 ? Math.round(v * 1000) : Math.round(v)
  if (typeof v === "string" && v.trim()) {
    const t = Date.parse(v)
    return Number.isNaN(t) ? undefined : t
  }
  return undefined
}

export const said = (c: Chat) => c.messages.filter((m) => m.role !== "tool" && m.parts.some(filled)).length
const filled = (p: Part) => p.kind === "image" || p.kind === "file" || !!p.text.trim()

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

export function aboutOf(fact: string): MemoryAbout {
  return /\b(prefers?|preference|would like (you|chatgpt|claude)|wants? (you|chatgpt|claude|responses|answers)|respond|responses?|answers? (in|with|to be)|replies|tone|concise|verbose|bullet points|format(ting)?|call (me|them|him|her)|address (me|them)|don'?t (use|say|include)|avoid using|always (use|answer|reply)|never (use|say))\b/i.test(fact)
    ? "preference" : "me"
}
