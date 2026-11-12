import crypto from "node:crypto"
import path from "node:path"
import { agentName, type Asking, type Question, type SampleAsk } from "../../../core/agents.ts"
import { HTTPError, LOADED, reply, whoOf } from "../../../core/plugins.ts"
import { type Item, requestWriter, str } from "../../../core/vault.ts"
import { endHanded } from "./handed.ts"
import { BLOCKED, type InboxEvent, previewOf, questionLine, questionsText } from "./model.ts"
import { judge, type Need, type Turn } from "./needs.ts"
import { clip, owner, plugin, settings, TERMINAL } from "./server.ts"
import { list, newId, put, resolve, shown, told } from "./store.ts"

// agents' sessions (Terminal's stream, a hook, or a host: inbox:session), one thread each: open when it needs
// the user (it asks, or a turn ended with something for them: needs.ts), working once they answer, done when settled

/** A change of an app terminal's state, as Terminal tells it (the service "inbox:state"; Terminal's StateChange): `was`
 *  the state it told before, `from` "shell" its program gone back to its shell (quit, crashed, interrupted). */
export type StateChange = { terminal: string; agent: string; state: "idle" | "working" | "blocked" | "done" | "error"
  kind?: string; msg?: string; from: "osc7501" | "hooks" | "screen" | "agent" | "backend" | "shell"; was?: string; at: number }
/** A change as the inbox hears it: an agent's own hook says its session, folder and last message; one outside the
 *  app's terminals has only its session. */
export type Heard = Omit<StateChange, "terminal" | "at"> & { terminal?: string; session?: string; cwd?: string; text?: string; prompt?: string
  /** An agent's own hook (`vau inbox hook`) or host (inbox:session): it says a turn ended, or it asks, each time news. */
  own?: boolean
  /** What it asks, in its own words, and its name, when its host says them (else its agent's plugin is asked). */
  questions?: Question[]; title?: string
  /** Its thread's id, when its host names it (inbox:session's `thread`). */
  thread?: string }

/** Each session's last state (by terminal, else by session), and since when it works: its turn's start. */
const states = new Map<string, { state: string; kind?: string; msg?: string; since: number }>()
/** What the inbox is still working out (a turn's message read, then judged): tests wait for it. */
const pending = new Set<Promise<unknown>>()
export const track = (p: Promise<unknown>) => {
  const q = p.catch((e) => console.error("inbox:", e)).finally(() => pending.delete(q))
  pending.add(q)
}
export const settled = async () => { while (pending.size) await Promise.all([...pending]) }

/** What an agent's own hook said (`j`: Claude Code's JSON or Codex's notify), as a change, or null (nothing to tell). */
export function fromHook(j: Item): Omit<Heard, "agent" | "from"> | null {
  const hook = str(j.hook_event_name)
  const session = clip(j.session_id ?? j["thread-id"] ?? j.thread_id ?? j.sessionID, 120)
  const message = clip(j.message, 300)
  const said = j.last_assistant_message ?? j["last-assistant-message"]
  const asked = (j["input-messages"] as unknown[] | undefined)?.at?.(-1)
  const turn = { ...(typeof said === "string" ? { text: said.trim() } : {}), ...(typeof asked === "string" ? { prompt: asked } : {}) }
  const where = { ...(session ? { session } : {}), ...(str(j.cwd) ? { cwd: str(j.cwd) } : {}) }
  const asks = (): Pick<Heard, "kind" | "msg"> => {
    const input = (j.tool_input ?? {}) as Item
    const question = Array.isArray(input.questions) ? clip((input.questions[0] as Item)?.question, 200) : ""
    const kind = j.notification_type === "permission_prompt" ? "permission" : j.tool_name === "ExitPlanMode" ? "plan" : "question"
    const msg = message || (question ? `Asks: ${question}` : j.tool_name === "ExitPlanMode" ? "A plan to approve" : j.tool_name ? `Wants to use ${clip(j.tool_name, 40)}` : "")
    return { kind, ...(msg ? { msg } : {}) }
  }
  if (hook === "Stop" || j.type === "agent-turn-complete") return { state: "done", own: true, ...where, ...turn }
  // (sitting at its prompt for a minute isn't news: Stop said it finished)
  if (hook === "Notification") return j.notification_type === "idle_prompt" || /waiting for your input/i.test(message) ? null : { state: "blocked", own: true, ...where, ...asks() }
  if (hook === "UserPromptSubmit") return { state: "working", own: true, ...where }
  return null
}

