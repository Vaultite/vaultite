// What this server runs: the commit it started on, or the web build's when that changes nothing of the server's (a
// web-only update, core/selfupdate.ts), and whether a commit is in it. vau version, Machines and About read it.
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { gitEnv } from "./gitenv.ts"
import { backendChanged } from "./selfupdate.ts"
import { served, type WebBuild } from "./webbuild.ts"

const exec = promisify(execFile)

export type Running = {
  /** The commit it runs (null: unknown, not a checkout nor a packaged app), its subject and when it was made (ms). */
  commit: string | null
  subject?: string
  at?: number
  branch: string | null
  /** The commit the server started on (its own code's). */
  startedOn: string | null
  /** The web app's build served: its entry script and its commit (null: not stamped, or none built). */
  web: { entry: string | null; commit: string | null }
}

/** `root`'s: a checkout, or a packaged app's (its electron/build.json); `web`, the build it serves. */
export function runningIn(root: string, web: () => WebBuild) {
  /** git's output, or null when it failed (not a checkout, an unknown commit). */
  const git = (...args: string[]) => exec("git", ["-C", root, ...args], { timeout: 5000, env: gitEnv() }).then((r) => r.stdout.trim(), () => null)
  const start = (async () => {
    const commit = await git("rev-parse", "HEAD")
    if (commit) {
      const [at, ...subject] = (await git("log", "-1", "--format=%ct%n%s", commit) ?? "").split("\n")
      return { commit, branch: await git("symbolic-ref", "--short", "-q", "HEAD") || null, at: Number(at) * 1000 || undefined, subject: subject.join(" ") || undefined }
    }
    try { return { commit: String(JSON.parse(fs.readFileSync(path.join(root, "electron", "build.json"), "utf8")).commit ?? "") || null, branch: null } }
    catch { return { commit: null, branch: null } }
  })()
  const same = new Map<string, Promise<boolean>>()
  /** Only the web app's files differ between the two (false when git can't say). */
  const sameServer = (a: string, b: string) => {
    let p = same.get(`${a}..${b}`)
    if (!p) same.set(`${a}..${b}`, p = git("diff", "--name-only", a, b).then((out) => out !== null && !backendChanged(out.split("\n").filter(Boolean))))
    return p
  }

  async function running(): Promise<Running> {
    const s = await start, b = web(), w = b.stamp
    const base: Running = { commit: s.commit, ...(s.subject ? { subject: s.subject } : {}), ...(s.at ? { at: s.at } : {}), branch: s.branch,
      startedOn: s.commit, web: { entry: b.entry, commit: w?.commit ?? null } }
    if (w && s.commit && w.commit !== s.commit && await sameServer(s.commit, w.commit)) return { ...base, commit: w.commit, subject: w.subject, at: w.at }
    return base
  }

  /** A commit as given (a short hash, a branch) in full, or null when this checkout doesn't have it (yet). */
  const resolve = async (given: string) => /^[\w./-]+$/.test(given) && !given.startsWith("-") ? git("rev-parse", "--verify", "--quiet", `${given}^{commit}`) : null
  /** Whether `commit` is `of` or comes before it (null: git can't say: not a checkout). */
  const contains = async (of: string, commit: string) => {
    if (/^[0-9a-f]{7,}$/.test(commit) && of.startsWith(commit)) return true
    if (!(await git("rev-parse", "--git-dir"))) return null
    return exec("git", ["-C", root, "merge-base", "--is-ancestor", commit, of], { timeout: 5000, env: gitEnv() }).then(() => true, () => false)
  }
  /** Whether `commit` is on `ref` (origin/main): null when either isn't known here. */
  const onRef = async (commit: string, ref: string) => (await git("rev-parse", "--verify", "--quiet", ref)) ? contains(ref, commit) : null
  return { running, resolve, contains, onRef }
}

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const here = runningIn(ROOT, served.read)
/** What this server runs now. */
export const running = here.running
export const { resolve: resolveCommit, contains, onRef } = here
