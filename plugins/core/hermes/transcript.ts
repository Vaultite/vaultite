// A Hermes session's conversation, from its rows in Hermes' messages table: what the user said, the model's answers
// (Markdown) and each tool call with its result. System rows, reasoning and compression summaries are left out.
import { cut, type Entry, type Said, type Tool, toolSummary } from "../../../core/codingagents.ts"

/** A row of the messages table, as stored (content may be JSON after Hermes' "\0json:" marker). */
export type Row = { role: string; content: string | null; tool_calls: string | null; tool_call_id: string | null
  tool_name: string | null; timestamp: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const json = (s: unknown): Any => {
  if (typeof s !== "string") return null
  try { return JSON.parse(s) } catch { return null }
}
const at = (sec: unknown) => (typeof sec === "number" && sec > 0 ? new Date(sec * 1000).toISOString() : "")

/** A message's text: a string, or multimodal parts (text kept, an image or a file named). */
export function textOf(content: string | null): string {
  if (!content) return ""
  if (!content.startsWith("\0json:")) return content.trim()
  const v = json(content.slice(6))
  const parts = Array.isArray(v) ? v : v ? [v] : []
  return parts.map((p: Any) => typeof p === "string" ? p : p?.type === "text" ? String(p.text ?? "")
    : p?.type === "image_url" || p?.type === "image" ? "_(image)_" : p?.type ? `_(${p.type})_` : "").filter(Boolean).join("\n\n").trim()
}

const PICK = ["description", "command", "path", "file_path", "pattern", "query", "url", "goal", "name", "prompt", "code", "action"]
const summarize = (name: string, input: unknown) => toolSummary(input, PICK, name === "search_files" ? ["path"] : undefined)

/** A tool's result: its output when Hermes wrapped it in JSON ({"output": ...}), an error when it says one. */
function result(content: string | null): { text: string; error: boolean } {
  const raw = textOf(content)
  const v = json(raw)
  if (!v || typeof v !== "object" || Array.isArray(v)) return { text: raw, error: false }
  if (typeof v.error === "string" && v.error) return { text: v.error, error: true }
  const out = [v.output, v.content, v.result].find((x) => typeof x === "string")
  return { text: out ?? raw, error: v.success === false }
}

/** A session's messages (active ones, in order) as a conversation, with its first and last times and its first prompt. */
export function conversation(rows: Row[]) {
  const entries: Entry[] = []
  const head = { first: "", last: "", prompt: "" }
  const calls = new Map<string, Tool>()
  for (const r of rows) {
    const when = at(r.timestamp)
    if (when) { head.first ||= when; head.last = when }
    if (r.role === "user" || r.role === "assistant") {
      const text = textOf(r.content)
      if (text) {
        const said: Said = { kind: r.role, text: cut(text, 20000), at: when }
        entries.push(said)
        if (r.role === "user" && !head.prompt) head.prompt = text.replace(/\s+/g, " ").slice(0, 80)
      }
      const list = r.role === "assistant" ? json(r.tool_calls) : null
      for (const c of Array.isArray(list) ? list : []) {
        const name = String(c?.function?.name ?? c?.name ?? "tool")
        const args = c?.function?.arguments ?? c?.arguments ?? {}
        const input = typeof args === "string" ? (json(args) ?? args) : args
        const t: Tool = { kind: "tool", id: String(c?.id ?? ""), name, summary: summarize(name, input),
          input: cut(typeof input === "string" ? input : JSON.stringify(input, null, 2)), result: null, error: false, at: when }
        entries.push(t)
        if (t.id) calls.set(t.id, t)
      }
    } else if (r.role === "tool") {
      const t = calls.get(String(r.tool_call_id ?? ""))
      if (!t) continue
      const out = result(r.content)
      t.result = cut(out.text)
      t.error = out.error
    }
  }
  return { entries, ...head }
}
