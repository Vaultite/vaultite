// Claude's export (conversations, projects, memories) into chats. Edits and retries branch: the transcript is the line
// to the newest leaf (or current_leaf_message_uuid); memory may come in several shapes, all read.
import { aboutOf, arr, type Chat, factsOf, isObj, type Memory, type Message, type Part, type Project, text, timeOf } from "./chat.ts"

const ROOT = "00000000-0000-4000-8000-000000000000"

type Msg = Record<string, unknown>

/** The messages from the root to the leaf the user last saw, and how many other leaves there are. */
export function linearize(msgs: Msg[], current?: string) {
  const parentOf = (m: Msg) => text(m.parent_message_uuid)
  if (!msgs.some((m) => parentOf(m))) return { path: msgs, others: 0 }
  const byId = new Map(msgs.map((m) => [text(m.uuid), m]))
  const kids = new Map<string, Msg[]>()
  for (const m of msgs) {
    const p = parentOf(m) && byId.has(parentOf(m)) ? parentOf(m) : ROOT
    kids.set(p, [...(kids.get(p) ?? []), m])
  }
  const leaves = msgs.filter((m) => !kids.has(text(m.uuid)))
  const t = (m: Msg) => timeOf(m.created_at) ?? 0
  const end = (current && byId.get(current)) || leaves.reduce<Msg | null>((a, b) => (!a || t(b) >= t(a) ? b : a), null)
  const path: Msg[] = []
  const seen = new Set<string>()
  for (let m = end; m && !seen.has(text(m.uuid)); m = byId.get(parentOf(m)) ?? null) {
    seen.add(text(m.uuid))
    path.push(m)
  }
  return { path: path.reverse(), others: Math.max(0, leaves.length - 1) }
}

const MAX_RESULT = 4000

/** A tool's input as one short line or a block. */
function toolUse(b: Record<string, unknown>): Part[] {
  const name = text(b.name)
  const input = isObj(b.input) ? b.input : {}
  if (name === "artifacts" || (text(input.command) && ("content" in input || "new_str" in input))) {
    const title = text(input.title) || text(input.id) || "Artifact"
    const cmd = text(input.command)
    if (cmd === "update" && ("old_str" in input || "new_str" in input)) {
      const diff = [...text(input.old_str).split("\n").map((l) => `- ${l}`), ...text(input.new_str).split("\n").map((l) => `+ ${l}`)].join("\n")
      return [{ kind: "code", text: diff, lang: "diff", title: `Changed ${title}` }]
    }
    const lang = text(input.language) || ({ "text/markdown": "markdown", "text/html": "html", "image/svg+xml": "svg", "application/vnd.ant.mermaid": "mermaid",
      "application/vnd.ant.react": "jsx", "application/vnd.ant.code": "" } as Record<string, string>)[text(input.type)] || ""
    return text(input.content).trim() ? [{ kind: "code", text: text(input.content), lang, title, open: true }] : [{ kind: "note", text: `Made ${title}` }]
  }
  if (typeof input.query === "string") return [{ kind: "note", text: `${name === "web_search" ? "Searched the web" : `Used ${name}`}: ${input.query}` }]
  if (typeof input.url === "string") return [{ kind: "note", text: `Opened ${input.url}` }]
  if (typeof input.code === "string") return [{ kind: "code", text: input.code, lang: text(input.language) || "javascript", title: name ? `Called ${name}` : "Code" }]
  const json = JSON.stringify(input)
  return [{ kind: "note", text: `Used ${name || "a tool"}${json && json !== "{}" ? `: ${json.length > 300 ? `${json.slice(0, 297)}...` : json}` : ""}` }]
}

function toolResult(b: Record<string, unknown>): Part[] {
  const c = b.content
  const lines: string[] = []
  if (typeof c === "string") lines.push(c)
  for (const x of arr(c)) {
    if (!isObj(x)) continue
    if (typeof x.text === "string") lines.push(x.text)
    else if (text(x.title) || text(x.url)) lines.push(`- ${text(x.title) || text(x.url)}${text(x.title) && text(x.url) ? ` (${text(x.url)})` : ""}`)
  }
  let t = lines.join("\n").trim()
  if (!t) return []
  if (t.length > MAX_RESULT) t = `${t.slice(0, MAX_RESULT)}\n...`
  return [{ kind: "output", text: t, title: [text(b.name), b.is_error === true ? "error" : ""].filter(Boolean).join(", ") || undefined }]
}

