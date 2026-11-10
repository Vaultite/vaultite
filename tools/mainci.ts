// Main's CI as the next pusher needs it: what's red (jobs, tests, the nightly's), since which commit, pushes on top. `--notice`:
// pre-push's few lines or nothing, in at most 2.5 s, silent offline; tools/try.ts asks it what's already red.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { githubApi, type CiRun } from "../core/update/ci.ts"
import { gitEnv } from "../core/gitenv.ts"

export const REPO = "Vaultite/vaultite"
/** The workflows a push to main runs, by their file. */
export const WORKFLOWS: Record<string, string> = { ".github/workflows/ci.yml": "CI", ".github/workflows/windows.yml": "Windows" }

export type Run = CiRun & { id: number; created_at: string; html_url?: string; head_commit?: { message?: string } | null }
export type Job = { id: number; name: string; conclusion: string | null; steps?: { name: string; conclusion: string | null }[] }
export type Annotation = { annotation_level?: string; title?: string; message?: string }
/** What failed in a job: its tests (as test/lib.ts annotates them), else the step that failed. */
export type Failure = { job: string; test: string }
/** A workflow red on main: its newest finished run, what failed there, and since when the first of those has. */
export type Red = { workflow: string; run: Run; failures: Failure[]; since: Run; sure: boolean; onTop: number | null }
/** Asks GitHub's API (a path after api.github.com/): the answer, or why not. */
export type Api = <T>(api: string) => Promise<T | string>

const finished = (r: Run) => r.status === "completed" && (r.conclusion === "success" || r.conclusion === "failure")

/** A test's failure as its annotation says it ("<file>: <section>: <name>  -> <got>"), without what it got. */
export const testOf = (a: Annotation) => `${a.title ? `${a.title}: ` : ""}${(a.message ?? "").split("  -> ")[0].split("\n")[0]}`.slice(0, 200)
/** The same failure in two runs: numbers in a test's name (a time it took) don't tell them apart. */
export const sameTest = (a: string, b: string) => a.replace(/\d+/g, "N") === b.replace(/\d+/g, "N")

/** A failed job's failures: its tests', else its failed steps (a build, a step that isn't tests). */
export function failuresOf(job: Job, annotations: Annotation[]): Failure[] {
  const tests = annotations.filter((a) => a.annotation_level === "failure" && !/^Process completed with exit code/.test(a.message ?? "")).map(testOf)
  const steps = (job.steps ?? []).filter((s) => s.conclusion === "failure").map((s) => `step: ${s.name}`)
  return [...new Set(tests.length ? tests : steps.length ? steps : ["(no step named)"])].map((test) => ({ job: job.name, test }))
}

/** A run's failures, asked once: a finished run's never change (`cache`, by run id). */
export async function runFailures(api: Api, runId: number, cache: Map<number, Failure[]> = new Map()): Promise<Failure[] | string> {
  const known = cache.get(runId)
  if (known) return known
  const jobs = await api<{ jobs?: Job[] }>(`repos/${REPO}/actions/runs/${runId}/jobs?per_page=50`)
  if (typeof jobs === "string") return jobs
  const out: Failure[] = []
  for (const job of (jobs.jobs ?? []).filter((j) => j.conclusion === "failure")) {
    const notes = await api<Annotation[]>(`repos/${REPO}/check-runs/${job.id}/annotations?per_page=50`)
    out.push(...failuresOf(job, typeof notes === "string" ? [] : notes))
  }
  cache.set(runId, out)
  return out
}

/** Each workflow's newest finished push run on main when it's red, and the runs before it back to its last green one
 *  (newest first; `green`: that one is among `runs`, so the streak's start is known). */
