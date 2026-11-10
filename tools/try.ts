// A try run: HEAD through CI's tests on Linux, macOS and Windows (ci.yml on a try/ branch) before it lands. A pass is kept
// for pre-push (--check <from> <to>); a failure main has too isn't the change's. node tools/try.ts [--timeout <min>]
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { CI_WORKFLOW, TRY_PREFIX, githubApi } from "../core/update/ci.ts"
import { gitEnv } from "../core/gitenv.ts"
import { REPO, mainRed, runFailures, sameTest, type Api, type Failure, type Job, type Run } from "./mainci.ts"
import { describe, osRisk, parseDiff, type Risk } from "./osrisk.ts"

const ROOT = path.resolve(import.meta.dirname, "..")

function git(root: string, args: string[], o: { input?: string; timeout?: number } = {}) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", env: gitEnv(), input: o.input, timeout: o.timeout ?? 60_000, maxBuffer: 256 * 1024 * 1024 })
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() || (r.error ? r.error.message : "") }
}

/** A change's OS-sensitive part, `from` to `to`: why it is, and git's patch id of its diff in those files (the same after
 *  a rebase that leaves them alone, line numbers aside); no key when nothing in it is. */
export function riskKey(root: string, from: string, to: string): { risks: Risk[]; key: string | null } {
  const risks = osRisk(parseDiff(git(root, ["diff", "-U0", "--no-color", from, to]).out))
  if (!risks.length) return { risks, key: null }
  const patch = git(root, ["diff", "--no-color", "--full-index", from, to, "--", ...new Set(risks.map((r) => r.file))]).out
  return { risks, key: git(root, ["patch-id", "--stable"], { input: `${patch}\n` }).out.split(" ")[0] || null }
}

/** Where a checkout keeps its passed try runs (shared by its worktrees). */
function triedDir(root: string) {
  return path.join(path.resolve(root, git(root, ["rev-parse", "--git-common-dir"]).out), "vaultite", "tried")
}
export const tried = (root: string, key: string) => fs.existsSync(path.join(triedDir(root), `${key}.json`))
function keep(root: string, key: string, what: object) {
  fs.mkdirSync(triedDir(root), { recursive: true })
  fs.writeFileSync(path.join(triedDir(root), `${key}.json`), JSON.stringify(what))
}

/** pre-push's question: a push of `from`..`to` to main is fine when nothing in it is OS-sensitive or that part passed a
 *  try run; else why not. (One not on top of `from` is refused by the remote anyway: rebase first.) */
export function checkPush(root: string, from: string, to: string): string | null {
  if (/^0+$/.test(from) || !git(root, ["merge-base", "--is-ancestor", from, to]).ok) return null
  const { risks, key } = riskKey(root, from, to)
  if (!key || tried(root, key)) return null
  return [`pre-push: this push is OS-sensitive and hasn't passed a try run: ${describe(risks)}.`,
    "  Try it on GitHub's Linux, macOS and Windows runners first (about 6 min): npm run verify -- --try, or node tools/try.ts",
    "  Pushing anyway (GitHub's runners down): VAULTITE_TRY=skip git push ..."].join("\n")
}

/** A try run's jobs, judged: a job is the change's failure unless all it failed on also fails on main now. */
export function judge(jobs: Job[], failures: Failure[], mains: Failure[]) {
  const onMain = (f: Failure) => mains.some((m) => m.job === f.job && sameTest(m.test, f.test))
  const rows = jobs.filter((j) => j.conclusion !== "skipped").map((j) => {
    const own = failures.filter((f) => f.job === j.name)
    const state = j.conclusion === "success" ? "ok" : j.conclusion === "failure" && own.length && own.every(onMain) ? "main's" : "FAIL"
    return { job: j.name, state, tests: own.map((f) => `${f.test}${onMain(f) ? " (main's too)" : ""}`), conclusion: j.conclusion }
  })
  return { rows, ok: rows.length > 0 && rows.every((r) => r.state !== "FAIL") }
}

