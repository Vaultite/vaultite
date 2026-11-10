// What this branch changed, checked, timing each: build, check, then the tests and QA scripts it reaches (--all: every
// test and smoke; --try: HEAD on GitHub's runners too, tools/try.ts). node tools/verify.ts [--base main] [--all] [--try [--surfaces]] [--dry]
import "./test/isolate.ts" // (first: a run of its own, kept off the user's vaults)
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { AREAS } from "./test/vault/index.ts"
import { gitEnv } from "../core/gitenv.ts"
import { qaFor } from "./qa_scripts.ts"
import { changeRisk, describe } from "./osrisk.ts"
import { WAIT_SECONDS, startTry, waitTry, type Waited } from "./try.ts"

const ROOT = path.resolve(import.meta.dirname, "..")
const argv = process.argv.slice(2)
const base = argv.includes("--base") ? argv[argv.indexOf("--base") + 1] : "main"
const dry = argv.includes("--dry"), all = argv.includes("--all"), tryIt = argv.includes("--try")
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

const risks = changeRisk(ROOT, base)
console.log(`${changed.length} files changed since ${base}`)
if (risks.length) console.log(`OS-sensitive: ${describe(risks)}`)
const rows: { name: string; why: string; s: string; ok: boolean | null }[] = []
const t0 = Date.now(), also = argv.includes("--surfaces") ? ["surfaces"] : []
let trying = false
for (const st of stages) {
  if (dry) { rows.push({ name: st.name, why: st.why, s: "-", ok: null }); continue }
  console.log(`\n== ${st.name}: ${st.cmd.join(" ")}`)
  const t = Date.now()
  const r = spawnSync(st.cmd[0], st.cmd.slice(1), { cwd: ROOT, stdio: "inherit" })
  rows.push({ name: st.name, why: st.why, s: ((Date.now() - t) / 1000).toFixed(1), ok: r.status === 0 })
  // (the try starts once build and check pass, what would fail its every job; the other stages run while it does)
  if (tryIt && st.name === "check") {
    console.log("\n== try: tools/try.ts (HEAD on GitHub's Linux, macOS and Windows runners)")
    trying = rows.every((x) => x.ok) ? startTry(ROOT, { also, precheck: () => null }) : (console.log("try: NOT STARTED: build or check fails here"), false)
  }
}
let waited: Waited | null = null
if (trying) {
  // (verify as a whole stays within a wait's bound: a sub-agent's command gets 10 minutes)
  console.log("\n== try: waiting for it (node tools/try.ts --wait)")
  const t = Date.now()
  waited = await waitTry(ROOT, { seconds: Math.max(30, WAIT_SECONDS - (Date.now() - t0) / 1000) })
  rows.push({ name: "try", why: "Linux, macOS and Windows (GitHub)", s: ((Date.now() - t) / 1000).toFixed(1), ok: waited.status === "passed" ? true : waited.status === "running" ? null : false })
} else if (tryIt && !dry) rows.push({ name: "try", why: "not started (above)", s: "-", ok: false })
console.log("\nstage        time    result  what")
for (const r of rows) console.log(`${r.name.padEnd(12)} ${r.s.padStart(6)}s  ${r.ok === null ? "-     " : r.ok ? "ok    " : "FAIL  "}  ${r.why.slice(0, 90)}`)
const failed = rows.filter((r) => r.ok === false).map((r) => r.name)
if (risks.length && !tryIt) console.log("\nOS-sensitive (above): before it lands, try HEAD on Linux, macOS and Windows: npm run verify -- --try (pre-push asks)")
// (the last line says it all, read alone: exit 0 ok, 1 failed, 3 the try still running)
console.log(`\n${dry ? "verify: dry run" : failed.length ? `verify: FAIL (${failed.join(", ")})${waited?.status === "failed" ? `; ${waited.line}` : ""}`
  : waited?.status === "running" ? `verify: ok here; ${waited.line}` : `verify: ok${waited ? `; ${waited.line}` : ""}`}`)
process.exit(failed.length ? 1 : waited?.status === "running" ? 3 : 0)
