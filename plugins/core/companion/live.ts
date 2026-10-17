// The companion as this window knows it: the server's agents and notes (/api/companion/live), the editors showing
// files, and what the user does in them, said back. No CodeMirror here: the editor is its own chunk (editor.ts).
import type { EditorView } from "@codemirror/view"

export type Mode = "off" | "quiet" | "notice" | "pair"
export type Target = { path?: string; line?: number; find?: string }
export type Agent = Target & { name: string; tint: string; state: "watching" | "reading" | "thinking" | "writing" | "away"; t: number; seen?: boolean }
export type Note = Target & { id: string; kind: "say" | "comment" | "suggestion" | "highlight"; agent: string; t: number
  text?: string; replace?: string; replies?: { by: "user" | "agent"; text: string }[] }
export type Hunk = { line: number; added: string[]; removed: string[] }
export type EditAsk = Target & { rid: string; agent: string; text: string; after?: string; append?: boolean; animate?: boolean }

type State = { mode: Mode; name: string; agents: Agent[]; notes: Note[]; connected: boolean }
let state: State = { mode: "quiet", name: "Claude", agents: [], notes: [], connected: false }
const subs = new Set<() => void>()
const changed = () => { for (const fn of [...subs]) fn() }
export const getState = () => state
export const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } }
const set = (next: Partial<State>) => { state = { ...state, ...next }; changed() }

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
    if (m.t === "state") set({ mode: m.mode as Mode, name: String(m.name), agents: m.agents as Agent[], notes: m.notes as Note[] })
    else if (m.t === "agent") {
      const a = m.agent as Agent
      set({ agents: [...state.agents.filter((x) => x.name !== a.name), a] })
    } else if (m.t === "note") {
      const n = m.note as Note
      const has = state.notes.some((x) => x.id === n.id)
      set({ notes: has ? state.notes.map((x) => (x.id === n.id ? n : x)) : [...state.notes, n] })
    } else if (m.t === "drop") set({ notes: state.notes.filter((x) => x.id !== m.id) })
    else if (m.t === "edit") void edit(m as unknown as EditAsk)
  }
}

const say = (m: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)) }

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

/** Something the user did, for the agents (an ask: for `agent`, else the companion). */
export const sendMoment = (m: { kind: "ask" | "edit"; agent?: string; path?: string; line?: number; text?: string; selection?: string; hunks?: Hunk[] }) =>
  say({ t: "moment", ...m })
/** The user's answer to a note: accept or reject a suggestion, dismiss a comment, reply to one. */
export function answer(id: string, verdict: "accept" | "reject" | "dismiss" | "reply", text?: string) {
  if (verdict !== "reply") set({ notes: state.notes.filter((x) => x.id !== id) })
  say({ t: "answer", id, verdict, text })
}

/** Which files this window shows and where the user is (`active`: they did something here). */
export function sayWhere(active = false) {
  const open = [...new Set([...views].filter(([v]) => v.dom.isConnected).map(([, p]) => p))]
  const f = [...views.keys()].find((v) => v.hasFocus)
  const focus = f ? { path: views.get(f)!, line: f.state.doc.lineAt(f.state.selection.main.head).number } : null
  say({ t: "where", open, focus, active: active && document.hasFocus() })
}

/** The agents around now, the companion first. */
export const liveAgents = () => state.agents.filter((a) => a.state !== "away").sort((a, b) => Number(b.name === state.name) - Number(a.name === state.name))
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

/** Where a line can address an agent: its start, after a list's marker or a task's box. */
export const MENTION_AT = /^\s*(?:[-*+]\s+(?:\[.\]\s+)?)?$/
/** A line that addresses an agent ("@claude what's…", "- @ada: fix this"): who and what it asks, or null. */
export function mentionIn(line: string, names = mentionNames()): { name: string; text: string } | null {
  const m = /^\s*(?:[-*+]\s+(?:\[.\]\s+)?)?@([\w-]+)[:,]?\s*(.*)$/.exec(line)
  return m && names.includes(m[1].toLowerCase()) ? { name: m[1], text: m[2].trim() || "(no words: look at this)" } : null
}
