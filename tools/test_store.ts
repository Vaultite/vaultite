// The root store (core/update/store.ts) on throwaway repos: roots made, checked, pointed at and collected, as the shell's
// picker (electron/shell/roots.mjs) reads them. No network, no npm: the install and the build are stood in for. In npm test.
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { check, exit, section, skip, summary, tempDir } from "./test/lib.ts"
import { gitEnv } from "../core/gitenv.ts"
import { rootsHeld } from "../core/update/lease.ts"
import { execIn, type Recipe, rootStore, stopRuns } from "../core/update/store.ts"
import { fingerprint } from "../electron/shell/print.mjs"
import * as roots from "../electron/shell/roots.mjs"
const t0 = Date.now()
// (Main's store is a Mac's or Linux's: Windows runs its bundle only, roots.mjs)
if (process.platform === "win32") { skip("the root store", "Windows runs only its bundle"); await exit(summary("store", t0)) }

const tmp = tempDir("vaultite-store-test-")
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=Alice Park", "-c", "user.email=alice@example.com", ...args], { cwd, encoding: "utf8", stdio: "pipe", env: gitEnv() }).trim()
const origin = path.join(tmp, "origin.git"), dev = path.join(tmp, "dev")
execFileSync("git", ["init", "--quiet", "--bare", "-b", "main", origin], { env: gitEnv() })
execFileSync("git", ["clone", "--quiet", origin, dev], { stdio: "pipe", env: gitEnv() })
const lock = (deps: Record<string, string>) => JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: deps }, "node_modules/electron": { version: "40.0.0" },
  ...Object.fromEntries(Object.entries(deps).map(([n, v]) => [`node_modules/${n}`, { version: v }])) } }, null, 2)
const commit = (files: Record<string, string | null>, msg: string) => {
  for (const [f, text] of Object.entries(files)) {
    const at = path.join(dev, f)
    if (text === null) { fs.rmSync(at, { force: true }); continue }
    fs.mkdirSync(path.dirname(at), { recursive: true })
    fs.writeFileSync(at, text)
  }
  git(dev, "add", "-A"); git(dev, "commit", "--quiet", "-m", msg); git(dev, "push", "--quiet", "origin", "HEAD:main")
  return git(dev, "rev-parse", "HEAD")
}
const c1 = commit({
  ".gitignore": "node_modules\nweb/dist/\nelectron/build.json\n",
  "package.json": JSON.stringify({ name: "lighthouse", main: "electron/shell/boot.mjs", dependencies: { lamp: "1.0.0" } }),
  "package-lock.json": lock({ lamp: "1.0.0" }), ".npmrc": "ignore-scripts=true\n",
  "electron/shell/inputs.json": JSON.stringify({ files: ["electron/shell"], package: ["main"], electron: "package-lock.json" }),
  "electron/shell/boot.mjs": "// the shell\n", "server.ts": "// the server\n", "web/src/a.ts": "1\n",
}, "first")

// The install and the build, stood in for: what they did is counted.
const installs: { dir: string; fresh: boolean; had: string[] }[] = []
let failInstall = false
const install = async (dir: string, o: { fresh: boolean }) => {
  if (failInstall) throw new Error("npm: ENOTFOUND registry.npmjs.org")
  const modules = path.join(dir, "node_modules")
  installs.push({ dir, fresh: o.fresh, had: fs.existsSync(modules) ? fs.readdirSync(modules).filter((n) => !n.startsWith(".")) : [] })
  const want = JSON.parse(fs.readFileSync(path.join(dir, "package-lock.json"), "utf8")).packages[""].dependencies
  fs.rmSync(modules, { recursive: true, force: true })
  for (const [n, v] of Object.entries(want)) { fs.mkdirSync(path.join(modules, n), { recursive: true }); fs.writeFileSync(path.join(modules, n, "package.json"), JSON.stringify({ name: n, version: v })) }
}
const ran: string[] = []
const recipe: Recipe = {
  build: [
    { name: "web build", run: async (c) => {
      if (fs.existsSync(path.join(c.root, "FAIL"))) throw new Error("vite: it didn't build")
      fs.mkdirSync(path.join(c.root, "web", "dist"), { recursive: true })
      fs.writeFileSync(path.join(c.root, "web", "dist", "index.html"), "<!doctype html>")
    } },
    { name: "stamp", run: async (c) => {
      const head = git(c.root, "rev-parse", "HEAD")
      fs.writeFileSync(path.join(c.root, "electron", "build.json"), JSON.stringify({ commit: fs.existsSync(path.join(c.root, "WRONG")) ? "f".repeat(40) : head }))
    } },
  ],
  keyFiles: ["server.ts", "package.json", "web/dist/index.html", "electron/build.json", "electron/shell/boot.mjs"],
  preflight: [{ name: "boots", run: async (c) => {
    ran.push(c.root)
    JSON.parse(fs.readFileSync(path.join(c.root, "node_modules", "lamp", "package.json"), "utf8"))
  } }],
}
const dir = path.join(tmp, "code.noindex"), lines: string[] = []
const store = rootStore({ dir, url: origin, recipe, install, log: (l) => lines.push(l), fresh: 0 })
const modeOf = (p: string) => fs.statSync(p).mode & 0o777
const pickIn = (s: typeof store, print: string, bad = {}) => roots.pick({ bundle: path.join(tmp, "bundle"), packaged: true, platform: "darwin", env: {}, uid: process.getuid?.(),
  shell: { channel: "main", fingerprint: print }, store: s.dir, bad, enabled: { dev: true, store: true } })