/** A session's state changed: a question it asks is its row, needing the user; answered, read; a turn that ended is
 *  judged. Never throws, and the terminal never waits on it. */
export async function heard(h: Heard) {
  const key = h.terminal || (h.session ? `session:${h.session}` : "")
  if (!key || !h.agent || await muted(h.agent, h.terminal ?? "", h.session ?? "")) return
  const was = states.get(key)
  // (the same said twice: once; an agent's own hook says only that a turn ended or that it asks, each news; after a
  // restart, what its terminal told before)
  const prev = was?.state ?? h.was
  const own = !!h.own
  if (!own && h.terminal && was && was.state === h.state && was.kind === h.kind && was.msg === h.msg) return
  const now = Date.now()
  states.set(key, { state: h.state, kind: h.kind, msg: h.msg, since: h.state === "working" && was?.state !== "working" ? now : was?.since ?? now })
  if (states.size > 500) states.delete(states.keys().next().value!)
  const who: Who = { agent: h.agent, terminal: h.terminal ?? "", session: h.session ?? "", ...(h.from === "agent" && !h.terminal ? { host: true } : {}),
    ...(h.thread ? { thread: h.thread } : {}) }
  if (h.title) name(who, h.title)
  // (working after it asked: the user answered; after a prompt its own hook saw: the user wrote to it)
  if (h.state === "working") {
    if (prev === "blocked" || own) resolve(who.terminal, who.session, own)
    // (a subagent's thread is there from its start, working for the session that delegated it)
    if (!list().some(rowOf(who)) && (await lineageOf(who))?.parent) await sessionRow(who, { state: "working", read: true }, false, h.cwd)
    return
  }
  if (h.state === "blocked") {
    const said = BLOCKED.has(str(h.kind)) ? str(h.kind) : "question"
    const asking: Asking | null = h.questions?.length ? { kind: "question", questions: h.questions } : await askingOf(who, said), ask = asking?.kind ?? said
    await sessionRow(who, { state: "open", ask, read: false, link: undefined, questions: asking?.kind === "question" ? asking.questions : undefined,
      body: asking?.kind === "question" ? questionsText(asking.questions) : asking?.kind === "plan" ? asking.plan : h.msg || ASKING[ask] }, true, h.cwd)
    return
  }
  // Out of a question without working again: refused or interrupted, which the user did.
  if (prev === "blocked" && h.state !== "error" && !own) return resolve(who.terminal, who.session, false, "done")
  if (prev === "working" || own) await turnEnded(who, h, was?.since ?? now)
}

/** Whether the session runs in an account the user muted (the setting `muted`: by its name or id), as its agent's plugin
 *  says ("agent-account:<agent>"). */
async function muted(agent: string, terminal: string, session: string) {
  const names = settings().muted
  if (!names.length) return false
  const a = await plugin.ask<{ id: string; label: string } | null>(`agent-account:${agent}`, null, terminal, session).catch(() => null)
  return !!a && names.some((n) => n === a.id.toLowerCase() || n === a.label.toLowerCase())
}

export const NEEDS: Record<string, string> = { permission: "asks permission", question: "asks", auth: "sign in", plan: "plan", reply: "asks you", answer: "answered", report: "report", error: "failed" }
const ASKING: Record<string, string> = { permission: "Asks permission", question: "Asks you something", auth: "Needs you to sign in", plan: "A plan to approve" }

/** What a blocked session asks, in its own words (its agent's "agent-asking"): a question its hooks call a permission
 *  (Claude Code's says so of its own questions) is one. Its transcript can trail its screen a moment. */
async function askingOf(who: Who, said: string): Promise<Asking | null> {
  if (said === "auth") return null
  for (let i = 0; i < (said === "permission" ? 1 : 4); i++) {
    if (i) await new Promise((r) => setTimeout(r, 400))
    const a = await plugin.ask<Asking | null>(`agent-asking:${who.agent}`, null, who.terminal, who.session).catch(() => null)
    if (a) return a
  }
  return null
}

export type Who = { agent: string; terminal: string; session: string; host?: boolean
  /** Its thread's id, when its host names it (a fork or a resume gave the session a new id). */
  thread?: string }
/** An agent's last turn as its plugin reads it (the service "agent-turn:<agent>"): the user's message, its last answer. */
type Last = { session: string; prompt: string; text: string; at: number; final: boolean
  /** The session itself started the turn (its task's notice, a schedule), not the user: `prompt` is what did. */
  auto?: boolean
  /** The session's own name, for an agent whose terminal isn't titled by it (Codex's thread name, else first prompt). */
  title?: string }
