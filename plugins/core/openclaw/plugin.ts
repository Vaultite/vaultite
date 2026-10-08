// OpenClaw: what OpenClaw (openclaw.ai) does on this machine, read from its SQLite databases and its agents' workspaces;
// nothing is written anywhere, except OpenClaw's own config by its own CLI (openclaw.connect).
import { execFile } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { promisify } from "node:util"
import zlib from "node:zlib"
import { accountsNamed, type AgentStart, ago, codingAgent, cut, expandHome, HOME, isoMicro as iso, notHere, num, processes, projectOf, quote,
  rebuilt, roots, SqliteFile, Tally, terminalOf, vauMcpServer } from "../../../core/codingagents.ts"
import { bullets, fmtMin, localDate, OpError, Plugin, section } from "../../../core/plugins.ts"
import { type Item, sortBy } from "../../../core/vault.ts"
import { type Any, conversation, injected, textOf } from "./transcript.ts"

export const plugin = new Plugin(import.meta.url)
const run = promisify(execFile)
// Where OpenClaw keeps its state, as its CLI finds it: OPENCLAW_STATE_DIR (the tests' fixture), else the profile's folder.
const env = (k: string) => process.env[k]?.trim() || ""
const PROFILE = env("OPENCLAW_PROFILE").toLowerCase() === "default" ? "" : env("OPENCLAW_PROFILE")
const STATE = env("OPENCLAW_STATE_DIR") ? expandHome(env("OPENCLAW_STATE_DIR")) : path.join(HOME, PROFILE ? `.openclaw-${PROFILE}` : ".openclaw")
const KEEP_DAYS = 35 // what the scan keeps in memory; blocks show up to 30 days
// zstd comes with Node 22.15: without it compressed events are skipped.
const unzstd = typeof zlib.zstdDecompressSync === "function" ? zlib.zstdDecompressSync : null
const str = (v: unknown) => (typeof v === "string" ? v : "")
const parse = (s: unknown): Any => {
  try {
    const v = typeof s === "string" ? JSON.parse(s) : null
    return v && typeof v === "object" && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

// ---------- the databases

/** A transcript row's event: its JSON, or its zstd-compressed bytes (OpenClaw compresses events of 1 KiB and more). */
function eventOf(r: Item): Any {
  if (typeof r.event_json === "string") return parse(r.event_json)
  if (!unzstd || !(r.event_zstd instanceof Uint8Array)) return {}
  try {
    return parse(Buffer.from(unzstd(r.event_zstd, { maxOutputLength: num(r.event_utf8_bytes) || 4 << 20 })).toString("utf8"))
  } catch {
    return {}
  }
}
const ROLE = "coalesce(json_extract(event_json, '$.message.role'), json_extract(navigation_json, '$.model.message.role'))"

/** A reply: its session, when, which model, its counts and cost (null: none recorded), how long it took, the local day. */
type Reply = { session: string; ts: number; model: string; cost: number | null; tokens: number; input: number; read: number; write: number
  ms: number; day: string }
/** A logical session (session_nodes): its key, its current transcript, state, name, parent's key, times, model, folder. */
type Node = { key: string; current: string; status: string; title: string; parent: string; archived: boolean; created: number
  updated: number; activity: number; started: number; model: string; cwd: string }

/** One of OpenClaw's agents (agents/<id>/agent/openclaw-agent.sqlite): its sessions, transcripts and replies. */
class Agent {
  id: string
  db: SqliteFile
  replies: Reply[] = []
  nodes = new Map<string, Node>()
  bySession = new Map<string, Node>() // current transcript id -> its node
  windows = new Map<string, { key: string; name: string }>() // transcript id -> its session key, its own name
  cwds = new Map<string, string>() // transcript id -> the folder its header names
  private replyCache = new Map<string, Any>() // "<session>:<seq>" -> a compressed reply's message
  private prompts = new Map<string, string>()

  constructor(id: string) {
    this.id = id
    this.db = new SqliteFile(path.join(STATE, "agents", id, "agent", "openclaw-agent.sqlite"))
  }

  /** Its workspace (memory and instructions): OPENCLAW_WORKSPACE_DIR or <state>/workspace for main, else workspace-<id>. */
  get workspace() {
    return this.id === "main" ? (env("OPENCLAW_WORKSPACE_DIR") ? path.resolve(env("OPENCLAW_WORKSPACE_DIR")) : path.join(STATE, "workspace"))
      : path.join(STATE, `workspace-${this.id}`)
  }

  /** Read the last KEEP_DAYS days again, at most every 5 s and only when the database changed. */
  refresh() {
    if (!this.db.due(() => { this.replies = []; this.nodes.clear(); this.bySession.clear(); this.windows.clear() })) return
    const cutoff = Date.now() - KEEP_DAYS * 86400000
    this.nodes = new Map(this.db.all(`SELECT session_key, current_session_id, status, label, display_name, parent_session_key, spawned_by,
        archived_at, created_at, updated_at, last_activity_at, entry_json FROM session_nodes WHERE updated_at >= ? OR status = 'running'`, cutoff)
      .map((n) => {
        const e = parse(n.entry_json)
        return [n.session_key, { key: n.session_key, current: str(n.current_session_id), status: str(n.status), parent: str(n.parent_session_key) || str(n.spawned_by),
          title: str(n.label) || str(n.display_name) || str(e.label) || str(e.displayName), archived: !!n.archived_at, created: num(n.created_at),
          updated: num(n.updated_at), activity: num(n.last_activity_at), started: num(e.sessionStartedAt), model: str(e.model), cwd: str(e.spawnedCwd) }]
      }))
    this.bySession = new Map([...this.nodes.values()].map((n) => [n.current, n]))
    this.windows = new Map(this.db.all(`SELECT session_id, session_key, display_name FROM session_windows WHERE updated_at >= ?`, cutoff)
      .map((w) => [w.session_id, { key: str(w.session_key), name: str(w.display_name) }]))
    // A transcript's first event is its header, with the folder it ran in.
    this.cwds = new Map(this.db.all(`SELECT t.session_id, json_extract(t.event_json, '$.cwd') AS cwd FROM transcript_events t
        JOIN (SELECT session_id, min(seq) AS seq FROM transcript_events WHERE session_id IN (SELECT session_id FROM session_windows WHERE updated_at >= ?)
          GROUP BY session_id) f ON f.session_id = t.session_id AND f.seq = t.seq`, cutoff).map((r) => [r.session_id, str(r.cwd)]))
    const rows = this.db.all(`SELECT session_id AS sid, seq, created_at AS at, ${ROLE} AS role, json_extract(event_json, '$.message.timestamp') AS ts,
        json_extract(event_json, '$.message.provider') AS provider, json_extract(event_json, '$.message.model') AS model,
        json_extract(event_json, '$.message.usage') AS usage, event_utf8_bytes,
        CASE WHEN event_json IS NULL AND json_extract(navigation_json, '$.report.entry.type') = 'message'
          AND coalesce(json_extract(navigation_json, '$.model.message.role'), 'assistant') = 'assistant' THEN event_zstd END AS event_zstd
      FROM transcript_events WHERE created_at >= ? ORDER BY session_id, seq`, cutoff)
    const seen = new Set<string>()
    const out: Reply[] = []
    let prev = { sid: "", at: 0 }
    for (const r of rows) {
      if (!r.role && !r.event_zstd) continue
      const since = r.sid === prev.sid ? num(r.at) - prev.at : 0
      prev = { sid: r.sid, at: num(r.at) }
      let m: Any = { timestamp: r.ts, provider: r.provider, model: r.model, usage: parse(r.usage) }
      if (r.event_zstd) {
        const k = `${r.sid}:${r.seq}`
        if (!this.replyCache.has(k)) this.replyCache.set(k, eventOf(r).message ?? {})
        m = this.replyCache.get(k)
        if (m.role !== "assistant") continue
      } else if (r.role !== "assistant") continue
      const u = m.usage ?? {}
      const n = [num(u.input), num(u.output), num(u.cacheRead), num(u.cacheWrite)]
      const tokens = num(u.totalTokens) || n.reduce((a, b) => a + b, 0)
      const cost = typeof u.cost?.total === "number" && u.cost.total >= 0 ? u.cost.total : null
      if (!tokens && !cost) continue // failed before any tokens
      const ts = num(m.timestamp) || num(r.at)
      // A fork copies the replies before it, times and counts kept: the first one counts.
      const key = [ts, m.provider, m.model, ...n].join("|")
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ session: r.sid, ts, model: str(m.model) || str(m.provider) || "unknown", cost, tokens, input: n[0], read: n[2], write: n[3],
        ms: Math.min(Math.max(since, 0), 30 * 60000), day: localDate(new Date(ts)) })
    }
    if (this.replyCache.size > 20000) this.replyCache.clear()
    this.replies = out
  }

  /** The session a subagent's run counts in: its parent's, up the chain (itself when it has none). */
  top(sid: string) {
    let id = sid
    for (let n = 0; n < 20; n++) {
      const node = this.bySession.get(id) ?? this.nodes.get(this.windows.get(id)?.key ?? "")
      const up = node?.parent ? this.nodes.get(node.parent) : undefined
      if (!up?.current || up.current === id) break
      id = up.current
    }
    return id
  }

  /** The folder a session ran in: the one it was spawned in, else its header's, else the agent's workspace. */
  cwdOf(sid: string) {
    return this.bySession.get(sid)?.cwd || this.cwds.get(sid) || this.workspace
  }

  /** A session's name (its label, else its generated title), else its first prompt. */
  titleOf(sid: string) {
    const named = this.bySession.get(sid)?.title || this.windows.get(sid)?.name
    if (named) return named
    if (!this.prompts.has(sid)) {
      let text = ""
      for (const r of this.db.all(`SELECT event_json, event_zstd, event_utf8_bytes FROM transcript_events WHERE session_id = ? AND ${ROLE} = 'user'
          ORDER BY seq LIMIT 8`, sid)) {
        const m = eventOf(r).message
        if ((text = injected(m) ? "" : textOf(m?.content).replace(/\s+/g, " ").trim().slice(0, 80))) break
      }
      if (!text) return ""
      this.prompts.set(sid, text)
    }
    return this.prompts.get(sid)!
  }
}

