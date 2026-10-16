// Cursor: what Cursor (the IDE and its CLI, `agent`) does on this machine: chats from its own files, usage from Cursor's
// dashboard with the IDE's sign-in (account.ts; Grok Bot's requests are its own plugin's). Nothing is written.
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { type AgentStart, ago, codingAgent, truncate, cwds, type Entry, HOME, isoOf, parseJson, limitRows, limitWindow, type Live, notOnThisMachine, processes, projectName,
  shellQuote, projectRoots, type Said, scanDays, sessionsOf, SqliteFile, Tally, terminalOf, type Tool, toolSummary } from "../../../core/agents.ts"
import { clampPct, CURSOR_USER_DIR as USER_DIR, cursorAccount, type CursorAccount, cursorModelName as modelName, cursorState as stateDb, forgetCursorAccount, isGrokBot,
  minutesBetween, NO_ACCOUNT, secOf as sec, stored, text } from "./account.ts"
import { localDate, Plugin, section } from "../../../core/plugins.ts"
import { sortBy } from "../../../core/vault.ts"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

export const plugin = new Plugin(import.meta.url)
const GAP = 5 * 60_000 // requests further apart than this aren't one stretch of work
const LIVE_MIN = 10 // Cursor.app counts as working on a chat touched in the last 10 minutes

// Cursor's plans (membershipType) and their monthly price in US dollars (per seat for teams).
const PLANS: Record<string, [string, number | null]> = {
  free: ["Hobby", null], free_trial: ["Pro trial", null], pro: ["Pro", 20], pro_plus: ["Pro+", 60], ultra: ["Ultra", 200],
  business: ["Teams", 40], team: ["Teams", 40], enterprise: ["Enterprise", null],
}

const dayOf = (ms: number) => localDate(new Date(ms))

// ---------- the chats on this machine: the IDE's in its state.vscdb (CURSOR_USER_DIR), the CLI's in ~/.cursor/chats

const CONFIG_DIR = process.env.CURSOR_CONFIG_DIR || path.join(HOME, ".cursor")
plugin.folders(() => [CONFIG_DIR, USER_DIR])
plugin.onUnload(() => stateDb.close()) // (opened again when asked)
const CHATS = path.join(CONFIG_DIR, "chats")

/** A chat on this machine: from the IDE or the CLI. Times in epoch ms. */
type Chat = { id: string; source: "ide" | "cli"; title: string; cwd: string; model: string; first: number; last: number
  status: string; dir?: string }

/** Epoch ms from ms, seconds or an ISO string (Cursor has written each). */
function ms(v: unknown): number {
  if (typeof v === "string" && v && !/^\d+$/.test(v)) { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t }
  const n = Number(v)
  return !Number.isFinite(n) || n <= 0 ? 0 : n < 1e11 ? n * 1000 : n
}
const stat = (p: string) => { try { return fs.statSync(p) } catch { return null } }
const readJson = (p: string): Any => { try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return null } }
const fileUri = (u: unknown) => {
  const s = typeof u === "string" ? u : (u as Any)?.fsPath || (u as Any)?.path || (u as Any)?.external || ""
  if (typeof s !== "string" || !s) return ""
  if (!s.startsWith("file://")) return s.startsWith("/") ? s : ""
  try { return decodeURIComponent(new URL(s).pathname) } catch { return "" }
}

// ---------- the IDE

/** The folder of each of the IDE's workspaces (workspaceStorage/<id>/workspace.json), read once a minute. */
let folders: [number, Map<string, string>] = [0, new Map()]
function workspaceFolders() {
  if (Date.now() - folders[0] < 60_000) return folders[1]
  const map = new Map<string, string>()
  const dir = path.join(USER_DIR, "workspaceStorage")
  let names: string[] = []
  try { names = fs.readdirSync(dir) } catch { /* none */ }
  for (const n of names) {
    const f = fileUri(readJson(path.join(dir, n, "workspace.json"))?.folder)
    if (f) map.set(n, f)
  }
  folders = [Date.now(), map]
  return map
}

