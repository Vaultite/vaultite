// ChatGPT's export into chats: each conversation a tree whose line from `current_node` to the root is the transcript.
// It has no memory list, so memories come from `bio` calls, model_set_context (newest wins) and custom instructions.
import { arr, type Chat, factsOf, isObj, type Memory, type Message, type Part, text, timeOf, aboutOf } from "./chat.ts"

type Node = { id: string; message?: Record<string, unknown> | null; parent?: string | null; children?: string[] }

/** ChatGPT's private-use citation markers ("\ue200cite\ue202turn0search1\ue201") and its file citations. */
const clean = (s: string) => s.replace(/[ \t]*\ue200[^\ue201]*\ue201/g, "").replace(/\u3010\d+(?::\d+)?\u2020[^\u3011]*\u3011/g, "")

/** The asset id of an image pointer: "file-service://file-AbC" and "sediment://file_00ab" -> "file-AbC", "file_00ab". */
export const assetId = (pointer: string) => pointer.replace(/^[a-z-]+:\/\//, "").trim()

/** The line of messages from the root to `current_node` (or, without one, the newest leaf), and how many other leaves. */
function line(mapping: Record<string, Node>, current: unknown) {
  const nodes = Object.values(mapping).filter(isObj) as Node[]
  const leaves = nodes.filter((n) => !arr(n.children).some((c) => typeof c === "string" && mapping[c]))
  let end = typeof current === "string" && mapping[current] ? current : null
  if (!end && leaves.length) {
    const t = (n: Node) => timeOf(isObj(n.message) ? n.message.create_time : undefined) ?? 0
    end = leaves.reduce((a, b) => (t(b) >= t(a) ? b : a)).id
  }
  const out: Node[] = []
  const seen = new Set<string>()
  for (let id = end; id && mapping[id] && !seen.has(id); id = mapping[id].parent ?? null) {
    seen.add(id)
    out.push(mapping[id])
  }
  return { nodes: out.reverse(), others: Math.max(0, leaves.length - 1) }
}

/** The text of `parts` (strings), and images and transcripts among them. */
function partsOf(content: Record<string, unknown>): Part[] {
  const out: Part[] = []
  for (const p of arr(content.parts)) {
    if (typeof p === "string") { if (clean(p).trim()) out.push({ kind: "text", text: clean(p) }) }
    else if (isObj(p)) {
      const ct = text(p.content_type)
      if (ct === "image_asset_pointer" && text(p.asset_pointer)) {
        out.push({ kind: "image", ref: assetId(text(p.asset_pointer)), size: typeof p.size_bytes === "number" ? p.size_bytes : undefined })
      } else if (ct === "audio_transcription" && text(p.text).trim()) out.push({ kind: "text", text: text(p.text) })
      else if (typeof p.text === "string" && p.text.trim()) out.push({ kind: "text", text: clean(p.text) })
      // audio, video and other pointers: the export has their bytes as files, but a note doesn't take them
    }
  }
  return out
}

/** The text inside a custom instruction's ``` fence (ChatGPT wraps them in its own explanation), or all of it. */
export function instructionText(s: string) {
  const m = /```(?:[a-z]*\n)?([\s\S]*?)```/.exec(s)
  return (m ? m[1] : s).trim()
}

export type ChatGptRead = { chat: Chat; memories: Memory[]; memoryList?: { at: number; facts: string[] } }

/** One conversation of conversations.json, or null when it isn't one. */
export function readConversation(c: unknown): ChatGptRead | null {
  if (!isObj(c) || !isObj(c.mapping)) return null
  const id = text(c.conversation_id) || text(c.id)
  if (!id) return null
  const { nodes, others } = line(c.mapping as Record<string, Node>, c.current_node)
  const messages: Message[] = []
  const memories: Memory[] = []
  let memoryList: { at: number; facts: string[] } | undefined
  const models: string[] = []
  const updated = timeOf(c.update_time)
  for (const n of nodes) {
    const m = n.message
    if (!isObj(m)) continue
    const author = isObj(m.author) ? m.author : {}
    const role = text(author.role)
    const content = isObj(m.content) ? m.content : {}
    const ct = text(content.content_type)
    const meta = isObj(m.metadata) ? m.metadata : {}
    const at = timeOf(m.create_time)
    // The custom instructions and the memory list: memories, never transcript.
    if (ct === "user_editable_context") {
      for (const f of factsOf(instructionText(text(content.user_profile)))) memories.push({ text: f, about: "me", from: "ChatGPT's custom instructions", at: updated })
      for (const f of factsOf(instructionText(text(content.user_instructions)))) memories.push({ text: f, about: "preference", from: "ChatGPT's custom instructions", at: updated })
      continue
    }
    if (ct === "model_editable_context") {
      const list = text(content.model_set_context)
      if (list.trim()) memoryList = { at: updated ?? at ?? 0, facts: memoryLines(list) }
      continue
    }
    if (role === "system" || meta.is_visually_hidden_from_conversation === true || ct === "reasoning_recap") continue
    const recipient = text(m.recipient) || "all"
    const model = text(meta.model_slug)
    if (role === "assistant" && model && !models.includes(model)) models.push(model)
    let parts: Part[] = []
    let r: Message["role"] = role === "user" ? "user" : role === "tool" ? "tool" : "assistant"
    let name: string | undefined
    if (role === "assistant" && recipient === "bio") {
      const t = ct === "code" ? text(content.text) : partsOf(content).map((p) => ("text" in p ? p.text : "")).join("\n")
      for (const f of t.split("\n").map((x) => x.trim()).filter(Boolean)) {
        parts.push({ kind: "memory", text: f })
        memories.push({ text: f, about: aboutOf(f), from: "ChatGPT's memory", at })
      }
    } else if (role === "tool" && text(author.name) === "bio") continue // "Model set context updated."
    else if (ct === "thoughts") {
      const t = arr(content.thoughts).filter(isObj).map((x) => [text(x.summary) && `**${text(x.summary)}**`, text(x.content)].filter(Boolean).join("\n\n")).join("\n\n")
      if (t.trim()) parts.push({ kind: "thinking", text: t })
    } else if (role === "assistant" && recipient !== "all") {
      const body = ct === "code" ? text(content.text) : partsOf(content).map((p) => ("text" in p ? p.text : "")).join("\n")
      if (body.trim()) parts.push({ kind: "code", text: body, lang: text(content.language) || (/^\s*[{[]/.test(body) ? "json" : ""), title: `Called ${recipient}` })
    } else if (ct === "code") {
      if (text(content.text).trim()) parts.push({ kind: "code", text: text(content.text), lang: text(content.language) })
    } else if (ct === "execution_output") {
      if (text(content.text).trim()) parts.push({ kind: "output", text: text(content.text) })
    } else if (ct === "tether_quote") {
      const t = [text(content.title), text(content.url), text(content.text)].filter(Boolean).join("\n\n")
      if (t.trim()) parts.push({ kind: "output", text: t, title: text(content.title) || text(content.domain) || undefined })
    } else if (ct === "tether_browsing_display") {
      const t = text(content.result) || text(content.summary)
      if (t.trim()) parts.push({ kind: "output", text: t })
    } else if (ct === "system_error") {
      parts.push({ kind: "note", text: `Error: ${text(content.name)}${text(content.text) ? `: ${text(content.text)}` : ""}` })
    } else {
      parts = partsOf(content)
      if (!parts.length && typeof content.text === "string" && content.text.trim()) parts.push({ kind: "text", text: clean(content.text) })
    }
    if (role === "tool") {
      name = text(author.name) || undefined
      // A tool's text is output, and an image it made (DALL·E) is the assistant's picture.
      parts = parts.map((p) => (p.kind === "text" ? { kind: "output", text: p.text } : p))
      if (parts.length && parts.every((p) => p.kind === "image")) r = "assistant"
    }
    if (!parts.length) continue
    // A message continuing the one before it (the same role, a tool's call and its answer folded into the turn).
    messages.push({ role: r, name, at, model: model || undefined, parts })
  }
  const def = text(c.default_model_slug)
  if (!models.length && def) models.push(def)
  const first = messages.find((m) => m.role === "user")?.parts.find((p) => p.kind === "text")
  const title = text(c.title).trim() || (first && first.kind === "text" ? first.text.replace(/\s+/g, " ").trim().slice(0, 60) : "") || "Untitled chat"
  return {
    chat: {
      source: "chatgpt", id, title, created: timeOf(c.create_time), updated, models, messages, otherBranches: others,
      url: `https://chatgpt.com/c/${id}`,
    },
    memories, memoryList,
  }
}

/** ChatGPT's memory list as the model saw it: "1. [2024-05-01]. Lives in Lisbon." lines, numbers and dates taken off. */
export function memoryLines(list: string): string[] {
  const out: string[] = []
  for (const l of list.split("\n")) {
    const m = /^\s*\d+\.\s*(?:\[[^\]]*\]\.?\s*)?(.+)$/.exec(l)
    if (m && m[1].trim()) out.push(m[1].trim())
  }
  return out.length ? out : factsOf(list)
}

/** A memories.json, if the export has one: a list of strings or of objects with the memory's text. */
export function memoriesFile(v: unknown): Memory[] {
  const out: Memory[] = []
  const walk = (x: unknown) => {
    if (typeof x === "string") { for (const f of factsOf(x)) out.push({ text: f, about: aboutOf(f), from: "ChatGPT's memory" }) }
    else if (Array.isArray(x)) x.forEach(walk)
    else if (isObj(x)) {
      const t = text(x.content) || text(x.memory) || text(x.text) || text(x.value)
      if (t) for (const f of factsOf(t)) out.push({ text: f, about: aboutOf(f), from: "ChatGPT's memory", at: timeOf(x.updated_at ?? x.created_at ?? x.create_time) })
      else for (const k of ["memories", "items", "data"]) if (k in x) walk(x[k])
    }
  }
  walk(v)
  return out
}

/** The zip's images by asset id: "file-AbC-photo.png", "dalle-generations/file-XyZ-uuid.webp", "user-1/file_00ab-x.png". */
export function assetIndex(names: string[]) {
  const out = new Map<string, string>()
  for (const n of names) {
    const base = n.split("/").pop() ?? ""
    const m = /^(file[-_][A-Za-z0-9]+)/.exec(base)
    if (m && /\.(png|jpe?g|gif|webp)$/i.test(base) && !out.has(m[1])) out.set(m[1], n)
  }
  return out
}
