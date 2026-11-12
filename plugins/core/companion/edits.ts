import { AsyncLocalStorage } from "node:async_hooks"
import { WebSocket } from "ws"
import { type OpCtx, OpError } from "../../../core/plugins.ts"
import { readText } from "../../../core/vault.ts"
import { partialArgs } from "./partial.ts"
import { BIG_EDIT, linesIn } from "./proposals.ts"
import { nearest } from "./text.ts"
import { checkMarks } from "../../../core/desktop/screenmarks.ts"
import { inSummoned } from "./summoned.ts"
import { languageIn } from "../../../core/desktop/spoken.ts"
import "./windowpanes.ts"
import { plugin } from "./self.ts"
import type { Moment, Agent, Note } from "./types.ts"
import { EDIT_WAIT, SAVED_MS, sayMs, str } from "./settings.ts"
import { moments, agents, notes, timers, did, acting, windows, asked, send, broadcast, key, isMain, meantFor, setAgent, newId, putNote, dropNote } from "./state.ts"
import { drawing, save, keepSaid } from "./comments.ts"
import { AS_TOOL } from "./chat.ts"
import { lane } from "./lane.ts"
import { target } from "./args.ts"
import { shown, askOf } from "./wiring.ts"

let nid = 0

type Edit = { path: string; find?: string; after?: string; text: string; line?: number; append?: boolean }

/** The window to type an edit in: the most recent one with the file on screen. */
export const editorFor = (path: string) => [...windows.entries()].filter(([, w]) => w.shown.includes(path)).sort((a, b) => b[1].at - a[1].at)[0]?.[0] ?? null

const turns = new Map<string, Promise<unknown>>()
/** One edit of a note at a time, typed or written: the next waits for it (two at once interleave their letters). */
export function inTurn<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const run = (turns.get(path) ?? Promise.resolve()).then(fn)
  const tail = run.catch(() => {})
  turns.set(path, tail)
  void tail.then(() => { if (turns.get(path) === tail) turns.delete(path) })
  return run
}

/** Ask a window to make a change (`m`): true once it's made (`reply`: its answer), its error, false when it can't (it
 *  doesn't show the file now). No answer by `wait` ms: it may still be at it, so writing the file too would mix the two. */
export async function askWindow(ws: WebSocket, m: object, wait: number, reply: Record<string, unknown> = {}, rid = `e${++nid}`) {
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
export const applyEdit = (ctx: OpCtx, agent: Agent, e: Edit, animate = true) => inTurn(e.path, async (): Promise<"typed" | "written"> => {
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
export const streams = new Map<string, Streamed>()
/** The tool_use a chat session's call is for, through the op it runs: the stream that showed it. */
export const toolUse = new AsyncLocalStorage<string | undefined>()
const STREAM_MS = 5 * 60_000
const ANCHORS = ["find", "after", "line", "append"]

/** The ask a tour asked for by name plays for (tours.asked), by agent: its words answer it, said as it was asked. */
export const touredAsk = new Map<string, Moment>()
/** The Talk key's ask a say of `name`'s answers, if it's one: when it came, said or typed, its language (voice.ts). */
export function answering(name: string): Note["answers"] {
  const from = inSummoned.getStore() ? lane().last() : moments.filter((m) => meantFor(m, name) && Date.now() - m.t < 180_000).slice(-5)
  const m = from.findLast((x) => x.kind === "ask" || x.kind === "point")
  const toured = touredAsk.get(key(name))
  if (toured && toured.t > (m?.t ?? 0)) return answersOf(toured)
  // (a job's proof showing since: its narration, said as Show me was)
  if (shown && isMain(name) && shown.t > (m?.t ?? 0)) return { t: shown.t, ...(shown.voice ? { voice: true as const } : {}) }
  return m?.summoned ? answersOf(m) : undefined
}
export function answersOf(m: Moment): NonNullable<Note["answers"]> {
  const lang = m.text ? languageIn(m.text) : null
  return { t: m.t, ...(m.voice ? { voice: true as const } : {}), ...(lang ? { lang } : {}) }
}

export type Streaming = "say" | "comment" | "edit" | "draw"
/** A streaming tool's input so far (`end`: written whole, its call to come; or its turn ended first). */
export function streamed(name: string, tool: Streaming, use: string, json: string, end?: "done" | "stop") {
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
export const saidUndrawn = new Map<string, { note: string; text: string; ask: number }>()
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
export function finishStream(s: Streamed) {
  const n = s.note ? notes.get(s.note) : s.reply ? notes.get(s.reply.id) : undefined
  // (cut off before its call: kept in its history as far as it got)
  if (n?.kind === "say" && !timers.has(n.id)) { timers.set(n.id, setTimeout(() => dropNote(n.id), sayMs(n.text ?? ""))); if (s.ended === "stop") keepSaid(n) }
  else if (n?.kind === "comment" && n.path) save(n.path)
  const x = s.edit
  if (x && !x.final) { x.final = true; if (x.open) endEdit(s, x) }
}
/** Its call answered: the stream is over, whatever its op did. */
export function streamDone(use: string) {
  const s = streams.get(use)
  if (!s) return
  streams.delete(use)
  finishStream(s)
}
/** Agent `name`'s streams stop where they are (the user's Esc). */
export function stopStreams(name: string) {
  for (const s of streams.values()) if (key(s.agent) === key(name)) { s.ended = "stop"; finishStream(s) }
}
/** Whether agent `name` is writing into a note now (one stopped, kept for a call that may never come, isn't). */
export const writing = (name: string) => [...streams.values()].some((s) => key(s.agent) === key(name) && s.ended !== "stop" && (s.note || s.reply || s.edit))

export const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
/** Line `n` (from 1) of a file, trimmed: "" when it can't be read. */
export const lineText = (p: string, n: number) => { try { return readText(plugin.vault.abs(p)).split("\n")[n - 1]?.trim() ?? "" } catch { return "" } }
