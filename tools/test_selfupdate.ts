// A service install following a branch (core/selfupdate.ts on core/update/): on throwaway git repos, with CI, npm, the
// browser and the restart stood in for. In npm test.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { check, exit, section, summary, tempDir } from "./test/lib.ts"
import type { CiResult } from "../core/update/ci.ts"
import { checkForUpdate } from "../core/update/updater.ts"
import { backendChanged, inPlace, shadow } from "../core/selfupdate.ts"
import { gitEnv } from "../core/gitenv.ts"
const t0 = Date.now()

const tmp = tempDir("vaultite-selfupdate-test-")
// (as under a git hook or `git bisect run`: every git here, the test's and the updater's, still acts on its own folder)
const decoy = path.join(tmp, "decoy.git")
execFileSync("git", ["init", "--quiet", "--bare", decoy], { env: gitEnv() })
Object.assign(process.env, { GIT_DIR: decoy, GIT_WORK_TREE: tmp, GIT_INDEX_FILE: path.join(decoy, "index") })
const GH = "https://github.com/Alice/lighthouse.git"
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=Alice Park", "-c", "user.email=alice@example.com", ...args], { cwd, encoding: "utf8", stdio: "pipe", env: gitEnv() }).trim()
const origin = path.join(tmp, "origin.git"), dev = path.join(tmp, "dev"), server = path.join(tmp, "server")
execFileSync("git", ["init", "--quiet", "--bare", "-b", "main", origin], { env: gitEnv() })
execFileSync("git", ["clone", "--quiet", origin, dev], { stdio: "pipe", env: gitEnv() })
const commit = (files: Record<string, string>, msg: string) => {
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dev, f)), { recursive: true }); fs.writeFileSync(path.join(dev, f), text) }
  git(dev, "add", "-A"); git(dev, "commit", "--quiet", "-m", msg); git(dev, "push", "--quiet", "origin", "HEAD:main")
  return git(dev, "rev-parse", "HEAD")
}
const first = commit({ "server.ts": "1", "package-lock.json": "{}" }, "first")
execFileSync("git", ["clone", "--quiet", origin, server], { stdio: "pipe", env: gitEnv() })
// (origin reads as GitHub, as a real checkout's would, while it fetches from the folder)
git(server, "remote", "set-url", "origin", GH)
git(server, "config", `url.${origin}.insteadOf`, GH)
const head = () => git(server, "rev-parse", "HEAD")

let ci: CiResult = { ok: true, why: "CI passed" }, busy: string | null = null, restarts = 0, failBuild = false
let verdicts = new Map<string, CiResult>() // (a commit's own, else `ci`)
const npmCalls: string[] = [], logged: { line: string; error: boolean }[] = []
const o = inPlace({ log: (line, error) => { logged.push({ line, error: error !== undefined }) }, root: server, branch: "main", stateFile: path.join(tmp, "state", "selfupdate.json"),
  busy: async () => busy, restart: () => { restarts++ }, ci: async (repo, sha) => (repo === "Alice/lighthouse" ? verdicts.get(sha) ?? ci : { ok: false, why: `asked ${repo}` }),
  npm: async (args) => { npmCalls.push(args.join(" ")); if (failBuild && args[0] === "run") throw new Error("vite build failed") } })
const look = () => checkForUpdate(o)

await section("up to date, then a web-only update", async () => {
  check("current when origin has nothing newer", (await look()).state === "current")
  const next = commit({ "web/src/app.ts": "2" }, "feat(web): two")
  ci = { ok: null, why: "CI is running on it" }
  const s = await look()
  check("waits for CI, naming the commit", s.state === "waiting" && s.why.includes("CI is running") && s.next === next && head() === first, s)
  check("…and saying what CI said of it", s.ci?.length === 1 && s.ci[0].commit === next && s.ci[0].ok === null, s.ci)
  ci = { ok: true, why: "CI passed" }
  busy = "an agent's call is under way"
  const b = await look()
  check("waits while the browser is busy", b.state === "waiting" && b.why.includes("an agent's call") && head() === first, b)
  busy = null
  const u = await look()
  check("updates: fast-forwards and builds, no install (the lock didn't change)", u.state === "current" && head() === next && JSON.stringify(npmCalls) === '["run build"]', { u, npmCalls })
  check("the web app only: no restart", restarts === 0 && u.last?.restarted === false && u.last.from === first && u.last.to === next, u)
})

await section("pushed to faster than CI runs: the newest commit that passed", async () => {
  const passed: CiResult = { ok: true, why: "CI passed" }
  const a = commit({ "web/src/a.ts": "a" }, "feat(web): a"), b = commit({ "web/src/b.ts": "b" }, "feat(web): b")
  const c = commit({ "web/src/c.ts": "c" }, "feat(web): c")
  verdicts = new Map([[a, passed], [b, passed], [c, { ok: null, why: "CI is running on it" }]])
  const u = await look()
  check("updates to the newest that passed, not the tip CI still runs on", u.state === "current" && head() === b, u)
  const w = await look()
  check("…then waits for the tip", w.state === "waiting" && /CI is running/.test(w.why) && w.next === c && head() === b, w)
  verdicts.set(c, passed)
  check("…and takes it once it passed", (await look()).state === "current" && head() === c)
  verdicts = new Map()
})

