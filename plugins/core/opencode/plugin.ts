// OpenCode: what OpenCode (opencode.ai) does on this machine, read from its SQLite database; nothing is written anywhere.
// Cost = what OpenCode recorded for each reply (models.dev prices; 0 for free models and subscriptions); no plan limits.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { type AgentStart, busyFirst, codingAgent, cwds, HOME, isoMicro as iso, notHere, num, processes, projectOf, quote, rebuilt, roots,
  SqliteFile, Tally, terminalOf } from "../../../core/codingagents.ts"
import { localDate, Plugin } from "../../../core/plugins.ts"
import { type Item, sortBy } from "../../../core/vault.ts"
import { conversation, type Row } from "./transcript.ts"

export const plugin = new Plugin(import.meta.url)
// OPENCODE_DATA_DIR (like ccusage's) and OPENCODE_CACHE_DIR: other folders (the tests' fixture).
const xdg = (v: string | undefined, dflt: string) => (v && path.isAbsolute(v) ? v : dflt)
const DATA = process.env.OPENCODE_DATA_DIR || path.join(xdg(process.env.XDG_DATA_HOME, path.join(HOME, ".local", "share")), "opencode")
const CACHE = process.env.OPENCODE_CACHE_DIR || path.join(xdg(process.env.XDG_CACHE_HOME, path.join(HOME, ".cache")), "opencode")
const KEEP_DAYS = 35 // what the scan keeps in memory; blocks show up to 30 days

// ---------- the database

/** OpenCode's database file: OPENCODE_DB, else opencode.db, else a release channel's (opencode-beta.db). */
function dbFile(): string | null {
  const env = process.env.OPENCODE_DB
  if (env && env !== ":memory:") return path.isAbsolute(env) ? env : path.join(DATA, env)
  const main = path.join(DATA, "opencode.db")
  if (fs.existsSync(main)) return main
  try {
    return fs.readdirSync(DATA).filter((n) => /^opencode-[\w.-]+\.db$/.test(n)).sort().map((n) => path.join(DATA, n))[0] ?? null
  } catch {
    return null
  }
}

/** A reply: when, which model, which session, its counts and cost, how long it took, the local day. */
type Reply = { id: string; session: string; ts: number; model: string; provider: string; cost: number; tokens: number
  input: number; read: number; write: number; ms: number; root: string; day: string }
type Ses = { id: string; parent: string | null; directory: string; title: string; created: number; updated: number }

class Store extends SqliteFile {
  replies: Reply[] = []
  sessions = new Map<string, Ses>()

  /** Read the last KEEP_DAYS days again, at most every 5 s and only when the database changed. */
  refresh() {
    if (!this.due(() => { this.replies = []; this.sessions.clear() })) return
    const cutoff = Date.now() - KEEP_DAYS * 86400000
    this.sessions = new Map(this.all(`SELECT id, parent_id, directory, title, time_created, time_updated FROM session WHERE time_updated >= ?`, cutoff)
      .map((s) => [s.id, { id: s.id, parent: s.parent_id ?? null, directory: s.directory ?? "", title: s.title ?? "", created: num(s.time_created), updated: num(s.time_updated) }]))
    const rows = this.all(`SELECT id, session_id AS sid, time_created AS created, json_extract(data, '$.modelID') AS model,
        json_extract(data, '$.providerID') AS provider, json_extract(data, '$.cost') AS cost,
        json_extract(data, '$.tokens.input') AS input, json_extract(data, '$.tokens.output') AS output,
        json_extract(data, '$.tokens.reasoning') AS reasoning, json_extract(data, '$.tokens.cache.read') AS cread,
        json_extract(data, '$.tokens.cache.write') AS cwrite, json_extract(data, '$.time.created') AS t0,
        json_extract(data, '$.time.completed') AS t1, json_extract(data, '$.path.root') AS root
      FROM message WHERE time_created >= ? AND json_extract(data, '$.role') = 'assistant' ORDER BY time_created, id`, cutoff)
    const seen = new Set<string>()
    const out: Reply[] = []
    for (const r of rows) {
      const n = [num(r.input), num(r.output), num(r.reasoning), num(r.cread), num(r.cwrite)]
      const tokens = n.reduce((a, b) => a + b, 0)
      if (!tokens && !num(r.cost)) continue // still streaming, or failed before any tokens
      const ts = num(r.t0) || num(r.created)
      // A fork copies the replies before it with new ids but the same times and counts: the first one counts.
      const key = [ts, r.provider, r.model, ...n].join("|")
      if (seen.has(key)) continue
      seen.add(key)
      const t1 = num(r.t1)
      out.push({ id: r.id, session: r.sid, ts, model: String(r.model ?? ""), provider: String(r.provider ?? ""), cost: num(r.cost), tokens,
        input: n[0], read: n[3], write: n[4], ms: t1 > ts ? Math.min(t1 - ts, 30 * 60000) : 0, root: String(r.root ?? ""), day: localDate(new Date(ts)) })
    }
    this.replies = out
  }

