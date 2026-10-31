// Claude Code's chat sessions on the server: the keeper's client (chatd.ts: started when first needed, followed while it
// runs, so a server that comes back hears what it missed), the ops, the chat tab's socket, and what the inbox hears.
import { spawn } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import type { WebSocket } from "ws"
import { type AgentChatNew, type Asking, type Choice, findBin, HOME, Transcript, transcripts } from "../../../core/agents.ts"
import { agentLines, byUser, type Machine, MACHINE_CLIENT, machineSocket, NOT_THE_USER, type Op, type OpCtx, OpError, outliving, pipeSockets, type Plugin, runtimeDir,
  splitMachine, userSurface } from "../../../core/plugins.ts"
import { type Entry, Reader } from "./chatlog.ts"
import { type Answer, EFFORTS, type Effort, type Event, type Mode, MODES, type Spec, type Summary, type ToolDef } from "./chathost.ts"

type Account = { id: string; dir: string; label: string; private: boolean }
/** What the chat takes from the rest of the plugin (plugin.ts). */
export type ChatDeps = {
  accounts: () => Account[]
  sessionFile: (id: string, all?: boolean) => { file: string; account: Account } | null
  /** The app's terminal a session runs in now, in Claude Code's own TUI ("" when not one of the app's), or null. */
  tuiOf: (id: string) => Promise<string | null>
  /** Sessions Claude Code runs in terminals now (its own TUI, not an SDK's). */
  inTerminals: () => Promise<Set<string>>
  /** Folders sessions ran in lately, newest first. */
  folders: () => Promise<string[]>
  models: () => { models: { id: string; label: string }[]; efforts: string[] }
  modelName: (model: string) => string
}

/** A tool a plugin serves to the session it starts (the companion's): run on the server, called through the keeper. */
export type ChatTool = ToolDef & { run: (args: unknown) => Promise<unknown> }
export type ChatStart = { prompt?: string; cwd?: string; account?: string; model?: string; effort?: Effort; mode?: Mode; append?: string
  title?: string; by?: string; tools?: ChatTool[]; inbox?: boolean
  /** Permission rules it runs without asking ("mcp__vaultite-app": its tools; "Bash(vau read:*)"), and never. */
  allowed?: string[]; denied?: string[] }

const SESSION = /^[\w-]{1,80}$/
const MODE_LABELS: Record<Mode, string> = { default: "Ask for permissions", acceptEdits: "Accept edits", plan: "Plan mode", auto: "Auto mode",
  dontAsk: "Don't ask", bypassPermissions: "Bypass permissions" }
/** Entries a page of history has (the chat tab's first, and each Show earlier). */
const PAGE = 300
/** Byte strings a transcript line needs to be read for the chat (the rest is tool output). */
const WANTED = ['"type":"user"', '"type":"assistant"', '"compact_boundary"', '"ai-title"', '"custom-title"']

/** A transcript read for the chat: its entries, title and folder. */
class Talk {
  r = new Reader()
  title = ""
  custom = false
  cwd = ""
  model = ""
  line(text: string) {
    let d: Record<string, unknown>
    try { d = JSON.parse(text) } catch { return }
    if (d.type === "custom-title" && d.customTitle) { this.title = String(d.customTitle); this.custom = true; return }
    if (d.type === "ai-title" && d.aiTitle) { if (!this.custom) this.title = String(d.aiTitle); return }
    if (!this.cwd && typeof d.cwd === "string") this.cwd = d.cwd
    const m = (d.message as { model?: unknown } | undefined)?.model
    if (d.type === "assistant" && typeof m === "string" && !m.startsWith("<")) this.model = m
    this.r.feed(d)
  }
  settle() {}
  get list() { return [...this.r.entries.values()] }
}

/** The keeper's name follows the port, as the terminal keeper's does (terminal/backend.ts backendName): a QA server's
 *  sessions stay its own, and an app serving no port (a test's) never reaches the live one's. */
const port = Number(process.env.PORT) || 0
const NAME = port === 8793 ? "vaultite" : `vaultite-${port || `x${process.pid}`}`
const WIN = process.platform === "win32"
const FILES = path.join(runtimeDir(), `vaultite-chatd1-${NAME}.sock`)
export const CHAT_SOCKET = WIN ? `\\\\.\\pipe\\vaultite-chatd1-${NAME}-${crypto.createHash("sha256").update(os.userInfo().username).digest("hex").slice(0, 8)}` : FILES

/** One connection to the keeper: requests with answers, and its events. */
class Wire {
  sock: net.Socket
  seq = 0
  waiting = new Map<number, { ok: (v: Record<string, unknown>) => void; fail: (e: Error) => void }>()
  closed = false
  constructor(sock: net.Socket, hear: (m: Record<string, unknown>) => void, gone: () => void) {
    this.sock = sock
    let buf = ""
    sock.setEncoding("utf8")
    sock.on("data", (chunk: string) => {
      buf += chunk
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        let m: Record<string, unknown>
        try { m = JSON.parse(line) } catch { continue }
        const w = typeof m.re === "number" ? this.waiting.get(m.re) : undefined
        if (w) { this.waiting.delete(m.re as number); if (typeof m.error === "string") w.fail(new Error(m.error)); else w.ok(m) } else hear(m)
      }
    })
    const end = () => {
      if (this.closed) return
      this.closed = true
      for (const w of this.waiting.values()) w.fail(new Error("the chat keeper went away"))
      this.waiting.clear()
      gone()
    }
    sock.on("close", end)
    sock.on("error", end)
  }
  request(op: string, params: Record<string, unknown> = {}, ms = 15000): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error("the chat keeper went away"))
    const re = ++this.seq
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => { this.waiting.delete(re); fail(new Error(`the chat keeper didn't answer ${op}`)) }, ms)
      this.waiting.set(re, { ok: (v) => { clearTimeout(timer); ok(v) }, fail: (e) => { clearTimeout(timer); fail(e) } })
      this.sock.write(JSON.stringify({ op, re, ...params }) + "\n")
    })
  }
  close() { this.sock.destroy() }
}

