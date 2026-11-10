// The root store: each commit the app runs made once into its own read-only folder (a code root), so each process keeps
// a consistent tree while newer ones are made beside it. electron/shell/roots.mjs picks among them: the layout is its.
import { execFile, spawn } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { gitEnv } from "../gitenv.ts"
import { fixSpawnHelper } from "./npm.ts"
import { leaseIn, processStart, type Lease } from "./lease.ts"
import { fingerprint } from "../../electron/shell/print.mjs"

const exec = promisify(execFile)
const MINUTE = 60_000
const SHA = /^[0-9a-f]{40}$/
/** A root this new stays through a gc: made, and about to be current (its host's next step after prepare). */
const FRESH = 10 * MINUTE
/** In a deps set, what builds write (tsconfig's tsBuildInfoFile, vite's cacheDir): left writable, shared as caches. */
const CACHES = [".tmp", ".vite"]

/** Runs a command: its stdout; throws with its stderr's end when it fails. */
export type Exec = (cmd: string, args: string[], o: { cwd: string; env?: NodeJS.ProcessEnv; timeout?: number }) => Promise<string>
const execIn: Exec = async (cmd, args, o) => {
  try { return (await exec(cmd, args, { cwd: o.cwd, env: o.env ?? process.env, timeout: o.timeout ?? 30 * MINUTE, maxBuffer: 64 << 20 })).stdout } catch (e) {
    // (a build's warnings fill its stderr: the lines that say error are the why)
    const x = e as { stdout?: string; stderr?: string; message: string }, all = `${x.stdout ?? ""}\n${x.stderr ?? ""}`.split("\n").map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim()).filter(Boolean)
    const errors = all.filter((l) => /\berror\b|\bERR!|failed|FAIL\b/i.test(l))
    throw new Error((errors.length ? errors : all).slice(-3).join(" ").slice(0, 500) || x.message, { cause: e })
  }
}

/** What a step is given: the root being prepared and the store's own. */
export type StepCtx = { root: string; store: string; helpers: string; node: string; env: NodeJS.ProcessEnv; exec: Exec }
/** One step of a root's making: its name (for the log and the measures) and what it does in the root. */
export type Step = { name: string; run: (c: StepCtx) => Promise<void> }
/** How a commit becomes a root: its build steps, the files it must have, and the preflight that runs it once. */
export type Recipe = { build: Step[]; keyFiles: string[]; preflight: Step[] }

/** A free port on this machine. */
const freePort = () => new Promise<number>((resolve, reject) => {
  const srv = net.createServer().listen(0, "127.0.0.1", () => { const p = (srv.address() as net.AddressInfo).port; srv.close(() => resolve(p)) })
  srv.on("error", reject)
})

/** The root's server, started on a sandbox vault of its own with the shell's Node, answers; then it's stopped. */
export const serverBoots: Step = {
  name: "server boots",
  async run(c) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-preflight-"))
    try {
      const vault = path.join(tmp, "vault"), port = await freePort()
      await c.exec(c.node, [path.join(c.root, "bin", "vau"), "sandbox", vault], { cwd: c.root, env: c.env, timeout: 2 * MINUTE })
      const server = spawn(c.node, [path.join(c.root, "server.ts")], { cwd: c.root, stdio: ["ignore", "ignore", "pipe"],
        env: { ...c.env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: vault, VAULTITE_LOCAL: path.join(tmp, "local"), VAULTITE_QUIET: "1" } })
      let said = ""
      server.stderr.on("data", (b) => { said = (said + b).slice(-2000) })
      try {
        for (let i = 0; i < 240; i++) {
          if (server.exitCode !== null) break
          if (await fetch(`http://127.0.0.1:${port}/api/state`).then((r) => r.ok, () => false)) return
          await new Promise((r) => setTimeout(r, 250))
        }
        throw new Error(`its server didn't answer${said ? `: ${said.trim().split("\n").slice(-3).join(" ")}` : ""}`)
      } finally {
        const gone = new Promise((r) => server.exitCode !== null ? r(null) : server.once("exit", r))
        server.kill("SIGTERM")
        await Promise.race([gone, new Promise((r) => setTimeout(r, 10_000))])
        if (server.exitCode === null) server.kill("SIGKILL")
      }
    } finally { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
  },
}

