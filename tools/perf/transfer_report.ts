// transfer.ts' result as CI's Markdown table, against ceilings (transfer.json). Its input may be a fork's: read as data.
// node tools/perf/transfer_report.ts <transfer.json> [--ceilings f] [--out report.md] [--check] [--ratchet] [--ci <status>] [--repo o/n]
import fs from "node:fs"
import path from "node:path"

export const FLOWS: Record<string, string> = {
  "cold": "Cold load (computer)", "warm": "Reload", "open": "Open a note", "switch": "Switch notes", "search": "Search",
  "today": "Today's note", "rich": "Note with embeds", "terminal": "Terminal output", "idle": "Idle, per minute",
  "phone-cold": "Phone: cold start", "phone-resume": "Phone: back from the background", "phone-reopen": "Phone: opened after a change",
  "update": "Phone: start after a deploy",
}
/** Metrics with a ceiling, and the room a ceiling leaves over what it was set from (--ratchet). */
const METRICS = {
  wire: { name: "Wire", room: (v: number, flow: string) => Math.ceil((v * (flow === "idle" || flow === "phone-resume" ? 1.5 : 1.08) + 2048) / 1024) * 1024 },
  requests: { name: "Requests", room: (v: number) => v + 3 },
  serial: { name: "Round trips in a row", room: (v: number) => v + 1 },
} as const
type Metric = keyof typeof METRICS
/** Which flows' requests and round trips are worth a row (the rest are a request or two). */
const LATENCY_FLOWS = new Set(["cold", "warm", "open", "today", "phone-cold", "phone-resume", "phone-reopen", "update"])
const KINDS = ["js", "css", "api", "html", "media", "other", "socket"] as const
type Measure = { wire: number; down: number; up: number; requests: number; api: number; serial: number; socketMsgs: number; ms: number
  sent: Record<(typeof KINDS)[number], number>; decoded: Record<(typeof KINDS)[number], number> }
type Side = { commit: string; flows: Record<string, Measure> }
export type Ceilings = { profile: string; flows: Record<string, Partial<Record<Metric, number>>> }

// ---- reading the result, as untrusted data

const fail = (why: string): never => { throw new Error(`transfer result: ${why}`) }
const num = (x: unknown, at: string) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x < 1e11 ? x : fail(`${at} isn't a count`))
function measureOf(x: unknown, at: string): Measure {
  if (!x || typeof x !== "object") fail(`${at} isn't an object`)
  const o = x as Record<string, unknown>
  const kinds = (k: unknown, a: string) => {
    if (!k || typeof k !== "object") fail(`${a} isn't an object`)
    return Object.fromEntries(KINDS.map((n) => [n, num((k as Record<string, unknown>)[n], `${a}.${n}`)])) as Measure["sent"]
  }
  return { wire: num(o.wire, `${at}.wire`), down: num(o.down, `${at}.down`), up: num(o.up, `${at}.up`), requests: num(o.requests, `${at}.requests`),
    api: num(o.api, `${at}.api`), serial: num(o.serial, `${at}.serial`), socketMsgs: num(o.socketMsgs, `${at}.socketMsgs`), ms: num(o.ms, `${at}.ms`),
    sent: kinds(o.sent, `${at}.sent`), decoded: kinds(o.decoded, `${at}.decoded`) }
}
export function read(text: string, profile: string) {
  if (text.length > 1 << 20) fail("too big")
  const r = JSON.parse(text) as Record<string, unknown>
  if (r?.version !== 1) fail("not version 1")
  const p = (r.profiles as Record<string, Record<string, unknown>> | undefined)?.[profile] ?? fail(`no ${profile} profile`)
  const prof = { rttMs: num(p.rttMs, "rttMs"), downKbps: num(p.downKbps, "downKbps"), upKbps: num(p.upKbps, "upKbps") }
  const results = Array.isArray(r.results) && r.results.length >= 1 && r.results.length <= 2 ? r.results as Record<string, unknown>[] : fail("results aren't one or two")
  const side = (x: Record<string, unknown>, i: number): Side => {
    const commit = typeof x?.commit === "string" && /^[0-9a-f]{7,40}$/.test(x.commit) ? x.commit : fail(`results[${i}].commit isn't a commit`)
    const flows = (x.profiles as Record<string, Record<string, unknown>> | undefined)?.[profile] ?? fail(`results[${i}] has no ${profile}`)
    const out: Record<string, Measure> = {}
    for (const [f, m] of Object.entries(flows)) if (f in FLOWS) out[f] = measureOf(m, `results[${i}].${f}`)
    return { commit, flows: out }
  }
  return { runs: num(r.runs, "runs"), idleS: num(r.idleS, "idleS"), prof, base: results.length === 2 ? side(results[0], 0) : null, head: side(results.at(-1)!, results.length - 1) }
}

// ---- the Markdown

const kib = (n: number) => (Math.abs(n) >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MiB` : Math.abs(n) >= 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${Math.round(n)} B`)
const fmt = (m: Metric, n: number) => (m === "wire" ? kib(n) : String(Math.round(n)))
function impact(m: Metric, base: number | undefined, head: number) {
  if (base === undefined) return "–"
  const d = head - base, pct = base ? (d / base) * 100 : 0
  const sign = d > 0 ? "+" : d < 0 ? "−" : ""
  return `${sign}${fmt(m, Math.abs(d))} (${sign}${Math.abs(pct).toFixed(1)}%)`
}

