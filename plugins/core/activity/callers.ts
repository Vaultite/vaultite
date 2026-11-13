import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { processTable, type Proc, type RequestStart } from "../../../core/plugins.ts"
import { agentName, KNOWN_AGENTS, parseTerminal } from "../../../core/agents.ts"
import type { Actor } from "./model.ts"
import { MINUTE, plugin } from "./store.ts"

type Caller = { agent: string | null; name: string; terminal?: string; session?: string }
const OTHERS: Record<string, string> = { mcp: "An MCP client", "ai-import": "AI import" }
export const nameOf = (agent: string) => agentName(agent) ?? OTHERS[agent] ?? agent

const run = (cmd: string, args: string[]) => new Promise<string>((resolve) =>
  execFile(cmd, args, { timeout: 3000, maxBuffer: 4 << 20 }, (_e, out) => resolve(String(out ?? ""))))

type Table = Map<number, Proc>
const processes = (fresh = false) => processTable(fresh ? 0 : 2000)

const byPort = new Map<number, [number, Caller | null]>(), byPid = new Map<number, [number, Caller | null]>()
const CALLER_TTL = 10_000
const cached = (m: Map<number, [number, Caller | null]>, k: number) => { const hit = m.get(k); return hit && Date.now() - hit[0] < CALLER_TTL ? hit : null }
function remember(m: Map<number, [number, Caller | null]>, k: number, c: Caller | null) {
  m.set(k, [Date.now(), c])
  if (m.size > 200) for (const [key, [at]] of m) if (Date.now() - at >= CALLER_TTL) m.delete(key)
  return c
}

export async function lookup(port: number): Promise<Caller | null> {
  const known = cached(byPort, port)
  if (known) return known[1]
  // A quick caller (curl) is gone by the time it's answered. Linux has iproute2's ss by default, lsof often not.
  let [sockets, table] = await Promise.all([process.platform === "linux"
    ? run("ss", ["-Htnp", "state", "established", `( sport = :${port} )`])
    : process.platform === "win32" ? run("netstat", ["-ano", "-p", "TCP"])
    : run(fs.existsSync("/usr/sbin/lsof") ? "/usr/sbin/lsof" : "lsof", ["-nP", "-a", `-iTCP:${port}`, "-sTCP:ESTABLISHED", "-Fp"]), processes()])
  const pids = (process.platform === "linux" ? [...sockets.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]))
    : process.platform === "win32" ? [...sockets.matchAll(new RegExp(`^\\s*TCP\\s+\\S+:${port}\\s+\\S+:${process.env.PORT || 8793}\\s+ESTABLISHED\\s+(\\d+)`, "gm"))].map((m) => Number(m[1]))
    : sockets.split("\n").filter((l) => l.startsWith("p")).map((l) => Number(l.slice(1)))).filter((p) => p && p !== process.pid)
  let pid = pids[0]
  if (pid) {
    const seen = cached(byPid, pid)
    if (seen) return remember(byPort, port, seen[1])
    if (!table.has(pid)) table = await processes(true)
  } else {
    // tmux's command lines carry the server's address too: only an API URL names a caller.
    const self = new RegExp(`(localhost|127\\.0\\.0\\.1|\\[::1\\]):${process.env.PORT || 8793}/api/`)
    const newest = (t: Table) => [...t].filter(([p, x]) => p !== process.pid && self.test(x.args)).map(([p]) => p).sort((a, b) => b - a)[0]
    pid = newest(table)
    if (!pid) pid = newest(table = await processes(true))
  }
  if (!pid || !table.has(pid)) return null
  return remember(byPort, port, remember(byPid, pid, await name(pid, table)))
}

async function name(pid: number, table: Table): Promise<Caller | null> {
  const chain: number[] = []
  for (let p = pid, n = 0; p > 1 && table.has(p) && n < 40; p = table.get(p)!.ppid, n++) chain.push(p)
  const first = table.get(pid)?.args ?? ""
  const prog = path.basename(first.split(/\s+/)[0] || "")
  for (const p of chain) {
    const hit = KNOWN_AGENTS.find((a) => a.runs?.test(table.get(p)!.args))
    if (hit) return { agent: hit.id, name: hit.name, ...(await terminalOf(chain)) }
  }
  if (/(^|\/)vau(\s|$)|core\/cli\.ts/.test(first)) return { agent: null, name: "vau CLI", ...(await terminalOf(chain)) }
  return prog ? { agent: null, name: prog, ...(await terminalOf(chain)) } : null
}

async function terminalOf(pids: number[]): Promise<{ terminal?: string; session?: string }> {
  const t = await plugin.ask<{ id: string; title?: string } | null>("terminal:of-pids", null, pids)
  return t ? { terminal: t.id, ...(t.title ? { session: t.title } : {}) } : {}
}

const loopback = (a: string) => a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1"

export function whoFrom(s: RequestStart): { actor: Actor; lookup: boolean } {
  const c = s.client ?? ""
  if (c.startsWith("app")) return { actor: { kind: "you", name: "You", device: c.split("/")[1] || "web" }, lookup: false }
  if (c === "mcp") return { actor: { kind: "agent", name: s.label || (s.agent ? nameOf(s.agent) : "An MCP client") }, lookup: false }
  if (c === "cli") {
    if (s.agent) return { actor: { kind: "agent", name: nameOf(s.agent) }, lookup: loopback(s.remote) }
    return { actor: { kind: "cli", name: "vau CLI" }, lookup: loopback(s.remote) }
  }
  if (/^Mozilla\//.test(s.ua) && !s.agent) return { actor: { kind: "you", name: "You", device: /iPhone|Android/.test(s.ua) ? "phone" : "web" }, lookup: false }
  if (s.agent) return { actor: { kind: "agent", name: nameOf(s.agent) }, lookup: loopback(s.remote) }
  const ua = /^([A-Za-z-]+)/.exec(s.ua)?.[1]?.toLowerCase()
  return { actor: { kind: "script", name: s.forwarded ? "Another device" : ua || "A script" }, lookup: loopback(s.remote) && !s.forwarded }
}

export function withCaller(a: Actor, c: Caller | null): Actor {
  if (!c) return a
  const term = { ...(c.terminal ? { terminal: c.terminal } : {}), ...(c.session ? { session: c.session } : {}) }
  if (c.agent) return { kind: "agent", name: agentName(c.agent) ?? c.name, ...term }
  if (a.kind === "cli") return { ...a, ...term }
  if (a.kind === "script") return { ...a, name: c.name, ...term }
  return { ...a, ...term }
}

export const sessionIds = new Map<string, [number, string]>()
export async function withSession(a: Actor): Promise<Actor> {
  if (a.kind !== "agent" || !a.terminal || a.sessionId) return a
  const heard = sessionIds.get(a.terminal)
  const id = parseTerminal(a.terminal)?.resume ?? (heard && Date.now() - heard[0] < MINUTE ? heard[1]
    : (await plugin.ask<{ session?: string } | null>("terminal:info", null, a.terminal).catch(() => null))?.session)
  if (id) sessionIds.set(a.terminal, [Date.now(), id])
  return id ? { ...a, sessionId: id } : a
}
