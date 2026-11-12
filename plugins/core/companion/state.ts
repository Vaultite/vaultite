import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import { WebSocket } from "ws"
import { localDate, type Who } from "../../../core/plugins.ts"
import { readText } from "../../../core/vault.ts"
import { profileOf } from "./profiles.ts"
import type { Hunk } from "./text.ts"
import { type Pane, PLACE_KEYS, type Target } from "../../../core/desktop/places.ts"
import { inSummoned } from "./summoned.ts"
import { keepShown, type Shown as ShownMark } from "./shown.ts"
import { TINTS, KEEP, SAY_MS, wakes, setting, mode, agentSetting, hidden, howOf, ownName, nameOf, profiles, inAccount, harnesses } from "./settings.ts"
import { plugin } from "./self.ts"
import type { Moment, Agent, KeptAgent, Note, Act } from "./types.ts"
import { KEPT, save, anchorLine, keepAsked } from "./comments.ts"
import { screens, screenDrawing, tours, SCREEN_NEWS, riding } from "./windows.ts"
import { followed } from "./windowpanes.ts"
import { touredAsk, answersOf, writing } from "./edits.ts"
import { session, sessionId, sessions, running, isChat, runsOf } from "./alwayson.ts"
import { chat, liveCtx } from "./chat.ts"
import { lane } from "./lane.ts"
import { turning, pump, nudge } from "./chatturns.ts"
import { liveEditing, talks, proofs } from "./wiring.ts"
import { toGuest } from "./people.ts"

// (agents are keyed by their name in lower case: @ada and --as Ada are the same one)
export const moments: Moment[] = []
export let seq = 0
/** The next moment's seq, for a part that adds one (an import can't be assigned). */
export const nextSeq = () => ++seq
export const delivered = new Map<string, number>() // agent -> last seq it was given
export const handed = new Set<string>() // agents given moments they haven't acted on yet
export const asking = new Set<string>() // agents handed an ask or a reply, busy on it until their next `next`
export const waiters = new Map<string, (m: Moment[]) => void>() // agent -> its waiting `next`
export const agents = new Map<string, KeptAgent>()
export const life = new Map<string, "starting" | "away">()
export const atWork = new Set<string>()
const writes = new Map<string, number>()
const wrote = new Set<string>()
export const seen = new Map<string, number>() // agent -> when it last ran `next`
export const ends = new Map<string, number>() // agent -> how many times its session ended (a `next` waiting through one returns)
export const dead = new Set<string>() // terminals whose session ended: a call still on its way from one brings no one back
export const watching = new Set<string>() // agents besides the companion that asked for edit and open moments
export const loaded = Date.now(), LIVE_MS = 10 * 60_000
export const notes = new Map<string, Note>()
/** Each agent's last says, gone from the screen or not, and what the user asked it (`ask`, `by` user): the cursor's
 *  popover shows them, a conversation. */
export let said: Note[] = []
export const recentSays = () => said
/** For the parts that replace it (an import can't be assigned). */
export const setSaid = (to: Note[]) => { said = to }
export const SAID = 10
export const timers = new Map<string, ReturnType<typeof setTimeout>>()
export const log = plugin.dayLog<Moment>("moments")
export const acts = plugin.dayLog<Act>("actions")
/** What's logged that isn't acting: its turn's bookkeeping. */
export const BOOKKEEPING = new Set(["next", "handed", "sent", "done", "again", "result", "withdrawn", "talked", "shown"])
/** When each agent last showed something (its cursor there, a mark) or let a moment pass: a tour's step the model
 *  played is one it showed, words alone (an apology) aren't. */
