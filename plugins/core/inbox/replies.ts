import { z } from "zod"
import { agentIn, type Choice, choiceOf, newTerminalId, parseTerminal, type Question, resumeTerminalId, startAgent } from "../../../core/agents.ts"
import { defineOp, localDate, localTime, type Machine, MACHINE_CLIENT, NOT_THE_USER, type OpCtx, OpError, splitMachine, userSurface } from "../../../core/plugins.ts"
import { type Item, str } from "../../../core/vault.ts"
import { hand, keepHanded } from "./handed.ts"
import { clip, type InboxEvent } from "./model.ts"
import { REPLY_BLOCK } from "./reports.ts"
import { editBody, resultAt } from "./results.ts"
import { agentOfTerminal, plugin, selfMachine } from "./server.ts"
import { fileOf, list, moveOn, resolve } from "./store.ts"
import { Captured, Event, Events, type Live, Passed, Saved, Sessions } from "./wire.ts"

type AgentReply = (session: string, text: string) => Promise<boolean>

/** Never a shell at its prompt, which would run the line: a report names its terminal, and anyone who writes the vault
 *  can write a report. */
export const typable = (sessions: Live[]) => (id: string) => !!id && sessions.some((s) => s.id === id && !!s.agent && s.busy === true)

type Plan = { how: "type" | "resume" | "new" | "host"; to: string; ago: number | null; ttl: number | null; transcript: string; account?: string }
async function replyPlan(r: Item, live: (id: string) => boolean, want = ""): Promise<Plan | null> {
  const terminal = str(r.terminal), session = str(r.session), agent = str(r.agent) || agentOfTerminal(terminal)
  const resume = session && agent ? resumeTerminalId(agent, session) : ""
  const none = { ago: null, ttl: null, transcript: "" }
  if (want !== "new") for (const to of [terminal, resume]) if (to && live(to)) return { how: "type", to, ...none }
  type Session = { transcript?: string; last?: number; ttl?: number; account?: string }
  const info = session && agent ? await plugin.ask<Session | null>(`agent-session:${agent}`, null, session) : null
  const ago = info?.last ? Math.max(0, Math.round((Date.now() - info.last) / 1000)) : null
  const ttl = Number(info?.ttl) || null
  const known = { ago, ttl, transcript: str(info?.transcript) }
  const cached = ago === null || !ttl ? null : ago < ttl - ttl / 12
  const named = str(info?.account) || parseTerminal(terminal)?.profile || ""
  const account = /^[a-z0-9]{1,32}$/.test(named) && named !== "default" ? named : ""
  const fresh = agent ? newTerminalId(agentIn(agent, account)) : ""
  if (resume && want !== "new" && (want === "resume" || cached !== false)) return { how: "resume", to: resume, ...known }
  if (fresh) return { how: "new", to: fresh, ...known, ...(account ? { account } : {}) }
  return null
}

async function elsewhere(r: Item, alive: (id: string) => boolean): Promise<{ id: string; m: Machine | null } | null> {
  const terminal = str(r.terminal)
  const self = await selfMachine()
  let there = str(r.machine)
  if (!there && terminal && !alive(terminal)) {
    there = str(await plugin.ask("terminal:locate", "", terminal))
  }
  if (!there || !self || there === self) return null
  return { id: there, m: await plugin.ask<Machine | null>("machines:machine", null, there) }
}

async function onSessionMachine(ctx: OpCtx, at: { id: string; m: Machine | null }, op: string, params: Item) {
  const { m } = at
  const name = m?.label || at.id
  if (!m) throw new OpError(`its session runs on ${name}, which isn't in Machines`, 409)
  if (ctx.who.client?.startsWith("machine/")) throw new OpError(`its session runs on ${name}, not on this machine`, 409)
  if (!m.online) throw new OpError(`its session runs on ${name}, which is offline`, 502)
  let r: Response
  try {
    r = await fetch(`${m.url}/api/ops/${op}`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" },
      body: JSON.stringify(params), signal: AbortSignal.timeout(30000) })
  } catch {
    throw new OpError(`its session runs on ${name}, which doesn't answer`, 502)
  }
  let out: z.infer<typeof Passed> = {}
  try { out = Passed.parse(await r.json()) } catch { /* not JSON, or not an object */ }
  if (!r.ok) throw new OpError(`${name}: ${str(out.error) || `answered ${r.status}`}`, r.status)
  return out
}

