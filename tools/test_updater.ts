// The update engine's decisions (core/update/): CI's verdict, the commit to take, where a checkout stands. No git, no
// network: the host's path end to end is test_selfupdate. In npm test.
import { check, exit, section, summary } from "./test/lib.ts"
import type { CiJob, CiResult, CiRun } from "../core/update/ci.ts"
import { CI_CALLS_PER_HOUR, CI_WORKFLOW, callBudget, ciOf, githubCi, githubRepo, osGate } from "../core/update/ci.ts"
import { capped, pickTarget, redRoute } from "../core/update/git.ts"
import { LOOK_EVERY, placed } from "../core/update/updater.ts"
const t0 = Date.now()
const LIST_GONE = 20_000 // (past the 15 s the branch's runs serve one look)

section("ci.ts")
check("githubRepo: https and ssh remotes", githubRepo("git@github.com:Vaultite/vaultite.git") === "Vaultite/vaultite" && githubRepo("https://github.com/Vaultite/vaultite") === "Vaultite/vaultite" && githubRepo("/srv/x.git") === null)
const run = (event: string, status: string, conclusion: string | null, p = CI_WORKFLOW, sha?: string): CiRun => ({ path: p, event, status, conclusion, head_sha: sha })
check("a push run that passed is green", ciOf([run("push", "completed", "success")]).ok === true)
check("the nightly counts as main's", ciOf([run("push", "completed", "failure"), run("schedule", "completed", "success")]).ok === true)
check("a dispatched QA run doesn't", ciOf([run("workflow_dispatch", "completed", "success")]).ok === null)
check("another workflow doesn't", ciOf([run("push", "completed", "success", ".github/workflows/release.yml")]).ok === null)
check("running is not yet, failed is red", ciOf([run("push", "in_progress", null)]).ok === null && ciOf([run("push", "completed", "failure")]).ok === false)
check("cancelled is not yet", ciOf([run("push", "completed", "cancelled")]).ok === null)
check("a try run (tools/try.ts) isn't main's", ciOf([{ ...run("push", "completed", "success"), head_branch: "try/0123456789ab" }]).ok === null
  && ciOf([{ ...run("push", "completed", "success"), head_branch: "main" }]).ok === true)
check("each verdict says where CI is", [ciOf([run("push", "completed", "success")]), ciOf([run("push", "completed", "failure")]), ciOf([run("push", "in_progress", null)]), ciOf([]), ciOf([run("push", "completed", "cancelled")])]
  .map((r) => r.state).join() === "passed,failed,running,none,cancelled")

section("ci.ts: the gate, this OS's test job")
const mac = osGate("darwin")!, job = (name: string, status: string, conclusion: string | null = null): CiJob => ({ name, status, conclusion })
const MAC = "test (macos-15)", LINUX = "test (ubuntu-24.04)", WIN = "test (windows-2025)"
check("each OS waits for its own test job", mac.job(MAC) && !mac.job(LINUX) && osGate("linux")!.job(LINUX) && osGate("win32")!.job(WIN) && !osGate("win32")!.job("demo")
  && osGate("aix") === null, [mac.label, osGate("linux")!.label])
const gated = (r: CiRun, jobs: CiJob[] | string | undefined) => ciOf([r], { gate: mac, jobs: () => jobs })
const going = { ...run("push", "in_progress", null), id: 1 }
const early = gated(going, [job(MAC, "completed", "success"), job(LINUX, "in_progress"), job("demo", "queued")])
check("its job passed while the run goes on: green at once", early.ok === true && early.state === "passed" && early.why === "CI's macOS tests passed" && !early.elsewhere, early)
const failedEarly = gated(going, [job(MAC, "completed", "failure"), job(LINUX, "in_progress")])
check("its job failed while the run goes on: red at once", failedEarly.ok === false && failedEarly.state === "failed" && /macOS tests failed/.test(failedEarly.why), failedEarly)
const others = gated({ ...run("push", "completed", "failure"), id: 1 }, [job(MAC, "completed", "success"), job(LINUX, "completed", "failure"), job("demo", "completed", "failure")])
check("another OS's failure (or the demo's) doesn't block it, and is said", others.ok === true && others.elsewhere?.join() === `${LINUX},demo`, others)
check("its job still running: not yet", gated(going, [job(MAC, "in_progress"), job(LINUX, "completed", "success")]).state === "running")
check("a run queued, no jobs yet: not yet", gated(going, []).state === "running")
check("a whole run that passed needs no jobs", gated({ ...run("push", "completed", "success"), id: 1 }, undefined).ok === true)
const blind = gated({ ...run("push", "completed", "failure"), id: 1 }, "GitHub answered 502 about CI")
check("a red run whose jobs GitHub didn't give: not known, saying why", blind.ok === null && !blind.state && /502/.test(blind.why), blind)
check("timed out is red, cancelled is not yet", gated(going, [job(MAC, "completed", "timed_out")]).ok === false && gated({ ...run("push", "completed", "cancelled"), id: 1 }, [job(MAC, "completed", "cancelled")]).state === "cancelled")
const nightly = ciOf([{ ...run("push", "completed", "failure"), id: 1 }, { ...run("schedule", "completed", "failure"), id: 2 }], { gate: mac, jobs: (r) => r.id === 1 ? [job(MAC, "completed", "failure")] : [job(MAC, "completed", "success"), job("qa", "completed", "failure")] })
check("the nightly's test job counts too", nightly.ok === true && nightly.elsewhere?.join() === "qa", nightly)

