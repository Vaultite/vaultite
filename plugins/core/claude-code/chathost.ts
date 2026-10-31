// Claude Code sessions run through the Agent SDK, each a streaming-input query kept open between turns, what it asks
// held until answered; chatd.ts runs this in a process that outlives the server, `listen` being its socket.
import crypto from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import type { CanUseTool, McpServerConfig, Options, PermissionResult, PermissionUpdate, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { type AskKind, type Entry, questionsOf, Reader, summarize } from "./chatlog.ts"

export type Mode = "default" | "acceptEdits" | "plan" | "auto" | "dontAsk" | "bypassPermissions"
export type Effort = "low" | "medium" | "high" | "xhigh" | "max"
export const MODES: Mode[] = ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"]
export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"]

/** A tool the server serves to a session (the companion's): the host relays each call to it ("tool" event, toolResult). */
export type ToolDef = { name: string; description: string; schema: { properties?: Record<string, unknown>; required?: string[] } }

/** How a session runs: its id (a new one's, or the one it resumes), folder, environment (CLAUDE_CONFIG_DIR picks the
 *  account), the claude to run, and what it starts with. */
export type Spec = {
  id: string; resume: boolean; cwd: string; env: Record<string, string>; claude?: string
  model?: string; effort?: Effort; mode?: Mode; append?: string; title?: string; tools?: ToolDef[]
  /** Who started it ("app", "inbox", a plugin's id): the inbox and the list say so. */
  by?: string; account?: string
  /** Its news stays out of the inbox (a plugin's own session). */
  quiet?: boolean
}

export type State = "starting" | "working" | "waiting" | "idle" | "error"
/** A session as the host tells it. `seq` counts the news the inbox hears (a turn started, ended, an ask); `told` is the
 *  last it heard, so a server that comes back tells only what it missed. */
export type Summary = {
  id: string; state: State; cwd: string; account: string; by: string; model: string; effort: string; mode: Mode
  started: number; at: number; asks: string[]; seq: number; told: number
  /** The last turn: what the user said, the answer's last text, and its error. */
  turn: { prompt: string; text: string; error?: string } | null
  error?: string; quiet?: boolean
}

/** A permission allowed (`always`: its rules too) or not (`message`: why); questions' answers (options from 1, or text;
 *  `message`: a reply instead); a plan approved (`mode`: the mode after it) or sent back with `message`. */
export type Answer = { allow?: boolean; always?: boolean; message?: string; answers?: (number[] | string)[]; mode?: Mode }

/** What the host tells its connections. */
export type Event =
  | { t: "put"; id: string; e: Entry }
  | { t: "state"; s: Summary }
  | { t: "gone"; id: string }
  | { t: "tool"; id: string; call: string; name: string; args: unknown }
  /** A file it edited or a command it ran, for Activity (as a terminal's hooks report). */
  | { t: "did"; id: string; tool: string; input: unknown }

/** What the host runs sessions with: the SDK's query, and an in-process MCP server of relayed tools. */
export type Sdk = {
  query: (p: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query
  mcp?: (name: string, tools: { name: string; description: string; schema: ToolDef["schema"]; run: (args: unknown) => Promise<unknown> }[]) => McpServerConfig
}

/** Minutes a session sits idle (no turn, nothing asked) before its claude process ends; the next message resumes it. */
const IDLE = 20 * 60_000
/** Entries a session keeps (the newest): the rest is in its transcript. */
const KEEP = 1500
/** How long a relayed tool call waits for the server. */
const TOOL_MS = 5 * 60_000

type Pending = { kind: AskKind; input: Record<string, unknown>; suggestions: PermissionUpdate[]; resolve: (r: PermissionResult) => void }

class Session {
  spec: Spec
  q: Query | null = null
  queue: SDKUserMessage[] = []
  wake: (() => void) | null = null
  ended = false
  reader = new Reader()
  asks = new Map<string, Pending>()
  s: Summary
  idle: ReturnType<typeof setTimeout> | null = null
  /** The user stopped its turn: the result that ends it says so, not why the SDK stopped. */
  stopping = false
  stderr: string[] = []
  constructor(spec: Spec) {
    this.spec = spec
    this.s = { id: spec.id, state: "starting", cwd: spec.cwd, account: spec.account ?? "", by: spec.by ?? "app", model: spec.model ?? "", effort: spec.effort ?? "",
      mode: spec.mode ?? "default", started: Date.now(), at: Date.now(), asks: [], seq: 0, told: 0, turn: null, ...(spec.quiet ? { quiet: true } : {}) }
  }
  /** What the user says, as the query takes it (it waits here between turns). */
  async *input(): AsyncGenerator<SDKUserMessage> {
    while (!this.ended) {
      const m = this.queue.shift()
      if (m) { yield m; continue }
      await new Promise<void>((r) => { this.wake = r })
      this.wake = null
    }
  }
}

export class Host {
  private sdk: Sdk
  private sessions = new Map<string, Session>()
  private listeners = new Set<(e: Event) => void>()
  private calls = new Map<string, { resolve: (v: unknown) => void; timer: ReturnType<typeof setTimeout> }>()
  log: (...a: unknown[]) => void
  constructor(sdk: Sdk, log: (...a: unknown[]) => void = () => {}) { this.sdk = sdk; this.log = log }

  on(fn: (e: Event) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private emit(e: Event) { for (const fn of this.listeners) try { fn(e) } catch (err) { this.log("listener:", err) } }

  /** Sessions with a claude process now. */
  get size() { return this.sessions.size }
  list(): Summary[] { return [...this.sessions.values()].map((x) => x.s) }
  read(id: string) {
    const x = this.sessions.get(id)
    return x ? { s: x.s, entries: [...x.reader.entries.values()] } : null
  }

  private session(id: string) {
    const x = this.sessions.get(id)
    if (!x || x.ended) throw new Error(`no session ${id} runs here`)
    return x
  }

  /** Start session `spec` (new, or resuming its id) with `prompt` as its first message, if any. */
  start(spec: Spec, prompt?: string): Summary {
    const old = this.sessions.get(spec.id)
    if (old && !old.ended) throw new Error(`session ${spec.id} already runs`)
    if (!spec.resume && !/^[0-9a-f-]{36}$/i.test(spec.id)) throw new Error("a new session's id is a UUID")
    const x = new Session(spec)
    this.sessions.set(spec.id, x)
    const opts: Options = {
      cwd: spec.cwd, env: { ...spec.env, CLAUDE_AGENT_SDK_CLIENT_APP: "vaultite" },
      ...(spec.claude ? { pathToClaudeCodeExecutable: spec.claude } : {}),
      ...(spec.resume ? { resume: spec.id } : { sessionId: spec.id }),
      ...(spec.model ? { model: spec.model } : {}), ...(spec.effort ? { effort: spec.effort } : {}),
      ...(spec.mode ? { permissionMode: spec.mode } : {}),
      // (only so the picker can switch to it later, as the TUI's --allow-dangerously-skip-permissions does)
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true, thinking: { type: "adaptive", display: "summarized" },
      systemPrompt: { type: "preset", preset: "claude_code", ...(spec.append ? { append: spec.append } : {}) },
      settingSources: ["user", "project", "local"],
      ...(spec.title && !spec.resume ? { title: spec.title } : {}),
      canUseTool: this.asker(x),
      hooks: {
        PostToolUse: [{ matcher: "^(Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell)$", hooks: [async (h) => {
          if (h.hook_event_name === "PostToolUse") this.emit({ t: "did", id: spec.id, tool: h.tool_name, input: h.tool_input })
          this.effortOf(x, h)
          return {}
        }] }],
        Stop: [{ hooks: [async (h) => { this.effortOf(x, h); return {} }] }],
      },
      stderr: (d: string) => { x.stderr.push(d); if (x.stderr.length > 40) x.stderr.shift() },
    }
    const tools = spec.tools?.length && this.sdk.mcp ? this.sdk.mcp("vaultite-app", spec.tools.map((t) => ({ ...t, run: (args: unknown) => this.relay(spec.id, t.name, args) }))) : null
    if (tools) opts.mcpServers = { "vaultite-app": tools }
    try {
      x.q = this.sdk.query({ prompt: x.input(), options: opts })
    } catch (e) {
      this.sessions.delete(spec.id)
      throw e
    }
    void this.run(x)
    if (prompt) this.send(spec.id, prompt)
    else this.state(x, "idle")
    return x.s
  }

  /** The user's message to session `id` (`uuid`: its id in the transcript), queued while a turn runs; while it asks
   *  something it's the answer: what to do instead (a permission, a plan), or a reply in place of its questions. */
  send(id: string, text: string, uuid: string = crypto.randomUUID()) {
    const x = this.session(id)
    if (!text.trim()) throw new Error("nothing to send")
    const asked = [...x.asks.keys()].at(-1)
    if (asked) { this.answer(id, asked, { allow: false, message: text.trim() }); return { uuid: "", answered: asked } }
    const at = new Date().toISOString()
    x.queue.push({ type: "user", uuid, session_id: id, parent_tool_use_id: null, message: { role: "user", content: text }, timestamp: at } as SDKUserMessage)
    x.wake?.()
    for (const e of x.reader.feed({ type: "user", uuid, message: { content: text }, timestamp: at })) this.put(x, e)
    this.state(x, "working", true)
    return { uuid }
  }

  async interrupt(id: string) {
    const x = this.session(id)
    x.stopping = x.s.state === "working" || x.s.state === "waiting"
    await x.q?.interrupt()
  }

  /** Change how it runs from now: the model, its effort, the permission mode. */
  async set(id: string, o: { model?: string; effort?: Effort; mode?: Mode }) {
    const x = this.session(id)
    if (o.model) { await x.q?.setModel(o.model); x.spec.model = x.s.model = o.model }
    if (o.effort) { await x.q?.applyFlagSettings({ effortLevel: o.effort }); x.spec.effort = o.effort; x.s.effort = o.effort }
    if (o.mode) { await x.q?.setPermissionMode(o.mode); x.spec.mode = x.s.mode = o.mode }
    this.emit({ t: "state", s: x.s })
    return x.s
  }

  /** End its claude process (the session stays in its transcript, to resume). */
  stop(id: string) {
    const x = this.sessions.get(id)
    if (!x) return false
    this.end(x)
    return true
  }

  /** The inbox heard the news up to `seq`. */
  told(id: string, seq: number) {
    const x = this.sessions.get(id)
    if (x && seq > x.s.told) x.s.told = Math.min(seq, x.s.seq)
  }

  answer(id: string, ask: string, a: Answer) {
    const x = this.session(id)
    const p = x.asks.get(ask)
    if (!p) throw new Error("it doesn't ask that any more")
    x.asks.delete(ask)
    const e = x.reader.entries.get(ask)
    let said: string, r: PermissionResult
    if (p.kind === "permission") {
      r = a.allow ? { behavior: "allow", updatedInput: p.input, ...(a.always && p.suggestions.length ? { updatedPermissions: p.suggestions } : {}) }
        : { behavior: "deny", message: a.message ? `The user said no, and to do this instead: ${a.message}` : "The user said no." }
      said = a.allow ? (a.always ? "Always allowed" : "Allowed") : a.message ? `Denied: ${a.message}` : "Denied"
    } else if (p.kind === "question") {
      const qs = questionsOf(p.input), raw = Array.isArray(p.input.questions) ? p.input.questions as { question?: string; options?: { label?: string }[] }[] : []
      if (a.answers) {
        if (a.answers.length !== qs.length) throw new Error(`an answer for each of its ${qs.length} questions`)
        const answers = Object.fromEntries(raw.map((q, i) => {
          const c = a.answers![i]
          return [String(q.question ?? ""), typeof c === "string" ? c : c.map((n) => String(q.options?.[n - 1]?.label ?? "")).filter(Boolean).join(", ")]
        }))
        r = { behavior: "allow", updatedInput: { ...p.input, answers } }
        said = `Answered: ${Object.values(answers).join("; ")}`
      } else if (a.message) {
        r = { behavior: "allow", updatedInput: { ...p.input, answers: {}, response: a.message } }
        said = `Replied: ${a.message}`
      } else throw new Error("answers: one for each question")
    } else {
      r = a.allow ? { behavior: "allow", updatedInput: p.input } : { behavior: "deny", message: a.message || "The user wants to keep planning: don't start yet." }
      said = a.allow ? "Approved" : a.message ? `Kept planning: ${a.message}` : "Kept planning"
    }
    p.resolve(r)
    if (e?.k === "ask") this.put(x, { ...e, answer: said })
    x.s.asks = [...x.asks.keys()]
    if (!x.asks.size) this.state(x, "working", true)
    if (p.kind === "plan" && a.allow && a.mode) void this.set(id, { mode: a.mode }).catch((err) => this.log("plan mode:", err))
    return x.s
  }

  /** A relayed tool's answer from the server. */
  toolResult(call: string, result: unknown) {
    const c = this.calls.get(call)
    if (!c) return
    clearTimeout(c.timer)
    this.calls.delete(call)
    c.resolve(result)
  }

  private relay(id: string, name: string, args: unknown) {
    const call = crypto.randomUUID()
    return new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => { this.calls.delete(call); resolve({ isError: true, content: [{ type: "text", text: "Vaultite didn't answer" }] }) }, TOOL_MS)
      timer.unref?.()
      this.calls.set(call, { resolve, timer })
      this.emit({ t: "tool", id, call, name, args })
    })
  }

  /** canUseTool: an ask (a permission, its questions, its plan) held until the user answers it, or the turn is stopped. */
  private asker(x: Session): CanUseTool {
    return (tool, input, o) => new Promise<PermissionResult>((resolve) => {
      const kind: AskKind = tool === "AskUserQuestion" ? "question" : tool === "ExitPlanMode" ? "plan" : "permission"
      const id = `ask:${o.toolUseID}`
      const always = kind === "permission" && !o.suppressAlwaysAllowRule && o.suggestions?.length ? alwaysText(o.suggestions) : ""
      const plan = kind === "plan" && typeof input.plan === "string" ? input.plan : undefined
      const e: Entry = { k: "ask", id, kind, tool, at: new Date().toISOString(), input,
        title: kind === "question" ? "Claude has a question" : kind === "plan" ? "Claude has a plan" : o.title || wants(tool, input),
        ...(o.description ? { detail: o.description } : kind === "permission" && summarize(tool, input) ? { detail: summarize(tool, input) } : {}),
        ...(kind === "question" ? { questions: questionsOf(input) } : {}), ...(plan ? { plan } : {}), ...(always ? { always } : {}) }
      x.asks.set(id, { kind, input, suggestions: o.suggestions ?? [], resolve })
      this.put(x, e)
      x.s.asks = [...x.asks.keys()]
      this.state(x, "waiting", true)
      o.signal.addEventListener("abort", () => {
        if (!x.asks.delete(id)) return
        x.s.asks = [...x.asks.keys()]
        this.put(x, { ...e, answer: "Stopped" })
        resolve({ behavior: "deny", message: "Stopped" })
      }, { once: true })
    })
  }

  /** The effort Claude Code applies (a hook's word for it), shown till one is chosen. */
  private effortOf(x: Session, h: unknown) {
    const level = (h as { effort?: { level?: unknown } }).effort?.level
    if (typeof level !== "string" || x.spec.effort || x.s.effort === level) return
    x.s.effort = level
    this.emit({ t: "state", s: x.s })
  }

  private async run(x: Session) {
    try {
      for await (const m of x.q!) this.message(x, m)
      if (!x.ended) this.fail(x, lastLines(x.stderr) || "Claude Code ended")
    } catch (e) {
      if (!x.ended) this.fail(x, lastLines(x.stderr) || String((e as Error)?.message ?? e))
    }
  }

  private message(x: Session, m: SDKMessage) {
    x.s.at = Date.now()
    if (m.type === "system" && m.subtype === "init") {
      x.s.model = m.model || x.s.model
      x.s.mode = (m.permissionMode as Mode) || x.s.mode
      x.s.cwd = m.cwd || x.s.cwd
      if (m.effort && !x.spec.effort) x.s.effort = m.effort
      this.emit({ t: "state", s: x.s })
    } else if (m.type === "system" && m.subtype === "status" && m.permissionMode && m.permissionMode !== x.s.mode) {
      x.s.mode = m.permissionMode as Mode
      this.emit({ t: "state", s: x.s })
    }
    const stopped = m.type === "result" && x.stopping
    for (const e of x.reader.feed(m)) this.put(x, stopped && e.k === "result" ? { k: "note", id: e.id, text: "Stopped", at: e.at } : e)
    if (m.type === "result") {
      x.stopping = false
      // (what was streaming when it stopped is as far as it got)
      for (const e of [...x.reader.entries.values()]) if ("live" in e && e.live) this.put(x, { ...e, live: undefined })
      const error = stopped || (m.subtype === "success" && !m.is_error) ? undefined : (x.reader.entries.get(String(m.uuid)) as { error?: string } | undefined)?.error
      x.s.turn = { prompt: x.reader.prompt, text: x.reader.text, ...(error ? { error } : {}) }
      // (another message sent while it worked starts the next turn at once)
      if (!x.asks.size) this.state(x, x.queue.length ? "working" : "idle", true)
    }
  }

  private put(x: Session, e: Entry) {
    x.reader.entries.set(e.id, e)
    if (x.reader.entries.size > KEEP) {
      const first = x.reader.entries.keys().next().value
      if (first !== undefined && first !== e.id) x.reader.entries.delete(first)
    }
    this.emit({ t: "put", id: x.s.id, e })
  }

  /** Its state now; `news`: what the inbox hears (a turn starting or ending, an ask). */
  private state(x: Session, state: State, news = false) {
    if (x.s.state === state && !news) return
    x.s.state = state
    if (state !== "error") delete x.s.error
    if (news) x.s.seq++
    x.s.at = Date.now()
    this.idleTimer(x, state === "idle")
    this.emit({ t: "state", s: x.s })
  }

  private fail(x: Session, why: string) {
    x.s.error = why.slice(0, 600)
    x.s.turn = { prompt: x.reader.prompt, text: x.reader.text, error: x.s.error }
    this.state(x, "error", true)
    this.end(x, false)
  }

  private idleTimer(x: Session, on: boolean) {
    if (x.idle) clearTimeout(x.idle)
    x.idle = null
    if (!on) return
    x.idle = setTimeout(() => { if (x.s.state === "idle" && !x.asks.size && !x.queue.length) this.end(x) }, IDLE)
    x.idle.unref?.()
  }

  /** Its process ends; `gone`: it's no longer listed (an error stays listed, to be seen, until the next one starts). */
  private end(x: Session, gone = true) {
    if (x.ended && !gone) return
    x.ended = true
    if (x.idle) clearTimeout(x.idle)
    for (const [id, p] of x.asks) { p.resolve({ behavior: "deny", message: "The session ended" }); x.asks.delete(id) }
    x.wake?.()
    try { x.q?.close() } catch { /* ended */ }
    x.q = null
    if (!gone) return
    if (this.sessions.get(x.s.id) === x) this.sessions.delete(x.s.id)
    this.emit({ t: "gone", id: x.s.id })
  }

  /** A session that failed is listed until `forget` or another start. */
  forget(id: string) {
    const x = this.sessions.get(id)
    if (x?.ended) { this.sessions.delete(id); this.emit({ t: "gone", id }) }
  }

  close() { for (const x of [...this.sessions.values()]) this.end(x) }
}

