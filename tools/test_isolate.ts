// A test run keeps off the user's own vaults and its temp files (tools/test/isolate.ts, core/testrun.ts): a made-up
// "own" vault (VAULTITE_OWN_VAULTS) stands in for theirs. `node tools/test_isolate.ts` (npm test)
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { RUN, sweep, touches } from "./test/isolate.ts"
import { check, exit, freePort, sleep, summary, tempDir, testServer } from "./test/lib.ts"
import { REFUSED_FILE, isOwnVault } from "../core/testrun.ts"

const began = Date.now()
const ROOT = path.resolve(import.meta.dirname, "..")
const tmp = tempDir("vaultite-isolate-test-")
const own = path.join(tmp, "own"), sandbox = path.join(tmp, "sandbox")
for (const d of [path.join(own, ".vaultite"), path.join(sandbox, ".vaultite"), path.join(own, "Notes")]) fs.mkdirSync(d, { recursive: true })
fs.writeFileSync(path.join(sandbox, ".vaultite", "sandbox.json"), "{}\n")
const ownEnv = { ...process.env, VAULTITE_OWN_VAULTS: [own, sandbox].join(path.delimiter) }

// ---------- the run itself
check("the run's temp folder is its own", os.tmpdir() === RUN && fs.existsSync(RUN) && process.env.VAULTITE_TEST === "1", [os.tmpdir(), RUN])
check("claude.ai's connectors are off for what the run starts", process.env.ENABLE_CLAUDEAI_MCP_SERVERS === "false")
check("a vault named as the user's is theirs, and a folder in it", isOwnVault(own, ownEnv) && isOwnVault(path.join(own, "Notes"), ownEnv))
check("a sandbox never is, nor a test's folder", !isOwnVault(sandbox, ownEnv) && !isOwnVault(tmp, ownEnv))

