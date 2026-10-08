// The coding agents on a server (written for Linux, runs on a Mac too), end to end against a throwaway sandbox server:
// OpenClaw and Hermes (and Claude Code, Codex, OpenCode) in Vaultite's terminals, connect and the vault's MCP tools,
// usage, conversations, memory, scheduled jobs, resuming, a server restart, file watching and process cleanup.
//   node tools/test_agents_linux.ts                         fixtures and fake agents only (free, runs anywhere)
//   VAULTITE_AGENT_LIVE=1 node tools/test_agents_linux.ts   also the real agents on a real model (a few cents)
// VAULTITE_TEST_PORT (8911), VAULTITE_AGENT_MODEL (openai/gpt-6-luna, through OpenRouter), VAULTITE_AGENT_KEEP=1 keeps
// the temporary folder. Never touches the real vault or the agents' own state: their homes are copies (live: config
// copied, the key files only linked), the server's HOME is a temporary one, and its port names its terminals.
import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { WebSocket } from "ws"
import { parse as parseYaml } from "yaml"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const REPO = path.resolve(import.meta.dirname, "..")
const PORT = Number(process.env.VAULTITE_TEST_PORT || 8911)
const BASE = `http://127.0.0.1:${PORT}`
const LIVE = process.env.VAULTITE_AGENT_LIVE === "1"
const MODEL = process.env.VAULTITE_AGENT_MODEL || "openai/gpt-6-luna"
const REAL_HOME = os.homedir()
const LINUX = process.platform === "linux"
const rand = (n = 8) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("")
const MARK = rand(12) // in the server's environment, so every process it starts can be found (and none left behind)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// No spaces in the root (fake agents' command lines are split on spaces, as real ones in ~/.local/bin never need);
// the vault and a project folder have spaces and accents, as a user's may.
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vt-agents-")))
const VAULT = path.join(TMP, "Vault de teste ü")
const LOCAL = path.join(TMP, "local")
const HOME = path.join(TMP, "home")
const BIN = path.join(TMP, "bin")
const PROJECT = path.join(TMP, "Projets é", "lighthouse x")
const FAKE_LOG = path.join(TMP, "fake.log")
for (const d of [LOCAL, HOME, BIN, PROJECT]) fs.mkdirSync(d, { recursive: true })

// ---------- results

type Status = "ok" | "FAIL" | "skip"
const results: { name: string; status: Status; note: string }[] = []
function check(name: string, ok: unknown, got?: unknown) {
  const note = ok ? "" : JSON.stringify(got)?.slice(0, 600) ?? ""
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  -> ${note}`}`)
  results.push({ name, status: ok ? "ok" : "FAIL", note })
  return !!ok
}
function skip(name: string, why: string) {
  console.log(`skip ${name}: ${why}`)
  results.push({ name, status: "skip", note: why })
}
function section(title: string) { console.log(`\n== ${title}`) }

async function waitFor<T>(fn: () => Promise<T> | T, ms = 15000, step = 500): Promise<T | null> {
  const end = Date.now() + ms
  for (;;) {
    try { const v = await fn(); if (v) return v } catch { /* not yet */ }
    if (Date.now() > end) return null
    await sleep(step)
  }
}

// ---------- the server

async function api(method: string, route: string, body?: unknown): Promise<[number, Any]> {
  const res = await fetch(`${BASE}/api/${route}`, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) })
  const text = await res.text()
  try { return [res.status, JSON.parse(text)] } catch { return [res.status, text] }
}
const get = async (route: string) => { const [c, b] = await api("GET", route); if (c !== 200) throw new Error(`${route}: ${c} ${JSON.stringify(b).slice(0, 300)}`); return b }

let server: ChildProcess | null = null
let serverEnv: Record<string, string> = {}
const portOpen = () => fetch(`${BASE}/api/version`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)

async function startServer() {
  const log = fs.openSync(path.join(TMP, "server.log"), "a")
  server = spawn(process.execPath, [path.join(REPO, "server.ts")], { cwd: REPO, env: serverEnv, stdio: ["ignore", log, log], detached: true })
  const up = await waitFor(async () => (await api("GET", "vault"))[0] === 200, 60000)
  if (!up) throw new Error(`the server didn't start on ${PORT}: ${fs.readFileSync(path.join(TMP, "server.log"), "utf8").slice(-2000)}`)
}

