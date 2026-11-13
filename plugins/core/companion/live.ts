import type { EditorView } from "@codemirror/view"
import type { CursorState } from "../../../core/desktop/cursor.ts"
import { profileOf } from "./profiles.ts"
import type { Change, Hunk } from "./text.ts"

export type Mode = "off" | "quiet" | "pair"
import type { Target } from "../../../core/desktop/places.ts"
import { locate } from "./locate.ts"
import { listenInputs } from "./inputs.ts"
import { windowCheck, windowSnapshot, windowThings } from "./tourwindow.ts"
export type { Target } from "../../../core/desktop/places.ts"
export type Boxed = { box?: { x: number; y: number; w: number; h: number; zoom: number } }
export type Follow = { id: string; agent: string; pane?: string; tab?: string; group?: string; ui?: string; title: string; since: number }
export type Agent = Target & Boxed & { name: string; tint: string; state: CursorState; t: number; seen?: boolean
  why?: string
  pointed?: number
  rests?: boolean
  runs?: string; model?: string; effort?: string; asks?: { event: string; text: string } }
export type How = { agent: string; model: string; effort: string }
export type Harness = { id: string; name: string; installed: boolean; models: { id: string; label: string }[]; efforts: string[] }
export type Note = Target & Boxed & { id: string; kind: "say" | "comment" | "suggestion" | "proposal" | "highlight" | "ask"; agent: string; t: number
  text?: string; replace?: string; replies?: Reply[]; pinned?: string
  changes?: Change[]; took?: number; left?: number
  by?: "user" | "guest"; tint?: string
  ask?: string
  dismissed?: number
  orphaned?: boolean
  question?: boolean; seen?: boolean; placed?: boolean }
export type Reply = { by: "user" | "agent" | "guest"; text: string; name?: string; t?: number }
export type Draft = { path: string; line: number; find?: string; text?: string; selection?: string }
export type Person = { id: number; name: string; color: string }
export type EditAsk = Target & { rid: string; agent: string; text: string; after?: string; append?: boolean; animate?: boolean }
export type StreamMsg = { t: "stream"; m: EditAsk } | { t: "more"; rid: string; at: number; add: string } | { t: "end"; rid: string; text: string } | { t: "cut" }

type State = { mode: Mode; name: string; agents: Agent[]; notes: Note[]; said: Note[]; picked: string | null; connected: boolean; draft: Draft | null; follows: Follow[]
  people: Record<string, Person[]>
  fresh: How; profiles: Record<string, How>; harnesses: Harness[]
  riding: string }
let state: State = { mode: "quiet", name: "Claude", agents: [], notes: [], said: [], picked: null, connected: false, draft: null, people: {}, follows: [],
  fresh: { agent: "", model: "", effort: "" }, profiles: {}, harnesses: [], riding: "" }
const subs = new Set<() => void>()
const changed = () => { for (const fn of [...subs]) fn() }
export const getState = () => state
export const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } }
const set = (next: Partial<State>) => { state = { ...state, ...next }; changed() }

let told: Agent[] = []
const ahead = new Map<string, { a: Partial<Agent>; timer: ReturnType<typeof setTimeout> }>()
let hearing: { path: string; line: number } | null = null
const showAgents = () => set({ agents: told.map((a) => {
  const x = ahead.get(a.name), b = x ? { ...a, ...x.a } : a
  return hearing && b.name === state.name && b.state === "watching" && state.mode !== "off" ? { ...b, state: "listening", path: hearing.path, line: hearing.line, find: undefined, x: undefined, y: undefined } : b
}) })
function heard(agents: Agent[], name?: string) {
  told = agents
  for (const [k, x] of askedHere) {
    if (!askedFromHere(k)) continue
    const a = agents.find((y) => y.name === k)
    if (a && a.state !== "watching" && a.state !== "away") Object.assign(x, { taken: true, idle: 0 })
    else if (x.taken) x.idle ||= Date.now()
  }
  for (const [k, x] of ahead) if (name === undefined || k === name) { clearTimeout(x.timer); ahead.delete(k) }
  showAgents()
}
const askedHere = new Map<string, { at: number; taken: boolean; idle: number }>()
export function askedFromHere(name: string) {
  const x = askedHere.get(name)
  if (x && ((x.idle && Date.now() - x.idle > 1500) || (!x.taken && Date.now() - x.at > 15_000))) askedHere.delete(name)
  return askedHere.has(name)
}
function expect(name: string, a: Partial<Agent>, ms: number) {
  clearTimeout(ahead.get(name)?.timer)
  ahead.set(name, { a: { ...a, seen: undefined, rests: undefined, t: Date.now() }, timer: setTimeout(() => { ahead.delete(name); showAgents() }, ms) })
  showAgents()
}
export function answered(name: string) {
  expect(name, { asks: undefined }, 5000)
  return () => { clearTimeout(ahead.get(name)?.timer); ahead.delete(name); showAgents() }
}

