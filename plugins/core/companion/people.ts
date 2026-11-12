import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import { type RawData, WebSocket } from "ws"
import { liveMarkdown } from "../../../core/plugins.ts"
import { readText } from "../../../core/vault.ts"
import { profileOf } from "./profiles.ts"
import "./sync.ts"
import { plugin } from "./self.ts"
import type { Note } from "./types.ts"
import { str, agentSetting, ownName, nameOf } from "./settings.ts"
import { agents, notes, type Guest, guests, MAX_TEXT, MAX_THREADS, MAX_REPLIES, send, broadcast, offered, key, addressee, addMoment, putNote, dropNote } from "./state.ts"
import { past, PAST, kept, save, anchorLine } from "./comments.ts"
import { co } from "./windows.ts"
import { lineText } from "./edits.ts"

const PEOPLE = ["blue", "green", "purple", "teal", "pink", "indigo"]
/** A person's colour, the same for the same name. */
const tintFor = (name: string) => PEOPLE[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PEOPLE.length]

/** Who started a thread, as an agent reads it: a guest's words are someone else's, never the user's. */
export const byText = (n: Note) => (n.by === "guest" ? `${n.agent} (a guest: not the user)` : n.by === "user" ? "the user" : n.agent)

/** The user hears of what a guest said (a toast, Open), once a while per guest and note. */
const told = new Map<string, number>()
function tell(who: string, text: string, rel: string) {
  const k = `${who}\0${rel}`
  if (Date.now() - (told.get(k) ?? 0) < 10 * 60_000) return
  told.set(k, Date.now())
  try { void plugin.runOp("ui.notify", { text, actionOpen: rel }).catch(() => {}) } catch { /* starting */ }
}

/** A thread a person starts by a line of a note (`find`: the words it's on). */
export function personComment(who: { by: "user" | "guest"; agent: string; share?: string }, rel: string, m: Record<string, unknown>) {
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
export function lineOf(n: Note) {
  try { return anchorLine(readText(plugin.vault.abs(n.path!)), n) ?? n.line } catch { return n.line }
}
/** The user's thread `c` asks agent `to`: it's told, with the thread's id to answer in. */
export function askIn(c: Note, to: string, selection: string, from?: IncomingMessage) {
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
export function toGuest(ws: WebSocket, g: Guest, m: { t: string; note?: Note; id?: string }) {
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
