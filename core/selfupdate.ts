// A service install following a branch (`vau service install --updates main`: VAULTITE_UPDATES in the job's env, so
// it's this machine's choice, not the vault's): a newer commit CI passed is merged, built, and run by a restart.
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)

type UpdateState = "off" | "current" | "waiting" | "updating" | "failed"
/** What `app.version` (vau version) shows: what runs and what the updates are doing. */
export type UpdateStatus = {
  /** The branch followed, null when off. */
  branch: string | null
  state: UpdateState
  /** Why, in words. */
  why: string
  checked: number | null
  /** The branch's newer commit, while waiting for it. */
  next?: string
  last?: { from: string; to: string; at: number; restarted: boolean }
  /** The update that failed (it isn't tried again until the branch moves on). */
  error?: { at: number; commit: string; message: string }
}

export type CiResult = { ok: boolean | null; why: string }
export type UpdaterOptions = {
  root: string
  branch: string
  /** The commit this server started on (what runs): a checkout moved past it, merged or pulled here, is run too. */
  running?: string
  /** Where what lasts across restarts is kept (the last update, the one that failed). */
  stateFile: string
  /** Why the server shouldn't restart now (an agent at work in the browser), or null. */
  busy: () => Promise<string | null>
  restart: () => void
  /** Whether CI passed on a commit (default: GitHub Actions); ok null is not yet. */
  ci?: (repo: string, sha: string) => Promise<CiResult>
  /** Runs npm (install, run build) in the checkout. */
  npm?: (args: string[]) => Promise<unknown>
}

const MINUTE = 60_000
const short = (sha: string) => sha.slice(0, 7)
const errText = (e: unknown) => String((e as { stderr?: string }).stderr || (e as Error).message || e).trim().split("\n").slice(-3).join(" ").slice(0, 500)

let status: UpdateStatus = { branch: null, state: "off", why: "not a service install following a branch (vau service install --updates <branch>)", checked: null }
/** The updates' state now (off unless this server follows a branch). */
export const updateStatus = (): UpdateStatus => status

/** CI's workflow for pushes to main (.github/workflows/ci.yml): main is judged by its push and nightly runs, never by one
 *  run by hand (those are QA). */
export const CI_WORKFLOW = ".github/workflows/ci.yml"

/** "owner/repo" of a GitHub remote's url, or null. */
export const githubRepo = (url: string) => /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1] ?? null

/** Whether CI's runs on `sha` passed, from GitHub's API (the gh CLI when it's signed in, else anonymously: the repo is
 *  public). */
async function githubCi(repo: string, sha: string): Promise<CiResult> {
  const api = `repos/${repo}/actions/runs?head_sha=${sha}&per_page=50`
  let body: { workflow_runs?: { path?: string; event?: string; status?: string; conclusion?: string | null }[] }
  try {
    body = JSON.parse((await exec("gh", ["api", api], { timeout: 30_000 })).stdout)
  } catch {
    const r = await fetch(`https://api.github.com/${api}`, { headers: { accept: "application/vnd.github+json", "user-agent": "vaultite" }, signal: AbortSignal.timeout(30_000) })
    if (!r.ok) return { ok: null, why: `GitHub answered ${r.status} about CI` }
    body = await r.json() as typeof body
  }
  return ciOf(body.workflow_runs ?? [])
}

/** CI's verdict from a commit's workflow runs: one of the push or nightly runs passed; red only when they all failed. */
export function ciOf(runs: { path?: string; event?: string; status?: string; conclusion?: string | null }[]): CiResult {
  const ours = runs.filter((r) => (r.path ?? "").startsWith(CI_WORKFLOW) && (r.event === "push" || r.event === "schedule"))
  if (ours.some((r) => r.status === "completed" && r.conclusion === "success")) return { ok: true, why: "CI passed" }
  if (!ours.length) return { ok: null, why: "CI hasn't run on it yet" }
  if (ours.some((r) => r.status !== "completed")) return { ok: null, why: "CI is running on it" }
  if (ours.every((r) => r.conclusion === "cancelled")) return { ok: null, why: "CI's run on it was cancelled" }
  return { ok: false, why: "CI failed on it" }
}

/** Whether a change reaches the running server (and so needs a restart): anything but what's built into web/dist or
 *  never loaded by it (the desktop and iOS apps, tools, CI, docs for people). */
