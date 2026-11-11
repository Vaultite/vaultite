// The companion as this window knows it: the server's agents and notes (/api/companion/live), the editors showing
// files, and what the user does in them, said back. No CodeMirror here: the editor is its own chunk (editor.ts).
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
/** listening: this window's own, the user dictating where it is (`hear`) while it's free; the server never says it. */
/** Where a page's element is in its page (CSS px, at its zoom): the server's word for a place's `el`. */
export type Boxed = { box?: { x: number; y: number; w: number; h: number; zoom: number } }
/** What an agent follows this session (follows.ts): a pane, a tab group, or a part of the app's UI. */
export type Follow = { id: string; agent: string; pane?: string; tab?: string; group?: string; ui?: string; title: string; since: number }
export type Agent = Target & Boxed & { name: string; tint: string; state: CursorState; t: number; seen?: boolean
  /** Why it let what it saw pass, in its few words (by the seen tick). */
  why?: string
  /** When it last pointed at its place (look, highlight, a say given one): a phone shows it there a moment. */
  pointed?: number
  /** Moved there without acting (plugin.ts setAgent): its cursor rests at home till it acts. */
  rests?: boolean
  runs?: string; model?: string; effort?: string; asks?: { event: string; text: string } }
/** What a session runs: its coding agent (claude, codex, claude_work), model and effort ("": its own). */
export type How = { agent: string; model: string; effort: string }
/** A coding agent a plugin runs: whether it's installed here, its models (none: it runs its own) and efforts. */
export type Harness = { id: string; name: string; installed: boolean; models: { id: string; label: string }[]; efforts: string[] }
export type Note = Target & Boxed & { id: string; kind: "say" | "comment" | "suggestion" | "proposal" | "highlight" | "ask"; agent: string; t: number
  text?: string; replace?: string; replies?: Reply[]; pinned?: string
  /** A proposal's changes not decided yet (placeholders while it's written), and how many were taken and left. */
  changes?: Change[]; took?: number; left?: number
  /** A person's thread (the user's, a guest's: `agent` is their name), and their colour. */
  by?: "user" | "guest"; tint?: string
  /** The agent a person's thread asks (an @name in it), which answers in it. */
  ask?: string
  /** A comment the user dismissed, when (companion.history's). */
  dismissed?: number
  /** The text it was on is gone: shown by its last line. */
  orphaned?: boolean
  /** A say that asks the user something; one they saw (else the unread dot); one they put in the note. */
  question?: boolean; seen?: boolean; placed?: boolean }
export type Reply = { by: "user" | "agent" | "guest"; text: string; name?: string; t?: number }
/** A comment being written: where, the words it starts with (Ask: "@claude "), the selection it asks about. */
export type Draft = { path: string; line: number; find?: string; text?: string; selection?: string }
/** Someone else in a note: their awareness id, name and colour (a CSS value). */
export type Person = { id: number; name: string; color: string }
export type EditAsk = Target & { rid: string; agent: string; text: string; after?: string; append?: boolean; animate?: boolean }
/** An edit typed in as it's written: opened (`stream`, its words so far), more words (`more`: `add` at `at`), ended
 *  (`end`: all of it); `cut`: the connection went, every stream stops where it is. */
export type StreamMsg = { t: "stream"; m: EditAsk } | { t: "more"; rid: string; at: number; add: string } | { t: "end"; rid: string; text: string } | { t: "cut" }

/** said: each agent's last says, oldest first; picked: the margin card the user opened; people: who else has each
 *  note open with this window (cotype.ts), by path. */
type State = { mode: Mode; name: string; agents: Agent[]; notes: Note[]; said: Note[]; picked: string | null; connected: boolean; draft: Draft | null; follows: Follow[]
  people: Record<string, Person[]>
  /** What a new agent runs: one whose name picks none, those whose name does (by profile name), what's installed. */
  fresh: How; profiles: Record<string, How>; harnesses: Harness[]
  /** The agent riding with the user's pointer over the screen (its Talk key's exchange, the desktop app's helper): its
   *  cursor isn't drawn here meanwhile, one companion at a time. */
  riding: string }
