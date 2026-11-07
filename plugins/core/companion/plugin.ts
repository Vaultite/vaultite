// Companion: one always-on agent session that watches the user write and answers in the app (its cursor, bubbles,
// margin comments, suggestions, edits typed in). Comments and suggestions are kept in a sidecar per note; the rest is live.
import { AsyncLocalStorage } from "node:async_hooks"
import fs from "node:fs"
import os from "node:os"
import type { IncomingMessage } from "node:http"
import path from "node:path"
import { type RawData, WebSocket } from "ws"
import { type AgentMeter, type AgentModels, type AgentUse, agentIn, agentName, findBin, KNOWN_AGENTS, newTerminalId, parseTerminal, startAgent } from "../../../core/agents.ts"
import { byUser, LOCAL, liveMarkdown, localDate, type OpCtx, OpError, Plugin, vaultPath, type Who, whoOf } from "../../../core/plugins.ts"
import { joinPath, Kind, readText, requestWriter, safeName, type Vault, type Writer, writeAtomic, writeNew } from "../../../core/vault.ts"
import { parseProfiles, type Profile, profileOf } from "./profiles.ts"
import { bridges } from "./bridge.ts"
import { type Follow, follows } from "./follows.ts"
import { rooms } from "./rooms.ts"
import { partialArgs } from "./partial.ts"
import { BIG_EDIT, changesOf, linesIn, tally } from "./proposals.ts"
import { type Change, changeAt, type Hunk, isPrivate, nearest, privateOf } from "./text.ts"
import { hostOf, type Pane, paneSource, PLACE_KEYS, placeText, siteIn, type Target } from "./places.ts"
import { AUTO_RULES, NEVER_READ, NEVER_RUN, readableDirs } from "./reach.ts"
import { screenDrawings } from "./drawings.ts"
import { screenMedia } from "./media.ts"
import { bestFound, byLabel, checkMarks, type Found, type Mark, type Rect as ScreenRect, rectOf, spots, VOCABULARY } from "./screenmarks.ts"
import { anchorsOf, inPicture, inSummoned, type Lane, screenNear, SUMMONED_PROMPT, summonedLane } from "./summoned.ts"
import { languageIn } from "./spoken.ts"
import { elevenUsage, voiceHere, voiceHereText, voiceOps } from "./voice.ts"
import { type JobState, jobSpoken, jobTimingsText, jobTold } from "./jobs.ts"
import { knockOps } from "./knockops.ts"
import { beforeLayer, FLIPS, layerOwner, readyNow } from "./proof.ts"
import { proofOps } from "./proofs.ts"
import { captureOps } from "./captures.ts"
import { liveEdits } from "./liveedit.ts"
import { walkOps } from "./walkops.ts"
import { teachOps } from "./teachops.ts"
import { jobOps } from "./workers.ts"
import { type Exchange, exchanges, type PressLine, type Spent, spent, talkSoFar } from "./conversation.ts"
import { type Guide, guideFor, guideLines, parseGuide, sitesOf } from "./guides.ts"
import { type Screen, toursOf } from "./tours.ts"
import type { Tour } from "./tour.ts"
import type { Seen } from "./anchor.ts"
import { markOf, type Spot, type Tag } from "./tags.ts"
import { doneText, effectOf, isBrowser, macOpen, nearText, stepOf, takeovers } from "./takeover.ts"
import { check as checkOn, listView, parseCondition, thingFrom, thingText, type Verdict } from "./uimodel.ts"
export { nearest } // (its tests reach it through the plugin)

export const plugin = new Plugin(import.meta.url)
voiceOps(plugin)

// The user's guides to their apps and sites (guides.ts): one loads with a summoned ask there.
plugin.kind(new Kind({
  type: "guide", collection: "guides", folder: "Guides", label: "Guides",
  parse: parseGuide,
  render: (g) => [{ app: (g.app as string[] | undefined)?.length ? g.app : null, site: (g.site as string[] | undefined)?.length ? g.site : null }, String(g.body ?? "")],
  filename: (g, at) => joinPath(at.folder, safeName(String(g.title || "Guide"))),
}))
const guides = () => plugin.vault.shared("guides") as unknown as readonly Guide[]

export type Mode = "off" | "quiet" | "pair"
/** What the user did, as an agent sees it. ask: they addressed it; point: an ask without words (its Talk key held, they
 *  drew or pointed); edit and open only in pair; reply, accept, reject, dismiss: their answer to one of its items. */
export type Moment = { seq: number; t: number; kind: "ask" | "point" | "edit" | "open" | "reply" | "accept" | "reject" | "dismiss" | "move" | "change" | "watch"
  path?: string; line?: number; text?: string; selection?: string; hunks?: Hunk[]; item?: string; to?: string
  /** A point's word or selection, where its cursor stays. */
  find?: string
  /** The agent it's for (an ask to @name, an answer to its item); none (edit, open): the companion and agents that watch. */
  for?: string
  /** How long (ms) the user had stopped typing when the app sent it: the pause they waited (a Talk key's ask: since
   *  it was let go, its words finished and what's there gathered). */
  waited?: number
  /** An ask whose line they went on writing after it went: the seq of the one it continues. */
  more?: number
  /** Handed again, as they went on with it before its agent acted: that turn was stopped. */
  again?: boolean
  /** On a drawing (`find`: the element asked in): the user's pointer, what changed after a pause, the scene as text. */
  x?: number; y?: number; changes?: string[]; scene?: string
  /** A reply to or a dismissal of one of its bubbles (`item`: the say), not a comment. */
  bubble?: boolean
  /** Asked with its Talk key (over the screen, Vaultite's windows too: the helper's): its summoned session's (summoned.ts); `voice`:
   *  said, not typed (its answer is said aloud, the desktop app's voice.ts). */
  summoned?: boolean; voice?: boolean
  /** Sent straight to the job working on its page (live editing, liveedit.ts): that job's id; `shotWindow`, the window
   *  under their pointer (Vaultite's own too), pictured before and after its change. */
  live?: string; shotWindow?: number
  /** A tour's step handed to the model (tours.ts): the player's words, never the user's, so it's no ask in their box. */
  tour?: boolean
  /** Asked through the realtime voice (the desktop app's realtimefront.ts): it already told them it's looking and says
   *  the answer itself; `talk`, what was said with it before. */
  front?: "realtime"; talk?: string[]
  /** A move: its words moved by the user, a bubble put in the note or what it wrote folded back into a bubble. */
  into?: "note" | "bubble"
  /** On screen, outside the app (the desktop app's helper): the app (bundle id, `appName` its name), its window and title,
   *  what the window says (its Accessibility text) and its picture (a PNG on this machine). */
  app?: string; appName?: string; window?: number; title?: string; screen?: string; shot?: string
  /** Other apps' panels floating over the screen then (a tray, a palette), front first: whose a thing in the picture is. */
  floating?: { app: string; name: string; frame: Rect }[]
  /** What was under their pointer, in words; on screen, that point (sx, sy), the picture's frame (`shotAt`: a pixel a
   *  point), what Accessibility found near it (`near`, ids for --ax) and what they drew (`ink`). */
  under?: string; sx?: number; sy?: number; shotAt?: Rect; near?: Near[]; ink?: Ink[]
  /** The box they drew on screen and keep there (a drag with the Talk key held: what they record), screen points. */
  region?: Rect
  /** What they clicked as they spoke, the Talk key held (each went on to the app as a click): where, and what was there. */
  clicks?: { sx: number; sy: number; under?: string }[]
  /** The display's picture as the key went down too, when the screen changed while they spoke (a toast gone); over
   *  Vaultite, its toasts of the last minute (`notices`, in words). */
  shotDown?: string; shotDownAt?: Rect; notices?: string
  /** On screen, its displays' bounds (screen points): where a mark can show. */
  displays?: Rect[]
  /** In a pane (a terminal, a web page: today's tab id) or the app's UI (a data-ui id), by its title; a terminal's row, a
   *  page's element (a snapshot ref) or the text under the pointer (`text`). */
  pane?: string; ui?: string; row?: number; el?: string
  /** change: what a pane it follows did (`what`: a command ended, the page changed; `changes` its lines); watch: a
   *  watch's hit (`item` the watch, `text` what to do). A page's address. */
  what?: string; url?: string }
export type { Target } from "./places.ts"
type Rect = { x: number; y: number; width: number; height: number }
/** An element near the pointer (the helper's Accessibility): its id to point by, its role, its words, its frame. */
type Near = import("./takeover.ts").Near
/** A stroke of ink: what it looks like (a ring round something, a line, an underline, a scribble), its box, its points. */
type Ink = { shape: string; box: Rect; points: [number, number][] }
/** reading: it was handed what the user did; thinking: something to answer; seen: it let that pass (why: its words on it);
 *  starting: its session boots (asks wait for its first `next`); runs (claude, codex), model, effort; asks: a permission. */
export type Agent = Target & Boxed & { name: string; tint: string; state: "watching" | "reading" | "thinking" | "writing" | "starting" | "away"; t: number; seen?: boolean; why?: string
  /** When it last pointed at its place (look, highlight, a say given one): a phone, with no cursor, shows it a moment. */
  pointed?: number
  /** Moved there without acting (after the user's note, back from the screen): its cursor rests at home till it acts. */
  rests?: boolean
  runs?: string; model?: string; effort?: string; asks?: { event: string; text: string } }
/** Where a page's element is in its page (CSS px, at its zoom), for the window to draw at: the engine's answer for `el`. */
export type Boxed = { box?: { x: number; y: number; w: number; h: number; zoom: number } }
/** What an agent leaves in the app: words by its cursor and highlights (gone after a while), a margin comment, a
 *  suggestion, a proposal (a large change, taken in part). `anchor`: a comment's line as it read, to find it again. */
export type Note = Target & Boxed & { id: string; kind: "say" | "comment" | "suggestion" | "proposal" | "highlight" | "ask"; agent: string; t: number
  text?: string; replace?: string; anchor?: string; replies?: Reply[]
  /** A proposal's changes not decided yet (its placeholders while it's written); how many were taken and left. */
  changes?: Change[]; took?: number; left?: number
  /** Who proposed it (or said it), as its request named them: what it takes is written as theirs (Provenance). */
  writer?: Writer
  /** A thread a person started, not an agent: the user, or a shared folder's guest (`agent` is then their name). */
  by?: "user" | "guest"
  /** The agent a person's thread asks (an @name in it): it hears the thread's words and answers in it. */
  ask?: string
  /** A person's colour (a token), where an agent's is its own; a guest's share (its id). */
  tint?: string; share?: string
  /** A say the user pinned: the comment it became. */
  pinned?: string
  /** A say that asks the user something (shown as a question, with a box to answer); one they saw (the unread dot);
   *  one they put in the note. */
  question?: boolean; seen?: boolean; placed?: boolean
  /** A comment the user dismissed, when: kept in its note's history. */
  dismissed?: number
  /** The text it was on is gone: shown by its last line, found again if the text comes back. */
  orphaned?: boolean
  /** A say answering a Talk key's ask: when that ask came, whether it was said (`voice`) and in what language, for the
   *  desktop app to say it aloud (`realtime`: said already, the realtime voice's own). Its exchange's: gone with it. */
  answers?: { t: number; voice?: true; lang?: string; realtime?: true } }
/** A word in a thread: the user's, an agent's, or a guest's (`name`: the guest's, or the agent's in a person's thread); when
 *  (older ones have none). */
export type Reply = { by: "user" | "agent" | "guest"; text: string; name?: string; t?: number }
/** What an agent did when (logged, for timings): called next, was handed moments (seqs), or acted (say, edit...). */
export type Act = { t: number; as: string; op: string; seqs?: number[]; text?: string }
/** A note's lines from..to (1-based, of `of`), sent with the moments in it; a drawing's scene as text. */
export type Excerpt = { path: string; from: number; to: number; of: number; lines: string[]; scene?: string
  /** A pane pointed at: what it shows now (a terminal's screen, a page's tree), by its title. */
  pane?: string; title?: string; text?: string }

const TINTS = ["orange", "blue", "purple", "green", "red", "yellow"]
const EMOJI: Record<string, string> = { red: "🔴", orange: "🟠", yellow: "🟡", green: "🟢", blue: "🔵", purple: "🟣" }
const KEEP = 300, SAY_MS = 12_000, HIGHLIGHT_MS = 10_000, EDIT_WAIT = 10_000, SAVED_MS = 3000
/** How long a bubble shows: longer the more it says, as reading takes. */
export const sayMs = (text: string) => Math.min(45_000, SAY_MS + Math.max(0, text.split(/\s+/).length - 20) * 300)
/** Whether a moment wakes its agent: an open, a bubble dismissed or its words moved by the user ride along with the next. */
export const wakes = (m: Pick<Moment, "kind" | "bubble">) => m.kind !== "open" && m.kind !== "move" && !(m.kind === "dismiss" && m.bubble)

const str = (v: unknown) => (typeof v === "string" ? v : "")
/** A setting, else its manifest's default. */
const setting = (key: string) => str(plugin.settings()[key]).trim() || str(plugin.manifest.settings?.[key]?.default)
export const mode = (): Mode => {
  const m = plugin.settings().mode
  return m === "off" || m === "pair" ? m : "quiet"
}
const agentSetting = () => setting("agent") || "claude"
/** A note no agent sees: in a private folder (the setting), or marked so in its properties (`companion: private`). */
export function hidden(p: string) {
  if (isPrivate(p, "", privates().folders)) return true
  if (!/\.md$/i.test(p)) return false
  let head = ""
  try { const fd = fs.openSync(plugin.vault.abs(p), "r"), b = Buffer.alloc(4096); head = b.subarray(0, fs.readSync(fd, b, 0, 4096, 0)).toString("utf8"); fs.closeSync(fd) } catch { return false }
  return isPrivate(p, head, [])
}
/** What it never sees: folders, sites, the Browser's containers and apps (the helper keeps those), the setting's lines
 *  (else its starting list). */
export const privates = () => { const v = plugin.settings().private; return privateOf(Array.isArray(v) ? v : plugin.manifest.settings?.private?.default) }
/** A web page it never sees: on a private site, or in a private container. */
export const privatePage = (url: string, container?: string | null) => { const p = privates(); return siteIn(hostOf(url), p.sites) || (!!container && p.containers.includes(container)) }
/** What a session of `agent` runs: the model and effort given, else the settings; their defaults (Sonnet, medium) only
 *  for Claude Code, whose models they name. */
export function howOf(agent: string, model = "", effort = "") {
  const claude = agent.split("_")[0] === "claude", own = (k: string) => (claude ? setting(k) : str(plugin.settings()[k]).trim())
  return { model: model || own("model"), effort: effort || own("effort") }
}
/** The configured agent's name: the setting, else its own (claude: Claude). */
const ownName = () => str(plugin.settings().name).trim() || nameOf(agentSetting())
const nameOf = (agent: string) => {
  const base = agent.split("_")[0]
  return base === "claude" ? "Claude" : agentName(base) ?? base.charAt(0).toUpperCase() + base.slice(1)
}
/** The names that pick an agent: the manifest's, then the user's lines. */
const profiles = () => parseProfiles([plugin.manifest.settings?.profiles?.default, plugin.settings().profiles].flatMap((v) => (Array.isArray(v) ? v : [])))
/** A profile's agent in the companion's account (claude_work) when it's the same agent. */
const inAccount = (agent: string) => (agent && agent === agentSetting().split("_")[0] ? agentSetting() : agent)
/** What agent `name` runs, filled in where it isn't told: as its last session did (started again), else its profile
 *  (its name's first part), else the settings. */
export function howFor(name: string, agent = "", model = "", effort = "") {
  const kept = isMain(name) ? null : session(name), ran = kept ? runsOf(kept) : ""
  let base: Partial<Profile> = ran ? { agent: ran, model: kept!.model, effort: kept!.effort } : isMain(name) ? {} : profileOf(name, profiles()) ?? {}
  if (agent && agent !== base.agent) base = {}
  const runs = agent || inAccount(base.agent ?? "") || agentSetting()
  return { agent: runs, ...howOf(runs, model || base.model, effort || base.effort) }
}
/** Programs whose name isn't their agent's. */
const BIN: Record<string, string> = { cursor: "cursor-agent" }
let found: { t: number; off: string; list: { id: string; name: string; installed: boolean; models: AgentModels["models"]; efforts: string[] }[] } | null = null
/** The coding agents a plugin that's on runs, whether they're installed here, and their models. */
function harnesses() {
  const off = [...plugin.vault.switchedOff()].join()
  if (found && found.off === off && Date.now() - found.t < 60_000) return found.list
  const list = KNOWN_AGENTS.flatMap((a) => {
    const id = a.terminal ?? a.id
    if (typeof plugin.service(`agent:${id}`) !== "function") return []
    let m: AgentModels | null = null
    try { m = plugin.service(`agent-models:${id}`)?.() ?? null } catch { /* none */ }
    return [{ id, name: a.name, installed: !!findBin(BIN[id] ?? id), models: m?.models ?? [], efforts: m?.efforts ?? [] }]
  })
  found = { t: Date.now(), off, list }
  return list
}

// ---------- state ----------

// (agents are keyed by their name in lower case: @ada and --as Ada are the same one)
const moments: Moment[] = []
let seq = 0
const delivered = new Map<string, number>() // agent -> last seq it was given
const handed = new Set<string>() // agents given moments they haven't acted on yet
const asking = new Set<string>() // agents handed an ask or a reply, busy on it until their next `next`
const waiters = new Map<string, (m: Moment[]) => void>() // agent -> its waiting `next`
const agents = new Map<string, Agent>()
const seen = new Map<string, number>() // agent -> when it last ran `next`
const ends = new Map<string, number>() // agent -> how many times its session ended (a `next` waiting through one returns)
const dead = new Set<string>() // terminals whose session ended: a call still on its way from one brings no one back
const watching = new Set<string>() // agents besides the companion that asked for edit and open moments
const loaded = Date.now(), LIVE_MS = 10 * 60_000
const notes = new Map<string, Note>()
/** Each agent's last says, gone from the screen or not, and what the user asked it (`ask`, `by` user): the cursor's
 *  popover shows them, a conversation. */
let said: Note[] = []
export const recentSays = () => said
const SAID = 10
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let nid = 0
const log = plugin.dayLog<Moment>("moments")
const acts = plugin.dayLog<Act>("actions")
/** What's logged that isn't acting: its turn's bookkeeping. */
const BOOKKEEPING = new Set(["next", "handed", "sent", "done", "again", "result", "withdrawn", "talked"])
/** `text`: what it said (a say's words), kept for the conversation's page. */
const did = (as: string, op: string, seqs?: number[], text?: string) => {
  const t = Date.now(), quick = inSummoned.getStore() === true
  acts.append(t, [{ t, as: quick ? lane().as(as) : as, op, ...(seqs ? { seqs } : {}), ...(text ? { text: text.slice(0, 2000) } : {}) }])
  if (BOOKKEEPING.has(op)) return
  if (quick) lane().acted(op)
  else handed.delete(key(as))
}
/** An agent's state once it acted: still thinking while busy on an ask (until its next `next`), else watching. */
const acting = (name: string): Agent["state"] => ((inSummoned.getStore() ? lane().asking() : asking.has(key(name))) ? "thinking" : "watching")

/** The app's windows: which files each has open (`shown`: on screen, where an edit can be typed in), where its user is,
 *  when they last did anything. */
type Win = { open: string[]; shown: string[]; focus: Target | null; at: number; was?: string
  /** The panes it shows (each pane's tab: today's tabs), the focused one, and the one last said to the agents. */
  panes: Pane[]; pane?: string; told?: string }
const windows = new Map<WebSocket, Win>()
/** A guest's view of the threads: `see` gives their name for a vault path in their folder (else null), `at` the vault
 *  path for theirs (throws outside it); `said`: true once they have said too much this minute. */
export type Guest = { id: string; name: string; who: Who; role: "read" | "comment" | "edit"; see: (rel: string) => string | null; at: (p: string) => string; said: () => boolean
  /** Whether the share still holds (not revoked nor expired). */
  holds: () => boolean
  /** Why a change of theirs to a note can't land, and whether they're typing too fast (the share's rules). */
  may: (rel: string, before: string, after: string) => string; slow: () => boolean
  /** When the folder was shared with them: the user's threads from before it stay the user's. */
  since: number }
const guests = new Map<WebSocket, Guest>()
/** The most a person's comment or reply keeps; a guest's threads in a note, and words in a thread. */
const MAX_TEXT = 4000, MAX_THREADS = 100, MAX_REPLIES = 100
/** What windows were asked to do and haven't answered, by request id (`ws`: the window asked). */
const asked = new Map<string, { ws: WebSocket; done: (ok: boolean, error?: string, reply?: Record<string, unknown>) => void }>()

const send = (ws: WebSocket, m: object) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)) }
const broadcast = (m: object) => {
  const text = JSON.stringify(m)
  for (const ws of windows.keys()) if (ws.readyState === ws.OPEN) ws.send(text)
  if (SCREEN_NEWS.has((m as { t: string }).t)) for (const ws of screens) if (ws.readyState === ws.OPEN) ws.send(text)
  for (const [ws, g] of guests) if (ws.readyState === ws.OPEN) toGuest(ws, g, m as { t: string; note?: Note; id?: string })
}
// (fresh: what a new agent started from the app runs, profiles what the names that pick one start, harnesses what can run)
const snapshot = () => ({ t: "state", mode: mode(), name: ownName(), agents: [...agents.values()], notes: [...notes.values()], said, follows: followed.list(), riding: riding(), ...offers() })
function offers() {
  const named = Object.entries(offered()).map(([name, p]) => [name, { agent: p.agent, ...howOf(p.agent, p.model, p.effort) }])
  return { fresh: { agent: agentSetting(), ...howOf(agentSetting()) }, profiles: Object.fromEntries(named), harnesses: harnesses() }
}
/** The profiles of agents installed here, and of the companion's own agent (in its account). */
function offered() {
  const here = harnesses(), on = (agent: string) => here.some((h) => h.id === agent.split("_")[0] && (h.installed || h.id === agentSetting().split("_")[0]))
  return Object.fromEntries(Object.entries(profiles()).flatMap(([name, p]) => (on(p.agent) ? [[name, { ...p, agent: inAccount(p.agent) }]] : [])))
}

const key = (name: string) => name.trim().toLowerCase()
const isMain = (name: string) => key(name) === key(ownName())
/** An agent still around: waiting for moments, or it waited a moment ago; a chat session's, while it's kept. */
const live = (name: string) => waiters.has(key(name)) || Date.now() - (seen.get(key(name)) ?? 0) < LIVE_MS || isChat(sessionId(name))
/** Who an ask to @name is for: that agent when it's around; the companion by its names (@companion, @claude when it
 *  runs Claude Code); one with a profile (@opus-review) or a session before, itself, to start; else the companion. */
function addressee(name?: string) {
  const a = name ? agents.get(key(name)) : undefined
  if (!name || (a && a.state !== "away" && live(a.name))) return a?.name ?? ownName()
  if (isMain(name) || key(name) === "companion" || key(name) === key(nameOf(agentSetting()))) return ownName()
  return session(name) || profileOf(name, offered()) ? a?.name ?? nameOf(key(name)) : ownName()
}
/** Whether `name` gets moment `m`: its own, and edit and open for the companion and agents that watch; an ask sent
 *  live is its job's, no session's, unless handed back. */
const meantFor = (m: Moment, name: string) => !m.live && (m.for ? key(m.for) === key(name) && !(m.summoned && isMain(name) && lane().on()) : isMain(name) || watching.has(key(name)))

/** Where the user is: the window they used last that has a note (`next`, and the ops' default place, both say this). */
export const focus = () => [...windows.values()].sort((a, b) => b.at - a.at).find((w) => w.focus)?.focus ?? null

/** Where a moment's agent looks: an app's window, its note's line, its pane's row, or the app's UI (a watch's, nowhere new). */
const placeOf = (m: Partial<Moment>): Partial<Agent> => (m.app || m.sx !== undefined ? { ...(m.app ? { app: m.app } : {}), ...(m.window ? { window: m.window } : m.sx !== undefined && m.sy !== undefined ? { sx: m.sx, sy: m.sy } : {}) } : m.path ? { path: m.path, line: m.line, find: m.find }
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
  // (a tour's ask phrase, "what's new?": the tour plays, without the model)
  if (full.summoned && full.for && isMain(full.for) && m.kind === "ask" && !m.tour && full.text && tours.asked(full.for, full.text)) { touredAsk.set(key(full.for), full); return full }
  // (a Talk key's ask over a page a job works on: straight to that job, live editing)
  if (full.summoned && full.for && isMain(full.for) && liveEditing.take(full, from)) return full
  handOut(full, from)
  return full
}

/** Moment `full`, kept, given to whoever takes it: its Talk key's session, else the agents it's for (waking one that
 *  isn't running, as the window's request `from`). */
function handOut(m: Moment, from?: IncomingMessage) {
  // (its Talk key's: the summoned session's, which runs warm apart from the long one)
  if (lane().takes(m)) {
    setAgent(m.for!, { state: "thinking", ...placeOf(m) })
    lane().take(m)
    return m
  }
  // (an open wakes no one: it rides along with the next moment, and the cursors free to follow go there now; so do the
  // user's corrections, a bubble closed or words moved)
  if (m.kind === "open") {
    for (const a of agents.values()) if (meantFor(m, a.name) && a.state === "watching" && live(a.name) && !handed.has(key(a.name)))
      setAgent(a.name, { path: m.path, line: m.line, x: m.x, y: m.y, find: undefined, state: "watching" }, true)
  } else if (wakes(m)) {
    for (const [k, wake] of waiters) if (meantFor(m, k)) { waiters.delete(k); wake([m]) }
    for (const s of sessions()) if (isChat(s.id) && meantFor(m, s.name)) void pump(s.name)
  }
  // (one starting shows that until its first `next` takes it)
  if (m.for && (m.kind === "ask" || m.kind === "point" || m.kind === "reply") && agents.get(key(m.for))?.state !== "starting") {
    setAgent(m.for, { state: "thinking", ...placeOf(m) })
    if (from) void wake(m, from)
  }
  return m
}

