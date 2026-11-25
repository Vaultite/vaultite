// An update's install (electron/update.sh install) on throwaway bundles: staged and checked beside the app, swapped in
// once it quit and nothing opened it again, then opened (a stand-in: no real app starts, quits or shows). In npm test.
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { check, exit, freePort, modesEnforced, section, sleep, standIn, summary, tempDir } from "./test/lib.ts"
import { gitEnv } from "../core/gitenv.ts"
import { removeReadOnly, writable } from "../core/update/store.ts"
import { afterUpdate, installedCommit } from "../electron/installed.ts"

const t0 = Date.now()
if (process.platform === "win32") { console.log("test_update: no update.sh on Windows"); process.exit(0) }
const MAC = process.platform === "darwin"
const SCRIPT = path.join(import.meta.dirname, "..", "electron", "update.sh")
const SHELL = MAC ? "/bin/zsh" : "/bin/bash" // (as electron/main.ts runs it)
const tmp = tempDir("vaultite-update-test-")
const OLD = "a".repeat(40), NEW = "b".repeat(40)
// (a name with a space and a dot, as Vaultite Main.app's)
const NAME = "Fake Main", EXE = MAC ? NAME : "fake-main"
const RES = MAC ? "Contents/Resources/app" : "resources/app", BIN = MAC ? `Contents/MacOS/${EXE}` : EXE
const bundle = (dir: string) => path.join(dir, MAC ? `${NAME}.app` : NAME)

/** A build of `commit` at `at` (the executable a link to Node, so a "copy of the app" can run from inside it). */
function makeBuild(at: string, commit: string, o: { omit?: string; print?: string } = {}) {
  fs.rmSync(at, { recursive: true, force: true })
  const files: Record<string, string> = {
    [`${RES}/electron/build.json`]: JSON.stringify({ commit, repo: "https://github.com/Alice/lighthouse.git" }, null, 2),
    [`${RES}/electron/shell.json`]: JSON.stringify({ channel: "main", commit, ...(o.print === "" ? {} : { fingerprint: o.print ?? "f".repeat(64) }), appId: "app.lighthouse.main", productName: NAME }, null, 2),
    // (the shell: electron/shell/boot.mjs, package.json's main, and what it runs with)
    ...Object.fromEntries(["boot.mjs", "roots.mjs", "vau.mjs", "print.mjs", "inputs.json"].map((f) => [`${RES}/electron/shell/${f}`, ""])),
    [`${RES}/server.ts`]: `// ${commit}`, [`${RES}/package.json`]: `{ "main": "electron/shell/boot.mjs" }`,
    [`${RES}/electron/boot.ts`]: "", [`${RES}/electron/main.ts`]: "", [`${RES}/plugins/core/lighthouse/plugin.ts`]: `// ${commit}`,
    // (the terminal keeper and the CLI, which the app's binary runs as Node: they hold on, as theirs do)
    [`${RES}/plugins/core/terminal/termd/daemon.ts`]: "setInterval(() => {}, 1000)\n", [`${RES}/bin/vau`]: "setInterval(() => {}, 1000)\n",
  }
  for (const [f, text] of Object.entries(files)) {
    if (f === o.omit) continue
    fs.mkdirSync(path.dirname(path.join(at, f)), { recursive: true })
    fs.writeFileSync(path.join(at, f), text)
  }
  if (MAC) fs.mkdirSync(path.join(at, "Contents", "Frameworks"), { recursive: true })
  fs.mkdirSync(path.dirname(path.join(at, BIN)), { recursive: true })
  fs.symlinkSync(process.execPath, path.join(at, BIN))
}
const commitAt = (app: string) => installedCommit(path.join(app, RES))

// Something to run in the background: Node holding on.
const hold = path.join(tmp, "hold.mjs")
fs.writeFileSync(hold, "setInterval(() => {}, 1000)\n")
const running: ChildProcess[] = []
const run = (cmd: string, args: string[]) => { const c = spawn(cmd, args, { stdio: "ignore" }); running.push(c); return c }
const end = async (c: ChildProcess) => { if (c.exitCode === null && c.signalCode === null) { c.kill("SIGKILL"); await new Promise((r) => c.once("exit", r)) } }
process.on("exit", () => { for (const c of running) try { c.kill("SIGKILL") } catch { /* gone */ } })

