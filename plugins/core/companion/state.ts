import fs from "node:fs"
import { WebSocket } from "ws"
import { z } from "zod"
import { type Who } from "../../../core/plugins.ts"
import { profileOf } from "./profiles.ts"
import { type Pane, PLACE_KEYS, type Target } from "../../../core/desktop/places.ts"
import { inSummoned } from "./summoned.ts"
import { keepShown, type Shown as ShownMark } from "./shown.ts"
import { TINTS, setting, mode, agentSetting, howOf, ownName, nameOf, profiles, inAccount, harnesses } from "./settings.ts"
import { plugin } from "./self.ts"
import type { Moment, Agent, KeptAgent, Note } from "./types.ts"
import { ActRow, MomentRow } from "./rows.ts"
import { KEPT, save, anchorLine } from "./comments.ts"
import { screens } from "./windows.ts"
import { SCREEN_NEWS, riding } from "./screensocket.ts"
import { followed } from "./windowpanes.ts"
import { touredAsk, vaultText } from "./edits.ts"
import { session, sessionId, sessions, isChat, runsOf } from "./alwayson.ts"
import { lane } from "./lane.ts"
import { toGuest } from "./people.ts"

export const moments: Moment[] = []
export let seq = 0
export const nextSeq = () => ++seq
export const delivered = new Map<string, number>()
export const handed = new Set<string>()
export const asking = new Set<string>()
export const waiters = new Map<string, (m: Moment[]) => void>()
export const agents = new Map<string, KeptAgent>()
export const life = new Map<string, "starting" | "away">()
export const atWork = new Set<string>()
const writes = new Map<string, number>()
const wrote = new Set<string>()
export const seen = new Map<string, number>()
export const ends = new Map<string, number>()
export const dead = new Set<string>()
export const watching = new Set<string>()
export const loaded = Date.now(), LIVE_MS = 10 * 60_000
export const notes = new Map<string, Note>()
export let said: Note[] = []
export const recentSays = () => said
export const setSaid = (to: Note[]) => { said = to }
export const SAID = 10
export const timers = new Map<string, ReturnType<typeof setTimeout>>()
export const log = plugin.dayLog("moments", MomentRow)
export const acts = plugin.dayLog("actions", ActRow)
export const BOOKKEEPING = new Set(["next", "handed", "sent", "done", "again", "result", "withdrawn", "talked", "shown"])
export const showedAt = new Map<string, number>(), passedAt = new Map<string, number>()
const SHOWING = new Set(["look", "draw", "highlight", "act"])
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
export const shownBy = new Map<string, ShownMark[]>()
export const showed = (as: string, add: ShownMark[]) => { if (add.length) shownBy.set(key(as), keepShown(shownBy.get(key(as)) ?? [], add)) }

type Win = { open: string[]; shown: string[]; focus: Target | null; at: number; was?: string
  panes: Pane[]; pane?: string; told?: string }
export const windows = new Map<WebSocket, Win>()
export type Guest = { id: string; name: string; who: Who; role: "read" | "comment" | "edit"; see: (rel: string) => string | null; at: (p: string) => string; said: () => boolean
  holds: () => boolean
  may: (rel: string, before: string, after: string) => string; slow: () => boolean
  since: number }
export const guests = new Map<WebSocket, Guest>()
export const MAX_TEXT = 4000, MAX_THREADS = 100, MAX_REPLIES = 100
export const asked = new Map<string, { ws: WebSocket; done: (ok: boolean, error?: string, reply?: Record<string, unknown>) => void }>()

export const send = (ws: WebSocket, m: object) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)) }
export const broadcast = <M extends { t: string; note?: Note; id?: string }>(m: M) => {
  const t = m.t
  if (t === "note" || t === "state" || t === "voice") m = { ...m, voice: setting("voice") }
  const text = JSON.stringify(m)
  for (const ws of windows.keys()) if (ws.readyState === ws.OPEN) ws.send(text)
  if (SCREEN_NEWS.has(m.t)) for (const ws of screens) if (ws.readyState === ws.OPEN) ws.send(text)
  for (const [ws, g] of guests) if (ws.readyState === ws.OPEN) toGuest(ws, g, m)
}
export const snapshot = () => ({ t: "state", mode: mode(), name: ownName(), agents: [...agents.values()].map(shown), notes: [...notes.values()], said, follows: followed.list(), riding: riding(), ...offers() })
export function offers() {
  const named = Object.entries(offered()).map(([name, p]) => [name, { agent: p.agent, ...howOf(p.agent, p.model, p.effort) }])
  return { fresh: { agent: agentSetting(), ...howOf(agentSetting()) }, profiles: Object.fromEntries(named), harnesses: harnesses() }
}
export function offered() {
  const here = harnesses(), on = (agent: string) => here.some((h) => h.id === agent.split("_")[0] && (h.installed || h.id === agentSetting().split("_")[0]))
  return Object.fromEntries(Object.entries(profiles()).flatMap(([name, p]) => (on(p.agent) ? [[name, { ...p, agent: inAccount(p.agent) }]] : [])))
}