/** What a permission is for, in words: "Claude wants to run a command", "to edit app.ts". */
function wants(tool: string, input: Record<string, unknown>) {
  const file = typeof input.file_path === "string" ? path.basename(input.file_path) : ""
  if (tool === "Bash" || tool === "PowerShell") return "Claude wants to run a command"
  if ((tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") && file) return `Claude wants to edit ${file}`
  if (tool === "Write" && file) return `Claude wants to write ${file}`
  if (tool === "Read" && file) return `Claude wants to read ${file}`
  if (tool === "WebFetch" && typeof input.url === "string") return `Claude wants to open ${input.url.replace(/^https?:\/\//, "").slice(0, 80)}`
  if (tool.startsWith("mcp__")) return `Claude wants to use ${tool.split("__").slice(2).join(" ").replace(/_/g, " ")} (${tool.split("__")[1]})`
  return `Claude wants to use ${tool}`
}

/** What Always allow allows, in words: "Bash(git push:*)" as "git push commands", a folder's edits. */
function alwaysText(ups: PermissionUpdate[]) {
  const said = ups.flatMap((u) => u.type === "addRules" && u.behavior === "allow" ? u.rules.map((r) => {
    const c = r.ruleContent?.replace(/:\*$/, "").trim()
    if (r.toolName === "Bash" && c) return `\`${c}\` commands`
    if (c) return `${r.toolName} on ${c}`
    return r.toolName
  }) : u.type === "addDirectories" ? u.directories.map((d) => `files in ${path.basename(d) || d}`) : u.type === "setMode" ? [u.mode === "acceptEdits" ? "edits" : u.mode] : [])
  return said.length ? said.join(", ").slice(0, 200) : "this from now on"
}

const lastLines = (lines: string[]) => lines.join("").trim().split("\n").slice(-4).join("\n").slice(0, 600)

// ---------- the socket: requests {op, re, ...} answered {re, ...} or {re, error}; `follow` hears every Event

/** Serve `host` at socket `sock` (a Unix socket, or a named pipe on Windows), until `stop`. */
export function listen(host: Host, sock: string, o: { log?: (...a: unknown[]) => void; hello?: () => Record<string, unknown> } = {}) {
  const conns = new Set<net.Socket>(), followers = new Set<net.Socket>()
  const send = (c: net.Socket, m: object) => { if (!c.destroyed) c.write(JSON.stringify(m) + "\n") }
  host.on((e) => { for (const c of followers) send(c, e) })
  const handle = async (c: net.Socket, m: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const id = String(m.id ?? "")
    switch (m.op) {
      case "hello": return { v: 1, pid: process.pid, ...o.hello?.() }
      case "follow": followers.add(c); return { sessions: host.list() }
      case "list": return { sessions: host.list() }
      case "read": { const r = host.read(id); if (!r) throw new Error(`no session ${id} runs here`); return r }
      case "start": return { s: host.start(m.spec as Spec, typeof m.prompt === "string" ? m.prompt : undefined) }
      case "send": return { ...host.send(id, String(m.text ?? ""), typeof m.uuid === "string" ? m.uuid : undefined) }
      case "interrupt": await host.interrupt(id); return {}
      case "set": return { s: await host.set(id, m as { model?: string; effort?: Effort; mode?: Mode }) }
      case "answer": return { s: host.answer(id, String(m.ask ?? ""), (m.answer ?? {}) as Answer) }
      case "stop": return { stopped: host.stop(id) }
      case "forget": host.forget(id); return {}
      case "told": host.told(id, Number(m.seq) || 0); return {}
      case "tool-result": host.toolResult(String(m.call ?? ""), m.result); return {}
      default: throw new Error(`unknown op '${m.op}'`)
    }
  }
  const server = net.createServer((c) => {
    conns.add(c)
    let buf = ""
    c.setEncoding("utf8")
    c.on("data", (chunk: string) => {
      buf += chunk
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        let m: Record<string, unknown>
        try { m = JSON.parse(line) } catch { continue }
        handle(c, m).then((out) => { if (m.re !== undefined) send(c, { re: m.re, ...out }) },
          (e) => { if (m.re !== undefined) send(c, { re: m.re, error: String((e as Error)?.message ?? e) }) })
      }
    })
    const gone = () => { conns.delete(c); followers.delete(c) }
    c.on("close", gone)
    c.on("error", gone)
  })
  if (process.platform !== "win32") { try { fs.rmSync(sock, { force: true }) } catch { /* none */ } fs.mkdirSync(path.dirname(sock), { recursive: true }) }
  server.listen(sock, () => { if (process.platform !== "win32") try { fs.chmodSync(sock, 0o600) } catch { /* the folder is the user's anyway */ } })
  return {
    server, conns: () => conns.size,
    stop: () => new Promise<void>((r) => { for (const c of conns) c.destroy(); server.close(() => r()) }),
  }
}