// The stand-in for `open`: what it found when the app was opened (the commit there, any copy left beside it).
const opened = path.join(tmp, "opened.jsonl")
const OPEN = standIn(path.join(tmp, "bin"), "open-app", `import fs from "node:fs"
const app = process.argv[2], b = ${JSON.stringify(RES)}
let commit = null
try { commit = JSON.parse(fs.readFileSync(app + "/" + b + "/electron/build.json", "utf8")).commit } catch {}
fs.appendFileSync(${JSON.stringify(opened)}, JSON.stringify({ app, commit, leftNew: fs.existsSync(app + ".new"), leftOld: fs.existsSync(app + ".old") }) + "\\n")`)
const opens = () => (fs.existsSync(opened) ? fs.readFileSync(opened, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [])

function readOnlyCache(app: string) {
  const cache = path.join(app, RES, ".compile-cache", "v24")
  fs.mkdirSync(cache, { recursive: true })
  fs.writeFileSync(path.join(cache, "a1b2"), "code")
  for (const p of [path.join(cache, "a1b2"), cache, path.dirname(cache)]) fs.chmodSync(p, 0o555)
}

type Install = { child: ChildProcess; staged: Promise<boolean>; done: Promise<number | null>; log: () => string; events: string[] }
/** update.sh install for the app `pid` stands for: the old app installed, the new build in update.noindex. */
let n = 0
function install(o: { next?: string; build?: string; omit?: string; print?: string; stay?: boolean; cached?: boolean; pid: number }): Install & { app: string } {
  const dir = path.join(tmp, `case-${++n}`), apps = path.join(dir, "Applications"), next = path.join(dir, "update.noindex")
  fs.mkdirSync(apps, { recursive: true })
  makeBuild(bundle(apps), OLD)
  makeBuild(bundle(next), o.build ?? NEW, { omit: o.omit, print: o.print })
  if (o.cached) for (const at of [bundle(apps), bundle(next), `${bundle(apps)}.new`, `${bundle(apps)}.old`]) readOnlyCache(at)
  fs.writeFileSync(path.join(next, "commit"), `${o.next ?? NEW}\n`)
  fs.rmSync(opened, { force: true })
  const env: NodeJS.ProcessEnv = { ...process.env, VAULTITE_UPDATE_OPEN: OPEN }
  delete env.XPC_SERVICE_NAME
  const child = spawn(SHELL, [SCRIPT, "install", String(o.pid), bundle(next), bundle(apps), EXE, ...(o.stay ? ["stay"] : [])],
    { stdio: ["ignore", "pipe", "pipe", "pipe"], env })
  let out = ""
  const events: string[] = []
  child.stdout!.on("data", (b) => (out += b)); child.stderr!.on("data", (b) => (out += b))
  const staged = new Promise<boolean>((ok) => {
    (child.stdio[3] as NodeJS.ReadableStream).on("data", (b: Buffer) => { if (/staged/.test(String(b))) { events.push(`staged (app ${commitAt(bundle(apps))?.[0]})`); ok(true) } })
    child.once("exit", () => ok(false))
  })
  const done = new Promise<number | null>((ok) => child.once("exit", (code) => { events.push("exit"); ok(code) }))
  return { child, staged, done, log: () => out, events, app: bundle(apps) }
}
const appPid = () => run(process.execPath, [hold])

await section("staged, swapped in once the app quit, then opened", async () => {
  const app = appPid(), i = install({ pid: app.pid!, cached: true })
  check("it says it's staged while the app still runs", await i.staged && app.exitCode === null, i.log())
  await sleep(600)
  check("...and touches nothing of the running app meanwhile", commitAt(i.app) === OLD && commitAt(`${i.app}.new`) === NEW && !opens().length,
    { at: commitAt(i.app), staged: commitAt(`${i.app}.new`), opens: opens() })
  await end(app)
  const code = await i.done
  check("once it quit, the new build is the app", code === 0 && commitAt(i.app) === NEW, { code, log: i.log() })
  check("...whole: every file the build has", fs.readFileSync(path.join(i.app, RES, "plugins/core/lighthouse/plugin.ts"), "utf8") === `// ${NEW}`)
  check("...with no copy left beside it, its read-only compile cache too", !fs.existsSync(`${i.app}.new`) && !fs.existsSync(`${i.app}.old`))
  const o = opens()
  check("it's opened once, after the swap was done", o.length === 1 && o[0].commit === NEW && !o[0].leftNew && !o[0].leftOld, o)
  check("the log says what it installed", i.log().includes(`installed ${NEW}`), i.log())
})

await section("update.sh build over builds whose compile cache is read-only", async () => {
  const dir = path.join(tmp, "builds"), repo = path.join(dir, "repo"), src = path.join(dir, "source.noindex"), next = path.join(dir, "update.noindex")
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Alice Park", "-c", "user.email=alice@example.com", ...args], { cwd: repo, encoding: "utf8", stdio: "pipe", env: gitEnv() }).trim()
  const at = `dist-app/${MAC ? `mac-arm64/${NAME}.app` : "linux-unpacked"}`
  const offlineDeps = { dependencies: { lamp: "file:lamp" } }
  const files = { "package.json": JSON.stringify({ name: "lighthouse", version: "1.0.0", productName: NAME, scripts: { "app:build": "node build.mjs" }, ...offlineDeps }),
    "package-lock.json": JSON.stringify({ name: "lighthouse", version: "1.0.0", lockfileVersion: 3, packages: { "": { name: "lighthouse", version: "1.0.0", ...offlineDeps }, lamp: { version: "1.0.0" }, "node_modules/lamp": { resolved: "lamp", link: true } } }),
    "lamp/package.json": JSON.stringify({ name: "lamp", version: "1.0.0" }),
    ".gitignore": "node_modules\ndist-app\n", "electron/sign.cjs": "// EnableCookieEncryption\n",
    "build.mjs": `import fs from "node:fs"
const app = ${JSON.stringify(`${at}/${RES}`)}, cache = app + "/.compile-cache/v24"
fs.mkdirSync(cache, { recursive: true })
fs.copyFileSync("package.json", app + "/package.json")
fs.writeFileSync(cache + "/a1b2", "code")
for (const p of [cache + "/a1b2", cache, app + "/.compile-cache"]) fs.chmodSync(p, 0o555)
if (fs.existsSync("FAIL")) process.exit(1)
` }
  for (const d of ["electron", "lamp"]) fs.mkdirSync(path.join(repo, d), { recursive: true })
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(repo, f), text)
  git("init", "--quiet", "-b", "main")
  const commit = (msg: string, fail: boolean) => {
    if (fail) fs.writeFileSync(path.join(repo, "FAIL"), ""); else fs.rmSync(path.join(repo, "FAIL"), { force: true })
    git("add", "-A"); git("commit", "--quiet", "--allow-empty", "-m", msg)
    return git("rev-parse", "HEAD")
  }
  const build = () => { const r = spawnSync(SHELL, [SCRIPT, "build", src, repo, OLD], { encoding: "utf8", env: gitEnv() }); return { code: r.status, last: r.stdout.trim().split("\n").pop(), out: r.stdout + r.stderr } }
  const has = (c: string) => fs.existsSync(path.join(bundle(next), RES, ".compile-cache/v24/a1b2")) && fs.readFileSync(path.join(next, "commit"), "utf8").trim() === c
  const one = commit("first", false), a = build()
  check("the first build is in update.noindex, its cache read-only", a.code === 0 && a.last === one && has(one), a)
  const two = commit("second", false), b = build()
  check("the next replaces it", b.code === 0 && b.last === two && has(two), b)
  commit("third", true)
  const c = build()
  check("one that fails after it was packed leaves the last as it was", c.code !== 0 && has(two) && fs.existsSync(path.join(src, at)), c)
  const four = commit("fourth", false), d = build()
  check("...and the next goes in over what it left", d.code === 0 && d.last === four && has(four), d)
})

