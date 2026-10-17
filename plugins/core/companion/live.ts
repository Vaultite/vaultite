// The companion as this window knows it: the server's agents and notes (/api/companion/live), the editors showing
// files, and what the user does in them, said back. No CodeMirror here: the editor is its own chunk (editor.ts).
import type { EditorView } from "@codemirror/view"

export type Mode = "off" | "quiet" | "notice" | "pair"
export type Target = { path?: string; line?: number; find?: string; x?: number; y?: number }
export type Agent = Target & { name: string; tint: string; state: "watching" | "reading" | "thinking" | "writing" | "away"; t: number; seen?: boolean }
export type Note = Target & { id: string; kind: "say" | "comment" | "suggestion" | "highlight"; agent: string; t: number
  text?: string; replace?: string; replies?: { by: "user" | "agent"; text: string }[]; pinned?: string }
export type Hunk = { line: number; added: string[]; removed: string[] }
export type EditAsk = Target & { rid: string; agent: string; text: string; after?: string; append?: boolean; animate?: boolean }

/** said: each agent's last says (gone from the screen or not), oldest first. */
/** picked: the margin card the user opened (clicked, or picked from the note's history). */
type State = { mode: Mode; name: string; agents: Agent[]; notes: Note[]; said: Note[]; picked: string | null; connected: boolean }
let state: State = { mode: "quiet", name: "Claude", agents: [], notes: [], said: [], picked: null, connected: false }
const subs = new Set<() => void>()
const changed = () => { for (const fn of [...subs]) fn() }
export const getState = () => state
export const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } }
const set = (next: Partial<State>) => { state = { ...state, ...next }; changed() }

/** The agents as the server last said, and what this window shows ahead of it (an ask just sent, the user writing to
 *  one): the server's next word on an agent replaces its own. */
let told: Agent[] = []
const ahead = new Map<string, { a: Partial<Agent>; timer: ReturnType<typeof setTimeout> }>()
const showAgents = () => set({ agents: told.map((a) => { const x = ahead.get(a.name); return x ? { ...a, ...x.a } : a }) })
function heard(agents: Agent[], name?: string) {
  told = agents
  for (const [k, x] of ahead) if (name === undefined || k === name) { clearTimeout(x.timer); ahead.delete(k) }
  showAgents()
}
/** Show agent `name` as `a` now, before the server says so (for `ms` at most). */
export function expect(name: string, a: Partial<Agent>, ms: number) {
  clearTimeout(ahead.get(name)?.timer)
  ahead.set(name, { a: { ...a, seen: undefined, t: Date.now() }, timer: setTimeout(() => { ahead.delete(name); showAgents() }, ms) })
  showAgents()
}
/** The user is writing an ask to @name on this line: its cursor comes over to read along, when it's free. */
export function listen(name: string, path: string, line: number) {
  const a = mentionAgent(name), was = a && told.find((x) => x.name === a.name)
  if (!was || was.state !== "watching") return
  expect(was.name, { state: "reading", path, line, find: undefined }, 8000)
}

/** An agent's colour, as a CSS value. */
export const tintOf = (name: string) => `var(--${state.agents.find((a) => a.name === name)?.tint ?? "orange"})`

// ---------- editors showing files

/** The editors on screen with a file, so edits find theirs and the overlay draws on them. */
export const views = new Map<EditorView, string>()
/** An editor showing `path`: the focused one, else the first that's on screen. */
export function viewOf(path: string): EditorView | null {
  let best: EditorView | null = null
  for (const [v, p] of views) {
    if (p !== path || !v.dom.isConnected) continue
    if (v.hasFocus) return v
    if (!best && v.dom.getClientRects().length) best = v
  }
  return best
}
/** The drawings this window shows (canvas.ts registers them): their paths, where the user is in one, and who makes an
 *  agent's drawing there. */
let drawings: { where: () => { open: string[]; focus: Target | null }; draw: (m: Record<string, unknown>) => void } | null = null
export const setDrawings = (d: typeof drawings) => { drawings = d }
/** Who types an edit into an editor (editor.ts registers it once loaded). */
let typer: ((v: EditorView, e: EditAsk) => Promise<void>) | null = null
export const setTyper = (fn: typeof typer) => { typer = fn }

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
  s.onopen = () => { tries = 0; set({ connected: true }); sayWhere(true) }
  s.onclose = () => {
    if (ws !== s) return
    ws = null
    set({ connected: false })
    if (users > 0) retry = setTimeout(open, Math.min(30_000, 1000 * 2 ** tries++))
  }
  s.onmessage = (ev) => {
    let m: Record<string, unknown>
    try { m = JSON.parse(String(ev.data)) } catch { return }
    if (m.t === "state") { set({ mode: m.mode as Mode, name: String(m.name), notes: m.notes as Note[], said: (m.said as Note[] | undefined) ?? [] }); heard(m.agents as Agent[]) }
    else if (m.t === "said") set({ said: m.said as Note[] })
    else if (m.t === "agent") {
      const a = m.agent as Agent
      heard([...told.filter((x) => x.name !== a.name), a], a.name)
    } else if (m.t === "note") {
      const n = m.note as Note
      const has = state.notes.some((x) => x.id === n.id)
      set({ notes: has ? state.notes.map((x) => (x.id === n.id ? n : x)) : [...state.notes, n] })
    } else if (m.t === "drop") set({ notes: state.notes.filter((x) => x.id !== m.id) })
    else if (m.t === "edit") void edit(m as unknown as EditAsk)
    else if (m.t === "draw") { if (drawings) drawings.draw(m); else say({ t: "done", rid: m.rid, ok: false }) }
  }
}

