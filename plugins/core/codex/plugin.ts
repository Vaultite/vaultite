import fs from "node:fs"
import path from "node:path"
import { type AgentAsk, type AgentCommand, programOf, type AgentMeter, type AgentModels, type AgentStart, ago, codingAgent, cwds, dayOf, findBin, HOME, isoOf, jsonLines, JsonlScan, limitRows, limitWindow, type Live, notOnThisMachine,
  priceList, processes, projectOf, shellQuote, projectRoots, sessionsOf, epochSeconds, Tally, terminalOf, Transcript, transcripts, lastTurn, type PermissionMode } from "../../../core/agents.ts"
import { Plugin, section } from "../../../core/plugins.ts"
import { type Item, sortBy } from "../../../core/vault.ts"
import { Conversation, titleOf, userText, WANTED } from "./rollout.ts"
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const plugin = new Plugin(import.meta.url)
const WIN = process.platform === "win32"
const CODEX = process.env.CODEX_HOME || path.join(HOME, ".codex")
plugin.folders(() => [CODEX])

// US dollars per million tokens, the published API list (LiteLLM's table): input, cached input, output with reasoning.
const price = priceList<[number, number, number]>({
  "gpt-6.1-sol": [2, 0.1, 10], "gpt-6-sol": [2, 0.2, 10], "gpt-6-luna": [0.1, 0.01, 0.5], "gpt-6-astra": [10, 1, 50],
  "gpt-5.6": [4, 0.4, 20], "gpt-5.6-sol": [4, 0.4, 20], "gpt-5.6-terra": [2, 0.2, 12], "gpt-5.6-luna": [0.2, 0.02, 1.2],
  "gpt-5.5": [5, 0.5, 30], "gpt-5.4": [2.5, 0.25, 15], "gpt-5.4-mini": [0.75, 0.075, 4.5], "gpt-5.4-nano": [0.2, 0.02, 1.25],
  "gpt-5.3-codex": [1.75, 0.175, 14], "gpt-5.2": [1.75, 0.175, 14],
  "gpt-5.1": [1.25, 0.125, 10], "gpt-5.1-codex-mini": [0.25, 0.025, 2], "gpt-5": [1.25, 0.125, 10], "gpt-5-codex": [1.25, 0.125, 10],
  "gpt-5-mini": [0.25, 0.025, 2], "gpt-5-nano": [0.05, 0.005, 0.4], "o3": [2, 0.5, 8], "o4-mini": [1.1, 0.275, 4.4],
  "codex-mini": [1.5, 0.375, 6],
}, "-")
const PLANS: Record<string, [string, number | null]> = {
  free: ["Free", 0], go: ["Go", 8], plus: ["Plus", 20], pro: ["Pro", 200], team: ["Team", null], business: ["Business", null],
  enterprise: ["Enterprise", null], edu: ["Edu", null],
}

function modelName(model: string) {
  const m = /^gpt-([\d.]+)(?:-(.*))?$/.exec(model)
  if (m) return [`GPT-${m[1]}`, ...(m[2] ?? "").split("-").filter(Boolean).map(cap)].join(" ")
  const [first, ...rest] = model.split("-")
  return [first, ...rest.map(cap)].join(" ") || model
}

// Tokens as ccusage counts them: only when a session's running total changed; forks replay their parent's, counted once.

type Resp = { ts: number; model: string; cwd: string; session: string; n: [number, number, number]; day: string }
type Meta = { id: string; file: string; cwd: string; model: string; title: string; source: string; first: number; last: number
  state: "started" | "complete" | ""; stateTs: number }
type FileState = { offset: number; meta: Meta; total: number[] | null; subagent: boolean }

const FILE_ID = /rollout-[\dT-]+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
const USAGE_KEYS = ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"]
const int = (v: unknown) => Math.max(Math.trunc(Number(v) || 0), 0)

