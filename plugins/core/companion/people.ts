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
import { agents, notes, type Guest, guests, MAX_TEXT, MAX_THREADS, MAX_REPLIES, send, broadcast, offered, key, addressee, putNote, dropNote } from "./state.ts"
import { addMoment } from "./intake.ts"
import { past, PAST, kept, save, anchorLine } from "./comments.ts"
import { co } from "./windows.ts"
import { messageFrom } from "./rooms.ts"
import { lineText } from "./edits.ts"

const PEOPLE = ["blue", "green", "purple", "teal", "pink", "indigo"]
const tintFor = (name: string) => PEOPLE[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PEOPLE.length]

export const byText = (n: Note) => (n.by === "guest" ? `${n.agent} (a guest: not the user)` : n.by === "user" ? "the user" : n.agent)

const told = new Map<string, number>()
function tell(who: string, text: string, rel: string) {
  const k = `${who}\0${rel}`
  if (Date.now() - (told.get(k) ?? 0) < 10 * 60_000) return
  told.set(k, Date.now())
  try { void plugin.runOp("ui.notify", { text, actionOpen: rel }).catch(() => {}) } catch {}
}

export function personComment(who: { by: "user" | "guest"; agent: string; share?: string }, rel: string, m: { text?: unknown; line?: unknown; find?: unknown }) {
  const text = str(m.text).trim().slice(0, MAX_TEXT)
  if (!text || !/\.md$/i.test(rel) || !fs.existsSync(plugin.vault.abs(rel))) return null
  if (who.share && (kept(rel).filter((n) => n.share === who.share).length >= MAX_THREADS || [...notes.values()].filter((n) => n.share === who.share).length >= MAX_THREADS * 10)) return null
  const line = Math.max(1, Math.floor(Number(m.line)) || 1), find = str(m.find).slice(0, 200)
  const anchor = find ? "" : lineText(rel, line)
  return putNote({ kind: "comment", ...who, ...(who.by === "guest" ? { tint: tintFor(who.agent) } : {}), text, path: rel, line, ...(find ? { find } : anchor ? { anchor } : {}) })
}

export function mentioned(text: string): string | undefined {
  const names = new Set([key(ownName()), "companion", key(nameOf(agentSetting())), ...agents.keys(), ...Object.keys(offered())])
  for (const m of text.matchAll(/(?<![\w@./])@([\w-]+)/g)) if (names.has(key(m[1])) || (m[1].includes("-") && profileOf(m[1], offered()))) return addressee(m[1])
  return undefined
}
export function lineOf(n: Note) {
  try { return anchorLine(readText(plugin.vault.abs(n.path!)), n) ?? n.line } catch { return n.line }
}
export function askIn(c: Note, to: string, selection: string, from?: IncomingMessage) {
  c.ask = to
  save(c.path!)
  broadcast({ t: "note", note: c })
  addMoment({ kind: "ask", for: to, item: c.id, path: c.path, line: lineOf(c), text: c.text, ...(selection ? { selection } : {}) }, from)
}

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
    const m = messageFrom(data)
    if (!m) return
    let rel: string | null = null
    try { rel = typeof m.path === "string" ? g.at(m.path) : null } catch {}
    if (co.heard(ws, m, rel)) return
    if (g.role === "read") return
    const n = typeof m.id === "string" ? notes.get(m.id) : undefined, theirs = n && forGuest(n, g)
    if (m.t !== "comment" && m.t !== "answer") return
    if (!g.holds()) return void ws.terminate()
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
