// A Claude Code session's transcript as a conversation: what the user said, Claude's answers (Markdown) and each tool
// call with its result; attachments, thinking, sidechains and meta lines are skipped.
import { cut, type Entry, type Head, type Tool, toolSummary } from "../../../core/codingagents.ts"

/** Byte strings a line must have to matter (the rest is skipped without parsing): plugin.ts tests them on the raw line. */
export const WANTED = ['"type":"user"', '"type":"assistant"', '"ai-title"', '"custom-title"']

const PICK = ["description", "command", "file_path", "path", "pattern", "url", "query", "prompt", "skill", "notebook_path", "subject", "task_id"]
/** One line saying what a tool call did: "git status", "src/app.ts", "TODO in *.ts". */
const summarize = (name: string, input: unknown) => toolSummary(input, PICK, name === "Grep" ? ["path", "glob"] : undefined)

/** What a user message says, as Markdown: a slash command as "/name args", system reminders and command output left out. */
function userText(content: unknown): string {
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

function resultText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.map((c) => (c?.type === "text" ? String(c.text ?? "") : c?.type === "image" ? "(image)" : "")).filter(Boolean).join("\n")
  return content == null ? "" : JSON.stringify(content)
}

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
          if (t) { t.result = cut(resultText(c.content)); t.error = !!c.is_error }
        }
        return
      }
      const text = userText(content)
      if (!text) return
      if (!this.firstPrompt) this.firstPrompt = text.replace(/\s+/g, " ").slice(0, 80)
      this.entries.push({ kind: "user", text: cut(text, 20000), at })
      return
    }
    if (typeof m.model === "string" && !m.model.startsWith("<")) this.models.set(m.model, (this.models.get(m.model) ?? 0) + 1)
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (c?.type === "text" && String(c.text ?? "").trim()) {
        // A streamed reply comes one content block per line: text after text of the same message joins it.
        const last = this.entries[this.entries.length - 1]
        const text = String(c.text).trim()
        if (last?.kind === "assistant" && m.id && this.lastMsg === m.id) last.text += `\n\n${text}`
        else this.entries.push({ kind: "assistant", text: cut(text, 20000), at })
        this.lastMsg = m.id ?? ""
      } else if (c?.type === "tool_use") {
        const input = c.input ?? {}
        const t: Tool = { kind: "tool", id: String(c.id ?? ""), name: String(c.name ?? "Tool"), summary: summarize(String(c.name ?? ""), input),
          input: cut(typeof input === "string" ? input : JSON.stringify(input, null, 2)), result: null, error: false, at }
        this.tools.set(t.id, t)
        this.entries.push(t)
        this.lastMsg = ""
      }
    }
  }
}
