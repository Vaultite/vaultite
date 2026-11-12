// A try's part on one machine (tools/try_machines.ts sends it there: over ssh, through a Vaultite terminal, or here): CI's
// test job in a fresh worktree at the commit, said as `try-job:` lines. Plain CommonJS: it runs from stdin or `node -e`.
const { spawn, spawnSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const HOME = path.join(os.homedir(), ".vaultite-try"), RUNNING = path.join(HOME, "running"), LOGS = path.join(HOME, "logs")
const arg = process.argv.find((a) => a.startsWith("try-job-args="))
const spec = arg ? JSON.parse(Buffer.from(arg.slice("try-job-args=".length), "base64").toString("utf8")) : { mode: "probe" }
const say = (s) => process.stdout.write(`try-job: ${s}\n`)
const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === "EPERM" } }

/** Other tries running here now (their pid files, the dead ones removed). */
function running() {
  let n = 0
  for (const f of fs.existsSync(RUNNING) ? fs.readdirSync(RUNNING) : []) {
    if (alive(Number(f.split(".")[0]))) n++
    else fs.rmSync(path.join(RUNNING, f), { force: true })
  }
  return n
}

if (spec.mode === "probe") {
  const load = os.loadavg()[0] / Math.max(1, os.cpus().length)
  say(`probe ${JSON.stringify({ platform: process.platform, node: process.versions.node, cpus: os.cpus().length, load: Math.round(load * 100) / 100, running: running() })}`)
  process.exit(0)
}

const sha = spec.sha, short = sha.slice(0, 12), started = Date.now()
fs.mkdirSync(RUNNING, { recursive: true }); fs.mkdirSync(LOGS, { recursive: true })
const mark = path.join(RUNNING, `${process.pid}.${short}`)
fs.writeFileSync(mark, String(Date.now()))
for (const f of fs.readdirSync(LOGS)) { try { if (Date.now() - fs.statSync(path.join(LOGS, f)).mtimeMs > 7 * 86_400_000) fs.rmSync(path.join(LOGS, f)) } catch { /* gone */ } }
const logFile = path.join(LOGS, `${short}-${process.pid}.log`), log = fs.openSync(logFile, "w")
const out = (s) => { process.stdout.write(s); fs.writeSync(log, s) }
const repo = path.join(HOME, "repo.git"), wt = path.join(HOME, `w-${short}-${process.pid}`)
// (core/gitenv.ts' gitEnv(), here without imports: git acts on the folder it's given, never on one a GIT_DIR names)
const gitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|PREFIX|CONFIG.*|IMPLICIT_WORK_TREE|GRAFT_FILE|NO_REPLACE_OBJECTS|REPLACE_REF_BASE|SHALLOW_FILE)$/.test(k)))
const git = (args, cwd = repo) => spawnSync("git", args, { cwd, encoding: "utf8", timeout: 300_000, env: gitEnv() })

// (as GitHub's runner: CI's marks on, nothing of a Vaultite terminal, an agent's session or npm's own run; this node first)
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VAULTITE|CLAUDE|CODEX_|npm_|ELECTRON_RUN_AS_NODE$|INIT_CWD$)/i.test(k)))
const PATH = Object.keys(env).find((k) => k.toUpperCase() === "PATH") || "PATH"
env[PATH] = [path.dirname(process.execPath), env[PATH]].filter(Boolean).join(path.delimiter)
Object.assign(env, { CI: "true", GITHUB_ACTIONS: "true", ELECTRON_SKIP_BINARY_DOWNLOAD: "1" })

// (CI's steps run in bash, Git Bash on Windows: its Unix tools on PATH as there)
const gitBash = ["ProgramFiles", "ProgramW6432"].map((k) => process.env[k] && path.join(process.env[k], "Git", "bin", "bash.exe")).find((p) => p && fs.existsSync(p))
const bash = process.platform === "win32" ? gitBash : ["/bin/bash", "/usr/bin/bash"].find((p) => fs.existsSync(p))

