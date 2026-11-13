// Claude Code's chat sessions on the server: the keeper's client (chatd.ts: started when first needed, followed while it
// runs, so a server that comes back hears what it missed); the chat tab, the ops and the inbox's part are chatsocket.ts, chatops.ts, chatinbox.ts.
import { spawn } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import type { WebSocket } from "ws"
import { type Asking, findBin, HOME, Transcript, transcripts } from "../../../core/agents.ts"
import { agentLines, OpError, outliving, type Plugin } from "../../../core/plugins.ts"
import { byUser as asUser } from "../../../core/writegate.ts"
import { merge, PAGE } from "./chatentries.ts"
import { chatInbox } from "./chatinbox.ts"
import { type Entry, Reader } from "./chatlog.ts"
import { chatOps } from "./chatops.ts"
import { type Answer, codeOf, type Effort, type Event, type Mode, MODES, type Spec, type Summary, type ToolDef } from "./chathost.ts"
import { chatTab } from "./chatsocket.ts"
import { CHAT_SOCKET, FILES, NAME, port, SESSION, WIN, Wire } from "./chatwire.ts"
import { modelId, notAModel } from "./models.ts"
import { memoryLines, unsaid } from "./memory.ts"

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

/** A tool a plugin serves to the session it starts (the companion's): run on the server, called through the keeper
 *  (`use`: the tool_use id, which its streamed input named). One that `streams` hears its input as it's written. */
export type ChatTool = ToolDef & { run: (args: unknown, use?: string) => Promise<unknown>; stream?: (use: string, json: string, end?: "done" | "stop") => void }
export type ChatStart = { prompt?: string; cwd?: string; account?: string; model?: string; effort?: Effort; mode?: Mode; append?: string
  /** Pictures on this machine sent with its message (a screenshot), seen without a Read; `uuid`: that message's id. */
  images?: string[]; uuid?: string
  /** Answers without thinking first (the summoned companion's). */
  quick?: boolean
  /** A lean session: its whole system prompt (no Claude Code's, nor chat.md, nor the user's settings, CLAUDE.md, MCP
   *  servers or skills), and the few of Claude Code's own tools it has (none by default). */
  system?: string; builtins?: string[]
  /** Its words as it writes them (each text block's so far, `use` its entry id; `end` as a tool's stream says). */
  onText?: (use: string, text: string, end?: "done" | "stop" | "tool") => void
  title?: string; by?: string; tools?: ChatTool[]; inbox?: boolean
  /** Permission rules it runs without asking ("mcp__vaultite-app": its tools; "Bash(vau read:*)"), and never. */
  allowed?: string[]; denied?: string[]
  /** Folders besides cwd its read-only commands may read unasked (additionalDirectories). */
  dirs?: string[]
  /** Its permission asks and auto mode's blocks answered by one of its tools (hidden), not the chat tab; shell
   *  commands refused outright; auto mode's rules (chathost.ts' Spec). */
  confirm?: string; never?: string[]; autoMode?: Record<string, string[]> }

/** Byte strings a transcript line needs to be read for the chat (the rest is tool output). */
const WANTED = ['"type":"user"', '"type":"assistant"', '"queued_command"', '"compact_boundary"', '"ai-title"', '"custom-title"']

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

export function chats(plugin: Plugin, d: ChatDeps) {
  const { core, chat } = chatCore(plugin, d)
  chatTab(plugin, core)
  chatOps(plugin, core)
  return chat
}

export type ChatCore = ReturnType<typeof chatCore>["core"]

