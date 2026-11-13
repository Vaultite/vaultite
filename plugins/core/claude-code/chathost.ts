import crypto from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import type { CanUseTool, HookInput, McpServerConfig, Options, PermissionResult, PermissionUpdate, Query, SDKControlInterruptResponse, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import type { JSONSchema } from "zod/v4/core"
import { type AskKind, type Entry, IMAGE_MAX, IMAGES_MAX, imageType, questionsOf, Reader, summarize } from "./chatlog.ts"
import { type Answer, type Effort, type Event, issues, type Mode, type Op, type Reply, Request, type Spec, type State, type Summary, type ToolDef, ToolResult, type Uuid } from "./chatprotocol.ts"
import { isRecord } from "./inputs.ts"

// Claude Code's terminal picker's words for Chat about this
const CHAT = "The user wants to clarify these questions. They may have more context or questions for you: take their " +
  "response into account, then ask again if it still applies. Start by asking them what they would like to clarify."

export type Running = AsyncIterable<SDKMessage> & Pick<Query, "interrupt" | "setModel" | "applyFlagSettings" | "setPermissionMode" | "close">
export type Sdk = {
  query: (p: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Running
  mcp?: (name: string, tools: { name: string; description: string; schema: ToolDef["schema"]; run: (args: unknown, use?: string) => Promise<ToolResult> }[]) => McpServerConfig
}

const isJsonSchema = (v: unknown): v is JSONSchema.JSONSchema => isRecord(v)

export function relayed(create: typeof import("@anthropic-ai/claude-agent-sdk")["createSdkMcpServer"], fromJSONSchema: typeof import("zod")["fromJSONSchema"]): NonNullable<Sdk["mcp"]> {
  const shapeOf = (schema: ToolDef["schema"]) => Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, s]) => {
    const z = fromJSONSchema(isJsonSchema(s) ? s : {})
    return [k, schema.required?.includes(k) ? z : z.optional()]
  }))
  // alwaysLoad: behind tool search the model reached for the shell instead
  return (name, tools) => create({ name, alwaysLoad: true, tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: shapeOf(t.schema),
    // Claude Code names the call's tool_use id in its _meta
    handler: async (args: unknown, extra: unknown) => await t.run(args, toolUseIdOf(extra)) })) })
}

const toolUseIdOf = (extra: unknown) => {
  const meta = isRecord(extra) ? extra._meta : undefined, u = isRecord(meta) ? meta["claudecode/toolUseId"] : undefined
  return typeof u === "string" ? u : undefined
}
export function codeOf(dir: string) {
  const h = crypto.createHash("sha256")
  for (const f of ["chatd.ts", "chathost.ts", "chatlog.ts", "chatprotocol.ts", "inputs.ts"]) { try { h.update(fs.readFileSync(path.join(dir, f))) } catch {} h.update("\0") }
  return h.digest("hex").slice(0, 16)
}

const APP = "mcp__vaultite-app__"

const NO = "Not run: the user said no to it (or moved on from it). Tell them you left it, in a few words (it was their no: no hooks or blocks), and don't try it another way."
const SECRET = "That reads keys or secrets (Keychains, ~/.ssh, tokens, Vaultite's own secrets): never, whoever asks. Say you may not."
const shellOf = (tool: string, input: unknown) => (tool === "Bash" && isRecord(input) && typeof input.command === "string" ? input.command : null)
export function callKey(tool: string, input: unknown) {
  const cmd = shellOf(tool, input)
  return `${tool}\0${cmd !== null ? cmd.trim().replace(/\s+/g, " ") : JSON.stringify(input)}`
}

const IDLE = 20 * 60_000
const KEEP = 1500
const TOOL_MS = 5 * 60_000, CONFIRM_MS = 11 * 60_000

type Pending = { kind: AskKind; input: Record<string, unknown>; suggestions: PermissionUpdate[]; resolve: (r: PermissionResult) => void }