const waking = new Set<string>()
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
    setAgent(name, { state: "watching" })
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
const batches = new Map<string, number[]>()
/** Sessions whose turn was stopped to take its moments again (no seen tick for it). */
const resend = new Set<string>()
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
function agentOf(name: string): Agent {
  let a = agents.get(key(name))
  if (!a) {
    if (!tints) try { tints = JSON.parse(fs.readFileSync(tintsFile(), "utf8")) } catch { tints = {} }
    const used = new Set([...agents.values()].map((x) => x.tint))
    const s = session(name), runs = (s && runsOf(s)) || (isMain(name) ? agentSetting() : profileOf(name, offered())?.agent ?? "")
    const want = tints![key(name)] ?? ({ claude: "orange", codex: "blue" } as Record<string, string>)[runs.split("_")[0]] ?? null
    const tint = want && !used.has(want) ? want : TINTS.find((t) => !used.has(t) && t !== "orange" && t !== "blue") ?? TINTS.find((t) => !used.has(t)) ?? TINTS[agents.size % TINTS.length]
    if (tints![key(name)] !== tint) { tints![key(name)] = tint; try { fs.writeFileSync(tintsFile(), JSON.stringify(tints)) } catch { /* as it was */ } }
    a = { name, tint, state: "watching", t: Date.now(), ...(runs ? { runs } : {}), ...(s?.model ? { model: s.model } : {}), ...(s?.effort ? { effort: s.effort } : {}) }
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
const ROOTS = ["path", "pane", "ui", "app", "sx"] as const
/** `moved`: a new place, not an act (`t` stays when it last acted), so its cursor doesn't show for it. */
function setAgent(name: string, change: Partial<Agent>, moved = false) {
  if (change.state === "watching" || change.state === "writing" || change.state === "away") handed.delete(key(name))
  if (ROOTS.some((k) => change[k] !== undefined)) change = { ...Object.fromEntries([...PLACE_KEYS, "box"].map((k) => [k, undefined])), ...change }
  const a = Object.assign(agentOf(name), { seen: undefined, why: undefined, rests: undefined }, change, moved ? { rests: true } : { t: Date.now() })
  broadcast({ t: "agent", agent: a })
  return a
}

/** A new item's id: short to type, and random so one kept by another machine's server isn't taken. */
function newId() {
  let id: string
  do id = `n${Math.random().toString(36).slice(2, 6)}`; while (notes.has(id))
  return id
}

function putNote(n: Omit<Note, "id" | "t">, ttl?: number) {
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
const personThread = (id: string) => !!notes.get(id)?.by
function dropNote(id: string) {
  clearTimeout(timers.get(id)); timers.delete(id)
  const n = notes.get(id)
  if (!n || !notes.delete(id)) return
  broadcast({ t: "drop", id })
  if (KEPT.has(n.kind) && n.path) save(n.path)
}

// ---------- comments and suggestions kept: a sidecar per note, so they outlive the server and reach other devices

const KEPT = new Set(["comment", "suggestion", "proposal"])
/** Comments the user dismissed, per note, newest last: its history (kept in the sidecar too). */
const past = new Map<string, Note[]>()
const PAST = 30
const DIR = ".vaultite/plugins/companion/comments"
const sidecar = (p: string) => `${DIR}/${p}.json`
/** Each sidecar's text as last written or read: our own writes come back from the watcher. */
const written = new Map<string, string>()
const kept = (p: string) => [...notes.values()].filter((n) => n.path === p && KEPT.has(n.kind))
const lineCount = (text: string) => text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
const under = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`)

/** A drawing's typed actions made on its text (`draw:<ext>`, from the plugin that draws it), or null: not a drawing. */
type Draw = (text: string, actions: unknown[]) => { text: string; touched: string[] }
function drawer(p: string): Draw | null {
  const exts = p.slice(p.lastIndexOf("/") + 1).toLowerCase().split(".").slice(1)
  for (let i = 0; i < exts.length; i++) { const fn = plugin.service(`draw:${exts.slice(i).join(".")}`); if (typeof fn === "function") return fn as Draw }
  return null
}
export const drawing = (p: string) => !!drawer(p)
/** A point given (x and y, numbers), as a target's or a moment's fields. */
const point = (o: Record<string, unknown>) => (typeof o.x === "number" && typeof o.y === "number" && Number.isFinite(o.x + o.y) ? { x: Math.round(o.x), y: Math.round(o.y) } : {})

/** Write a note's sidecar as its kept items are now; none: the file goes. */
export function save(p: string) {
  const rel = sidecar(p), list = kept(p), old = past.get(p) ?? [], bare = ({ path: _, ...n }: Note) => n
  const text = list.length || old.length ? `${JSON.stringify({ comments: list.map(bare), ...(old.length ? { past: old.map(bare) } : {}) }, null, 2)}\n` : ""
  if (text === (written.get(rel) ?? "")) return
  const abs = plugin.vault.abs(rel)
  try {
    if (text) writeAtomic(abs, text)
    else {
      fs.rmSync(abs, { force: true })
      // (its folders too, once empty)
      for (let d = path.dirname(abs), top = plugin.vault.abs(DIR); d.startsWith(top) && fs.readdirSync(d).length === 0; d = path.dirname(d)) fs.rmdirSync(d)
    }
  } catch (e) { console.error(`companion: couldn't save ${rel}: ${(e as Error).message}`) }
  if (text) written.set(rel, text); else written.delete(rel)
}

/** A note's kept items as its sidecar has them now (the server started, or another machine wrote it). */
function load(p: string) {
  const rel = sidecar(p), abs = plugin.vault.abs(rel)
  let text = ""
  try { text = readText(abs) } catch (e) {
    // (in iCloud only for now, or unreadable: as it was until it reads)
    if ((e as NodeJS.ErrnoException).code !== "ENOENT" || fs.existsSync(path.join(path.dirname(abs), `.${path.basename(abs)}.icloud`))) return
  }
  if (text === (written.get(rel) ?? "")) return
  let list: unknown, was: unknown
  try { ({ comments: list, past: was } = text ? JSON.parse(text) : { comments: [] }) } catch { return }
  if (!Array.isArray(list)) return
  if (text) written.set(rel, text); else written.delete(rel)
  const gone = Array.isArray(was) ? was.filter((n): n is Note => n && typeof n.id === "string" && n.kind === "comment").map((n) => ({ ...n, path: p })) : []
  if (gone.length) past.set(p, gone); else past.delete(p)
  const now = new Map(list.filter((n): n is Note => n && typeof n.id === "string" && KEPT.has(n.kind)).map((n) => [n.id, { ...n, path: p }]))
  for (const n of kept(p)) if (!now.has(n.id)) { notes.delete(n.id); broadcast({ t: "drop", id: n.id }) }
  for (const n of now.values()) {
    if (JSON.stringify(notes.get(n.id)) === JSON.stringify(n)) continue
    notes.set(n.id, n)
    broadcast({ t: "note", note: n })
  }
}

/** The line an item is on in `text` now: where its find (or anchor line) is nearest its line, null when that's gone. */
export function anchorLine(text: string, n: Pick<Note, "find" | "anchor" | "line">): number | null {
  if (n.find) {
    const i = nearest(text, n.find, n.line)
    return i < 0 ? null : text.slice(0, i).split("\n").length
  }
  const lines = text.split("\n")
  if (!n.anchor) return Math.max(1, Math.min(n.line ?? 1, lineCount(text)))
  let best: number | null = null
  lines.forEach((l, i) => { if (l.trim() === n.anchor && (best === null || Math.abs(i + 1 - (n.line ?? 1)) < Math.abs(best - (n.line ?? 1)))) best = i + 1 })
  return best
}

/** A note's kept items found again in its text: a comment whose text is gone stays by its last line, orphaned, a
 *  suggestion goes. */
function follow(p: string) {
  const list = kept(p)
  let text: string
  try { text = readText(plugin.vault.abs(p)) } catch { return }
  let changed = false
  for (const n of list) {
    if (n.kind === "proposal") { if (refind(n, text)) changed = true; continue }
    const found = anchorLine(text, n)
    if (found === null && n.kind !== "comment") { notes.delete(n.id); broadcast({ t: "drop", id: n.id }); changed = true; continue }
    const line = found ?? Math.max(1, Math.min(n.line ?? 1, lineCount(text)))
    if (line === n.line && !n.orphaned === (found !== null)) continue
    n.line = line
    if (found === null) n.orphaned = true; else delete n.orphaned
    broadcast({ t: "note", note: n })
    changed = true
  }
  if (changed) save(p)
}
// (after a pause: a suggestion just taken is answered before its text is gone from the file)
const following = new Map<string, ReturnType<typeof setTimeout>>()
const followSoon = (p: string) => {
  clearTimeout(following.get(p))
  following.set(p, setTimeout(() => { following.delete(p); follow(p) }, 2000))
}

/** Every sidecar read (as when the server starts), and its note's items found again; fresh: memory's forgotten first. */
export function loadAll(fresh = false) {
  if (fresh) { for (const n of notes.values()) if (KEPT.has(n.kind)) notes.delete(n.id); written.clear(); past.clear() }
  const top = plugin.vault.abs(DIR)
  let files: string[] = []
  try { files = (fs.readdirSync(top, { recursive: true }) as string[]).filter((f) => f.endsWith(".json")) } catch { /* none yet */ }
  for (const f of files) {
    const p = f.split(path.sep).join("/").slice(0, -5)
    load(p)
    // (a trashed note's, once it's gone for good from the trash)
    if (p.startsWith(".trash/") && !fs.existsSync(plugin.vault.abs(p))) { for (const n of kept(p)) notes.delete(n.id); past.delete(p); save(p) } else follow(p)
  }
}

let loadedFor: Vault | null = null
plugin.onChange((paths) => {
  if (!loadedFor) return
  if (paths === null) return loadAll()
  for (const p of paths) {
    if (p.startsWith(`${DIR}/`) && p.endsWith(".json")) load(p.slice(DIR.length + 1, -5))
    else if (kept(p).length || past.has(p)) {
      if (p.startsWith(".trash/") && !fs.existsSync(plugin.vault.abs(p))) { past.delete(p); for (const n of kept(p)) dropNote(n.id); save(p) } else followSoon(p)
    }
  }
})

// Kept items follow their note: moved, renamed, into the trash and back (even while it's off).
plugin.onMove((from, to, trashed) => {
  const dest = to ?? trashed ?? null
  const there = (p: string) => (dest === null ? null : dest + p.slice(from.length))
  for (const [a, b] of [[sidecar(from), dest && sidecar(dest)], [`${DIR}/${from}`, dest && `${DIR}/${dest}`]]) {
    const abs = plugin.vault.abs(a!)
    if (!fs.existsSync(abs) || (a === `${DIR}/${from}` && !fs.statSync(abs).isDirectory())) continue
    try {
      if (b) { fs.mkdirSync(path.dirname(plugin.vault.abs(b)), { recursive: true }); fs.renameSync(abs, plugin.vault.abs(b)) } else fs.rmSync(abs, { recursive: true, force: true })
    } catch (e) { console.error(`companion: couldn't move ${a}: ${(e as Error).message}`) }
  }
  for (const [k, text] of [...written]) {
    const p = k.slice(DIR.length + 1, -5)
    if (!under(p, from)) continue
    written.delete(k)
    const q = there(p)
    if (q) written.set(sidecar(q), text)
  }
  for (const [p, list] of [...past]) {
    if (!under(p, from)) continue
    past.delete(p)
    const q = there(p)
    if (q) past.set(q, list.map((n) => ({ ...n, path: q })))
  }
  for (const n of [...notes.values()]) {
    if (!n.path || !under(n.path, from) || !KEPT.has(n.kind)) continue
    const q = there(n.path)
    if (q) { n.path = q; broadcast({ t: "note", note: n }) } else { notes.delete(n.id); broadcast({ t: "drop", id: n.id }) }
  }
})

/** The user's answer to an item from the app: a moment for its agent; a suggestion or a dismissed comment goes away. */
export function answer(id: string, verdict: "accept" | "reject" | "dismiss" | "reply", text?: string, from?: IncomingMessage) {
  const n = notes.get(id) ?? said.find((x) => x.id === id)
  if (!n) return
  if (n.kind === "say") return answerSay(n, verdict, text, from)
  if (n.kind === "proposal") return verdict === "reply" ? undefined : void review(id, verdict === "accept" ? "accept" : "reject", undefined, from).catch((e) => console.error(`companion: ${(e as Error).message}`))
  if (verdict === "reply" && text) {
    n.replies = [...(n.replies ?? []), { by: "user", text: text.slice(0, MAX_TEXT), t: Date.now() }]
    broadcast({ t: "note", note: n })
    if (KEPT.has(n.kind) && n.path) save(n.path)
  } else {
    if (verdict === "dismiss" && n.kind === "comment" && n.path) past.set(n.path, [...(past.get(n.path) ?? []).filter((x) => x.id !== id), { ...n, dismissed: Date.now() }].slice(-PAST))
    dropNote(id)
  }
  // (a person's thread is between people, unless it asks an agent: then that agent hears the words in it)
  if (n.by) {
    const to = n.by === "user" && verdict === "reply" && text ? mentioned(text) ?? n.ask : undefined
    if (!to) return
    if (n.ask !== to) { n.ask = to; save(n.path!) }
    return void addMoment({ kind: "reply", for: to, item: id, path: n.path, line: lineOf(n), text }, from)
  }
  addMoment({ kind: verdict, for: n.agent, item: id, path: n.path, line: n.line, text: verdict === "reply" ? text : n.text, ...(n.kind === "suggestion" ? { selection: n.find, to: n.replace } : {}) }, from)
}

/** The user's answer to a bubble: a reply to it (in the bubble), or closing it; either way it goes. */
function answerSay(n: Note, verdict: string, text: string | undefined, from?: IncomingMessage) {
  if (verdict !== "reply" && verdict !== "dismiss") return
  if (notes.has(n.id)) dropNote(n.id)
  saw([n.id])
  if (verdict === "reply" && !text?.trim()) return
  addMoment({ kind: verdict, for: n.agent, item: n.id, bubble: true, path: n.path, line: n.line, ...(n.find ? { find: n.find } : {}),
    text: verdict === "reply" ? text!.slice(0, MAX_TEXT) : n.text }, from)
}

/** The user saw these bubbles (they showed long enough to read, or the cursor's history opened): no unread dot for them. */
export function saw(ids: string[]) {
  let changed = false
  for (const x of said) if (ids.includes(x.id) && !x.seen) { x.seen = true; changed = true }
  if (changed) broadcast({ t: "said", said })
}

/** A bubble gone before its time, as the user went on writing: no word to its agent. */
function hide(id: string) {
  if (notes.get(id)?.kind === "say") dropNote(id)
}

/** Where a say is in its note's text now: its line (its find nearest it), else null. */
function sayLine(text: string, n: Note) {
  return n.find ? anchorLine(text, n) : n.line ? Math.max(1, Math.min(n.line, lineCount(text))) : null
}

/** Put a bubble in the note, as its agent's words (Provenance): after the paragraph it was said by, else at the end. */
export async function place(id: string) {
  const n = said.find((x) => x.id === id) ?? notes.get(id)
  if (!n || n.kind !== "say" || !n.text?.trim()) throw new OpError(`there's no bubble ${id}`, 404)
  const a = agents.get(key(n.agent)), t: Target = n.path ? n : a?.path ? a : focus() ?? {}
  if (!t.path || drawing(t.path)) throw new OpError("it wasn't said by a note", 409)
  const cur = await textOf(apiCtx, t.path), lines = cur.split("\n")
  let at = sayLine(cur, t as Note)
  if (at !== null) while (at < lines.length && lines[at]?.trim()) at++
  const text = at === null ? n.text.trim() : `\n${n.text.trim()}`
  const writer: Writer = n.writer ?? { client: "cli", agent: n.agent }
  await requestWriter.run(writer, () => applyEdit(apiCtx, agentOf(n.agent), { path: t.path!, text, ...(at === null ? { append: true } : { line: at }) }, false))
  if (notes.has(id)) dropNote(id)
  for (const x of said) if (x.id === id) Object.assign(x, { placed: true, seen: true })
  broadcast({ t: "said", said })
  addMoment({ kind: "move", into: "note", for: n.agent, item: id, path: t.path, line: at === null ? lineCount(cur) + 1 : at + 2, text: n.text })
  return { path: t.path, line: at === null ? lineCount(cur) + 1 : at + 2 }
}

/** What an agent wrote in a note (its lines, taken out by the user's editor) back in a bubble by its cursor there. */
export function fold(name: string, path: string, line: number, text: string) {
  const a = agents.get(key(name))
  if (!a || !text.trim()) throw new OpError(`${name} isn't here to say it`, 404)
  setAgent(a.name, { path, line, find: undefined, x: undefined, y: undefined, state: acting(a.name) })
  const n = putNote({ kind: "say", agent: a.name, text: text.trim(), path, line }, sayMs(text))
  keepSaid(n)
  addMoment({ kind: "move", into: "bubble", for: a.name, item: n.id, path, line, text: text.trim() })
  return n
}

/** A say (or the user's ask) kept in its agent's last ones (the cursor's history): ten of each. */
function keepSaid(n: Note) {
  const mine = said.filter((x) => key(x.agent) === key(n.agent) && (x.kind === "ask") === (n.kind === "ask"))
  said = [...said.filter((x) => !mine.slice(0, -(SAID - 1)).includes(x)), { ...n }]
  broadcast({ t: "said", said })
}

/** Each ask's row in the history, by its moment's seq: one that goes on (dictation's next sentence) rewrites its row. */
const askRows = new Map<number, string>()
/** What the user asked an agent (an ask, a reply to its bubble), kept with its says: the popover shows both. Asks in
 *  a comment's thread stay in the thread. */
function keepAsked(m: Moment) {
  if (!m.for || m.tour || !m.text?.trim() || !((m.kind === "ask" && !m.item) || (m.kind === "reply" && m.bubble))) return
  const id = askRows.get(m.more ?? m.seq) ?? `ask-${m.seq}`, text = m.text.trim()
  askRows.set(m.seq, id)
  if (askRows.size > 200) askRows.delete(askRows.keys().next().value!)
  const n = said.find((x) => x.id === id)
  if (n) { Object.assign(n, { text, t: m.t }); return void broadcast({ t: "said", said }) }
  keepSaid({ id, kind: "ask", by: "user", agent: m.for, text, t: m.t, seen: true, ...(m.path ? { path: m.path, line: m.line } : {}) })
}

/** A dismissed comment back in the margin, as it was. */
export function reopen(id: string) {
  for (const [p, list] of past) {
    const n = list.find((x) => x.id === id)
    if (!n) continue
    const rest = list.filter((x) => x !== n)
    if (rest.length) past.set(p, rest); else past.delete(p)
    const { dismissed: _, ...back } = n
    notes.set(id, back)
    broadcast({ t: "note", note: back })
    save(p)
    return back
  }
  return null
}

/** A say the user pinned: a comment with its words, where it was said (else where its agent is, else the user). */
export function pin(id: string) {
  const s = said.find((n) => n.id === id) ?? notes.get(id)
  if (!s || s.kind !== "say" || s.pinned) return null
  const a = agents.get(key(s.agent))
  const t: Target = s.path ? s : a?.path ? a : focus() ?? {}
  if (!t.path) return null
  if (notes.has(id)) dropNote(id)
  let line = t.line ?? 1
  if (t.find) try { line = anchorLine(readText(plugin.vault.abs(t.path)), t) ?? line } catch { /* as it was said */ }
  const anchor = t.find ? "" : lineText(t.path, line)
  const c = putNote({ kind: "comment", agent: s.agent, text: s.text, path: t.path, line, ...(t.find ? { find: t.find } : {}), ...(anchor ? { anchor } : {}) })
  s.pinned = c.id
  broadcast({ t: "said", said })
  return c
}

plugin.onUnload(() => {
  for (const t of [...timers.values(), ...following.values()]) clearTimeout(t)
  for (const ws of windows.keys()) ws.close()
  for (const wake of waiters.values()) wake([])
  clearInterval(watchdog)
  unhear?.()
  unhear = null
})

// ---------- the app's windows: /api/companion/live

/** Notes open in windows, typed in together (rooms.ts). */
const co = rooms(plugin)
plugin.onChange((paths) => co.changed(paths))
/** The user as others in a note see them (never this machine's login name). */
const OWNER = "Owner"
const YOU: Who = { client: "app/web", agent: null, label: "You", source: "app" }
/** A note a window names, as the vault's path (`./a.md` is `a.md`), or null. */
const notePath = (p: unknown) => { try { return vaultPath(p, false, plugin.vault) } catch { return null } }

/** Notes another machine of the vault shares typed in there, with its guests (bridge.ts). */
const there = bridges(plugin, (ws, m, path) => void co.heard(ws, m, path))
plugin.onUnload(() => there.stop())
const roomMessage = (m: Record<string, unknown>) => typeof m.t === "string" && (m.t.startsWith("y") || m.t === "aw")

/** The desktop app's helper (electron/helper.ts): it draws the agents outside the window, and says what the user asks or
 *  points at on screen; it opens no notes. */
const screens = new Set<WebSocket>()
/** Its steps in other apps (takeover.ts): sent to the helper the ask came from. */
const takeover = takeovers(send, (name, sx, sy) => void resolve(target({ sx, sy }, true), name).then((t) => setAgent(name, { ...t, state: "writing", pointed: Date.now() }), () => {}))
/** The companion's drawing over the screen (drawings.ts). */
const screenDrawing = screenDrawings(plugin, {
  send: (m) => { for (const ws of screens) send(ws, m) },
  locate: (places) => windowRects(places),
  tint: (a) => agentOf(layerOwner(a)).tint,
  elements: (a) => Object.fromEntries((nearBy.get(key(a)) ?? []).map((e) => [`el:${e.id}`, rectOfNear(e)])),
  // (Vaultite's own elements by their data-ui id, found again where they are now: the ask's frames may be stale)
  live: async (a, ids) => {
    const ask = askOf(a), ui = (e: Near) => e.ui
    if (!ask || awayIn([ask])) return {}
    const els = (nearBy.get(key(a)) ?? []).filter((e) => ids.includes(e.id) && ui(e))
    const now = await Promise.all(els.map((e) => windowRects([`ui:${ui(e)}`], { x: e.frame.x + e.frame.width / 2, y: e.frame.y + e.frame.height / 2 }).then((r) => r[`ui:${ui(e)}`])))
    return Object.fromEntries(els.flatMap((e, i) => (now[i] ? [[`el:${e.id}`, { ...now[i], label: e.label }]] : [])))
  },
  find: (a, text) => screenFind(a, text),
  drawn: (a) => (askOf(a)?.ink ?? []).map((k) => ({ x: k.box.x, y: k.box.y, w: k.box.width, h: k.box.height })),
  words: (a) => {
    const asked = moments.findLast((m) => m.for === a && (m.kind === "ask" || m.kind === "point"))?.t ?? 0
    return [...notes.values()].findLast((n) => n.kind === "say" && n.agent === a && n.t >= asked)?.text
  },
  displays: (a) => (screens.size ? displaysOf(layerOwner(a)).map((d) => ({ x: d.x, y: d.y, w: d.width, h: d.height })) : null),
  // (a file of this Mac: where its read-only commands may look)
  media: screenMedia(plugin, { readable: (abs) => READ_ONLY.dirs.some((d) => abs.startsWith(`${d}${path.sep}`)) && !abs.startsWith(`${path.resolve(LOCAL)}${path.sep}`) && !/(^|\/)\.env/.test(abs) }),
})
// ---------- tours (tours.ts): played on the screen of each agent's last ask, without the model

// (a tour of Vaultite's own plays on its window, wherever the last ask was, as a proof does)
const tours = toursOf(plugin, { screen: (name, t) => screenOf(name, { vaultite: !!t && ownTour(t) }), who: (p) => who(p) })
/** The window used last: where a tour over Vaultite plays. */
const lastWindow = () => [...windows.entries()].sort((a, b) => b[1].at - a[1].at)[0]?.[0]
/** A thing as Vaultite's window lists it (tourwindow.ts): `within`, the data-ui around one that has none. */
type Shown = Seen & { within?: string }
/** How the marks up become `next` when only their places changed (the same kinds, in order, each at a box): each one's
 *  move, by id. Null: they differ more than that. */
function glides(up: Mark[], marks: unknown[]) {
  let next: Mark[]
  try { next = checkMarks(marks) } catch { return null }
  if (up.length !== next.length) return null
  const box = (v: unknown) => (v && typeof v === "object" && "x" in v && "w" in v ? v as ScreenRect : null)
  const out: { mark: string; dx: number; dy: number }[] = []
  for (const [i, m] of up.entries()) {
    const n = next[i], a = "at" in m ? box(m.at) : null, b = "at" in n ? box(n.at) : null
    if (!m.id || m.type !== n.type || !a || !b || Math.abs(a.w - b.w) > 4 || Math.abs(a.h - b.h) > 4) return null
    out.push({ mark: m.id, dx: b.x - a.x, dy: b.y - a.y })
  }
  return out
}
/** A job's proof showing (proofs.ts): its narration said aloud or not, and the displays its helper said it has. */
let shown: { t: number; voice: boolean; displays: ScreenRectLike[] } | null = null
type ScreenRectLike = { x: number; y: number; width: number; height: number }
/** Where agent `name`'s marks can show: its last ask's displays, else those of a proof being shown. */
function displaysOf(name: string): ScreenRectLike[] {
  const asked = askOf(name)?.displays ?? []
  return asked.length ? asked : shown?.displays ?? []
}
/** A step's before picture flipping with how its thing is now (a proof's): its layer, and the flips still to come. */
let flipping: { layer: string; timers: ReturnType<typeof setTimeout>[] } | null = null
function stopFlips() {
  if (!flipping) return
  for (const t of flipping.timers) clearTimeout(t)
  screenDrawing.clear({ agent: flipping.layer })
  flipping = null
}
/** Picture `src` laid over `at` (screen points) on agent `name`'s before layer, then flipped: before, now, before, now. */
async function flip(name: string, src: string, at: { x: number; y: number; width: number; height: number }) {
  stopFlips()
  const layer = beforeLayer(name)
  try {
    await screenDrawing.draw(layer, [{ type: "image", src, at: [at.x, at.y, at.width, at.height], over: true, caption: "Before", life: "dismiss" }])
  } catch (e) { return void console.error(`companion: a before picture didn't show: ${(e as Error).message}`) }
  const mine: NonNullable<typeof flipping> = { layer, timers: [] }
  mine.timers = FLIPS.map(([ms, on]) => setTimeout(() => { if (flipping === mine) screenDrawing.toggle(layer, on) }, ms))
  flipping = mine
}
/** A tour of Vaultite's own (its app, or none named): it plays on Vaultite's window. */
const ownTour = (t: Pick<Tour, "app" | "site">) => !t.site.length && (!t.app.length || t.app.includes("vaultite"))
/** Agent `name`'s screen for a tour: the app its last ask was over (the Mac's helper reads it), else Vaultite's window
 *  (`vaultite`: that window whatever the ask was over, as a proof of Vaultite's own). */
function screenOf(name: string, o: { vaultite?: boolean } = {}): Screen | null {
  const ask = askOf(name), away = ask && !o.vaultite ? awayIn([ask]) : ""
  if (away === "a private app") return null
  const call = (op: string, p: Record<string, unknown>) => plugin.host.call(op, { ...p, ...(isMain(name) ? {} : { as: name }) }, AS_TOOL, { report: "companion tour" })
  const mid = (s: Seen) => ({ sx: Math.round(s.frame.x + s.frame.width / 2), sy: Math.round(s.frame.y + s.frame.height / 2) })
  const spot = (s: Seen): Spot => ({ sx: s.frame.x, sy: s.frame.y, w: s.frame.width, h: s.frame.height })
  const sayIt = async (text: string) => { await call("companion.say", { text }) }
  /** Draw's marks for a step's, at the frames found (a point is its cursor's, not a mark). */
  const drawnOf = (marks: Parameters<Screen["show"]>[1]) => marks.filter((m) => m.at).flatMap((m) => {
    const x = m.kind === "point" ? null : markOf({ kind: m.kind as Tag["kind"], at: spot(m.at!), ...(m.to ? { to: spot(m.to) } : {}), ...(m.label ? { label: m.label } : {}), ...(m.n !== undefined ? { n: m.n } : {}), ...(m.dir ? { dir: m.dir } : {}), offset: 0 })
    return x ? [x] : []
  })
  const overScreen = () => screens.size > 0 && displaysOf(name).length > 0
  let drewCard = false
  async function show(text: string, marks: Parameters<Screen["show"]>[1], before?: string, draw?: Record<string, unknown>[]) {
    stopFlips()
    // (a step's own drawing goes as the next step comes; its cards, unless they say, stay till their next ask)
    if (drewCard) { drewCard = false; screenDrawing.clear({ agent: name }) }
    const placed = marks.filter((m) => m.at)
    if (draw?.length) {
      drewCard = true
      const at = drawnOf(placed), point = placed.find((m) => m.kind === "point")
      if (point) await call("companion.look", mid(point.at!))
      return void await call("companion.draw", { marks: [...at, ...draw.map((d) => ({ life: "ask", ...d }))], ...(text ? { say: text } : {}) })
    }
    // (its picture before over its first thing, as it is now, while its words are said)
    if (before && overScreen() && placed[0]) void flip(name, before, placed[0].at!.frame)
    if (overScreen() && placed.length) {
      // (over the screen: marks at the frames found, a point its cursor there)
      const drawn = drawnOf(placed)
      const point = placed.find((m) => m.kind === "point")
      if (point) await call("companion.look", mid(point.at!))
      if (drawn.length) return void await call("companion.draw", { marks: drawn, ...(text ? { say: text } : {}) })
      if (text) await call("companion.say", { text, ...(point ? mid(point.at!) : {}) })
      return
    }
    // (in Vaultite's window: its cursor and bubble at the thing, by its data-ui id, else its words in the UI around it)
    const places = placed.flatMap((m) => { const s = m.at as Shown; return s.ui ? [{ ui: s.ui }] : s.within ? [{ ui: s.within, find: s.label }] : [] })
    for (const p of places.slice(1)) await call("companion.highlight", p).catch(() => {})
    if (text) await call("companion.say", { text, ...(places[0] ?? {}) })
    else if (places[0]) await call("companion.look", places[0])
  }
  async function act(d: Parameters<Screen["act"]>[0], at: Seen | null) {
    try {
      if (away) {
        const step = d.action === "click" ? { action: "click" } : d.action === "type" ? { action: "type", value: d.value ?? "" } : d.action === "press" ? { action: "press", key: d.key } : { action: "scroll", direction: d.dir ?? "down" }
        const r = (await call("companion.act", { ...step, ...(at ? mid(at) : {}) })).result as { ok?: boolean; text?: string }
        return r?.ok === false ? { ok: false, why: r.text ?? "it didn't work" } : { ok: true }
      }
      if (d.action !== "click") return { ok: false, why: `in Vaultite's own UI it only clicks: ${d.action} isn't something it can do there, so the user does it` }
      const s = at as Shown | null
      if (!s) return { ok: false, why: "nothing to click: name it by its words" }
      const r = (await call("companion.act", { action: "click", ...(s.ui ? { ui: s.ui } : { ...(s.within ? { ui: s.within } : {}), find: s.label }) })).result as { ok?: boolean; saw?: string }
      return r?.ok === false ? { ok: false, why: r.saw ?? "it didn't work" } : { ok: true }
    } catch (e) { return { ok: false, why: (e as Error).message } }
  }
  /** The step as an ask of its model's (the summoned session's, else its own), where the last ask was: whether it said or showed something. */
  async function fallback(tour: Parameters<Screen["fallback"]>[0], step: Parameters<Screen["fallback"]>[1], missing: string[]) {
    const t0 = Date.now(), last = askOf(name)
    const place = Object.fromEntries((["app", "window", "title", "sx", "sy", "path", "line", "pane", "ui", "url", "displays"] as const).flatMap((k) => (last?.[k] !== undefined ? [[k, last[k]]] : [])))
    const text = `(A step of their tour "${tour.title}", played for them, not their words. Step ${step.n}: ${step.text}\nNot found on their screen now: ${missing.map((x) => JSON.stringify(x)).join(", ")}. Say this step yourself, its tag on that thing as it shows now; if it isn't there, tell them so in a few words.)`
    const m = addMoment({ kind: "ask", for: name, summoned: true, tour: true, text, ...place })
    if (!m) return false
    const spoke = () => [...notes.values(), ...said].some((n) => n.kind === "say" && key(n.agent) === key(name) && n.t >= t0) || (agents.get(key(name))?.pointed ?? 0) >= t0
    const busy = () => (lane().takes(m) ? lane().busy() : turning.has(key(name)))
    let began = false
    for (const end = t0 + 90_000; Date.now() < end;) {
      await new Promise((ok) => setTimeout(ok, 300))
      if (busy()) began = true
      else if (began || spoke()) break
    }
    return spoke()
  }
  const inputs = (on: boolean) => { for (const ws of [...windows.keys(), ...screens]) send(ws, { t: "inputs", on }) }
  /** Its marks drawn again where their things are now, unsaid; one off screen left out till it's back. In Vaultite's
   *  window without the helper's drawing, the bubble finds its place again by itself. */
  async function follow(marks: Parameters<Screen["show"]>[1]) {
    if (!overScreen()) return
    const drawn = drawnOf(marks), up = screenDrawing.layer(name), moves = up && glides(up.marks.filter((m) => !m.gone), drawn)
    // (the same marks, their things moved: each glides there, not drawn again)
    if (up && moves) return void screenDrawing.moved(up.id, moves)
    screenDrawing.clear({ agent: name })
    if (drawn.length) await call("companion.draw", { marks: drawn }).catch(() => {})
  }
  if (away) {
    if (!screens.size) return null
    const site = sitesOf(ask!)[0]
    const read = async () => { const r = await takeover.things(); return r.ok ? r.things ?? [] : null }
    return {
      things: async () => { const t = await read(); return t && { where: { app: ask!.app, ...(site ? { site } : {}) }, things: t } },
      holds: async (c, before) => { const t = await read(); return !!t && checkOn(c, listView(t), before).ok },
      snapshot: async () => listView((await read()) ?? []).snapshot(),
      show, say: sayIt, act, fallback, inputs, ...(overScreen() ? { follow } : {}),
    }
  }
  if (!lastWindow()) return null
  const fromWindow = async <T,>(m: object): Promise<T | null> => {
    const ws = lastWindow(), reply: Record<string, unknown> = {}
    if (!ws) return null
    return (await askWindow(ws, m, 3000, reply).catch(() => false)) ? reply as T : null
  }
  return {
    things: async () => {
      const r = await fromWindow<{ window?: Rect; things?: Shown[] }>({ t: "things" })
      return r?.things ? { where: { app: "vaultite", ...(r.window ? { window: r.window } : {}) }, things: r.things } : null
    },
    holds: async (c, before) => (await fromWindow<{ verdict?: Verdict }>({ t: "check", condition: c, ...(before !== undefined ? { before } : {}) }))?.verdict?.ok === true,
    snapshot: async () => (await fromWindow<{ snapshot?: string }>({ t: "snapshot" }))?.snapshot ?? "",
    show, say: sayIt, act, fallback, inputs, ...(overScreen() ? { follow } : {}),
  }
}
const rectOfNear = (e: Near): ScreenRect => ({ x: e.frame.x, y: e.frame.y, w: e.frame.width, h: e.frame.height, label: e.label })
/** Where the window used last has `places` now (locate.ts), in screen points; words found nearest `near`. */
async function windowRects(places: string[], near?: { x: number; y: number }): Promise<Record<string, ScreenRect & { q?: number }>> {
  const ws = [...windows.entries()].sort((a, b) => b[1].at - a[1].at)[0]?.[0], reply: { rects?: Record<string, ScreenRect & { q?: number }> } = {}
  if (ws) await askWindow(ws, { t: "locate", places, ...(near ? { near } : {}) }, 3000, reply).catch(() => false)
  return reply.rects ?? {}
}
/** Where words show now on the screen of agent `a`'s last ask (screen points): over another app, its element or the app's
 *  (Accessibility); over Vaultite, its window's and its web pages', the best nearest what they drew or pointed at. */
async function screenFind(a: string, text: string): Promise<ScreenRect | null> {
  const ask = askOf(a), near = byLabel(nearBy.get(key(a)) ?? [], text)
  if (awayIn([ask].filter((m) => !!m)) || (openedFor.has(key(a)) && openedFor.get(key(a)) === ask)) {
    if (near) return rectOfNear(near)
    const r = await takeover.find(text)
    return r.ok && r.found ? rectOfNear(r.found) : null
  }
  const pointer = ask?.sx !== undefined && ask.sy !== undefined ? { x: ask.sx, y: ask.sy } : undefined
  const by = ask?.ink?.length ? ask.ink.map((k) => ({ x: k.box.x, y: k.box.y, w: k.box.width, h: k.box.height })) : pointer ? [{ ...pointer, w: 0, h: 0 }] : []
  const [here, pages] = await Promise.all([windowRects([`find:${text}`, "pages"], pointer), pageFinds(a, text)])
  const found: Found[] = here[`find:${text}`] ? [{ q: 2, ...here[`find:${text}`] }] : []
  for (const p of pages) {
    const box = here[`page:${p.pane}`]
    for (const r of box ? p.found : []) {
      const at = { x: Math.round(box.x + r.x * p.zoom), y: Math.round(box.y + r.y * p.zoom), w: Math.round(r.w * p.zoom), h: Math.round(r.h * p.zoom), q: r.q }
      if (at.x < box.x + box.w && at.y < box.y + box.h && at.x + at.w > box.x && at.y + at.h > box.y) found.push(at)
    }
  }
  const best = bestFound(found, by)
  if (best) return { x: best.x, y: best.y, w: best.w, h: best.h }
  // (nothing there now: the element the ask came with, as it was)
  return near ? rectOfNear(near) : null
}
/** Where the web pages shown in the user's window say `text` (their viewport's CSS px, a CSS px `zoom` points). */
async function pageFinds(name: string, text: string) {
  const tabs = await plugin.desktop("agent:tabs", { name, session: "", task: "", summary: "", remote: false }).catch(() => []) as (BrowserTab & { shown?: boolean })[]
  const shown = tabs.filter((t) => t.pane && t.shown && t.access !== "none" && !privatePage(t.url, t.container)).slice(0, 8)
  const late = <T,>(ms: number) => new Promise<T>((_ok, no) => setTimeout(() => no(new Error("late")), ms))
  const each = await Promise.all(shown.map((t) => Promise.race([plugin.desktop("agent:find", t.tab, text), late(1500)])
    .then((r) => ({ pane: t.pane!, ...(r as { zoom: number; found: Found[] }) }), () => null)))
  return each.filter((x): x is NonNullable<typeof x> => !!x && Array.isArray(x.found) && Number.isFinite(x.zoom))
}
const SCREEN_NEWS = new Set(["state", "agent", "note", "drop", "said", "hush"])
/** The helper the user last spoke to or answered a knock on: where Still broken records. */
let lastScreen: WebSocket | null = null
const toScreens = (m: object) => { const text = JSON.stringify(m); for (const ws of screens) if (ws.readyState === ws.OPEN) ws.send(text) }
/** A screen moment's place, from what the helper sent: an app's window, never a path. */
/** Only the helper's own pictures: an agent reads what's named here. */
const OWN_SHOT = /[/\\]screens[/\\](window-\d+-\d+|display-\d+-\d+)\.png$/
function screenPlace(m: Record<string, unknown>) {
  const shot = str(m.shot), down = str(m.shotDown), window = Number(m.window), sx = Number(m.sx), sy = Number(m.sy)
  const rect = (r: unknown): Rect | null => { const o = (r ?? {}) as Record<string, unknown>, v = [o.x, o.y, o.width, o.height].map(Number); return v.every(Number.isFinite) ? { x: Math.round(v[0]), y: Math.round(v[1]), width: Math.round(v[2]), height: Math.round(v[3]) } : null }
  const near = Array.isArray(m.near) ? m.near.slice(0, 40).flatMap((e: Record<string, unknown>) => { const t = thingFrom(e); return t?.id ? [t as Near] : [] }) : []
  const ink = Array.isArray(m.ink) ? m.ink.slice(0, 12).flatMap((k: Record<string, unknown>) => { const b = rect(k?.box); return b ? [{ shape: str(k.shape).slice(0, 20), box: b,
    points: (Array.isArray(k.points) ? k.points : []).slice(0, 40).map((p: unknown) => (Array.isArray(p) ? [Math.round(Number(p[0])), Math.round(Number(p[1]))] : [0, 0]) as [number, number]) }] : [] }) : []
  const floating = Array.isArray(m.floating) ? m.floating.slice(0, 6).flatMap((w: Record<string, unknown>) => { const f = rect(w?.frame)
    return f && str(w.app) ? [{ app: str(w.app).slice(0, 200), name: str(w.name).slice(0, 120), frame: f }] : [] }) : []
  const clicks = Array.isArray(m.clicks) ? m.clicks.slice(0, 8).flatMap((c: Record<string, unknown>) => { const x = Number(c?.sx), y = Number(c?.sy)
    return Number.isFinite(x) && Number.isFinite(y) ? [{ sx: Math.round(x), sy: Math.round(y), ...(str(c.under) ? { under: str(c.under).slice(0, 300) } : {}) }] : [] }) : []
  const at = rect(m.shotAt), displays = Array.isArray(m.displays) ? m.displays.slice(0, 8).map(rect).filter((d): d is Rect => !!d && d.width > 0 && d.height > 0) : []
  return { ...(str(m.app) ? { app: str(m.app).slice(0, 200), ...(str(m.appName) ? { appName: str(m.appName).slice(0, 120) } : {}) } : {}), ...(Number.isInteger(window) && window > 0 ? { window } : {}), ...(Number.isInteger(Number(m.shotWindow)) && Number(m.shotWindow) > 0 ? { shotWindow: Number(m.shotWindow) } : {}), ...(str(m.title) ? { title: str(m.title).slice(0, 300) } : {}),
    ...(str(m.screen) ? { screen: str(m.screen).slice(0, 20_000) } : {}), ...(str(m.under) ? { under: str(m.under).slice(0, 700) } : {}),
    ...(Number.isFinite(sx) && Number.isFinite(sy) && m.sx !== undefined && m.sy !== undefined ? { sx: Math.round(sx), sy: Math.round(sy) } : {}),
    ...(OWN_SHOT.test(shot) ? { shot, ...(at ? { shotAt: at } : {}) } : {}),
    ...(OWN_SHOT.test(down) && OWN_SHOT.test(shot) ? { shotDown: down, ...(rect(m.shotDownAt) ? { shotDownAt: rect(m.shotDownAt)! } : {}) } : {}),
    ...(str(m.notices) ? { notices: str(m.notices).slice(0, 1200) } : {}),
    ...(near.length ? { near } : {}), ...(ink.length ? { ink } : {}), ...(floating.length ? { floating } : {}), ...(displays.length ? { displays } : {}), ...(rect(m.region) ? { region: rect(m.region)! } : {}),
    ...(clicks.length ? { clicks } : {}) }
}
/** What the last ask on screen found near the pointer, by agent: what `--ax` points at. */
const nearBy = new Map<string, Near[]>()
/** Its cursor off the screen, done there (the helper's: its exchange over, idle a while): back to the user's note while
 *  it's on screen, else home (one in a tab behind would send it to a file's row or a list's edge, far from them). */
export function comeBack(name: string) {
  if (!agents.has(key(name))) return
  const w = [...windows.values()].sort((a, b) => b.at - a.at).find((x) => x.focus), f = w?.focus?.path && w.shown.includes(w.focus.path) ? w.focus : null
  setAgent(name, { ...Object.fromEntries(PLACE_KEYS.map((k) => [k, undefined])), ...(f?.path ? { path: f.path, line: f.line } : {}) }, true)
}
/** What the user did on screen, as the helper says it: an ask, or a point (no words). Over Vaultite's own window, it
 *  says what's there as the page knows it too (a note's line, a pane's row, the app's UI), asked as one asked there. */
export function screenMoment(m: Record<string, unknown>, req?: IncomingMessage) {
  if (m.kind !== "ask" && m.kind !== "point") return null
  const place = screenPlace(m)
  // (a point where nothing can be read, as the menu bar: still there, with its picture)
  if (!place.app && place.sx === undefined) return null
  // (none this time: the last ask's ids are gone too, never pointed at on another screen)
  nearBy.set(key(str(m.agent) || ownName()), place.near ?? [])
  // (the Talk key let go `keyUp`: its words finished and what's there gathered since, as its pause)
  const up = Number(m.keyUp), waited = Number.isFinite(up) ? Date.now() - up : NaN
  const talk = Array.isArray(m.talk) ? m.talk.slice(-8).map((x) => str(x).slice(0, 300)).filter(Boolean) : []
  const asked = { summoned: true as const, ...(m.voice === true ? { voice: true } : {}), ...(waited >= 0 && waited < 60_000 ? { waited: Math.round(waited) } : {}),
    ...(m.front === "realtime" ? { front: "realtime" as const, ...(talk.length ? { talk } : {}) } : {}) }
  if (!place.app && (str(m.pane) || str(m.ui))) {
    const { under: _, title: __, ...seen } = place
    return void paneMoment({ ...m, summoned: true }, req, { ...seen, ...asked })
  }
  if (!place.app && str(m.path)) {
    const selection = str(m.selection).slice(0, 4000) || undefined
    return addMoment({ kind: m.kind, for: str(m.agent) || undefined, path: str(m.path), line: Number(m.line) || undefined, text: str(m.text) || undefined, ...(selection ? { selection } : {}),
      ...(m.kind === "point" && str(m.find) ? { find: str(m.find).slice(0, 200) } : {}), ...place, ...asked }, req)
  }
  return addMoment({ kind: m.kind, for: str(m.agent) || undefined, text: str(m.text) || undefined, ...place, ...asked }, req)
}
/** Each helper's realtime voice, paused (the account can't pay, or its key is refused) and why. */
const realtimePaused = new Map<WebSocket, { account: string; why: string; until: number } | null>()
const pausedNow = () => [...realtimePaused.values()].find((p) => p && p.until > Date.now()) ?? null
/** The mic each helper hears with, and why (electron/miclogic.ts): for its status. */
const mics = new Map<WebSocket, string>()
/** Each Mac's call, as its helper hears it (electron/calllogic.ts): its voice keeps quiet meanwhile. */
const calls = new Map<WebSocket, string>()
/** What the realtime voice answered alone (small talk): their words and its, kept as an ask and a say. `withdraw`: the
 *  summoned session was asked it too (as the realtime voice listened): its turn stops, and what it said goes. */
function screenAnswered(m: Record<string, unknown>) {
  const name = str(m.agent) || ownName(), heard = str(m.heard).trim().slice(0, 2000), words = str(m.said).trim().slice(0, 2000)
  if (!words || mode() === "off") return
  const t = Date.now()
  const asks = m.withdraw === true && isMain(name) ? lane().withdraw() : []
  // (the talk's log: the summoned answer withdrawn and these words said instead, or small talk the voice answered alone)
  if (asks.length) { did(name, "withdrawn", asks.map((x) => x.seq)); acts.append(t, [{ t, as: name, op: "say", text: words }]) }
  else did(name, "talked", undefined, JSON.stringify({ heard, said: words }))
  if (asks.length) {
    // (their ask stays, as it came; what the summoned session said of it goes)
    const ts = new Set(asks.map((x) => x.t)), theirs = (n: Note) => n.kind === "say" && key(n.agent) === key(name) && !!n.answers && ts.has(n.answers.t)
    for (const n of [...notes.values()].filter(theirs)) dropNote(n.id)
    if (said.some(theirs)) { said = said.filter((n) => !theirs(n)); broadcast({ t: "said", said }) }
  } else if (heard) keepSaid({ id: `ask-rt-${t}`, kind: "ask", by: "user", agent: name, text: heard, t, seen: true })
  keepSaid(putNote({ kind: "say", agent: name, text: words, seen: true, answers: { t, realtime: true } }, sayMs(words)))
}
function screenSocket(ws: WebSocket, req: IncomingMessage) {
  screens.add(ws)
  send(ws, snapshot())
  for (const m of screenDrawing.messages()) send(ws, m)
  send(ws, { t: "jobs", jobs: jobs.cards() })
  knocks.hello()
  ws.on("message", (data: RawData) => {
    let m: Record<string, unknown>
    try { m = JSON.parse(String(data)) } catch { return }
    if (takeover.message(ws, m)) return
    // (a wait listening: what they click and type in other apps)
    if (m.t === "input") return void tours.input(m)
    // (a bubble over the screen clicked away)
    if (m.t === "hide" && typeof m.id === "string") return void hide(m.id)
    if (m.t === "home" && typeof m.agent === "string") return void comeBack(m.agent)
    // (its Talk key pressed: its summoned session made ready while they speak)
    if (m.t === "summoning") return void lane().warm()
    // (pressed again, or Esc, mid-answer: its summoned turn stops where it is, so the next ask isn't kept waiting)
    // (its take-over's offer up: the press is their answer to it)
    if (m.t === "interrupt") return void (takeover.offering(ws) || bargeIn())
    // (who rides with their pointer: the windows draw no cursor of its meanwhile)
    if (m.t === "riding") return void ride(ws, str(m.agent).slice(0, 80))
    // (a job opened from the menu bar: no longer news)
    if (m.t === "job-seen" && Array.isArray(m.ids)) return void jobs.seen(m.ids.filter((x): x is string => typeof x === "string").slice(0, 30))
    // (a cursor's conversation opened over the screen: its says seen)
    if (m.t === "saw" && Array.isArray(m.ids)) return void saw(m.ids.filter((x): x is string => typeof x === "string").slice(0, 100))
    if (m.t === "knock" || m.t === "moment") lastScreen = ws
    if (m.t === "knock") return void knocks.heard(m)
    if (m.t === "drawing-act") return void drawingAct(m, req)
    if (m.t === "moment" && !takeover.heard(ws, m)) screenMoment(m, req)
    if (m.t === "answered") screenAnswered(m)
    // (its realtime voice paused, and why, or back: for its status)
    if (m.t === "mic") mics.set(ws, str(m.mic).slice(0, 300))
    if (m.t === "call") { if (str(m.call)) calls.set(ws, str(m.call).slice(0, 120)); else calls.delete(ws) }
    if (m.t === "realtime") { const p = m.paused as Record<string, unknown> | null; realtimePaused.set(ws, p && typeof p === "object" ? { account: str(p.account), why: str(p.why).slice(0, 300), until: Number(p.until) || 0 } : null) }
  })
  ws.on("close", () => { screens.delete(ws); realtimePaused.delete(ws); mics.delete(ws); calls.delete(ws); takeover.closed(ws); ride(ws, "") })
}
/** The summoned session's turn stopped (its Talk key pressed again, Esc): only it, never the long session's. */
function bargeIn() {
  if (!lane().busy()) return
  const name = ownName()
  stopStreams(name)
  void lane().interrupt().then((ok) => { if (ok) did(name, "stopped") }, () => {})
}
/** Each helper's agent riding with the pointer over the screen (its Talk key's exchange); `riding()` the one now. */
const ridingBy = new Map<WebSocket, string>()
const riding = () => [...ridingBy.values()].find(Boolean) ?? ""
function ride(ws: WebSocket, agent: string) {
  const was = riding()
  if (agent) ridingBy.set(ws, agent); else ridingBy.delete(ws)
  if (riding() === was) return
  // (its exchange over: what it answered there was said by the pointer or in its box, so seen, never a bubble after,
  // where its cursor goes next; a late answer still comes as one)
  const there = was ? [...notes.values()].filter((n) => n.kind === "say" && n.answers && key(n.agent) === key(was)).map((n) => n.id) : []
  for (const id of there) dropNote(id)
  saw(there)
  broadcast({ t: "riding", agent: riding() })
}

/** What the user pressed on a layer over the screen (Clear, Keep, a card's ×, a button's next step: an ask by where it
 *  is), or what the helper saw of it: its exchange over (settle), the screen under it changed. */
function drawingAct(m: Record<string, unknown>, req: IncomingMessage) {
  if (m.kind === "changed" && Array.isArray(m.marks)) return void screenDrawing.changed(str(m.id), m.marks.filter((x): x is string => typeof x === "string"))
  if (m.kind === "moved" && Array.isArray(m.moves)) return void screenDrawing.moved(str(m.id), m.moves.flatMap((x) => (x && typeof x === "object" && typeof x.mark === "string" && typeof x.dx === "number" && typeof x.dy === "number" ? [{ mark: x.mark, dx: x.dx, dy: x.dy }] : [])))
  const d = screenDrawing.byId(str(m.id))
  if (!d) return
  if (m.kind === "clear") return void screenDrawing.clear({ id: d.id })
  if (m.kind === "settle") return void screenDrawing.settle(d.agent)
  if (m.kind === "dismiss" && typeof m.mark === "string") return void screenDrawing.dismiss(d.id, m.mark)
  if (m.kind === "keep") return void plugin.runOp("companion.save-drawing", { id: d.id, places: m.places ?? {} }, YOU, req).catch((e) => console.error(`companion: keep: ${(e as Error).message}`))
  const a = agents.get(key(d.agent)), r = spots(d.marks).map((s) => rectOf(s, d.places)).find(Boolean)
  if (m.kind === "ask" && str(m.text)) addMoment({ kind: "ask", for: d.agent, text: str(m.text).slice(0, 2000), ...(a?.app ? { app: a.app } : {}),
    ...(r ? { sx: Math.round(r.x + r.w / 2), sy: Math.round(r.y + r.h / 2) } : a?.sx !== undefined ? { sx: a.sx, sy: a.sy } : {}) }, req)
}

plugin.socket("companion/live", (ws, req, { query }) => {
  if (query.screen === "1") return screenSocket(ws, req)
  co.add(ws, { who: YOU, name: OWNER, tint: "red", edits: true, see: (rel) => rel })
  // (another machine's server, for its windows: only the rooms, and never sent on again)
  if (query.rooms === "1") {
    ws.on("message", (data: RawData) => {
      let m: Record<string, unknown>
      try { m = JSON.parse(String(data)) } catch { return }
      if (roomMessage(m)) co.heard(ws, m, notePath(m.path))
    })
    return
  }
  windows.set(ws, { open: [], shown: [], focus: null, at: 0, panes: [] })
  there.add(ws)
  send(ws, snapshot())
  ws.on("message", (data: RawData) => {
    let m: Record<string, unknown>
    try { m = JSON.parse(String(data)) } catch { return }
    if (roomMessage(m)) {
      const path = notePath(m.path)
      if (path && /\.md$/i.test(path) && there.heard(ws, m, path)) return
      if (co.heard(ws, m, path)) return
    }
    const w = windows.get(ws)
    if (!w) return
    if (m.t === "input") return void tours.input(m)
    if (m.t === "where") {
      w.open = Array.isArray(m.open) ? m.open.filter((p): p is string => typeof p === "string") : w.open
      w.shown = Array.isArray(m.shown) ? m.shown.filter((p): p is string => typeof p === "string") : w.shown
      const f = m.focus as Target | null
      // (an editor left for the terminal or a menu: still their note while it's open)
      w.focus = f && typeof f.path === "string" ? { path: f.path, ...(drawing(f.path) ? point(f as Record<string, unknown>) : { line: Number(f.line) || 1 }) } : w.focus && w.open.includes(w.focus.path!) ? w.focus : null
      // (a private note: the agents don't know they're there)
      if (w.focus?.path && hidden(w.focus.path)) w.focus = null
      if (m.active) w.at = Date.now()
      // (another note, not the same one focused again)
      if (w.focus && m.active && w.focus.path !== w.was) { w.was = w.focus.path; addMoment({ kind: "open", ...w.focus }) }
      if (Array.isArray(m.panes)) w.panes = panesFrom(m.panes)
      // (a job's tab on screen: seen)
      const shownJobs = m.active && w.panes.length ? jobs.cards().filter((j) => j.unseen && w.panes.some((x) => x.to === j.link)) : []
      if (shownJobs.length) jobs.seen(shownJobs.map((j) => j.id))
      w.pane = str(m.pane) || undefined
      // (awareness, in pair: the pane they went to that isn't a note, by its title; a private page's never)
      const pn = w.panes.find((x) => x.id === w.pane), kind = pn && paneSource(pn.to).kind
      if (pn && m.active && pn.id !== w.told && kind !== "note" && !privatePane(pn)) { w.told = pn.id; addMoment({ kind: "open", pane: pn.id, title: pn.title, ...(kind === "site" ? { url: paneSource(pn.to).url } : {}) }) }
      else if (kind === "note") w.told = pn!.id
    } else if (m.t === "moment" && (m.kind === "ask" || m.kind === "point" || m.kind === "change") && (str(m.pane) || str(m.ui)) && !str(m.path)) {
      // (an ask or a point on a pane or the app's UI, or a change in UI it follows: the window says what's there)
      w.at = Date.now()
      void paneMoment(m, req)
    } else if (m.t === "moment" && typeof m.kind === "string" && ["ask", "point", "edit"].includes(m.kind)) {
      w.at = Date.now()
      addMoment({ kind: m.kind as Moment["kind"], for: str(m.agent) || undefined, path: str(m.path) || undefined, line: Number(m.line) || undefined, text: str(m.text) || undefined,
        selection: str(m.selection) || undefined, find: m.kind === "point" || str(m.scene) ? str(m.find).slice(0, 200) || undefined : undefined,
        hunks: Array.isArray(m.hunks) ? (m.hunks as Hunk[]).slice(0, 40) : undefined,
        ...(Number(m.waited) >= 0 ? { waited: Math.min(600_000, Math.round(Number(m.waited))) } : {}), ...point(m),
        ...(Array.isArray(m.changes) ? { changes: m.changes.map(String).slice(0, 40) } : {}), ...(str(m.scene) ? { scene: str(m.scene).slice(0, 20_000) } : {}) }, req)
    } else if (m.t === "pin" && typeof m.id === "string") {
      pin(m.id)
    } else if (m.t === "seen" && Array.isArray(m.ids)) {
      saw(m.ids.filter((x): x is string => typeof x === "string"))
    } else if (m.t === "hide" && typeof m.id === "string") {
      hide(m.id)
    } else if (m.t === "reopen" && typeof m.id === "string") {
      reopen(m.id)
    } else if (m.t === "answer" && typeof m.id === "string" && ["accept", "reject", "dismiss", "reply"].includes(String(m.verdict))) {
      answer(m.id, m.verdict as "accept", str(m.text) || undefined, req)
    } else if (m.t === "review" && typeof m.id === "string" && (m.verdict === "accept" || m.verdict === "reject")) {
      void review(m.id, m.verdict, str(m.change) || undefined, req).catch((e) => console.error(`companion: ${(e as Error).message}`))
    } else if (m.t === "comment") {
      const c = personComment({ by: "user", agent: "" }, str(m.path), m), to = c && mentioned(c.text!)
      if (c && to) askIn(c, to, str(m.selection).slice(0, 20_000), req)
    } else if (m.t === "done" && typeof m.rid === "string") {
      asked.get(m.rid)?.done(m.ok === true, str(m.error) || undefined, m)
    }
  })
  ws.on("close", () => {
    windows.delete(ws)
    // (gone mid-edit: what it was asked fails now, not when its wait runs out, and the note's turn is free)
    for (const x of [...asked.values()]) if (x.ws === ws) x.done(false, "the window showing it closed as it was typed: read it again before another change")
  })
})

// ---------- panes: what the windows show besides notes (terminals, web pages), pointed at and followed

/** Panes as a window says them, checked. */
function panesFrom(v: unknown[]): Pane[] {
  return v.slice(0, 300).flatMap((x) => {
    const p = (x ?? {}) as Record<string, unknown>
    return typeof p.id === "string" && typeof p.to === "string" ? [{ id: p.id, to: p.to, title: str(p.title).slice(0, 200), ...(str(p.tab) ? { tab: str(p.tab) } : {}), ...(str(p.group) ? { group: str(p.group) } : {}) }] : []
  })
}
/** Every pane the windows show, the latest window's first (an id once). */
export function allPanes(): Pane[] {
  const out = new Map<string, Pane>()
  for (const w of [...windows.values()].sort((a, b) => b.at - a.at)) for (const p of w.panes) if (!out.has(p.id)) out.set(p.id, p)
  return [...out.values()]
}
const paneById = (id?: string) => (id ? allPanes().find((p) => p.id === id) : undefined)
/** A pane it never sees: a private note's, or a private site's. */
function privatePane(p: Pane) {
  const x = paneSource(p.to)
  return x.kind === "note" ? hidden(x.path!) : x.kind === "site" ? privatePage(x.url!) : false
}
/** Where the user is when it isn't a note: the focused pane of the window they used last (never a private one). */
export const paneFocus = () => { const w = [...windows.values()].sort((a, b) => b.at - a.at)[0], p = w && paneById(w.pane); return p && !privatePane(p) ? p : null }
/** What the user looks at beyond the note, as a moment's head says it: their pane (a terminal, a page) and, from the
 *  helper, the app in front. Metadata only. */
function awareness() {
  const p = paneFocus(), x = p && paneSource(p.to), front = (plugin.service("screen:front") as (() => { name?: string; title?: string } | null) | null)?.()
  return [x && x.kind !== "note" ? `They're looking at "${p.title}" (pane ${p.id}, ${x.kind === "site" ? `a web page, ${x.url}` : x.kind === "terminal" ? "a terminal" : "a view"}).` : "",
    front?.name ? `The app in front: ${front.name}${front.title ? `, "${front.title}"` : ""}.` : ""].filter(Boolean).join(" ")
}

/** The browser tab showing pane `id` (the engine lists the window's tab with each page), or null. */
type BrowserTab = { tab: number; url: string; title: string; container: string | null; access: string; pane?: string }
async function pageOf(id: string, name = ownName()): Promise<BrowserTab | null> {
  const tabs = await plugin.desktop("agent:tabs", { name, session: "", task: "", summary: "", remote: false }).catch(() => []) as BrowserTab[]
  return tabs.find((t) => t.pane === id) ?? null
}
/** A pane's page as the companion may use it: there, not private, its container letting agents `need` (read, act). */
async function pageFor(id: string, need: "read" | "act", name?: string) {
  const t = await pageOf(id, name)
  // (a terminal's says what works there: it took a guess at typing into one)
  if (!t) throw new OpError(paneById(id) && paneSource(paneById(id)!.to).kind === "terminal" ? `pane ${id} is a terminal: nothing types in it (see reads it, follow watches it)`
    : `pane ${id} shows no web page in the desktop app (vau tabs lists the panes)`, 404)
  if (privatePage(t.url, t.container)) throw new OpError("that page is private: the companion never sees it (the setting private)", 403)
  if (t.access === "none" || (need === "act" && t.access !== "act")) throw new OpError(`its container lets agents ${t.access === "none" ? "do nothing" : "only read"} there (Agents, in the container menu of the page's bar)`, 403)
  return t
}

/** A place resolved for the window: a pane that shows a note is that note; a page's element to its box (a terminal's
 *  text the window finds on its screen). Private panes refuse. */
async function resolve(t: Target, name: string): Promise<Target & Boxed> {
  const p = t.pane ? paneById(t.pane) : undefined
  if (t.pane && !p) throw new OpError(`no pane ${t.pane} in the user's window (vau tabs lists them)`, 404)
  // (a note's text, found: its line too, so what's by its cursor is found there)
  if (!p && t.path && t.find && t.line === undefined && !drawing(t.path)) { try { const line = anchorLine(readText(plugin.vault.abs(t.path)), t); if (line) return { ...t, line } } catch { /* not there */ } }
  if (!p) return t
  if (privatePane(p)) throw new OpError("that pane is private: the companion never sees it", 403)
  const x = paneSource(p.to)
  if (x.kind === "note") return { path: x.path, ...(t.line ? { line: t.line } : {}), ...(t.find ? { find: t.find } : {}) }
  if (x.kind === "site" && t.el) {
    const page = await pageFor(p.id, "read", name)
    const b = await plugin.desktop("agent:locate", page.tab, t.el).catch((e) => { throw new OpError((e as Error).message, 409) }) as { x: number; y: number; width: number; height: number; zoom: number }
    return { ...t, box: { x: b.x, y: b.y, w: b.width, h: b.height, zoom: b.zoom } }
  }
  return t
}

/** An ask or a point on a pane or the app's UI (the window says what's there; `extra`: a Talk key's over it, its point and
 *  picture), or a change in UI it follows: a moment. Never a follow: that's only asked for (companion follow). */
async function paneMoment(m: Record<string, unknown>, req: IncomingMessage | undefined, extra: Partial<Moment> = {}) {
  const ui = str(m.ui).slice(0, 120) || undefined
  // (a tab of one pane is that pane; a split tab is its panes)
  const tabId = /^tab:(.+)$/.exec(ui ?? "")?.[1], inTab = tabId ? allPanes().filter((x) => x.tab === tabId) : []
  const pane = str(m.pane) || /^pane:(.+)$/.exec(ui ?? "")?.[1] || (inTab.length === 1 ? inTab[0].id : undefined), p = paneById(pane)
  const tab = !pane && inTab.length > 1 ? tabId : undefined
  if (p && privatePane(p)) return
  if (tab && inTab.every(privatePane)) return
  const agent = str(m.agent) || undefined, title = (p?.title || (tab ? inTab.filter((x) => !privatePane(x)).map((x) => x.title).join(" · ") : "") || str(m.title)).slice(0, 200) || undefined
  const asked = m.kind === "ask" ? str(m.text).slice(0, 4000) || undefined : undefined
  const text = (m.kind === "ask" ? str(m.under) : str(m.text)).slice(0, 4000) || undefined
  const where = { ...(pane ? { pane } : {}), ...(ui && !pane ? { ui } : {}), ...(title ? { title } : {}), ...(m.summoned === true && m.kind !== "change" ? { summoned: true, ...(m.voice === true ? { voice: true } : {}) } : {}), ...extra }
  if (m.kind === "change") {
    if (!followed.list().some((f) => f.ui === ui)) return
    return void addMoment({ kind: "change", for: agent, ...where, what: "it changed", changes: Array.isArray(m.changes) ? m.changes.map(String).slice(0, 30) : [] })
  }
  const x = p && paneSource(p.to)
  if (x?.kind === "note") return void addMoment({ kind: m.kind as "ask", for: agent, path: x.path, line: 1, ...(asked ? { text: asked } : {}), ...(where.summoned ? { summoned: true, ...(where.voice ? { voice: true } : {}) } : {}), ...extra }, req)
  let under = text
  if (x?.kind === "site" && m.x !== undefined) {
    const t = await pageOf(p!.id).catch(() => null)
    if (t && !privatePage(t.url, t.container) && t.access !== "none") under = String((await plugin.desktop("agent:at", t.tab, Number(m.x), Number(m.y)).catch(() => ({})) as { text?: string }).text ?? "") || under
  }
  const said = under?.slice(0, 1200)
  addMoment({ kind: m.kind as "ask", for: agent, ...where, ...(Number(m.row) > 0 ? { row: Number(m.row) } : {}), ...(x?.kind === "site" ? { url: x.url } : {}),
    ...(m.kind === "ask" ? { ...(asked ? { text: asked } : {}), ...(said ? { under: said } : {}) } : said ? { text: said } : {}) }, req)
}

/** What the companion follows now (follows.ts): a change in one is a moment for it. */
const followed = follows(plugin, {
  panes: allPanes,
  change: (c) => addMoment({ kind: "change", for: c.follow.agent, pane: c.pane, title: c.title, what: c.what, changes: c.changes, ...(c.url ? { url: c.url } : {}) }),
  told: () => broadcast({ t: "follows", follows: followed.list() }),
})
plugin.onUnload(() => followed.stop())
/** A source the watches read, for a pane: its note, terminal or address. */
const sourceOf = (p: Pane) => { const x = paneSource(p.to); return x.kind === "note" ? `note:${x.path}` : x.kind === "terminal" ? `terminal:${x.terminal}` : x.kind === "site" ? `site:${x.url}` : null }
/** The panes the windows show (but private ones): each one's id, title, tab group and what it shows (note:, terminal:, site:). */
plugin.provide("companion:panes", () => allPanes().filter((p) => !privatePane(p)).map((p) => ({ id: p.id, title: p.title, ...(p.group ? { group: p.group } : {}), source: sourceOf(p) })))
/** Whether a web page (its address, its container) is private: the companion never sees it, nor do watches. */
plugin.provide("companion:private", (url: string, container: string | null) => privatePage(url, container))
/** Whether a note is private (the setting's folders, or companion: private in it). */
plugin.provide("companion:hidden", (path: string) => hidden(path))
/** Its names, for dictation to expect (@claude, "ask Ada"). */
plugin.provide("dictation:terms", () => [...new Set([ownName(), ...[...agents.values()].map((a) => a.name)])].filter(Boolean))
/** A watch's hit: a moment for the companion while it runs (true), else the watches' inbox (false). */
plugin.provide("companion:watch", (h: { id: string; title: string; why: string; done: boolean; changes: string[]; url?: string }) => {
  const name = ownName()
  if (mode() === "off" || !(live(name) || isChat(sessionId(name)))) return false
  return !!addMoment({ kind: "watch", for: name, item: h.id, title: h.title, ...(h.why ? { text: h.why } : {}), what: h.done ? "what it waited for happened (the watch ended)" : "it changed", changes: h.changes.slice(0, 30), ...(h.url ? { url: h.url } : {}) })
})

// ---------- edits: typed in by the window that has the file open, else written on disk

type Edit = { path: string; find?: string; after?: string; text: string; line?: number; append?: boolean }

/** The window to type an edit in: the most recent one with the file on screen. */
const editorFor = (path: string) => [...windows.entries()].filter(([, w]) => w.shown.includes(path)).sort((a, b) => b[1].at - a[1].at)[0]?.[0] ?? null

const turns = new Map<string, Promise<unknown>>()
/** One edit of a note at a time, typed or written: the next waits for it (two at once interleave their letters). */
function inTurn<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const run = (turns.get(path) ?? Promise.resolve()).then(fn)
  const tail = run.catch(() => {})
  turns.set(path, tail)
  void tail.then(() => { if (turns.get(path) === tail) turns.delete(path) })
  return run
}

/** Ask a window to make a change (`m`): true once it's made (`reply`: its answer), its error, false when it can't (it
 *  doesn't show the file now). No answer by `wait` ms: it may still be at it, so writing the file too would mix the two. */
async function askWindow(ws: WebSocket, m: object, wait: number, reply: Record<string, unknown> = {}, rid = `e${++nid}`) {
  const ok = await new Promise<boolean | string | null>((resolve) => {
    const timer = setTimeout(() => { asked.delete(rid); resolve(null) }, wait)
    asked.set(rid, { ws, done: (ok, error, r) => { clearTimeout(timer); asked.delete(rid); Object.assign(reply, r); resolve(ok || error || false) } })
    send(ws, { ...m, rid })
  })
  if (typeof ok === "string") throw new OpError(ok, 409)
  if (ok === null) throw new OpError("the window showing it didn't say it was done: read it again before another change", 504)
  return ok
}

// Its edits are its in History and Review: the text before is kept as a version, and the app's save of what it typed
// is Activity's as that agent's (the op's own event names it too: `did`'s by).
const applyEdit = (ctx: OpCtx, agent: Agent, e: Edit, animate = true) => inTurn(e.path, async (): Promise<"typed" | "written"> => {
  await plugin.ask("history:keep", false, e.path)
  const ws = editorFor(e.path)
  if (ws) {
    let was: string | null = null
    try { was = readText(plugin.vault.abs(e.path)) } catch { /* a drawing's, or gone */ }
    // (its cursor waits at the end of what it types, once it's typed)
    const end = was !== null ? endOf(was, e) : null
    if (end) setAgent(agent.name, { path: e.path, line: end.line, find: end.find, state: "writing" })
    const wait = EDIT_WAIT + e.text.length * 20
    await plugin.ask("activity:typing", false, e.path, agent.name, wait + SAVED_MS)
    let typed = false, late = false
    try { typed = await askWindow(ws, { t: "edit", agent: agent.name, animate, ...e }, wait) } catch (err) { late = (err as OpError).status === 504; throw err } finally {
      // (typed, or maybe still typing: its save lands within a moment of the window's autosave)
      await plugin.ask("activity:typing", false, e.path, agent.name, typed || late ? SAVED_MS : 0)
    }
    if (typed) {
      // (the app saves what it typed, as the user's: who wrote those lines is said here, for Provenance)
      if (was !== null && !drawing(e.path)) try { await plugin.ask("provenance:wrote", null, e.path, was, editText(was, e)) } catch { /* not in the file as saved */ }
      return "typed"
    }
  }
  const f = await ctx.api("GET", `file?path=${encodeURIComponent(e.path)}`)
  const cur = String(f.text ?? "")
  await ctx.api("PUT", "file", { path: f.path, text: editText(cur, e), base: cur })
  const end = endOf(cur, e)
  if (end) setAgent(agent.name, { path: e.path, line: end.line, find: end.find })
  return "written"
})

/** `cur` with edit `e` made: `find` replaced by `text`, or `text` as new lines after the line with `after`, after `line`
 *  (0: first) or at the end. */
export function editText(cur: string, e: Omit<Edit, "path">) {
  const missing = (s: string) => new OpError(`"${cut(s, 60)}" isn't in the file: read it again (it may have changed) and copy the text exactly`)
  if (e.find) {
    const at = nearest(cur, e.find, e.line)
    if (at < 0) throw missing(e.find)
    return cur.slice(0, at) + e.text + cur.slice(at + e.find.length)
  }
  let line = e.line
  if (e.after) {
    const at = nearest(cur, e.after, e.line)
    if (at < 0) throw missing(e.after)
    line = cur.slice(0, at + e.after.length).split("\n").length
  }
  const lines = cur.split("\n")
  const n = e.append || line === undefined ? (cur.endsWith("\n") ? lines.length - 1 : lines.length) : Math.max(0, Math.min(lines.length, line))
  lines.splice(n, 0, ...e.text.replace(/\n$/, "").split("\n"))
  return lines.join("\n")
}

/** Where edit `e` of `cur` ends: its last line written (from 1) and that line's words, where its cursor stays. */
export function endOf(cur: string, e: Omit<Edit, "path">): { line: number; find?: string } | null {
  let next: string
  try { next = editText(cur, e) } catch { return null }
  let line: number
  if (e.find) line = cur.slice(0, nearest(cur, e.find, e.line)).split("\n").length + e.text.split("\n").length - 1
  else {
    let n = e.line
    if (e.after) n = cur.slice(0, nearest(cur, e.after, e.line) + e.after.length).split("\n").length
    const lines = cur.split("\n")
    n = e.append || n === undefined ? (cur.endsWith("\n") ? lines.length - 1 : lines.length) : Math.max(0, Math.min(lines.length, n))
    line = n + e.text.replace(/\n$/, "").split("\n").length
  }
  const all = next.split("\n")
  while (line > 1 && !all[line - 1]?.trim()) line--
  const words = all[line - 1]?.trim().slice(0, 200)
  return { line, ...(words ? { find: words } : {}) }
}

// ---------- answers streamed: a say's bubble and an edit's words shown as the model writes them (a chat session's tools)

/** A streaming call: what shows as it comes (a bubble, a comment or reply, an edit typed in by a window); `whole`: nothing
 *  does, its call does it all (an edit that becomes a proposal, one no window shows, one whose place comes last). */
type Streamed = { use: string; agent: string; tool: Streaming; ended?: "done" | "stop"; whole?: boolean; note?: string; reply?: { id: string; at: number }; again?: boolean
  edit?: { ws: WebSocket; rid: string; e: Edit; text: string; sent: number; open: boolean; final: boolean; was: string | null; job: Promise<"typed" | "stopped" | "unshown"> } }
const streams = new Map<string, Streamed>()
/** The tool_use a chat session's call is for, through the op it runs: the stream that showed it. */
const toolUse = new AsyncLocalStorage<string | undefined>()
const STREAM_MS = 5 * 60_000
const ANCHORS = ["find", "after", "line", "append"]

/** The ask a tour asked for by name plays for (tours.asked), by agent: its words answer it, said as it was asked. */
const touredAsk = new Map<string, Moment>()
/** The Talk key's ask a say of `name`'s answers, if it's one: when it came, said or typed, its language (voice.ts). */
function answering(name: string): Note["answers"] {
  const from = inSummoned.getStore() ? lane().last() : moments.filter((m) => meantFor(m, name) && Date.now() - m.t < 180_000).slice(-5)
  const m = from.findLast((x) => x.kind === "ask" || x.kind === "point")
  const toured = touredAsk.get(key(name))
  if (toured && !tours.playing(name)) touredAsk.delete(key(name))
  else if (toured && toured.t > (m?.t ?? 0)) return answersOf(toured)
  // (a job's proof showing since: its narration, said as Show me was)
  if (shown && isMain(name) && shown.t > (m?.t ?? 0)) return { t: shown.t, ...(shown.voice ? { voice: true as const } : {}) }
  return m?.summoned ? answersOf(m) : undefined
}
function answersOf(m: Moment): NonNullable<Note["answers"]> {
  const lang = m.text ? languageIn(m.text) : null
  return { t: m.t, ...(m.voice ? { voice: true as const } : {}), ...(lang ? { lang } : {}) }
}

type Streaming = "say" | "comment" | "edit" | "draw"
/** A streaming tool's input so far (`end`: written whole, its call to come; or its turn ended first). */
function streamed(name: string, tool: Streaming, use: string, json: string, end?: "done" | "stop") {
  let s = streams.get(use)
  if (!s) {
    if (!json) return
    const t = { use, agent: name, tool }
    s = t
    streams.set(use, t)
    // (its call never came: let go)
    setTimeout(() => { if (streams.get(use) === t) { finishStream(t); streams.delete(use) } }, STREAM_MS).unref?.()
  }
  if (s.ended) return
  const { whole, keys, open } = partialArgs(json)
  // (a draw's words are its say, its bubble by its cursor as a say's; one on a drawing (actions, path) has none)
  const field = tool === "draw" ? "say" : "text"
  if (tool === "draw" && keys.some((k) => k === "actions" || k === "path")) s.whole = true
  // (its words wait for its marks, whole and sound: a draw refused would have said them, and its retry again)
  const held = tool === "draw" && !s.whole && !s.note && !marksSound(whole.marks)
  if (held && whole.marks !== undefined) s.whole = true
  const text = typeof whole[field] === "string" ? whole[field] as string : open?.key === field ? open.text : null
  if (text !== null && !s.whole && !held) {
    try { if (tool === "edit") editStream(s, whole, keys, text); else noteStream(s, whole, keys, text) } catch { s.whole = true }
  }
  if (end) s.ended = end
  if (end === "stop") finishStream(s)
}

const marksSound = (marks: unknown) => { try { return marks !== undefined && !!checkMarks(marks).length } catch { return false } }
/** A draw's words said though its marks weren't drawn (none found there): its retry's words, the same, go on from them. */
const saidUndrawn = new Map<string, { note: string; text: string; ask: number }>()
const sameStart = (a: string, b: string) => { const x = a.trim().toLowerCase(), y = b.trim().toLowerCase(); return x.startsWith(y) || y.startsWith(x) }

/** A say's bubble or a comment's card, its words growing as they come (a comment kept once its call ends it). */
function noteStream(s: Streamed, given: Record<string, unknown>, keys: string[], text: string) {
  if (!text.trim()) return
  const n = s.note ? notes.get(s.note) : s.reply ? notes.get(s.reply.id) : undefined
  if (n) {
    const r = s.reply ? n.replies?.[s.reply.at] : null
    // (a retry's words still those said: what was said stays as it was)
    if (s.again && n.text?.startsWith(text)) return
    if (r && r.text !== text) r.text = text
    else if (!s.reply && n.text !== text) n.text = text
    else return
    return void broadcast({ t: "note", note: n })
  }
  if (s.note || s.reply) return // (gone meanwhile)
  const placed = s.tool !== "draw" && keys.slice(0, keys.indexOf("text")).some((k) => ["path", "line", "find", "x", "y", "id"].includes(k))
  if (s.tool === "comment") {
    // (its place after its words: by the line it's on now, the moment's, until its call says where)
    const a = agents.get(key(s.agent))
    if (!placed && !a?.path) { s.whole = true; return }
    if (!placed) given = { path: a!.path, line: a!.line, ...(a!.find ? { find: a!.find } : {}) }
    const to = given.id ? notes.get(str(given.id)) : undefined
    if (given.id) {
      if (to?.kind !== "comment") { s.whole = true; return }
      to.replies = [...(to.replies ?? []), { by: "agent", text, t: Date.now(), ...(to.by ? { name: s.agent } : {}) }]
      s.reply = { id: to.id, at: to.replies.length - 1 }
      setAgent(s.agent, { path: to.path, line: to.line, find: to.find, state: acting(s.agent) })
      broadcast({ t: "note", note: to })
    } else {
      const t = target(given)
      if (drawing(t.path!)) { s.whole = true; return }
      setAgent(s.agent, { ...t, state: acting(s.agent) })
      const note: Note = { kind: "comment", agent: s.agent, text, ...t, id: newId(), t: Date.now() }
      notes.set(note.id, note)
      broadcast({ t: "note", note })
      s.note = note.id
    }
  } else {
    const undrawn = s.tool === "draw" ? saidUndrawn.get(key(s.agent)) : undefined
    if (undrawn && undrawn.ask === askOf(s.agent)?.t && notes.has(undrawn.note) && sameStart(undrawn.text, text)) {
      saidUndrawn.delete(key(s.agent)); s.note = undrawn.note; s.again = true
      return noteStream(s, given, keys, text)
    }
    const t = placed ? target(given) : {}
    setAgent(s.agent, { ...t, ...("path" in t ? { find: t.find, x: t.x, y: t.y } : {}), state: acting(s.agent) })
    const answers = answering(s.agent)
    s.note = putNote({ kind: "say", agent: s.agent, text, ...t, ...(given.ask === true ? { question: true } : {}), ...(answers ? { answers } : {}), writer: { client: AS_TOOL.client, agent: AS_TOOL.agent } }).id
  }
  did(s.agent, "word")
}

function editStream(s: Streamed, given: Record<string, unknown>, keys: string[], text: string) {
  if (s.edit) { s.edit.text = text; flushEdit(s); return }
  // (its place before its words, as its parameters are ordered: else its call does it all)
  if (!keys.slice(0, keys.indexOf("text")).some((k) => ANCHORS.includes(k))) { s.whole = true; return }
  const t = target(given), find = str(given.find) || undefined, after = str(given.after) || undefined
  const ws = !drawing(t.path!) && !(find && linesIn(find) > BIG_EDIT) ? editorFor(t.path!) : null
  if (!ws) { s.whole = true; return }
  const e: Edit = { path: t.path!, find, after, line: t.line, text: "", append: given.append === true }
  const x = { ws, rid: `e${++nid}`, e, text, sent: 0, open: false, final: false, was: null as string | null, job: null as unknown as Promise<"typed" | "stopped" | "unshown"> }
  s.edit = x
  x.job = inTurn(e.path, () => typeIn(s, x))
  x.job.catch(() => {})
}

/** An edit typed in as it streams (in its note's turn): the window opens it, takes its words as they come, and says
 *  it's done once it ended; what it typed is the agent's. "unshown": no window shows it now, so its call writes it. */
async function typeIn(s: Streamed, x: NonNullable<Streamed["edit"]>): Promise<"typed" | "stopped" | "unshown"> {
  const path = x.e.path
  await plugin.ask("history:keep", false, path)
  try { x.was = readText(plugin.vault.abs(path)) } catch { /* gone */ }
  await plugin.ask("activity:typing", false, path, s.agent, STREAM_MS)
  setAgent(s.agent, { path, line: x.e.line, find: x.e.after ?? x.e.find, x: undefined, y: undefined, state: "writing" })
  did(s.agent, "word")
  const reply: Record<string, unknown> = {}
  let ok = false
  try {
    x.sent = x.text.length
    const done = askWindow(x.ws, { t: "stream", agent: s.agent, ...x.e, text: x.text }, STREAM_MS, reply, x.rid)
    x.open = true
    if (x.final) endEdit(s, x)
    ok = await done
  } finally { await plugin.ask("activity:typing", false, path, s.agent, SAVED_MS) }
  if (!ok) { x.open = false; return "unshown" }
  const typed = typeof reply.text === "string" ? reply.text : x.text
  if (x.was !== null) try { await plugin.ask("provenance:wrote", null, path, x.was, editText(x.was, { ...x.e, text: typed })) } catch { /* not in the file as saved */ }
  return reply.stopped ? "stopped" : "typed"
}

function flushEdit(s: Streamed) {
  const x = s.edit
  if (!x?.open || x.text.length <= x.sent) return
  send(x.ws, { t: "stream-more", rid: x.rid, at: x.sent, add: x.text.slice(x.sent) })
  x.sent = x.text.length
}
/** The edit's last words (all of it, as its call gives it): its cursor goes to where it ends, then the window ends it. */
function endEdit(s: Streamed, x: NonNullable<Streamed["edit"]>) {
  flushEdit(s)
  const end = x.was !== null ? endOf(x.was, { ...x.e, text: x.text }) : null
  if (end) setAgent(s.agent, { path: x.e.path, line: end.line, find: end.find, state: "writing" })
  send(x.ws, { t: "stream-end", rid: x.rid, text: x.text })
}
/** A stream ends: a say's bubble goes after a while like any, a comment is kept as far as it got, an edit ends with
 *  what it has. */
function finishStream(s: Streamed) {
  const n = s.note ? notes.get(s.note) : s.reply ? notes.get(s.reply.id) : undefined
  // (cut off before its call: kept in its history as far as it got)
  if (n?.kind === "say" && !timers.has(n.id)) { timers.set(n.id, setTimeout(() => dropNote(n.id), sayMs(n.text ?? ""))); if (s.ended === "stop") keepSaid(n) }
  else if (n?.kind === "comment" && n.path) save(n.path)
  const x = s.edit
  if (x && !x.final) { x.final = true; if (x.open) endEdit(s, x) }
}
/** Its call answered: the stream is over, whatever its op did. */
function streamDone(use: string) {
  const s = streams.get(use)
  if (!s) return
  streams.delete(use)
  finishStream(s)
}
/** Agent `name`'s streams stop where they are (the user's Esc). */
function stopStreams(name: string) {
  for (const s of streams.values()) if (key(s.agent) === key(name)) { s.ended = "stop"; finishStream(s) }
}
/** Whether agent `name` is writing into a note now (one stopped, kept for a call that may never come, isn't). */
const writing = (name: string) => [...streams.values()].some((s) => key(s.agent) === key(name) && s.ended !== "stop" && (s.note || s.reply || s.edit))

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
/** Line `n` (from 1) of a file, trimmed: "" when it can't be read. */
const lineText = (p: string, n: number) => { try { return readText(plugin.vault.abs(p)).split("\n")[n - 1]?.trim() ?? "" } catch { return "" } }

// ---------- the always-on session

/** What its session runs unasked: its own commands, reading the vault, and keeping what it learns of the user. */
const ALLOW = ["vau companion", "vau docs", "vau read", "vau search", "vau render", "vau links", "vau context", "vau tasks", "vau dataview", "vau remember", "vau dictation add", "vau watches", "vau tabs", "vau browser"]
// The companion's session is session.json; another agent started by name (start --as Ada) is session-ada.json.
const sessionFile = (name?: string | null) => `${plugin.localDir()}/${name && !isMain(name) ? `session-${key(name)}` : "session"}.json`
/** A session as kept: its terminal, its model, and how many moments it was handed (a fresh one takes over past
 *  fresh_after). */
type Session = { id: string; name: string; t: number; model?: string; effort?: string; handed?: number
  /** A chat session's agent (claude, claude_work): a terminal's id says it. */
  runs?: string }
const session = (name?: string | null): Session | null => {
  try { const s = JSON.parse(fs.readFileSync(sessionFile(name), "utf8")); return typeof s.id === "string" ? s : null } catch { return null }
}
const writeSession = (s: Session) => fs.writeFileSync(sessionFile(s.name), JSON.stringify(s))
const sessionId = (name?: string | null): string | null => session(name)?.id ?? null
/** Every session started here: the companion's (its name) and the others'. */
function sessions(): { name: string; id: string }[] {
  let files: string[] = []
  try { files = fs.readdirSync(plugin.localDir()).filter((f) => /^session(-[\w-]+)?\.json$/.test(f)) } catch { /* none yet */ }
  return files.flatMap((f) => {
    try {
      const s = JSON.parse(fs.readFileSync(`${plugin.localDir()}/${f}`, "utf8"))
      return typeof s.id === "string" ? [{ name: f === "session.json" ? ownName() : str(s.name), id: s.id }] : []
    } catch { return [] }
  })
}
/** Whether a session runs: a terminal's while it does, a chat session's while it's kept (its process, ended when idle a
 *  while, comes back with the next message). */
const running = async (id: string | null) => !!id && (isChat(id) ? sessions().some((s) => s.id === id) : !!(await plugin.ask<boolean>("terminal:runs", false, id)))
/** A Claude Code session the chat host runs (its id a UUID), not a terminal ("claude-ab12cd34"). */
const isChat = (id: string | null | undefined) => !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
/** The agent a session runs (claude_work, codex). */
function runsOf(s: Session) {
  if (isChat(s.id)) return s.runs || "claude"
  const t = parseTerminal(s.id)
  return t ? agentIn(t.agent, t.profile) : ""
}
const nextCmd = (name: string) => `vau companion next --timeout 240${isMain(name) ? "" : ` --as ${name}`}`

async function start(ctx: OpCtx, as?: string, agent?: string, model?: string, effort?: string, at: Target = {}, after?: number) {
  const name = as?.trim() || ownName()
  if (!/^[\w-]{1,30}$/.test(name)) throw new OpError("a name is one word (letters, digits, - or _): it's what @ calls it by")
  const was = sessionId(name)
  if (await running(was)) return { id: was!, running: true, name }
  // (a quicker model answers sooner: each moment is one of its turns)
  const how = howFor(name, agent, model, effort), runs = how.agent
  if (onChat(runs)) return await startChat(name, how, at, after)
  const id = newTerminalId(runs), prompt = promptFor(name)
  starting(name, { ...at, runs, model: how.model || undefined, effort: how.effort || undefined }, after)
  try {
    await startAgent(ctx, id, prompt, { allow: ALLOW, model: how.model || null, effort: how.effort || null })
  } catch (e) { seen.delete(key(name)); setAgent(name, { state: isMain(name) ? "watching" : "away" }); throw e }
  writeSession({ id, name, t: Date.now(), ...(how.model ? { model: how.model } : {}), ...(how.effort ? { effort: how.effort } : {}), handed: 0 })
  return { id, running: false, name, ...how }
}

/** Agent `name`'s session boots: asks to it from now on (or after moment `after`) wait for its first `next`, its cursor
 *  showing it starting. */
export function starting(name: string, a: Partial<Agent> = {}, after = seq) {
  const k = key(name)
  seen.set(k, Date.now()); delivered.set(k, Math.min(after, seq)); handed.delete(k); asking.delete(k)
  return setAgent(name, { ...a, state: "starting" })
}

/** What a session is told it is: the setting's prompt, how moments reach it (a chat session's messages, a terminal's
 *  loop of next), and its name when it isn't the companion. */
const promptFor = (name: string, chat = false) => [setting("prompt"), chat ? CHAT_WORDS : LOOP_WORDS(name),
  isMain(name) ? "" : chat ? `Your name here is ${name}: asks to @${key(name)} are yours.` : `Your name here is ${name}: add \`--as ${name}\` to every vau companion command (\`${nextCmd(name)}\`); asks to @${key(name)} are yours.`].filter(Boolean).join(" ")
const LOOP_WORDS = (name: string) => `Then loop and never stop: run \`${nextCmd(name)}\` (give that command a timeout of 250 seconds or more), which waits for what they do and shows the note's lines around it (no need to read the note again), then act on it with \`vau companion look|say|pass|comment|suggest|propose|edit|highlight\`, then run next again. Never end your turn.`
const CHAT_WORDS = "What the user does comes to you as messages (moments, with the note's lines around them: no need to read the note again). Act on them with your vaultite-app tools (say, pass, comment, suggest, propose, edit, look, highlight, draw...), not vau companion commands. Your last call for a moment says done: true, which ends your turn with it: words outside your tools never reach the user, so write none (pass ends it too). Your say, comment and edit words show as you write them, so give their place (find, after, line) before their text. What they do next comes as your next message: never wait or poll for moments."

// ---------- a fresh session: one that has handled many moments (or read much context) hands over to a new one

const FRESH_TOKENS = 150_000, FRESH_SHARE = 0.6, ASK_AGAIN = 60_000, HANDOVER_WAIT = 3 * 60_000, OLD_ENDS = 15_000, METER_EVERY = 5 * 60_000
const freshAfter = () => Number(plugin.settings().fresh_after) || Number(plugin.manifest.settings?.fresh_after?.default) || 150
/** When each agent was asked to hand over (it summarizes, then `handover`). */
const handing = new Map<string, number>()
/** Agents the user asked for a fresh session (Start fresh): asked to hand over at their next `next`. */
const fresh = new Set<string>()
const metered = new Map<string, number>() // session -> when its context was last read (its agent scans processes)

/** Whether a session is due for a fresh one: past fresh_after moments, or its context (when its agent says) past
 *  FRESH_TOKENS or FRESH_SHARE of its window. */
async function due(s: Session) {
  if ((s.handed ?? 0) >= freshAfter()) return true
  // (a chat session compacts its context itself)
  if (isChat(s.id) || Date.now() - (metered.get(s.id) ?? 0) < METER_EVERY) return false
  metered.set(s.id, Date.now())
  const agent = parseTerminal(s.id)?.agent
  const meters = agent ? await plugin.ask<AgentMeter[]>(`agent-meters:${agent}`, [], true).catch(() => []) : []
  const m = Array.isArray(meters) ? meters.find((x) => x.terminal === s.id) : undefined
  return !!m?.tokens && m.tokens >= Math.min(FRESH_TOKENS, (m.window || Infinity) * FRESH_SHARE)
}

/** What a fresh session is told after its prompt: the last one's summary, its open threads and the user's last asks. */
export function handoverText(name: string, summary: string, items: Note[], asks: Moment[], chat = false) {
  const open = items.filter((n) => !n.by && key(n.agent) === key(name) && KEPT.has(n.kind)).slice(-20)
  const last = (n: Note) => n.replies?.at(-1)
  return [`This session continues an earlier one of yours that grew long. The user sees no change: don't greet them or say you're new. ${chat ? "Read `vau docs companion`, then end your turn: their next moments come as your messages" : `Read \`vau docs companion\`, then run \`${nextCmd(name)}\` at once`} (ME.md when a moment needs it).`,
    summary.trim() ? `What your last session handed over:\n${summary.trim()}` : "",
    open.length ? `Your open threads (reply with ${chat ? "your comment tool and its id" : "`vau companion comment --id <id>`"}):\n${open.map((n) => `- ${n.id} ${n.kind} in ${n.path}${n.line ? `:${n.line}` : ""}${n.orphaned ? " (its text is gone)" : ""}: ${JSON.stringify(cut(n.text ?? n.replace ?? "", 160))}${last(n) ? `; last, ${last(n)!.by === "user" ? "the user" : "you"}: ${JSON.stringify(cut(last(n)!.text, 160))}` : ""}`).join("\n")}` : "",
    asks.length ? `The user's last asks:\n${asks.map((m) => `- ${m.path ?? ""}${m.line ? `:${m.line}` : ""} ${JSON.stringify(cut(m.text ?? "", 160))}`).join("\n")}` : ""].filter(Boolean).join("\n\n")
}

/** Start the fresh session (the same agent and account) with the handover, then end the old one once it has answered. */
async function handOver(ctx: OpCtx, name: string, summary: string) {
  const old = session(name)
  if (!old) throw new OpError(`${name} has no session to hand over`, 404)
  const k = key(name)
  const asks = [...new Map(moments.filter((m) => m.kind === "ask" && key(m.for ?? "") === k).map((m) => [m.text, m])).values()].slice(-5)
  if (isChat(old.id)) return await handOverChat(name, old, handoverText(name, summary, [...notes.values()], asks, true))
  const id = newTerminalId(runsOf(old) || agentSetting())
  // (the same model; its cursor stays as it is: moments wait for the new one's first next, as for any start)
  await startAgent(ctx, id, `${promptFor(name)}\n\n${handoverText(name, summary, [...notes.values()], asks)}`,
    { allow: ALLOW, model: old.model || null, effort: old.effort || null })
  writeSession({ ...old, id, t: Date.now(), handed: 0 })
  handing.delete(k); handed.delete(k)
  seen.set(k, Date.now())
  did(name, "handover")
  // (after its handover call has answered, so it isn't cut off mid-command)
  setTimeout(() => { void (async () => { if (await running(old.id)) await plugin.runOp("terminal.end", { id: old.id }) })().catch(() => {}) }, OLD_ENDS).unref?.()
  return { id, from: old.id, name }
}

/** End a session (the companion's by default), or every one. */
async function stop(as?: string, all = false) {
  const gone = all ? sessions() : [{ name: as?.trim() || ownName(), id: sessionId(as) ?? "" }]
  for (const s of gone) {
    try { fs.rmSync(sessionFile(s.name)) } catch { /* none */ }
    if (isChat(s.id)) await chat()?.stop(s.id).catch(() => {})
    else if (await running(s.id)) await plugin.runOp("terminal.end", { id: s.id })
  }
  for (const s of gone) if (s.id) dead.add(s.id)
  if (all || isMain(gone[0]?.name ?? "")) await lane().stop()
  for (const a of agents.values()) if (all || gone.some((s) => key(s.name) === key(a.name))) ended(a.name)
  return { id: gone[0]?.id || null }
}

/** Agent `name`'s session ended (stopped, its tab closed, killed): its cursor goes until it starts again (an ask to
 *  the companion wakes it), its waiting `next` answered. `id`: its terminal, whose late calls are let go. */
function ended(name: string, id?: string) {
  const k = key(name)
  asking.delete(k); handing.delete(k); fresh.delete(k); seen.delete(k); watching.delete(k)
  ends.set(k, (ends.get(k) ?? 0) + 1)
  if (id) dead.add(id)
  const wait = waiters.get(k)
  if (wait) { waiters.delete(k); wait([]) }
  setAgent(name, { state: "away", asks: undefined })
  followed.remove(null, name)
}
plugin.onEvent({ types: ["terminal.ended"] }, (ev) => {
  const s = sessions().find((x) => x.id === ev.id)
  if (s) ended(s.name, s.id)
})
// (its agent isn't installed: forgotten, so an ask starts it again; its terminal stays, showing the shell's error)
plugin.onEvent({ types: ["terminal.agent-missing"] }, (ev) => {
  const s = sessions().find((x) => x.id === ev.id)
  if (!s) return
  try { fs.rmSync(sessionFile(s.name)) } catch { /* none */ }
  ended(s.name, s.id)
})

// ---------- Claude Code's sessions through the Agent SDK (claude-code's chat host): what the user does is their
// messages, sent as they happen (or as a turn ends), and the actions their tools; a turn ended is a terminal's next `next`

/** A tool served to a chat session, run here: claude-code's chat relays its calls. */
export type ChatTool = { name: string; description: string; schema: { properties?: Record<string, unknown>; required?: string[] }; run: (args: unknown, use?: string) => Promise<unknown>
  streams?: boolean; ends?: boolean; hidden?: boolean; stream?: (use: string, json: string, end?: "done" | "stop") => void }
export type ChatHow = { cwd?: string; account?: string; model?: string; effort?: string; append?: string; title?: string; by?: string; inbox?: boolean; allowed?: string[]; denied?: string[]; dirs?: string[]; tools?: ChatTool[]
  /** Its permission mode (Claude Code's): the summoned session's is auto, what its classifier blocks offered to them. */
  mode?: "default" | "acceptEdits" | "plan" | "auto" | "dontAsk" | "bypassPermissions"
  /** Its permission asks and auto mode's blocks answered by its hidden tool of that name; commands never run (regex
   *  sources); auto mode's rules (claude-code's chathost.ts). */
  confirm?: string; never?: string[]; autoMode?: Record<string, string[]>
  /** Pictures sent with its message (an ask's screenshot); `quick`: no thinking first. */
  images?: string[]; quick?: boolean
  /** A lean session's whole system prompt and the few Claude Code tools it has; its words as written (`onText`). */
  system?: string; builtins?: string[]; onText?: (use: string, text: string, end?: "done" | "stop" | "tool") => void }
export type ChatState = { id: string; state: "starting" | "working" | "waiting" | "idle" | "error"; error?: string; seq?: number; turn?: { text: string } | null
  /** Tokens its last request read. */
  context?: number }
/** What claude-code exports as `chat`. */
export type Chat = {
  start: (o: ChatHow & { prompt?: string }) => Promise<ChatState>
  send: (id: string, text: string, o?: ChatHow) => Promise<unknown>
  stop: (id: string) => Promise<unknown>
  interrupt: (id: string) => Promise<boolean>
  list: () => ChatState[]
  touch: () => void
  serve: (id: string, o: ChatHow) => void
  on: (fn: (id: string, s: ChatState | null) => void) => () => void
  asking: (id: string) => string[]
}
const chat = () => (plugin.peer("claude-code")?.exports.chat ?? null) as Chat | null
/** Claude Code's companions run through the SDK; Codex's and OpenCode's in terminals, looping on `next`. */
const onChat = (agent: string) => agent.split("_")[0] === "claude"
/** The actions a chat session has as tools: the ops of those names, run as it. */
const TOOLS = ["say", "pass", "comment", "suggest", "propose", "edit", "look", "highlight", "draw", "layer", "see", "act", "check", "follow", "unfollow", "keep", "clear", "history", "status", "handover", "handoff", "open", "page", "job", "job-open", "job-stop", "job-answer", "job-show", "tour", "tour-save"]
/** Tools whose answers the talk leaves out: what it read, and its words (logged as they're said). */
const QUIET_RESULTS = new Set(["see", "check", "history", "status", "conversation", "say", "pass", "look", "highlight"])
/** An action's last call of a turn: its turn ends with it, no call of the model's after (a summary nobody reads). */
const DONE = { type: "boolean", description: "true on your last call for this moment: your turn ends with it" }
/** Those whose words show as they're written; those its turn may end after with no words (a summary holds its next moment). */
const STREAMS = new Set(["say", "comment", "edit", "draw"]), ENDS = new Set(["say", "pass", "comment", "suggest", "propose", "edit", "look", "highlight", "draw", "layer", "act", "follow", "unfollow", "keep", "clear", "handover", "handoff", "open", "page", "job", "job-open", "job-stop", "job-answer", "job-show", "tour"])
/** Those after which its turn always ends. */
const LAST = new Set(["pass", "handover", "handoff"])
/** What it runs unasked: its tools, and reading the vault (its actions are tools, not vau companion). */
const ALLOWED = ["mcp__vaultite-app", ...ALLOW.filter((c) => c !== "vau companion").map((c) => `Bash(${c}:*)`)]
const AS_TOOL = whoOf("cli", "claude-code")
/** The API as excerpts reads notes with, for a chat session's moments. */
const apiCtx = { api: (method: string, route: string, body?: unknown) => plugin.host.api(method, route, body) } as unknown as OpCtx
/** An ops context for work the app does itself, as request `from` would (live edits, a proof's Keep). */
const liveCtx = (from?: IncomingMessage) => ({ ...apiCtx, op: async (id: string, p?: Record<string, unknown>) => (await plugin.runOp(id, p ?? {}, undefined, from)).result }) as unknown as OpCtx

/** Agent `name`'s tools, each op's parameters (but `as`, which is it) and words (but its vau examples); `busy`: its turn
 *  runs (the summoned session's own). */
function toolsFor(name: string, list = TOOLS, busy = () => turning.has(key(name))): ChatTool[] {
  return list.flatMap((short) => {
    const op = plugin.ops.find((o) => o.id === `companion.${short}`)
    if (!op) return []
    const params = Object.entries(op.params ?? {}).filter(([k]) => k !== "as")
    const properties = Object.fromEntries(params.map(([k, p]) => {
      const { required: _r, env: _e, format: _f, ...s } = p as Record<string, unknown>
      return [k, s]
    }))
    const description = [op.summary, ...(op.help ?? "").split("\n").filter((l) => !/^\s*vau /.test(l) && !/^\s+[{[]/.test(l))].join("\n").replace(/\n{3,}/g, "\n\n").trim()
    const ends = ENDS.has(short) && !LAST.has(short)
    if (ends) properties.done = DONE
    return [{ name: short, description, schema: { properties, required: params.filter(([, p]) => p.required).map(([k]) => k) },
      ...(STREAMS.has(short) ? { streams: true, stream: (use: string, json: string, end?: "done" | "stop") => streamed(name, short as Streaming, use, json, end) } : {}),
      ...(ENDS.has(short) ? { ends: true } : {}),
      run: async (args: unknown, use?: string) => {
        const { done, ...given } = (args && typeof args === "object" ? args : {}) as Record<string, unknown>
        try {
          const r = await toolUse.run(use, () => plugin.host.call(op.id, { ...given, ...(isMain(name) ? {} : { as: name }) }, AS_TOOL, { report: `companion ${short}` }))
          // (what it answered, ids and all, for the talk a fresh session is told: "the one you just opened")
          if (!QUIET_RESULTS.has(short) && r.text) did(name, "result", undefined, `${short}: ${String(r.text).slice(0, 400)}`)
          // (not its last call: its turn goes on, and its cursor shows it busy, a bubble or not, until it ends)
          if (ends && done !== true && busy() && agents.get(key(name))?.state === "watching") setAgent(name, { state: "thinking" })
          return { content: [{ type: "text", text: r.text }], ...((ends && done === true) || LAST.has(short) ? { endsTurn: true } : {}) }
        } catch (e) {
          did(name, "result", undefined, `${short} failed: ${(e as Error).message.slice(0, 300)}`)
          return { isError: true, content: [{ type: "text", text: (e as Error).message }] }
        }
        finally { if (use) streamDone(use) }
      } }]
  })
}

/** How agent `name`'s chat session runs: in the vault, its account (claude_work: work), model and effort, told it's
 *  the companion, out of the inbox, with its tools. */
function chatOptions(name: string, how: { runs?: string; agent?: string; model?: string; effort?: string }): ChatHow {
  const runs = how.runs || how.agent || "claude"
  return { cwd: plugin.vault.path, account: runs.split("_")[1] || undefined, model: how.model || undefined, effort: how.effort || undefined,
    append: promptFor(name, true), title: isMain(name) ? "Companion" : `Companion: ${name}`, by: "companion", inbox: false, allowed: ALLOWED,
    // (its tools, not the commands the docs show: those go through a server that may be restarting)
    denied: ["Bash(vau companion:*)"], tools: toolsFor(name) }
}

// ---------- its summoned session (summoned.ts): Talk key asks, on a small model, warm, apart from this long one

/** What the summoned session has besides its words (said, its tags pointing and marking): drawing more than a mark,
 *  reading or acting on a page, following, handing off. */
const SUMMONED_TOOLS = ["pass", "open", "page", "draw", "layer", "see", "act", "check", "follow", "clear", "handoff", "job", "job-open", "job-stop", "job-answer", "job-show", "live-undo", "conversation", "tour", "tour-save"]
/** What its words and tags become. */
const SUMMONED_ACTS = ["say", "look", "draw"]
/** Of Claude Code's own tools, the one it has: vau, to read the vault (ALLOWED's commands). */
const SUMMONED_BUILTINS = ["Bash"]
/** What it runs at once, no classifier's check keeping them waiting while they talk: the long session's commands,
 *  showing things in their window, and looking around (READ_ONLY). The rest auto mode decides, its blocks offered. */
const SUMMONED_ALLOWED = [...ALLOWED, "Bash(vau --help)", "Bash(vau open:*)", "Bash(vau commands:*)", "Bash(vau command companion:session:*)", "Bash(vau screen:*)",
  "Bash(tailscale serve status:*)", "Bash(tailscale status:*)", "Bash(lsof:*)", "Bash(git -C * log *)", "Bash(git -C * show *)"]
/** Where its read-only commands (ls, cat, grep...: Claude Code tells them from writes, redirects too) may look unasked
 *  (reach.ts), never home's dotfiles or Library (keys, cookies, mail); git's -c could run a pager, so it's refused. */
const READ_ONLY = { dirs: readableDirs().dirs,
  denied: [`/${path.resolve(LOCAL)}`].map((d) => `Read(${d}/**)`).concat(NEVER_READ, "Bash(git * --output*)", "Bash(git * -c *)", "Bash(git * --config-env*)", "Bash(git * --exec-path*)") }
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** What a command it may not run unasked becomes: a one-line offer by their pointer ("Run `…`?"), said yes to or
 *  clicked, then run; any other tool's ask, a no. Answers the keeper's gate (claude-code's chathost.ts, confirm). */
function confirmTool(name: () => string): ChatTool {
  return { name: "confirm", hidden: true, description: "", schema: {}, run: async (args) => {
    const a = (args ?? {}) as { tool?: string; input?: { command?: unknown; description?: unknown }; blocked?: boolean }
    const cmd = typeof a.input?.command === "string" ? a.input.command.trim() : ""
    if (a.tool !== "Bash" || !cmd) return { yes: false, message: "Only shell commands are offered to them: do it with your own tools, or hand it off." }
    const who = name(), what = typeof a.input?.description === "string" && a.input.description.trim() ? a.input.description.trim().replace(/\.?$/, ".") : ""
    did(who, "result", undefined, `offered: ${cmd.slice(0, 300)}`)
    const r = await takeover.confirm(`Run \`${cmd.length > 120 ? `${cmd.slice(0, 119)}…` : cmd}\`?`, `${what ? `${what} ` : ""}Say yes or click Run.`, { agent: who, tint: agentOf(who).tint })
    did(who, "result", undefined, `offer ${r.ok ? "taken" : r.why === "none" ? "not shown (no Mac's screen)" : `declined (${r.why ?? "no"})`}`)
    if (r.ok) return { yes: true }
    return { yes: false, message: r.why === "none" ? "There's no screen of theirs to ask on: tell them the command in a few words, or hand it off." : r.why === "asked"
      ? "They asked something else instead: don't run it; answer that (your next message)." : "Not run: the user said no to it on its offer. Tell them you left it, in a few words (it was their no: no hooks, blocks or approvals), and don't try it another way." }
  } }
}

/** An ask's window text it's given at most (chars), the lines by what's at their pointer first: the rest is in its
 *  picture, and every ask's text stays in its history. */
const SCREEN_CHARS = 4000
/** The model summoned asks run on; "" (the setting's companion, or an agent not Claude Code's): the long session takes them. */
const summonedModel = () => { const m = setting("summoned_model"); return onChat(agentSetting()) && m !== "companion" ? m : "" }
/** The pictures an ask's text names, attached to its message (no Read call before its first word). */
const shotsOf = (ms: Moment[]) => [...new Set(ms.flatMap((m) => [m.shotDown, m.shot].filter((f): f is string => !!f && fs.existsSync(f))))].slice(-3)
let laneOf: { vault: Vault; lane: Lane } | null = null
const lane = (): Lane => {
  if (laneOf?.vault === plugin.vault) return laneOf.lane
  const l = summonedLane({
    file: () => `${plugin.localDir()}/summoned.json`, chat, name: ownName, model: summonedModel,
    // (low effort: its thinking, which can't be turned off, took 1 to 2 s of each answer at the account's high)
    options: (model) => ({ cwd: plugin.vault.path, account: agentSetting().split("_")[1] || undefined, model, effort: "low", quick: true, system: SUMMONED_PROMPT,
      builtins: SUMMONED_BUILTINS, title: "Companion: summoned", by: "companion", inbox: false, mode: "auto", allowed: SUMMONED_ALLOWED,
      denied: ["Bash(vau companion:*)", ...READ_ONLY.denied], dirs: READ_ONLY.dirs, confirm: "confirm", never: [...NEVER_RUN, escaped(path.resolve(LOCAL))], autoMode: AUTO_RULES,
      tools: [...toolsFor(ownName(), SUMMONED_TOOLS, () => lane().busy()), confirmTool(ownName)] }),
    acts: () => { const [say, look, draw] = toolsFor(ownName(), SUMMONED_ACTS, () => lane().busy()); return { say, look, draw } },
    found: async (text) => {
      if (askOf(ownName())?.path) return null
      const r = await screenFind(ownName(), text).catch(() => null)
      return r ? { sx: Math.round(r.x + r.w / 2), sy: Math.round(r.y + r.h / 2) } : null
    },
    caption: (name, text) => screenDrawing.recaption(name, text),
    answered: (name, text) => {
      const ask = askOf(name), away = ask ? awayIn([ask]) : "", site = ask ? sitesOf(ask)[0] : undefined
      if (away === "a private app") return
      tours.answered(name, text, { near: (nearBy.get(key(name)) ?? []).map((e) => ({ id: e.id, role: e.role, label: e.label, frame: e.frame, inside: e.inside })),
        app: away || "vaultite", ...(site ? { site } : {}) })
    },
    text: async (ms) => {
      const slim = ms.map((m) => inPicture(m.screen ? { ...m, screen: screenNear(m.screen, anchorsOf(m), SCREEN_CHARS) } : m))
      // (when it is, as a friend beside them would know: "this morning", "last night" in the talk make sense)
      const now = new Date().toLocaleString("en-US", { weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false })
      const text = [`(now: ${now})`, momentsText(slim, mode(), focus(), await excerpts(apiCtx, slim)), jobs.line()].filter(Boolean).join("\n")
      // (its picture attached, not a path: given one, it spent a turn reading it before its first word)
      const images = shotsOf(ms), named = images.reduce((t, f) => t.split(`its picture: ${f}`).join("its picture, attached to this message")
        .split(`as the key went down: ${f}`).join("as the key went down, attached before it"), text)
      return { text: named.replace(/\(point at one: --ax <id>\)/g, "(tag one by id: [point a1], [ring a1])"), images }
    },
    agent: (name) => agents.get(key(name)), setAgent, did,
    talk: (t) => talkBefore(t),
    say: (name, text) => { const a = agents.get(key(name)), answers = inSummoned.run(true, () => answering(name))
      keepSaid(putNote({ kind: "say", agent: name, text, ...(a?.path ? { path: a.path, line: a.line } : {}), ...(answers ? { answers } : {}) }, sayMs(text))) },
  })
  laneOf = { vault: plugin.vault, lane: l }
  return l
}

/** What a fresh summoned session is told first: their ME.md (its start) and the talk before `t`, its last day. */
function talkBefore(t: number) {
  const days = [...new Set([localDate(t - 86_400_000), localDate(t)])]
  const xs = days.flatMap((d) => exchanges(log.read(d), acts.read(d), [], ownName())).filter((e) => e.t < t && t - e.t < 86_400_000)
  const body = String((plugin.vault.has("me") ? plugin.vault.get("me", "me") : null)?.body ?? "").trim()
  return { me: body.length > ME_CHARS ? `${body.slice(0, ME_CHARS)}…` : body, said: talkSoFar(xs, t) }
}
/** How much of ME.md a fresh summoned session is told (its first sections: who they are, how they want it). */
const ME_CHARS = 5000

const READY = "Read ME.md and `vau docs companion` first, once."
/** Agents whose chat session's turn runs (or was just sent its message): moments meanwhile wait for its end. */
const turning = new Set<string>()
/** Chat sessions handed over, ended once their last turn does. */
const retiring = new Set<string>()

/** Agent `name`'s chat session starts: the moments waiting for it (the ask that started it) are its first message, else
 *  it gets ready, its cursor starting until that turn ends. */
async function startChat(name: string, how: { agent: string; model: string; effort: string }, at: Target, after?: number) {
  const c = chat()
  if (!c) throw new OpError("the companion's Claude Code sessions run through the Claude Code plugin, which is off", 409)
  hearChats()
  const k = key(name)
  starting(name, { ...at, runs: how.agent, model: how.model || undefined, effort: how.effort || undefined }, after)
  const waiting = pendingFor(name), given = waiting.some(wakes) ? hand(name, waiting) : []
  const first = given.length ? `${READY}\n\n${momentsText(given, mode(), focus(), await excerpts(apiCtx, given), mode() === "pair" ? awareness() : "")}`
    : `${READY} Then end your turn: what the user does comes as your next messages.`
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
async function pump(name: string) {
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
    text = momentsText(given, mode(), focus(), await excerpts(apiCtx, given), mode() === "pair" ? awareness() : "")
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
const INTERRUPT: Record<string, string[]> = { codex: ["Escape"], opencode: ["Escape", "Escape"] }
/** What a session stopped by the user (Esc) is told with its next moments: what it was answering. */
const STOPPED = (asks: string[]) => `They stopped your last answer (Esc)${asks.length ? `, to ${asks.map((a) => JSON.stringify(cut(a, 120))).join(", ")}` : ""}: leave it as it is, and don't answer it again unless they ask anew.`
/** Agents the user stopped, with the asks they were answering, to tell them with their next moments. */
const stopped = new Map<string, string[]>()
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
const hearChats = () => { if (!unhear) { const c = chat(); if (c) unhear = c.on(heard) } }

/** A chat session hands over: a new one (the same agent, account, model) starts with `text`, and the old one ends once
 *  its turn (the handover call's) does. */
async function handOverChat(name: string, old: Session, text: string) {
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
async function nudge(name: string, id: string) {
  seen.set(key(name), Date.now())
  await plugin.runOp("terminal.send", { id, text: `Keep watching: run \`${nextCmd(name)}\` again, and never end your turn.` }).catch(() => {})
}
export const watchdog = setInterval(tend, 60_000)
watchdog.unref?.()

// ---------- ops

const AS = { type: "string", description: "your name in the app, when several agents keep the user company (default: the companion's, Claude)" } as const
const PATH = { type: "string", format: "path", description: "the file (Notes/Idea.md); default: the one the user is in" } as const
const LINE = { type: "integer", minimum: 0, description: "a line of it (from 1, counting its frontmatter)" } as const
const FIND = { type: "string", description: "text in that line or near it, exactly as in the file (the occurrence nearest line); on a drawing, an element's id or text" } as const
const X = { type: "number", description: "on a drawing: a point of it, with y (its units, as its elements')" } as const
const Y = { type: "number", description: "on a drawing: a point of it, with x" } as const

const PANE = { type: "string", description: "instead of a note: a pane of the user's window, a terminal or a web page (its id: vau tabs; a pane showing a note is that note)" } as const
const UI = { type: "string", description: "instead of a note: the app's own UI, by its id (tab:<id>, pane:<id>, group:<id>, panel:<plugin>:<name>, button:<command id>)" } as const
const ROW = { type: "integer", minimum: 1, description: "in a terminal pane: a row of its screen, from 1 (or find: its text)" } as const
const EL = { type: "string", description: "in a web page's pane: an element, by its ref (e12: companion see)" } as const
/** Where an op points, in a note, a pane, the app's UI, or (the helper's) an app's window and the screen. */
const PLACE = { path: PATH, line: LINE, find: FIND, x: X, y: Y, pane: PANE, ui: UI, row: ROW, el: EL,
  app: { type: "string", description: "outside the app (the helper): an app, by its bundle id" } as const,
  window: { type: "integer", description: "outside the app: a window of it (its CGWindowID)" } as const,
  sx: { type: "number", description: "outside the app: a point on the screen, with sy (points)" } as const,
  sy: { type: "number", description: "outside the app: a point on the screen, with sx" } as const,
  display: { type: "integer", description: "outside the app: the display sx and sy are on" } as const,
  ax: { type: "string", description: "outside the app: an element the user's last ask listed near their pointer (a3), instead of sx and sy: your cursor snaps to it" } as const }

/** A target from params: the user's file when none is given; a pane, the app's UI or the screen (`elsewhere`: the ops
 *  that point) without one. */
function target(p: Record<string, unknown>, elsewhere = false): Target {
  const out: Target = {}
  if (str(p.ax)) {
    const e = nearBy.get(key(who(p)))?.find((x) => x.id === str(p.ax))
    if (!e) throw new OpError(`no element ${str(p.ax)} near their pointer: the ids are the last ask's (its near list)`, 404)
    Object.assign(out, { sx: e.frame.x + Math.min(16, e.frame.width / 2), sy: e.frame.y + e.frame.height / 2, frame: e.frame })
  }
  for (const k of ["pane", "ui", "el", "app"] as const) if (str(p[k])) out[k] = str(p[k])
  for (const k of ["row", "window", "sx", "sy", "display"] as const) if (p[k] !== undefined && p[k] !== null && Number.isFinite(Number(p[k]))) out[k] = Number(p[k])
  const away = !!(out.pane || out.ui || out.app || out.sx !== undefined)
  if (out.frame) { out.sx = Math.round(out.sx!); out.sy = Math.round(out.sy!) }
  if (away && !elsewhere) throw new OpError("this is for notes: give `path` (in a pane or the app's UI: companion look, say or highlight)")
  const path = str(p.path) || (away ? "" : focus()?.path)
  if (!path && !away) throw new OpError("the user has no file open: give `path` (or `pane`, `ui`)")
  return { ...(path ? { path } : {}), ...(p.line !== undefined ? { line: Number(p.line) } : {}), ...(str(p.find) ? { find: str(p.find) } : {}), ...point(p), ...out }
}
/** What a drawing doesn't have (a margin, lines to write in): the op that does it there instead. */
function notOnDrawing(t: Target, what: string) {
  if (t.path && drawing(t.path)) throw new OpError(`${t.path} is a drawing: ${what}`)
}
/** The agent acting: --as (as it was first called), else the companion. */
const who = (p: Record<string, unknown>) => { const n = str(p.as).trim(); return n ? agents.get(key(n))?.name ?? n : ownName() }

plugin.op({
  id: "companion.next",
  cli: "companion next",
  summary: "Wait for what the user does next in the app (asks you, writes, opens a note, answers you), as the companion.",
  help: `Answers the moments since you last asked, or waits for one (up to timeout seconds; none by then: an empty list).
ask: they addressed you, a line with your @name (it stays in their note), @claude in a comment of theirs or Ask
companion (answer in that thread, companion comment --id). Always answer. edit: lines they changed after a pause (pair
mode): answer what's meant for you, @name or not; writing to themselves, pass. point: an ask without words (they held
your Talk key and drew or pointed): look there and answer, as for an ask. open: the note they went to, with the next moment. reply,
accept, reject, dismiss: their answer to your comment, suggestion or bubble. move: they moved your words, a bubble into
the note or what you wrote back into a bubble: a hint for next time. Lines count from 1 with the frontmatter. Asks,
replies and edits come with the note's text around them, numbered: no need to read it again. While you wait your cursor
rests; given moments, it shows you reading (thinking, for an ask) there until you act, or run this again: the user sees
a seen tick (companion pass says why). Run it again after acting, forever. With several agents (--as), each gets the
asks to its @name and answers to its items; edit and open go to the companion, or to an agent with --watch.

  vau companion next --timeout 240`,
  kind: "read",
  lock: false,
  params: {
    timeout: { type: "integer", minimum: 0, maximum: 240, default: 100, description: "seconds to wait for a moment" },
    after: { type: "integer", minimum: 0, description: "only moments after this one (default: after the last you were given)" },
    as: AS,
    watch: { type: "boolean", description: "also get edit and open moments (pair mode), which only the companion gets otherwise" },
    terminal: { type: "string", env: "VAULTITE_TERMINAL", description: "the app terminal you run in (filled in from VAULTITE_TERMINAL)" },
  },
  run: async (p, ctx) => {
    const name = who(p), k = key(name), era = ends.get(k)
    const over = () => ({ mode: mode(), focus: null, moments: [], cursor: delivered.get(k) ?? 0, notes: [], ended: true })
    // (from a session that ended, sent before it did: no cursor comes back for it)
    if (p.terminal && dead.has(p.terminal)) return over()
    seen.set(k, Date.now())
    if (p.watch) watching.add(k)
    else watching.delete(k)
    did(name, "next")
    const joined = !agents.has(k), a = agentOf(name)
    // (back without acting on what it was handed: it let it pass, which the user sees as a tick)
    asking.delete(k)
    if (handed.has(k)) setAgent(name, { state: "watching", seen: true })
    else if (joined || a.state === "away" || a.state === "writing" || a.state === "thinking" || a.state === "starting") setAgent(name, { state: "watching" })
    const after = p.after ?? delivered.get(k) ?? Math.max(0, seq - 20)
    const pending = () => pendingFor(name, after)
    let got = pending()
    // (nothing but opens (and what rides along) waiting: the moment to hand over, if it's due)
    const sess = !got.some(wakes) ? session(name) : null
    const handover = () => {
      fresh.delete(k); handing.set(k, Date.now())
      did(name, "asked to hand over")
      return { mode: mode(), focus: focus(), moments: [], cursor: after, notes: [], handover: true, as: isMain(name) ? "" : name }
    }
    if (sess && (fresh.has(k) || (Date.now() - (handing.get(k) ?? 0) > ASK_AGAIN && await due(sess)))) return handover()
    // (opens alone wait for the next moment, which they come with)
    if (!got.some(wakes) && p.timeout > 0) {
      waiters.get(k)?.([])
      const woken = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => { if (waiters.get(k) === wake) waiters.delete(k); resolve(false) }, p.timeout * 1000)
        const wake = (m: Moment[]) => { clearTimeout(timer); resolve(m.length > 0) }
        waiters.set(k, wake)
      })
      // (its session ended while it waited)
      if (ends.get(k) !== era) return over()
      got = woken ? pending() : []
      seen.set(k, Date.now())
      // (woken to start fresh)
      if (!got.length && fresh.has(k) && session(name)) return handover()
    }
    if (got.length) got = hand(name, got)
    return { mode: mode(), focus: focus(), moments: got, cursor: delivered.get(k) ?? after, notes: await excerpts(ctx, got), ...(got.length && mode() === "pair" ? { aware: awareness() } : {}) }
  },
  text: (r) => (r.ended ? "Your session has ended: stop here, without running next again." : r.handover ? handoverAsk(r.as) : momentsText(r.moments, r.mode, r.focus, r.notes, r.aware)),
})

/** The moments for agent `name` after moment `after` (of the last half hour). */
const pendingFor = (name: string, after = delivered.get(key(name)) ?? Math.max(0, seq - 20)) =>
  moments.filter((m) => m.seq > after && Date.now() - m.t < 30 * 60_000 && meantFor(m, name))

/** Moments given to agent `name` (by its `next`, or as its chat session's message): counted on its session, its cursor
 *  reading them (thinking, for an ask) where the last is, until it acts or comes back for more. */
function hand(name: string, got: Moment[]) {
  const k = key(name)
  delivered.set(k, got[got.length - 1].seq)
  // (of the notes they went to, the last one)
  got = got.filter((m, i) => m.kind !== "open" || !got.slice(i + 1).some((x) => x.kind === "open"))
  const s = session(name)
  if (s) { try { writeSession({ ...s, handed: (s.handed ?? 0) + got.length }) } catch { /* as it was */ } }
  did(name, "handed", got.map((m) => m.seq))
  batches.set(k, got.map((m) => m.seq))
  const at = [...got].reverse().find((m) => m.path || m.pane || m.ui), asked = got.some((m) => m.kind === "ask" || m.kind === "point" || m.kind === "reply")
  if (asked) asking.add(k)
  setAgent(name, { state: asked ? "thinking" : "reading", ...(at ? placeOf(at) : {}) })
  handed.add(k)
  return got
}

const handoverAsk = (as: string, chat = false) => `Time for a fresh session: this one has grown long. In a few lines, write what the next one should know (what the user is working on, what they asked you to keep in mind, anything you promised), then ${chat ? "call your handover tool with those lines" : `run \`vau companion handover${as ? ` --as ${as}` : ""} "<those lines>"\``}. It starts the new session, which takes over your cursor and threads; then end your turn.`

plugin.op({
  id: "companion.handover",
  cli: "companion handover",
  summary: "Hand over to a fresh session (when next asks you to): it starts with your summary and open threads; then end your turn.",
  help: `  vau companion handover "Alice is planning the Lisbon trip; I promised to check the budget note tomorrow."`,
  kind: "write",
  lock: false,
  params: { summary: { type: "string", description: "what the next session should know, in a few lines" }, as: AS },
  args: ["summary"],
  run: async (p, ctx) => await handOver(ctx, who(p), str(p.summary)),
  text: (r) => `Handed over to ${r.id}: end your turn now.`,
})

/** The text around what the user asked or wrote, per note: all of a short note for an ask or a reply. */
export async function excerpts(ctx: OpCtx, ms: Moment[]) {
  const by = new Map<string, Moment[]>()
  const out: Excerpt[] = []
  // (a pane pointed at: what it shows now, the look; never for a change, which has its lines)
  for (const m of ms) if ((m.kind === "point" || m.kind === "ask") && m.pane && !out.some((e) => e.pane === m.pane)) {
    const pn = paneById(m.pane), x = pn && paneSource(pn.to)
    try {
      if (x?.kind === "terminal") out.push({ path: "", from: 0, to: 0, of: 0, lines: [], pane: m.pane, title: m.title ?? pn!.title, text: await plugin.ask<string>("terminal:screen", "", x.terminal, 60) })
      else if (x?.kind === "site") {
        const t = await pageFor(m.pane, "read"), r = await plugin.desktop("agent:snapshot", t.tab) as { snapshot: string }
        out.push({ path: "", from: 0, to: 0, of: 0, lines: [], pane: m.pane, title: m.title ?? pn!.title, text: cut(r.snapshot, SNAPSHOT) })
      }
    } catch { /* not readable now: the moment says where */ }
  }
  // (a drawing: its scene as the window that sent the moment saw it, the last one)
  for (const m of [...ms].reverse()) if (m.path && m.scene && !out.some((e) => e.path === m.path)) out.push({ path: m.path, from: 0, to: 0, of: 0, lines: [], scene: m.scene })
  for (const m of ms) if (m.path && !m.scene && (m.kind === "ask" || m.kind === "point" || m.kind === "reply" || m.kind === "edit")) by.set(m.path, [...(by.get(m.path) ?? []), m])
  for (const [path, list] of by) {
    try {
      const read = async () => String((await ctx.api("GET", `file?path=${encodeURIComponent(path)}`) as { text?: unknown }).text ?? "")
      let text = await read()
      // (an ask typed in the note, `waited`: the window's autosave lands a moment after it went)
      for (let i = 0; i < 8 && list.some((m) => m.kind === "ask" && m.waited !== undefined && m.text && !text.includes(m.text)); i++) { await new Promise((r) => setTimeout(r, 200)); text = await read() }
      const e = excerpt(path, text, list)
      if (e) out.push(e)
    } catch { /* gone, or not text */ }
  }
  return out
}
const WHOLE = 120, MOST = 160, ABOVE = 3, PARAGRAPH = 12
export function excerpt(path: string, text: string, ms: Moment[]): Excerpt | null {
  const lines = text.split("\n")
  if (lines.at(-1) === "") lines.pop()
  const asked = ms.some((m) => m.kind !== "edit")
  const at = ms.flatMap((m) => [m.line ?? 0, ...(m.hunks ?? []).flatMap((h) => [h.line, h.line + h.added.length - 1])]).filter((n) => n > 0)
  if (!lines.length || (!at.length && !asked)) return null
  const keep = uncut(lines, ms)
  let from = 1, to = lines.length
  if (!asked || lines.length > WHOLE) {
    const pad = asked ? 40 : 6
    from = Math.max(1, Math.min(...at, lines.length) - pad)
    to = Math.min(lines.length, Math.max(...at, 1) + pad, from + MOST - 1)
  }
  return { path, from, to, of: lines.length, lines: lines.slice(from - 1, to).map((l, i) => (keep.has(from - 1 + i) ? l : cut(l, 400))) }
}

/** The lines (from 0) read whole: the paragraph an ask, a point or a reply is in, and the few paragraphs just above it
 *  ("read this and the previous three"); other long lines are cut. */
function uncut(lines: string[], ms: Moment[]) {
  const out = new Set<number>()
  const para = (i: number) => {
    let a = i, b = i
    while (a > 0 && i - a < PARAGRAPH && lines[a - 1].trim()) a--
    while (b + 1 < lines.length && b - i < PARAGRAPH && lines[b + 1].trim()) b++
    for (let k = a; k <= b; k++) out.add(k)
    return a
  }
  for (const m of ms) {
    if (m.kind === "edit" || !m.line || m.line > lines.length) continue
    let k = para(m.line - 1) - 1
    for (let n = 0; n < ABOVE && k >= 0; n++) {
      while (k >= 0 && !lines[k].trim()) k--
      if (k >= 0) k = para(k) - 1
    }
  }
  return out
}

/** A bubble's words, as a moment about it quotes them. */
const saidText = (id?: string) => { const n = said.find((x) => x.id === id); return n?.text ? `\n  you said: ${JSON.stringify(cut(n.text, 160))}` : "" }

/** The app the latest ask or point of `ms` was made in, when that's another app than Vaultite (on screen); else "". */
export function awayIn(ms: Moment[]) {
  const m = ms.findLast((x) => x.kind === "ask" || x.kind === "point")
  return m?.app && !m.path && !m.pane && !m.ui ? (m.app === "private" ? "a private app" : appIn(m)) : ""
}
/** An app on screen as an agent reads it: its name, then its bundle id. */
export const appIn = (m: { app?: string; appName?: string }) => (m.appName && m.appName !== m.app ? `${m.appName} (${m.app})` : m.app ?? "")

/** The tours (type: tour notes) for where moment `m` was: its site's or its app's, Vaultite's own when in its window. */
function toursHere(m: Moment) {
  const all = plugin.vault.shared("tours") as unknown as readonly { id: string; app?: string[]; site?: string[] }[]
  const hosts = sitesOf(m), app = (awayIn([m]) || "vaultite").toLowerCase()
  return all.filter((t) => hosts.some((h) => siteIn(h, t.site ?? [])) || (t.app ?? []).some((a) => a.toLowerCase() === app)).slice(0, 8).map((t) => (/\.md$/i.test(t.id) ? t.id : `${t.id}.md`))
}

/** Moments as an agent reads them. */
export function momentsText(ms: Moment[], md: Mode, f: Target | null, notes: Excerpt[] = [], aware = "") {
  const guided = new Set<string>()
  const note = f?.path ? `${f.path}${f.x !== undefined ? ` at ${f.x},${f.y}` : ` at line ${f.line ?? 1}`}` : "", away = awayIn(ms)
  // (asked over another app: they're there, Vaultite's note only behind it; said as the note, it acted in Vaultite)
  const head = `Mode: ${md}.${away ? ` The user is in ${away}, not Vaultite${note ? ` (Vaultite shows ${note})` : ""}.` : note ? ` The user is in ${note}.` : ""}`
  if (!ms.length) return `${head}${aware ? `\n${aware}` : ""}\nNothing yet: run vau companion next again.`
  const out = [head, ...(aware ? [aware] : [])]
  for (const m of ms) {
    const at = m.path ? ` ${m.path}${m.line ? `:${m.line}` : ""}` : m.pane || m.ui ? ` ${m.title ? `"${m.title}" ` : ""}(${m.pane ? `pane ${m.pane}` : m.ui})${m.row ? `, row ${m.row}` : ""}`
      : m.app ? ` on screen, ${m.title ? `${JSON.stringify(m.title)} in ` : ""}${appIn(m)}${m.window ? ` (window ${m.window})` : ""}`
      : m.sx !== undefined ? ` on screen, at sx ${m.sx}, sy ${m.sy} (no window there${m.under ? "" : ", nothing Accessibility reads: see its picture"})` : ""
    if (m.kind === "change") {
      out.push(`- change in${at}: ${m.what ?? "it changed"}${m.url ? ` (${m.url})` : ""}`)
      for (const c of m.changes ?? []) out.push(`  ${c}`)
      continue
    }
    if (m.kind === "watch") {
      out.push(`- watch ${m.item} "${m.title ?? ""}": ${m.what ?? "it changed"}${m.url ? ` (${m.url})` : ""}${m.text ? `\n  they asked: ${JSON.stringify(m.text)}` : ""}`)
      for (const c of m.changes ?? []) out.push(`  ${c}`)
      continue
    }
    if (m.kind === "point" && !m.path && (m.pane || m.ui)) {
      out.push(`- point${at}: they pointed you here (look at this, as an ask)${m.text ? `\n  under the pointer: ${JSON.stringify(cut(m.text, 600))}` : ""}`)
      continue
    }
    const thread = m.item && (m.kind === "ask" || m.kind === "reply") && personThread(m.item) ? ` (in their comment thread ${m.item}, by the line: answer in it, companion comment --id ${m.item})` : ""
    if (m.kind === "ask") out.push(`- ask${at}${m.voice ? " (said: may hold the recognizer's slips)" : ""}${thread}${m.scene && m.find ? ` (in ${m.find})` : ""}${m.more || m.again ? " (they went on writing it: the whole line now)" : ""}: ${JSON.stringify(m.text ?? "")}${m.selection ? `\n  on the selection: ${JSON.stringify(cut(m.selection, 2000))}` : ""}`)
    else if (m.kind === "point") out.push(`- point${at}: they pointed you here (look at this, as an ask)${m.selection ? `\n  on the selection: ${JSON.stringify(cut(m.selection, 2000))}` : ""}`)
    else if (m.kind === "edit") {
      out.push(`- edit${at}${m.again ? " (they went on writing: all of it now)" : ""}`)
      for (const c of m.changes ?? []) out.push(`  ${c}`)
      for (const h of m.hunks ?? []) {
        out.push(`  at line ${h.line}:`)
        for (const l of h.removed) out.push(`  - ${l}`)
        for (const l of h.added) out.push(`  + ${l}`)
      }
    } else if (m.kind === "open") out.push(`- open${at}`)
    else if (m.kind === "reply" && m.bubble) out.push(`- reply to your bubble ${m.item}${at}: ${JSON.stringify(m.text ?? "")}${saidText(m.item)}`)
    else if (m.kind === "reply") out.push(`- reply to ${m.item}${at}${thread}: ${JSON.stringify(m.text ?? "")}`)
    else if (m.kind === "dismiss" && m.bubble) out.push(`- dismiss your bubble ${m.item}${at}: they closed it, ${JSON.stringify(cut(m.text ?? "", 200))}`)
    else if (m.kind === "move") out.push(m.into === "note" ? `- move${at}: they put your bubble in the note there (more for the note than a bubble), ${JSON.stringify(cut(m.text ?? "", 200))}`
      : `- move${at}: they folded what you wrote there back into a bubble (more for a bubble than the note), ${JSON.stringify(cut(m.text ?? "", 200))}`)
    else out.push(`- ${m.kind} ${m.item}${at}${m.kind === "accept" && m.to !== undefined ? ` (now ${JSON.stringify(cut(m.to, 200))})` : ""}`)
    if (m.shot) out.push(`  its picture: ${m.shot}${m.shotAt ? ` (the screen around their pointer, cropped: what its edges cut is whole on their screen; a pixel a point: its top left is sx ${m.shotAt.x}, sy ${m.shotAt.y}, so its pixel x, y is sx ${m.shotAt.x} + x, sy ${m.shotAt.y} + y${m.sx !== undefined ? `; their pointer at ${m.sx - m.shotAt.x}, ${m.sy! - m.shotAt.y} in it` : ""})` : ""}`)
    if (m.shotDown) out.push(`  its picture as the key went down: ${m.shotDown} (the screen changed while they spoke: what they meant may be only in this one${m.shotDownAt ? `; its top left is sx ${m.shotDownAt.x}, sy ${m.shotDownAt.y}` : ""})`)
    if (m.notices) out.push(`  Vaultite's toasts of the last minute (gone from the picture, maybe): ${m.notices}`)
    if (m.front === "realtime") out.push(`  asked through the realtime voice: it already told them you're looking, so answer at once, no "let me look"${m.talk?.length ? `; said before: ${m.talk.map((x) => JSON.stringify(x)).join(", ")}` : ""}`)
    if (m.under) out.push(`  under their pointer${m.sx !== undefined ? ` (sx ${m.sx}, sy ${m.sy})` : ""}: ${m.under}`)
    else if (m.sx !== undefined && m.app) out.push(`  their pointer: sx ${m.sx}, sy ${m.sy}`)
    for (const k of m.ink ?? []) out.push(`  they drew ${k.shape === "ring" ? "a ring round" : k.shape === "underline" ? "an underline under" : `a ${k.shape} over`} sx ${k.box.x}-${k.box.x + k.box.width}, sy ${k.box.y}-${k.box.y + k.box.height} (its box ${k.box.x},${k.box.y},${k.box.width},${k.box.height}): ${k.points.map((p) => p.join(",")).join(" ")}`)
    if (m.clicks?.length) out.push(`  they clicked as they spoke (each went to the app as a click; the picture may show what it did): ${m.clicks.map((c) => `${c.under ?? "something"} at sx ${c.sx}, sy ${c.sy}`).join("; ")}`)
    if (m.region) out.push(`  their box (one they drew and keep on screen; "record this" records it): sx ${m.region.x}-${m.region.x + m.region.width}, sy ${m.region.y}-${m.region.y + m.region.height}`)
    if (m.floating?.length) out.push(`  floating over the screen (another app's panel, maybe what they mean): ${m.floating.map((w) => `${w.name ? `${w.name} (${w.app})` : w.app} at sx ${w.frame.x}, sy ${w.frame.y}, ${w.frame.width}×${w.frame.height}`).join("; ")}`)
    if (m.near?.length) out.push("  near their pointer (point at one: --ax <id>):", ...m.near.map((e) => `    ${thingText(e, { frame: true })}`))
    if (m.screen) out.push("  what the window says (its Accessibility text):", ...m.screen.split("\n").slice(0, 400).map((l) => `    ${cut(l, 300)}`))
    // (its Talk key's, in an app or on a site: the user's guide to it, once a message)
    if (m.summoned && (m.kind === "ask" || m.kind === "point") && (m.app || m.url)) {
      const g = guideFor(guides(), m)
      if (g && !guided.has(g.id)) { guided.add(g.id); out.push(...guideLines(g)) }
      else if (!g && m.app && m.app !== "private") out.push(`  no guide to ${m.app} yet (Guides/)`)
    }
    // (and the tours there, Vaultite's own when it wasn't another app: one line, once a message)
    if (m.summoned && !m.tour && (m.kind === "ask" || m.kind === "point") && m.app !== "private" && !guided.has("tours")) {
      const here = toursHere(m)
      if (here.length) { guided.add("tours"); out.push(`  their tours here (companion tour): ${here.join(", ")}`) }
      const asked = tours.askable().filter((t) => !here.includes(t.path)).slice(0, 8)
      if (asked.length) { guided.add("tours"); out.push(`  their tours for anywhere (companion tour, when they ask for one in other words): ${asked.map((t) => `${t.path} (${t.ask.map((a) => JSON.stringify(a)).join(", ")})`).join("; ")}`) }
    }
  }
  // (what its last answer left on their screen: a follow-up changes it in place)
  for (const a of new Set(ms.flatMap((m) => (m.for && (m.kind === "ask" || m.kind === "point") ? [m.for] : [])))) { const up = screenDrawing.text(a); if (up) out.push(up) }
  for (const e of notes) {
    if (e.pane) { out.push(`"${e.title ?? e.pane}" (pane ${e.pane}), what it shows now${e.text?.includes("[ref=") || /\be\d+\b/.test(e.text ?? "") ? " (refs for look --el, act)" : ""}:`, e.text ?? ""); continue }
    if (e.scene) { out.push(`${e.path}, the drawing (ids for companion draw, say --find):`, e.scene); continue }
    out.push(`${e.path}, lines ${e.from}-${e.to} of ${e.of}:`)
    e.lines.forEach((l, i) => out.push(`${String(e.from + i).padStart(4)}  ${l}`))
  }
  return out.join("\n")
}

plugin.op({
  id: "companion.look",
  cli: "companion look",
  summary: "Move your cursor to a place, without a word: in a note, a pane (a terminal's row, a page's element) or the app's own UI.",
  help: `  vau companion look --path Notes/Idea.md --line 12
  vau companion look --find "the second paragraph"
  vau companion look --path Drawings/Plan.excalidraw --find login
  vau companion look --ui tab:t3k2
  vau companion look --pane t3k2 --find "error:"
  vau companion look --pane t5x1 --el e12`,
  kind: "read",
  params: { ...PLACE, as: AS },
  run: async (p) => {
    const name = who(p), t = await resolve(target(p, true), name)
    did(name, "look")
    setAgent(name, { ...t, state: acting(name), pointed: Date.now() })
    return t
  },
  text: (r) => `Looking at ${placeText(r, paneById(r.pane)?.title)}.`,
})

plugin.op({
  id: "companion.say",
  cli: "companion say",
  summary: "Say something in a bubble by your cursor: your voice, for answers in the moment, how something works, quick replies.",
  help: `As long as it needs, no longer: it stays a while, longer the more it says, and its history is a click on your cursor.
With a place, your cursor goes there first. With ask, it's a question (shown as one, with a box to answer); ignored, it
fades, which means "stay quiet". What they'd want in the note tomorrow goes in it (edit); a thought by a line, a comment.

  vau companion say "Done: three tasks added below."
  vau companion say "That date is a Sunday." --find "May 3"
  vau companion say "For you, or a note to yourself?" --ask
  vau companion say "This step needs a way back." --path Drawings/Plan.excalidraw --find login
  vau companion say "That's the failing test." --pane t3k2 --find "FAIL"
  vau companion say "Your sidebar's search is here." --ui button:switcher:open`,
  kind: "read",
  // (its place before its words: its bubble shows them as they come, where they belong)
  params: { ...PLACE, ask: { type: "boolean", description: "it asks them something: a question bubble they can answer in" },
    text: { type: "string", required: true, description: "what to say (Markdown)" }, as: AS },
  args: ["text"],
  run: async (p, ctx) => {
    const name = who(p)
    did(name, "say", undefined, str(p.text))
    const given = ROOTS.some((k) => p[k] !== undefined) || p.line !== undefined || p.find || p.x !== undefined
    const t = given ? await resolve(target(p, true), name) : {}
    setAgent(name, { ...t, state: acting(name), ...(given ? { pointed: Date.now() } : {}) })
    // (shown as it was written: its bubble, with its words and place as the call has them)
    const use = toolUse.getStore(), shown = use ? streams.get(use)?.note : undefined, was = shown ? notes.get(shown) : undefined
    // (its bubble closed as it was written: it stays closed, its words in its history)
    if (shown && !was) {
      const n: Note = { id: shown, kind: "say", agent: name, text: str(p.text), ...t, t: Date.now(), seen: true }
      keepSaid(n)
      return n
    }
    if (was) {
      Object.assign(was, { text: str(p.text), ...t, ...(p.ask ? { question: true } : {}) })
      broadcast({ t: "note", note: was })
      clearTimeout(timers.get(was.id))
      timers.set(was.id, setTimeout(() => dropNote(was.id), sayMs(str(p.text))))
    }
    const answers = was ? undefined : answering(name)
    const n = was ?? putNote({ kind: "say", agent: name, text: str(p.text), ...t, ...(p.ask ? { question: true } : {}), ...(answers ? { answers } : {}), writer: requestWriter.getStore() ?? { client: ctx.who.client, agent: ctx.who.agent } }, sayMs(str(p.text)))
    keepSaid(n)
    return n
  },
  text: () => "Said.",
})

// Its jobs (workers.ts): long work handed to a worker in a terminal, through one lifecycle (jobs.ts).
/** The ask agent `name` is answering: its summoned session's turn's, else its last. */
const askOf = (name: string) => (inSummoned.getStore() ? lane().last() : moments).findLast((m) => (m.kind === "ask" || m.kind === "point") && (m.for ? key(m.for) === key(name) : isMain(name)))
const jobs = jobOps(plugin, {
  askOf,
  say: (ctx, name, text) => plugin.host.call("companion.say", { text, ...(isMain(name) ? {} : { as: name }) }, ctx.who),
  did, who, as: AS, cards: (cards) => toScreens({ t: "jobs", jobs: cards }),
  // (a live edit's turn ending is told by its ring, not its news)
  // (a live edit's turn ending is told by its ring; a job just ready knocks, its proof to show; the rest is news)
  moved: (j, from) => void (liveEditing.moved(j, from) || (readyNow(j, from) && j.terminal ? proofs.moved(j, from) : jobNews(j.title, j.state, from)).catch(() => {})),
  warm: (j) => liveEditing.warm(j),
  onScreen: (link) => [...windows.values()].some((w) => { const tab = w.panes.find((p) => p.id === w.pane)?.tab; return !!tab && w.panes.some((p) => p.tab === tab && p.to === link) }),
})
captureOps(plugin, jobs)
teachOps(plugin)
// Knocks: background sessions asking for the user, one line at a pause, and their presences by the notch (knocks.ts).
const knocks = knockOps(plugin, { toScreens, listening: () => screens.size > 0, jobs: () => jobs.list(), off: () => mode() === "off", hidden: () => plugin.settings().island === false })
const liveEditing = liveEdits(plugin, {
  jobs,
  ctx: (from) => liveCtx(from),
  say: async (name, text, m) => {
    did(name, "say", undefined, text)
    keepSaid(putNote({ kind: "say", agent: name, text, ...placeOf(m) as Partial<Note>, ...(m.summoned ? { answers: answersOf(m) } : {}) }, sayMs(text)))
    setAgent(name, { state: "watching" })
  },
  seen: (name, why, m) => setAgent(name, { state: "watching", seen: true, why, ...placeOf(m) }),
  ring: (name, boxes) => screenDrawing.draw(name, boxes.map((b) => ({ type: "ring", at: [b.x, b.y, b.w, b.h] }))),
  fallback: (m) => void handOut(m),
  desktop: (name, args) => plugin.desktop(name, args),
})
walkOps(plugin, jobs)
/** A job's proof (proofs.ts): its ready knock, Show me playing the tour its worker saved, then Keep or Still broken. */
const proofs = proofOps(plugin, {
  jobs, knocks, tours,
  name: () => ownName(),
  screen: (name, t) => {
    const s = screenOf(name, { vaultite: ownTour(t) })
    // (a thing it names that's gone is said plainly, never played by the model instead)
    return s && { ...s, fallback: async () => false }
  },
  say: (text, o = {}) => plugin.host.call("companion.say", { text, ...(o.ask ? { ask: true } : {}) }, AS_TOOL, { report: "companion job-show" }),
  choices: async () => {
    if (!screens.size || !displaysOf(ownName()).length) return false
    const at = { area: "bottom" }
    await plugin.host.call("companion.draw", { say: "Keep it, or is it still broken?", marks: [
      { type: "button", label: "Keep", do: { ask: "Keep" }, at }, { type: "button", label: "Still broken", do: { ask: "Still broken" }, at }] }, AS_TOOL, { report: "companion job-show" })
    return true
  },
  clear: () => { stopFlips(); screenDrawing.clear({ agent: ownName() }) },
  open: (where) => plugin.host.call("companion.open", { path: where }, AS_TOOL, { report: "companion job-show" }),
  record: (id) => {
    const ws = lastScreen && screens.has(lastScreen) ? lastScreen : screens.size === 1 ? [...screens][0] : null
    if (!ws) return false
    send(ws, { t: "record", job: id })
    return true
  },
  urgency: async () => {
    if (setting("job_news") === "off") return "off"
    if (setting("job_news") !== "spoken" || setting("voice") === "off") return "normal"
    const block = await plugin.host.call("block.status", {}).then((r) => r.result as { now?: unknown } | null).catch(() => null)
    return block?.now ? "normal" : "high"
  },
  showing: (on) => {
    if (!on) { shown = null; return }
    const ds = Array.isArray(on.displays) ? on.displays.filter((x): x is ScreenRectLike => !!x && typeof x === "object" && ["x", "y", "width", "height"].every((k) => typeof (x as Record<string, unknown>)[k] === "number")).slice(0, 8) : []
    shown = { t: shown?.t ?? Date.now(), voice: on.voice, displays: ds.length ? ds : shown?.displays ?? [] }
  },
})
/** The coding agents it runs, as a terminal names them (claude_agent), and for what (the service "agents-used:companion"):
 *  its chat's while it's on, then its jobs'. `agent-limits` with `for: companion` shows these accounts first. */
plugin.provide("agents-used:companion", (): AgentUse[] => [
  ...(mode() === "off" ? [] : [{ agent: agentSetting(), as: "Companion chat" }]),
  { agent: jobs.jobsAgent(), as: "Jobs" },
])
/** How recent their last Talk key ask must be for a job's news to be said aloud. */
const AROUND_MS = 15 * 60_000
/** A job's news said in its voice, one line, only while they're at this Mac (a Talk key ask to its helper lately: never
 *  aloud at home from a phone's ask) and not in a focus block; else the menu bar's notification waits for them, silent. */
async function jobNews(title: string, state: string, from: string) {
  const text = jobSpoken({ title, state: state as JobState }, from), last = moments.findLast((m) => m.summoned)?.t ?? 0
  if (!text || setting("job_news") !== "spoken" || !jobTold(state, "spoken") || mode() === "off" || setting("voice") === "off" || Date.now() - last > AROUND_MS) return
  const block = await plugin.host.call("block.status", {}).then((r) => r.result as { now?: unknown } | null).catch(() => null)
  if (block?.now) return
  await plugin.desktop("voice:sample", { text, after: true })
}

/** The open task line `line` (1-based) of `src`, or the only one with `text`: its index, or -1. */
export function openTaskLine(src: string, line: number, text: string) {
  const lines = src.split("\n"), open = (l: string | undefined) => !!l && /^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s/.test(l) && (!text || l.includes(text))
  if (open(lines[line - 1])) return line - 1
  const all = lines.flatMap((l, i) => (open(l) ? [i] : []))
  return all.length === 1 ? all[0] : -1
}

const queues = new Map<string, Promise<unknown>>()
/** `fn` once the last one under `key` has ended, however it ended. */
function oneAtATime<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(fn, fn), tail = run.catch(() => {})
  queues.set(key, tail)
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key) })
  return run
}

