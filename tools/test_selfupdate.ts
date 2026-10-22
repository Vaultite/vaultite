// A service install following a branch (core/selfupdate.ts): on throwaway git repos, with CI, npm, the browser and the
// restart stood in for. In npm test.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { check, section, summary } from "./test/lib.ts"
import type { CiResult, UpdaterOptions } from "../core/selfupdate.ts"
const t0 = Date.now()

const U = await import("../core/selfupdate.ts")
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-selfupdate-test-"))
const GH = "https://github.com/Alice/lighthouse.git"
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=Alice Park", "-c", "user.email=alice@example.com", ...args], { cwd, encoding: "utf8", stdio: "pipe" }).trim()
const origin = path.join(tmp, "origin.git"), dev = path.join(tmp, "dev"), server = path.join(tmp, "server")
execFileSync("git", ["init", "--quiet", "--bare", "-b", "main", origin])
execFileSync("git", ["clone", "--quiet", origin, dev], { stdio: "pipe" })
const commit = (files: Record<string, string>, msg: string) => {
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dev, f)), { recursive: true }); fs.writeFileSync(path.join(dev, f), text) }
  git(dev, "add", "-A"); git(dev, "commit", "--quiet", "-m", msg); git(dev, "push", "--quiet", "origin", "HEAD:main")
  return git(dev, "rev-parse", "HEAD")
}
const first = commit({ "server.ts": "1", "package-lock.json": "{}" }, "first")
execFileSync("git", ["clone", "--quiet", origin, server], { stdio: "pipe" })
// (origin reads as GitHub, as a real checkout's would, while it fetches from the folder)
git(server, "remote", "set-url", "origin", GH)
git(server, "config", `url.${origin}.insteadOf`, GH)
const head = () => git(server, "rev-parse", "HEAD")

let ci: CiResult = { ok: true, why: "CI passed" }, busy: string | null = null, restarts = 0, failBuild = false
const npmCalls: string[] = []
const o: UpdaterOptions = { root: server, branch: "main", stateFile: path.join(tmp, "state", "selfupdate.json"),
  busy: async () => busy, restart: () => { restarts++ }, ci: async (repo) => (repo === "Alice/lighthouse" ? ci : { ok: false, why: `asked ${repo}` }),
  npm: async (args) => { npmCalls.push(args.join(" ")); if (failBuild && args[0] === "run") throw new Error("vite build failed") } }
const look = () => U.checkForUpdate(o)

await section("up to date, then a web-only update", async () => {
  check("current when origin has nothing newer", (await look()).state === "current")
  const next = commit({ "web/src/app.ts": "2" }, "feat(web): two")
  ci = { ok: null, why: "CI is running on it" }
  const s = await look()
  check("waits for CI, naming the commit", s.state === "waiting" && s.why.includes("CI is running") && s.next === next && head() === first, s)
  ci = { ok: true, why: "CI passed" }
  busy = "an agent's call is under way"
  const b = await look()
  check("waits while the browser is busy", b.state === "waiting" && b.why.includes("an agent's call") && head() === first, b)
  busy = null
  const u = await look()
  check("updates: fast-forwards and builds, no install (the lock didn't change)", u.state === "current" && head() === next && JSON.stringify(npmCalls) === '["run build"]', { u, npmCalls })
  check("the web app only: no restart", restarts === 0 && u.last?.restarted === false && u.last.from === first && u.last.to === next, u)
})

await section("merged in the checkout itself (a squash merge on this machine): run once pushed", async () => {
  npmCalls.length = 0
  o.running = head()
  fs.mkdirSync(path.join(server, "core"), { recursive: true })
  fs.writeFileSync(path.join(server, "core/y.ts"), "local")
  git(server, "add", "-A"); git(server, "commit", "--quiet", "-m", "feat(server): merged here")
  const ahead = await look()
  check("not pushed yet: waits, nothing built", ahead.state === "waiting" && /ahead of origin/.test(ahead.why) && !npmCalls.length, ahead)
  git(server, "push", "--quiet", origin, "HEAD:main")
  git(dev, "pull", "--quiet", "origin", "main")
  const r0 = restarts
  const u = await look()
  check("pushed, CI passed: built and restarted though the checkout already had it", u.state === "current" && JSON.stringify(npmCalls) === '["run build"]' && restarts === r0 + 1, { u, npmCalls })
  check("… and then current", (await look()).state === "current" && restarts === r0 + 1)
})