export function redStreaks(runs: Run[]): { file: string; workflow: string; streak: Run[]; green: boolean }[] {
  const out = []
  for (const [file, workflow] of Object.entries(WORKFLOWS)) {
    const done = runs.filter((r) => r.path?.startsWith(file) && r.event === "push" && r.head_branch === "main" && finished(r))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
    if (done[0]?.conclusion !== "failure") continue
    const green = done.findIndex((r) => r.conclusion === "success")
    out.push({ file, workflow, streak: green < 0 ? done : done.slice(0, green), green: green >= 0 })
  }
  return out
}

/** Main's red workflows: the newest finished run's failures, the oldest run of its streak with one of them (`walk`: that
 *  many older runs asked at most, the cache keeps them), the pushes since. Green costs one call (a run is 14 kB: 20). */
export async function mainRed(api: Api, o: { cache?: Map<number, Failure[]>; walk?: number; learned?: () => void } = {}): Promise<Red[] | string> {
  const list = await api<{ workflow_runs?: Run[] }>(`repos/${REPO}/actions/runs?branch=main&event=push&status=completed&per_page=20`)
  if (typeof list === "string") return list
  const cache = o.cache ?? new Map<number, Failure[]>()
  const out: Red[] = []
  for (const { file, workflow, streak, green } of redStreaks(list.workflow_runs ?? [])) {
    const failures = await runFailures(api, streak[0].id, cache)
    if (typeof failures === "string") return failures
    o.learned?.()
    let since = streak[0], sure = streak.length === 1 && green, asked = 0
    for (const r of streak.slice(1)) {
      if (!cache.has(r.id) && asked++ >= (o.walk ?? 3)) { sure = false; break }
      const theirs = await runFailures(api, r.id, cache)
      if (typeof theirs === "string") { sure = false; break }
      o.learned?.()
      if (!theirs.some((t) => failures.some((f) => f.job === t.job && sameTest(f.test, t.test)))) { sure = true; break }
      since = r
      sure = r === streak.at(-1) && green
    }
    // (every push makes a run, finished, cancelled while it waited, or still going)
    const after = await api<{ total_count?: number }>(`repos/${REPO}/actions/workflows/${path.basename(file)}/runs?branch=main&event=push&created=${encodeURIComponent(`>${since.created_at}`)}&per_page=1`)
    out.push({ workflow, run: streak[0], failures, since, sure, onTop: typeof after === "string" ? null : after.total_count ?? 0 })
  }
  return out
}

/** The newest finished nightly run of ci.yml on main (every test and QA script) when it failed, and what failed; null
 *  when it passed, or why not. */
export async function nightlyRed(api: Api, cache?: Map<number, Failure[]>): Promise<{ run: Run; failures: Failure[] } | null | string> {
  const list = await api<{ workflow_runs?: Run[] }>(`repos/${REPO}/actions/workflows/ci.yml/runs?branch=main&event=schedule&status=completed&per_page=5`)
  if (typeof list === "string") return list
  const run = (list.workflow_runs ?? []).find(finished)
  if (run?.conclusion !== "failure") return null
  const failures = await runFailures(api, run.id, cache)
  return typeof failures === "string" ? failures : { run, failures }
}

const subject = (r: Run) => (r.head_commit?.message ?? "").split("\n")[0].slice(0, 72)

