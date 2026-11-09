// CI's verdict on a commit, from GitHub Actions: an update takes only commits CI passed.
import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)

/** A commit's verdict; ok null is not yet (running, not run, cancelled, GitHub not answering). */
export type CiResult = { ok: boolean | null; why: string }
/** Asks CI about a commit of "owner/repo". */
export type Ci = (repo: string, sha: string) => Promise<CiResult>
/** A workflow run, as GitHub's API gives it. */
export type CiRun = { path?: string; event?: string; status?: string; conclusion?: string | null; head_sha?: string }

/** CI's workflow for pushes to main (.github/workflows/ci.yml): main is judged by its push and nightly runs, never by one
 *  run by hand (those are QA). */
export const CI_WORKFLOW = ".github/workflows/ci.yml"

/** "owner/repo" of a GitHub remote's url, or null. */
export const githubRepo = (url: string) => /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1] ?? null

/** GitHub's API (the gh CLI when it's signed in, else anonymously: the repo is public): its workflow runs, or why not. */
export async function githubRuns(api: string): Promise<CiRun[] | string> {
  let body: { workflow_runs?: CiRun[] }
  try {
    body = JSON.parse((await exec("gh", ["api", api], { timeout: 30_000 })).stdout)
  } catch {
    const r = await fetch(`https://api.github.com/${api}`, { headers: { accept: "application/vnd.github+json", "user-agent": "vaultite" }, signal: AbortSignal.timeout(30_000) })
    if (!r.ok) return `GitHub answered ${r.status} about CI`
    body = await r.json() as typeof body
  }
  return body.workflow_runs ?? []
}

/** CI's verdicts for one look: the branch's latest runs in one call, a commit not among them asked of on its own (one
 *  call each: the anonymous API allows 60 an hour). */
export function githubCi(branch: string, runs: (api: string) => Promise<CiRun[] | string> = githubRuns): Ci {
  let latest: Promise<CiRun[] | string> | null = null
  return async (repo, sha) => {
    latest ??= runs(`repos/${repo}/actions/workflows/${path.basename(CI_WORKFLOW)}/runs?branch=${branch}&per_page=100`)
    const all = await latest, mine = typeof all === "string" ? [] : all.filter((r) => r.head_sha === sha)
    if (mine.length) return ciOf(mine)
    const own = await runs(`repos/${repo}/actions/runs?head_sha=${sha}&per_page=50`)
    return typeof own === "string" ? { ok: null, why: own } : ciOf(own)
  }
}

/** CI's verdict from a commit's workflow runs: one of the push or nightly runs passed; red only when they all failed. */
export function ciOf(runs: CiRun[]): CiResult {
  const ours = runs.filter((r) => (r.path ?? "").startsWith(CI_WORKFLOW) && (r.event === "push" || r.event === "schedule"))
  if (ours.some((r) => r.status === "completed" && r.conclusion === "success")) return { ok: true, why: "CI passed" }
  if (!ours.length) return { ok: null, why: "CI hasn't run on it yet" }
  if (ours.some((r) => r.status !== "completed")) return { ok: null, why: "CI is running on it" }
  if (ours.every((r) => r.conclusion === "cancelled")) return { ok: null, why: "CI's run on it was cancelled" }
  return { ok: false, why: "CI failed on it" }
}
