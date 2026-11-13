import { moments, nextSeq, delivered, handed, asking, waiters, agents, life, log, did, key, isMain, live, addressee, meantFor, placeOf, setAgent, stateOf, putNote, batches, resend } from "./state.ts"
import type { IncomingMessage } from "node:http"
import { localDate } from "../../../core/plugins.ts"
import type { Hunk } from "./text.ts"
import { KEEP, SAY_MS, wakes, mode, hidden } from "./settings.ts"
import { plugin } from "./self.ts"
import type { Moment } from "./types.ts"
import { keepAsked } from "./comments.ts"
import { screenDrawing, tours } from "./windows.ts"
import { touredAsk, answersOf, writing } from "./edits.ts"
import { sessionId, sessions, running, isChat } from "./alwayson.ts"
import { chat, liveCtx } from "./chat.ts"
import { lane } from "./lane.ts"
import { turning, pump, nudge } from "./chatturns.ts"
import { liveEditing, talks, proofs } from "./wiring.ts"
import { messageOf } from "./errors.ts"

export function addMoment(m: Omit<Moment, "seq" | "t"> & { t?: number }, from?: IncomingMessage) {
  const md = mode()
  if (md === "off") return null
  if (m.kind === "ask" && m.path && m.line && plugin.service("provenance:by-guest")?.(m.path, m.line) === true) return null
  if ((m.kind === "edit" || m.kind === "open") && md === "quiet") return null
  if (m.path && hidden(m.path)) return null
  const words = (ls: string[]) => ls.map((l) => l.trim()).filter(Boolean).join("\n")
  if (m.kind === "edit" && m.hunks?.length && m.hunks.every((h) => words(h.added) === words(h.removed))) return null
  const full: Moment = { ...m, seq: nextSeq(), t: m.t ?? Date.now() }
  if (m.kind === "edit" || m.kind === "open") delete full.for
  else full.for = addressee(m.for)
  if (m.kind === "ask" && full.for && isMain(full.for) && full.text && !m.tour && proofs.answer(liveCtx(from), full.text)) return full
  if (m.kind === "ask" && full.for && isMain(full.for) && full.text && !m.tour && !m.live) { const r = proofs.reviewedBy(full.text); if (r) full.reviewed = r }
  if (m.kind === "ask" && !m.item && !m.summoned && log.read(localDate(full.t)).some((x) => x.kind === "ask" && x.for === full.for && x.path === full.path && x.text === full.text && full.t - x.t < 2 * 3600_000)) return null
  log.append(full.t, [full])
  const back = rethink(full)
  if (back) { keepAsked(back); return back }
  const last = moments[moments.length - 1]
  const merged = m.kind === "edit" && last?.kind === "edit" && last.path === m.path && ![...delivered.values()].some((d) => d >= last.seq) ? mergeHunks(last.hunks ?? [], m.hunks ?? []) : null
  if (merged) { Object.assign(last, { hunks: merged, t: full.t }); return last }
  const was = m.kind === "ask" && !m.item && !m.summoned ? continues(full) : undefined
  if (was) {
    if ((delivered.get(key(was.for!)) ?? 0) < was.seq) { Object.assign(was, { text: full.text, line: full.line }); keepAsked(was); return was }
    full.more = was.seq
  }
  moments.push(full)
  if (moments.length > KEEP) moments.splice(0, moments.length - KEEP)
  keepAsked(full)
  if (full.for && (m.kind === "ask" || m.kind === "point") && !m.tour) { screenDrawing.settle(full.for); tours.interrupt(full.for); if (isMain(full.for)) proofs.stop() }
  if (full.summoned && full.for && isMain(full.for) && talks.take(full, from)) return full
  if (full.summoned && full.for && isMain(full.for) && m.kind === "ask" && !m.tour && full.text) {
    const name = full.for, ended = () => { if (touredAsk.get(key(name)) === full) touredAsk.delete(key(name)); setAgent(name, {}) }
    if (tours.asked(name, full.text, ended)) { touredAsk.set(key(name), full); life.delete(key(name)); setAgent(name, {}); return full }
  }
  if (full.summoned && full.for && isMain(full.for) && liveEditing.take(full, from)) return full
  handOut(full, from)
  return full
}