class Session {
  spec: Spec
  q: Running | null = null
  queue: SDKUserMessage[] = []
  wake: (() => void) | null = null
  ended = false
  reader = new Reader()
  asks = new Map<string, Pending>()
  s: Summary
  idle: ReturnType<typeof setTimeout> | null = null
  background = 0
  stopping = false
  stderr: string[] = []
  streams = new Map<number, { use: string; name: string; json: string }>()
  message = ""
  ending = new Set<string>()
  answered = new Map<string, { yes: boolean; message?: string }[]>()
  declined = false
  constructor(spec: Spec) {
    this.spec = spec
    this.s = { id: spec.id, state: "starting", cwd: spec.cwd, account: spec.account ?? "", by: spec.by ?? "app", model: spec.model ?? "", effort: spec.effort ?? "",
      mode: spec.mode ?? "default", started: Date.now(), at: Date.now(), asks: [], seq: 0, told: 0, turn: null, background: 0, ...(spec.quiet ? { quiet: true } : {}) }
  }
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
  private calls = new Map<string, { resolve: (v: unknown) => void; timer: ReturnType<typeof setTimeout>; e: Extract<Event, { t: "tool" }> }>()
  log: (...a: unknown[]) => void
  idleMs = IDLE
  constructor(sdk: Sdk, log: (...a: unknown[]) => void = () => {}) { this.sdk = sdk; this.log = log }

