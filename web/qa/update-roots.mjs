// Vaultite Main's code store as its shell reads it (electron/shell/boot.mjs, roots.mjs, store.mjs): launched onto the
// store's current root, and from one that doesn't start back onto the good one, said in its Errors. WRITES: temp only.
//   node web/qa/update-roots.mjs <vault copy>   (from source: VAULTITE_SHELL_TEST=main picks as Main's shell)
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until } from "./lib/qa.mjs"
import { ownedBy } from "../../electron/devinstance.ts"
import { gitEnv } from "../../core/gitenv.ts"
import { fingerprint } from "../../electron/shell/print.mjs"

const { args: [VAULT], check, done } = await qa(import.meta.url, { chrome: false })
if (process.platform === "win32") { console.log("skipped: Windows runs only its bundle"); process.exit(0) }
if (!fs.existsSync(path.join(ROOT, "web/dist/index.html"))) { console.log("skipped: no web/dist (npm run build)"); process.exit(0) }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-roots-"))
const userData = path.join(TMP, "userData"), store = path.join(userData, "code.noindex")
const head = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8", env: gitEnv() }).trim()
// Two roots as the store makes them: this commit, and one of its tree whose code throws as it loads.
const A = path.join(store, "roots", head), B = path.join(store, "roots", "b".repeat(40))
fs.mkdirSync(A, { recursive: true })
execFileSync("sh", ["-c", 'git -C "$1" archive HEAD | tar -x -C "$2"', "sh", ROOT, A], { env: gitEnv() })
fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(A, "node_modules"))
fs.cpSync(path.join(ROOT, "web/dist"), path.join(A, "web/dist"), { recursive: true })
fs.writeFileSync(path.join(A, "electron/build.json"), JSON.stringify({ commit: head, repo: "https://github.com/Alice/lighthouse.git" }))
fs.cpSync(A, B, { recursive: true, verbatimSymlinks: true })
fs.writeFileSync(path.join(B, "electron/boot.ts"), 'throw new Error("broken on purpose")\n')
fs.writeFileSync(path.join(B, "electron/build.json"), JSON.stringify({ commit: "b".repeat(40), repo: "https://github.com/Alice/lighthouse.git" }))
fs.writeFileSync(path.join(userData, "use-code-store"), "")
const point = (name, commit) => fs.writeFileSync(path.join(store, `${name}.json`), JSON.stringify({ commit, t: Date.now() }))
check("the roots are built for this shell (its checkout's fingerprint)", fingerprint(A) === fingerprint(ROOT) && fingerprint(B) === fingerprint(ROOT))

const electron = path.join(ROOT, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
const env = { ...process.env, VAULTITE_QUIET: "1", VAULTITE_SHELL_TEST: "main", VAULTITE_USER_DATA: userData, VAULTITE_LOCAL: path.join(TMP, "local") }
delete env.NODE_COMPILE_CACHE
const owned = () => ownedBy(execFileSync("ps", ["-A", "-ww", "-E", "-o", "pid=", "-o", "command="], { encoding: "utf8", maxBuffer: 64 << 20 }), userData)
const stop = async () => {
  for (const pid of owned()) try { process.kill(pid, "SIGTERM") } catch { /* gone */ }
  await until(() => !owned().length, 15_000)
  for (const pid of owned()) try { process.kill(pid, "SIGKILL") } catch { /* gone */ }
  fs.rmSync(path.join(userData, "shell", "good.json"), { force: true })
}
const launch = () => spawn(process.platform === "darwin" ? electron : path.join(ROOT, "node_modules/.bin/electron"), [ROOT, "--vault", VAULT], { env, stdio: "ignore", detached: true })
/** Its app, once its first window is up: what it says it runs (app.version's app). */
const app = async () => {
  const good = await until(() => fs.existsSync(path.join(userData, "shell", "good.json")), 60_000)
  if (!good) return null
  const v = await until(() => { try { return JSON.parse(fs.readFileSync(path.join(userData, "vaults.json"), "utf8")).vaults.find((x) => x.port) } catch { return null } }, 10_000)
  return until(async () => {
    const r = await fetch(`http://127.0.0.1:${v?.port}/api/ops/app.version`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((x) => x.json()).catch(() => null)
    return r?.app?.root ? { ...r.app, port: v.port } : null
  }, 20_000)
}

try {
  point("current", head)
  launch()
  const a = await app()
  check("launched onto the store's current root", a?.root?.from === "current" && a.commit === head && !a.root.fellBack, a)
  await stop()

  point("current", "b".repeat(40)); point("good", head)
  const first = launch(), ended = new Promise((r) => first.once("exit", r))
  check("the root that doesn't load: that run ends at once (exit 1)", await Promise.race([ended, new Promise((r) => setTimeout(() => r("running"), 30_000))]) === 1)
  const b = await app()
  check("...and the app starts again on the good one, saying it fell back and why", b?.root?.from === "good" && b.commit === head
    && b.root.fellBack?.commit === "b".repeat(40) && /didn't load: broken on purpose/.test(b.root.fellBack.why), b)
  const said = await until(async () => {
    const r = await fetch(`http://127.0.0.1:${b?.port}/api/errors?limit=20`).then((x) => x.json()).catch(() => null)
    const m = (r?.groups ?? []).map((g) => g.message)
    return m.some((x) => /couldn't start on bbbbbbb/.test(x)) ? m : null
  }, 20_000)
  check("...in its window's Errors (vau errors)", !!said, said)
} finally {
  await stop()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
