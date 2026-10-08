// An OpenCode session's conversation, from its rows in OpenCode's database: what the user said, the model's answers
// (Markdown) and each tool call with its result. Reasoning, step markers, patches and synthetic parts are left out.
import { cut, type Entry, type Said, toolSummary } from "../../../core/codingagents.ts"

/** A row of the message table and the part rows that belong to it, in order. */
export type Row = { id: string; created: number; data: string; parts: string[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const parse = (s: string): Any => {
  try {
    const v = JSON.parse(s)
    return v && typeof v === "object" && !Array.isArray(v) ? v : null
  } catch {
    return null
  }
}
const at = (ms: unknown) => (typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : "")

const PICK = ["description", "command", "filePath", "path", "pattern", "url", "query", "prompt", "name"]
/** One line saying what a tool call did: "npm test", "src/app.ts", "retry in src". */
const summarize = (name: string, input: unknown) => toolSummary(input, PICK, name === "grep" ? ["path", "include"] : undefined)

/** A session's messages as a conversation, with its first and last times and the model it used most. */
export function conversation(rows: Row[]) {
  const entries: Entry[] = []
  const head = { first: "", last: "", model: "", prompt: "" }
  const models = new Map<string, number>()
  for (const r of rows) {
    const m = parse(r.data)
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue
    const when = at(m.time?.created ?? r.created)
    if (when) { head.first ||= when; head.last = when }
    if (m.role === "assistant" && typeof m.modelID === "string" && m.modelID) {
      const k = `${m.providerID ?? ""}/${m.modelID}`
      models.set(k, (models.get(k) ?? 0) + 1)
    }
    // Text parts of one message make one entry; a tool call ends it (text after it is a new one).
    let said: Said | null = null
    for (const raw of r.parts) {
      const p = parse(raw)
      if (!p || p.synthetic || p.ignored) continue
      if (p.type === "text" && String(p.text ?? "").trim()) {
        const text = String(p.text).trim()
        if (said) said.text += `\n\n${text}`
        else entries.push(said = { kind: m.role, text, at: at(p.time?.start) || when })
      } else if (p.type === "file" && m.role === "user") {
        const text = `_(${String(p.filename || p.url || "file")})_`
        if (said) said.text += `\n\n${text}`
        else entries.push(said = { kind: "user", text, at: when })
      } else if (p.type === "tool") {
        const st = p.state ?? {}, input = st.input ?? {}
        const out = st.status === "error" ? String(st.error ?? "") : st.status === "completed" ? String(st.output ?? "") : null
        entries.push({ kind: "tool", id: String(p.callID ?? p.id ?? ""), name: String(p.tool ?? "tool"), summary: summarize(String(p.tool ?? ""), input),
          input: cut(typeof input === "string" ? input : JSON.stringify(input, null, 2)), result: out === null ? null : cut(out),
          error: st.status === "error", at: at(st.time?.start) || when })
        said = null
      }
    }
    if (said) said.text = cut(said.text, 20000)
    if (m.role === "user" && !head.prompt && said) head.prompt = said.text.replace(/\s+/g, " ").slice(0, 80)
  }
  const top = [...models].sort((a, b) => b[1] - a[1])[0]
  return { entries, first: head.first, last: head.last, model: top ? top[0] : "", prompt: head.prompt }
}
