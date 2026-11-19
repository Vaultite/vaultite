import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expandHome, findBin, HOME, isoOf, jsonLines, limitWindow, processes } from "../../../core/agents.ts"
import type { Plugin } from "../../../core/plugins.ts"
import { whenReady } from "../../../core/startup.ts"
import { type Item, sortBy } from "../../../core/vault.ts"
import { SAMPLE_DIR } from "./sample.ts"

export type Account = { id: string; dir: string; label: string; private: boolean }
type Needs = { defaultDir: string; accountJson: (a: Account) => string; scanOf: (a: Account) => { resp: Map<string, { ts: number }> } }

const APP_HISTORY = path.join(HOME, "Library", "Application Support", "Claude", "plan-usage-history.json")
const PLANS: [string, string, number | null][] = [["max_20x", "Max 20x", 200], ["max_5x", "Max 5x", 100], ["max", "Max", null],
  ["pro", "Pro", 20], ["team", "Team", null], ["enterprise", "Enterprise", null]]

const LABELS: Record<string, string> = { session: "Current session", week: "This week", opus: "This week, Opus", sonnet: "This week, Sonnet" }

const window = (key: string, minutes: number, used: number, resets: number | null, now: number, label = LABELS[key]) =>
  limitWindow(key, label, minutes, used, resets, now)
const KEYS: Record<string, [string, number]> = { five_hour: ["session", 300], seven_day: ["week", 10080],
  seven_day_opus: ["opus", 10080], seven_day_sonnet: ["sonnet", 10080] }
const windows = (rl: Item, used: string, resets: (v: unknown) => number | null, now: number) => Object.entries(KEYS).flatMap(([name, [k, m]]) => {
  const w = rl[name]
  return w && typeof w === "object" && typeof w[used] === "number" ? [window(k, m, w[used], resets(w.resets_at), now)] : []
})

const ASKING_DIR = path.join(os.tmpdir(), "vaultite-claude-limits"), ASK_AFTER = 3000
const started = process.env.VAULTITE_TEST === "1" ? Promise.resolve() : whenReady.then(() => new Promise((r) => setTimeout(r, ASK_AFTER).unref()))
let askingReal = ""
let sampleReal = ""
export const isAsking = (cwd: string) => (!!askingReal && cwd === askingReal) || cwd === (sampleReal ||= (() => { try { return fs.realpathSync(SAMPLE_DIR) } catch { return "" } })())

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

const at = (v: unknown) => { const t = typeof v === "string" ? Date.parse(v) / 1000 : NaN; return Number.isFinite(t) ? t : null }

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

function appLimits(now: number, org: string | null, scan: { resp: Map<string, { ts: number }> }) {
  let data: Item
  try { data = JSON.parse(fs.readFileSync(APP_HISTORY, "utf8")) } catch { return null }
  if (data.version !== 1 && data.version !== 2) return null
  const samples: [number, Record<string, number>][] = []
  for (const e of data.samples || []) {
    if (!e || typeof e !== "object" || typeof e.t !== "number" || (org && e.org !== undefined && e.org !== null && e.org !== org)) continue
    const u = data.version === 1 ? e : (e.u || {})
    const kept: Record<string, number> = {}
    for (const [k, v] of Object.entries(u)) if (["fh", "sd", "so", "sn"].includes(k) && typeof v === "number") kept[k] = v
    samples.push([e.t / 1000, kept])
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

async function servers(accts: Account[], defaultDir: string) {
  const rows: Item[] = []
  for (const { pid, started, command } of await processes()) {
    if (!/^(\S*\/)?claude\s+remote-control(\s|$)/.test(command) || /\s(-h|--help)(\s|$)/.test(command)) continue
    // Unnamed, its sessions are named after the machine (Remote Control's default).
    const name = /--name(?:=|\s+)("[^"]*"|'[^']*'|\S+)/.exec(command)?.[1]?.replace(/^["']|["']$/g, "") || os.hostname().replace(/\.local$/, "")
    // ps shows a process's environment to its user: its CLAUDE_CONFIG_DIR names its account
    let dir = defaultDir
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

export function limitsOf(plugin: Plugin, { defaultDir, accountJson, scanOf }: Needs) {
  const asked = (dir: string) => plugin.memoStale(120, async function claudeUsage(d: string) {
    await started
    return { at: Date.now() / 1000, got: await askClaude(d) }
  }, dir)

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

  async function plans(accts: Account[]) {
    const each = await Promise.all(accts.map(async (a) => ({ id: a.id, label: a.label, private: a.private, plan: await plan(a), limits: await limits(a) })))
    const plans = each.map((a) => a.plan).filter((p) => p !== null)
    const both = plans.length === each.length && plans.length > 1
      ? { name: plans.map((p) => p.name).join(" + "), monthly: plans.every((p) => p.monthly) ? plans.reduce((n, p) => n + p.monthly!, 0) : null } : null
    return { plan: each.length === 1 ? each[0].plan : both, limits: each.find((a) => a.limits)?.limits ?? null,
      accounts: each, servers: await plugin.memoStale(10, servers, accts, defaultDir) }
  }

  return { limits, plans }
}
