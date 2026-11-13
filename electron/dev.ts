// npm run app:dev: this worktree in Vaultite Dev beside Vaultite Main, one instance per worktree with data of its own,
// in a Dev shell built for its shell fingerprint (the installed one, else one kept for it, else built now). --help.
import { execFileSync, spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { appData, devApp, instanceAt, instances, instancesOf, ownedNow, shellDir } from "./devinstance.ts"
import { webStale } from "./webfresh.ts"
import { codeOf } from "../core/values.ts"
import { fingerprint } from "./shell/print.mjs"

const ROOT = path.dirname(import.meta.dirname)
const DEV = devApp(ROOT), { config: CONFIG, name: NAME, data: DATA, installed: INSTALLED, printOf, shellFor } = DEV
const argv = process.argv.slice(2)
const USAGE = `npm run app:dev [-- <option>]
  (none)      this worktree's instance, opened (or relaunched) behind the app in front: switch to it. It takes in the
              worktree's changes as they're saved: the web app rebuilt, its server restarted, a relaunch offered.
  --headless  one for an agent: quiet, off screen, data of its own; prints its pid, debug port and server.
  --stop      this worktree's instances ended, with what they started (servers, keepers); --all, every worktree's.
  --list      every instance, and whether it runs.
  --install   (npm run app:shell:dev) this worktree's shell as /Applications/Vaultite Dev.app, when it differs.
VAULTITE_DEV_CONFIG: another electron-builder config than electron/dev.cjs (a test's, under another id and name).`
if (process.platform !== "darwin") {
  console.error("Vaultite Dev is a Mac's: elsewhere, npm run app runs this checkout.")
  process.exit(1)
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch (e) { return codeOf(e) === "EPERM" } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } })
  if (r.status) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`)
}

/** This worktree's shell built (its bundle's code is this worktree now: what the shell falls back to) and kept for its
 *  fingerprint. Its stamps are taken out of the worktree after: a checkout run as it is has none (identity.ts). */
function buildShell(print: string) {
  console.log(`Building a ${NAME} shell for this worktree (its shell fingerprint ${print.slice(0, 7)} has none yet)…`)
  if (webStale(ROOT)) run("npm", ["run", "build"])
  try {
    run(process.execPath, [path.join(ROOT, "electron", "stamp.ts")], { VAULTITE_CHANNEL: "dev" })
    fs.rmSync(path.join(ROOT, "dist-app"), { recursive: true, force: true })
    run(path.join(ROOT, "node_modules", ".bin", "electron-builder"), ["--dir", "-c", CONFIG])
  } finally {
    for (const f of ["build.json", "shell.json", "cli.json"]) fs.rmSync(path.join(ROOT, "electron", f), { force: true })
  }
  const out = fs.readdirSync(path.join(ROOT, "dist-app")).map((d) => path.join(ROOT, "dist-app", d, `${NAME}.app`)).find((a) => fs.existsSync(a))
  if (!out) throw new Error("electron-builder made no app in dist-app/")
  const to = path.join(shellDir(DATA, print), `${NAME}.app`)
  fs.rmSync(to, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.renameSync(out, to)
  fs.rmSync(path.join(ROOT, "dist-app"), { recursive: true, force: true })
  return to
}

/** An instance ended (its main process asked to quit, then made to), with what it started that's still there. */
async function stop(userData: string, headless: boolean) {
  const info = instanceAt(userData)
  if (info && alive(info.pid)) {
    process.kill(info.pid, "SIGTERM")
    for (let i = 0; i < 75 && alive(info.pid); i++) await sleep(200)
    if (alive(info.pid)) process.kill(info.pid, "SIGKILL")
  }
  // (servers, terminal and chat keepers: they carry its userData; its terminals' shells end with their keeper)
  const left = () => ownedNow(userData).filter((p) => p !== process.pid)
  for (const pid of left()) try { process.kill(pid, "SIGTERM") } catch { /* gone */ }
  for (let i = 0; i < 25 && left().length; i++) await sleep(200)
  for (const pid of left()) try { process.kill(pid, "SIGKILL") } catch { /* gone */ }
  fs.rmSync(path.join(userData, "instance.json"), { force: true })
  if (headless) fs.rmSync(userData, { recursive: true, force: true })
  return !!info
}

/** Its record, once the instance started after `since` and is ready (its first window up, or launched without one). */
async function started(userData: string, since: number, ms = 90_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) {
    const info = instanceAt(userData)
    let good: { t?: number } | null = null
    try { good = JSON.parse(fs.readFileSync(path.join(userData, "shell", "good.json"), "utf8")) } catch { /* not yet */ }
    if (info && info.started >= since && good?.t && good.t >= since) return info
    if (info && info.started >= since && !alive(info.pid)) break
  }
  return null
}
/** The server of the vault it opened (its sandbox, the first time), once its list says (it saves it a moment later). */
async function serverOf(userData: string) {
  for (let i = 0; i < 20; i++, await sleep(250)) {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(userData, "vaults.json"), "utf8")).vaults?.find((x: { open?: boolean; port?: number }) => x.open !== false && x.port)
      if (v) return `http://127.0.0.1:${v.port}`
    } catch { /* not written yet */ }
  }
  return null
}
const freePort = () => new Promise<number>((resolve, reject) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => { const a = s.address(); s.close(() => (a && typeof a === "object" ? resolve(a.port) : reject(new Error("no port")))) }).on("error", reject)
})

