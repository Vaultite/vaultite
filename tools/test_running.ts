// What a server runs and whether a commit is live (core/running.ts, core/webbuild.ts, app.version's verdict): on a
// throwaway git repo and build folder. In npm test.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { check, exit, section, sleep, summary, tempDir, waitFor } from "./test/lib.ts"
import { stampIn, stampOf, stampText } from "../core/buildstamp.ts"
import { gitEnv } from "../core/gitenv.ts"
import { isHash, runningIn } from "../core/running.ts"
import type { UpdateStatus } from "../core/update/updater.ts"
import { verdict, versionOps } from "../core/coreops/version.ts"
import { webBuilds } from "../core/webbuild.ts"
const t0 = Date.now()

const tmp = tempDir("vaultite-running-test-")
const repo = path.join(tmp, "repo"), dist = path.join(repo, "web", "dist")
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Alice Park", "-c", "user.email=alice@example.com", ...args], { cwd: repo, encoding: "utf8", stdio: "pipe", env: gitEnv() }).trim()
fs.mkdirSync(repo, { recursive: true })
git("init", "--quiet", "-b", "main")
const commit = (files: Record<string, string>, msg: string) => {
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), text) }
  git("add", "-A"); git("commit", "--quiet", "-m", msg)
  return git("rev-parse", "HEAD")
}
/** A build of `sha` in web/dist, as vite.config.ts writes one: its entry and stamp. */
const build = (entry: string, sha: string | null, subject = "a subject") => {
  fs.mkdirSync(dist, { recursive: true })
  const meta = sha ? `<meta name="vaultite-build" content="${stampText({ commit: sha, at: 1_700_000_000_000, subject }).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">` : ""
  fs.writeFileSync(path.join(dist, "index.html"), `<!doctype html><html><head>${meta}<script type="module" crossorigin src="./assets/${entry}"></script><link rel="stylesheet" href="./assets/index-1.css"></head></html>`)
}

section("the stamp")
const s = { commit: "a".repeat(40), at: 1_700_000_000_000, subject: 'fix(web): "quotes" & <tags>' }
check("its text reads back", JSON.stringify(stampOf(stampText(s))) === JSON.stringify(s), stampOf(stampText(s)))
check("as an index.html says it (escaped)", stampIn(`<meta name="vaultite-build" content="${stampText(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}">`)?.subject === s.subject)
check("none, or not one: null", stampIn("<html></html>") === null && stampOf("main 12 x") === null)

await section("the build served", async () => {
  build("index-A.js", null)
  const b = webBuilds(dist, 50)
  check("its entry, the files it starts with", b.read().entry === "index-A.js" && b.read().eager.length === 2 && b.read().stamp === null, b.read())
  const heard: string[] = []
  const off = b.on((x) => heard.push(x.entry!))
  await sleep(150)
  check("listening tells nothing until it changes", heard.length === 0)
  build("index-B.js", "b".repeat(40))
  check("a new build is told once", !!(await waitFor(() => heard.length === 1, 3000, 25)) && heard[0] === "index-B.js", heard)
  check("with its stamp", b.read().stamp?.commit === "b".repeat(40))
  fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html>") // (half written)
  await sleep(450)
  build("index-B.js", "b".repeat(40))
  await sleep(450)
  check("one written again, or half written, isn't news", heard.length === 1, heard)
  off()
  build("index-C.js", null)
  await sleep(450)
  check("nothing heard once nobody listens", heard.length === 1, heard)
})

