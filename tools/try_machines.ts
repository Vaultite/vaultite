// A try's OS parts on the user's own Machines (plugins/core/machines) when one with that OS answers and is idle: CI's test
// job in a fresh worktree at the commit (try_job.cjs), here, over ssh or through a Vaultite terminal. Off: VAULTITE_TRY_MACHINES=off.
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { Ctx, servers } from "../core/cli.ts"
import { gitEnv } from "../core/gitenv.ts"

const ROOT = path.resolve(import.meta.dirname, "..")
const JOB = path.join(ROOT, "tools", "try_job.cjs")
export type Os = "linux" | "darwin" | "win32"
export const OSES: Os[] = ["linux", "darwin", "win32"]
export const OS_NAME: Record<Os, string> = { linux: "Linux", darwin: "macOS", win32: "Windows" }
/** Each OS's job in ci.yml as GitHub names it, and the try ref's mark that leaves it out there (ci.yml's matrix). */
export const CI_JOB: Record<Os, string> = { linux: "test (ubuntu-24.04)", darwin: "test (macos-15)", win32: "test (windows-2025)" }
export const SKIP: Record<Os, string> = { linux: "skip-linux", darwin: "skip-macos", win32: "skip-windows" }
/** ci.yml's test job as a machine runs it (test_ci.ts holds it to ci.yml), but for what needs sudo on a runner's clean
 *  image: Playwright's --with-deps and the apt-get converters (a machine's own libraries and tools are what's there). */
export const STEPS = [
  { name: "npm ci", cmd: "npm ci", fatal: true },
  { name: "npm run check", cmd: "npm run check", after: true },
  { name: "playwright", cmd: "npx playwright-core install chromium" },
  { name: "npm run build", cmd: "npm run build" },
  { name: "npm test", cmd: "npm test" },
  { name: "npm run smoke", cmd: "npm run smoke" },
]
/** A machine over this load (a minute's, per core) is busy: its user's or another agent's work, not a try's. */
const BUSY_LOAD = 0.75
/** The memory a machine has free for a try (VAULTITE_TRY_FREE_GB): the job's and the 2 GB its user's own apps keep. */
const TRY_FREE = (Number(process.env.VAULTITE_TRY_FREE_GB) || 5) * 2 ** 30
/** The Machines' list (plugins/core/machines): its entries with `ssh` (no Vaultite there) and `"try": false` are read here. */
const SETTINGS = ".vaultite/plugins/machines/data.json"
/** The hidden ref a machine fetches the commit from (no workflow runs on it). */
export const MACHINE_REF = (sha: string) => `refs/vaultite-try/${sha}`

export type Reach = { kind: "here" } | { kind: "vau"; url: string } | { kind: "ssh"; dest: string }
export type Machine = { id: string; label: string; os: Os; reach: Reach }
/** A part as its runner keeps it (`<tries>/<sha>.<os>.json`): what it runs where, then how it ended. */
export type Part = Machine & {
  sha: string; job: string; source: string; ref: string; started: number; pid?: number; terminal?: string
  ended?: number; ok?: boolean; steps?: { name: string; ok: boolean; s: number }[]; failures?: string[]; flaky?: string[]; why?: string; log?: string
}

export const machinesOff = (root: string, env = process.env) => /^(off|0|false|no)$/i.test(env.VAULTITE_TRY_MACHINES ?? "")
  || /^(false|off|0|no)$/i.test(spawnSync("git", ["config", "vaultite.tryMachines"], { cwd: root, encoding: "utf8", env: gitEnv() }).stdout.trim())

