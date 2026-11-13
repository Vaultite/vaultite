import { type Asking, truncate, type Entry, type Head, type Tool } from "../../../core/agents.ts"
import { NOT_SAID, questionsOf, resultText, summarize, userText } from "./chatlog.ts"
// (a transcript line: untrusted JSON, each field checked where it's read)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

export const WANTED = ['"type":"user"', '"type":"assistant"', '"ai-title"', '"custom-title"', '"type":"queue-operation"']

export class Conversation {
  entries: Entry[] = []
  head: Head = { title: "", cwd: "", model: "", first: "", last: "", branch: "" }
  background = new Set<string>()
  auto: { text: string; at: string } | null = null
  private promptId = ""
  private tasks = new Map<string, string>()
  private titleKind = ""
  private lastMsg = ""
  private firstPrompt = ""
  private tools = new Map<string, Tool>()
  private models = new Map<string, number>()

  settle() {
    const top = [...this.models].sort((a, b) => b[1] - a[1])[0]
    this.head.model = top ? top[0] : ""
    if (!this.titleKind) this.head.title = this.firstPrompt
    return this
  }

  private started(d: Json, text: string, at: string, meta: boolean) {
    const id = typeof d.promptId === "string" ? d.promptId : ""
    if (meta && (!id || id === this.promptId || !text)) return
    if (id) this.promptId = id
    const origin = d.origin?.kind
    this.auto = meta || (typeof origin === "string" && origin !== "human") || NOT_SAID.test(text) ? { text, at } : null
  }

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
    if (d.type === "queue-operation") {
      // (a Monitor's events come without a status: only one with a status ends the tasks it names)
      const n = String(d.content ?? "")
      if (!/<task-notification>/.test(n) || !/<status>/.test(n)) return
      for (const [, id] of n.matchAll(/<tool-use-id>([^<]+)<\/tool-use-id>/g)) this.background.delete(id)
      for (const [, id] of n.matchAll(/<task-id>([^<]+)<\/task-id>/g)) { const u = this.tasks.get(id); if (u) this.background.delete(u) }
      return
    }
    if ((d.type !== "user" && d.type !== "assistant") || d.isSidechain) return
    const at = typeof d.timestamp === "string" ? d.timestamp : ""
    if (d.isMeta) return void this.started(d, typeof d.message?.content === "string" ? userText(d.message.content) : "", at, true)
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
          const id = String(c.tool_use_id)
          if (c.is_error) { this.background.delete(id); continue }
          // (TaskStop ends one with no notice after it)
          if (t?.name === "TaskStop" || t?.name === "KillShell") { const u = this.tasks.get(/"(?:task|shell)_id": "([^"]+)"/.exec(t.input)?.[1] ?? ""); if (u) this.background.delete(u); continue }
          const task = backgroundTask(resultText(c.content))
          if (task && !(t?.name === "Monitor" && /"persistent": true/.test(t.input))) { this.background.add(id); this.tasks.set(task, id) }
        }
        return
      }
      const text = userText(content)
      if (!text) return
      this.started(d, text, at, false)
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
        if (input.run_in_background === true) this.background.add(t.id)
        this.lastMsg = ""
      }
    }
  }
}

export function backgroundTask(result: string) {
  return /^(?:Command (?:running in background|was manually backgrounded[^\n]*?) with ID: |Command [^\n]*?moved to the background \(ID: |Monitor started \(task |Async agent launched[\s\S]*?agentId: )([\w-]+)/m.exec(result)?.[1] ?? null
}

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