plugin.op({
  id: "companion.do",
  cli: "companion do",
  summary: "Do it: hand a task to a worker, as the Do it on a task line does: a line of a note goes in progress ([/]), and the worker ticks it when it's done.",
  help: `What a user's tap on Do it runs: a line of a note (path, line; text, its words, finds it if it moved), or only words. The worker
starts at once through companion handoff.

  vau companion do --path Notes/Trip.md --line 12
  vau companion do --text "Compare the two flights in Notes/Trip.md"`,
  kind: "write",
  lock: false,
  params: { path: { type: "string", format: "path", description: "the note the task is in (Notes/Trip.md)" }, line: { type: "integer", minimum: 1, description: "its line, from 1" },
    text: { type: "string", description: "the task's words; without a path, all there is to go on" } },
  run: async (p, ctx) => {
    const rel = str(p.path), words = str(p.text).trim()
    if (!rel && !words) throw new OpError("say what: a note's path and line, or the task's text")
    // (set inside the queue: typed so it isn't read as always null after it)
    let line = "", at = 0, mark = null as { old: string; new: string } | null
    // (one tap at a time per note: two edits alike both merge, so two that read it open would both start a worker)
    if (rel) await oneAtATime(`do:${rel}`, async () => {
      const src = fs.readFileSync(plugin.vault.abs(rel), "utf8"), i = openTaskLine(src, Number(p.line) || 0, words), lines = src.split("\n")
      if (i < 0) throw new OpError(`no open task ${words ? `"${cut(words, 60)}" ` : ""}at line ${p.line} of ${rel}`, 404)
      line = lines[i]
      at = i + 1
      // In progress first: a second tap (another device's) finds it taken, and two workers never start.
      let before = ""
      // (the lines above it tell twins apart)
      for (let k = i - 1; k >= 0 && src.indexOf(before + line) !== src.lastIndexOf(before + line); k--) before = `${lines[k]}\n${before}`
      mark = { old: before + line, new: before + line.replace("[ ]", "[/]") }
      await ctx.op("file.edit", { path: rel, ...mark }).catch(() => { throw new OpError(`that task was just handed over, or changed: ${cut(line.trim(), 60)}`, 409) })
    })
    const said = rel ? line.replace(/^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s+/, "") : words
    const task = rel
      ? [`Do this task from the note ${rel} (line ${at}): ${said}`, "Read the note first: it's the context. When it's fully done, mark the line done (tasks_complete, or `[x]` with vau edit). If it needs the user (a decision, a sign-in, anything outward like a post or a message), leave it open and say what you need."].join("\n\n")
      : [`Do this: ${said}`, "If it needs the user (a decision, a sign-in, anything outward like a post or a message), stop and say what you need."].join("\n\n")
    try {
      return await ctx.op("companion.handoff", { task, say: `On it: ${cut(said, 60)}`, title: cut(said, 80) })
    } catch (e) {
      // (nobody's on it: the line's open again)
      if (mark) await ctx.op("file.edit", { path: rel, old: mark.new, new: mark.old }).catch(() => {})
      throw e
    }
  },
  text: (r) => `Handed off (${r.id}): "${r.title}", ${r.state}.`,
  did: (p) => ({ action: "run", text: `Do it: ${JSON.stringify(cut(str(p.text) || `${str(p.path)}:${p.line}`, 60))}` }),
})

