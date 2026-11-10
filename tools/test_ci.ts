// What keeps main green across OSes: the OS-sensitive rule (osrisk.ts), main's red notice (mainci.ts) and the try run's
// verdict and record (try.ts), on made-up runs and a scratch repository. No network. In npm test.
import { check, exit, section, summary, tempDir } from "./test/lib.ts"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { gitEnv } from "../core/gitenv.ts"
import { alsoTry, describe, osRisk, parseDiff } from "./osrisk.ts"
import { failuresOf, mainRed, nightlyRed, notice, redStreaks, type Api, type Run } from "./mainci.ts"
import { checkPush, judge, riskKey, tried, tryHead } from "./try.ts"
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
type Script = { second?: "ok" | "FAIL"; never?: boolean; surfaces?: "ok" | "FAIL" }
function fake(sc: Script) {
  let attempt = 1
  const asked: string[] = [], gh: string[] = []
  const windows = { id: 88, path: ".github/workflows/windows.yml", html_url: "https://github.com/x/runs/88" }
  const jobsOf = () => attempt === 1 ? [{ id: 1, name: "test (ubuntu-24.04)", status: "completed", conclusion: "success" }, { id: 2, name: "test (windows-2025)", status: sc.never ? "in_progress" : "completed", conclusion: sc.never ? null : "failure" }]
    : [{ id: 1, name: "test (ubuntu-24.04)", status: "completed", conclusion: "success" }, { id: 3, name: "test (windows-2025)", status: "completed", conclusion: sc.second === "ok" ? "success" : "failure" }]
  const api: Api = async <T>(p: string) => {
    asked.push(p)
    if (p.includes("/actions/runs?branch=try")) return { workflow_runs: [{ id: 77, path: ".github/workflows/ci.yml", html_url: "https://github.com/x/runs/77" }, ...p.includes("-surfaces") ? [windows] : []] } as T
    if (p.includes("/runs/88/jobs")) return { jobs: [{ id: 9, name: "surfaces", status: "completed", conclusion: sc.surfaces === "FAIL" ? "failure" : "success" }, { id: 10, name: "arm64", status: "completed", conclusion: "skipped" }] } as T
    if (p.includes("/runs/77/jobs")) return { jobs: jobsOf() } as T
    if (/runs\/77$/.test(p)) return { run_attempt: attempt } as T
    if (p.includes("check-runs/")) return [failed("test_vault.ts", "terminal: teleport finds the checkout  -> C:/x")] as T
    if (p.includes("/actions/runs?")) return { workflow_runs: [] } as T
    return "not found"
  }
  const ghDid = (args: string[]) => { gh.push(args.join(" ")); if (args.at(-1)?.endsWith("rerun-failed-jobs")) attempt = 2; return true }
  return { api, gh: ghDid, asked, ghAsked: gh }
}
const tryOnce = async (sc: Script, timeoutMin?: number, branch = "change") => {
  w("checkout", "-q", branch)
  const f = fake(sc), logs: string[] = []
  const ok = await tryHead(work, { api: f.api, gh: f.gh, pause: async () => {}, log: (s) => logs.push(s), timeoutMin })
  return { ok, logs: logs.join("\n"), f, left: at(origin)("for-each-ref", "--format=%(refname)", "refs/heads/try").stdout.trim() }
}
const sensitive = riskKey(work, w("merge-base", "main", "HEAD").stdout.trim(), "HEAD").key!
const broken = await tryOnce({ second: "FAIL" })
check("try: a failure that fails again is the change's: named with its test, not kept, its branch deleted", !broken.ok && /test \(windows-2025\) failed:\n\s+test_vault\.ts: terminal: teleport/.test(broken.logs)
  && /try: FAIL on test \(windows-2025\)/.test(broken.logs) && !tried(work, sensitive) && broken.left === "", broken)
const flaky = await tryOnce({ second: "ok" })
check("try: a failure that passes the second time is flaky, said so; the try passes and is kept for pre-push", flaky.ok && /flaky, failed once then passed/.test(flaky.logs) && tried(work, sensitive)
  && flaky.f.ghAsked.some((a) => a.endsWith("rerun-failed-jobs")) && flaky.left === "", flaky)
fs.rmSync(path.join(work, ".git", "vaultite"), { recursive: true, force: true })
const slow = await tryOnce({ never: true }, 0.0001)
check("try: past its time, the run is cancelled and it fails loudly", !slow.ok && /timed out after .* min, cancelled/.test(slow.logs) && slow.f.ghAsked.some((a) => a.endsWith("/cancel")) && slow.left === "", slow)
w("checkout", "-qb", "setup", "main"); fs.mkdirSync(path.join(work, "electron")); fs.writeFileSync(path.join(work, "electron/setup.ts"), "export const bin = (d: string) => path.join(d, 'vau.cmd')\n"); w("add", "-A"); w("commit", "-qm", "setup")
const surf = await tryOnce({ second: "ok", surfaces: "FAIL" }, undefined, "setup")
check("try: a change to what surfaces exercises runs windows.yml's surfaces too (not arm64), and its failure counts", !surf.ok && surf.f.asked.some((p) => p.includes("branch=try%2F") && p.includes("-surfaces"))
  && surf.f.asked.some((p) => p.includes("/runs/88/jobs")) && /surfaces failed/.test(surf.logs) && !/arm64/.test(surf.logs) && surf.left === "", surf)
fs.writeFileSync(path.join(work, "core/files.ts"), "export const b = 2\n")
const dirtyTry = await tryOnce({})
check("try: uncommitted work isn't tried, nothing pushed", !dirtyTry.ok && /commit first/.test(dirtyTry.logs) && !dirtyTry.f.asked.length, dirtyTry)

await exit(summary("ci", t0))
