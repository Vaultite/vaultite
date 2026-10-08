// A Codex session's rollout as a conversation: what the user said, Codex's answers (Markdown) and each tool call (a
// command, a file change, an MCP tool, a web search) with its result. Both rollout shapes are read (Conversation).
import { cut, type Entry, type Head, type Said, type Tool, toolSummary } from "../../../core/codingagents.ts"

/** Byte strings a line must have to matter (the rest is skipped without parsing): plugin.ts tests them on the raw line. */
export const WANTED = ['"item_completed"', '"user_message"', '"agent_message"', '"function_call', '"custom_tool_call', '"local_shell_call"',
  '"session_meta"', '"turn_context"']

const PICK = ["description", "command", "cmd", "file_path", "path", "pattern", "url", "query", "prompt", "uri", "name"]
/** One line saying what a tool call did: "git status", "src/app.ts", "retry in src". */
const summarize = (name: string, input: unknown) => toolSummary(input, PICK, /grep|search/i.test(name) ? ["path"] : undefined)

/** The words of a user's message: text parts, images as a note. */
export function userText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.map((c) => (c?.type === "text" || c?.type === "input_text" ? String(c.text ?? "")
    : c?.type === "image" || c?.type === "localImage" || c?.type === "input_image" ? "_(image)_" : "")).filter(Boolean).join("\n\n")
}

/** A session's title from its first message: what follows "## My request for Codex:" when an IDE wrapped it. */
export function titleOf(text: string) {
  const at = text.indexOf("## My request for Codex:")
  return (at >= 0 ? text.slice(at + 24) : text).replace(/\s+/g, " ").trim().slice(0, 80)
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v, null, 2))
/** ["/bin/zsh", "-lc", "ls -1"] -> "ls -1". */
const commandOf = (c: unknown) => (Array.isArray(c) ? (c.length === 3 && /(^|\/)(ba|z|fi)?sh$/.test(String(c[0])) && /^-l?c$/.test(String(c[1])) ? String(c[2]) : c.join(" ")) : str(c))
const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~")

/** A turn item that is a tool call, as one entry (null: not a tool call). */
function toolOf(it: Record<string, any>, at: string): Tool | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  const id = String(it.id ?? "")
  const t = (name: string, summary: string, input: string, result: string | null, error = false): Tool =>
    ({ kind: "tool", id, name, summary: summary.replace(/\s+/g, " ").trim().slice(0, 200), input: cut(input), result: result === null ? null : cut(result), error, at })
  switch (it.type) {
    case "CommandExecution": {
      const cmd = commandOf(it.command)
      return t("Shell", cmd, cmd, str(it.aggregated_output ?? it.formatted_output ?? it.stdout), typeof it.exit_code === "number" && it.exit_code !== 0)
    }
    case "FileChange": {
      const files = Object.keys(it.changes ?? {})
      const diff = files.map((f) => {
        const c = it.changes[f] ?? {}
        return `${c.type ?? "update"} ${home(f)}${c.unified_diff ? `\n${c.unified_diff}` : c.content ? `\n${c.content}` : ""}`
      }).join("\n\n")
      return t("Edit", files.map((f) => f.split("/").pop()).join(", "), diff, [it.stdout, it.stderr].filter(Boolean).join("\n") || (it.status ? String(it.status) : ""),
        it.status === "failed" || it.status === "declined")
    }
    case "McpToolCall":
      return t(`${it.server ?? "mcp"} ${it.tool ?? ""}`.trim(), summarize(String(it.tool ?? ""), it.arguments), str(it.arguments),
        it.error ? str(it.error) : it.result == null ? null : str(it.result), !!it.error)
    case "WebSearch":
      return t("Web search", String(it.query ?? ""), String(it.query ?? ""), it.results ? str(it.results) : null)
    case "DynamicToolCall":
      return t(String(it.tool ?? it.name ?? "Tool"), summarize(String(it.tool ?? ""), it.arguments), str(it.arguments),
        it.output == null && it.result == null ? null : str(it.output ?? it.result), it.success === false)
    case "CollabAgentToolCall":
    case "SubAgentActivity":
      return t("Agent", String(it.prompt ?? it.description ?? it.tool ?? ""), str(it), null)
    case "ImageGeneration":
      return t("Image", String(it.revised_prompt ?? ""), String(it.revised_prompt ?? ""), it.saved_path ? String(it.saved_path) : null, it.status === "failed")
    default:
      return null
  }
}