let print = ""
await section("prepare: a root the shell's picker takes", async () => {
  check("fetch: the branch's commit", await store.fetch("main") === c1)
  const r = await store.prepare(c1)
  const root = path.join(dir, "roots", c1)
  check("at roots/<sha>, its deps linked from deps/<lock's blob>", r.dir === root && fs.readlinkSync(path.join(root, "node_modules")) === `../../deps/${r.deps}/node_modules`
    && fs.existsSync(path.join(dir, "deps", r.deps, "node_modules", "lamp", "package.json")) && r.deps === git(dev, "rev-parse", `${c1}:package-lock.json`), r)
  check("read-only, the user's (roots.mjs refuses others' or a writable one)", modeOf(root) === 0o555 && modeOf(path.join(root, "server.ts")) === 0o444 && fs.statSync(root).uid === process.getuid?.())
  check("its fingerprint is the shell's, as the picker reckons it", r.fingerprint === fingerprint(root) && /^[0-9a-f]{64}$/.test(r.fingerprint))
  check("each step timed, the preflight run in it before it moved", ["worktree", "deps", "web build", "stamp", "verify", "boots"].every((s) => typeof r.steps[s] === "number")
    && ran.length === 1 && ran[0].includes(".staging-"), r.steps)
  check("sound: nothing to say", (await store.verify(c1)).length === 0)
  check("nothing current yet: the picker runs the bundle", pickIn(store, r.fingerprint).from === "bundle")
  await store.setCurrent(c1)
  check("current.json: the commit, written whole", JSON.parse(fs.readFileSync(path.join(dir, "current.json"), "utf8")).commit === c1 && !fs.readdirSync(dir).some((f) => f.endsWith(".tmp")))
  const p = pickIn(store, r.fingerprint)
  check("the picker takes it: the store's current, at its root", p.from === "current" && p.root === root && roots.commitOf(p.root) === c1, p)
  check("another shell's fingerprint: the bundle, saying why", ((x) => x.from === "bundle" && /fingerprint differs/.test(x.passed[0]?.why ?? ""))(pickIn(store, "0".repeat(64))))
  const again = installs.length
  check("prepared already: answered at once", (await store.prepare(c1)).prepared === r.prepared && installs.length === again && ran.length === 1)
  print = r.fingerprint
})

let c2 = "", c3 = ""
await section("deps: kept per lockfile", async () => {
  c2 = commit({ "web/src/a.ts": "2\n" }, "feat(web): two")
  await store.fetch("main")
  const n = installs.length, r2 = await store.prepare(c2)
  check("a commit with the same lock: its deps set reused, nothing installed", installs.length === n && r2.deps === (await store.prepared(c1))!.deps)
  c3 = commit({ "package.json": JSON.stringify({ name: "lighthouse", main: "electron/shell/boot.mjs", dependencies: { lamp: "1.0.0", wick: "2.0.0" } }), "package-lock.json": lock({ lamp: "1.0.0", wick: "2.0.0" }) }, "build: wick")
  await store.fetch("main")
  const r3 = await store.prepare(c3)
  const last = installs.at(-1)!
  check("a lockfile change makes a new set, cloned from the one before, then installed", r3.deps !== r2.deps && !last.fresh && last.had.join() === "lamp"
    && fs.readdirSync(path.join(dir, "deps")).filter((d) => !d.startsWith(".")).length === 2, { r3, last })
  check("the set has its lock and .npmrc, and is read-only but for builds' caches (tsc's .tmp, vite's)", fs.existsSync(path.join(dir, "deps", r3.deps, ".npmrc"))
    && modeOf(path.join(dir, "deps", r3.deps, "node_modules")) === 0o555 && modeOf(path.join(dir, "deps", r3.deps, "node_modules", "lamp")) === 0o555
    && (modeOf(path.join(dir, "deps", r3.deps, "node_modules", ".tmp")) & 0o200) !== 0)
  check("the first set was installed fresh (npm ci)", installs[0].fresh)
})