export const backendChanged = (files: string[]) => files.some((f) =>
  !/^(web|electron|ios|tools|screenshots|examples|\.github|\.githooks)\//.test(f) && !/\.(tsx|css)$/.test(f) && !/^[^/]+\.md$/.test(f))

/** node-pty's helper loses its exec bit in an npm install, and terminals then fail (Setup.md). */
function fixSpawnHelper(root: string) {
  const dir = path.join(root, "node_modules", "node-pty", "prebuilds")
  try {
    for (const d of fs.readdirSync(dir)) if (d.startsWith("darwin-")) {
      const f = path.join(dir, d, "spawn-helper")
      if (fs.existsSync(f)) fs.chmodSync(f, 0o755)
    }
  } catch { /* no prebuilds here (Linux builds its own) */ }
}

/** One look: fetch, and update when the branch is ahead, CI passed, the tree is clean and nobody's busy. Never throws. */
export async function checkForUpdate(o: UpdaterOptions): Promise<UpdateStatus> {
  const git = async (...args: string[]) => (await exec("git", args, { cwd: o.root, timeout: 120_000, maxBuffer: 16 << 20 })).stdout.trim()
  // (Windows' npm is npm.cmd, which only a shell runs; the arguments are fixed words)
  const npm = o.npm ?? ((args: string[]) => exec("npm", args, { cwd: o.root, timeout: 30 * MINUTE, maxBuffer: 64 << 20, shell: process.platform === "win32", windowsHide: true }))
  let kept: Pick<UpdateStatus, "last" | "error"> = {}
  try { kept = JSON.parse(fs.readFileSync(o.stateFile, "utf8")) } catch { /* none yet */ }
  const keep = () => { try { fs.mkdirSync(path.dirname(o.stateFile), { recursive: true }); fs.writeFileSync(o.stateFile, JSON.stringify({ last: kept.last, error: kept.error })) } catch { /* shown, not kept */ } }
  const set = (state: UpdateState, why: string, next?: string) =>
    (status = { branch: o.branch, state, why, checked: Date.now(), ...(next ? { next } : {}), ...(kept.last ? { last: kept.last } : {}), ...(kept.error ? { error: kept.error } : {}) })
  const fail = (commit: string, message: string, e?: unknown) => {
    kept.error = { at: Date.now(), commit, message }
    keep()
    console.error(`vaultite: updating the server: ${message}`, ...(e instanceof Error ? [e] : []))
    return set("failed", message, commit)
  }
  try {
    const on = await git("symbolic-ref", "--short", "-q", "HEAD").catch(() => "")
    if (on !== o.branch) return set("waiting", `the checkout is on ${on || "a detached commit"}, not ${o.branch}`)
    await git("fetch", "--quiet", "--no-tags", "origin", `+refs/heads/${o.branch}:refs/remotes/origin/${o.branch}`)
    const head = await git("rev-parse", "HEAD"), remote = await git("rev-parse", `refs/remotes/origin/${o.branch}`)
    const running = o.running || head
    const ancestor = (a: string, b: string) => git("merge-base", "--is-ancestor", a, b).then(() => true, () => false)
    if (head === remote && running === head) return set("current", `up to date with origin/${o.branch}`)
    if (head !== remote && !(await ancestor(head, remote))) {
      if (await ancestor(remote, head)) return set(running === head ? "current" : "waiting", `ahead of origin/${o.branch}: it runs once pushed and CI passed`)
      return kept.error?.commit === remote ? set("failed", kept.error.message, remote) : fail(remote, `the checkout and origin/${o.branch} have diverged: it can't fast-forward`)
    }
    const next = remote
    if (kept.error?.commit === next) return set("failed", kept.error.message, next)
    if (await git("status", "--porcelain", "--untracked-files=no")) return set("waiting", "the checkout has uncommitted changes", next)
    const repo = githubRepo(await git("config", "--get", "remote.origin.url"))
    if (!repo) return set("waiting", "origin isn't on GitHub, so CI can't be checked", next)
    const ci = await (o.ci ?? githubCi)(repo, next)
    if (ci.ok !== true) return set("waiting", `${ci.why} (${short(next)})`, next)
    const busy = await o.busy()
    if (busy) return set("waiting", `busy: ${busy}`, next)

    set("updating", `updating to ${short(next)}`, next)
    const files = (await git("diff", "--name-only", running, next)).split("\n").filter(Boolean)
    const lock = files.includes("package-lock.json")
    const install = async () => {
      await npm(["install", "--no-audit", "--no-fund"])
      fixSpawnHelper(o.root)
      await git("checkout", "--", "package-lock.json") // (npm may rewrite it: the tree stays clean for the next update)
    }
    try {
      if (head !== next) await git("merge", "--ff-only", "--quiet", next)
      if (lock) await install()
      await npm(["run", "build"])
    } catch (e) {
      // Back to what runs, built as it was: never half-updated.
      let back = ""
      const was = await ancestor(running, head) ? running : head
      try {
        if (await git("rev-parse", "HEAD") !== was) {
          await git("reset", "--hard", "--quiet", was)
          if (lock) await install()
          await npm(["run", "build"])
        }
      } catch (e2) { back = `, and going back to ${short(was)} failed too: ${errText(e2)}` }
      return fail(next, `${short(next)} didn't install or build: ${errText(e)}${back}`, e)
    }
    const restart = backendChanged(files)
    kept = { last: { from: running, to: next, at: Date.now(), restarted: restart } }
    keep()
    o.running = next // (a web-only update is live once built)
    console.log(`vaultite: updated the server to ${short(next)} (${files.length} files)${restart ? ", restarting" : ""}`)
    set("current", restart ? `updated to ${short(next)}, restarting` : `updated to ${short(next)} (the web app only)`)
    if (restart) o.restart()
    return status
  } catch (e) {
    // (a fetch or GitHub not answering: tried again next time, not an error to keep)
    return set("waiting", `couldn't check: ${errText(e)}`)
  }
}

/** Look every 10 minutes (the first a minute after the start), one look at a time. */
export function startUpdater(o: UpdaterOptions) {
  if (!o.running) void exec("git", ["rev-parse", "HEAD"], { cwd: o.root }).then((r) => { o.running = r.stdout.trim() }, () => {})
  status = { branch: o.branch, state: "waiting", why: "the first look is a minute after the server starts", checked: null }
  try { Object.assign(status, JSON.parse(fs.readFileSync(o.stateFile, "utf8"))) } catch { /* none yet */ }
  const later = (ms: number) => setTimeout(() => void checkForUpdate(o).finally(() => later(10 * MINUTE)), ms).unref()
  later(MINUTE)
}
