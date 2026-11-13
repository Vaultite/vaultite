import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { type AgentAsk, type AgentCommand, type AgentMeter, type AgentModel, type AgentModels, type Asking, type Choice, type Question, type AgentStart, ago, codingAgent, dayOf, expandHome, findBin, HOME, isoOf, jsonLines, JsonlScan, limitRows,
  limitWindow, type Live, type SampleAsk, agentRefusal, notOnThisMachine, priceList, processes, projectName, projectOf, shellQuote, projectRoots, epochSeconds, Tally, terminalOf, Transcript, transcripts,
  type Usage, lastTurn, parseTerminal, PERMISSION_MODES, type PermissionMode, trustClaudeProject, usedFirst, when } from "../../../core/agents.ts"
import { bullets, gitEnv, localDate, OpError, Plugin, section } from "../../../core/plugins.ts"
import { type Item, sortBy } from "../../../core/vault.ts"
import { askingIn, Conversation, WANTED } from "./transcript.ts"
import { userSaid } from "./chatlog.ts"
import { chats } from "./chat.ts"
import { type EditSpan, editSpans } from "./edits.ts"
import { dialogOn } from "./dialog.ts"
import { SAMPLE_DIR, sample } from "./sample.ts"
import { teleports } from "./teleport.ts"
import { cloudSessions } from "./cloud.ts"
import { FAMILIES, modelId, modelName, notAModel } from "./models.ts"
import { memoryLines, unsaid } from "./memory.ts"
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const int = (v: unknown) => Math.trunc(Number(v) || 0)

export const plugin = new Plugin(import.meta.url)
const DEFAULT_DIR = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(HOME, ".claude")
const APP_HISTORY = path.join(HOME, "Library", "Application Support", "Claude", "plan-usage-history.json")

// US dollars per million tokens, the published API list: input, output, cache read, cache write 5 min, cache write 1 h.
const price = priceList<[number, number, number, number, number]>({
  "claude-fable-5-1": [10, 50, 0.25, 12.5, 20], "claude-fable-5": [10, 50, 1, 12.5, 20],
  "claude-mythos-5": [10, 50, 1, 12.5, 20],
  "claude-opus-5-5": [4, 20, 0.2, 5, 8], "claude-opus-5": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-8": [5, 25, 0.5, 6.25, 10], "claude-opus-4-7": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-6": [5, 25, 0.5, 6.25, 10], "claude-opus-4-5": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-1": [15, 75, 1.5, 18.75, 30], "claude-opus-4": [15, 75, 1.5, 18.75, 30],
  "claude-sonnet-5": [2, 10, 0.2, 2.5, 4], "claude-sonnet-4": [3, 15, 0.3, 3.75, 6], "claude-3-7-sonnet": [3, 15, 0.3, 3.75, 6],
  "claude-haiku-4-5": [1, 5, 0.1, 1.25, 2], "claude-3-5-haiku": [0.8, 4, 0.08, 1, 1.6],
})
const FAST = 2
const PLANS: [string, string, number | null][] = [["max_20x", "Max 20x", 200], ["max_5x", "Max 5x", 100], ["max", "Max", null],
  ["pro", "Pro", 20], ["team", "Team", null], ["enterprise", "Enterprise", null]]


type Account = { id: string; dir: string; label: string; private: boolean }
const ACCOUNT_ID = /^[a-z0-9]{1,32}$/

function accounts(): Account[] {
  const set = plugin.loaded ? (plugin.settings({}).accounts ?? {}) as Item : {}
  const byDir = new Map<string, string>([[DEFAULT_DIR, "default"]])
  const parent = path.dirname(DEFAULT_DIR), base = path.basename(DEFAULT_DIR)
  let names: string[] = []
  try { names = fs.readdirSync(parent) } catch {}
  for (const n of names.sort()) {
    const id = n.startsWith(base + "-") ? n.slice(base.length + 1).toLowerCase() : ""
    if (ACCOUNT_ID.test(id) && ["projects", ".claude.json"].some((f) => fs.existsSync(path.join(parent, n, f)))) byDir.set(path.join(parent, n), id)
  }
  for (const [id, o] of Object.entries(set)) {
    if (ACCOUNT_ID.test(id) && o && typeof o === "object" && typeof o.dir === "string" && o.dir && !inVault(expandHome(o.dir))) byDir.set(expandHome(o.dir), id)
  }
  const out: Account[] = []
  for (const [dir, id] of byDir) {
    const o = (set[id] && typeof set[id] === "object" ? set[id] : {}) as Item
    if (o.hidden === true || out.some((a) => a.id === id)) continue
    out.push({ id, dir, label: typeof o.label === "string" && o.label ? o.label : cap(id), private: o.private === true })
  }
  return out
}

function inVault(dir: string) {
  const real = (p: string) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }
  const roots = [path.resolve(plugin.vault.path), real(plugin.vault.path)]
  return [path.resolve(dir), real(dir)].some((d) => roots.some((r) => d === r || d.startsWith(r + path.sep)))
}

plugin.folders(() => accounts().map((a) => a.dir))

/** Where an account keeps its .claude.json: beside ~/.claude for the default folder, inside any other. */
const accountJson = (a: Account) => (a.dir === path.join(HOME, ".claude") ? path.join(HOME, ".claude.json") : path.join(a.dir, ".claude.json"))
const PRIVATE = "\0private:"


type Resp = { ts: number; model: string; cwd: string; session: string; n: [number, number, number, number, number]; fast: boolean; day: string }
const N_INPUT = 0, N_WRITE5 = 1, N_WRITE1H = 2, N_READ = 3, N_OUTPUT = 4

const TYPE_FIRST = Buffer.from('{"type":"')

class Scan extends JsonlScan<Resp> {
  titles = new Map<string, [string, string]>()
  protected extra() { return [...this.titles] }
  protected restore(x: unknown) { if (Array.isArray(x)) this.titles = new Map(x) }

