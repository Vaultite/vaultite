// Following a branch: every few minutes a look at origin, and a newer commit CI passed is handed to the host to take
// (core/selfupdate.ts, in place). Each change of state or reason is logged, so why it waited can be read later.
import fs from "node:fs"
import path from "node:path"
import type { Ci } from "./ci.ts"
import { githubCi } from "./ci.ts"
import type { Relation } from "./git.ts"
import { capped, changedFiles, commitsNotIn, commitsSince, currentBranch, dirtyFiles, fetchBranch, gitIn, originRepo, pickTarget, relation, short } from "./git.ts"

type UpdateState = "off" | "current" | "waiting" | "updating" | "failed"
/** What in the checkout stops an update (what agents working in a server's checkout leave behind): changes not
 *  committed, commits not on the branch, the two diverged, another branch checked out. */
export type Blocked = { by: "uncommitted" | "unpushed" | "diverged" | "branch"; files?: string[]; commits?: string[] }
/** What `app.version` (vau version) shows: what runs and what the updates are doing. */
export type UpdateStatus = {
  /** The branch followed, null when off. */
  branch: string | null
  state: UpdateState
  /** Why, in words. */
  why: string
  checked: number | null
  /** The commit this server runs: what it started on, moved on by an update needing no restart. */
  running?: string
  /** origin's commit of the branch at the last look. */
  origin?: string
  /** The branch's newer commit, while waiting for it. */
  next?: string
  /** What in the checkout stops it, when that's what does. */
  blocked?: Blocked
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
  /** Whether CI passed on a commit (default: GitHub Actions, core/update/ci.ts); ok null is not yet. */
  ci?: Ci
  /** Takes a commit into the checkout and builds it, never leaving it half-updated. */
  apply: (u: Update) => Promise<Applied>
  /** Where a change of state goes (default: the server's log; a new failure as an error). */
  log?: (line: string, error?: unknown) => void
}

const MINUTE = 60_000
/** The last lines of a failed command (its stderr) or an error, short enough for a status. */
export const errText = (e: unknown) => String((e as { stderr?: string }).stderr || (e as Error).message || e).trim().split("\n").slice(-3).join(" ").slice(0, 500)

let status: UpdateStatus = { branch: null, state: "off", why: "not a service install following a branch (vau service install --updates <branch>)", checked: null }
/** The updates' state now (off unless this server follows a branch). */
export const updateStatus = (): UpdateStatus => status

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`
/** Commits as a status names them: how many, and the newest few. */
type Commits = { count: number; list: string[] }

type Stop = { state: UpdateState; why: string; next?: string; fail?: true; blocked?: Blocked }
/** Where the checkout stands against the branch, before CI is asked: a status to stop at (`fail`: a new failure, to
 *  keep), or null to go on. `here`: the checkout's commits not on the branch (ahead or diverged), `there` the reverse. */
export function placed(p: { branch: string; head: string; remote: string; running: string; relation: Relation; failed?: Kept["error"]; here?: Commits; there?: Commits }): Stop | null {
  const here = p.here ?? { count: 0, list: [] }
  const mine = `${plural(here.count, "commit")} not on origin/${p.branch}${here.list.length ? ` (${capped(here.list, here.count)})` : ""}`
  if (p.relation === "same" && p.running === p.head) return { state: "current", why: `up to date with origin/${p.branch}` }
  if (p.relation === "ahead") {
    const blocked: Blocked = { by: "unpushed", commits: here.list }
    return p.running === p.head
      ? { state: "current", why: `the checkout runs ${mine}: updates go on once they're pushed`, blocked }
      : { state: "waiting", why: `the checkout has ${mine}: they run once pushed and CI passed`, blocked }
  }
  const again = p.failed?.commit === p.remote
  if (p.relation === "diverged") {
    const theirs = p.there ? `, origin has ${p.there.count} it hasn't` : ""
    return { state: "failed", why: `the checkout and origin/${p.branch} have diverged, so it can't fast-forward: the checkout has ${mine}${theirs}`,
      next: p.remote, ...(again ? {} : { fail: true as const }), blocked: { by: "diverged", commits: here.list } }
  }
  if (p.failed?.commit === p.remote) return { state: "failed", why: p.failed.message, next: p.remote }
  return null
}

/** A change of state or reason as the log says it, with the commits involved; "" for none (a look like the last). */
let said = ""
function note(s: UpdateStatus, log: NonNullable<UpdaterOptions["log"]>, error?: unknown) {
  const key = `${s.state}|${s.why}|${s.next ?? ""}`
  if (key === said) return
  said = key
  const at = [s.running && `runs ${short(s.running)}`, s.origin && `origin/${s.branch} ${short(s.origin)}`, s.next && s.next !== s.origin && `next ${short(s.next)}`].filter(Boolean).join(", ")
  log(`vaultite: updates: ${s.state}, ${s.why}${at ? ` (${at})` : ""}`, error)
}
const toConsole = (line: string, error?: unknown) => error === undefined ? console.log(line) : console.error(line, ...(error instanceof Error ? [error] : []))