const BODY = 8000

/** A turn that ended: its last message read (the hook's, else the agent's transcript), judged; needing the user, its
 *  row says so (and tells them); else the row, unless still to read, keeps it quietly. */
async function turnEnded(who: Who, h: Heard, since: number) {
  let { text, prompt } = h, auto = false
  if (text === undefined || prompt === undefined) {
    const t = await lastTurn(who, since, text === undefined)
    // (back to idle with no session to read: it was starting up, as Codex says it works while it does)
    if (!t && h.from === "osc7501" && h.state === "idle" && text === undefined && prompt === undefined) return
    if (t) { text ??= t.text; prompt ??= t.prompt; auto = !!t.auto && h.prompt === undefined; who = { ...who, session: who.session || t.session } }
    if (t?.title) name(who, t.title)
  }
  text = (text ?? h.msg ?? "").trim()
  // Its report (inbox.report) this turn is what it had to say: the row is the report's.
  const row = list().find(rowOf(who))
  if (row?.ask === "report" && row.state !== "working" && row.t >= since - 2000) return void endHanded(who.terminal)
  const body = text ? (text.length > BODY ? `${text.slice(0, BODY)}\n\n…` : text) : undefined
  // A subagent's turn is its parent's to read; a session whose subagents still work hears from them, so it's on it.
  const line = await lineageOf(who)
  if (line?.consumes || line?.waits) {
    await sessionRow(who, { state: line.consumes ? "done" : "working", ask: line.consumes && h.state === "error" ? "error" : undefined, body, read: true, questions: undefined,
      turn: line.consumes ? undefined : turnOf(prompt) }, false, h.cwd)
    return void endHanded(who.terminal)
  }
  const sample = plugin.service("sample") as ((a: SampleAsk) => Promise<{ text: string; truncated: boolean }>) | null
  const v = await judge({ prompt, text, error: h.state === "error", auto } satisfies Turn, sample)
  const now = list().find(rowOf(who)), turn = turnOf(prompt)
  // (an answer that only tells, the setting `answers` quiet: done on its agent's row, unread, never told)
  if (v.needs && v.why === "answer" && settings().answers === "quiet") await sessionRow(who, { state: "done", ask: "answer", body, read: false, link: undefined, questions: undefined, turn: undefined }, false, h.cwd)
  else if (v.needs) await sessionRow(who, { state: "open", ask: v.why as Need, body, read: false, link: undefined, questions: undefined, turn }, true, h.cwd)
  // (a turn it started itself settles nothing the user hasn't answered)
  else if (!now || !(auto ? now.state === "open" && !BLOCKED.has(str(now.ask)) : stillOpen(now, turn))) await sessionRow(who, { state: "done", ask: undefined, body, read: true, questions: undefined, turn: undefined }, false, h.cwd)
  else told(now) // (still to read: it stays as it was)
  endHanded(who.terminal)
}

const turnOf = (prompt?: string) => (prompt?.trim() ? crypto.createHash("sha1").update(prompt.trim()).digest("hex").slice(0, 12) : undefined)

/** Whether open thread `e` still needs the user after a quiet turn (answering `turn`): what it left stays to read while
 *  the same turn goes on (a background task); a new message from the user, or its ask gone, settles it. */
export const stillOpen = (e: Pick<InboxEvent, "state" | "ask" | "turn">, turn?: string) =>
  e.state === "open" && !BLOCKED.has(str(e.ask)) && (e.ask === "report" || !turn || !e.turn || turn === e.turn)

/** The agent's last turn: once its transcript has this turn's final answer (OSC 7501's done comes before the agent has
 *  written it, so asked again for a few seconds), else this turn's latest words, else none. */
async function lastTurn(who: Who, since: number, wantText: boolean): Promise<Last | null> {
  let t: Last | null = null
  for (let i = 0; i < 10; i++) {
    t = await plugin.ask<Last | null>(`agent-turn:${who.agent}`, null, who.terminal, who.session).catch(() => null)
    if (!t || !wantText || (t.final && t.at >= since - 1000)) return t
    await new Promise((r) => setTimeout(r, 500))
  }
  return t && (t.at >= since - 1000 ? t : { ...t, text: "" })
}

export const rowOf = (k: Who) => (e: InboxEvent) => !e.gate && !e.machine && e.source === k.agent &&
  ((!!k.thread && e.id === k.thread) || (!k.thread && ((!!k.session && e.session === k.session) || (!!k.terminal && e.terminal === k.terminal))))