await section("a tree with read-only folders is deleted (core/update/store.ts)", async () => {
  const app = path.join(tmp, "read-only", bundle(""))
  readOnlyCache(app)
  if (modesEnforced) check("rmSync alone can't", (() => { try { fs.rmSync(app, { recursive: true, force: true }); return false } catch { return fs.existsSync(app) } })())
  removeReadOnly(app)
  check("removeReadOnly does", !fs.existsSync(app))
  removeReadOnly(app)
  check("...and nothing there is fine", !fs.existsSync(app))
})

await section("a copy that isn't the build is never staged", async () => {
  for (const [what, o, why] of [
    ["another commit's build.json", { build: OLD.replace(/a/g, "c") }, "build.json says"],
    ["no server.ts", { omit: `${RES}/server.ts` }, `no ${RES}/server.ts`],
    ["no electron/main.ts", { omit: `${RES}/electron/main.ts` }, `no ${RES}/electron/main.ts`],
    ["a shell without its picker", { omit: `${RES}/electron/shell/roots.mjs` }, "no electron/shell/roots.mjs"],
    ["a shell without its fingerprint", { print: "" }, "no fingerprint"],
  ] as const) {
    const app = appPid(), i = install({ pid: app.pid!, ...o })
    const staged = await i.staged, code = await i.done
    check(`${what}: not staged, and it ends at once (the app keeps running)`, !staged && code === 1 && app.exitCode === null, { code, log: i.log() })
    check(`${what}: the app stays as it was, nothing left beside it`, commitAt(i.app) === OLD && !fs.existsSync(`${i.app}.new`) && !opens().length)
    check(`${what}: the log says why`, i.log().includes("not installed") && i.log().includes(why), i.log())
    await end(app)
  }
})

await section("a build from before the shell (a server's older commit) still goes in", async () => {
  const app = appPid(), i = install({ pid: app.pid!, omit: `${RES}/electron/shell/boot.mjs` })
  check("staged", await i.staged, i.log())
  await end(app)
  check("...and installed", (await i.done) === 0 && commitAt(i.app) === NEW, i.log())
})

await section("opened again before the swap: not swapped out from under it", async () => {
  const app = appPid(), i = install({ pid: app.pid! })
  await i.staged
  const again = run(path.join(i.app, BIN), [hold])
  await sleep(300)
  await end(app)
  const code = await i.done
  check("the app opened again keeps its tree, and the copy goes", code === 0 && commitAt(i.app) === OLD && !fs.existsSync(`${i.app}.new`), { code, log: i.log() })
  check("...it isn't opened a second time", !opens().length, opens())
  check("...and the log says so", i.log().includes("opened again before the swap"), i.log())
  await end(again)
})

await section("its helpers, terminal keeper and agents' vau mcp still running don't hold it back", async () => {
  const app = appPid(), i = install({ pid: app.pid! })
  await i.staged
  // (Chromium's helpers run with --type=; the terminal keeper and vau mcp, the app's binary as Node, outlive it)
  const helpers = [run(path.join(i.app, BIN), [path.join(i.app, RES, "plugins/core/terminal/termd/daemon.ts")]),
    run(path.join(i.app, BIN), [path.join(i.app, RES, "bin/vau"), "mcp"]), run(path.join(i.app, BIN), [hold, "--type=renderer"])]
  await sleep(300)
  await end(app)
  const code = await i.done
  check("it installs", code === 0 && commitAt(i.app) === NEW && opens().length === 1, { code, log: i.log() })
  for (const h of helpers) await end(h)
})

await section("quit for good (stay): installed, not opened", async () => {
  const app = appPid(), i = install({ pid: app.pid!, stay: true })
  await i.staged
  await end(app)
  const code = await i.done
  check("the new build is the app, and nothing opens it", code === 0 && commitAt(i.app) === NEW && !opens().length, { code, log: i.log() })
})

await section("a swap that fails leaves the old app whole, and opens it", async () => {
  if (!modesEnforced) return check("(skipped: file modes aren't enforced here)", true)
  const app = appPid(), i = install({ pid: app.pid! })
  await i.staged
  const apps = path.dirname(i.app)
  fs.chmodSync(apps, 0o555) // (nothing in Applications can be renamed now)
  await end(app)
  const code = await i.done
  fs.chmodSync(apps, 0o755)
  check("the old app is there, whole", commitAt(i.app) === OLD && fs.existsSync(path.join(i.app, RES, "server.ts")), { code, log: i.log() })
  check("...opened again, the old one", opens().length === 1 && opens()[0].commit === OLD, opens())
  check("...and the log says it wasn't installed", i.log().includes("not installed"), i.log())
})

