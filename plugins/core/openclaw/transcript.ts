// An OpenClaw session's conversation, from its transcript events (a `session` header, then entries linked by parentId):
// what the user said, the answers and each tool call with its result; thinking and bookkeeping entries are left out.
import { cut, type Entry, type Said, type Tool, toolSummary } from "../../../core/codingagents.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Any = any

const at = (v: unknown) => {
  const ms = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : ""
}
const str = (v: unknown) => (typeof v === "string" ? v : "")

const PICK = ["description", "command", "path", "file_path", "filePath", "pattern", "url", "query", "task", "prompt", "name"]

/** A message's text: its string, or its text parts (an image as a mark). */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content.trim()
  if (!Array.isArray(content)) return ""
  return content.map((c: Any) => (c?.type === "text" ? str(c.text).trim() : c?.type === "image" ? "_(image)_" : "")).filter(Boolean).join("\n\n")
}

/** A user message the runtime added (context for the model), not something the user said. */
export const injected = (m: Any) => !!(m?.runtimeContext || m?.runtimeContextCarrier)

/** The entries on the active branch (the last entry's, or a `leaf` control's target, and its ancestors), or null when
 *  they aren't linked: a rewind leaves its old branch in the transcript. */
function activePath(events: Any[]): Set<string> | null {
  const parent = new Map<string, string | null>()
  let tip: string | null = null
  for (const e of events) {
    if (!e || e.type === "session" || typeof e.id !== "string") continue
    if (!Object.hasOwn(e, "parentId")) return null
    if (e.type === "leaf") { parent.set(e.id, str(e.targetId) || null); tip = str(e.targetId) || null } else {
      parent.set(e.id, str(e.parentId) || null)
      if (e.appendMode !== "side") tip = e.id
    }
  }
  const on = new Set<string>()
  for (let id = tip; id && !on.has(id); id = parent.get(id) ?? null) on.add(id)
  return on.size ? on : null
}

/** A session's events (in order) as a conversation, with its folder, first and last times, the model it used most and
 *  its first prompt. */
export function conversation(events: Any[]) {
  const on = activePath(events)
  const entries: Entry[] = []
  const head = { cwd: "", first: "", last: "", model: "", prompt: "" }
  const models = new Map<string, number>()
  const calls = new Map<string, Tool>()
  for (const e of events) {
    if (e?.type === "session") { head.cwd ||= str(e.cwd); continue }
    if (e?.type !== "message" || !e.message || typeof e.message !== "object") continue
    if (on && !on.has(e.id) && !(e.appendMode === "side" && on.has(e.parentId))) continue
    const m = e.message, when = at(m.timestamp) || at(e.timestamp)
    if (when) { head.first ||= when; head.last = when }
    if (m.role === "user") {
      const text = injected(m) ? "" : textOf(m.content)
      if (!text) continue
      entries.push({ kind: "user", text: cut(text, 20000), at: when })
      head.prompt ||= text.replace(/\s+/g, " ").slice(0, 80)
    } else if (m.role === "assistant") {
      if (str(m.model)) models.set(m.model, (models.get(m.model) ?? 0) + 1)
      // Text parts make one entry; a tool call ends it (text after it is a new one).
      let said: Said | null = null
      for (const c of Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }]) {
        if (c?.type === "text" && str(c.text).trim()) {
          if (said) said.text += `\n\n${c.text.trim()}`
          else entries.push(said = { kind: "assistant", text: c.text.trim(), at: when })
        } else if (c?.type === "toolCall") {
          // OpenClaw calls an MCP server's tools through its meta-tools (tool_call, tool_describe): the tool is `id`
          // ("mcp:vaultite:vaultite__write_note"), its arguments `args`.
          const meta = (c.name === "tool_call" || c.name === "tool_describe") && str(c.arguments?.id)
          const args = meta && c.name === "tool_call" && c.arguments?.args && typeof c.arguments.args === "object" ? c.arguments.args : c.arguments ?? {}
          const name = meta ? (str(c.arguments.id).split(":").pop() ?? "").replace(/^[\w-]+__/, "") + (c.name === "tool_describe" ? " (describe)" : "") : str(c.name)
          const t: Tool = { kind: "tool", id: str(c.id), name: name || "tool", summary: toolSummary(args, PICK), input: cut(JSON.stringify(args, null, 2)),
            result: null, error: false, at: when }
          entries.push(t)
          if (t.id) calls.set(t.id, t)
          said = null
        }
      }
      if (said) said.text = cut(said.text, 20000)
    } else if (m.role === "toolResult") {
      const t = calls.get(str(m.toolCallId))
      const out = cut(textOf(m.content))
      if (t) { t.result = out; t.error = m.isError === true } else {
        entries.push({ kind: "tool", id: str(m.toolCallId), name: str(m.toolName) || "tool", summary: "", input: "", result: out, error: m.isError === true, at: when })
      }
    } else if (m.role === "bashExecution") {
      entries.push({ kind: "tool", id: str(e.id), name: "bash", summary: toolSummary(str(m.command), []), input: str(m.command), result: cut(str(m.output)),
        error: typeof m.exitCode === "number" && m.exitCode !== 0, at: when })
    }
  }
  const top = [...models].sort((a, b) => b[1] - a[1])[0]
  return { entries, cwd: head.cwd, first: head.first, last: head.last, model: top ? top[0] : "", prompt: head.prompt }
}