export function render(data: ReturnType<typeof read>, ceilings: Ceilings | null, opts: { ci?: string; repo?: string } = {}) {
  const { base, head, prof } = data
  const rows: string[] = [], over: string[] = []
  for (const [flow, label] of Object.entries(FLOWS)) {
    const h = head.flows[flow]
    if (!h) continue
    for (const m of Object.keys(METRICS) as Metric[]) {
      if (m !== "wire" && !LATENCY_FLOWS.has(flow)) continue
      // (main's own "deploy" is a reload into the same build: no baseline for it)
      const b = flow === "update" ? undefined : base?.flows[flow]?.[m], v = h[m], cap = ceilings?.flows[flow]?.[m]
      const ok = cap === undefined || v <= cap
      if (!ok) over.push(`${label}: ${METRICS[m].name.toLowerCase()}`)
      rows.push(`| ${label} | ${METRICS[m].name} | ${b === undefined ? "–" : fmt(m, b)} | ${fmt(m, v)} | ${impact(m, b, v)} | ${cap === undefined ? "–" : fmt(m, cap)} | ${cap === undefined ? "" : ok ? "✅" : "❌"} |`)
    }
  }
  const short = (c: string) => opts.repo ? `[\`${c.slice(0, 9)}\`](https://github.com/${opts.repo}/commit/${c})` : `\`${c.slice(0, 9)}\``
  const times = Object.entries(FLOWS).filter(([f]) => head.flows[f] && f !== "idle" && f !== "switch").map(([f, label]) => {
    const b = f === "update" ? undefined : base?.flows[f]?.ms, v = head.flows[f].ms
    return `| ${label} | ${b === undefined ? "–" : `${b} ms`} | ${v} ms | ${b === undefined ? "–" : `${v - b > 0 ? "+" : v - b < 0 ? "−" : ""}${Math.abs(v - b)} ms`} |`
  })
  const kinds = ["cold", "phone-cold", "update"].filter((f) => head.flows[f]).map((f) => {
    const cell = (k: (typeof KINDS)[number]) => `${base?.flows[f] && f !== "update" ? `${kib(base.flows[f].sent[k])} → ` : ""}${kib(head.flows[f].sent[k])}`
    return `| ${FLOWS[f]} | ${cell("js")} | ${cell("css")} | ${cell("api")} | ${cell("socket")} | ${kib(Object.values(head.flows[f].decoded).reduce((a, x) => a + x, 0))} |`
  })
  return [
    "## Transfer impact",
    "",
    over.length ? `❌ Over its ceiling: ${over.join(", ")}.` : "✅ Transfer stays within every ceiling.",
    "",
    "| Flow | Metric | Main | This commit | Impact | Ceiling | |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ...rows,
    "",
    `Baseline: ${base ? short(base.commit) : "none"} · This commit: ${short(head.commit)}${opts.ci ? ` · CI: ${opts.ci.replace(/[^\w ]/g, "")}` : ""}`,
    "",
    "<details><summary>Scenario, time to usable and bytes by kind</summary>",
    "",
    `A made-up vault (tools/perf/vault.ts) on a throwaway server, in headless Chromium through an emulated network: ${prof.rttMs} ms round trips, ` +
      `${prof.downKbps / 1000} Mbit/s down and ${prof.upKbps / 1000} up, HTTP/2 over TLS through a proxy as Tailscale Serve is. Medians of ${data.runs} runs, ` +
      `main and this commit taking turns on one machine. Wire is both ways, TLS and headers included. Idle is ${data.idleS} s scaled to a minute. ` +
      "A start after a deploy is a phone holding main's build reloading into this commit's.",
    "",
    "| Flow | Main | This commit | Impact |",
    "| --- | ---: | ---: | ---: |",
    ...times,
    "",
    "| Flow (sent, compressed) | JS | CSS | API | Socket | Decoded |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...kinds,
    "",
    "</details>",
    "",
  ].join("\n")
}

/** Ceilings from this result, each with its room (--ratchet: only ever lowered, a new flow's added). */
export function ratchet(data: ReturnType<typeof read>, was: Ceilings | null, profile: string): Ceilings {
  const flows: Ceilings["flows"] = {}
  for (const [flow, h] of Object.entries(data.head.flows)) {
    for (const m of Object.keys(METRICS) as Metric[]) {
      if (m !== "wire" && !LATENCY_FLOWS.has(flow)) continue
      const now = METRICS[m].room(h[m], flow), before = was?.flows[flow]?.[m]
      ;(flows[flow] ??= {})[m] = before === undefined ? now : Math.min(before, now)
    }
  }
  return { profile, flows }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
  const input = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && !["--check", "--ratchet"].includes(args[i - 1])))
  if (!input) { console.error("usage: node tools/perf/transfer_report.ts <transfer.json> [--ceilings f] [--out f] [--check] [--ratchet]"); process.exit(2) }
  const ceilingsAt = arg("ceilings") ?? path.join(import.meta.dirname, "transfer.json")
  let ceilings = fs.existsSync(ceilingsAt) ? JSON.parse(fs.readFileSync(ceilingsAt, "utf8")) as Ceilings : null
  const profile = ceilings?.profile ?? "cellular"
  const data = read(fs.readFileSync(input, "utf8"), profile)
  if (args.includes("--ratchet")) {
    ceilings = ratchet(data, ceilings, profile)
    fs.writeFileSync(ceilingsAt, JSON.stringify(ceilings, null, 2) + "\n")
    console.error(`${ceilingsAt}: ceilings set (commit it)`)
  }
  const md = render(data, ceilings, { ci: arg("ci"), repo: arg("repo") })
  const out = arg("out")
  if (out) fs.writeFileSync(out, md)
  else console.log(md)
  if (args.includes("--check") && md.includes("❌ Over its ceiling")) process.exit(1)
}
