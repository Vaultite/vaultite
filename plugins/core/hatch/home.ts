// A Hatch agent's home folder (its persona files, memory, dreams, runs, scheduled jobs and feed), read on this machine
// or, far more often, on an agent machine through Machines' file agent; and what its files say, parsed leniently.
import fs from "node:fs"
import path from "node:path"
import { cut, toolSummary, type Entry, type Tool } from "../../../core/codingagents.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
export type FileEntry = { name: string; dir: boolean; size: number | null; mtime: number | null }
export type Contents = { path: string; text: string; size: number; mtime: number; truncated: boolean }

/** Where a home is read: `list` and `read` take paths relative to it (null: not there). */
export type Home = {
  machine: string
  root: string
  list(rel: string): Promise<FileEntry[] | null>
  read(rel: string, max?: number): Promise<Contents | null>
  /** Its files changed last under `rel`, newest first (null: the file agent can't say). */
  recent(rel: string, limit: number): Promise<{ path: string; size: number; mtime: number }[] | null>
}

const str = (v: unknown) => (typeof v === "string" ? v : "")
const missing = (e: unknown) => /NotFound|No such file|NotADirectory|ENOENT|ENOTDIR/i.test(String((e as Error)?.message ?? e))

export function localHome(root: string): Home {
  const abs = (rel: string) => path.join(root, rel)
  return {
    machine: "", root,
    async list(rel) {
      try {
        return fs.readdirSync(abs(rel), { withFileTypes: true }).map((d) => {
          let st: fs.Stats | null = null
          try { st = fs.statSync(path.join(abs(rel), d.name)) } catch { /* gone meanwhile */ }
          return { name: d.name, dir: !!st?.isDirectory(), size: st && !st.isDirectory() ? st.size : null, mtime: st ? st.mtimeMs : null }
        })
      } catch { return null }
    },
    async read(rel, max = 1 << 20) {
      try {
        const st = fs.statSync(abs(rel))
        if (!st.isFile()) return null
        const fd = fs.openSync(abs(rel), "r"), buf = Buffer.alloc(Math.min(st.size, max))
        try { fs.readSync(fd, buf, 0, buf.length, 0) } finally { fs.closeSync(fd) }
        return { path: abs(rel), text: buf.toString("utf8"), size: st.size, mtime: st.mtimeMs, truncated: st.size > buf.length }
      } catch { return null }
    },
    async recent() { return null },
  }
}

/** An agent machine's home, through the service machines:fs (the relay's file agent). */
export function remoteHome(machine: string, root: string, ask: (rest: string, q: Record<string, string>) => Promise<Any>): Home {
  const abs = (rel: string) => (rel ? `${root.replace(/\/$/, "")}/${rel}` : root)
  const soft = async <T>(fn: () => Promise<T>): Promise<T | null> => { try { return await fn() } catch (e) { if (missing(e)) return null; throw e } }
  return {
    machine, root,
    list: (rel) => soft(async () => ((await ask("fs/list", { path: abs(rel) })).entries ?? []) as FileEntry[]),
    read: (rel, max) => soft(async () => {
      const r = await ask("fs/read", { path: abs(rel), ...(max ? { max: String(max) } : {}) })
      return typeof r.text === "string" ? { path: r.path, text: r.text, size: r.size, mtime: r.mtime, truncated: !!r.truncated } : null
    }),
    recent: async (rel, limit) => {
      try { return (await ask("fs/recent", { path: abs(rel), limit: String(limit) })).files ?? [] } catch (e) {
        if (/only lists folders|NotFound|No such file/i.test(String((e as Error).message))) return null
        throw e
      }
    },
  }
}

/** Whether a folder's entries are a Hatch home's. */
export const isHatch = (entries: FileEntry[] | null) => {
  const has = (n: string, dir = false) => !!entries?.some((e) => e.name === n && e.dir === dir)
  return has("SOUL.md") && has("HEARTBEAT.md") && has("workspace", true) && has("agents", true)
}

/** At most `n` at once: the file agent answers sixteen reads at a time. */
export async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]) }
  }))
  return out
}

