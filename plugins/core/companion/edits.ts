import { AsyncLocalStorage } from "node:async_hooks"
import { WebSocket } from "ws"
import { type OpCtx, OpError, readFile } from "../../../core/plugins.ts"
import { readText } from "../../../core/vault.ts"
import { partialArgs } from "./partial.ts"
import { BIG_EDIT, linesIn } from "./proposals.ts"
import { nearest } from "./text.ts"
import { checkMarks } from "../../../core/desktop/screenmarks.ts"
import { inSummoned } from "./summoned.ts"
import { languageIn } from "../../../core/desktop/spoken.ts"
import "./windowpanes.ts"
import { plugin } from "./self.ts"
import type { Moment, KeptAgent, Note } from "./types.ts"
import { EDIT_WAIT, SAVED_MS, sayMs, str } from "./settings.ts"
import { moments, agents, notes, timers, did, windows, asked, send, broadcast, key, isMain, meantFor, setAgent, wroteAt, writingAt, newId, putNote, dropNote } from "./state.ts"
import { drawing, save, keepSaid } from "./comments.ts"
import { AS_TOOL } from "./chat.ts"
import { lane } from "./lane.ts"
import { target, type Given } from "./args.ts"
import { statusOf } from "./errors.ts"
import { shown, askOf } from "./wiring.ts"

let nid = 0

type Edit = { path: string; find?: string; after?: string; text: string; line?: number; append?: boolean }

export const editorFor = (path: string) => [...windows.entries()].filter(([, w]) => w.shown.includes(path)).sort((a, b) => b[1].at - a[1].at)[0]?.[0] ?? null

const turns = new Map<string, Promise<unknown>>()
export function inTurn<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const run = (turns.get(path) ?? Promise.resolve()).then(fn)
  const tail = run.catch(() => {})
  turns.set(path, tail)
  void tail.then(() => { if (turns.get(path) === tail) turns.delete(path) })
  return run
}

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

export const applyEdit = (ctx: OpCtx, agent: KeptAgent, e: Edit, animate = true) => inTurn(e.path, async (): Promise<"typed" | "written"> => {
  await plugin.ask("history:keep", false, e.path)
  const ws = editorFor(e.path)
  if (ws) {
    const was = vaultText(e.path)
    const end = was !== null ? endOf(was, e) : null
    const wait = EDIT_WAIT + e.text.length * 20
    await plugin.ask("activity:typing", false, e.path, agent.name, wait + SAVED_MS)
    const done = writingAt(agent.name, end ? { path: e.path, line: end.line, find: end.find } : null)
    let typed = false, late = false
    try { typed = await askWindow(ws, { t: "edit", agent: agent.name, animate, ...e }, wait) } catch (err) { late = statusOf(err) === 504; throw err } finally {
      await plugin.ask("activity:typing", false, e.path, agent.name, typed || late ? SAVED_MS : 0)
      if (end) done()
    }
    if (typed) {
      const next = was !== null && !drawing(e.path) ? edited(was, e) : null
      if (was !== null && next !== null) await plugin.ask("provenance:wrote", null, e.path, was, next)
      return "typed"
    }
  }
  const f = await readFile(ctx, e.path)
  const cur = f.text
  await ctx.api("PUT", "file", { path: f.path, text: editText(cur, e), base: cur })
  const end = endOf(cur, e)
  if (end) setAgent(agent.name, { path: e.path, line: end.line, find: end.find })
  return "written"
})

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

const edited = (cur: string, e: Omit<Edit, "path">) => { try { return editText(cur, e) } catch { return null } }