const agentCache = new Map<string, Agent>()
const stateDb = new SqliteFile(path.join(STATE, "state", "openclaw.sqlite")) // shared: cron jobs
plugin.onUnload(() => { for (const a of agentCache.values()) a.db.close(); stateDb.close() })

/** Every agent with a database here, main first. */
function allAgents(): Agent[] {
  let ids: string[] = []
  try {
    ids = fs.readdirSync(path.join(STATE, "agents")).filter((id) => fs.existsSync(path.join(STATE, "agents", id, "agent", "openclaw-agent.sqlite")))
  } catch {
    // no OpenClaw here
  }
  return sortBy(ids, (id) => [id === "main" ? 0 : 1, id]).map((id) => {
    if (!agentCache.has(id)) agentCache.set(id, new Agent(id))
    return agentCache.get(id)!
  })
}

const agentsFor = (id: unknown) => accountsNamed(allAgents(), id, "OpenClaw agent")

/** The agent whose workspace a block reads: the one named, else main (its workspace may come before any session). */
function agentOf(id: unknown): Agent {
  if (id) return agentsFor(id)[0]
  const first = allAgents()[0]
  if (first) return first
  if (!agentCache.has("main")) agentCache.set("main", new Agent("main"))
  return agentCache.get("main")!
}

// ---------- usage