  /** The session at the top of a subagent's chain (itself when it has no parent). */
  top(id: string) {
    let s = this.sessions.get(id)
    for (let n = 0; s?.parent && this.sessions.has(s.parent) && n < 20; n++) s = this.sessions.get(s.parent)
    return s?.id ?? id
  }
}

const store = new Store(dbFile)
plugin.onUnload(() => store.close())

// ---------- names

/** "opencode/big-pickle" -> "Big Pickle", from models.dev's catalogue as OpenCode caches it (else the model's id). */
async function modelNames(): Promise<Map<string, string>> {
  return plugin.memo(3600, function catalogue() {
    const out = new Map<string, string>()
    try {
      const all = JSON.parse(fs.readFileSync(path.join(CACHE, "models.json"), "utf8"))
      for (const [p, v] of Object.entries(all as Item)) {
        for (const [m, info] of Object.entries((v?.models ?? {}) as Item)) if (info?.name) out.set(`${p}/${m}`, String(info.name))
      }
    } catch {
      // not cached yet: ids it is
    }
    return out
  })
}
const modelName = (names: Map<string, string>, key: string) => names.get(key) || key.split("/").slice(1).join("/") || key

/** OpenCode's placeholder titles ("New session - 2026-09-29T...", "Child session - ...") aren't titles. */
const placeholder = (t: string) => !t || /^(New|Child) session - \d{4}-\d\d-\d\dT/.test(t)
const prompts = new Map<string, string>()

/** A session's title, or its first prompt when OpenCode hasn't named it. */
function titleOf(s: { id: string; title: string }) {
  if (!placeholder(s.title)) return s.title
  if (!prompts.has(s.id)) {
    const r = store.all(`SELECT json_extract(p.data, '$.text') AS text FROM part p JOIN message m ON m.id = p.message_id
      WHERE p.session_id = ? AND json_extract(m.data, '$.role') = 'user' AND json_extract(p.data, '$.type') = 'text'
        AND json_extract(p.data, '$.synthetic') IS NOT 1 ORDER BY m.time_created, p.id LIMIT 1`, s.id)[0]
    const text = String(r?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 80)
    if (!text) return ""
    prompts.set(s.id, text)
  }
  return prompts.get(s.id)!
}

// ---------- usage

/** A reply copied into a fork keeps its times and counts, so it counts once; a subagent's session counts in its parent's. */
async function summary(days: number) {
  store.refresh()
  const names = await modelNames()
  const t = new Tally(days)
  const rows = store.replies.filter((r) => r.day >= t.start)
  // A reply belongs to its top session; that session's folder (its repository's root when OpenCode knew it) is the project.
  const topOf = new Map(rows.map((r) => [r.session, store.top(r.session)]))
  const where = new Map<string, string>()
  for (const r of rows) {
    const top = topOf.get(r.session)!
    if (!where.has(top)) where.set(top, (r.session === top && r.root) || store.sessions.get(top)?.directory || r.root)
  }
  const root = roots(new Set(where.values()))
  for (const r of rows) {
    const sid = topOf.get(r.session)!, proj = root.get(where.get(sid)!)!, mn = modelName(names, `${r.provider}/${r.model}`)
    const s = t.session(sid, () => {
      const row = store.sessions.get(sid)
      return { title: row ? titleOf(row) : "", root: proj, cwd: row?.directory || r.root }
    })
    t.count({ ts: r.ts, day: r.day, cost: r.cost, tokens: r.tokens, read: r.read, prompt: r.input + r.read + r.write, model: mn, min: r.ms / 60000 },
      sid, t.project(proj), s, mn, r.tokens + 1)
  }
  return t.result(iso)
}

// ---------- OpenCode running now

// Subcommands that aren't a session of their own (a server hosts others', `attach` talks to one).
const NOT_A_SESSION = new Set(["acp", "mcp", "attach", "debug", "providers", "auth", "agent", "upgrade", "uninstall", "serve",
  "web", "models", "stats", "export", "import", "github", "session", "plugin", "plug", "db", "completion"])
const VALUED = new Set(["-m", "--model", "-s", "--session", "--prompt", "--agent", "--port", "--hostname", "--log-level",
  "--mdns-domain", "--cors", "--replay-limit", "--format", "--file", "-f", "--title", "--attach", "--dir", "--variant"])