const body = (runs: CiRun[]) => ({ workflow_runs: runs })
await section("githubCi: one call for the branch, one more per commit not in it", async () => {
  const asked: string[] = []
  let clock = 0
  const ci = githubCi("main", async (api) => {
    asked.push(api)
    if (api.includes("/workflows/")) return body([run("push", "completed", "success", CI_WORKFLOW, "aaa")])
    return api.includes("head_sha=ccc") ? "GitHub answered 403 about CI" : body([run("push", "in_progress", null, CI_WORKFLOW, "bbb")])
  }, { budget: callBudget(100, () => clock), now: () => clock, gate: null })
  const a = await ci("Alice/lighthouse", "aaa"), a2 = await ci("Alice/lighthouse", "aaa")
  check("a commit among the branch's runs", a.ok === true && a2.ok === true && asked.length === 1, asked)
  check("the branch's runs asked of once, by workflow and branch", asked[0] === "repos/Alice/lighthouse/actions/workflows/ci.yml/runs?branch=main&per_page=100", asked)
  check("one not among them asked of on its own", (await ci("Alice/lighthouse", "bbb")).ok === null && asked[1] === "repos/Alice/lighthouse/actions/runs?head_sha=bbb&per_page=50", asked)
  const c = await ci("Alice/lighthouse", "ccc")
  check("GitHub not answering is not yet, saying why", c.ok === null && /403/.test(c.why), c)
  clock += 60_000 // (the next look)
  asked.length = 0
  check("a pass is final: never asked again", (await ci("Alice/lighthouse", "aaa")).ok === true && !asked.length, asked)
  await ci("Alice/lighthouse", "bbb")
  check("a commit not among the branch's runs is asked of on its own only once", asked.length === 1 && asked[0].includes("/workflows/"), asked)
})

await section("githubCi: a red verdict asked again after 10 minutes, a failing list asks no more", async () => {
  let clock = 0, list: CiRun[] | string = [run("push", "completed", "failure", CI_WORKFLOW, "red")]
  const asked: string[] = []
  const ci = githubCi("main", async (api) => (asked.push(api), typeof list === "string" ? list : body(list)), { budget: callBudget(100, () => clock), now: () => clock, gate: null })
  check("red", (await ci("Alice/lighthouse", "red")).ok === false && asked.length === 1)
  clock += 9 * 60_000
  check("still red, not asked within 10 minutes", (await ci("Alice/lighthouse", "red")).ok === false && asked.length === 1, asked)
  clock += 60_000
  list = [run("push", "completed", "failure", CI_WORKFLOW, "red"), run("schedule", "completed", "success", CI_WORKFLOW, "red")]
  check("asked again: the nightly passed it", (await ci("Alice/lighthouse", "red")).ok === true && asked.length === 2, asked)
  clock += 60_000
  list = "GitHub answered 502 about CI"
  const down = await ci("Alice/lighthouse", "new")
  check("the branch's runs not answering: not yet, and no commit asked of on its own", down.ok === null && /502/.test(down.why) && asked.length === 3, { down, asked })
})