let state: State = { mode: "quiet", name: "Claude", agents: [], notes: [], said: [], picked: null, connected: false, draft: null, people: {}, follows: [],
  fresh: { agent: "", model: "", effort: "" }, profiles: {}, harnesses: [], riding: "" }
const subs = new Set<() => void>()
const changed = () => { for (const fn of [...subs]) fn() }
export const getState = () => state
export const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } }
const set = (next: Partial<State>) => { state = { ...state, ...next }; changed() }

/** The agents as the server last said, and what this window shows ahead of it (an ask just sent, the user writing to
 *  one): the server's next word on an agent replaces its own. */
let told: Agent[] = []
const ahead = new Map<string, { a: Partial<Agent>; timer: ReturnType<typeof setTimeout> }>()
/** The user dictating in a note (`hear`): the companion, when free, listens there. */
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
/** The agents at work on an ask sent from this window (a phone shows only those thinking), until they're done with it. */
const askedHere = new Map<string, { at: number; taken: boolean; idle: number }>()
/** Whether agent `name` is on an ask from here: over once it's been idle a moment since taking it up (between two of
 *  its moments it's idle for less), or when it never took it up. */
export function askedFromHere(name: string) {
  const x = askedHere.get(name)
  if (x && ((x.idle && Date.now() - x.idle > 1500) || (!x.taken && Date.now() - x.at > 15_000))) askedHere.delete(name)
  return askedHere.has(name)
}
/** Show agent `name` as `a` now, before the server says so (for `ms` at most). */
function expect(name: string, a: Partial<Agent>, ms: number) {
  clearTimeout(ahead.get(name)?.timer)
  ahead.set(name, { a: { ...a, seen: undefined, rests: undefined, t: Date.now() }, timer: setTimeout(() => { ahead.delete(name); showAgents() }, ms) })
  showAgents()
}
/** Agent `name`'s question answered here: it goes at once. Returns the undo, for an answer that failed. */
export function answered(name: string) {
  expect(name, { asks: undefined }, 5000)
  return () => { clearTimeout(ahead.get(name)?.timer); ahead.delete(name); showAgents() }
}

/** The user is writing an ask to @name on this line: its cursor comes over to read along, when it's free. */
export function listen(name: string, path: string, line: number) {
  const a = mentionAgent(name), was = a && told.find((x) => x.name === a.name)
  if (!was || was.state !== "watching") return
  expect(was.name, { state: "reading", path, line, find: undefined }, 8000)
}

/** The user dictating on `line` of `path` (not a private note's: `hidden`): the companion's cursor listens there while
 *  it's free, as long as they dictate, whatever the server says meanwhile; null: they stopped. */
export function hear(path: string | null, line = 0, hidden = false) {
  const next = path && !hidden ? { path, line } : null
  if (next?.path === hearing?.path && next?.line === hearing?.line) return
  hearing = next
  showAgents()
}

/** An agent's colour, as a CSS value. */
export const tintOf = (name: string) => `var(--${state.agents.find((a) => a.name === name)?.tint ?? "orange"})`
/** A shared folder's guest, when this app is theirs (index.tsx says): no agent works for them. */
let share: { guest: string } | null = null
export const setGuest = (g: { guest: string } | null) => { share = g }
/** A thread's colour: its person's, else its agent's. */
export const threadTint = (n: Note) => (n.tint ? `var(--${n.tint})` : n.by === "user" ? "var(--muted-foreground)" : tintOf(n.agent))
/** Who started a thread, as this window names them (a guest's app: the folder's owner is "Owner"). */
export const authorOf = (n: Note) => (n.by === "user" ? (share ? "Owner" : "You") : n.by === "guest" && share?.guest === n.agent ? "You" : n.agent)
/** Who wrote a reply, likewise. */
export const replyAuthor = (n: Note, r: Reply) => (r.by === "user" ? (share ? "Owner" : "You") : r.by === "guest" ? (share?.guest === r.name ? "You" : r.name ?? "Guest") : r.name ?? n.agent)

/** Who's in `path` now (cotype.ts says). */
export const setPeople = (path: string, list: Person[]) => {
  const { [path]: _, ...rest } = state.people
  set({ people: list.length ? { ...rest, [path]: list } : rest })
}
/** Notes' rooms (cotype.ts, loaded with the editor): their messages, and taking the user to someone's caret. */
let rooms: { heard: (m: Record<string, unknown>) => void; goTo: (path: string, id: number) => void } | null = null
export const setRooms = (r: typeof rooms) => { rooms = r }
export const goToPerson = (path: string, id: number) => rooms?.goTo(path, id)