/** The IDE's chats (cursorDiskKV's composerData:<id>; composerHeaders says a chat's workspace), read again only when its database changed (the file or its WAL), at most every 10 s. */
let ide: { at: number; sig: string; chats: Chat[] } = { at: 0, sig: "", chats: [] }
async function ideChats(): Promise<Chat[]> {
  if (Date.now() - ide.at < 10_000) return ide.chats
  const sig = [stateDb.file, `${stateDb.file}-wal`].map((p) => { const s = stat(p); return s ? `${s.size}:${s.mtimeMs}` : "" }).join("|")
  if (sig === ide.sig) { ide.at = Date.now(); return ide.chats }
  const db = stateDb.open()
  if (!db) { ide = { at: Date.now(), sig, chats: [] }; return [] }
  // (older versions: no composerHeaders)
  const heads = new Map(stateDb.all("SELECT composerId, workspaceId, isSubagent FROM composerHeaders").map((h) => [String(h.composerId), h]))
  const where = workspaceFolders()
  let rows: Any[]
  try {
    // Only the fields needed: an old composerData holds its whole conversation.
    rows = db.prepare(`WITH c AS (SELECT key, CAST(value AS TEXT) AS v FROM cursorDiskKV WHERE key LIKE 'composerData:%')
      SELECT key, json_extract(v, '$.name') AS name, json_extract(v, '$.createdAt') AS created, json_extract(v, '$.lastUpdatedAt') AS updated,
      json_extract(v, '$.status') AS status, json_extract(v, '$.isDraft') AS draft, json_extract(v, '$.modelConfig.modelName') AS model,
      json_array_length(v, '$.fullConversationHeadersOnly') AS n, json_array_length(v, '$.conversation') AS old,
      json_extract(v, '$.workspaceIdentifier') AS ws, json_extract(v, '$.subagentInfo') AS sub FROM c WHERE json_valid(v)`).all()
  } catch {
    ide.at = Date.now() // unreadable right now: what was read last time
    return ide.chats
  }
  const chats: Chat[] = []
  for (const r of rows) {
    const id = String(r.key).slice("composerData:".length)
    const head = heads.get(id)
    if (!(r.n || r.old) || r.draft || r.sub || head?.isSubagent) continue
    const ws = parseJson(r.ws) ?? {}
    const cwd = fileUri(ws.uri) || where.get(String(head?.workspaceId ?? ws.id ?? "")) || ""
    const first = ms(r.created), last = ms(r.updated) || first
    chats.push({ id, source: "ide", title: String(r.name || ""), cwd, model: String(r.model || ""), first, last, status: String(r.status || "") })
  }
  ide = { at: Date.now(), sig, chats }
  return chats
}

// ---------- the CLI

/** store.db's metadata: key "0" is the hex of a JSON (agentId, name, createdAt, lastUsedModel, mode...). */
function storeMeta(db: SqliteFile): Any {
  const s = text(db.all("SELECT value FROM meta WHERE key = '0'")[0]?.value)
  return parseJson(/^[0-9a-f]+$/i.test(s) && s.length % 2 === 0 ? Buffer.from(s, "hex") : s) ?? {}
}

const cli = new Map<string, [number, Chat | null]>() // chat folder -> [its meta.json and store.db mtimes, the chat]
async function cliChat(dir: string): Promise<Chat | null> {
  const m = stat(path.join(dir, "meta.json")), s = stat(path.join(dir, "store.db"))
  if (!s) return null
  const key = (m?.mtimeMs ?? 0) + s.mtimeMs
  const hit = cli.get(dir)
  if (hit && hit[0] === key) return hit[1]
  const meta = (m && readJson(path.join(dir, "meta.json"))) || {}
  let chat: Chat | null = null
  if (!meta.isSubagent && meta.hasConversation !== false) {
    const db = new SqliteFile(path.join(dir, "store.db"))
    const sm = storeMeta(db)
    db.close()
    const name = String(meta.title || sm.name || "")
    chat = { id: path.basename(dir), source: "cli", title: name === "New Agent" ? "" : name, cwd: String(meta.cwd || ""),
      model: String(sm.lastUsedModel || ""), first: ms(meta.createdAtMs ?? sm.createdAt) || s.birthtimeMs,
      last: Math.max(ms(meta.updatedAtMs), s.mtimeMs), status: "", dir }
  }
  cli.set(dir, [key, chat])
  return chat
}