/** The notice: what's red on main, a few lines; none when it's green. */
export function notice(reds: Red[], max = 3, nightly: { run: Run; failures: Failure[] } | null = null): string {
  if (!reds.length && !nightly) return ""
  const lines = [`main is red on ${reds.length ? "CI" : "its nightly run"} (this push still goes):`]
  for (const r of reds) {
    const jobs = new Map<string, string[]>()
    for (const f of r.failures) jobs.set(f.job, [...jobs.get(f.job) ?? [], f.test])
    const pushes = r.onTop === null ? "" : ` (${r.sure ? "" : "at least "}${r.onTop} push${r.onTop === 1 ? "" : "es"} on top)`
    lines.push(`  ${r.workflow}, red since ${r.sure ? "" : "at least "}${r.since.head_sha?.slice(0, 9)} ${subject(r.since)}${pushes}`)
    for (const [job, tests] of jobs) lines.push(`    ${job}: ${tests.slice(0, max).join("; ")}${tests.length > max ? `; and ${tests.length - max} more` : ""}`)
    if (r.run.html_url) lines.push(`    ${r.run.html_url}`)
  }
  if (nightly) {
    const jobs = new Map<string, string[]>()
    for (const f of nightly.failures) jobs.set(f.job, [...jobs.get(f.job) ?? [], f.test])
    lines.push(`  Nightly (${nightly.run.created_at.slice(5, 10)}) red: ${[...jobs].map(([job, tests]) => `${job}: ${tests.slice(0, max).join("; ")}${tests.length > max ? `; and ${tests.length - max} more` : ""}`).join(" | ")}`)
    if (nightly.run.html_url) lines.push(`    ${nightly.run.html_url}`)
  }
  return lines.join("\n")
}

/** Where a checkout keeps what the notice learned (shared by its worktrees): the run list for a minute, failures for good. */
function cacheFile(root: string) {
  const dir = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8", env: gitEnv() }).stdout.trim()
  return dir ? path.join(path.resolve(root, dir), "vaultite", "mainci.json") : null
}
/** A run list kept with only what the notice reads. */
const slim = (body: unknown) => {
  const b = body as { workflow_runs?: Run[]; total_count?: number }
  return !b.workflow_runs ? b : { ...b, workflow_runs: b.workflow_runs.map((r) => ({ id: r.id, path: r.path, event: r.event, status: r.status, conclusion: r.conclusion,
    head_sha: r.head_sha, head_branch: r.head_branch, created_at: r.created_at, html_url: r.html_url, head_commit: { message: subject(r) } })) }
}
type Cache = { answers: Record<string, { at: number; body: unknown }>; failures: [number, Failure[]][] }
const LIST_FOR = 60_000, NIGHTLY_FOR = 30 * 60_000

/** The notice with a cache: GitHub asked at most once a minute per question and checkout, a finished run's failures
 *  never again. */
export async function cachedNotice(root: string, timeout = 1500, now = Date.now()): Promise<string> {
  const file = cacheFile(root)
  let c: Cache = { answers: {}, failures: [] }
  try { if (file) c = { ...c, ...JSON.parse(fs.readFileSync(file, "utf8")) as Cache } } catch { /* (none yet) */ }
  // (the nightly's list changes once a night: kept longer)
  for (const [k, a] of Object.entries(c.answers)) if (now - a.at >= (k.includes("event=schedule") ? NIGHTLY_FOR : LIST_FOR)) delete c.answers[k]
  const cache = new Map(c.failures)
  const save = () => {
    if (!file) return
    // (whole or not at all: pushes from several worktrees share it)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(`${file}.${process.pid}`, JSON.stringify({ answers: c.answers, failures: [...cache].slice(-60) }))
    fs.renameSync(`${file}.${process.pid}`, file)
  }
  const api: Api = async <T>(p: string) => {
    if (c.answers[p]) return c.answers[p].body as T
    const got = await githubApi<T>(p, timeout)
    if (typeof got !== "string" && !/\/(jobs|annotations)\?/.test(p)) c.answers[p] = { at: now, body: slim(got) }
    return got
  }
  // (saved after each run learned: a notice cut short by its time still keeps it)
  const [reds, nightly] = await Promise.all([mainRed(api, { cache, learned: save }), nightlyRed(api, cache)])
  if (typeof reds === "string") return ""
  save()
  return notice(reds, 3, typeof nightly === "string" ? null : nightly)
}

if (import.meta.main && process.argv.includes("--notice")) {
  // (a hard stop: a push never waits on GitHub)
  setTimeout(() => process.exit(0), 2500).unref()
  const said = await cachedNotice(process.cwd()).catch(() => "")
  if (said) console.log(said)
}
