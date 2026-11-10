// Main's red notice (mainci.ts) on made-up runs: what failed, since when, the pushes on top. No network. In npm test.
import { check, exit, section, summary } from "./test/lib.ts"
import { failuresOf, mainRed, notice, redStreaks, type Api, type Run } from "./mainci.ts"
const t0 = Date.now()

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
check("main green: nothing said", notice([]) === "" && (await mainRed(github({ runs: [run(2, "success"), run(1, "failure")] }).api) as unknown[]).length === 0)

await exit(summary("ci", t0))
