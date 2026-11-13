import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import path from "node:path"
import { z } from "zod"
import { OpError } from "../../../core/plugins.ts"
import { parseJson } from "../../../core/agents.ts"
import { readText, requestWriter, type Writer, writeAtomic } from "../../../core/vault.ts"
import { nearest } from "./text.ts"
import type { Target } from "../../../core/desktop/places.ts"
import { waiters, agents, notes, said, setSaid, SAID, timers, windows, MAX_TEXT, broadcast, key, focus, agentOf, acted, setAgent, putNote, dropNote } from "./state.ts"
import { addMoment } from "./intake.ts"
import { plugin } from "./self.ts"
import type { Moment, Note } from "./types.ts"
import { sayMs } from "./settings.ts"
import { applyEdit, lineText, vaultText } from "./edits.ts"
import { apiCtx } from "./chat.ts"
import { unhearChats, watchdog } from "./chatturns.ts"
import { textOf, refind, review } from "./propose.ts"
import { loadedFor } from "./sync.ts"
import { mentioned, lineOf } from "./people.ts"
import { codeOf, messageOf } from "./errors.ts"

export const KEPT = new Set(["comment", "suggestion", "proposal"])
export const past = new Map<string, Note[]>()
export const PAST = 30
const DIR = ".vaultite/plugins/companion/comments"
const sidecar = (p: string) => `${DIR}/${p}.json`
const written = new Map<string, string>()
export const kept = (p: string) => [...notes.values()].filter((n) => n.path === p && KEPT.has(n.kind))
const lineCount = (text: string) => text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
const under = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`)

export type Draw = (text: string, actions: unknown[]) => { text: string; touched: string[] }
export function drawer(p: string): Draw | null {
  const exts = p.slice(p.lastIndexOf("/") + 1).toLowerCase().split(".").slice(1)
  for (let i = 0; i < exts.length; i++) { const fn = plugin.service(`draw:${exts.slice(i).join(".")}`); if (typeof fn === "function") return fn }
  return null
}
export const drawing = (p: string) => !!drawer(p)
const Sidecar = z.object({ comments: z.array(z.unknown()), past: z.unknown().optional() })
const isNote = (n: unknown): n is Note => typeof n === "object" && n !== null && "id" in n && typeof n.id === "string" && "kind" in n && typeof n.kind === "string"
export const point = (o: Record<string, unknown>) => (typeof o.x === "number" && typeof o.y === "number" && Number.isFinite(o.x + o.y) ? { x: Math.round(o.x), y: Math.round(o.y) } : {})

export function save(p: string) {
  const rel = sidecar(p), list = kept(p), old = past.get(p) ?? [], bare = ({ path: _, ...n }: Note) => n
  const text = list.length || old.length ? `${JSON.stringify({ comments: list.map(bare), ...(old.length ? { past: old.map(bare) } : {}) }, null, 2)}\n` : ""
  if (text === (written.get(rel) ?? "")) return
  const abs = plugin.vault.abs(rel)
  try {
    if (text) writeAtomic(abs, text)
    else {
      fs.rmSync(abs, { force: true })
      for (let d = path.dirname(abs), top = plugin.vault.abs(DIR); d.startsWith(top) && fs.readdirSync(d).length === 0; d = path.dirname(d)) fs.rmdirSync(d)
    }
  } catch (e) { console.error(`companion: couldn't save ${rel}: ${messageOf(e)}`) }
  if (text) written.set(rel, text); else written.delete(rel)
}