const named = new Map<string, string>()
function name(k: Who, title: string) {
  if (!(k.terminal || k.session)) return
  named.set(k.terminal || k.session, clip(title, 200))
  if (named.size > 500) named.delete(named.keys().next().value!)
}

/** What the user knows a session by: the name its agent gave it, else its terminal's (Claude Code names it after the
 *  session), else its folder. */
export async function sessionTitle(k: Who, cwd?: string) {
  const own = named.get(k.terminal || k.session)
  if (own) return own
  const term = k.terminal ? await plugin.ask<{ title?: string } | null>("terminal:info", null, k.terminal).catch(() => null) : null
  return str(term?.title).replace(/^[^\p{L}\p{N}]+/u, "").trim() || (cwd ? path.basename(cwd) : "")
}

/** Where a session stands among delegated tasks (the service "delegate:lineage"): who delegated it its task, and
 *  whether that one waits on this turn; how many of its own subagents still work, which will tell it when they're done. */
type Lineage = { parent: { agent: string; terminal?: string; session?: string; task: string } | null; consumes: boolean; waits: number }
const lineageOf = (k: Who) => plugin.ask<Lineage | null>("delegate:lineage", null, k.agent, k.terminal, k.session)

async function parentOf(k: Who): Promise<{ parent: InboxEvent["parent"]; task: string } | null> {
  const p = (await lineageOf(k))?.parent
  if (!p) return null
  const them: Who = { agent: p.agent, terminal: p.terminal ?? "", session: p.session ?? "" }
  const title = list().find(rowOf(them))?.title || await sessionTitle(them) || `${agentLabel(p.agent)} session`
  return { parent: { title, agent: p.agent, ...(p.terminal ? { terminal: p.terminal } : {}), ...(p.session ? { session: p.session } : {}) }, task: p.task }
}

/** Session `k`'s row, made or changed (`patch`; undefined takes a field away), at the top; `news`: the user is told. */
export async function sessionRow(k: Who, patch: Partial<InboxEvent>, news: boolean, cwd?: string) {
  const line = await parentOf(k), parent = line?.parent
  // (a subagent is called by its task until its agent names it)
  const title = (line?.task && !named.has(k.terminal || k.session) ? line.task : "") || await sessionTitle(k, cwd)
  const es = list()
  const old = es.find(rowOf(k)) ?? null
  const e = { ...(old ?? { id: newId(Date.now()) }), t: Date.now(), source: k.agent, kind: "session", title: title || old?.title || `${agentLabel(k.agent)} session`, ...patch,
    ...(k.terminal ? { terminal: k.terminal } : {}), ...(k.session ? { session: k.session } : {}), ...(k.host ? { host: true } : {}), ...(parent ? { parent } : {}) } as InboxEvent
  if (e.questions) e.preview = questionLine(e.questions)
  else if (e.body) e.preview = previewOf(e.body)
  else delete e.preview
  for (const f of Object.keys(e) as (keyof InboxEvent)[]) if (e[f] === undefined) delete e[f]
  return put(e, old, es, news)
}

export function agentLabel(name: string) {
  const p = LOADED.find((x) => Object.hasOwn(x.services, `agent:${name}`))
  return agentName(name) ?? (p ? str(p.manifest.name) : name ? name[0].toUpperCase() + name.slice(1) : "An agent")
}

/** A session's state as its host tells it (an agent run outside a terminal, as the Agent SDK runs one): AGENTS.md's
 *  "A session's state". The same as a hook's: a turn that ends is judged, a question needs the user. */
export type SessionState = { agent: string; session: string; terminal?: string; thread?: string; state: "waiting" | "working" | "done" | "error"
  ask?: string; text?: string; prompt?: string; title?: string; questions?: Question[]; cwd?: string }
const HOST_STATES = { waiting: "blocked", working: "working", done: "done", error: "error" } as const

