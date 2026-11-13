import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { hookCommand, recordSpan, serverUrl, type Span } from "../../../core/plugins.ts"
import { parseTerminal } from "../../../core/agents.ts"
import { nameOf, sessionIds } from "./callers.ts"
import { str } from "./describe.ts"
import { record } from "./events.ts"
import type { Action, Actor, ClientPerf } from "./model.ts"
import { claim } from "./requests.ts"
import { DAY, plugin } from "./store.ts"
import { clients } from "./timings.ts"

function relOf(abs: string) {
  // path.relative: Windows' separators and case-blind names.
  const under = (root: string) => {
    const r = root ? path.relative(root, abs) : ""
    return r && r !== ".." && !r.startsWith(".." + path.sep) && !path.isAbsolute(r) ? r.split(path.sep).join("/") : null
  }
  for (const root of [plugin.vault.path, (() => { try { return fs.realpathSync(plugin.vault.path) } catch { return "" } })()]) {
    const rel = under(root)
    if (rel) return { rel, inVault: true }
  }
  const home = under(os.homedir())
  return { rel: home ? `~/${home}` : abs, inVault: false }
}

/** The command a coding agent's hook runs to send its JSON (on stdin) here; it never fails the hook. */
plugin.provide("activity:report", (agent: string, terminal: string) => {
  return hookCommand("activity/hook", { agent, terminal })
})
/** The same as a URL the hook POSTs its JSON to (Claude Code's http hooks on Windows). */
plugin.provide("activity:report-url", (agent: string, terminal: string) => `${serverUrl()}/api/activity/hook?${new URLSearchParams({ agent, terminal })}`)

plugin.route("POST", "activity/hook", async (req) => {
  const b = (req.body ?? {}) as Record<string, unknown>
  const agent = str(req.query.agent) || "claude-code"
  const tool = str(b.tool_name)
  const input = (b.tool_input ?? {}) as Record<string, unknown>
  const terminal = str(req.query.terminal)
  const term = terminal ? await terminalInfo(terminal) : str(req.query.session) ? { session: str(req.query.session).slice(0, 120) } : {}
  const sid = (str(b.session_id) || str(b.thread_id) || str(b["thread-id"]) || str(b.sessionID)).slice(0, 120) || parseTerminal(terminal)?.resume
  if (sid && terminal) sessionIds.set(terminal, [Date.now(), sid])
  const actor: Actor = { kind: "agent", name: nameOf(agent), ...term, ...(sid ? { sessionId: sid } : {}) }
  const t = Date.now()
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) {
    const file = str(input.file_path) || str(input.notebook_path)
    if (!file) return { ok: true }
    const { rel, inVault } = relOf(file)
    if (inVault) claim(rel)
    record({ t, actor, action: tool === "Write" ? "create" : "edit", text: `${tool === "Write" ? "Wrote" : "Edited"} ${rel}`, paths: inVault ? [rel] : [] })
  } else if (tool === "Bash" || tool === "PowerShell") {
    const cmd = str(input.command).split("\n")[0].slice(0, 200)
    if (cmd) record({ t, actor, action: "run", text: `Ran ${cmd}`, paths: [] })
  }
  return { ok: true }
}, { sync: false })

async function terminalInfo(id: string): Promise<{ terminal?: string; session?: string; sessionId?: string }> {
  const t = await plugin.ask<{ title?: string; session?: string } | null>("terminal:info", null, id)
  return { terminal: id, ...(t?.title ? { session: t.title } : {}), ...(t?.session ? { sessionId: t.session } : {}) }
}

const ACTIONS = new Set<Action>(["edit", "create", "delete", "move", "save", "settings", "pin", "ui", "read", "search", "run", "open", "command", "drop", "change", "request"])

plugin.route("POST", "activity", (req) => {
  const b = (req.body ?? {}) as Record<string, unknown>
  const list = Array.isArray(b.events) ? b.events.slice(0, 200) : []
  const device = str(b.device) || "web"
  let n = 0
  for (const x of list as Record<string, unknown>[]) {
    const text = str(x.text).slice(0, 300)
    if (!text) continue
    const action = ACTIONS.has(x.action as Action) ? x.action as Action : "request"
    const t = typeof x.t === "number" && Math.abs(x.t - Date.now()) < DAY ? x.t : Date.now()
    const paths = Array.isArray(x.paths) ? x.paths.filter((p): p is string => typeof p === "string").slice(0, 20) : []
    record({ t, actor: { kind: "you", name: "You", device }, action, text, paths })
    n++
  }
  return { ok: true, recorded: n }
}, { sync: false })

plugin.route("POST", "activity/perf", (req) => {
  const b = (req.body ?? {}) as ClientPerf & { spans?: unknown }
  const device = str(b.device) || "web"
  for (const s of Array.isArray(b.spans) ? b.spans.slice(0, 100) as Span[] : []) {
    const ok = s && typeof s.name === "string" && typeof s.t === "number" && typeof s.ms === "number" && s.parts && typeof s.parts === "object"
    if (ok) recordSpan({ name: s.name.slice(0, 40), t: s.t, ms: s.ms, parts: s.parts, tags: { ...(s.tags ?? {}), device } })
  }
  if (b.longTasks === undefined) return { ok: true }
  const was = clients.get(device)
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : undefined)
  const api = Array.isArray(b.api) ? b.api.slice(0, 50).filter((r) => r && typeof r.route === "string").map((r) => ({ route: r.route.slice(0, 80), n: num(r.n) ?? 0, p50: num(r.p50) ?? 0, max: num(r.max) ?? 0 })) : undefined
  const next: ClientPerf = { device, t: Date.now(),
    ttfb: num(b.ttfb) ?? was?.ttfb, ready: num(b.ready) ?? was?.ready, load: num(b.load) ?? was?.load, state: num(b.state) ?? was?.state,
    longTasks: num(b.longTasks) ?? 0, longMs: num(b.longMs) ?? 0, shift: typeof b.shift === "number" && isFinite(b.shift) && b.shift >= 0 ? Math.round(b.shift * 1000) / 1000 : 0,
    shifts: num(b.shifts) ?? 0, api: api ?? was?.api, heap: num(b.heap) ?? was?.heap }
  clients.set(device, next)
  return { ok: true }
}, { sync: false })