/** A message's parts: its content blocks (or its text, in older exports), what it attached. */
function partsOf(m: Msg): Part[] {
  const out: Part[] = []
  for (const a of arr(m.attachments)) {
    if (!isObj(a)) continue
    out.push({ kind: "file", name: text(a.file_name) || "attachment", text: text(a.extracted_content) || undefined })
  }
  const blocks = arr(m.content).filter(isObj)
  for (const b of blocks) {
    const type = text(b.type)
    if (type === "text") { if (text(b.text).trim()) out.push({ kind: "text", text: text(b.text) }) }
    else if (type === "thinking") {
      const t = text(b.thinking) || arr(b.summaries).filter(isObj).map((s) => text(s.summary)).join("\n\n")
      if (t.trim()) out.push({ kind: "thinking", text: t })
    } else if (type === "tool_use" || type === "server_tool_use") out.push(...toolUse(b))
    else if (type === "tool_result" || type === "web_search_tool_result") out.push(...toolResult(b))
    else if (type === "voice_note") { if (text(b.text).trim()) out.push({ kind: "text", text: text(b.text) }) }
    else if (type === "image") out.push({ kind: "image", ref: null, name: text(b.file_name) || undefined })
    else if (typeof b.text === "string" && b.text.trim()) out.push({ kind: "text", text: b.text })
  }
  if (!blocks.some((b) => text(b.type) === "text" || text(b.type) === "voice_note") && text(m.text).trim()) out.push({ kind: "text", text: text(m.text) })
  for (const f of arr(m.files)) {
    if (!isObj(f)) continue
    const name = text(f.file_name) || "file"
    out.push(/\.(png|jpe?g|gif|webp|heic)$/i.test(name) || text(f.file_kind) === "image" ? { kind: "image", ref: null, name } : { kind: "file", name })
  }
  return out
}

/** One conversation of conversations.json, or null when it isn't one. `projects`: names by id, to say which. */
export function readConversation(c: unknown): Chat | null {
  if (!isObj(c) || !Array.isArray(c.chat_messages)) return null
  const id = text(c.uuid)
  if (!id) return null
  const msgs = c.chat_messages.filter(isObj)
  const { path, others } = linearize(msgs, text(c.current_leaf_message_uuid) || undefined)
  const models: string[] = []
  const convModel = text(c.model)
  const messages: Message[] = []
  for (const m of path) {
    const parts = partsOf(m)
    if (!parts.length) continue
    const role = text(m.sender) === "human" ? "user" : "assistant"
    const model = role === "assistant" ? text(m.model) || convModel : ""
    if (model && !models.includes(model)) models.push(model)
    messages.push({ role, at: timeOf(m.created_at), model: model || undefined, parts })
  }
  let title = text(c.name).trim()
  if (!title) {
    const first = messages.find((m) => m.role === "user")?.parts.find((p) => p.kind === "text")
    title = first && first.kind === "text" ? first.text.replace(/\s+/g, " ").trim().slice(0, 60) : ""
  }
  const project = text(c.project_uuid) || (isObj(c.project) ? text(c.project.uuid) : "")
  return {
    source: "claude", id, title: title || "Untitled chat", created: timeOf(c.created_at), updated: timeOf(c.updated_at), models, messages,
    otherBranches: others, url: `https://claude.ai/chat/${id}`, project: project || undefined,
  }
}

/** projects.json's projects. */
export function readProjects(v: unknown): Project[] {
  const out: Project[] = []
  for (const p of arr(v)) {
    if (!isObj(p) || !text(p.uuid)) continue
    const docs = arr(p.docs).filter(isObj).map((d) => ({ name: text(d.filename) || text(d.file_name) || "Document", text: text(d.content) })).filter((d) => d.text.trim())
    out.push({ id: text(p.uuid), name: text(p.name).trim() || "Untitled project", description: text(p.description).trim() || undefined,
      instructions: text(p.prompt_template).trim() || undefined, created: timeOf(p.created_at), updated: timeOf(p.updated_at), docs })
  }
  return out
}

/** memories.json's memories: across chats (about the user), and each project's (`projects`: names by id). */
export function readMemories(v: unknown, projects: Map<string, string> = new Map()): Memory[] {
  const out: Memory[] = []
  const add = (raw: string, from: string, at?: number, about?: string) => {
    for (const f of factsOf(raw)) out.push({ text: f, about: about ?? aboutOf(f), from, at })
  }
  const walk = (x: unknown) => {
    if (Array.isArray(x)) return x.forEach(walk)
    if (!isObj(x)) return
    if (typeof x.conversations_memory === "string") add(x.conversations_memory, "Claude's memory", timeOf(x.updated_at))
    if (isObj(x.project_memories)) {
      for (const [id, t] of Object.entries(x.project_memories)) {
        const raw = typeof t === "string" ? t : isObj(t) ? text(t.memory) || text(t.content) : ""
        if (raw) add(raw, `Claude's memory of the project ${projects.get(id) ?? id}`)
      }
    }
    // Memory as files: {path: "/preferences.md", content}.
    if (typeof x.path === "string" && (typeof x.content === "string" || typeof x.text === "string")) {
      const p = x.path.toLowerCase()
      add(text(x.content) || text(x.text), `Claude's memory (${x.path.replace(/^\/+/, "")})`, timeOf(x.updated_at),
        /pref|instruction|style/.test(p) ? "preference" : undefined)
    }
    for (const k of ["memories", "files", "items"]) if (k in x) walk(x[k])
  }
  walk(v)
  return out
}
