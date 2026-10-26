// Backend test, in-process: the API against a throwaway vault (or a copy), by area (tools/test/vault/).
//   node tools/test_vault.ts [area...] [--vault <dir>] | --list | --report      (npm test: all)
import fs from "node:fs"
import path from "node:path"
import { report, section, summary } from "./test/lib.ts"
import { AREAS } from "./test/vault/index.ts"

const argv = process.argv.slice(2)
const flag = (f: string) => { const i = argv.indexOf(f); return i >= 0 && !!argv.splice(i, 1) }
const DIR = path.join(import.meta.dirname, "test", "vault")
if (flag("--report")) { report("vault"); process.exit(0) }
if (flag("--list")) {
  for (const a of AREAS) {
    const text = fs.readFileSync(path.join(DIR, `${a.name}.ts`), "utf8")
    const first = /^ {2}\/\/ (?:-+ )?(.*?)(?: -+)?$/m.exec(text)?.[1] ?? /check\("([^"]*)"/.exec(text)?.[1] ?? ""
    console.log(`${a.name.padEnd(14)} ${first.slice(0, 100)}${a.deps.length ? `  (after ${a.deps.join(", ")})` : ""}`)
  }
  process.exit(0)
}
const vi = argv.indexOf("--vault")
const from = vi >= 0 ? argv.splice(vi, 2)[1] : undefined
const unknown = argv.filter((n) => !AREAS.some((a) => a.name === n))
if (unknown.length) { console.error(`no area ${unknown.join(", ")} (--list lists them)`); process.exit(2) }

// The named areas and, before them, the ones they need, in the file's order.
const want = new Set<string>()
const add = (n: string) => { if (want.has(n)) return; want.add(n); for (const d of AREAS.find((a) => a.name === n)!.deps) add(d) }
argv.forEach(add)
const areas = argv.length ? AREAS.filter((a) => want.has(a.name)) : AREAS

const t0 = Date.now()
const { vaultHarness } = await import("./test/vault/harness.ts")
const $ = await vaultHarness(from)
for (const a of areas) {
  const mod = await import(`./test/vault/${a.name}.ts`)
  await section(a.name, () => mod.default($))
}
const code = summary("vault", t0)
process.exit(code)