/** The environment of what a try starts: not a test run's (verify's), so the user's server answers it, and the run's TMPDIR, removed at its end, not used. */
function plainEnv(): Record<string, string | undefined> {
  const env = { ...process.env }
  if (env.VAULTITE_TEST_TMPDIR) env.TMPDIR = env.VAULTITE_TEST_TMPDIR
  for (const k of Object.keys(env)) if (k.startsWith("VAULTITE_TEST")) delete env[k]
  return env
}
const argOf = (spec: object) => `try-job-args=${Buffer.from(JSON.stringify(spec)).toString("base64")}`
const nodeMajor = (v: string) => Number(v.split(".")[0])
/** CI's Node (ci.yml's node-version): a machine with an older one isn't CI's. */
const ciNode = () => Number(/node-version:\s*(\d+)/.exec(fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8"))?.[1] ?? 0)

/** A Vaultite server's op, called as its owner's CLI. */
const op = (url: string, id: string, params: object) => new Ctx({ url, env: plainEnv(), client: "cli" }).callOp({ id, kind: id === "terminal.start" || id === "terminal.end" ? "write" : "read" }, "", params)
const job = (spec: object) => `node -e "eval(Buffer.from('${fs.readFileSync(JOB).toString("base64")}','base64').toString())" ${argOf(spec)}`
const sshArgs = (dest: string, spec: object) => ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=30", dest, "node", "-", argOf(spec)]

export type Probe = { platform: string; node: string; load: number; running: number; free?: number }
export function unfit(p: Probe, ciNode: number): string | null {
  if (nodeMajor(p.node) < ciNode) return `Node ${p.node}, CI's is ${ciNode}`
  if (p.running) return "busy: another try runs there"
  if (p.load >= BUSY_LOAD) return `busy: load ${p.load} per core`
  if ((p.free ?? 0) < TRY_FREE) return `low memory: ${((p.free ?? 0) / 2 ** 30).toFixed(1)} GB free, a try needs ${TRY_FREE / 2 ** 30}`
  return null
}

async function probe(m: Omit<Machine, "os">): Promise<Probe | string> {
  const said = (text: string) => { const l = /try-job: probe (\{.*\})/.exec(text)?.[1]; try { return l ? JSON.parse(l) : "no answer" } catch { return "no answer" } }
  if (m.reach.kind === "vau") {
    try { return said(String((await op(m.reach.url, "terminal.start", { command: job({ mode: "probe" }), name: "try probe", wait: true, timeout: 20 })).output ?? "")) }
    catch (e) { return (e as Error).message.slice(0, 120) }
  }
  const [cmd, args, input] = m.reach.kind === "ssh" ? ["ssh", sshArgs(m.reach.dest, { mode: "probe" }), fs.readFileSync(JOB, "utf8")] : [process.execPath, [JOB], undefined]
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env: plainEnv(), stdio: ["pipe", "pipe", "pipe"] })
    let out = "", err = ""
    const t = setTimeout(() => p.kill(), 20_000)
    p.stdout.on("data", (d) => { out += d }); p.stderr.on("data", (d) => { err += d })
    p.on("error", (e) => { err = e.message })
    p.on("close", () => { clearTimeout(t); const r = said(out); resolve(typeof r === "string" ? (err.trim().split("\n").filter((l) => !l.startsWith("**")).pop() ?? r).slice(0, 120) : r) })
    p.stdin.end(input ?? "")
  })
}

/** The Machines this try's OSes can run on: online, CI's Node, idle; one per OS, this one first. What was passed over, and why, said. */
export async function findMachines(root: string, oses: Os[], log: (s: string) => void = () => {}): Promise<Machine[]> {
  if (!oses.length || machinesOff(root)) return []
  type Listed = { id: string; label: string; url?: string; online?: boolean; self?: boolean; via?: string; platform?: string }
  type Entry = { id?: string; label?: string; url?: string; via?: string; ssh?: string; try?: boolean }
  let listed: Listed[] | null = null, entries: Entry[] = []
  for (const url of servers(plainEnv())) {
    const ctx = new Ctx({ url, env: plainEnv() })
    try { listed = await ctx.call("GET", "machines") } catch { continue }
    try { entries = JSON.parse(String((await ctx.call("GET", `file?path=${encodeURIComponent(SETTINGS)}`)).text ?? "{}")).machines ?? [] } catch { entries = [] }
    break
  }
  if (!Array.isArray(listed) || !Array.isArray(entries)) return []
  const off = new Set(entries.filter((e) => e?.try === false).map((e) => String(e.id)))
  const ssh = entries.filter((e) => e && !e.url && !e.via && typeof e.ssh === "string" && /^\w[\w.@-]*$/.test(e.ssh) && e.id && !off.has(String(e.id)))
  const want = (os?: string) => !!os && (oses as string[]).includes(os)
  const all: Omit<Machine, "os">[] = [
    ...listed.filter((m) => m.online && !m.via && !off.has(m.id) && want(m.platform)).map((m) => ({ id: m.id, label: m.label, reach: m.self ? { kind: "here" as const } : { kind: "vau" as const, url: m.url! } })),
    ...ssh.map((m) => ({ id: String(m.id), label: String(m.label || m.id), reach: { kind: "ssh" as const, dest: m.ssh! } })),
  ]
  const said = await Promise.all(all.map(probe)), node = ciNode(), out: (Machine & { load: number })[] = [], passed: string[] = []
  all.forEach((m, i) => {
    const p = said[i]
    if (typeof p === "string") return passed.push(`${m.label} (${p})`)
    if (!want(p.platform)) return
    const why = unfit(p, node)
    if (why) return passed.push(`${m.label} (${why})`)
    out.push({ ...m, os: p.platform as Os, load: p.load + (m.reach.kind === "here" ? -1 : 0) })
  })
  if (passed.length) log(`try: machines passed over: ${passed.join(", ")}`)
  return oses.flatMap((os) => out.filter((m) => m.os === os).sort((a, b) => a.load - b.load).slice(0, 1)).map(({ load: _, ...m }) => m)
}

