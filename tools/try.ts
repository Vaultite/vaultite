// A try: HEAD through CI's tests on Linux, macOS and Windows (ci.yml on a try/ branch) before it lands, started and waited
// for apart (it lives on GitHub). A pass is kept for pre-push (--check); a failure main has too isn't the change's.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { CI_WORKFLOW, TRY_PREFIX, githubApi } from "../core/update/ci.ts"
import { gitEnv } from "../core/gitenv.ts"
import { REPO, mainRed, runFailures, sameTest, type Api, type Failure, type Job, type Run } from "./mainci.ts"
import { alsoTry, describe, osRisk, parseDiff, type Risk } from "./osrisk.ts"

const ROOT = path.resolve(import.meta.dirname, "..")
/** The bounds, once: a try's jobs stop after JOB_MIN (surfaces SURFACES_JOB_MIN: ci.yml, windows.yml); an attempt not done
 *  ATTEMPT_MIN after it began is cancelled by the next try command; a wait ends in WAIT_SECONDS (under 10 min). */
export const JOB_MIN = 15, SURFACES_JOB_MIN = 20, ATTEMPT_MIN = 25, WAIT_SECONDS = 510
export const USAGE = `node tools/try.ts [--surfaces]   start a try of HEAD (committed), at once
node tools/try.ts --wait [seconds]  wait for HEAD's try, at most ${WAIT_SECONDS} s: exit 0 passed, 1 failed, 3 still running (run it again), 2 none`

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

/** Where a checkout keeps its tries and passes (shared by its worktrees). */
const stateDir = (root: string, kind: "tried" | "tries") => path.join(path.resolve(root, git(root, ["rev-parse", "--git-common-dir"]).out), "vaultite", kind)
export const tried = (root: string, key: string) => fs.existsSync(path.join(stateDir(root, "tried"), `${key}.json`))
function write(file: string, what: object) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.${process.pid}`, JSON.stringify(what))
  fs.renameSync(`${file}.${process.pid}`, file) // (whole: two waits may write it)
}

/** A try as the checkout keeps it, by its commit: what it runs, its runs once found, its one rerun, its verdict once known. */
export type Try = {
  sha: string; base: string; ref: string; key: string | null; also: string[]; wants: string[]; started: number; attemptAt: number
  runs?: { id: number; path?: string; html_url?: string }[]; rerun?: { job: string; tests: string[] }[]
  verdict?: { state: "passed" | "failed" | "timed out"; lines: string[]; line: string; at: number }
}
const tryFile = (root: string, sha: string) => path.join(stateDir(root, "tries"), `${sha}.json`)
export function loadTry(root: string, sha: string): Try | null {
  try { return JSON.parse(fs.readFileSync(tryFile(root, sha), "utf8")) as Try } catch { return null }
}
const saveTry = (root: string, t: Try) => write(tryFile(root, t.sha), t)
const allTries = (root: string) => { try { return fs.readdirSync(stateDir(root, "tries")).filter((f) => /^[0-9a-f]+\.json$/.test(f)).map((f) => loadTry(root, f.slice(0, -5))).filter((t): t is Try => !!t) } catch { return [] } }

/** pre-push's question: a push of `from`..`to` to main is fine when nothing in it is OS-sensitive or that part passed a
 *  try run; else why not. (One not on top of `from` is refused by the remote anyway: rebase first.) */
export function checkPush(root: string, from: string, to: string): string | null {
  if (/^0+$/.test(from) || !git(root, ["merge-base", "--is-ancestor", from, to]).ok) return null
  const { risks, key } = riskKey(root, from, to)
  if (!key || tried(root, key)) return null
  const mine = allTries(root).filter((t) => t.key === key).sort((a, b) => b.started - a.started)[0]
  return [`pre-push: this push is OS-sensitive and hasn't passed a try run: ${describe(risks)}.`,
    mine?.verdict ? `  Its try ${mine.verdict.line.replace(/^try: /, "")}` : mine ? "  Its try is running: node tools/try.ts --wait (a pass is kept for this push)"
      : "  Try it on GitHub's Linux, macOS and Windows runners first: node tools/try.ts, then node tools/try.ts --wait (or npm run verify -- --try)",
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
type Verdict = ReturnType<typeof judge>
type Jobs = (Job & { status?: string; started_at?: string; completed_at?: string; run_attempt?: number; run?: number })[]