await section("a failed prepare leaves current and nothing else behind", async () => {
  const c4 = commit({ FAIL: "1" }, "feat(web): broken")
  await store.fetch("main")
  let why = ""
  try { await store.prepare(c4) } catch (e) { why = (e as Error).message }
  check("it says why", /wasn't prepared: web build: vite: it didn't build/.test(why), why)
  check("no root, no staging, current untouched", !fs.existsSync(path.join(dir, "roots", c4)) && !fs.readdirSync(path.join(dir, "roots")).some((n) => n.startsWith(".")) && store.current() === c1
    && !git(path.join(dir, "repo.git"), "worktree", "list").includes(c4.slice(0, 7)))
  check("marked bad: not tried again, never current", !!store.bad(c4) && await store.prepare(c4).then(() => false, (e) => /failed before/.test(e.message)) && await store.setCurrent(c4).then(() => false, () => true))
  const c5 = commit({ FAIL: null, WRONG: "1" }, "fix(web): stamped wrong")
  await store.fetch("main")
  check("a root that doesn't check out (its stamp isn't its commit) isn't made", await store.prepare(c5).then(() => "", (e) => e.message).then((m) => /electron\/build\.json says f{40}, not/.test(m)) && !fs.existsSync(path.join(dir, "roots", c5)))
  const c6 = commit({ WRONG: null, "package.json": JSON.stringify({ name: "lighthouse", main: "electron/shell/boot.mjs", dependencies: { lamp: "1.1.0" } }), "package-lock.json": lock({ lamp: "1.1.0" }) }, "build: lamp 1.1")
  await store.fetch("main")
  failInstall = true
  const offline = await store.prepare(c6).then(() => "", (e) => e.message)
  failInstall = false
  check("an install that fails (offline) isn't the commit's fault: not marked bad, nothing left", /ENOTFOUND/.test(offline) && !store.bad(c6)
    && !fs.readdirSync(path.join(dir, "deps")).some((d) => d.startsWith(".tmp")) && !fs.existsSync(path.join(dir, "roots", c6)), offline)
  check("…and it's made once online", (await store.prepare(c6)).commit === c6)
})

