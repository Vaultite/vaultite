// Browser evals: real Claude Code sessions (claude -p, the user's own login) doing the tasks of tasks.mjs on the made-up
// sites of sites.mjs, in a quiet desktop app (never seen: VAULTITE_QUIET) on a throwaway vault. Each run is timed and
// its tokens, tool calls and browser output counted, so two builds of the app (or two docs) can be compared.
//   node tools/browser-evals/run.mjs [--app <checkout>] [--models sonnet:medium,opus:low] [--tasks mail-find,billing]
//     [--reps 1] [--jobs 3] [--label baseline] [--out <dir>]
// Writes <out>/<label>.json (one row per run) and prints a table; compare runs with report.mjs.
// The sessions may only run vau and read-only shell tools (an allowlist): nothing else on this Mac.
import "../test/isolate.ts" // (first: a run of its own, kept off the user's vaults)
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { startSites, freshState } from "./sites.mjs"
import { TASKS } from "./tasks.mjs"

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const HERE = path.dirname(new URL(import.meta.url).pathname)
const APP = path.resolve(arg("app", path.join(HERE, "../..")))
const MODELS = { sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5", haiku: "claude-haiku-5-5" }
const CONFIGS = arg("models", "sonnet:medium").split(",").map((x) => { const [m, e] = x.split(":"); return { model: MODELS[m] ?? m, short: m, effort: e ?? "medium" } })
const TASK_IDS = arg("tasks", TASKS.map((t) => t.id).join(",")).split(",")
const REPS = Number(arg("reps", "1")), JOBS = Number(arg("jobs", "3"))
const LABEL = arg("label", "run"), OUT = path.resolve(arg("out", path.join(os.homedir(), ".local/share/vaultite-browser-evals")))
const CLAUDE_DIR = arg("claude-config", path.join(os.homedir(), ".claude"))
const TIMEOUT = Number(arg("timeout", "600")) * 1000
const ALLOWED = ["Bash(vau:*)", "Bash(grep:*)", "Bash(head:*)", "Bash(tail:*)", "Bash(sed:*)", "Bash(jq:*)", "Bash(cat:*)", "Bash(wc:*)", "Bash(sleep:*)", "Read"]
fs.mkdirSync(OUT, { recursive: true })

// ---------- the app, quiet, on a throwaway vault ----------
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-evals-"))
const VAULT = path.join(TMP, "vault")
await new Promise((ok, fail) => spawn(process.execPath, [path.join(APP, "bin/vau"), "sandbox", VAULT], { stdio: "ignore" }).on("exit", (c) => (c ? fail(new Error("sandbox")) : ok())))
const plugins = path.join(VAULT, ".vaultite/plugins.json")
const on = fs.existsSync(plugins) ? JSON.parse(fs.readFileSync(plugins, "utf8")) : { enabled: [], disabled: [] }
fs.writeFileSync(plugins, JSON.stringify({ ...on, enabled: [...new Set([...(on.enabled ?? []), "web-viewer", "terminal"])] }))
fs.writeFileSync(path.join(VAULT, "CLAUDE.md"), "@.vaultite/AGENTS.md\n")
const require = createRequire(path.join(APP, "package.json"))
const { _electron } = require("playwright-core")
const app = await _electron.launch({
  executablePath: path.join(APP, "node_modules/.bin/electron"), args: [APP, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
await win.waitForSelector("[role=tree]", { timeout: 90000 })
const ORIGIN = new URL(win.url()).origin
await new Promise((r) => setTimeout(r, 3000))
const api = async (method, p, body) => { const r = await fetch(`${ORIGIN}/api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return r.json().catch(() => ({})) }
const CONTEXT = (await api("GET", "terminals/instructions"))?.text ?? ""
const commit = await new Promise((ok) => { let s = ""; spawn("git", ["-C", APP, "rev-parse", "--short", "HEAD"]).stdout.on("data", (d) => (s += d)).on("end", () => ok(s.trim())) })
console.log(`app ${APP} @ ${commit}, server ${ORIGIN}, context ${CONTEXT.length} chars`)

// ---------- one session ----------
function session(task, cfg, rep) {
  return new Promise(async (done) => {
    const sites = await startSites(freshState())
    const t0 = Date.now()
    const args = ["-p", task.prompt(sites.url), "--model", cfg.model, "--effort", cfg.effort, "--output-format", "stream-json", "--verbose",
      "--allowedTools", ...ALLOWED, "--disallowedTools", "Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch", "Agent",
      "--append-system-prompt", CONTEXT, "--no-session-persistence"]
    // (the work login is ~/.claude, whose keychain entry is found only with no CLAUDE_CONFIG_DIR)
    const env = { ...process.env, CLAUDE_CONFIG_DIR: CLAUDE_DIR, VAULTITE_URL: ORIGIN, VAULTITE_VAULT: VAULT, VAULTITE_CLIENT: "desktop" }
    if (CLAUDE_DIR === path.join(os.homedir(), ".claude")) delete env.CLAUDE_CONFIG_DIR
    for (const k of Object.keys(env)) if (/^(VAULTITE_TERMINAL|CLAUDECODE|CLAUDE_CODE_ENTRYPOINT)$/.test(k)) delete env[k]
    const child = spawn("claude", args, { cwd: VAULT, env, stdio: ["ignore", "pipe", "pipe"] })
    const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT)
    let buf = "", err = ""
    const ev = []
    child.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { ev.push(JSON.parse(l)) } catch { /* not json */ } } })
    child.stderr.on("data", (d) => (err += d))
    child.on("exit", async (code) => {
      clearTimeout(timer)
      const state = JSON.parse(JSON.stringify(sites.state))
      sites.server.close()
      const result = ev.findLast((e) => e.type === "result") ?? {}
      const uses = new Map(), calls = []
      for (const e of ev) for (const b of e.message?.content ?? []) {
        if (b.type === "tool_use") uses.set(b.id, { name: b.name, input: b.input })
        if (b.type === "tool_result" && uses.has(b.tool_use_id)) {
          const u = uses.get(b.tool_use_id), text = Array.isArray(b.content) ? b.content.map((x) => x.text ?? "").join("") : String(b.content ?? "")
          const cmd = u.name === "Bash" ? String(u.input.command ?? "") : ""
          const browser = /vau browser|browser_/.test(cmd) || /browser_/.test(u.name)
          calls.push({ tool: u.name, browser, sub: browser ? [...new Set([...cmd.matchAll(/vau browser ([a-z]+)/g)].map((m) => m[1]))].join("+") || u.name : "", chars: text.length,
            error: !!b.is_error, cmd: cmd.slice(0, 400), out: text.slice(0, 600) })
        }
      }
      const answer = String(result.result ?? "")
      let ok = false
      try { ok = !!task.check(answer, state) } catch { ok = false }
      const u = result.usage ?? {}
      const row = { label: LABEL, commit, task: task.id, model: cfg.short, effort: cfg.effort, rep, ok, answer: answer.slice(0, 2000), exit: code,
        seconds: (Date.now() - t0) / 1000, apiSeconds: (result.duration_api_ms ?? 0) / 1000, turns: result.num_turns ?? 0, cost: result.total_cost_usd ?? 0,
        input: u.input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, output: u.output_tokens ?? 0,
        toolCalls: calls.length, browserCalls: calls.filter((c) => c.browser).length, browserChars: calls.filter((c) => c.browser).reduce((s, c) => s + c.chars, 0),
        errors: calls.filter((c) => c.error).length, subs: calls.filter((c) => c.browser).map((c) => c.sub), calls, stderr: err.slice(-1000) }
      // (the agent's tabs, if it left them open)
      try { for (const t of (await api("POST", "ops/web-viewer.tabs", {}))?.result ?? []) if (t.by) await api("POST", "ops/web-viewer.close", { tab: t.tab }) } catch { /* fine */ }
      done(row)
    })
  })
}

// ---------- the matrix ----------
const jobs = []
for (let rep = 0; rep < REPS; rep++) for (const cfg of CONFIGS) for (const id of TASK_IDS) { const t = TASKS.find((x) => x.id === id); if (t) jobs.push([t, cfg, rep]) }
const rows = []
const file = path.join(OUT, `${LABEL}.json`)
let next = 0
await Promise.all(Array.from({ length: Math.min(JOBS, jobs.length) }, async () => {
  while (next < jobs.length) {
    const [t, cfg, rep] = jobs[next++]
    const row = await session(t, cfg, rep)
    rows.push(row)
    fs.writeFileSync(file, JSON.stringify(rows, null, 1))
    console.log(`${row.ok ? "ok  " : "FAIL"} ${t.id.padEnd(15)} ${cfg.short}:${cfg.effort.padEnd(6)} ${row.seconds.toFixed(0).padStart(4)}s turns ${String(row.turns).padStart(3)} browser ${String(row.browserCalls).padStart(3)} calls ${String(row.browserChars).padStart(7)} chars  out ${row.output} tok  $${row.cost.toFixed(3)}  ${row.ok ? "" : row.answer.slice(0, 80).replace(/\n/g, " ")}`)
  }
}))
await app.close().catch(() => {})
fs.rmSync(TMP, { recursive: true, force: true })
console.log(`wrote ${file}`)