export const key = (name: string) => name.trim().toLowerCase()
export const isMain = (name: string) => key(name) === key(ownName())
export const live = (name: string) => waiters.has(key(name)) || Date.now() - (seen.get(key(name)) ?? 0) < LIVE_MS || isChat(sessionId(name))
export function addressee(name?: string) {
  const a = name ? agents.get(key(name)) : undefined
  if (!name || (a && stateOf(a.name) !== "away" && live(a.name))) return a?.name ?? ownName()
  if (isMain(name) || key(name) === "companion" || key(name) === key(nameOf(agentSetting()))) return ownName()
  return session(name) || profileOf(name, offered()) ? a?.name ?? nameOf(key(name)) : ownName()
}
export const meantFor = (m: Moment, name: string) => !m.live && (m.for ? key(m.for) === key(name) && !(m.summoned && isMain(name) && lane().on()) : isMain(name) || watching.has(key(name)))

export const focus = () => [...windows.values()].sort((a, b) => b.at - a.at).find((w) => w.focus)?.focus ?? null

export const placeOf = (m: Partial<Moment>): Partial<KeptAgent> => (m.app || m.sx !== undefined ? { ...(m.app ? { app: m.app } : {}), ...(m.window ? { window: m.window } : m.sx !== undefined && m.sy !== undefined ? { sx: m.sx, sy: m.sy } : {}) } : m.path ? { path: m.path, line: m.line, find: m.find }
  : m.pane ? { pane: m.pane, ...(m.row ? { row: m.row } : {}) } : m.ui ? { ui: m.ui } : {})

export const batches = new Map<string, number[]>()
export const resend = new Set<string>()

const tintsFile = () => `${plugin.localDir()}/tints.json`
let tints: Record<string, string> | null = null
const Tints = z.record(z.string(), z.string())
const HARNESS_TINTS: Record<string, string> = { claude: "orange", codex: "blue" }
export function agentOf(name: string): KeptAgent {
  let a = agents.get(key(name))
  if (!a) {
    if (!tints) try { tints = Tints.parse(JSON.parse(fs.readFileSync(tintsFile(), "utf8"))) } catch { tints = {} }
    const used = new Set([...agents.values()].map((x) => x.tint))
    const s = session(name), runs = (s && runsOf(s)) || (isMain(name) ? agentSetting() : profileOf(name, offered())?.agent ?? "")
    const want = tints![key(name)] ?? HARNESS_TINTS[runs.split("_")[0]] ?? null
    const tint = want && !used.has(want) ? want : TINTS.find((t) => !used.has(t) && t !== "orange" && t !== "blue") ?? TINTS.find((t) => !used.has(t)) ?? TINTS[agents.size % TINTS.length]
    if (tints![key(name)] !== tint) { tints![key(name)] = tint; try { fs.writeFileSync(tintsFile(), JSON.stringify(tints)) } catch {} }
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
  agents.delete(k); life.delete(k); atWork.delete(k); writes.delete(k); wrote.delete(k); asking.delete(k); handed.delete(k); seen.delete(k)
}

export function newId() {
  let id: string
  do id = `n${Math.random().toString(36).slice(2, 6)}`; while (notes.has(id))
  return id
}

export function putNote(n: Omit<Note, "id" | "t">, ttl?: number) {
  const note: Note = { ...n, id: newId(), t: Date.now() }
  if (note.kind !== "proposal" && KEPT.has(note.kind) && note.path && note.find && note.line === undefined) {
    const text = vaultText(note.path)
    if (text !== null) note.line = anchorLine(text, note) ?? undefined
  }
  notes.set(note.id, note)
  broadcast({ t: "note", note })
  if (ttl) timers.set(note.id, setTimeout(() => dropNote(note.id), ttl))
  if (KEPT.has(note.kind)) save(note.path!)
  return note
}
export const personThread = (id: string) => !!notes.get(id)?.by
export function dropNote(id: string) {
  clearTimeout(timers.get(id)); timers.delete(id)
  const n = notes.get(id)
  if (!n || !notes.delete(id)) return
  broadcast({ t: "drop", id })
  if (KEPT.has(n.kind) && n.path) save(n.path)
}