  on(fn: (e: Event) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private emit(e: Event) { for (const fn of this.listeners) try { fn(e) } catch (err) { this.log("listener:", err) } }

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

  start(spec: Spec, prompt?: string, images: string[] = [], uuid?: Uuid): Summary {
    const content = prompt || images.length ? withImages(prompt ?? "", images) : null
    const old = this.sessions.get(spec.id)
    if (old && !old.ended) throw new Error(`session ${spec.id} already runs`)
    if (!spec.resume && !/^[0-9a-f-]{36}$/i.test(spec.id)) throw new Error("a new session's id is a UUID")
    const x = new Session(spec)
    this.sessions.set(spec.id, x)
    const ends = (spec.tools ?? []).filter((t) => t.ends).map((t) => APP + t.name).join(",")
    const opts: Options = {
      cwd: spec.cwd, env: { ...spec.env, CLAUDE_AGENT_SDK_CLIENT_APP: "vaultite", ...(ends ? { CLAUDE_CODE_TERMINAL_MCP_TOOLS: ends } : {}) },
      ...(spec.claude ? { pathToClaudeCodeExecutable: spec.claude } : {}),
      ...(spec.resume ? { resume: spec.id } : { sessionId: spec.id }),
      ...(spec.model ? { model: spec.model } : {}), ...(spec.effort ? { effort: spec.effort } : {}),
      ...(spec.mode ? { permissionMode: spec.mode } : {}), ...(spec.allowed?.length ? { allowedTools: spec.allowed } : {}),
      ...(spec.denied?.length ? { disallowedTools: spec.denied } : {}), ...(spec.dirs?.length ? { additionalDirectories: spec.dirs } : {}),
      // the SDK switches a session to bypassPermissions later only when it started with this
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true, thinking: spec.quick ? { type: "disabled" } : { type: "adaptive", display: "summarized" },
      ...(spec.system !== undefined
        ? { systemPrompt: spec.system, settingSources: [], strictMcpConfig: true, tools: spec.builtins ?? [] }
        : { systemPrompt: { type: "preset", preset: "claude_code", ...(spec.append ? { append: spec.append } : {}) }, settingSources: ["user", "project", "local"] }),
      ...(spec.title && !spec.resume ? { title: spec.title } : {}),
      canUseTool: this.asker(x),
      ...(spec.autoMode ? { settings: { autoMode: spec.autoMode } } : {}),
      hooks: {
        ...this.gate(x),
        PostToolUse: [{ matcher: "^(Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell)$", hooks: [async (h) => {
          if (h.hook_event_name === "PostToolUse") this.emit({ t: "did", id: spec.id, tool: h.tool_name, input: h.tool_input })
          this.effortOf(x, h)
          return {}
        }] },
        { matcher: `^${APP}`, hooks: [async (h) => (h.hook_event_name === "PostToolUse" && x.ending.delete(h.tool_use_id) ? { continue: false, suppressOutput: true } : {})] }],
        Stop: [{ hooks: [async (h) => { this.effortOf(x, h); return {} }] }],
      },
      stderr: (d: string) => { x.stderr.push(d); if (x.stderr.length > 40) x.stderr.shift() },
    }
    const shown = spec.tools?.filter((t) => !t.hidden)
    const tools = shown?.length && this.sdk.mcp ? this.sdk.mcp("vaultite-app", shown.map((t) => ({ ...t, run: async (args: unknown, use?: string): Promise<ToolResult> => {
      const r = ToolResult.safeParse(await this.relay(spec.id, t.name, args, use))
      if (!r.success) return { isError: true, content: [{ type: "text", text: `Vaultite's answer isn't a tool's result: ${issues(r.error)}` }] }
      const { endsTurn, ...rest } = r.data
      if (endsTurn === true && use) x.ending.add(use)
      return rest
    } }))) : null
    if (tools) opts.mcpServers = { "vaultite-app": tools }
    try {
      x.q = this.sdk.query({ prompt: x.input(), options: opts })
    } catch (e) {
      this.sessions.delete(spec.id)
      throw e
    }
    void this.run(x)
    if (content) this.said(x, prompt ?? "", images.length, uuid ?? crypto.randomUUID(), content)
    else this.state(x, "idle")
    return x.s
  }

  send(id: string, text: string, uuid: Uuid = crypto.randomUUID(), images: string[] = []) {
    const x = this.session(id)
    if (!text.trim() && !images.length) throw new Error("nothing to send")
    const content = withImages(text.trim(), images)
    const asked = [...x.asks.keys()].at(-1)
    if (asked && !images.length) { this.answer(id, asked, { allow: false, message: text.trim() }); return { uuid: "", answered: asked } }
    if (asked) this.answer(id, asked, { allow: false, message: PICTURES }, "Answered in the message below")
    this.said(x, text.trim(), images.length, uuid, content)
    return { uuid, ...(asked ? { answered: asked } : {}) }
  }

  private said(x: Session, text: string, pictures: number, uuid: Uuid, content: SDKUserMessage["message"]["content"]) {
    const at = new Date().toISOString(), id = x.s.id
    x.declined = false
    x.answered.clear()
    x.queue.push({ type: "user", uuid, session_id: id, parent_tool_use_id: null, message: { role: "user", content }, timestamp: at })
    x.wake?.()
    const shown = [...Array.from({ length: pictures }, () => ({ type: "image" })), ...(text ? [{ type: "text", text }] : [])]
    for (const e of x.reader.feed({ type: "user", uuid, message: { content: shown }, timestamp: at })) this.put(x, e)
    this.state(x, "working", true)
  }

  async interrupt(id: string) {
    const x = this.session(id)
    x.stopping = x.s.state === "working" || x.s.state === "waiting"
    // (cancelQueued: the SDK's, though its type doesn't list it yet)
    const q: { interrupt(o?: { cancelQueued: boolean }): Promise<SDKControlInterruptResponse | undefined> } | null = x.q
    const r = await q?.interrupt({ cancelQueued: true })
    const taken: Extract<Entry, { k: "user" }>[] = []
    for (const uuid of r?.cancelled ?? []) {
      const e = x.reader.entries.get(uuid)
      if (e?.k !== "user") continue
      taken.push(e)
      x.reader.entries.delete(uuid)
      this.emit({ t: "drop", id, e: uuid })
    }
    return { taken }
  }

  async set(id: string, o: { model?: string; effort?: Effort; mode?: Mode }) {
    const x = this.session(id)
    if (o.model) { await x.q?.setModel(o.model); x.spec.model = x.s.model = o.model }
    if (o.effort) { await x.q?.applyFlagSettings({ effortLevel: o.effort }); x.spec.effort = o.effort; x.s.effort = o.effort }
    if (o.mode) { await x.q?.setPermissionMode(o.mode); x.spec.mode = x.s.mode = o.mode }
    this.emit({ t: "state", s: x.s })
    return x.s
  }

  stop(id: string) {
    const x = this.sessions.get(id)
    if (!x) return false
    this.end(x)
    return true
  }

  told(id: string, seq: number) {
    const x = this.sessions.get(id)
    if (x && seq > x.s.told) x.s.told = Math.min(seq, x.s.seq)
  }

  answer(id: string, ask: string, a: Answer, shown?: string) {
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
      const qs = questionsOf(p.input), raw: unknown[] = Array.isArray(p.input.questions) ? p.input.questions : []
      if (a.answers) {
        if (a.answers.length !== qs.length) throw new Error(`an answer for each of its ${qs.length} questions`)
        const answers = Object.fromEntries(raw.map((q, i) => {
          const c = a.answers![i], [ns, text] = typeof c === "string" ? [[], c] : Array.isArray(c) ? [c, ""] : [c.options, c.text]
          const labels = (isRecord(q) && Array.isArray(q.options) ? q.options : []).map((o) => (isRecord(o) ? o.label : undefined))
          return [String((isRecord(q) ? q.question : undefined) ?? ""), [...ns.map((n) => String(labels[n - 1] ?? "")), text].filter(Boolean).join(", ")]
        }))
        r = { behavior: "allow", updatedInput: { ...p.input, answers } }
        said = `Answered: ${Object.values(answers).join("; ")}`
      } else if (a.chat) {
        r = { behavior: "deny", message: CHAT }
        said = "Chat about this"
      } else if (a.message) {
        r = { behavior: "allow", updatedInput: { ...p.input, answers: {}, response: a.message } }
        said = `Replied: ${a.message}`
      } else throw new Error("answers: one for each question")
    } else {
      r = a.allow ? { behavior: "allow", updatedInput: p.input } : { behavior: "deny", message: a.message || "The user wants to keep planning: don't start yet." }
      said = a.allow ? "Approved" : a.message ? `Kept planning: ${a.message}` : "Kept planning"
    }
    p.resolve(r)
    if (e?.k === "ask") this.put(x, { ...e, answer: shown ?? said })
    x.s.asks = [...x.asks.keys()]
    if (!x.asks.size) this.state(x, "working", true)
    if (p.kind === "plan" && a.allow && a.mode) void this.set(id, { mode: a.mode }).catch((err) => this.log("plan mode:", err))
    return x.s
  }

