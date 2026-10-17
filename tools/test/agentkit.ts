// Coding agents on a real server, for the end-to-end agent tests (tools/test_agents_linux.ts, and Vaultite/plugins'
// for its agents): a sandbox vault, the server in a minimal environment, terminals, fake agents, MCP over stdio.
import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse as parseYaml } from "yaml"
import { type Any, check, sleep, waitFor } from "./lib.ts"

export const REPO = path.resolve(import.meta.dirname, "..", "..")
export const PORT = Number(process.env.VAULTITE_TEST_PORT || 8911)
export const BASE = `http://127.0.0.1:${PORT}`
export const LIVE = process.env.VAULTITE_AGENT_LIVE === "1"
export const MODEL = process.env.VAULTITE_AGENT_MODEL || "openai/gpt-6-luna"
export const REAL_HOME = os.homedir()
export const LINUX = process.platform === "linux"
export const rand = (n = 8) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("")
const MARK = rand(12) // in the server's environment, so every process it starts can be found (and none left behind)

// No spaces in the root (fake agents' command lines are split on spaces, as real ones in ~/.local/bin never need);
// the vault and a project folder have spaces and accents, as a user's may.
export const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vt-agents-")))
export const VAULT = path.join(TMP, "Vault de teste ü")
export const LOCAL = path.join(TMP, "local")
export const HOME = path.join(TMP, "home")
export const BIN = path.join(TMP, "bin")
export const PROJECT = path.join(TMP, "Projets é", "lighthouse x")
const FAKE_LOG = path.join(TMP, "fake.log")
for (const d of [LOCAL, HOME, BIN, PROJECT]) fs.mkdirSync(d, { recursive: true })

// ---------- the server

export async function api(method: string, route: string, body?: unknown): Promise<[number, Any]> {
  const res = await fetch(`${BASE}/api/${route}`, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) })
  const text = await res.text()
  try { return [res.status, JSON.parse(text)] } catch { return [res.status, text] }
}
export const get = async (route: string) => { const [c, b] = await api("GET", route); if (c !== 200) throw new Error(`${route}: ${c} ${JSON.stringify(b).slice(0, 300)}`); return b }

let server: ChildProcess | null = null
/** The server's environment (baseEnv's), which the agents it starts get too. */
export let serverEnv: Record<string, string> = {}
const portOpen = () => fetch(`${BASE}/api/version`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)

export async function startServer() {
  const log = fs.openSync(path.join(TMP, "server.log"), "a")
  server = spawn(process.execPath, [path.join(REPO, "server.ts")], { cwd: REPO, env: serverEnv, stdio: ["ignore", log, log], detached: true })
  const up = await waitFor(async () => (await api("GET", "vault"))[0] === 200, 60000)
  if (!up) throw new Error(`the server didn't start on ${PORT}: ${fs.readFileSync(path.join(TMP, "server.log"), "utf8").slice(-2000)}`)
}
export const serverLog = () => fs.readFileSync(path.join(TMP, "server.log"), "utf8")

export async function stopServer() {
  if (!server) return
  const s = server
  server = null
  if (s.exitCode === null) {
    const gone = new Promise((r) => s.once("exit", r))
    s.kill("SIGTERM")
    await Promise.race([gone, sleep(8000)])
    if (s.exitCode === null && s.signalCode === null) s.kill("SIGKILL")
  }
  await waitFor(async () => !(await portOpen()), 10000, 200)
}

/** The keeper and tmux server this port's terminals run in (they outlive the server on purpose). */
export function stopBackends() {
  // (core/runtime.ts: $TMPDIR on a Mac; Linux's $XDG_RUNTIME_DIR/vaultite, else /tmp/vaultite-<uid> as in a bare env)
  for (const dir of [os.tmpdir(), process.env.XDG_RUNTIME_DIR && path.join(process.env.XDG_RUNTIME_DIR, "vaultite"), `/tmp/vaultite-${process.getuid?.()}`]) {
    if (!dir) continue
    try { process.kill(Number(fs.readFileSync(path.join(dir, `vaultite-ptyd1-vaultite-${PORT}.sock.pid`), "utf8").trim()), "SIGTERM") } catch { /* none */ }
  }
  try { execFileSync("tmux", ["-L", `vaultite-${PORT}`, "kill-server"], { stdio: "ignore" }) } catch { /* none */ }
}

// ---------- processes (each one's environment: VAULTITE_TERMINAL names its terminal, MARK this run)

