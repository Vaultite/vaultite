// What keeps main green across OSes: the OS-sensitive rule (osrisk.ts), main's red notice (mainci.ts) and the try run's
// verdict and record (try.ts), on made-up runs and a scratch repository. No network. In npm test.
import { check, exit, section, summary, tempDir } from "./test/lib.ts"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { gitEnv } from "../core/gitenv.ts"
import { alsoTry, describe, osRisk, parseDiff } from "./osrisk.ts"
import { failuresOf, mainRed, nightlyRed, notice, redStreaks, type Api, type Run } from "./mainci.ts"
import { ATTEMPT_MIN, checkPush, judge, loadTry, riskKey, startTry, sweep, tried, waitTry } from "./try.ts"
const t0 = Date.now()

section("osrisk")
const whys = (file: string, ...added: string[]) => osRisk([{ file, added }]).map((r) => r.why)
check("a path built in the server is OS-sensitive", whys("core/files.ts", "const p = path.resolve(dir, name)").includes("builds or compares paths"))
check("a process started is", whys("plugins/core/terminal/plugin.ts", "const child = spawn(shell, args)").includes("starts or stops a process"))
check("a tool run by name is", whys("core/agents.ts", 'execFileSync("which", ["git"])').includes("runs a tool one OS lacks"))
check("file times are", whys("core/live.ts", "if (st.mtimeMs > seen) changed.push(f)").includes("file system behaviour (modes, links, renames, watching, file times)"))
check("a regex's exec isn't a process", whys("core/links.ts", "const m = re.exec(text)").length === 0)
check("ordinary lines aren't", whys("core/links.ts", "const total = items.length + 1", "return { ok: true }").length === 0)
check("the browser's code isn't (no OS APIs there)", whys("web/src/core/paths.ts", "const p = path.resolve(a)").length === 0 && whys("web/qa/tabs.mjs", "spawn(x)").length === 0)
check("prose isn't", whys("CHANGELOG.md", "- spawn(x) path.resolve") .length === 0 && whys("core/docs/app.md", "spawn(") .length === 0)
check("the CLI's shims, CI and the packages are, whatever their lines", whys("bin/vau.cmd")[0] === "the CLI's shims" && whys(".github/workflows/ci.yml")[0] === "CI itself" && whys("package.json")[0] === "the packages (native builds, scripts)")
check("the native helpers are, their Swift too (CI's macOS has an older Xcode)", whys("electron/voice.swift")[0] === "the native helpers" && whys("tools/build_helpers.ts")[0] === "the native helpers")
check("how tests start is", whys("tools/test/lib.ts")[0] === "how tests and the app's runs start" && whys("core/runtime.ts")[0] === "how tests and the app's runs start")
const many = osRisk(["a", "b", "c", "d"].map((n) => ({ file: `core/${n}.ts`, added: ["path.relative(x, y)"] })))
check("described by reason, a few files each", describe(many) === "builds or compares paths (core/a.ts, core/b.ts, core/c.ts and 1 more)", describe(many))
check("what windows.yml's surfaces exercises is OS-sensitive whatever its lines, and its try runs surfaces too; elsewhere not",
  whys("electron/setup.ts", "const a = 1")[0] === "what vau, Set up, the service and the installer do on Windows" && alsoTry(osRisk([{ file: "electron/setup.ts", added: [] }, { file: "core/x.ts", added: ["path.resolve(a)"] }])).join() === "surfaces"
  && alsoTry(osRisk([{ file: "bin/vau.cmd", added: [] }])).join() === "surfaces" && alsoTry(osRisk([{ file: "core/x.ts", added: ["path.resolve(a)"] }])).length === 0)
const diff = ["diff --git a/core/x.ts b/core/x.ts", "--- a/core/x.ts", "+++ b/core/x.ts", "@@ -1 +1 @@", "-old", "+const p = path.resolve(a)",
  "diff --git a/web/src/y.tsx b/web/src/y.tsx", "+++ b/web/src/y.tsx", "+spawn()"].join("\n")