await section("merged in the checkout itself (a squash merge on this machine): run once pushed", async () => {
  npmCalls.length = 0
  o.running = head()
  fs.mkdirSync(path.join(server, "core"), { recursive: true })
  fs.writeFileSync(path.join(server, "core/y.ts"), "local")
  git(server, "add", "-A"); git(server, "commit", "--quiet", "-m", "feat(server): merged here")
  const ahead = await look()
  check("not pushed yet: waits, naming the commit, nothing built", ahead.state === "waiting" && /1 commit not on origin\/main \(\w+ feat\(server\): merged here\)/.test(ahead.why)
    && ahead.blocked?.by === "unpushed" && !npmCalls.length, ahead)
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
  check("waits while the checkout has uncommitted changes, naming them", d.state === "waiting" && /uncommitted changes \(server\.ts\)/.test(d.why)
    && d.blocked?.by === "uncommitted" && d.blocked.files?.join() === "server.ts" && head() === before, d)
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
  check("…naming the checkout's own commit", /has 1 commit not on origin\/main \(\w+ local\), origin has 1 it hasn't/.test(d.why) && d.blocked?.by === "diverged", d)
})

await section("the log: each change of state or reason once, with the commits", async () => {
  git(server, "reset", "--quiet", "--hard", "origin/main")
  o.running = head()
  logged.length = 0
  await look(); await look()
  check("a look like the last says nothing", logged.length === 1 && /^vaultite: updates: current, up to date with origin\/main \(runs \w{7}, origin\/main \w{7}\)$/.test(logged[0].line), logged)
  const next = commit({ "web/src/log.ts": "1" }, "feat(web): log")
  ci = { ok: null, why: "CI is running on it" }
  await look(); await look()
  check("waiting, and why, once", logged.length === 2 && logged[1].line.includes(`waiting, CI is running on it (${next.slice(0, 7)})`), logged)
  ci = { ok: true, why: "CI passed" }
  await look()
  check("updating, then updated", logged.slice(2).map((l) => l.line.split(",")[0]).join() === "vaultite: updates: updating,vaultite: updates: current"
    && logged.at(-1)!.line.includes(`updated to ${next.slice(0, 7)}`), logged)
  failBuild = true
  commit({ "web/src/log.ts": "2" }, "feat(web): log two")
  await look(); await look()
  const failed = logged.filter((l) => / failed, /.test(l.line))
  check("a new failure once, as an error; the same again isn't logged", failed.length === 1 && failed[0].error && /didn't install or build/.test(failed[0].line), logged)
  failBuild = false
})

await section("taken on this OS's green while another's is red: said in the status and once in the log", async () => {
  const next = commit({ "web/src/elsewhere.ts": "1" }, "feat(web): elsewhere")
  verdicts.set(next, { ok: true, why: "CI's macOS tests passed", state: "passed", elsewhere: ["test (ubuntu-24.04)"] })
  logged.length = 0
  const u = await look(); await look()
  check("updated, naming the job red elsewhere", u.state === "current" && head() === next && /updated to \w+ \(the web app only\); CI is red on it elsewhere: test \(ubuntu-24\.04\)/.test(u.why)
    && u.last?.elsewhere?.join() === "test (ubuntu-24.04)", u)
  check("…once in the log", logged.filter((l) => l.line.includes("red on it elsewhere")).length === 1, logged)
  check("…and kept with the last update across a restart", JSON.parse(fs.readFileSync(o.stateFile, "utf8")).last?.elsewhere?.[0] === "test (ubuntu-24.04)")
  verdicts.delete(next)
})

await section("vau update: a look asked for while one runs joins it", async () => {
  let release = () => {}
  const gate = new Promise<void>((r) => { release = r })
  const slow = o.busy
  let looks = 0
  o.busy = async () => { looks++; await gate; return null }
  commit({ "web/src/join.ts": "1" }, "feat(web): join")
  const a = look(), b = look()
  release()
  const [ra, rb] = await Promise.all([a, b])
  check("one look, both callers get its answer", looks === 1 && ra === rb && ra.state === "current" && !ra.looking, { looks, ra })
  o.busy = slow
})

section("what restarts the server")
check("web/, the desktop app, tools and docs don't", !backendChanged(["web/src/a.ts", "plugins/core/x/index.tsx", "electron/main.ts", "tools/t.ts", "CHANGELOG.md", "web/dist/x.js"]))
check("core, plugins' backends, server.ts and dependencies do", ["core/a.ts", "plugins/core/x/plugin.ts", "server.ts", "package.json", "core/docs/design.md"].every((f) => backendChanged([f])))

await section("the module graph's answer beside it, said when they differ", async () => {
  const dir = tempDir("vaultite-shadow-test-")
  for (const [f, t] of Object.entries({ "server.ts": `import "./core/a.ts"`, "core/a.ts": "", "web/src/x.tsx": "" })) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t)
  }
  const lines: string[] = [], log = (l: string) => lines.push(l)
  await shadow(dir, ["web/src/x.tsx"], false, log)
  await shadow(dir, ["core/a.ts"], true, log)
  check("nothing when they agree", !lines.length, lines)
  await shadow(dir, ["core/a.ts"], false, log)
  await shadow(dir, ["core/docs/new.md"], true, log)
  check("both ways when they don't, with the files", lines.length === 2 && /would restart \(core\/a\.ts; server\.ts > core\/a\.ts\)/.test(lines[0])
    && /would not restart \(the server reaches none of core\/docs\/new\.md\)/.test(lines[1]), lines)
})

section("an inherited GIT_DIR")
const inDecoy = (...args: string[]) => execFileSync("git", ["--git-dir", decoy, ...args], { encoding: "utf8", env: gitEnv() })
check("no git run here touched the repository GIT_DIR named", !inDecoy("for-each-ref").trim() && /^count: 0$/m.test(inDecoy("count-objects", "-v"))
  && inDecoy("config", "core.bare").trim() === "true" && !fs.existsSync(path.join(decoy, "index")))

await exit(summary("selfupdate", t0))