export function endOf(cur: string, e: Omit<Edit, "path">): { line: number; find?: string } | null {
  const next = edited(cur, e)
  if (next === null) return null
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

type Streamed = { use: string; agent: string; tool: Streaming; ended?: "done" | "stop"; whole?: boolean; note?: string; reply?: { id: string; at: number }; again?: boolean
  edit?: { ws: WebSocket; rid: string; e: Edit; text: string; sent: number; open: boolean; final: boolean; was: string | null; job: Promise<"typed" | "stopped" | "unshown"> } }
export const streams = new Map<string, Streamed>()
export const toolUse = new AsyncLocalStorage<string | undefined>()
const STREAM_MS = 5 * 60_000
const ANCHORS = ["find", "after", "line", "append"]

export const touredAsk = new Map<string, Moment>()
export function answering(name: string): Note["answers"] {
  const from = inSummoned.getStore() ? lane().last() : moments.filter((m) => meantFor(m, name) && Date.now() - m.t < 180_000).slice(-5)
  const m = from.findLast((x) => x.kind === "ask" || x.kind === "point")
  const toured = touredAsk.get(key(name))
  if (toured && toured.t > (m?.t ?? 0)) return answersOf(toured)
  if (shown && isMain(name) && shown.t > (m?.t ?? 0)) return { t: shown.t, ...(shown.voice ? { voice: true as const } : {}) }
  return m?.summoned ? answersOf(m) : undefined
}
export function answersOf(m: Moment): NonNullable<Note["answers"]> {
  const lang = m.text ? languageIn(m.text) : null
  return { t: m.t, ...(m.voice ? { voice: true as const } : {}), ...(lang ? { lang } : {}) }
}

export type Streaming = "say" | "comment" | "edit" | "draw"
export function streamed(name: string, tool: Streaming, use: string, json: string, end?: "done" | "stop") {
  let s = streams.get(use)
  if (!s) {
    if (!json) return
    const t = { use, agent: name, tool }
    s = t
    streams.set(use, t)
    setTimeout(() => { if (streams.get(use) === t) { finishStream(t); streams.delete(use) } }, STREAM_MS).unref?.()
  }
  if (s.ended) return
  const { whole, keys, open } = partialArgs(json)
  const field = tool === "draw" ? "say" : "text"
  if (tool === "draw" && keys.some((k) => k === "actions" || k === "path")) s.whole = true
  const held = tool === "draw" && !s.whole && !s.note && !marksSound(whole.marks)
  if (held && whole.marks !== undefined) s.whole = true
  const said = whole[field]
  const text = typeof said === "string" ? said : open?.key === field ? open.text : null
  if (text !== null && !s.whole && !held) {
    try { if (tool === "edit") editStream(s, whole, keys, text); else noteStream(s, whole, keys, text) } catch { s.whole = true }
  }
  if (end) s.ended = end
  if (end === "stop") finishStream(s)
}

const marksSound = (marks: unknown) => { try { return marks !== undefined && !!checkMarks(marks).length } catch { return false } }
export const saidUndrawn = new Map<string, { note: string; text: string; ask: number }>()
const sameStart = (a: string, b: string) => { const x = a.trim().toLowerCase(), y = b.trim().toLowerCase(); return x.startsWith(y) || y.startsWith(x) }

function noteStream(s: Streamed, given: Given & { id?: unknown; ask?: unknown }, keys: string[], text: string) {
  if (!text.trim()) return
  const n = s.note ? notes.get(s.note) : s.reply ? notes.get(s.reply.id) : undefined
  if (n) {
    const r = s.reply ? n.replies?.[s.reply.at] : null
    if (s.again && n.text?.startsWith(text)) return
    if (r && r.text !== text) r.text = text
    else if (!s.reply && n.text !== text) n.text = text
    else return
    return void broadcast({ t: "note", note: n })
  }
  if (s.note || s.reply) return
  const placed = s.tool !== "draw" && keys.slice(0, keys.indexOf("text")).some((k) => ["path", "line", "find", "x", "y", "id"].includes(k))
  if (s.tool === "comment") {
    const a = agents.get(key(s.agent))
    if (!placed && !a?.path) { s.whole = true; return }
    if (!placed) given = { path: a!.path, line: a!.line, ...(a!.find ? { find: a!.find } : {}) }
    const to = given.id ? notes.get(str(given.id)) : undefined
    if (given.id) {
      if (to?.kind !== "comment") { s.whole = true; return }
      to.replies = [...(to.replies ?? []), { by: "agent", text, t: Date.now(), ...(to.by ? { name: s.agent } : {}) }]
      s.reply = { id: to.id, at: to.replies.length - 1 }
      setAgent(s.agent, { path: to.path, line: to.line, find: to.find })
      broadcast({ t: "note", note: to })
    } else {
      const t = target(given)
      if (drawing(t.path!)) { s.whole = true; return }
      setAgent(s.agent, t)
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
    setAgent(s.agent, { ...t, ...("path" in t ? { find: t.find, x: t.x, y: t.y } : {}) })
    const answers = answering(s.agent)
    s.note = putNote({ kind: "say", agent: s.agent, text, ...t, ...(given.ask === true ? { question: true } : {}), ...(answers ? { answers } : {}), writer: { client: AS_TOOL.client, agent: AS_TOOL.agent } }).id
  }
  did(s.agent, "word")
}

function editStream(s: Streamed, given: Given & { after?: unknown; append?: unknown }, keys: string[], text: string) {
  if (s.edit) { s.edit.text = text; flushEdit(s); return }
  if (!keys.slice(0, keys.indexOf("text")).some((k) => ANCHORS.includes(k))) { s.whole = true; return }
  const t = target(given), find = str(given.find) || undefined, after = str(given.after) || undefined
  const ws = !drawing(t.path!) && !(find && linesIn(find) > BIG_EDIT) ? editorFor(t.path!) : null
  if (!ws) { s.whole = true; return }
  const e: Edit = { path: t.path!, find, after, line: t.line, text: "", append: given.append === true }
  const rid = `e${++nid}`, job = inTurn(e.path, () => typeIn(s, x))
  const x: NonNullable<Streamed["edit"]> = { ws, rid, e, text, sent: 0, open: false, final: false, was: null, job }
  s.edit = x
  x.job.catch(() => {})
}

async function typeIn(s: Streamed, x: NonNullable<Streamed["edit"]>): Promise<"typed" | "stopped" | "unshown"> {
  const path = x.e.path
  await plugin.ask("history:keep", false, path)
  x.was = vaultText(path)
  await plugin.ask("activity:typing", false, path, s.agent, STREAM_MS)
  wroteAt(s.agent, { path, line: x.e.line, find: x.e.after ?? x.e.find, x: undefined, y: undefined })
  did(s.agent, "word")
  const reply: { text?: unknown; stopped?: unknown } = {}
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
  const next = x.was !== null ? edited(x.was, { ...x.e, text: typed }) : null
  if (x.was !== null && next !== null) await plugin.ask("provenance:wrote", null, path, x.was, next)
  return reply.stopped ? "stopped" : "typed"
}

function flushEdit(s: Streamed) {
  const x = s.edit
  if (!x?.open || x.text.length <= x.sent) return
  send(x.ws, { t: "stream-more", rid: x.rid, at: x.sent, add: x.text.slice(x.sent) })
  x.sent = x.text.length
}
function endEdit(s: Streamed, x: NonNullable<Streamed["edit"]>) {
  flushEdit(s)
  const end = x.was !== null ? endOf(x.was, { ...x.e, text: x.text }) : null
  if (end) wroteAt(s.agent, { path: x.e.path, line: end.line, find: end.find })
  send(x.ws, { t: "stream-end", rid: x.rid, text: x.text })
}
export function finishStream(s: Streamed) {
  const n = s.note ? notes.get(s.note) : s.reply ? notes.get(s.reply.id) : undefined
  if (n?.kind === "say" && !timers.has(n.id)) { timers.set(n.id, setTimeout(() => dropNote(n.id), sayMs(n.text ?? ""))); if (s.ended === "stop") keepSaid(n) }
  else if (n?.kind === "comment" && n.path) save(n.path)
  const x = s.edit
  if (x && !x.final) { x.final = true; if (x.open) endEdit(s, x) }
}
export function streamDone(use: string) {
  const s = streams.get(use)
  if (!s) return
  streams.delete(use)
  finishStream(s)
}
export function stopStreams(name: string) {
  for (const s of streams.values()) if (key(s.agent) === key(name)) { s.ended = "stop"; finishStream(s) }
}
export const writing = (name: string) => [...streams.values()].some((s) => key(s.agent) === key(name) && s.ended !== "stop" && (s.note || s.reply || s.edit))

export const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
export const vaultText = (p: string) => { try { return readText(plugin.vault.abs(p)) } catch { return null } }
export const lineText = (p: string, n: number) => vaultText(p)?.split("\n")[n - 1]?.trim() ?? ""
