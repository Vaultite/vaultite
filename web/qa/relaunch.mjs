// An update's relaunch keeps the vault's server (electron/main.ts handOver, server.ts waits, electron/heir.ts) and its
// vault (electron/argv.ts): the next launch takes the server over, with no gap; a plain quit still ends it. WRITES: temp.
//   node web/qa/relaunch.mjs <vault copy>
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until } from "./lib/qa.mjs"
import { ownedNow } from "../../electron/devinstance.ts"

const { args: [VAULT], check, done } = await qa(import.meta.url, { chrome: false })
if (process.platform === "win32") { console.log("skipped: Windows' app relaunches only to install"); process.exit(0) }
if (!fs.existsSync(path.join(ROOT, "web/dist/index.html"))) { console.log("skipped: no web/dist (npm run build)"); process.exit(0) }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-relaunch-"))
const userData = path.join(TMP, "userData")
fs.mkdirSync(userData, { recursive: true })
// (the binary itself, as its main process lists it, fetched if npm's install didn't: .bin/electron is a Node script)
const electron = createRequire(import.meta.url)("electron")
const env = { ...process.env, VAULTITE_QUIET: "1", VAULTITE_USER_DATA: userData, VAULTITE_LOCAL: path.join(TMP, "local") }
delete env.NODE_COMPILE_CACHE
const owned = () => ownedNow(userData)
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const stop = async () => {
  for (const pid of owned()) try { process.kill(pid, "SIGTERM") } catch { /* gone */ }
  await until(() => !owned().length, 15_000)
  for (const pid of owned()) try { process.kill(pid, "SIGKILL") } catch { /* gone */ }
}
/** The app's main processes: the binary itself, not its helpers, servers or keepers. */
const mains = () => {
  const ps = execFileSync("ps", ["-A", "-ww", "-o", "pid=", "-o", "command="], { encoding: "utf8", maxBuffer: 64 << 20 })
  const mine = new Set(owned())
  return ps.split("\n").map((l) => l.trim().match(/^(\d+) (.*)$/)).filter((m) => m && mine.has(Number(m[1])) && m[2].startsWith(electron) && !/--type=|server\.ts|termd|chatd/.test(m[2])).map((m) => Number(m[1]))
}
const port = () => until(() => { try { return JSON.parse(fs.readFileSync(path.join(userData, "vaults.json"), "utf8")).vaults.find((x) => x.port)?.port } catch { return null } }, 60_000)
/** The pid listening on `p`, once one is. */
const listener = (p) => until(() => { try { return Number(execFileSync("lsof", ["-tiTCP:" + p, "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split("\n")[0]) || null } catch { return null } }, 60_000)
const logOf = (pid) => { try { return execFileSync("lsof", ["-a", "-p", String(pid), "-d", "1", "-Fn"], { encoding: "utf8" }).split("\n").find((l) => l.startsWith("n/"))?.slice(1) ?? null } catch { return null } }
/** What the app printed, its last lines but the bus's noise. */
const appLog = () => { try { return fs.readFileSync(path.join(TMP, "app.log"), "utf8").split("\n").filter((l) => l && !/dbus|bus\.cc/.test(l)).slice(-12) } catch { return null } }
const answers = (p) => fetch(`http://127.0.0.1:${p}/api/ui`).then((r) => r.ok, () => false)

try {
  // (Linux: --no-sandbox, as Playwright launches the other desktop scripts: a checkout's chrome-sandbox isn't setuid root)
  const out = fs.openSync(path.join(TMP, "app.log"), "a")
  spawn(electron, [...(process.platform === "linux" ? ["--no-sandbox"] : []), ROOT, "--vault", VAULT], { env, stdio: ["ignore", out, out], detached: true }).unref()
  const p = await port()
  const server = p && await listener(p)
  const first = await until(() => mains()[0] ?? null, 30_000)
  check("the app is up, its server answering", !!server && !!first && await until(() => answers(p), 30_000), { p, server, first })
  const log = logOf(server)
  check("its server writes to a file, not a pipe to the app (it outlives the app)", !!log && log.endsWith(".log"), log)

  // An update's relaunch: the server is told, waits, and the next launch takes it over.
  let down = 0
  const watching = setInterval(() => void answers(p).then((ok) => { if (!ok) down++ }), 100)
  const t0 = Date.now(), from = fs.statSync(log).size, since = () => fs.readFileSync(log, "utf8").slice(from)
  process.kill(first, "SIGUSR2")
  const gone = await until(() => !alive(first), 30_000)
  const second = await until(() => mains().find((x) => x !== first) ?? null, 60_000)
  const back = await until(() => /its app is back: taken over/.test(since()), 60_000)
  clearInterval(watching)
  check("relaunched: the first launch ended and a second is up", gone && !!second, { gone, second, app: second ? undefined : appLog() })
  check("...and took over the same server, never down meanwhile", back && alive(server) && await listener(p) === server && down === 0, { server, now: await listener(p), down, log: since() })
  console.log(`  relaunch to the server taken over: ${Date.now() - t0} ms`)
  check("the server said it waited for the relaunch", /its app is relaunching: waiting for it/.test(since()), since())

  // A plain quit of the launch that took it over still ends it.
  if (second) process.kill(second, "SIGTERM")
  check("a quit (no relaunch) ends the server it took over", await until(() => !alive(server), 20_000), { server })
} finally {
  await stop()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
