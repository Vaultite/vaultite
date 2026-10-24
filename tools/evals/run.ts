// Agent evals: can an agent use the vault through its tools? On a sandbox vault, never a real one.
//   node tools/evals/run.ts [--live]   scripted MCP calls in-process; --live: `claude -p` on haiku (a few cents)
import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { parse as parseYaml } from "yaml"
import { type Any, check, section, skip, stopTerminals, summary, testServer, waitFor } from "../test/lib.ts"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const LIVE = process.argv.includes("--live")
const MODEL = process.env.VAULTITE_EVAL_MODEL || "haiku"
const t0 = Date.now()
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-evals-"))
const VAULT = path.join(tmp, "vault")
const S = await import("../../core/sandbox.ts")
const TODAY = S.localToday()
S.makeSandbox(VAULT, TODAY)
fs.writeFileSync(path.join(VAULT, "People", "Alice Park.md"), "---\ntype: person\nrelation: friend\n---\n\nLikes hiking.\n")

/** A vault file's frontmatter and body. */
function note(rel: string): { fm: Any; body: string } | null {
  try {
    const text = fs.readFileSync(path.join(VAULT, rel), "utf8")
    const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
    return m ? { fm: parseYaml(m[1]) ?? {}, body: m[2] } : { fm: {}, body: text }
  } catch { return null }
}
/** Every Markdown file the user sees (not .vaultite/), with its hash. */
function files(): Map<string, string> {
  const out = new Map<string, string>()
  for (const f of fs.readdirSync(VAULT, { recursive: true }) as string[]) {
    if (f.startsWith(".") || !f.endsWith(".md")) continue
    out.set(f, crypto.createHash("sha1").update(fs.readFileSync(path.join(VAULT, f))).digest("hex"))
  }
  return out
}
const changedSince = (before: Map<string, string>) => [...files()].filter(([f, h]) => before.get(f) !== h).map(([f]) => f)

type Call = (tool: string, args: Record<string, unknown>) => Promise<{ error: boolean; text: string }>
type Task = { name: string; prompt: string; script: (call: Call) => Promise<string>; grade: (answer: string, changed: string[]) => [string, boolean, unknown][] }

/** What a user asks an agent, the calls an agent would make for it, and what the vault must then hold. */
const TASKS: Task[] = [
  {
    name: "log a run",
    prompt: "I just went for a 32 minute run, 5.2 km. Log it in my vault.",
    script: async (call) => (await call("write_log", { area: "workouts", title: "Morning run", duration_min: 32, data: { distance_km: 5.2 } })).text,
    grade: (_, changed) => {
      const f = changed.find((c) => note(c)?.fm.type === "log")
      const n = f ? note(f) : null
      return [["one log file, in the workouts area, dated today", n?.fm.area === "workouts" && String(n?.fm.date) === TODAY && changed.length === 1, { changed, fm: n?.fm }],
        ["its 32 minutes and 5.2 km kept", JSON.stringify(n ?? "").includes("32") && JSON.stringify(n ?? "").includes("5.2"), n]]
    },
  },
  {
    name: "remember a fact",
    prompt: "Remember this about Alice Park: she is allergic to peanuts.",
    script: async (call) => {
      await call("search", { query: "Alice Park" })
      return (await call("remember", { fact: "Allergic to peanuts.", about: "Alice Park" })).text
    },
    grade: (_, changed) => [["in her file (People/Alice Park.md), only there", /peanut/i.test(note("People/Alice Park.md")?.body ?? "") && changed.join() === "People/Alice Park.md",
      { changed, body: note("People/Alice Park.md")?.body }],
      ["what was there kept", (note("People/Alice Park.md")?.body ?? "").includes("Likes hiking."), note("People/Alice Park.md")?.body]],
  },
  {
    name: "add to the inbox",
    prompt: "Put a short summary in my inbox for later, titled 'Lighthouse launch summary': the launch is on Friday, the venue is booked and the flyers are printed.",
    script: async (call) => (await call("inbox_add", { title: "Lighthouse launch summary", tldr: "The launch is on Friday; the venue is booked and the flyers are printed.",
      body: "- Launch: Friday\n- Venue: booked\n- Flyers: printed\n" })).text,
    grade: (_, changed) => {
      const f = changed.find((c) => c.startsWith("Inbox/"))
      const n = f ? note(f) : null
      return [["one item in Inbox/, marked new", n?.fm.type === "inbox" && n.fm.status === "new" && changed.length === 1, { changed, fm: n?.fm }],
        ["it says Friday", /friday/i.test(JSON.stringify(n ?? "")), n]]
    },
  },
  {
    name: "read a page",
    prompt: "What's on my People page? Read it and tell me in two lines; don't change anything.",
    script: async (call) => (await call("render", { path: "Dashboards/People.md" })).text,
    grade: (answer, changed) => [["an answer", answer.trim().length > 20, answer.slice(0, 300)], ["nothing written", !changed.length, changed]],
  },
]