export function findEvent<E extends { id: string }>(events: E[], id: string, self: string | null): E | undefined {
  const exact = events.find((e) => e.id === id)
  if (exact) return exact
  const [bare, at] = splitMachine(id)
  if (at) return at === self ? events.find((e) => e.id === bare) : undefined
  const hits = events.filter((e) => splitMachine(e.id)[0] === bare)
  return hits.length === 1 ? hits[0] : undefined
}

export async function eventFor(ctx: OpCtx, id: string) {
  const { events } = Events.parse(await ctx.api("GET", "inbox/events?all=1"))
  const e = findEvent(events, id.trim(), await selfMachine())
  if (!e) throw new OpError(`no event ${id} (vau inbox lists them)`, 404)
  return Event.parse(e)
}

export async function onOwner(ctx: OpCtx, e: InboxEvent, op: string, params: Item) {
  const at = e.machine!
  return onSessionMachine(ctx, { id: at, m: await plugin.ask<Machine | null>("machines:machine", null, at) }, op, params)
}

export const EVENT_ID = /^[a-z0-9]{6,12}-[0-9a-f]{6}(@[a-z0-9][a-z0-9-]{0,62})?$/
const sessionOfRow = (e: InboxEvent) => ({ terminal: e.terminal ?? "", session: e.session ?? "", agent: e.source })

async function replyToRow(ctx: OpCtx, e: InboxEvent, text: string, how = "") {
  const line = text.trim().replace(/\s*\n\s*/g, " ")
  if (!line) throw new OpError("`text`: the reply")
  if (!e.terminal && !e.session) throw new OpError("it isn't an agent's session: nothing to reply to", 409)
  const { sessions } = Sessions.parse(await ctx.api("GET", "terminals/sessions"))
  const asks = !!e.terminal && sessions.find((s) => s.id === e.terminal)?.state === "blocked"
  const one = e.questions?.length === 1 && !e.questions[0].multi ? e.questions[0] : null
  if (asks && one && (!one.closed || typeof choiceOf(one, line, "", false) !== "string")) {
    if (!userSurface(ctx.who)) throw new OpError(NOT_THE_USER, 403)
    return { how: "type", terminal: (await pickIn(ctx, e, [line])).terminal }
  }
  const host: AgentReply | null = plugin.service(`agent-reply:${e.source}`)
  if (host && e.session && !how && await host(e.session, line)) {
    moveOn(list().filter((x) => x.id === e.id), "working")
    return { how: "host", terminal: e.terminal ?? null }
  }
  if (e.terminal) keepHanded(e.terminal)
  const plan = await replyPlan(sessionOfRow(e), typable(sessions), how)
  if (!plan) throw new OpError(`its terminal ${e.terminal} has ended and it names no session to resume`, 409)
  keepHanded(plan.to)
  if (plan.how === "type" && asks && (e.questions || e.ask === "question")) {
    await ctx.api("POST", `terminals/${encodeURIComponent(plan.to)}/send`, { text: "\x1b", enter: false })
    await new Promise((r) => setTimeout(r, 800))
    await submit(ctx, plan.to, line)
  } else if (plan.how === "type") {
    if (atPrompt(sessions.find((s) => s.id === plan.to)?.state)) await submit(ctx, plan.to, line)
    else await ctx.api("POST", `terminals/${encodeURIComponent(plan.to)}/send`, { text: line, enter: true })
  } else if (plan.how === "resume") await startAgent(ctx, plan.to, line)
  const started = plan.how !== "new" ? null : await startNew(ctx, e.source, plan, `(The user replies to the last answer of an earlier session; you start ` +
    `without its context.${plan.transcript ? ` Its transcript is \`${plan.transcript}\`: search it for what you need, don't read it whole.` : ""} ` +
    `Its last answer:\n\n${clip(e.body, 3000) || "(not kept)"}\n\nThe user's reply:) ${line}`)
  moveOn(list().filter((x) => x.id === e.id), "working", started ?? { terminal: plan.to })
  return { how: plan.how, terminal: started ? started.terminal ?? null : plan.to }
}