/** A step's command, its output said as it comes; its annotated failures (test/lib.ts' `::error` lines) kept. */
function run(cmd, until) {
  return new Promise((resolve) => {
    out(`\n== ${cmd}\n`)
    const p = bash ? spawn(bash, ["--noprofile", "--norc", "-eo", "pipefail", "-c", cmd], { cwd: wt, env })
      : spawn(cmd, { cwd: wt, env, shell: true })
    const failures = []
    let rest = ""
    const take = (d) => {
      out(d.toString())
      const lines = (rest + d.toString()).split("\n")
      rest = lines.pop()
      for (const l of lines) {
        const m = /^::error title=([^:]*)::(.*)$/.exec(l.trim())
        if (m) failures.push(`${m[1]}: ${m[2].replace(/%0D/g, "\r").replace(/%0A/g, "\n").replace(/%25/g, "%").split("  -> ")[0].split("\n")[0]}`.slice(0, 200))
      }
    }
    p.stdout.on("data", take); p.stderr.on("data", take)
    const timer = setTimeout(() => { out(`\n(stopped: the try's ${spec.jobMin} min are up)\n`); kill(p) }, Math.max(1000, until - Date.now()))
    p.on("error", (e) => { out(`${e.message}\n`) })
    p.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, failures }) })
  })
}
function kill(p) {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"])
  else p.kill("SIGKILL")
}

const steps = []
async function main() {
  if (!fs.existsSync(repo)) git(["init", "-q", "--bare", repo], HOME)
  const got = git(["fetch", "-q", "--no-tags", spec.source, `+${spec.ref}:refs/try/${short}`])
  if (got.status !== 0) return { setup: `can't fetch ${spec.ref}: ${(got.stderr || "").trim().split("\n").pop()}` }
  const added = git(["worktree", "add", "-q", "--detach", "-f", wt, sha])
  if (added.status !== 0) return { setup: `can't make its worktree: ${(added.stderr || "").trim().split("\n").pop()}` }
  const until = started + spec.jobMin * 60_000
  for (const st of spec.steps) {
    if (st.after && steps.some((s) => !s.ok)) continue // (as CI: npm ci failing, check isn't run)
    const t = Date.now(), r = await run(st.cmd, until)
    steps.push({ name: st.name, ok: r.ok, s: (Date.now() - t) / 1000, failures: r.failures })
    say(`step ${r.ok ? "ok" : "FAIL"} ${((Date.now() - t) / 1000).toFixed(1)} ${st.name}`)
    if (!r.ok && st.fatal) break
  }
  // (as try.ts reruns a failed job once: a flaky test passes then, a broken one doesn't; only the tests, the rest is the same twice)
  const again = steps.filter((s) => !s.ok && spec.again.includes(s.name))
  if (again.length && again.length === steps.filter((s) => !s.ok).length) {
    const until2 = Math.min(started + spec.deadlineMin * 60_000, Date.now() + spec.jobMin * 60_000)
    for (const s of again) {
      say(`again ${s.name}`)
      const t = Date.now(), r = await run(spec.steps.find((x) => x.name === s.name).cmd, until2)
      if (r.ok) { s.flaky = s.failures; s.failures = []; s.ok = true }
      else s.failures = r.failures
      s.s += (Date.now() - t) / 1000
    }
  }
  return {}
}

main().catch((e) => ({ setup: String(e && e.message || e) })).then((r) => {
  // (not `git worktree remove`: Windows' 44,000 files of node_modules outlast its time there; Node's rm takes seconds)
  try { fs.rmSync(wt, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) } catch (e) { out(`couldn't remove ${wt}: ${e.message}\n`) }
  git(["worktree", "prune"]); git(["update-ref", "-d", `refs/try/${short}`])
  fs.rmSync(mark, { force: true })
  // (the summary last, short lines: a terminal's capture reads its end)
  say("summary")
  if (r.setup) say(`setup ${r.setup}`)
  for (const s of steps) {
    say(`result ${s.ok ? "ok" : "FAIL"} ${s.s.toFixed(1)} ${s.name}`)
    for (const f of s.failures.slice(0, 20)) say(`fail ${s.name}: ${f}`)
    for (const f of (s.flaky || []).slice(0, 20)) say(`flaky ${s.name}: ${f}`)
  }
  const ok = !r.setup && steps.length > 0 && steps.every((s) => s.ok)
  say(`log ${logFile}`)
  say(`done ${ok ? "ok" : "FAIL"} ${((Date.now() - started) / 1000).toFixed(1)}`)
  fs.closeSync(log)
  process.exit(ok ? 0 : 1)
})