await section("after a launch: the running server against the installed build", () => {
  const root = path.join(tmp, "installed")
  makeBuild(root, NEW)
  const at = path.join(root, RES)
  check("the installed commit is the one on disk", installedCommit(at) === NEW)
  check("none on disk: none", installedCommit(path.join(tmp, "nowhere")) === null)
  check("a server on the installed build stays", !afterUpdate({ installed: NEW, app: NEW, server: NEW, restarted: false }).restart)
  check("one on the replaced build restarts", afterUpdate({ installed: NEW, app: NEW, server: OLD, restarted: false }).restart)
  check("...once", !afterUpdate({ installed: NEW, app: NEW, server: OLD, restarted: true }).restart)
  check("an app started from the replaced tree is stale", afterUpdate({ installed: NEW, app: OLD, server: OLD, restarted: false }).stale)
  check("a server that doesn't say, or no build.json: nothing done", (({ restart, stale }) => !restart && !stale)(afterUpdate({ installed: null, app: OLD, server: OLD, restarted: false }))
    && !afterUpdate({ installed: NEW, app: NEW, server: null, restarted: false }).restart)
})

await section("an automatic restart: what it waits on (electron/updatelogic.ts)", async () => {
  const { AWAY_S, restartWaitsOn } = await import("../electron/updatelogic.ts")
  const away = { othersOpen: false, pages: 2, safe: 2, idle: AWAY_S, talked: Infinity, busy: null }
  check("every window safe, the user away, the browser idle: it restarts", restartWaitsOn(away) === null)
  check("a window not safe yet, the user at the computer, another machine's window: it waits", !!restartWaitsOn({ ...away, safe: 1 })
    && !!restartWaitsOn({ ...away, idle: AWAY_S - 1 }) && !!restartWaitsOn({ ...away, othersOpen: true }) && !!restartWaitsOn({ ...away, pages: 0, safe: 0 }))
  check("keys and pointer untouched for long, but the user talked to the companion a minute ago (a typed ask, an exchange): it waits",
    restartWaitsOn({ ...away, idle: 3 * AWAY_S, talked: 60 }) === "the user is talking to the companion" && restartWaitsOn({ ...away, talked: AWAY_S }) === null)
  check("an ask to the companion under way (dictating, its turn running): it waits, saying why",
    restartWaitsOn({ ...away, talked: 0, busy: "an exchange with the companion is on" }) !== null)
  check("agents at work in the browser: it waits, saying why", restartWaitsOn({ ...away, busy: "an agent's call is under way" }) === "an agent's call is under way")
})

