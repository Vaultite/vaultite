// The tests' shared kit: check, skip, sections (timed; one that throws ends there, not the run), the summary, the
// record of runs (tools/.runs/test-runs.jsonl) and the made-up agents' state the backend tests read.
import fs from "node:fs"
import path from "node:path"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Any = any
export type Status = "ok" | "FAIL" | "skip"
export type Result = { name: string; status: Status; note: string; section: string }
export type SectionRun = { name: string; ms: number; ok: boolean; fails: string[]; threw?: string }

export const results: Result[] = []
export const sections: SectionRun[] = []
let current: SectionRun | null = null
let started = 0

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
export function runsFile() {
  return path.join(process.env.VAULTITE_RUNS_DIR ?? path.join(REPO, "tools", ".runs"), "test-runs.jsonl")
}
export type RunRecord = { suite: string; at: string; ms: number; ok: boolean; sections: { name: string; ms: number; ok: boolean; fails: string[] }[] }

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

// ---------- the coding agents' made-up state (tools/fixtures), never this machine's

const FIX = path.join(REPO, "tools", "fixtures")
const sqlite = () => import("node:sqlite")

/** OpenClaw's: each <name>.sql made into its database, times moved so the newest reply is an hour ago, events of 512
 *  bytes and more zstd-compressed (as OpenClaw stores them). */
export async function openclawFixture(dir: string) {
  fs.cpSync(path.join(FIX, "openclaw"), dir, { recursive: true })
  const { DatabaseSync } = await sqlite()
  const { zstdCompressSync } = await import("node:zlib")
  const files = (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith(".sql"))
  const times = files.filter((f) => f.startsWith("agents")).flatMap((f) => [...fs.readFileSync(path.join(dir, f), "utf8").matchAll(/\b1[78]\d{11}\b/g)].map((m) => Number(m[0])))
  const shift = Date.now() - 3600000 - Math.max(...times)
  for (const f of files) {
    const db = new DatabaseSync(path.join(dir, f.slice(0, -4)))
    db.exec(fs.readFileSync(path.join(dir, f), "utf8").replace(/\b1[78]\d{11}\b/g, (t) => String(Number(t) + shift))
      .replace(/\b20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, (t) => new Date(Date.parse(t) + shift).toISOString()))
    const big = f.startsWith("agents") ? db.prepare("SELECT session_id, seq, event_json FROM transcript_events WHERE length(event_json) >= 512 AND event_json NOT LIKE '{\"type\":\"session\"%'").all() : []
    for (const r of big as { session_id: string; seq: number; event_json: string }[]) {
      const ev = JSON.parse(r.event_json), nb = Buffer.byteLength(r.event_json)
      const nav = { version: 1, report: { kind: "canonical", hasParentId: true, entry: { id: ev.id, parentId: ev.parentId, timestamp: ev.timestamp, type: ev.type } },
        navigation: {}, reset: {}, model: { type: ev.type, id: ev.id, message: { role: ev.message?.role } }, modelBytes: nb, modelWithoutCheckpointBytes: nb, withoutCustomDataBytes: nb }
      db.prepare("UPDATE transcript_events SET event_json = NULL, event_zstd = ?, event_utf8_bytes = ?, navigation_json = ? WHERE session_id = ? AND seq = ?")
        .run(zstdCompressSync(Buffer.from(r.event_json)), nb, JSON.stringify(nav), r.session_id, r.seq)
    }
    db.close()
    fs.rmSync(path.join(dir, f))
  }
}

/** Hermes Agent's home and a profile: each state.sql made its state.db, times in seconds moved so the newest is an hour ago. */
export async function hermesFixture(dir: string) {
  fs.cpSync(path.join(FIX, "hermes"), dir, { recursive: true })
  const { DatabaseSync } = await sqlite()
  const sqls = (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith(".sql"))
  const TIME = /\b1[78]\d{8}(\.\d+)?\b/g
  const shift = Date.now() / 1000 - 3600 - Math.max(...sqls.flatMap((f) => [...fs.readFileSync(path.join(dir, f), "utf8").matchAll(TIME)].map((m) => Number(m[0]))))
  for (const f of sqls) {
    const db = new DatabaseSync(path.join(dir, f.replace(/\.sql$/, ".db")))
    db.exec(fs.readFileSync(path.join(dir, f), "utf8").replace(TIME, (t) => String(Number(t) + shift)))
    db.close()
    fs.rmSync(path.join(dir, f))
  }
}

/** OpenCode's database (opencode.sql, times moved so the newest is an hour ago). */
export async function opencodeFixture(dir: string) {
  const sql = fs.readFileSync(path.join(FIX, "opencode", "opencode.sql"), "utf8")
  const times = [...sql.matchAll(/\b1[78]\d{11}\b/g)].map((m) => Number(m[0]))
  const shift = Date.now() - 3600000 - Math.max(...times)
  const { DatabaseSync } = await sqlite()
  fs.mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(path.join(dir, "opencode.db"))
  db.exec(sql.replace(/\b1[78]\d{11}\b/g, (t) => String(Number(t) + shift)))
  db.close()
}

/** Cursor's files (`User` for Cursor.app's User folder, `config` for ~/.cursor), each <name>.sql made <name>. */
export async function cursorFixture(dir: string) {
  fs.cpSync(path.join(FIX, "cursor"), dir, { recursive: true })
  const { DatabaseSync } = await sqlite()
  for (const f of fs.readdirSync(dir, { recursive: true }) as string[]) {
    if (!f.endsWith(".sql")) continue
    const db = new DatabaseSync(path.join(dir, f.slice(0, -4)))
    db.exec(fs.readFileSync(path.join(dir, f), "utf8"))
    db.close()
  }
}