class Scan extends JsonlScan<Resp, FileState> {
  names = new Map<string, string>()
  limits: { observed: number; rl: Item } | null = null
  protected extra() { return this.limits }
  protected restore(x: unknown) { if (x && typeof x === "object") this.limits = x as Scan["limits"] }

  protected fresh(p: string): FileState {
    const id = FILE_ID.exec(path.basename(p))?.[1] ?? path.basename(p, ".jsonl")
    return { offset: 0, total: null, subagent: false, meta: { id, file: p, cwd: "", model: "", title: "", source: "", first: 0, last: 0, state: "", stateTs: 0 } }
  }

  protected async run() {
    await super.run()
    this.readNames()
  }

  private readNames() {
    try {
      for (const line of fs.readFileSync(path.join(CODEX, "session_index.jsonl"), "utf8").split("\n")) {
        try {
          const d = JSON.parse(line)
          if (d?.id && typeof d.thread_name === "string") this.names.set(String(d.id), d.thread_name)
        } catch {}
      }
    } catch {}
  }

  protected line(line: Buffer, f: FileState) {
    let kind: string
    if (line.includes('"token_count"')) kind = "tokens"
    else if (line.includes('"task_started"') || line.includes('"task_complete"')) kind = "turn"
    else if (line.includes('"type":"session_meta"')) kind = "meta"
    else if (line.includes('"type":"turn_context"')) kind = "context"
    else if (!f.meta.title && (line.includes('"type":"UserMessage"') || line.includes('"type":"user_message"'))) kind = "title"
    else return
    let d: Item
    try {
      d = JSON.parse(line.toString("utf8"))
    } catch {
      return
    }
    const p = d?.payload
    if (!p || typeof p !== "object") return
    const ts = epochSeconds(d.timestamp)
    const m = f.meta
    if (ts) { m.first ||= ts; m.last = Math.max(m.last, ts) }
    if (kind === "meta") {
      // A forked session starts with its parent's session_meta: only its own counts.
      if (p.id === m.id || !m.cwd) {
        m.cwd = String(p.cwd || m.cwd)
        const src = p.source
        m.source = typeof src === "string" ? src : src && typeof src === "object" ? Object.keys(src)[0] ?? "" : ""
        f.subagent = m.source === "subagent"
      }
      return
    }
    if (kind === "context") {
      if (typeof p.model === "string" && p.model) m.model = p.model
      if (typeof p.cwd === "string" && p.cwd) m.cwd = p.cwd
      return
    }
    if (kind === "title") {
      const text = p.type === "item_completed" && p.item?.type === "UserMessage" ? userText(p.item.content) : p.type === "user_message" ? String(p.message ?? "") : ""
      if (text.trim()) m.title = titleOf(text)
      return
    }
    if (kind === "turn") {
      if (p.type === "task_started") { m.state = "started"; m.stateTs = ts ?? m.stateTs }
      else if (p.type === "task_complete") {
        m.state = "complete"
        m.stateTs = ts ?? m.stateTs
        const ms = int(p.duration_ms) || (int(p.completed_at) - int(p.started_at)) * 1000
        const key = p.turn_id ? String(p.turn_id) : `${m.id}:${ts}`
        if (ms > 0 && ts && !this.turns.has(key)) this.turns.set(key, { ts, session: m.id, cwd: m.cwd, ms, day: dayOf(ts) })
      }
      return
    }
    if (p.type !== "token_count" || !ts) return
    if (p.rate_limits && typeof p.rate_limits === "object" && (!p.rate_limits.limit_id || p.rate_limits.limit_id === "codex") &&
      (!this.limits || ts >= this.limits.observed)) this.limits = { observed: ts, rl: p.rate_limits }
    const info = p.info
    if (!info || typeof info !== "object") return
    const total = USAGE_KEYS.map((k) => int(info.total_token_usage?.[k]))
    if (f.total && total.every((v, i) => v === f.total![i])) return // the same total again: a rate limit update
    const last = info.last_token_usage && typeof info.last_token_usage === "object"
      ? USAGE_KEYS.map((k) => int(info.last_token_usage[k]))
      : total.map((v, i) => Math.max(v - (f.total?.[i] ?? 0), 0))
    f.total = total
    const [input, cached, output] = last
    if (!input && !cached && !output) return // a compaction's estimate: no tokens of its own
    const model = m.model || "gpt-5"
    const key = `${d.timestamp}|${model}|${last.join(",")}`
    if (!this.resp.has(key)) this.resp.set(key, { ts, model, cwd: m.cwd, session: m.id, n: [Math.max(input - cached, 0), Math.min(cached, input), output], day: dayOf(ts) })
  }

