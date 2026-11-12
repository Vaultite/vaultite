// What this branch changed, checked, timing each: build, check, then the tests and QA scripts it reaches (--all: every
// test and smoke; --try: HEAD on Linux, macOS and Windows too, idle Machines first, else GitHub's runners: tools/try.ts). node tools/verify.ts [--base main] [--all] [--try [--surfaces]] [--dry] [--fresh]
import "./test/isolate.ts" // (first: a run of its own, kept off the user's vaults)
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { AREAS } from "./test/vault/index.ts"
import { gitEnv } from "../core/gitenv.ts"
import { qaFor } from "./qa_scripts.ts"
import { changeRisk, describe } from "./osrisk.ts"
import { WAIT_SECONDS, startTry, waitTry, type Waited } from "./try.ts"
import { findMachines } from "./try_machines.ts"
// (a stage that passed on the same files isn't run again; --fresh: every one is)
import { filesState, passes } from "./verify_passed.ts"

const ROOT = path.resolve(import.meta.dirname, "..")
const argv = process.argv.slice(2)
const base = argv.includes("--base") ? argv[argv.indexOf("--base") + 1] : "main"
const dry = argv.includes("--dry"), all = argv.includes("--all"), tryIt = argv.includes("--try"), fresh = argv.includes("--fresh")
const git = (...a: string[]) => spawnSync("git", a, { cwd: ROOT, encoding: "utf8", env: gitEnv() }).stdout.split("\n").filter(Boolean)
const changed = [...new Set([...git("diff", "--name-only", `${base}...HEAD`), ...git("diff", "--name-only", "HEAD"),
  ...git("ls-files", "--others", "--exclude-standard")])].sort()

/** The vault test's areas these changes reach: none, some, or all (a file they all rest on, or one none names). */
function areasFor(files: string[]): string[] {
  const text = new Map(AREAS.map((a) => [a.name, fs.readFileSync(path.join(ROOT, "tools/test/vault", `${a.name}.ts`), "utf8")]))
  const all = AREAS.map((a) => a.name), out = new Set<string>()
  for (const f of files) {
    if (/^(server\.ts|package\.json|tools\/test_vault\.ts|tools\/test\/(lib|vault\/harness|vault\/index)\.ts)$/.test(f)) return all
    const area = /^tools\/test\/vault\/([\w-]+)\.ts$/.exec(f)?.[1]
    if (area) { out.add(area); continue }
    const plugin = /^plugins\/core\/([\w-]+)\//.exec(f)?.[1]
    const core = /^core\/(.+)\.ts$/.exec(f)?.[1]
    if (!plugin && !core) continue
    const re = plugin ? new RegExp(`plugins/core/${plugin}\\b`) : new RegExp(`(?<!plugins/)core/${core!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.ts`)
    const hit = all.filter((a) => a === plugin || re.test(text.get(a)!))
    if (!hit.length) return all
    hit.forEach((a) => out.add(a))
  }
  return all.filter((a) => out.has(a))
}

const web = changed.some((f) => f.startsWith("web/"))
const areas = areasFor(changed), qa = [...qaFor(changed).keys()].sort()
type Stage = { name: string; cmd: string[]; why: string }
const picked: Stage[] = [
  ...(changed.some((f) => f.startsWith("web/src/") || f === "tools/test_web.ts") ? [{ name: "test_web", cmd: ["node", "tools/test_web.ts"], why: "web/src or its test changed" }] : []),
  ...(changed.some((f) => /^(electron\/browser\/(kdbx\/|keepass\.ts|kdbxedit\.ts)|tools\/test\/kdbx\/|tools\/test_kdbx\.ts)/.test(f)) ? [{ name: "test_kdbx", cmd: ["node", "tools/test_kdbx.ts"], why: "the KeePass reader changed" }] : []),
  ...(changed.some((f) => /^(plugins\/core\/terminal\/claude-pictures\/|tools\/test\/pictures\/|tools\/fixtures\/pictures\/|tools\/test_pictures\.ts)/.test(f)) ? [{ name: "test_pictures", cmd: ["node", "tools/test_pictures.ts"], why: "the pictures mod's decoders changed" }] : []),
  ...(changed.some((f) => /^(\.oxlintrc\.json$|tools\/(oxlint|ratchet)\/|tools\/(ratchet|test_lint)\.ts$)/.test(f)) ? [{ name: "test_lint", cmd: ["node", "tools/test_lint.ts"], why: "the lint rules or the ratchet changed" }] : []),
  ...(areas.length ? [{ name: "test_vault", cmd: ["node", "tools/test_vault.ts", ...(areas.length === AREAS.length ? [] : areas)],
    why: areas.length === AREAS.length ? "all areas" : areas.join(" ") }] : []),
  ...(changed.some((f) => f.startsWith("web/qa/") || f.startsWith("web/src/")) ? [{ name: "qa lint", cmd: ["node", "tools/qa.ts", "--lint"], why: "QA selectors" }] : []),
  ...(qa.length ? [{ name: "qa", cmd: ["node", "tools/qa.ts", ...qa], why: qa.join(" ") }] : []),
  ...(web ? [{ name: "smoke", cmd: ["npm", "run", "smoke"], why: "web changed" }] : []),
]
const stages: Stage[] = [
  { name: "build", cmd: ["npm", "run", "build"], why: "always" },
  { name: "check", cmd: ["npm", "run", "check"], why: "always" },
  ...(all ? [{ name: "test", cmd: ["npm", "test"], why: "--all" }, { name: "smoke", cmd: ["npm", "run", "smoke"], why: "--all" }] : picked),
]

