// Companion: one always-on agent session that watches the user write (moments from the app's editors) and answers in the
// app (its cursor, bubbles, margin comments, suggestions, edits typed in). Live state only: nothing in the vault.
import fs from "node:fs"
import { type RawData, WebSocket } from "ws"
import { agentName, newTerminalId, startAgent } from "../../../core/agents.ts"
import { type OpCtx, OpError, Plugin } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

export type Mode = "off" | "quiet" | "notice" | "pair"
/** Lines changed together: from `line` (1-based, in the file's text, frontmatter too), `removed` replaced by `added`. */
export type Hunk = { line: number; added: string[]; removed: string[] }
/** What the user did, as an agent sees it. ask: they addressed it (@claude in a note, Ask companion); edit and open only in
 *  notice and pair; reply, accept, reject, dismiss: their answer to one of its items. */
export type Moment = { seq: number; t: number; kind: "ask" | "edit" | "open" | "reply" | "accept" | "reject" | "dismiss"
  path?: string; line?: number; text?: string; selection?: string; hunks?: Hunk[]; item?: string; to?: string }
/** Where something points: a file and a line (1-based), or text found in it (the occurrence nearest `line`). */
export type Target = { path?: string; line?: number; find?: string }
export type Agent = Target & { name: string; tint: string; state: "watching" | "thinking" | "writing" | "away"; t: number }
/** What an agent leaves in the app: words by its cursor (say, gone after a while), a margin comment, a suggested change,
 *  a highlight (gone after a while). */
export type Note = Target & { id: string; kind: "say" | "comment" | "suggestion" | "highlight"; agent: string; t: number
  text?: string; replace?: string; replies?: { by: "user" | "agent"; text: string }[] }

const TINTS = ["orange", "blue", "purple", "green", "red", "yellow"]
export const EMOJI: Record<string, string> = { red: "🔴", orange: "🟠", yellow: "🟡", green: "🟢", blue: "🔵", purple: "🟣" }
const KEEP = 300, SAY_MS = 12_000, HIGHLIGHT_MS = 10_000, EDIT_WAIT = 4_000

const str = (v: unknown) => (typeof v === "string" ? v : "")
/** A setting, else its manifest's default. */
const setting = (key: string) => str(plugin.settings()[key]).trim() || str(plugin.manifest.settings?.[key]?.default)
export const mode = (): Mode => {
  const m = plugin.settings().mode
  return m === "off" || m === "notice" || m === "pair" ? m : "quiet"
}
const agentSetting = () => setting("agent") || "claude"
/** The configured agent's name: the setting, else its own (claude: Claude). */
export const ownName = () => str(plugin.settings().name).trim() || nameOf(agentSetting())
const nameOf = (agent: string) => {
  const base = agent.split("_")[0]
  return base === "claude" ? "Claude" : agentName(base) ?? base.charAt(0).toUpperCase() + base.slice(1)
}

// ---------- state ----------

const moments: Moment[] = []
let seq = 0
const delivered = new Map<string, number>() // agent -> last seq it was given
const waiters = new Map<string, (m: Moment[]) => void>() // agent -> its waiting `next`
const agents = new Map<string, Agent>()
const notes = new Map<string, Note>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let nid = 0
const log = plugin.dayLog<Moment>("moments")

/** The app's windows: which files each has open, where its user is, when they last did anything. */
type Win = { open: string[]; focus: Target | null; at: number; was?: string }
const windows = new Map<WebSocket, Win>()
const asked = new Map<string, { done: (ok: boolean, error?: string) => void }>()

const send = (ws: WebSocket, m: object) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)) }
const broadcast = (m: object) => { const text = JSON.stringify(m); for (const ws of windows.keys()) if (ws.readyState === ws.OPEN) ws.send(text) }
const snapshot = () => ({ t: "state", mode: mode(), name: ownName(), agents: [...agents.values()], notes: [...notes.values()] })

/** Where the user is: the window they used last. */
export const focus = () => [...windows.values()].sort((a, b) => b.at - a.at)[0]?.focus ?? null