plugin.op({
  id: "companion.pass",
  cli: "companion pass",
  summary: "Let what you were handed pass, saying why in a few words: the user sees it by your cursor's seen tick.",
  help: `When you choose not to act on a moment (not for you, they're still writing), rather than ending your turn in silence.

  vau companion pass "not for me"
  vau companion pass "waiting for you to finish"`,
  kind: "read",
  params: { reason: { type: "string", required: true, description: "why, in a few words (lower case, no period)" }, as: AS },
  args: ["reason"],
  run: async (p) => {
    const name = who(p), why = cut(str(p.reason).trim().replace(/[.\s]+$/, ""), 40)
    did(name, "pass")
    asking.delete(key(name))
    setAgent(name, { state: "watching", seen: true, ...(why ? { why } : {}) })
    return { why }
  },
  text: () => "Passed: end your turn.",
})

plugin.op({
  id: "companion.place",
  cli: "companion place",
  summary: "Put an agent's bubble in the note, as its words: after the paragraph it was said by (the user's call, Put in note).",
  kind: "write",
  lock: false,
  params: { id: { type: "string", required: true, description: "the bubble (a say's id)" } },
  args: ["id"],
  run: async (p, ctx) => {
    if (!byUser(ctx.who)) throw new OpError("only the user moves an agent's words (Put in note on its bubble)", 403)
    return await place(str(p.id))
  },
  text: (r) => `Put in ${r.path} at line ${r.line}.`,
})