  sessions() {
    const out = new Map<string, Meta>()
    for (const f of this.files.values()) {
      const old = out.get(f.meta.id)
      if (!old || f.meta.last > old.last) out.set(f.meta.id, f.meta)
    }
    return out
  }
}

const scan = new Scan(() => [path.join(CODEX, "sessions"), path.join(CODEX, "archived_sessions")], () => path.join(plugin.localDir(), "scan.json"))

function cost(r: Resp) {
  const p = price(r.model)
  return p ? (r.n[0] * p[0] + r.n[1] * p[1] + r.n[2] * p[2]) / 1e6 : null
}

/** Codex's own worktrees (~/.codex/worktrees/<id>/<repo>) belong to their repository. */
const WORKTREES = path.join(CODEX, "worktrees") + "/"
const rootsOf = (cwds: Iterable<string>) => projectRoots(cwds, (c) => (c.startsWith(WORKTREES) ? c.slice(WORKTREES.length).split("/").slice(1).join("/") || c : c))

async function summary(days: number) {
  await scan.refresh()
  const t = new Tally(days)
  const metas = scan.sessions()
  const rows = sortBy([...scan.resp.values()].filter((r) => r.day >= t.start), (r) => [r.ts, r.model, r.cwd, r.session])
  const turns = [...scan.turns.values()].filter((x) => x.day >= t.start)
  const root = rootsOf(new Set([...rows.map((r) => r.cwd), ...turns.map((x) => x.cwd)]))
  for (const r of rows) {
    const proj = root.get(r.cwd)!
    const s = t.session(r.session, () => ({ root: proj, cwd: r.cwd, title: scan.names.get(r.session) || metas.get(r.session)?.title || "" }))
    t.count({ ts: r.ts * 1000, day: r.day, cost: cost(r), tokens: r.n[0] + r.n[1] + r.n[2], read: r.n[1], prompt: r.n[0] + r.n[1], model: modelName(r.model) },
      r.session, t.project(proj), s, r.model)
  }
  for (const x of turns) t.work(x.day, root.get(x.cwd)!, x.session, x.ms / 60000)
  return t.result(modelName)
}


/** Codex's native binary (the TUI or `codex exec`, not its app-server or npm wrapper), each one's start and folder. */
const codexProcesses = () => plugin.memo(2, async function codexProcesses() {
  const out = (await processes()).flatMap(({ pid, started, command }) => {
    const [name, rest] = programOf(command)
    if (name !== "codex" || /\b(app-server|exec-server|mcp-server|daemon|remote-control)\b/.test(rest)) return []
    return [{ pid, started, exec: /^\s+(exec|e)\b/.test(rest), cwd: "", args: rest }]
  })
  const dirs = await cwds(out.map((p) => p.pid))
  for (const p of out) p.cwd = dirs.get(p.pid) ?? ""
  return out
})