await section("the commit it runs", async () => {
  const a = commit({ "server.ts": "1", "web/src/a.tsx": "1" }, "first")
  build("index-A.js", a)
  const r = runningIn(repo, webBuilds(dist).read)
  const at = await r.running()
  check("the one it started on, with its subject", at.commit === a && at.subject === "first" && at.branch === "main" && at.web.commit === a, at)
  const b = commit({ "web/src/a.tsx": "2" }, "feat(web): two")
  build("index-B.js", b, "feat(web): two")
  const web = await r.running()
  check("after a web-only update, the web build's", web.commit === b && web.subject === "feat(web): two" && web.startedOn === a, web)
  const c = commit({ "core/x.ts": "3" }, "feat(server): three")
  build("index-C.js", c)
  const back = await r.running()
  check("built from one that changes the server: still the one it started on, till it restarts", back.commit === a && back.web.commit === c, back)
  check("has: itself and what came before it", await r.contains(b, a) === true && await r.contains(b, b.slice(0, 7)) === true)
  check("not what came after", await r.contains(a, b) === false)
  check("a short hash in full, an unknown one null", await r.resolve(b.slice(0, 7)) === b && await r.resolve(b.toUpperCase()) === b && await r.resolve("deadbeef") === null)
  check("never a name: HEAD, a branch, a relative ref, an option", await r.resolve("HEAD") === null && await r.resolve("main") === null && await r.resolve(`${c}~1`) === null && await r.resolve("--all") === null)
  git("branch", "feedfacecafe", a)
  check("a branch named like a hash isn't taken for one", await r.resolve("feedfacecafe") === null)
  check("a short hash naming one commit isn't ambiguous", await r.ambiguous(b.slice(0, 7)) === false && await r.ambiguous(b) === false)
  check("isHash: hashes only", isHash(b) && isHash(b.slice(0, 4)) && !isHash("HEAD") && !isHash("main") && !isHash("abc") && !isHash(`${b.slice(0, 7)}^`) && !isHash("v1.2.0"))
  const none = runningIn(path.join(tmp, "nowhere"), () => ({ entry: null, eager: [], stamp: null }))
  check("not a checkout: unknown", (await none.running()).commit === null && await none.contains("a".repeat(40), "b".repeat(40)) === null)
  check("… and whether a process runs older code, unknown", (await none.processes([{ id: "server", commit: a }]))[0].stale === null)
})