type Proc = { pid: number; started: number; kind: string; session: string; dir: string }

/** OpenCode processes with a session of their own: the TUI (`opencode`, `opencode <folder>`) and `opencode run`. */
async function sessionProcesses(): Promise<Proc[]> {
  const procs: Proc[] = []
  for (const { pid, started, command } of await processes()) {
    const args = command.trim().split(/\s+/)
    if (!["opencode", "opencode.exe"].includes(path.basename(args[0]))) continue // npm's package runs bin/opencode.exe
    let session = ""
    const pos: string[] = []
    for (let i = 1; i < args.length; i++) {
      const a = args[i]
      if (a === "-s" || a === "--session") session = args[++i] ?? ""
      else if (a.startsWith("--session=")) session = a.slice(10)
      else if (VALUED.has(a)) i++
      else if (!a.startsWith("-")) pos.push(a)
    }
    const sub = pos[0] ?? ""
    if (NOT_A_SESSION.has(sub)) continue
    const kind = sub === "run" ? "run" : "interactive"
    procs.push({ pid, started, kind, session, dir: kind === "interactive" ? sub : "" })
  }
  return procs
}

/** OpenCode open now: each process and its session (the one it resumed, else the newest top-level one of its kind in
 *  its folder since it started), working while its last reply isn't done. A TUI asked nothing yet isn't one. */
async function live(recent: Item[]) {
  const procs = await sessionProcesses()
  if (!procs.length || !store.open()) return []
  const dirs = await cwds(procs.map((p) => p.pid))
  const names = await modelNames()
  const byId = new Map(recent.map((s) => [s.id, s]))
  const since = Math.min(...procs.map((p) => p.started)) - 5000
  // `opencode run` makes its sessions unable to ask anything (question denied): that tells them from the TUI's.
  const cands = store.all(`SELECT id, title, directory, time_created, time_updated,
      coalesce(permission, '') LIKE '%"permission":"question","pattern":"*","action":"deny"%' AS headless
    FROM session WHERE parent_id IS NULL AND time_updated >= ? ORDER BY time_updated DESC`, since)
  const taken = new Set<string>()
  const out: Item[] = []
  for (const p of sortBy(procs, (x) => x.started, true)) {
    const cwd = p.dir ? path.resolve(dirs.get(p.pid) ?? "/", p.dir) : dirs.get(p.pid) ?? ""
    let s: Item | undefined
    if (p.session) s = store.all(`SELECT id, title, directory, time_created, time_updated FROM session WHERE id = ?`, p.session)[0]
    else s = cands.find((c) => !taken.has(c.id) && c.directory === cwd && num(c.time_updated) >= p.started - 5000 && !!c.headless === (p.kind === "run"))
    if (!s) continue
    taken.add(s.id)
    const last = store.all(`SELECT time_created AS created, json_extract(data, '$.role') AS role, json_extract(data, '$.time.completed') AS done,
      json_extract(data, '$.providerID') AS provider, json_extract(data, '$.modelID') AS model
      FROM message WHERE session_id = ? ORDER BY time_created DESC, id DESC LIMIT 1`, s.id)[0]
    const busy = !!last && (last.role === "user" || (last.role === "assistant" && !last.done))
    const model = store.all(`SELECT json_extract(data, '$.providerID') AS provider, json_extract(data, '$.modelID') AS model FROM message
      WHERE session_id = ? AND json_extract(data, '$.role') = 'assistant' ORDER BY time_created DESC, id DESC LIMIT 1`, s.id)[0]
    const u = byId.get(s.id) ?? {}
    out.push({ pid: p.pid, id: s.id, title: titleOf({ id: s.id, title: s.title ?? "" }), name: "", project: u.project || projectOf(s.directory),
      status: busy ? "busy" : "idle", kind: p.kind, started: iso(p.started), since: iso(num(last?.done) || num(last?.created) || num(s.time_updated)),
      model: u.model ?? (model?.model ? modelName(names, `${model.provider}/${model.model}`) : null), cost: u.cost ?? 0, tokens: u.tokens ?? 0,
      cwd: s.directory, terminal: await terminalOf(plugin, p.pid) })
  }
  return busyFirst(out)
}

/** Live sessions and `days` of usage. OpenCode has no plan or limits of its own. */
async function usage(days: number) {
  const s = await summary(days)
  return { plan: null, limits: null, live: await live(s.sessions), ...s }
}

// ---------- one session's conversation (the view tab: view:opencode-session/<id>)

const SESSION_ID = /^[\w.-]{4,100}$/
const talks = rebuilt<ReturnType<typeof conversation>>()

