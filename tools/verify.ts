// What this branch changed, checked: build and check, then the web test, vault test areas, QA scripts whose header
// names a changed path and the smoke test, as needed, timing each. node tools/verify.ts [--base main] [--dry]
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { AREAS } from "./test/vault/index.ts"
import { gitEnv } from "../core/gitenv.ts"

const ROOT = path.resolve(import.meta.dirname, "..")
const argv = process.argv.slice(2)
const base = argv.includes("--base") ? argv[argv.indexOf("--base") + 1] : "main"
const dry = argv.includes("--dry")
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

/** QA scripts whose header comment names a changed path (or that changed themselves). */
function qaFor(files: string[]): string[] {
  const dir = path.join(ROOT, "web/qa")
  return fs.readdirSync(dir).filter((f) => f.endsWith(".mjs")).map((f) => f.slice(0, -4)).filter((name) => {
    if (files.includes(`web/qa/${name}.mjs`)) return true
    const head = fs.readFileSync(path.join(dir, `${name}.mjs`), "utf8").split("\n").filter((l) => l.startsWith("//")).join("\n")
    return files.some((f) => {
      const plugin = /^plugins\/core\/[\w-]+/.exec(f)?.[0]
      return head.includes(f) || (plugin && head.includes(plugin)) || (/^(core|web\/src)\//.test(f) && head.includes(f.replace(/^web\/src\//, "").replace(/\.tsx?$/, ".ts")))
    })
  }).filter((n) => !["boot", "perf", "stability", "termperf", "shots", "subjects", "machines", "termhost", "demo"].includes(n))
}

const web = changed.some((f) => f.startsWith("web/"))
const areas = areasFor(changed), qa = qaFor(changed)
const stages: { name: string; cmd: string[]; why: string }[] = [
  { name: "build", cmd: ["npm", "run", "build"], why: "always" },
  { name: "check", cmd: ["npm", "run", "check"], why: "always" },
  ...(changed.some((f) => f.startsWith("web/src/") || f === "tools/test_web.ts") ? [{ name: "test_web", cmd: ["node", "tools/test_web.ts"], why: "web/src or its test changed" }] : []),
  ...(areas.length ? [{ name: "test_vault", cmd: ["node", "tools/test_vault.ts", ...(areas.length === AREAS.length ? [] : areas)],
    why: areas.length === AREAS.length ? "all areas" : areas.join(" ") }] : []),
  ...(changed.some((f) => f.startsWith("web/qa/") || f.startsWith("web/src/")) ? [{ name: "qa lint", cmd: ["node", "tools/qa.ts", "--lint"], why: "QA selectors" }] : []),
  ...(qa.length ? [{ name: "qa", cmd: ["node", "tools/qa.ts", ...qa], why: qa.join(" ") }] : []),
  ...(web ? [{ name: "smoke", cmd: ["npm", "run", "smoke"], why: "web changed" }] : []),
]

console.log(`${changed.length} files changed since ${base}`)
const rows: { name: string; why: string; s: string; ok: boolean | null }[] = []
for (const st of stages) {
  if (dry) { rows.push({ name: st.name, why: st.why, s: "-", ok: null }); continue }
  console.log(`\n== ${st.name}: ${st.cmd.join(" ")}`)
  const t = Date.now()
  const r = spawnSync(st.cmd[0], st.cmd.slice(1), { cwd: ROOT, stdio: "inherit" })
  rows.push({ name: st.name, why: st.why, s: ((Date.now() - t) / 1000).toFixed(1), ok: r.status === 0 })
}
console.log("\nstage        time    result  what")
for (const r of rows) console.log(`${r.name.padEnd(12)} ${r.s.padStart(6)}s  ${r.ok === null ? "-     " : r.ok ? "ok    " : "FAIL  "}  ${r.why.slice(0, 90)}`)
const ok = rows.every((r) => r.ok !== false)
console.log(`\n${dry ? "dry run" : ok ? "ok" : "FAIL"}`)
process.exit(ok ? 0 : 1)