function processesWith(...needles: string[]): { pid: number; cmd: string }[] {
  const out: { pid: number; cmd: string }[] = []
  if (LINUX) {
    for (const d of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(d)) continue
      try {
        const env = fs.readFileSync(`/proc/${d}/environ`, "utf8").split("\0")
        if (needles.every((n) => env.includes(n))) out.push({ pid: Number(d), cmd: fs.readFileSync(`/proc/${d}/cmdline`, "utf8").replaceAll("\0", " ").trim() })
      } catch { /* gone, or another user's */ }
    }
    return out
  }
  // macOS: ps shows the environment after the command line (E), for this user's processes.
  const text = execFileSync("ps", ["-AwwE", "-o", "pid=,command="], { encoding: "utf8", maxBuffer: 64 << 20 })
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line)
    // (tmux's server has a session's variables among its arguments, not its environment)
    if (m && needles.every((n) => m[2].includes(` ${n}`)) && !/\btmux .*new-session/.test(m[2])) out.push({ pid: Number(m[1]), cmd: m[2].slice(0, 200) })
  }
  return out
}
const inTerminal = (id: string) => processesWith(`VT_AGENT_MARK=${MARK}`, `VAULTITE_TERMINAL=${id}`)

// ---------- terminals

export const term = {
  start: (id: string, prompt?: string) => api("POST", `terminals/${encodeURIComponent(id)}`, prompt ? { prompt } : {}),
  screen: async (id: string, lines = 300) => {
    const [c, b] = await api("GET", `terminals/${encodeURIComponent(id)}/screen?lines=${lines}`)
    return c === 200 ? (b.lines as string[]).join("\n") : ""
  },
  send: (id: string, text: string, enter = true) => api("POST", `terminals/${encodeURIComponent(id)}/send`, { text, enter }),
  end: (id: string) => api("DELETE", `terminals/${encodeURIComponent(id)}`),
  list: async (): Promise<Any[]> => (await get("terminals/sessions")).sessions,
  one: async (id: string) => (await term.list()).find((s) => s.id === id),
}
export const screenHas = (id: string, re: RegExp, ms = 20000) => waitFor(async () => { const s = await term.screen(id); return re.test(s) ? s : null }, ms)

/** Ends a terminal and checks it's gone, with nothing it started still running. */
export async function endAndCheck(label: string, id: string) {
  const before = inTerminal(id)
  const [c] = await term.end(id)
  const gone = await waitFor(async () => !(await term.one(id)), 10000)
  // (an agent may finish its own work first on a hangup: Hermes saves its session; 30 s at most)
  const t0 = Date.now()
  const left = (await waitFor(() => inTerminal(id).length === 0, 30000, 250)) ? [] : inTerminal(id)
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  check(`${label}: ending its terminal ends it, no process of it left (${before.length} were running, gone in ${secs} s)`, c === 200 && gone && !left.length, { c, gone, left })
  for (const p of left) try { process.kill(p.pid, "SIGKILL") } catch { /* gone */ }
}

/** A session the plugin lists as open now, linked to terminal `id`. */
export async function liveIn(agent: string, id: string, ms = 30000): Promise<Any | null> {
  return waitFor(async () => (await get(`${agent}?days=1`)).live.find((s: Any) => s.terminal === id) ?? null, ms, 1000)
}

// ---------- files the agents wrote

function frontmatter(file: string): { fm: Any; body: string } {
  const text = fs.readFileSync(file, "utf8")
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  return m ? { fm: parseYaml(m[1]) ?? {}, body: m[2] } : { fm: {}, body: text }
}
export function findFile(dir: string, re: RegExp): string | null {
  try {
    for (const f of fs.readdirSync(path.join(VAULT, dir), { recursive: true }) as string[]) if (re.test(path.basename(f))) return path.join(VAULT, dir, f)
  } catch { /* no folder */ }
  return null
}
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** What an agent wrote through write_note, write_log and inbox_add, each where it belongs with its frontmatter. */
export function checkWrites(label: string, tok: string, source: string | null, code: string | null) {
  const note = findFile("Notes", new RegExp(`${esc(tok)}.*\\.md$`))
  const n = note ? frontmatter(note) : null
  check(`${label}: write_note made Notes/<title>.md, a note${source ? ` by ${source}` : ""}${code ? " with what it read" : ""}`,
    n && n.fm.type === "note" && (!source || n.fm.source === source) && (!code || n.body.includes(code)), note ? { file: path.relative(VAULT, note), fm: n?.fm, body: n?.body.slice(0, 200) } : "no note")
  const log = findFile("Logs", new RegExp(`${esc(tok)}.*\\.md$`))
  const l = log ? frontmatter(log) : null
  check(`${label}: write_log made Logs/Workouts/<date> <title>.md, a workouts log dated today`,
    l && l.fm.type === "log" && l.fm.area === "workouts" && String(l.fm.date) === today() && path.relative(VAULT, log!).startsWith("Logs/Workouts/") &&
      path.basename(log!).startsWith(today()), log ? { file: path.relative(VAULT, log), fm: l?.fm } : "no log")
  const inbox = findFile("Inbox", new RegExp(`${esc(tok)}.*\\.md$`))
  const i = inbox ? frontmatter(inbox) : null
  check(`${label}: inbox_add made Inbox/<title>.md, marked new`, i && i.fm.type === "inbox" && i.fm.status === "new" && path.dirname(inbox!) === path.join(VAULT, "Inbox"),
    inbox ? { file: path.relative(VAULT, inbox), fm: i?.fm } : "no inbox item")
  return { note, log, inbox, noteFm: n?.fm, inboxFm: i?.fm }
}