function chatCore(plugin: Plugin, d: ChatDeps) {
  /** The sessions the keeper runs, as it last told. */
  const hosted = new Map<string, Summary>()
  /** What each asks now (its ask entries), for the inbox's words and agent-asking. */
  const asking = new Map<string, Map<string, Extract<Entry, { k: "ask" }>>>()
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
      // (a keeper of other code, as one left from before an update: ended once quiet, so the change reaches its sessions)
      const h = await w.request("hello").catch(() => ({} as Record<string, unknown>))
      if (h.code !== codeOf(plugin.dir) && typeof h.pid === "number" && h.pid !== process.pid) retire(w, h.pid)
      for (const s of sessions) { hosted.set(s.id, s); void readAsks(w, s.id) }
      // (tabs were told each was gone when the last connection dropped)
      for (const s of sessions) { tellInbox(s); inform(s.id, s); toTabs(s.id, { t: "state", s }) }
      void recover(new Set(sessions.map((s) => s.id)))
      return w
    })()
    wire = p
    p.catch(() => { if (wire === p) wire = null })
    return p
  }
  const ask = async (op: string, params: Record<string, unknown> = {}) => (await keeper(!!port)).request(op, params)
  /** When a session last ran or was started, sent to or about to be (a turn, an ask): a keeper is ended only when none
   *  has for a while. */
  let busyAt = Date.now()
  /** Keeper `pid` (followed by `w`) runs other code than this server's: ended once no session ran for two minutes
   *  (each resumes on its next message). The companion's sessions, never all gone, kept one's first code for days. */
  function retire(w: Wire, pid: number) {
    console.error(`chat: its keeper (pid ${pid}) runs other code: ending it once it's quiet`)
    const t = setInterval(() => {
      if (w.closed) return clearInterval(t)
      // (ending it ends what sessions run in the background too)
      if ([...hosted.values()].some((s) => s.state === "working" || s.state === "waiting" || s.state === "starting" || s.background) || Date.now() - busyAt < 2 * 60_000) return
      clearInterval(t)
      try { process.kill(pid, "SIGTERM") } catch { /* gone */ }
    }, 15_000)
    t.unref?.()
  }
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
  let kept: Record<string, Kept> = {}, read = false
  // (read once the vault is loaded, its local dir known: not as the module loads; what's kept since wins)
  plugin.onSync(() => {
    if (read) return
    read = true
    try { kept = { ...JSON.parse(fs.readFileSync(keptFile(), "utf8")), ...kept } } catch { /* none yet */ }
  })
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

  function hear(m: Record<string, unknown>) {
    const e = m as Event
    if (e.t === "put") {
      if (e.e.k === "ask") { if (e.e.answer) asking.get(e.id)?.delete(e.e.id); else asksOf(e.id).set(e.e.id, e.e) }
      toTabs(e.id, { t: "put", e: e.e })
    } else if (e.t === "drop") toTabs(e.id, { t: "drop", e: e.e })
    else if (e.t === "state") {
      if (e.s.state !== "idle" && e.s.state !== "error") busyAt = Date.now()
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
    // (its calls are the session's, as an agent's request: never this plugin acting on its own, as a socket its timer
    // opened would have them, so the write gate doesn't refuse a session's edit of a note)
    } else if (e.t === "tool") void asUser(() => runTool(e.id, e.call, e.name, e.args, e.use))
    else if (e.t === "partial") {
      try { asUser(() => { if (e.name) toolOf(e.id, e.name)?.stream?.(e.use, e.json, e.end === "tool" ? undefined : e.end); else owned.get(e.id)?.onText?.(e.use, e.json, e.end) }) } catch (err) { console.error("chat: stream:", err) }
    }
    else if (e.t === "did") {
      // (Activity's intake for agents' hooks, the session named by its title)
      const q = new URLSearchParams({ agent: "claude-code", session: titleOf(e.id) || e.id.slice(0, 8) })
      void plugin.host.api("POST", `activity/hook?${q}`, { tool_name: e.tool, tool_input: e.input }).catch(() => {})
    }
  }

  const toolOf = (id: string, name: string) => owned.get(id)?.tools?.find((t) => t.name === name)
  async function runTool(id: string, call: string, name: string, args: unknown, use?: string) {
    // (a server just started: its plugin serves the session's tools again in a moment, serve)
    for (let i = 0; i < 100 && !toolOf(id, name); i++) await new Promise((r) => setTimeout(r, 200))
    const t = toolOf(id, name)
    let result: unknown
    try {
      result = t ? await t.run(args, use) : { isError: true, content: [{ type: "text", text: `Vaultite serves no tool ${name} to this session now: the plugin that started it is off` }] }
    } catch (err) {
      result = { isError: true, content: [{ type: "text", text: String((err as Error)?.message ?? err) }] }
    }
    await ask("tool-result", { call, result }).catch(() => {})
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

  /** What a session in `cwd` is told it runs in (chat.md), then the plugins' lines, less what its CLAUDE.md files say. */
  function chatContext(cwd: string, a: Account) {
    let text = ""
    try { text = fs.readFileSync(path.join(plugin.dir, "chat.md"), "utf8").trim().replace(/\n(?!\n)/g, " ") } catch { /* none */ }
    return unsaid([text, ...agentLines(plugin.vault).map((l) => `- ${l.text}`)].filter(Boolean).join("\n"), memoryLines(cwd, a.dir))
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
    // (one told the vault's lines tells its MCP server so: VAULTITE_TOLD, so they reach it once)
    const cwd = o.cwd || plugin.vault.path, lean = o.system !== undefined
    const env = { ...await envFor(a), CLAUDE_CODE_SESSION_ID: id, VAULTITE_AGENT: "claude", ...(lean ? {} : { VAULTITE_TOLD: "1" }) }
    return { id, resume: o.resume, cwd, env, claude: claudeBin(), account: a.id, by: o.by ?? "app",
      ...(o.model ? { model: o.model } : {}), ...(o.effort ? { effort: o.effort } : {}), mode: o.mode || modeDefault(a.id),
      ...(lean ? { system: o.system, builtins: o.builtins ?? [] } : { append: [chatContext(cwd, a), o.append].filter(Boolean).join("\n\n") }),
      ...(o.onText ? { texts: true } : {}), ...(o.title ? { title: o.title } : {}),
      ...(o.tools?.length ? { tools: o.tools.map(({ name, description, schema, streams, ends, hidden }) => ({ name, description, schema, ...(streams ? { streams } : {}), ...(ends ? { ends } : {}), ...(hidden ? { hidden } : {}) })) } : {}),
      ...(o.confirm ? { confirm: o.confirm } : {}), ...(o.never?.length ? { never: o.never } : {}), ...(o.autoMode ? { autoMode: o.autoMode } : {}),
      ...(o.allowed?.length ? { allowed: o.allowed } : {}), ...(o.denied?.length ? { denied: o.denied } : {}), ...(o.dirs?.length ? { dirs: o.dirs } : {}), ...(o.inbox === false ? { quiet: true } : {}), ...(o.quick ? { quick: true } : {}) }
  }

  /** Model `said` as people say it ("Fable 5.2") as --model takes it (claude-fable-5-2); refused when it names none. */
  function runsAs(said: string) {
    const id = modelId(said)
    if (id === null) throw new OpError(notAModel(said))
    return id
  }
  /** A new session: its id. `own`: a plugin's, run so again when it's resumed. */
  async function start(o: ChatStart, own = false) {
    busyAt = Date.now()
    const a = accountOf(o.account)
    if (o.cwd && !fs.statSync(o.cwd, { throwIfNoEntry: false })?.isDirectory()) throw new OpError(`there's no folder ${o.cwd}`, 404)
    if (o.model) o = { ...o, model: runsAs(o.model) }
    const id = crypto.randomUUID()
    if (own) owned.set(id, { ...o, prompt: undefined, images: undefined, uuid: undefined })
    const said = o.prompt?.trim() || o.images?.length ? { prompt: o.prompt?.trim() ?? "", ...(o.images?.length ? { images: o.images } : {}), ...(o.uuid ? { uuid: o.uuid } : {}) } : {}
    const { s } = await ask("start", { spec: await specFor(id, { ...o, resume: false }, a), ...said }) as { s: Summary }
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
    busyAt = Date.now()
    if (given.model) given = { ...given, model: runsAs(given.model) }
    if (!SESSION.test(id)) throw new OpError(`'${id}' isn't a session id`)
    const o = { ...owned.get(id), ...given }
    const said = text.trim(), pics = { ...(given.images?.length ? { images: given.images } : {}), ...(given.uuid ? { uuid: given.uuid } : {}) }
    if (!said && !given.images?.length) throw new OpError("`text`: what to say (or `images`)")
    let lost: Summary | undefined
    if (hosted.has(id) && hosted.get(id)!.state !== "error") {
      // (chosen in a tab that didn't know it ran yet: applied before what it's told)
      const s = hosted.get(id)!, was = owned.get(id)
      // (as it was started is as it runs: "sonnet" runs as its full name)
      const change = { ...(given.model && given.model !== s.model && given.model !== was?.model ? { model: given.model } : {}),
        ...(given.effort && given.effort !== s.effort && given.effort !== was?.effort ? { effort: given.effort } : {}),
        ...(given.mode && given.mode !== s.mode ? { mode: given.mode } : {}) }
      try {
        if (Object.keys(change).length) await ask("set", { id, ...change })
        return await ask("send", { id, text: said, ...pics }) as { uuid: string; answered?: string }
      } catch (e) {
        // (its process ended a moment ago, idle a while, its news on the way: resumed with it instead)
        if (!/^no session \S+ runs here$/.test((e as Error).message)) throw e
        lost = hosted.get(id)
        hosted.delete(id)
      }
    }
    const why = await busyElsewhere(id)
    if (why) throw new OpError(why, 409)
    const f = d.sessionFile(id)
    if (!f) throw new OpError(`no session ${id} on this machine (or it's in a private account)`, 404)
    if (f.account.private) throw new OpError("it's in a private account, which the app doesn't show", 403)
    const t = await readTitle(id)
    const before = hosted.get(id), was = before ?? lost
    const { s } = await ask("start", { spec: await specFor(id, { ...o, resume: true, cwd: o.cwd || t?.cwd || "",
      model: o.model || was?.model || undefined, effort: o.effort || (was?.effort || undefined) as Effort | undefined, mode: o.mode || was?.mode || kept[id]?.mode }, f.account), prompt: said,
      ...pics }) as { s: Summary }
    if (hosted.get(id) === before) hosted.set(id, s)
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
  const { tellInbox } = chatInbox(plugin, { asking, kept: () => kept, save, titleOf, readTitle, ask, can, hosted, d, busyElsewhere, send, answer, start })


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

  // ---------- what the chat tab hears and reads (chatsocket.ts)

  /** What each tab not yet sent its hello hears meanwhile: sent after it, so nothing told is lost or undone. */
  const holding = new WeakMap<WebSocket, string[]>()
  function toTabs(id: string, m: object) {
    const tabs = watching.get(id)
    if (!tabs?.size) return
    const text = JSON.stringify(m)
    for (const ws of tabs) { const held = holding.get(ws); if (held) held.push(text); else if (ws.readyState === ws.OPEN) ws.send(text) }
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

  /** The model an account's sessions start with (its settings' `model`), "" when Claude Code picks. */
  function modelDefault(account: string) {
    const a = d.accounts().find((x) => x.id === account)
    try { const m = a ? (JSON.parse(fs.readFileSync(path.join(a.dir, "settings.json"), "utf8")) as { model?: unknown }).model : ""; return typeof m === "string" ? m : "" } catch { return "" }
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

  /** A session's conversation: its transcript with what the keeper has of it merged in (merge), and its state as of
   *  that read (what's told after it is newer). */
  async function conversation(id: string) {
    const t = await readTitle(id)
    const live = hosted.has(id) ? ((await ask("read", { id }).catch(() => null)) as { entries: Entry[] } | null)?.entries ?? [] : []
    return { t, s: hosted.get(id) ?? null, list: merge(t?.list ?? [], live) }
  }

  async function hello(id: string) {
    const { t, s, list } = await conversation(id)
    const f = d.sessionFile(id)
    const account = s?.account || f?.account.id || ""
    return { t: "hello", id, s, title: t?.title ?? "", cwd: s?.cwd || t?.cwd || "", account, model: t?.model ?? "", effort: effortDefault(account, s?.model || t?.model),
      history: page(list), tui: s ? null : await d.tuiOf(id), found: !!(s || t), driven: drivenBy(id) }
  }

  return {
    core: { d, hosted, asking, watching, holding, kept: () => kept, save, ask, keeper, can, titleOf, readTitle, start, send, answer, hostedOr404, runsAs,
      busyElsewhere, hello, conversation, page, modelDefault, effortDefault, modeDefault },
    chat: {
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
        /** Stop its turn where it is (the user's Esc): false when none runs. */
        interrupt: async (id: string) => {
          const s = hosted.get(id)
          if (!s || (s.state !== "working" && s.state !== "waiting")) return false
          await ask("interrupt", { id })
          return true
        },
        list: () => [...hosted.values()],
        /** A session of the plugin's is about to be used (its Talk key pressed, an ask on its way): the keeper isn't ended
         *  for a while, so what was warmed for it is still there. */
        touch: () => { busyAt = Date.now() },
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
    },
  }
}
