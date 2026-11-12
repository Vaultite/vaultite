// npm run quality [-- --at <commit>] [--json]: the code's patterns per 1k lines, overall and per folder.
import { execFileSync } from "node:child_process"
import { gitEnv } from "../core/gitenv.ts"
import { add, type Counts, empty, isCode, measure, METRICS, type Metric } from "./quality/measure.ts"
import { ROOT, sourceFiles, readAt } from "./quality/files.ts"

const args = process.argv.slice(2)
const at = args.includes("--at") ? args[args.indexOf("--at") + 1] : null

const folderOf = (f: string) => {
  const [a, b] = f.split("/")
  if (!b) return "(root)"
  return a === "web" ? `${a}/${b}` : a
}

type Row = { counts: Counts; files: number; over1000: number; over2000: number }
const row = (): Row => ({ counts: empty(), files: 0, over1000: 0, over2000: 0 })

const total = row()
const folders = new Map<string, Row>()
const files = sourceFiles(at).filter(isCode)
const texts = readAt(at, files)
for (const f of files) {
  const c = measure(f, texts.get(f) ?? "")
  const key = folderOf(f)
  if (!folders.has(key)) folders.set(key, row())
  for (const r of [total, folders.get(key) ?? row()]) {
    add(r.counts, c)
    r.files++
    if (c.lines > 1000) r.over1000++
    if (c.lines > 2000) r.over2000++
  }
}

function fixShare(days: number) {
  const log = execFileSync("git", ["log", "--format=%s", `--since=${days} days ago`, at ?? "HEAD"],
    { cwd: ROOT, env: gitEnv(), encoding: "utf8" }).split("\n").filter(Boolean)
  return { commits: log.length, fixes: log.filter((s) => /^fix(\(|!|:)/.test(s)).length }
}

const per1k = (r: Row, m: Metric) => (r.counts.lines ? (r.counts[m] * 1000) / r.counts.lines : 0)
const metrics = METRICS.map(([m]) => m)
const label = new Map<Metric, string>(METRICS)

if (args.includes("--json")) {
  const json = (r: Row) => ({ ...r, per1k: Object.fromEntries(metrics.map((m) => [m, +per1k(r, m).toFixed(2)])) })
  const out = { at: at ?? "worktree", total: json(total), fixes30d: fixShare(30),
    folders: Object.fromEntries([...folders].map(([k, r]) => [k, json(r)])) }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n")
} else {
  const shown = [...folders].filter(([, r]) => r.counts.lines >= 2000).sort((a, b) => b[1].counts.lines - a[1].counts.lines)
  const cols: [string, Row][] = [["all", total], ...shown]
  const pad = (s: string, n: number) => s.padStart(n)
  const head = ["per 1k lines".padEnd(40), ...cols.map(([k]) => pad(k.replace(/^plugins\//, "p/"), 9))].join("")
  const lines = [head]
  for (const m of metrics) lines.push([(label.get(m) ?? m).padEnd(40), ...cols.map(([, r]) => pad(per1k(r, m).toFixed(1), 9))].join(""))
  lines.push(["lines".padEnd(40), ...cols.map(([, r]) => pad(String(r.counts.lines), 9))].join(""))
  lines.push(["files over 1000 lines".padEnd(40), ...cols.map(([, r]) => pad(String(r.over1000), 9))].join(""))
  lines.push(["files over 2000 lines".padEnd(40), ...cols.map(([, r]) => pad(String(r.over2000), 9))].join(""))
  const fx = fixShare(30)
  lines.push(`\n${total.files} files at ${at ?? "the worktree"}; last 30 days: ${fx.fixes} of ${fx.commits} commits are fixes (${Math.round((fx.fixes * 100) / Math.max(1, fx.commits))}%)`)
  process.stdout.write(lines.join("\n") + "\n")
}