const parsed = parseDiff(diff)
check("a diff's files and their added lines", parsed.length === 2 && parsed[0].file === "core/x.ts" && parsed[0].added.join() === "const p = path.resolve(a)" && osRisk(parsed).length === 1, parsed)

section("mainci")
const run = (id: number, conclusion: string | null, o: Partial<Run> = {}): Run => ({ id, path: ".github/workflows/ci.yml", event: "push", head_branch: "main", status: conclusion ? "completed" : "in_progress",
  conclusion, head_sha: `${id}`.padStart(40, "0"), created_at: `2026-11-05T${String(id).padStart(2, "0")}:00:00Z`, html_url: `https://github.com/x/runs/${id}`, head_commit: { message: `feat(x): change ${id}\n\nbody` }, ...o })
const job = (id: number, name: string, conclusion: string) => ({ id, name, conclusion, steps: [{ name: "Run npm test", conclusion }] })
const failed = (title: string, message: string) => ({ annotation_level: "failure", title, message })
const fs1 = failuresOf(job(1, "test (windows-2025)", "failure"), [failed("test_vault.ts", "live: walks  -> 2"), { annotation_level: "failure", message: "Process completed with exit code 1." }, { annotation_level: "warning", title: "x", message: "Node 20" }])
check("a job's failures are its tests, without what they got", fs1.length === 1 && fs1[0].test === "test_vault.ts: live: walks", fs1)
check("a job failing outside its tests names the step", failuresOf(job(2, "demo", "failure"), [])[0].test === "step: Run npm test")
check("main green: no streak", redStreaks([run(3, "success"), run(2, "failure")]).length === 0)
const st = redStreaks([run(5, null), run(4, "failure"), run(3, "cancelled"), run(2, "failure"), run(1, "success"), run(9, "failure", { head_branch: "try/abc" })])
check("main red: the streak back to its last green run, cancelled and running runs aside, try runs not main's", st.length === 1 && st[0].streak.map((r) => r.id).join() === "4,2" && st[0].green, st)