await section("githubCi with a gate: a run's jobs while they may change, once when they've ended", async () => {
  let clock = 0, jobs: CiJob[] = [job(MAC, "in_progress"), job(LINUX, "in_progress")]
  let runs = [{ ...run("push", "in_progress", null, CI_WORKFLOW, "t"), id: 7 }]
  const asked: string[] = []
  const ci = githubCi("main", async (api) => (asked.push(api), api.includes("/jobs") ? { jobs } : body(runs)), { budget: callBudget(100, () => clock), now: () => clock, gate: mac })
  check("its job running: the list, then the run's jobs", (await ci("Alice/lighthouse", "t")).state === "running" && asked.join() === "repos/Alice/lighthouse/actions/workflows/ci.yml/runs?branch=main&per_page=100,repos/Alice/lighthouse/actions/runs/7/jobs?per_page=50", asked)
  clock += LOOK_EVERY
  asked.length = 0
  jobs = [job(MAC, "completed", "success"), job(LINUX, "completed", "failure"), job("demo", "in_progress")]
  const pass = await ci("Alice/lighthouse", "t")
  check("the next look asks only the jobs (one call), and takes it once its job passed", asked.length === 1 && asked[0].endsWith("/runs/7/jobs?per_page=50") && pass.ok === true && pass.elsewhere?.join() === LINUX, { asked, pass })
  asked.length = 0
  runs = [{ ...run("push", "completed", "failure", CI_WORKFLOW, "r"), id: 8 }]
  jobs = [job(MAC, "completed", "failure"), job(LINUX, "completed", "success")]
  clock += LIST_GONE
  check("red: its job failed", (await ci("Alice/lighthouse", "r")).ok === false && asked.length === 2, asked)
  clock += 10 * 60_000
  asked.length = 0
  jobs = [job(MAC, "completed", "success"), job(LINUX, "completed", "success")]
  check("asked again after 10 minutes (a re-run): the list and the jobs again", (await ci("Alice/lighthouse", "r")).ok === true && asked.length === 2, asked)
  asked.length = 0
  runs = [{ ...run("push", "completed", "success", CI_WORKFLOW, "g"), id: 9 }]
  clock += LIST_GONE
  check("a run that passed whole: no jobs asked", (await ci("Alice/lighthouse", "g")).ok === true && asked.length === 1, asked)
})

await section(`the request budget: at most ${CI_CALLS_PER_HOUR} calls to GitHub in any hour, whatever the looks`, async () => {
  // Worst case: a look every LOOK_EVERY with a commit whose job never ends (its run's jobs, one call a look), plus vau
  // update asked in a loop: the budget holds it at CI_CALLS_PER_HOUR.
  check("an hour of timed looks fits the budget with one call each", 60 / (LOOK_EVERY / 60_000) <= CI_CALLS_PER_HOUR, LOOK_EVERY)
  check("the budget leaves most of GitHub's 60 anonymous calls an hour", CI_CALLS_PER_HOUR <= 20)
  for (const gate of [null, mac]) {
    let clock = 0, calls = 0
    const ci = githubCi("main", async (api) => (calls++, api.includes("/jobs") ? { jobs: [job(MAC, "in_progress")] } : body([{ ...run("push", "in_progress", null, CI_WORKFLOW, "t"), id: 3 }])),
      { budget: callBudget(CI_CALLS_PER_HOUR, () => clock), now: () => clock, gate })
    let last: CiResult = { ok: null, why: "" }
    for (let i = 0; i < 600; i++) { clock += 6_000; last = await ci("Alice/lighthouse", i % 3 ? "t" : `c${i}`) } // (a call every 6 s for an hour)
    check(`${gate ? "with" : "without"} a gate: an hour of looks every 6 seconds asks at most the budget`, calls === CI_CALLS_PER_HOUR, calls)
    check("…and says why it doesn't ask", last.ok === null && /asked again later/.test(last.why), last)
    clock += 3_600_000
    await ci("Alice/lighthouse", "t")
    check("…and asks again an hour on", calls === CI_CALLS_PER_HOUR + 1, calls)
  }
})

section("git.ts: capped")
check("a few in words, the rest counted", capped(["a"]) === "a" && capped(["a", "b"]) === "a and b" && capped(["a", "b", "c", "d", "e", "f", "g"]) === "a, b, c, d, e and 2 more"
  && capped(["a", "b"], 9) === "a, b and 7 more")