await section("the app's updates as one machine: each event's move and effects (electron/updatelogic.ts)", async () => {
  const { START, step, statusOf, menuItem, offerMessage, buildFailure, describe } = await import("../electron/updatelogic.ts")
  type U = typeof START
  type E = Parameters<typeof step>[1]
  type Of<T extends E["type"]> = Extract<E, { type: T }>
  const C = "c".repeat(40), D = "d".repeat(40)
  const play = (events: E[], from: U = START) => {
    let s = from
    const fx: string[] = [], ignored: string[] = []
    for (const e of events) {
      const r = step(s, e)
      s = r.to
      fx.push(...r.do.map((d) => d.kind === "leave" ? `leave:${d.then}` : d.kind === "stage" ? `stage:${d.reopen ? "reopen" : "stay"}` : d.kind))
      if (r.ignored) ignored.push(e.type)
    }
    return { s, fx: fx.join(" "), ignored }
  }
  const fxOf = (from: U, e: E) => step(from, e).do
  const timer: Of<"check"> = { type: "check", byHand: false, via: "build", off: false, recent: false }
  const byHand: Of<"check"> = { type: "check", byHand: true, via: "build", off: false, recent: false }
  const built = (code: number, out = `${C}\n`, at: string | null = C): Of<"built"> => ({ type: "built", code, out, built: at, quitting: false })
  const offered = (how: "install" | "release" | "relaunch" = "install", commit = C): Of<"offered"> => ({ type: "offered", commit, how })
  const stageable: Of<"restart"> = { type: "restart", byHand: true, built: C, replaceable: true, releases: true }

  const quiet = play([timer, { type: "pinned", want: "" }, { type: "building", commit: C }, built(0)])
  check("on the timer: its servers' commit asked, then a build, its toast once it says what it builds, then offered",
    quiet.fx === "pin build menu status status tell menu weigh menu" && quiet.s.offer?.commit === C && quiet.s.offer.how === "install" && quiet.s.look.kind === "idle", quiet.fx)
  const said = step(step(step(START, timer).to, { type: "pinned", want: "" }).to, { type: "building", commit: C }).to
  check("...its toast says what it updates to", statusOf(said, "Lighthouse")?.text === `Updating Lighthouse to ${C.slice(0, 7)}…`)
  const asked = step(step(START, byHand).to, { type: "pinned", want: D }).to
  check("by hand: Checking for updates… from the build's start", statusOf(asked, "Lighthouse")?.text === "Checking for updates…" && statusOf(step(START, byHand).to, "L") === null)
  const current = fxOf(asked, built(3))
  check("by hand, nothing newer: up to date, saying it runs its server's version", current.some((d) => d.kind === "current" && d.current.via === "build" && d.current.pinned))
  const failed = fxOf(asked, built(1, "boot: 2 failed\n", null)).find((d) => d.kind === "failed")
  check("by hand, a failed build: why in a line", failed?.kind === "failed" && failed.why === "The new version didn't pass its startup check.", failed)
  check("...on the timer, or quitting: no dialog", !fxOf(step(step(START, timer).to, { type: "pinned", want: "" }).to, built(1, "x", null)).some((d) => d.kind === "failed")
    && !fxOf(asked, { ...built(1, "x", null), quitting: true }).some((d) => d.kind === "failed"))
  check("its failures, told apart", buildFailure("no code signing identity in the keychain: not building").startsWith("This Mac has no code signing identity")
    && buildFailure("not building an update signed ad hoc").startsWith("The new version couldn't be signed") && buildFailure("from before cookie encryption").startsWith("Its server runs")
    && buildFailure("npm ERR!") === "The new version didn't build.")
  check("a timer's check while off or after a recent build: nothing; by hand: it goes", play([{ ...timer, off: true }]).s === START && play([{ ...timer, recent: true }]).s === START
    && step(START, { ...byHand, off: true, recent: true }).to.look.kind === "pinning")
  check("its servers' commit not had: back to idle, the next check builds", step(step(START, byHand).to, { type: "pin-failed" }).to.look.kind === "idle")
  check("nothing to look through (not updatable): nothing", play([{ ...byHand, via: null }]).s === START)
  check("one look at a time: a check while one runs is ignored", step(asked, byHand).ignored === true && step(step(START, byHand).to, timer).ignored === true)

  const waiting = play([offered()]).s
  const dropped = play([timer, { type: "pinned", want: "" }, built(1, "x", D)], waiting).s
  check("a build that fails and leaves another in its folder takes the offer down", dropped.offer === null && dropped.look.kind === "idle")
  check("...one that leaves it there keeps it", play([timer, { type: "pinned", want: "" }, built(1, "x", C)], waiting).s.offer?.commit === C)
  check("the same build again on the timer: not offered twice; by hand: offered anew", play([timer, { type: "pinned", want: "" }, built(0)], waiting).fx === "pin build menu status menu"
    && play([byHand, { type: "pinned", want: "" }, built(0)], waiting).fx.includes("tell menu weigh"))

  const store = step(START, { ...byHand, via: "store" })
  check("the store's look by hand: Checking for updates…, the menu busy", store.do.map((d) => d.kind).join(" ") === "status menu store-look"
    && statusOf(store.to, "L")?.text === "Checking for updates…" && menuItem(store.to, { worktree: false, updatable: true })?.enabled === false)
  const upToDate = fxOf(store.to, { type: "looked", state: "current", why: "it runs the newest", quitting: false })
  check("...up to date: said, with why", upToDate.some((d) => d.kind === "current" && d.current.via === "store" && d.current.why === "it runs the newest"))
  const mid = play([{ ...byHand, via: "store" }, offered("relaunch"), { type: "looked", state: "current", why: "", quitting: false }])
  check("...an update offered while it looked: no up-to-date dialog", mid.s.offer?.how === "relaunch" && !mid.fx.includes("current"), mid.fx)
  check("...failed: why said, not while quitting", fxOf(store.to, { type: "looked", state: "failed", why: "no network", quitting: false }).some((d) => d.kind === "failed" && d.why === "No network.")
    && !fxOf(store.to, { type: "looked", state: "failed", why: "x", quitting: true }).some((d) => d.kind === "failed"))
  check("...on the timer: no toast at its start nor its end", play([{ ...timer, via: "store" }, { type: "looked", state: "current", why: "", quitting: false }]).fx === "menu store-look menu")

  const release = play([{ ...timer, via: "release" }, { type: "release-found", version: "1.2.3" }])
  check("a release: its download's toast, on the timer too", statusOf(release.s, "Lighthouse")?.text === "Downloading Lighthouse 1.2.3…")
  check("...its end always takes the toast down; by hand up to date, said", play([{ ...byHand, via: "release" }, { type: "release-looked", outcome: { kind: "current" }, quitting: false }]).fx === "menu status release-look current status menu"
    && play([{ ...timer, via: "release" }, { type: "release-looked", outcome: { kind: "current" }, quitting: false }]).fx === "menu release-look status menu")

  check("an offer: told in every window and the menu, then weighed; the same one again: nothing", play([offered()]).fx === "tell menu weigh" && play([offered(), offered()]).fx === "tell menu weigh"
    && play([offered(), { ...offered(), again: true }]).fx === "tell menu weigh tell menu weigh" && play([offered(), offered("relaunch")]).fx === "tell menu weigh tell menu weigh")
  const behind = play([{ ...offered("relaunch"), behind: "electron/main.ts changed" }, offered("relaunch")]).s
  check("why the main process is behind: kept when the same offer comes without it, replaced when said", behind.offer?.behind === "electron/main.ts changed"
    && play([{ type: "offered", commit: C, how: "relaunch", behind: null }], behind).s.offer?.behind === null)

  const wait = play([offered(), { type: "weighed", auto: true, why: "the user is at the computer" }])
  check("automatic, not safe yet: it waits, saying on what, looked at again in a minute", wait.s.offer?.restart.kind === "waiting" && wait.fx.endsWith("arm")
    && describe(wait.s).includes("waits: the user is at the computer"))
  check("...a new reason: still waiting, on it", (({ s }) => s.offer?.restart.kind === "waiting" && s.offer.restart.on === "no window is open")(play([{ type: "weighed", auto: true, why: "no window is open" }], wait.s)))
  check("...no longer automatic: it stops waiting, its minute's look dropped", play([{ type: "weighed", auto: false, why: null }], wait.s).fx === "disarm"
    && play([{ type: "weighed", auto: false, why: null }], wait.s).s.offer?.restart.kind === "offered")
  check("...safe: it restarts", play([{ type: "weighed", auto: true, why: null }], wait.s).fx === "restart")
  check("not automatic, or nothing offered: weighing does nothing", play([offered(), { type: "weighed", auto: false, why: null }]).fx === "tell menu weigh"
    && play([{ type: "weighed", auto: true, why: null }]).fx === "")

  const staging = play([offered(), stageable])
  check("restart into a build: staged beside the app, the toast says it restarts", staging.fx === "tell menu weigh stop-build stage:reopen note status"
    && statusOf(staging.s, "L")?.text === "Restarting to update…" && statusOf(staging.s, "L")?.restart === true)
  check("...not its build in the folder, or the app can't be replaced: nothing", play([offered(), { ...stageable, built: D }]).ignored.join() === "restart"
    && play([offered(), { ...stageable, replaceable: false }]).ignored.join() === "restart")
  check("...pressed twice: once", play([stageable], staging.s).ignored.join() === "restart" && play([stageable], staging.s).fx === "")
  check("...while it stages: no build starts, no new offer, the toast stays", play([byHand, offered("install", D)], staging.s).ignored.join() === "check,offered"
    && statusOf(play([{ type: "looked", state: "current", why: "", quitting: false }], { ...staging.s, look: { kind: "store", byHand: true } }).s, "L")?.text === "Restarting to update…")
  check("...staged: it quits", play([{ type: "staged", ok: true }], staging.s).fx === "leave:quit")
  const preparing = play([{ ...timer, via: "store" }, offered("relaunch"), stageable])
  check("a relaunch while the store prepares a commit waits for it (its build never cut short), then is weighed again",
    preparing.s.offer?.restart.kind === "waiting" && preparing.fx.endsWith("arm") && !preparing.fx.includes("hand-over")
    && play([{ type: "looked", state: "current", why: "", quitting: false }], preparing.s).fx.endsWith("weigh"), preparing.fx)
  const unstaged = play([{ type: "staged", ok: false }], staging.s)
  check("...not staged: the offer dropped (not again until the next check), the toast down, said when by hand", unstaged.s.offer === null && unstaged.fx === "unnote status menu failed"
    && statusOf(unstaged.s, "L") === null && play([{ type: "weighed", auto: true, why: null }], unstaged.s).fx === "")
  check("a relaunch onto a root it has: its servers handed over, the note, a relaunch", play([offered("relaunch"), stageable]).fx === "tell menu weigh hand-over begin-quit note status leave:relaunch-soon")
  check("a release: installed as it quits, once electron-updater is loaded", play([offered("release"), stageable]).fx === "tell menu weigh begin-quit note status leave:release"
    && play([offered("release"), { ...stageable, releases: false }]).ignored.join() === "restart")
  const dev = play([{ type: "changed", what: "web/src changed" }, { type: "changed", what: "web/src changed" }, stageable])
  check("a Dev instance's changes: offered without weighing, once each, a relaunch with no note", dev.fx === "tell menu hand-over begin-quit status leave:relaunch")

  const quit = (from: U, o: Partial<Of<"quit">> = {}) => play([{ type: "quit", off: false, updatable: true, built: C, replaceable: true, ...o }], from).fx
  check("quitting: a build stops; one offered goes in as it quits", quit(START) === "stop-build" && quit(waiting) === "stop-build stage:stay")
  check("...not when off, not updatable, its folder holds another, a relaunch's or a release's, or one already staging", quit(waiting, { off: true }) === "stop-build" && quit(waiting, { updatable: false }) === "stop-build"
    && quit(waiting, { built: D }) === "stop-build" && quit(play([offered("relaunch")]).s) === "stop-build" && quit(play([offered("release")]).s) === "stop-build" && quit(staging.s) === "stop-build")

  check("the mode changed: every window told; a check unless off or one is offered", play([{ type: "mode-changed", off: false }]).fx === "tell check"
    && play([{ type: "mode-changed", off: true }]).fx === "tell" && play([{ type: "mode-changed", off: false }], waiting).fx === "tell")

  const item = (s: U, worktree = false, updatable = true) => menuItem(s, { worktree, updatable })?.label ?? null
  check("the menu: Check for updates…, Restart or Relaunch to update, a Dev instance's Relaunch, none when not updatable", item(START) === "Check for updates…"
    && item(waiting) === "Restart to update" && item(play([offered("relaunch")]).s) === "Relaunch to update" && item(dev.s, true) === "Relaunch to run your changes"
    && item(START, true) === null && item(START, false, false) === null)
  const msg = (how: "install" | "release" | "relaunch", auto: boolean) => offerMessage({ commit: how === "release" ? "1.2.3" : C, how, behind: null, restart: { kind: "offered" } }, "Lighthouse", auto)
  check("the toast: a build's short commit, a release's version, a relaunch's words", JSON.stringify(msg("install", false)) === JSON.stringify({ type: "update", name: "Lighthouse", version: C.slice(0, 7), auto: false })
    && JSON.stringify(msg("release", true)) === JSON.stringify({ type: "update", name: "Lighthouse", version: "1.2.3", auto: true })
    && JSON.stringify(msg("relaunch", true)) === JSON.stringify({ type: "update", text: `Lighthouse ${C.slice(0, 7)} is ready: relaunching takes a couple of seconds, and it does so while you're away`, label: "Relaunch", auto: true })
    && JSON.stringify(offerMessage({ commit: "web/src changed", how: "worktree", behind: null, restart: { kind: "offered" } }, "L", false)) === JSON.stringify({ type: "update", text: "web/src changed: relaunch to run them", label: "Relaunch" }))
})

