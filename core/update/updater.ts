import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import type { Ci } from "./ci.ts"
import { githubCi } from "./ci.ts"
import { type Blocked, type Judged, type UpdateState, UpdateStatus } from "../contracts/version.ts"
import { readJson } from "../jsonfile.ts"
import type { Relation } from "./git.ts"
import { logger } from "../log.ts"
import { capped, changedFiles, commitsNotIn, commitsSince, currentBranch, dirtyFiles, fetchBranch, gitIn, originRepo, pickTarget, relation, short } from "./git.ts"
import { isObj } from "../values.ts"

const Kept = z.object({ last: UpdateStatus.shape.last.catch(undefined), error: UpdateStatus.shape.error.catch(undefined) })
type Kept = z.infer<typeof Kept>
const keptIn = (file: string): Kept => { const r = readJson(file, Kept); return r.ok ? r.value : {} }

/** The checkout's `head` may be past `running`. */
export type Update = { head: string; running: string; to: string; files: string[] }
/** `failed`: having gone back to what runs. */
export type Applied = { restart: boolean; said?: string } | { failed: string; cause?: unknown }

export type UpdaterOptions = {
  /** The git it follows: a checkout on the branch, or (`bare`) a bare clone, a root store's (core/update/store.ts). */
  root: string
  /** No branch checked out, no tree to keep clean: what runs (`running`, which the host sets) is the head. */
  bare?: boolean
  branch: string
  /** The commit this server started on (what runs): a checkout moved past it, merged or pulled here, is run too. */
  running?: string
  stateFile: string
  /** Why the server shouldn't restart now (an agent at work in the browser), or null: it holds only an update that restarts. */
  busy: () => Promise<string | null>
  restart: () => void
  /** How often a built update that restarts asks again whether the browser is quiet (ms). */
  quietEvery?: number
  /** Whether taking these changed files restarts the server (the host's rule; default: it does, not being known). */
  restarts?: (files: string[]) => boolean
  /** Whether CI passed on a commit (default: GitHub Actions, core/update/ci.ts); ok null is not yet. */
  ci?: Ci
  /** Never leaves the checkout half-updated. */
  apply: (u: Update) => Promise<Applied>
  /** Where a change of state goes (default: the server's log; a new failure as an error). */
  log?: (line: string, error?: unknown) => void
}

const MINUTE = 60_000
export const errText = (e: unknown) => String((isObj(e) && (e.stderr || e.message)) || e).trim().split("\n").slice(-3).join(" ").slice(0, 500)