/** A made-up GitHub: runs 1 (green) to 4, run 4 and 3 failing the same test, run 2 another; 6 pushes since run 3. */
function github(o: { runs?: Run[]; fail?: boolean } = {}) {
  const asked: string[] = []
  const runs = o.runs ?? [run(4, "failure"), run(3, "failure"), run(2, "failure"), run(1, "success")]
  const tests: Record<number, string> = { 4: "share: links (12 ms)  -> 403", 3: "share: links (15 ms)  -> 403", 2: "kept: written" }
  const api: Api = async <T>(p: string) => {
    asked.push(p)
    if (o.fail) return "GitHub answered 503 about CI"
    if (p.includes("/actions/runs?")) return { workflow_runs: runs } as T
    if (p.includes("/workflows/ci.yml/runs?")) return { total_count: 6 } as T
    const r = /runs\/(\d+)\/jobs/.exec(p)?.[1]
    if (r) return { jobs: [job(Number(r) * 10, "test (windows-2025)", "failure"), job(Number(r) * 10 + 1, "test (ubuntu-24.04)", "success")] } as T
    const j = /check-runs\/(\d+)\/annotations/.exec(p)?.[1]
    if (j) return [failed("test_vault.ts", tests[Number(j) / 10])] as T
    return "not found"
  }
  return { api, asked }
}
const g = github()
const reds = await mainRed(g.api)
const r0 = typeof reds === "string" ? null : reds[0]
check("red since the oldest run failing the same test (numbers in its name aside), and the pushes since", r0?.since.id === 3 && r0.sure && r0.onTop === 6 && r0.failures.length === 1, reds)
const said = notice(typeof reds === "string" ? [] : reds)
check("the notice: the job, the test, since which commit, pushes on top, the run", /test \(windows-2025\): test_vault\.ts: share: links \(12 ms\)/.test(said) && said.includes("red since 000000000 feat(x): change 3 (6 pushes on top)") && said.includes("https://github.com/x/runs/4"), said)
check("a green job isn't asked about", !g.asked.some((p) => p.includes("check-runs/41/")), g.asked)
const cache = new Map<number, import("./mainci.ts").Failure[]>()
const short = await mainRed(github().api, { walk: 0, cache })
check("a streak longer than it asks about says so", typeof short !== "string" && short[0].since.id === 4 && !short[0].sure && /red since at least .* \(at least 6 pushes on top\)/.test(notice(short)), short)
const again = github()
await mainRed(again.api, { cache, walk: 3 })
check("a finished run's failures are asked once", !again.asked.some((p) => p.includes("runs/4/jobs")), again.asked)
check("GitHub not answering: no notice", typeof await mainRed(github({ fail: true }).api) === "string")
const nightlyApi = (conclusion: string): Api => async <T>(p: string) => {
  if (p.includes("event=schedule")) return { workflow_runs: [run(9, null, { event: "schedule" }), run(8, conclusion, { event: "schedule", created_at: "2026-11-09T05:17:00Z" })] } as T
  if (p.includes("runs/8/jobs")) return { jobs: [job(80, "qa", "failure"), job(81, "test (macos-15)", "success")] } as T
  if (p.includes("check-runs/80/")) return [failed("qa counts", "budget: 41 requests, at most 30"), failed("qa requests", "a second fetch of the tree")] as T
  return "not found"
}
const night = await nightlyRed(nightlyApi("failure"))
const told = notice([], 3, typeof night === "string" ? null : night)
check("the nightly red: its date, the job and its scripts, said even when the pushes are green", /^main is red on its nightly run/.test(told) && told.includes("Nightly (11-09) red: qa: qa counts: budget: 41 requests, at most 30; qa requests: a second fetch of the tree") && told.includes("runs/8"), told)
check("the nightly green, or still running: nothing", await nightlyRed(nightlyApi("success")) === null)
check("main green: nothing said", notice([]) === "" && (await mainRed(github({ runs: [run(2, "success"), run(1, "failure")] }).api) as unknown[]).length === 0)

section("try")
const jobs = [job(1, "test (ubuntu-24.04)", "success"), job(2, "test (windows-2025)", "failure"), job(3, "demo", "skipped")]
const mine = [{ job: "test (windows-2025)", test: "test_vault.ts: live: walks" }]
check("a job failing on its own is the change's", !judge(jobs, mine, []).ok && judge(jobs, mine, []).rows.find((r) => r.job === "test (windows-2025)")?.state === "FAIL")
const asMain = judge(jobs, mine, [{ job: "test (windows-2025)", test: "test_vault.ts: live: walks" }])
check("failing only as main does isn't, and a skipped job isn't counted", asMain.ok && asMain.rows.length === 2 && asMain.rows[1].state === "main's", asMain)
check("a failure main has on another OS is still the change's", !judge(jobs, mine, [{ job: "test (macos-15)", test: "test_vault.ts: live: walks" }]).ok)
check("a job that failed with nothing said (cancelled, timed out) is a failure", !judge([job(2, "test (windows-2025)", "cancelled")], [], []).ok)

