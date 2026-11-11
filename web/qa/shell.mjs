// The shell's fallback, through the packaged Vaultite Dev shell (electron/shell/boot.mjs, roots.mjs): a code root that
// doesn't load is marked bad, the app starts again on its bundle, and its first window's Errors say so. WRITES: temp only.
//   node web/qa/shell.mjs <vault copy>   (its shell: npm run app:dev -- --headless once, then --stop)
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until } from "./lib/qa.mjs"
import { devApp, ownedNow } from "../../electron/devinstance.ts"
import { fingerprint } from "../../electron/shell/print.mjs"

const { args: [VAULT], check, done } = await qa(import.meta.url, { chrome: false })
if (process.platform !== "darwin") { console.log("skipped: Vaultite Dev is a Mac's"); process.exit(0) }
const dev = devApp(ROOT), print = fingerprint(ROOT), shell = dev.shellFor(print)
if (!shell) { console.log(`skipped: no ${dev.name} shell for this worktree (npm run app:dev -- --headless builds one, then --stop)`); process.exit(0) }

// A root built for this shell (its fingerprint's inputs copied in) whose code throws as it loads.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-shell-"))
const broken = path.join(TMP, "broken")
const inputs = JSON.parse(fs.readFileSync(path.join(ROOT, "electron/shell/inputs.json"), "utf8"))
for (const f of [...inputs.files, "package.json", inputs.electron]) fs.cpSync(path.join(ROOT, f), path.join(broken, f), { recursive: true })
fs.writeFileSync(path.join(broken, "electron/boot.ts"), 'throw new Error("broken on purpose")\n')
fs.writeFileSync(path.join(broken, "electron/build.json"), JSON.stringify({ commit: "b".repeat(40), repo: "https://github.com/Alice/lighthouse.git" }))
fs.chmodSync(broken, 0o755)
check("the fixture is built for this shell", fingerprint(broken) === print)

const userData = path.join(TMP, "userData"), state = path.join(userData, "shell")
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(state, f), "utf8")) } catch { return null } }
const events = () => { try { return fs.readFileSync(path.join(state, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const env = { ...process.env, VAULTITE_QUIET: "1", VAULTITE_CODE_ROOT: broken, VAULTITE_USER_DATA: userData, VAULTITE_LOCAL: path.join(TMP, "local") }
delete env.NODE_COMPILE_CACHE
const first = spawn(dev.exe(shell), ["--vault", VAULT], { env, stdio: "ignore", detached: true })
const firstEnd = new Promise((r) => first.once("exit", (code) => r(code)))
try {
  check("the broken root's run ends at once (exit 1), never sitting there", await Promise.race([firstEnd, new Promise((r) => setTimeout(() => r("still running"), 30_000))]) === 1)
  const bad = read("bad.json")
  check("...its root marked bad, saying why", /didn't load: broken on purpose/.test(bad?.[broken]?.why ?? ""), bad)
  const good = await until(() => read("good.json"), 60_000)
  check("the app starts again on its bundle, and gets ready", good && good.root !== broken && good.root.endsWith("Contents/Resources/app"), good)
  const ev = events()
  check("the record says both: the failure, then the root passed over", ev.some((e) => e.kind === "failed" && e.root === broken && /broken on purpose/.test(e.why))
    && ev.some((e) => e.kind === "passed" && e.root === broken && /failed before/.test(e.why)), ev)
  const vaults = await until(() => { try { return JSON.parse(fs.readFileSync(path.join(userData, "vaults.json"), "utf8")).vaults.find((v) => v.port) } catch { return null } }, 10_000)
  const errors = await until(async () => {
    const r = await fetch(`http://127.0.0.1:${vaults?.port}/api/errors?limit=20`).then((x) => x.json()).catch(() => null)
    const said = (r?.groups ?? []).map((g) => g.message)
    return said.some((m) => /couldn't start on bbbbbbb: its code didn't load/.test(m)) && said.some((m) => /didn't start on bbbbbbb/.test(m)) ? said : null
  }, 20_000)
  check("...and its window's Errors (vau errors) tell the user", !!errors, errors)
} finally {
  // (the run it relaunched isn't ours to hold: everything with its userData ends)
  const owned = () => ownedNow(userData)
  for (const pid of owned()) try { process.kill(pid, "SIGTERM") } catch { /* gone */ }
  await until(() => !owned().length, 15_000)
  for (const pid of owned()) try { process.kill(pid, "SIGKILL") } catch { /* gone */ }
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