// Cost per reply as OpenClaw recorded it in the transcript (its model catalog's prices; none: unpriced); a day is the
// reply's own time, not the session's. A subagent's replies count in its parent's session.
async function summary(days: number, agents: Agent[]) {
  const t = new Tally(days)
  const many = allAgents().length > 1
  const rows: [Agent, Reply][] = []
  for (const a of agents) {
    a.refresh()
    for (const r of a.replies) if (r.day >= t.start) rows.push([a, r])
  }
  const where = new Map<string, string>() // top session -> its folder
  for (const [a, r] of rows) {
    const top = a.top(r.session)
    if (!where.has(top)) where.set(top, a.cwdOf(top))
  }
  const root = roots(new Set(where.values()))
  for (const [a, r] of rows) {
    const sid = a.top(r.session), cwd = where.get(sid)!, proj = root.get(cwd)!
    const s = t.session(sid, () => ({ title: a.titleOf(sid), root: proj, cwd, account: a.id, ...(many ? { accountLabel: a.id } : {}) }))
    t.count({ ts: r.ts, day: r.day, cost: r.cost, tokens: r.tokens, read: r.read, prompt: r.input + r.read + r.write, model: r.model, min: r.ms / 60000 },
      sid, t.project(proj), s, r.model, r.tokens + 1)
  }
  return t.result(iso)
}

