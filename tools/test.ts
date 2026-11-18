// npm test: every suite at once, each one's output printed as it ends, then which failed. node tools/test.ts [suite...]
import "./test/isolate.ts" // (first: a run of its own, kept off the user's vaults)
import { spawn } from "node:child_process"
import path from "node:path"

const ALL = ["test_web", "test_vault", "test_vt", "test_pictures", "test_player", "test_kdbx", "test_sandbox", "test_setup", "test_shell", "test_selfupdate", "test_running", "test_updater", "test_store", "test_servicestore", "test_plan", "test_ci", "test_update", "test_closure", "test_lint", "test_stall", "test_keptassets", "test_slowmove", "test_hang", "test_desktophost", "test_serverwatch", "test_machines", "test_shared", "test_sync", "test_sync_live", "test_tours", "test_showsaid", "test_isolate", "test_qa_scripts", "perf/startup"]
const args = process.argv.slice(2), cut = args.indexOf("--except")
const want = cut < 0 ? args : args.slice(0, cut), except = cut < 0 ? [] : args.slice(cut + 1)
const unknown = [...want, ...except].filter((s) => !ALL.includes(s))
if (unknown.length) { console.error(`no suite ${unknown.join(", ")}: ${ALL.join(" ")}`); process.exit(2) }
const t0 = Date.now()
const runs = await Promise.all((want.length ? want : ALL).filter((s) => !except.includes(s)).map((name) => new Promise<{ name: string; code: number; ms: number }>((resolve) => {
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