export function listen(name: string, path: string, line: number) {
  const a = mentionAgent(name), was = a && told.find((x) => x.name === a.name)
  if (!was || was.state !== "watching") return
  expect(was.name, { state: "reading", path, line, find: undefined }, 8000)
}

export function hear(path: string | null, line = 0, hidden = false) {
  const next = path && !hidden ? { path, line } : null
  if (next?.path === hearing?.path && next?.line === hearing?.line) return
  hearing = next
  showAgents()
}

export const tintOf = (name: string) => `var(--${state.agents.find((a) => a.name === name)?.tint ?? "orange"})`
let share: { guest: string } | null = null
export const setGuest = (g: { guest: string } | null) => { share = g }
export const threadTint = (n: Note) => (n.tint ? `var(--${n.tint})` : n.by === "user" ? "var(--muted-foreground)" : tintOf(n.agent))
export const authorOf = (n: Note) => (n.by === "user" ? (share ? "Owner" : "You") : n.by === "guest" && share?.guest === n.agent ? "You" : n.agent)
export const replyAuthor = (n: Note, r: Reply) => (r.by === "user" ? (share ? "Owner" : "You") : r.by === "guest" ? (share?.guest === r.name ? "You" : r.name ?? "Guest") : r.name ?? n.agent)

export const setPeople = (path: string, list: Person[]) => {
  const { [path]: _, ...rest } = state.people
  set({ people: list.length ? { ...rest, [path]: list } : rest })
}
let rooms: { heard: (m: Record<string, unknown>) => void; goTo: (path: string, id: number) => void } | null = null
export const setRooms = (r: typeof rooms) => { rooms = r }
export const goToPerson = (path: string, id: number) => rooms?.goTo(path, id)

export const startComment = (d: Draft | null) => set({ draft: d, picked: d ? "draft" : state.picked === "draft" ? null : state.picked })
export function comment(text: string) {
  const d = state.draft
  if (!d || !text.trim()) return true
  if (!say({ t: "comment", ...d, text: text.trim() })) return false
  set({ draft: null, picked: null })
  return true
}


export const views = new Map<EditorView, string>()
const onScreen = (v: EditorView) => v.dom.isConnected && (v.hasFocus || v.dom.getClientRects().length > 0)
export function viewOf(path: string): EditorView | null {
  let best: EditorView | null = null
  for (const [v, p] of views) {
    if (p !== path || !onScreen(v)) continue
    if (v.hasFocus) return v
    best ??= v
  }
  return best
}
let drawings: { where: () => { open: string[]; focus: Target | null }; draw: (m: Record<string, unknown>) => void } | null = null
export const setDrawings = (d: typeof drawings) => { drawings = d }
let panes: (() => { panes: { id: string; to: string; title: string; tab?: string; group?: string }[]; pane?: string }) | null = null
export const setPanes = (fn: typeof panes) => { panes = fn }
let folder: ((path: string, agent: string, line?: number) => (() => void) | null) | null = null
export const setFolder = (fn: typeof folder) => { folder = fn }
export const foldable = (a: Agent) => (a.path && folder ? folder(a.path, a.name, a.line) : null)
let typer: ((v: EditorView, e: EditAsk) => Promise<void>) | null = null
export const setTyper = (fn: typeof typer) => { typer = fn }
let streamer: ((v: EditorView | null, s: StreamMsg) => void) | null = null
export const setStreamer = (fn: typeof streamer) => { streamer = fn }
let undoer: { undo: (agent?: string) => boolean; can: (agent?: string) => boolean } | null = null
export const setUndoer = (u: typeof undoer) => { undoer = u }
export const canUndoEdit = (agent?: string) => !!undoer?.can(agent)
export const undoEdit = (agent?: string) => !!undoer?.undo(agent)


let ws: WebSocket | null = null
let retry: ReturnType<typeof setTimeout> | null = null
let tries = 0
let users = 0

export function connect() {
  users++
  if (!ws && !retry) open()
  return () => {
    if (--users > 0) return
    if (retry) { clearTimeout(retry); retry = null }
    ws?.close(); ws = null
  }
}