// ---------- what its files say

/** A file's frontmatter (flat keys and one level of nesting, as Hatch writes them) and the rest. */
export function frontmatter(text: string): { fm: Record<string, Any>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { fm: {}, body: text }
  const fm: Record<string, Any> = {}
  let parent: Record<string, Any> | null = null
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\s*)([\w.-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    const value = kv[3].replace(/^["']|["']$/g, "")
    if (!kv[1]) { parent = kv[3] === "" ? (fm[kv[2]] = {}) : null; if (kv[3] !== "") fm[kv[2]] = value } else if (parent) parent[kv[2]] = value
  }
  return { fm, body: text.slice(m[0].length) }
}

/** IDENTITY.md's name ("- **Name:** Muse"). */
export const nameOf = (identity: string | undefined) => /\*\*Name:\*\*\s*([^\n_*(][^\n]*)/.exec(identity ?? "")?.[1].trim() ?? ""

/** What's left to fill in a persona file: its empty fields ("- **Timezone:**", or a "_(...)_" placeholder) and its
 *  sections with nothing under them. */
export function unfilled(text: string): string[] {
  const out: string[] = []
  const lines = frontmatter(text).body.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/)
  const blank = (l: string) => !l.trim() || /^\s*_[^_].*_\s*$/.test(l)
  lines.forEach((l, i) => {
    const field = /^\s*[-*]\s+\*\*([^*]+?):?\*\*:?\s*(.*)$/.exec(l)
    if (field && (!field[2].trim() || /^_\(.*\)_$/.test(field[2].trim()))) out.push(field[1].replace(/:$/, ""))
    const h = /^##\s+(.+)$/.exec(l)
    if (h) {
      let j = i + 1
      while (j < lines.length && !/^#{1,2}\s/.test(lines[j]) && blank(lines[j])) j++
      if (j >= lines.length || /^#{1,2}\s/.test(lines[j])) out.push(h[1].trim())
    }
  })
  return out
}

export type Fact = { kind: string; confidence: string; text: string; quote: string; at: string }
/** A daily memory note (memory/<date>.md): its facts ("- [fact|high] ...", each with its quote) and its other lines. */
export function dailyNote(text: string) {
  const facts: Fact[] = [], notes: string[] = []
  let at = "", fact: Fact | null = null
  for (const line of text.split(/\r?\n/)) {
    const h = /^##\s+(.*)$/.exec(line)
    if (h) { at = /(\d\d:\d\d(?: UTC)?)/.exec(h[1])?.[1] ?? ""; fact = null; continue }
    const f = /^- \[([\w-]+)\|([\w-]+)\]\s+(.+)$/.exec(line)
    if (f) { facts.push(fact = { kind: f[1], confidence: f[2], text: f[3].trim(), quote: "", at }); continue }
    const q = /^\s+- quote:\s*"?(.*?)"?\s*$/.exec(line)
    if (q && fact) { fact.quote = q[1]; continue }
    if (/^\s+- (claim|sources):/.test(line)) continue
    const b = /^\s*- (.+)$/.exec(line)
    if (b && !/^\s/.test(line)) { notes.push(b[1].trim()); fact = null }
  }
  return { facts, notes }
}

/** A Markdown list's top-level items ("- ..."), their "(src: ...)" left out. */
export const bullets = (text: string) => text.split(/\r?\n/).flatMap((l) => {
  const m = /^[-*]\s+(.+)$/.exec(l)
  return m ? [m[1].replace(/\s*\(src: [^)]*\)\s*$/, "").trim()] : []
})

/** A dream (dreams/<date>.md): the prose under "## Dream", its date line left out. */
export function dreamText(text: string) {
  const body = frontmatter(text).body
  const at = body.search(/^##\s+Dream\s*$/m)
  return (at < 0 ? body.replace(/^#\s.*$/m, "") : body.slice(at).replace(/^##\s+Dream\s*$/m, ""))
    .replace(/^\s*\d{4}-\d\d-\d\d\s*$/m, "").trim()
}

export type Story = { title: string; text: string; links: { url: string; note: string }[] }
/** A feed write-up (workspace/feed/research/<id>/<date>-<slot>-<hash>/<beat>.md): its beat, angle and stories. */
export function feedFile(text: string) {
  const beat = /^Beat:\s*(.+)$/m.exec(text)?.[1].trim() ?? "", angle = /^Angle:\s*(.+)$/m.exec(text)?.[1].trim() ?? ""
  const stories: Story[] = []
  for (const part of text.split(/^##\s+/m).slice(1)) {
    const [title, ...rest] = part.split(/\r?\n/)
    const links: Story["links"] = [], prose: string[] = []
    for (const l of rest) {
      const link = /^\s*-\s+(https?:\/\/\S+)\s*(?:\((.*)\))?\s*$/.exec(l)
      if (link) links.push({ url: link[1], note: link[2] ?? "" })
      else prose.push(l)
    }
    stories.push({ title: title.trim(), text: prose.join("\n").trim(), links })
  }
  return { beat, angle, stories }
}

/** A slot folder's date and part of day ("2026-10-10-midday-64d14e9c" -> 2026-10-10, midday). */
export const slotOf = (name: string) => { const m = /^(\d{4}-\d\d-\d\d)-([a-z]+)/.exec(name); return m ? { date: m[1], part: m[2] } : null }

/** A scheduled job (workspace/cron.d/<cadence>/<name>.md), as its frontmatter and task say. */
export function cronJob(text: string, file: string, archived: boolean) {
  const { fm, body } = frontmatter(text)
  const s = (fm.schedule ?? {}) as Record<string, string>
  const when = s.kind === "interval" ? `every ${s.every}` : s.kind === "daily" ? `daily at ${str(s.time).slice(0, 5)}`
    : s.kind === "weekly" ? `weekly${s.day ? ` on ${s.day}` : ""}${s.time ? ` at ${s.time.slice(0, 5)}` : ""}`
    : s.kind === "once" || s.kind === "runonce" ? `once${s.at ? `, ${s.at}` : ""}` : str(s.kind) || "unscheduled"
  return { id: str(fm.id) || file.replace(/\.md$/, ""), enabled: fm.enabled !== "false" && !archived, archived, mode: str(fm.mode),
    schedule: `${when}${s.timezone && s.timezone !== "UTC" ? ` (${s.timezone})` : ""}`, task: body.trim().replace(/\s+/g, " ").slice(0, 200),
    by: str((fm.metadata ?? {}).created_by) }
}

/** skills.yaml's connectors: each name with its status. */
export function connectors(text: string) {
  const out: { name: string; status: string }[] = []
  let name = ""
  for (const l of text.split(/\r?\n/)) {
    const k = /^ {2}([\w.-]+):\s*$/.exec(l)
    if (k) { name = k[1]; continue }
    const st = /^ {4}status:\s*(\S+)/.exec(l)
    if (st && name) { out.push({ name, status: st[1] }); name = "" }
  }
  return out
}

// ---------- runs (agents/agent-<id>/sessions/<id>.jsonl)

const KINDS: Record<string, string> = { runtime: "Conversation", "runtime.proactivity": "Proactive", "runtime.self_improvement": "Self-improvement",
  "runtime.feed": "Feed", "scheduler.cron": "Scheduled", "runtime.onboarding": "Onboarding", "runtime.heartbeat": "Heartbeat" }
/** Sources that ride along in any run (a tool's guidance, a notice), never what the run is. */
const ASIDE = /^runtime\.(tool_guidance|injected_context_change|dev_notice|monitoring|skill_invalidation)$/
const kindOf = (source: string) => KINDS[source] ?? (source.replace(/^runtime\./, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) || "Run")

/** What a run was asked, in a line: its "# Task:", else its first heading or line that isn't a section's name. */
export function titleOf(prompt: string) {
  const lines = prompt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const task = lines.map((l) => /^#+\s*Task:\s*(.+)$/.exec(l)?.[1]).find(Boolean)
  const pick = task ?? lines.find((l) => !/^#+\s*(Step instructions|This run|Context|Materials?)\s*$/i.test(l))?.replace(/^#+\s*/, "") ?? ""
  const one = pick.replace(/\s+/g, " ").replace(/[*_`]/g, "")
  const sentence = (/^(.{20,}?[.!?])(\s|$)/.exec(one)?.[1] ?? one).replace(/^./, (c) => c.toUpperCase())
  return sentence.length > 90 ? `${sentence.slice(0, 89)}…` : sentence
}

const lines = (text: string): Any[] => text.split(/\r?\n/).flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : [] } catch { return [] } })

export type Run = { id: string; kind: string; title: string; first: string; last: string; items: number; tools: number; model: string; tokens: number }
/** A run's summary from its transcript (and sessions.json, for its model and context size). */
export function runOf(id: string, transcript: string, sessions: string | null): Run {
  const events = lines(transcript)
  const sources = new Map<string, number>()
  let first = "", last = "", tools = 0, prompt = "", said = ""
  for (const e of events) {
    if (e?.type === "session_header") { first ||= str(e.created_at); continue }
    if (e?.type !== "item") continue
    const src = str(e.source)
    if (src && !ASIDE.test(src)) sources.set(src, (sources.get(src) ?? 0) + 1)
    if (e.created_at) { first ||= e.created_at; last = e.created_at }
    const it = e.item ?? {}
    if (it.type === "function_call") tools++
    if (it.type === "message" && it.role === "user") { prompt ||= str(it.text); if (src === "runtime") said = str(it.text) }
  }
  const source = [...sources].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""
  let model = "", tokens = 0
  try {
    const s = (JSON.parse(sessions ?? "{}").sessions ?? [])[0] ?? {}
    model = str(s.context_window_usage?.model_id); tokens = Number(s.context_window_usage?.input_tokens) || 0
    first ||= str(s.created_at); last ||= str(s.updated_at)
  } catch { /* none */ }
  const kind = kindOf(source)
  return { id, kind, title: titleOf(kind === "Conversation" && said ? said : prompt) || kind, first, last, items: events.length - 1, tools, model, tokens }
}

const PICK = ["query", "path", "file_path", "url", "command", "cmd", "name", "id", "question", "title"]

/** A run's transcript as a conversation (AgentSession.tsx): what the user said, its answers and notes, each tool call
 *  with its result; the runtime's own prompts fold away as "Instructions", its thinking is left out. */
export function conversation(transcript: string) {
  const entries: Entry[] = []
  const calls = new Map<string, Tool>()
  for (const e of lines(transcript)) {
    if (e?.type !== "item") continue
    const it = e.item ?? {}, at = str(e.created_at), src = str(e.source)
    if (it.type === "message" && it.role === "user") {
      const text = str(it.text).trim()
      if (!text) continue
      if (src === "runtime") entries.push({ kind: "user", text: cut(text, 20000), at })
      else entries.push({ kind: "tool", id: "", name: src === "runtime.tool_guidance" ? "Guidance" : "Instructions", summary: titleOf(text), input: cut(text, 20000), result: null, error: false, at })
    } else if ((it.type === "message" && it.role === "assistant") || it.type === "commentary_text") {
      const text = str(it.text).trim()
      if (text) entries.push({ kind: "assistant", text: cut(text, 20000), at })
    } else if (it.type === "function_call") {
      let args: Any = it.arguments
      try { args = typeof args === "string" ? JSON.parse(args) : args } catch { /* as it is */ }
      const t: Tool = { kind: "tool", id: str(it.call_id), name: str(it.name) || "tool", summary: toolSummary(args ?? {}, PICK),
        input: cut(typeof args === "string" ? args : JSON.stringify(args ?? {}, null, 2)), result: null, error: false, at }
      entries.push(t)
      if (t.id) calls.set(t.id, t)
    } else if (it.type === "function_call_output") {
      const t = calls.get(str(it.call_id)), out = typeof it.output === "string" ? it.output : JSON.stringify(it.output ?? "", null, 2)
      if (t) { t.result = cut(out); t.error = it.is_error === true || it.status === "error" }
    }
  }
  return entries
}