  protected line(line: Buffer) {
    // Claude Code writes a line's type first in some (titles, request blobs), early in a user's: told from their head.
    let kind: string
    if (line.subarray(0, TYPE_FIRST.length).equals(TYPE_FIRST)) {
      const type = line.subarray(TYPE_FIRST.length, TYPE_FIRST.length + 14).toString("latin1")
      if (type.startsWith('ai-title"') || type.startsWith('custom-title"')) kind = "title"
      else if (type.startsWith('assistant"') && line.includes('"usage"')) kind = "assistant"
      else if (type.startsWith('system"') && line.includes('"turn_duration"')) kind = "turn"
      else return
    } else if (line.subarray(0, 512).includes('"type":"user"')) return
    else if (line.includes('"type":"assistant"') && line.includes('"usage"')) kind = "assistant"
    else if (line.includes('"turn_duration"')) kind = "turn"
    else if (line.includes('"ai-title"') || line.includes('"custom-title"')) kind = "title"
    else return
    let d: Item
    try { d = JSON.parse(line.toString("utf8")) } catch { return }
    if (!d || typeof d !== "object" || Array.isArray(d)) return
    if (kind === "title") {
      const sid = d.sessionId
      if (d.type === "custom-title" && d.customTitle) this.titles.set(sid, ["custom", d.customTitle])
      else if (d.type === "ai-title" && d.aiTitle && this.titles.get(sid)?.[0] !== "custom") this.titles.set(sid, ["ai", d.aiTitle])
      return
    }
    const ts = epochSeconds(d.timestamp)
    if (ts === null) return
    if (kind === "turn") {
      if (d.subtype === "turn_duration" && d.durationMs) {
        this.turns.set(String(d.uuid), { ts, session: d.sessionId || "", cwd: d.cwd || "", ms: Math.trunc(d.durationMs), day: dayOf(ts) })
      }
      return
    }
    const m = d.message || {}
    const u = m.usage, model = m.model
    if (!u || typeof u !== "object" || Array.isArray(u) || !model || String(model).startsWith("<")) return
    const w = int(u.cache_creation_input_tokens)
    const w1 = int((u.cache_creation || {}).ephemeral_1h_input_tokens)
    const row: Resp = { ts, model, cwd: d.cwd || "", session: d.sessionId || "",
      n: [int(u.input_tokens), Math.max(w - w1, 0), w1, int(u.cache_read_input_tokens), int(u.output_tokens)],
      fast: u.speed === "fast", day: dayOf(ts) }
    // A streamed reply is logged once per content block; the largest counts are the final ones.
    const key = m.id ? `${m.id}:${d.requestId ?? "None"}` : String(d.uuid)
    const old = this.resp.get(key)
    if (old) row.n = old.n.map((a, i) => Math.max(a, row.n[i])) as Resp["n"]
    this.resp.set(key, old ? { ...old, n: row.n } : row)
  }
}

const scans = new Map<string, Scan>()
const keyOf = (dir: string) => createHash("sha1").update(dir).digest("hex").slice(0, 12)
const scanOf = (a: Account) => {
  let s = scans.get(a.dir)
  if (!s) scans.set(a.dir, (s = new Scan(() => [path.join(a.dir, "projects")], () => path.join(plugin.localDir(), `scan-${keyOf(a.dir)}.json`))))
  return s
}
function titleOf(id: string, accts = accounts()) {
  for (const a of accts) if (!a.private) { const t = scans.get(a.dir)?.titles.get(id)?.[1]; if (t) return t }
  return ""
}

function cost(r: Resp) {
  const p = price(r.model)
  if (!p) return null
  const c = (r.n[N_INPUT] * p[0] + r.n[N_OUTPUT] * p[1] + r.n[N_READ] * p[2] + r.n[N_WRITE5] * p[3] + r.n[N_WRITE1H] * p[4]) / 1e6
  return r.fast ? c * FAST : c
}

const rootsOf = (cwds: Iterable<string>) => projectRoots(cwds, (c) => c.split("/.claude/worktrees/")[0])
const nameOf = (root: string, accts: Account[] = []) => root.startsWith(PRIVATE)
  ? accts.find((a) => a.id === root.slice(PRIVATE.length))?.label ?? "Private" : projectName(root)

let summarized: { key: string; out: ReturnType<typeof summarize> } | null = null

async function summary(days: number, accts: Account[]) {
  await Promise.all(accts.map((a) => scanOf(a).refresh()))
  const key = `${accts.map((a) => `${a.id}=${a.dir}:${a.private}:${a.label}:${scanOf(a).version}`).join(",")}:${days}:${localDate(new Date())}`
  if (summarized?.key !== key) summarized = { key, out: summarize(days, accts) }
  return summarized.out
}

function summarize(days: number, accts: Account[]) {
  const t = new Tally(days, (root) => nameOf(root, accts))
  const acctOf = new Map<string, Account>()
  const rows = sortBy(accts.flatMap((a) => [...scanOf(a).resp.values()].filter((r) => r.day >= t.start).map((r) => {
    acctOf.set(r.session, a)
    return a.private ? { ...r, cwd: PRIVATE + a.id } : r
  })), (r) => [r.ts, r.model, r.cwd, r.session])
  const turns = accts.flatMap((a) => [...scanOf(a).turns.values()].filter((x) => x.day >= t.start).map((x) => (a.private ? { ...x, cwd: PRIVATE + a.id } : x)))
  const root = rootsOf(new Set([...rows.map((r) => r.cwd), ...turns.map((x) => x.cwd)]))
  for (const r of rows) {
    const proj = root.get(r.cwd)!, a = acctOf.get(r.session)!
    const s = t.session(r.session, () => ({ root: proj, cwd: a.private ? "" : r.cwd, account: a.id, ...(a.private ? { private: true } : {}),
      title: a.private ? "" : scanOf(a).titles.get(r.session)?.[1] ?? "" }))
    t.count({ ts: r.ts * 1000, day: r.day, cost: cost(r), tokens: r.n.reduce((x, y) => x + y, 0), read: r.n[N_READ],
      prompt: r.n[N_INPUT] + r.n[N_WRITE5] + r.n[N_WRITE1H] + r.n[N_READ], model: modelName(r.model) },
    r.session, t.project(proj, proj.startsWith(PRIVATE) ? "" : proj), s, r.model)
  }
  for (const x of turns) t.work(x.day, root.get(x.cwd)!, x.session, x.ms / 60000)
  return t.result(modelName)
}


function lstart(s: string, utc = false) {
  const m = /^\w{3} (\w{3}) +(\d+) (\d\d):(\d\d):(\d\d) (\d{4})$/.exec(s.trim().split(/\s+/).join(" "))
  if (!m) return null
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(m[1])
  const parts = [Number(m[6]), mon, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])] as const
  return utc ? Date.UTC(...parts) : +new Date(...parts)
}

const started = new Map<number, [unknown, boolean]>()

