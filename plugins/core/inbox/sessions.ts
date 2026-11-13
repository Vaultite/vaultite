import path from "node:path"
import { agentName, type Asking, type Question, type SampleAsk } from "../../../core/agents.ts"
import { HTTPError, LOADED, reply, whoOf } from "../../../core/plugins.ts"
import { type Item, requestWriter, str } from "../../../core/vault.ts"
import { endHanded } from "./handed.ts"
import { BLOCKED, clip, type InboxEvent, TERMINAL } from "./model.ts"
import { judge } from "./needs.ts"
import { afterTurn, askedRow, askOf, bodyOf, delegated, delegatedRow, fromHook, hear, type Heard, heardWho, keyOf, type Last, type Lineage, reportedSince,
  rowOf, rowWith, type Seen, wantsLast, type Who, wordsOf } from "./rows.ts"
import { owner, plugin, settings } from "./server.ts"
import { list, newId, put, resolve, shown, told } from "./store.ts"

const states = new Map<string, Seen>()
const pending = new Set<Promise<unknown>>()
export const track = (p: Promise<unknown>) => {
  const q = p.catch((e) => console.error("inbox:", e)).finally(() => pending.delete(q))
  pending.add(q)
}
export const settled = async () => { while (pending.size) await Promise.all([...pending]) }

/** A session's change heard: its row made or changed. Never throws, and the terminal never waits on it. */
export async function heard(h: Heard) {
  const key = keyOf(h)
  if (!key || !h.agent || await muted(h.agent, h.terminal ?? "", h.session ?? "")) return
  const { seen, act } = hear(states.get(key), h, Date.now())
  if (act.do === "repeat") return
  states.set(key, seen)
  if (states.size > 500) states.delete(states.keys().next().value!)
  const who = heardWho(h)
  if (h.title) name(who, h.title)
  switch (act.do) {
    case "working":
      if (act.resolve) resolve(who.terminal, who.session, act.resolve === "user")
      if (!list().some(rowOf(who)) && (await lineageOf(who))?.parent) await sessionRow(who, { state: "working", read: true }, false, h.cwd)
      return
    case "ask": {
      const said = askOf(h.kind)
      const asking: Asking | null = h.questions?.length ? { kind: "question", questions: h.questions } : await askingOf(who, said)
      await sessionRow(who, askedRow(asking, said, h.msg), true, h.cwd)
      return
    }
    case "refused": return resolve(who.terminal, who.session, false, "done")
    case "turn": return turnEnded(who, h, act.since)
  }
}

async function muted(agent: string, terminal: string, session: string) {
  const names = settings().muted
  if (!names.length) return false
  const a = await plugin.ask<{ id: string; label: string } | null>(`agent-account:${agent}`, null, terminal, session).catch(() => null)
  return !!a && names.some((n) => n === a.id.toLowerCase() || n === a.label.toLowerCase())
}

/** Claude Code's hooks call its own questions permissions; its transcript can trail its screen a moment. */
async function askingOf(who: Who, said: string): Promise<Asking | null> {
  if (said === "auth") return null
  for (let i = 0; i < (said === "permission" ? 1 : 4); i++) {
    if (i) await new Promise((r) => setTimeout(r, 400))
    const a = await plugin.ask<Asking | null>(`agent-asking:${who.agent}`, null, who.terminal, who.session).catch(() => null)
    if (a) return a
  }
  return null
}

async function turnEnded(who: Who, h: Heard, since: number) {
  const last = wantsLast(h) ? await lastTurn(who, since, h.text === undefined) : null
  const words = wordsOf(h, last)
  if (!words) return
  if (last) {
    who = { ...who, session: who.session || last.session }
    if (last.title) name(who, last.title)
  }
  if (reportedSince(list().find(rowOf(who)), since)) return void endHanded(who.terminal)
  const body = bodyOf(words.text)
  const line = await lineageOf(who)
  if (delegated(line)) {
    await sessionRow(who, delegatedRow(line, h.state === "error", body, words.prompt), false, h.cwd)
    return void endHanded(who.terminal)
  }
  const sample: ((a: SampleAsk) => Promise<{ text: string; truncated: boolean }>) | null = plugin.service("sample")
  const v = await judge({ prompt: words.prompt, text: words.text, error: h.state === "error", auto: words.auto }, sample)
  const row = list().find(rowOf(who))
  const change = afterTurn(row, v, { body, prompt: words.prompt, auto: words.auto, quietAnswers: settings().answers === "quiet" })
  if (change) await sessionRow(who, change.patch, change.news, h.cwd)
  else if (row) told(row)
  endHanded(who.terminal)
}

/** OSC 7501's done comes before the agent has written its turn's final answer: asked again for a few seconds. */
async function lastTurn(who: Who, since: number, wantText: boolean): Promise<Last | null> {
  let t: Last | null = null
  for (let i = 0; i < 10; i++) {
    t = await plugin.ask<Last | null>(`agent-turn:${who.agent}`, null, who.terminal, who.session).catch(() => null)
    if (!t || !wantText || (t.final && t.at >= since - 1000)) return t
    await new Promise((r) => setTimeout(r, 500))
  }
  return t && (t.at >= since - 1000 ? t : { ...t, text: "" })
}