export const showedAt = new Map<string, number>(), passedAt = new Map<string, number>()
const SHOWING = new Set(["look", "draw", "highlight", "act"])
/** `text`: what it said (a say's words), kept for the conversation's page. */
export const did = (as: string, op: string, seqs?: number[], text?: string) => {
  const t = Date.now(), quick = inSummoned.getStore() === true
  if (SHOWING.has(op)) showedAt.set(key(as), t)
  else if (op === "pass") passedAt.set(key(as), t)
  acts.append(t, [{ t, as: quick ? lane().as(as) : as, op, ...(seqs ? { seqs } : {}), ...(text ? { text: text.slice(0, 2000) } : {}) }])
  if (BOOKKEEPING.has(op)) return
  if (quick) { life.delete(key(as)); lane().acted(op) }
  else acted(as)
}
export function acted(name: string) { const k = key(name); life.delete(k); handed.delete(k); atWork.delete(k) }
/** What each agent showed on the screen lately, where it landed (shown.ts): its next asks carry it. */
export const shownBy = new Map<string, ShownMark[]>()
export const showed = (as: string, add: ShownMark[]) => { if (add.length) shownBy.set(key(as), keepShown(shownBy.get(key(as)) ?? [], add)) }

/** The app's windows: which files each has open (`shown`: on screen, where an edit can be typed in), where its user is,
 *  when they last did anything. */
type Win = { open: string[]; shown: string[]; focus: Target | null; at: number; was?: string
  /** The panes it shows (each pane's tab: today's tabs), the focused one, and the one last said to the agents. */
  panes: Pane[]; pane?: string; told?: string }
export const windows = new Map<WebSocket, Win>()
/** A guest's view of the threads: `see` gives their name for a vault path in their folder (else null), `at` the vault
 *  path for theirs (throws outside it); `said`: true once they have said too much this minute. */
export type Guest = { id: string; name: string; who: Who; role: "read" | "comment" | "edit"; see: (rel: string) => string | null; at: (p: string) => string; said: () => boolean
  /** Whether the share still holds (not revoked nor expired). */
  holds: () => boolean
  /** Why a change of theirs to a note can't land, and whether they're typing too fast (the share's rules). */
  may: (rel: string, before: string, after: string) => string; slow: () => boolean
  /** When the folder was shared with them: the user's threads from before it stay the user's. */
  since: number }
export const guests = new Map<WebSocket, Guest>()
/** The most a person's comment or reply keeps; a guest's threads in a note, and words in a thread. */
export const MAX_TEXT = 4000, MAX_THREADS = 100, MAX_REPLIES = 100
/** What windows were asked to do and haven't answered, by request id (`ws`: the window asked). */
export const asked = new Map<string, { ws: WebSocket; done: (ok: boolean, error?: string, reply?: Record<string, unknown>) => void }>()

export const send = (ws: WebSocket, m: object) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)) }
export const broadcast = (m: object) => {
  // (its voice setting as it is now, with each say: an answer that just turned it off or on is said as it now says)
  const t = (m as { t: string }).t
  if (t === "note" || t === "state" || t === "voice") m = { ...m, voice: setting("voice") }
  const text = JSON.stringify(m)
  for (const ws of windows.keys()) if (ws.readyState === ws.OPEN) ws.send(text)
  if (SCREEN_NEWS.has((m as { t: string }).t)) for (const ws of screens) if (ws.readyState === ws.OPEN) ws.send(text)
  for (const [ws, g] of guests) if (ws.readyState === ws.OPEN) toGuest(ws, g, m as { t: string; note?: Note; id?: string })
}
// (fresh: what a new agent started from the app runs, profiles what the names that pick one start, harnesses what can run)
export const snapshot = () => ({ t: "state", mode: mode(), name: ownName(), agents: [...agents.values()].map(shown), notes: [...notes.values()], said, follows: followed.list(), riding: riding(), ...offers() })
export function offers() {
  const named = Object.entries(offered()).map(([name, p]) => [name, { agent: p.agent, ...howOf(p.agent, p.model, p.effort) }])
  return { fresh: { agent: agentSetting(), ...howOf(agentSetting()) }, profiles: Object.fromEntries(named), harnesses: harnesses() }
}
/** The profiles of agents installed here, and of the companion's own agent (in its account). */
export function offered() {
  const here = harnesses(), on = (agent: string) => here.some((h) => h.id === agent.split("_")[0] && (h.installed || h.id === agentSetting().split("_")[0]))
  return Object.fromEntries(Object.entries(profiles()).flatMap(([name, p]) => (on(p.agent) ? [[name, { ...p, agent: inAccount(p.agent) }]] : [])))
}