/** Take in a moment from the app: kept (and logged), and given to the agents waiting. */
export function addMoment(m: Omit<Moment, "seq" | "t"> & { t?: number }) {
  const md = mode()
  if (md === "off") return null
  if ((m.kind === "edit" || m.kind === "open") && md === "quiet") return null
  const full = { ...m, seq: ++seq, t: m.t ?? Date.now() } as Moment
  moments.push(full)
  if (moments.length > KEEP) moments.splice(0, moments.length - KEEP)
  log.append(full.t, [full])
  for (const [name, wake] of waiters) { waiters.delete(name); wake([full]) }
  if (m.kind === "ask" || m.kind === "reply") for (const a of agents.values()) setAgent(a.name, { state: "thinking", ...(m.path ? { path: m.path, line: m.line, find: undefined } : {}) })
  return full
}

/** The agent named `name`, made the first time it acts (its tint the next free one, Claude orange, Codex blue). */
function agentOf(name: string): Agent {
  let a = agents.get(name)
  if (!a) {
    const used = new Set([...agents.values()].map((x) => x.tint))
    const want = /claude/i.test(name) ? "orange" : /codex/i.test(name) ? "blue" : null
    const tint = want && !used.has(want) ? want : TINTS.find((t) => !used.has(t)) ?? TINTS[agents.size % TINTS.length]
    a = { name, tint, state: "watching", t: Date.now() }
    agents.set(name, a)
  }
  return a
}
function setAgent(name: string, change: Partial<Agent>) {
  const a = Object.assign(agentOf(name), change, { t: Date.now() })
  broadcast({ t: "agent", agent: a })
  return a
}

function putNote(n: Omit<Note, "id" | "t">, ttl?: number) {
  const note: Note = { ...n, id: `n${++nid}`, t: Date.now() }
  notes.set(note.id, note)
  broadcast({ t: "note", note })
  if (ttl) timers.set(note.id, setTimeout(() => dropNote(note.id), ttl))
  return note
}
export function dropNote(id: string) {
  clearTimeout(timers.get(id)); timers.delete(id)
  if (notes.delete(id)) broadcast({ t: "drop", id })
}

/** The user's answer to an item from the app: a moment for its agent; a suggestion or a dismissed comment goes away. */
export function answer(id: string, verdict: "accept" | "reject" | "dismiss" | "reply", text?: string) {
  const n = notes.get(id)
  if (!n) return
  if (verdict === "reply" && text) {
    n.replies = [...(n.replies ?? []), { by: "user", text }]
    broadcast({ t: "note", note: n })
  } else dropNote(id)
  addMoment({ kind: verdict, item: id, path: n.path, line: n.line, text: verdict === "reply" ? text : n.text, ...(n.kind === "suggestion" ? { selection: n.find, to: n.replace } : {}) })
}

plugin.onUnload(() => {
  for (const t of timers.values()) clearTimeout(t)
  for (const ws of windows.keys()) ws.close()
  for (const wake of waiters.values()) wake([])
  if (watchdog) clearInterval(watchdog)
})

// ---------- the app's windows: /api/companion/live

plugin.socket("companion/live", (ws) => {
  windows.set(ws, { open: [], focus: null, at: 0 })
  send(ws, snapshot())
  ws.on("message", (data: RawData) => {
    let m: Record<string, unknown>
    try { m = JSON.parse(String(data)) } catch { return }
    const w = windows.get(ws)
    if (!w) return
    if (m.t === "where") {
      w.open = Array.isArray(m.open) ? m.open.filter((p): p is string => typeof p === "string") : w.open
      const f = m.focus as Target | null
      w.focus = f && typeof f.path === "string" ? { path: f.path, line: Number(f.line) || 1 } : null
      if (m.active) w.at = Date.now()
      // (another note, not the same one focused again)
      if (w.focus && m.active && w.focus.path !== w.was) { w.was = w.focus.path; addMoment({ kind: "open", ...w.focus }) }
    } else if (m.t === "moment" && typeof m.kind === "string" && ["ask", "edit"].includes(m.kind)) {
      w.at = Date.now()
      addMoment({ kind: m.kind as "ask" | "edit", path: str(m.path) || undefined, line: Number(m.line) || undefined, text: str(m.text) || undefined,
        selection: str(m.selection) || undefined, hunks: Array.isArray(m.hunks) ? (m.hunks as Hunk[]).slice(0, 40) : undefined })
    } else if (m.t === "answer" && typeof m.id === "string" && ["accept", "reject", "dismiss", "reply"].includes(String(m.verdict))) {
      answer(m.id, m.verdict as "accept", str(m.text) || undefined)
    } else if (m.t === "done" && typeof m.rid === "string") {
      asked.get(m.rid)?.done(m.ok === true, str(m.error) || undefined)
    }
  })
  ws.on("close", () => windows.delete(ws))
})