function load(p: string) {
  const rel = sidecar(p), abs = plugin.vault.abs(rel)
  let text = ""
  try { text = readText(abs) } catch (e) {
    // iCloud keeps a file not downloaded yet as a `.<name>.icloud` placeholder.
    if (codeOf(e) !== "ENOENT" || fs.existsSync(path.join(path.dirname(abs), `.${path.basename(abs)}.icloud`))) return
  }
  if (text === (written.get(rel) ?? "")) return
  const doc = Sidecar.safeParse(text ? parseJson(text) : { comments: [] }).data
  if (!doc) return
  if (text) written.set(rel, text); else written.delete(rel)
  const gone = Array.isArray(doc.past) ? doc.past.filter((n): n is Note => isNote(n) && n.kind === "comment").map((n) => ({ ...n, path: p })) : []
  if (gone.length) past.set(p, gone); else past.delete(p)
  const now = new Map(doc.comments.filter((n): n is Note => isNote(n) && KEPT.has(n.kind)).map((n) => [n.id, { ...n, path: p }]))
  for (const n of kept(p)) if (!now.has(n.id)) { notes.delete(n.id); broadcast({ t: "drop", id: n.id }) }
  for (const n of now.values()) {
    if (JSON.stringify(notes.get(n.id)) === JSON.stringify(n)) continue
    notes.set(n.id, n)
    broadcast({ t: "note", note: n })
  }
}

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

function follow(p: string) {
  const list = kept(p)
  const text = vaultText(p)
  if (text === null) return
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
const following = new Map<string, ReturnType<typeof setTimeout>>()
const followSoon = (p: string) => {
  clearTimeout(following.get(p))
  following.set(p, setTimeout(() => { following.delete(p); follow(p) }, 2000))
}

export function loadAll(fresh = false) {
  if (fresh) { for (const n of notes.values()) if (KEPT.has(n.kind)) notes.delete(n.id); written.clear(); past.clear() }
  const top = plugin.vault.abs(DIR)
  let files: string[] = []
  try { files = fs.readdirSync(top, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".json")) } catch {}
  for (const f of files) {
    const p = f.split(path.sep).join("/").slice(0, -5)
    load(p)
    if (p.startsWith(".trash/") && !fs.existsSync(plugin.vault.abs(p))) { for (const n of kept(p)) notes.delete(n.id); past.delete(p); save(p) } else follow(p)
  }
}

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