// (build makes what the stages after it use, so it runs whenever one of them does; build or check failing, the tests
// would run again on the fixed files anyway, so they wait)
const GATES = new Set(["build", "check"])
const state = filesState(ROOT), kept = passes(ROOT)
const before = stages.map((st) => (state && !fresh ? kept.passedAt(state, st.cmd) : null))
if (stages.some((st, i) => st.name !== "build" && before[i] === null)) stages.forEach((st, i) => { if (st.name === "build") before[i] = null })
const logFile = path.join(git("rev-parse", "--absolute-git-dir")[0] ?? ROOT, "verify.log")
const logFd = dry ? null : fs.openSync(logFile, "w")
const say = (s: string) => { process.stdout.write(`${s}\n`); if (logFd !== null) fs.writeSync(logFd, `${s}\n`) }
const run = (cmd: string[]) => new Promise<number>((resolve) => {
  const child = spawn(cmd[0], cmd.slice(1), { cwd: ROOT, stdio: ["inherit", "pipe", "pipe"] })
  const tee = (to: NodeJS.WriteStream) => (d: Buffer) => { to.write(d); fs.writeSync(logFd!, d) }
  child.stdout!.on("data", tee(process.stdout)); child.stderr!.on("data", tee(process.stderr))
  child.on("error", () => resolve(127)); child.on("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)))
})
const ago = (at: number) => { const m = Math.round((Date.now() - at) / 60_000); return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago` }

const risks = changeRisk(ROOT, base)
say(`${changed.length} files changed since ${base}`)
if (risks.length) say(`OS-sensitive: ${describe(risks)}`)
const rows: { name: string; why: string; s: string; ok: boolean | null; cmd: string[] }[] = []
const t0 = Date.now(), also = argv.includes("--surfaces") ? ["surfaces"] : []
let trying = false
for (const [i, st] of stages.entries()) {
  const at = before[i], gated = rows.some((r) => GATES.has(r.name) && r.ok === false)
  if (at !== null) rows.push({ name: st.name, why: `passed on these files ${ago(at)}: ${st.why}`, s: "-", ok: true, cmd: st.cmd })
  else if (dry) rows.push({ name: st.name, why: st.why, s: "-", ok: null, cmd: st.cmd })
  else if (gated && !GATES.has(st.name)) rows.push({ name: st.name, why: "not run: build or check fails (above)", s: "-", ok: null, cmd: st.cmd })
  else {
    say(`\n== ${st.name}: ${st.cmd.join(" ")}`)
    const t = Date.now(), ok = (await run(st.cmd)) === 0, s = (Date.now() - t) / 1000
    rows.push({ name: st.name, why: st.why, s: s.toFixed(1), ok, cmd: st.cmd })
    // (kept only if the files are still the ones it started on: none changed while it ran)
    if (ok && state && filesState(ROOT) === state) kept.pass(state, st.cmd, s)
  }
  // (the try starts once build and check pass, what would fail its every job; the other stages run while it does)
  if (tryIt && !dry && st.name === "check") {
    say("\n== try: tools/try.ts (HEAD on Linux, macOS and Windows: idle Machines first, else GitHub's runners)")
    trying = rows.every((x) => x.ok) ? await startTry(ROOT, { also, precheck: () => null, machines: (oses, log) => findMachines(ROOT, oses, log) }) : (say("try: NOT STARTED: build or check fails here"), false)
  }
}
let waited: Waited | null = null
if (trying) {
  // (verify as a whole stays within a wait's bound: a sub-agent's command gets 10 minutes)
  say("\n== try: waiting for it (node tools/try.ts --wait)")
  const t = Date.now()
  waited = await waitTry(ROOT, { seconds: Math.max(30, WAIT_SECONDS - (Date.now() - t0) / 1000) })
  rows.push({ name: "try", why: "Linux, macOS and Windows", s: ((Date.now() - t) / 1000).toFixed(1), ok: waited.status === "passed" ? true : waited.status === "running" ? null : false, cmd: [] })
} else if (tryIt && !dry) rows.push({ name: "try", why: "not started (above)", s: "-", ok: false, cmd: [] })
say("\nstage        time    result  what")
for (const r of rows) say(`${r.name.padEnd(12)} ${r.s.padStart(6)}s  ${r.ok === null ? "-     " : r.ok ? "ok    " : "FAIL  "}  ${r.why.slice(0, 90)}`)
const failed = rows.filter((r) => r.ok === false)
if (risks.length && !tryIt) say("\nOS-sensitive (above): before it lands, try HEAD on Linux, macOS and Windows: npm run verify -- --try (pre-push asks)")
// (while fixing, the failed stage alone is the quick loop; verify again at the end runs only what hasn't passed on the files)
if (failed.some((r) => r.cmd.length)) say(`\nwhile fixing, rerun just what failed: ${failed.filter((r) => r.cmd.length).map((r) => r.cmd.join(" ")).join("; ")}`)
// (the last line says it all, read alone: exit 0 ok, 1 failed, 3 the try still running)
say(`\n${dry ? "verify: dry run" : failed.length ? `verify: FAIL (${failed.map((r) => r.name).join(", ")})${waited?.status === "failed" ? `; ${waited.line}` : ""}; its output: ${logFile}`
  : waited?.status === "running" ? `verify: ok here; ${waited.line}` : `verify: ok${waited ? `; ${waited.line}` : ""}`}`)
process.exit(failed.length ? 1 : waited?.status === "running" ? 3 : 0)