/** What started a session, by its key: a scheduled job, a subagent, else a conversation. */
const kindOf = (key: string) => (/(^|:)cron:/.test(key) ? "cron" : /:subagent:/.test(key) ? "subagent" : "interactive")

/** The session key Terminal started a TUI on (OPENCLAW_TUI_SESSION, agent:openclaw), from Linux's /proc: OpenClaw sets
 *  its process title there, which overwrites its arguments, `tui` and `--session` too. */
function tuiEnv(pid: number): string | null {
  try { return /(?:^|\0)OPENCLAW_TUI_SESSION=([^\0]+)/.exec(fs.readFileSync(`/proc/${pid}/environ`, "latin1"))?.[1] ?? null } catch { return null }
}

/** OpenClaw's TUIs open now (`openclaw tui [--session <key>]`): each one's session key and pid (its launcher's first).
 *  Only OpenClaw's own process counts, not a shell or tmux server whose command line names it. */
async function tuis() {
  const out = new Map<string, number>()
  for (const { pid, command } of sortBy(await processes(), (p) => p.pid)) {
    const args = command.trim().split(/\s+/)
    const i = path.basename(args[0] ?? "") === "openclaw" ? 0
      : /^(node|nodejs|bun|sh|bash|dash|zsh)$/.test(path.basename(args[0] ?? "")) && /(^|\/)openclaw(\/|\.|$)/.test(args[1] ?? "") ? 1 : -1 // (a script: npm's, pnpm's sh shim)
    if (i < 0) continue
    const env = tuiEnv(pid)
    // (a bare title, its arguments overwritten: a TUI only when Terminal said which session it's on)
    if (args[i + 1] !== "tui" && !(args.length === i + 1 && env)) continue
    let key = env ?? "main"
    for (let j = i + 2; j < args.length; j++) {
      if (args[j] === "--session") key = args[++j] ?? key
      else if (args[j].startsWith("--session=")) key = args[j].slice(10)
    }
    key = key.replace(/^'|'$/g, "")
    const full = key.startsWith("agent:") ? key : `agent:main:${key}`
    if (!out.has(full)) out.set(full, pid)
  }
  return out
}

/** Sessions working now (OpenClaw marks one running while a turn is under way) or open in a TUI, working ones first. */
async function live(agents: Agent[], recent: Item[]) {
  const many = allAgents().length > 1
  const byId = new Map(recent.map((s) => [s.id, s]))
  const open = await tuis()
  const out: Item[] = []
  for (const a of agents) {
    for (const n of a.nodes.values()) {
      const pid = open.get(n.key) ?? 0
      if ((n.status !== "running" && !pid) || n.archived || !n.current) continue
      const u = byId.get(n.current) ?? {}, cwd = a.cwdOf(n.current)
      out.push({ pid, id: n.current, title: n.title || a.titleOf(n.current), name: n.key, project: u.project || projectOf(cwd),
        status: n.status === "running" ? "busy" : "idle", kind: kindOf(n.key), started: iso(n.started || n.created), since: iso(n.activity || n.updated),
        model: u.model || n.model || null, cost: u.cost ?? 0, tokens: u.tokens ?? 0, cwd, terminal: pid ? await terminalOf(plugin, pid) : null,
        account: a.id, ...(many ? { accountLabel: a.id } : {}) })
    }
  }
  return sortBy(sortBy(out, (s) => s.since || "", true), (s) => (s.status === "busy" ? 0 : 1))
}

