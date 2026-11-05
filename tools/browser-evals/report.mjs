// Compare eval runs (run.mjs's <label>.json): per task and per model, how often they worked, how long they took, their
// turns, browser calls, browser output and tokens, the later labels against the first.
//   node tools/browser-evals/report.mjs baseline candidate [--out <dir>] [--md]
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const argv = process.argv.slice(2)
const flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv.splice(i, 2)[1] : undefined }
const OUT = path.resolve(flag("out") ?? path.join(os.homedir(), ".local/share/vaultite-browser-evals"))
const MD = argv.includes("--md") ? (argv.splice(argv.indexOf("--md"), 1), true) : false
const labels = argv
const runs = Object.fromEntries(labels.map((l) => [l, JSON.parse(fs.readFileSync(path.join(OUT, `${l}.json`), "utf8"))]))

const tokens = (r) => r.input + r.cacheRead + r.cacheWrite + r.output
const METRICS = [["ok", (rs) => rs.filter((r) => r.ok).length / rs.length, (v) => `${Math.round(v * 100)}%`],
  ["seconds", (rs) => avg(rs.map((r) => r.seconds)), (v) => v.toFixed(0)],
  ["turns", (rs) => avg(rs.map((r) => r.turns)), (v) => v.toFixed(1)],
  ["browser calls", (rs) => avg(rs.map((r) => r.browserCalls)), (v) => v.toFixed(1)],
  ["browser chars", (rs) => avg(rs.map((r) => r.browserChars)), (v) => Math.round(v).toLocaleString()],
  ["tokens (in+cache+out)", (rs) => avg(rs.map(tokens)), (v) => `${Math.round(v / 1000)}k`],
  ["output tokens", (rs) => avg(rs.map((r) => r.output)), (v) => Math.round(v).toLocaleString()],
  ["cost $", (rs) => avg(rs.map((r) => r.cost)), (v) => v.toFixed(3)]]
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const pct = (a, b) => (a ? `${b >= a ? "+" : ""}${Math.round(((b - a) / a) * 100)}%` : "")

function table(title, groupOf) {
  const keys = [...new Set(Object.values(runs).flat().map(groupOf))].sort()
  const rows = []
  for (const k of keys) {
    for (const [name, fn, fmt] of METRICS) {
      const vals = labels.map((l) => { const rs = runs[l].filter((r) => groupOf(r) === k); return rs.length ? fn(rs) : null })
      rows.push([k, name, ...vals.map((v, i) => (v === null ? "" : `${fmt(v)}${i && vals[0] !== null && name !== "ok" ? ` (${pct(vals[0], v)})` : ""}`))])
    }
  }
  const head = [title, "metric", ...labels]
  if (MD) return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n")
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)))
  return [head, ...rows].map((r) => r.map((c, i) => String(c).padEnd(w[i])).join("  ")).join("\n")
}

console.log(table("all", () => "all"))
console.log()
console.log(table("model", (r) => `${r.model}:${r.effort}`))
console.log()
console.log(table("task", (r) => r.task))
const failed = Object.values(runs).flat().filter((r) => !r.ok)
if (failed.length) console.log(`\nFailed:\n${failed.map((r) => `${r.label} ${r.task} ${r.model}:${r.effort}: ${r.answer.slice(0, 160).replace(/\n/g, " ")}`).join("\n")}`)