const named = new Map<string, string>()
function name(k: Who, title: string) {
  if (!(k.terminal || k.session)) return
  named.set(k.terminal || k.session, clip(title, 200))
  if (named.size > 500) named.delete(named.keys().next().value!)
}

/** Claude Code titles its terminal after its session. */
export async function sessionTitle(k: Who, cwd?: string) {
  const own = named.get(k.terminal || k.session)
  if (own) return own
  const term = k.terminal ? await plugin.ask<{ title?: string } | null>("terminal:info", null, k.terminal).catch(() => null) : null
  return str(term?.title).replace(/^[^\p{L}\p{N}]+/u, "").trim() || (cwd ? path.basename(cwd) : "")
}

const lineageOf = (k: Who) => plugin.ask<Lineage | null>("delegate:lineage", null, k.agent, k.terminal, k.session)

async function parentOf(k: Who): Promise<{ parent: InboxEvent["parent"]; task: string } | null> {
  const p = (await lineageOf(k))?.parent
  if (!p) return null
  const them: Who = { agent: p.agent, terminal: p.terminal ?? "", session: p.session ?? "" }
  const title = list().find(rowOf(them))?.title || await sessionTitle(them) || `${agentLabel(p.agent)} session`
  return { parent: { title, agent: p.agent, ...(p.terminal ? { terminal: p.terminal } : {}), ...(p.session ? { session: p.session } : {}) }, task: p.task }
}

/** Session `k`'s row made or changed (`patch`; undefined takes a field away), at the top; `news`: the user is told. A
 *  subagent is called by its task until its agent names it. */
export async function sessionRow(k: Who, patch: Partial<InboxEvent>, news: boolean, cwd?: string) {
  const line = await parentOf(k)
  const title = (line?.task && !named.has(k.terminal || k.session) ? line.task : "") || await sessionTitle(k, cwd)
  const es = list()
  const old = es.find(rowOf(k)) ?? null
  const now = Date.now()
  return put(rowWith(old, patch, k, { id: newId(now), t: now, title, fallback: `${agentLabel(k.agent)} session`, parent: line?.parent }), old, es, news)
}

export function agentLabel(name: string) {
  const p = LOADED.find((x) => Object.hasOwn(x.services, `agent:${name}`))
  return agentName(name) ?? (p ? str(p.manifest.name) : name ? name[0].toUpperCase() + name.slice(1) : "An agent")
}

/** A session's state as its host tells it (an agent run outside a terminal, as the Agent SDK runs one): AGENTS.md's
 *  "A session's state". */
export type SessionState = { agent: string; session: string; terminal?: string; thread?: string; state: "waiting" | "working" | "done" | "error"
  ask?: string; text?: string; prompt?: string; title?: string; questions?: Question[]; cwd?: string }
const hostState = (s: string): Heard["state"] | undefined => (s === "waiting" ? "blocked" : s === "working" || s === "done" || s === "error" ? s : undefined)

function questionOf(q: Item): Question[] {
  if (!str(q?.question) || !Array.isArray(q.options)) return []
  const given: Item[] = q.options
  const options = given.flatMap((o) => {
    const label = clip(o?.label, 200)
    return label ? [{ label, ...(str(o?.description) ? { description: clip(o.description, 500) } : {}) }] : []
  })
  return [{ question: clip(q.question, 500), ...(str(q.header) ? { header: clip(q.header, 60) } : {}), ...(q.multi === true ? { multi: true } : {}), ...(q.closed === true ? { closed: true } : {}), options }]
}

export function sessionOf(b: Item): Heard {
  const agent = clip(b.agent, 40).toLowerCase(), session = clip(b.session, 120)
  const terminal = TERMINAL.test(str(b.terminal)) ? str(b.terminal) : ""
  const state = hostState(str(b.state))
  if (!/^[a-z][\w-]*$/.test(agent)) throw new HTTPError(400, "agent: who runs it (claude, codex...)")
  if (!session && !terminal) throw new HTTPError(400, "session: its id")
  if (!state) throw new HTTPError(400, "state: waiting, working, done or error")
  if (b.ask !== undefined && !BLOCKED.has(str(b.ask))) throw new HTTPError(400, "ask: what it waits on (permission, question, auth, plan)")
  const given: Item[] = Array.isArray(b.questions) ? b.questions : []
  const qs = given.flatMap(questionOf)
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
  return list().find(rowOf(heardWho(h))) ?? null
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
    track(heard(sessionOf(req.body ?? {})))
    return reply(202, { ok: true })
  }, { sync: false })

  /** An agent's own hook (`vau inbox hook`): its news; Terminal tells the rest ("inbox:state"). A terminal started before
   *  that has a state command posting here (`state`): its state file says it now. */
  plugin.route("POST", "inbox/hook", async (req) => {
    await owner(req)
    const q = req.query
    if (q.state) return { ok: true }
    const j: Item = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}
    const agent = clip(q.agent, 40).toLowerCase() || "agent"
    const terminal = TERMINAL.test(str(q.terminal)) ? str(q.terminal) : ""
    const h = fromHook(j)
    if (h) track(heard({ ...h, agent, ...(terminal ? { terminal } : {}), from: "hooks" }))
    return { ok: true }
  }, { sync: false })
}