/** One look: fetch, and update when the branch is ahead, CI passed, the tree is clean and nobody's busy. Never throws. */
export async function checkForUpdate(o: UpdaterOptions): Promise<UpdateStatus> {
  const git = gitIn(o.root), log = o.log ?? toConsole
  let kept: Kept = {}, origin: string | undefined
  try { kept = JSON.parse(fs.readFileSync(o.stateFile, "utf8")) } catch { /* none yet */ }
  const keep = () => { try { fs.mkdirSync(path.dirname(o.stateFile), { recursive: true }); fs.writeFileSync(o.stateFile, JSON.stringify({ last: kept.last, error: kept.error })) } catch { /* shown, not kept */ } }
  const set = (state: UpdateState, why: string, more: { next?: string; blocked?: Blocked; error?: unknown } = {}) => {
    status = { branch: o.branch, state, why, checked: Date.now(), ...(o.running ? { running: o.running } : {}), ...(origin ? { origin } : {}),
      ...(more.next ? { next: more.next } : {}), ...(more.blocked ? { blocked: more.blocked } : {}), ...(kept.last ? { last: kept.last } : {}), ...(kept.error ? { error: kept.error } : {}) }
    note(status, log, more.error)
    return status
  }
  const fail = (commit: string, message: string, e?: unknown, blocked?: Blocked) => {
    kept.error = { at: Date.now(), commit, message }
    keep()
    return set("failed", message, { next: commit, blocked, error: e ?? message })
  }
  try {
    const on = await currentBranch(git)
    if (on !== o.branch) return set("waiting", `the checkout is on ${on || "a detached commit"}, not ${o.branch}: it updates once ${o.branch} is checked out again`, { blocked: { by: "branch" } })
    const fetched = await fetchBranch(git, o.branch), { head, remote } = fetched
    origin = remote
    o.running ||= head
    const running = o.running
    const rel = await relation(git, head, remote)
    const here = rel === "ahead" || rel === "diverged" ? await commitsNotIn(git, remote, head) : undefined
    const there = rel === "diverged" ? await commitsNotIn(git, head, remote) : undefined
    const stop = placed({ branch: o.branch, head, remote, running, relation: rel, failed: kept.error, here, there })
    if (stop) return stop.fail ? fail(remote, stop.why, undefined, stop.blocked) : set(stop.state, stop.why, stop)
    const dirty = await dirtyFiles(git)
    if (dirty.length) return set("waiting", `the checkout has uncommitted changes (${capped(dirty)}): it updates once they're committed or undone`, { next: remote, blocked: { by: "uncommitted", files: dirty.slice(0, 20) } })
    const repo = await originRepo(git)
    if (!repo) return set("waiting", "origin isn't on GitHub, so CI can't be checked", { next: remote })
    const ci = o.ci ??= githubCi(o.branch) // (kept: what CI said lasts across looks)
    const target = await pickTarget({ tip: remote, since: () => commitsSince(git, head, remote), ci: (sha) => ci(repo, sha), failed: kept.error?.commit })
    if ("why" in target) return set("waiting", target.why, { next: remote })
    const next = target.to
    const busy = await o.busy()
    if (busy) return set("waiting", `busy: ${busy}`, { next })

    const files = await changedFiles(git, running, next)
    set("updating", `updating to ${short(next)} (${plural(files.length, "file")})`, { next })
    const applied = await o.apply({ head, running, to: next, files })
    if ("failed" in applied) return fail(next, applied.failed, applied.cause ?? applied.failed)
    const { restart } = applied
    kept = { last: { from: running, to: next, at: Date.now(), restarted: restart } }
    keep()
    o.running = next // (a web-only update is live once built)
    set("current", restart ? `updated to ${short(next)}, restarting` : `updated to ${short(next)} (the web app only)`)
    if (restart) o.restart()
    return status
  } catch (e) {
    // (a fetch or GitHub not answering: tried again next time, not an error to keep)
    return set("waiting", `couldn't check: ${errText(e)}`)
  }
}

/** How often a look runs. A look where nothing moved is a git fetch; CI is asked only about a commit to take whose
 *  verdict isn't known yet, at most once a look, and never more than CI_CALLS_PER_HOUR (20) times in any hour. */
export const LOOK_EVERY = 3 * MINUTE

/** Look every few minutes (the first a minute after the start), one look at a time. */
export function startUpdater(o: UpdaterOptions) {
  status = { branch: o.branch, state: "waiting", why: "the first look is a minute after the server starts", checked: null }
  try { Object.assign(status, JSON.parse(fs.readFileSync(o.stateFile, "utf8"))) } catch { /* none yet */ }
  if (!o.running) void gitIn(o.root)("rev-parse", "HEAD").then((head) => { o.running ||= head; status.running ??= o.running }, () => {})
  else status.running = o.running
  const later = (ms: number) => setTimeout(() => void checkForUpdate(o).finally(() => later(LOOK_EVERY)), ms).unref()
  later(MINUTE)
}