// ---------- MCP over stdio, as an agent runs the server connect saved

export async function mcpSession(server: { command: string; args: string[]; env: Record<string, string> }, clientName: string) {
  const child = spawn(server.command, server.args, { env: { ...serverEnv, ...server.env }, stdio: ["pipe", "pipe", "pipe"] })
  let buf = ""
  const waiting = new Map<number, (m: Any) => void>()
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (c: string) => {
    buf += c
    let at
    while ((at = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, at)
      buf = buf.slice(at + 1)
      try { const m = JSON.parse(line); waiting.get(m.id)?.(m); waiting.delete(m.id) } catch { /* not ours */ }
    }
  })
  let n = 0
  const call = (method: string, params: Any = {}): Promise<Any> => new Promise((resolve, reject) => {
    const id = ++n
    waiting.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    setTimeout(() => { if (waiting.delete(id)) reject(new Error(`${method}: no answer`)) }, 30000)
  })
  const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: clientName, version: "1.0" } })
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")
  const tool = async (name: string, args: Any) => {
    const r = await call("tools/call", { name, arguments: args })
    return { error: !!r.result?.isError || !!r.error, text: (r.result?.content ?? []).map((c: Any) => c.text ?? "").join("\n") || JSON.stringify(r.error ?? "") }
  }
  return { init, call, tool, close: () => { child.stdin.end(); setTimeout(() => child.kill(), 2000).unref() } }
}

/** The vault's MCP tools through `server`, spoken to as `client` would: read, search, write a note, a log, the inbox
 *  (what it writes is by `source` when that's said). */
export async function mcpTools(server: { command: string; args: string[]; env: Record<string, string> }, client: string, source: string | null) {
  const tok = rand(6)
  fs.mkdirSync(path.join(VAULT, "Notes"), { recursive: true })
  fs.writeFileSync(path.join(VAULT, "Notes", "Agent brief.md"), `---\ntype: note\n---\nThe code word is periwinkle-${tok}.\n`)
  fs.writeFileSync(path.join(VAULT, "Notes", `Phare notes ${tok}.md`), `---\ntype: note\n---\nThe zephyrine${tok} lamp.\n`)
  const m = await mcpSession(server, client)
  const tools = (await m.call("tools/list")).result?.tools?.map((t: Any) => t.name) ?? []
  check(`mcp (${client}): the vault's tools are listed`, ["read", "search", "write_note", "write_log", "inbox_add"].every((t) => tools.includes(t)), tools)
  const read = await m.tool("read", { path: "Notes/Agent brief.md" })
  check(`mcp (${client}): read a note`, !read.error && read.text.includes(`periwinkle-${tok}`), read)
  const found = await waitFor(async () => { const s = await m.tool("search", { query: `zephyrine${tok}` }); return s.text.includes(`Phare notes ${tok}`) ? s : null }, 8000)
  check(`mcp (${client}): search finds a note`, !!found, found)
  const t = `${client} ${tok} Café ü`
  const wn = await m.tool("write_note", { title: `Fixture ${t}`, body: `Code word: periwinkle-${tok}.` })
  const wl = await m.tool("write_log", { area: "workouts", title: `Fixture ${t}`, duration_min: 5 })
  const ia = await m.tool("inbox_add", { title: `Fixture ${t}`, body: "Done.", tldr: "A test." })
  check(`mcp (${client}): write_note, write_log and inbox_add answer`, !wn.error && !wl.error && !ia.error, { wn, wl, ia })
  checkWrites(`mcp (${client})`, `${client} ${tok}`, source, `periwinkle-${tok}`)
  m.close()
}

// ---------- the sandbox vault, fake agents, the environment