export async function startNew(ctx: OpCtx, agent: string, plan: Plan, prompt: string): Promise<Pick<InboxEvent, "terminal" | "session" | "host">> {
  const chat: ((a: { prompt: string; account?: string; by: string }) => Promise<{ id: string } | null>) | null = plugin.service(`agent-chat-new:${agent}`)
  const made = chat ? await chat({ prompt, ...(plan.account ? { account: plan.account } : {}), by: ctx.who.label }) : null
  if (made?.id) return { terminal: undefined, session: made.id, host: true }
  await startAgent(ctx, plan.to, prompt)
  return { terminal: plan.to, session: undefined }
}

export async function pickIn(ctx: Pick<OpCtx, "api">, e: InboxEvent, picks: string[] | "chat", typed: string[] = []) {
  const qs = e.questions, pick: ((qs: Question[], choices: Choice[] | "chat") => string[]) | null = plugin.service(`agent-pick:${e.source}`)
  if (!qs?.length || !e.terminal || e.kind !== "session" || !pick) throw new OpError("it doesn't ask anything to pick from now", 409)
  if (picks === "chat" && qs.some((q) => q.closed)) throw new OpError("its question takes one of its options: it has no Chat about this", 409)
  if (picks !== "chat" && picks.length !== qs.length) throw new OpError(`\`picks\`: an answer for each of its ${qs.length} questions`)
  const choices = picks === "chat" ? picks : qs.map((q, i) => choiceOf(q, picks[i], typed[i]))
  const t = `terminals/${encodeURIComponent(e.terminal)}`
  const squash = (s: string) => s.replace(/\s+/g, "")
  const { text } = Captured.parse(await ctx.api("GET", `${t}/capture?lines=40`).catch(() => ({ text: "" })))
  if (!squash(text).includes(squash(qs[0].question).slice(0, 80))) throw new OpError("its terminal doesn't show that question any more", 409)
  for (const [i, k] of pick(qs, choices).entries()) {
    if (i) await new Promise((r) => setTimeout(r, 200))
    await ctx.api("POST", `${t}/send`, { text: k, enter: false })
  }
  resolve(e.terminal, "")
  return { terminal: e.terminal, choices }
}

const atPrompt = (state?: string) => state === "idle" || state === "done"
const busy = (state?: string) => state === "working" || state === "blocked"

/** Type a message into an agent at its prompt, Enter once it shows (a dialog's Enter would pick an option); not working a
 *  few seconds later, Escape, then Enter again (vim mode); not shown or still not working, an error: not lost. */