await section("git.ts: pickTarget", async () => {
  const passed: CiResult = { ok: true, why: "CI passed" }, running: CiResult = { ok: null, why: "CI is running on it" }
  // (the branch's commits after the checkout's, newest first: t is the tip)
  const since = ["t", "c3", "c2", "c1"]
  const pick = async (verdicts: Record<string, CiResult>, failed?: string) => {
    const asked: string[] = []
    let listed = 0
    const r = await pickTarget({ tip: "t", failed, since: async () => (listed++, since), ci: async (sha) => (asked.push(sha), verdicts[sha] ?? running) })
    return { r, asked, listed }
  }
  const tip = await pick({ t: passed })
  check("the tip once it passed, the commits not even listed", "to" in tip.r && tip.r.to === "t" && tip.listed === 0 && tip.asked.join() === "t", tip)
  const newest = await pick({ c2: passed, c1: passed })
  check("else the newest that passed", "to" in newest.r && newest.r.to === "c2" && newest.asked.join() === "t,c3,c2", newest)
  const none = await pick({})
  check("none passed: waits, saying why and naming the tip", "why" in none.r && none.r.why === "CI is running on it (t)", none)
  check("…with what CI said of each commit asked, the tip first", "judged" in none.r && none.r.judged.map((j) => j.commit).join() === "t,c3,c2,c1", none)
  const failed = await pick({ c1: passed }, "c2")
  check("never the commit that failed before, nor older", "why" in failed.r && failed.asked.join() === "t,c3", failed)
  const red = await pick({ t: { ok: false, why: "CI failed on it" }, c3: passed })
  check("a red tip: the newest before it that passed", "to" in red.r && red.r.to === "c3", red)
})

section("git.ts: redRoute")
const j = (commit: string, state?: "passed" | "failed" | "running" | "none" | "cancelled") => ({ commit, ok: state === "failed" ? false : null, ...(state ? { state } : {}) })
check("the tip itself red: that's the end of it", redRoute([j("t", "failed"), j("c1", "running")], "t") === "t")
check("an older commit with no run of its own under a red tip: red", redRoute([j("t", "failed"), j("c2", "none"), j("c1", "failed")], "c2") === "t")
check("a commit between still running: it may pass", redRoute([j("t", "failed"), j("c2", "running"), j("c1", "failed")], "c1") === null)
check("a tip still running over a red commit: the tip may bring it", redRoute([j("t", "running"), j("c1", "failed")], "c1") === null)
check("GitHub didn't say of one between: not known", redRoute([j("t", "failed"), j("c2"), j("c1", "none")], "c1") === null)
check("a commit not asked about: not known", redRoute([j("t", "failed")], "x") === null)

section("updater.ts: placed")
const at = { branch: "main", head: "h", remote: "r", running: "h" }
check("same commit, running it: current", placed({ ...at, remote: "h", relation: "same" })?.state === "current")
check("same commit, running an older one: goes on (built and restarted)", placed({ ...at, remote: "h", running: "o", relation: "same" }) === null)
check("behind: goes on", placed({ ...at, relation: "behind" }) === null)
const here = { count: 2, list: ["c0ffee1 feat(web): local one", "c0ffee2 fix(core): local two"] }
const ahead = placed({ ...at, relation: "ahead", here }), aheadOld = placed({ ...at, running: "o", relation: "ahead", here })
check("ahead: current when it runs the checkout's commit, else waits for the push", ahead?.state === "current" && aheadOld?.state === "waiting", { ahead, aheadOld })
check("ahead: names the commits not on the branch", /2 commits not on origin\/main \(c0ffee1 feat\(web\): local one and c0ffee2/.test(ahead?.why ?? "") && ahead?.blocked?.by === "unpushed" && ahead.blocked.commits?.length === 2, ahead)
const diverged = placed({ ...at, relation: "diverged", here, there: { count: 5, list: [] } })
check("diverged: a new failure on the branch's commit, to keep", diverged?.state === "failed" && diverged.fail === true && diverged.next === "r" && /diverged/.test(diverged.why), diverged)
check("diverged: says what the checkout has and origin has", /has 2 commits not on origin\/main \(c0ffee1.*\), origin has 5 it hasn't/.test(diverged?.why ?? "") && diverged?.blocked?.by === "diverged", diverged)
const error = { at: 1, commit: "r", message: "r didn't install or build" }
const again = placed({ ...at, relation: "diverged", failed: error, here }), behindAgain = placed({ ...at, relation: "behind", failed: error })
check("the commit that failed before: failed again, not kept anew, not tried", again?.state === "failed" && !again.fail && /diverged/.test(again.why) && again.blocked?.by === "diverged"
  && behindAgain?.state === "failed" && !behindAgain.fail && behindAgain.next === "r" && behindAgain.why === error.message, { again, behindAgain })
check("an older failure doesn't stop a newer commit", placed({ ...at, relation: "behind", failed: { ...error, commit: "x" } }) === null)

await exit(summary("updater", t0))