/** The app's recipe, as npm run app:build makes a build: the web app, the native helpers (from the store's cache), the
 *  stamps; then its server boots and the smoke test passes, with the shell's Node. */
export function appRecipe(o: { channel?: string } = {}): Recipe {
  const npm = (c: StepCtx, args: string[], env: Record<string, string> = {}) => c.exec("npm", args, { cwd: c.root, env: { ...c.env, ...env } })
  return {
    build: [
      { name: "web build", run: (c) => npm(c, ["run", "build"], { VAULTITE_CLEAN_BUILD: "1" }).then(() => {}) },
      { name: "helpers", run: (c) => c.exec(c.node, ["tools/build_helpers.ts", "--cache", c.helpers], { cwd: c.root, env: c.env }).then(() => {}) },
      { name: "stamp", run: (c) => c.exec(c.node, ["electron/stamp.ts"], { cwd: c.root, env: { ...c.env, VAULTITE_CHANNEL: o.channel ?? "main" } }).then(() => {}) },
    ],
    keyFiles: ["server.ts", "package.json", "bin/vau", "electron/boot.ts", "electron/main.ts", "electron/build.json", "web/dist/index.html",
      ...["boot.mjs", "roots.mjs", "vau.mjs", "print.mjs", "inputs.json"].map((f) => `electron/shell/${f}`)],
    preflight: [serverBoots, { name: "smoke", run: (c) => c.exec(c.node, ["web/qa/boot.mjs"], { cwd: c.root, env: c.env }).then(() => {}) }],
  }
}

export type StoreOptions = {
  /** The store's folder (Main's: userData/code.noindex). */
  dir: string
  /** origin's url. */
  url: string
  recipe?: Recipe
  /** The Node that runs the steps and the preflight (the shell's binary as Node: ELECTRON_RUN_AS_NODE in `env`). */
  node?: string
  env?: NodeJS.ProcessEnv
  /** Installs `dir`'s package-lock.json into its node_modules (`fresh`: nothing there yet). Default: npm. */
  install?: (dir: string, o: { fresh: boolean }) => Promise<void>
  exec?: Exec
  log?: (line: string) => void
  now?: () => number
  /** How long a root just made stays through a gc (default FRESH, 10 minutes). */
  fresh?: number
}

/** A prepared root: where, its commit, its shell fingerprint, its deps set, and how long it took. */
export type Root = { commit: string; dir: string; fingerprint: string; deps: string; prepared: number; seconds: number; steps: Record<string, number> }
export type { Lease }

const readJson = <T>(file: string): T | null => { try { return JSON.parse(fs.readFileSync(file, "utf8")) as T } catch { return null } }
const writeJson = (file: string, v: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(v, null, 2) + "\n")
  fs.renameSync(`${file}.${process.pid}.tmp`, file)
}
/** Every file and folder under `dir` writable (`on`) or not, links left as they are. */
function writable(dir: string, on: boolean) {
  const walk = (p: string) => {
    const st = fs.lstatSync(p)
    if (st.isSymbolicLink()) return
    if (st.isDirectory() && on) fs.chmodSync(p, st.mode | 0o200)
    if (st.isDirectory()) for (const n of fs.readdirSync(p)) walk(path.join(p, n))
    fs.chmodSync(p, on ? st.mode | 0o200 : st.mode & ~0o222)
  }
  if (fs.existsSync(dir)) walk(dir)
}
/** Gone, read-only or not. */
function remove(dir: string) {
  if (!fs.existsSync(dir)) return
  writable(dir, true)
  fs.rmSync(dir, { recursive: true, force: true })
}
/** A copy of `from` at `to` that shares its blocks where the filesystem can (APFS clones, Linux reflinks). */
async function cloneDir(from: string, to: string, run: Exec) {
  try {
    if (process.platform === "darwin") await run("cp", ["-cR", from, to], { cwd: path.dirname(to) })
    else if (process.platform === "linux") await run("cp", ["-R", "--reflink=auto", from, to], { cwd: path.dirname(to) })
    else throw new Error("no cp")
  } catch {
    fs.rmSync(to, { recursive: true, force: true })
    fs.cpSync(from, to, { recursive: true, mode: fs.constants.COPYFILE_FICLONE, verbatimSymlinks: true })
  }
}