async function deterministic() {
  process.env.VAULTITE_VAULT = VAULT
  process.env.VAULTITE_LOCAL = path.join(tmp, "local")
  const { open } = await import("../../core/app.ts")
  const app = await open(VAULT, { start: false })
  const catalog = app.catalog()

  await section("docs: every op", () => {
    const bad = (pred: (e: Any) => unknown) => catalog.filter(pred).map((e) => e.id)
    let n = bad((e) => !e.summary.trim() || e.summary.includes("\n"))
    check(`a one-line summary (${catalog.length} ops)`, !n.length, n)
    n = catalog.flatMap((e) => Object.entries(e.params.properties ?? {}).filter(([, p]: Any) => (p.description ?? "").trim().split(/\s+/).length < 2).map(([k]) => `${e.id} ${k}`))
    check("each parameter described in words", !n.length, n)
    n = bad((e) => (e.params.required ?? []).some((r: string) => !e.params.properties?.[r]))
    check("its required parameters are its own", !n.length, n)
    n = bad((e) => /\b(for example|e\.g\.|example:)/i.test(e.help) && !/`[^`]+`|\n {2}vau /.test(e.help))
    check("one that says it has an example shows it", !n.length, n)
    n = bad((e) => e.mcp && !e.help)
    if (n.length) skip(`MCP tools with only a summary: ${n.join(", ")}`, "a note, not a failure")
    const long = bad((e) => e.summary.length > 120)
    if (long.length) skip(`summaries over 120 characters: ${long.length}`, long.join(", "))
  })

  // The MCP tools in-process, as the plugin serves them (plugins/core/mcp/plugin.ts).
  const { handle } = await import("../../plugins/core/mcp/protocol.ts")
  const { toolsOf } = await import("../../plugins/core/mcp/catalog.ts")
  const server = {
    version: "0.0.0",
    instructions: async () => (await app.callOp("mcp.instructions", {}, { client: "mcp" } as Any)).text,
    tools: () => toolsOf(app.catalog()),
    ctx: (client: Any) => ({ client, op: async (id: string, p: Any) => (await app.callOp(id, p, { ...client, client: "mcp" })).text }),
  }
  const session: Any = { client: null }
  let id = 0
  const rpc = (method: string, params?: unknown) => handle({ jsonrpc: "2.0", id: ++id, method, params }, session, server) as Promise<Any>
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2" } })
  const tools = new Set(((await rpc("tools/list")).result.tools as Any[]).map((t) => t.name))
  for (const task of TASKS) {
    await section(`scripted: ${task.name}`, async () => {
      const before = files(), calls: string[] = []
      const call: Call = async (name, args) => {
        calls.push(name)
        if (!tools.has(name)) return { error: true, text: `no tool ${name}` }
        const r = await rpc("tools/call", { name, arguments: args })
        return { error: r.result?.isError === true, text: String(r.result?.content?.[0]?.text ?? r.error?.message ?? "") }
      }
      const answer = await task.script(call)
      await app.vault.sync()
      for (const [name, ok, got] of task.grade(answer, changedSince(before))) check(`${task.name}: ${name}`, ok, got)
    })
  }
}

const freePort = () => new Promise<number>((resolve) => {
  const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)) })
})

/** One run of `claude -p`: its answer, the tools it called and how many failed. */
function claude(prompt: string, config: string, cwd: string) {
  const r = spawnSync("claude", ["-p", prompt, "--model", MODEL, "--output-format", "stream-json", "--verbose", "--strict-mcp-config",
    "--mcp-config", config, "--tools", "", "--allowedTools", "mcp__vaultite", "--max-turns", "10"], { cwd, encoding: "utf8", timeout: 240_000, maxBuffer: 64 << 20 })
  const events = r.stdout.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } })
  const content = (type: string) => events.filter((e) => e.type === type).flatMap((e) => e.message?.content ?? [])
  const used = content("assistant").filter((c: Any) => c.type === "tool_use")
  const uses = used.map((c: Any) => String(c.name).replace(/^mcp__vaultite__/, ""))
  const failed = content("user").filter((c: Any) => c.type === "tool_result" && c.is_error)
    .map((c: Any) => `${uses[used.findIndex((u: Any) => u.id === c.tool_use_id)] ?? "?"}: ${JSON.stringify(c.content).slice(0, 200)}`)
  const result = events.find((e) => e.type === "result")
  return { answer: String(result?.result ?? ""), uses, failed, cost: Number(result?.total_cost_usd ?? 0), error: r.status ? (r.stderr || r.stdout).slice(-500) : "" }
}

async function live() {
  if (spawnSync("claude", ["--version"]).status !== 0) return skip("live", "no claude on PATH")
  // A sandbox of its own, served, its MCP tools through `vau mcp` as an agent runs them.
  const port = await freePort(), base = `http://127.0.0.1:${port}`
  const server = testServer({ stdio: "ignore",
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: path.join(tmp, "live-local") } })
  try {
    if (!await waitFor(async () => (await fetch(`${base}/api/state`)).ok, 60_000)) return check("live: the sandbox server starts", false)
    const config = path.join(tmp, "mcp.json")
    fs.writeFileSync(config, JSON.stringify({ mcpServers: { vaultite: { command: process.execPath, args: [path.join(ROOT, "bin", "vau"), "mcp"], env: { VAULTITE_URL: base } } } }))
    let cost = 0
    for (const task of TASKS) {
      await section(`live (${MODEL}): ${task.name}`, async () => {
        const before = files()
        const r = claude(task.prompt, config, tmp)
        cost += r.cost
        await new Promise((ok) => setTimeout(ok, 1500)) // (the server sees its own writes at once; a moment for the files)
        console.log(`  tools: ${r.uses.join(", ") || "none"}; ${r.failed.length} failed; $${r.cost.toFixed(4)}`)
        check(`${task.name}: claude ran`, !r.error, r.error)
        check(`${task.name}: no tool call failed (${r.uses.length} calls)`, !r.failed.length, r.failed)
        for (const [name, ok, got] of task.grade(r.answer, changedSince(before))) check(`${task.name}: ${name}`, ok, got)
      })
    }
    console.log(`\nlive: $${cost.toFixed(4)} in all`)
  } finally {
    server.kill()
    stopTerminals(port)
  }
}

if (LIVE) await live(); else await deterministic()
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(summary(LIVE ? "evals-live" : "evals", t0))