await section("pointers and the picker's fallback order", async () => {
  await store.setCurrent(c3)
  store.markGood(c2)
  check("good.json beside current.json", store.good() === c2 && store.current() === c3)
  check("the picker: current first", pickIn(store, print).root === store.root(c3))
  check("a root the shell found bad: the picker falls to good", ((x) => x.from === "good" && x.root === store.root(c2) && /failed before/.test(x.passed[0].why))(pickIn(store, print, { [store.root(c3)]: { why: "it crashed twice" } })))
  store.markBad(c3, "it crashed twice within a minute of starting")
  check("marked bad in the store: no longer current, so good", store.current() === null && pickIn(store, print).from === "good")
  fs.chmodSync(store.root(c2), 0o775)
  check("a root others can write to: the bundle", ((x) => x.from === "bundle" && /others can write/.test(x.passed[0].why))(pickIn(store, print)))
  fs.chmodSync(store.root(c2), 0o555)
  await store.setCurrent(c2)
  check("setCurrent refuses a commit never prepared", await store.setCurrent("a".repeat(40)).then(() => false, (e) => /isn't prepared/.test(e.message)))
})

await section("verify: a root changed after it was made", async () => {
  const root = store.root(c1)
  fs.chmodSync(root, 0o755)
  fs.writeFileSync(path.join(root, "extra.ts"), "planted")
  const problems = await store.verify(c1)
  check("git finds it changed", problems.some((p) => /git finds it changed: \?\? extra\.ts/.test(p)), problems)
  fs.rmSync(path.join(root, "extra.ts")); fs.chmodSync(root, 0o555)
})

await section("gc: current, good and leased roots stay", async () => {
  // (a keeper: a process running c1's root for long)
  const keeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
  await new Promise((r) => setTimeout(r, 300))
  const release = await store.lease(c1, { pid: keeper.pid!, what: "termd" })
  const gone = await store.gc()
  check("current (c2) and leased (c1) stay; c3, c6 go", fs.existsSync(store.root(c1)) && fs.existsSync(store.root(c2)) && !fs.existsSync(store.root(c3)) && !fs.existsSync(store.root(c6Of()))
    && gone.includes(c3), gone)
  check("their worktrees are pruned in the repo", !git(path.join(dir, "repo.git"), "worktree", "list").includes(c3.slice(0, 7)))
  check("deps sets no kept root uses go", fs.readdirSync(path.join(dir, "deps")).length === 1, fs.readdirSync(path.join(dir, "deps")))
  keeper.kill()
  await new Promise((r) => keeper.on("exit", r))
  const later = await store.gc()
  check("its keeper gone: the lease no longer holds", later.includes(c1) && !fs.existsSync(store.root(c1)) && !fs.existsSync(path.join(dir, "leases", `${c1}.${keeper.pid}.json`)), later)
  release()
  check("the picker still runs current", pickIn(store, print).root === store.root(c2))
})
function c6Of() { return git(dev, "rev-parse", "HEAD") }

await section("a server holds its root and the web build it serves, the one before let go", async () => {
  const s = path.join(tmp, "held.noindex"), sha = (x: string) => x.repeat(40), at = (x: string, f: string) => path.join(s, "roots", sha(x), f)
  fs.mkdirSync(path.join(s, "repo.git"), { recursive: true })
  for (const x of "abc") fs.mkdirSync(at(x, "web/dist"), { recursive: true })
  const held = rootStore({ dir: s, url: origin, recipe, install, log: () => {} })
  const leased = async () => [...(await held.leased()).keys()].map((k) => k[0]).sort().join("")
  const roots = rootsHeld(at("a", "server.ts"), "server")
  await roots.ready
  await roots.take(at("a", "web/dist"))
  check("its own root, once", await leased() === "a")
  await roots.take(at("b", "web/dist"))
  check("…and the web build it adopted (an update's next root)", await leased() === "ab")
  await roots.take(at("c", "web/dist"))
  check("another adopted: the one before let go", await leased() === "ac")
  await roots.take(at("a", "web/dist"))
  check("its own again: only its own held", await leased() === "a")
})

await section("two stores of one folder in one process take turns (the app's look and its gc after a launch)", async () => {
  let release = () => {}, began = () => {}
  const started = new Promise<void>((r) => { began = r })
  const slow: Recipe = { ...recipe, build: [{ name: "slow", run: () => new Promise<void>((r) => { release = r; began() }) }, ...recipe.build] }
  const a = rootStore({ dir, url: origin, recipe: slow, install }), b = rootStore({ dir, url: origin, recipe, install })
  const c9 = commit({ "web/src/a.ts": "9\n" }, "ninth")
  await a.fetch("main")
  const making = a.prepare(c9)
  await started // (its root being made: worktree and deps done, the build under way)
  let collected = false
  const gc = b.gc().then((gone) => { collected = true; return gone })
  await new Promise((r) => setTimeout(r, 100))
  check("the other's gc waits while a root is being made", !collected && fs.existsSync(path.join(dir, "roots", `.staging-${c9}`)))
  release()
  const r = await making, gone = await gc
  check("...and the root made is whole, kept as just made (its host makes it current next)", fs.existsSync(path.join(r.dir, "electron", "build.json")) && !gone.some((g) => g.includes(c9)), gone)
})

await section("migration: an older source clone moves in, with no download", async () => {
  const source = path.join(tmp, "source.noindex")
  execFileSync("git", ["clone", "--quiet", origin, source], { stdio: "pipe", env: gitEnv() })
  const moved = rootStore({ dir: path.join(tmp, "moved.noindex"), url: "https://github.invalid/Alice/lighthouse.git", recipe, install })
  await moved.init(source)
  const r = await moved.prepare(c2)
  check("its objects are the clone's: prepared offline, origin set to the app's url", r.commit === c2 && git(moved.repo, "remote", "get-url", "origin") === "https://github.invalid/Alice/lighthouse.git"
    && git(moved.repo, "config", "--get", "remote.origin.fetch") === "+refs/heads/*:refs/remotes/origin/*")
  check("a bare clone (no working tree to drift)", git(moved.repo, "rev-parse", "--is-bare-repository") === "true")
})

await section("a prepare's processes end with its host", async () => {
  const build = execIn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: tmp }).then(() => "ended by itself", (e: Error) => e.message)
  const stopped = stopRuns()
  check("what a prepare still runs is stopped when its host goes (never left running on its own)", stopped === 1 && (await build) !== "ended by itself", [stopped, await build])
})

// (roots are read-only: writable again, so the temp folder goes)
execFileSync("chmod", ["-R", "u+w", tmp])
await exit(summary("store", t0))