function sessionRow(id: string): Item | null {
  return SESSION_ID.test(id) ? store.all(`SELECT id, title, directory, time_updated FROM session WHERE id = ?`, id)[0] ?? null : null
}

/** A session's conversation, built again only when it changed (its last update, its message count). */
function talk(s: Item) {
  const n = store.all(`SELECT count(*) AS n, max(time_updated) AS t FROM message WHERE session_id = ?`, s.id)[0] ?? {}
  return talks(s.id, `${s.time_updated}:${n.n}:${n.t}`, () => {
    const parts = new Map<string, string[]>()
    for (const p of store.all(`SELECT message_id, data FROM part WHERE session_id = ? ORDER BY message_id, id`, s.id)) {
      if (!parts.has(p.message_id)) parts.set(p.message_id, [])
      parts.get(p.message_id)!.push(p.data)
    }
    const rows: Row[] = store.all(`SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id`, s.id)
      .map((m) => ({ id: m.id, created: num(m.time_created), data: m.data, parts: parts.get(m.id) ?? [] }))
    return conversation(rows)
  })
}

/** A session's title, folder, times, model and conversation. */
async function session(id: string) {
  const s = sessionRow(id)
  if (!s) return null
  const t = talk(s)
  const cwd = String(s.directory ?? "")
  return { id, title: placeholder(s.title) ? t.prompt : s.title, cwd, model: t.model ? modelName(await modelNames(), t.model) : "",
    first: t.first, last: t.last, branch: "", project: cwd ? projectOf(cwd) : "", entries: t.entries }
}

// ---------- Terminal runs it (the service "agent:opencode")

/** A file in this machine's temp folder named by its content (written once): what OpenCode's config points at. */
function tmpFile(ext: string, text: string) {
  const dir = path.join(os.tmpdir(), "vaultite-opencode")
  const file = path.join(dir, `${crypto.createHash("sha1").update(text).digest("hex").slice(0, 16)}${ext}`)
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, text)
  }
  return file
}

/** An OpenCode plugin (loaded from a file:// path) that marks the terminal's state from OpenCode's events: working
 *  while any session of the process is busy, waiting while a permission or a question is asked, idle otherwise. */
function statePlugin(state: NonNullable<AgentStart["state"]>) {
  const cmds = JSON.stringify({ working: state("working"), waiting: state("waiting"), idle: state("idle") })
  return `// Written by Vaultite: marks its terminal working, waiting or idle.
import { spawn } from "node:child_process"
const cmd = ${cmds}
let last = ""
const busy = new Set(), asks = new Set()
const set = (s) => { if (s === last) return; last = s; spawn("/bin/sh", ["-c", cmd[s]], { stdio: "ignore", detached: true }).unref() }
const show = () => set(asks.size ? "waiting" : busy.size ? "working" : "idle")
export default { id: "vaultite-state", server: async () => { show(); return { event: async ({ event }) => {
  const p = event.properties || {}
  if (event.type === "session.status") { if (p.status?.type === "idle") busy.delete(p.sessionID); else busy.add(p.sessionID) }
  else if (event.type === "session.idle") busy.delete(p.sessionID)
  else if (event.type === "permission.asked" || event.type === "question.asked") asks.add(p.id)
  else if (event.type === "permission.replied" || event.type === "question.replied") asks.delete(p.requestID ?? p.id)
  else return
  show()
} } } }
`
}

/** `opencode`, or `opencode --session <id>` in the folder it ran in, told where it runs through OPENCODE_CONFIG_CONTENT
 *  (merged into the user's config): an instructions file and the state plugin above. */
plugin.provide("agent:opencode", async ({ resume, context, state, prompt }: AgentStart) => {
  const row = resume ? sessionRow(resume) : null
  if (resume && !row) return notHere("OpenCode", resume)
  const config: Item = {}
  try {
    if (context) config.instructions = [tmpFile(".md", context)]
    if (state) config.plugin = [pathToFileURL(tmpFile(".mjs", statePlugin(state))).href]
  } catch {
    // no temp folder: it runs as it is
  }
  const env = Object.keys(config).length ? `OPENCODE_CONFIG_CONTENT=${quote(JSON.stringify(config))} ` : ""
  return { command: `${env}opencode${resume ? ` --session ${quote(resume)}` : ""}${prompt ? ` --prompt ${quote(prompt)}` : ""}`, cwd: row?.directory || null }
})

// ---------- blocks as text (GET /api/render)

codingAgent(plugin, { id: "opencode", name: "OpenCode", prefix: "opencode", value: "as OpenCode recorded it",
  state: (s) => (s.status === "busy" ? "Working" : "Idle"), sessionId: SESSION_ID, usage, session })