async function cliChats(): Promise<Chat[]> {
  const out: Chat[] = []
  let hashes: string[] = []
  try { hashes = fs.readdirSync(CHATS) } catch { return out }
  for (const h of hashes) {
    let ids: string[] = []
    try { ids = fs.readdirSync(path.join(CHATS, h)) } catch { continue }
    for (const id of ids) {
      if (!/^[\w.-]{4,100}$/.test(id)) continue
      const c = await cliChat(path.join(CHATS, h, id))
      if (c) out.push(c)
    }
  }
  return out
}

/** Every chat on this machine, the IDE's and the CLI's. */
async function chats(): Promise<Chat[]> {
  return [...(await ideChats()), ...(await cliChats())]
}

/** Where the CLI keeps a folder's chats (it names them by the md5 of the folder). */
function chatsOf(cwd: string) {
  return path.join(CHATS, createHash("md5").update(path.resolve(cwd)).digest("hex"))
}

// ---------- a chat's conversation, from its files

const isoAt = (t: number) => isoOf(t) ?? ""
const pretty = (v: unknown) => {
  if (typeof v === "string") { const j = parseJson(v); return j !== null && typeof j === "object" ? JSON.stringify(j, null, 2) : v }
  return v == null ? "" : JSON.stringify(v, null, 2)
}
type Talk = { title: string; cwd: string; model: string; first: string; last: string; branch: string; entries: Entry[] }

const PICK = ["explanation", "description", "command", "target_file", "targetFile", "file_path", "path", "relativeWorkspacePath",
  "pattern", "query", "search_term", "url", "globPattern", "glob_pattern"]
/** One line saying what a tool call did: its command, file, pattern or query. */
const summarize = (input: unknown) => toolSummary(typeof input === "string" ? parseJson(input) ?? {} : input, PICK)

/** What the user typed: the <user_query> of a prompt, without the context blocks Cursor puts around it. */
function userText(s: string) {
  const q = /<user_query>([\s\S]*?)<\/user_query>/.exec(s)
  if (q) return q[1].trim()
  return s.replace(/<(user_info|system_reminder|system-reminder|additional_data|attached_files|rules|project_layout|git_status)>[\s\S]*?<\/\1>/g, "").trim()
}

/** An IDE chat's conversation: its messages in order (fullConversationHeadersOnly), each a `bubbleId:` row. */
async function ideTalk(id: string, chat: Chat): Promise<Talk | null> {
  const data = parseJson(stateDb.all("SELECT value FROM cursorDiskKV WHERE key = ?", `composerData:${id}`)[0]?.value)
  if (!data) return null
  try {
    const order: string[] = (data.fullConversationHeadersOnly ?? []).map((h: Any) => String(h?.bubbleId ?? "")).filter(Boolean)
    const rows = stateDb.all("SELECT key, value FROM cursorDiskKV WHERE key LIKE ?", `bubbleId:${id}:%`)
    const byId = new Map(rows.map((r) => [String(r.key).split(":").pop()!, r.value]))
    // An old chat keeps its messages inline, in `conversation`.
    const inline: Any[] = Array.isArray(data.conversation) ? data.conversation : []
    const bubbles: Any[] = order.length ? order.map((b) => parseJson(byId.get(b)) ?? inline.find((x) => x?.bubbleId === b)).filter(Boolean) : inline
    const entries: Entry[] = []
    let model = chat.model
    for (const b of bubbles) {
      const at = isoAt(ms(b.createdAt ?? b.timingInfo?.clientStartTime))
      if (b.type === 1) {
        const t = userText(String(b.text ?? ""))
        if (t) entries.push({ kind: "user", text: truncate(t, 20000), at })
        continue
      }
      if (b.type !== 2) continue
      if (!model && b.modelInfo?.modelName) model = String(b.modelInfo.modelName)
      const tf = b.toolFormerData
      if (tf && (tf.name || tf.tool)) {
        const input = tf.rawArgs ?? tf.params ?? ""
        const result = tf.result == null ? null : truncate(pretty(tf.result))
        entries.push({ kind: "tool", id: String(tf.toolCallId ?? b.bubbleId ?? ""), name: String(tf.name || tf.tool), summary: summarize(input),
          input: truncate(pretty(input)), result, error: tf.status === "error" || !!tf.error, at })
      }
      const t = String(b.text ?? "").trim()
      if (t) entries.push({ kind: "assistant", text: truncate(t, 20000), at })
    }
    return { title: chat.title, cwd: chat.cwd, model, first: isoAt(chat.first), last: isoAt(chat.last), branch: "", entries }
  } catch {
    return null
  }
}

