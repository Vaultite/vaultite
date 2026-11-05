// The companion's session as turns: each what the user did (the moments of its message) and what it did with
// its tools (said, commented, wrote...), not as a chat. Read from the session's entries, so it stays live. No Node, no DOM.
import type { Entry } from "@plugins/claude-code/chatlog"
import { type Message, type Read, readMoments } from "./moments.ts"

export type Place = { path?: string; line?: number; find?: string }
/** How the user answered one of its items: took it, left it, dismissed it, or replied (the reply). */
export type Outcome = { kind: "accept" | "reject" | "dismiss" | "reply"; text?: string; at: string }
/** One thing it did. `item`: the comment, suggestion or proposal it left (its id), which `outcomes` follow. */
export type Act = Place & { id: string; at: string; live?: boolean; error?: string; item?: string; outcomes?: Outcome[] } & (
  | { k: "say" | "comment"; text: string; reply?: boolean }
  | { k: "suggest"; from: string; to: string; why?: string }
  | { k: "propose"; why?: string; pending?: string; text?: string; from?: string; to?: string }
  | { k: "edit"; text: string; from?: string; proposed?: boolean }
  | { k: "look" | "highlight" | "draw" | "clear" | "handover" | "pass"; text?: string }
  /** What it read or looked up: a few at once are one row. */
  | { k: "read"; what: string[] }
  /** A session it started: a terminal (`terminal`: its id), or a task delegated (`task`: its id; `job`: handed off). */
  | { k: "session"; agent: string; title: string; terminal?: string; task?: string; job?: boolean }
  /** Its own words in its session, which the user only sees there. */
  | { k: "text"; text: string }
  /** Its session asks the user something (a permission). */
  | { k: "ask"; text: string; answer?: string })
/** A turn: the message that started it (moments, or another ask: `said`) and what it did. */
export type Turn = { id: string; at: string; message: Message | null; said?: string; acts: Act[]; live: boolean }

const APP = "mcp__vaultite-app__"
const str = (v: unknown) => (typeof v === "string" ? v : "")
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined)
/** The id its tool's answer names: "Commented (n12).", "Opened claude-3f2a.", "Suggested (n7uaz)." */
const idIn = (s = "") => /\(([a-z]\w{2,})\)|^Opened (\S+?)[ .]/.exec(s)?.slice(1).find(Boolean)
const placeOf = (i: Record<string, unknown>): Place => ({
  ...(str(i.path) ? { path: str(i.path) } : {}), ...(num(i.line) !== undefined ? { line: num(i.line) } : {}),
  ...(str(i.find) || str(i.after) ? { find: str(i.find) || str(i.after) } : {}) })
/** A path an answer names: "Wrote Notes/A.md.", "Typed into Notes/A.md." */
const pathIn = (s = "") => /^(?:Wrote|Typed into|Drew on|Highlighted in) (.+?)(?: \(.*\))?\.$/.exec(s)?.[1]