export const partFile = (dir: string, sha: string, os: Os) => path.join(dir, `${sha}.${os}.json`)
export function readPart(file: string): Part | null { try { return JSON.parse(fs.readFileSync(file, "utf8")) as Part } catch { return null } }
function savePart(file: string, p: Part) { fs.writeFileSync(`${file}.${process.pid}`, JSON.stringify(p)); fs.renameSync(`${file}.${process.pid}`, file) }
const alive = (pid?: number) => { if (!pid) return false; try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM" } }

/** Starts a part's runner, apart from this process (a verify's end kills what it started): it outlives the try command. */
export function startPart(file: string, p: Part) {
  savePart(file, p)
  spawn(process.execPath, [import.meta.filename, "--fork", file], { detached: true, stdio: "ignore", env: plainEnv() }).unref()
}
/** A part that hasn't ended: its runner gone (ended without a word), else still running. */
export function partNow(file: string): Part | null {
  const p = readPart(file)
  if (p && !p.ended && p.pid && !alive(p.pid) && !(readPart(file)?.ended)) {
    Object.assign(p, { ended: Date.now(), ok: false, why: "its runner ended without a result" })
    savePart(file, p)
  }
  return readPart(file) ?? p
}
/** Stops a part that's still running: its runner ends the job (a terminal's, there too). */
export function stopPart(file: string) {
  const p = readPart(file)
  if (p && !p.ended && p.pid && alive(p.pid)) try { process.kill(p.pid, "SIGTERM") } catch { /* gone */ }
}

export function parseJob(text: string): Pick<Part, "steps" | "failures" | "flaky" | "why" | "log" | "ok"> {
  const lines = text.split(/\r?\n/).map((l) => /try-job: (.*)$/.exec(l)?.[1]?.trimEnd()).filter((l): l is string => !!l)
  const from = lines.lastIndexOf("summary"), sum = from >= 0 ? lines.slice(from + 1) : []
  const r = { steps: [] as NonNullable<Part["steps"]>, failures: [] as string[], flaky: [] as string[], why: undefined as string | undefined, log: undefined as string | undefined, ok: false }
  for (const l of sum) {
    const [kind, ...rest] = l.split(" "), body = rest.join(" ")
    if (kind === "result") { const [state, s, ...name] = rest; r.steps.push({ name: name.join(" "), ok: state === "ok", s: Number(s) }) }
    else if (kind === "fail") r.failures.push(body.replace(/^[^:]+: /, ""))
    else if (kind === "flaky") r.flaky.push(body.replace(/^[^:]+: /, ""))
    else if (kind === "setup") r.why = body
    else if (kind === "log") r.log = body
    else if (kind === "done") r.ok = rest[0] === "ok"
  }
  if (from < 0) r.why = "it ended without its summary"
  return r
}

export const AWAY_MS = 5 * 60_000
/** Asked again while the machine's server is away (restarting on a push: the part's terminal outlives it). */
export async function patient<T>(call: () => Promise<T>, deadline: number, o: { now?: () => number; pause?: (ms: number) => Promise<void> } = {}): Promise<T> {
  const now = o.now ?? Date.now, pause = o.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let away = 0
  for (;;) {
    try { return await call() } catch (e) {
      away ||= now()
      if (now() - away >= AWAY_MS || now() >= deadline) throw e
    }
    await pause(10_000)
  }
}

/** The runner: the part's job where it runs, its whole output kept beside the part, how it ended written there. */
async function runPart(file: string) {
  const p = readPart(file)!
  p.pid = process.pid
  savePart(file, p)
  const deadline = p.started + (Number(process.env.VAULTITE_TRY_ATTEMPT_MIN) || 25) * 60_000
  const spec = { mode: "run", sha: p.sha, source: p.source, ref: p.ref, steps: STEPS, again: ["npm test", "npm run smoke"], jobMin: 15, deadlineMin: 24 }
  const outFile = file.replace(/\.json$/, ".log")
  let text = "", why: string | undefined
  if (p.reach.kind === "vau") {
    const url = p.reach.url
    try {
      const t = await op(url, "terminal.start", { command: job(spec), name: `try ${p.sha.slice(0, 9)}` })
      p.terminal = String(t.id)
      savePart(file, p)
      process.on("SIGTERM", () => { void op(url, "terminal.end", { id: p.terminal }).finally(() => process.exit(1)) })
      for (;;) {
        const w = await patient(() => op(url, "terminal.wait", { id: p.terminal, for: ["exit"], timeout: Math.max(5, Math.min(300, (deadline - Date.now()) / 1000)) }), deadline)
        if (w.met === "exit" || w.exit || w.lost) break
        if (Date.now() >= deadline) { why = "not done in time (stopped)"; await op(url, "terminal.end", { id: p.terminal }).catch(() => {}); break }
      }
      text = String((await patient(() => op(url, "terminal.capture", { id: p.terminal, lines: 400 }), deadline + AWAY_MS)).text ?? "")
    } catch (e) { why = `${p.label} stopped answering: ${(e as Error).message.slice(0, 120)}` }
    fs.writeFileSync(outFile, text)
  } else {
    const fd = fs.openSync(outFile, "w")
    const [cmd, args, input] = p.reach.kind === "ssh" ? ["ssh", sshArgs(p.reach.dest, spec), fs.readFileSync(JOB, "utf8")] : [process.execPath, [JOB, argOf(spec)], ""]
    const child = spawn(cmd, args, { env: plainEnv(), stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" })
    const end = () => { try { if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]); else process.kill(-child.pid!, "SIGKILL") } catch { /* gone */ } }
    process.on("SIGTERM", () => { end(); process.exit(1) })
    const timer = setTimeout(() => { why = "not done in time (stopped)"; end() }, Math.max(1000, deadline - Date.now()))
    child.stdout.on("data", (d) => { text += d; fs.writeSync(fd, d) }); child.stderr.on("data", (d) => fs.writeSync(fd, d))
    child.stdin.end(input)
    const code = await new Promise<number | null>((r) => { child.on("close", r); child.on("error", (e) => { why = e.message; r(null) }) })
    clearTimeout(timer)
    if (code === 255 && p.reach.kind === "ssh" && !/try-job: summary/.test(text)) why ??= `ssh to ${p.reach.dest} failed or was cut`
    fs.closeSync(fd)
  }
  const r = parseJob(text)
  savePart(file, { ...p, ...r, why: why ?? r.why, ok: !why && r.ok, ended: Date.now(), log: outFile + (r.log ? ` (there: ${r.log})` : "") })
}

if (import.meta.main) {
  const [flag, file] = process.argv.slice(2)
  if (flag === "--fork") { spawn(process.execPath, [import.meta.filename, "--part", file], { detached: true, stdio: "ignore" }).unref(); process.exit(0) }
  if (flag === "--part") await runPart(file).catch((e) => { const p = readPart(file); if (p) savePart(file, { ...p, ended: Date.now(), ok: false, why: String(e?.message ?? e) }) })
}