/** What it's given: this worktree as its code, data of its own; never Main's compile cache a terminal may carry. */
function envFor(userData: string, more: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, VAULTITE_CODE_ROOT: ROOT, VAULTITE_USER_DATA: userData, ...more }
  delete env.NODE_COMPILE_CACHE
  return env
}

async function main() {
  if (argv.includes("--help")) return void console.log(USAGE)
  if (argv.includes("--list")) {
    for (const i of instances(DATA)) console.log(`${i.info && alive(i.info.pid) ? "running" : "stopped"}  ${i.headless ? "headless" : "app     "}  ${i.info?.root ?? "?"}  ${i.userData}`)
    return
  }
  if (argv.includes("--stop")) {
    const all = instances(DATA, argv.includes("--all") ? undefined : ROOT)
    for (const i of all) if (await stop(i.userData, i.headless)) console.log(`stopped ${i.headless ? "headless " : ""}${i.info?.worktree ?? i.userData}`)
    if (!all.some((i) => i.info)) console.log("No instance of this worktree runs.")
    return
  }
  const print = fingerprint(ROOT)
  if (argv.includes("--install")) {
    if (printOf(INSTALLED) === print) return void console.log(`${INSTALLED} is this worktree's shell already.`)
    // (never replaced under a copy that runs from it: it would run the old tree while the disk says new)
    if (execFileSync("ps", ["-A", "-ww", "-o", "command="], { encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").some((l) => l.startsWith(`${INSTALLED}/Contents/`))) {
      console.error(`${NAME} runs from ${INSTALLED}: quit it first (npm run app:dev -- --stop --all, and its own windows).`)
      process.exit(1)
    }
    const shell = shellFor(print) ?? buildShell(print)
    fs.rmSync(`${INSTALLED}.new`, { recursive: true, force: true })
    run("ditto", [shell, `${INSTALLED}.new`])
    fs.rmSync(INSTALLED, { recursive: true, force: true })
    fs.renameSync(`${INSTALLED}.new`, INSTALLED)
    return void console.log(`Installed this worktree's shell as ${INSTALLED}.`)
  }
  if (webStale(ROOT)) run("npm", ["run", "build"])
  const shell = shellFor(print) ?? buildShell(print)
  const exe = DEV.exe(shell)
  // (one that ended without stopping: what it left goes first)
  for (const i of instances(DATA, ROOT)) if (i.info && !alive(i.info.pid)) await stop(i.userData, i.headless)
  const since = Date.now()
  if (argv.includes("--headless")) {
    const userData = path.join(instancesOf(DATA, ROOT), `headless-${since}`), debugPort = await freePort()
    fs.mkdirSync(userData, { recursive: true })
    const log = fs.openSync(path.join(userData, "out.log"), "a")
    spawn(exe, [], { detached: true, stdio: ["ignore", log, log], env: envFor(userData, { VAULTITE_QUIET: "1", VAULTITE_DEBUG_PORT: String(debugPort) }) }).unref()
    fs.closeSync(log)
    const info = await started(userData, since)
    if (!info) { console.error(`It didn't start: ${path.join(userData, "out.log")}`); await stop(userData, true); process.exit(1) }
    console.log(JSON.stringify({ pid: info.pid, debugPort, server: await serverOf(userData), userData, stop: "npm run app:dev -- --stop" }, null, 2))
    return
  }
  const userData = appData(DATA, ROOT)
  if (await stop(userData, false)) console.log("Relaunching this worktree's instance…")
  run("open", ["-n", "-g", "--env", `VAULTITE_CODE_ROOT=${ROOT}`, "--env", `VAULTITE_USER_DATA=${userData}`, "--env", "VAULTITE_BEHIND=1", shell])
  const info = await started(userData, since)
  if (!info) { console.error(`It didn't start: its log is ${path.join(userData, "logs")}`); process.exit(1) }
  console.log(`${NAME} runs ${path.basename(ROOT)}: switch to it (its Dock icon says ${path.basename(ROOT).slice(0, 10)}). It takes in this worktree's changes as they're saved; npm run app:dev -- --stop ends it.`)
}

await main()
