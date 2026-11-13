// What a server runs and whether a commit is live (core/running.ts, core/webbuild.ts, app.version's verdict): on a
// throwaway git repo and build folder. In npm test.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { type Any, check, exit, section, sleep, summary, tempDir, waitFor } from "./test/lib.ts"
import { stampIn, stampOf, stampText } from "../core/buildstamp.ts"
import { gitEnv } from "../core/gitenv.ts"
import { isHash, runningIn } from "../core/running.ts"
import type { UpdateStatus } from "../core/contracts/version.ts"
import { processList, verdict, versionOps, waitFor as waitLive } from "../core/coreops/version.ts"
import { Ctx, execute } from "../core/cli.ts"
import { entryOf } from "../core/ops.ts"
import http from "node:http"
import type net from "node:net"
import { webBuilds } from "../core/webbuild.ts"
import { giveGraph } from "../core/update/graph.ts"
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
  const late = path.join(tmp, "late"), lateGit = (...args: string[]) => execFileSync("git", ["-c", "user.name=Alice Park", "-c", "user.email=alice@example.com", ...args], { cwd: late, encoding: "utf8", stdio: "pipe", env: gitEnv() }).trim()
  fs.mkdirSync(late)
  const unsure = runningIn(late, webBuilds(path.join(late, "dist")).read)
  check("git not able to say as it started: no commit", (await unsure.running()).commit === null)
  lateGit("init", "--quiet", "-b", "main"); fs.writeFileSync(path.join(late, "a.txt"), "1"); lateGit("add", "-A"); lateGit("commit", "--quiet", "-m", "late")
  check("…nor a commit made after it started: that isn't the code it loaded", (await unsure.running()).commit === null)
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
  const without = (await ask())[0]
  check("no graph given by the host (the web demo): can't say, and why", without.stale === null && /no module graph/.test(without.why ?? ""), without)
  giveGraph(() => import("../core/update/closure.ts")) // (as server.ts does)
  fs.writeFileSync(path.join(repo, "README.md"), "more"); fs.writeFileSync(path.join(repo, "web/src/x.tsx"), "more")
  let [server, app, helper] = await ask()
  check("what the server doesn't reach changed: not stale", server.stale === false && server.label === "Server", server)
  check("a process that didn't say its commit, or one this checkout hasn't: can't say, and why", app.stale === null && !!app.why && helper.stale === null && /doesn't have/.test(helper.why ?? ""), [app, helper])
  fs.writeFileSync(path.join(repo, "core/a.ts"), "export const a = 2") // (uncommitted: what the disk has is what a restart runs)
  ;[server] = await ask()
  check("a file it reaches changed: stale, saying which and how", server.stale === true && server.first === "core/a.ts" && server.chain?.join(">") === "server.ts>core/a.ts", server)
  git("checkout", "--", ".")
})

