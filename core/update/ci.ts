// CI's verdict on a commit, from GitHub Actions: an update takes only commits CI passed.
import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)

/** Where CI is with a commit: none when it has no run (a commit pushed under a newer one never gets one). */
export type CiState = "passed" | "failed" | "running" | "none" | "cancelled"
/** A commit's verdict; ok null is not yet (running, not run, cancelled, GitHub not answering: no `state`). */
export type CiResult = { ok: boolean | null; why: string; state?: CiState }
/** Asks CI about a commit of "owner/repo". */
export type Ci = (repo: string, sha: string) => Promise<CiResult>
/** A workflow run, as GitHub's API gives it. */
export type CiRun = { path?: string; event?: string; status?: string; conclusion?: string | null; head_sha?: string; head_branch?: string | null }

/** CI's workflow for pushes to main (.github/workflows/ci.yml): main is judged by its push and nightly runs, never by one
 *  run by hand (those are QA). */
export const CI_WORKFLOW = ".github/workflows/ci.yml"

/** "owner/repo" of a GitHub remote's url, or null. */
export const githubRepo = (url: string) => /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1] ?? null

/** GitHub's API (the gh CLI when it's signed in, else anonymously: the repo is public): its answer, or why not. */
export async function githubApi<T>(api: string, timeout = 30_000): Promise<T | string> {
  try {
    return JSON.parse((await exec("gh", ["api", api], { timeout })).stdout) as T
  } catch { /* (not signed in, or no gh: anonymously) */ }
  try {
    const r = await fetch(`https://api.github.com/${api}`, { headers: { accept: "application/vnd.github+json", "user-agent": "vaultite" }, signal: AbortSignal.timeout(timeout) })
    return r.ok ? await r.json() as T : `GitHub answered ${r.status} about CI`
  } catch (e) {
    return `GitHub didn't answer about CI (${(e as Error).message})`
  }
}

/** A list of workflow runs from GitHub's API, or why not. */
export async function githubRuns(api: string): Promise<CiRun[] | string> {
  const body = await githubApi<{ workflow_runs?: CiRun[] }>(api)
  return typeof body === "string" ? body : body.workflow_runs ?? []
}

/** GitHub's API allows 60 calls an hour without a login, per address, shared by every machine behind it: the updates
 *  ask at most this many in any hour, whatever the looks or check-nows (two hosts on one network still leave a third). */
export const CI_CALLS_PER_HOUR = 20
const HOUR = 3_600_000

/** At most `max` calls in any hour: `take` says whether one more may go now. */
export function callBudget(max = CI_CALLS_PER_HOUR, now = Date.now) {
  const at: number[] = []
  return {
    take() {
      while (at.length && now() - at[0] >= HOUR) at.shift()
      if (at.length >= max) return false
      at.push(now())
      return true
    },
    used: () => at.filter((t) => now() - t < HOUR).length,
  }
}
export type CallBudget = ReturnType<typeof callBudget>
/** This process's, shared by every look (timed or asked for). */
const hourly = callBudget()

/** A red verdict is asked again after this (a re-run or the nightly may pass it); a pass is final. */
const RED_RECHECK = 10 * 60_000
/** The branch's runs serve every question of one look, not the next's. */
const LIST_FOR = 15_000

/** CI's verdicts, asked as little as GitHub allows: the branch's latest runs in one call, a commit not among them on its
 *  own once (its runs are older than the list, so they don't change), a pass never again, a red one every 10 minutes. */
export function githubCi(branch: string, runs: (api: string) => Promise<CiRun[] | string> = githubRuns, o: { budget?: CallBudget; now?: () => number } = {}): Ci {
  const budget = o.budget ?? hourly, now = o.now ?? Date.now
  const ask = (api: string) => budget.take() ? runs(api) : Promise.resolve(`GitHub's API was asked ${CI_CALLS_PER_HOUR} times this hour, the most the updates ask: CI is asked again later`)
  const known = new Map<string, { r: CiResult; at: number }>(), own = new Map<string, CiResult>()
  let list: { at: number; runs: Promise<CiRun[] | string> } | null = null
  return async (repo, sha) => {
    const k = known.get(sha)
    if (k && (k.r.ok === true || (k.r.ok === false && now() - k.at < RED_RECHECK))) return k.r
    if (!list || now() - list.at >= LIST_FOR) list = { at: now(), runs: ask(`repos/${repo}/actions/workflows/${path.basename(CI_WORKFLOW)}/runs?branch=${branch}&per_page=100`) }
    const all = await list.runs
    if (typeof all === "string") return { ok: null, why: all }
    const mine = all.filter((r) => r.head_sha === sha)
    let r: CiResult | undefined = mine.length ? ciOf(mine) : own.get(sha)
    if (!r) {
      const theirs = await ask(`repos/${repo}/actions/runs?head_sha=${sha}&per_page=50`)
      if (typeof theirs === "string") return { ok: null, why: theirs }
      own.set(sha, r = ciOf(theirs))
    }
    if (r.ok !== null) known.set(sha, { r, at: now() })
    if (known.size + own.size > 500) { known.clear(); own.clear() } // (a long-running server's: never more than a look's)
    return r
  }
}

/** CI's verdict from a commit's workflow runs: one of the push or nightly runs passed; red only when they all failed. */
export function ciOf(runs: CiRun[]): CiResult {
  const ours = runs.filter((r) => (r.path ?? "").startsWith(CI_WORKFLOW) && (r.event === "push" || r.event === "schedule"))
  if (ours.some((r) => r.status === "completed" && r.conclusion === "success")) return { ok: true, why: "CI passed", state: "passed" }
  if (!ours.length) return { ok: null, why: "CI hasn't run on it yet", state: "none" }
  if (ours.some((r) => r.status !== "completed")) return { ok: null, why: "CI is running on it", state: "running" }
  if (ours.every((r) => r.conclusion === "cancelled")) return { ok: null, why: "CI's run on it was cancelled", state: "cancelled" }
  return { ok: false, why: "CI failed on it", state: "failed" }
}
