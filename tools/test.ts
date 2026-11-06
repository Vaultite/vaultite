// npm test: every suite at once (each has its own temp folders, ports and servers; they mostly wait), each one's output
// printed as it ends, then which failed. node tools/test.ts [suite...]   (suite: test_vault, perf/startup...)
import { spawn } from "node:child_process"
import path from "node:path"

const ALL = ["test_web", "test_vault", "test_vt", "test_sandbox", "test_setup", "test_selfupdate", "test_update", "test_stall", "test_desktophost", "test_machines", "test_shared", "perf/startup"]
const want = process.argv.slice(2)
const unknown = want.filter((s) => !ALL.includes(s))
if (unknown.length) { console.error(`no suite ${unknown.join(", ")}: ${ALL.join(" ")}`); process.exit(2) }
const t0 = Date.now()
const runs = await Promise.all((want.length ? want : ALL).map((name) => new Promise<{ name: string; code: number; ms: number }>((resolve) => {
  const began = Date.now(), child = spawn(process.execPath, [path.join(import.meta.dirname, `${name}.ts`)], { stdio: ["ignore", "pipe", "pipe"] })
  let log = ""
  child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d))
  child.on("close", (code, signal) => {
    console.log(`\n######## ${name}\n${log.trimEnd()}`)
    resolve({ name, code: code ?? (signal ? 1 : 0), ms: Date.now() - began })
  })
})))
console.log("\nsuites:")
for (const r of runs) console.log(`  ${r.code ? "FAIL" : "ok  "} ${(r.ms / 1000).toFixed(1).padStart(6)} s  ${r.name}`)
const failed = runs.filter((r) => r.code)
console.log(`\n${failed.length ? `${failed.length} of ${runs.length} suites failed: ${failed.map((r) => r.name).join(", ")}` : runs.length === 1 ? `${runs[0].name} passed` : `all ${runs.length} suites passed`} in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
process.exitCode = failed.length ? 1 : 0