await section("whether each process runs older code (the module graph)", async () => {
  const sha = commit({ "server.ts": `import "./core/a.ts"`, "core/a.ts": "export const a = 1", "web/src/x.tsx": "", "README.md": "" }, "graph")
  const r = runningIn(repo, () => ({ entry: null, eager: [], stamp: null }))
  const ask = () => r.processes([{ id: "server", commit: sha }, { id: "desktop", commit: null }, { id: "helper", commit: "f".repeat(40) }])
  fs.writeFileSync(path.join(repo, "README.md"), "more"); fs.writeFileSync(path.join(repo, "web/src/x.tsx"), "more")
  let [server, app, helper] = await ask()
  check("what the server doesn't reach changed: not stale", server.stale === false && server.label === "Server", server)
  check("a process that didn't say its commit, or one this checkout hasn't: can't say, and why", app.stale === null && !!app.why && helper.stale === null && /doesn't have/.test(helper.why ?? ""), [app, helper])
  fs.writeFileSync(path.join(repo, "core/a.ts"), "export const a = 2") // (uncommitted: what the disk has is what a restart runs)
  ;[server] = await ask()
  check("a file it reaches changed: stale, saying which and how", server.stale === true && server.first === "core/a.ts" && server.chain?.join(">") === "server.ts>core/a.ts", server)
  git("checkout", "--", ".")
})

await section("app.version asks about a hash only", async () => {
  const op = versionOps()[0], ctx = { who: { client: "cli" } } as Parameters<typeof op.run>[1]
  const refused = async (p: Record<string, unknown>) => { try { await op.run(p, ctx); return "" } catch (e) { return String((e as Error).message) } }
  for (const name of ["HEAD", "main", "v1.2.0", "HEAD~1", "origin/main"]) {
    const why = await refused({ commit: name })
    check(`refuses ${name}, saying to give a hash or use a current vau`, /`commit` is a commit's hash/.test(why) && why.includes(`git rev-parse ${name}`) && /current vau/.test(why), why)
  }
  const fwd = await refused({ commit: "HEAD", machine: "studio", wait: true })
  check("before passing it on to another machine too", /`commit` is a commit's hash/.test(fwd), fwd)
})

section("is it live")
const full = "c".repeat(40), runs = "d".repeat(40)
const following = (state: UpdateStatus["state"], why: string, more: Partial<UpdateStatus> = {}): UpdateStatus => ({ branch: "main", state, why, checked: Date.now(), ...more })
const off: UpdateStatus = { branch: null, state: "off", why: "", checked: null }
const v = (o: Partial<Parameters<typeof verdict>[0]>) => verdict({ given: "ccccccc", full, runs, has: false, failed: false, updates: following("current", "up to date"), app: null, ...o })
check("in what it runs: live", v({ has: true }).live && /is live here: it runs ddddddd, which has it/.test(v({ has: true }).why), v({ has: true }))
check("what it runs itself: live", v({ runs: full, has: null }).live)
check("waiting on CI: not yet, and why", ((x) => !x.live && !x.final && /isn't live here yet: updates waiting: CI hasn't passed/.test(x.why))(v({ updates: following("waiting", "CI hasn't passed (ccccccc)") })))
check("not fetched yet: not yet", ((x) => !x.final && /doesn't have it yet/.test(x.why))(v({ full: null })))
check("its update failed: it won't be", ((x) => !x.live && x.final && /won't be live here: its update failed: didn't build/.test(x.why))(v({ failed: true, updates: following("failed", "x", { error: { at: 1, commit: full, message: "didn't build" } }) })))
check("an older one failed: still on its way", !v({ failed: false, updates: following("failed", "x", { error: { at: 1, commit: runs, message: "no" } }) }).final)
const dirty = following("waiting", "the checkout has uncommitted changes (core/a.ts and web/b.ts): it updates once they're committed or undone", { blocked: { by: "uncommitted", files: ["core/a.ts", "web/b.ts"] } })
check("a checkout with uncommitted changes: it won't be, naming them", ((x) => !x.live && x.final && /won't be live here: its checkout blocks the updates: the checkout has uncommitted changes \(core\/a\.ts and web\/b\.ts\)/.test(x.why))(v({ updates: dirty })))
const ahead = following("current", "the checkout runs 1 commit not on origin/main (eeeeeee local): updates go on once they're pushed", { blocked: { by: "unpushed", commits: ["eeeeeee local"] } })
check("commits not on the branch: it won't be, naming them", ((x) => x.final && /eeeeeee local/.test(x.why))(v({ updates: ahead })))
const diverged = following("failed", "the checkout and origin/main have diverged, so it can't fast-forward: the checkout has 1 commit not on origin/main (eeeeeee local)", { blocked: { by: "diverged", commits: ["eeeeeee local"] } })
check("diverged: it won't be", ((x) => x.final && /diverged/.test(x.why))(v({ updates: diverged })))
const elsewhere = following("waiting", "the checkout is on fix, not main: it updates once main is checked out again", { blocked: { by: "branch" } })
check("another branch checked out: it won't be, even before it has the commit", v({ updates: elsewhere }).final && v({ updates: elsewhere, full: null }).final)
check("blocked before it has the commit: the next look decides", !v({ updates: dirty, full: null }).final)
const red = (ci: UpdateStatus["ci"]) => following("waiting", "CI failed on it (ccccccc)", { ci })
check("CI failed on it: it won't be", ((x) => x.final && /won't be live here: CI failed on it: it goes live with a fix CI passes/.test(x.why))(v({ updates: red([{ commit: full, ok: false, state: "failed" }]) })))
const tip = "e".repeat(40)
check("CI failed on the newest commit with it, none between ran: it won't be, naming that commit", ((x) => x.final && /CI failed on eeeeeee, the newest commit with it/.test(x.why))(
  v({ updates: red([{ commit: tip, ok: false, state: "failed" }, { commit: full, ok: null, state: "none" }]) })))
check("a newer commit with it still running: on its way", !v({ updates: red([{ commit: tip, ok: null, state: "running" }, { commit: full, ok: false, state: "failed" }]) }).final)
check("busy: still on its way", !v({ updates: following("waiting", "busy: an agent is at work in the browser") }).final)
check("no updates here: it won't be", ((x) => x.final && /doesn't update itself/.test(x.why))(v({ updates: off })))
const app = { mode: "automatic" as const, available: true, from: "main", ready: null, doing: null }
check("the desktop app's, automatic: on its way", !v({ updates: off, app }).final)
check("off, or notify (someone must restart it): it won't be by itself", v({ updates: off, app: { ...app, mode: "off" } }).final && v({ updates: off, app: { ...app, mode: "notify" } }).final)

await exit(summary("running", t0))