export const key = (name: string) => name.trim().toLowerCase()
export const isMain = (name: string) => key(name) === key(ownName())
/** An agent still around: waiting for moments, or it waited a moment ago; a chat session's, while it's kept. */
export const live = (name: string) => waiters.has(key(name)) || Date.now() - (seen.get(key(name)) ?? 0) < LIVE_MS || isChat(sessionId(name))
/** Who an ask to @name is for: that agent when it's around; the companion by its names (@companion, @claude when it
 *  runs Claude Code); one with a profile (@opus-review) or a session before, itself, to start; else the companion. */
export function addressee(name?: string) {
  const a = name ? agents.get(key(name)) : undefined
  if (!name || (a && stateOf(a.name) !== "away" && live(a.name))) return a?.name ?? ownName()
  if (isMain(name) || key(name) === "companion" || key(name) === key(nameOf(agentSetting()))) return ownName()
  return session(name) || profileOf(name, offered()) ? a?.name ?? nameOf(key(name)) : ownName()
}
/** Whether `name` gets moment `m`: its own, and edit and open for the companion and agents that watch; an ask sent
 *  live is its job's, no session's, unless handed back. */
export const meantFor = (m: Moment, name: string) => !m.live && (m.for ? key(m.for) === key(name) && !(m.summoned && isMain(name) && lane().on()) : isMain(name) || watching.has(key(name)))

/** Where the user is: the window they used last that has a note (`next`, and the ops' default place, both say this). */
export const focus = () => [...windows.values()].sort((a, b) => b.at - a.at).find((w) => w.focus)?.focus ?? null

/** Where a moment's agent looks: an app's window, its note's line, its pane's row, or the app's UI (a watch's, nowhere new). */
export const placeOf = (m: Partial<Moment>): Partial<KeptAgent> => (m.app || m.sx !== undefined ? { ...(m.app ? { app: m.app } : {}), ...(m.window ? { window: m.window } : m.sx !== undefined && m.sy !== undefined ? { sx: m.sx, sy: m.sy } : {}) } : m.path ? { path: m.path, line: m.line, find: m.find }
  : m.pane ? { pane: m.pane, ...(m.row ? { row: m.row } : {}) } : m.ui ? { ui: m.ui } : {})

/** Take in a moment from the app: kept (and logged), and given to the agents waiting. `from`: the window's request, which
 *  starts the companion's session when an ask finds it not running. */