export async function submit(ctx: Pick<OpCtx, "api">, id: string, text: string, tick = 500) {
  const t = encodeURIComponent(id)
  const working = async () => {
    for (let i = 0; i < 8; i++) {
      await new Promise((res) => setTimeout(res, tick))
      const { sessions } = Sessions.parse(await ctx.api("GET", "terminals/sessions"))
      if (busy(sessions.find((s) => s.id === id)?.state)) return true
    }
    return false
  }
  // (shown: its end in the lines that changed, spaces aside as the agent wraps it, or a long one as a paste's marker)
  const screen = async () => Captured.parse(await ctx.api("GET", `terminals/${t}/capture?lines=200`)).text.split("\n")
  const squash = (s: string) => s.replace(/\s+/g, "")
  const end = squash(text).slice(-24)
  const before = new Set(await screen())
  await ctx.api("POST", `terminals/${t}/send`, { text, enter: false })
  let shown = false
  for (let i = 0; i < 8 && !shown; i++) {
    await new Promise((res) => setTimeout(res, tick / 2))
    const changed = (await screen()).filter((l) => !before.has(l)).join("")
    shown = squash(changed).includes(end) || /\[Pasted /.test(changed)
  }
  if (!shown) throw new OpError(`the agent didn't take it (something over ${id}'s prompt, a question or an offer, has the keys): open its session to see it, then send it again`, 409)
  await ctx.api("POST", `terminals/${t}/send`, { text: "", enter: true })
  if (await working()) return
  await ctx.api("POST", `terminals/${t}/send`, { text: "\x1b", enter: false })
  await new Promise((res) => setTimeout(res, 300))
  await ctx.api("POST", `terminals/${t}/send`, { text: "", enter: true })
  if (await working()) return
  throw new OpError(`the agent didn't start on it (${id} is still at its prompt): open its session to see why, then send it again`, 409)
}

const Planned = z.looseObject({ how: z.string().nullable(), ago: z.number().nullable(), ttl: z.number().nullable() })

const replyPlanOp = defineOp({
  id: "inbox.reply-plan",
  owner: "the terminal",
  lock: false,
  summary: "Where a reply to an agent's report or session would go now: typed into its running terminal, its session resumed (its context still cached), or a new session.",
  kind: "read",
  params: { to: { type: "string", required: true, description: "the report (Inbox/<Title>.md) or the session's event id (vau inbox lists them)" } },
  args: ["to"],
  run: async (p, ctx) => {
    const to = str(p.to).trim()
    const { sessions } = Sessions.parse(await ctx.api("GET", "terminals/sessions"))
    const alive = (id: string) => sessions.some((s) => s.id === id)
    let plan: Plan | null
    if (EVENT_ID.test(to)) {
      const e = await eventFor(ctx, to)
      if (e.machine) return Planned.parse(await onOwner(ctx, e, "inbox.reply-plan", { to: splitMachine(e.id)[0] }))
      plan = await replyPlan(sessionOfRow(e), typable(sessions))
    } else {
      const r = resultAt(to)
      if (!r) throw new OpError(`no report ${to} in the inbox`, 404)
      const at = await elsewhere(r, alive)
      if (at) return Planned.parse(await onSessionMachine(ctx, at, "inbox.reply-plan", { to: `${r.id}.md` }))
      plan = await replyPlan(r, typable(sessions))
    }
    return { how: plan?.how ?? null, ago: plan?.ago ?? null, ttl: plan?.ttl ?? null }
  },
  text: (r) => r.how === "type" ? "Typed into its terminal, still running." : r.how === "resume" ? "Its session resumed" +
    (r.ago !== null && r.ttl ? ` (its context is cached for ${Math.max(0, Math.round((r.ttl - r.ago) / 60))} min more).` : ".")
    : r.how === "new" ? "A new session, told what it's about (its old context is no longer cached)." : "Nowhere: it names no session.",
})

const replyOp = defineOp({
  id: "inbox.reply",
  cli: "inbox reply",
  owner: "the terminal",
  lock: false,
  summary: "Answer an agent: its report, or its session's row in the inbox; typed into its session if it still runs, else the session resumed while its context is cached, else a new session told what it's about.",
  help: `What a report's Reply box and a session's reply in the inbox do. A terminal still running gets the reply as a new
message. Once it has ended, the session is resumed with it while the agent's prompt cache lasts (Claude Code: an hour,
or five minutes, after its last response): its whole context, cheap. Later, resuming would send the whole conversation
again at full price, so a new session starts, told to read the report (or the session's last answer, and where its
transcript is). Either runs in the background (no tab opens). how: resume or new, whatever the cache.
Its thread is then working (its agent has it) until that turn ends: with something for the user it's open again, else
done. A report: the reply is added to it, and it's archived (into Inbox/.archive/, the thread its item) unless keep; it
names the session answering it, whose next report goes on in it (back to new). A thread whose report it is takes it the
same way. A session on another of the Machines gets it through the app there.

  vau inbox reply "Inbox/Sidebar scrollbar fixed.md" "Yes, ship it to the phone too"
  vau inbox reply lzk3p2-a1b2c3 "Use the second option"`,
  kind: "write",
  params: {
    to: { type: "string", required: true, description: "the report (Inbox/<Title>.md) or the session's event id (vau inbox lists them)" },
    text: { type: "string", required: true, description: "the reply" },
    how: { type: "string", enum: ["auto", "resume", "new"], description: "resume its session, or start a new one (default auto: by its cache)" },
    keep: { type: "boolean", description: "a report: leave it new (not archived)" },
  },
  args: ["to", "text"],
  run: async (p, ctx) => {
    let to = str(p.to).trim()
    const how = p.how === "auto" ? "" : str(p.how)
    if (EVENT_ID.test(to)) {
      const e = await eventFor(ctx, to)
      if (e.machine) return onOwner(ctx, e, "inbox.reply", { to: splitMachine(e.id)[0], text: str(p.text), ...(how ? { how } : {}), ...(p.keep ? { keep: true } : {}) })
      const rec = fileOf(e.link) ? resultAt(fileOf(e.link)!) : undefined
      if (!rec || !(rec.terminal || rec.session)) return { to: e.id, ...(await replyToRow(ctx, e, str(p.text), how)), done: false }
      to = `${rec.id}.md`
    }
    // One line for the agent (a newline typed into its terminal would send it early); the report keeps its lines.
    const lines = str(p.text).trim(), text = lines.replace(/\s*\n\s*/g, " ")
    if (!text) throw new OpError("`text`: the reply")
    await plugin.vault.sync()
    const r = resultAt(to)
    if (!r) throw new OpError(`no report ${to} in the inbox`, 404)
    const terminal = str(r.terminal), session = str(r.session), agent = str(r.agent) || agentOfTerminal(terminal)
    if (!terminal && !(session && agent)) throw new OpError("this result doesn't say which session wrote it (only inbox.report's do)", 409)
    if (terminal) keepHanded(terminal)
    const { sessions } = Sessions.parse(await ctx.api("GET", "terminals/sessions"))
    const alive = (id: string) => !!id && sessions.some((s) => s.id === id)
    const at = await elsewhere(r, alive)
    if (at) return onSessionMachine(ctx, at, "inbox.reply", { to: `${r.id}.md`, text: str(p.text), ...(how ? { how } : {}), ...(p.keep ? { keep: true } : {}) })
    const again = "when it's done, report again with vau inbox report"
    const host: AgentReply | null = session && !how && !typable(sessions)(terminal) ? plugin.service(`agent-reply:${agent}`) : null
    const hosted = !!host && await host(session, `(A reply to your report ${r.id}.md; ${again}) ${text}`)
    const plan: Plan | null = hosted ? { how: "host", to: terminal, ago: null, ttl: null, transcript: "" } : await replyPlan(r, typable(sessions), how)
    if (!plan) throw new OpError(`its terminal ${terminal} has ended and the report has no session to resume`, 409)
    let started: Pick<InboxEvent, "terminal" | "session" | "host"> | null = null
    if (plan.how === "type") {
      const said = `(A reply to your report ${r.id}.md; ${again}) ${text}`
      if (atPrompt(sessions.find((s) => s.id === plan.to)?.state)) await submit(ctx, plan.to, said)
      else await ctx.api("POST", `terminals/${encodeURIComponent(plan.to)}/send`, { text: said, enter: true })
    } else if (plan.how !== "host") {
      const said = plan.how === "resume" ? `(A reply to your report ${r.id}.md; ${again}) ${text}`
        : `(A reply to the report \`${r.id}.md\`, which an earlier session wrote: you start without its context.) Read the ` +
          `report first: what was asked, what was done, what's left.${plan.transcript ? ` That session's transcript is ` +
          `\`${plan.transcript}\`: search it for a detail the report doesn't give, don't read it whole.` : ""} Then do what ` +
          `the reply asks, and ${again}. The user's reply: ${text}`
      if (plan.how === "resume") await startAgent(ctx, plan.to, said)
      else started = await startNew(ctx, agent, plan, said)
      if (!started?.host) hand(plan.to)
    }
    const quoted = lines.split(/\r?\n/).map((l) => `> ${l}`.trimEnd()).join("\n")
    const now = new Date()
    await editBody(r.id, (body) => {
      const note = `> [!note] You replied · ${localDate(now)} ${localTime(now)}\n${quoted}\n\n`
      const at = body.lastIndexOf(REPLY_BLOCK)
      return at < 0 ? `${body.replace(/\n*$/, "")}\n\n${note}` : body.slice(0, at) + note + body.slice(at)
    })
    const answering = started ? started.terminal ?? "" : plan.to
    const next = { ...(answering !== terminal ? { terminal: answering } : {}), ...(plan.how === "new" ? { session: started?.session ?? "" } : {}) }
    let id = r.id
    if ((!p.keep && r.status !== "done") || Object.keys(next).length) {
      id = Saved.nullable().parse(await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { ...next, ...(!p.keep ? { status: "done" } : {}) }))?.id || id
    }
    moveOn(list().filter((e) => [`${r.id}.md`, `${id}.md`].includes(fileOf(e.link) ?? "")), "working",
      started ?? { terminal: plan.to, ...(plan.how === "new" ? { session: undefined } : {}) })
    return { to: `${r.id}.md`, terminal: answering || null, how: plan.how, done: !p.keep }
  },
  text: (r) => `${r.how === "resume" ? "Resumed its session" : r.how === "new" ? "Started a new session" : r.how === "host" ? "Sent to its session" : "Sent"}${r.terminal ? ` in ${r.terminal}` : ""}${r.done ? "; the report is archived, its thread working" : "; its thread is working"}.`,
})

export function register() {
  plugin.op(replyPlanOp)
  plugin.op(replyOp)
}