async function stopServer() {
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
function stopBackends() {
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

const term = {
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
const screenHas = (id: string, re: RegExp, ms = 20000) => waitFor(async () => { const s = await term.screen(id); return re.test(s) ? s : null }, ms)

/** Ends a terminal and checks it's gone, with nothing it started still running. */
async function endAndCheck(label: string, id: string) {
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
async function liveIn(agent: string, id: string, ms = 30000): Promise<Any | null> {
  return waitFor(async () => (await get(`${agent}?days=1`)).live.find((s: Any) => s.terminal === id) ?? null, ms, 1000)
}

// ---------- files the agents wrote

function frontmatter(file: string): { fm: Any; body: string } {
  const text = fs.readFileSync(file, "utf8")
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  return m ? { fm: parseYaml(m[1]) ?? {}, body: m[2] } : { fm: {}, body: text }
}
function findFile(dir: string, re: RegExp): string | null {
  try {
    for (const f of fs.readdirSync(path.join(VAULT, dir), { recursive: true }) as string[]) if (re.test(path.basename(f))) return path.join(VAULT, dir, f)
  } catch { /* no folder */ }
  return null
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** What an agent wrote through write_note, write_log and inbox_add, each where it belongs with its frontmatter. */
function checkWrites(label: string, tok: string, source: string | null, code: string | null) {
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

async function mcpSession(server: { command: string; args: string[]; env: Record<string, string> }, clientName: string) {
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

// ---------- agents' state: made-up fixtures (tools/fixtures), or the real ones copied (live)

const FIX = path.join(REPO, "tools", "fixtures")

/** OpenClaw's fixture state, each <name>.sql made into its database with times moved so the newest reply is an hour ago
 *  (big events zstd-compressed, as OpenClaw stores them): tools/test_vault.ts does the same. */
async function openclawFixture(dir: string) {
  fs.cpSync(path.join(FIX, "openclaw"), dir, { recursive: true })
  const { DatabaseSync } = await import("node:sqlite")
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

/** Hermes' fixture home (and its profile), times in seconds moved so the newest is an hour ago; plus a session that ran
 *  in a folder with spaces and accents, to resume there. */
async function hermesFixture(dir: string) {
  fs.cpSync(path.join(FIX, "hermes"), dir, { recursive: true })
  const { DatabaseSync } = await import("node:sqlite")
  const sqls = (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith(".sql"))
  const TIME = /\b1[78]\d{8}(\.\d+)?\b/g
  const shift = Date.now() / 1000 - 3600 - Math.max(...sqls.flatMap((f) => [...fs.readFileSync(path.join(dir, f), "utf8").matchAll(TIME)].map((m) => Number(m[0]))))
  for (const f of sqls) {
    const db = new DatabaseSync(path.join(dir, f.replace(/\.sql$/, ".db")))
    db.exec(fs.readFileSync(path.join(dir, f), "utf8").replace(TIME, (t) => String(Number(t) + shift)))
    db.close()
    fs.rmSync(path.join(dir, f))
  }
  const db = new DatabaseSync(path.join(dir, "state.db"))
  const t = Date.now() / 1000 - 1800
  db.prepare("INSERT INTO sessions (id, source, model, cwd, started_at, ended_at, title) VALUES (?, 'cli', 'openai/gpt-6-luna', ?, ?, ?, 'Résumé test')")
    .run("20261001_120000_accent", PROJECT, t, t + 60)
  db.prepare("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, 'user', 'Bonjour', ?)").run("20261001_120000_accent", t)
  db.close()
}

/** Fake agents: each says what it was run with (FAKE-<NAME> and its folder) and keeps a child running, like an MCP
 *  server, so ending its terminal must end both. OpenClaw's records `mcp set`; Hermes' starts a session in its database. */
function writeFakes() {
  const w = (name: string, text: string) => fs.writeFileSync(path.join(BIN, name), text, { mode: 0o755 })
  w("openclaw", `#!/usr/bin/env node
const fs = require("fs"), { spawn } = require("child_process")
const a = process.argv.slice(2)
fs.appendFileSync(process.env.VT_FAKE_LOG, JSON.stringify({ bin: "openclaw", args: a, cwd: process.cwd() }) + "\\n")
if (a[0] === "mcp" && a[1] === "set") { console.log("Saved MCP server " + a[2] + "."); process.exit(0) }
if (a[0] !== "tui") { console.error("fake openclaw: " + a.join(" ")); process.exit(2) }
console.log("FAKE-OPENCLAW " + JSON.stringify(a)); console.log("CWD " + process.cwd())
process.title = "openclaw" // as OpenClaw does: on Linux its command line then reads "openclaw" alone
spawn("sleep", ["3600"], { stdio: "ignore" })
setInterval(() => {}, 1e6)
`)
  w("hermes", `#!/usr/bin/env python3
import json, os, sqlite3, subprocess, sys, time
a = sys.argv[1:]
profile = resume = query = None
i = 0
while i < len(a):
    if a[i] in ("-p", "--profile"): profile = a[i + 1]; i += 1
    elif a[i] in ("-r", "--resume"): resume = a[i + 1]; i += 1
    elif a[i] in ("-q", "--query"): query = a[i + 1]; i += 1
    i += 1
with open(os.environ["VT_FAKE_LOG"], "a") as f: f.write(json.dumps({"bin": "hermes", "args": a, "cwd": os.getcwd()}) + "\\n")
print("FAKE-HERMES " + json.dumps(a)); print("CWD " + os.getcwd()); sys.stdout.flush()
if query is not None: sys.exit(0)
if not resume:
    home = os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")
    if profile: home = os.path.join(home, "profiles", profile)
    db = sqlite3.connect(os.path.join(home, "state.db"))
    sid = "fake_%s_%d" % (time.strftime("%Y%m%d_%H%M%S"), os.getpid())
    now = time.time()
    db.execute("INSERT INTO sessions (id, source, model, cwd, started_at) VALUES (?, 'cli', 'openai/fake-model', ?, ?)", (sid, os.getcwd(), now))
    db.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, 'user', 'Fake hello from the agent test', ?)", (sid, now))
    db.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, 'assistant', 'Hi', ?)", (sid, now + 1))
    db.commit(); db.close()
    print("SESSION " + sid); sys.stdout.flush()
subprocess.Popen(["sleep", "3600"])
while True: time.sleep(3600)
`)
  for (const name of ["claude", "codex", "opencode"]) w(name, `#!/bin/sh\necho "FAKE-${name.toUpperCase()} $*"\necho "CWD $(pwd)"\nsleep 3600 &\nwait\n`)
}

// ---------- the sandbox vault

async function makeVault() {
  const S = await import("../core/sandbox.ts")
  S.makeSandbox(VAULT, S.localToday())
  const pj = path.join(VAULT, ".vaultite", "plugins.json")
  const conf = JSON.parse(fs.readFileSync(pj, "utf8"))
  // The agents' plugins on; nothing that reaches other machines.
  conf.disabled = conf.disabled.filter((x: string) => !["codex", "opencode"].includes(x))
  fs.writeFileSync(pj, JSON.stringify(conf, null, 2))
  fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", "machines"), { recursive: true })
  fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", "machines", "data.json"), JSON.stringify({ machines: [] }))
}
function setBackend(name: "vaultite" | "tmux") {
  const dir = path.join(VAULT, ".vaultite", "plugins", "terminal")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({ backend: name }))
}

/** The command `name` would run as (the first on PATH), or null. */
function which(name: string, PATH: string) {
  for (const d of PATH.split(":").filter(Boolean)) {
    const p = path.join(d, name)
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p } catch { /* next */ }
  }
  return null
}

function baseEnv(PATH: string, extra: Record<string, string>): Record<string, string> {
  // A minimal environment, as a service has: no LANG (lsof and ps then speak C), its own HOME.
  const keep = ["USER", "LOGNAME", "TMPDIR"].filter((k) => process.env[k]).map((k) => [k, process.env[k]!])
  return { ...Object.fromEntries(keep), HOME, PORT: String(PORT), HOST: "127.0.0.1", VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: LOCAL,
    SHELL: fs.existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh", PATH, VT_AGENT_MARK: MARK, VT_FAKE_LOG: FAKE_LOG,
    CLAUDE_CONFIG_DIR: path.join(HOME, ".claude"), CODEX_HOME: path.join(HOME, ".codex"), ...extra }
}
const SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
/** The terminals' python3 (the system's) is a Mac's framework build (Command Line Tools'): it runs as Python.app. */
const PY_FRAMEWORK = (() => {
  try { return execFileSync("python3", ["-c", "import sysconfig; print(sysconfig.get_config_var('PYTHONFRAMEWORK') or '')"], { encoding: "utf8", env: { PATH: SYSTEM_PATH } }).trim() !== "" } catch { return false }
})()
const fakeLog = (): Any[] => { try { return fs.readFileSync(FAKE_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }

// =====================================================================================================================
// Part 1: fixtures and fake agents

async function fixturePart() {
  section("fixtures: the server, the plugins, connect, MCP")
  const OC = path.join(TMP, "openclaw-fixture"), HH = path.join(TMP, "hermes-fixture")
  await openclawFixture(OC)
  await hermesFixture(HH)
  writeFakes()
  // (node linked, not its folder on PATH: an npm -g agent there would stand in for a missing one)
  fs.symlinkSync(process.execPath, path.join(BIN, "node"))
  serverEnv = baseEnv([BIN, SYSTEM_PATH].join(":"),
    { OPENCLAW_STATE_DIR: OC, OPENCLAW_WORKSPACE_DIR: path.join(OC, "workspace"), HERMES_HOME: HH })
  setBackend("vaultite")
  await startServer()
  check("server: answers on 127.0.0.1 only", fs.readFileSync(path.join(TMP, "server.log"), "utf8").includes(`http://127.0.0.1:${PORT}`))

  // The plugins read the fixtures on this machine (node:sqlite, zstd).
  for (const agent of ["openclaw", "hermes"]) {
    const u = await get(`${agent}?days=7`)
    check(`${agent}: usage per day and model from its databases`, u.total.tokens > 0 && u.models.length > 0 && u.days.length === 7 && u.days.some((d: Any) => d.tokens > 0),
      { total: u.total, models: u.models?.length })
  }
  const oc = await get("openclaw/session/a1f0c3d2-5b6e-4c7a-8d9e-0f1a2b3c4d5a")
  check("openclaw: a conversation (compressed events too)", oc.entries?.length > 0 && oc.key === "agent:main:main", { n: oc.entries?.length, key: oc.key })
  const hs = (await get("hermes?days=7")).sessions[0]
  const ht = hs ? await get(`hermes/session/${encodeURIComponent(hs.id)}`) : null
  check("hermes: a conversation", ht?.entries?.length > 0, ht)
  const om = await get("openclaw/memory"), hm = await get("hermes/memory")
  check("openclaw: its workspace's memory files and daily notes", om.files.length > 0 && om.notes.length > 0, om)
  check("hermes: its soul, memory and what it knows about the user", !!hm.soul && hm.memory?.length > 0 && hm.user?.length > 0, hm)
  const oj = await get("openclaw/cron"), hj = await get("hermes/cron")
  check("openclaw: scheduled jobs", Array.isArray(oj) && oj.length > 0, oj)
  check("hermes: scheduled jobs", hj.jobs?.length > 0, hj)
  for (const page of ["Dashboards/OpenClaw.md", "Dashboards/Hermes.md"]) {
    if (!fs.existsSync(path.join(VAULT, page))) { check(`${page}: the plugin brought its page`, false, "missing"); continue }
    const [c, text] = await api("GET", `render?path=${encodeURIComponent(page)}`)
    const notes = [...String(text).matchAll(/_\(([\w-]+ block: .*?)\)_/g)].map((m) => m[1])
    check(`${page}: renders as text, every block without a problem`, c === 200 && !notes.length, { c, notes })
  }

  // connect: OpenClaw through its CLI (the fake records it), Hermes by editing its config.yaml.
  const [c1, r1] = await api("POST", "ops/openclaw.connect", {})
  const set = fakeLog().filter((x) => x.bin === "openclaw" && x.args[0] === "mcp").pop()
  const saved = set ? JSON.parse(set.args[3]) : null
  check("openclaw connect: runs `openclaw mcp set vaultite <server>` with this server's node, vau and address",
    c1 === 200 && set?.args[2] === "vaultite" && fs.existsSync(saved?.command) && saved?.args[0] === path.join(REPO, "bin", "vau") && saved?.args[1] === "mcp" &&
      saved?.env?.VAULTITE_URL === BASE, { c1, r1, set })
  const [c2, r2] = await api("POST", "ops/hermes.connect", {})
  const hy = parseYaml(fs.readFileSync(path.join(HH, "config.yaml"), "utf8"))
  check("hermes connect: adds mcp_servers.vaultite to config.yaml, the rest kept", c2 === 200 && r2.changed === "added" && hy.mcp_servers?.vaultite?.env?.VAULTITE_URL === BASE &&
    hy.model !== undefined, { c2, r2, hy })
  const [, r3] = await api("POST", "ops/hermes.connect", {})
  check("hermes connect: again changes nothing", r3.changed === "unchanged", r3)
  const [c4] = await api("POST", "ops/hermes.connect", { account: "nobody" })
  check("hermes connect: a profile that isn't there is a clear 404", c4 === 404, c4)

  // The MCP server connect saved, spoken to as each agent would: read, search, write a note, a log, the inbox.
  if (saved) {
    const tok = rand(6)
    fs.mkdirSync(path.join(VAULT, "Notes"), { recursive: true })
    fs.writeFileSync(path.join(VAULT, "Notes", "Agent brief.md"), `---\ntype: note\n---\nThe code word is periwinkle-${tok}.\n`)
    fs.writeFileSync(path.join(VAULT, "Notes", `Phare notes ${tok}.md`), `---\ntype: note\n---\nThe zephyrine${tok} lamp.\n`)
    for (const [client, source] of [["openclaw", "openclaw"], ["hermes", "hermes"]]) {
      const m = await mcpSession(saved, client)
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
  }

  // File watching: a change made on disk is pushed to the app (/api/events), in new folders with accents too.
  section("fixtures: file watching")
  const events: Any[] = []
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/events`)
  ws.on("message", (d) => { try { events.push(JSON.parse(String(d))) } catch { /* not JSON */ } })
  await new Promise((r, j) => { ws.once("open", r); ws.once("error", j) })
  await sleep(500)
  const changed = (rel: string, ms = 5000) => waitFor(() => events.some((e) => e.type === "change" && (e.paths === null || e.paths.includes(rel))), ms, 100)
  const nested = "Nouveau dossier é/Sous dossier ü/Watched note.md"
  fs.mkdirSync(path.join(VAULT, path.dirname(nested)), { recursive: true })
  await sleep(300) // inotify watches a new folder once it's seen it: the file comes after
  fs.writeFileSync(path.join(VAULT, nested), "---\ntype: note\n---\nWatched once.\n")
  check("watch: a file made on disk in new folders (accents, spaces) is pushed", await changed(nested), events.slice(-3))
  const [, r1t] = await api("GET", `render?path=${encodeURIComponent(nested)}`)
  check("watch: the API reads it", String(r1t).includes("Watched once."), r1t)
  events.length = 0
  fs.appendFileSync(path.join(VAULT, nested), "Watched twice.\n")
  check("watch: an edit on disk is pushed", await changed(nested), events.slice(-3))
  events.length = 0
  const deep = "Nouveau dossier é/Sous dossier ü/Plus profond/Deep note.md"
  fs.mkdirSync(path.join(VAULT, path.dirname(deep)), { recursive: true })
  fs.writeFileSync(path.join(VAULT, deep), "---\ntype: note\n---\nDeep.\n")
  check("watch: a file made at once with its new folder is pushed", await changed(deep), events.slice(-3))
  events.length = 0
  fs.rmSync(path.join(VAULT, nested))
  check("watch: a file removed on disk is pushed", await changed(nested), events.slice(-3))
  ws.close()

  await terminalsPart("vaultite", OC)
  await stopServer()
  stopBackends()
  if (["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"].some((p) => fs.existsSync(p))) {
    setBackend("tmux")
    await startServer()
    await terminalsPart("tmux", OC)
    await stopServer()
    stopBackends()
  } else skip("terminals in tmux", "tmux isn't installed")
}

/** The fake agents in terminals of one backend: started, listed, linked by their plugins, surviving a server restart,
 *  resumed, a first prompt passed whole, ended with nothing left, and a missing binary. */
async function terminalsPart(backend: string, OC: string) {
  section(`fixtures: terminals (${backend === "vaultite" ? "the keeper" : backend})`)
  const tag = backend === "vaultite" ? "keeper" : backend
  const ids: Record<string, string> = { openclaw: `openclaw-${rand()}`, ...(PY_FRAMEWORK ? {} : { hermes: `hermes-${rand()}` }) }
  if (PY_FRAMEWORK) skip(`hermes (${tag}): the fake in terminals`, "this python3 is a framework build (ps shows Python.app, and it leaves its group): it can't stand in for Hermes")
  for (const [agent, id] of Object.entries(ids)) {
    const [c, r] = await term.start(id)
    check(`${agent} (${tag}): a terminal starts it`, c === 200 && r.started && r.agent === agent, r)
    const screen = await screenHas(id, new RegExp(`FAKE-${agent.toUpperCase()}`))
    check(`${agent} (${tag}): it runs in the vault's folder (spaces, accents)`, screen?.includes(`CWD ${VAULT}`), screen?.slice(-400))
    const listed = await waitFor(async () => { const s = await term.one(id); return s?.busy && s.agent === agent ? s : null })
    check(`${agent} (${tag}): Terminals lists it, running`, listed && listed.backend === backend, await term.one(id))
    const live = await liveIn(agent, id)
    check(`${agent} (${tag}): its plugin lists the session as open, linked to its terminal`,
      live && (agent === "openclaw" ? live.name === "agent:main:main" : String(live.id).startsWith("fake_")), live ?? (await get(`${agent}?days=1`)).live)
  }

  // The server restarts (a deploy): the shells live on in the backend, and the plugins find them again.
  await stopServer()
  await startServer()
  for (const [agent, id] of Object.entries(ids)) {
    const s = await waitFor(() => term.one(id), 10000)
    check(`${agent} (${tag}): its terminal survives a server restart`, s?.busy, s)
    check(`${agent} (${tag}): still linked to its terminal after the restart`, await liveIn(agent, id), (await get(`${agent}?days=1`)).live)
    const screen = await term.screen(id)
    check(`${agent} (${tag}): its screen is still there`, screen.includes(`FAKE-${agent.toUpperCase()}`), screen.slice(-300))
  }
  for (const [agent, id] of Object.entries(ids)) await endAndCheck(`${agent} (${tag})`, id)

  // Resuming: OpenClaw on the session's key, Hermes with -r in the folder the session ran in.
  const ro = "resume-openclaw-b2e1d4c3-6c7f-4d8b-9eaf-1a2b3c4d5e6b"
  await term.start(ro)
  await screenHas(ro, /FAKE-OPENCLAW/)
  const ra = fakeLog().filter((x) => x.bin === "openclaw" && x.args[0] === "tui").pop()?.args ?? []
  check(`openclaw (${tag}): resume runs \`openclaw tui --local --session <its key>\``, ra.includes("--session") && ra[ra.indexOf("--session") + 1] === "agent:main:lighthouse-notes" && ra.includes("--local"), ra)
  const rl = await liveIn("openclaw", ro)
  check(`openclaw (${tag}): the resumed session is open, linked to its terminal`, rl?.name === "agent:main:lighthouse-notes", rl ?? (await get("openclaw?days=1")).live)
  await endAndCheck(`openclaw resumed (${tag})`, ro)
  if (!PY_FRAMEWORK) {
    const rh = "resume-hermes-20261001_120000_accent"
    await term.start(rh)
    const hscreen = await screenHas(rh, /FAKE-HERMES/)
    check(`hermes (${tag}): resume runs \`hermes -r <id>\` in the folder it ran in (spaces, accents)`, hscreen?.includes(`CWD ${PROJECT}`) && /"-r", "20261001_120000_accent"/.test(hscreen), hscreen?.slice(-400))
    const hl = await liveIn("hermes", rh)
    check(`hermes (${tag}): the resumed session is open, linked to its terminal`, hl?.id === "20261001_120000_accent", hl ?? (await get("hermes?days=1")).live)
    await endAndCheck(`hermes resumed (${tag})`, rh)
  }

  if (backend !== "vaultite") return // the rest is the same in every backend

  // A first prompt reaches the agent whole: quotes, a dollar sign, backticks and accents.
  const prompt = `It's "quoted", $HOME and \`date\` stay text: café ü`
  const po = `openclaw-${rand()}`
  await term.start(po, prompt)
  await screenHas(po, /FAKE-OPENCLAW/)
  const pa = fakeLog().filter((x) => x.bin === "openclaw" && x.args[0] === "tui").pop()?.args ?? []
  check("openclaw: a first prompt is passed whole (--message)", pa[pa.indexOf("--message") + 1] === prompt, pa)
  await endAndCheck("openclaw with a prompt", po)
  const ph = `hermes-${rand()}`
  await term.start(ph, prompt)
  await screenHas(ph, /FAKE-HERMES/)
  const pha = fakeLog().filter((x) => x.bin === "hermes").pop()?.args ?? []
  check("hermes: a first prompt is passed whole (chat -q)", pha[pha.indexOf("-q") + 1] === prompt, pha)
  const back = await waitFor(async () => { const s = await term.one(ph); return s && !s.busy ? s : null }, 10000)
  check("hermes: after a one-shot prompt the terminal is a plain shell again", back, await term.one(ph))
  await endAndCheck("hermes with a prompt", ph)

  // The other agents' terminals start what their plugins say (fakes here).
  for (const agent of ["claude", "codex", "opencode"]) {
    const id = `${agent}-${rand()}`
    const [, r] = await term.start(id)
    const s = await screenHas(id, new RegExp(`FAKE-${agent.toUpperCase()}`))
    check(`${agent}: a terminal starts it in the vault's folder`, r.agent === agent && s?.includes(`CWD ${VAULT}`), { r, screen: s?.slice(-300) })
    await endAndCheck(agent, id)
  }

  // An agent that isn't installed: the terminal says so and stays a shell; connect says so too.
  fs.renameSync(path.join(BIN, "openclaw"), path.join(BIN, "openclaw.off"))
  fs.renameSync(path.join(BIN, "hermes"), path.join(BIN, "hermes.off"))
  for (const agent of ["openclaw", "hermes"]) {
    const id = `${agent}-${rand()}`
    await term.start(id)
    const s = await screenHas(id, /not found|No such file/i, 15000)
    const shell = await waitFor(async () => { const x = await term.one(id); return x && !x.busy ? x : null }, 10000)
    check(`${agent}: missing, its terminal says it isn't found and stays a shell`, s && shell, { screen: (await term.screen(id)).slice(-300), shell: await term.one(id) })
    await endAndCheck(`${agent} missing`, id)
  }
  // (connect also looks beside the server's Node, where npm -g puts it)
  if (fs.existsSync(path.join(path.dirname(fs.realpathSync(process.execPath)), "openclaw"))) skip("openclaw connect: missing, a clear 409", "openclaw is installed beside this Node")
  else {
    const [cm, rm] = await api("POST", "ops/openclaw.connect", {})
    check("openclaw connect: missing, a clear 409 (isn't installed)", cm === 409 && /isn't installed/.test(JSON.stringify(rm)), { cm, rm })
  }
  fs.renameSync(path.join(BIN, "openclaw.off"), path.join(BIN, "openclaw"))
  fs.renameSync(path.join(BIN, "hermes.off"), path.join(BIN, "hermes"))
  void OC
}

// =====================================================================================================================
// Part 2: the real agents on a real model (VAULTITE_AGENT_LIVE=1)

/** An isolated copy of OpenClaw's state: its config with paths moved here, no MCP servers, no gateway, the model set;
 *  the key file linked (never copied); its workspace's files without the first-run ritual. */
function openclawHome(dir: string) {
  const real = path.join(REAL_HOME, ".openclaw")
  const conf = JSON.parse(fs.readFileSync(path.join(real, "openclaw.json"), "utf8"))
  conf.agents ??= {}
  conf.agents.defaults ??= {}
  conf.agents.defaults.workspace = path.join(dir, "workspace")
  conf.agents.defaults.model = { ...(conf.agents.defaults.model ?? {}), primary: `openrouter/${MODEL}` }
  conf.agents.defaults.models = { ...(conf.agents.defaults.models ?? {}), [`openrouter/${MODEL}`]: {} }
  for (const [id, e] of Object.entries(conf.agents.entries ?? {}) as [string, Any][]) {
    e.workspace = path.join(dir, id === "main" ? "workspace" : `workspace-${id}`)
    e.agentDir = path.join(dir, "agents", id, "agent")
  }
  delete conf.mcp
  delete conf.wizard
  if (conf.gateway) delete conf.gateway.auth
  fs.mkdirSync(path.join(dir, "workspace"), { recursive: true })
  fs.writeFileSync(path.join(dir, "openclaw.json"), JSON.stringify(conf, null, 2), { mode: 0o600 })
  fs.symlinkSync(path.join(real, ".env"), path.join(dir, ".env"))
  for (const f of ["AGENTS.md", "IDENTITY.md", "SOUL.md", "USER.md"]) {
    try { fs.copyFileSync(path.join(real, "workspace", f), path.join(dir, "workspace", f)) } catch { /* not there */ }
  }
}

/** An isolated Hermes home: its config without MCP servers, the model set; .env and auth.json linked; its soul. */
async function hermesHome(dir: string) {
  const real = path.join(REAL_HOME, ".hermes")
  const { parseDocument } = await import("yaml")
  const doc = parseDocument(fs.readFileSync(path.join(real, "config.yaml"), "utf8"))
  doc.delete("mcp_servers")
  doc.setIn(["model", "default"], MODEL)
  doc.setIn(["model", "provider"], "openrouter")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "config.yaml"), String(doc), { mode: 0o600 })
  for (const f of [".env", "auth.json"]) if (fs.existsSync(path.join(real, f))) fs.symlinkSync(path.join(real, f), path.join(dir, f))
  try { fs.copyFileSync(path.join(real, "SOUL.md"), path.join(dir, "SOUL.md")) } catch { /* none */ }
}

/** One line (a TUI sends on Enter): the five MCP tools, then the code word as the answer. `tok` names the code word and
 *  the note to find, `mine` what this agent writes. */
const livePrompt = (label: string, tok: string, mine: string) => `This is an automated test of your Vaultite MCP tools (the MCP server named vaultite); use only those tools and do exactly this: ` +
  `1) read the note "Notes/Agent brief.md" and find its code word; 2) search the vault for "zephyrine${tok}" and see which file matches; ` +
  `3) write_note with title "${label} live ${mine}" and body "Code word: <the code word>. Search found: <that file>."; ` +
  `4) write_log with area "workouts", title "${label} live ${mine}", duration_min 5; 5) inbox_add with title "${label} live ${mine}" and body "Done.". ` +
  `Then reply with only the code word.`

async function livePart() {
  section(`live: the real agents on ${MODEL}`)
  const agentPath = [path.dirname(process.execPath), path.join(REAL_HOME, ".local", "bin"), SYSTEM_PATH].join(":")
  const OC = path.join(TMP, "openclaw-live"), HH = path.join(TMP, "hermes-live")
  const has = {
    openclaw: !!which("openclaw", agentPath) && fs.existsSync(path.join(REAL_HOME, ".openclaw", ".env")),
    hermes: !!which("hermes", agentPath) && fs.existsSync(path.join(REAL_HOME, ".hermes", ".env")),
  }
  if (has.openclaw) openclawHome(OC)
  if (has.hermes) await hermesHome(HH)
  serverEnv = baseEnv(agentPath, { OPENCLAW_STATE_DIR: OC, HERMES_HOME: HH })
  setBackend("vaultite")
  await startServer()
  const tok = rand(6)
  fs.mkdirSync(path.join(VAULT, "Notes"), { recursive: true })
  const code = `periwinkle-${tok}`
  fs.writeFileSync(path.join(VAULT, "Notes", "Agent brief.md"), `---\ntype: note\n---\nThe code word is ${code}.\n`)
  fs.writeFileSync(path.join(VAULT, "Notes", `Phare notes ${tok}.md`), `---\ntype: note\n---\nThe zephyrine${tok} lamp.\n`)

  for (const agent of ["openclaw", "hermes"] as const) {
    if (!has[agent]) { skip(`live ${agent}`, `${agent} or its key file (~/.${agent}/.env) isn't on this machine`); continue }
    section(`live: ${agent}`)
    const label = agent === "openclaw" ? "OpenClaw" : "Hermes"
    const mine = rand(6) // what this agent writes is named by it
    const [cc, rc] = await api("POST", `ops/${agent}.connect`, {})
    const conf = agent === "openclaw" ? JSON.parse(fs.readFileSync(path.join(OC, "openclaw.json"), "utf8")).mcp?.servers?.vaultite
      : parseYaml(fs.readFileSync(path.join(HH, "config.yaml"), "utf8")).mcp_servers?.vaultite
    check(`live ${agent}: connect saves the vault's MCP server in its config (this server's address)`, cc === 200 && conf?.env?.VAULTITE_URL === BASE, { cc, rc, conf })

    // In a terminal, the prompt sent as it starts (OpenClaw) or typed into it (Hermes: its first prompt is one-shot).
    const id = `${agent}-${rand()}`
    const t0 = Date.now()
    if (agent === "openclaw") await term.start(id, livePrompt(label, tok, mine))
    else {
      await term.start(id)
      await waitFor(async () => (await term.one(id))?.busy, 20000)
      await screenHas(id, /❯|>|Hermes/i, 60000)
      await sleep(3000)
      await term.send(id, livePrompt(label, tok, mine))
    }
    const wrote = await waitFor(() => findFile("Inbox", new RegExp(`live ${mine}`)) && findFile("Notes", new RegExp(`live ${mine}`)) && findFile("Logs", new RegExp(`live ${mine}`)), 300000, 2000)
    check(`live ${agent}: it used the vault's MCP tools (read, search, write_note, write_log, inbox_add) within 5 min`, wrote, { secs: Math.round((Date.now() - t0) / 1000), screen: (await term.screen(id, 60)).slice(-1500) })
    await sleep(5000) // its answer after the last tool
    const w = checkWrites(`live ${agent}`, `live ${mine}`, null, code)
    console.log(`     (${agent} wrote as source "${w.noteFm?.source}", inbox from "${w.inboxFm?.from}")`)
    check(`live ${agent}: its writes say who wrote them (source ${agent})`, w.noteFm?.source === agent, w.noteFm)
    check(`live ${agent}: it answered with the code word`, await screenHas(id, new RegExp(esc(code)), 60000), (await term.screen(id, 40)).slice(-800))

    const live = await liveIn(agent, id, 30000)
    check(`live ${agent}: its session shows as open, linked to its terminal`, live, (await get(`${agent}?days=1`)).live)
    const u = await waitFor(async () => { const x = await get(`${agent}?days=1`); return x.sessions.length && x.days.at(-1).tokens > 0 ? x : null }, 30000, 2000)
    const model = MODEL.split("/").pop()!
    const mrow = u?.models.find((m: Any) => String(m.name).includes(model))
    check(`live ${agent}: usage today, for ${model}`, mrow && mrow.tokens > 0 && u.days.at(-1).date === today(), u && { models: u.models, day: u.days.at(-1), total: u.total })
    check(`live ${agent}: a cost for the run (priced)`, mrow && mrow.cost > 0, u && { models: u.models, total: u.total })
    const sid = live?.id ?? u?.sessions[0]?.id
    const conv = sid ? await get(`${agent}/session/${encodeURIComponent(sid)}`) : null
    const calls = (conv?.entries ?? []).filter((e: Any) => e.kind === "tool")
    const called = (t: string) => calls.some((e: Any) => `${e.name} ${e.input}`.includes(t))
    check(`live ${agent}: its conversation, with the prompt and the MCP tool calls`, conv?.entries?.some((e: Any) => e.kind === "user" && e.text.includes(mine)) &&
      ["write_note", "write_log", "inbox_add"].every(called), { tools: calls.map((e: Any) => e.name), n: conv?.entries?.length })
    check(`live ${agent}: its conversation names the vault's tools it called`, ["write_note", "write_log", "inbox_add"].every((t) => calls.some((e: Any) => String(e.name).includes(t))),
      calls.map((e: Any) => e.name))
    const mem = await get(`${agent}/memory`)
    check(`live ${agent}: its memory as the plugin shows it`, agent === "openclaw" ? mem.dir === path.join(OC, "workspace") && mem.files.length > 0 : mem.soul !== null, mem)
    if (agent === "hermes") {
      try {
        execFileSync(which("hermes", agentPath)!, ["cron", "create", "--name", `Test job ${tok}`, "0 9 * * *", "Say hi"], { env: { ...serverEnv }, stdio: "pipe", timeout: 60000 })
        const jobs = await get("hermes/cron")
        check("live hermes: a scheduled job made with its CLI shows up", jobs.jobs.some((j: Any) => j.name === `Test job ${tok}`), jobs)
      } catch (e) { check("live hermes: a scheduled job made with its CLI shows up", false, String((e as Any).stderr ?? e).slice(0, 400)) }
    } else {
      const jobs = await get("openclaw/cron")
      check("live openclaw: scheduled jobs read (none here)", Array.isArray(jobs), jobs)
      skip("live openclaw: a scheduled job made with its CLI", "openclaw cron add needs a running gateway (this setup runs --local)")
    }

    // The server restarts: the agent goes on in its terminal, still linked.
    await stopServer()
    await startServer()
    check(`live ${agent}: its terminal survives a server restart`, (await waitFor(() => term.one(id), 10000))?.busy, await term.one(id))
    check(`live ${agent}: still linked to its terminal after the restart`, await liveIn(agent, id), (await get(`${agent}?days=1`)).live)
    await endAndCheck(`live ${agent}`, id)

    // Resume it in a new terminal and ask once more: the same conversation grows.
    if (!sid) { skip(`live ${agent}: resume`, "no session id"); continue }
    const rid = `resume-${agent}-${sid}`
    await term.start(rid)
    const rl = await liveIn(agent, rid, 60000)
    check(`live ${agent}: resumed, the session shows as open in its new terminal`, rl, (await get(`${agent}?days=1`)).live)
    // (typed before the TUI is up, the line is lost: OpenClaw's status line says "ready" once it takes input)
    if (agent === "openclaw") await waitFor(async () => /\bready\b/.test(await term.screen(rid, 40)) || null, 90000, 1000)
    await sleep(5000)
    await term.send(rid, `Reply with exactly: resumed ${tok}`)
    const grew = await waitFor(async () => {
      const c = await get(`${agent}/session/${encodeURIComponent(rl?.id ?? sid)}`)
      // (the first prompt is in it too: the same conversation)
      return c.entries.some((e: Any) => e.kind === "assistant" && e.text.includes(`resumed ${tok}`)) && c.entries.some((e: Any) => e.kind === "user" && e.text.includes(`live ${mine}`)) ? c : null
    }, 120000, 3000)
    check(`live ${agent}: resumed, it answers in the same conversation`, grew, (await term.screen(rid, 40)).slice(-800))
    await endAndCheck(`live ${agent} resumed`, rid)
  }

  // Claude Code, Codex, OpenCode: started in a terminal when installed (not signed in here: no prompt is sent).
  for (const agent of ["claude", "codex", "opencode"]) {
    if (!which(agent, agentPath)) { skip(`live ${agent}`, "not installed"); continue }
    const id = `${agent}-${rand()}`
    await term.start(id)
    const s = await waitFor(async () => { const x = await term.one(id); return x?.busy ? x : null }, 20000)
    check(`live ${agent}: a terminal starts it`, s, { list: await term.one(id), screen: (await term.screen(id, 30)).slice(-500) })
    await endAndCheck(`live ${agent}`, id)
  }
  await stopServer()
  stopBackends()
}

// =====================================================================================================================

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

if (await portOpen()) {
  console.error(`something already answers on port ${PORT}: pick another with VAULTITE_TEST_PORT`)
  process.exit(2)
}
process.on("SIGINT", () => { void cleanup().finally(() => process.exit(130)) })
try {
  await makeVault()
  await fixturePart()
  if (LIVE) await livePart()
  else skip("live agents", "set VAULTITE_AGENT_LIVE=1 to run the real agents on a real model")
} catch (e) {
  check("the run finished", false, String((e as Error).stack ?? e))
}
await cleanup()
const fails = results.filter((r) => r.status === "FAIL")
console.log(`\n${results.filter((r) => r.status === "ok").length} passed, ${fails.length} failed, ${results.filter((r) => r.status === "skip").length} skipped`)
for (const f of fails) console.log(`  FAIL ${f.name}`)
process.exit(fails.length ? 1 : 0)