/** A CLI chat's conversation: the JSON messages among store.db's blobs, in the order they were written. */
async function cliTalk(chat: Chat): Promise<Talk | null> {
  const db = new SqliteFile(path.join(chat.dir!, "store.db"))
  if (!db.open()) return null
  try {
    const entries: Entry[] = []
    const tools = new Map<string, Tool>()
    for (const r of db.all("SELECT data FROM blobs ORDER BY rowid")) {
      const buf = r.data instanceof Uint8Array ? Buffer.from(r.data) : Buffer.from(text(r.data))
      if (buf[0] !== 0x7b) continue // not JSON: the binary tree that links them
      const m = parseJson(buf)
      if (!m || typeof m !== "object" || typeof m.role !== "string") continue
      const parts: Any[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : Array.isArray(m.content) ? m.content : []
      if (m.role === "user") {
        const t = userText(parts.filter((p) => p?.type === "text").map((p) => String(p.text ?? "")).join("\n\n"))
        if (t) entries.push({ kind: "user", text: truncate(t, 20000), at: "" })
      } else if (m.role === "assistant") {
        for (const p of parts) {
          if (p?.type === "text" && String(p.text ?? "").trim()) {
            const last = entries[entries.length - 1]
            if (last?.kind === "assistant") last.text += `\n\n${String(p.text).trim()}`
            else entries.push({ kind: "assistant", text: truncate(String(p.text).trim(), 20000), at: "" })
          } else if (p?.type === "tool-call") {
            const input = p.args ?? p.input ?? {}
            const t: Tool = { kind: "tool", id: String(p.toolCallId ?? ""), name: String(p.toolName ?? "Tool"), summary: summarize(input),
              input: truncate(pretty(input)), result: null, error: false, at: "" }
            tools.set(t.id, t)
            entries.push(t)
          }
        }
      } else if (m.role === "tool") {
        for (const p of parts) {
          if (p?.type !== "tool-result") continue
          const t = tools.get(String(p.toolCallId ?? ""))
          if (t) { t.result = truncate(pretty(p.result ?? p.output ?? "")); t.error = !!p.isError }
        }
      }
    }
    return { title: chat.title, cwd: chat.cwd, model: chat.model, first: isoAt(chat.first), last: isoAt(chat.last), branch: "", entries }
  } catch {
    return null
  } finally {
    db.close()
  }
}

/** A chat's conversation, or null when there's no such chat on this machine. The title falls back to the first prompt. */
async function talk(id: string): Promise<Talk | null> {
  const chat = (await chats()).find((c) => c.id === id)
  if (!chat) return null
  const t = chat.source === "ide" ? await ideTalk(id, chat) : await cliTalk(chat)
  const first = t?.entries.find((e): e is Said => e.kind === "user")
  if (t && !t.title) t.title = first?.text.replace(/\s+/g, " ").slice(0, 80) ?? ""
  return t
}

// ---------- Cursor's account, once allowed (`account`): read with Grok Bot's plugin, kept 5 minutes

/** Whether the user allowed reading their account (unset: not asked yet). */
const allowed = () => plugin.settings().account === true
async function readAccount(days: number): Promise<CursorAccount> {
  const a = await cursorAccount(days)
  return { summary: a.summary, events: a.events && a.events.filter((e) => !isGrokBot(e.model)) }
}
const account = (): Promise<CursorAccount> => (allowed() ? plugin.memo(300, readAccount, scanDays()) : Promise.resolve(NO_ACCOUNT))

// ---------- usage

/** Cursor's own worktrees (~/.cursor/worktrees/<repo>/<name>) belong to their repository. */
const WORKTREES = path.join(CONFIG_DIR, "worktrees") + "/"
const rootsOf = (cwds: Iterable<string>) => projectRoots(cwds, (c) => (c.startsWith(WORKTREES) ? WORKTREES + c.slice(WORKTREES.length).split("/")[0] : c))
const nameOf = (root: string) => (root === "" ? "No folder" : projectName(root))
const projectOf = (cwd: string) => nameOf(cwd ? rootsOf([cwd]).get(cwd)! : "")
const ELSEWHERE = "Not on this machine" // a conversation that isn't

/** Value = the tokens at API rates as Cursor prices them, not what the plan costs. Conversations not on this machine count
 *  as a project of their own, not sessions; time working is the gaps under 5 min between a conversation's requests. */
async function summary(days: number) {
  const [{ events: evs }, local] = await Promise.all([account(), chats()])
  const t = new Tally(days, nameOf)
  const start = +new Date(`${t.start}T00:00:00`)
  const byChat = new Map(local.map((c) => [c.id, c]))
  const root = rootsOf(local.map((c) => c.cwd).filter(Boolean))
  const rootOf = (c: Chat) => (c.cwd ? root.get(c.cwd)! : "")
  const session = (c: Chat) => t.session(c.id, () => ({ title: c.title, project: nameOf(rootOf(c)), root: rootOf(c), ...(c.cwd ? { cwd: c.cwd } : {}),
    first: c.first, last: c.last, model: c.model }))
  const prev = new Map<string, number>() // conversation -> its previous request, for time working
  for (const e of (evs ?? []).filter((x) => x.ts >= start)) {
    const conv = e.conversation || `request-${e.ts}`
    const gap = prev.has(conv) ? e.ts - prev.get(conv)! : GAP
    prev.set(conv, e.ts)
    const chat = byChat.get(e.conversation)
    t.count({ ts: e.ts, day: dayOf(e.ts), cost: e.value, tokens: e.input + e.output + e.read + e.write, read: e.read, prompt: e.input + e.read + e.write,
      model: modelName(e.model), min: gap < GAP ? gap / 60000 : 0 }, conv,
    chat ? t.project(rootOf(chat)) : t.project(`\0${ELSEWHERE}`, null, ELSEWHERE), chat && session(chat), e.model)
  }
  // Chats with no metered request in the period (signed out, or nothing metered) still count, on the day they were used.
  for (const c of local) {
    if (c.last < start || t.sessions.has(c.id)) continue
    session(c)
    t.days.get(dayOf(c.last))?.sessions.add(c.id)
    const p = t.project(rootOf(c))
    p.sessions.add(c.id)
    p.last = Math.max(p.last, c.last)
  }
  // A session's model: the one Cursor metered most for it, else the one the chat has picked.
  return t.result(modelName)
}

// ---------- the plan and its allowances

async function plan() {
  const s = (await account()).summary?.summary
  const type = String(s?.membershipType || (await stored(["cursorAuth/stripeMembershipType"]))["cursorAuth/stripeMembershipType"] || "").toLowerCase()
  if (!type) return null
  const [name, monthly] = PLANS[type] ?? [type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " "), null]
  return { name, monthly }
}