function alive(pid: number, start: unknown) {
  try {
    process.kill(pid, 0)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EPERM") { started.delete(pid); return false }
  }
  if (!start) return true
  // A pid can be reused: the process must be the one that wrote the file (its start in UTC; ps says local time).
  const seen = started.get(pid)
  if (seen && seen[0] === start) return seen[1]
  let out: string
  try {
    out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 3000 })
  } catch (e) {
    return (e as { status?: number }).status === undefined
  }
  if (!out.trim()) return false
  const ran = lstart(out), wrote = lstart(String(start), true)
  const same = ran === null || wrote === null || Math.abs(ran - wrote) < 5000
  started.set(pid, [start, same])
  return same
}

function running(accts: Account[]) {
  return accts.flatMap((a) => {
    const d = path.join(a.dir, "sessions")
    let names: string[] = []
    try { names = fs.readdirSync(d).filter((n) => n.endsWith(".json")).sort() } catch { return [] }
    return names.flatMap((n) => {
      let s: Item
      try { s = JSON.parse(fs.readFileSync(path.join(d, n), "utf8")) } catch { return [] }
      const pid = Math.trunc(Number(s.pid)), cwd = String(s.cwd || "")
      if (!Number.isFinite(pid) || isAsking(cwd) || !alive(pid, s.procStart)) return []
      return [{ a, s, pid, cwd, sid: typeof s.sessionId === "string" ? s.sessionId : "" }]
    })
  })
}

async function live(accts: Account[]): Promise<Live[]> {
  const ms = (v: unknown) => (typeof v === "number" ? v : null)
  return running(accts).map(({ a, s, pid, cwd, sid }) => ({ pid, id: sid, title: a.private ? "" : scanOf(a).titles.get(sid)?.[1] || s.name || "",
    name: a.private ? "" : s.name || "", status: s.status || "", kind: s.kind || "", cwd: a.private ? "" : cwd, started: ms(s.startedAt),
    since: ms(s.statusUpdatedAt), account: a.id, ...(a.private ? { project: a.label, private: true } : {}) }))
}


const LABELS: Record<string, string> = { session: "Current session", week: "This week", opus: "This week, Opus", sonnet: "This week, Sonnet" }

const window = (key: string, minutes: number, used: number, resets: number | null, now: number, label = LABELS[key]) =>
  limitWindow(key, label, minutes, used, resets, now)
const KEYS: Record<string, [string, number]> = { five_hour: ["session", 300], seven_day: ["week", 10080],
  seven_day_opus: ["opus", 10080], seven_day_sonnet: ["sonnet", 10080] }
const windows = (rl: Item, used: string, resets: (v: unknown) => number | null, now: number) => Object.entries(KEYS).flatMap(([name, [k, m]]) => {
  const w = rl[name]
  return w && typeof w === "object" && typeof w[used] === "number" ? [window(k, m, w[used], resets(w.resets_at), now)] : []
})

const ASKING_DIR = path.join(os.tmpdir(), "vaultite-claude-limits")
let askingReal = ""
let sampleReal = ""
const isAsking = (cwd: string) => (!!askingReal && cwd === askingReal) || cwd === (sampleReal ||= (() => { try { return fs.realpathSync(SAMPLE_DIR) } catch { return "" } })())

function askClaude(dir: string): Promise<Item | null> {
  const bin = process.env.VAULTITE_TEST === "1" ? null : findBin("claude")
  if (!bin) return Promise.resolve(null)
  try { fs.mkdirSync(ASKING_DIR, { recursive: true }); askingReal ||= fs.realpathSync(ASKING_DIR) } catch { return Promise.resolve(null) }
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: [path.dirname(bin), process.env.PATH].filter(Boolean).join(":") }
  if (dir === path.join(HOME, ".claude")) delete env.CLAUDE_CONFIG_DIR
  else env.CLAUDE_CONFIG_DIR = dir
  return jsonLines<Item>(bin, ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--no-session-persistence",
    "--strict-mcp-config"], { env, cwd: ASKING_DIR, ms: 20000, first: { type: "control_request", request_id: "init", request: { subtype: "initialize" } },
  hear: (m, send, done) => {
    if (m.type !== "control_response") return
    const r = m.response ?? {}
    if (r.subtype !== "success") done(null)
    else if (r.request_id === "init") send({ type: "control_request", request_id: "usage", request: { subtype: "get_usage", skipBehaviors: true } })
    else if (r.request_id === "usage") done(r.response ?? null)
  } })
}

const asked = (dir: string) => plugin.memoStale(120, async function claudeUsage(d: string) { return { at: Date.now() / 1000, got: await askClaude(d) } }, dir)

const at = (v: unknown) => { const t = typeof v === "string" ? Date.parse(v) / 1000 : NaN; return Number.isFinite(t) ? t : null }

async function accountLimits(now: number, dir: string) {
  const { at: observed, got } = await asked(dir)
  const rl = got?.rate_limits_available ? got.rate_limits : null
  if (!rl || typeof rl !== "object") return null
  const wins = windows(rl, "utilization", at, now)
  for (const l of Array.isArray(rl.limits) ? rl.limits : []) {
    const name = l?.kind === "weekly_scoped" && typeof l.percent === "number" ? l.scope?.model?.display_name : null
    if (typeof name === "string" && name && !wins.some((w) => w.label === `This week, ${name}`))
      wins.push(window(`week-${name.toLowerCase()}`, 10080, l.percent, at(l.resets_at), now, `This week, ${name}`))
  }
  return wins.length ? { source: "Claude account", observed, windows: wins } : null
}

function statusLineLimits(now: number, a: Account) {
  const files: string[] = []
  for (const dir of new Set([a.dir, path.join(HOME, ".claude")])) {
    const d = path.join(dir, "usage-snapshots")
    try { for (const n of fs.readdirSync(d)) if (n.endsWith(".json")) files.push(path.join(d, n)) } catch {}
  }
  let projects: string[] = []
  try { projects = fs.readdirSync(path.join(a.dir, "projects")).map((n) => path.join(a.dir, "projects", n)) } catch { return null }
  const mine = (sid: string) => projects.some((p) => fs.existsSync(path.join(p, `${sid}.jsonl`)))
  const byAge = files.flatMap((f) => { try { return [[fs.statSync(f).mtimeMs / 1000, f] as const] } catch { return [] } }).sort((x, y) => y[0] - x[0])
  for (const [observed, f] of byAge) {
    if (now - observed > 7 * 86400) break
    let rl: Item
    try { rl = JSON.parse(fs.readFileSync(f, "utf8")).rate_limits } catch { continue }
    if (!rl || typeof rl !== "object" || !mine(path.basename(f, ".json"))) continue
    const wins = windows(rl, "used_percentage", (v) => (typeof v === "number" ? v : null), now)
    if (wins.length) return { source: "status line", observed, windows: wins }
  }
  return null
}