plugin.op({
  id: "companion.fold",
  cli: "companion fold",
  summary: "Show what an agent wrote in a note as its bubble instead (the app takes its lines out of the note): the user's call.",
  kind: "write",
  lock: false,
  params: { as: { type: "string", required: true, description: "the agent that wrote it" }, path: { type: "string", required: true, format: "path", description: "the note" },
    line: LINE, text: { type: "string", required: true, description: "what it wrote" } },
  run: async (p, ctx) => {
    if (!byUser(ctx.who)) throw new OpError("only the user moves an agent's words (Fold into a bubble)", 403)
    const n = fold(str(p.as), str(p.path), Number(p.line) || 1, str(p.text).slice(0, MAX_TEXT))
    return { id: n.id }
  },
  text: (r) => `Folded into bubble ${r.id}.`,
})

plugin.op({
  id: "companion.comment",
  cli: "companion comment",
  summary: "Leave a comment in the margin by a line, until the user dismisses it; they can reply (a reply moment).",
  help: `For what's worth keeping a moment: an answer to their ask, a thought on what they wrote. Replying to their reply to
it: with id (the comment's), your words join its thread.

  vau companion comment "Alice moved this to Thursday." --path Notes/Plans.md --find "Meet Alice"
  vau companion comment "Yes, both work." --id n12`,
  kind: "write",
  lock: false,
  // (its place before its words: the model writes them in this order, so its card shows them as they come)
  params: { id: { type: "string", description: "a comment to reply in" }, path: PATH, line: LINE, find: FIND,
    text: { type: "string", required: true, description: "the comment (Markdown, short)" }, as: AS },
  args: ["text"],
  run: async (p) => {
    const name = who(p)
    did(name, "comment")
    // (shown as it was written: that card or reply, with its words as the call has them)
    const use = toolUse.getStore(), s = use ? streams.get(use) : undefined
    // (dismissed as it was written: it stays dismissed, with all its words)
    const gone = s?.reply && !notes.has(s.reply.id) ? s.reply.id : s?.note && !notes.has(s.note) ? s.note : undefined
    if (gone) {
      const n = [...past.values()].flat().find((x) => x.id === gone)
      if (!n) return { id: gone }
      const r = s!.reply && n.replies?.[s!.reply.at]
      if (r) r.text = str(p.text); else if (!s!.reply) n.text = str(p.text)
      save(n.path!)
      return n
    }
    if (s?.reply && notes.get(s.reply.id)?.replies?.[s.reply.at]) {
      const n = notes.get(s.reply.id)!
      n.replies![s.reply.at].text = str(p.text)
      broadcast({ t: "note", note: n })
      save(n.path!)
      return n
    }
    const shown = s?.note ? notes.get(s.note) : undefined
    // (a reply after all, its id after its words: the card its words showed in goes)
    if (shown && p.id) { s!.note = undefined; dropNote(shown.id) }
    else if (shown) {
      const t = target(p), anchor = !t.find && t.line ? lineText(t.path!, t.line) : ""
      Object.assign(shown, { text: str(p.text), ...t, ...(anchor ? { anchor } : {}) })
      broadcast({ t: "note", note: shown })
      save(shown.path!)
      return shown
    }
    if (p.id) {
      // (a word in a dismissed thread brings it back to the margin)
      const n = notes.get(p.id) ?? reopen(p.id)
      if (!n || n.kind !== "comment") throw new OpError(`there's no comment ${p.id}`, 404)
      n.replies = [...(n.replies ?? []), { by: "agent", text: str(p.text), t: Date.now(), ...(n.by ? { name } : {}) }]
      broadcast({ t: "note", note: n })
      save(n.path!)
      setAgent(name, { path: n.path, line: n.line, find: n.find, state: acting(name) })
      return n
    }
    const t = target(p)
    notOnDrawing(t, "say it by an element (companion say --find <id>), or draw a text (companion draw)")
    setAgent(name, { ...t, state: acting(name) })
    const anchor = !t.find && t.line ? lineText(t.path!, t.line) : ""
    return putNote({ kind: "comment", agent: name, text: str(p.text), ...t, ...(anchor ? { anchor } : {}) })
  },
  text: (r) => `Commented (${r.id}).`,
  did: (p) => ({ action: "ui", text: `Commented in ${str(p.path) || focus()?.path || "a note"}`, paths: [], by: who(p) }),
})

