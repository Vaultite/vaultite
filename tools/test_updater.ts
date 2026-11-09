// The update engine's decisions (core/update/): CI's verdict, the commit to take, where a checkout stands. No git, no
// network: the host's path end to end is test_selfupdate. In npm test.
import { check, exit, section, summary } from "./test/lib.ts"
import type { CiResult, CiRun } from "../core/update/ci.ts"
import { CI_WORKFLOW, ciOf, githubCi, githubRepo } from "../core/update/ci.ts"
import { pickTarget } from "../core/update/git.ts"
import { placed } from "../core/update/updater.ts"
const t0 = Date.now()

section("ci.ts")
check("githubRepo: https and ssh remotes", githubRepo("git@github.com:Vaultite/vaultite.git") === "Vaultite/vaultite" && githubRepo("https://github.com/Vaultite/vaultite") === "Vaultite/vaultite" && githubRepo("/srv/x.git") === null)
const run = (event: string, status: string, conclusion: string | null, p = CI_WORKFLOW, sha?: string): CiRun => ({ path: p, event, status, conclusion, head_sha: sha })
check("a push run that passed is green", ciOf([run("push", "completed", "success")]).ok === true)
check("the nightly counts as main's", ciOf([run("push", "completed", "failure"), run("schedule", "completed", "success")]).ok === true)
check("a dispatched QA run doesn't", ciOf([run("workflow_dispatch", "completed", "success")]).ok === null)
check("another workflow doesn't", ciOf([run("push", "completed", "success", ".github/workflows/release.yml")]).ok === null)
check("running is not yet, failed is red", ciOf([run("push", "in_progress", null)]).ok === null && ciOf([run("push", "completed", "failure")]).ok === false)
check("cancelled is not yet", ciOf([run("push", "completed", "cancelled")]).ok === null)

await section("githubCi: one call for the branch, one more per commit not in it", async () => {
  const asked: string[] = []
  const ci = githubCi("main", async (api) => {
    asked.push(api)
    if (api.includes("/workflows/")) return [run("push", "completed", "success", CI_WORKFLOW, "aaa")]
    return api.includes("head_sha=ccc") ? "GitHub answered 403 about CI" : [run("push", "in_progress", null, CI_WORKFLOW, "bbb")]
  })
  const a = await ci("Alice/lighthouse", "aaa"), a2 = await ci("Alice/lighthouse", "aaa")
  check("a commit among the branch's runs", a.ok === true && a2.ok === true && asked.length === 1, asked)
  check("the branch's runs asked of once, by workflow and branch", asked[0] === "repos/Alice/lighthouse/actions/workflows/ci.yml/runs?branch=main&per_page=100", asked)
  check("one not among them asked of on its own", (await ci("Alice/lighthouse", "bbb")).ok === null && asked[1] === "repos/Alice/lighthouse/actions/runs?head_sha=bbb&per_page=50", asked)
  const c = await ci("Alice/lighthouse", "ccc")
  check("GitHub not answering is not yet, saying why", c.ok === null && /403/.test(c.why), c)
})

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
  const failed = await pick({ c1: passed }, "c2")
  check("never the commit that failed before, nor older", "why" in failed.r && failed.asked.join() === "t,c3", failed)
  const red = await pick({ t: { ok: false, why: "CI failed on it" }, c3: passed })
  check("a red tip: the newest before it that passed", "to" in red.r && red.r.to === "c3", red)
})

section("updater.ts: placed")
const at = { branch: "main", head: "h", remote: "r", running: "h" }
check("same commit, running it: current", placed({ ...at, remote: "h", relation: "same" })?.state === "current")
check("same commit, running an older one: goes on (built and restarted)", placed({ ...at, remote: "h", running: "o", relation: "same" }) === null)
check("behind: goes on", placed({ ...at, relation: "behind" }) === null)
const ahead = placed({ ...at, relation: "ahead" }), aheadOld = placed({ ...at, running: "o", relation: "ahead" })
check("ahead: current when it runs the checkout's commit, else waits for the push", ahead?.state === "current" && aheadOld?.state === "waiting" && /ahead of origin\/main/.test(ahead.why), { ahead, aheadOld })
const diverged = placed({ ...at, relation: "diverged" })
check("diverged: a new failure on the branch's commit, to keep", diverged?.state === "failed" && diverged.fail === true && diverged.next === "r" && /diverged/.test(diverged.why), diverged)
const error = { at: 1, commit: "r", message: "r didn't install or build" }
const again = placed({ ...at, relation: "diverged", failed: error }), behindAgain = placed({ ...at, relation: "behind", failed: error })
check("the commit that failed before: failed again, not kept anew, not tried", again?.state === "failed" && !again.fail && again.why === error.message
  && behindAgain?.state === "failed" && !behindAgain.fail && behindAgain.next === "r", { again, behindAgain })
check("an older failure doesn't stop a newer commit", placed({ ...at, relation: "behind", failed: { ...error, commit: "x" } }) === null)

await exit(summary("updater", t0))