// ---------- edits: typed in by the window that has the file open, else written on disk

type Edit = { path: string; find?: string; text: string; line?: number; append?: boolean }

/** The window to type an edit in: the most recent one with the file open. */
const editorFor = (path: string) => [...windows.entries()].filter(([, w]) => w.open.includes(path)).sort((a, b) => b[1].at - a[1].at)[0]?.[0] ?? null

async function applyEdit(ctx: OpCtx, agent: Agent, e: Edit, animate = true): Promise<"typed" | "written"> {
  const ws = editorFor(e.path)
  if (ws) {
    const rid = `e${++nid}`
    const ok = await new Promise<boolean | string>((resolve) => {
      const timer = setTimeout(() => { asked.delete(rid); resolve(false) }, EDIT_WAIT + e.text.length * 20)
      asked.set(rid, { done: (ok, error) => { clearTimeout(timer); asked.delete(rid); resolve(ok || error || false) } })
      send(ws, { t: "edit", rid, agent: agent.name, animate, ...e })
    })
    if (ok === true) return "typed"
    if (typeof ok === "string") throw new OpError(ok, 409)
  }
  const f = await ctx.api("GET", `file?path=${encodeURIComponent(e.path)}`)
  const cur = String(f.text ?? "")
  await ctx.api("PUT", "file", { path: f.path, text: editText(cur, e), base: cur })
  return "written"
}

/** `cur` with edit `e` made: `find` replaced by `text`, or `text` as new lines after `line` (0: first) or at the end. */
export function editText(cur: string, e: Omit<Edit, "path">) {
  if (e.find) {
    const at = nearest(cur, e.find, e.line)
    if (at < 0) throw new OpError(`"${cut(e.find, 60)}" isn't in the file: read it again (it may have changed) and copy the text exactly`)
    return cur.slice(0, at) + e.text + cur.slice(at + e.find.length)
  }
  const lines = cur.split("\n")
  const n = e.append || e.line === undefined ? (cur.endsWith("\n") ? lines.length - 1 : lines.length) : Math.max(0, Math.min(lines.length, e.line))
  lines.splice(n, 0, ...e.text.replace(/\n$/, "").split("\n"))
  return lines.join("\n")
}

/** Where `find` is in `text`: the occurrence nearest line `line` (1-based), -1 when it isn't. */
export function nearest(text: string, find: string, line?: number) {
  let best = -1, bestD = Infinity
  for (let i = text.indexOf(find); i >= 0; i = text.indexOf(find, i + 1)) {
    const d = line ? Math.abs(text.slice(0, i).split("\n").length - line) : 0
    if (d < bestD) { best = i; bestD = d }
    if (!line) break
  }
  return best
}
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

// ---------- the always-on session

/** What its session runs unasked: its own commands and reading the vault. */
const ALLOW = ["vau companion", "vau docs", "vau read", "vau search", "vau render", "vau links", "vau context", "vau tasks", "vau dataview"]
const sessionFile = () => `${plugin.localDir()}/session.json`
const sessionId = (): string | null => { try { return JSON.parse(fs.readFileSync(sessionFile(), "utf8")).id ?? null } catch { return null } }
const running = async (id: string | null) => !!id && !!(await plugin.ask<boolean>("terminal:runs", false, id))

async function start(ctx: OpCtx) {
  const was = sessionId()
  if (await running(was)) return { id: was!, running: true }
  const id = newTerminalId(agentSetting())
  await startAgent(ctx, id, setting("prompt"), ALLOW)
  fs.writeFileSync(sessionFile(), JSON.stringify({ id, t: Date.now() }))
  lastAsk = Date.now()
  return { id, running: false }
}