let status: UpdateStatus = { branch: null, state: "off", why: "not a service install following a branch (vau service install --updates <branch>)", checked: null }
let looking: Promise<UpdateStatus> | null = null
export const updateStatus = (): UpdateStatus => ({ ...status, looking: !!looking })

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`
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

let said = ""
function note(s: UpdateStatus, log: NonNullable<UpdaterOptions["log"]>, error?: unknown) {
  const key = `${s.state}|${s.why}|${s.next ?? ""}`
  if (key === said) return
  said = key
  const at = [s.running && `runs ${short(s.running)}`, s.origin && `origin/${s.branch} ${short(s.origin)}`, s.next && s.next !== s.origin && `next ${short(s.next)}`].filter(Boolean).join(", ")
  log(`vaultite: updates: ${s.state}, ${s.why}${at ? ` (${at})` : ""}`, error)
}
export function toLog(line: string, error?: unknown) {
  const area = /^([^:\s]+): /.exec(line), log = logger(area?.[1] ?? "updates"), message = area ? line.slice(area[0].length) : line
  if (error === undefined) log.info(message)
  else log.error(message, error instanceof Error ? error : undefined)
}

/** Never throws. */
export function checkForUpdate(o: UpdaterOptions): Promise<UpdateStatus> {
  return looking ??= lookOnce(o).finally(() => { looking = null }).then(updateStatus)
}

async function lookOnce(o: UpdaterOptions): Promise<UpdateStatus> {
  const git = gitIn(o.root), log = o.log ?? toLog
  let kept = keptIn(o.stateFile)
  let origin: string | undefined
  const keep = () => { try { fs.mkdirSync(path.dirname(o.stateFile), { recursive: true }); fs.writeFileSync(o.stateFile, JSON.stringify({ last: kept.last, error: kept.error })) } catch { /* shown, not kept */ } }
  const set = (state: UpdateState, why: string, more: { next?: string; blocked?: Blocked; ci?: Judged[]; error?: unknown } = {}) => {
    status = { branch: o.branch, state, why, checked: Date.now(), ...(o.running ? { running: o.running } : {}), ...(origin ? { origin } : {}),
      ...(more.next ? { next: more.next } : {}), ...(more.blocked ? { blocked: more.blocked } : {}), ...(more.ci ? { ci: more.ci } : {}), ...(kept.last ? { last: kept.last } : {}), ...(kept.error ? { error: kept.error } : {}) }
    note(status, log, more.error)
    return status
  }
  const fail = (commit: string, message: string, e?: unknown, blocked?: Blocked) => {
    kept.error = { at: Date.now(), commit, message }
    keep()
    return set("failed", message, { next: commit, blocked, error: e ?? message })
  }
  try {
    const on = o.bare ? o.branch : await currentBranch(git)
    if (on !== o.branch) return set("waiting", `the checkout is on ${on || "a detached commit"}, not ${o.branch}: it updates once ${o.branch} is checked out again`, { blocked: { by: "branch" } })
    const fetched = await fetchBranch(git, o.branch), { remote } = fetched, head = o.bare ? o.running || remote : fetched.head
    origin = remote
    o.running ||= head
    const running = o.running
    const rel = await relation(git, head, remote)
    const here = rel === "ahead" || rel === "diverged" ? await commitsNotIn(git, remote, head) : undefined
    const there = rel === "diverged" ? await commitsNotIn(git, head, remote) : undefined
    const stop = placed({ branch: o.branch, head, remote, running, relation: rel, failed: kept.error, here, there })
    if (stop) return stop.fail ? fail(remote, stop.why, undefined, stop.blocked) : set(stop.state, stop.why, stop)
    const dirty = o.bare ? [] : await dirtyFiles(git)
    if (dirty.length) return set("waiting", `the checkout has uncommitted changes (${capped(dirty)}): it updates once they're committed or undone`, { next: remote, blocked: { by: "uncommitted", files: dirty.slice(0, 20) } })
    const repo = await originRepo(git) ?? ""
    if (!repo && !o.ci) return set("waiting", "origin isn't on GitHub, so CI can't be checked", { next: remote })
    const ci = o.ci ??= githubCi(o.branch) // (kept: what CI said lasts across looks)
    const target = await pickTarget({ tip: remote, since: () => commitsSince(git, head, remote), ci: (sha, q) => ci(repo, sha, q), failed: kept.error?.commit })
    if ("why" in target) return set("waiting", target.why, { next: remote, ci: target.judged })
    const next = target.to
    // (busy holds only a restart: an update of the web app alone goes through while agents browse)
    const files = await changedFiles(git, running, next), restarts = o.restarts?.(files) ?? true
    const busy = await o.busy()
    if (busy && restarts) return set("waiting", `busy: ${busy}; the update restarts the server`, { next })
    set("updating", `updating to ${short(next)} (${plural(files.length, "file")})`, { next })
    const applied = await o.apply({ head, running, to: next, files })
    if ("failed" in applied) return fail(next, applied.failed, applied.cause ?? applied.failed)
    const { restart } = applied
    // (an agent may have begun while it built: the restart waits till the browser is quiet again, the build kept)
    for (let b = restart ? await o.busy() : null; b; b = await o.busy()) {
      set("updating", `${short(next)} is built; the server restarts once the browser is quiet (${b})`, { next })
      await new Promise((r) => setTimeout(r, o.quietEvery ?? 2000))
    }
    const elsewhere = target.ci.elsewhere ?? []
    kept = { last: { from: running, to: next, at: Date.now(), restarted: restart, ...(elsewhere.length ? { elsewhere } : {}) } }
    keep()
    o.running = next // (a web-only update is live once built)
    const red = elsewhere.length ? `; CI is red on it elsewhere: ${elsewhere.join(", ")}` : ""
    set("current", `${applied.said ? `updated to ${short(next)}: ${applied.said}` : restart ? `updated to ${short(next)}, restarting` : `updated to ${short(next)} (the web app only${busy ? `, while busy: ${busy}` : ""})`}${red}`)
    if (restart) o.restart()
    return status
  } catch (e) {
    // (a fetch or GitHub not answering: tried again next time, not an error to keep)
    return set("waiting", `couldn't check: ${errText(e)}`)
  }
}

/** GitHub's rate limit allows it: CI is asked only about a commit whose verdict isn't known yet (one call a look), never
 *  more than ciCallsPerHour() in any hour (20 anonymously, 300 through a signed-in gh). */
export const LOOK_EVERY = 3 * MINUTE

let following: UpdaterOptions | null = null
export const checkNow = () => following ? checkForUpdate(following) : Promise.resolve(updateStatus())

export function startUpdater(o: UpdaterOptions) {
  following = o
  status = { branch: o.branch, state: "waiting", why: "the first look is a minute after the server starts", checked: null }
  const { last, error } = keptIn(o.stateFile)
  Object.assign(status, last ? { last } : {}, error ? { error } : {})
  if (!o.running && !o.bare) void gitIn(o.root)("rev-parse", "HEAD").then((head) => { o.running ||= head; status.running ??= o.running }, () => {})
  else status.running = o.running
  const later = (ms: number) => setTimeout(() => void checkForUpdate(o).finally(() => later(LOOK_EVERY)), ms).unref()
  later(MINUTE)
}