plugin.onMove((from, to, trashed) => {
  const dest = to ?? trashed ?? null
  const there = (p: string) => (dest === null ? null : dest + p.slice(from.length))
  for (const [a, b] of [[sidecar(from), dest && sidecar(dest)], [`${DIR}/${from}`, dest && `${DIR}/${dest}`]]) {
    const abs = plugin.vault.abs(a!)
    if (!fs.existsSync(abs) || (a === `${DIR}/${from}` && !fs.statSync(abs).isDirectory())) continue
    try {
      if (b) { fs.mkdirSync(path.dirname(plugin.vault.abs(b)), { recursive: true }); fs.renameSync(abs, plugin.vault.abs(b)) } else fs.rmSync(abs, { recursive: true, force: true })
    } catch (e) { console.error(`companion: couldn't move ${a}: ${messageOf(e)}`) }
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

export function answer(id: string, verdict: "accept" | "reject" | "dismiss" | "reply", text?: string, from?: IncomingMessage) {
  const n = notes.get(id) ?? said.find((x) => x.id === id)
  if (!n) return
  if (n.kind === "say") return answerSay(n, verdict, text, from)
  if (n.kind === "proposal") return verdict === "reply" ? undefined : void review(id, verdict === "accept" ? "accept" : "reject", undefined, from).catch((e) => console.error(`companion: ${messageOf(e)}`))
  if (verdict === "reply" && text) {
    n.replies = [...(n.replies ?? []), { by: "user", text: text.slice(0, MAX_TEXT), t: Date.now() }]
    broadcast({ t: "note", note: n })
    if (KEPT.has(n.kind) && n.path) save(n.path)
  } else {
    if (verdict === "dismiss" && n.kind === "comment" && n.path) past.set(n.path, [...(past.get(n.path) ?? []).filter((x) => x.id !== id), { ...n, dismissed: Date.now() }].slice(-PAST))
    dropNote(id)
  }
  if (n.by) {
    const to = n.by === "user" && verdict === "reply" && text ? mentioned(text) ?? n.ask : undefined
    if (!to) return
    if (n.ask !== to) { n.ask = to; save(n.path!) }
    return void addMoment({ kind: "reply", for: to, item: id, path: n.path, line: lineOf(n), text }, from)
  }
  addMoment({ kind: verdict, for: n.agent, item: id, path: n.path, line: n.line, text: verdict === "reply" ? text : n.text, ...(n.kind === "suggestion" ? { selection: n.find, to: n.replace } : {}) }, from)
}

function answerSay(n: Note, verdict: string, text: string | undefined, from?: IncomingMessage) {
  if (verdict !== "reply" && verdict !== "dismiss") return
  if (notes.has(n.id)) dropNote(n.id)
  saw([n.id])
  if (verdict === "reply" && !text?.trim()) return
  addMoment({ kind: verdict, for: n.agent, item: n.id, bubble: true, path: n.path, line: n.line, ...(n.find ? { find: n.find } : {}),
    text: verdict === "reply" ? text!.slice(0, MAX_TEXT) : n.text }, from)
}

export function saw(ids: string[]) {
  let changed = false
  for (const x of said) if (ids.includes(x.id) && !x.seen) { x.seen = true; changed = true }
  if (changed) broadcast({ t: "said", said })
}

export function hide(id: string) {
  if (notes.get(id)?.kind === "say") dropNote(id)
}

function sayLine(text: string, n: Pick<Note, "find" | "anchor" | "line">) {
  return n.find ? anchorLine(text, n) : n.line ? Math.max(1, Math.min(n.line, lineCount(text))) : null
}

export async function place(id: string) {
  const n = said.find((x) => x.id === id) ?? notes.get(id)
  if (!n || n.kind !== "say" || !n.text?.trim()) throw new OpError(`there's no bubble ${id}`, 404)
  const a = agents.get(key(n.agent)), t: Target = n.path ? n : a?.path ? a : focus() ?? {}
  if (!t.path || drawing(t.path)) throw new OpError("it wasn't said by a note", 409)
  const cur = await textOf(apiCtx, t.path), lines = cur.split("\n")
  let at = sayLine(cur, t)
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

export function fold(name: string, path: string, line: number, text: string) {
  const a = agents.get(key(name))
  if (!a || !text.trim()) throw new OpError(`${name} isn't here to say it`, 404)
  acted(a.name)
  setAgent(a.name, { path, line, find: undefined, x: undefined, y: undefined })
  const n = putNote({ kind: "say", agent: a.name, text: text.trim(), path, line }, sayMs(text))
  keepSaid(n)
  addMoment({ kind: "move", into: "bubble", for: a.name, item: n.id, path, line, text: text.trim() })
  return n
}

export function keepSaid(n: Note) {
  const mine = said.filter((x) => key(x.agent) === key(n.agent) && (x.kind === "ask") === (n.kind === "ask"))
  setSaid([...said.filter((x) => !mine.slice(0, -(SAID - 1)).includes(x)), { ...n }])
  broadcast({ t: "said", said })
}

const askRows = new Map<number, string>()
export function keepAsked(m: Moment) {
  if (!m.for || m.tour || !m.text?.trim() || !((m.kind === "ask" && !m.item) || (m.kind === "reply" && m.bubble))) return
  const id = askRows.get(m.more ?? m.seq) ?? `ask-${m.seq}`, text = m.text.trim()
  askRows.set(m.seq, id)
  if (askRows.size > 200) askRows.delete(askRows.keys().next().value!)
  const n = said.find((x) => x.id === id)
  if (n) { Object.assign(n, { text, t: m.t }); return void broadcast({ t: "said", said }) }
  keepSaid({ id, kind: "ask", by: "user", agent: m.for, text, t: m.t, seen: true, ...(m.path ? { path: m.path, line: m.line } : {}) })
}

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

export function pin(id: string) {
  const s = said.find((n) => n.id === id) ?? notes.get(id)
  if (!s || s.kind !== "say" || s.pinned) return null
  const a = agents.get(key(s.agent))
  const t: Target = s.path ? s : a?.path ? a : focus() ?? {}
  if (!t.path) return null
  if (notes.has(id)) dropNote(id)
  let line = t.line ?? 1
  const text = t.find ? vaultText(t.path) : null
  if (text !== null) line = anchorLine(text, t) ?? line
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
  unhearChats()
})