async function live(fresh = false): Promise<Live[]> {
  await scan.refresh(fresh)
  const metas = [...scan.sessions().values()]
  const out: Live[] = []
  for (const [p, m] of sessionsOf(await codexProcesses(), (s: Meta) => s.id, (p, free) =>
    // (Windows can't tell a process's folder: a session begun since it started, or the one it resumes)
    sortBy(metas.filter((s) => s.last * 1000 >= p.started - 5000 && free(s) && (s.cwd === p.cwd ||
      (!p.cwd && WIN && (s.first * 1000 >= p.started - 5000 || p.args.includes(s.id))))), (s) => -s.last)[0])) {
    const terminal = await terminalOf(plugin, p.pid)
    if (!m && !terminal) continue
    out.push({ pid: p.pid, id: m?.id ?? "", title: (m && (scan.names.get(m.id) || m.title)) || "", name: m ? scan.names.get(m.id) ?? "" : "",
      status: m?.state === "started" ? "busy" : "idle", kind: p.exec ? "exec" : "interactive", cwd: p.cwd, started: p.started,
      since: m?.stateTs ? m.stateTs * 1000 : p.started, model: m?.model ? modelName(m.model) : null, terminal })
  }
  return out
}


/** `codex app-server`: JSON-RPC over stdio, a JSON object a line; its npm wrapper needs node on PATH. */
function appServer() {
  const bin = findBin("codex")
  if (!bin) return Promise.resolve(null)
  const env = { ...process.env, PATH: [path.dirname(process.execPath), path.dirname(bin), process.env.PATH].filter(Boolean).join(":") }
  const got: { account: Item | null; limits: Item | null } = { account: null, limits: null }
  return jsonLines<typeof got>(bin, ["app-server"], { env, ms: 15000, end: () => (got.limits ? got : null),
    first: { id: 1, method: "initialize", params: { clientInfo: { name: "vaultite", title: "Vaultite", version: "1.0" } } },
    hear: (m, send, done) => {
      if (m.id === 1) {
        if (m.error) return done(null)
        send({ method: "initialized" })
        send({ id: 2, method: "account/read", params: {} })
        send({ id: 3, method: "account/rateLimits/read" })
      } else if (m.id === 2) got.account = m.result?.account ?? null
      else if (m.id === 3) { got.limits = m.result ?? null; done(got) }
    } })
}

const account = () => plugin.memo(60, async function chatgptAccount() { return { at: Date.now() / 1000, got: await appServer() } })

function label(minutes: number) {
  if (minutes === 300) return "Current session"
  if (minutes === 10080) return "This week"
  if (minutes >= 40000 && minutes <= 45000) return "This month"
  return minutes % 1440 === 0 ? `${minutes / 1440} days` : `${Math.round(minutes / 60)} hours`
}

const window = (id: string, minutes: number, used: number, resets: number | null, now: number) =>
  limitWindow(id, label(minutes), minutes, used, resets, now)

async function limits() {
  const now = Date.now() / 1000
  const { at, got } = await account()
  const snap = got?.limits?.rateLimitsByLimitId?.codex ?? got?.limits?.rateLimits
  if (snap && typeof snap === "object") {
    const wins = (["primary", "secondary"] as const).flatMap((k) => {
      const w = snap[k]
      return w && typeof w.usedPercent === "number" ? [window(k, int(w.windowDurationMins), w.usedPercent, w.resetsAt ?? null, now)] : []
    })
    if (wins.length) return { source: "ChatGPT account", observed: isoOf(at * 1000), windows: wins, plan: String(snap.planType ?? got?.account?.planType ?? "") }
  }
  await scan.refresh()
  const seen = scan.limits
  if (!seen || now - seen.observed > 7 * 86400) return null
  const wins = (["primary", "secondary"] as const).flatMap((k) => {
    const w = seen.rl[k]
    return w && typeof w.used_percent === "number" ? [window(k, int(w.window_minutes), w.used_percent, w.resets_at ?? null, now)] : []
  })
  return wins.length ? { source: "last session", observed: isoOf(seen.observed * 1000), windows: wins, plan: String(seen.rl.plan_type ?? "") } : null
}

