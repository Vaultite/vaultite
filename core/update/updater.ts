// Following a branch: every few minutes a look at origin, and a newer commit CI passed is handed to the host to take
// (core/selfupdate.ts: a service's checkout, in place). The updates' state is what `vau version` shows.
import fs from "node:fs"
import path from "node:path"
import type { Ci } from "./ci.ts"
import { githubCi } from "./ci.ts"
import type { Relation } from "./git.ts"
import { changedFiles, commitsSince, currentBranch, fetchBranch, gitIn, isDirty, originRepo, pickTarget, relation, short } from "./git.ts"

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
/** What lasts across restarts. */
type Kept = Pick<UpdateStatus, "last" | "error">

/** A commit to take: from what runs (`running`, which the checkout's `head` may be past) to `to`, and the files between. */
export type Update = { head: string; running: string; to: string; files: string[] }
/** Taken, and whether the server must restart to run it; or why not, having gone back to what runs. */
export type Applied = { restart: boolean } | { failed: string; cause?: unknown }

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
  ci?: Ci
  /** Takes a commit into the checkout and builds it, never leaving it half-updated. */
  apply: (u: Update) => Promise<Applied>
}

const MINUTE = 60_000
/** The last lines of a failed command (its stderr) or an error, short enough for a status. */
export const errText = (e: unknown) => String((e as { stderr?: string }).stderr || (e as Error).message || e).trim().split("\n").slice(-3).join(" ").slice(0, 500)

let status: UpdateStatus = { branch: null, state: "off", why: "not a service install following a branch (vau service install --updates <branch>)", checked: null }
/** The updates' state now (off unless this server follows a branch). */
export const updateStatus = (): UpdateStatus => status

type Stop = { state: UpdateState; why: string; next?: string; fail?: true }
/** Where the checkout stands against the branch, before CI is asked: a status to stop at (`fail`: a new failure, to
 *  keep), or null to go on. */
export function placed(p: { branch: string; head: string; remote: string; running: string; relation: Relation; failed?: Kept["error"] }): Stop | null {
  if (p.relation === "same" && p.running === p.head) return { state: "current", why: `up to date with origin/${p.branch}` }
  if (p.relation === "ahead") return { state: p.running === p.head ? "current" : "waiting", why: `ahead of origin/${p.branch}: it runs once pushed and CI passed` }
  if (p.failed?.commit === p.remote) return { state: "failed", why: p.failed.message, next: p.remote }
  if (p.relation === "diverged") return { state: "failed", why: `the checkout and origin/${p.branch} have diverged: it can't fast-forward`, next: p.remote, fail: true }
  return null
}

/** One look: fetch, and update when the branch is ahead, CI passed, the tree is clean and nobody's busy. Never throws. */
export async function checkForUpdate(o: UpdaterOptions): Promise<UpdateStatus> {
  const git = gitIn(o.root)
  let kept: Kept = {}
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
    const on = await currentBranch(git)
    if (on !== o.branch) return set("waiting", `the checkout is on ${on || "a detached commit"}, not ${o.branch}`)
    const { head, remote } = await fetchBranch(git, o.branch)
    const running = o.running || head
    const stop = placed({ branch: o.branch, head, remote, running, relation: await relation(git, head, remote), failed: kept.error })
    if (stop) return stop.fail ? fail(remote, stop.why) : set(stop.state, stop.why, stop.next)
    if (await isDirty(git)) return set("waiting", "the checkout has uncommitted changes", remote)
    const repo = await originRepo(git)
    if (!repo) return set("waiting", "origin isn't on GitHub, so CI can't be checked", remote)
    const ci = o.ci ?? githubCi(o.branch)
    const target = await pickTarget({ tip: remote, since: () => commitsSince(git, head, remote), ci: (sha) => ci(repo, sha), failed: kept.error?.commit })
    if ("why" in target) return set("waiting", target.why, remote)
    const next = target.to
    const busy = await o.busy()
    if (busy) return set("waiting", `busy: ${busy}`, next)

    set("updating", `updating to ${short(next)}`, next)
    const files = await changedFiles(git, running, next)
    const applied = await o.apply({ head, running, to: next, files })
    if ("failed" in applied) return fail(next, applied.failed, applied.cause)
    const { restart } = applied
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
  if (!o.running) void gitIn(o.root)("rev-parse", "HEAD").then((head) => { o.running = head }, () => {})
  status = { branch: o.branch, state: "waiting", why: "the first look is a minute after the server starts", checked: null }
  try { Object.assign(status, JSON.parse(fs.readFileSync(o.stateFile, "utf8"))) } catch { /* none yet */ }
  const later = (ms: number) => setTimeout(() => void checkForUpdate(o).finally(() => later(10 * MINUTE)), ms).unref()
  later(MINUTE)
}