const hour = (ts: number) => ts - (ts % 3600) // allowances renew on the hour, in UTC

function appLimits(now: number, org: string | null, scan: Scan) {
  let data: Item
  try { data = JSON.parse(fs.readFileSync(APP_HISTORY, "utf8")) } catch { return null }
  if (data.version !== 1 && data.version !== 2) return null
  const samples: [number, Record<string, number>][] = []
  for (const e of data.samples || []) {
    if (!e || typeof e !== "object" || typeof e.t !== "number" || (org && e.org !== undefined && e.org !== null && e.org !== org)) continue
    const u = data.version === 1 ? e : (e.u || {})
    samples.push([e.t / 1000, Object.fromEntries(Object.entries(u as Item)
      .filter(([k, v]) => ["fh", "sd", "so", "sn"].includes(k) && typeof v === "number")) as Record<string, number>])
  }
  samples.sort((a, b) => a[0] - b[0])
  if (!samples.length || now - samples[samples.length - 1][0] > 7 * 86400) return null
  const [t, latest] = samples[samples.length - 1]
  const wins = []
  if ("fh" in latest && now - t < 5 * 3600) {
    let end: number | null = null
    if (latest.fh > 0) {
      let i = samples.length - 1
      while (i > 0 && (samples[i - 1][1].fh ?? 0) > 0 && samples[i][0] - samples[i - 1][0] < 5 * 3600) i--
      const began = samples[i][0], earliest = i ? samples[i - 1][0] : samples[i][0] - 5 * 3600
      const mine = [...scan.resp.values()].map((r) => r.ts).filter((ts) => earliest < ts && ts <= began)
      end = hour(mine.length ? Math.min(...mine) : began) + 5 * 3600
    }
    wins.push(window("session", 300, latest.fh, end, now))
  }
  for (const [key, name] of [["sd", "week"], ["so", "opus"], ["sn", "sonnet"]]) {
    if (!(key in latest)) continue
    let resets: number | null = null
    for (let j = samples.length - 1; j >= 1; j--) {
      const [t0, a] = samples[j - 1], [t1, b] = samples[j]
      if (key in a && key in b && b[key] + 1 < a[key]) {
        resets = Math.min(hour(t0) + 3600, t1)
        while (resets <= t) resets += 7 * 86400
        break
      }
    }
    if (resets === null && now - t > 86400) continue
    wins.push(window(name, 10080, latest[key], resets, now))
  }
  return wins.length ? { source: "Claude app", observed: t, windows: wins } : null
}

function login(file: string): Item {
  try { return JSON.parse(fs.readFileSync(file, "utf8")).oauthAccount || {} } catch { return {} }
}

async function plan(a: Account) {
  const o = await plugin.memo(300, login, accountJson(a))
  const tier = `${o.organizationRateLimitTier || ""} ${o.organizationType || ""}`.toLowerCase()
  const hit = PLANS.find(([match]) => tier.includes(match))
  return hit ? { name: hit[1], monthly: hit[2] } : null
}

async function limits(a: Account) {
  const now = Date.now() / 1000
  const live = await accountLimits(now, a.dir)
  if (live) return { ...live, observed: isoOf(live.observed * 1000) }
  const found = [statusLineLimits(now, a), appLimits(now, (await plugin.memo(300, login, accountJson(a))).organizationUuid ?? null, scanOf(a))]
    .filter((x) => x !== null)
  if (!found.length) return null
  const best = found.reduce((x, y) => (y.observed > x.observed ? y : x))
  return { ...best, observed: isoOf(best.observed * 1000) }
}


async function servers(accts: Account[]) {
  const rows: Item[] = []
  for (const { pid, started, command } of await processes()) {
    if (!/^(\S*\/)?claude\s+remote-control(\s|$)/.test(command) || /\s(-h|--help)(\s|$)/.test(command)) continue
    // Unnamed, its sessions are named after the machine (Remote Control's default).
    const name = /--name(?:=|\s+)("[^"]*"|'[^']*'|\S+)/.exec(command)?.[1]?.replace(/^["']|["']$/g, "") || os.hostname().replace(/\.local$/, "")
    // ps shows a process's environment to its user: its CLAUDE_CONFIG_DIR names its account
    let dir = DEFAULT_DIR
    try {
      const env = execFileSync("ps", ["eww", "-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 3000 })
      const d = /(?:^|\s)CLAUDE_CONFIG_DIR=(\S+)/.exec(env)?.[1]
      if (d) dir = expandHome(d)
    } catch {}
    const a = accts.find((x) => x.dir === dir)
    rows.push({ pid, name, account: a?.id ?? "", accountLabel: a?.label ?? path.basename(dir), started: isoOf(started) })
  }
  return sortBy(rows, (r) => [r.started ?? "", r.pid])
}

async function plans(accts: Account[]) {
  const each = await Promise.all(accts.map(async (a) => ({ id: a.id, label: a.label, private: a.private, plan: await plan(a), limits: await limits(a) })))
  const plans = each.map((a) => a.plan).filter((p) => p !== null)
  const both = plans.length === each.length && plans.length > 1
    ? { name: plans.map((p) => p.name).join(" + "), monthly: plans.every((p) => p.monthly) ? plans.reduce((n, p) => n + p.monthly!, 0) : null } : null
  return { plan: each.length === 1 ? each[0].plan : both, limits: each.find((a) => a.limits)?.limits ?? null,
    accounts: each, servers: await plugin.memoStale(10, servers, accts) }
}


const SESSION_ID = /^[\w-]{1,80}$/
const transcript = transcripts((file) => new Transcript(file, () => new Conversation(), WANTED))

function sessionFile(id: string, all = false): { file: string; account: Account } | null {
  if (!SESSION_ID.test(id)) return null
  for (const a of accounts().filter((x) => all || !x.private)) {
    const dir = path.join(a.dir, "projects")
    let folders: string[] = []
    try { folders = fs.readdirSync(dir) } catch { continue }
    for (const f of folders) {
      const p = path.join(dir, f, `${id}.jsonl`)
      if (fs.existsSync(p)) return { file: p, account: a }
    }
  }
  return null
}

async function session(id: string) {
  const file = sessionFile(id)?.file
  const t = file ? await transcript(file) : null
  if (!t) return null
  return { ...t.talk.head, title: titleOf(id) || t.talk.head.title, entries: t.talk.entries }
}