function planOf(type: string) {
  const hit = PLANS[type.toLowerCase()]
  return hit ? { name: hit[0], monthly: hit[1] || null } : type ? { name: type.charAt(0).toUpperCase() + type.slice(1), monthly: null } : null
}

async function plan() {
  const lim = await limits()
  return { plan: planOf(lim?.plan ?? ""), limits: lim && { source: lim.source, observed: lim.observed, windows: lim.windows } }
}


const SESSION_ID = /^[0-9a-f-]{8,64}$/i
const read = transcripts((file) => new Transcript(file, () => new Conversation(FILE_ID.exec(path.basename(file))?.[1] ?? path.basename(file, ".jsonl")), WANTED))

async function sessionFile(id: string): Promise<string | null> {
  if (!SESSION_ID.test(id)) return null
  await scan.refresh()
  const known = scan.sessions().get(id)
  if (known && fs.existsSync(known.file)) return known.file
  for (const dir of ["sessions", "archived_sessions"]) {
    try {
      const hit = (fs.readdirSync(path.join(CODEX, dir), { recursive: true }) as string[]).find((n) => n.endsWith(".jsonl") && n.includes(id))
      if (hit) return path.join(CODEX, dir, hit)
    } catch {}
  }
  return null
}

async function transcript(id: string) {
  const file = await sessionFile(id)
  return file ? read(file) : null
}

async function session(id: string) {
  const t = await transcript(id)
  return t && { ...t.talk.head, title: scan.names.get(id) || t.talk.head.title, entries: t.talk.entries }
}

/** A session's latest turn: the user's last message, Codex's last answer, the session's title. */
plugin.provide("agent-turn:codex", async (terminal: string, session = "") => {
  const id = session || (terminal ? (await live(true)).find((l) => l.terminal === terminal)?.id ?? "" : "")
  const t = id ? await transcript(id) : null
  return t ? { session: id, title: scan.names.get(id) || t.talk.head.title, ...lastTurn(t.talk.entries), done: t.talk.done } : null
})

/** Its sessions in the app's terminals, by terminal. No meters: its rollouts don't say when a prompt cache expires. */
plugin.provide("agent-meters:codex", async (): Promise<AgentMeter[]> =>
  (await live()).flatMap((l) => (l.terminal && l.id ? [{ terminal: l.terminal, session: l.id }] : [])))

// ---------- Terminal runs it (the service "agent:codex")

/** `codex`, or `codex resume <id>`. No context or hooks: any `-c` runs it without its shared background server. */
plugin.provide("agent:codex", async ({ resume, prompt, wsl, model, effort, allow, mode }: AgentStart): Promise<AgentCommand> => {
  // (inside WSL its sessions are the distro's own)
  const t = resume && !wsl ? await transcript(resume) : null
  if (resume && !t && !wsl) return notOnThisMachine("Codex", resume)
  // Codex's sandbox blocks the network vau needs, and takes no list of commands
  const how = [...(model ? ["-m", model] : []), ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []), ...(allow?.length ? ["-c", "sandbox_workspace_write.network_access=true"] : []),
    ...(mode ? SANDBOX[mode] : [])]
  const argv = ["codex", ...(resume ? ["resume", ...how, resume, ...(prompt ? [prompt] : [])] : [...how, ...(prompt ? ["--", prompt] : [])])]
  return { command: argv.map((x, i) => (i && !["resume", "--", "-m", "-c"].includes(x) ? shellQuote(x) : x)).join(" "), argv, cwd: t?.talk.head.cwd || null }
})

const SANDBOX: Record<PermissionMode, string[]> = {
  plan: ["-s", "read-only", "-a", "never"], dontAsk: ["-s", "read-only", "-a", "never"], default: ["-s", "read-only", "-a", "on-request"],
  acceptEdits: ["-s", "workspace-write", "-a", "on-request"], auto: ["-s", "workspace-write", "--approve-for-me"],
  bypassPermissions: ["--dangerously-bypass-approvals-and-sandbox"],
}