const minutes = (j: { started_at?: string; completed_at?: string }) =>
  j.started_at && j.completed_at ? `${((Date.parse(j.completed_at) - Date.parse(j.started_at)) / 60000).toFixed(1)} min` : ""
/** Minutes a try waits at most: a run (about 6) and a failure's second attempt. */
const TIMEOUT = 20
type Jobs = (Job & { status?: string; started_at?: string; completed_at?: string })[]
type Verdict = ReturnType<typeof judge>
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Tries HEAD: pushes it to a try/ branch, waits for ci.yml's run there (at most `timeoutMin`, then cancels it), says each
 *  job's result, deletes the branch, keeps a pass. */
export async function tryHead(root: string, o: { timeoutMin?: number; log?: (s: string) => void; api?: Api; gh?: (args: string[]) => boolean; pause?: (ms: number) => Promise<unknown> } = {}): Promise<boolean> {
  const log = o.log ?? console.log, api = o.api ?? (<T>(p: string) => githubApi<T>(p)), pause = o.pause ?? sleep
  /** gh, for what needs a sign-in (a run cancelled or run again): whether it did it. */
  const ghDid = o.gh ?? ((args: string[]) => spawnSync("gh", args, { encoding: "utf8", timeout: 30_000 }).status === 0)
  const fail = (why: string) => { log(`try: FAIL ${why}`); return false }
  const dirty = git(root, ["status", "--porcelain"]).out
  if (dirty) return fail(`HEAD is what's tried: commit first (uncommitted: ${dirty.split("\n").length} files)`)
  const fetched = git(root, ["fetch", "-q", "origin", "main"], { timeout: 120_000 })
  if (!fetched.ok) return fail(`can't fetch origin's main: ${fetched.err}`)
  const sha = git(root, ["rev-parse", "HEAD"]).out, base = git(root, ["merge-base", "FETCH_HEAD", "HEAD"]).out
  if (sha === base) return fail("HEAD is on main already: nothing to try")
  const ref = `${TRY_PREFIX}${sha.slice(0, 12)}`, t0 = Date.now(), deadline = t0 + (o.timeoutMin ?? TIMEOUT) * 60_000
  const pushed = git(root, ["push", "-q", "--no-verify", "origin", `+HEAD:refs/heads/${ref}`], { timeout: 120_000 })
  if (!pushed.ok) return fail(`can't push ${ref}: ${pushed.err}`)
  const drop = () => git(root, ["push", "-q", "--no-verify", "origin", "--delete", ref], { timeout: 60_000 })
  const stop = () => { drop(); process.exit(130) }
  process.once("SIGINT", stop).once("SIGTERM", stop)
  let run: Run | undefined
  try {
    // (gh signed in has 5000 calls an hour; anonymous 60, shared by the machine: asked less often)
    const gh = ghDid(["auth", "token"]), every = gh ? 15_000 : 60_000
    for (let waited = 0; !run; waited += 5000) {
      if (waited > 180_000) return fail(`no CI run started on ${ref} in 3 min (ci.yml runs the try/ pushes of commits that have it)`)
      await pause(5000)
      const got = await api<{ workflow_runs?: Run[] }>(`repos/${REPO}/actions/workflows/${path.basename(CI_WORKFLOW)}/runs?branch=${encodeURIComponent(ref)}&head_sha=${sha}&per_page=5`)
      run = typeof got === "string" ? undefined : got.workflow_runs?.[0]
    }
    log(`try: ${sha.slice(0, 9)} on ${ref}: ${run.html_url ?? ""}`)
    const id = run.id, said = new Set<number>()
    /** The run's jobs (its latest attempt's) once all have ended, each said as it does; null past the deadline. */
    const ended = async (): Promise<Jobs | null> => {
      for (;;) {
        const got = await api<{ jobs?: Jobs }>(`repos/${REPO}/actions/runs/${id}/jobs?per_page=50`)
        const jobs = typeof got === "string" ? [] : got.jobs ?? []
        for (const j of jobs) if (j.status === "completed" && j.conclusion !== "skipped" && !said.has(j.id)) { said.add(j.id); log(`  ${j.conclusion === "success" ? "ok  " : "FAIL"}  ${j.name}  ${minutes(j)}`) }
        if (jobs.length && jobs.every((j) => j.status === "completed")) return jobs
        if (Date.now() > deadline) return null
        await pause(every)
      }
    }
    const verdict = async (jobs: Jobs) => {
      const got = await runFailures(api, id), failures = typeof got === "string" ? [] : got
      const reds = failures.length ? await mainRed(api) : []
      return judge(jobs, failures, typeof reds === "string" ? [] : reds.filter((r) => r.workflow === "CI").flatMap((r) => r.failures))
    }
    const timedOut = (jobs: string[]) => {
      ghDid(["api", "-X", "POST", `repos/${REPO}/actions/runs/${id}/cancel`])
      return fail(`timed out after ${o.timeoutMin ?? TIMEOUT} min, cancelled: ${jobs.join(", ") || "its jobs"} still running`)
    }
    const tell = (rows: Verdict["rows"]) => { for (const r of rows.filter((r) => r.state !== "ok")) log(`  ${r.job} ${r.state === "FAIL" ? "failed" : "failed as main does"}${r.tests.length ? `:\n        ${r.tests.slice(0, 8).join("\n        ")}` : ` (${r.conclusion})`}`) }
    let jobs = await ended()
    if (!jobs) return timedOut([])
    let v = await verdict(jobs), flaky: string[] = []
    // (a flaky test passes the second time, a broken one doesn't: a failure runs again once, where gh may ask for it)
    const first = v.rows.filter((r) => r.state === "FAIL")
    if (first.length && gh && ghDid(["api", "-X", "POST", `repos/${REPO}/actions/runs/${id}/rerun-failed-jobs`])) {
      tell(first)
      log(`try: running ${first.map((r) => r.job).join(", ")} again, once`)
      for (let n = 0; n < 12; n++) {
        await pause(5000)
        const r = await api<{ run_attempt?: number }>(`repos/${REPO}/actions/runs/${id}`)
        if (typeof r !== "string" && (r.run_attempt ?? 1) > 1) break
      }
      jobs = await ended()
      if (!jobs) return timedOut(first.map((r) => r.job))
      v = await verdict(jobs)
      flaky = first.filter((r) => v.rows.find((x) => x.job === r.job)?.state === "ok").flatMap((r) => r.tests.map((t) => `${r.job}: ${t}`))
    }
    tell(v.rows)
    const took = `${((Date.now() - t0) / 60000).toFixed(1)} min`
    if (flaky.length) log(`try: flaky, failed once then passed (worth a fix of its own):\n        ${flaky.join("\n        ")}`)
    if (!v.ok) return fail(`on ${v.rows.filter((r) => r.state === "FAIL").map((r) => r.job).join(", ")} (${took})`)
    const { key } = riskKey(root, base, sha)
    if (key) keep(root, key, { sha, run: run.html_url, at: new Date().toISOString() })
    log(`try: ok on ${v.rows.map((r) => r.job).join(", ")}${v.rows.some((r) => r.state === "main's") ? " (failing only as main does)" : ""} in ${took}`)
    return true
  } finally {
    const gone = drop()
    if (!gone.ok) log(`try: couldn't delete ${ref}: ${gone.err} (git push origin --delete ${ref})`)
    process.off("SIGINT", stop).off("SIGTERM", stop)
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2)
  if (argv[0] === "--check") {
    const why = checkPush(process.cwd(), argv[1] ?? "", argv[2] ?? "HEAD")
    if (why) console.error(why)
    process.exit(why ? 1 : 0)
  }
  const t = argv.indexOf("--timeout")
  process.exit(await tryHead(ROOT, { timeoutMin: t >= 0 ? Number(argv[t + 1]) : undefined }) ? 0 : 1)
}
