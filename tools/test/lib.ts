// The tests' shared kit: check, skip, sections (timed; one that throws ends there, not the run), the summary, the
// record of runs (tools/.runs/test-runs.jsonl).
import { type ChildProcess, spawn, type SpawnOptions } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"

export type Any = any
export type Status = "ok" | "FAIL" | "skip"
export type Result = { name: string; status: Status; note: string; section: string }
type SectionRun = { name: string; ms: number; ok: boolean; fails: string[]; threw?: string }

export const results: Result[] = []
const sections: SectionRun[] = []
let current: SectionRun | null = null
let started = 0

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** A port nothing listens on now, on 127.0.0.1. */
export const freePort = () => new Promise<number>((resolve) => {
  const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)) })
})

const servers = new Set<ChildProcess>()
const killServers = () => { for (const s of servers) if (s.exitCode === null && s.signalCode === null) try { s.kill("SIGKILL") } catch { /* gone */ } }
let ending = false
/** This checkout's server.ts for a test (spawn's options): killed when the test ends, by its end, a signal or a crash,
 *  and ending itself should the test die unseen (VAULTITE_PARENT_PID, server.ts). */
export function testServer(o: SpawnOptions = {}): ChildProcess {
  if (!ending) {
    ending = true
    process.on("exit", killServers)
    for (const [sig, n] of [["SIGINT", 2], ["SIGTERM", 15], ["SIGHUP", 1]] as const) {
      // (a script with its own handler decides when to exit; else this one does, as the signal would have)
      process.on(sig, () => { killServers(); if (process.listenerCount(sig) === 1) process.exit(128 + n) })
    }
  }
  const s = spawn(process.execPath, [path.join(REPO, "server.ts")], { cwd: REPO, ...o, env: { ...(o.env ?? process.env), VAULTITE_PARENT_PID: String(process.pid) } })
  servers.add(s)
  s.once("exit", () => servers.delete(s))
  return s
}

export function check(name: string, ok: unknown, got?: unknown) {
  const note = ok ? "" : JSON.stringify(got)?.slice(0, 400) ?? ""
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  -> ${note}`}`)
  results.push({ name, status: ok ? "ok" : "FAIL", note, section: current?.name ?? "" })
  if (!ok) current?.fails.push(name)
  return !!ok
}

export function skip(name: string, why: string) {
  console.log(`skip ${name}: ${why}`)
  results.push({ name, status: "skip", note: why, section: current?.name ?? "" })
}

function close() {
  if (!current) return
  current.ms = Date.now() - started
  current.ok = !current.fails.length && !current.threw
  current = null
}
function open(name: string) {
  close()
  console.log(`\n== ${name}`)
  current = { name, ms: 0, ok: true, fails: [] }
  sections.push(current)
  started = Date.now()
}

/** With fn: runs it as a section, timed, an exception failing it (and only it). Without: what follows is the section. */
export function section(name: string): void
export function section(name: string, fn: () => Promise<unknown> | unknown): Promise<boolean>
export function section(name: string, fn?: () => Promise<unknown> | unknown): Promise<boolean> | void {
  open(name)
  if (!fn) return
  const run = current!
  return (async () => {
    try { await fn() } catch (e) {
      run.threw = String((e as Error)?.stack ?? e).split("\n").slice(0, 6).join("\n")
      console.log(`FAIL ${name}: threw  -> ${run.threw}`)
      results.push({ name: `${name}: threw`, status: "FAIL", note: run.threw, section: name })
      run.fails.push(`${name}: threw`)
    }
    close()
    return run.fails.length === 0
  })()
}

export async function waitFor<T>(fn: () => Promise<T> | T, ms = 15000, step = 500): Promise<T | null> {
  const end = Date.now() + ms
  for (;;) {
    try { const v = await fn(); if (v) return v } catch { /* not yet */ }
    if (Date.now() > end) return null
    await sleep(step)
  }
}

const REPO = path.resolve(import.meta.dirname, "..", "..")
/** Where runs are kept: tools/.runs/ (ignored by its own .gitignore), or $VAULTITE_RUNS_DIR. */
function runsFile() {
  return path.join(process.env.VAULTITE_RUNS_DIR ?? path.join(REPO, "tools", ".runs"), "test-runs.jsonl")
}
type RunRecord = { suite: string; at: string; ms: number; ok: boolean; sections: { name: string; ms: number; ok: boolean; fails: string[] }[] }

export function record(suite: string, rows: { name: string; ms: number; ok: boolean; fails: string[] }[], ms: number) {
  const rec: RunRecord = { suite, at: new Date().toISOString(), ms, ok: rows.every((r) => r.ok), sections: rows }
  try {
    fs.mkdirSync(path.dirname(runsFile()), { recursive: true })
    if (!process.env.VAULTITE_RUNS_DIR) fs.writeFileSync(path.join(path.dirname(runsFile()), ".gitignore"), "*\n")
    fs.appendFileSync(runsFile(), JSON.stringify(rec) + "\n")
  } catch { /* a read-only checkout: runs aren't kept */ }
}

/** The slowest sections (their latest time) and the ones that failed in the last runs, of one suite. */
export function report(suite: string, last = 20) {
  let runs: RunRecord[] = []
  try { runs = fs.readFileSync(runsFile(), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.suite === suite) } catch { /* none yet */ }
  if (!runs.length) return console.log(`no ${suite} runs kept yet (${runsFile()})`)
  runs = runs.slice(-last)
  const latest = new Map<string, number>(), failed = new Map<string, { n: number; at: string; fails: string[] }>()
  for (const r of runs) for (const s of r.sections) {
    latest.set(s.name, s.ms)
    if (!s.ok) failed.set(s.name, { n: (failed.get(s.name)?.n ?? 0) + 1, at: r.at, fails: s.fails })
  }
  console.log(`${suite}: ${runs.length} runs kept, the last ${runs.at(-1)!.ok ? "passed" : "failed"} in ${(runs.at(-1)!.ms / 1000).toFixed(1)} s\n\nslowest:`)
  for (const [n, ms] of [...latest].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${(ms / 1000).toFixed(1).padStart(6)} s  ${n}`)
  console.log(failed.size ? `\nfailed in the last ${runs.length} runs:` : `\nnothing failed in the last ${runs.length} runs`)
  for (const [n, f] of [...failed].sort((a, b) => b[1].at.localeCompare(a[1].at)))
    console.log(`  ${n}: ${f.n}x, last ${f.at.slice(0, 16)}  ${f.fails.slice(0, 2).join("; ").slice(0, 160)}`)
}

/** Prints the totals (and each section's time when there were several), keeps the run, returns the exit code. */
export function summary(suite: string, t0: number) {
  close()
  const fails = results.filter((r) => r.status === "FAIL"), skips = results.filter((r) => r.status === "skip")
  if (sections.length > 1) {
    console.log("\nsections:")
    for (const s of sections) console.log(`  ${s.ok ? "ok  " : "FAIL"} ${(s.ms / 1000).toFixed(1).padStart(6)} s  ${s.name}${s.fails.length ? ` (${s.fails.length} failed)` : ""}`)
  }
  console.log(`\n${results.length - fails.length - skips.length} passed, ${fails.length} failed${skips.length ? `, ${skips.length} skipped` : ""}` +
    ` in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  for (const f of fails) console.log(`  FAIL ${f.name}`)
  record(suite, sections.map(({ name, ms, ok, fails }) => ({ name, ms, ok, fails })), Date.now() - t0)
  return fails.length ? 1 : 0
}