/** The sandbox vault with plugins `on` turned on; nothing that reaches other machines. */
export async function makeVault(on: string[] = []) {
  const S = await import("../../core/sandbox.ts")
  S.makeSandbox(VAULT, S.localToday())
  const pj = path.join(VAULT, ".vaultite", "plugins.json")
  const conf = JSON.parse(fs.readFileSync(pj, "utf8"))
  conf.disabled = conf.disabled.filter((x: string) => !on.includes(x))
  conf.enabled = [...new Set([...conf.enabled, ...on])]
  fs.writeFileSync(pj, JSON.stringify(conf, null, 2))
  fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", "machines"), { recursive: true })
  fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", "machines", "data.json"), JSON.stringify({ machines: [] }))
}
/** Where new shells run, set on the running server (a `local` setting: this machine's, never the vault's). */
export async function setBackend(name: "vaultite" | "tmux") {
  const [c, b] = await api("PATCH", "config/plugin/terminal", { backend: name })
  if (c !== 200) throw new Error(`the terminal backend wasn't set: ${c} ${JSON.stringify(b)}`)
}

/** A fake agent in BIN; what it was run with goes in the fake log (`fakeLog`), as `{bin, args, cwd}` lines. */
export const writeFake = (name: string, text: string) => fs.writeFileSync(path.join(BIN, name), text, { mode: 0o755 })
/** A fake that says what it was run with (FAKE-<NAME> and its folder) and keeps a child running, like an MCP server,
 *  so ending its terminal must end both. */
export const shellFake = (name: string) => writeFake(name, `#!/bin/sh\necho "FAKE-${name.toUpperCase()} $*"\necho "CWD $(pwd)"\nsleep 3600 &\nwait\n`)
export const fakeLog = (): Any[] => { try { return fs.readFileSync(FAKE_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }

/** The command `name` would run as (the first on PATH), or null. */
export function which(name: string, PATH: string) {
  for (const d of PATH.split(":").filter(Boolean)) {
    const p = path.join(d, name)
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p } catch { /* next */ }
  }
  return null
}

export const SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
/** The server's environment from now on: a minimal one, as a service has (no LANG: lsof and ps then speak C), its own
 *  HOME, PATH and `extra` (the agents' homes). */
export function setEnv(PATH: string, extra: Record<string, string> = {}) {
  const keep = ["USER", "LOGNAME", "TMPDIR"].filter((k) => process.env[k]).map((k) => [k, process.env[k]!])
  serverEnv = { ...Object.fromEntries(keep), HOME, PORT: String(PORT), HOST: "127.0.0.1", VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: LOCAL,
    SHELL: fs.existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh", PATH, VT_AGENT_MARK: MARK, VT_FAKE_LOG: FAKE_LOG,
    CLAUDE_CONFIG_DIR: path.join(HOME, ".claude"), CODEX_HOME: path.join(HOME, ".codex"), ...extra }
}
/** The fakes' PATH: BIN first, with node linked there (not its folder on PATH: an npm -g agent there would stand in for
 *  a missing one). */
export function fakesPath() {
  if (!fs.existsSync(path.join(BIN, "node"))) fs.symlinkSync(process.execPath, path.join(BIN, "node"))
  return [BIN, SYSTEM_PATH].join(":")
}
/** The real agents' PATH (live runs): beside this Node, ~/.local/bin, the system's. */
export const agentPath = () => [path.dirname(process.execPath), path.join(REAL_HOME, ".local", "bin"), SYSTEM_PATH].join(":")

/** Hide fake `name` (an agent that isn't installed) until `back`. */
export const hideFake = (name: string, back = false) =>
  fs.renameSync(path.join(BIN, back ? `${name}.off` : name), path.join(BIN, back ? name : `${name}.off`))

// ---------- the run

/** Runs `fn` once nothing else answers on the port, then cleans up: nothing this run started is left running. */
export async function run(fn: () => Promise<void>) {
  if (await portOpen()) {
    console.error(`something already answers on port ${PORT}: pick another with VAULTITE_TEST_PORT`)
    process.exit(2)
  }
  process.on("SIGINT", () => { void cleanup().finally(() => process.exit(130)) })
  try { await fn() } catch (e) { check("the run finished", false, String((e as Error).stack ?? e)) }
  await cleanup()
}

async function cleanup() {
  await stopServer().catch(() => {})
  stopBackends()
  await sleep(1000)
  const left = processesWith(`VT_AGENT_MARK=${MARK}`)
  check("cleanup: nothing this run started is left running", !left.length, left)
  for (const p of left) try { process.kill(p.pid, "SIGKILL") } catch { /* gone */ }
  if (process.env.VAULTITE_AGENT_KEEP !== "1") fs.rmSync(TMP, { recursive: true, force: true })
  else console.log(`kept ${TMP}`)
}