/** Start writing a comment there (Add comment), or stop. */
export const startComment = (d: Draft | null) => set({ draft: d, picked: d ? "draft" : state.picked === "draft" ? null : state.picked })
/** Send the comment being written: a thread of the user's (a guest's, in theirs); an @name in it asks that agent. */
export function comment(text: string) {
  const d = state.draft
  if (!d || !text.trim()) return true
  if (!say({ t: "comment", ...d, text: text.trim() })) return false
  set({ draft: null, picked: null })
  return true
}

// ---------- editors showing files

/** The editors on screen with a file, so edits find theirs and the overlay draws on them. */
export const views = new Map<EditorView, string>()
/** Whether an editor is on screen: a kept tab's (hidden) can't show what's typed in it. */
const onScreen = (v: EditorView) => v.dom.isConnected && (v.hasFocus || v.dom.getClientRects().length > 0)
/** An editor showing `path`: the focused one, else the first that's on screen. */
export function viewOf(path: string): EditorView | null {
  let best: EditorView | null = null
  for (const [v, p] of views) {
    if (p !== path || !onScreen(v)) continue
    if (v.hasFocus) return v
    best ??= v
  }
  return best
}
/** The drawings this window shows (canvas.ts registers them): their paths, where the user is in one, and who makes an
 *  agent's drawing there. */
let drawings: { where: () => { open: string[]; focus: Target | null }; draw: (m: Record<string, unknown>) => void } | null = null
export const setDrawings = (d: typeof drawings) => { drawings = d }
/** The window's panes (panes.ts registers them): each pane's tab and title, and the focused one. */
let panes: (() => { panes: { id: string; to: string; title: string; tab?: string; group?: string }[]; pane?: string }) | null = null
export const setPanes = (fn: typeof panes) => { panes = fn }
/** What folds an agent's lines by its cursor back into a bubble (editor.ts, once loaded): its run, or null. */
let folder: ((path: string, agent: string, line?: number) => (() => void) | null) | null = null
export const setFolder = (fn: typeof folder) => { folder = fn }
/** Agent `a`'s answer by its cursor, folded into a bubble: what its menu runs, or null when there's none. */
export const foldable = (a: Agent) => (a.path && folder ? folder(a.path, a.name, a.line) : null)
/** Who types an edit into an editor (editor.ts registers it once loaded). */
let typer: ((v: EditorView, e: EditAsk) => Promise<void>) | null = null
export const setTyper = (fn: typeof typer) => { typer = fn }
/** Who types a streamed edit in (editor.ts, likewise). */
let streamer: ((v: EditorView | null, s: StreamMsg) => void) | null = null
export const setStreamer = (fn: typeof streamer) => { streamer = fn }
/** Taking back an agent's last edit (editor.ts, likewise): whether there's one on screen, and undoing it. */
let undoer: { undo: (agent?: string) => boolean; can: (agent?: string) => boolean } | null = null
export const setUndoer = (u: typeof undoer) => { undoer = u }
export const canUndoEdit = (agent?: string) => !!undoer?.can(agent)
export const undoEdit = (agent?: string) => !!undoer?.undo(agent)

// ---------- the connection

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
      // (what an agent started from here runs; no model: its agent takes none)
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
    // (where its places are on the screen, for a drawing over it)
    else if (m.t === "locate") say({ t: "done", rid: m.rid, ok: true, rects: locate(m.places, m.near) })
    // (a companion's wait listening: what the user clicks and types here)
    else if (m.t === "inputs") listenInputs(m.on === true, say)
    // (a tour playing here: what's in the window, one state checked, what it shows now)
    else if (m.t === "things") say({ t: "done", rid: m.rid, ok: true, ...windowThings() })
    else if (m.t === "check") say({ t: "done", rid: m.rid, ok: true, verdict: windowCheck(m.condition as Parameters<typeof windowCheck>[0], typeof m.before === "string" ? m.before : undefined) })
    else if (m.t === "snapshot") say({ t: "done", rid: m.rid, ok: true, snapshot: windowSnapshot() })
  }
}