plugin.provide("sample", (a: SampleAsk) => sample(a, DEFAULT_DIR))


/** On Windows' PowerShell and cmd the hooks POST (http hooks); SessionStart takes only a program. */
function hooks({ state, report, stateHook, reportUrl }: Pick<AgentStart, "state" | "report" | "stateHook" | "reportUrl">): object | null {
  const reported = report ? { type: "command", command: report } : reportUrl ? { type: "http", url: reportUrl, timeout: 5 } : null
  const told = reported ? [{ matcher: "^(Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell)$", hooks: [reported] }] : []
  if (!state && !stateHook) return reported ? { hooks: { PostToolUse: told } } : null
  const set = (s: "working" | "waiting" | "idle", kind?: "permission" | "question", start = false) => {
    if (state) return [{ type: "command", command: state(s, kind) }]
    const h = stateHook!(s, kind)
    return [start ? { type: "command", command: h.argv[0], args: h.argv.slice(1), timeout: 5 } : { type: "http", url: h.url, timeout: 5 }]
  }
  const asks = "AskUserQuestion|ExitPlanMode"
  return { hooks: {
    SessionStart: [{ hooks: set("idle", undefined, true) }],
    UserPromptSubmit: [{ hooks: set("working") }],
    PreToolUse: [{ matcher: `^(?!(${asks})$).*`, hooks: set("working") }, { matcher: `^(${asks})$`, hooks: set("waiting", "question") }],
    PostToolUse: [{ hooks: set("working") }, ...told],
    // A turn that was interrupted fires no Stop: a minute idle at its prompt counts too.
    Notification: [{ matcher: "permission_prompt", hooks: set("waiting", "permission") }, { matcher: "elicitation_dialog", hooks: set("waiting", "question") },
      { matcher: "idle_prompt", hooks: set("idle") }],
    Stop: [{ hooks: set("idle") }],
  } }
}

const CLOUD_SESSION = /^session_\w{4,80}$/
const FLAGS = new Set(["--resume", "--teleport", "--append-system-prompt", "--settings", "--allowedTools", "--model", "--effort", "--permission-mode", "--"])
plugin.provide("agent:claude", async (start: AgentStart): Promise<AgentCommand> => {
  const { resume, context, profile, prompt, dark, allow, model, effort, mode, wsl } = start
  const driver = resume ? chat.driving(resume) : ""
  if (driver) return agentRefusal(`This is ${driver === "companion" ? "the companion's" : `the ${driver} plugin's`} Claude Code session, running in the app with tools only the app serves: open it in its chat tab, or stop it there first to resume it here.`)
  const cloud = !!resume && CLOUD_SESSION.test(resume)
  const found = resume && !wsl && !cloud ? sessionFile(resume, true) : null
  if (resume && !found && !wsl && !cloud) return notOnThisMachine("Claude Code", resume)
  if (resume && !cloud && chat.hosted(resume)) await chat.letGo(resume)
  const a = wsl ? undefined : found?.account ?? (profile ? accounts().find((x) => x.id === profile) : undefined)
  if (cloud && profile && !a) return agentRefusal(`There's no Claude Code account "${profile}" on this machine to continue that cloud session in.`)
  const env: Record<string, string> = a && (a.dir !== path.join(HOME, ".claude") || process.env.CLAUDE_CONFIG_DIR) ? { CLAUDE_CONFIG_DIR: a.dir } : {}
  const cwd = found ? (await transcript(found.file))?.talk.head.cwd || null : null
  const append = context && !wsl && !cloud ? unsaid(context, memoryLines(cwd || start.cwd || plugin.vault.path, a?.dir ?? DEFAULT_DIR)) : context
  if (context) env.VAULTITE_TOLD = "1"
  // Its ANSI themes draw in the terminal's 16 colours, which are the app's colour scheme.
  const theme = typeof dark === "boolean" ? { theme: dark ? "dark-ansi" : "light-ansi" } : null
  const told = hooks(start)
  const settings = told || theme ? { ...told, ...theme } : null
  // (Bash(...) and PowerShell(...): without Git Bash, Windows' Claude Code runs commands with its PowerShell tool)
  const allowed = allow?.flatMap((x) => [`Bash(${x}:*)`, ...(process.platform === "win32" && !wsl ? [`PowerShell(${x}:*)`] : [])])
  const args = [...(resume ? [cloud ? "--teleport" : "--resume", resume] : []), ...(append ? ["--append-system-prompt", append] : []), ...(settings ? ["--settings", JSON.stringify(settings)] : []),
    ...(allowed?.length ? ["--allowedTools", ...allowed] : []), ...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : []),
    ...(mode ? ["--permission-mode", mode] : []), ...(prompt && !cloud ? ["--", prompt] : [])]
  return {
    command: [...Object.entries(env).map(([k, v]) => `${k}=${shellQuote(v)}`), "claude", ...args.map((x) => (FLAGS.has(x) ? x : shellQuote(x)))].join(" "),
    argv: ["claude", ...args], env, cwd,
  }
})

const models = (): AgentModels => ({ models: FAMILIES.map((id) => ({ id, label: modelName(id) })),
  efforts: ["low", "medium", "high", "xhigh", "max"], modes: [...PERMISSION_MODES] })
/** Its accounts' ids: what a job may ask to run in on this machine. */
plugin.provide("agent-accounts:claude", () => accounts().map((a) => a.id))
plugin.provide("agent-models:claude", models)
/** A model as people say it ("Fable 5.2", "opus 55") as --model takes it, and its name. */
plugin.provide("agent-model-id:claude", (said: string): AgentModel => {
  const id = modelId(said)
  return id === null ? { error: notAModel(said) } : { id, label: id && modelName(id) }
})

/** The permission mode a session runs in now: what a subagent it delegates to may have at most; null: unknown. */
plugin.provide("agent-mode:claude", async (terminal: string, session = ""): Promise<PermissionMode | null> => {
  const sid = session || await sessionIn(terminal)
  const hosted = sid ? chat.api.list().find((s) => s.id === sid) : undefined
  if (hosted) return hosted.mode
  const found = sid ? sessionFile(sid, true) : null, t = found && tail(found.file)
  const said = t ? [...t.text.matchAll(/"permissionMode":"(\w+)"/g)].at(-1)?.[1] : undefined
  return PERMISSION_MODES.find((m) => m === said) ?? null
})