/** A vau command it ran, as an act: a session it started, or what it read. */
function command(cmd: string, result: string): Pick<Extract<Act, { k: "session" }>, "k" | "agent" | "title" | "terminal" | "task"> | { k: "read"; what: string[] } | null {
  const c = cmd.trim().replace(/^cd [^&;]+(&&|;)\s*/, "")
  const word = (re: RegExp) => re.exec(c)?.[1]?.replace(/^["']|["']$/g, "") ?? ""
  if (/^vau terminal open\b/.test(c)) {
    const agent = word(/^vau terminal open\s+([\w-]+)/)
    return { k: "session", agent: agent.startsWith("--") ? "" : agent, title: word(/--prompt\s+("[^"]*"|'[^']*'|\S+)/), terminal: idIn(result) }
  }
  if (/^vau delegate\s+(claude|codex|opencode)\b/.test(c)) {
    return { k: "session", agent: word(/^vau delegate\s+(\w+)/), title: word(/^vau delegate\s+\w+\s+("[^"]*"|'[^']*')/), task: /\b(d[a-z0-9]{7})\b/.exec(result)?.[1] }
  }
  if (/^vau (read|search|list|links|tags|render|query|docs|dataview|context|tasks)\b/.test(c)) return { k: "read", what: [c.replace(/^vau /, "").slice(0, 120)] }
  return null
}

/** What one tool call did, or null for one that shows nothing (its status, history). */
function actOf(t: Extract<Entry, { k: "tool" }>): Act | null {
  const i = (t.input && typeof t.input === "object" ? t.input : {}) as Record<string, unknown>
  const base = { id: t.id, at: t.at, ...(t.live || t.result === undefined ? { live: true } : {}), ...(t.error ? { error: t.result || "It failed" } : {}) }
  if (t.name.startsWith(APP)) {
    const op = t.name.slice(APP.length), p = placeOf(i), item = t.error ? undefined : idIn(t.result)
    switch (op) {
      case "say": return { ...base, ...p, k: "say", text: str(i.text) }
      case "comment": return { ...base, ...p, k: "comment", text: str(i.text), ...(str(i.id) ? { reply: true, item: str(i.id) } : item ? { item } : {}) }
      case "suggest": return { ...base, ...p, k: "suggest", from: str(i.find), to: str(i.replace), ...(str(i.why) ? { why: str(i.why) } : {}), ...(item ? { item } : {}) }
      case "propose": return { ...base, ...p, k: "propose", ...(str(i.why) ? { why: str(i.why) } : {}), ...(str(i.pending) ? { pending: str(i.pending) } : {}),
        ...(str(i.text) ? { text: str(i.text) } : {}), ...(str(i.replace) || str(i.find) ? { from: str(i.find), to: str(i.replace) } : {}), item: str(i.id) || item }
      case "edit": {
        const proposed = /^Proposed it/.test(t.result ?? "")
        return { ...base, ...p, ...(p.path ? {} : { path: pathIn(t.result) }), k: "edit", text: str(i.text), ...(str(i.find) ? { from: str(i.find) } : {}), ...(proposed ? { proposed, item } : {}) }
      }
      case "pass": return { ...base, k: "pass", text: str(i.reason) }
      case "handoff": return { ...base, k: "session", agent: str(i.agent) || "claude", title: str(i.title) || str(i.task), task: str(i.job) || idIn(t.result), job: true }
      case "look": case "highlight": case "draw": case "clear": case "handover":
        return { ...base, ...p, ...(p.path ? {} : { path: pathIn(t.result) }), k: op, ...(op === "handover" ? { text: str(i.summary) } : op === "clear" && str(i.id) ? { text: str(i.id) } : {}) }
      default: return null
    }
  }
  if (t.name === "Bash") {
    const c = command(str(i.command), t.result ?? "")
    return c ? { ...base, ...c } as Act : { ...base, k: "read", what: [str(i.description) || t.summary] }
  }
  if (t.name === "Read" || t.name === "Grep" || t.name === "Glob" || t.name === "WebSearch" || t.name === "WebFetch" || t.name.startsWith("mcp__"))
    return { ...base, k: "read", what: [t.summary || t.name] }
  if (t.name === "Agent" || t.name === "Task") return { ...base, k: "session", agent: "subagent", title: str(i.description) || t.summary }
  return { ...base, k: "read", what: [t.summary || t.name] }
}

/** The session's entries as turns, oldest first: each user message, then what it did till the next. */
export function turnsOf(entries: Entry[]): Turn[] {
  const turns: Turn[] = []
  const items = new Map<string, Act>()
  let turn: Turn | null = null
  for (const e of entries) {
    if ("parent" in e && e.parent) continue
    if (e.k === "user") {
      const message = readMoments(e.text)
      turn = { id: e.id, at: e.at, message, ...(message ? {} : { said: e.text }), acts: [], live: false }
      turns.push(turn)
      // (its answers to items it left: on them, where they show)
      for (const m of message?.moments ?? []) {
        const a = m.item ? items.get(m.item) : undefined
        if (a && (m.kind === "accept" || m.kind === "reject" || m.kind === "dismiss" || m.kind === "reply")) (a.outcomes ??= []).push({ kind: m.kind, ...(m.text ? { text: m.text } : {}), at: e.at })
      }
      continue
    }
    if (!turn) { turn = { id: `start:${e.id}`, at: e.at, message: null, acts: [], live: false }; turns.push(turn) }
    let a: Act | null = null
    if (e.k === "tool") a = actOf(e)
    else if (e.k === "text" && e.text.trim()) a = { id: e.id, at: e.at, k: "text", text: e.text.trim(), ...(e.live ? { live: true } : {}) }
    else if (e.k === "ask") a = { id: e.id, at: e.at, k: "ask", text: e.detail || e.title, ...(e.answer ? { answer: e.answer } : {}) }
    else if (e.k === "result" && !e.ok) a = { id: e.id, at: e.at, k: "text", text: e.error || "It stopped", error: e.error || "It stopped" }
    if (!a) continue
    // (an ask's tool call is drawn as the ask)
    if (a.k === "ask") turn.acts = turn.acts.filter((x) => `ask:${x.id}` !== a!.id)
    const last = turn.acts.at(-1)
    if (a.k === "read" && last?.k === "read" && !last.error && !a.error) { last.what.push(...a.what); last.live = a.live; continue }
    if (a.item && a.k !== "comment") items.set(a.item, a)
    else if (a.k === "comment" && a.item && !a.reply) items.set(a.item, a)
    turn.acts.push(a)
  }
  for (const t of turns) t.live = t.acts.some((a) => a.live)
  return turns
}

/** Where a turn happened: the note of its first moment, else of what it did, else where the user was. */
export function noteOf(t: Turn): string {
  return t.message?.moments.find((m) => m.path)?.path ?? t.acts.find((a) => a.path)?.path ?? t.message?.focus?.path ?? ""
}

/** The user's side of a turn worth a row: what they asked, pointed at, wrote, replied; an answer to an item shown on it
 *  (`shown`) isn't again. */
export function contextOf(t: Turn, shown: Set<string>): Read[] {
  return (t.message?.moments ?? []).filter((m) => m.kind !== "open" && !((m.kind === "accept" || m.kind === "reject" || m.kind === "dismiss") && m.item && shown.has(m.item)))
}
