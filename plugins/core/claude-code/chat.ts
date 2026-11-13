import { spawn } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import type { WebSocket } from "ws"
import { z } from "zod"
import { type Asking, findBin, HOME, Transcript, transcripts } from "../../../core/agents.ts"
import { agentLines, logger, OpError, outliving, type Plugin, whenListening } from "../../../core/plugins.ts"
import { byUser as asUser } from "../../../core/writegate.ts"
import { merge, PAGE } from "./chatentries.ts"
import { chatInbox } from "./chatinbox.ts"
import { type Entry, Reader } from "./chatlog.ts"
import { chatOps } from "./chatops.ts"
import { type Answer, codeOf, type Effort, effortOf, type Event, type Mode, modeOf, type Spec, type Summary, type ToolDef } from "./chathost.ts"
import { chatTab } from "./chatsocket.ts"
import { CHAT_SOCKET, FILES, NAME, port, SESSION, WIN, Wire } from "./chatwire.ts"
import { modelId, notAModel } from "./models.ts"
import { memoryLines, unsaid } from "./memory.ts"
const log = logger("chat")

type Account = { id: string; dir: string; label: string; private: boolean }
const Settings = z.looseObject({
  permissions: z.looseObject({ defaultMode: z.string().optional().catch(undefined) }).optional().catch(undefined), model: z.unknown().optional(),
  effortLevel: z.unknown().optional(), modelSettings: z.record(z.string(), z.looseObject({ effortLevel: z.unknown().optional() }).catch({})).optional().catch(undefined),
}).catch({})

export type ChatDeps = {
  accounts: () => Account[]
  sessionFile: (id: string, all?: boolean) => { file: string; account: Account } | null
  tuiOf: (id: string) => Promise<string | null>
  inTerminals: () => Promise<Set<string>>
  folders: () => Promise<string[]>
  models: () => { models: { id: string; label: string }[]; efforts: string[] }
  modelName: (model: string) => string
}