export function chats(plugin: Plugin, d: ChatDeps) {
  /** The sessions the keeper runs, as it last told. */
  const hosted = new Map<string, Summary>()
  /** What each asks now (its ask entries), for the inbox's words and agent-asking. */
  const asking = new Map<string, Map<string, Extract<Entry, { k: "ask" }>>>()
  /** The chat tabs watching each session. */
  const watching = new Map<string, Set<WebSocket>>()
  /** How the sessions plugins started run (their tools, words, account...), by session: a resume runs them so again. */
  const owned = new Map<string, ChatStart>()
  /** Who hears each session's state (a plugin driving its own): its summary, null once it's gone. */
  const listeners = new Set<(id: string, s: Summary | null) => void>()
  const inform = (id: string, s: Summary | null) => { for (const fn of listeners) try { fn(id, s) } catch (e) { console.error("chat: listener:", e) } }
  let wire: Promise<Wire> | null = null

  const daemon = path.join(plugin.dir, "chatd.ts")
  function startKeeper(plain = false) {
    let out: number | "ignore" = "ignore"
    try { out = fs.openSync(`${FILES}.log`, "a") } catch { /* no log */ }
    const [cmd, args] = plain ? [process.execPath, [daemon, CHAT_SOCKET, FILES]] : outliving(process.execPath, [daemon, CHAT_SOCKET, FILES], `chatd-${NAME}`)
    const child = spawn(cmd, args, { detached: true, stdio: ["ignore", out, out], cwd: os.homedir(), env: process.env, windowsHide: true })
    if (cmd !== process.execPath) child.once("exit", (code) => { if (code) startKeeper(true) })
    child.unref()
    if (typeof out === "number") fs.closeSync(out)
  }

  const connectTo = () => new Promise<Wire>((ok, fail) => {
    const sock = net.connect(CHAT_SOCKET)
    sock.once("connect", () => { sock.removeAllListeners("error"); ok(new Wire(sock, hear, () => { wire = null; dropAll() })) })
    sock.once("error", fail)
  })

  /** The keeper, followed; started when `start` and none answers. */
  function keeper(start = true): Promise<Wire> {
    if (wire) return wire
    const p = (async () => {
      let w: Wire | null = null
      try { w = await connectTo() } catch {
        if (!start) throw new Error("no chat keeper runs")
        startKeeper()
        for (let i = 0; i < 100 && !w; i++) {
          await new Promise((r) => setTimeout(r, 100))
          try { w = await connectTo() } catch { /* not yet */ }
        }
        if (!w) throw new Error(`the chat keeper didn't start (see ${FILES}.log)`)
      }
      const { sessions } = await w.request("follow") as { sessions: Summary[] }
      for (const s of sessions) { hosted.set(s.id, s); void readAsks(w, s.id) }
      for (const s of sessions) { tellInbox(s); inform(s.id, s) }
      void recover(new Set(sessions.map((s) => s.id)))
      return w
    })()
    wire = p
    p.catch(() => { if (wire === p) wire = null })
    return p
  }
  const ask = async (op: string, params: Record<string, unknown> = {}) => (await keeper(!!port)).request(op, params)
  /** Whether chat sessions can run here: a server serving a port starts its keeper; an app serving none (a test's)
   *  only uses one already listening, never starting real sessions. */
  const can = () => !!port || !!wire || (!WIN && fs.existsSync(CHAT_SOCKET))

  /** A server that comes back follows the keeper still running (its sessions' news may have waited for it); one whose
   *  keeper died mid-turn starts another, which takes those turns up again. */
  const look = () => {
    if (wire) { for (const s of hosted.values()) tellInbox(s); void handOver() }
    else if (WIN || fs.existsSync(CHAT_SOCKET) || (port && Object.values(kept).some((k) => midTurn(k) && (!k.tools || owned.has(k.id))))) keeper(!!port).catch(() => {})
  }

  // ---------- what outlives the keeper: each session as last seen (this machine's, out of the vault), so turns cut off
  // by a reboot or a crash go on, and an owner: a terminal resuming a session takes it over

  type Kept = Pick<Summary, "id" | "cwd" | "account" | "model" | "effort" | "mode" | "by" | "at"> & { state: Summary["state"] | "closed"; tools?: boolean; quiet?: boolean
    /** Its inbox thread's event id. */
    thread?: string }
  const keptFile = () => path.join(plugin.localDir(), "chats.json")
  let kept: Record<string, Kept> = {}
  try { kept = JSON.parse(fs.readFileSync(keptFile(), "utf8")) } catch { /* none yet */ }
  let saving: ReturnType<typeof setTimeout> | null = null
  const save = () => { saving ??= setTimeout(() => { saving = null; try { fs.writeFileSync(keptFile(), JSON.stringify(kept)) } catch (e) { console.error("chat: keeping sessions:", e) } }, 500) }
  const midTurn = (k: Kept) => k.state === "working" || k.state === "waiting" || k.state === "starting"
  function keep(s: Summary | null, id = s?.id ?? "") {
    // (one that ended stays known as a chat's, so a reply resumes it here; the newest few hundred)
    if (!s) { if (kept[id]) kept[id] = { ...kept[id], state: "closed" } }
    else kept[id] = { id, state: s.state, cwd: s.cwd, account: s.account, model: s.model, effort: s.effort, mode: s.mode, by: s.by, at: s.at,
      ...(owned.get(id)?.tools?.length || kept[id]?.tools ? { tools: true } : {}), ...(s.quiet ? { quiet: true } : {}), ...(kept[id]?.thread ? { thread: kept[id].thread } : {}) }
    const ids = Object.keys(kept)
    for (const old of ids.slice(0, Math.max(0, ids.length - 300))) delete kept[old]
    save()
  }
  /** Turns taken up again lately, by session: at most 3 in 5 minutes each, so one that dies at once doesn't loop. */
  const revived = new Map<string, number[]>()
  async function recover(running: Set<string>) {
    for (const k of Object.values(kept)) {
      if (running.has(k.id)) continue
      // (one that wasn't mid-turn needs nothing: its next message resumes it; one with a plugin's tools waits for them, serve)
      if (k.tools && !owned.has(k.id) && midTurn(k)) continue
      if (!midTurn(k)) { if (k.state !== "closed") { kept[k.id] = { ...k, state: "closed" }; save() } continue }
      const times = (revived.get(k.id) ?? []).filter((t) => Date.now() - t < 5 * 60_000)
      if (times.length >= 3) continue
      revived.set(k.id, [...times, Date.now()])
      try {
        await send(k.id, "Continue where you left off.", { model: k.model || undefined, effort: (k.effort || undefined) as Effort | undefined, mode: k.mode, by: k.by })
        console.error(`chat: took ${k.id} up again after its keeper ended`)
      } catch (e) { console.error(`chat: couldn't take ${k.id} up again:`, e); kept[k.id] = { ...k, state: "closed" }; save() }
    }
  }
  /** A session a terminal now runs too (claude --resume): the chat lets go of it, mid-turn too (what it was doing
   *  stops), so one writes it; the terminal is the user's latest word. The app's own terminals ask first (plugin.ts). */
  async function handOver() {
    if (!hosted.size) return
    const elsewhere = await d.inTerminals().catch(() => new Set<string>())
    for (const s of [...hosted.values()]) if (elsewhere.has(s.id)) await letGo(s.id)
  }
  async function letGo(id: string) {
    const s = hosted.get(id)
    if (!s) return
    if (s.state === "working" || s.state === "waiting") await ask("interrupt", { id }).catch(() => {})
    await ask("stop", { id }).catch(() => {})
  }
  setTimeout(look, 0).unref?.()
  const looking = setInterval(look, 5_000)
  looking.unref?.()
  plugin.onUnload(() => { clearInterval(looking); void wire?.then((w) => w.close()).catch(() => {}) })

  async function readAsks(w: Wire, id: string) {
    try {
      const r = await w.request("read", { id }) as { entries: Entry[] }
      for (const e of r.entries) if (e.k === "ask" && !e.answer) asksOf(id).set(e.id, e)
    } catch { /* gone */ }
  }
  const asksOf = (id: string) => { let m = asking.get(id); if (!m) asking.set(id, (m = new Map())); return m }

  function dropAll() {
    for (const id of hosted.keys()) { toTabs(id, { t: "state", s: null }); inform(id, null) }
    hosted.clear()
    asking.clear()
  }

  /** What the keeper says. */
  function hear(m: Record<string, unknown>) {
    const e = m as Event
    if (e.t === "put") {
      if (e.e.k === "ask") { if (e.e.answer) asking.get(e.id)?.delete(e.e.id); else asksOf(e.id).set(e.e.id, e.e) }
      toTabs(e.id, { t: "put", e: e.e })
    } else if (e.t === "state") {
      const was = hosted.get(e.s.id)?.state
      hosted.set(e.s.id, e.s)
      keep(e.s)
      toTabs(e.s.id, { t: "state", s: e.s })
      tellInbox(e.s)
      inform(e.s.id, e.s)
      // (Claude Code names a session as its first turns end, a moment after: its tabs hear it)
      if (e.s.state === "idle" && was !== "idle" && watching.has(e.s.id)) for (const ms of [500, 4000]) setTimeout(() => void sayTitle(e.s.id), ms)
    } else if (e.t === "gone") {
      keep(null, e.id)
      hosted.delete(e.id)
      asking.delete(e.id)
      toTabs(e.id, { t: "state", s: null })
      inform(e.id, null)
    } else if (e.t === "tool") void runTool(e.id, e.call, e.name, e.args)
    else if (e.t === "did") {
      // (Activity's intake for agents' hooks, the session named by its title)
      const q = new URLSearchParams({ agent: "claude-code", session: titleOf(e.id) || e.id.slice(0, 8) })
      void plugin.host.api("POST", `activity/hook?${q}`, { tool_name: e.tool, tool_input: e.input }).catch(() => {})
    }
  }

  const toolOf = (id: string, name: string) => owned.get(id)?.tools?.find((t) => t.name === name)
  async function runTool(id: string, call: string, name: string, args: unknown) {
    // (a server just started: its plugin serves the session's tools again in a moment, serve)
    for (let i = 0; i < 100 && !toolOf(id, name); i++) await new Promise((r) => setTimeout(r, 200))
    const t = toolOf(id, name)
    let result: unknown
    try {
      result = t ? await t.run(args) : { isError: true, content: [{ type: "text", text: `Vaultite serves no tool ${name} to this session now: the plugin that started it is off` }] }
    } catch (err) {
      result = { isError: true, content: [{ type: "text", text: String((err as Error)?.message ?? err) }] }
    }
    await ask("tool-result", { call, result }).catch(() => {})
  }

  // ---------- the inbox: each session's news through its intake (inbox:session), once each (the keeper's seq and told)

  /** Each session's news told in turn, its title read first (the name Claude Code gave it). */
  const telling = new Map<string, Promise<void>>()
  /** The news told so far, by session (the keeper's `told` can trail it a moment). */
  const toldInbox = new Map<string, number>()
  const isNews = (s: Summary) => s.seq > Math.max(s.told, toldInbox.get(s.id) ?? 0)
  function tellInbox(s: Summary) {
    if (!isNews(s)) return
    const now = { ...s }
    const p = (telling.get(s.id) ?? Promise.resolve()).then(() => readTitle(s.id).catch(() => null)).then(() => { if (isNews(now)) tellNow(now) })
    telling.set(s.id, p)
    void p.finally(() => { if (telling.get(s.id) === p) telling.delete(s.id) })
  }
  function tellNow(s: Summary) {
    const tell = plugin.service("inbox:session") as ((c: Record<string, unknown>) => Promise<unknown>) | null
    // (the inbox not there yet, as the server starts: told on the next look)
    if (!tell && !s.quiet) return
    if (tell && !s.quiet) {
      const a = [...(asking.get(s.id)?.values() ?? [])].at(-1), cmd = (a?.input as { command?: unknown } | undefined)?.command
      // (its thread's id once the inbox gave it: the same thread whatever becomes of the session's id)
      const thread = kept[s.id]?.thread
      const base = { agent: "claude", session: s.id, cwd: s.cwd, ...(thread ? { thread } : {}), ...(titleOf(s.id) ? { title: titleOf(s.id) } : {}) }
      const said = s.state === "working" ? { state: "working" }
        : s.state === "waiting" ? { state: "waiting", ask: a?.kind ?? "permission", ...(a?.questions?.length ? { questions: a.questions } : {}),
          text: a?.kind === "plan" ? a.plan ?? "" : a ? a.title + (typeof cmd === "string" ? `: ${cmd.slice(0, 200)}` : a.detail ? `: ${a.detail}` : "") : "" }
        : s.state === "idle" && s.turn ? { state: "done", text: s.turn.text, prompt: s.turn.prompt }
        : s.state === "error" ? { state: "error", text: s.error ?? s.turn?.text ?? "", prompt: s.turn?.prompt ?? "" } : null
      if (said) void tell({ ...base, ...said }).then((e) => {
        const id = (e as { id?: unknown } | null)?.id
        if (typeof id === "string" && kept[s.id] && kept[s.id].thread !== id) { kept[s.id] = { ...kept[s.id], thread: id }; save() }
      }, (e) => console.error("chat: inbox:", e))
    }
    toldInbox.set(s.id, s.seq)
    if (toldInbox.size > 500) toldInbox.delete(toldInbox.keys().next().value!)
    void ask("told", { id: s.id, seq: s.seq }).catch(() => {})
  }

  async function sayTitle(id: string) {
    const before = titleOf(id), t = await readTitle(id).catch(() => null)
    if (t?.title && t.title !== before) toTabs(id, { t: "title", title: t.title })
  }

  // ---------- the transcripts (history before the keeper's, and sessions it doesn't run)

  const history = transcripts((file) => new Transcript(file, () => new Talk(), WANTED))
  async function talkOf(id: string) {
    const f = d.sessionFile(id)
    return f ? (await history(f.file))?.talk ?? null : null
  }
  /** A session's title: the one Claude Code gave it (or the user), as its transcript says. */
  const titles = new Map<string, string>()
  const titleOf = (id: string) => titles.get(id) ?? ""
  async function readTitle(id: string) {
    const t = await talkOf(id)
    if (t?.title) titles.set(id, t.title)
    if (titles.size > 500) titles.delete(titles.keys().next().value!)
    return t
  }

  // ---------- starting and resuming

  /** Claude Code to run: the user's own (what they run in terminals, signed in, kept up to date by its own updater),
   *  else the SDK's bundled one (none in the packaged app). */
  const claudeBin = () => findBin("claude") ?? undefined

  function chatContext() {
    let text = ""
    try { text = fs.readFileSync(path.join(plugin.dir, "chat.md"), "utf8").trim().replace(/\n(?!\n)/g, " ") } catch { /* none */ }
    return [text, ...agentLines(plugin.vault).map((l) => `- ${l.text}`)].filter(Boolean).join("\n")
  }

  function accountOf(id?: string) {
    const all = d.accounts().filter((a) => !a.private)
    const a = id ? all.find((x) => x.id === id) : all.find((x) => x.id === "default") ?? all[0]
    if (!a) throw new OpError(id ? `no Claude Code account '${id}' to chat in (${all.map((x) => x.id).join(", ") || "none"}; a private one isn't shown in the app)` : "no Claude Code account to chat in", 404)
    return a
  }

  async function envFor(a: Account): Promise<Record<string, string>> {
    const given = await plugin.ask<Record<string, string> | null>("terminal:agent-env", null).catch(() => null)
    const env = { ...(given ?? Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string" && !e[0].startsWith("npm_")))) }
    // (its default folder, unless the server runs with another: then it's named, as a terminal's agent's is)
    if (a.dir !== path.join(HOME, ".claude") || process.env.CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = a.dir
    else delete env.CLAUDE_CONFIG_DIR
    delete env.CLAUDECODE
    delete env.CLAUDE_CODE_ENTRYPOINT
    return env
  }

  async function specFor(id: string, o: ChatStart & { resume: boolean }, a: Account): Promise<Spec> {
    // (its own session and agent, so `vau inbox report` from it names them: it has no terminal)
    const env = { ...await envFor(a), CLAUDE_CODE_SESSION_ID: id, VAULTITE_AGENT: "claude" }
    return { id, resume: o.resume, cwd: o.cwd || plugin.vault.path, env, claude: claudeBin(), account: a.id, by: o.by ?? "app",
      ...(o.model ? { model: o.model } : {}), ...(o.effort ? { effort: o.effort } : {}), mode: o.mode || modeDefault(a.id),
      append: [chatContext(), o.append].filter(Boolean).join("\n\n"), ...(o.title ? { title: o.title } : {}),
      ...(o.tools?.length ? { tools: o.tools.map(({ name, description, schema }) => ({ name, description, schema })) } : {}),
      ...(o.allowed?.length ? { allowed: o.allowed } : {}), ...(o.denied?.length ? { denied: o.denied } : {}), ...(o.inbox === false ? { quiet: true } : {}) }
  }

  /** A new session: its id. `own`: a plugin's, run so again when it's resumed. */
  async function start(o: ChatStart, own = false) {
    const a = accountOf(o.account)
    if (o.cwd && !fs.statSync(o.cwd, { throwIfNoEntry: false })?.isDirectory()) throw new OpError(`there's no folder ${o.cwd}`, 404)
    if (o.model && !d.models().models.some((m) => m.id === o.model) && !/^claude-[\w.-]+$/.test(o.model)) throw new OpError(`'${o.model}' isn't a model Claude Code runs`)
    const id = crypto.randomUUID()
    if (own) owned.set(id, { ...o, prompt: undefined })
    const { s } = await ask("start", { spec: await specFor(id, { ...o, resume: false }, a), ...(o.prompt?.trim() ? { prompt: o.prompt.trim() } : {}) }) as { s: Summary }
    // (its news after the answer, in the same read, was heard first: newer)
    if (!hosted.has(id)) hosted.set(id, s)
    return hosted.get(id)!
  }

  /** Why session `id` can't take a message from the app now, or "" (it runs in a terminal: two writers would fork it). */
  async function busyElsewhere(id: string) {
    if (hosted.has(id)) return ""
    const t = await d.tuiOf(id)
    return t === null ? "" : t ? `it runs in the app's terminal ${t}: answer it there, or end it first` : "it runs in Claude Code in a terminal: answer it there, or end it first"
  }

  /** What the user says to session `id`: straight in while the keeper runs it, else it's resumed with it. */
  async function send(id: string, text: string, given: ChatStart = {}) {
    if (!SESSION.test(id)) throw new OpError(`'${id}' isn't a session id`)
    const o = { ...owned.get(id), ...given }
    const said = text.trim()
    if (!said) throw new OpError("text: what to say")
    if (hosted.has(id) && hosted.get(id)!.state !== "error") {
      // (chosen in a tab that didn't know it ran yet: applied before what it's told)
      const s = hosted.get(id)!
      const change = { ...(given.model && given.model !== s.model ? { model: given.model } : {}), ...(given.effort && given.effort !== s.effort ? { effort: given.effort } : {}),
        ...(given.mode && given.mode !== s.mode ? { mode: given.mode } : {}) }
      if (Object.keys(change).length) await ask("set", { id, ...change })
      return await ask("send", { id, text: said }) as { uuid: string; answered?: string }
    }
    const why = await busyElsewhere(id)
    if (why) throw new OpError(why, 409)
    const f = d.sessionFile(id)
    if (!f) throw new OpError(`no session ${id} on this machine (or it's in a private account)`, 404)
    if (f.account.private) throw new OpError("it's in a private account, which the app doesn't show", 403)
    const t = await readTitle(id)
    const was = hosted.get(id)
    const { s } = await ask("start", { spec: await specFor(id, { ...o, resume: true, cwd: o.cwd || t?.cwd || "",
      model: o.model || was?.model || undefined, effort: o.effort || (was?.effort || undefined) as Effort | undefined, mode: o.mode || was?.mode || kept[id]?.mode }, f.account), prompt: said }) as { s: Summary }
    if (hosted.get(id) === was) hosted.set(id, s)
    return { uuid: "", resumed: true }
  }

  function hostedOr404(id: string) {
    const s = hosted.get(id)
    if (!s) throw new OpError(`session ${id} isn't running in the app (vau chat list)`, 404)
    return s
  }

  /** The plugin driving session `id` with the tools it serves (the companion), or "": run in a terminal, it would
   *  have none of them, and its plugin would lose it. */
  function drivenBy(id: string) {
    const k = kept[id]
    return owned.get(id)?.tools?.length || k?.tools ? (hosted.get(id)?.by || k?.by || "a plugin") : ""
  }

  /** Answer what session `id` asks (its newest ask, or `askId`). */
  async function answer(id: string, a: Answer, askId = "") {
    hostedOr404(id)
    const at = askId || [...(asking.get(id)?.keys() ?? [])].at(-1)
    if (!at) throw new OpError("it doesn't ask anything now", 409)
    return (await ask("answer", { id, ask: at, answer: a }) as { s: Summary }).s
  }

  /** Whether session `id` is the chat's to talk to: it runs here, or it ran here before (resumed by a message), and no
   *  terminal runs it now. A terminal's session that ended is the inbox's to resume as it sees fit. */
  async function ours(id: string) {
    if (!SESSION.test(id) || !can()) return false
    if (hosted.has(id)) return true
    const f = kept[id] ? d.sessionFile(id) : null
    return !!f && !f.account.private && !(await busyElsewhere(id))
  }
  // The inbox's replies and answers to a session with no terminal (its host's services): taken here when it's ours.
  plugin.provide("agent-reply:claude", async (id: string, text: string) => {
    if (!(await ours(id))) return false
    await send(id, text)
    return true
  })
  plugin.provide("agent-answer:claude", async (id: string, a: { answer?: "approve" | "deny"; picks?: Choice[] }) => {
    if (!hosted.has(id) || !asking.get(id)?.size) return false
    if (a.picks) await answer(id, { answers: a.picks })
    else if (a.answer) await answer(id, { allow: a.answer === "approve" })
    else return false
    return true
  })
  plugin.provide("agent-chat-new:claude", (async (o) => (can() ? { id: (await start({ prompt: o.prompt, account: o.account, cwd: o.cwd, by: o.by ?? "app" })).id } : null)) satisfies AgentChatNew)

  /** What a session the keeper runs waits on (agent-asking), in its own words; undefined when it doesn't run it. */
  function askingNow(id: string): Asking | null | undefined {
    if (!hosted.has(id)) return undefined
    const a = [...(asking.get(id)?.values() ?? [])].at(-1)
    if (a?.kind === "question" && a.questions?.length) return { kind: "question", questions: a.questions }
    if (a?.kind === "plan" && a.plan) return { kind: "plan", plan: a.plan }
    return null
  }
  /** Its last turn (agent-turn), when the keeper runs it. */
  const turnNow = (id: string) => {
    const s = hosted.get(id)
    return s?.turn ? { session: id, prompt: s.turn.prompt, text: s.turn.text, at: s.at, final: s.state !== "working", ...(titleOf(id) ? { title: titleOf(id) } : {}) } : null
  }

  // ---------- the chat tab: its socket (the conversation, then each change), and its pickers' choices

  function toTabs(id: string, m: object) {
    const tabs = watching.get(id)
    if (!tabs?.size) return
    const text = JSON.stringify(m)
    for (const ws of tabs) if (ws.readyState === ws.OPEN) ws.send(text)
  }

  /** A page of a session's history: the newest `limit` entries before `before`. */
  function page(list: Entry[], before = list.length, limit = PAGE) {
    const end = Math.min(Math.max(before, 0), list.length), start = Math.max(end - limit, 0)
    return { entries: list.slice(start, end), start, total: list.length }
  }

  /** The permission mode an account's sessions start in when none is chosen: its settings' defaultMode (Claude Code's
   *  own setting, as a terminal's claude starts in), else auto. */
  function modeDefault(account: string): Mode {
    const a = d.accounts().find((x) => x.id === account)
    try {
      const st = a ? JSON.parse(fs.readFileSync(path.join(a.dir, "settings.json"), "utf8")) as { permissions?: { defaultMode?: unknown } } : null
      const m = st?.permissions?.defaultMode
      if (MODES.includes(m as Mode)) return m as Mode
    } catch { /* none set */ }
    return "auto"
  }

  /** The effort an account's sessions run at when none is chosen: its settings' for the model, else its own. */
  function effortDefault(account: string, model = "") {
    const a = d.accounts().find((x) => x.id === account)
    if (!a) return ""
    try {
      const st = JSON.parse(fs.readFileSync(path.join(a.dir, "settings.json"), "utf8")) as { effortLevel?: unknown; modelSettings?: Record<string, { effortLevel?: unknown }> }
      const v = st.modelSettings?.[model]?.effortLevel ?? st.effortLevel
      return typeof v === "string" ? v : ""
    } catch { return "" }
  }

  async function hello(id: string) {
    const t = await readTitle(id)
    const s = hosted.get(id) ?? null
    const live = s ? ((await ask("read", { id }).catch(() => null)) as { entries: Entry[] } | null)?.entries ?? [] : []
    const f = d.sessionFile(id)
    const account = s?.account || f?.account.id || ""
    return { t: "hello", id, s, title: t?.title ?? "", cwd: s?.cwd || t?.cwd || "", account, model: t?.model ?? "", effort: effortDefault(account, s?.model || t?.model),
      history: page(t?.list ?? []), live, tui: s ? null : await d.tuiOf(id), found: !!(s || t), driven: drivenBy(id) }
  }

  plugin.socket("claude-code/chat/*", async (ws, req, { wild }) => {
    const [id, at] = splitMachine(wild[0] ?? "")
    const why = await plugin.refusal(req, "Claude Code's chat")
    const m = !why && at ? await plugin.ask<Machine | null>("machines:machine", null, at) : null
    if (m && !m.self) {
      // (another machine's session: its own socket, joined both ways)
      if (!m.online) { ws.send(JSON.stringify({ t: "refused", reason: `${m.label} isn't answering` })); return ws.close(1013, "unavailable") }
      return pipeSockets(ws, machineSocket(m, `claude-code/chat/${encodeURIComponent(id)}`), () => { ws.send(JSON.stringify({ t: "refused", reason: `${m.label} isn't answering` })); ws.close(1011, "unreachable") })
    }
    if (why || !SESSION.test(id) || (at && !m)) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "refused", reason: why || "not a session id" }))
      return ws.close(4003, "refused")
    }
    let set = watching.get(id)
    if (!set) watching.set(id, (set = new Set()))
    set.add(ws)
    // A session the keeper doesn't run (a terminal's, or one ended) is read again as its transcript grows.
    const sent = new Map<string, Entry>()
    let tui: string | null = null
    const poll = setInterval(async () => {
      if (hosted.has(id) || ws.readyState !== ws.OPEN) return
      const t = await readTitle(id).catch(() => null)
      for (const e of t?.list.slice(-PAGE) ?? []) if (sent.get(e.id) !== e) { sent.set(e.id, e); ws.send(JSON.stringify({ t: "put", e })) }
      const now = await d.tuiOf(id)
      if (now !== tui) { tui = now; ws.send(JSON.stringify({ t: "tui", tui, title: t?.title ?? "" })) }
    }, 2500)
    ws.on("close", () => { clearInterval(poll); set!.delete(ws); if (!set!.size) watching.delete(id) })
    try {
      const h = await hello(id)
      for (const e of h.history.entries) sent.set(e.id, e)
      tui = h.tui
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(h))
    } catch (e) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "error", reason: String((e as Error)?.message ?? e) }))
    }
  })

  plugin.route("GET", "claude-code/chat/*/history", async (req) => {
    await plugin.ownerOnly(req, "Claude Code's chat")
    const [id, at] = splitMachine(req.arg(0))
    const m = at ? await plugin.ask<Machine | null>("machines:machine", null, at) : null
    if (m && !m.self) {
      const r = await fetch(`${m.url}/api/claude-code/chat/${encodeURIComponent(id)}/history?${new URLSearchParams(req.query)}`, { headers: MACHINE_CLIENT, signal: AbortSignal.timeout(15000) }).catch(() => null)
      if (!r?.ok) throw new OpError(`${m.label} doesn't answer`, 502)
      return await r.json()
    }
    const t = await talkOf(id)
    if (!t) return { entries: [], start: 0, total: 0 }
    return page(t.list, req.query.before !== undefined ? Math.trunc(Number(req.query.before)) || 0 : undefined, Math.min(1000, Math.max(1, Number(req.query.limit) || PAGE)))
  }, { sync: false })

  plugin.route("GET", "claude-code/chat/options", async (req) => {
    await plugin.ownerOnly(req, "Claude Code's chat")
    const m = d.models()
    return { models: m.models, efforts: m.efforts, modes: MODES.map((id) => ({ id, label: MODE_LABELS[id] })),
      accounts: d.accounts().filter((a) => !a.private).map((a) => ({ id: a.id, label: a.label, effort: effortDefault(a.id), mode: modeDefault(a.id) })),
      folders: (await d.folders()).slice(0, 12), vault: plugin.vault.path, home: HOME }
  }, { sync: false })

  // ---------- ops: vau chat ..., MCP's tools

  const ID = { type: "string", required: true, description: "the session's id (vau chat list; <id>@<machine>: another machine's)" } as const

  /** An op on a session, which another machine's (`<id>@<machine>`) runs there, once (not passed on again). */
  function onMachines(def: Op) {
    plugin.op({ ...def, run: async (p, ctx) => {
      const [sid, at] = splitMachine(String(p.id ?? ""))
      const m = at ? await plugin.ask<Machine | null>("machines:machine", null, at) : null
      if (!at || m?.self) return def.run({ ...p, id: sid }, ctx)
      if (!m) throw new OpError(`no machine '${at}' (Machines lists them)`, 404)
      if (ctx.who.client?.startsWith("machine/")) throw new OpError(`a call passed on from another machine runs where it's sent, not on ${m.label}`, 409)
      if (!m.online) throw new OpError(`${m.label} is offline`, 502)
      let r: Response
      try {
        r = await fetch(`${m.url}/api/ops/${def.id}`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" },
          body: JSON.stringify({ ...p, id: sid }), signal: AbortSignal.timeout(30000) })
      } catch { throw new OpError(`${m.label} doesn't answer`, 502) }
      const out = await r.json().catch(() => ({})) as Record<string, unknown>
      if (!r.ok) throw new OpError(`${m.label}: ${String(out.error ?? `answered ${r.status}`)}`, r.status)
      return { ...out, ...(typeof out.id === "string" ? { id: `${out.id}@${m.id}` } : {}) }
    } })
  }
  const OWNER = "Claude Code's chat"
  const line = (s: Summary) => `- ${s.id} · ${s.state}${s.asks.length ? " (asks)" : ""} · ${titleOf(s.id) || path.basename(s.cwd)} · ${d.modelName(s.model) || "default model"} · ${MODE_LABELS[s.mode] ?? s.mode}`
  const theUser = (ctx: OpCtx) => { if (!userSurface(ctx.who)) throw new OpError(NOT_THE_USER, 403) }

  /** Open its tab in the user's window: theirs at once, an agent's behind their tab with a toast. */
  async function show(ctx: OpCtx, id: string) {
    const path = `view:claude-session/${id}`
    try {
      if (byUser(ctx.who)) return void await ctx.ui({ action: "open", path, newTab: true })
      await ctx.ui({ action: "open", path, background: true })
      const who = ctx.who.label
      await ctx.ui({ action: "notify", text: `${who[0].toUpperCase()}${who.slice(1)} started a chat with Claude`, button: { label: "Show", open: path } })
    } catch (e) {
      if (!(e instanceof OpError && e.status === 409)) throw e
    }
  }

  plugin.op({
    id: "claude-code.chat-start", cli: "chat start", mcp: "chat_start", owner: OWNER, kind: "write", lock: false,
    summary: "Start a Claude Code chat session: run in the app (not a terminal), drawn in a chat tab, its questions and permissions answered there and in the inbox.",
    help: `It runs in the app's chat keeper, so it goes on when the server restarts, and it's a normal Claude Code session:
claude --resume <id> in a terminal opens the same conversation. account: one of Claude Code's accounts (its config
folders; vau chat start --help lists none: GET /api/claude-code/accounts); cwd: the folder it works in (the vault by
default); model (sonnet, opus, haiku, fable or a full id), effort (low to max) and mode (default, acceptEdits, plan,
auto, dontAsk, bypassPermissions; none: the account's permissions.defaultMode, else auto). open: show its tab (an agent's opens behind the user's, with a toast).

  vau chat start "Fix the flaky upload test" --cwd ~/code/lighthouse --model sonnet
  vau chat start "Plan the release" --mode plan --open`,
    params: {
      prompt: { type: "string", description: "its first message (none: it waits for one)" },
      cwd: { type: "string", description: "the folder it works in (default: the vault's)" },
      account: { type: "string", description: "the Claude Code account to run in (default: default)" },
      model: { type: "string", description: "sonnet, opus, haiku, fable, or a model's full id" },
      effort: { type: "string", enum: EFFORTS, description: "how hard it thinks" },
      mode: { type: "string", enum: MODES, description: "its permission mode (default: the account's permissions.defaultMode, else auto)" },
      open: { type: "boolean", description: "open its chat tab in the user's window" },
    },
    args: ["prompt"],
    run: async (p, ctx) => {
      const s = await start({ prompt: p.prompt, cwd: p.cwd ? path.resolve(String(p.cwd).replace(/^~(?=$|\/)/, HOME)) : undefined, account: p.account,
        model: p.model, effort: p.effort, mode: p.mode, by: byUser(ctx.who) ? "app" : ctx.who.agent || ctx.who.client || "agent" })
      if (p.open) await show(ctx, s.id)
      return { id: s.id, state: s.state, cwd: s.cwd, account: s.account }
    },
    text: (r) => `Started chat ${r.id} in ${r.cwd} (${r.account}): vau chat read ${r.id}.`,
    did: ({ prompt }) => ({ action: "run", text: prompt ? `Started a chat: ${String(prompt).slice(0, 60)}` : "Started a chat" }),
  })

  onMachines({
    id: "claude-code.chat-send", cli: "chat send", mcp: "chat_send", owner: OWNER, kind: "write", lock: false,
    summary: "Tell a Claude Code session something: straight into it while it runs in the app (queued during a turn), else it's resumed with it.",
    help: `While it asks something (a permission, a plan), the message is the answer: no, and do this instead; to questions,
a reply in their place. A session running in a terminal is answered there, not here.

  vau chat send 3f2a... "Also update the changelog"`,
    params: { id: ID, text: { type: "string", required: true, description: "what to say" },
      model: { type: "string", description: "resuming it: the model to run" }, effort: { type: "string", enum: EFFORTS, description: "resuming it: its effort" },
      mode: { type: "string", enum: MODES, description: "resuming it: its permission mode" } },
    args: ["id", "text"],
    run: async (p) => ({ id: p.id, ...(await send(p.id, p.text, { model: p.model, effort: p.effort, mode: p.mode })) }),
    text: (r) => (r.answered ? "It was asking: that's its answer." : r.resumed ? "Resumed it with that." : "Sent."),
  })

  onMachines({
    id: "claude-code.chat-interrupt", cli: "chat interrupt", mcp: "chat_interrupt", owner: OWNER, kind: "write", lock: false,
    summary: "Stop a Claude Code chat session's turn, as Esc does in the terminal: what it was doing stops, the session stays.",
    params: { id: ID }, args: ["id"],
    run: async (p) => { hostedOr404(p.id); await ask("interrupt", { id: p.id }); return { id: p.id } },
    text: () => "Interrupted.",
  })

  onMachines({
    id: "claude-code.chat-answer", cli: "chat answer", owner: OWNER, kind: "write", lock: false,
    summary: "Answer what a Claude Code chat session asks: allow or deny a permission (always: and its rule), pick answers to its questions, approve its plan or keep planning.",
    help: `The user's alone: from the app or their phone, never an agent nor vau. picks: one per question, an option's number
(several, comma-separated, in a multi-select) or text of its own. message: with a denial, what to do instead; with a
plan sent back, what to change. mode: the permission mode after an approved plan (acceptEdits, default...).`,
    params: {
      id: ID,
      ask: { type: "string", description: "which ask (its entry id); default: the newest" },
      allow: { type: "boolean", description: "allow the permission, approve the plan" },
      always: { type: "boolean", description: "with allow: its suggested rule too, so it isn't asked again" },
      picks: { type: "array", items: { type: "string" }, description: "the questions' answers, in order" },
      message: { type: "string", description: "why not, or what to do instead" },
      mode: { type: "string", enum: MODES, description: "after an approved plan, the permission mode" },
    },
    args: ["id"],
    run: async (p, ctx) => {
      theUser(ctx)
      const qs = [...(asking.get(p.id)?.values() ?? [])].find((e) => !p.ask || e.id === p.ask)?.questions ?? []
      const answers = p.picks?.length ? (p.picks as string[]).map((x, i): Choice => {
        const ns = x.split(",").map((n) => Number(n.trim()))
        return ns.every((n) => Number.isInteger(n) && n >= 1 && n <= (qs[i]?.options.length ?? 0)) ? ns : x
      }) : undefined
      const s = await answer(p.id, { ...(p.allow !== undefined ? { allow: p.allow } : {}), ...(p.always ? { always: true } : {}),
        ...(answers ? { answers } : {}), ...(p.message ? { message: p.message } : {}), ...(p.mode ? { mode: p.mode } : {}) }, p.ask)
      return { id: p.id, state: s.state }
    },
    text: () => "Answered.",
  })

  onMachines({
    id: "claude-code.chat-set", cli: "chat set", mcp: "chat_set", owner: OWNER, kind: "write", lock: false,
    summary: "Change how a Claude Code chat session runs from its next step: its model, effort or permission mode.",
    params: { id: ID, model: { type: "string", description: "sonnet, opus, haiku, fable, or a full id" },
      effort: { type: "string", enum: EFFORTS, description: "how hard it thinks" }, mode: { type: "string", enum: MODES, description: "its permission mode" } },
    args: ["id"],
    run: async (p) => {
      hostedOr404(p.id)
      if (!p.model && !p.effort && !p.mode) throw new OpError("model, effort or mode: what to change")
      const { s } = await ask("set", { id: p.id, ...(p.model ? { model: p.model } : {}), ...(p.effort ? { effort: p.effort } : {}), ...(p.mode ? { mode: p.mode } : {}) }) as { s: Summary }
      return { id: p.id, model: s.model, effort: s.effort, mode: s.mode }
    },
    text: (r) => `Now ${d.modelName(r.model) || "its model"}${r.effort ? `, ${r.effort} effort` : ""}, ${MODE_LABELS[r.mode as Mode] ?? r.mode}.`,
  })

  plugin.op({
    id: "claude-code.chat-list", cli: "chat list", mcp: "chat_list", owner: OWNER, kind: "read", lock: false,
    summary: "The Claude Code sessions running in the app's chat now: each one's state, what it asks, folder, model and mode.",
    run: async () => {
      await keeper(false).catch(() => null)
      return { sessions: [...hosted.values()].map((s) => ({ ...s, title: titleOf(s.id) })) }
    },
    text: (r) => (r.sessions.length ? r.sessions.map(line).join("\n") : "No chat sessions are running."),
  })

  onMachines({
    id: "claude-code.chat-read", cli: "chat read", mcp: "chat_read", owner: OWNER, kind: "read", lock: false,
    summary: "A Claude Code session's conversation as the chat tab shows it: what was said, each tool call, what it asks now.",
    params: { id: ID, limit: { type: "number", description: "how many of the newest entries (default 30)" } },
    args: ["id"],
    run: async (p) => {
      const h = await hello(p.id)
      if (!h.found) throw new OpError(`no session ${p.id} on this machine (or it's in a private account)`, 404)
      const all = new Map(h.history.entries.map((e) => [e.id, e]))
      for (const e of h.live) all.set(e.id, e)
      return { id: p.id, title: h.title, cwd: h.cwd, state: h.s?.state ?? (h.tui !== null ? "in a terminal" : "ended"), entries: [...all.values()].slice(-(Number(p.limit) || 30)) }
    },
    text: (r) => [`# ${r.title || "Chat"} (${r.state})`, ...r.entries.map(entryText).filter(Boolean)].join("\n\n"),
  })

  onMachines({
    id: "claude-code.chat-stop", cli: "chat stop", mcp: "chat_stop", owner: OWNER, kind: "write", lock: false,
    summary: "End a Claude Code chat session's process (what it was doing stops); the conversation stays, to resume with a message or in a terminal.",
    params: { id: ID }, args: ["id"],
    run: async (p) => {
      const s = hosted.get(p.id)
      if (!s) return { id: p.id, stopped: false }
      if (s.state === "error") await ask("forget", { id: p.id })
      else await ask("stop", { id: p.id })
      return { id: p.id, stopped: true }
    },
    text: (r) => (r.stopped ? "Stopped; claude --resume " + r.id + " opens it in a terminal." : "It wasn't running."),
  })

  return {
    hosted: (id: string) => hosted.has(id),
    /** The plugin whose tools session `id` runs with while it runs here, or "". */
    driving: (id: string) => (hosted.has(id) ? drivenBy(id) : ""),
    askingNow, turnNow,
    /** A plugin's sessions (the companion's): resumed as started (its tools...); `serve` gives them again after a
     *  restart; `on` hears each state (null: its process ended, idle a while: the next message resumes it). */
    api: {
      start: (o: ChatStart) => start(o, true),
      send: (id: string, text: string, o: ChatStart = {}) => send(id, text, o),
      stop: async (id: string) => { owned.delete(id); return hosted.has(id) ? await ask("stop", { id }) : { stopped: false } },
      list: () => [...hosted.values()],
      serve(id: string, o: ChatStart) {
        owned.set(id, { ...o, prompt: undefined })
        // (cut off mid-turn by a keeper that ended, before its tools were back: taken up again now)
        if (kept[id] && midTurn(kept[id]) && !hosted.has(id) && can()) void keeper(!!port).then(() => recover(new Set(hosted.keys()))).catch(() => {})
      },
      on(fn: (id: string, s: Summary | null) => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
      /** What it asks now, in words ("Claude wants to run a command: rm -rf build"). */
      asking: (id: string) => [...(asking.get(id)?.values() ?? [])].map((a) => a.title + (a.detail ? `: ${a.detail}` : "")),
    },
    letGo,
  }
}

/** An entry as one Markdown paragraph, for an agent reading a chat. */
function entryText(e: Entry): string {
  switch (e.k) {
    case "user": return `**You:** ${e.text}`
    case "text": return e.text
    case "thinking": return ""
    case "tool": return `\`${e.name}\` ${e.summary}${e.error ? " (failed)" : ""}`
    case "ask": return `**Asks** (${e.kind}): ${e.title}${e.detail ? `: ${e.detail}` : ""}${e.answer ? ` · ${e.answer}` : ""}`
    case "result": return e.ok ? "" : `**Stopped:** ${e.error ?? ""}`
    case "note": return `_${e.text}_`
  }
}