export function sessionOf(b: Item): Heard {
  const agent = clip(b.agent, 40).toLowerCase(), session = clip(b.session, 120)
  const terminal = TERMINAL.test(str(b.terminal)) ? str(b.terminal) : ""
  const state = HOST_STATES[str(b.state) as keyof typeof HOST_STATES]
  if (!/^[a-z][\w-]*$/.test(agent)) throw new HTTPError(400, "agent: who runs it (claude, codex...)")
  if (!session && !terminal) throw new HTTPError(400, "session: its id")
  if (!state) throw new HTTPError(400, "state: waiting, working, done or error")
  if (b.ask !== undefined && !BLOCKED.has(str(b.ask))) throw new HTTPError(400, "ask: what it waits on (permission, question, auth, plan)")
  const qs = Array.isArray(b.questions) ? (b.questions as Item[]).filter((q) => str(q?.question) && Array.isArray(q.options)).map((q) => ({
    question: clip(q.question, 500), ...(str(q.header) ? { header: clip(q.header, 60) } : {}), ...(q.multi === true ? { multi: true } : {}), ...(q.closed === true ? { closed: true } : {}),
    options: (q.options as Item[]).map((o) => ({ label: clip(o?.label, 200), ...(str(o?.description) ? { description: clip(o.description, 500) } : {}) })).filter((o) => o.label),
  })) : []
  const thread = /^[a-z0-9]{6,12}-[0-9a-f]{6}$/.test(str(b.thread)) ? str(b.thread) : ""
  return { agent, state, from: "agent", own: true, ...(session ? { session } : {}), ...(terminal ? { terminal } : {}), ...(thread ? { thread } : {}),
    ...(b.ask !== undefined ? { kind: str(b.ask) } : {}), ...(typeof b.text === "string" ? { text: b.text.trim() } : {}),
    ...(typeof b.prompt === "string" ? { prompt: b.prompt } : {}), ...(str(b.title) ? { title: clip(b.title, 200) } : {}),
    ...(state === "blocked" && str(b.text) ? { msg: clip(b.text, 300) } : {}), ...(qs.length ? { questions: qs } : {}), ...(str(b.cwd) ? { cwd: str(b.cwd) } : {}) }
}

export const needsYou = (terminal: string, session = "") => list().some((e) => !e.read && e.kind === "session" && e.state === "open" &&
  ((!!terminal && e.terminal === terminal) || (!!session && e.session === session)))

export async function tellSession(b: Item): Promise<InboxEvent | null> {
  const h = sessionOf(b)
  const p = heard(h)
  track(p)
  await p
  return list().find(rowOf({ agent: h.agent, terminal: h.terminal ?? "", session: h.session ?? "", ...(h.thread ? { thread: h.thread } : {}) })) ?? null
}

export const progressOf = (terminal: string, session?: string) =>
  shown().find((e) => e.kind === "session" && e.state !== "done" && !!e.progress && ((!!terminal && e.terminal === terminal) || (!!session && e.session === session)))?.progress ?? null

/** The session whose request this is (its app terminal, its agent's session), by the name the user knows it by. */
export async function askerOf(): Promise<InboxEvent["from"]> {
  const w = requestWriter.getStore()
  if (!w || !(w.terminal || w.session)) return undefined
  const agent = whoOf(w.client, w.agent).source
  const k: Who = { agent, terminal: w.terminal ?? "", session: w.session ?? "" }
  const row = list().find((x) => x.kind === "session" && !x.gate && !x.machine && ((!!k.terminal && x.terminal === k.terminal) || (!!k.session && x.session === k.session)))
  const title = row?.title || await sessionTitle(k).catch(() => "") || `${agentLabel(row?.source ?? agent)} session`
  return { title, agent: row?.source ?? agent, ...(k.terminal ? { terminal: k.terminal } : {}), ...(k.session ? { session: k.session } : {}) }
}

export function register() {
  /** A session's state from a host outside this server (SessionState): answered at once, the thread worked out after. */
  plugin.route("POST", "inbox/sessions", async (req) => {
    await owner(req)
    track(heard(sessionOf((req.body ?? {}) as Item)))
    return reply(202, { ok: true })
  }, { sync: false })

  /** An agent's own hook (`vau inbox hook`): its news; Terminal tells the rest ("inbox:state"). A terminal started before
   *  that has a state command posting here (`state`): its state file says it now. */
  plugin.route("POST", "inbox/hook", async (req) => {
    await owner(req)
    const q = req.query
    if (q.state) return { ok: true }
    const j = (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Item
    const agent = clip(q.agent, 40).toLowerCase() || "agent"
    const terminal = TERMINAL.test(str(q.terminal)) ? str(q.terminal) : ""
    const h = fromHook(j)
    if (h) track(heard({ ...h, agent, ...(terminal ? { terminal } : {}), from: "hooks" }))
    return { ok: true }
  }, { sync: false }) // (an agent waits on its hook, which reads nothing of the vault)
}
