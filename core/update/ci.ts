// CI's verdict on a commit, from GitHub Actions: an update takes only commits whose test job for this server's OS passed.
import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)

/** Where CI is with a commit: none when it has no run (a commit pushed under a newer one never gets one). */
export type CiState = "passed" | "failed" | "running" | "none" | "cancelled"
/** A commit's verdict; ok null is not yet (running, not run, cancelled, GitHub not answering: no `state`). `elsewhere`:
 *  the jobs that failed besides the ones it waits for (another OS's tests, the demo), as far as GitHub said. */
export type CiResult = { ok: boolean | null; why: string; state?: CiState; elsewhere?: string[] }
/** Asks CI about a commit of "owner/repo". `superseded`: an older commit than the branch's tip, answered from what the
 *  branch's runs already say (a commit pushed under a newer one never gets a run of its own to look up). */
export type Ci = (repo: string, sha: string, o?: { superseded?: boolean }) => Promise<CiResult>
/** A workflow run, as GitHub's API gives it. */
export type CiRun = { id?: number; path?: string; event?: string; status?: string; conclusion?: string | null; head_sha?: string; head_branch?: string | null }

/** CI's workflow for pushes to main (.github/workflows/ci.yml): main is judged by its push and nightly runs, never by one
 *  run by hand (those are QA). */
export const CI_WORKFLOW = ".github/workflows/ci.yml"
/** A run's job, as GitHub's API gives it (its latest attempt's). */
export type CiJob = { name: string; status?: string; conclusion?: string | null }

/** The jobs a server waits for: ci.yml's test job on its own OS ("test (macos-15)": the check, build, tests and smoke
 *  in it), by the runner's family. The other OSes' and the demo (the site's build, not what a server runs) only say. */
export type Gate = { label: string; job: (name: string) => boolean }
const FAMILY: Partial<Record<NodeJS.Platform, [string, string]>> = { darwin: ["macos", "macOS"], linux: ["ubuntu", "Linux"], win32: ["windows", "Windows"] }
/** This OS's gate; null where ci.yml tests on no runner of its kind (the whole run must pass). */
export function osGate(platform: NodeJS.Platform = process.platform): Gate | null {
  const f = FAMILY[platform]
  return f ? { label: `${f[1]} tests`, job: (name) => name.startsWith(`test (${f[0]}`) } : null
}

/** The branches a try run pushes (tools/try.ts): ci.yml runs its tests there. */
export const TRY_PREFIX = "try/"

/** "owner/repo" of a GitHub remote's url, or null. */
export const githubRepo = (url: string) => /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1] ?? null

/** How githubApi last reached GitHub: through a signed-in gh, anonymously, or not yet (null). */
let signedIn: boolean | null = null

/** GitHub's API (the gh CLI when it's signed in, else anonymously: the repo is public): its answer, or why not. */
export async function githubApi<T>(api: string, timeout = 30_000): Promise<T | string> {
  try {
    const body = JSON.parse((await exec("gh", ["api", api], { timeout })).stdout) as T
    signedIn = true
    return body
  } catch { /* (not signed in, or no gh: anonymously) */ }
  signedIn = false
  try {
    const r = await fetch(`https://api.github.com/${api}`, { headers: { accept: "application/vnd.github+json", "user-agent": "vaultite" }, signal: AbortSignal.timeout(timeout) })
    return r.ok ? await r.json() as T : `GitHub answered ${r.status} about CI`
  } catch (e) {
    return `GitHub didn't answer about CI (${(e as Error).message})`
  }
}

/** GitHub's API allows 60 calls an hour without a login, per address, shared by every machine behind it: the updates
 *  ask at most this many in any hour, whatever the looks or check-nows (two hosts on one network still leave a third). */
export const CI_CALLS_PER_HOUR = 20
/** Signed in, GitHub allows 5000 an hour per account (every gh on it, every machine): the updates take a small share. */
export const CI_CALLS_SIGNED_IN = 300
const HOUR = 3_600_000

/** The updates' calls an hour by how githubApi reaches GitHub: anonymous's until a signed-in gh answered. */
export const ciCallsPerHour = (viaGh: boolean | null = signedIn) => viaGh ? CI_CALLS_SIGNED_IN : CI_CALLS_PER_HOUR