/** Each store folder's turn in this process: a prepare and a gc of two rootStore()s of one folder never overlap. */
const chains = new Map<string, Promise<unknown>>()

export function rootStore(o: StoreOptions) {
  const dir = path.resolve(o.dir), run = o.exec ?? execIn, log = o.log ?? (() => {}), now = o.now ?? Date.now
  const recipe = o.recipe ?? appRecipe(), node = o.node ?? process.execPath, env = o.env ?? process.env
  /** A bare clone (an older source clone migrates in), and roots/<sha>: its detached worktrees, built, then 0555. */
  const repo = path.join(dir, "repo.git"), roots = path.join(dir, "roots")
  /** deps/<lock's blob>: node_modules for one package-lock.json, linked into its roots; helpers/<id>: built once. */
  const deps = path.join(dir, "deps"), helpers = path.join(dir, "helpers")
  // (also current.json and good.json, {"commit", "t"} by rename; bad/<sha>.json; leases/<sha>.<pid>.json; meta/<sha>.json)
  const git = (args: string[], cwd = repo) => run("git", args, { cwd, env: gitEnv(), timeout: 10 * MINUTE }).then((s) => s.trim())
  const rootOf = (sha: string) => path.join(roots, sha)
  const install = o.install ?? (async (d: string, x: { fresh: boolean }) => {
    await run("npm", [x.fresh ? "ci" : "install", "--no-audit", "--no-fund"], { cwd: d, env })
  })

  // One prepare or gc at a time, here (every rootStore of this folder in this process: chains) and in any other process.
  const lockFile = path.join(dir, "lock")
  async function locked<T>(fn: () => Promise<T>): Promise<T> {
    const mine = (chains.get(dir) ?? Promise.resolve()).then(async () => {
      fs.mkdirSync(dir, { recursive: true })
      for (let i = 0; ; i++) {
        try { fs.writeFileSync(lockFile, String(process.pid), { flag: "wx" }); break } catch {
          const pid = Number(fs.readFileSync(lockFile, "utf8"))
          let alive = false
          try { process.kill(pid, 0); alive = true } catch (e) { alive = (e as NodeJS.ErrnoException).code === "EPERM" }
          if (!alive || pid === process.pid) { fs.rmSync(lockFile, { force: true }); continue }
          if (i > 600) throw new Error(`the store is locked by process ${pid}`)
          await new Promise((r) => setTimeout(r, 1000))
        }
      }
      try { return await fn() } finally { fs.rmSync(lockFile, { force: true }) }
    })
    chains.set(dir, mine.catch(() => {}))
    return mine
  }

  /** The bare clone, made once: from an older clone of the same repo when given (its objects shared, no download). */
  async function init(from?: string) {
    if (fs.existsSync(path.join(repo, "HEAD"))) return
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${repo}.${process.pid}.tmp`
    fs.rmSync(tmp, { recursive: true, force: true })
    const local = from && fs.existsSync(path.join(from, ".git")) ? from : null
    await run("git", ["clone", "--quiet", "--bare", ...(local ? ["--local", local] : [o.url]), tmp], { cwd: dir, env: gitEnv(), timeout: 30 * MINUTE })
    await git(["remote", "set-url", "origin", o.url], tmp)
    await git(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"], tmp)
    fs.renameSync(tmp, repo)
    log(`store: made ${repo}${local ? ` from ${local}` : ""}`)
  }

  /** origin's branch, fetched: its commit. */
  async function fetch(branch: string) {
    await init()
    await git(["fetch", "--quiet", "--no-tags", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`])
    return git(["rev-parse", `refs/remotes/origin/${branch}`])
  }

  /** The deps set for `sha`'s package-lock.json: there already, or cloned from the newest one and installed. */
  async function depsFor(sha: string) {
    const blob = await git(["rev-parse", `${sha}:package-lock.json`])
    const at = path.join(deps, blob)
    if (fs.existsSync(path.join(at, ".ready"))) return { blob, at, made: false }
    remove(at)
    const tmp = path.join(deps, `.tmp-${blob}-${process.pid}`)
    remove(tmp)
    fs.mkdirSync(deps, { recursive: true })
    const near = fs.readdirSync(deps).filter((n) => /^[0-9a-f]{40}$/.test(n) && fs.existsSync(path.join(deps, n, ".ready")))
      .map((n) => ({ n, t: fs.statSync(path.join(deps, n, ".ready")).mtimeMs })).sort((a, b) => b.t - a.t)[0]
    try {
      if (near) { await cloneDir(path.join(deps, near.n), tmp, run); writable(tmp, true); fs.rmSync(path.join(tmp, ".ready"), { force: true }) }
      else fs.mkdirSync(tmp)
      for (const f of ["package.json", "package-lock.json", ".npmrc"]) {
        const text = await git(["show", `${sha}:${f}`]).catch(() => null)
        if (text !== null) fs.writeFileSync(path.join(tmp, f), text + "\n")
      }
      await install(tmp, { fresh: !near })
      fixSpawnHelper(path.join(tmp, "node_modules"))
      fs.writeFileSync(path.join(tmp, ".ready"), `${sha}\n`)
      for (const c of CACHES) fs.mkdirSync(path.join(tmp, "node_modules", c), { recursive: true })
      // (moved first: a Mac may refuse to rename a folder no longer writable)
      fs.renameSync(tmp, at)
      writable(at, false)
      // (the caches a root's build writes in node_modules, tsc's .tmp and vite's: the rest stays as installed)
      for (const c of CACHES) writable(path.join(at, "node_modules", c), true)
    } catch (e) { remove(tmp); remove(at); throw e }
    log(`store: deps ${blob.slice(0, 7)} for ${sha.slice(0, 7)}${near ? ` (from ${near.n.slice(0, 7)})` : ""}`)
    return { blob, at, made: true }
  }

  /** Why `root` isn't a sound root of `sha` (none: it is): its stamp and HEAD are the commit, its key files and web
   *  build are there, its dependencies resolve, and git has nothing changed or added in it. */
  async function check(root: string, sha: string): Promise<string[]> {
    const out: string[] = []
    const stamp = readJson<{ commit?: string }>(path.join(root, "electron", "build.json"))?.commit
    if (stamp !== sha) out.push(`its electron/build.json says ${stamp ?? "nothing"}, not ${sha}`)
    const head = await git(["rev-parse", "HEAD"], root).catch(() => "")
    if (head !== sha) out.push(`its HEAD is ${head || "unknown"}, not ${sha}`)
    for (const f of recipe.keyFiles) if (!fs.existsSync(path.join(root, f))) out.push(`it has no ${f}`)
    const pkg = readJson<{ dependencies?: Record<string, string> }>(path.join(root, "package.json"))
    for (const name of Object.keys(pkg?.dependencies ?? {})) {
      if (!fs.existsSync(path.join(root, "node_modules", name, "package.json"))) { out.push(`its dependency ${name} doesn't resolve`); break }
    }
    const status = await git(["status", "--porcelain"], root).catch((e) => `(git status failed: ${(e as Error).message})`)
    if (status) out.push(`git finds it changed: ${status.split("\n").slice(0, 3).join("; ")}`)
    return out
  }

  const metaOf = (sha: string) => readJson<Root>(path.join(dir, "meta", `${sha}.json`))
  const badOf = (sha: string) => readJson<{ why: string; t: number }>(path.join(dir, "bad", `${sha}.json`))
  const pointer = (name: "current" | "good") => {
    const c = readJson<{ commit?: string }>(path.join(dir, `${name}.json`))?.commit
    return typeof c === "string" && SHA.test(c) ? c : null
  }
  /** A prepared root of `sha`, or null. */
  const prepared = (sha: string): Root | null => { const m = metaOf(sha); return m && fs.existsSync(rootOf(sha)) ? m : null }

  /** Removes a root and its worktree's record. */
  async function drop(root: string) {
    remove(root)
    await git(["worktree", "prune"]).catch(() => {})
  }

  /** `sha` as a root: made, built, checked and preflighted once, then read-only. One that fails leaves nothing behind
   *  (and `current` as it was); a failure of its own code marks the commit bad, never tried again unless `retry`. */
  function prepare(sha: string, x: { retry?: boolean } = {}): Promise<Root> {
    return locked(async () => {
      if (!SHA.test(sha)) throw new Error(`${sha} isn't a full commit hash`)
      const bad = badOf(sha)
      if (bad && !x.retry) throw new Error(`${sha.slice(0, 7)} failed before: ${bad.why}`)
      const have = prepared(sha)
      if (have) return have
      await init()
      const t0 = now(), root = rootOf(sha), stage = path.join(roots, `.staging-${sha}`), steps: Record<string, number> = {}
      await drop(root)
      await drop(stage)
      fs.mkdirSync(roots, { recursive: true })
      const timed = async <T>(name: string, fn: () => Promise<T>) => { const t = now(); try { return await fn() } finally { steps[name] = (now() - t) / 1000 } }
      let mine = false // (a failure of the commit's own code, not of the network or the disk)
      try {
        await timed("worktree", () => git(["worktree", "add", "--quiet", "--detach", stage, sha]))
        const d = await timed("deps", () => depsFor(sha))
        fs.symlinkSync(path.relative(stage, path.join(d.at, "node_modules")), path.join(stage, "node_modules"))
        const ctx: StepCtx = { root: stage, store: dir, helpers, node, env, exec: run }
        mine = true
        for (const s of recipe.build) await timed(s.name, () => s.run(ctx).catch((e) => { throw new Error(`${s.name}: ${errLine(e)}`) }))
        const problems = await timed("verify", () => check(stage, sha))
        if (problems.length) throw new Error(`it doesn't check out: ${problems.join("; ")}`)
        for (const s of recipe.preflight) await timed(s.name, () => s.run(ctx).catch((e) => { throw new Error(`${s.name}: ${errLine(e)}`) }))
        // (once more: a preflight that wrote into the root would leave it changed)
        const after = await check(stage, sha)
        if (after.length) throw new Error(`its preflight changed it: ${after.join("; ")}`)
        mine = false
        await git(["worktree", "move", stage, root])
        // (moved: the link to its deps is relative, the same from roots/<sha>)
        const r: Root = { commit: sha, dir: root, fingerprint: fingerprint(root), deps: d.blob, prepared: now(), seconds: (now() - t0) / 1000, steps }
        writable(root, false)
        writeJson(path.join(dir, "meta", `${sha}.json`), r)
        log(`store: prepared ${sha.slice(0, 7)} in ${r.seconds.toFixed(1)} s`)
        return r
      } catch (e) {
        await drop(stage)
        await drop(root)
        const why = errLine(e)
        if (mine) writeJson(path.join(dir, "bad", `${sha}.json`), { why, t: now() })
        log(`store: ${sha.slice(0, 7)} wasn't prepared: ${why}`)
        throw new Error(`${sha.slice(0, 7)} wasn't prepared: ${why}`, { cause: e })
      }
    })
  }

  /** Whether `sha`'s root is sound now (none: it is); one never prepared says so. */
  const verify = async (sha: string) => prepared(sha) ? check(rootOf(sha), sha) : [`${sha.slice(0, 7)} isn't prepared`]

  /** `sha` is what the app runs next: only a prepared, sound root not marked bad. */
  async function setCurrent(sha: string) {
    const bad = badOf(sha)
    if (bad) throw new Error(`${sha.slice(0, 7)} is bad: ${bad.why}`)
    const problems = await verify(sha)
    if (problems.length) throw new Error(`${sha.slice(0, 7)} can't be current: ${problems.join("; ")}`)
    writeJson(path.join(dir, "current.json"), { commit: sha, t: now() })
  }
  /** It ran and became ready (the shell's ready()): what the app falls back to. */
  function markGood(sha: string) {
    if (!prepared(sha)) throw new Error(`${sha.slice(0, 7)} isn't prepared`)
    writeJson(path.join(dir, "good.json"), { commit: sha, t: now() })
  }
  /** It's bad (`why`): never current again, and no longer current or good. */
  function markBad(sha: string, why: string) {
    writeJson(path.join(dir, "bad", `${sha}.json`), { why, t: now() })
    for (const p of ["current", "good"] as const) if (pointer(p) === sha) fs.rmSync(path.join(dir, `${p}.json`), { force: true })
  }

  /** A process running `sha`'s root for long (a keeper): kept from gc while it lives. Answers its release. */
  const lease = (sha: string, l: { pid: number; what: string }) => leaseIn(dir, sha, l)
  /** The roots leased by a process still running (the same one: its start time too); the rest of the leases removed. */
  async function leased(): Promise<Map<string, Lease[]>> {
    const out = new Map<string, Lease[]>(), at = path.join(dir, "leases")
    let names: string[] = []
    try { names = fs.readdirSync(at) } catch { return out }
    for (const n of names) {
      const m = /^([0-9a-f]{40})\.(\d+)\.json$/.exec(n), l = readJson<Lease>(path.join(at, n))
      if (m && l && (await processStart(l.pid)) === l.started) out.set(m[1], [...out.get(m[1]) ?? [], l])
      else fs.rmSync(path.join(at, n), { force: true })
    }
    return out
  }

  /** Every root but current, good, the leased and one just made (about to be current: FRESH) removed, with the deps
   *  sets none of those use: what it removed. */
  function gc() {
    return locked(async () => {
      const fresh = (n: string) => now() - (metaOf(n)?.prepared ?? 0) < (o.fresh ?? FRESH)
      const keep = new Set([pointer("current"), pointer("good"), ...(await leased()).keys(), ...(fs.existsSync(roots) ? fs.readdirSync(roots).filter((n) => SHA.test(n) && fresh(n)) : [])]
        .filter((s): s is string => !!s))
      const gone: string[] = []
      let names: string[] = []
      try { names = fs.readdirSync(roots) } catch { /* none */ }
      for (const n of names) if (!keep.has(n)) { await drop(path.join(roots, n)); fs.rmSync(path.join(dir, "meta", `${n}.json`), { force: true }); gone.push(n) }
      const used = new Set([...keep].map((s) => metaOf(s)?.deps).filter(Boolean))
      try { for (const n of fs.readdirSync(deps)) if (!used.has(n)) { remove(path.join(deps, n)); gone.push(`deps/${n}`) } } catch { /* none */ }
      if (gone.length) log(`store: removed ${gone.length} (${gone.map((g) => g.replace(/([0-9a-f]{7})[0-9a-f]{33}/, "$1")).join(", ")})`)
      return gone
    })
  }

  return {
    dir, repo, init, fetch, prepare, verify, setCurrent, markGood, markBad, lease, leased, gc,
    root: rootOf, prepared, current: () => pointer("current"), good: () => pointer("good"), bad: badOf,
    /** The roots there, prepared or not. */
    roots: () => { try { return fs.readdirSync(roots).filter((n) => SHA.test(n)) } catch { return [] } },
  }
}
export type RootStore = ReturnType<typeof rootStore>

const errLine = (e: unknown) => String((e as { stderr?: string }).stderr || (e as Error).message || e).trim().split("\n").slice(-3).join(" ").slice(0, 500)