/** Sessions running now and `days` of usage, of one agent or all of them. */
async function usage(days: number, account: unknown) {
  const agents = agentsFor(account)
  const s = await summary(days, agents)
  return { plan: null, limits: null, live: await live(agents, s.sessions), ...s }
}

// ---------- one session's conversation (the view tab: view:openclaw-session/<transcript id>)

const SESSION_ID = /^[\w.-]{4,100}$/
const talks = rebuilt<ReturnType<typeof conversation>>()

/** The agent and session key a transcript belongs to, or null when it isn't here. */
function sessionAt(id: string): { agent: Agent; key: string } | null {
  if (!SESSION_ID.test(id)) return null
  for (const agent of allAgents()) {
    const w = agent.db.all(`SELECT session_key FROM session_windows WHERE session_id = ?`, id)[0]
    if (w) return { agent, key: str(w.session_key) }
  }
  return null
}

/** A transcript as a conversation, built again only when it grew or changed. */
function talk(agent: Agent, id: string) {
  const n = agent.db.all(`SELECT count(*) AS n, max(seq) AS s, max(created_at) AS t FROM transcript_events WHERE session_id = ?`, id)[0] ?? {}
  return talks(id, `${n.n}:${n.s}:${n.t}`, () =>
    conversation(agent.db.all(`SELECT event_json, event_zstd, event_utf8_bytes FROM transcript_events WHERE session_id = ? ORDER BY seq`, id).map(eventOf)))
}

/** A session's key, agent, title, folder, times, model and conversation (its active branch). */
function session(id: string) {
  const at = sessionAt(id)
  if (!at) return null
  at.agent.refresh()
  const t = talk(at.agent, id)
  const cwd = at.agent.bySession.get(id)?.cwd || t.cwd
  return { key: at.key, agent: at.agent.id, title: at.agent.bySession.get(id)?.title || at.agent.windows.get(id)?.name || t.prompt, cwd, model: t.model,
    first: t.first, last: t.last, branch: "", project: cwd ? projectOf(cwd) : "", entries: t.entries }
}

// ---------- memory (the workspace's files, which the agent reads and writes) and scheduled jobs

const MEMORY_FILES = ["IDENTITY.md", "SOUL.md", "USER.md", "MEMORY.md"]
const notesOf = (v: unknown) => Math.min(Math.max(Math.trunc(Number(v ?? 2)) || 0, 0), 14)

function readFile(file: string) {
  try {
    const st = fs.statSync(file)
    return st.isFile() ? { text: cut(fs.readFileSync(file, "utf8").trim(), 20000), modified: iso(st.mtimeMs) } : null
  } catch {
    return null
  }
}

/** An agent's memory: its identity, soul, user and long-term memory files, and its latest daily notes (memory/<date>.md). */
function memory(agent: Agent, notes: number) {
  const dir = agent.workspace
  const files = MEMORY_FILES.flatMap((name) => { const f = readFile(path.join(dir, name)); return f ? [{ name, ...f }] : [] })
  let days: string[] = []
  try { days = fs.readdirSync(path.join(dir, "memory")).filter((n) => /^\d{4}-\d\d-\d\d\.md$/.test(n)).sort().reverse().slice(0, notes) } catch { /* none yet */ }
  const daily = days.flatMap((name) => { const f = readFile(path.join(dir, "memory", name)); return f ? [{ date: name.slice(0, 10), name, ...f }] : [] })
  return { agent: agent.id, dir, files, notes: daily }
}

plugin.route("GET", "openclaw/memory", (req) => memory(agentOf(req.query.account), notesOf(req.query.notes)))