async function stop() {
  const id = sessionId()
  try { fs.rmSync(sessionFile()) } catch { /* none */ }
  if (await running(id)) await plugin.runOp("terminal.end", { id })
  for (const a of agents.values()) setAgent(a.name, { state: "away" })
  return { id }
}

// A session whose turn ended stops watching: nudged back when nobody has waited on moments for a while.
let lastAsk = 0
const NUDGE = 5 * 60_000
const watchdog: ReturnType<typeof setInterval> | null = setInterval(async () => {
  if (plugin.isOff() || mode() === "off" || waiters.size || Date.now() - lastAsk < NUDGE) return
  const id = sessionId()
  if (!(await running(id))) return
  lastAsk = Date.now()
  await plugin.runOp("terminal.send", { id, text: "Keep watching: run `vau companion next --timeout 240` again, and never end your turn." }).catch(() => {})
}, 60_000)
watchdog.unref?.()

// ---------- ops

const AS = { type: "string", description: "your name in the app, when several agents keep the user company (default: the companion's, Claude)" } as const
const PATH = { type: "string", format: "path", description: "the file (Notes/Idea.md); default: the one the user is in" } as const
const LINE = { type: "integer", minimum: 0, description: "a line of it (from 1, counting its frontmatter)" } as const
const FIND = { type: "string", description: "text in that line or near it, exactly as in the file (the occurrence nearest line)" } as const

/** A target from params: the user's file when none is given. */
function target(p: Record<string, unknown>): Target {
  const path = str(p.path) || focus()?.path
  if (!path) throw new OpError("the user has no file open: give path")
  return { path, ...(p.line !== undefined ? { line: Number(p.line) } : {}), ...(str(p.find) ? { find: str(p.find) } : {}) }
}
const who = (p: Record<string, unknown>) => str(p.as).trim() || ownName()

plugin.op({
  id: "companion.next",
  cli: "companion next",
  summary: "Wait for what the user does next in the app (asks you, writes, opens a note, answers you), as the companion.",
  help: `Answers the moments since you last asked, or waits for one (up to timeout seconds; none by then: an empty list).
ask: they addressed you (a line "@claude ..." in a note, or Ask companion on a selection): always answer. edit: lines
they changed after a pause (notice and pair modes). open: they went to a note. reply, accept, reject, dismiss: their
answer to your comment or suggestion. Lines count from 1 with the frontmatter. While you wait your cursor rests; after an
ask it shows you thinking until you act. Run it again after acting, forever.

  vau companion next --timeout 240`,
  kind: "read",
  lock: false,
  params: {
    timeout: { type: "integer", minimum: 0, maximum: 240, default: 100, description: "seconds to wait for a moment" },
    after: { type: "integer", minimum: 0, description: "only moments after this one (default: after the last you were given)" },
    as: AS,
  },
  run: async (p) => {
    const name = who(p)
    lastAsk = Date.now()
    const a = agentOf(name)
    if (a.state === "away" || a.state === "writing") setAgent(name, { state: "watching" })
    const after = p.after ?? delivered.get(name) ?? Math.max(0, seq - 20)
    let got = moments.filter((m) => m.seq > after && Date.now() - m.t < 30 * 60_000)
    if (!got.length && p.timeout > 0) {
      waiters.get(name)?.([])
      got = await new Promise<Moment[]>((resolve) => {
        const timer = setTimeout(() => { if (waiters.get(name) === wake) waiters.delete(name); resolve([]) }, p.timeout * 1000)
        const wake = (m: Moment[]) => { clearTimeout(timer); resolve(m) }
        waiters.set(name, wake)
      })
      lastAsk = Date.now()
    }
    if (got.length) delivered.set(name, got[got.length - 1].seq)
    return { mode: mode(), focus: focus(), moments: got, cursor: delivered.get(name) ?? after }
  },
  text: (r) => momentsText(r.moments, r.mode, r.focus),
})