/** Send `m` to the server: false when it can't go now (no connection), so what the user wrote can stay to send again. */
export const say = (m: object) => { if (ws?.readyState !== WebSocket.OPEN) return false; ws.send(JSON.stringify(m)); return true }

let turn: Promise<unknown> = Promise.resolve()
/** Edits typed one at a time, each where the last left the note. */
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

/** Something the user did, for the agents (an ask: for `agent`, else the companion, who shows it thinking at once).
 *  `waited`: ms since they last typed. False when it couldn't go. */
export function sendMoment(m: { kind: "ask" | "point" | "edit" | "change"; agent?: string; path?: string; line?: number; text?: string; selection?: string; find?: string; hunks?: Hunk[]; waited?: number
  x?: number; y?: number; changes?: string[]; scene?: string; pane?: string; ui?: string; row?: number; title?: string; under?: string; summoned?: boolean; voice?: boolean }) {
  if (share) return true // (no agent works for a guest)
  if (!say({ t: "moment", ...m })) return false
  const a = m.kind === "ask" || m.kind === "point" ? mentionAgent(m.agent ?? state.name) : undefined
  if (a) askedHere.set(a.name, { at: Date.now(), taken: false, idle: 0 })
  if (a && a.state !== "away" && a.state !== "starting") expect(a.name, { state: "thinking", ...(m.path ? { path: m.path, line: m.line, find: m.find } : m.pane || m.ui ? { path: undefined, line: undefined, find: undefined, pane: m.pane, ui: m.ui, row: m.row } : {}) }, 10_000)
  return true
}
/** A part of the app's UI an agent follows changed: its new lines (and those gone). */
export const uiChanged = (agent: string, ui: string, changes: string[], title?: string) => sendMoment({ kind: "change", agent, ui, changes, ...(title ? { title } : {}) })
/** A say turned into a margin comment, same words, same place. */
export const pin = (id: string) => say({ t: "pin", id })
/** Bubbles the user saw: no unread dot for them (on every device). */
export const sawSays = (ids: string[]) => {
  const fresh = ids.filter((id) => state.said.some((n) => n.id === id && !n.seen))
  if (!fresh.length) return
  set({ said: state.said.map((n) => (fresh.includes(n.id) ? { ...n, seen: true } : n)) })
  say({ t: "seen", ids: fresh })
}
/** When this window got each bubble, and when it first drew it (its clock, not the server's): one held while the user
 *  spoke shows at their pause, and its time on screen counts from then. */
const arrived = new Map<string, number>(), drawnAt = new Map<string, number>()
/** When a bubble came (one from before this window opened: long ago). */
export const arrivedAt = (id: string) => arrived.get(id) ?? 0
/** A bubble is on screen (its first draw counts). */
export const sawShown = (id: string) => { if (!drawnAt.has(id)) drawnAt.set(id, Date.now()) }
/** How long a bubble has been on screen here, in ms (0: not drawn yet, as one held while the user speaks). */
export const shownFor = (id: string) => { const t = drawnAt.get(id); return t === undefined ? 0 : Date.now() - t }
/** A bubble gone as the user went on writing: off the screen at once, no word to its agent. */
export const hideSay = (id: string) => { set({ notes: state.notes.filter((x) => x.id !== id) }); say({ t: "hide", id }) }
/** The agent's says not seen yet (its cursor's unread dot). */
export const unread = (agent: string) => state.said.filter((n) => n.agent === agent && !n.seen && !n.placed && !n.pinned)
/** A dismissed comment back in the margin. */
export const reopen = (id: string) => say({ t: "reopen", id })
export const pick = (id: string | null) => { if (state.picked !== id) set({ picked: id }) }

/** The user's answer to a note: accept or reject a suggestion, dismiss a comment or a bubble, reply to one (a bubble
 *  replied to goes). False: a reply that couldn't go, left as it was. */
export function answer(id: string, verdict: "accept" | "reject" | "dismiss" | "reply", text?: string) {
  if (verdict === "reply" && ws?.readyState !== WebSocket.OPEN) return false
  if (verdict !== "reply" || state.notes.find((x) => x.id === id)?.kind === "say") set({ notes: state.notes.filter((x) => x.id !== id) })
  say({ t: "answer", id, verdict, text })
  return true
}

