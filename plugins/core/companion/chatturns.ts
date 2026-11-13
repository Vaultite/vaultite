import fs from "node:fs"
import { logger, OpError } from "../../../core/plugins.ts"
import type { Target } from "../../../core/desktop/places.ts"
import { lane, nowNote } from "./lane.ts"
import { plugin } from "./self.ts"
import { SAY_MS, wakes, str, mode, ownName } from "./settings.ts"
import { handed, asking, waiters, agents, seen, loaded, did, key, isMain, live, focus, batches, resend, setAgent, putNote, life, atWork, restate, stateOf } from "./state.ts"
import { waking } from "./intake.ts"
import { headAware } from "./windowpanes.ts"
import { cut } from "./edits.ts"
import { sessionFile, type Session, session, writeSession, sessionId, sessions, running, isChat, nextCmd, starting, unstarted, ASK_AGAIN, HANDOVER_WAIT, handing, fresh, due, ended } from "./alwayson.ts"
import { type ChatState, chat, apiCtx, chatOptions } from "./chat.ts"
import { pendingFor, hand, handoverAsk } from "./next.ts"
import { excerpts, momentsText } from "./momentstext.ts"
import { messageOf, statusOf } from "./errors.ts"

const log = logger("companion")

const ready = () => { const now = nowNote(); return `Read ME.md${now ? `, ${now.path} (what they're on now)` : ""} and \`vau docs companion\` first, once.` }
export const turning = new Set<string>()
const retiring = new Set<string>()

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
    unstarted(name)
    throw e
  }
  writeSession({ id: s.id, name, t: Date.now(), runs: how.agent, ...(how.model ? { model: how.model } : {}), ...(how.effort ? { effort: how.effort } : {}), handed: given.length })
  if (isMain(name)) lane().warm()
  const now = c.list().find((x) => x.id === s.id)
  if (now) heard(s.id, now)
  return { id: s.id, running: false, name, ...how }
}

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
    turning.delete(k); asking.delete(k); handed.delete(k); atWork.delete(k)
    setAgent(name, {})
    const a = agents.get(k)
    putNote({ kind: "say", agent: name, text: `I couldn't take that in: ${messageOf(e)}`, ...(a?.path ? { path: a.path, line: a.line } : {}) }, SAY_MS)
    if (statusOf(e) === 404) { fs.rmSync(sessionFile(name), { force: true }); ended(name) }
  }
}

// OpenCode's first Esc only arms its interrupt.
export const INTERRUPT: Record<string, string[]> = { codex: ["Escape"], opencode: ["Escape", "Escape"] }
export const STOPPED = (asks: string[]) => `They stopped your last answer (Esc)${asks.length ? `, to ${asks.map((a) => JSON.stringify(cut(a, 120))).join(", ")}` : ""}: leave it as it is, and don't answer it again unless they ask anew.`
export const stopped = new Map<string, string[]>()
const newsOf = new Map<string, number>()

function heard(id: string, s: ChatState | null) {
  if (retiring.has(id)) {
    if (!s || s.state === "idle" || s.state === "error") { retiring.delete(id); if (s) void chat()?.stop(id).catch(() => {}) }
    return
  }
  const x = sessions().find((v) => v.id === id)
  if (!x) return
  const a = agents.get(key(x.name)), name = a?.name ?? x.name, k = key(name)
  if (!s) return void turning.delete(k)
  if (s.state === "waiting") setAgent(name, { asks: { event: `chat:${id}`, text: chat()?.asking(id).at(-1) || "It asks your permission: its session shows what" } })
  else if (a?.asks) setAgent(name, { asks: undefined })
  if (s.state === "working" || s.state === "waiting" || s.state === "starting") {
    newsOf.delete(id)
    turning.add(k)
    restate(name, () => { if (a && stateOf(name) === "away") life.delete(k); atWork.add(k) })
    return
  }
  if (s.seq !== undefined) {
    if (newsOf.get(id) === s.seq) return
    newsOf.set(id, s.seq)
  }
  const before = a ? stateOf(name) : null, was = turning.delete(k)
  asking.delete(k); atWork.delete(k); life.delete(k)
  batches.delete(k)
  seen.set(k, Date.now())
  if (resend.has(k)) setAgent(name, {})
  else if (handed.delete(k)) setAgent(name, { seen: true })
  else if (before !== "watching") setAgent(name, {})
  if (was) did(name, "done")
  if (s.state === "error" && s.error) putNote({ kind: "say", agent: name, text: `I stopped: ${cut(s.error, 300)}`, ...(a?.path ? { path: a.path, line: a.line } : {}) }, SAY_MS)
  void pump(name)
}
let unhear: (() => void) | null = null
export const hearChats = () => { if (!unhear) { const c = chat(); if (c) unhear = c.on(heard) } }
export const unhearChats = () => { unhear?.(); unhear = null }

