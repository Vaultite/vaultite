// A Claude Code session's transcript as a conversation: what the user said, Claude's answers (Markdown) and each tool
// call with its result; attachments, thinking, sidechains and meta lines are skipped.
import { type Asking, truncate, type Entry, type Head, type Tool } from "../../../core/agents.ts"
import { questionsOf, resultText, summarize, userText } from "./chatlog.ts"
// (a transcript line: untrusted JSON, each field checked where it's read)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

/** Byte strings a line must have to matter (the rest is skipped without parsing): plugin.ts tests them on the raw line. */
export const WANTED = ['"type":"user"', '"type":"assistant"', '"ai-title"', '"custom-title"']

/** A conversation read so far, fed one line of the transcript at a time (the lines with a WANTED string). */
export class Conversation {
  entries: Entry[] = []
  head: Head = { title: "", cwd: "", model: "", first: "", last: "", branch: "" }
  private titleKind = ""
  private lastMsg = ""
  private firstPrompt = ""
  private tools = new Map<string, Tool>()
  private models = new Map<string, number>()

  /** Done with the lines there are for now: the title falls back to the first prompt, the model is the most used. */
  settle() {
    const top = [...this.models].sort((a, b) => b[1] - a[1])[0]
    this.head.model = top ? top[0] : ""
    if (!this.titleKind) this.head.title = this.firstPrompt
    return this
  }

  /** One line of the file (a JSON record). */
  line(text: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let d: any
    try {
      d = JSON.parse(text)
    } catch {
      return
    }
    if (!d || typeof d !== "object") return
    if (d.type === "custom-title" && d.customTitle) { this.head.title = String(d.customTitle); this.titleKind = "custom"; return }
    if (d.type === "ai-title" && d.aiTitle) { if (this.titleKind !== "custom") { this.head.title = String(d.aiTitle); this.titleKind = "ai" } return }
    if ((d.type !== "user" && d.type !== "assistant") || d.isSidechain || d.isMeta) return
    const at = typeof d.timestamp === "string" ? d.timestamp : ""
    if (at) { this.head.first ||= at; this.head.last = at }
    if (d.cwd && !this.head.cwd) this.head.cwd = String(d.cwd)
    if (d.gitBranch && d.gitBranch !== "HEAD") this.head.branch = String(d.gitBranch)
    const m = d.message ?? {}
    if (d.type === "user") {
      const content = m.content
      if (Array.isArray(content) && content.some((c) => c?.type === "tool_result")) {
        for (const c of content) {
          if (c?.type !== "tool_result") continue
          const t = this.tools.get(String(c.tool_use_id))
          if (t) { t.result = truncate(resultText(c.content)); t.error = !!c.is_error }
        }
        return
      }
      const text = userText(content)
      if (!text) return
      if (!this.firstPrompt) this.firstPrompt = text.replace(/\s+/g, " ").slice(0, 80)
      this.entries.push({ kind: "user", text: truncate(text, 20000), at })
      return
    }
    if (typeof m.model === "string" && !m.model.startsWith("<")) this.models.set(m.model, (this.models.get(m.model) ?? 0) + 1)
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (c?.type === "text" && String(c.text ?? "").trim()) {
        // A streamed reply comes one content block per line: text after text of the same message joins it.
        const last = this.entries[this.entries.length - 1]
        const text = String(c.text).trim()
        if (last?.kind === "assistant" && m.id && this.lastMsg === m.id) last.text += `\n\n${text}`
        else this.entries.push({ kind: "assistant", text: truncate(text, 20000), at })
        this.lastMsg = m.id ?? ""
      } else if (c?.type === "tool_use") {
        const input = c.input ?? {}
        const t: Tool = { kind: "tool", id: String(c.id ?? ""), name: String(c.name ?? "Tool"), summary: summarize(String(c.name ?? ""), input),
          input: truncate(typeof input === "string" ? input : JSON.stringify(input, null, 2)), result: null, error: false, at }
        this.tools.set(t.id, t)
        this.entries.push(t)
        this.lastMsg = ""
      }
    }
  }
}

/** What a transcript's tail waits on: its last tool call still without a result, when that's AskUserQuestion (its
 *  questions) or ExitPlanMode (its plan). A prompt after it, or another tool waiting, means it asks nothing. */
export function askingIn(tail: string): Asking | null {
  const answered = new Set<string>()
  const lines = tail.split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!WANTED.slice(0, 2).some((w) => lines[i].includes(w))) continue
    let d: Json
    try { d = JSON.parse(lines[i]) } catch { continue }
    const content = d?.message?.content
    if (d?.isSidechain || d?.isMeta) continue
    if (d.type === "user" && !Array.isArray(content)) return null
    for (const c of Array.isArray(content) ? [...content].reverse() : []) {
      if (c?.type === "tool_result") answered.add(String(c.tool_use_id))
      else if (d.type === "user" && c?.type === "text" && userText([c])) return null
      else if (c?.type === "tool_use" && !answered.has(String(c.id))) {
        if (c.name === "AskUserQuestion") { const questions = questionsOf(c.input); return questions.length ? { kind: "question", questions } : null }
        if (c.name === "ExitPlanMode" && typeof c.input?.plan === "string" && c.input.plan.trim()) return { kind: "plan", plan: c.input.plan.trim().slice(0, 8000) }
        return null
      }
    }
  }
  return null
}