export function handOut(m: Moment, from?: IncomingMessage) {
  if (lane().takes(m)) {
    life.delete(key(m.for!))
    lane().take(m)
    setAgent(m.for!, placeOf(m))
    return m
  }
  if (m.kind === "open") {
    for (const a of agents.values()) if (meantFor(m, a.name) && stateOf(a.name) === "watching" && live(a.name) && !handed.has(key(a.name)))
      setAgent(a.name, { path: m.path, line: m.line, x: m.x, y: m.y, find: undefined }, true)
  } else if (wakes(m)) {
    for (const [k, wake] of waiters) if (meantFor(m, k)) { waiters.delete(k); wake([m]) }
    for (const s of sessions()) if (isChat(s.id) && meantFor(m, s.name)) void pump(s.name)
  }
  if (m.for && (m.kind === "ask" || m.kind === "point" || m.kind === "reply")) {
    const k = key(m.for), booting = agents.has(k) && stateOf(m.for) === "starting"
    asking.add(k)
    if (!booting) {
      life.delete(k)
      setAgent(m.for, placeOf(m))
      if (from) void wake(m, from)
    }
  }
  return m
}

export const waking = new Set<string>()
async function wake(m: Moment, from: IncomingMessage) {
  const name = m.for!, k = key(name), id = sessionId(name)
  if (waiters.has(k) || waking.has(k) || (live(name) && (!isMain(name) || !id))) return
  if (await running(id)) return void (isMain(name) || isChat(id) || nudge(name, id!))
  waking.add(k)
  try { await plugin.runOp("companion.start", { ...(isMain(name) ? {} : { as: name }), ...(m.path ? { path: m.path, line: m.line } : {}), after: m.seq - 1 }, undefined, from) }
  catch (e) {
    asking.delete(k); life.delete(k)
    setAgent(name, {})
    putNote({ kind: "say", agent: name, text: `I couldn't start: ${messageOf(e)}`, ...(m.path ? { path: m.path, line: m.line } : {}), ...(m.summoned ? { answers: answersOf(m) } : {}) }, SAY_MS)
  } finally { waking.delete(k) }
}

function continues(m: Moment): Moment | undefined {
  const was = moments.findLast((x) => x.kind === "ask" && x.path === m.path && x.for === m.for && x.seq !== m.seq && !x.summoned === !m.summoned)
  return was && goesOn(was, m) ? was : undefined
}
const goesOn = (was: Moment, m: Moment) => {
  if (!was.text || !m.text || was.line !== m.line || m.t - was.t > 5 * 60_000) return false
  let n = 0
  while (n < was.text.length && was.text[n] === m.text[n]) n++
  return n >= Math.min(40, was.text.length * 0.6)
}

function rethink(m: Moment): Moment | undefined {
  if (m.item || (m.kind !== "edit" && m.kind !== "ask")) return undefined
  for (const s of sessions()) {
    const k = key(s.name), batch = batches.get(k)
    if (!isChat(s.id) || !batch?.length || !turning.has(k) || !handed.has(k) || resend.has(k) || writing(s.name) || !meantFor(m, s.name)) continue
    const x = moments.findLast((y) => batch.includes(y.seq) && y.kind === m.kind && y.path === m.path && !y.item && (m.kind === "ask" ? y.for === m.for : true))
    if (!x) continue
    if (m.kind === "edit") {
      const hunks = mergeHunks(x.hunks ?? [], m.hunks ?? [])
      if (!hunks) continue
      x.hunks = hunks
    } else {
      if (!goesOn(x, m)) continue
      Object.assign(x, { text: m.text, line: m.line })
    }
    Object.assign(x, { t: m.t, again: true, ...(m.waited !== undefined ? { waited: m.waited } : {}) })
    delivered.set(k, Math.min(...batch) - 1)
    resend.add(k)
    did(s.name, "again", [x.seq])
    void chat()?.interrupt(s.id).then((ok) => { if (!ok) resend.delete(k); void pump(s.name) }, () => resend.delete(k))
    return x
  }
  return undefined
}

export function mergeHunks(a: Hunk[], b: Hunk[]): Hunk[] | null {
  if (a.length !== 1 || b.length !== 1) return null
  const [x] = a, [y] = b, k = y.line - x.line
  if (k < 0 || k + y.removed.length > x.added.length) return null
  return [{ line: x.line, removed: x.removed, added: [...x.added.slice(0, k), ...y.added, ...x.added.slice(k + y.removed.length)].slice(0, 40) }]
}
