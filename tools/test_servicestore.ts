// A service on its code store (core/update/servicestore.ts, bin/vaultite-server) on throwaway repos: roots made, restarted
// onto or their web build taken, the one that keeps failing at start left. npm, builds, CI and the graph stood in for.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { check, exit, section, skip, summary, tempDir } from "./test/lib.ts"
import { gitEnv } from "../core/gitenv.ts"
import { giveGraph } from "../core/update/graph.ts"
import type { Recipe } from "../core/update/store.ts"
import { inStore } from "../core/update/servicestore.ts"
import { checkForUpdate } from "../core/update/updater.ts"
const t0 = Date.now()
if (process.platform === "win32") { skip("the service's code store", "Windows' service updates its checkout in place"); await exit(summary("servicestore", t0)) }

const tmp = tempDir("vaultite-servicestore-test-")
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=Alice Park", "-c", "user.email=alice@example.com", ...args], { cwd, encoding: "utf8", stdio: "pipe", env: gitEnv() }).trim()
const origin = path.join(tmp, "origin.git"), dev = path.join(tmp, "dev"), checkout = path.join(tmp, "lighthouse")
execFileSync("git", ["init", "--quiet", "--bare", "-b", "main", origin], { env: gitEnv() })
execFileSync("git", ["clone", "--quiet", origin, dev], { stdio: "pipe", env: gitEnv() })
const commit = (files: Record<string, string>, msg: string) => {
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dev, f)), { recursive: true }); fs.writeFileSync(path.join(dev, f), text) }
  git(dev, "add", "-A"); git(dev, "commit", "--quiet", "-m", msg); git(dev, "push", "--quiet", "origin", "HEAD:main")
  return git(dev, "rev-parse", "HEAD")
}
// (the server says where it runs from and where its own files are: what the trampoline gave it)
const server = (n: number) => `console.log(JSON.stringify({ server: ${n}, cwd: process.cwd(), local: process.env.VAULTITE_LOCAL }))\n`
commit({ ".gitignore": "node_modules\nweb/dist/\nelectron/build.json\ndata/\n", "package.json": JSON.stringify({ name: "lighthouse", type: "module" }),
  "package-lock.json": "{}", "server.ts": server(1), "web/src/a.ts": "1\n", "bin/vaultite-server": fs.readFileSync("bin/vaultite-server", "utf8"),
  "electron/shell/inputs.json": JSON.stringify({ files: ["electron/shell"], package: ["name"], electron: "package-lock.json" }), "electron/shell/boot.mjs": "// the shell\n" }, "first")
execFileSync("git", ["clone", "--quiet", origin, checkout], { stdio: "pipe", env: gitEnv() })

const recipe: Recipe = {
  build: [
    { name: "web build", run: async (c) => { fs.mkdirSync(path.join(c.root, "web", "dist"), { recursive: true }); fs.writeFileSync(path.join(c.root, "web", "dist", "index.html"), "<!doctype html>") } },
    { name: "stamp", run: async (c) => { fs.mkdirSync(path.join(c.root, "electron"), { recursive: true }); fs.writeFileSync(path.join(c.root, "electron", "build.json"), JSON.stringify({ commit: git(c.root, "rev-parse", "HEAD") })) } },
  ],
  keyFiles: ["server.ts", "bin/vaultite-server", "web/dist/index.html"],
  preflight: [],
}
// (what reaches the server: server.ts; the web app: web/)
giveGraph(async () => ({ diskTree: () => null, graphOf: () => ({ hit: (entry: string, files: string[]) => {
  const f = files.find((x) => entry === "server" ? x === "server.ts" : entry === "web" ? x.startsWith("web/") : false)
  return f ? { file: f, chain: [f] } : null
} }) }) as never)

const store = path.join(checkout, "data", "code.noindex")
let restarts = 0
const adopted: string[] = [], logged: string[] = []
const host = (root: string) => inStore({ checkout, store, root, branch: "main", stateFile: path.join(tmp, "state.json"), busy: async () => null, restart: () => { restarts++ },
  ci: async () => ({ ok: true, why: "CI passed" }), adoptWeb: (d) => adopted.push(d), log: (l) => logged.push(l), recipe, install: async (dir) => { fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true }) } })
const current = () => JSON.parse(fs.readFileSync(path.join(store, "current.json"), "utf8")).commit
const rootOf = (sha: string) => path.join(store, "roots", sha)
/** bin/vaultite-server as the service manager runs it: what its server said. */
const trampoline = () => JSON.parse(execFileSync(process.execPath, [path.join(checkout, "bin", "vaultite-server")], { encoding: "utf8",
  env: { ...process.env, VAULTITE_CODE_STORE: store, VAULTITE_LOCAL: "" } }).trim().split("\n").at(-1)!)

await section("a commit the server runs: made into a root, then restarted onto", async () => {
  const c2 = commit({ "server.ts": server(2) }, "the server changes")
  const s = await checkForUpdate(await host(checkout))
  check("prepared, current, the server restarts", s.state === "current" && current() === c2 && restarts === 1 && !adopted.length, { s, logged })
  check("its root is read-only", !(fs.statSync(rootOf(c2)).mode & 0o222))
  const ran = trampoline()
  check("bin/vaultite-server runs it from its root, its own files the checkout's", ran.server === 2 && fs.realpathSync(ran.cwd) === fs.realpathSync(rootOf(c2)) && fs.realpathSync(ran.local) === fs.realpathSync(path.join(checkout, "data")), ran)
  fs.rmSync(path.join(store, "service-start.json"))
  await host(rootOf(c2))
  check("once up on it, its root is good (what a failed start falls back to)", JSON.parse(fs.readFileSync(path.join(store, "good.json"), "utf8")).commit === c2)
})

await section("a commit of the web app only: its web build taken, no restart", async () => {
  const before = restarts
  const c3 = commit({ "web/src/a.ts": "2\n" }, "the web app changes")
  const s = await checkForUpdate(await host(rootOf(git(dev, "rev-parse", "HEAD~1"))))
  check("current, the new root's web/dist served, nothing restarted", s.state === "current" && current() === c3 && restarts === before && adopted.at(-1) === path.join(rootOf(c3), "web", "dist"), { s, adopted, logged })
})

await section("a root whose server keeps stopping as it starts: bad, the good one runs", async () => {
  const c3 = current()
  const said = [1, 2, 3].map(() => trampoline().server)
  const fourth = trampoline()
  check("three tries of current, then it's bad and the good root runs", said.every((n) => n === 2) && fourth.server === 2 && fs.realpathSync(fourth.cwd) === fs.realpathSync(rootOf(git(dev, "rev-parse", "HEAD~1")))
    && fs.existsSync(path.join(store, "bad", `${c3}.json`)), { said, fourth })
  fs.rmSync(path.join(store, "current.json")); fs.rmSync(path.join(store, "good.json"))
  check("no root to run: the checkout's own server", trampoline().server === 1)
})

execFileSync("chmod", ["-R", "u+w", tmp]) // (roots are read-only)
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 })
await exit(summary("servicestore", t0))