function open() {
  retry = null
  const url = new URL("api/companion/live", location.href)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  const s = new WebSocket(url)
  ws = s
  s.onopen = () => { tries = 0; saidWhere = ""; set({ connected: true }); sayWhere(true) }
  s.onclose = () => {
    if (ws !== s) return
    ws = null
    set({ connected: false, riding: "" })
    streamer?.(null, { t: "cut" })
    if (users > 0) retry = setTimeout(open, Math.min(30_000, 1000 * 2 ** tries++))
  }
  s.onmessage = (ev) => {
    let m: Record<string, unknown>
    try { m = JSON.parse(String(ev.data)) } catch { return }
    if (m.t === "state") { set({ mode: m.mode as Mode, name: String(m.name), notes: m.notes as Note[], said: (m.said as Note[] | undefined) ?? [],
      fresh: (m.fresh as How | undefined) ?? { agent: "", model: "", effort: "" }, profiles: (m.profiles as State["profiles"] | undefined) ?? {},
      harnesses: (m.harnesses as Harness[] | undefined) ?? [], follows: (m.follows as Follow[] | undefined) ?? [], riding: typeof m.riding === "string" ? m.riding : "" }); heard(m.agents as Agent[]) }
    else if (m.t === "riding") set({ riding: typeof m.agent === "string" ? m.agent : "" })
    else if (m.t === "follows") set({ follows: (m.follows as Follow[] | undefined) ?? [] })
    else if (m.t === "said") set({ said: m.said as Note[] })
    else if (m.t === "agent") {
      const a = m.agent as Agent
      heard([...told.filter((x) => x.name !== a.name), a], a.name)
    } else if (m.t === "note") {
      const n = m.note as Note
      const has = state.notes.some((x) => x.id === n.id)
      if (!has && n.kind === "say") arrived.set(n.id, Date.now())
      set({ notes: has ? state.notes.map((x) => (x.id === n.id ? n : x)) : [...state.notes, n] })
    } else if (m.t === "drop") { arrived.delete(String(m.id)); drawnAt.delete(String(m.id)); set({ notes: state.notes.filter((x) => x.id !== m.id) }) }
    else if (m.t === "edit") void edit(m as unknown as EditAsk)
    else if (m.t === "stream") {
      const e = m as unknown as EditAsk, v = e.path ? viewOf(e.path) : null
      if (!v || !streamer) say({ t: "done", rid: e.rid, ok: false })
      else streamer(v, { t: "stream", m: e })
    } else if (m.t === "stream-more") streamer?.(null, { t: "more", rid: String(m.rid), at: Number(m.at), add: String(m.add ?? "") })
    else if (m.t === "stream-end") streamer?.(null, { t: "end", rid: String(m.rid), text: String(m.text ?? "") })
    else if (m.t === "y-state" || m.t === "y" || m.t === "aw" || m.t === "y-reject" || m.t === "y-peers" || m.t === "y-clash" || m.t === "y-gone") rooms?.heard(m)
    else if (m.t === "draw") { if (drawings) drawings.draw(m); else say({ t: "done", rid: m.rid, ok: false }) }
    else if (m.t === "locate") say({ t: "done", rid: m.rid, ok: true, rects: locate(m.places, m.near) })
    else if (m.t === "inputs") listenInputs(m.on === true, say)
    else if (m.t === "things") say({ t: "done", rid: m.rid, ok: true, ...windowThings() })
    else if (m.t === "check") say({ t: "done", rid: m.rid, ok: true, verdict: windowCheck(m.condition as Parameters<typeof windowCheck>[0], typeof m.before === "string" ? m.before : undefined) })
    else if (m.t === "snapshot") say({ t: "done", rid: m.rid, ok: true, snapshot: windowSnapshot() })
  }
}

export const say = (m: object) => { if (ws?.readyState !== WebSocket.OPEN) return false; ws.send(JSON.stringify(m)); return true }

let turn: Promise<unknown> = Promise.resolve()
const inTurn = <T>(fn: () => Promise<T>) => { const run = turn.then(fn); turn = run.catch(() => {}); return run }