/** Claude Code's dialogs: folder trust, then external CLAUDE.md imports, before its hooks run; a permission, Yes chosen. */
const ASKS: AgentAsk[] = [
  { id: "trust", match: /Yes, I trust this folder/, says: "Trust this folder? It can read, edit and run files in it", approve: { option: "Yes, I trust this folder" }, deny: { option: "No, exit" } },
  { id: "imports", match: /Yes, allow external imports/, says: "Allow external CLAUDE.md imports? Its rules read files outside this folder",
    approve: { option: "Yes, allow external imports" }, deny: { option: "No, disable external imports" } },
  { id: "permission", match: /Do you want to.*(?:\n(?![❯>]).*)*\n *[❯>] 1\. Yes(?:\n(?![❯>]).*)*$/, lines: 40, says: "Asks permission", approve: ["\r"], deny: ["\x1b"] },
]
plugin.provide("agent-asks:claude", (): AgentAsk[] => ASKS)

/** A session's last response and how long its prompt cache lasts: an hour when it wrote 1 h cache, else five minutes. */
plugin.provide("agent-session:claude", (id: string): { transcript: string; last: number; ttl: number; account: string } | null => {
  const found = sessionFile(id, true), t = found && tail(found.file)
  return t ? { transcript: found.file, last: t.st.mtimeMs, ttl: ttlOf(t.text), account: found.account.id } : null
})

/** The account a session runs in (the Inbox mutes the ones the user muted); null when it can't be told. */
plugin.provide("agent-account:claude", async (terminal: string, session = ""): Promise<{ id: string; label: string } | null> => {
  const accts = accounts(), of = (a: Account | undefined) => (a ? { id: a.id, label: a.label } : null)
  const found = session ? sessionFile(session, true) : null
  if (found) return of(found.account)
  if (!terminal) return null
  for (const { a, s, pid } of running(accts)) {
    const key = `${pid}@${s.procStart}`
    const t = terminals.get(key) ?? await terminalOf(plugin, pid)
    if (t) terminals.set(key, t)
    if (t === terminal) return of(a)
  }
  const named = parseTerminal(terminal)
  return named?.agent === "claude" ? of(accts.find((a) => a.id === (named.profile ?? "default")) ?? accts[0]) : null
})

/** A session's latest turn: the user's last message (or `auto`), Claude's last answer, its background tasks running. */
plugin.provide("agent-turn:claude", async (terminal: string, session = "") => {
  const now = !terminal && session ? chat.turnNow(session) : null
  const sid = session || await sessionIn(terminal)
  const found = sid ? sessionFile(sid) : null
  const t = found ? await transcript(found.file) : null
  if (now) return { ...now, files: t ? lastTurn(t.talk.entries).files : [] }
  const auto = t?.talk.auto
  return t ? { session: sid, ...lastTurn(t.talk.entries), ...(auto ? { prompt: auto.text, auto: true } : {}), background: t.talk.background.size } : null
})

/** The user's own latest message in a session, not a notice or another session's message. */
plugin.provide("agent-said:claude", async (terminal: string, session = "") => {
  const sid = session || await sessionIn(terminal)
  const found = sid ? sessionFile(sid) : null
  const text = found ? await fs.promises.readFile(found.file, "utf8").catch(() => "") : ""
  const said = text ? userSaid(text.split("\n")) : null
  return said ? { session: sid, ...said } : null
})

/** The files a session changed after each message it was told and each of its words, from `from` on. */
plugin.provide("agent-edits:claude", async (terminal: string, session = "", from = ""): Promise<EditSpan[] | null> => {
  const sid = session || await sessionIn(terminal)
  const found = sid ? sessionFile(sid) : null
  if (!found) return null
  const text = await fs.promises.readFile(found.file, "utf8").catch(() => "")
  const spans = editSpans(text.split("\n")), first = from ? spans.findIndex((s) => s.prompt?.includes(from)) : 0
  return first < 0 ? [] : spans.slice(first)
})

/** What a session waits on: its AskUserQuestion or plan, else its terminal's dialog as a question; never a private account's. */
plugin.provide("agent-asking:claude", async (terminal: string, session = ""): Promise<Asking | null> => {
  const hosted = !terminal && session ? chat.askingNow(session) : undefined
  if (hosted !== undefined) return hosted
  const sid = session || await sessionIn(terminal)
  const found = sid ? sessionFile(sid) : null, t = found && tail(found.file)
  const said = t ? askingIn(t.text) : null
  if (said || !terminal) return said
  const screen = await plugin.ask<string>("terminal:screen", "", terminal, 40).catch(() => "")
  const lines = screen.replace(/\s+$/, "").split("\n")
  if (ASKS.some((a) => a.match.test(lines.slice(-(a.lines ?? 12)).join("\n")))) return null
  const q = dialogOn(screen)
  return q ? { kind: "question", questions: [q] } : null
})

/** The keys answering its questions with `choices`, or "chat": a digit picks (toggles in a multi-select, then Tab). */
plugin.provide("agent-pick:claude", (questions: Question[], choices: Choice[] | "chat"): string[] => {
  if (choices === "chat") return [String(questions[0].options.length + 2)]
  const keys = questions.flatMap((q, i) => {
    const c = choices[i]
    if (!q.multi) return typeof c === "string" ? [String(q.options.length + 1), c, "\r"] : [String((Array.isArray(c) ? c : c.options)[0])]
    const [picks, text] = typeof c === "string" ? [[], c] : Array.isArray(c) ? [c, ""] : [c.options, c.text]
    return text ? [...picks.map(String), ...Array(q.options.length).fill("\x1b[B"), text, "\t", "\r"] : [...picks.map(String), "\t"]
  })
  return questions.length > 1 || questions.some((q) => q.multi) ? [...keys, "1"] : keys
})

async function sessionIn(terminal: string) {
  const sid = parseTerminal(terminal)?.resume || ""
  if (sid || !terminal) return sid
  for (const { a, s, pid, sid: id } of running(accounts())) {
    if (!id || a.private) continue
    const key = `${pid}@${s.procStart}`
    const t = terminals.get(key) ?? await terminalOf(plugin, pid)
    if (t) terminals.set(key, t)
    if (t === terminal) return id
  }
  return ""
}

const said = new Map<string, { size: number; model: string | null }>()
plugin.provide("agent-model:claude-code", (session: string) => {
  const found = SESSION_ID.test(session) ? sessionFile(session, true) : null
  if (!found) return null
  let size = 0
  try { size = fs.statSync(found.file).size } catch { return null }
  const was = said.get(found.file)
  if (was?.size === size) return was.model
  let model: string | null = null
  for (const line of (tail(found.file)?.text ?? "").split("\n").reverse()) {
    if (!line.includes('"type":"assistant"') || line.includes('"isSidechain":true')) continue
    const m = /"model":"([^"]+)"/.exec(line)
    if (m && m[1] !== "<synthetic>") { model = modelName(m[1]); break }
  }
  said.set(found.file, { size, model })
  if (said.size > 50) said.delete(said.keys().next().value!)
  return model
})