  toolResult(call: string, result: unknown) {
    const c = this.calls.get(call)
    if (!c) return
    clearTimeout(c.timer)
    this.calls.delete(call)
    c.resolve(result)
  }

  pendingCalls() { return [...this.calls.values()].map((c) => c.e) }

  private relay(id: string, name: string, args: unknown, use?: string, ms = TOOL_MS) {
    const call = crypto.randomUUID(), e = { t: "tool" as const, id, call, name, args, ...(use ? { use } : {}) }
    return new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => { this.calls.delete(call); resolve({ isError: true, content: [{ type: "text", text: "Vaultite didn't answer" }] }) }, ms)
      timer.unref?.()
      this.calls.set(call, { resolve, timer, e })
      this.emit(e)
    })
  }

  private asker(x: Session): CanUseTool {
    return (tool, input, o) => (x.spec.confirm && tool !== "AskUserQuestion" && tool !== "ExitPlanMode"
      ? this.confirmed(x, tool, input, o.decisionReason ?? o.title ?? "", false, o.toolUseID).then((a): PermissionResult => (a.yes
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: a.message ?? NO }))
      : new Promise<PermissionResult>((resolve) => {
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
        if (!x.asks.size && !x.ended && !x.stopping) this.state(x, "working", true)
      }, { once: true })
    }))
  }

  private async confirmed(x: Session, tool: string, input: unknown, reason: string, blocked: boolean, use?: string): Promise<{ yes: boolean; message?: string }> {
    if (x.declined) return { yes: false }
    const r = await this.relay(x.spec.id, x.spec.confirm!, { tool, input, reason, blocked }, use, CONFIRM_MS)
    const a = { yes: isRecord(r) && r.yes === true, ...(isRecord(r) && typeof r.message === "string" ? { message: r.message } : {}) }
    if (!a.yes) x.declined = true
    return a
  }

  private gate(x: Session): NonNullable<Options["hooks"]> {
    const { confirm, never } = x.spec
    if (!confirm && !never?.length) return {}
    const nevers = (never ?? []).map((n) => new RegExp(n, "i"))
    const decide = (allow: boolean, why: string) => ({ hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: allow ? "allow" as const : "deny" as const, permissionDecisionReason: why } })
    return {
      PreToolUse: [{ hooks: [async (h) => {
        if (h.hook_event_name !== "PreToolUse") return {}
        const cmd = shellOf(h.tool_name, h.tool_input)
        if (cmd !== null && nevers.some((n) => n.test(cmd))) return decide(false, SECRET)
        const k = callKey(h.tool_name, h.tool_input), a = x.answered.get(k)?.shift()
        if (x.answered.get(k)?.length === 0) x.answered.delete(k)
        if (a) return decide(a.yes, a.yes ? "the user said yes to it" : a.message ?? NO)
        return cmd !== null && x.declined ? decide(false, NO) : {}
      }] }],
      ...(confirm ? { PermissionDenied: [{ timeout: CONFIRM_MS / 1000, hooks: [async (h) => {
        if (h.hook_event_name !== "PermissionDenied") return {}
        const a = await this.confirmed(x, h.tool_name, h.tool_input, h.reason, true, h.tool_use_id), k = callKey(h.tool_name, h.tool_input)
        x.answered.set(k, [...x.answered.get(k) ?? [], a])
        return { hookSpecificOutput: { hookEventName: "PermissionDenied" as const, retry: true } }
      }] }] } : {}),
    }
  }

  private effortOf(x: Session, h: HookInput) {
    const level = h.effort?.level
    if (!level || x.spec.effort || x.s.effort === level) return
    x.s.effort = level
    this.emit({ t: "state", s: x.s })
  }

  private async run(x: Session) {
    try {
      for await (const m of x.q!) this.message(x, m)
      if (!x.ended) this.fail(x, lastLines(x.stderr) || "Claude Code ended")
    } catch (e) {
      if (!x.ended) this.fail(x, lastLines(x.stderr) || (e instanceof Error ? e.message : String(e)))
    }
  }

  private message(x: Session, m: SDKMessage) {
    x.s.at = Date.now()
    if (m.type === "system" && m.subtype === "init") {
      x.s.model = m.model || x.s.model
      x.s.mode = m.permissionMode || x.s.mode
      x.s.cwd = m.cwd || x.s.cwd
      if (m.effort && !x.spec.effort) x.s.effort = m.effort
      this.emit({ t: "state", s: x.s })
    } else if (m.type === "system" && m.subtype === "status" && m.permissionMode && m.permissionMode !== x.s.mode) {
      x.s.mode = m.permissionMode
      this.emit({ t: "state", s: x.s })
    } else if (m.type === "system" && m.subtype === "background_tasks_changed") {
      const was = x.background
      x.background = x.s.background = m.tasks.filter((t) => !t.ambient).length
      if (was !== x.background) this.emit({ t: "state", s: x.s })
      if (was && !x.background && x.s.state === "idle") this.idleTimer(x, true)
    }
    if (m.type === "assistant" && !m.parent_tool_use_id) {
      const u = m.message.usage
      const n = (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0)
      if (n) x.s.context = n
    }
    // the SDK sends a queued message at once: only a new answer starting says a turn runs
    const begun = m.type === "assistant" || (m.type === "stream_event" && m.event.type === "message_start")
    if (begun && !m.parent_tool_use_id && x.s.state === "idle") this.state(x, "working", true)
    this.streamed(x, m)
    const stopped = m.type === "result" && x.stopping
    const said = stopped && interrupted([...x.reader.entries.values()])
    for (const e of x.reader.feed(m)) {
      if (stopped && e.k === "result") { if (said) x.reader.entries.delete(e.id); else this.put(x, { k: "note", id: e.id, text: "Stopped", at: e.at }) }
      else this.put(x, e)
    }
    if (m.type === "result") {
      x.stopping = false
      for (const e of [...x.reader.entries.values()]) if ("live" in e && e.live) this.put(x, { ...e, live: undefined })
      const error = stopped || (m.subtype === "success" && !m.is_error) ? undefined : resultError(x.reader.entries.get(String(m.uuid)))
      x.s.turn = { prompt: x.reader.prompt, text: x.reader.text, ...(error ? { error } : {}) }
      if (!x.asks.size) this.state(x, "idle", true)
    }
  }

  private streamed(x: Session, m: SDKMessage) {
    const stop = () => {
      for (const s of x.streams.values()) this.emit({ t: "partial", id: x.s.id, ...s, end: "stop" })
      x.streams.clear()
    }
    const ended = (end: "tool" | "stop") => { if (x.spec.texts) this.emit({ t: "partial", id: x.s.id, use: "", name: "", json: "", end }) }
    if (m.type === "result") { stop(); return ended("stop") }
    if (m.type !== "stream_event" || m.parent_tool_use_id) return
    const ev = m.event
    if (ev.type === "message_start") { x.message = String(ev.message?.id ?? ""); return stop() }
    if (ev.type === "message_delta" && ev.delta?.stop_reason) return ended(ev.delta.stop_reason === "tool_use" ? "tool" : "stop")
    if (ev.type === "message_delta" || ev.type === "message_stop" || typeof ev.index !== "number") return
    if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
      const name = String(ev.content_block.name ?? ""), short = name.startsWith(APP) ? name.slice(APP.length) : ""
      if (short && x.spec.tools?.some((t) => t.name === short && t.streams)) x.streams.set(ev.index, { use: String(ev.content_block.id ?? ""), name: short, json: "" })
    } else if (ev.type === "content_block_start" && ev.content_block?.type === "text" && x.spec.texts) {
      x.streams.set(ev.index, { use: `${x.message}:${ev.index}`, name: "", json: "" })
    } else if (ev.type === "content_block_delta" && (ev.delta?.type === "input_json_delta" || ev.delta?.type === "text_delta")) {
      const s = x.streams.get(ev.index), more = ev.delta.type === "text_delta" ? ev.delta.text : ev.delta.partial_json
      if (!s || !more) return
      s.json += more
      this.emit({ t: "partial", id: x.s.id, ...s })
    } else if (ev.type === "content_block_stop") {
      const s = x.streams.get(ev.index)
      if (!s) return
      x.streams.delete(ev.index)
      this.emit({ t: "partial", id: x.s.id, ...s, end: "done" })
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
    x.idle = setTimeout(() => { if (x.s.state === "idle" && !x.asks.size && !x.background) this.end(x) }, this.idleMs)
    x.idle.unref?.()
  }

  private end(x: Session, gone = true) {
    if (x.ended && !gone) return
    x.ended = true
    if (x.idle) clearTimeout(x.idle)
    for (const [id, p] of x.asks) { p.resolve({ behavior: "deny", message: "The session ended" }); x.asks.delete(id) }
    for (const [call, c] of this.calls) if (c.e.id === x.s.id) { clearTimeout(c.timer); this.calls.delete(call); c.resolve({ isError: true, content: [{ type: "text", text: "The session ended" }] }) }
    x.wake?.()
    try { x.q?.close() } catch {}
    x.q = null
    if (!gone) return
    if (this.sessions.get(x.s.id) === x) this.sessions.delete(x.s.id)
    this.emit({ t: "gone", id: x.s.id })
  }

  forget(id: string) {
    const x = this.sessions.get(id)
    if (x?.ended) { this.sessions.delete(id); this.emit({ t: "gone", id }) }
  }

  close() { for (const x of [...this.sessions.values()]) this.end(x) }
}

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