/** The user's answer to a proposal: take or leave one change, or all (taken ones are typed in as its agent's). Left
 *  ones go at once; taken ones as they're typed. */
export function review(id: string, verdict: "accept" | "reject", change?: string) {
  if (verdict === "reject") {
    const n = state.notes.find((x) => x.id === id), rest = (n?.changes ?? []).filter((c) => change && c.id !== change)
    set({ notes: rest.length ? state.notes.map((x) => (x.id === id ? { ...x, changes: rest } : x)) : state.notes.filter((x) => x.id !== id) })
  }
  say({ t: "review", id, verdict, ...(change ? { change } : {}) })
}

/** Which files this window shows and where the user is (`active`: they did something here). What the server heard last
 *  isn't said again, unless the user did something. */
let saidWhere = ""
let whereSoon: ReturnType<typeof setTimeout> | null = null
export function sayWhere(active = false) {
  if (whereSoon) { clearTimeout(whereSoon); whereSoon = null }
  const drawn = drawings?.where() ?? { open: [], focus: null }
  const open = [...new Set([...[...views].filter(([v]) => v.dom.isConnected).map(([, p]) => p), ...drawn.open])]
  // (shown: where an edit can be typed in, as viewOf finds; a note only in a kept tab is written to its file)
  const shown = [...new Set([...[...views].filter(([v]) => onScreen(v)).map(([, p]) => p), ...drawn.open])]
  const f = [...views.keys()].find((v) => v.hasFocus)
  const focus = f ? { path: views.get(f)!, line: f.state.doc.lineAt(f.state.selection.main.head).number } : drawn.focus
  const m = { t: "where", open, shown, focus, ...panes?.(), active: active && document.hasFocus() }, json = JSON.stringify({ ...m, active: false })
  if (!m.active && json === saidWhere) return
  if (say(m)) saidWhere = json
}
/** Tabs shown and hidden: said once they settle (switching tabs is one message, not two a switch). A tab that's gone
 *  hidden meanwhile answers an edit as unshown, and the server writes it to its file. */
export const sayWhereSoon = () => { if (whereSoon) clearTimeout(whereSoon); whereSoon = setTimeout(() => sayWhere(), 1000) }

/** The agents around now, the companion first. */
export const liveAgents = () => state.agents.filter((a) => a.state !== "away").sort((a, b) => Number(b.name === state.name) - Number(a.name === state.name))
/** The agent an @name reaches: that one while it's around; one a profile starts (@opus), none yet; else the companion
 *  (as the server routes it). */
export function mentionAgent(name: string): Agent | undefined {
  const k = name.toLowerCase()
  return state.agents.find((a) => a.name.toLowerCase() === k && a.state !== "away") ?? (mainName(k) || !profileOf(k, state.profiles) ? state.agents.find((a) => a.name === state.name) : undefined)
}
/** Whether @name is the companion's: its own name, "companion", or its agent's ("claude" while it runs Claude Code). */
const mainName = (k: string) => k === "companion" || k === state.name.toLowerCase() || k === (state.fresh.agent.split("_")[0] || "claude")
/** The names that address an agent after @ (lower case): every agent's, the companion's own, "claude" and "companion",
 *  and the profiles' (@opus starts one). */
export const mentionNames = () => (share ? [] : [...new Set(["companion", "claude", state.name.toLowerCase(), ...state.agents.map((a) => a.name.toLowerCase()), ...Object.keys(state.profiles)])])
/** What a new agent called `name` runs: its profile's (its name's first part), else the default. */
export const howOf = (name: string): How => profileOf(name, state.profiles) ?? state.fresh
/** What a session runs, as the user reads it: "Claude Code · Opus · high", "Codex · GPT-6.1 Sol · medium". */
export const howText = (h: Partial<How> & { runs?: string }) => howWith(h, state.harnesses)
/** What a session runs, in words (Claude Code · Opus · high), by the coding agents that can run: the cursor's header,
 *  in the window and over the screen. */