await section("a background update that fails: kept, counted and told once (electron/updatelogic.ts)", async () => {
  const { START, step, buildFailure, describe, failed, failedMessage, FAILURES_TOLD_AFTER } = await import("../electron/updatelogic.ts")
  type U = typeof START
  type E = Parameters<typeof step>[1]
  const C = "c".repeat(40), D = "d".repeat(40)
  const play = (events: E[], from: U = START) => events.reduce<{ s: U; told: string[] }>(({ s, told }, e) => {
    const r = step(s, e)
    return { s: r.to, told: [...told, ...r.do.flatMap((d) => (d.kind === "failed" ? [d.tell] : []))] }
  }, { s: from, told: [] })
  const started = (byHand: boolean): E[] => [{ type: "check", byHand, via: "build", off: false, recent: false }, { type: "pinned", want: "" }]
  const ended = (code: number | null, out: string, quitting = false): E => ({ type: "built", code, out, built: code === 0 ? C : null, quitting })
  const building: E = { type: "building", commit: C }, noticed: E = { type: "noticed" }
  const fails = (out = "npm ERR!", code: number | null = 1) => [...started(false), building, ended(code, out)]
  const offline = [...started(false), ended(128, "fatal: unable to access 'https://github.com/': Could not resolve host: github.com")]
  const works = [...started(false), building, ended(0, `${C}\n`)], current = [...started(false), ended(3, "")]
  const times = (n: number, run: E[]) => Array.from({ length: n }, () => run).flat()
  const counted = (events: E[]) => failed(play(events).s)?.times
  const told = (events: E[], from?: U) => play(events, from).told.join(" ")

  for (const line of ["rm: dist-app/mac-arm64/L.app/a1b2: Permission denied", "rm: cannot remove 'dist-app/a1b2': Permission denied", "mv: rename dist-app/mac-arm64/L.app to /u/L.app: Directory not empty"]) {
    check(`its reason: ${line.slice(0, 20)}…`, buildFailure(`@building ${C}\n${line}\n`).startsWith("The last build couldn't be deleted (Permission denied)"))
  }
  const one = play(fails())
  check("one: nobody told, and the log's line says it failed and why", one.told.length === 0 && describe(one.s) === "idle, failed (1 in a row): The new version didn't build.", describe(one.s))
  const several = play(times(FAILURES_TOLD_AFTER, fails()))
  check(`${FAILURES_TOLD_AFTER} in a row: a notice, no dialog`, several.told.join() === "notice", several.told)
  check("...saying the app, its machine, how often and why", failedMessage(several.s, "Lighthouse", "studio") === "Lighthouse on studio couldn't update 3 times in a row. The new version didn't build.")
  check("...given again at the next when no vault took it", told(fails(), several.s) === "notice")
  check("...never again once one did", told([noticed, ...times(5, fails())], several.s) === "")
  for (const [what, run] of [["one that works", works], ["nothing newer", current]] as const) {
    check(`${what} clears it, and the next failures are told anew`, counted([...fails(), ...run]) === undefined && told([noticed, ...run, ...times(FAILURES_TOLD_AFTER, fails())], several.s) === "notice")
  }
  const away = play(times(9, offline))
  check("offline: kept as failed, never counted or told", describe(away.s) === "idle, failed: It couldn't reach the network." && !away.told.length, describe(away.s))
  check("...npm's install offline too", counted(fails("npm error code ENOTFOUND\nnpm error network request failed")) === 0)
  check("...and a fetch that stalled till it was stopped", counted([...started(false), ended(null, "")]) === 0)
  check("...between two failures it neither counts nor clears", counted([...fails(), ...offline, ...fails()]) === 2)
  check("a build's own words about a connection count", counted(fails("FAIL smoke: connection refused")) === 1)
  check("...and a build stopped after its 45 minutes", counted(fails("", null)) === 1)
  check("a build stopped as the app quits isn't a failure", counted([...started(false), building, ended(null, "", true)]) === undefined)
  check("by hand: the dialog, so no notice after it", told([...started(true), ended(1, "x"), ...times(5, fails())]) === "dialog")
  check("...one about the network only doesn't stand in for the notice", told([...started(true), offline[2], ...times(FAILURES_TOLD_AFTER, fails())]) === "dialog notice")

  const store = (next: string, state = "failed"): E[] => [{ type: "check", byHand: false, via: "store", off: false, recent: false }, { type: "looked", state, why: "its new shell didn't build", next, quitting: false }]
  check("the store's looks at one commit that failed: one failure", counted(times(9, store(C))) === 1)
  check("...three commits: told", told([C, D, "e".repeat(40)].flatMap((n) => store(n))) === "notice")
  check("...waiting changes nothing, current clears", counted([...store(C), ...store(D, "waiting")]) === 1 && counted([...store(C), ...store(D, "current")]) === undefined)
})