/** How often a job runs, in words. */
function scheduleText(s: Any) {
  if (s?.kind === "cron") return `cron ${str(s.expr)}${s.tz ? ` (${s.tz})` : ""}`
  const min = num(s?.everyMs) / 60000, days = min / 1440
  if (s?.kind === "every") return `every ${!Number.isInteger(days) ? fmtMin(min) : days === 1 ? "day" : `${days} days`}`
  if (s?.kind === "at") return `once, ${str(s.at)}`
  if (s?.kind === "on-exit") return "when a command exits"
  if (s?.kind === "stream") return "on a command's output"
  return str(s?.kind) || "unscheduled"
}

/** What a job asks for: its message, event text or command. */
function taskText(p: Any) {
  const t = str(p?.message) || str(p?.text) || (Array.isArray(p?.argv) ? p.argv.join(" ") : "") || (p?.script ? "a script" : "")
  return t.replace(/\s+/g, " ").trim().slice(0, 160)
}

/** OpenClaw's scheduled jobs (cron_jobs in its shared database): when each runs, its last run and the next. */
function cronJobs(account?: unknown) {
  const running = new Set(stateDb.all(`SELECT job_id FROM cron_run_receipts WHERE status = 'running'`).map((r) => r.job_id))
  return stateDb.all(`SELECT job_id, name, description, enabled, agent_id, job_json, state_json FROM cron_jobs ORDER BY sort_order, updated_at, job_id`)
    .map((r) => {
      const job = parse(r.job_json), st = parse(r.state_json)
      return { id: str(r.job_id), name: str(r.name) || str(r.job_id), description: str(r.description), enabled: !!r.enabled, agent: str(r.agent_id) || "main",
        schedule: scheduleText(job.schedule), task: taskText(job.payload), next: r.enabled ? iso(num(st.nextRunAtMs)) : null, last: iso(num(st.lastRunAtMs)),
        status: running.has(r.job_id) || st.runningAtMs ? "running" : str(st.lastRunStatus) || str(st.lastStatus), error: str(st.lastError).slice(0, 300) }
    })
    .filter((j) => !account || j.agent === account)
}

plugin.route("GET", "openclaw/cron", (req) => cronJobs(req.query.account))

// ---------- Terminal runs it (the service "agent:openclaw")

/** Whether OpenClaw's gateway answers on its port (OPENCLAW_GATEWAY_PORT, else its default; a port set only in its
 *  JSON5 config isn't read). */
function gatewayUp(): Promise<boolean> {
  const port = Number(process.env.OPENCLAW_GATEWAY_PORT) || 18789
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port, timeout: 500 }, () => { sock.destroy(); resolve(true) })
    sock.on("error", () => resolve(false)).on("timeout", () => { sock.destroy(); resolve(false) })
  })
}

/** `openclaw tui`, on a session's key to resume it (or an agent's main session, the profile), its prompt sent first;
 *  `--local` (its embedded runtime) when no gateway runs, as on a server set up without one. */
plugin.provide("agent:openclaw", async ({ resume, profile, prompt }: AgentStart) => {
  const at = resume ? sessionAt(resume) : null
  if (resume && !at) return notHere("OpenClaw", resume)
  const key = at?.key || (profile ? `agent:${profile}:main` : "")
  const cwd = at ? at.agent.cwdOf(resume!) : ""
  const local = (await gatewayUp()) ? "" : " --local"
  // (the key in its environment too: on Linux its process title hides its arguments, tuis())
  return { command: `OPENCLAW_TUI_SESSION=${quote(key || "agent:main:main")} openclaw tui${local}${key ? ` --session ${quote(key)}` : ""}${prompt ? ` --message ${quote(prompt)}` : ""}`,
    cwd: cwd && fs.existsSync(cwd) ? cwd : null }
})

// ---------- connecting OpenClaw to the vault

/** The openclaw command: the server's PATH first (launchd's is short), then where its installers put it. */
function openclawBin() {
  // `npm i -g` puts it beside the real node binary (a Node unpacked in the home folder, nvm's).
  let npmBin = ""
  try { npmBin = path.dirname(fs.realpathSync(process.execPath)) } catch { /* none */ }
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean), npmBin, path.join(HOME, ".local", "bin"), path.join(HOME, ".npm-global", "bin"),
    "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].filter(Boolean)
  return dirs.map((d) => path.join(d, "openclaw")).find((p) => {
    try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile() } catch { return false }
  }) ?? null
}