async function limits() {
  const acc = (await account()).summary
  if (!acc) return null
  const s = acc.summary ?? {}, now = Date.now() / 1000
  const cycle = minutesBetween(s.billingCycleStart, s.billingCycleEnd) || 43200
  const windows = []
  const planUse = s.individualUsage?.plan ?? {}
  const pct = planUse.totalPercentUsed ?? (planUse.limit ? (100 * (planUse.used ?? 0)) / planUse.limit : null)
  if (pct != null && s.billingCycleEnd) windows.push(limitWindow("month", "Included usage", cycle, clampPct(pct), sec(s.billingCycleEnd), now))
  const od = s.individualUsage?.onDemand
  if (od?.enabled && od.limit) windows.push(limitWindow("on-demand", "On-demand", cycle, clampPct((100 * (od.used ?? 0)) / od.limit), sec(s.billingCycleEnd), now))
  return windows.length ? { source: "Cursor dashboard", observed: isoOf(acc.at), windows } : null
}

// ---------- running now

// The CLI runs as its own node: .../cursor-agent/versions/<v>/node .../index.js [args]
const CLI = /\/cursor-agent\/versions\/[^/]+\/index\.js(\s|$)/
const APP = /\/Cursor\.app\/Contents\/MacOS\/Cursor$/