await section("whether each part runs a commit: it, or older code its change doesn't reach", async () => {
  // (the graph given above, as server.ts does; server.ts reaches core/a.ts)
  const base = commit({ "web/index.html": `<script type="module" src="./src/x.tsx"></script>`, "web/src/x.tsx": "1", "electron/shell/boot.mjs": "" }, "base")
  const r = runningIn(repo, webBuilds(dist).read)
  const startedOnBase = await r.running()
  const web = commit({ "web/src/x.tsx": "2", "vite.config.ts": "export default {}", "CHANGELOG.md": "- two" }, "fix(web): two")
  const server = commit({ "core/a.ts": "export const a = 3" }, "fix(server): three")
  const of = async (sha: string, code: string, built: string) => Object.fromEntries((await r.runsOf(sha, [{ id: "server", commit: code }, { id: "web", commit: built },
    { id: "desktop", commit: null }])).map((p) => [p.id, p]))
  let x = await of(web, base, web)
  check("a web-only commit taken in place: the web app runs it, the server older code it doesn't change, the desktop app too", x.web.runs === "it" && x.server.runs === "untouched" && x.desktop.runs === "untouched", x)
  check("it started on the commit HEAD was then", startedOnBase.startedOn === base, startedOnBase)
  x = await of(web, base, base)
  check("… a web app built before it: older, naming the file", x.web.runs === "older" && x.web.file === "vite.config.ts", x)
  x = await of(server, base, server)
  check("a server commit the server hasn't restarted onto: older, naming the file", x.server.runs === "older" && x.server.file === "core/a.ts" && x.web.runs === "it", x)
  check("… once it has: it", (await of(server, server, server)).server.runs === "it")
  const desk = commit({ "electron/shell/boot.mjs": "// one" }, "fix(desktop): one")
  check("a desktop commit with a desktop app that didn't say its commit: can't say", (await of(desk, desk, desk)).desktop.runs === "unknown")
  build("index-W.js", web, "fix(web): two")
  check("running: built from a commit whose changes the server doesn't reach (vite.config.ts, by the graph), that commit", (await r.running()).commit === web, await r.running())
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
type Part = Parameters<typeof verdict>[0]["parts"][number]
const LABELS: Record<string, string> = { server: "Server", web: "Web app", desktop: "Desktop app", helper: "Menu-bar helper" }
const part = (id: string, ran: Part["runs"], sha: string | null = runs, file?: string): Part => ({ id, label: LABELS[id], commit: sha, runs: ran, ...(file ? { file } : {}) })
const v = (o: Partial<Parameters<typeof verdict>[0]>) => verdict({ given: "ccccccc", full, parts: [part("server", "older", runs, "core/a.ts")], taken: false, failed: false,
  updates: following("current", "up to date"), app: null, ...o })
check("in what it runs: live", v({ parts: [part("server", "it")], taken: true }).live && /is live here: server runs ddddddd, which has it/.test(v({ parts: [part("server", "it")], taken: true }).why))
check("what it runs itself: live", v({ parts: [part("server", "it", full)], taken: true }).live)
{
  // (seen live: the web build taken in place, no restart, the server on the commit before; a desktop app far behind)
  const desktop = { mode: "automatic" as const, available: true, from: "main", ready: "b".repeat(40), doing: null }
  const webOnly = [part("server", "untouched"), part("web", "it", full), part("desktop", "untouched", "a".repeat(40)), part("helper", "untouched", "a".repeat(40))]
  const x = v({ parts: webOnly, taken: true, app: desktop })
  check("a web-only commit its web app runs, the server not restarted: live, saying the server's code is the same", x.live && x.outcome === "live"
    && /is live here: server runs ddddddd, which it doesn't change; web app runs it; desktop app runs aaaaaaa, which it doesn't change/.test(x.why), x)
  const server = v({ parts: [part("server", "older", runs, "core/a.ts"), part("web", "it", full)], taken: true, updates: following("updating", "ccccccc is built; the server restarts once the browser is quiet") })
  check("a server commit built, its restart waiting: not yet, saying what the server runs", !server.live && !server.final && /updates updating: .*\(server runs ddddddd, before it, and it changes core\/a\.ts\)/.test(server.why), server)
  const desk = v({ parts: [part("server", "untouched"), part("web", "untouched"), part("desktop", "older", "a".repeat(40), "electron/main.ts")], taken: true, app: desktop })
  check("a desktop commit beside a service: not yet, the desktop app's updates saying why", !desk.live && !desk.final
    && /isn't live here yet: desktop app runs aaaaaaa, before it, and it changes electron\/main\.ts; the desktop app updates by itself: bbbbbbb ready/.test(desk.why), desk)
  check("… one that offers restarts: it won't be by itself", v({ parts: [part("desktop", "older", "a".repeat(40), "electron/main.ts")], taken: true, app: { ...desktop, mode: "notify" } }).final)
  const helper = v({ parts: [part("server", "untouched"), part("helper", "older", "a".repeat(40), "electron/helper.ts")], taken: true, app: desktop })
  check("what's behind and how it catches up, said apart from the words (the companion's plain ones)", helper.behind?.part === "helper" && helper.behind.by === "itself"
    && desk.behind?.part === "desktop" && v({ parts: [part("desktop", "older", "a".repeat(40), "electron/main.ts")], taken: true, app: { ...desktop, mode: "notify" } }).behind?.by === "restart"
    && server.behind?.part === "server" && server.behind.by === "itself" && !x.behind, [helper.behind, desk.behind, server.behind])
  check("a commit reaching nothing that runs, not taken yet: not yet, the updates saying why", ((y) => !y.live && /updates waiting: CI is running/.test(y.why))(
    v({ parts: [part("server", "untouched")], taken: false, updates: following("waiting", "CI is running on it") })))
  check("… taken: live", v({ parts: [part("server", "untouched")], taken: true }).live)
}
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
check("CI failed on it: it won't be, naming the red commit", ((x) => x.final && x.red === full && /won't be live here: CI failed on it: it goes live with a fix CI passes/.test(x.why))(v({ updates: red([{ commit: full, ok: false, state: "failed" }]) })))
check("blocked: it won't be, and no red", ((x) => x.final && !x.red)(v({ updates: dirty })))
const tip = "e".repeat(40)
check("CI failed on the newest commit with it, none between ran: it won't be, naming that commit", ((x) => x.final && /CI failed on eeeeeee, the newest commit with it/.test(x.why))(
  v({ updates: red([{ commit: tip, ok: false, state: "failed" }, { commit: full, ok: null, state: "none" }]) })))
check("a newer commit with it still running: on its way", !v({ updates: red([{ commit: tip, ok: null, state: "running" }, { commit: full, ok: false, state: "failed" }]) }).final)
check("busy: still on its way", !v({ updates: following("waiting", "busy: an agent is at work in the browser") }).final)
check("no updates here: it won't be", ((x) => x.final && /doesn't update itself/.test(x.why) && x.behind?.by === "never")(v({ updates: off })))
const app = { mode: "automatic" as const, available: true, from: "main", ready: null, doing: null }
check("the desktop app's, automatic: on its way", !v({ updates: off, app }).final)
check("a menu-bar helper reloaded onto a newer root: its own commit, not the main process's (an older app's: the main process's)",
  processList(full, { ...app, commit: runs, helper: true, helperCommit: full }).find((p) => p.id === "helper")?.commit === full
  && processList(full, { ...app, commit: runs, helper: true }).find((p) => p.id === "helper")?.commit === runs)
check("off, or notify (someone must restart it): it won't be by itself", v({ updates: off, app: { ...app, mode: "off" } }).final && v({ updates: off, app: { ...app, mode: "notify" } }).final)

section("vau version's text")
{
  const op = versionOps()[0], base = { version: "0.1.0", api: 9, commit: full, branch: null, updates: off, app: null, pid: 1, started: 0 }
  const dev = op.text!({ ...base, app: { mode: "notify", available: true, from: "worktree", ready: null, doing: null, commit: full, worktree: { worktree: "lighthouse-fix", branch: "fix", commit: full, dirty: true } } }, {})
  check("a Dev instance: its worktree, branch and commit, and whether it has changes", dev.split("\n")[1] === "Worktree: lighthouse-fix, fix@ccccccc, with changes not committed", dev)
  check("none otherwise", !op.text!(base, {}).includes("Worktree"))
}

// A wait through the server's restart: the call cut, the server refusing, its proxy's empty 502, then the new server.
// vau and a machine's wait ride it out in the timeout, or say why not. A step a call (sent again after 3 s; machine's 5 s).
type Step = "cut" | "refuse" | "proxy" | "answer"
/** A server for app.version whose calls go `steps` in turn (the last one again after), kept in `asked`. */
async function restartingServer(steps: Step[], live = true) {
  const asked: Any[] = []
  let port = 0, listening: http.Server | null = null
  const entry = entryOf(versionOps()[0], null)
  const sockets = new Set<net.Socket>()
  const handler: http.RequestListener = (req, res) => {
    let raw = ""
    req.on("data", (d) => { raw += d })
    req.on("end", () => {
      if (req.method === "GET") return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(req.url?.includes("word=") ? [entry] : entry))
      const body = JSON.parse(raw || "{}"), step = steps[Math.min(asked.length, steps.length - 1)]
      asked.push(body)
      if (step === "cut") return void setTimeout(() => req.socket.destroy(), 200)
      if (step === "refuse") { req.socket.destroy(); return void stop(1500) }
      if (step === "proxy") return res.writeHead(502).end()
      const why = live ? `${String(body.commit).slice(0, 7)} is live here: it runs it` : `${String(body.commit).slice(0, 7)} won't be live here: its update failed`
      const result = { live: { commit: body.commit, live, final: true, outcome: live ? "live" : "never", why, waited: body.waited ?? 0 }, version: "0.0.0" }
      const wantsBoth = req.url?.includes("as=both")
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(wantsBoth ? { result, text: `Vaultite 0.0.0\n${why}` } : result))
    })
  }
  const listen = () => new Promise<void>((ok) => {
    listening = http.createServer(handler)
    listening.on("connection", (c) => { sockets.add(c); c.on("close", () => sockets.delete(c)) })
    listening.listen(port, "127.0.0.1", () => { port = (listening!.address() as net.AddressInfo).port; ok() })
  })
  /** Down for `ms` (refusing), then up again on its port. */
  const stop = (ms: number) => { const s = listening; listening = null; s?.close(); for (const c of sockets) c.destroy(); setTimeout(() => void listen(), ms) }
  await listen()
  return { url: `http://127.0.0.1:${port}`, asked, close: () => { listening?.close(); for (const c of sockets) c.destroy() } }
}
const sha = "f".repeat(40)

await section("a wait through a restart", async () => {
  {
    const srv = await restartingServer(["cut", "refuse", "proxy", "answer"])
    const r = await execute(["version", sha, "--wait", "--timeout", "60"], { url: srv.url })
    const lines = r.out.split("\n")
    check("vau: a wait cut, refused, then a proxy's 502: it answers from the new server", r.code === 0 && /is live here/.test(lines.at(-1) ?? ""), r)
    const waits = srv.asked.slice(1)
    check("vau: sent again with the time left and the time spent: the timeout counts once", waits.length >= 3 && waits.every((b) => Math.abs(Number(b.timeout) + Number(b.waited ?? 0) - 60) <= 1)
      && Number(waits.at(-1).waited) >= 6, srv.asked)
    check("vau: each time the same commit, as a hash", srv.asked.every((b) => b.commit === sha && b.wait === true), srv.asked)
    srv.close()
  }
  {
    const srv = await restartingServer(["cut", "proxy", "answer"], false)
    const r = await execute(["version", sha, "--wait", "--timeout", "60"], { url: srv.url })
    check("vau: a verdict from the new server that it won't be: exit 1, said last", r.code === 1 && /won't be live here: its update failed$/.test(r.out), r)
    srv.close()
  }
  {
    const srv = await restartingServer(["cut", "proxy"])
    const r = await execute(["version", sha, "--wait", "--timeout", "8"], { url: srv.url })
    check("vau: never back within the timeout: exit 1, its last line says the server didn't answer and how long", r.code === 1 && !r.err &&
      new RegExp(`^ffffff\\w: can't tell if it's live: the server at ${srv.url.replace(/\./g, "\\.")} answered 502, not itself \\(a proxy: the server behind it is down\\) for \\d+ s, till the wait's 8 s were up$`).test(r.out.split("\n").at(-1) ?? ""), r)
    const json = await execute(["version", sha, "--wait", "--timeout", "8", "--json"], { url: srv.url })
    const said = JSON.parse(json.out || "{}").live
    check("vau --json: the same, as the answer's live: outcome unreachable", json.code === 1 && said?.outcome === "unreachable" && said.live === false && /can't tell/.test(said.why), json)
    const once = await execute(["version"], { url: srv.url })
    check("vau: a proxy's 502 with nothing in it is said, never an empty error", once.code === 1 && /answered 502, not itself/.test(once.err), once)
    srv.close()
  }
  {
    // (vau finds the server itself: one that answered is the one it waits on, never another found after it)
    const a = await restartingServer(["cut", "refuse", "answer"]), b = await restartingServer(["answer"])
    const c: Any = new Ctx({ url: a.url })
    c.next = [b.url]
    const ask = () => c.api("POST", "ops/app.version", { commit: sha, wait: true }).then(() => "answered", (e: Error) => e.message)
    const got = await ask() // (cut)
    await ask() // (cut again, and it goes down)
    await ask() // (refused)
    check("vau: a server found that dropped the call stays the one asked, restarting", /isn't answering at/.test(got) && b.asked.length === 0 && c.url === a.url, { got, b: b.asked.length, url: c.url })
    a.close(); b.close()
  }
  {
    // Another machine's, through this server: it rides out that machine's restart the same way.
    const srv = await restartingServer(["cut", "proxy", "answer"])
    const op = versionOps()[0]
    const ctx: Any = { who: { client: "cli" }, api: async (_m: string, route: string) => (route === "machines" ? [{ id: "studio", label: "Studio", url: srv.url, online: true, self: false }] : null) }
    const out: Any = await op.run({ commit: sha, wait: true, timeout: 60, machine: "studio" }, ctx)
    check("machine: its wait rides out the restart and answers from its new server", out.machine === "studio" && out.live?.live === true, out)
    check("machine: sent again with the time left and the time spent", srv.asked.length === 3 && srv.asked.every((b) => Math.abs(Number(b.timeout) + Number(b.waited ?? 0) - 60) <= 1), srv.asked)
    srv.close()
    const gone = await restartingServer(["proxy"])
    ctx.api = async (_m: string, route: string) => (route === "machines" ? [{ id: "studio", label: "Studio", url: gone.url, online: true, self: false }] : null)
    const lost: Any = await op.run({ commit: sha, wait: true, timeout: 6, machine: "studio" }, ctx)
    check("machine: never back: unreachable, said", lost.live?.outcome === "unreachable" && /can't tell if it's live on Studio: Studio answered 502/.test(lost.live.why) && op.text!(lost, {}) === lost.live.why, lost)
    gone.close()
  }
  {
    // This server's own wait, sent again after a restart: it counts from the time already spent.
    const pending = async () => ({ commit: sha, live: false, final: false, outcome: "pending" as const, why: "fffffff isn't live here yet: updates waiting: CI is running on it" })
    const x = await waitLive(sha, 1, 30, pending)
    check("local: a wait sent again times out counting what it waited before", x.outcome === "timeout" && x.waited! >= 31 && /still isn't live here after 3\d s of waiting \(timed out\): updates waiting/.test(x.why), x)
  }
})

await section("an agent's call through a restart: sent again only where that's safe", async () => {
  // (a server whose port answers nothing for `downMs`, then takes calls as `steps` say, kept in `got`)
  const flaky = async (steps: ("cut" | "proxy" | "answer")[], downMs = 0) => {
    const got: string[] = [], port = await new Promise<number>((ok) => { const s = http.createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)) }) })
    let srv: http.Server | null = null
    const up = () => { srv = http.createServer((req, res) => {
      const step = steps[Math.min(got.length, steps.length - 1)]
      got.push(req.url ?? "")
      if (step === "cut") return void req.socket.destroy()
      if (step === "proxy") return void res.writeHead(502).end()
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ done: true }))
    }).listen(port, "127.0.0.1") }
    if (downMs) setTimeout(up, downMs); else up()
    return { url: `http://127.0.0.1:${port}`, got, close: () => srv?.close() }
  }
  const act = { id: "web-viewer.act", kind: "write" }, snap = { id: "web-viewer.snapshot", kind: "read" }
  const call = (url: string, e: { id: string; kind: string }) => new Ctx({ url }).callOp(e, "?as=text", {}).then((b: Any) => (b?.done ? "answered" : String(b)), (e: Error) => e.message)
  {
    const s = await flaky(["answer"], 1500)
    const r = await call(s.url, act)
    check("a click sent while nothing listens (the server restarting) goes once it's back, and once", r === "answered" && s.got.length === 1, { r, got: s.got })
    s.close()
  }
  {
    // (the catalog is asked first: the app's own processes wait for it too; elsewhere nothing up is said at once)
    const late = async () => {
      const port = await new Promise<number>((ok) => { const s = http.createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)) }) })
      const got: string[] = [], entry = entryOf(versionOps()[0], null)
      let srv: http.Server | null = null
      setTimeout(() => { srv = http.createServer((req, res) => {
        got.push(`${req.method} ${req.url}`)
        const body = req.method === "GET" ? (req.url?.includes("word=") ? [entry] : entry) : { version: "0.0.0" }
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body))
      }).listen(port, "127.0.0.1") }, 1500)
      return { url: `http://127.0.0.1:${port}`, got, close: () => srv?.close() }
    }
    const a = await late(), t0 = Date.now(), away = await execute(["version"], { url: a.url, env: {} })
    check("vau outside the app: a server that refuses is said at once", away.code === 1 && /isn't answering at/.test(away.err) && Date.now() - t0 < 1000, away)
    await sleep(1600)
    a.close()
    const b = await late(), r = await execute(["version", "--json"], { url: b.url, env: { VAULTITE: "1" } })
    check("vau in the app's terminals: a server restarting is waited for, its catalog and the call both", r.code === 0 && b.got[0]?.startsWith("GET /api/ops") && b.got.some((x) => x.startsWith("POST")), { r, got: b.got })
    b.close()
  }
  {
    const s = await flaky(["cut", "answer"])
    const r = await call(s.url, act)
    check("a click the restart cut, which the server may have done, isn't sent again: it says the server didn't answer", /isn't answering at/.test(r) && s.got.length === 1, { r, got: s.got })
    s.close()
  }
  {
    const s = await flaky(["cut", "answer"])
    const r = await call(s.url, snap)
    check("a read the restart cut is sent again once", r === "answered" && s.got.length === 2, { r, got: s.got })
    s.close()
  }
  {
    const s = await flaky(["proxy"])
    const r = await new Ctx({ url: s.url }).op(snap, "", {})
    check("…only once: a proxy's empty 502 again is the answer", r.status === 502 && s.got.length === 2, { r, got: s.got })
    const w = await new Ctx({ url: s.url }).op(act, "", {})
    check("a write a proxy answered 502 for isn't sent again", w.status === 502 && s.got.length === 3, s.got)
    s.close()
  }
})

await exit(summary("running", t0))
