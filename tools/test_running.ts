// What a server runs (core/running.ts, core/webbuild.ts, core/buildstamp.ts): on a throwaway git repo and build
// folder. In npm test.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { check, exit, section, sleep, summary, tempDir, waitFor } from "./test/lib.ts"
import { stampIn, stampOf, stampText } from "../core/buildstamp.ts"
import { gitEnv } from "../core/gitenv.ts"
import { runningIn } from "../core/running.ts"
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
  check("a short hash and HEAD in full; an unknown one null", await r.resolve(b.slice(0, 7)) === b && await r.resolve("HEAD") === c && await r.resolve("deadbeef") === null)
  check("not a ref's name", await r.resolve("--all") === null)
  const none = runningIn(path.join(tmp, "nowhere"), () => ({ entry: null, eager: [], stamp: null }))
  check("not a checkout: unknown", (await none.running()).commit === null && await none.contains("a".repeat(40), "b".repeat(40)) === null)
})

await exit(summary("running", t0))