async function live(): Promise<Live[]> {
  const local = await chats()
  const procs = await processes()
  const clis = procs.filter((p) => CLI.test(p.command) && !/^(\S*\/)?(ba|z|fi|da)?sh\s/.test(p.command)) // a shell that runs it isn't it
  const dirs = await cwds(clis.map((p) => p.pid))
  const row = (pid: number, c: Chat | undefined) => ({ pid, id: c?.id ?? "", title: c?.title ?? "", model: c?.model ? modelName(c.model) : null })
  const out: Live[] = []
  // Its chat: the one it resumed, else the newest in its folder written since it started.
  const claimed = sessionsOf(clis, (c: Chat) => c.id, (p) => {
    const asked = /--resume[= ]([\w.-]{4,100})/.exec(p.command)?.[1], dir = dirs.get(p.pid) ? chatsOf(dirs.get(p.pid)!) : ""
    return asked ? local.find((x) => x.id === asked)
      : sortBy(local.filter((x) => x.source === "cli" && x.dir && path.dirname(x.dir) === dir && x.last >= p.started - 5000), (x) => x.last, true)[0]
  })
  for (const [p, c] of claimed) {
    const terminal = await terminalOf(plugin, p.pid)
    if (!c && !terminal) continue
    let since = c?.last ?? p.started
    try { if (c?.dir) since = fs.statSync(path.join(c.dir, "store.db")).mtimeMs } catch { /* as it is */ }
    out.push({ ...row(p.pid, c), status: Date.now() - since < 20_000 ? "busy" : "idle", kind: "CLI", cwd: c?.cwd || dirs.get(p.pid) || "",
      started: p.started, since, terminal })
  }
  // Cursor.app, with the chat worked on last if that was in the last few minutes.
  const app = procs.find((p) => APP.test(p.command)), taken = new Set(claimed.map(([, c]) => c?.id))
  const c = app && sortBy(local.filter((x) => x.source === "ide" && !taken.has(x.id) && (x.status === "generating" || Date.now() - x.last < LIVE_MIN * 60000)), (x) => x.last, true)[0]
  if (app && c) out.push({ ...row(app.pid, c), status: c.status === "generating" ? "busy" : "idle", kind: "IDE", cwd: c.cwd, started: c.first, since: c.last, terminal: null })
  return out
}

// ---------- one chat's conversation (the view tab: view:cursor-session/<id>)

const SESSION_ID = /^[\w.-]{4,100}$/


// ---------- Terminal runs it (the service "agent:cursor")

/** `agent`, or `agent --resume <id>` in the chat's folder (the CLI keeps chats per folder). It takes no system prompt
 *  (it reads the vault's AGENTS.md itself) nor hooks; an IDE chat can't be resumed by the CLI: its folder gets a new one. */
plugin.provide("agent:cursor", async ({ resume, prompt }: AgentStart) => {
  const c = resume ? (await chats()).find((x) => x.id === resume) : undefined
  if (resume && !c) return notOnThisMachine("Cursor", resume)
  return { command: c?.source === "cli" ? `agent --resume ${shellQuote(c.id)}${prompt ? ` ${shellQuote(prompt)}` : ""}` : prompt ? `agent ${shellQuote(prompt)}` : "agent", cwd: c?.cwd || null }
})

// ---------- blocks as text (GET /api/render)

plugin.block("agent-limits", async () => {
  const [lim, p] = [await limits(), await plan()]
  if (!lim) return section("Cursor plan", `_${p ? `${p.name}. ` : ""}${allowed() ? "No usage read yet: it comes from Cursor's dashboard, with Cursor.app signed in on this machine."
    : "Usage from the Cursor account isn't read: allow it in Cursor's settings (Read usage from your Cursor account)."}_`)
  return section("Cursor plan", ...(p ? [`${p.name}${p.monthly ? `, $${p.monthly} a month` : ""}.`] : []), limitRows(lim.windows), `_From the ${lim.source}, ${ago(lim.observed)}._`)
})

codingAgent(plugin, { id: "cursor", name: "Cursor", noun: "chat", count: "conversation", value: "estimated at list prices", estimate: true,
  state: (s) => `${s.status === "busy" ? "Working" : "Open"}${s.kind === "IDE" ? " in Cursor" : ""}`, sessionId: SESSION_ID, summary, live,
  plan: async () => ({ plan: await plan(), limits: await limits() }), session: talk, modelName, projectOf, forget: forgetCursorAccount })