await section("updates that keep failing are told by one vault's server (electron/attached.ts)", async () => {
  const { tellOneVault } = await import("../electron/attached.ts")
  const asked: { url?: string; body: string }[] = [], logged: string[] = []
  const servers: http.Server[] = []
  const server = async (status: number) => {
    const port = await freePort()
    const s = http.createServer((q, r) => { let body = ""; q.on("data", (b) => (body += b)).on("end", () => { asked.push({ url: q.url, body }); r.writeHead(status).end("{}") }) })
    servers.push(s)
    await new Promise<void>((ok) => s.listen(port, "127.0.0.1", ok))
    return port
  }
  const down = await server(503), up = await server(200), other = await server(200), all = [down, up, other]
  const tell = (of: number[]) => tellOneVault(of, (l) => logged.push(l), "Lighthouse hasn't updated", "/logs/update.log")
  check("the first server that takes it, and no other", await tell(all) && asked.length === 2 && asked.every((a) => a.url === "/api/ops/ui.notify"
    && a.body === JSON.stringify({ text: "Lighthouse hasn't updated", error: true, actionOpen: "/logs/update.log" })), asked)
  check("...none did: false, so it's told at the next failure, and the log says both", !await tell([down]) && !await tell([]) && logged.length === 3 && logged[0].includes("told the user"), logged)
  for (const s of servers) { s.closeAllConnections(); s.close() }
})