export const say = (m: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)) }

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
 *  `waited`: ms since they last typed. */
export function sendMoment(m: { kind: "ask" | "point" | "edit"; agent?: string; path?: string; line?: number; text?: string; selection?: string; find?: string; hunks?: Hunk[]; waited?: number
  x?: number; y?: number; changes?: string[]; scene?: string }) {
  say({ t: "moment", ...m })
  const a = m.kind === "ask" || m.kind === "point" ? mentionAgent(m.agent ?? state.name) : undefined
  if (a && a.state !== "away") expect(a.name, { state: "thinking", ...(m.path ? { path: m.path, line: m.line, find: m.find } : {}) }, 10_000)
}
/** The user dropped an agent's cursor here: "look at this". It stays there (the server says so too, a moment later). */
export const pointAt = (agent: string, t: { path: string; line: number; find?: string; selection?: string }) => sendMoment({ kind: "point", agent, ...t })
/** A say turned into a margin comment, same words, same place. */
export const pin = (id: string) => say({ t: "pin", id })
/** A dismissed comment back in the margin. */
export const reopen = (id: string) => say({ t: "reopen", id })
export const pick = (id: string | null) => { if (state.picked !== id) set({ picked: id }) }

/** The user's answer to a note: accept or reject a suggestion, dismiss a comment, reply to one. */
export function answer(id: string, verdict: "accept" | "reject" | "dismiss" | "reply", text?: string) {
  if (verdict !== "reply") set({ notes: state.notes.filter((x) => x.id !== id) })
  say({ t: "answer", id, verdict, text })
}

/** Which files this window shows and where the user is (`active`: they did something here). */
export function sayWhere(active = false) {
  const drawn = drawings?.where() ?? { open: [], focus: null }
  const open = [...new Set([...[...views].filter(([v]) => v.dom.isConnected).map(([, p]) => p), ...drawn.open])]
  const f = [...views.keys()].find((v) => v.hasFocus)
  const focus = f ? { path: views.get(f)!, line: f.state.doc.lineAt(f.state.selection.main.head).number } : drawn.focus
  say({ t: "where", open, focus, active: active && document.hasFocus() })
}

/** The agents around now, the companion first. */
export const liveAgents = () => state.agents.filter((a) => a.state !== "away").sort((a, b) => Number(b.name === state.name) - Number(a.name === state.name))
/** The agent an @name reaches: that one while it's around, else the companion (as the server routes it). */
export function mentionAgent(name: string): Agent | undefined {
  const k = name.toLowerCase()
  return state.agents.find((a) => a.name.toLowerCase() === k && a.state !== "away") ?? state.agents.find((a) => a.name === state.name)
}
/** The names that address an agent after @ (lower case): every agent's, and the companion's own, "claude" and "companion". */
export const mentionNames = () => [...new Set(["companion", "claude", state.name.toLowerCase(), ...state.agents.map((a) => a.name.toLowerCase())])]

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

/** Where `find` is in `text`: the occurrence nearest line `line` (1-based), -1 when it isn't. */
export function nearest(text: string, find: string, line?: number) {
  if (!find) return -1
  let best = -1, bestD = Infinity
  for (let i = text.indexOf(find); i >= 0; i = text.indexOf(find, i + 1)) {
    const d = line ? Math.abs(text.slice(0, i).split("\n").length - line) : 0
    if (d < bestD) { best = i; bestD = d }
    if (!line) break
  }
  return best
}

/** The lines changed from `a` to `b`, as one stretch (what a pause in typing changes is mostly one place). */
export function hunksOf(a: string[], b: string[]): Hunk[] {
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let e = 0
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++
  const removed = a.slice(s, a.length - e), added = b.slice(s, b.length - e)
  return removed.length || added.length ? [{ line: s + 1, removed: removed.slice(0, 40), added: added.slice(0, 40) }] : []
}

/** Where a line can address an agent with any of its names: its start, after a list's marker or a task's box. */
const MENTION_AT = /^\s*(?:[-*+]\s+(?:\[.\]\s+)?)?$/
/** An @ that can start a mention: not after a word, a dot or a slash (an email, a link). */
const MENTION_RE = /(?<![\w@./])@([\w-]+)/g
/** Whether an @ typed after `before` (the line up to it) starts a mention. */
export const canMention = (before: string) => !/[\w@./]$/.test(before)
/** The names that address an agent mid-line (lower case): the companion's and the agents around. */
export const midNames = () => [...new Set([state.name, ...liveAgents().map((a) => a.name)].map((n) => n.toLowerCase()))]
export type Mention = { from: number; to: number; name: string }
/** A line's @names that address an agent: at its start any agent's name, after that only `mid` ones. */
export function mentionsOf(line: string, names = mentionNames(), mid = midNames()): Mention[] {
  const out: Mention[] = [], lead = /^\s*(?:[-*+]\s+(?:\[.\]\s+)?)?/.exec(line)![0].length
  for (const m of line.matchAll(MENTION_RE)) {
    const k = m[1].toLowerCase()
    if ((m.index === lead ? names : mid).includes(k)) out.push({ from: m.index, to: m.index + m[0].length, name: m[1] })
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
export const asksSomething = (line: string, ms: Mention[]) => !!ms.reduceRight((s, m) => s.slice(0, m.from) + s.slice(m.to), line).replace(/^\s*(?:[-*+]\s+(?:\[.\]\s+)?)?/, "").replace(/[\s\p{P}]/gu, "")