/** Moments as an agent reads them. */
export function momentsText(ms: Moment[], md: Mode, f: Target | null) {
  const head = `Mode: ${md}.${f?.path ? ` The user is in ${f.path} at line ${f.line ?? 1}.` : ""}`
  if (!ms.length) return `${head}\nNothing yet: run vau companion next again.`
  const out = [head]
  for (const m of ms) {
    const at = m.path ? ` ${m.path}${m.line ? `:${m.line}` : ""}` : ""
    if (m.kind === "ask") out.push(`- ask${at}: ${JSON.stringify(m.text ?? "")}${m.selection ? `\n  on the selection: ${JSON.stringify(cut(m.selection, 2000))}` : ""}`)
    else if (m.kind === "edit") {
      out.push(`- edit${at}`)
      for (const h of m.hunks ?? []) {
        out.push(`  at line ${h.line}:`)
        for (const l of h.removed) out.push(`  - ${l}`)
        for (const l of h.added) out.push(`  + ${l}`)
      }
    } else if (m.kind === "open") out.push(`- open${at}`)
    else if (m.kind === "reply") out.push(`- reply to ${m.item}${at}: ${JSON.stringify(m.text ?? "")}`)
    else out.push(`- ${m.kind} ${m.item}${at}${m.kind === "accept" && m.to !== undefined ? ` (now ${JSON.stringify(cut(m.to, 200))})` : ""}`)
  }
  return out.join("\n")
}

plugin.op({
  id: "companion.look",
  cli: "companion look",
  summary: "Move your cursor to a place in a note, without a word: where your attention is.",
  help: `  vau companion look --path Notes/Idea.md --line 12
  vau companion look --find "the second paragraph"`,
  kind: "read",
  params: { path: PATH, line: LINE, find: FIND, as: AS },
  run: async (p) => {
    const t = target(p)
    setAgent(who(p), { ...t, state: "watching", find: t.find })
    return t
  },
  text: (r) => `Looking at ${r.path}${r.line ? `:${r.line}` : ""}.`,
})

plugin.op({
  id: "companion.say",
  cli: "companion say",
  summary: "Say something in a bubble by your cursor (gone after a while): a short answer, a heads-up.",
  help: `Short, one or two sentences. With a place, your cursor goes there first. What should stay goes in a comment.

  vau companion say "Done: three tasks added below."
  vau companion say "That date is a Sunday." --find "May 3"`,
  kind: "read",
  params: { text: { type: "string", required: true, description: "what to say (Markdown)" }, path: PATH, line: LINE, find: FIND, as: AS },
  args: ["text"],
  run: async (p) => {
    const name = who(p)
    const t = p.path || p.line !== undefined || p.find ? target(p) : {}
    setAgent(name, { ...t, state: "watching" })
    return putNote({ kind: "say", agent: name, text: str(p.text), ...t }, SAY_MS)
  },
  text: () => "Said.",
})

plugin.op({
  id: "companion.comment",
  cli: "companion comment",
  summary: "Leave a comment in the margin by a line, until the user dismisses it; they can reply (a reply moment).",
  help: `For what's worth keeping a moment: an answer to their ask, a thought on what they wrote. Replying to their reply to
it: with id (the comment's), your words join its thread.

  vau companion comment "Alice moved this to Thursday." --path Notes/Plans.md --find "Meet Alice"
  vau companion comment "Yes, both work." --id n12`,
  kind: "read",
  params: { text: { type: "string", required: true, description: "the comment (Markdown, short)" }, id: { type: "string", description: "a comment to reply in" },
    path: PATH, line: LINE, find: FIND, as: AS },
  args: ["text"],
  run: async (p) => {
    const name = who(p)
    if (p.id) {
      const n = notes.get(p.id)
      if (!n || n.kind !== "comment") throw new OpError(`there's no comment ${p.id} (dismissed?)`, 404)
      n.replies = [...(n.replies ?? []), { by: "agent", text: str(p.text) }]
      broadcast({ t: "note", note: n })
      setAgent(name, { path: n.path, line: n.line, find: n.find, state: "watching" })
      return n
    }
    const t = target(p)
    setAgent(name, { ...t, state: "watching" })
    return putNote({ kind: "comment", agent: name, text: str(p.text), ...t })
  },
  text: (r) => `Commented (${r.id}).`,
})