plugin.op({
  id: "companion.suggest",
  cli: "companion suggest",
  summary: "Suggest a change in a note: shown struck through and in your colour; the user takes it (Tab) or not (Esc).",
  help: `find is the text to change, exactly as in the file; replace what it becomes (empty: removed). An accept or reject
moment tells you what they chose.

  vau companion suggest --path Notes/Idea.md --find "recieve" --replace "receive"
  vau companion suggest --find "We could maybe try" --replace "We'll try" --why "Firmer"`,
  kind: "write",
  lock: false,
  params: { find: { ...FIND, description: "the text to change, exactly as in the file" }, replace: { type: "string", required: true, description: "what it becomes" },
    why: { type: "string", description: "a few words on why, by it" }, path: PATH, line: LINE, as: AS },
  run: async (p) => {
    if (!str(p.find)) throw new OpError("give `find`: the text to change")
    const name = who(p), t = target(p)
    notOnDrawing(t, "change it with companion draw")
    did(name, "suggest")
    setAgent(name, { ...t, state: acting(name) })
    return putNote({ kind: "suggestion", agent: name, ...t, replace: str(p.replace), ...(str(p.why) ? { text: str(p.why) } : {}) })
  },
  text: (r) => `Suggested (${r.id}).`,
  did: (p) => ({ action: "ui", text: `Suggested a change in ${str(p.path) || focus()?.path || "a note"}`, paths: [], by: who(p) }),
})

// ---------- proposals: a large change as a shadow copy, shown as tracked changes and taken in part

const changeId = () => `c${Math.random().toString(36).slice(2, 6)}`
const firstLine = (s: string) => s.split("\n")[0] || undefined
/** A note's text as the app has it (its open editor's typing saved). */
const textOf = async (ctx: OpCtx, p: string) => String((await ctx.api("GET", `file?path=${encodeURIComponent(p)}`)).text ?? "")

/** A proposal's place (where its card sits): its first change that still fits. True when it moved. */
function placeAt(n: Note) {
  const c = n.changes?.find((x) => !x.stale && !x.intent) ?? n.changes?.[0]
  if (!c || (n.line === c.line && n.find === firstLine(c.find))) return false
  n.line = c.line
  if (firstLine(c.find)) n.find = firstLine(c.find); else delete n.find
  return true
}
/** A proposal's changes found again in the note's text (their lines as it changes; stale once their text is gone).
 *  True when any moved. */
function refind(n: Note, text: string) {
  let moved = false
  for (const c of n.changes ?? []) {
    const at = changeAt(text, c), line = at < 0 ? c.line : text.slice(0, at).split("\n").length
    if (line === c.line && !c.stale === at >= 0) continue
    c.line = line
    if (at < 0) c.stale = true; else delete c.stale
    moved = true
  }
  if (placeAt(n)) moved = true
  if (moved) broadcast({ t: "note", note: n })
  return moved
}

/** Propose `next` for note `p` (now `cur`): cut into changes, as a new proposal or filling `into` (its placeholders
 *  go). The frontmatter stays when `next` leaves it out. */
function proposeText(ctx: OpCtx, name: string, p: string, next: string, cur: string, why = "", into?: Note) {
  const fm = /^---\n[\s\S]*?\n---\n\n*/.exec(cur)?.[0]
  if (fm && !next.startsWith("---\n")) next = fm + next.replace(/^\n+/, "")
  const changes = changesOf(cur, next, changeId)
  if (!changes.length) throw new OpError("it's the note as it is: nothing to propose")
  did(name, "propose")
  setAgent(name, { path: p, line: changes[0].line, state: acting(name) })
  const writer = { client: ctx.who.client, agent: ctx.who.agent }
  if (!into) return putNote({ kind: "proposal", agent: name, path: p, line: changes[0].line, ...(firstLine(changes[0].find) ? { find: firstLine(changes[0].find) } : {}), changes, writer, ...(why ? { text: why } : {}) })
  Object.assign(into, { changes, writer, t: Date.now() }, why ? { text: why } : {})
  placeAt(into)
  broadcast({ t: "note", note: into })
  save(p)
  return into
}

/** Take a change: typed in by the window showing the note (else written), as its agent's (Provenance, History). */
async function take(n: Note, c: Change) {
  const writer: Writer = n.writer ?? { client: "cli", agent: n.agent }
  await requestWriter.run(writer, () => applyEdit(apiCtx, agentOf(n.agent), { path: n.path!, find: c.find, line: c.line, text: c.text }, false))
}

/** Take or leave a proposal's changes: one, or all those not decided (a stale one can only be left; leaving all takes
 *  its placeholders too). Once none is left it closes, and its agent hears what was taken. */
export async function review(id: string, verdict: "accept" | "reject", change?: string, from?: IncomingMessage) {
  const n = notes.get(id)
  if (!n || n.kind !== "proposal") throw new OpError(`there's no proposal ${id}`, 404)
  const picked = (n.changes ?? []).filter((c) => (change ? c.id === change : verdict === "reject" || (!c.intent && !c.stale)))
  if (change && !picked.length) throw new OpError(`proposal ${id} has no change ${change}`, 404)
  let took = 0, left = 0, failed = 0
  for (const c of picked) {
    if (verdict === "accept") {
      if (c.intent || c.stale) { failed++; continue }
      try { await take(n, c); took++ } catch { c.stale = true; failed++; continue }
    } else if (!c.intent) left++
    n.changes = (n.changes ?? []).filter((x) => x !== c)
  }
  n.took = (n.took ?? 0) + took; n.left = (n.left ?? 0) + left
  const open = n.changes?.length ?? 0
  if (open) {
    placeAt(n)
    broadcast({ t: "note", note: n })
    save(n.path!)
  } else {
    dropNote(id)
    const all = n.took + n.left
    addMoment({ kind: n.took ? "accept" : "reject", for: n.agent, item: id, path: n.path, line: n.line,
      text: `${n.took === all ? "took all" : n.took ? `took ${n.took} of` : "left all"} ${all === 1 ? "the change" : `${all} changes`} of your proposal${n.text ? ` (${cut(n.text, 80)})` : ""}` }, from)
  }
  return { id, took, left, failed, open }
}

plugin.op({
  id: "companion.propose",
  cli: "companion propose",
  summary: "Propose a large change to a note: shown as tracked changes in your colour that the user takes or leaves one by one. None of it is in the file until they take it.",
  help: `For a change too big to type in before their eyes: a rewrite, a section, several places at once. Give the note as
you'd have it (text: a shadow copy, which is cut into changes; its frontmatter may be left out), or one stretch (find and
replace). While you work it out, you may first plant a placeholder where it will land (pending: what's coming; find: the
text of the line it comes after), then propose with its id to fill it. A companion edit replacing more than ${BIG_EDIT} lines
becomes a proposal by itself. An accept or reject moment says what they took ("took 3 of 4 changes").

  vau companion propose --path Notes/Plan.md --pending "Risks: checking last week's notes" --find "## Risks"
  vau companion propose --id n4k2 --path Notes/Plan.md --text "$(cat /tmp/plan.md)" --why "Tighter, risks updated"
  vau companion propose --find "We could maybe try" --replace "We'll try" --why "Firmer"`,
  kind: "write",
  lock: false,
  params: { text: { type: "string", description: "the whole note as you'd have it (its frontmatter may be left out)" },
    find: { ...FIND, description: "with replace: the text to change, exactly as in the file; with pending: text of the line it comes after" },
    replace: { type: "string", description: "what find becomes (empty: removed)" },
    pending: { type: "string", description: "a placeholder: what you're writing, shown where it will land until you propose" },
    why: { type: "string", description: "a few words on why, on its card" },
    id: { type: "string", description: "your proposal to fill (its placeholders), or to add a placeholder to" }, path: PATH, line: LINE, as: AS },
  run: async (p, ctx) => {
    const name = who(p), into = p.id ? notes.get(str(p.id)) : undefined
    if (p.id && (!into || into.kind !== "proposal")) throw new OpError(`there's no proposal ${str(p.id)}`, 404)
    if (into && key(into.agent) !== key(name)) throw new OpError(`proposal ${into.id} is ${into.agent}'s`, 403)
    const t = into ? { ...target({ ...p, path: into.path }) } : target(p), path = t.path!
    notOnDrawing(t, "change it with companion draw")
    const cur = await textOf(ctx, path)
    if (str(p.pending)) {
      if (!t.find && t.line === undefined) throw new OpError("with pending, give find (the text of the line it comes after) or line")
      const at = t.find ? nearest(cur, t.find, t.line) : -1
      if (t.find && at < 0) throw new OpError(`"${cut(t.find, 60)}" isn't in the file: read it again and copy the text exactly`)
      const line = at >= 0 ? cur.slice(0, at).split("\n").length : Math.max(1, Math.min(t.line!, cur.split("\n").length))
      const c: Change = { id: changeId(), find: at >= 0 ? t.find! : cur.split("\n")[line - 1] ?? "", text: "", line, intent: cut(str(p.pending), 200) }
      did(name, "propose")
      setAgent(name, { path, line, find: firstLine(c.find), state: "writing" })
      if (!into) return putNote({ kind: "proposal", agent: name, path, line, ...(firstLine(c.find) ? { find: firstLine(c.find) } : {}), changes: [c], writer: { client: ctx.who.client, agent: ctx.who.agent } })
      into.changes = [...(into.changes ?? []), c]
      placeAt(into)
      broadcast({ t: "note", note: into })
      save(path)
      return into
    }
    let next: string
    if (str(p.text)) next = str(p.text)
    else if (t.find && p.replace !== undefined) next = editText(cur, { find: t.find, line: t.line, text: str(p.replace) })
    else throw new OpError("give text (the note as you'd have it), find and replace, or pending")
    return proposeText(ctx, name, path, next, cur, str(p.why), into)
  },
  text: (r: Note) => {
    const ready = (r.changes ?? []).filter((c) => !c.intent), waits = (r.changes?.length ?? 0) - ready.length
    if (!ready.length) return `Placeholder planted (proposal ${r.id}): propose with --id ${r.id} and the text to fill it.`
    const sum = ready.reduce((a, c) => { const x = tally(c); return { come: a.come + x.come, gone: a.gone + x.gone } }, { come: 0, gone: 0 })
    return `Proposed ${ready.length === 1 ? "1 change" : `${ready.length} changes`} (+${sum.come} −${sum.gone} lines) in ${r.path} (${r.id})${waits ? `, ${waits} placeholder${waits === 1 ? "" : "s"} still waiting` : ""}: the user takes or leaves each.`
  },
  did: (p) => ({ action: "ui", text: `Proposed a change to ${str(p.path) || focus()?.path || "a note"}`, paths: [], by: who(p) }),
})

plugin.op({
  id: "companion.review",
  cli: "companion review",
  summary: "Take or leave an agent's proposal: all its changes, or one (the user's call: agents propose, people decide).",
  help: `  vau companion review n4k2 accept
  vau companion review n4k2 reject --change c8f1`,
  kind: "write",
  lock: false,
  params: { id: { type: "string", required: true, description: "the proposal (n4k2)" },
    verdict: { type: "string", required: true, enum: ["accept", "reject"], description: "accept: take them (written as its agent's); reject: leave them" },
    change: { type: "string", description: "one of its changes (c8f1); default: all those that still fit" } },
  args: ["id", "verdict"],
  run: async (p, ctx) => {
    if (!byUser(ctx.who)) throw new OpError("only the user takes or leaves a proposal (in the app, or vau typed by hand)", 403)
    return review(str(p.id), p.verdict === "accept" ? "accept" : "reject", str(p.change) || undefined)
  },
  text: (r) => `Took ${r.took}, left ${r.left}${r.failed ? `; ${r.failed} no longer fit${r.failed === 1 ? "s" : ""} the note` : ""}${r.open ? `; ${r.open} still open` : "; it's closed"}.`,
})

plugin.op({
  id: "companion.edit",
  cli: "companion edit",
  summary: "Write in a note: typed in before the user's eyes when it's open (they can undo it), else saved to the file.",
  help: `Only in pair mode or when they asked you to. find and text: find replaced by text. after and text: new lines after
the line with that text. Else new lines after line (0: at the top), or at the end. Prefer find or after: a line number
goes stale as they type. Edits of a note go one at a time; each returns once it's in. In the app's chat your words are
typed in as you write them, its place first; your cursor stays at their end.

  vau companion edit --path Notes/Idea.md --find "- [ ] Call Alice" --text "- [x] Call Alice"
  vau companion edit --after "## Budget" --text "- Ask Ben about the budget"`,
  kind: "write",
  lock: false,
  // (its place before its words: the model writes them in this order, so its words are typed in as they come)
  params: { path: PATH, find: { type: "string", description: "the text it replaces, exactly as in the file" },
    after: { type: "string", description: "new lines go after the line with this text (exactly as in the file)" },
    line: LINE, append: { type: "boolean", description: "at the end of the file" }, text: { type: "string", required: true, description: "what to write" }, as: AS },
  args: ["text"],
  run: async (p, ctx) => {
    const name = who(p), t = target(p), after = str(p.after) || undefined
    notOnDrawing(t, "change it with companion draw")
    // (a big change is never a silent rewrite: it comes as a proposal)
    if (t.find && linesIn(t.find) > BIG_EDIT) {
      const cur = await textOf(ctx, t.path!)
      const n = proposeText(ctx, name, t.path!, editText(cur, { find: t.find, line: t.line, text: str(p.text) }), cur)
      return { path: t.path, how: "proposed", id: n.id }
    }
    did(name, "edit")
    const use = toolUse.getStore(), s = use ? streams.get(use) : undefined
    if (s?.edit) {
      // (typed in as it was written: its last words, then it's done)
      const x = s.edit
      x.text = x.e.text = str(p.text)
      finishStream(s)
      try {
        const how = await x.job
        if (how === "stopped") throw new OpError("the user stopped you (Esc) as you wrote it: what you had typed by then stays", 409)
        // (no window could show it as it came: made like any edit, written to the file)
        return { path: x.e.path, how: how === "typed" ? how : await applyEdit(ctx, agentOf(name), x.e) }
      } finally { setAgent(name, { state: acting(name) }) }
    }
    const a = setAgent(name, { ...t, ...(after ? { find: after } : {}), state: "writing" })
    try {
      const how = await applyEdit(ctx, a, { path: t.path!, find: t.find, after, line: t.line, text: str(p.text), append: !!p.append })
      return { path: t.path, how }
    } finally { setAgent(name, { state: acting(name) }) }
  },
  text: (r) => (r.how === "proposed" ? `Proposed it in ${r.path} instead (${r.id}): it replaces more than ${BIG_EDIT} lines, so the user takes it or not.`
    : `${r.how === "typed" ? "Typed into" : "Wrote"} ${r.path}.`),
  did: (p) => edited(p),
})

/** An edit as Activity lists it: by the agent's name in the app (Ada), not the coding agent it runs on. */
function edited(p: Record<string, unknown>) {
  const path = str(p.path) || focus()?.path || ""
  return { action: "edit" as const, text: path ? `Edited ${path}` : "Edited a note", paths: path ? [path] : [], by: who(p) }
}

plugin.op({
  id: "companion.highlight",
  cli: "companion highlight",
  summary: "Highlight text in your colour: in a note (for a while, or kept as ==🟠text== with keep), on a drawing an element, in a pane a terminal's text or a page's element, or the app's UI.",
  help: `  vau companion highlight --find "the budget is due Friday"
  vau companion highlight --path Notes/Idea.md --find "key insight" --keep`,
  kind: "write",
  lock: false,
  params: { find: { ...FIND, description: "the text to highlight, exactly as in the file (in a terminal, on its screen)" }, keep: { type: "boolean", description: "keep it in the file, as a highlight of your colour" },
    path: PATH, line: LINE, pane: PANE, ui: UI, row: ROW, el: EL, as: AS },
  run: async (p, ctx) => {
    const name = who(p), t = await resolve(target(p, true), name)
    if (!t.find && !t.el && !t.ui && !t.row) throw new OpError("give `find`: the text to highlight (in a page, `el`; in the app, `ui`)")
    if (!t.path && p.keep) throw new OpError("keep is for notes")
    did(name, "highlight")
    if (p.keep) notOnDrawing(t, "keep is for notes; its highlight is your selection there for a while")
    const a = setAgent(name, { ...t, state: acting(name), pointed: Date.now() })
    if (!p.keep) return putNote({ kind: "highlight", agent: name, ...t }, HIGHLIGHT_MS)
    await applyEdit(ctx, a, { path: t.path!, find: t.find, line: t.line, text: `==${EMOJI[a.tint] ?? ""}${t.find}==` }, false)
    return { path: t.path, kept: true }
  },
  text: (r) => (r.kept ? `Highlighted in ${r.path}.` : `Highlighted (${r.id}).`),
  did: (p) => (p.keep ? edited(p) : { action: "ui", text: `Highlighted text in ${str(p.path) || focus()?.path || "a note"}`, paths: [] }),
})

// ---------- in panes: what one shows now, acting in the user's own page, following, and keeping a follow as a watch

/** A page's tree as the companion is given it, at most this long. */
const SNAPSHOT = 12_000
plugin.op({
  id: "companion.see",
  cli: "companion see",
  summary: "What a pane of the user's window shows now (a terminal's screen, a web page as its accessibility tree with refs to point at and act on, a note's text), or a part of the app's own UI (a sidebar panel's rows).",
  help: `For an ask or a point about a pane (the look: a snapshot only then, not to keep an eye on it: that's follow). A
private page or note is never shown.

  vau companion see --pane t5x1
  vau companion see --ui panel:files:files`,
  kind: "read",
  lock: false,
  params: { pane: { ...PANE, description: "the pane (its id: vau tabs; default: the one the user is in)" },
    ui: { ...UI, description: "instead of a pane: the app's own UI by its id (panel:files:files, tab:<id>): what it shows now" }, as: AS },
  run: async (p, ctx) => {
    if (str(p.ui)) {
      const ui = str(p.ui), r = await ctx.ui({ action: "companion:read", ui }).catch(() => null) as { found: boolean; label?: string; folded?: boolean; text?: string } | null
      if (!r?.found) throw new OpError(`${ui} isn't on the user's screen (act --ui shows a place)`, 404)
      return { ui, title: r.label || ui, kind: "ui", text: r.folded ? "(folded: only its heading shows; act expand --ui opens it)" : r.text ?? "" }
    }
    const id = str(p.pane) || paneFocus()?.id, pn = paneById(id)
    if (!pn) throw new OpError(id ? `no pane ${id} in the user's window (vau tabs lists them)` : "give `pane`: the user isn't in one", 404)
    if (privatePane(pn)) throw new OpError("that pane is private: the companion never sees it", 403)
    const x = paneSource(pn.to)
    if (x.kind === "terminal") return { pane: pn.id, title: pn.title, kind: "terminal", text: await plugin.ask<string>("terminal:screen", "", x.terminal, 80) }
    if (x.kind === "note") { let text = ""; try { text = readText(plugin.vault.abs(x.path!)) } catch { /* gone */ } return { pane: pn.id, title: pn.title, kind: "note", path: x.path, text: cut(text, SNAPSHOT) } }
    if (x.kind !== "site") return { pane: pn.id, title: pn.title, kind: "view", text: "" }
    const t = await pageFor(pn.id, "read", who(p))
    const r = await plugin.desktop("agent:snapshot", t.tab).catch((e) => { throw new OpError((e as Error).message, 409) }) as { url: string; title: string; snapshot: string }
    return { pane: pn.id, title: r.title || pn.title, kind: "site", url: r.url, access: t.access, text: cut(r.snapshot, SNAPSHOT) }
  },
  text: (r) => `"${r.title}" (${"ui" in r ? r.ui : `pane ${r.pane}`}${"url" in r && r.url ? `, ${r.url}` : ""}${"access" in r && r.access === "read" ? "; you may only read here" : ""}):\n${r.text || "(nothing to read)"}`,
})