function alwaysText(ups: PermissionUpdate[]) {
  const said = ups.flatMap((u) => u.type === "addRules" && u.behavior === "allow" ? u.rules.map((r) => {
    const c = r.ruleContent?.replace(/:\*$/, "").trim()
    if (r.toolName === "Bash" && c) return `\`${c}\` commands`
    if (c) return `${r.toolName} on ${c}`
    return r.toolName
  }) : u.type === "addDirectories" ? u.directories.map((d) => `files in ${path.basename(d) || d}`) : u.type === "setMode" ? [u.mode === "acceptEdits" ? "edits" : u.mode] : [])
  return said.length ? said.join(", ").slice(0, 200) : "this from now on"
}

const resultError = (e: Entry | undefined) => (e?.k === "result" ? e.error : undefined)

const PICTURES = "The user answered with a message and pictures: it's their next message, read it."
function interrupted(es: Entry[]) {
  for (let i = es.length - 1; i >= 0; i--) {
    if (es[i].k === "user") return false
    const e = es[i]
    if (e.k === "note" && e.text === "Interrupted") return true
  }
  return false
}

const lastLines = (lines: string[]) => lines.join("").trim().split("\n").slice(-4).join("\n").slice(0, 600)


export function eachMessage(sock: net.Socket, fn: (m: Record<string, unknown>) => void) {
  let buf = ""
  sock.setEncoding("utf8")
  sock.on("data", (chunk: string) => {
    buf += chunk
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      let m: Record<string, unknown>
      try { m = JSON.parse(line) } catch { continue }
      fn(m)
    }
  })
}

