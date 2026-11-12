import fs from "node:fs"
import { OpError } from "../../../core/plugins.ts"
import type { Target } from "../../../core/desktop/places.ts"
import { lane, nowNote } from "./lane.ts"
import { plugin } from "./self.ts"
import { SAY_MS, wakes, str, mode, ownName } from "./settings.ts"
import { handed, asking, waiters, agents, seen, loaded, did, key, isMain, live, focus, waking, batches, resend, setAgent, putNote } from "./state.ts"
import { headAware } from "./windowpanes.ts"
import { cut } from "./edits.ts"
import { sessionFile, type Session, session, writeSession, sessionId, sessions, running, isChat, nextCmd, starting, ASK_AGAIN, HANDOVER_WAIT, handing, fresh, due, ended } from "./alwayson.ts"
import { type ChatState, chat, apiCtx, chatOptions } from "./chat.ts"
import { pendingFor, hand, handoverAsk, excerpts, momentsText } from "./next.ts"

/** What a chat session reads first: ME.md, their Now note when they keep one, and its docs. */
const ready = () => { const now = nowNote(); return `Read ME.md${now ? `, ${now.path} (what they're on now)` : ""} and \`vau docs companion\` first, once.` }
/** Agents whose chat session's turn runs (or was just sent its message): moments meanwhile wait for its end. */
export const turning = new Set<string>()
/** Chat sessions handed over, ended once their last turn does. */
const retiring = new Set<string>()

/** Agent `name`'s chat session starts: the moments waiting for it (the ask that started it) are its first message, else
 *  it gets ready, its cursor starting until that turn ends. */
export async function startChat(name: string, how: { agent: string; model: string; effort: string }, at: Target, after?: number) {
  const c = chat()
  if (!c) throw new OpError("the companion's Claude Code sessions run through the Claude Code plugin, which is off", 409)
  hearChats()
  const k = key(name)
  starting(name, { ...at, runs: how.agent, model: how.model || undefined, effort: how.effort || undefined }, after)
  const waiting = pendingFor(name), given = waiting.some(wakes) ? hand(name, waiting) : []
  const first = given.length ? `${ready()}\n\n${momentsText(given, mode(), focus(), await excerpts(apiCtx, given), headAware(name))}`
    : `${ready()} Then end your turn: what the user does comes as your next messages.`
  turning.add(k)
  let s: ChatState
  try { s = await c.start({ ...chatOptions(name, how), prompt: first }) } catch (e) {
    turning.delete(k); seen.delete(k)
    setAgent(name, { state: isMain(name) ? "watching" : "away" })
    throw e
  }
  writeSession({ id: s.id, name, t: Date.now(), runs: how.agent, ...(how.model ? { model: how.model } : {}), ...(how.effort ? { effort: how.effort } : {}), handed: given.length })
  if (isMain(name)) lane().warm()
  // (what it said before this knew its id)
  const now = c.list().find((x) => x.id === s.id)
  if (now) heard(s.id, now)
  return { id: s.id, running: false, name, ...how }
}

/** What's waiting for agent `name`'s chat session, sent as one message once its turn isn't running: the moments since
 *  the last (opens alone wait for one), else the ask to hand over when it's due. */
export async function pump(name: string) {
  const k = key(name), s = session(name), c = chat()
  if (!s || !isChat(s.id) || !c || turning.has(k) || mode() === "off") return
  const now = c.list().find((x) => x.id === s.id)
  if (now && (now.state === "working" || now.state === "waiting" || now.state === "starting")) return void turning.add(k)
  const got = pendingFor(name)
  let text: string
  if (got.some(wakes)) {
    turning.add(k)
    resend.delete(k)
    const given = hand(name, got)
    text = momentsText(given, mode(), focus(), await excerpts(apiCtx, given), headAware(name))
    const was = stopped.get(k)
    if (was && stopped.delete(k)) text = `${STOPPED(was)}\n${text}`
  } else if (fresh.has(k) || (Date.now() - (handing.get(k) ?? 0) > ASK_AGAIN && await due(s))) {
    if (turning.has(k)) return
    turning.add(k)
    fresh.delete(k); handing.set(k, Date.now())
    did(name, "asked to hand over")
    text = handoverAsk(isMain(name) ? "" : name, true)
  } else return
  try { await c.send(s.id, text, chatOptions(name, s)) } catch (e) {
    turning.delete(k)
    setAgent(name, { state: "watching" })
    const a = agents.get(k)
    putNote({ kind: "say", agent: name, text: `I couldn't take that in: ${(e as Error).message}`, ...(a?.path ? { path: a.path, line: a.line } : {}) }, SAY_MS)
    // (its conversation is gone: the next ask starts another)
    if ((e as OpError).status === 404) { try { fs.rmSync(sessionFile(name)) } catch { /* none */ } ended(name) }
  }
}

/** The keys that stop a terminal's agent mid-turn, by agent: Codex's Esc; OpenCode's Esc twice (once only arms it). */
export const INTERRUPT: Record<string, string[]> = { codex: ["Escape"], opencode: ["Escape", "Escape"] }
/** What a session stopped by the user (Esc) is told with its next moments: what it was answering. */
export const STOPPED = (asks: string[]) => `They stopped your last answer (Esc)${asks.length ? `, to ${asks.map((a) => JSON.stringify(cut(a, 120))).join(", ")}` : ""}: leave it as it is, and don't answer it again unless they ask anew.`
/** Agents the user stopped, with the asks they were answering, to tell them with their next moments. */
export const stopped = new Map<string, string[]>()
/** Each chat session's news count as last heard: a state told again without news (its model set) isn't its turn's end. */
const newsOf = new Map<string, number>()

/** A chat session's state, from claude-code's chat: a turn running shows its cursor busy, and what it asks by it; a turn
 *  ended is a terminal's next `next` (a seen tick when it let what it was handed pass), and what came meanwhile goes. */
function heard(id: string, s: ChatState | null) {
  if (retiring.has(id)) {
    if (!s || s.state === "idle" || s.state === "error") { retiring.delete(id); if (s) void chat()?.stop(id).catch(() => {}) }
    return
  }
  const x = sessions().find((v) => v.id === id)
  if (!x) return
  const a = agents.get(key(x.name)), name = a?.name ?? x.name, k = key(name)
  // (its process ended, idle a while, or the keeper went: the next message resumes it)
  if (!s) return void turning.delete(k)
  if (s.state === "waiting") setAgent(name, { asks: { event: `chat:${id}`, text: chat()?.asking(id).at(-1) || "It asks your permission: its session shows what" } })
  else if (a?.asks) setAgent(name, { asks: undefined })
  if (s.state === "working" || s.state === "waiting" || s.state === "starting") {
    newsOf.delete(id)
    turning.add(k)
    if (!a || a.state === "watching" || a.state === "away") setAgent(name, { state: "thinking" })
    return
  }
  // (the same turn's end told again, as a send applies its model first: not the end of the turn just sent)
  if (s.seq !== undefined) {
    if (newsOf.get(id) === s.seq) return
    newsOf.set(id, s.seq)
  }
  const was = turning.delete(k)
  asking.delete(k)
  batches.delete(k)
  seen.set(k, Date.now())
  if (resend.has(k)) setAgent(name, { state: "thinking" })
  else if (handed.has(k)) setAgent(name, { state: "watching", seen: true })
  else if (!a || a.state !== "watching") setAgent(name, { state: "watching" })
  if (was) did(name, "done")
  if (s.state === "error" && s.error) putNote({ kind: "say", agent: name, text: `I stopped: ${cut(s.error, 300)}`, ...(a?.path ? { path: a.path, line: a.line } : {}) }, SAY_MS)
  void pump(name)
}
let unhear: (() => void) | null = null
export const hearChats = () => { if (!unhear) { const c = chat(); if (c) unhear = c.on(heard) } }
export const unhearChats = () => { unhear?.(); unhear = null }

/** A chat session hands over: a new one (the same agent, account, model) starts with `text`, and the old one ends once
 *  its turn (the handover call's) does. */
export async function handOverChat(name: string, old: Session, text: string) {
  const c = chat()
  if (!c) throw new OpError("the companion's Claude Code sessions run through the Claude Code plugin, which is off", 409)
  const k = key(name)
  turning.add(k)
  const s = await c.start({ ...chatOptions(name, old), prompt: text }).catch((e) => { turning.delete(k); throw e })
  writeSession({ ...old, id: s.id, t: Date.now(), handed: 0 })
  // (its turn running, the handover call's: once it ends)
  const was = c.list().find((x) => x.id === old.id)
  if (was && (was.state === "working" || was.state === "waiting")) retiring.add(old.id)
  else void c.stop(old.id).catch(() => {})
  handing.delete(k); handed.delete(k); fresh.delete(k)
  seen.set(k, Date.now())
  did(name, "handover")
  // (its turn's end missed: ended anyway)
  setTimeout(() => { if (retiring.delete(old.id)) void c.stop(old.id).catch(() => {}) }, 2 * 60_000).unref?.()
  const now = c.list().find((x) => x.id === s.id)
  if (now) heard(s.id, now)
  return { id: s.id, from: old.id, name }
}

// A permission an agent's session asks (Claude Code's folder trust before it starts, a tool's) shows by its cursor with
// Approve and Deny, until its terminal no longer waits (answered there, in the inbox or on the phone).
plugin.onEvent({ types: ["inbox.event"] }, (ev) => {
  const s = ev.kind !== "info" && ev.state === "open" && ev.ask === "permission" ? sessions().find((x) => x.id === ev.terminal) : undefined
  if (!s) return
  setAgent(s.name, { asks: { event: str(ev.id), text: str(ev.body) || str(ev.title) } })
  void (async () => {
    while (agents.get(key(s.name))?.asks?.event === ev.id) {
      await new Promise((r) => setTimeout(r, 2000))
      if (agents.get(key(s.name))?.asks?.event !== ev.id) return
      if (!(await plugin.ask<boolean>("terminal:waits", false, s.id))) setAgent(s.name, { asks: undefined })
    }
  })()
})

// A session whose turn ended stops watching: nudged back when it hasn't waited on moments for a while. An agent quiet
// that long is away (an ask to it nudges it, or starts it again), the companion too once its session isn't running.
const NUDGE = 5 * 60_000
/** The watchdog's round, each minute (and the tests'). */
export async function tend() {
  if (plugin.isOff() || mode() === "off") return
  // (the companion stays while its session runs, but not starting forever)
  // (an agent told something while a session was asked about, a next or its end, is as that said: newer than this look)
  for (const a of [...agents.values()]) {
    if (a.state === "away" || live(a.name) || waking.has(key(a.name))) continue
    const t = a.t, runs = isMain(a.name) && await running(sessionId())
    if (a.t === t && (!runs || a.state === "starting")) setAgent(a.name, { state: runs ? "watching" : "away" })
  }
  // (a session that ended without telling us, as terminal.ended does: its cursor goes too)
  for (const s of sessions()) {
    const a = agents.get(key(s.name)), t = a?.t
    if (a && a.state !== "away" && a.state !== "starting" && !waiters.has(key(s.name)) && !waking.has(key(s.name)) && !(await running(s.id)) && a.t === t) ended(s.name, s.id)
  }
  // (nor thinking with no session to think: it ended mid-ask)
  const main = agents.get(key(ownName())), was = main?.t
  if (main && (main.state === "thinking" || main.state === "reading") && !waking.has(key(main.name)) && !(await running(sessionId())) && main.t === was) setAgent(main.name, { state: live(main.name) ? "watching" : "away" })
  // (asked to hand over and it didn't: a fresh one without its summary)
  for (const [k, t] of handing) {
    if (Date.now() - t < HANDOVER_WAIT) continue
    handing.delete(k)
    const s = sessions().find((x) => key(x.name) === k)
    if (s) await plugin.runOp("companion.handover", { as: s.name }).catch((e) => console.error(`companion: handover failed: ${(e as Error).message}`))
  }
  for (const s of sessions()) {
    const k = key(s.name)
    // (a chat session's moments go as its turns end: any left over, now)
    if (isChat(s.id)) { void pump(s.name); continue }
    if (waiters.has(k) || Date.now() - (seen.get(k) ?? loaded) < NUDGE || !(await running(s.id))) continue
    await nudge(s.name, s.id)
  }
}
export async function nudge(name: string, id: string) {
  seen.set(key(name), Date.now())
  await plugin.runOp("terminal.send", { id, text: `Keep watching: run \`${nextCmd(name)}\` again, and never end your turn.` }).catch(() => {})
}
export const watchdog = setInterval(tend, 60_000)
watchdog.unref?.()