type Acted = { url: string; title: string; navigated: boolean; opened?: { tab: number; url: string; title: string }[]; diff?: { page: boolean; lines: string[]; more: number } }
/** What an act in a page did, as told: the page's text is all it sees, so no change there isn't "nothing happened". */
function actText(r: Acted, action: string) {
  const opened = r.opened?.length ? `\nOpened ${r.opened.map((o) => o.title || o.url).join(", ")} in a new tab.` : ""
  const lines = r.diff?.lines?.length ? `\n${r.diff.page ? "The page now" : "What changed (- gone, + new)"}:\n${r.diff.lines.join("\n")}${r.diff.more ? `\n… ${r.diff.more} more lines` : ""}` : ""
  const none = lines || opened ? "" : action === "scroll" ? "\nScrolled; the page's text is the same (see shows what's in view)." : "\nIts text didn't change (a change only its picture shows isn't in it: see, or look at the screen)."
  return `${r.navigated ? "Went to another page: " : ""}${r.title || r.url}${opened}${lines}${none}`
}
type InApp = { ui: string; clicked: string; role?: string; opened?: boolean; already?: boolean; ok?: boolean; saw?: string; shows?: string; notices?: { text: string; kind?: string }[] }
/** What an act in the app did, as read back: done, already so, or plainly not ("nothing changed"), and what shows now. */
function actInAppText(r: InApp, action: string) {
  const what = r.clicked ? JSON.stringify(r.clicked) : r.ui
  const head = r.already ? `Nothing to do: ${r.saw}.` : r.ok === false ? `${r.opened ? "Asked the app to show" : action === "click" ? "Pressed" : `Tried to ${action}`} ${what}, but ${r.saw ?? "nothing changed"}: tell them plainly, or try another way.`
    : `${r.opened ? `Showed ${what}` : action === "click" ? `Pressed ${what}` : `${action[0].toUpperCase()}${action.slice(1)}ed ${what}`} in the app${r.saw ? `: ${r.saw}` : ""}.`
  const notices = r.notices?.length ? ` It then showed: ${r.notices.map((n) => `${JSON.stringify(n.text)}${n.kind === "error" ? " (an error)" : ""}`).join(", ")}.` : ""
  return `${head}${notices}${r.shows ? `\n${r.ui ? `${r.ui} shows now` : "It shows now"} (point at a row by its words, [point "<words>"]):\n${r.shows}` : ""}`
}
/** How long its cursor flies before it clicks, so they see where. */
const LAND_MS = 450
/** The acts the app's own UI takes: a press, or a state asked for (expand: pressed only when folded). */
const IN_APP = ["click", "dblclick", "expand", "collapse", "check", "uncheck", "select"]
/** An act on the app's own UI, its cursor there first (index.tsx' answers.click): the target by its id or its role and
 *  words, resolved to the part that acts, its state read back. Only what's on screen, or a place the app can show. */
async function actInApp(ctx: OpCtx, name: string, ui: string, find: string, action: string, role = ""): Promise<InApp> {
  if (!IN_APP.includes(action)) throw new OpError(`in the app's own UI it does ${IN_APP.join(", ")}: to write in a note, edit; in a page, give its pane`, 400)
  did(name, "act")
  // (words anywhere in the window: no place to fly to first, as find alone would mean their note's words)
  setAgent(name, { ...(ui ? { ui, ...(find ? { find } : {}) } : {}), state: "writing", pointed: Date.now() })
  await new Promise((done) => setTimeout(done, LAND_MS))
  try {
    const r = await ctx.ui({ action: "companion:click", ui, find, role, how: action }).catch((e) => {
      throw e instanceof OpError && e.status === 409 ? new OpError("no app window is open on this server: open the app first", 409) : e
    }) as ({ found: boolean; label?: string } & Omit<InApp, "ui" | "clicked">) | null
    if (r?.found) { const { found: _f, label, ...rest } = r; return { ui, clicked: label ?? "", ...rest } }
    throw new OpError(find ? `no ${role ? `${role} ` : ""}"${find}" in ${ui || "the app's window"} on the user's screen (use its words as shown)`
      : `${ui} isn't on the user's screen, and the app can't show it (vau tabs lists tabs and panes)`, 404)
  } finally { setAgent(name, { state: acting(name) }) }
}

const ACTS = ["click", "dblclick", "rightclick", "hover", "fill", "type", "press", "check", "uncheck", "select", "scroll", "focus", "expand", "collapse"]
/** A step in another app (take-over): an element their ask listed, a screen point, or (asked there) the field with the keys. */
function onScreen(p: Record<string, unknown>, name: string) {
  if (str(p.ax) || p.sx !== undefined || str(p.app)) return true
  if (str(p.pane) || str(p.el)) return false
  const m = moments.findLast((x) => (x.kind === "ask" || x.kind === "point") && (!x.for || key(x.for) === key(name)))
  return !!m?.summoned && !!m.app && m.app !== "private" && !m.pane && !m.ui
}
async function screenAct(p: Record<string, unknown>, name: string) {
  let step: ReturnType<typeof stepOf>
  try { step = stepOf({ action: str(p.action), ax: str(p.ax) || undefined, sx: p.sx === undefined ? undefined : Number(p.sx), sy: p.sy === undefined ? undefined : Number(p.sy),
    value: p.value === undefined ? undefined : str(p.value), key: str(p.key) || undefined, direction: str(p.direction) || undefined, doing: str(p.doing) || undefined,
    app: str(p.app) || undefined, find: str(p.find) || undefined, role: str(p.role) || undefined }, nearBy.get(key(name)) ?? []) } catch (e) { throw new OpError((e as Error).message, 404) }
  did(name, "act")
  // (its cursor flies there first: the helper waits for it; behind their windows, its card shows where instead)
  if ((step.el || step.at) && !step.app) setAgent(name, { ...await resolve(target(p, true), name), state: "writing", pointed: Date.now() })
  try {
    const r = await takeover.act(step, { agent: name, tint: agentOf(name).tint, ask: str(p.ask) || undefined }), was = nearBy.get(key(name)) ?? []
    // (helper's ids are fresh each step: what's near now is what the next points at)
    const near = (r.near ?? []).flatMap((e) => { const t = thingFrom(e); return t?.id ? [t as Near] : [] }), read = { ...r, ...(r.near ? { near } : {}) }
    if (near.length) nearBy.set(key(name), near)
    const effect = effectOf(str(p.action), read, was), done = effect ? { ...read, effect } : read
    return { screen: true, ...done, text: doneText(done) }
  } finally { setAgent(name, { state: acting(name) }) }
}
plugin.op({
  id: "companion.act",
  cli: "companion act",
  owner: "The companion's actions",
  summary: "Act in the user's own web page, the app's UI or (asked on the screen) another app, with your cursor there: click, fill, type, press a key, pick an option, scroll.",
  help: `Their tab, before their eyes: as in their notes, act when that's what they want (they asked, or it's plainly the
next step); a long errand goes to a page of your own instead (vau browser open --task, its tab group yours), told with a
say. Only where its container lets agents act, never on a private page. Answers what changed on the page.

In another app (take-over, an ask on the screen): an element the ask listed (--ax), a point (--sx --sy), or the field
with the keys (neither). With --app, in that app's window behind theirs: their pointer and front app stay theirs, a card
shows its window and what you do; the element by its words (--find), each step read back there, and offered in front
when it can't be confirmed. They're asked first (a card by the pointer, --ask its line), a yes lasting the exchange; a
send, post or delete is asked each time. Your cursor says what it does (--doing, else made from the step); their mouse
or keys pause a step that needs them, a click or Esc stops it. Answers the elements there now, by id.

  vau companion act --pane t5x1 click --el e12
  vau companion act --pane t5x1 fill --el e5 --value "alice@example.com"
  vau companion act click --ax a3 --ask "Want me to turn on dark mode?"
  vau companion act fill --ax a5 --value "Lighthouse" --doing "Typing the title"
  vau companion act press --key cmd+s
  vau companion act click --app Calculator --find "7"
  vau companion act type --app TextEdit --value "Lighthouse notes"`,
  kind: "write",
  lock: false,
  params: { pane: PANE, ui: { ...UI, description: "instead of a page: the app's own UI, by its id (as in look); a place (panel:files:files) is shown, unfolded, and what it shows comes back" },
    find: { type: "string", description: "in the app's UI, or with --app in that app's window: the words of what to act on, as shown (in ui when given, else anywhere in its window)" },
    app: { type: "string", description: "another app to act in behind the user's window (its name: TextEdit), their pointer and front app left alone" },
    role: { type: "string", description: "with find: its role (button, tab, row, switch, checkbox, heading, link, menuitem, textbox), when the words alone could name two things" },
    action: { type: "string", required: true, enum: ACTS, description: "what to do" }, el: EL,
    ax: PLACE.ax, sx: PLACE.sx, sy: PLACE.sy, ask: { type: "string", description: "in another app: the line offering it, when they haven't said yes yet (Want me to...?)" },
    doing: { type: "string", description: "in another app: a few words by your cursor for this step (Typing the title); else made from the step" },
    value: { type: "string", description: "the text to fill or type, or the option to select (scroll: up or down)" }, key: { type: "string", description: "the key to press (Enter, Tab, Escape; in another app with modifiers: cmd+s)" },
    direction: { type: "string", enum: ["up", "down"], description: "which way to scroll" }, as: AS },
  args: ["action", "value"],
  run: async (p, ctx) => {
    const name = who(p)
    if (str(p.ui)) return actInApp(ctx, name, str(p.ui), str(p.find), str(p.action), str(p.role))
    // (an element their ask listed over Vaultite's own window: the same act, through its UI by id or role and name)
    const ask = askOf(name), own = str(p.ax) && ask && !awayIn([ask]) ? nearBy.get(key(name))?.find((e) => e.id === str(p.ax)) : undefined
    if (own) return actInApp(ctx, name, own.ui ?? "", own.ui ? "" : own.label, str(p.action), own.ui ? "" : own.role)
    if (onScreen(p, name)) return screenAct(p, name)
    // (words alone, in a note or a view: a button or row of the app's window saying them)
    if (str(p.find) && !str(p.pane) && !str(p.el) && paneSource(paneFocus()?.to ?? "").kind !== "site") return actInApp(ctx, name, "", str(p.find), str(p.action), str(p.role))
    if (p.action === "rightclick" || p.action === "focus") throw new OpError(`${String(p.action)} is for another app (--ax, --sx --sy)`)
    if (p.action === "expand" || p.action === "collapse") throw new OpError(`in a web page, click what opens or folds it`)
    const id = str(p.pane) || paneFocus()?.id
    if (!id) throw new OpError("give `pane` (a web page) or `ui` (the app's own UI): the user isn't in a web page")
    if (p.action === "scroll" && !p.direction && /^(up|down)$/i.test(str(p.value))) p = { ...p, direction: str(p.value).toLowerCase(), value: undefined }
    const t = await pageFor(id, "act", name)
    did(name, "act")
    if (str(p.el)) setAgent(name, { ...await resolve({ pane: id, el: str(p.el) }, name).catch(() => ({ pane: id })), state: "writing" })
    try {
      const r = await plugin.desktop("agent:act", t.tab, { action: p.action, ref: str(p.el) || undefined, value: p.value, key: p.key, direction: p.direction, diff: "summary" },
        { name, session: "", task: "", summary: "", remote: false }).catch((e) => { throw new OpError((e as Error).message, 409) }) as Acted
      return { pane: id, ...r }
    } finally { setAgent(name, { state: acting(name) }) }
  },
  text: (r, p) => ("screen" in r ? r.text : "clicked" in r ? actInAppText(r, String(p.action)) : actText(r, String(p.action))),
  did: (p) => ({ action: "ui", text: `${String(p.action)} in ${p.ui ? `the app (${String(p.ui)}${p.find ? ` "${String(p.find)}"` : ""})` : p.app ? `${String(p.app)}, behind their window${p.find ? ` ("${String(p.find)}")` : ""}` : p.ax || p.sx !== undefined ? "another app" : "the user's page"}${p.el || p.ax ? ` (${String(p.el || p.ax)})` : ""}`, paths: [], by: who(p) }),
})

/** What each agent's last check of another app read: what its next `changed` compares with. */
const checked = new Map<string, string>()
/** One condition (uimodel.ts' language: expanded "Files", shows "Saved", selected tab "Notes", changed) checked once where
 *  agent `name`'s last ask was: another app's window (its helper's Accessibility) or Vaultite's (its page). */
export async function checkNow(ctx: OpCtx, name: string, condition: string): Promise<Verdict & { where: string }> {
  let c
  try { c = parseCondition(condition) } catch (e) { throw new OpError((e as Error).message, 400) }
  const ask = askOf(name), away = ask ? awayIn([ask]) : ""
  if (away) {
    if (away === "a private app") throw new OpError("that app is private: the companion never reads it", 403)
    const r = await takeover.things()
    if (!r.ok) throw new OpError(r.text ?? "that app's window can't be read now", 409)
    const view = listView(r.things ?? []), v = checkOn(c, view, checked.get(key(name)))
    checked.set(key(name), view.snapshot())
    return { ...v, where: away }
  }
  const r = await ctx.ui({ action: "companion:check", condition }).catch((e) => {
    throw e instanceof OpError && e.status === 409 ? new OpError("no app window is open on this server: open the app first", 409) : e
  }) as Verdict | null
  // (a window still running the app from before it could check: it answers nothing)
  if (typeof r?.saw !== "string") throw new OpError("the app's window is out of date: it can check once it reloads", 409)
  return { ...r, where: "Vaultite" }
}
plugin.op({
  id: "companion.check",
  cli: "companion check",
  summary: "Check one state on the user's screen now, by reading it back: whether a section is open, a tab selected, a switch on, words shown, or anything changed since your last act.",
  help: `Where their last ask was: Vaultite's window, or the app they asked over. A thing is named by its role and words, as
it shows (role "name" [in "container"]), or by its id (ui:panel:files:files, a3). After an act, to know it worked.

  vau companion check 'expanded "Files"'
  vau companion check 'selected tab "Notes"'
  vau companion check 'not checked switch "Dark mode"'
  vau companion check 'shows "Saved"'
  vau companion check 'value textbox "Title" is "Lighthouse"'
  vau companion check changed`,
  kind: "read",
  lock: false,
  params: { condition: { type: "string", required: true, description: "[not] expanded|collapsed|selected|checked|unchecked|focused|disabled|exists|gone <target>; shows \"<words>\" [in <target>]; value <target> is \"<text>\"; changed" }, as: AS },
  args: ["condition"],
  run: (p, ctx) => checkNow(ctx, who(p), str(p.condition)),
  text: (r) => `${r.ok ? "Yes" : "No"}: ${r.saw} (${r.where}).`,
})

// ---------- opening things before their eyes: its cursor goes where it opens, as the CLI's opens do too

/** Set while its own open runs, so the CLI's wrap below doesn't fly it twice. */
const opening = new AsyncLocalStorage<boolean>()
/** Which of its sessions asked over the CLI (its session header): the summoned one, or an agent's own; else null. */
function companionAsking(): string | null {
  const sid = requestWriter.getStore()?.session
  if (!sid) return null
  if (laneOf?.vault === plugin.vault && lane().id() === sid) return ownName()
  return [...agents.values()].find((a) => session(a.name)?.id === sid)?.name ?? null
}
/** What a pane shows that `path` opens (a note, a folder's page, a view, a web address). */
function shows(p: Pane, path: string) {
  const x = path.replace(/^file:/, "")
  return /^https?:\/\//i.test(x) ? p.to === `view:web/${x}` || p.to.startsWith(`view:web/${x.replace(/\/$/, "")}`)
    : x.startsWith("view:") ? p.to === x : p.to === `file:${x}` || p.to === `file:${x}.md` || p.to === `view:folder/${x}`
}
/** Open `path` with its cursor there: on its tab first when it's open already, then on what opened. */
async function openSeen(name: string, path: string, open: () => Promise<unknown>) {
  const was = allPanes().find((p) => shows(p, path) && p.tab)
  if (was) { setAgent(name, { ui: `tab:${was.tab}`, state: "writing", pointed: Date.now() }); await new Promise((done) => setTimeout(done, LAND_MS)) }
  const focused = paneFocus()?.id
  const r = await opening.run(true, open)
  // (the window says what it shows a moment after)
  let p: Pane | undefined
  for (const until = Date.now() + 1500; !p && Date.now() < until;) {
    await new Promise((done) => setTimeout(done, 100))
    const f = paneFocus()
    p = allPanes().find((x) => shows(x, path)) ?? (f && f.id !== focused ? f : undefined)
  }
  p ??= paneFocus() ?? undefined
  if (p && !privatePane(p)) setAgent(name, { ...await resolve({ pane: p.id }, name).catch(() => ({ pane: p!.id })), state: acting(name), pointed: Date.now() })
  else setAgent(name, { state: acting(name) })
  return { result: r, pane: p?.id }
}
plugin.around("ui.open", async (call, next) => {
  const name = opening.getStore() ? null : companionAsking()
  return name ? (await openSeen(name, String(call.params.path ?? ""), () => next())).result : next()
})
plugin.around("ui.command", async (call, next) => {
  const name = companionAsking(), id = str(call.params.id)
  // (its button, where the window shows one: the cursor goes there as it runs)
  if (name && id) setAgent(name, { ui: `button:${id}`, state: "writing", pointed: Date.now() })
  try { return await next() } finally { if (name) setAgent(name, { state: acting(name) }) }
})
plugin.around("tabs.focus", async (call, next) => {
  const name = companionAsking(), what = str(call.params.what), tab = name && allPanes().find((p) => p.id === what || p.tab === what || shows(p, what))?.tab
  if (name && tab) { setAgent(name, { ui: `tab:${tab}`, state: "writing", pointed: Date.now() }); await new Promise((done) => setTimeout(done, LAND_MS)) }
  return next()
})
/** The ask a Mac open answered, by agent: its words name what's in that window now (screenFind looks there). */
const openedFor = new Map<string, Moment>()
plugin.op({
  id: "companion.open",
  cli: "companion open",
  summary: "Open what the user asked to see, your cursor flying there: a note, a folder, a view or a web page in their window, or on their Mac an app, a file or folder in its app, any address (a System Settings pane).",
  help: `For what they asked to see: a pinned page, a note, a site; on their Mac, what they could open themselves (an app,
~/Downloads in Finder, a System Settings pane by its address). It answers the pane it opened (a web page's: see and act
work there), or the Mac's window in front and what's in it by id (point, ring and act on those).

  vau companion open Personal/Dashboards/Today.md
  vau companion open https://example.com --split right
  vau companion open "x-apple.systempreferences:com.apple.Keyboard-Settings.extension"
  vau companion open ~/Downloads
  vau companion open --app Calculator`,
  kind: "write",
  lock: false,
  params: { path: { type: "string", description: "a vault path (or as they say it: Today), a folder, a view (view:graph), a web address, any other address (x-apple.systempreferences:..., mailto:...), or a path on their Mac (~/Downloads)" },
    app: { type: "string", description: "an app on their Mac to open (its name, Calculator, or bundle id), with path or the address in it if given" },
    split: { type: "string", enum: ["right", "down"], description: "in a pane beside (right) or below (down)" }, newTab: { type: "boolean", description: "in a new tab" },
    vaultite: { type: "boolean", description: "a web page in Vaultite even when they asked from their browser (where it opens, a new tab, by default)" }, as: AS },
  args: ["path"],
  run: async (p, ctx) => {
    const name = who(p), path = str(p.path), app = str(p.app), m = askOf(name)
    if (!path && !app) throw new OpError("give a path or an app")
    did(name, "open")
    // (asked from their browser: a page opens there, where they are, not in a pane of Vaultite's behind it)
    const browser = /^https?:\/\/\S+$/i.test(path) && !app && p.vaultite !== true && m?.summoned && m.app && isBrowser(m.app) ? m.app : ""
    const mac = browser ? { url: path, app: browser } : macOpen(path, app, plugin.vault.path, os.homedir())
    if (mac) {
      const r = await takeover.open(mac)
      if (!r.ok) throw new OpError(`it didn't open${mac.app ? ` in ${mac.app}` : ""}: ${r.text ?? r.why ?? "no answer"}${browser ? " (vaultite: true opens it in Vaultite)" : ""}`, 409)
      if (r.near?.length) { nearBy.set(key(name), r.near); if (m) openedFor.set(key(name), m) }
      if (r.frame) { const f = r.frame; void resolve(target({ sx: Math.round(f.x + f.width / 2), sy: Math.round(f.y + Math.min(f.height / 2, 120)) }, true), name).then((t) => setAgent(name, { ...t, state: acting(name), pointed: Date.now() }), () => {}) }
      return { path: path || app, pane: null, in: r.app || mac.app || "", title: r.title ?? "", near: r.near ?? [], browser: !!browser }
    }
    const r = await openSeen(name, path, () => ctx.op("ui.open", { path, ...(p.split ? { split: p.split } : {}), ...(p.newTab ? { newTab: true } : {}) }))
    return { path, pane: r.pane ?? null }
  },
  text: (r) => (r.browser ? `Opened ${r.path} in ${r.in}, a new tab there in front of them.`
    : r.in !== undefined ? `Opened ${r.path} on their Mac${r.in ? `: ${r.in}${r.title ? `, "${r.title}"` : ""} is in front` : ""}.${nearText(r.near as never, "In it now (point, ring or act by id)")}`
    : `Opened ${r.path}${r.pane ? ` (pane ${r.pane})` : ""}.`),
  did: (p) => ({ action: "ui", text: `Opened ${String(p.path || p.app)}`, paths: [], by: who(p) }),
})

const followText = (f: Follow) => `${f.id}: ${f.pane ? `pane ${f.pane}` : f.tab ? `tab ${f.tab}` : f.group ? `tab group ${f.group}` : f.ui}${f.title ? ` "${f.title}"` : ""}`
plugin.op({
  id: "companion.follow",
  cli: "companion follow",
  summary: "Follow a pane, a tab, a tab group or a part of the app for this session: what it does comes to you as change moments (a terminal at a command's end or its agent's state, a page at a navigation, a selection or a settled change).",
  help: `Only when they ask you to keep an eye on something now (pointing at it isn't asking). For
longer than this session, offer to keep it as a watch (companion keep). Without a pane, the list.

  vau companion follow --pane t3k2
  vau companion follow --tab tk3j2
  vau companion follow --group s1k2`,
  kind: "write",
  lock: false,
  params: { pane: PANE, tab: { type: "string", description: "a tab (its id: vau tabs): all its panes" }, group: { type: "string", description: "a tab group (its id: vau tabs): all its tabs" }, ui: UI, as: AS },
  run: async (p) => {
    const name = who(p), pane = str(p.pane), tab = str(p.tab), group = str(p.group), ui = str(p.ui)
    if (!pane && !tab && !group && !ui) return { follows: followed.list().filter((f) => key(f.agent) === key(name)) }
    if (tab) {
      const ps = allPanes().filter((x) => x.tab === tab && !privatePane(x))
      if (!ps.length) throw new OpError(`no tab ${tab} in the user's window (vau tabs lists them)`, 404)
      return { follows: [followed.add({ agent: name, tab, title: ps.map((x) => x.title).join(" · ") })] }
    }
    const pn = pane ? paneById(pane) : undefined
    if (pane && !pn) throw new OpError(`no pane ${pane} in the user's window (vau tabs lists them)`, 404)
    if (pn && privatePane(pn)) throw new OpError("that pane is private: the companion never sees it", 403)
    return { follows: [followed.add({ agent: name, ...(pane ? { pane } : group ? { group } : { ui }), title: pn?.title ?? "" })] }
  },
  text: (r) => (r.follows.length ? r.follows.map(followText).join("\n") : "Following nothing."),
})
plugin.op({
  id: "companion.unfollow",
  cli: "companion unfollow",
  summary: "Stop following a pane, a tab, a tab group or a part of the app (by its follow's id, pane, tab, group or ui; none: all yours).",
  kind: "write",
  lock: false,
  params: { id: { type: "string", description: "the follow (f2), or the pane, tab, group or ui id it follows" }, as: AS },
  args: ["id"],
  run: async (p) => ({ stopped: followed.remove(str(p.id) || null, who(p)).length }),
  text: (r) => `Stopped ${r.stopped} follow${r.stopped === 1 ? "" : "s"}.`,
})
plugin.op({
  id: "companion.keep",
  cli: "companion keep",
  summary: "Keep a follow as a watch (a file, checked by the server after this session too): when the user says yes to keeping an eye on it.",
  help: `A watch of the pane's terminal, page or note (or the whole tab group), live or every few minutes, until what it
waits for happens (vau docs watches). The follow ends: the watch tells you instead.

  vau companion keep --pane t3k2 --until "idle" --why "Tell me when the migration finishes"
  vau companion keep --pane t5x1 --every 30m --until Shipped --why "Tell me when it ships"`,
  kind: "write",
  lock: false,
  params: { pane: PANE, group: { type: "string", description: "a tab group (its id)" }, every: { type: "string", default: "live", description: "live, or how often: 5m, 2h, 1d" },
    until: { type: "string", description: "what it waits for (words, or a /regular expression/)" }, why: { type: "string", description: "what to do then, in the user's words" },
    title: { type: "string", description: "its name" }, as: AS },
  run: async (p, ctx) => {
    const pn = str(p.pane) ? paneById(str(p.pane)) : undefined
    const source = str(p.group) ? `group:${str(p.group)}` : pn ? sourceOf(pn) : null
    if (!source) throw new OpError(str(p.pane) ? `pane ${str(p.pane)} shows nothing to watch (a terminal, a page or a note)` : "give `pane` or `group`")
    if (pn && privatePane(pn)) throw new OpError("that pane is private: the companion never sees it", 403)
    const r = await ctx.op("watches.add", { source, every: str(p.every) || "live", ...(str(p.until) ? { until: str(p.until) } : {}), ...(str(p.why) ? { why: str(p.why) } : {}),
      ...(str(p.title) ? { title: str(p.title) } : pn ? { title: `Watch ${pn.title}`.slice(0, 80) } : {}), by: who(p) })
    followed.remove(str(p.group) || str(p.pane))
    return r
  },
  text: (r) => `Kept as a watch: ${r.id}.md (${r.source}).`,
})

plugin.op({
  id: "companion.history",
  cli: "companion history",
  summary: "A note's margin threads: the comments in it now, and those the user dismissed (newest last).",
  kind: "read",
  params: { path: PATH },
  run: async (p) => {
    const path = target(p).path!
    return { path, open: kept(path).filter((n) => n.kind === "comment"), past: past.get(path) ?? [] }
  },
  text: (r) => [`${r.path}: ${r.open.length} open, ${r.past.length} dismissed.`,
    ...[...r.open, ...r.past].map((n: Note) => `- ${n.id}${n.dismissed ? " (dismissed)" : ""} by ${byText(n)} at line ${n.line ?? "?"}: ${cut(n.text ?? "", 80)}${n.replies?.length ? ` (${n.replies.length} replies)` : ""}`)].join("\n"),
})

plugin.op({
  id: "companion.draw",
  cli: "companion draw",
  summary: "Draw on the screen (marks: ring, point, connect, a scratch pad..., hand-drawn in your colour with your words), or change a drawing's elements (actions, on an .excalidraw).",
  help: `marks: what to draw over the user's screen, in beats with your words (say); each call adds to what's up. At their
next ask what pointed goes and the cards stay (a pad, a sticky, a picture...), listed by id with the ask: a follow-up
about them changes them in place (actions, no path); new marks replace them; companion clear takes it all down. The
user can drag or dismiss a card, and Keep it all (companion save-drawing: an .excalidraw).
${VOCABULARY}
Which: a thing on their screen, a mark at it; a diagram or flow, a paper of Excalidraw's shapes (rect, diamond, arrow
from/to ids); a picture of something (a logo, an animal, an icon), a paper with an svg item, clean or sketch; their
file or a picture from the web, an image or video card.

  vau companion draw --say "Click Share. Then pick who." --marks '[{"type":"ring","at":{"el":"e12"},"label":"Share"},
    {"type":"connect","from":{"el":"e12"},"to":[900,420,120,30],"beat":1}, {"type":"num","at":[900,420],"n":2,"beat":1}]'
  vau companion draw --marks '[{"type":"paper","title":"Sales","grid":true,"items":[{"type":"chart","kind":"bar","values":[3,5,8],"labels":["Q1","Q2","Q3"]}]}]'
  vau companion draw --marks '[{"type":"paper","id":"flow","w":420,"h":160,"items":[{"type":"rect","id":"in","x":20,"y":50,"label":"Sign in"},
    {"type":"diamond","id":"ok","x":170,"y":30,"w":100,"h":100,"label":"Valid?"},{"type":"rect","id":"home","x":300,"y":50,"label":"Home","fill":"green"},
    {"type":"arrow","from":"in","to":"ok"},{"type":"arrow","from":"ok","to":"home","label":"yes"}]}]'
  vau companion draw --marks '[{"type":"paper","w":200,"h":200,"items":[{"type":"svg","style":"sketch","paths":[{"d":"M20 80 Q50 10 80 80 Z","fill":"green"}]}]}]'
  vau companion draw --marks '[{"type":"image","src":"screenshot","caption":"Your latest screenshot","at":"top-right"}]'

actions without a path: what's up changed in place, by the ids the ask listed (or your marks gave): {"op": "add",
"type": "rect" | ..., "in": "<pad id>", ...an item} (to the last pad without in), {"op": "add", "mark": {...a mark}},
{"op": "move", "id", "dx", "dy"} (or x, y; a card {"op": "move", "id", "at": "top-left"}), {"op": "change", "id",
"color", "fill", "label", "text", "w", "h", "caption"...}, {"op": "delete", "id"} (erased, its pen run backward).

  vau companion draw --actions '[{"op":"change","id":"home","fill":"blue"},{"op":"add","type":"rect","id":"err","x":170,"y":0,"w":90,"h":24,"label":"Retry"},
    {"op":"add","type":"arrow","from":"ok","to":"err","label":"no"},{"op":"delete","id":"old"}]'

actions with a path: a drawing's changes, all checked before any is made (\`vau docs excalidraw\` has every field). Ids are in the
drawing's text (next, vau render). Only in pair mode or when they asked you to.

  vau companion draw --path Drawings/Plan.excalidraw --actions '[{"op":"add","type":"rectangle","id":"login","x":0,"y":0,"label":"Log in","fill":"blue"},
    {"op":"add","type":"arrow","from":"login","to":"home","label":"ok"}, {"op":"move","id":"home","dx":40,"dy":0},
    {"op":"change","id":"home","label":"Start"}, {"op":"delete","id":"old"}]'`,
  kind: "write",
  lock: false,
  params: { marks: { type: "array", items: { type: "object" }, description: "marks to draw on the screen: {\"type\": \"ring\" | \"point\" | \"frame\" | \"connect\" | \"paper\" | ..., ...} (see help)" },
    say: { type: "string", description: "with marks, written after them: your words, said once the marks check; each mark's beat is a sentence of them" },
    actions: { type: "array", items: { type: "object" }, description: "what to change, in order, by id: {\"op\": \"add\" | \"move\" | \"change\" | \"delete\", ...}; without path the drawing on the screen, with path that drawing file" },
    path: PATH, as: AS },
  run: async (p, ctx) => {
    if (p.marks !== undefined) return drawOnScreen(p, ctx)
    if (p.actions === undefined) throw new OpError("marks (on the screen) or actions (on the screen's drawing, or a drawing's with path)")
    if (p.path === undefined) return editOnScreen(p, ctx)
    const name = who(p), t = target(p), apply = drawer(t.path!)
    if (!apply) throw new OpError(`${t.path} isn't a drawing (a .excalidraw file, its plugin on): companion edit writes in notes`)
    did(name, "draw")
    const a = setAgent(name, { path: t.path, line: undefined, find: undefined, x: undefined, y: undefined, state: "writing" })
    try {
      return await inTurn(t.path!, async () => {
        const f = await ctx.api("GET", `file?path=${encodeURIComponent(t.path!)}`), cur = String(f.text ?? "")
        let made: ReturnType<Draw>
        try { made = apply(cur, p.actions) } catch (e) { throw new OpError((e as Error).message) }
        const ws = editorFor(t.path!), reply: { touched?: unknown } = {}
        const drawn = !!ws && await askWindow(ws, { t: "draw", agent: a.name, path: t.path, actions: p.actions }, EDIT_WAIT + p.actions.length * 300, reply)
        if (!drawn) await ctx.api("PUT", "file", { path: f.path, text: made.text, base: cur })
        const touched = drawn && Array.isArray(reply.touched) ? reply.touched.map(String) : made.touched
        if (touched.length) setAgent(name, { find: touched.at(-1) })
        return { path: t.path, how: drawn ? "drawn" : "written", touched }
      })
    } finally { setAgent(name, { state: acting(name) }) }
  },
  text: (r) => (r.changed ? `Changed the drawing on the screen (${r.changed.join(", ") || "nothing named"}).` : r.screen ? `Drew ${r.marks} on the screen (${r.screen}).${r.unshown ? ` Not drawn, they saw no mark: ${r.unshown.join("; ")}.` : ""}` : `${r.how === "drawn" ? "Drew on" : "Wrote"} ${r.path}${r.touched.length ? ` (${r.touched.join(", ")})` : ""}.`),
  did: (p) => (p.marks !== undefined ? { action: "ui", text: "Drew on the screen", paths: [], by: who(p) } : edited(p)),
})