const OPS = new Set<string>(Request.options.map((r) => r.shape.op.value))
function withImages(text: string, images: string[]): SDKUserMessage["message"]["content"] {
  if (images.length > IMAGES_MAX) throw new Error(`at most ${IMAGES_MAX} pictures a message (${images.length} given)`)
  const blocks = images.map((f) => {
    let b: Buffer
    try { b = fs.readFileSync(f) } catch { throw new Error(`the picture ${path.basename(f)} isn't there to send`) }
    const type = imageType(b)
    if (!type) throw new Error(`${path.basename(f)} isn't a PNG, JPEG, GIF or WebP picture`)
    if (b.length > IMAGE_MAX) throw new Error(`${path.basename(f)} is over ${IMAGE_MAX >> 20} MB`)
    return { type: "image" as const, source: { type: "base64" as const, media_type: type, data: b.toString("base64") } }
  })
  return blocks.length ? [...blocks, ...(text ? [{ type: "text" as const, text }] : [])] : text
}

export function listen(host: Host, sock: string, o: { log?: (...a: unknown[]) => void; hello?: () => { file: string; stale: boolean; code: string } } = {}) {
  const conns = new Set<net.Socket>(), followers = new Set<net.Socket>()
  const send = (c: net.Socket, m: object) => { if (!c.destroyed) c.write(JSON.stringify(m) + "\n") }
  host.on((e) => { for (const c of followers) send(c, e) })
  const handle = async (c: net.Socket, raw: Record<string, unknown>): Promise<Reply<Op>> => {
    const r = Request.safeParse(raw)
    if (!r.success) throw new Error(typeof raw.op === "string" && !OPS.has(raw.op) ? `unknown op '${raw.op}'` : `a ${String(raw.op)} it can't read: ${issues(r.error)}`)
    const m = r.data
    switch (m.op) {
      case "hello": return { v: 1, pid: process.pid, ...o.hello?.() }
      case "follow": followers.add(c); setTimeout(() => { for (const e of host.pendingCalls()) send(c, e) }, 0); return { sessions: host.list() }
      case "list": return { sessions: host.list() }
      case "read": { const s = host.read(m.id); if (!s) throw new Error(`no session ${m.id} runs here`); return s }
      case "start": return { s: host.start(m.spec, m.prompt, m.images, m.uuid) }
      case "send": return host.send(m.id, m.text, m.uuid, m.images)
      case "interrupt": return await host.interrupt(m.id)
      case "set": return { s: await host.set(m.id, m) }
      case "answer": return { s: host.answer(m.id, m.ask, m.answer) }
      case "stop": return { stopped: host.stop(m.id) }
      case "forget": host.forget(m.id); return {}
      case "told": host.told(m.id, m.seq); return {}
      case "tool-result": host.toolResult(m.call, m.result); return {}
    }
  }
  const server = net.createServer((c) => {
    conns.add(c)
    eachMessage(c, (m) => handle(c, m).then((out) => { if (m.re !== undefined) send(c, { re: m.re, ...out }) },
      (e) => { if (m.re !== undefined) send(c, { re: m.re, error: (e instanceof Error ? e.message : String(e)) }) }))
    const gone = () => { conns.delete(c); followers.delete(c) }
    c.on("close", gone)
    c.on("error", gone)
  })
  if (process.platform !== "win32") { try { fs.rmSync(sock, { force: true }) } catch {} fs.mkdirSync(path.dirname(sock), { recursive: true }) }
  server.listen(sock, () => { if (process.platform !== "win32") try { fs.chmodSync(sock, 0o600) } catch {} })
  return {
    server, conns: () => conns.size,
    stop: () => new Promise<void>((r) => { for (const c of conns) c.destroy(); server.close(() => r()) }),
  }
}