/** At most `max` calls in any hour (a function: sized at each call): `take` says whether one more may go now. */
export function callBudget(limit: number | (() => number) = CI_CALLS_PER_HOUR, now = Date.now) {
  const at: number[] = [], max = typeof limit === "number" ? () => limit : limit
  return {
    max,
    take() {
      while (at.length && now() - at[0] >= HOUR) at.shift()
      if (at.length >= max()) return false
      at.push(now())
      return true
    },
    used: () => at.filter((t) => now() - t < HOUR).length,
  }
}
export type CallBudget = ReturnType<typeof callBudget>
/** This process's, shared by every look (timed or asked for). */
const hourly = callBudget(() => ciCallsPerHour())

/** A red verdict is asked again after this (a re-run or the nightly may pass it); a pass is final. */
const RED_RECHECK = 10 * 60_000
/** The branch's runs serve every question of one look, not the next's. */
const LIST_FOR = 15_000

/** CI's verdicts, asked as little as GitHub allows: the branch's latest runs in one call, a commit not among them on its
 *  own once, a run's jobs only while they may change (once all ended, never again), a pass never, a red every 10 min. */
export function githubCi(branch: string, get: (api: string) => Promise<unknown> = githubApi, o: { budget?: CallBudget; now?: () => number; gate?: Gate | null } = {}): Ci {
  const budget = o.budget ?? hourly, now = o.now ?? Date.now, gate = o.gate === undefined ? osGate() : o.gate
  const ask = <T>(api: string) => (budget.take() ? get(api) : Promise.resolve(`GitHub's API was asked ${budget.max()} times this hour, the most the updates ask: CI is asked again later`)) as Promise<T | string>
  const runsOf = (body: { workflow_runs?: CiRun[] } | string) => typeof body === "string" ? body : body.workflow_runs ?? []
  const known = new Map<string, { r: CiResult; at: number }>(), seen = new Map<string, CiRun[]>(), ended = new Map<number, CiJob[]>()
  let list: { at: number; runs: Promise<CiRun[] | string> } | null = null
  return async (repo, sha, { superseded = false } = {}) => {
    const k = known.get(sha)
    if (k && (k.r.ok === true || (k.r.ok === false && now() - k.at < RED_RECHECK))) return k.r
    // (a red asked again: a re-run's jobs or the nightly's run may pass it)
    if (k?.r.ok === false) { for (const r of seen.get(sha) ?? []) if (r.id) ended.delete(r.id); seen.delete(sha) }
    // (with a gate, a run's progress is read from its jobs, once it started; without, or before, from the list)
    let runs = gate && !seen.get(sha)?.some(waiting) ? seen.get(sha) : undefined
    if (!runs?.length) {
      if (!list || now() - list.at >= LIST_FOR) list = { at: now(), runs: ask<{ workflow_runs?: CiRun[] }>(`repos/${repo}/actions/workflows/${path.basename(CI_WORKFLOW)}/runs?branch=${branch}&per_page=100`).then(runsOf) }
      const all = await list.runs
      if (typeof all === "string") return { ok: null, why: all }
      runs = all.filter((r) => r.head_sha === sha)
      // (one not among the branch's latest runs: its own, older than the list, asked once; a superseded one never had one)
      if (!runs.length && !seen.has(sha) && !superseded) {
        const theirs = runsOf(await ask<{ workflow_runs?: CiRun[] }>(`repos/${repo}/actions/runs?head_sha=${sha}&per_page=50`))
        if (typeof theirs === "string") return { ok: null, why: theirs }
        runs = theirs
      }
      seen.set(sha, runs = ours(runs))
    }
    const jobs = new Map<number, CiJob[] | string>()
    for (const run of runs) {
      if (!run.id || !needsJobs(run, gate)) continue
      const done = ended.get(run.id)
      if (done) { jobs.set(run.id, done); continue }
      const got = await ask<{ jobs?: CiJob[] }>(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=50`)
      const js = typeof got === "string" ? got : got.jobs ?? []
      jobs.set(run.id, js)
      if (typeof js !== "string" && js.length && js.every((j) => j.status === "completed")) ended.set(run.id, js)
      if (typeof js !== "string" && verdictOf(run, js, gate).state === "passed") break
    }
    const r = ciOf(runs, { gate, jobs: (run) => (run.id ? jobs.get(run.id) ?? ended.get(run.id) : undefined) })
    if (r.ok !== null) known.set(sha, { r, at: now() })
    if (known.size + seen.size + ended.size > 1500) { known.clear(); seen.clear(); ended.clear() } // (a long-running server's: never more than a look's)
    return r
  }
}

/** ci.yml's runs that are main's: its push and nightly runs, never one by hand (QA) nor a try run (tools/try.ts: a try/
 *  branch, only the tests). */
const ours = (runs: CiRun[]) => runs.filter((r) => (r.path ?? "").startsWith(CI_WORKFLOW) && (r.event === "push" || r.event === "schedule") && !r.head_branch?.startsWith(TRY_PREFIX))

/** Whether a run's verdict needs its jobs: not when it passed whole, nor while it waits to start (none of its jobs can
 *  have ended), nor, with no gate, while it runs. */
const WAITING = new Set(["queued", "pending", "waiting", "requested"])
const waiting = (run: CiRun) => WAITING.has(run.status ?? "")
const needsJobs = (run: CiRun, gate: Gate | null) => !(run.status === "completed" && run.conclusion === "success") && !waiting(run) && (!!gate || run.status === "completed")

const RED = new Set(["failure", "timed_out", "startup_failure"])
type RunVerdict = { state: CiState | "unknown"; why?: string; elsewhere: string[] }
/** One run's verdict for a gate, from its jobs (undefined: not asked, a string: why GitHub didn't say). */
function verdictOf(run: CiRun, jobs: CiJob[] | string | undefined, gate: Gate | null): RunVerdict {
  if (run.status === "completed" && run.conclusion === "success") return { state: "passed", elsewhere: [] }
  if (typeof jobs === "string" && gate) return { state: "unknown", why: jobs, elsewhere: [] }
  if (jobs === undefined || typeof jobs === "string" || !jobs.length) {
    if (run.status !== "completed") return { state: "running", elsewhere: [] }
    if (!gate) return { state: run.conclusion === "cancelled" ? "cancelled" : "failed", elsewhere: [] }
    return { state: "unknown", why: "GitHub didn't say which of its jobs failed", elsewhere: [] }
  }
  const mine = gate ? jobs.filter((j) => gate.job(j.name)) : jobs
  const elsewhere = jobs.filter((j) => !mine.includes(j) && j.status === "completed" && RED.has(j.conclusion ?? "")).map((j) => j.name)
  if (!mine.length) return { state: run.status === "completed" ? "none" : "running", elsewhere }
  if (mine.some((j) => j.status === "completed" && RED.has(j.conclusion ?? ""))) return { state: "failed", elsewhere }
  if (mine.some((j) => j.status !== "completed")) return { state: "running", elsewhere }
  if (mine.every((j) => j.conclusion === "success" || j.conclusion === "skipped") && mine.some((j) => j.conclusion === "success")) return { state: "passed", elsewhere }
  return { state: mine.every((j) => j.conclusion === "cancelled") ? "cancelled" : "failed", elsewhere }
}

/** CI's verdict on a commit from its runs: one of main's (push or nightly) passed the gate's jobs, the rest of the run
 *  only said (`elsewhere`); red once a gate's job failed, ended or not. No gate: the whole run, by its conclusion. */
export function ciOf(runs: CiRun[], o: { gate?: Gate | null; jobs?: (run: CiRun) => CiJob[] | string | undefined } = {}): CiResult {
  const gate = o.gate ?? null, what = gate ? `CI's ${gate.label}` : "CI"
  const vs = ours(runs).map((r) => verdictOf(r, o.jobs?.(r), gate))
  const pass = vs.find((v) => v.state === "passed")
  if (pass) return { ok: true, why: `${what} passed`, state: "passed", ...(pass.elsewhere.length ? { elsewhere: pass.elsewhere } : {}) }
  const elsewhere = [...new Set(vs.flatMap((v) => v.elsewhere))], more = elsewhere.length ? { elsewhere } : {}
  if (!vs.length || vs.every((v) => v.state === "none")) return { ok: null, why: `${what} hasn't run on it yet`, state: "none" }
  if (vs.some((v) => v.state === "running")) return { ok: null, why: `${what} ${gate ? "are" : "is"} running on it`, state: "running", ...more }
  const unknown = vs.find((v) => v.state === "unknown")
  if (unknown) return { ok: null, why: unknown.why ?? "GitHub didn't say", ...more }
  if (vs.every((v) => v.state === "cancelled")) return { ok: null, why: "CI's run on it was cancelled", state: "cancelled" }
  return { ok: false, why: `${what} failed on it`, state: "failed", ...more }
}