export function addMoment(m: Omit<Moment, "seq" | "t"> & { t?: number }, from?: IncomingMessage) {
  const md = mode()
  if (md === "off") return null
  // (a line a shared folder's guest wrote is never the user's ask, whoever's window sends it)
  if (m.kind === "ask" && m.path && m.line && plugin.service("provenance:by-guest")?.(m.path, m.line) === true) return null
  if ((m.kind === "edit" || m.kind === "open") && md === "quiet") return null
  // (a private note: nothing of it reaches any agent)
  if (m.path && hidden(m.path)) return null
  // (spaces alone changed, as a trailing one: nothing to see, and an agent woken for it isn't free for what is)
  const words = (ls: string[]) => ls.map((l) => l.trim()).filter(Boolean).join("\n")
  if (m.kind === "edit" && m.hunks?.length && m.hunks.every((h) => words(h.added) === words(h.removed))) return null
  const full = { ...m, seq: ++seq, t: m.t ?? Date.now() } as Moment
  if (m.kind === "edit" || m.kind === "open") delete full.for
  else full.for = addressee(m.for)
  // (Keep or Still broken, just after a job's proof: the app's, never the model's, nor an ask a later job is told of)
  if (m.kind === "ask" && full.for && isMain(full.for) && full.text && !m.tour && proofs.answer(liveCtx(from), full.text)) return full
  // (else, right after a proof, their words are about the job just shown, whatever note or page is behind them)
  if (m.kind === "ask" && full.for && isMain(full.for) && full.text && !m.tour && !m.live) { const r = proofs.reviewedBy(full.text); if (r) full.reviewed = r }
  // (an ask already asked, as it reads, a while ago: a line asked again by Enter on it, after a restart too)
  if (m.kind === "ask" && !m.item && !m.summoned && log.read(localDate(full.t)).some((x) => x.kind === "ask" && x.for === full.for && x.path === full.path && x.text === full.text && full.t - x.t < 2 * 3600_000)) return null
  log.append(full.t, [full])
  const back = rethink(full)
  if (back) { keepAsked(back); return back }
  // (more of the same lines before any agent saw the last: one moment)
  const last = moments[moments.length - 1]
  const merged = m.kind === "edit" && last?.kind === "edit" && last.path === m.path && ![...delivered.values()].some((d) => d >= last.seq) ? mergeHunks(last.hunks ?? [], m.hunks ?? []) : null
  if (merged) { Object.assign(last, { hunks: merged, t: full.t }); return last }
  const was = m.kind === "ask" && !m.item && !m.summoned ? continues(full) : undefined
  if (was) {
    // (not handed yet: the same ask, as it reads now)
    if ((delivered.get(key(was.for!)) ?? 0) < was.seq) { Object.assign(was, { text: full.text, line: full.line }); keepAsked(was); return was }
    full.more = was.seq
  }
  moments.push(full)
  if (moments.length > KEEP) moments.splice(0, moments.length - KEEP)
  keepAsked(full)
  // (a new ask: what the last answer pointed with goes, a Talk key's too, so a mark it corrects is replaced, not
  // stacked; its cards stay, for a follow-up to change in place; a tour playing for it stops too: they moved on)
  if (full.for && (m.kind === "ask" || m.kind === "point") && !m.tour) { screenDrawing.settle(full.for); tours.interrupt(full.for); if (isMain(full.for)) proofs.stop() }
  // (a job has the floor: their Talk key's words are its, the companion quiet till they say back)
  if (full.summoned && full.for && isMain(full.for) && talks.take(full, from)) return full
  // (a tour's ask phrase, "what's new?": the tour plays, without the model)
  if (full.summoned && full.for && isMain(full.for) && m.kind === "ask" && !m.tour && full.text) {
    const name = full.for, ended = () => { if (touredAsk.get(key(name)) === full) touredAsk.delete(key(name)); setAgent(name, {}) }
    if (tours.asked(name, full.text, ended)) { touredAsk.set(key(name), full); life.delete(key(name)); setAgent(name, {}); return full }
  }
  // (a Talk key's ask over a page a job works on: straight to that job, live editing)
  if (full.summoned && full.for && isMain(full.for) && liveEditing.take(full, from)) return full
  handOut(full, from)
  return full
}

/** Moment `full`, kept, given to whoever takes it: its Talk key's session, else the agents it's for (waking one that
 *  isn't running, as the window's request `from`). */