let waitsTold = new Map<string, "permission" | "question">()
let waitsTimer: ReturnType<typeof setTimeout> | null = null
const tellWaitsSoon = () => { waitsTimer ??= setTimeout(() => { waitsTimer = null; void tellWaits().catch((e) => console.error("claude-code: waits:", e)) }, 100) }

export async function tellWaits() {
  const tell = plugin.service("terminal:agent-waits")
  if (!tell) return
  const now = new Map<string, "permission" | "question">()
  for (const { s, pid } of running(accounts())) {
    if (s.status !== "waiting") continue
    const key = `${pid}@${s.procStart}`
    const t = terminals.get(key) ?? await terminalOf(plugin, pid)
    if (!t) continue
    terminals.set(key, t)
    now.set(t, s.waitingFor === "permission prompt" ? "permission" : "question")
  }
  for (const [t, kind] of now) if (waitsTold.get(t) !== kind) tell(t, kind)
  for (const t of waitsTold.keys()) if (!now.has(t)) tell(t, null)
  waitsTold = now
}

const watched = new Map<string, fs.FSWatcher>()
function watchSessions() {
  for (const a of accounts()) {
    const d = path.join(a.dir, "sessions")
    if (watched.has(d) || !fs.existsSync(d)) continue
    try {
      const w = fs.watch(d, tellWaitsSoon)
      w.on("error", () => { w.close(); watched.delete(d) })
      watched.set(d, w)
    } catch {}
  }
  tellWaitsSoon()
}
const sessionsLook = setInterval(watchSessions, 30_000)
sessionsLook.unref?.()
setTimeout(watchSessions, 0).unref?.()
plugin.onUnload(() => { clearInterval(sessionsLook); if (waitsTimer) clearTimeout(waitsTimer); for (const w of watched.values()) w.close() })

function tail(file: string) {
  try {
    const fd = fs.openSync(file, "r")
    try {
      const st = fs.fstatSync(fd), n = Math.min(st.size, 256 << 10), buf = Buffer.alloc(n)
      fs.readSync(fd, buf, 0, n, st.size - n)
      return { st, text: buf.toString("utf8") }
    } finally { fs.closeSync(fd) }
  } catch { return null }
}
/** How long a transcript's prompt cache lasts: an hour when its tail wrote 1 h cache, else five minutes. */
const ttlOf = (tail: string) => (/"ephemeral_1h_input_tokens":\s*[1-9]/.test(tail) ? 3600 : 300)

const terminals = new Map<string, string>()
type Read = { tokens: number; last: number; ttl: number }
const lastRead = new Map<string, { size: number; meter: Read | null }>()
plugin.provide("agent-meters:claude", async (meters?: boolean): Promise<AgentMeter[]> => {
  const out: AgentMeter[] = []
  for (const { a, s, pid, sid, cwd } of running(accounts())) {
    if (!sid) continue
    const key = `${pid}@${s.procStart}`
    let terminal = terminals.get(key)
    if (!terminal) {
      terminal = await terminalOf(plugin, pid) ?? undefined
      if (!terminal) continue
      terminals.set(key, terminal)
    }
    const at = { terminal, session: sid, account: a.id, ...(a.private || !cwd ? {} : { cwd }) }
    const found = meters && sessionFile(sid, true), m = found && lastRequest(found.file)
    if (!m) { out.push(at); continue }
    out.push({ ...at, ...m, window: windowOf(a.dir, sid, m.tokens) })
  }
  return out
})

function windowOf(dir: string, sid: string, tokens: number) {
  // A status line may write to ~/.claude whatever account runs it: a session id is the same in either.
  for (const d of new Set([dir, path.join(HOME, ".claude")])) {
    try { const w = Number(JSON.parse(fs.readFileSync(path.join(d, "usage-snapshots", `${sid}.json`), "utf8")).context_window?.context_window_size) || 0; if (w) return w } catch {}
  }
  return tokens > 200_000 ? 1_000_000 : 200_000
}

/** How full a session's context is now: its last request's tokens and its window. */
plugin.provide("agent-context:claude", async (terminal: string, session = ""): Promise<{ tokens: number; window: number } | null> => {
  const sid = session || await sessionIn(terminal)
  const found = sid ? sessionFile(sid) : null, m = found && lastRequest(found.file)
  return m ? { tokens: m.tokens, window: windowOf(found.account.dir, sid, m.tokens) } : null
})

function lastRequest(file: string) {
  let size = 0
  try { size = fs.statSync(file).size } catch { return null }
  const was = lastRead.get(file)
  if (was?.size === size) return was.meter
  const t = tail(file)
  if (!t) return null
  let meter: Read | null = null
  for (const line of t.text.split("\n").reverse()) {
    if (!line.includes('"type":"assistant"') || !line.includes('"usage"') || line.includes('"isSidechain":true')) continue
    try {
      const e = JSON.parse(line), u = e.message?.usage ?? {}
      const tokens = int(u.input_tokens) + int(u.cache_read_input_tokens) + int(u.cache_creation_input_tokens)
      if (!tokens) continue
      meter = { tokens, last: Date.parse(e.timestamp) || 0, ttl: ttlOf(t.text) }
      break
    } catch {}
  }
  lastRead.set(file, { size, meter })
  return meter
}


plugin.block("agent-limits", async (ctx) => {
  const accts = agent.accountsFor(ctx.options.account)
  const used = accts.length > 1 ? await agent.usedBy(ctx.options.for) : new Map<string, string[]>()
  const each = await Promise.all(usedFirst(accts, used).map(async (a) => ({ a, lim: await limits(a) })))
  return section("Plan limits", ...each.flatMap(({ a, lim }) => {
    const head = each.length > 1 ? `### ${a.label}${a.uses ? ` (${a.uses.join(", ")})` : ""}` : ""
    if (!lim) return [head, "_No limits read yet: they come from Claude Code (signed in), its status line or the Claude app._"]
    return [head, limitRows(lim.windows), `_From the ${lim.source}, ${ago(lim.observed)}._`]
  }))
})