function howWith(h: Partial<How> & { runs?: string }, harnesses: Harness[]) {
  const id = (h.agent ?? h.runs ?? "").split("_")[0], harness = harnesses.find((x) => x.id === id)
  const model = h.model && (harness?.models.find((m) => m.id === h.model)?.label ?? capitalize(h.model))
  return [harness?.name ?? (id && capitalize(id)), model, h.effort && effortName(h.effort)].filter(Boolean).join(" · ")
}
export const effortName = (e: string) => (e === "xhigh" ? "extra high" : e)
/** A new agent's name as typed after @, as its agent calls itself when it's one (opencode: OpenCode). */
export const nameAs = (name: string) => state.harnesses.find((x) => x.id === name.toLowerCase())?.name ?? capitalize(name)
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// ---------- for the overlay

const bumps = new Set<() => void>()
/** Something on screen moved (an editor scrolled, typed, resized): the overlay places its things again. */
export const bump = () => { for (const fn of [...bumps]) fn() }
export const onBump = (fn: () => void) => { bumps.add(fn); return () => { bumps.delete(fn) } }

/** Where an agent is typing now, which its cursor follows. */
export let typing: { view: EditorView; pos: number; agent: string } | null = null
export const setTyping = (t: typeof typing) => { typing = t; bump() }

/** Take a suggestion: its change made in the editor showing it, and the agent told. */
export async function accept(n: Note) {
  const v = n.path ? viewOf(n.path) : null
  if (v && typer && n.find !== undefined) await inTurn(() => typer!(v, { rid: "", agent: n.agent, path: n.path, find: n.find, line: n.line, text: n.replace ?? "", animate: false }))
  answer(n.id, "accept")
}

// ---------- text

/** The lines the user changed from `a` to `b` (`spans`: each change's lines in `a` and `b`, from 1), a hunk per place
 *  (`line`: in `b`): what others wrote meanwhile (an agent, another window) is in both, never in one. */
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

/** A line's list marker or task box, if any. */
const LEAD = /^\s*(?:[-*+]\s+(?:\[.\]\s+)?)?/
/** Where a line can address an agent with any of its names: its start, after a list's marker or a task's box. */
const MENTION_AT = new RegExp(`${LEAD.source}$`)
/** An @ that can start a mention: not after a word, a dot or a slash (an email, a link). */
const MENTION_RE = /(?<![\w@./])@([\w-]+)/g
/** Whether an @ typed after `before` (the line up to it) starts a mention. */
export const canMention = (before: string) => !/[\w@./]$/.test(before)
/** The names that address an agent mid-line (lower case): the companion's and the agents around. */
export const midNames = () => (share ? [] : [...new Set([state.name, ...liveAgents().map((a) => a.name)].map((n) => n.toLowerCase()))])
export type Mention = { from: number; to: number; name: string }
/** A line's @names that address an agent: at its start any agent's name, after that only `mid` ones. */
export function mentionsOf(line: string, names = mentionNames(), mid = midNames()): Mention[] {
  const out: Mention[] = [], lead = LEAD.exec(line)![0].length
  for (const m of line.matchAll(MENTION_RE)) {
    const k = m[1].toLowerCase()
    // (at its start, a name a profile picks too: @opus-review)
    if ((m.index === lead ? names : mid).includes(k) || (m.index === lead && k.includes("-") && names.includes(k.split("-")[0]) && !!profileOf(k, state.profiles)))
      out.push({ from: m.index, to: m.index + m[0].length, name: m[1] })
  }
  return out
}
/** A line that addresses an agent ("@claude what's…", "- @ada: fix this", "how is it going @claude?"): who, and what it
 *  asks (after a leading @name, else the whole line), or null. */
export function mentionIn(line: string, names = mentionNames(), mid = midNames()): { name: string; text: string } | null {
  const [m] = mentionsOf(line, names, mid)
  if (!m) return null
  const text = MENTION_AT.test(line.slice(0, m.from)) ? line.slice(m.to).replace(/^[:,]/, "").trim() : line.trim()
  return { name: m.name, text: text || "(no words: look at this)" }
}
/** Whether a line's ask has words of its own, besides its @names (sent after a pause only then). */
export const asksSomething = (line: string, ms: Mention[]) => !!ms.reduceRight((s, m) => s.slice(0, m.from) + s.slice(m.to), line).replace(LEAD, "").replace(/[\s\p{P}]/gu, "")
