import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { gitEnv } from "../gitenv.ts"
import type { Judged } from "../contracts/version.ts"
import type { CiResult } from "./ci.ts"
import { githubRepo } from "./ci.ts"

const exec = promisify(execFile)

/** Throws when git fails. */
export type Git = (...args: string[]) => Promise<string>
export const gitIn = (root: string): Git => async (...args) =>
  (await exec("git", args, { cwd: root, timeout: 120_000, maxBuffer: 16 << 20, env: gitEnv() })).stdout.trim()

export const short = (sha: string) => sha.slice(0, 7)

/** The branch checked out, "" when detached. */
export const currentBranch = (git: Git) => git("symbolic-ref", "--short", "-q", "HEAD").catch(() => "")

export async function fetchBranch(git: Git, branch: string) {
  await git("fetch", "--quiet", "--no-tags", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`)
  return { head: await git("rev-parse", "HEAD"), remote: await git("rev-parse", `refs/remotes/origin/${branch}`) }
}

export const isAncestor = (git: Git, a: string, b: string) => git("merge-base", "--is-ancestor", a, b).then(() => true, () => false)

export type Relation = "same" | "behind" | "ahead" | "diverged"
export async function relation(git: Git, head: string, remote: string): Promise<Relation> {
  if (head === remote) return "same"
  if (await isAncestor(git, head, remote)) return "behind"
  return await isAncestor(git, remote, head) ? "ahead" : "diverged"
}

export const dirtyFiles = async (git: Git) => (await git("diff", "--name-only", "HEAD")).split("\n").filter(Boolean)

/** "abc1234 subject", newest first, at most `max`. */
export async function commitsNotIn(git: Git, from: string, to: string, max = 5) {
  const count = Number(await git("rev-list", "--count", `${from}..${to}`))
  const list = count ? (await git("log", "--format=%h %s", `--max-count=${max}`, `${from}..${to}`)).split("\n").filter(Boolean).map((l) => l.length > 72 ? `${l.slice(0, 71)}…` : l) : []
  return { count, list }
}

/** Some of a list, in words: "a, b and 3 more". */
export function capped(items: string[], total = items.length, max = 5) {
  const shown = items.slice(0, max), more = total - shown.length
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown.join("")
}

export const originRepo = async (git: Git) => githubRepo(await git("config", "--get", "remote.origin.url"))

export const changedFiles = async (git: Git, from: string, to: string) => (await git("diff", "--name-only", from, to)).split("\n").filter(Boolean)

export const commitsSince = async (git: Git, head: string, tip: string) =>
  (await git("rev-list", "--first-parent", "--max-count=40", `${head}..${tip}`)).split("\n").filter(Boolean)

/** The tip once CI passed it, else the newest after the checkout's that did, never `failed` nor older. Else why it
 *  waits, and what CI said of each commit asked, the tip first. */
export async function pickTarget(o: { tip: string; since: () => Promise<string[]>; ci: (sha: string, o?: { superseded?: boolean }) => Promise<CiResult>; failed?: string }): Promise<{ to: string; ci: CiResult } | { why: string; judged: Judged[] }> {
  const tip = await o.ci(o.tip)
  if (tip.ok === true) return { to: o.tip, ci: tip }
  const judged: Judged[] = [{ commit: o.tip, ok: tip.ok, ...(tip.state ? { state: tip.state } : {}) }]
  for (const c of (await o.since()).slice(1)) {
    if (c === o.failed) break
    const r = await o.ci(c, { superseded: true })
    if (r.ok === true) return { to: c, ci: r }
    judged.push({ commit: c, ok: r.ok, ...(r.state ? { state: r.state } : {}) })
  }
  return { why: `${tip.why} (${short(o.tip)})`, judged }
}

/** CI failed on every commit that could bring `commit`: the branch's tip (`judged[0]`) failed, and none from `commit` up
 *  to it passed or still runs (a red is final as the updates take it: asked again only after 10 minutes). The tip, or null. */
export function redRoute(judged: Judged[], commit: string): string | null {
  const i = judged.findIndex((j) => j.commit === commit)
  if (i < 0 || judged[0].state !== "failed") return null
  return judged.slice(1, i + 1).every((j) => j.state === "failed" || j.state === "none" || j.state === "cancelled") ? judged[0].commit : null
}