const minutes = (j: { started_at?: string; completed_at?: string }) =>
  j.started_at && j.completed_at ? `${((Date.parse(j.completed_at) - Date.parse(j.started_at)) / 60000).toFixed(1)} min` : ""
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const WINDOWS_WORKFLOW = ".github/workflows/windows.yml"

/** What a try's commands may be given instead of GitHub, gh, the clock and a pause (tests). */
export type Deps = { log?: (s: string) => void; api?: Api; gh?: (args: string[]) => boolean; now?: () => number; pause?: (ms: number) => Promise<unknown> }
function deps(o: Deps) {
  return { log: o.log ?? console.log, api: o.api ?? (<T>(p: string) => githubApi<T>(p)), now: o.now ?? Date.now, pause: o.pause ?? sleep,
    gh: o.gh ?? ((args: string[]) => spawnSync("gh", args, { encoding: "utf8", timeout: 30_000 }).status === 0) }
}
/** What makes a try fail at once anyway, run here first (seconds): the types and `npm run check`. */
function precheck(root: string): string | null {
  for (const [what, cmd, args] of [["tsc", process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-b"]], ["npm run check", process.execPath, [path.join(root, "tools/check_plugins.ts")]]] as const) {
    const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", timeout: 300_000 })
    if (r.status !== 0) return `${what} fails here, and would in every job: ${`${r.stdout}${r.stderr}`.trim().split("\n").slice(-6).join("\n  ")}`
  }
  return null
}

/** Ends a try: its branch deleted, a pass kept for pre-push, the verdict kept (a later wait says it again) and said. */
function finish(root: string, t: Try, d: ReturnType<typeof deps>, state: NonNullable<Try["verdict"]>["state"], lines: string[], line: string): Waited {
  const gone = git(root, ["push", "-q", "--no-verify", "origin", "--delete", t.ref], { timeout: 60_000 })
  if (!gone.ok && !/remote ref does not exist/.test(gone.err)) lines.push(`couldn't delete ${t.ref}: ${gone.err} (git push origin --delete ${t.ref})`)
  if (state === "passed" && t.key) write(path.join(stateDir(root, "tried"), `${t.key}.json`), { sha: t.sha, runs: t.runs?.map((r) => r.html_url), at: d.now() })
  t.verdict = { state, lines, line, at: d.now() }
  saveTry(root, t)
  for (const l of lines) d.log(`  ${l}`)
  d.log(line)
  return { status: state === "passed" ? "passed" : "failed", line }
}

/** Ends the tries nobody came back to (an attempt past its time: cancelled, its branch deleted), forgets week-old ones. */
export function sweep(root: string, o: Deps = {}) {
  const d = deps({ ...o, log: o.log ?? (() => {}) })
  for (const t of allTries(root)) {
    if (t.verdict) { if (d.now() - t.verdict.at > 7 * 86_400_000) fs.rmSync(tryFile(root, t.sha), { force: true }); continue }
    if (d.now() - t.attemptAt < ATTEMPT_MIN * 60_000) continue
    for (const r of t.runs ?? []) d.gh(["api", "-X", "POST", `repos/${REPO}/actions/runs/${r.id}/cancel`])
    finish(root, t, d, "timed out", [], `try: TIMED OUT ${t.sha.slice(0, 9)}: not done ${ATTEMPT_MIN} min after it ${t.rerun ? "ran again" : "started"} (cancelled)`)
  }
}

/** Starts a try of HEAD and returns: the cheap checks first, then HEAD pushed to a try/ branch (`-surfaces`: windows.yml's
 *  surfaces too) and kept as this checkout's try. Already running or passed: says so. */
export function startTry(root: string, o: Deps & { also?: string[]; precheck?: () => string | null } = {}): boolean {
  const d = deps(o)
  const no = (why: string) => { d.log(`try: NOT STARTED: ${why}`); return false }
  sweep(root, o)
  const dirty = git(root, ["status", "--porcelain"]).out
  if (dirty) return no(`HEAD is what's tried: commit first (uncommitted: ${dirty.split("\n").length} files)`)
  const fetched = git(root, ["fetch", "-q", "origin", "main"], { timeout: 120_000 })
  if (!fetched.ok) return no(`can't fetch origin's main: ${fetched.err}`)
  const sha = git(root, ["rev-parse", "HEAD"]).out, base = git(root, ["merge-base", "FETCH_HEAD", "HEAD"]).out
  if (sha === base) return no("HEAD is on main already: nothing to try")
  const was = loadTry(root, sha)
  if (was && !was.verdict) { d.log(`try: STARTED already (${sha.slice(0, 9)} on ${was.ref}): node tools/try.ts --wait`); return true }
  if (was?.verdict?.state === "passed") { d.log(was.verdict.line); return true }
  const bad = (o.precheck ?? (() => precheck(root)))()
  if (bad) return no(bad)
  const { key, risks } = riskKey(root, base, sha)
  const also = [...new Set([...o.also ?? [], ...alsoTry(risks)])].sort()
  const t: Try = { sha, base, key, also, ref: `${TRY_PREFIX}${sha.slice(0, 12)}${also.map((j) => `-${j}`).join("")}`,
    wants: [CI_WORKFLOW, ...also.includes("surfaces") ? [WINDOWS_WORKFLOW] : []], started: d.now(), attemptAt: d.now() }
  const pushed = git(root, ["push", "-q", "--no-verify", "origin", `+HEAD:refs/heads/${t.ref}`], { timeout: 120_000 })
  if (!pushed.ok) return no(`can't push ${t.ref}: ${pushed.err}`)
  saveTry(root, t)
  d.log(`try: STARTED ${sha.slice(0, 9)} on ${t.ref}${also.length ? ` (${also.join(", ")} too: it changes what that exercises)` : ""}: about ${also.length ? 11 : 6} min. Wait: node tools/try.ts --wait`)
  return true
}

export type Waited = { status: "passed" | "failed" | "running" | "none"; line: string }

/** Waits for HEAD's try at most `seconds`: each job said as it ends, a failure run again once (a flaky test passes then, a
 *  broken one doesn't), the verdict at its end; else how far it got. Stopping a wait stops nothing on GitHub. */
export async function waitTry(root: string, o: Deps & { seconds?: number } = {}): Promise<Waited> {
  const d = deps(o), until = d.now() + (o.seconds ?? WAIT_SECONDS) * 1000
  sweep(root, o)
  const sha = git(root, ["rev-parse", "HEAD"]).out, t = loadTry(root, sha)
  const said = (status: Waited["status"], line: string): Waited => { d.log(line); return { status, line } }
  if (!t) return said("none", `try: NONE of ${sha.slice(0, 9)} (HEAD) started: node tools/try.ts`)
  const ended = (): Waited | null => {
    if (!t.verdict) return null
    for (const l of t.verdict.lines) d.log(`  ${l}`)
    return said(t.verdict.state === "passed" ? "passed" : "failed", t.verdict.line)
  }
  const gh = d.gh(["auth", "token"]), every = gh ? 15_000 : 60_000 // (anonymous: 60 calls an hour, the machine's)
  const shown = new Set<number>()
  let done = 0, total = 0
  for (;;) {
    const over = ended()
    if (over) return over
    if (!t.runs || t.runs.length < t.wants.length) {
      const got = await d.api<{ workflow_runs?: Run[] }>(`repos/${REPO}/actions/runs?branch=${encodeURIComponent(t.ref)}&head_sha=${t.sha}&per_page=10`)
      const all = (typeof got === "string" ? [] : got.workflow_runs ?? []).filter((r) => !r.created_at || Date.parse(r.created_at) > t.started - 120_000)
      const runs = t.wants.flatMap((w) => all.filter((r) => r.path?.startsWith(w)).slice(0, 1))
      if (runs.length === t.wants.length) {
        t.runs = runs.map((r) => ({ id: r.id, path: r.path, html_url: r.html_url }))
        saveTry(root, t)
        d.log(`try: ${t.sha.slice(0, 9)} on ${t.ref}: ${t.runs.map((r) => r.html_url ?? r.id).join(" ")}`)
      } else if (d.now() - t.started > 180_000) {
        return finish(root, t, d, "failed", [], `try: FAILED ${t.sha.slice(0, 9)}: no run of ${t.wants.map((w) => path.basename(w)).join(", ")} started on ${t.ref} in 3 min`)
      }
    }
    if (t.runs && t.runs.length === t.wants.length) {
      const jobs: Jobs = []
      for (const r of t.runs) {
        const got = await d.api<{ jobs?: Jobs }>(`repos/${REPO}/actions/runs/${r.id}/jobs?per_page=50`)
        jobs.push(...(typeof got === "string" ? [{ id: -r.id, name: path.basename(r.path ?? ""), status: "unknown", conclusion: null }] : got.jobs ?? []).map((j) => ({ ...j, run: r.id })))
      }
      const counted = jobs.filter((j) => j.conclusion !== "skipped")
      for (const j of counted) if (j.status === "completed" && !shown.has(j.id)) { shown.add(j.id); d.log(`  ${j.conclusion === "success" ? "ok  " : "FAIL"}  ${j.name}  ${minutes(j)}`) }
      done = counted.filter((j) => j.status === "completed").length
      total = counted.length
      // (a rerun's jobs show as its second attempt: until then the list is still the first's)
      const settled = jobs.length > 0 && jobs.every((j) => j.status === "completed") && (!t.rerun || t.rerun.every((r) => jobs.some((j) => j.name === r.job && (j.run_attempt ?? 1) > 1)))
      if (settled) {
        const failures: Failure[] = []
        for (const r of t.runs) { const got = await runFailures(d.api, r.id); if (typeof got !== "string") failures.push(...got) }
        const reds = failures.length ? await mainRed(d.api) : []
        const v: Verdict = judge(jobs, failures, typeof reds === "string" ? [] : reds.flatMap((r) => r.failures))
        const failed = v.rows.filter((r) => r.state === "FAIL")
        const again = t.runs.filter((r) => jobs.some((j) => j.run === r.id && failed.some((f) => f.job === j.name)))
        if (failed.length && !t.rerun && gh && again.every((r) => d.gh(["api", "-X", "POST", `repos/${REPO}/actions/runs/${r.id}/rerun-failed-jobs`]))) {
          t.rerun = failed.map((r) => ({ job: r.job, tests: r.tests }))
          t.attemptAt = d.now()
          saveTry(root, t)
          for (const r of failed) d.log(`  ${r.job} failed${r.tests.length ? `: ${r.tests.slice(0, 4).join("; ")}` : ""}; running it again, once`)
        } else {
          const flaky = (t.rerun ?? []).filter((r) => v.rows.find((x) => x.job === r.job)?.state === "ok").flatMap((r) => r.tests.map((x) => `${r.job}: ${x}`))
          const lines = v.rows.filter((r) => r.state !== "ok").map((r) => `${r.job} ${r.state === "FAIL" ? "failed" : "failed as main does"}${r.tests.length ? `: ${r.tests.slice(0, 8).join("; ")}` : ` (${r.conclusion})`}`)
          const took = `${((d.now() - t.started) / 60000).toFixed(1)} min`, at = `${t.sha.slice(0, 9)}`
          const line = v.ok
            ? `try: PASSED ${at} on ${v.rows.map((r) => r.job).join(", ")} in ${took}${flaky.length ? `; flaky (failed once, then passed): ${flaky.join("; ")}` : ""}${v.rows.some((r) => r.state === "main's") ? "; failing only as main does" : ""}`
            : `try: FAILED ${at} on ${failed.map((r) => `${r.job}${r.tests.length ? `: ${r.tests.slice(0, 3).join("; ")}` : ""}`).join(" | ")}`
          return finish(root, t, d, v.ok ? "passed" : "failed", lines, line)
        }
      } else if (d.now() - t.attemptAt > ATTEMPT_MIN * 60_000) {
        for (const r of t.runs) d.gh(["api", "-X", "POST", `repos/${REPO}/actions/runs/${r.id}/cancel`])
        return finish(root, t, d, "timed out", [], `try: TIMED OUT ${t.sha.slice(0, 9)}: ${counted.filter((j) => j.status !== "completed").map((j) => j.name).join(", ")} not done ${ATTEMPT_MIN} min after it ${t.rerun ? "ran again" : "started"} (cancelled)`)
      }
    }
    const left = until - d.now()
    if (left <= 0) return said("running", `try: STILL RUNNING ${t.sha.slice(0, 9)}: ${done} of ${total || "?"} jobs done; keep waiting: node tools/try.ts --wait`)
    await d.pause(Math.min(every, left))
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2)
  if (argv[0] === "--check") {
    const why = checkPush(process.cwd(), argv[1] ?? "", argv[2] ?? "HEAD")
    if (why) console.error(why)
    process.exit(why ? 1 : 0)
  }
  if (argv[0] === "--sweep") { sweep(ROOT); process.exit(0) }
  if (argv[0] === "--help") { console.log(USAGE); process.exit(0) }
  if (argv[0] === "--wait") {
    const s = Number(argv[1])
    const w = await waitTry(ROOT, { seconds: Number.isFinite(s) && s >= 0 ? s : undefined })
    process.exit({ passed: 0, failed: 1, none: 2, running: 3 }[w.status])
  }
  process.exit(startTry(ROOT, { also: argv.includes("--surfaces") ? ["surfaces"] : [] }) ? 0 : 1)
}