plugin.op({
  id: "companion.suggest",
  cli: "companion suggest",
  summary: "Suggest a change in a note: shown struck through and in your colour; the user takes it (Tab) or not (Esc).",
  help: `find is the text to change, exactly as in the file; replace what it becomes (empty: removed). An accept or reject
moment tells you what they chose.

  vau companion suggest --path Notes/Idea.md --find "recieve" --replace "receive"
  vau companion suggest --find "We could maybe try" --replace "We'll try" --why "Firmer"`,
  kind: "read",
  params: { find: { ...FIND, description: "the text to change, exactly as in the file" }, replace: { type: "string", required: true, description: "what it becomes" },
    why: { type: "string", description: "a few words on why, by it" }, path: PATH, line: LINE, as: AS },
  run: async (p) => {
    if (!str(p.find)) throw new OpError("give find: the text to change")
    const name = who(p), t = target(p)
    setAgent(name, { ...t, state: "watching" })
    return putNote({ kind: "suggestion", agent: name, ...t, replace: str(p.replace), ...(str(p.why) ? { text: str(p.why) } : {}) })
  },
  text: (r) => `Suggested (${r.id}).`,
})

plugin.op({
  id: "companion.edit",
  cli: "companion edit",
  summary: "Write in a note: typed in before the user's eyes when it's open (they can undo it), else saved to the file.",
  help: `Only in pair mode or when they asked you to. find and text: find replaced by text. Without find: text as new lines
after line (0: at the top), or at the end.

  vau companion edit --path Notes/Idea.md --find "- [ ] Call Alice" --text "- [x] Call Alice"
  vau companion edit --line 14 --text "- Ask Ben about the budget"`,
  kind: "write",
  lock: false,
  params: { text: { type: "string", required: true, description: "what to write" }, find: { type: "string", description: "the text it replaces, exactly as in the file" },
    path: PATH, line: LINE, append: { type: "boolean", description: "at the end of the file" }, as: AS },
  args: ["text"],
  run: async (p, ctx) => {
    const name = who(p), t = target(p)
    const a = setAgent(name, { ...t, state: "writing" })
    try {
      const how = await applyEdit(ctx, a, { path: t.path!, find: t.find, line: t.line, text: str(p.text), append: !!p.append })
      return { path: t.path, how }
    } finally { setAgent(name, { state: "watching" }) }
  },
  text: (r) => `${r.how === "typed" ? "Typed into" : "Wrote"} ${r.path}.`,
})

plugin.op({
  id: "companion.highlight",
  cli: "companion highlight",
  summary: "Highlight text in a note in your colour: for a while, or kept in the file (==🟠text==) with keep.",
  help: `  vau companion highlight --find "the budget is due Friday"
  vau companion highlight --path Notes/Idea.md --find "key insight" --keep`,
  kind: "read",
  params: { find: { ...FIND, description: "the text to highlight, exactly as in the file" }, keep: { type: "boolean", description: "keep it in the file, as a highlight of your colour" },
    path: PATH, line: LINE, as: AS },
  run: async (p, ctx) => {
    if (!str(p.find)) throw new OpError("give find: the text to highlight")
    const name = who(p), t = target(p), a = setAgent(name, { ...t, state: "watching" })
    if (!p.keep) return putNote({ kind: "highlight", agent: name, ...t }, HIGHLIGHT_MS)
    await applyEdit(ctx, a, { path: t.path!, find: t.find, line: t.line, text: `==${EMOJI[a.tint] ?? ""}${t.find}==` }, false)
    return { path: t.path, kept: true }
  },
  text: (r) => (r.kept ? `Highlighted in ${r.path}.` : `Highlighted (${r.id}).`),
})

plugin.op({
  id: "companion.clear",
  cli: "companion clear",
  summary: "Take back your comments and suggestions (one by id, or all of yours).",
  kind: "read",
  params: { id: { type: "string", description: "the item (n12); default: all of yours" }, as: AS },
  run: async (p) => {
    const name = who(p), gone = [...notes.values()].filter((n) => (p.id ? n.id === p.id : n.agent === name))
    for (const n of gone) dropNote(n.id)
    return { cleared: gone.length }
  },
  text: (r) => `Cleared ${r.cleared}.`,
})