await section("a backend update with new dependencies restarts", async () => {
  npmCalls.length = 0
  const r0 = restarts
  const next = commit({ "core/x.ts": "3", "package-lock.json": '{"v":3}' }, "feat(server): three")
  const u = await look()
  check("installs (the lock changed), then builds", JSON.stringify(npmCalls) === '["install --no-audit --no-fund","run build"]', npmCalls)
  check("restarts for a backend change", restarts === r0 + 1 && u.last?.restarted === true && head() === next, u)
  check("what it did lasts across a restart", JSON.parse(fs.readFileSync(o.stateFile, "utf8")).last?.to === next)
})

await section("never half-updated", async () => {
  const before = head()
  fs.writeFileSync(path.join(server, "server.ts"), "mine")
  commit({ "core/y.ts": "4" }, "feat(server): four")
  const d = await look()
  check("waits while the checkout has uncommitted changes", d.state === "waiting" && /uncommitted/.test(d.why) && head() === before, d)
  git(server, "checkout", "--", "server.ts")
  ci = { ok: false, why: "CI failed on it" }
  check("waits on red CI", (await look()).state === "waiting" && head() === before)
  ci = { ok: true, why: "CI passed" }
  failBuild = true
  npmCalls.length = 0
  const f = await look()
  check("a build that fails goes back to the commit before, built again", f.state === "failed" && head() === before && JSON.stringify(npmCalls) === '["run build","run build"]', { f, npmCalls })
  check("the failure is kept, naming the commit", /didn't install or build/.test(f.error?.message ?? "") && f.error?.commit === git(dev, "rev-parse", "HEAD"), f.error)
  failBuild = false
  npmCalls.length = 0
  check("that commit isn't tried again", (await look()).state === "failed" && !npmCalls.length && head() === before)
  const next = commit({ "core/y.ts": "5" }, "fix(server): five")
  check("a newer one is", (await look()).state === "current" && head() === next)
})

await section("what it won't update", async () => {
  git(server, "checkout", "--quiet", "-b", "mine")
  check("a checkout on another branch waits", /on mine, not main/.test((await look()).why))
  git(server, "checkout", "--quiet", "main")
  fs.writeFileSync(path.join(server, "local.txt"), "x"); git(server, "add", "local.txt"); git(server, "commit", "--quiet", "-m", "local")
  commit({ "core/z.ts": "6" }, "feat(server): six")
  const d = await look()
  check("diverged from origin: failed, nothing changed", d.state === "failed" && /diverged/.test(d.why) && fs.existsSync(path.join(server, "local.txt")), d)
})

section("the pieces")
check("githubRepo: https and ssh remotes", U.githubRepo("git@github.com:Vaultite/vaultite.git") === "Vaultite/vaultite" && U.githubRepo("https://github.com/Vaultite/vaultite") === "Vaultite/vaultite" && U.githubRepo("/srv/x.git") === null)
const run = (event: string, status: string, conclusion: string | null, p = U.CI_WORKFLOW) => ({ path: p, event, status, conclusion })
check("ci: a push run that passed is green", U.ciOf([run("push", "completed", "success")]).ok === true)
check("ci: the nightly counts as main's", U.ciOf([run("push", "completed", "failure"), run("schedule", "completed", "success")]).ok === true)
check("ci: a dispatched QA run doesn't", U.ciOf([run("workflow_dispatch", "completed", "success")]).ok === null)
check("ci: another workflow doesn't", U.ciOf([run("push", "completed", "success", ".github/workflows/release.yml")]).ok === null)
check("ci: running is not yet, failed is red", U.ciOf([run("push", "in_progress", null)]).ok === null && U.ciOf([run("push", "completed", "failure")]).ok === false)
check("backend: web/, the desktop app, tools and docs don't restart the server", !U.backendChanged(["web/src/a.ts", "plugins/core/x/index.tsx", "electron/main.ts", "tools/t.ts", "CHANGELOG.md", "web/dist/x.js"]))
check("backend: core, plugins' backends, server.ts and dependencies do", ["core/a.ts", "plugins/core/x/plugin.ts", "server.ts", "package.json", "core/docs/design.md"].every((f) => U.backendChanged([f])))

fs.rmSync(tmp, { recursive: true, force: true })
process.exit(summary("selfupdate", t0))
