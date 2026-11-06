// Backend test, in-process: the API against a throwaway vault (or a copy), by area (tools/test/vault/), many in parallel.
//   node tools/test_vault.ts [area...] [--vault <dir>] [--jobs n] | --list | --report      (npm test: all)
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { absorb, check, exit, lastTimes, report, section, summary, tempDir } from "./test/lib.ts"
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
const ji = argv.indexOf("--jobs")
const asked = ji >= 0 ? Number(argv.splice(ji, 2)[1]) : 0
const unknown = argv.filter((n) => !AREAS.some((a) => a.name === n))
if (unknown.length) { console.error(`no area ${unknown.join(", ")} (--list lists them)`); process.exit(2) }

// The named areas and, before them, the ones they need, in the file's order.
const want = new Set<string>()
const add = (n: string) => { if (want.has(n)) return; want.add(n); for (const d of AREAS.find((a) => a.name === n)!.deps) add(d) }
argv.forEach(add)
const areas = argv.length ? AREAS.filter((a) => want.has(a.name)) : AREAS

// (a process each few areas, its own app's start being a second or two)
const jobs = asked || Math.min(4, os.availableParallelism(), Math.ceil(areas.length / 8))
const t0 = Date.now()
if (jobs > 1 && areas.length > 1) await exit(await shards())
const { vaultHarness } = await import("./test/vault/harness.ts")
const $ = await vaultHarness(from)
for (const a of areas) {
  const mod = await import(`./test/vault/${a.name}.ts`)
  await section(a.name, () => mod.default($))
}
await exit(summary("vault", t0))

/** The areas split into `jobs` shards by their last times (an area's deps run in its shard too), each run by a process
 *  of its own; their output printed as each ends, then the totals. */
async function shards() {
  const times = lastTimes("vault"), ms = (n: string) => times.get(n) ?? 1000
  const needs = (n: string, into = new Set<string>()) => { into.add(n); for (const d of AREAS.find((a) => a.name === n)!.deps) needs(d, into); return into }
  const parts = Array.from({ length: jobs }, () => ({ own: new Set<string>(), all: new Set<string>(), ms: 0 }))
  for (const a of [...areas].sort((x, y) => ms(y.name) - ms(x.name))) {
    const cost = (p: (typeof parts)[number]) => p.ms + [...needs(a.name)].filter((n) => !p.all.has(n)).reduce((t, n) => t + ms(n), 0)
    const p = parts.reduce((best, q) => (cost(q) < cost(best) ? q : best))
    p.ms = cost(p); p.own.add(a.name); needs(a.name, p.all)
  }
  const tmp = tempDir("vaultite-shards-"), used = parts.filter((p) => p.own.size)
  const ended = await Promise.all(used.map((p, i) => new Promise<string>((resolve) => {
    const out = path.join(tmp, `${i}.json`), args = [import.meta.filename, ...p.own, "--jobs", "1", ...(from ? ["--vault", from] : [])]
    const child = spawn(process.execPath, args, { env: { ...process.env, VAULTITE_TEST_OUT: out }, stdio: ["ignore", "pipe", "pipe"] })
    let log = ""
    child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d))
    child.on("close", (code, signal) => {
      console.log(`\n######## shard ${i + 1}: ${[...p.own].join(" ")}\n${log}`)
      resolve(fs.existsSync(out) ? "" : `shard ${i + 1} (${[...p.own].join(" ")}) ended (${signal ?? code}) without its results`)
    })
  })))
  ended.forEach((why, i) => why ? check(why, false) : absorb(path.join(tmp, `${i}.json`), used[i].own))
  return summary("vault", t0)
}