/** A tool a plugin serves its session, run on the server (`use`: the tool_use id its streamed input named). */
export type ChatTool = ToolDef & { run: (args: unknown, use?: string) => Promise<unknown>; stream?: (use: string, json: string, end?: "done" | "stop") => void }
export type ChatStart = { prompt?: string; cwd?: string; account?: string; model?: string; effort?: Effort; mode?: Mode; append?: string
  /** Pictures on this machine sent with its message (a screenshot), seen without a Read; `uuid`: that message's id. */
  images?: string[]; uuid?: string
  /** Answers without thinking first (the summoned companion's). */
  quick?: boolean
  /** A lean session: its whole system prompt, none of the user's settings, CLAUDE.md, MCP servers or skills. */
  system?: string; builtins?: string[]
  /** Its words as it writes them (each text block's so far, `use` its entry id; `end` as a tool's stream says). */
  onText?: (use: string, text: string, end?: "done" | "stop" | "tool") => void
  title?: string; by?: string; tools?: ChatTool[]; inbox?: boolean
  /** Permission rules it runs without asking ("mcp__vaultite-app": its tools; "Bash(vau read:*)"), and never. */
  allowed?: string[]; denied?: string[]
  /** Folders besides cwd its read-only commands may read unasked (additionalDirectories). */
  dirs?: string[]
  /** Asks and auto mode's blocks answered by its hidden tool `confirm`; `never`: shell commands refused; auto mode's rules. */
  confirm?: string; never?: string[]; autoMode?: Record<string, string[]> }

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
  const hosted = new Map<string, Summary>()
  const asking = new Map<string, Map<string, Extract<Entry, { k: "ask" }>>>()
  const watching = new Map<string, Set<WebSocket>>()
  const owned = new Map<string, ChatStart>()
  const listeners = new Set<(id: string, s: Summary | null) => void>()
  const inform = (id: string, s: Summary | null) => { for (const fn of listeners) try { fn(id, s) } catch (e) { log.error("a listener failed", e, { id }) } }
  let wire: Promise<Wire> | null = null

  const daemon = path.join(plugin.dir, "chatd.ts")
  function startKeeper() {
    let ended = false
    const run = (plain: boolean) => {
      let out: number | "ignore" = "ignore"
      try { out = fs.openSync(`${FILES}.log`, "a") } catch {}
      const [cmd, args] = plain ? [process.execPath, [daemon, CHAT_SOCKET, FILES]] : outliving(process.execPath, [daemon, CHAT_SOCKET, FILES], `chatd-${NAME}`)
      const child = spawn(cmd, args, { detached: true, stdio: ["ignore", out, out], cwd: os.homedir(), env: process.env, windowsHide: true })
      child.once("error", () => { ended = true })
      child.once("exit", (code) => { if (cmd !== process.execPath && code) run(true); else ended = true })
      child.unref()
      if (typeof out === "number") fs.closeSync(out)
    }
    run(false)
    return { ended: () => ended }
  }
  const connectTo = () => new Promise<Wire>((ok, fail) => {
    const sock = net.connect(CHAT_SOCKET)
    sock.once("connect", () => { sock.removeAllListeners("error"); ok(new Wire(sock, hear, () => { wire = null; dropAll() })) })
    sock.once("error", fail)
  })

  function keeper(start = true): Promise<Wire> {
    if (wire) return wire
    const p = (async () => {
      let w: Wire | null = null
      try { w = await connectTo() } catch {
        if (!start) throw new Error("no chat keeper runs")
        w = await whenListening(connectTo, startKeeper())
        if (!w) throw new Error(`the chat keeper didn't start (see ${FILES}.log)`)
      }
      const { sessions } = await w.request("follow") as { sessions: Summary[] }
      const h = await w.request("hello").catch(() => ({} as Record<string, unknown>))
      if (h.code !== codeOf(plugin.dir) && typeof h.pid === "number" && h.pid !== process.pid) retire(w, h.pid)
      for (const s of sessions) { hosted.set(s.id, s); void readAsks(w, s.id) }
      for (const s of sessions) { tellInbox(s); inform(s.id, s); toTabs(s.id, { t: "state", s }) }
      void recover(new Set(sessions.map((s) => s.id)))
      return w
    })()
    wire = p
    p.catch(() => { if (wire === p) wire = null })
    return p
  }
  const ask = async (op: string, params: Record<string, unknown> = {}) => (await keeper(!!port)).request(op, params)
  let busyAt = Date.now()
  function retire(w: Wire, pid: number) {
    log.warn("its keeper runs other code: ending it once it's quiet", { pid })
    const t = setInterval(() => {
      if (w.closed) return clearInterval(t)
      if ([...hosted.values()].some((s) => s.state === "working" || s.state === "waiting" || s.state === "starting" || s.background) || Date.now() - busyAt < 2 * 60_000) return
      clearInterval(t)
      try { process.kill(pid, "SIGTERM") } catch {}
    }, 15_000)
    t.unref?.()
  }
  const can = () => !!port || !!wire || (!WIN && fs.existsSync(CHAT_SOCKET))

  const look = () => {
    if (wire) { for (const s of hosted.values()) tellInbox(s); void handOver() }
    else if (WIN || fs.existsSync(CHAT_SOCKET) || (port && Object.values(kept).some((k) => midTurn(k) && (!k.tools || owned.has(k.id))))) keeper(!!port).catch(() => {})
  }


  type Kept = Pick<Summary, "id" | "cwd" | "account" | "model" | "effort" | "mode" | "by" | "at"> & { state: Summary["state"] | "closed"; tools?: boolean; quiet?: boolean
    thread?: string }
  const keptFile = () => path.join(plugin.localDir(), "chats.json")
  let kept: Record<string, Kept> = {}, read = false
  plugin.onSync(() => {
    if (read) return
    read = true
    try { kept = { ...JSON.parse(fs.readFileSync(keptFile(), "utf8")), ...kept } } catch {}
  })
  let saving: ReturnType<typeof setTimeout> | null = null
  const save = () => { saving ??= setTimeout(() => { saving = null; try { fs.writeFileSync(keptFile(), JSON.stringify(kept)) } catch (e) { log.error("keeping sessions", e) } }, 500) }
  const midTurn = (k: Kept) => k.state === "working" || k.state === "waiting" || k.state === "starting"
  function keep(s: Summary | null, id = s?.id ?? "") {
    if (!s) { if (kept[id]) kept[id] = { ...kept[id], state: "closed" } }
    else kept[id] = { id, state: s.state, cwd: s.cwd, account: s.account, model: s.model, effort: s.effort, mode: s.mode, by: s.by, at: s.at,
      ...(owned.get(id)?.tools?.length || kept[id]?.tools ? { tools: true } : {}), ...(s.quiet ? { quiet: true } : {}), ...(kept[id]?.thread ? { thread: kept[id].thread } : {}) }
    const ids = Object.keys(kept)
    for (const old of ids.slice(0, Math.max(0, ids.length - 300))) delete kept[old]
    save()
  }
  const revived = new Map<string, number[]>()
  async function recover(running: Set<string>) {
    for (const k of Object.values(kept)) {
      if (running.has(k.id)) continue
      if (k.tools && !owned.has(k.id) && midTurn(k)) continue
      if (!midTurn(k)) { if (k.state !== "closed") { kept[k.id] = { ...k, state: "closed" }; save() } continue }
      const times = (revived.get(k.id) ?? []).filter((t) => Date.now() - t < 5 * 60_000)
      if (times.length >= 3) continue
      revived.set(k.id, [...times, Date.now()])
      try {
        await send(k.id, "Continue where you left off.", { model: k.model || undefined, effort: effortOf(k.effort), mode: k.mode, by: k.by })
        log.info("took a session up again after its keeper ended", { id: k.id })
      } catch (e) { log.error("couldn't take a session up again", e, { id: k.id }); kept[k.id] = { ...k, state: "closed" }; save() }
    }
  }
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
    } catch {}
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
      // Claude Code names a session a moment after its first turns end
      if (e.s.state === "idle" && was !== "idle" && watching.has(e.s.id)) for (const ms of [500, 4000]) setTimeout(() => void sayTitle(e.s.id), ms)
    } else if (e.t === "gone") {
      keep(null, e.id)
      hosted.delete(e.id)
      asking.delete(e.id)
      toTabs(e.id, { t: "state", s: null })
      inform(e.id, null)
    } else if (e.t === "tool") void asUser(() => runTool(e.id, e.call, e.name, e.args, e.use))
    else if (e.t === "partial") {
      try { asUser(() => { if (e.name) toolOf(e.id, e.name)?.stream?.(e.use, e.json, e.end === "tool" ? undefined : e.end); else owned.get(e.id)?.onText?.(e.use, e.json, e.end) }) } catch (err) { log.error("stream", err, { id: e.id }) }
    }
    else if (e.t === "did") {
      const q = new URLSearchParams({ agent: "claude-code", session: titleOf(e.id) || e.id.slice(0, 8) })
      void plugin.host.api("POST", `activity/hook?${q}`, { tool_name: e.tool, tool_input: e.input }).catch(() => {})
    }
  }

  const toolOf = (id: string, name: string) => owned.get(id)?.tools?.find((t) => t.name === name)
  async function runTool(id: string, call: string, name: string, args: unknown, use?: string) {
    for (let i = 0; i < 100 && !toolOf(id, name); i++) await new Promise((r) => setTimeout(r, 200))
    const t = toolOf(id, name)
    let result: unknown
    try {
      result = t ? await t.run(args, use) : { isError: true, content: [{ type: "text", text: `Vaultite serves no tool ${name} to this session now: the plugin that started it is off` }] }
    } catch (err) {
      result = { isError: true, content: [{ type: "text", text: (err instanceof Error ? err.message : String(err)) }] }
    }
    await ask("tool-result", { call, result }).catch(() => {})
  }

  async function sayTitle(id: string) {
    const before = titleOf(id), t = await readTitle(id).catch(() => null)
    if (t?.title && t.title !== before) toTabs(id, { t: "title", title: t.title })
  }


  const history = transcripts((file) => new Transcript(file, () => new Talk(), WANTED))
  async function talkOf(id: string) {
    const f = d.sessionFile(id)
    return f ? (await history(f.file))?.talk ?? null : null
  }
  const titles = new Map<string, string>()
  const titleOf = (id: string) => titles.get(id) ?? ""
  async function readTitle(id: string) {
    const t = await talkOf(id)
    if (t?.title) titles.set(id, t.title)
    if (titles.size > 500) titles.delete(titles.keys().next().value!)
    return t
  }


  const claudeBin = () => findBin("claude") ?? undefined

  function chatContext(cwd: string, a: Account) {
    let text = ""
    try { text = fs.readFileSync(path.join(plugin.dir, "chat.md"), "utf8").trim().replace(/\n(?!\n)/g, " ") } catch {}
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
    if (a.dir !== path.join(HOME, ".claude") || process.env.CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = a.dir
    else delete env.CLAUDE_CONFIG_DIR
    delete env.CLAUDECODE
    delete env.CLAUDE_CODE_ENTRYPOINT
    return env
  }

  async function specFor(id: string, o: ChatStart & { resume: boolean }, a: Account): Promise<Spec> {
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

  function runsAs(said: string) {
    const id = modelId(said)
    if (id === null) throw new OpError(notAModel(said))
    return id
  }
  async function start(o: ChatStart, own = false) {
    busyAt = Date.now()
    const a = accountOf(o.account)
    if (o.cwd && !fs.statSync(o.cwd, { throwIfNoEntry: false })?.isDirectory()) throw new OpError(`there's no folder ${o.cwd}`, 404)
    if (o.model) o = { ...o, model: runsAs(o.model) }
    const id = crypto.randomUUID()
    if (own) owned.set(id, { ...o, prompt: undefined, images: undefined, uuid: undefined })
    const said = o.prompt?.trim() || o.images?.length ? { prompt: o.prompt?.trim() ?? "", ...(o.images?.length ? { images: o.images } : {}), ...(o.uuid ? { uuid: o.uuid } : {}) } : {}
    const { s } = await ask("start", { spec: await specFor(id, { ...o, resume: false }, a), ...said }) as { s: Summary }
    if (!hosted.has(id)) hosted.set(id, s)
    return hosted.get(id)!
  }

  async function busyElsewhere(id: string) {
    if (hosted.has(id)) return ""
    const t = await d.tuiOf(id)
    return t === null ? "" : t ? `it runs in the app's terminal ${t}: answer it there, or end it first` : "it runs in Claude Code in a terminal: answer it there, or end it first"
  }

  async function send(id: string, text: string, given: ChatStart = {}) {
    busyAt = Date.now()
    if (given.model) given = { ...given, model: runsAs(given.model) }
    if (!SESSION.test(id)) throw new OpError(`'${id}' isn't a session id`)
    const o = { ...owned.get(id), ...given }
    const said = text.trim(), pics = { ...(given.images?.length ? { images: given.images } : {}), ...(given.uuid ? { uuid: given.uuid } : {}) }
    if (!said && !given.images?.length) throw new OpError("`text`: what to say (or `images`)")
    let lost: Summary | undefined
    if (hosted.has(id) && hosted.get(id)!.state !== "error") {
      const s = hosted.get(id)!, was = owned.get(id)
      const change = { ...(given.model && given.model !== s.model && given.model !== was?.model ? { model: given.model } : {}),
        ...(given.effort && given.effort !== s.effort && given.effort !== was?.effort ? { effort: given.effort } : {}),
        ...(given.mode && given.mode !== s.mode ? { mode: given.mode } : {}) }
      try {
        if (Object.keys(change).length) await ask("set", { id, ...change })
        return await ask("send", { id, text: said, ...pics }) as { uuid: string; answered?: string }
      } catch (e) {
        if (!/^no session \S+ runs here$/.test(e instanceof Error ? e.message : String(e))) throw e
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
      model: o.model || was?.model || undefined, effort: o.effort || effortOf(was?.effort), mode: o.mode || was?.mode || kept[id]?.mode }, f.account), prompt: said,
      ...pics }) as { s: Summary }
    if (hosted.get(id) === before) hosted.set(id, s)
    return { uuid: "", resumed: true }
  }

  function hostedOr404(id: string) {
    const s = hosted.get(id)
    if (!s) throw new OpError(`session ${id} isn't running in the app (vau chat list)`, 404)
    return s
  }

  function drivenBy(id: string) {
    const k = kept[id]
    return owned.get(id)?.tools?.length || k?.tools ? (hosted.get(id)?.by || k?.by || "a plugin") : ""
  }

  async function answer(id: string, a: Answer, askId = "") {
    hostedOr404(id)
    const at = askId || [...(asking.get(id)?.keys() ?? [])].at(-1)
    if (!at) throw new OpError("it doesn't ask anything now", 409)
    return (await ask("answer", { id, ask: at, answer: a }) as { s: Summary }).s
  }
  const { tellInbox } = chatInbox(plugin, { asking, kept: () => kept, save, titleOf, readTitle, ask, can, hosted, d, busyElsewhere, send, answer, start })


  function askingNow(id: string): Asking | null | undefined {
    if (!hosted.has(id)) return undefined
    const a = [...(asking.get(id)?.values() ?? [])].at(-1)
    if (a?.kind === "question" && a.questions?.length) return { kind: "question", questions: a.questions }
    if (a?.kind === "plan" && a.plan) return { kind: "plan", plan: a.plan }
    return null
  }
  const turnNow = (id: string) => {
    const s = hosted.get(id)
    return s?.turn ? { session: id, prompt: s.turn.prompt, text: s.turn.text, at: s.at, final: s.state !== "working", ...(titleOf(id) ? { title: titleOf(id) } : {}) } : null
  }


  const holding = new WeakMap<WebSocket, string[]>()
  function toTabs(id: string, m: object) {
    const tabs = watching.get(id)
    if (!tabs?.size) return
    const text = JSON.stringify(m)
    for (const ws of tabs) { const held = holding.get(ws); if (held) held.push(text); else if (ws.readyState === ws.OPEN) ws.send(text) }
  }

  function page(list: Entry[], before = list.length, limit = PAGE) {
    const end = Math.min(Math.max(before, 0), list.length), start = Math.max(end - limit, 0)
    return { entries: list.slice(start, end), start, total: list.length }
  }

  function modeDefault(account: string): Mode {
    const a = d.accounts().find((x) => x.id === account)
    try {
      const m = a ? modeOf(Settings.parse(JSON.parse(fs.readFileSync(path.join(a.dir, "settings.json"), "utf8"))).permissions?.defaultMode) : undefined
      if (m) return m
    } catch {}
    return "auto"
  }

  function modelDefault(account: string) {
    const a = d.accounts().find((x) => x.id === account)
    try { const m = a ? Settings.parse(JSON.parse(fs.readFileSync(path.join(a.dir, "settings.json"), "utf8"))).model : ""; return typeof m === "string" ? m : "" } catch { return "" }
  }

  function effortDefault(account: string, model = "") {
    const a = d.accounts().find((x) => x.id === account)
    if (!a) return ""
    try {
      const st = Settings.parse(JSON.parse(fs.readFileSync(path.join(a.dir, "settings.json"), "utf8")))
      const v = st.modelSettings?.[model]?.effortLevel ?? st.effortLevel
      return typeof v === "string" ? v : ""
    } catch { return "" }
  }

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
      driving: (id: string) => (hosted.has(id) ? drivenBy(id) : ""),
      askingNow, turnNow,
      /** A plugin's sessions: resumed as started; `serve` gives their tools again after a restart; `on` hears each state. */
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
        /** One of its sessions is about to be used (its Talk key pressed): the keeper isn't ended for a while. */
        touch: () => { busyAt = Date.now() },
        serve(id: string, o: ChatStart) {
          owned.set(id, { ...o, prompt: undefined })
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