export function modeOf(approval: string, sandbox: string, reviewer = ""): PermissionMode | null {
  if (sandbox === "danger-full-access") return approval === "never" ? "bypassPermissions" : "auto"
  if (sandbox === "workspace-write") return approval === "never" || reviewer === "auto_review" ? "auto" : "acceptEdits"
  if (sandbox === "read-only") return approval === "never" ? "plan" : "default"
  return null
}

/** The mode a session runs in now, from its last turn's sandbox and approvals; null: unknown. */
plugin.provide("agent-mode:codex", async (terminal: string, session = ""): Promise<PermissionMode | null> => {
  const id = session || (terminal ? (await live(true)).find((l) => l.terminal === terminal)?.id ?? "" : "")
  const file = id ? await sessionFile(id) : null
  if (!file) return null
  let text = ""
  try {
    const fd = fs.openSync(file, "r"), size = fs.fstatSync(fd).size, n = Math.min(size, 1 << 20), buf = Buffer.alloc(n)
    fs.readSync(fd, buf, 0, n, size - n)
    fs.closeSync(fd)
    text = buf.toString("utf8")
  } catch { return null }
  const line = text.split("\n").reverse().find((l) => l.includes('"turn_context"'))
  let c: Item = {}
  try { c = JSON.parse(line ?? "").payload ?? {} } catch { return null }
  return modeOf(String(c.approval_policy ?? ""), String((c.sandbox_policy as Item | undefined)?.type ?? ""), String(c.approvals_reviewer ?? ""))
})

/** The models its picker lists ($CODEX_HOME/models_cache.json) and the efforts they take. */
plugin.provide("agent-models:codex", (): AgentModels => {
  let list: Item[] = []
  try { list = (JSON.parse(fs.readFileSync(path.join(CODEX, "models_cache.json"), "utf8")).models ?? []).filter((m: Item) => m.visibility === "list" && typeof m.slug === "string") } catch {}
  const efforts = (m: Item) => (Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels.map((l: Item) => String(l.effort)) : [])
  return { models: sortBy(list, (m) => Number(m.priority) || 0).map((m) => ({ id: String(m.slug), label: modelName(String(m.slug)) })),
    efforts: list.length ? efforts(list[0]).filter((e: string) => list.every((m) => efforts(m).includes(e))) : ["low", "medium", "high", "xhigh"],
    modes: Object.keys(SANDBOX) as PermissionMode[] }
})

/** Its dialogs, by their last lines; before 0.163 (no OSC 7501, no hooks) its only blocked state. */
plugin.provide("agent-asks:codex", (): AgentAsk[] => [
  { id: "trust", match: /Trust this folder\? Codex can/, says: "Trust this folder? It can read, edit and run files in it", approve: ["\r"], deny: ["\x1b"] },
  { id: "permission", match: /Yes, proceed \(y\)[\s\S]*Press enter to confirm or esc to cancel/, says: "Asks permission", approve: ["\r"], deny: ["\x1b"] },
])


plugin.block("agent-limits", async () => {
  const lim = await limits()
  const p = planOf(lim?.plan ?? "")
  if (!lim) return section("Codex plan limits", "_No limits read yet: they come from ChatGPT through the codex CLI, or from Codex's last session._")
  return section("Codex plan limits", limitRows(lim.windows), `_${p ? `${p.name} plan, from` : "From"} the ${lim.source}, ${ago(lim.observed)}._`)
})

codingAgent(plugin, { id: "codex", name: "Codex", value: "estimated at list prices", state: (s) => (s.status === "busy" ? "Working" : "Idle"),
  sessionId: SESSION_ID, summary, live: () => live(), plan, session, modelName, projectOf: (cwd) => projectOf(cwd, rootsOf), warm: scan.refresh })