export function handOut(m: Moment, from?: IncomingMessage) {
  // (its Talk key's: the summoned session's, which runs warm apart from the long one)
  if (lane().takes(m)) {
    life.delete(key(m.for!))
    lane().take(m)
    setAgent(m.for!, placeOf(m))
    return m
  }
  // (an open wakes no one: it rides along with the next moment, and the cursors free to follow go there now; so do the
  // user's corrections, a bubble closed or words moved)
  if (m.kind === "open") {
    for (const a of agents.values()) if (meantFor(m, a.name) && stateOf(a.name) === "watching" && live(a.name) && !handed.has(key(a.name)))
      setAgent(a.name, { path: m.path, line: m.line, x: m.x, y: m.y, find: undefined }, true)
  } else if (wakes(m)) {
    for (const [k, wake] of waiters) if (meantFor(m, k)) { waiters.delete(k); wake([m]) }
    for (const s of sessions()) if (isChat(s.id) && meantFor(m, s.name)) void pump(s.name)
  }
  // (one starting shows that until its first `next` takes it)
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
/** An ask to an agent whose session isn't running (ended, or never started: @opus) starts it, the ask waiting for its
 *  first `next`; one running that stopped watching is nudged. As the window's request: only this machine's owner starts. */
async function wake(m: Moment, from: IncomingMessage) {
  const name = m.for!, k = key(name), id = sessionId(name)
  // (another around has a session, or joined from one of its own, as the companion run by hand: the ask waits for its next)
  if (waiters.has(k) || waking.has(k) || (live(name) && (!isMain(name) || !id))) return
  if (await running(id)) return void (isMain(name) || isChat(id) || nudge(name, id!))
  waking.add(k)
  try { await plugin.runOp("companion.start", { ...(isMain(name) ? {} : { as: name }), ...(m.path ? { path: m.path, line: m.line } : {}), after: m.seq - 1 }, undefined, from) }
  catch (e) {
    asking.delete(k); life.delete(k)
    setAgent(name, {})
    putNote({ kind: "say", agent: name, text: `I couldn't start: ${(e as Error).message}`, ...(m.path ? { path: m.path, line: m.line } : {}), ...(m.summoned ? { answers: answersOf(m) } : {}) }, SAY_MS)
  } finally { waking.delete(k) }
}

/** The ask `m` goes on from: the last to the same agent on that line of that note, a few minutes ago, which `m`'s
 *  text begins like (dictation lands a sentence at a time, and a pause between sends the half written). */
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

/** The moments each chat session's turn was handed (its seqs), while that turn runs. */
export const batches = new Map<string, number[]>()
/** Sessions whose turn was stopped to take its moments again (no seen tick for it). */
export const resend = new Set<string>()
/** The user went on with what a chat session's turn is thinking over, before it acted (the next sentence of a thought,
 *  the rest of an ask): that turn stops, and the moment, as it reads now, goes again with the rest of its batch. */
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

/** Two edits in a row as one, when the second changes only lines the first wrote (or right after them); else null. */
export function mergeHunks(a: Hunk[], b: Hunk[]): Hunk[] | null {
  if (a.length !== 1 || b.length !== 1) return null
  const [x] = a, [y] = b, k = y.line - x.line
  if (k < 0 || k + y.removed.length > x.added.length) return null
  return [{ line: x.line, removed: x.removed, added: [...x.added.slice(0, k), ...y.added, ...x.added.slice(k + y.removed.length)].slice(0, 40) }]
}

/** Each agent's tint as it last had it, kept here: the same colour after a restart, whoever comes back first. */
const tintsFile = () => `${plugin.localDir()}/tints.json`
let tints: Record<string, string> | null = null
/** The agent named `name`, made the first time it acts (its tint its own from before, else the next free one: Claude
 *  Code's orange, Codex's blue, which the others take last). */
export function agentOf(name: string): KeptAgent {
  let a = agents.get(key(name))
  if (!a) {
    if (!tints) try { tints = JSON.parse(fs.readFileSync(tintsFile(), "utf8")) } catch { tints = {} }
    const used = new Set([...agents.values()].map((x) => x.tint))
    const s = session(name), runs = (s && runsOf(s)) || (isMain(name) ? agentSetting() : profileOf(name, offered())?.agent ?? "")
    const want = tints![key(name)] ?? ({ claude: "orange", codex: "blue" } as Record<string, string>)[runs.split("_")[0]] ?? null
    const tint = want && !used.has(want) ? want : TINTS.find((t) => !used.has(t) && t !== "orange" && t !== "blue") ?? TINTS.find((t) => !used.has(t)) ?? TINTS[agents.size % TINTS.length]
    if (tints![key(name)] !== tint) { tints![key(name)] = tint; try { fs.writeFileSync(tintsFile(), JSON.stringify(tints)) } catch { /* as it was */ } }
    a = { name, tint, t: Date.now(), ...(runs ? { runs } : {}), ...(s?.model ? { model: s.model } : {}), ...(s?.effort ? { effort: s.effort } : {}) }
    agents.set(key(name), a)
  }
  return a
}
/** The agent whose session runs in app terminal `terminal`, as Provenance names who wrote a line: its name, colour,
 *  and the model and effort it was started with; null when it's no companion's. */
plugin.provide("companion:who", (terminal: string) => {
  const s = sessions().find((x) => x.id === terminal)
  if (!s) return null
  const kept = session(s.name), a = agentOf(s.name)
  return { name: a.name, tint: a.tint, ...(kept?.model ? { model: kept.model } : {}), ...(kept?.effort ? { effort: kept.effort } : {}) }
})

/** What anchors a place: given one, the rest of the agent's old place goes (a pane's row isn't a note's line). */
export const ROOTS = ["path", "pane", "ui", "app", "sx"] as const
export function stateOf(name: string): Agent["state"] {
  const k = key(name), session = life.get(k)
  if (writes.has(k) || wrote.has(k)) return "writing"
  if (session === "away") return "away"
  if (isMain(name) && (lane().owes() || touredAsk.has(k))) return "thinking"
  if (session === "starting" && !handed.has(k)) return "starting"
  if (asking.has(k) || resend.has(k)) return "thinking"
  if (handed.has(k)) return "reading"
  return atWork.has(k) ? "thinking" : "watching"
}
export const shown = (a: KeptAgent): Agent => ({ ...a, state: stateOf(a.name) })

/** `moved`: a new place, not an act (`t` stays when it last acted), so its cursor doesn't show for it. */
export const setAgent = (name: string, change: Partial<KeptAgent>, moved = false) => put(name, change, moved ? "moved" : "act")
export const wroteAt = (name: string, at: Partial<KeptAgent>) => { acted(name); return put(name, at, "wrote") }
function put(name: string, change: Partial<KeptAgent>, how: "act" | "moved" | "wrote") {
  if (how === "wrote") wrote.add(key(name))
  else if (how === "act") wrote.delete(key(name))
  if (ROOTS.some((k) => change[k] !== undefined)) change = { ...Object.fromEntries([...PLACE_KEYS, "box"].map((k) => [k, undefined])), ...change }
  const a = Object.assign(agentOf(name), { seen: undefined, why: undefined, rests: undefined }, change, how === "moved" ? { rests: true } : { t: Date.now() })
  broadcast({ t: "agent", agent: shown(a) })
  return a
}
export function restate(name: string, f: () => void) {
  const was = agents.has(key(name)) ? stateOf(name) : null
  f()
  if (stateOf(name) !== was) setAgent(name, {})
}
export function writingAt(name: string, at: Partial<KeptAgent> | null) {
  const k = key(name)
  let open = !!at
  if (at) { writes.set(k, (writes.get(k) ?? 0) + 1); acted(name); setAgent(name, at) }
  return (then: Partial<KeptAgent> = {}) => {
    if (open) { open = false; const n = (writes.get(k) ?? 1) - 1; if (n > 0) writes.set(k, n); else writes.delete(k) }
    return setAgent(name, then)
  }
}
export function forget(name: string) {
  const k = key(name)
  agents.delete(k); life.delete(k); atWork.delete(k); writes.delete(k); wrote.delete(k); asking.delete(k); handed.delete(k)
}

/** A new item's id: short to type, and random so one kept by another machine's server isn't taken. */
export function newId() {
  let id: string
  do id = `n${Math.random().toString(36).slice(2, 6)}`; while (notes.has(id))
  return id
}

export function putNote(n: Omit<Note, "id" | "t">, ttl?: number) {
  const note: Note = { ...n, id: newId(), t: Date.now() }
  // (one by its words gets its line now: else the note's next save finds it, and its card redraws for that alone)
  if (note.kind !== "proposal" && KEPT.has(note.kind) && note.path && note.find && note.line === undefined) {
    try { note.line = anchorLine(readText(plugin.vault.abs(note.path)), note) ?? undefined } catch { /* not there yet */ }
  }
  notes.set(note.id, note)
  broadcast({ t: "note", note })
  if (ttl) timers.set(note.id, setTimeout(() => dropNote(note.id), ttl))
  if (KEPT.has(note.kind)) save(note.path!)
  return note
}
/** Whether `id` is a thread a person started (the user's, a guest's). */
export const personThread = (id: string) => !!notes.get(id)?.by
export function dropNote(id: string) {
  clearTimeout(timers.get(id)); timers.delete(id)
  const n = notes.get(id)
  if (!n || !notes.delete(id)) return
  broadcast({ t: "drop", id })
  if (KEPT.has(n.kind) && n.path) save(n.path)
}