const edit = (e: EditAsk) => inTurn(async () => {
  const v = e.path ? viewOf(e.path) : null
  if (!v || !typer) return say({ t: "done", rid: e.rid, ok: false })
  try {
    await typer(v, e)
    say({ t: "done", rid: e.rid, ok: true })
  } catch (err) {
    say({ t: "done", rid: e.rid, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})

export function sendMoment(m: { kind: "ask" | "point" | "edit" | "change"; agent?: string; path?: string; line?: number; text?: string; selection?: string; find?: string; hunks?: Hunk[]; waited?: number
  x?: number; y?: number; changes?: string[]; scene?: string; pane?: string; ui?: string; row?: number; title?: string; under?: string; summoned?: boolean; voice?: boolean }) {
  if (share) return true
  if (!say({ t: "moment", ...m })) return false
  const a = m.kind === "ask" || m.kind === "point" ? mentionAgent(m.agent ?? state.name) : undefined
  if (a) askedHere.set(a.name, { at: Date.now(), taken: false, idle: 0 })
  if (a && a.state !== "away" && a.state !== "starting") expect(a.name, { state: "thinking", ...(m.path ? { path: m.path, line: m.line, find: m.find } : m.pane || m.ui ? { path: undefined, line: undefined, find: undefined, pane: m.pane, ui: m.ui, row: m.row } : {}) }, 10_000)
  return true
}
export const uiChanged = (agent: string, ui: string, changes: string[], title?: string) => sendMoment({ kind: "change", agent, ui, changes, ...(title ? { title } : {}) })
export const pin = (id: string) => say({ t: "pin", id })
export const sawSays = (ids: string[]) => {
  const fresh = ids.filter((id) => state.said.some((n) => n.id === id && !n.seen))
  if (!fresh.length) return
  set({ said: state.said.map((n) => (fresh.includes(n.id) ? { ...n, seen: true } : n)) })
  say({ t: "seen", ids: fresh })
}
const arrived = new Map<string, number>(), drawnAt = new Map<string, number>()
export const arrivedAt = (id: string) => arrived.get(id) ?? 0
export const sawShown = (id: string) => { if (!drawnAt.has(id)) drawnAt.set(id, Date.now()) }
export const shownFor = (id: string) => { const t = drawnAt.get(id); return t === undefined ? 0 : Date.now() - t }
export const hideSay = (id: string) => { set({ notes: state.notes.filter((x) => x.id !== id) }); say({ t: "hide", id }) }
export const unread = (agent: string) => state.said.filter((n) => n.agent === agent && !n.seen && !n.placed && !n.pinned)
export const reopen = (id: string) => say({ t: "reopen", id })
export const pick = (id: string | null) => { if (state.picked !== id) set({ picked: id }) }

export function answer(id: string, verdict: "accept" | "reject" | "dismiss" | "reply", text?: string) {
  if (verdict === "reply" && ws?.readyState !== WebSocket.OPEN) return false
  if (verdict !== "reply" || state.notes.find((x) => x.id === id)?.kind === "say") set({ notes: state.notes.filter((x) => x.id !== id) })
  say({ t: "answer", id, verdict, text })
  return true
}

export function review(id: string, verdict: "accept" | "reject", change?: string) {
  if (verdict === "reject") {
    const n = state.notes.find((x) => x.id === id), rest = (n?.changes ?? []).filter((c) => change && c.id !== change)
    set({ notes: rest.length ? state.notes.map((x) => (x.id === id ? { ...x, changes: rest } : x)) : state.notes.filter((x) => x.id !== id) })
  }
  say({ t: "review", id, verdict, ...(change ? { change } : {}) })
}

let saidWhere = ""
let whereSoon: ReturnType<typeof setTimeout> | null = null
export function sayWhere(active = false) {
  if (whereSoon) { clearTimeout(whereSoon); whereSoon = null }
  const drawn = drawings?.where() ?? { open: [], focus: null }
  const open = [...new Set([...[...views].filter(([v]) => v.dom.isConnected).map(([, p]) => p), ...drawn.open])]
  const shown = [...new Set([...[...views].filter(([v]) => onScreen(v)).map(([, p]) => p), ...drawn.open])]
  const f = [...views.keys()].find((v) => v.hasFocus)
  const focus = f ? { path: views.get(f)!, line: f.state.doc.lineAt(f.state.selection.main.head).number } : drawn.focus
  const m = { t: "where", open, shown, focus, ...panes?.(), active: active && document.hasFocus() }, json = JSON.stringify({ ...m, active: false })
  if (!m.active && json === saidWhere) return
  if (say(m)) saidWhere = json
}
export const sayWhereSoon = () => { if (whereSoon) clearTimeout(whereSoon); whereSoon = setTimeout(() => sayWhere(), 1000) }

export const liveAgents = () => state.agents.filter((a) => a.state !== "away").sort((a, b) => Number(b.name === state.name) - Number(a.name === state.name))
export function mentionAgent(name: string): Agent | undefined {
  const k = name.toLowerCase()
  return state.agents.find((a) => a.name.toLowerCase() === k && a.state !== "away") ?? (mainName(k) || !profileOf(k, state.profiles) ? state.agents.find((a) => a.name === state.name) : undefined)
}
const mainName = (k: string) => k === "companion" || k === state.name.toLowerCase() || k === (state.fresh.agent.split("_")[0] || "claude")
export const mentionNames = () => (share ? [] : [...new Set(["companion", "claude", state.name.toLowerCase(), ...state.agents.map((a) => a.name.toLowerCase()), ...Object.keys(state.profiles)])])
export const howOf = (name: string): How => profileOf(name, state.profiles) ?? state.fresh
export const howText = (h: Partial<How> & { runs?: string }) => howWith(h, state.harnesses)
function howWith(h: Partial<How> & { runs?: string }, harnesses: Harness[]) {
  const id = (h.agent ?? h.runs ?? "").split("_")[0], harness = harnesses.find((x) => x.id === id)
  const model = h.model && (harness?.models.find((m) => m.id === h.model)?.label ?? capitalize(h.model))
  return [harness?.name ?? (id && capitalize(id)), model, h.effort && effortName(h.effort)].filter(Boolean).join(" · ")
}
export const effortName = (e: string) => (e === "xhigh" ? "extra high" : e)
export const nameAs = (name: string) => state.harnesses.find((x) => x.id === name.toLowerCase())?.name ?? capitalize(name)
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)


const bumps = new Set<() => void>()
export const bump = () => { for (const fn of [...bumps]) fn() }
export const onBump = (fn: () => void) => { bumps.add(fn); return () => { bumps.delete(fn) } }

export let typing: { view: EditorView; pos: number; agent: string } | null = null
export const setTyping = (t: typeof typing) => { typing = t; bump() }

export async function accept(n: Note) {
  const v = n.path ? viewOf(n.path) : null
  if (v && typer && n.find !== undefined) await inTurn(() => typer!(v, { rid: "", agent: n.agent, path: n.path, find: n.find, line: n.line, text: n.replace ?? "", animate: false }))
  answer(n.id, "accept")
}


export function hunksIn(a: string[], b: string[], spans: [number, number, number, number][]): Hunk[] {
  const merged: [number, number, number, number][] = []
  for (const s of spans) {
    const p = merged.at(-1)
    if (p && s[0] <= p[1] + 1 && s[2] <= p[3] + 1) { p[1] = Math.max(p[1], s[1]); p[3] = Math.max(p[3], s[3]) } else merged.push([...s])
  }
  return merged.flatMap(([a1, a2, b1, b2]) => {
    let removed = a.slice(a1 - 1, a2), added = b.slice(b1 - 1, b2), line = b1
    while (removed.length && added.length && removed[0] === added[0]) { removed = removed.slice(1); added = added.slice(1); line++ }
    while (removed.length && added.length && removed.at(-1) === added.at(-1)) { removed = removed.slice(0, -1); added = added.slice(0, -1) }
    return removed.length || added.length ? [{ line, removed: removed.slice(0, 40), added: added.slice(0, 40) }] : []
  }).slice(0, 20)
}

const LEAD = /^\s*(?:[-*+]\s+(?:\[.\]\s+)?)?/
const MENTION_AT = new RegExp(`${LEAD.source}$`)
const MENTION_RE = /(?<![\w@./])@([\w-]+)/g
export const canMention = (before: string) => !/[\w@./]$/.test(before)
export const midNames = () => (share ? [] : [...new Set([state.name, ...liveAgents().map((a) => a.name)].map((n) => n.toLowerCase()))])
export type Mention = { from: number; to: number; name: string }
export function mentionsOf(line: string, names = mentionNames(), mid = midNames()): Mention[] {
  const out: Mention[] = [], lead = LEAD.exec(line)![0].length
  for (const m of line.matchAll(MENTION_RE)) {
    const k = m[1].toLowerCase()
    if ((m.index === lead ? names : mid).includes(k) || (m.index === lead && k.includes("-") && names.includes(k.split("-")[0]) && !!profileOf(k, state.profiles)))
      out.push({ from: m.index, to: m.index + m[0].length, name: m[1] })
  }
  return out
}
export function mentionIn(line: string, names = mentionNames(), mid = midNames()): { name: string; text: string } | null {
  const [m] = mentionsOf(line, names, mid)
  if (!m) return null
  const text = MENTION_AT.test(line.slice(0, m.from)) ? line.slice(m.to).replace(/^[:,]/, "").trim() : line.trim()
  return { name: m.name, text: text || "(no words: look at this)" }
}
export const asksSomething = (line: string, ms: Mention[]) => !!ms.reduceRight((s, m) => s.slice(0, m.from) + s.slice(m.to), line).replace(LEAD, "").replace(/[\s\p{P}]/gu, "")