plugin.op({
  id: "openclaw.connect",
  cli: "openclaw connect",
  owner: "OpenClaw's settings",
  summary: "Give OpenClaw the vault's tools: saves Vaultite's MCP server (`vau mcp`, over stdio) in OpenClaw's config, with its own CLI.",
  help: `Runs \`openclaw mcp set vaultite '{"command":"<node>","args":["<the app>/bin/vau","mcp"],"env":{"VAULTITE_URL":...}}'\` on the machine the server runs on,
so OpenClaw's agents get the vault's tools (the app must be running when they use them). OpenClaw's config is its own
(JSON5): it's never edited here. Running it again saves the same thing.

  vau openclaw connect`,
  kind: "write",
  lock: false, // runs OpenClaw's CLI, holds nothing of the vault
  result: { type: "object", description: "name (vaultite), server (the command and args saved), saved (what OpenClaw answered)" },
  run: async () => {
    const bin = openclawBin()
    if (!bin) throw new OpError("OpenClaw isn't installed on this machine: no openclaw command on the server's PATH or where its installers put it (openclaw.ai)", 409)
    const server = vauMcpServer()
    // Its npm launcher runs on node: the server's own, when the PATH has none.
    const PATH = [process.env.PATH, path.dirname(bin), path.dirname(process.execPath)].filter(Boolean).join(path.delimiter)
    try {
      const { stdout } = await run(bin, ["mcp", "set", "vaultite", JSON.stringify(server)], { timeout: 60000, env: { ...process.env, PATH } })
      return { name: "vaultite", server, saved: stdout.trim().split("\n").pop() ?? "" }
    } catch (e) {
      const err = e as { stderr?: string; message: string }
      throw new OpError(`openclaw mcp set failed: ${(err.stderr || err.message).trim().split("\n").slice(-3).join(" ")}`, 502)
    }
  },
  text: (r) => `OpenClaw's agents can use the vault's tools now: \`${r.server.command} ${r.server.args.join(" ")}\` is saved as its MCP server \`vaultite\`. ${r.saved}`,
})

// ---------- blocks as text (GET /api/render)

codingAgent(plugin, { id: "openclaw", name: "OpenClaw", prefix: "openclaw", value: "as OpenClaw recorded it",
  state: (s) => (s.status === "busy" ? "Working" : "Idle"), sessionId: SESSION_ID, usage, session,
  // (to open OpenClaw as one of them)
  accounts: () => allAgents().map((a) => ({ id: a.id, label: a.id })) })

plugin.block("openclaw-memory", async (ctx) => {
  const m = memory(agentOf(ctx.options.account), notesOf(ctx.options.notes))
  if (!m.files.length && !m.notes.length) return section("OpenClaw memory", `_Nothing in ${m.agent}'s workspace yet (${m.dir})._`)
  return section(`OpenClaw memory${m.agent === "main" ? "" : ` (${m.agent})`}`, ...m.files.map((f) => `### ${f.name}\n\n${f.text}`),
    ...m.notes.map((n) => `### Daily note, ${n.date}\n\n${n.text}`))
})

/** "in 3 h" or "due", for a job's next run. */
const until = (s: string) => {
  const m = (Date.parse(s) - Date.now()) / 60000
  return m <= 0 ? "due now" : `in ${m < 48 * 60 ? fmtMin(m) : `${Math.round(m / 1440)} days`}`
}

plugin.block("openclaw-cron", async (ctx) => {
  const rows = cronJobs(ctx.options.account).map((j) => [`${j.name}: ${j.schedule}`, !j.enabled && "off",
    j.status === "running" ? "running now" : j.last && `last ${ago(j.last)}${j.status ? ` (${j.status})` : ""}`, j.next && `next ${until(j.next)}`,
    j.task && `"${j.task}"`, j.error && `error: ${j.error}`].filter(Boolean).join(", "))
  return section("OpenClaw scheduled jobs", bullets(rows, "No scheduled jobs."))
})