await section("a Linux package the feed doesn't serve is its package manager's to update (electron/updatelogic.ts)", async () => {
  const { packageManaged } = await import("../electron/updatelogic.ts")
  check("the AUR's (pacman) is pacman's; the AppImage, the .deb and other systems update themselves", packageManaged("linux", "pacman")
    && !packageManaged("linux", null) && !packageManaged("linux", "deb") && !packageManaged("darwin", "pacman"))
})

await section("Main's updates through its code store: where, and its two policies (electron/storepolicy.ts)", async () => {
  const { pinOf, policyFor, storeWanted } = await import("../electron/storepolicy.ts")
  const main = { packaged: true, channel: "main", release: false, platform: "darwin", marker: true }
  check("Vaultite Main where its marker is: the store", storeWanted(main) && storeWanted({ ...main, platform: "linux" }))
  check("...not without the marker (updates as before), nor a release, Windows, Dev or a run from source", !storeWanted({ ...main, marker: false }) && !storeWanted({ ...main, release: true })
    && !storeWanted({ ...main, platform: "win32" }) && !storeWanted({ ...main, channel: "dev" }) && !storeWanted({ ...main, channel: "nightly", release: true }) && !storeWanted({ ...main, packaged: false }))
  const server = "5".repeat(40), attached = await policyFor(server), alone = await policyFor("")
  check("attached to a service: only the commit its server runs, checked by its server booting", attached.follows === "server" && (await attached.ci("", server)).ok === true
    && (await attached.ci("", "6".repeat(40))).ok === null && attached.recipe.preflight.map((x) => x.name).join() === "server boots,main's compile cache")
  check("standalone: the branch's newest, CI not waited for, smoke too", alone.follows === "branch" && (await alone.ci("", "6".repeat(40))).ok === true
    && alone.recipe.preflight.map((x) => x.name).join() === "server boots,main's compile cache,smoke")
  // (what updates.ts' attachedTo gives policyFor: a window's server, own or a service, and the commit it runs)
  const service = (commit: string) => ({ own: false, commit }), mine = { own: true, commit: "" }
  check("every window on a real service (vau service's, another app's): pinned to the commit it runs", pinOf([service(server), service(server)]) === server)
  check("...one not saying yet: the look waits (null); two on different commits, or a window on its own server: the branch",
    pinOf([service(server), service("")]) === null && pinOf([service(server), service("6".repeat(40))]) === "" && pinOf([service(server), null]) === "" && pinOf([]) === "")
  check("windows attached to this app's own kept server (its last launch's, taken over; started at launch): the branch, never pinned to it",
    pinOf([mine]) === "" && pinOf([mine, service(server)]) === "")
})

await section("moved into Applications from its disk image: a copy already there (electron/movelogic.ts)", async () => {
  const { moveConflict, plistVersion } = await import("../electron/movelogic.ts")
  const plist = (v: string) => `<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n\t<key>CFBundleName</key>\n\t<string>Lighthouse</string>\n\t<key>CFBundleShortVersionString</key>\n\t<string>${v}</string>\n</dict>\n</plist>\n`
  check("its version read from its Info.plist; none when it says none", plistVersion(plist("0.12.0")) === "0.12.0" && plistVersion("<plist><dict></dict></plist>") === null && plistVersion("") === null)
  const at = (version: string | null, running = false) => moveConflict("Lighthouse", "0.12.0", { version, running })
  check("an older or the same version, not running: replaced without a word", at("0.11.4").kind === "replace" && at("0.12.0").kind === "replace" && at("0.12.0-beta.1").kind === "replace")
  const newer = at("0.13.0")
  check("a newer one: asked, keeping it the default, saying both versions", newer.kind === "ask" && newer.buttons?.[0] === "Keep the newer one" && /0\.13\.0/.test(newer.detail) && /0\.12\.0/.test(newer.detail), newer)
  const unread = at(null)
  check("one whose version can't be read: asked too", unread.kind === "ask" && unread.buttons?.[1] === "Replace it", unread)
  const open = at("0.11.0", true)
  check("one that's running, whatever its version: never replaced, it says to quit it first", open.kind === "say" && /Quit it/.test(open.detail) && at("0.13.0", true).kind === "say", open)
  const main = fs.readFileSync(path.join(import.meta.dirname, "..", "electron", "main.ts"), "utf8")
  const offer = main.slice(main.indexOf("async function offerMove"), main.indexOf("function ejectImages"))
  check("main.ts asks through it, and a copy a script drives (VAULTITE_QUIET) is never asked", /moveConflict\(/.test(offer) && !/conflictHandler: \(\) => true/.test(offer) &&
    /if \(![^\n]*\bdriven\b[^\n]*\) return false/.test(offer) && /const driven = !!process\.env\.VAULTITE_QUIET/.test(main))
})

writable(tmp, true)
await exit(summary("update", t0))