export async function handOverChat(name: string, old: Session, text: string) {
  const c = chat()
  if (!c) throw new OpError("the companion's Claude Code sessions run through the Claude Code plugin, which is off", 409)
  const k = key(name)
  turning.add(k)
  const s = await c.start({ ...chatOptions(name, old), prompt: text }).catch((e) => { turning.delete(k); throw e })
  writeSession({ ...old, id: s.id, t: Date.now(), handed: 0 })
  const was = c.list().find((x) => x.id === old.id)
  if (was && (was.state === "working" || was.state === "waiting")) retiring.add(old.id)
  else void c.stop(old.id).catch(() => {})
  handing.delete(k); handed.delete(k); fresh.delete(k)
  seen.set(k, Date.now())
  did(name, "handover")
  setTimeout(() => { if (retiring.delete(old.id)) void c.stop(old.id).catch(() => {}) }, 2 * 60_000).unref?.()
  const now = c.list().find((x) => x.id === s.id)
  if (now) heard(s.id, now)
  return { id: s.id, from: old.id, name }
}

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

const NUDGE = 5 * 60_000
export async function tend() {
  if (plugin.isOff() || mode() === "off") return
  for (const a of [...agents.values()]) {
    if (stateOf(a.name) === "away" || live(a.name) || waking.has(key(a.name))) continue
    const t = a.t, runs = isMain(a.name) && await running(sessionId())
    if (a.t === t && (!runs || stateOf(a.name) === "starting")) { if (runs) life.delete(key(a.name)); else quiet(a.name); setAgent(a.name, {}) }
  }
  for (const s of sessions()) {
    const a = agents.get(key(s.name)), t = a?.t, now = a && stateOf(a.name)
    if (a && now !== "away" && now !== "starting" && !waiters.has(key(s.name)) && !waking.has(key(s.name)) && !(await running(s.id)) && a.t === t) ended(s.name, s.id)
  }
  const main = agents.get(key(ownName())), k = key(ownName()), was = main?.t
  const onAsk = () => (stateOf(ownName()) === "thinking" || stateOf(ownName()) === "reading") && (asking.has(k) || handed.has(k) || atWork.has(k))
  if (main && onAsk() && !waking.has(k) && !(await running(sessionId())) && main.t === was) {
    asking.delete(k); handed.delete(k); atWork.delete(k)
    if (!live(main.name)) quiet(main.name)
    setAgent(main.name, {})
  }
  for (const [k, t] of handing) {
    if (Date.now() - t < HANDOVER_WAIT) continue
    handing.delete(k)
    const s = sessions().find((x) => key(x.name) === k)
    if (s) await plugin.runOp("companion.handover", { as: s.name }).catch((e) => log.error(`handover failed: ${messageOf(e)}`))
  }
  for (const s of sessions()) {
    const k = key(s.name)
    if (isChat(s.id)) { void pump(s.name); continue }
    if (waiters.has(k) || Date.now() - (seen.get(k) ?? loaded) < NUDGE || !(await running(s.id))) continue
    await nudge(s.name, s.id)
  }
}
function quiet(name: string) { life.set(key(name), "away"); handed.delete(key(name)) }
export async function nudge(name: string, id: string) {
  seen.set(key(name), Date.now())
  await plugin.runOp("terminal.send", { id, text: `Keep watching: run \`${nextCmd(name)}\` again, and never end your turn.` }).catch(() => {})
}
export const watchdog = setInterval(tend, 60_000)
watchdog.unref?.()