/** Marks over the screen, its cursor at the first and its words said with them. */
async function drawOnScreen(p: Record<string, unknown>, ctx: OpCtx) {
  const name = who(p)
  did(name, "draw")
  const { drawing: d, unshown } = await screenDrawing.draw(name, p.marks, str(p.say) || undefined).catch((e) => {
    const use = toolUse.getStore(), n = use ? streams.get(use)?.note : undefined, ask = askOf(name)?.t
    if (n && ask !== undefined) saidUndrawn.set(key(name), { note: n, text: notes.get(n)?.text ?? str(p.say), ask })
    throw e
  })
  const r = spots(d.marks).map((s) => rectOf(s, d.places)).find(Boolean)
  const at = r ? { sx: Math.round(r.x + r.w / 2), sy: Math.round(r.y + r.h / 2) } : {}
  if (str(p.say)) await ctx.op("companion.say", { text: str(p.say), ...at, ...(p.as ? { as: p.as } : {}) })
  else if (r) setAgent(name, { ...at, state: acting(name) })
  return { screen: d.id, marks: (p.marks as unknown[]).length - unshown.length, ...(unshown.length ? { unshown } : {}) }
}

/** The drawing up changed in place by id, its words said with it. */
async function editOnScreen(p: Record<string, unknown>, ctx: OpCtx) {
  const name = who(p)
  did(name, "draw")
  const { drawing: d, touched } = await screenDrawing.edit(name, p.actions, str(p.say) || undefined)
  if (str(p.say)) await ctx.op("companion.say", { text: str(p.say), ...(p.as ? { as: p.as } : {}) })
  return { screen: d.id, changed: touched }
}

plugin.op({
  id: "companion.save-drawing",
  cli: "companion save-drawing",
  summary: "Keep the drawing on the screen as an .excalidraw in the vault: its scratch pads, cards and words (all: its marks too).",
  help: "What Keep does on the screen. Default path: Drawings/<its title>.excalidraw.",
  kind: "write",
  params: { id: { type: "string", description: "the drawing (default: the one up)" }, path: { ...PATH, description: "where (default Drawings/<its title>.excalidraw)" },
    all: { type: "boolean", description: "the marks on the screen too, as they were placed" }, places: { type: "object", description: "where the overlay found its places (Keep's)" } },
  run: async (p, ctx) => ({ path: await screenDrawing.keep(ctx, { id: str(p.id) || undefined, path: str(p.path) || undefined, all: p.all === true, places: (p.places ?? {}) as Record<string, ScreenRect> }) }),
  text: (r) => `Kept ${r.path}.`,
  did: () => ({ action: "create", text: "Kept the companion's drawing", paths: [] }),
})

plugin.op({
  id: "companion.clear",
  cli: "companion clear",
  summary: "Take back your comments and suggestions (one by id, or all of yours, and your layer on the screen).",
  kind: "write",
  lock: false,
  params: { id: { type: "string", description: "the item (n12); default: all of yours" }, as: AS },
  run: async (p) => {
    // (an agent's own: never a person's thread)
    const name = who(p), gone = [...notes.values()].filter((n) => !n.by && (p.id ? n.id === p.id : n.agent === name))
    for (const n of gone) dropNote(n.id)
    const drew = !p.id && screenDrawing.clear({ agent: name })
    return { cleared: gone.length + (drew ? 1 : 0) }
  },
  text: (r) => `Cleared ${r.cleared}.`,
  did: (p) => ({ action: "ui", text: p.id ? `Took back ${str(p.id)}` : "Took back its comments and suggestions", paths: [], by: who(p) }),
})

plugin.op({
  id: "companion.layer",
  cli: "companion layer",
  summary: "Your layer on the screen (what you drew there, by id): read it, or hide and show it (a before and after).",
  help: `Each session draws on its own layer (companion draw): its marks never touch another's. A mark stays until the next
ask (what points), until it's dismissed (cards) or until the screen under it changes (life). Hiding keeps it as it is,
ids and all: show brings it back at once, nothing drawn again.

  vau companion layer              what's on it, by id
  vau companion layer --hide       out of sight (the after: the screen as it is)
  vau companion layer --show       back (the before: what you marked)`,
  kind: "write",
  lock: false,
  params: { hide: { type: "boolean", description: "out of sight, kept as it is" }, show: { type: "boolean", description: "back on the screen" },
    toggle: { type: "boolean", description: "hidden if shown, shown if hidden" }, as: AS },
  run: async (p) => {
    const name = who(p), d = screenDrawing.layer(name)
    if (!d) return { layer: null, shown: false, text: "" }
    if (p.hide === true && p.show === true) throw new OpError("hide or show, not both")
    const shown = p.hide === true ? screenDrawing.toggle(name, false) : p.show === true ? screenDrawing.toggle(name, true) : p.toggle === true ? screenDrawing.toggle(name) : !d.hidden
    return { layer: d.id, shown, text: screenDrawing.text(name) }
  },
  text: (r) => (!r.layer ? "Nothing of yours is on the screen." : `Your layer ${r.layer}, ${r.shown ? "shown" : "hidden"}.${r.text ? `\n${r.text.split("\n").slice(1).join("\n")}` : ""}`),
  did: (p) => ({ action: "ui", text: p.hide === true ? "Hid its layer" : p.show === true ? "Showed its layer" : p.toggle === true ? "Toggled its layer" : "Read its layer", paths: [], by: who(p) }),
})

plugin.op({
  id: "companion.status",
  cli: "companion status",
  summary: "What the companion is: its mode, its sessions, the agents in the app and what they left there.",
  kind: "read",
  params: {},
  run: async () => {
    const id = sessionId()
    const all = await Promise.all(sessions().map(async (s) => ({ ...s, running: await running(s.id) })))
    return { mode: mode(), name: ownName(), session: (await running(id)) ? id : null, windows: windows.size, focus: focus(),
      sessions: all.filter((s) => s.running).map(({ name, id }) => ({ name, id, ...(isChat(id) ? { chat: true } : {}) })), summoned: lane().on() ? { id: lane().id(), model: summonedModel(), ...(lane().trouble() ? { trouble: lane().trouble() } : {}) } : null,
      agents: [...agents.values()].map((a) => ({ ...a, live: a.state !== "away" && live(a.name), watch: isMain(a.name) || watching.has(key(a.name)) })),
      notes: [...notes.values()], moments: moments.slice(-10), follows: followed.list(),
      realtime: pausedNow() ? { state: "paused", ...pausedNow()! } : realtimePaused.size ? { state: "on" } : null, voice: voiceHere(plugin, setting, [...mics.values()].at(-1)), ...(calls.size ? { call: [...calls.values()].at(-1) } : {}) }
  },
  text: (r) => [`Mode: ${r.mode}. Session: ${r.session ?? "not running"}.${r.summoned ? ` Summoned asks: ${r.summoned.model}${r.summoned.id ? `, session ${r.summoned.id}` : ""}${r.summoned.trouble ? ` (its last trouble, at ${new Date(r.summoned.trouble.t).toTimeString().slice(0, 5)}: ${cut(r.summoned.trouble.why, 160)})` : ""}.` : ""} Windows: ${r.windows}.`,
    voiceHereText(r.voice),
    ...(r.call ? [`Quiet: ${r.call}, its answers show as text.`] : []),
    ...(r.realtime?.state === "paused" ? [`Realtime voice: paused, ${r.realtime.account === "quota" ? "the OpenAI account has no credits" : "OpenAI refused its key"} (${cut(r.realtime.why, 120)}); tries again at ${new Date(r.realtime.until).toTimeString().slice(0, 5)}.`] : []),
    ...r.agents.map((a: Agent & { live: boolean }) => {
      const s = r.sessions.find((x: { name: string }) => key(x.name) === key(a.name))
      return `- ${a.name} (${a.tint})${isMain(a.name) ? ", the companion" : ""}: ${a.live || isMain(a.name) ? a.state : "away"}${a.path ? ` at ${a.path}${a.line ? `:${a.line}` : ""}` : ""}${s ? `, session ${s.id}` : ""}`
    }),
    ...r.notes.map((n: Note) => `- ${n.id} ${n.kind} by ${byText(n)}${n.path ? ` in ${n.path}` : ""}: ${cut(n.text ?? n.replace ?? n.find ?? "", 80)}`),
    ...r.follows.map((f: Follow) => `- ${f.agent} follows ${followText(f)}`)].join("\n"),
})

plugin.op({
  id: "companion.start",
  cli: "companion start",
  owner: "a coding agent",
  summary: "Start the companion's always-on session (its agent, in a terminal on this machine), or another agent's by name.",
  help: `With --as, another agent joins under that name, with its own cursor colour: @name in a note asks it (asks sent while
it starts wait for it). The name's first part picks what it runs (the setting profiles: Opus-review runs Claude Code on
Opus, Codex runs Codex); --agent, --model and --effort override that (each moment is one of the model's turns). Other
names run the settings' agent, model and effort.

  vau companion start
  vau companion start --as Opus-review
  vau companion start --as Ada --agent codex --model gpt-6-luna --effort high`,
  kind: "write",
  lock: false,
  params: { as: { type: "string", description: "start another agent under this name (one word; default: the companion)" },
    agent: { type: "string", description: "the coding agent it runs (claude, codex, claude_personal...; default: its name's profile, else the setting)" },
    model: { type: "string", description: "the model it runs (sonnet, opus, gpt-6.1-sol, a full name; default: its name's profile, else the setting, else the agent's own)" },
    effort: { type: "string", enum: ["low", "medium", "high", "xhigh", "max"], description: "its effort (default: its name's profile, else the setting, else the agent's own)" },
    path: { type: "string", format: "path", description: "the note it was called from: its cursor waits there while it starts" }, line: LINE,
    after: { type: "integer", minimum: 0, description: "the moments after this one wait for it (the ask that started it); default: those from now" } },
  run: async (p, ctx) => {
    if (mode() === "off") await plugin.patchSettings({ mode: "quiet" })
    const at = str(p.path) ? { path: str(p.path), ...(p.line ? { line: Number(p.line) } : {}) } : {}
    return await start(ctx, str(p.as), str(p.agent), str(p.model), str(p.effort), at, p.after)
  },
  text: (r) => `${r.running ? "Already running" : "Started"}: ${r.name}${r.agent ? ` (${[agentName(r.agent.split("_")[0]) ?? r.agent, r.model, r.effort].filter(Boolean).join(", ")})` : ""} in ${r.id} (${isChat(r.id) ? `vau chat read ${r.id}` : `vau terminal capture ${r.id}`}).`,
})

plugin.op({
  id: "companion.stop",
  cli: "companion stop",
  owner: "the terminal",
  summary: "End the companion's session (or another agent's, by name); its cursor goes away until it starts again.",
  kind: "write",
  lock: false,
  params: { as: { type: "string", description: "the agent started with start --as (default: the companion)" }, all: { type: "boolean", description: "every session" } },
  run: async (p) => await stop(str(p.as), !!p.all),
  text: (r) => (r.id ? `Ended ${r.id}.` : "It wasn't running."),
})

plugin.op({
  id: "companion.interrupt",
  cli: "companion interrupt",
  summary: "Stop the companion mid-answer (Esc in a note): its turn ends where it is, and what it typed stays.",
  kind: "write",
  lock: false,
  params: { as: { type: "string", description: "the agent started with start --as (default: the companion)" } },
  run: async (p) => {
    const name = str(p.as) ? who(p) : ownName(), s = session(name), k = key(name)
    stopStreams(name)
    broadcast({ t: "hush", agent: name })
    const asks = (batches.get(k) ?? []).flatMap((n) => moments.find((m) => m.seq === n && m.kind === "ask")?.text ?? [])
    const keys = s && !isChat(s.id) ? INTERRUPT[runsOf(s).split("_")[0]] : undefined
    // (its summoned session, answering a Talk key's ask)
    let ok = isMain(name) && await lane().interrupt()
    if (!ok && s && isChat(s.id)) {
      ok = !!(await chat()?.interrupt(s.id).catch(() => false))
      if (ok) { stopped.set(k, asks); resend.delete(k) }
    } else if (!ok && s && keys && !waiters.has(k) && await running(s.id)) {
      // (a terminal's agent busy on a moment, not waiting in next: its own interrupt key, then told so and back to next)
      ok = !!(await plugin.runOp("terminal.key", { id: s.id, keys }).catch(() => null))
      if (ok) setTimeout(() => void plugin.runOp("terminal.send", { id: s.id, text: `${STOPPED(asks)} Then run \`${nextCmd(name)}\` again, and never end your turn.` }).catch(() => {}), 1000).unref?.()
    }
    if (ok) did(name, "stopped")
    return { name, stopped: ok }
  },
  text: (r) => (r.stopped ? `Stopped ${r.name}.` : `${r.name} wasn't answering.`),
})

plugin.op({
  id: "companion.fresh",
  cli: "companion fresh",
  owner: "the terminal",
  summary: "Have the companion (or another agent, by name) hand over to a fresh session: once it's free, it writes what the next should know, which starts with that and its threads.",
  kind: "write",
  lock: false,
  params: { as: { type: "string", description: "the agent started with start --as (default: the companion)" } },
  run: async (p) => {
    const name = str(p.as).trim() || ownName(), k = key(name), s = session(name)
    if (!s || !(await running(s.id))) throw new OpError(`${name} isn't running`, 404)
    // (asked when it's next free, not cut off mid-work; waiting now, at once)
    fresh.add(k)
    const wait = waiters.get(k)
    if (wait) { waiters.delete(k); wait([]) }
    if (isChat(s.id)) void pump(name)
    return { name, id: s.id }
  },
  text: (r) => `${r.name} hands over to a fresh session once it's free.`,
})

plugin.op({
  id: "companion.replay",
  cli: "companion replay",
  summary: "Replay moments recorded on a day (or from a file of JSON lines) to the companion, to see how it answers.",
  help: `The test harness: moments are logged on this machine each day; replaying a day's sends them again, spaced as they
came (faster with speed), so you can watch what the session makes of them.

  vau companion replay --day 2026-10-16 --speed 4
  vau companion replay --file /tmp/moments.jsonl`,
  kind: "read",
  lock: false,
  params: { day: { type: "string", description: "a day (YYYY-MM-DD) of the log" }, file: { type: "string", description: "a file of moments, one JSON per line" },
    speed: { type: "number", minimum: 0.1, default: 1, description: "how much faster than they came" }, limit: { type: "integer", minimum: 1, default: 50, description: "at most this many" } },
  run: async (p) => {
    let ms: Moment[] = []
    if (p.file) ms = fs.readFileSync(String(p.file), "utf8").split("\n").flatMap((l) => { try { return l ? [JSON.parse(l)] : [] } catch { return [] } })
    else if (p.day) ms = log.read(String(p.day))
    else throw new OpError("give `day` or `file`")
    ms = ms.filter((m) => m && typeof m.kind === "string").slice(-p.limit)
    const t0 = ms[0]?.t ?? 0
    void (async () => {
      for (const m of ms) {
        const wait = Math.min(30_000, Math.max(0, (m.t - t0) / p.speed))
        await new Promise((r) => setTimeout(r, wait))
        addMoment({ ...m, t: Date.now() })
      }
    })()
    return { replaying: ms.length }
  },
  text: (r) => `Replaying ${r.replaying} moments.`,
})

/** A moment's latency (ms): the user's pause, until handed (handoff), sent (a summoned session's message), its first
 *  action (think) and word shown (word), to its next `next` or turn's end (total); undefined: it didn't happen. */
export type Timing = { t: number; seq: number; kind: string; at: string; as?: string; op?: string; pause?: number; handoff?: number; sent?: number; think?: number; word?: number; total?: number }

/** What's logged that isn't an action of its own. */
const NOT_ACTS = new Set([...BOOKKEEPING, "word", "stopped"])
/** The actions that show words. */
const WORDS = new Set(["word", "say", "comment", "suggest", "propose", "edit"])

/** Each moment's timing per agent handed it, from the moments and actions logged on a day (seqs restart with the
 *  server: matched in time). A moment handed again (they went on with it) counts from its last handing. */
export function timings(ms: Moment[], log: Act[]): Timing[] {
  return ms.flatMap((m, i) => {
    const until = ms.slice(i + 1).find((x) => x.seq === m.seq)?.t ?? Infinity
    const r: Timing = { t: m.t, seq: m.seq, kind: m.kind, at: m.path ? `${m.path}${m.line ? `:${m.line}` : ""}` : "", ...(m.waited !== undefined ? { pause: m.waited } : {}) }
    const hands = log.flatMap((a, hi) => (a.op === "handed" && a.t >= m.t && a.t < until && a.seqs?.includes(m.seq) ? [hi] : []))
      .filter((hi, k, all) => all.findLastIndex((x) => log[x].as === log[hi].as) === k)
    if (!hands.length) return [r]
    return hands.map((hi) => {
      const h = log[hi], after = log.slice(hi + 1).filter((a) => a.as === h.as)
      const done = after.find((a) => a.op === "next" || a.op === "done"), within = (a: Act) => !done || a.t <= done.t
      const first = after.find((a) => !NOT_ACTS.has(a.op) && within(a)), word = after.find((a) => WORDS.has(a.op) && within(a)), sent = after.find((a) => a.op === "sent" && within(a))
      return { ...r, as: h.as, handoff: h.t - m.t, ...(sent ? { sent: sent.t - h.t } : {}), ...(first ? { op: first.op, think: first.t - h.t } : {}), ...(word ? { word: word.t - h.t } : {}), ...(done ? { total: done.t - m.t } : {}) }
    })
  })
}

export function timingsText(day: string, rows: Timing[]) {
  const s = (ms?: number) => (ms === undefined ? "-" : (ms / 1000).toFixed(1)).padStart(7)
  const time = (t: number) => new Date(t).toTimeString().slice(0, 8)
  const pct = (xs: number[], q: number) => xs.sort((a, b) => a - b)[Math.max(0, Math.ceil(q * xs.length) - 1)]
  const sum = (label: string, rs: Timing[]) => `${label} (${rs.length}): ${(["pause", "handoff", "think", "word", "total"] as const).map((k) => {
    const xs = rs.flatMap((r) => r[k] ?? [])
    return `${k} ${xs.length ? `${s(pct(xs, 0.5)).trim()}/${s(pct(xs, 0.9)).trim()}` : "-"}`
  }).join(", ")} (median/p90, s)`
  if (!rows.length) return `No moments on ${day}.`
  return [`${day}, in seconds: pause (the user's, before the app sent it; a Talk key's, from letting it go), handoff (until it was handed: a next, or its chat session's message), think (to the first action), word (to the first word shown), total (to the next \`next\`, or its turn's end).`,
    `${"time".padEnd(8)} ${"pause".padStart(7)} ${"handoff".padStart(7)}${"think".padStart(7)}${"word".padStart(7)}  ${"total".padStart(7)}  moment`,
    ...rows.map((r) => `${time(r.t)} ${s(r.pause)} ${s(r.handoff)}${s(r.think)}${s(r.word)}  ${s(r.total)}  ${r.as ? `${r.as}: ` : ""}${r.kind}${r.op ? ` -> ${r.op}` : ""} ${cut(r.at, 50)}`),
    sum("asks and replies", rows.filter((r) => r.kind === "ask" || r.kind === "reply")), sum("all", rows),
    // (each agent's own, to compare models)
    ...(new Set(rows.flatMap((r) => r.as ?? [])).size > 1 ? [...new Set(rows.flatMap((r) => r.as ?? []))].map((a) => sum(a, rows.filter((r) => r.as === a))) : [])].join("\n")
}

plugin.op({
  id: "companion.timings",
  cli: "companion timings",
  summary: "How fast the companion answered on a day: per moment, its wait to be handed, the think to its first action, to its first word shown, total; per job, to its card and its worker's first step.",
  help: `  vau companion timings
  vau companion timings --day 2026-10-16`,
  kind: "read",
  params: { day: { type: "string", description: "a day (YYYY-MM-DD); default: today" } },
  run: async (p) => {
    const day = str(p.day) || localDate(Date.now())
    return { day, rows: timings(log.read(day), acts.read(day)), jobs: jobs.timings(day, localDate) }
  },
  text: (r) => [timingsText(r.day, r.rows), jobTimingsText(r.jobs)].filter(Boolean).join("\n\n"),
})

plugin.op({
  id: "companion.conversation",
  cli: "companion conversation",
  summary: "The user's talk with the companion on a day: each ask (a Talk key's press, an @name), its answer and what it did, its timings and press; and what its services used.",
  help: `What the Companion page and the Conversations panel's Talk show. Each exchange's press has its steps (mic,
recognizer, the key's up and down, its end), as the menu-bar helper logged them on this machine.

  vau companion conversation
  vau companion conversation --day 2026-11-05`,
  kind: "read",
  params: { day: { type: "string", description: "a day (YYYY-MM-DD); default: today" } },
  run: async (p) => {
    const day = str(p.day) || localDate(Date.now())
    const got = await plugin.desktop("talk:presses", { day }).catch(() => []), presses = (Array.isArray(got) ? got : []) as PressLine[]
    return { day, exchanges: exchanges(log.read(day), acts.read(day), presses, ownName()), spent: spent(presses), jobs: jobs.cards().map((j) => ({ ...j, at: j.started, ...(j.ended ? { ended: j.ended } : {}) })) }
  },
  text: (r) => [`${r.day}: ${r.exchanges.length} ${r.exchanges.length === 1 ? "ask" : "asks"}.`, ...r.exchanges.map((e: Exchange) => `${new Date(e.t).toTimeString().slice(0, 5)} ${e.voice ? "said" : "asked"}${e.where ? ` (${e.where})` : ""}: ${e.text.replace(/\s+/g, " ").slice(0, 160)}${e.said.length ? `\n  -> ${e.said.join(" ").replace(/\s+/g, " ").slice(0, 200)}` : ""}`),
    ...(r.spent.length ? [`Used: ${r.spent.map((x: Spent) => `${x.service} ${x.uses}${x.seconds ? `, ${Math.round(x.seconds)} s` : ""}${x.cost ? `, $${x.cost.toFixed(3)}` : ""}`).join("; ")}`] : [])].join("\n"),
})
/** A Talk key ask's picture of the screen, as the helper wrote it (userData/screens/display-*.png): no other file. */
plugin.op({
  id: "companion.press-media",
  owner: "The companion's presses",
  summary: "A Talk key press's kept audio (WAV) and its ask's picture of the screen (PNG), base64, for its Details on the Companion page.",
  kind: "read",
  mcp: false,
  params: { press: { type: "string", description: "the press's id (companion conversation)" }, shot: { type: "string", description: "its ask's picture (companion conversation)" } },
  run: async (p) => {
    const wav = str(p.press) ? ((await plugin.desktop("talk:audio", { press: str(p.press) }).catch(() => null)) as { wav: string | null } | null)?.wav ?? null : null
    const png = str(p.shot) ? ((await plugin.desktop("talk:shot", { name: path.basename(str(p.shot)) }).catch(() => null)) as { png: string | null } | null)?.png ?? null : null
    return { wav, png }
  },
  text: (r) => [r.wav ? "Its audio is kept." : "No audio kept.", r.png ? "Its picture is kept." : "No picture kept."].join(" "),
})

/** Where each service's balance is told, when it can't be asked. */
type UsageRow = { service: string; today: Spent; week: Spent; left?: { used: number; limit: number; resets?: number; unit: string }; billing?: string }
const BILLING: Record<string, string> = { openai: "https://platform.openai.com/settings/organization/billing/overview", soniox: "https://console.soniox.com", elevenlabs: "https://elevenlabs.io/app/subscription" }
plugin.op({
  id: "companion.usage",
  cli: "companion usage",
  summary: "What the companion's services used today and this week (counted by Vaultite from its presses), and what's left where the provider says.",
  help: `Per service: its uses, seconds heard and cost today and over the last 7 days; ElevenLabs' characters left this
month from its API (with this machine's key); for the others, where to see the balance. The Claude plans' limits are
Claude Code's (vau claude-code limits).

  vau companion usage`,
  kind: "read",
  run: async (): Promise<{ services: UsageRow[] }> => {
    const days = Array.from({ length: 7 }, (_, i) => localDate(Date.now() - i * 86_400_000))
    const got = await Promise.all(days.map((day) => plugin.desktop("talk:presses", { day }).catch(() => []) as Promise<unknown>))
    const lines = got.map((x) => (Array.isArray(x) ? x : []) as PressLine[])
    const today = spent(lines[0]), week = spent(lines.flat()), eleven = await elevenUsage(plugin)
    const services = [...new Set([...week.map((x) => x.service), ...(eleven ? ["elevenlabs"] : [])])]
    return { services: services.map((service) => ({ service, today: today.find((x) => x.service === service) ?? { service, uses: 0 }, week: week.find((x) => x.service === service) ?? { service, uses: 0 },
      ...(service === "elevenlabs" && eleven ? { left: { ...eleven, unit: "characters" } } : {}), ...(BILLING[service] ? { billing: BILLING[service] } : {}) })) }
  },
  text: (r) => (r.services.length ? r.services.map((x: UsageRow) => `${x.service}: today ${x.today.uses}${x.today.cost ? ` ($${x.today.cost.toFixed(3)})` : ""}, this week ${x.week.uses}${x.week.cost ? ` ($${x.week.cost.toFixed(3)})` : ""}${x.left ? `; ${x.left.limit - x.left.used} of ${x.left.limit} ${x.left.unit} left` : ""}`).join("\n") : "Nothing used this week."),
})

plugin.op({
  id: "companion.page",
  cli: "companion page",
  summary: "Open the Companion page: your talk with it (asks, answers, jobs, each press's details) and what its services used.",
  help: `Written into the pages folder first when the vault doesn't have it yet (its blocks: companion-conversation,
companion-usage).

  vau companion page
  vau companion page --split right`,
  kind: "write",
  lock: false,
  params: { split: { type: "string", enum: ["right", "down"], description: "in a pane beside (right) or below (down)" }, newTab: { type: "boolean", description: "in a new tab" }, as: AS },
  run: async (p, ctx) => {
    const home = plugin.vault.pagesHome(), at = home ? `${home}/Companion.md` : "Companion.md"
    // (a vault that had it on before its page came: written now, as turning it on would have)
    if (!fs.existsSync(plugin.vault.abs(at))) writeNew(plugin.vault.abs(at), readText(path.join(plugin.dir, "pages", "Companion.md")))
    // (no window to show it in: said, never "opened")
    const shown = await ctx.op("ui.open", { path: at, ...(p.split ? { split: p.split } : {}), ...(p.newTab ? { newTab: true } : {}) }).then(() => true, () => false)
    return { path: at, shown, split: str(p.split) }
  },
  text: (r) => (r.shown ? `Opened ${r.path}${r.split ? ` in a split ${r.split}` : ""}.` : `${r.path} is ready, but no window of the app is open to show it in.`),
})

// (the Companion page's blocks as text: what /api/render shows)
plugin.block("companion-conversation", async (ctx) => (await plugin.host.call("companion.conversation", { day: ctx.today })).text)
plugin.block("companion-usage", async () => (await plugin.host.call("companion.usage", {})).text)

// ---------- a change of settings (mode, name) reaches the windows

/** The sessions still running when the server starts (a restart, an update): back in the app at once, so @name
 *  reaches them while they finish what they were doing, before their next `next`. */
async function rejoin() {
  hearChats()
  lane().serve()
  for (const x of sessions()) {
    // (a chat session's tools are this server's: served again, so a call it makes now reaches them)
    if (isChat(x.id)) { const s = session(x.name); if (s) chat()?.serve(s.id, chatOptions(s.name, s)) }
    if (agents.has(key(x.name)) || !(await running(x.id).catch(() => false))) continue
    seen.set(key(x.name), Date.now())
    setAgent(x.name, { state: "watching" })
  }
}

let lastSaid = ""
plugin.onSync((vault) => {
  if (loadedFor !== vault) {
    loadedFor = vault
    loadAll(true)
    // (again a moment later: Terminal may not have started yet)
    void rejoin(); setTimeout(() => void rejoin(), 5000).unref?.()
  }
  const now = JSON.stringify([mode(), ownName(), offers()])
  if (now === lastSaid) return
  // (turned off: its session ends too)
  if (lastSaid && mode() === "off") void stop(undefined, true).catch(() => {})
  lastSaid = now
  broadcast(snapshot())
})

// ---------- people's threads: the user's, and a shared folder's guests' (plugins/core/share), which no agent hears of

const PEOPLE = ["blue", "green", "purple", "teal", "pink", "indigo"]
/** A person's colour, the same for the same name. */
const tintFor = (name: string) => PEOPLE[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PEOPLE.length]

/** Who started a thread, as an agent reads it: a guest's words are someone else's, never the user's. */
const byText = (n: Note) => (n.by === "guest" ? `${n.agent} (a guest: not the user)` : n.by === "user" ? "the user" : n.agent)

/** The user hears of what a guest said (a toast, Open), once a while per guest and note. */
const told = new Map<string, number>()
function tell(who: string, text: string, rel: string) {
  const k = `${who}\0${rel}`
  if (Date.now() - (told.get(k) ?? 0) < 10 * 60_000) return
  told.set(k, Date.now())
  try { void plugin.runOp("ui.notify", { text, actionOpen: rel }).catch(() => {}) } catch { /* starting */ }
}

/** A thread a person starts by a line of a note (`find`: the words it's on). */
function personComment(who: { by: "user" | "guest"; agent: string; share?: string }, rel: string, m: Record<string, unknown>) {
  const text = str(m.text).trim().slice(0, MAX_TEXT)
  if (!text || !/\.md$/i.test(rel) || !fs.existsSync(plugin.vault.abs(rel))) return null
  if (who.share && (kept(rel).filter((n) => n.share === who.share).length >= MAX_THREADS || [...notes.values()].filter((n) => n.share === who.share).length >= MAX_THREADS * 10)) return null
  const line = Math.max(1, Math.floor(Number(m.line)) || 1), find = str(m.find).slice(0, 200)
  const anchor = find ? "" : lineText(rel, line)
  return putNote({ kind: "comment", ...who, ...(who.by === "guest" ? { tint: tintFor(who.agent) } : {}), text, path: rel, line, ...(find ? { find } : anchor ? { anchor } : {}) })
}

/** The agent a person's words ask, by the first @name in them that addresses one (as an ask in a note would). */
export function mentioned(text: string): string | undefined {
  const names = new Set([key(ownName()), "companion", key(nameOf(agentSetting())), ...agents.keys(), ...Object.keys(offered())])
  for (const m of text.matchAll(/(?<![\w@./])@([\w-]+)/g)) if (names.has(key(m[1])) || (m[1].includes("-") && profileOf(m[1], offered()))) return addressee(m[1])
  return undefined
}
/** A thread's line in its note as it reads now (its text found again), else as kept. */
function lineOf(n: Note) {
  try { return anchorLine(readText(plugin.vault.abs(n.path!)), n) ?? n.line } catch { return n.line }
}
/** The user's thread `c` asks agent `to`: it's told, with the thread's id to answer in. */
function askIn(c: Note, to: string, selection: string, from?: IncomingMessage) {
  c.ask = to
  save(c.path!)
  broadcast({ t: "note", note: c })
  addMoment({ kind: "ask", for: to, item: c.id, path: c.path, line: lineOf(c), text: c.text, ...(selection ? { selection } : {}) }, from)
}

/** Only people's threads reach a guest, and only people's words in them: an agent's could tell what's outside the folder. */
function forGuest(n: Note, g: Guest): Note | null {
  const p = g.role !== "read" && n.path && n.kind === "comment" && n.by && (n.by === "guest" || n.t >= g.since) ? g.see(n.path) : null
  if (p === null || p === undefined) return null
  const { anchor: _a, share: _s, ...rest } = n
  return { ...rest, path: p, replies: (n.replies ?? []).filter((r) => r.by !== "agent") }
}
function toGuest(ws: WebSocket, g: Guest, m: { t: string; note?: Note; id?: string }) {
  if (m.t === "note" && m.note) {
    const n = forGuest(m.note, g)
    send(ws, n ? { t: "note", note: n } : { t: "drop", id: m.note.id })
  } else if (m.t === "drop") send(ws, { t: "drop", id: m.id })
}

/** A guest's app's socket (the share's gateway checked who and what): their threads, and what they say in them. */
plugin.provide("companion:guest", (ws: WebSocket, g: Guest) => {
  guests.set(ws, g)
  co.add(ws, { who: g.who, name: g.name, tint: tintFor(g.name), edits: g.role === "edit", see: g.see, may: g.may, slow: g.slow })
  send(ws, { t: "state", mode: "quiet", name: "", agents: [], notes: [...notes.values()].map((n) => forGuest(n, g)).filter(Boolean), said: [] })
  ws.on("message", (data: RawData) => {
    let m: Record<string, unknown>
    try { m = JSON.parse(String(data)) } catch { return }
    let rel: string | null = null
    try { rel = typeof m.path === "string" ? g.at(m.path) : null } catch { /* not theirs */ }
    if (co.heard(ws, m, rel)) return
    if (g.role === "read") return // (who reads only sees: the note, its threads and who's in it)
    const n = typeof m.id === "string" ? notes.get(m.id) : undefined, theirs = n && forGuest(n, g)
    if (m.t !== "comment" && m.t !== "answer") return
    if (!g.holds()) return void ws.terminate() // (revoked or expired since the socket opened)
    // (a guest's words draw as Markdown in the user's app: nothing in them may run or fetch; checked as they're kept)
    const text = str(m.text).trim().slice(0, MAX_TEXT)
    if (g.said() || liveMarkdown(text)) return
    if (m.t === "comment") {
      if (!rel) return
      const c = personComment({ by: "guest", agent: g.name, share: g.id }, rel, { ...m, text })
      if (c) tell(g.id, `${g.name} commented on ${rel.split("/").pop()!.replace(/\.md$/i, "")}`, rel)
    } else if (m.t === "answer" && theirs && m.verdict === "reply" && text && (n.replies?.length ?? 0) < MAX_REPLIES) {
      n.replies = [...(n.replies ?? []), { by: "guest", name: g.name, text, t: Date.now() }]
      broadcast({ t: "note", note: n })
      save(n.path!)
      tell(g.id, `${g.name} replied in ${n.path!.split("/").pop()!.replace(/\.md$/i, "")}`, n.path!)
    } else if (m.t === "answer" && theirs && m.verdict === "dismiss" && n.share === g.id) {
      past.set(n.path!, [...(past.get(n.path!) ?? []).filter((x) => x.id !== n.id), { ...n, dismissed: Date.now() }].slice(-PAST))
      dropNote(n.id)
    }
  })
  ws.on("close", () => guests.delete(ws))
})