// A scratch repository: main, a branch with an OS-sensitive change, main moving on, the branch rebased.
const repo = tempDir("tryrepo-")
const git = (...a: string[]) => spawnSync("git", ["-c", "user.name=Alice Park", "-c", "user.email=alice@example.com", "-c", "commit.gpgsign=false", ...a], { cwd: repo, encoding: "utf8", env: gitEnv() }).stdout.trim()
const write = (f: string, text: string) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), text) }
git("init", "-q", "-b", "main")
write("core/files.ts", "export const a = 1\n"); write("README.md", "# Lighthouse\n"); git("add", "-A"); git("commit", "-qm", "base")
const base = git("rev-parse", "HEAD")
git("checkout", "-qb", "change")
write("core/files.ts", "export const a = 1\nexport const p = (d: string) => path.resolve(d, 'x')\n"); write("CHANGELOG.md", "- a change\n"); git("add", "-A"); git("commit", "-qm", "change")
const before = riskKey(repo, base, "HEAD")
check("a change's OS-sensitive part has a key", !!before.key && before.risks.length === 1, before)
check("pre-push stops it untried", /OS-sensitive and hasn't passed a try run: builds or compares paths \(core\/files\.ts\)/.test(checkPush(repo, base, git("rev-parse", "HEAD")) ?? ""))
git("checkout", "-q", "main"); write("README.md", "# Lighthouse\n\nTides.\n"); write("CHANGELOG.md", "- another\n"); git("add", "-A"); git("commit", "-qm", "theirs")
const moved = git("rev-parse", "HEAD")
check("one not on top of main is left to the remote's refusal", checkPush(repo, moved, git("rev-parse", "change")) === null)
git("checkout", "-q", "change"); git("rebase", "-q", "-X", "theirs", "main")
const after = riskKey(repo, moved, "HEAD")
check("rebased (a CHANGELOG conflict too), its key is the same", after.key === before.key, { before, after })
const dir = path.join(repo, ".git", "vaultite", "tried")
fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${before.key}.json`), "{}")
check("tried, pre-push lets it go", tried(repo, before.key!) && checkPush(repo, moved, git("rev-parse", "HEAD")) === null)
write("README.md", "# Lighthouse\n\nTides and boats.\n"); git("commit", "-qam", "docs")
check("then a change elsewhere keeps it tried", checkPush(repo, moved, git("rev-parse", "HEAD")) === null)
write("core/files.ts", "export const a = 2\nexport const p = (d: string) => path.resolve(d, 'y')\n"); git("commit", "-qam", "more")
check("a new OS-sensitive change needs its own try", checkPush(repo, moved, git("rev-parse", "HEAD")) !== null)
write("core/other.ts", "export const b = 2\n"); git("add", "-A"); git("commit", "-qm", "plain")
check("nothing OS-sensitive: no key, nothing asked", riskKey(repo, git("rev-parse", "HEAD~1"), "HEAD").key === null && checkPush(repo, git("rev-parse", "HEAD~1"), git("rev-parse", "HEAD")) === null)

// A whole try against a made-up GitHub, its origin a bare repository here: pushed, waited for, judged, deleted.
const origin = tempDir("tryorigin-"), work = tempDir("trywork-")
const at = (cwd: string) => (...a: string[]) => spawnSync("git", ["-c", "user.name=Alice Park", "-c", "user.email=alice@example.com", "-c", "commit.gpgsign=false", ...a], { cwd, encoding: "utf8", env: gitEnv() })
at(origin)("init", "-q", "--bare", "-b", "main")
const w = at(work)
w("init", "-q", "-b", "main"); w("remote", "add", "origin", origin)
fs.mkdirSync(path.join(work, "core")); fs.writeFileSync(path.join(work, "core/files.ts"), "export const a = 1\n"); w("add", "-A"); w("commit", "-qm", "base"); w("push", "-q", "origin", "main")
w("checkout", "-qb", "change"); fs.writeFileSync(path.join(work, "core/files.ts"), "export const p = (d: string) => path.resolve(d)\n"); w("commit", "-qam", "change")
/** A made-up GitHub for one try: its jobs running until `done`, the Windows one failing (`second`: then, run again). */
function fake(sc: { second?: "ok" | "FAIL"; surfaces?: "ok" | "FAIL" } = {}) {
  let attempt = 1, clock = 1_800_000_000_000
  const g = { done: false, asked: [] as string[], ghAsked: [] as string[] }
  const windows = { id: 88, path: ".github/workflows/windows.yml", html_url: "https://github.com/x/runs/88" }
  const jobsOf = () => attempt === 1 ? [{ id: 1, name: "test (ubuntu-24.04)", status: "completed", conclusion: "success", run_attempt: 1 }, { id: 2, name: "test (windows-2025)", status: g.done ? "completed" : "in_progress", conclusion: g.done ? "failure" : null, run_attempt: 1 }]
    : [{ id: 1, name: "test (ubuntu-24.04)", status: "completed", conclusion: "success", run_attempt: 1 }, { id: 3, name: "test (windows-2025)", status: "completed", conclusion: sc.second === "ok" ? "success" : "failure", run_attempt: 2 }]
  const api: Api = async <T>(p: string) => {
    g.asked.push(p)
    if (p.includes("/actions/runs?branch=try")) return { workflow_runs: [{ id: 77, path: ".github/workflows/ci.yml", html_url: "https://github.com/x/runs/77" }, ...p.includes("-surfaces") ? [windows] : []] } as T
    if (p.includes("/runs/88/jobs")) return { jobs: [{ id: 9 + attempt * 10, name: "surfaces", status: "completed", conclusion: sc.surfaces === "FAIL" ? "failure" : "success", run_attempt: attempt }, { id: 10, name: "arm64", status: "completed", conclusion: "skipped" }] } as T
    if (p.includes("/runs/77/jobs")) return { jobs: jobsOf() } as T
    if (p.includes("check-runs/")) return [failed("test_vault.ts", "terminal: teleport finds the checkout  -> C:/x")] as T
    if (p.includes("/actions/runs?")) return { workflow_runs: [] } as T
    return "not found"
  }
  const gh = (args: string[]) => { g.ghAsked.push(args.join(" ")); if (args.at(-1)?.endsWith("rerun-failed-jobs")) attempt = 2; return true }
  const logs: string[] = []
  const o = { api, gh, log: (l: string) => logs.push(l), now: () => clock, pause: async (ms: number) => { clock += ms }, precheck: () => null }
  return { g, o, logs, text: () => logs.join("\n"), last: () => logs.at(-1) ?? "", tick: (ms: number) => { clock += ms } }
}
const branches = () => at(origin)("for-each-ref", "--format=%(refname)", "refs/heads/try").stdout.trim()
const forget = () => fs.rmSync(path.join(work, ".git", "vaultite"), { recursive: true, force: true })
const sensitive = riskKey(work, w("merge-base", "main", "HEAD").stdout.trim(), "HEAD").key!
const head = () => w("rev-parse", "HEAD").stdout.trim()

const pre = fake()
check("try: what fails at once anyway (tsc, check) fails here first, nothing pushed", !startTry(work, { ...pre.o, precheck: () => "npm run check fails here" }) && /^try: NOT STARTED: npm run check fails/.test(pre.last()) && branches() === "")
const a = fake({ second: "ok" })
check("try: started, it returns at once: HEAD on its try branch, kept as this checkout's try", startTry(work, a.o) && /^try: STARTED [0-9a-f]{9} on try\/[0-9a-f]{12}: about 6 min\. Wait: node tools\/try\.ts --wait$/.test(a.last())
  && branches().startsWith("refs/heads/try/") && loadTry(work, head())?.ref === branches().slice("refs/heads/".length), [a.logs, branches()])
check("try: started again while it runs: said, not pushed again", startTry(work, a.o) && /STARTED already/.test(a.last()))
check("pre-push, meanwhile: its try is running, wait for it", /Its try is running: node tools\/try\.ts --wait/.test(checkPush(work, w("merge-base", "main", "HEAD").stdout.trim(), head()) ?? ""))
const w1 = await waitTry(work, { ...a.o, seconds: 0 })
check("try --wait, not done: still running, how far, and what to run again; nothing ended", w1.status === "running" && /^try: STILL RUNNING [0-9a-f]{9}: 1 of 2 jobs done; keep waiting: node tools\/try\.ts --wait$/.test(w1.line) && branches() !== "", [w1, a.logs])
a.g.done = true
const w2 = await waitTry(work, { ...a.o, seconds: 300 })
check("try --wait again: a failure runs again once, passes: PASSED with the flaky test in its last line, kept for pre-push, branch deleted",
  w2.status === "passed" && /^try: PASSED [0-9a-f]{9} on test \(ubuntu-24\.04\), test \(windows-2025\) in .* min; flaky \(failed once, then passed\): test \(windows-2025\): test_vault\.ts: terminal: teleport/.test(w2.line)
  && a.last() === w2.line && a.logs.filter((l) => l === w2.line).length === 1 && a.g.ghAsked.some((x) => x.endsWith("rerun-failed-jobs")) && tried(work, sensitive) && branches() === "", [w2, a.logs])
const asked = a.g.asked.length, w3 = await waitTry(work, { ...a.o, seconds: 300 })
check("try --wait once it ended: the verdict again, GitHub not asked", w3.status === "passed" && w3.line === w2.line && a.g.asked.length === asked)
forget()
const b = fake({ second: "FAIL" }); b.g.done = true
startTry(work, b.o)
const wb = await waitTry(work, { ...b.o, seconds: 300 })
check("try: failing again is the change's: FAILED naming the job and its test, not kept", wb.status === "failed" && /^try: FAILED [0-9a-f]{9} on test \(windows-2025\): test_vault\.ts: terminal: teleport/.test(wb.line) && !tried(work, sensitive) && branches() === "", [wb, b.logs])
forget()
const c = fake()
startTry(work, c.o)
await waitTry(work, { ...c.o, seconds: 0 })
c.tick((ATTEMPT_MIN + 1) * 60_000)
sweep(work, c.o)
const wc = await waitTry(work, { ...c.o, seconds: 0 })
check("try: one nobody came back to is ended by the next try command: cancelled, its branch deleted, TIMED OUT", wc.status === "failed" && /^try: TIMED OUT [0-9a-f]{9}: not done 25 min after it started \(cancelled\)$/.test(wc.line)
  && c.g.ghAsked.some((x) => x.endsWith("/cancel")) && branches() === "", [wc, c.logs])
forget()
w("checkout", "-qb", "setup", "main"); fs.mkdirSync(path.join(work, "electron")); fs.writeFileSync(path.join(work, "electron/setup.ts"), "export const bin = (d: string) => path.join(d, 'vau.cmd')\n"); w("add", "-A"); w("commit", "-qm", "setup")
const s1 = fake({ surfaces: "FAIL", second: "FAIL" }); s1.g.done = true
startTry(work, s1.o)
const ws = await waitTry(work, { ...s1.o, seconds: 300 })
check("try: a change to what surfaces exercises runs windows.yml's surfaces too (not arm64), and its failure counts", /on try\/[0-9a-f]{12}-surfaces \(surfaces too/.test(s1.text()) && ws.status === "failed"
  && /^try: FAILED .* surfaces/.test(ws.line) && s1.g.asked.some((p) => p.includes("/runs/88/jobs")) && !/arm64/.test(s1.text()) && branches() === "", [ws, s1.logs])
fs.writeFileSync(path.join(work, "electron/setup.ts"), "export const b = 2\n")
const d1 = fake()
check("try: uncommitted work isn't tried, nothing pushed", !startTry(work, d1.o) && /NOT STARTED: HEAD is what's tried: commit first/.test(d1.last()) && !d1.g.asked.length && branches() === "")
w("checkout", "-q", "--", "."); w("checkout", "-q", "main")
const n1 = fake()
check("try --wait with none started: says so, with what to run", (await waitTry(work, { ...n1.o, seconds: 0 })).status === "none" && /^try: NONE of [0-9a-f]{9} \(HEAD\) started: node tools\/try\.ts$/.test(n1.last()))

await exit(summary("ci", t0))