// ---------- a test's server refuses the user's vault, kept for its run's end
{
  const run = path.join(tmp, "run-a")
  fs.mkdirSync(run)
  const port = await freePort()
  const s = testServer({ env: { ...ownEnv, VAULTITE_TEST_RUN: run, VAULTITE_VAULT: own, VAULTITE_LOCAL: path.join(tmp, "local-a"), PORT: String(port), HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] })
  let said = ""
  s.stderr!.on("data", (d) => { said += d })
  const code = await new Promise<number | null>((done) => s.once("exit", done))
  check("a test's server on the user's vault doesn't start", code === 1 && /reached the user's own vault/.test(said), [code, said.slice(-300)])
  check("nothing of it written in that vault", fs.readdirSync(path.join(own, ".vaultite")).length === 0, fs.readdirSync(path.join(own, ".vaultite")))
  const t = touches(run, path.join(run, "none"), 0, began, path.join(tmp, "nohome"))
  check("the run's end names it", t.length === 1 && t[0].includes(own), t)
}

// ---------- the user's own server refuses a test's vau, and keeps it where the run's end looks
{
  const run = path.join(tmp, "run-b"), rt = path.join(tmp, "rt")
  fs.mkdirSync(run); fs.mkdirSync(rt, { mode: 0o700 })
  const port = await freePort()
  const user: Record<string, string | undefined> = { ...ownEnv, VAULTITE_VAULT: own, VAULTITE_LOCAL: path.join(tmp, "local-b"), PORT: String(port), HOST: "127.0.0.1", TMPDIR: rt, XDG_RUNTIME_DIR: rt }
  for (const k of ["VAULTITE_TEST", "VAULTITE_TEST_RUN"]) delete user[k]
  const s = testServer({ env: user as NodeJS.ProcessEnv, stdio: ["ignore", "ignore", "pipe"] })
  let up = false
  for (let i = 0; i < 120 && !up && s.exitCode === null; i++) { try { up = (await fetch(`http://127.0.0.1:${port}/api/state`)).ok } catch { await sleep(250) } }
  check("the user's server starts", up)
  const vau = (env: Record<string, string | undefined>) => spawnSync(process.execPath, [path.join(ROOT, "bin/vau"), "--url", `http://127.0.0.1:${port}`, "read", "Notes/Gone.md"], { env: env as NodeJS.ProcessEnv, encoding: "utf8" })
  const refused = vau({ ...process.env, VAULTITE_TEST_RUN: run })
  check("a test's vau is refused there", refused.status !== 0 && /test run's call/.test(refused.stdout + refused.stderr), (refused.stdout + refused.stderr).slice(-300))
  const theirs = vau(user)
  check("the user's own vau isn't", !/test run's call/.test(theirs.stdout + theirs.stderr), (theirs.stdout + theirs.stderr).slice(-300))
  const file = [path.join(rt, REFUSED_FILE), path.join(rt, "vaultite", REFUSED_FILE)].find((f) => fs.existsSync(f)) ?? ""
  const t = touches(run, file, 0, began, path.join(tmp, "nohome"))
  check("the run's end names the call", t.length >= 1 && t.every((x) => /refused (GET|POST) \/api\//.test(x)), [file, t])
  check("another run's end doesn't", touches(path.join(tmp, "run-c"), file, 0, began, path.join(tmp, "nohome")).length === 0)
  s.kill("SIGKILL")
}

// ---------- a coding agent of the user's that ran in the run's folders and called a claude.ai connector
{
  const run = path.join(tmp, "run-d"), home = path.join(tmp, "home")
  const project = path.join(home, ".claude-x", "projects", run.replace(/[^a-zA-Z0-9]/g, "-") + "-vault")
  fs.mkdirSync(project, { recursive: true })
  fs.writeFileSync(path.join(project, "s.jsonl"), `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}\n`)
  check("an agent that called none isn't named", touches(run, "", 0, began, home).length === 0)
  fs.appendFileSync(path.join(project, "s.jsonl"), `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__claude_ai_Vaultite__tasks_add"}]}}\n`)
  const t = touches(run, "", 0, began, home)
  check("one that called a connector is", t.length === 1 && t[0].includes("mcp__claude_ai_Vaultite__tasks_add"), t)
  // (a vault given a QA script by hand, outside the run's folder)
  const given = path.join(tmp, "given-vault"), there = path.join(home, ".claude", "projects", given.replace(/[^a-zA-Z0-9]/g, "-"))
  fs.mkdirSync(there, { recursive: true })
  fs.writeFileSync(path.join(there, "s.jsonl"), `{"type":"tool_use","name":"mcp__claude_ai_Gmail__send"}\n`)
  check("one outside the run's folder isn't, until the run says it works there", touches(run, "", 0, began, home).length === 1)
  fs.mkdirSync(run, { recursive: true }); fs.writeFileSync(path.join(run, "folders.txt"), given + "\n")
  check("then it is", touches(run, "", 0, began, home).length === 2)
}

// ---------- a run that ended without its cleanup: the next one removes its folder
{
  const dead = spawn(process.execPath, ["-e", ""])
  await new Promise((done) => dead.once("exit", done))
  const left = path.join(tmp, "vt-left1"), live = path.join(tmp, "vt-live1"), other = path.join(tmp, "vt-other")
  for (const d of [left, live, other]) fs.mkdirSync(d)
  fs.writeFileSync(path.join(left, "owner.pid"), String(dead.pid))
  fs.writeFileSync(path.join(live, "owner.pid"), String(process.pid))
  sweep(tmp)
  check("a dead run's folder is removed, a live one's and one not a run's aren't", !fs.existsSync(left) && fs.existsSync(live) && fs.existsSync(other))
}

// ---------- a run's end removes its folder, failed or not, and fails one that reached the user's vault
{
  const script = (body: string) => spawnSync(process.execPath, ["--input-type=module", "-e", `import ${JSON.stringify(path.join(ROOT, "tools/test/isolate.ts"))}; ${body}`],
    { env: { ...process.env, VAULTITE_TEST_RUN: "", TMPDIR: tmp, VAULTITE_OWN_VAULTS: own }, encoding: "utf8" })
  const ok = script(`console.log(process.env.VAULTITE_TEST_RUN)`)
  const dir = ok.stdout.trim()
  check("a run's folder is gone when it ends", ok.status === 0 && dir.startsWith(tmp) && !fs.existsSync(dir), [ok.status, dir, ok.stderr])
  const failed = script(`console.log(process.env.VAULTITE_TEST_RUN); process.exit(3)`)
  check("and when it fails, with its code", failed.status === 3 && !fs.existsSync(failed.stdout.trim()), [failed.status, failed.stdout])
  const reached = script(`const { refuseOwnVault } = await import(${JSON.stringify(path.join(ROOT, "core/testrun.ts"))}); refuseOwnVault(${JSON.stringify(own)}, "a test")`)
  check("a run that reached the user's vault fails", reached.status === 1 && /reached the user's own vault/.test(reached.stdout), [reached.status, reached.stdout.slice(-300)])
}

await exit(summary("isolate", began))