/** A conversation read so far, fed one line of the rollout at a time (the lines with a WANTED string). Rollouts come
 *  paginated (event_msg item_completed with turn items) or legacy (user_message / agent_message, response_item calls). */
export class Conversation {
  entries: Entry[] = []
  head: Head = { title: "", cwd: "", model: "", first: "", last: "", branch: "" }
  /** The file's own session: a forked one starts with its parent's session_meta, which isn't its own. */
  id: string
  // A paginated file also logs the model's raw tool calls as response items: once it's known, those are left out.
  private paginated = false
  private tools = new Map<string, Tool>()
  private models = new Map<string, number>()

  constructor(id = "") { this.id = id }

  /** Done with the lines there are for now: the model is the one used most. */
  settle() {
    const top = [...this.models].sort((a, b) => b[1] - a[1])[0]
    this.head.model = top ? top[0] : ""
    return this
  }

  private said(kind: Said["kind"], text: string, at: string) {
    text = text.trim()
    if (!text) return
    if (kind === "user" && !this.head.title) this.head.title = titleOf(text)
    this.entries.push({ kind, text: cut(text, 20000), at })
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
    const p = d.payload ?? {}
    const at = typeof d.timestamp === "string" ? d.timestamp : ""
    if (d.type === "session_meta") {
      if (!this.id || p.id === this.id || !this.head.cwd) {
        if (p.cwd) this.head.cwd = String(p.cwd)
        if (p.git?.branch) this.head.branch = String(p.git.branch)
      }
      return
    }
    if (d.type === "turn_context") {
      if (typeof p.model === "string" && p.model) this.models.set(p.model, (this.models.get(p.model) ?? 0) + 1)
      return
    }
    if (at && (d.type === "event_msg" || d.type === "response_item")) { this.head.first ||= at; this.head.last = at }
    if (d.type === "event_msg") {
      if (p.type === "item_completed" && p.item && typeof p.item === "object") {
        this.paginated = true
        const it = p.item
        if (it.type === "UserMessage") this.said("user", userText(it.content), at)
        else if (it.type === "AgentMessage") this.said("assistant", userText((it.content ?? []).map((c: { type?: string; text?: string }) => ({ type: "text", text: c?.text }))), at)
        else {
          const tool = toolOf(it, at)
          if (tool) this.entries.push(tool)
        }
      } else if (!this.paginated && p.type === "user_message") this.said("user", String(p.message ?? ""), at)
      else if (!this.paginated && p.type === "agent_message") this.said("assistant", String(p.message ?? ""), at)
      return
    }
    if (d.type !== "response_item" || this.paginated) return
    // Legacy: the model's tool calls and their outputs, by call id.
    if (p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call") {
      let input: unknown = p.type === "function_call" ? p.arguments : p.type === "custom_tool_call" ? p.input : p.action
      if (typeof input === "string") try { input = JSON.parse(input) } catch { /* as it is */ }
      const cmd = p.type === "local_shell_call" ? commandOf(p.action?.command) : input && typeof input === "object" && "command" in input ? commandOf((input as { command: unknown }).command) : ""
      const name = p.type === "local_shell_call" || p.name === "shell" || p.name === "exec_command" ? "Shell" : String(p.name ?? "Tool")
      const tool: Tool = { kind: "tool", id: String(p.call_id ?? p.id ?? ""), name, summary: (cmd || summarize(name, input)).replace(/\s+/g, " ").slice(0, 200),
        input: cut(cmd || str(input)), result: null, error: false, at }
      this.tools.set(tool.id, tool)
      this.entries.push(tool)
    } else if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
      const tool = this.tools.get(String(p.call_id ?? ""))
      if (!tool) return
      const out = p.output
      tool.result = cut(typeof out === "string" ? out : Array.isArray(out) ? userText(out) : str(out?.content ?? out))
      tool.error = out?.success === false
    }
  }
}