function room(lim: Awaited<ReturnType<typeof limits>>) {
  const week = lim?.windows.find((w) => w.id === "week"), session = lim?.windows.find((w) => w.id === "session")
  return { week_left: week ? Math.max(0, Math.round((100 - week.used) * 10) / 10) : null, renews: week?.resets_at ?? null,
    session_full: !!session && session.used >= 100, session_renews: session?.resets_at ?? null }
}

plugin.op({
  id: "claude-code.limits", cli: "limits", mcp: "claude_limits", owner: "Claude Code on this machine", kind: "read", lock: false,
  summary: "Each Claude Code account's plan limits: how much of its week is left and when it renews, most room first, to pick the account a new session runs on.",
  help: `Every account on this machine (its config folders), the one with the most of its week left first; one whose 5-hour
session is spent goes last until it renews. for (a plugin) says what that plugin runs on each account.

  vau limits
  vau limits --account agent`,
  params: {
    account: { type: "string", description: "one account, by its id (default, agent...)" },
    for: { type: "string", description: "a plugin (companion): says which accounts it runs on, and for what" },
  },
  run: async (p) => {
    const accts = agent.accountsFor(p.account)
    const used = accts.length > 1 ? await agent.usedBy(p.for) : new Map<string, string[]>()
    const each = await Promise.all(usedFirst(accts, used).map(async (a) => {
      const lim = await limits(a)
      return { id: a.id, label: a.label, ...(a.uses ? { uses: a.uses } : {}), ...room(lim), windows: lim?.windows ?? [], source: lim?.source ?? null, observed: lim?.observed ?? null }
    }))
    return { accounts: sortBy(each, (a) => [a.session_full ? 1 : 0, a.week_left === null ? 1 : 0, -(a.week_left ?? 0)]) }
  },
  text: (r) => r.accounts.map((a: Item) => `${a.label} (${a.id})${a.uses ? `, ${a.uses.join(", ")}` : ""}: ` +
    (a.week_left === null ? "no limits read yet" : `${a.week_left}% of the week left` + (a.renews ? `, renews ${when(a.renews)}` : "") +
      (a.session_full ? `; its 5-hour session is spent${a.session_renews ? ` until ${when(a.session_renews)}` : ""}` : ""))).join("\n") || "No Claude Code accounts here.",
})

/** The checkout `cwd` is in, the main one for a worktree's (Claude Code trusts a worktree as its checkout), or "". */
function checkoutOf(cwd: string) {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, env: gitEnv(), timeout: 5000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
    if (path.basename(common) !== ".git" || !fs.statSync(common).isDirectory()) return ""
    return fs.realpathSync(path.dirname(common))
  } catch { return "" }
}

plugin.op({
  id: "claude-code.trust", owner: "Claude Code on this machine", kind: "write", lock: false,
  summary: "Marks the checkout a folder is in (its main one for a worktree) trusted in a Claude Code account, so Claude Code started there doesn't ask \"Trust this folder?\". The companion's jobs use it for the user's own repos.",
  params: {
    cwd: { type: "string", required: true, description: "a folder in a git checkout on this machine" },
    account: { type: "string", description: "the account, by its id (default, agent...); default: default" },
  },
  run: async (p) => {
    const id = String(p.account ?? "").trim().toLowerCase() || "default", a = accounts().find((x) => x.id === id)
    if (!a) throw new OpError(`no Claude Code account '${id}' here (vau limits lists them)`, 404)
    const dir = checkoutOf(expandHome(String(p.cwd)))
    if (!dir) throw new OpError(`${p.cwd} isn't in a git checkout here: only a checkout is trusted this way`, 404)
    return { account: a.id, checkout: dir, trusted: await trustClaudeProject(accountJson(a), dir) }
  },
  text: (r) => `${r.checkout} is trusted in ${r.account}${r.trusted ? "" : " (it already was)"}.`,
  did: (p) => ({ action: "settings", text: `Trusted ${p.cwd} for Claude Code${p.account ? ` (${p.account})` : ""}` }),
})

const agent = codingAgent(plugin, {
  id: "claude-code", name: "Claude Code", value: "estimated at list prices", sessionId: SESSION_ID, summary, live, plan: plans,
  session, modelName, projectOf: (cwd) => projectOf(cwd, rootsOf), accounts: { all: accounts, word: "Claude Code account" },
  warm: () => Promise.all(accounts().map((a) => scanOf(a).refresh())),
  state: (s) => (s.status === "busy" ? "Working" : cap(String(s.status).toLowerCase()) || "Open"),
  more: (u) => {
    const rc = (u as Usage & { servers: Item[] }).servers
    return rc.length ? ["### Remote Control", bullets(rc.map((r) => `${r.name || "Unnamed"}${r.accountLabel ? ` (${r.accountLabel})` : ""}, since ${ago(r.started)}`))] : []
  },
})


const chat = chats(plugin, {
  accounts, sessionFile, models, modelName,
  async tuiOf(id) {
    for (const { a, s, pid, sid } of running(accounts())) {
      if (sid !== id || chat.hosted(id) || String(s.entrypoint ?? "").startsWith("sdk")) continue
      const key = `${pid}@${s.procStart}`
      const t = terminals.get(key) ?? await terminalOf(plugin, pid)
      if (t) terminals.set(key, t)
      return a.private ? "" : t ?? ""
    }
    return null
  },
  async inTerminals() {
    return new Set(running(accounts()).filter(({ s }) => !String(s.entrypoint ?? "").startsWith("sdk")).map(({ sid }) => sid).filter(Boolean))
  },
  async folders() {
    const u = await summary(30, accounts().filter((a) => !a.private))
    return sortBy((u.projects as Item[]).filter((p) => typeof p.root === "string" && p.root && fs.existsSync(p.root)), (p) => [String(p.last ?? "")]).reverse().map((p) => String(p.root))
  },
})
plugin.exports.chat = chat.api

cloudSessions(plugin, { accounts, bin: () => (process.env.VAULTITE_TEST === "1" ? null : findBin("claude")), trust: (a, dir) => trustClaudeProject(accountJson(a), dir),
  envOf: (a) => {
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (a.dir === path.join(HOME, ".claude")) delete env.CLAUDE_CONFIG_DIR
    else env.CLAUDE_CONFIG_DIR = a.dir
    return env
  } })

teleports(plugin, { accounts, json: accountJson, roots: async () => {
  const u = await summary(30, accounts())
  return sortBy((u.projects as Item[]).filter((p) => typeof p.root === "string" && p.root), (p) => [String(p.last ?? "")]).reverse().map((p) => String(p.root))
} })