plugin.op({
  id: "companion.status",
  cli: "companion status",
  summary: "What the companion is: its mode, its session, the agents in the app and what they left there.",
  kind: "read",
  params: {},
  run: async () => {
    const id = sessionId()
    return { mode: mode(), name: ownName(), session: (await running(id)) ? id : null, windows: windows.size, focus: focus(),
      agents: [...agents.values()], notes: [...notes.values()], moments: moments.slice(-10) }
  },
  text: (r) => [`Mode: ${r.mode}. Session: ${r.session ?? "not running"}. Windows: ${r.windows}.`,
    ...r.agents.map((a: Agent) => `- ${a.name} (${a.tint}): ${a.state}${a.path ? ` at ${a.path}${a.line ? `:${a.line}` : ""}` : ""}`),
    ...r.notes.map((n: Note) => `- ${n.id} ${n.kind} by ${n.agent}${n.path ? ` in ${n.path}` : ""}: ${cut(n.text ?? n.replace ?? n.find ?? "", 80)}`)].join("\n"),
})

plugin.op({
  id: "companion.start",
  cli: "companion start",
  owner: "a coding agent",
  summary: "Start the companion's always-on session (its agent, in a terminal on this machine), unless it runs.",
  kind: "write",
  lock: false,
  params: {},
  run: async (_p, ctx) => {
    if (mode() === "off") await plugin.patchSettings({ mode: "quiet" })
    return await start(ctx)
  },
  text: (r) => `${r.running ? "Already running" : "Started"} in ${r.id} (vau terminal screen ${r.id}).`,
})

plugin.op({
  id: "companion.stop",
  cli: "companion stop",
  owner: "the terminal",
  summary: "End the companion's session; its cursor goes away until it starts again.",
  kind: "write",
  lock: false,
  params: {},
  run: async () => await stop(),
  text: (r) => (r.id ? `Ended ${r.id}.` : "It wasn't running."),
})

plugin.op({
  id: "companion.replay",
  cli: "companion replay",
  summary: "Replay moments recorded on a day (or from a file of JSON lines) to the companion, to see how it answers.",
  help: `The test harness: moments are logged on this machine each day; replaying a day's sends them again, spaced as they
came (faster with speed), so you can watch what the session makes of them.

  vau companion replay --day 2026-10-16 --speed 4
  vau companion replay --file /tmp/moments.jsonl`,
  kind: "read",
  lock: false,
  params: { day: { type: "string", description: "a day (YYYY-MM-DD) of the log" }, file: { type: "string", description: "a file of moments, one JSON per line" },
    speed: { type: "number", minimum: 0.1, default: 1, description: "how much faster than they came" }, limit: { type: "integer", minimum: 1, default: 50, description: "at most this many" } },
  run: async (p) => {
    let ms: Moment[] = []
    if (p.file) ms = fs.readFileSync(String(p.file), "utf8").split("\n").flatMap((l) => { try { return l ? [JSON.parse(l)] : [] } catch { return [] } })
    else if (p.day) ms = log.read(String(p.day))
    else throw new OpError("give day or file")
    ms = ms.filter((m) => m && typeof m.kind === "string").slice(-p.limit)
    const t0 = ms[0]?.t ?? 0
    void (async () => {
      for (const m of ms) {
        const wait = Math.min(30_000, Math.max(0, (m.t - t0) / p.speed) - 0)
        await new Promise((r) => setTimeout(r, wait))
        addMoment({ ...m, t: Date.now() })
      }
    })()
    return { replaying: ms.length }
  },
  text: (r) => `Replaying ${r.replaying} moments.`,
})

// ---------- a change of settings (mode, name) reaches the windows

let lastSaid = ""
plugin.onSync(() => {
  const now = `${mode()}\n${ownName()}`
  if (now === lastSaid) return
  // (turned off: its session ends too)
  if (lastSaid && mode() === "off") void stop().catch(() => {})
  lastSaid = now
  broadcast(snapshot())
})
