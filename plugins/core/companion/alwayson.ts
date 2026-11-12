import fs from "node:fs"
import { type AgentMeter, agentIn, newTerminalId, parseTerminal, startAgent } from "../../../core/agents.ts"
import { type OpCtx, OpError } from "../../../core/plugins.ts"
import type { Target } from "../../../core/desktop/places.ts"
import { cut } from "./edits.ts"
import { plugin } from "./self.ts"
import type { Moment, KeptAgent, Note } from "./types.ts"
import { str, setting, agentSetting, ownName, howFor } from "./settings.ts"
import { moments, seq, delivered, handed, asking, waiters, agents, seen, ends, dead, watching, notes, did, key, isMain, setAgent, life, atWork } from "./state.ts"
import { KEPT } from "./comments.ts"
import { followed } from "./windowpanes.ts"
import { chat, onChat } from "./chat.ts"
import { lane, nowNote } from "./lane.ts"
import { startChat, handOverChat } from "./chatturns.ts"

/** What its session runs unasked: its own commands, reading the vault, and keeping what it learns of the user. */
export const ALLOW = ["vau companion", "vau docs", "vau read", "vau search", "vau render", "vau links", "vau context", "vau tasks", "vau dataview", "vau remember", "vau dictation add", "vau watches", "vau tabs", "vau browser", "vau limits", "vau voice off", "vau voice on", "vau voice always"]
// The companion's session is session.json; another agent started by name (start --as Ada) is session-ada.json.
export const sessionFile = (name?: string | null) => `${plugin.localDir()}/${name && !isMain(name) ? `session-${key(name)}` : "session"}.json`
/** A session as kept: its terminal, its model, and how many moments it was handed (a fresh one takes over past
 *  fresh_after). */
export type Session = { id: string; name: string; t: number; model?: string; effort?: string; handed?: number
  /** A chat session's agent (claude, claude_work): a terminal's id says it. */
  runs?: string }
export const session = (name?: string | null): Session | null => {
  try { const s = JSON.parse(fs.readFileSync(sessionFile(name), "utf8")); return typeof s.id === "string" ? s : null } catch { return null }
}
export const writeSession = (s: Session) => fs.writeFileSync(sessionFile(s.name), JSON.stringify(s))
export const sessionId = (name?: string | null): string | null => session(name)?.id ?? null
/** Every session started here: the companion's (its name) and the others'. */
export function sessions(): { name: string; id: string }[] {
  let files: string[] = []
  try { files = fs.readdirSync(plugin.localDir()).filter((f) => /^session(-[\w-]+)?\.json$/.test(f)) } catch { /* none yet */ }
  return files.flatMap((f) => {
    try {
      const s = JSON.parse(fs.readFileSync(`${plugin.localDir()}/${f}`, "utf8"))
      return typeof s.id === "string" ? [{ name: f === "session.json" ? ownName() : str(s.name), id: s.id }] : []
    } catch { return [] }
  })
}
/** Whether a session runs: a terminal's while it does, a chat session's while it's kept (its process, ended when idle a
 *  while, comes back with the next message). */
export const running = async (id: string | null) => !!id && (isChat(id) ? sessions().some((s) => s.id === id) : !!(await plugin.ask<boolean>("terminal:runs", false, id)))
/** A Claude Code session the chat host runs (its id a UUID), not a terminal ("claude-ab12cd34"). */
export const isChat = (id: string | null | undefined) => !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
/** The agent a session runs (claude_work, codex). */
export function runsOf(s: Session) {
  if (isChat(s.id)) return s.runs || "claude"
  const t = parseTerminal(s.id)
  return t ? agentIn(t.agent, t.profile) : ""
}
export const nextCmd = (name: string) => `vau companion next --timeout 240${isMain(name) ? "" : ` --as ${name}`}`

export async function start(ctx: OpCtx, as?: string, agent?: string, model?: string, effort?: string, at: Target = {}, after?: number) {
  const name = as?.trim() || ownName()
  if (!/^[\w-]{1,30}$/.test(name)) throw new OpError("a name is one word (letters, digits, - or _): it's what @ calls it by")
  const was = sessionId(name)
  if (await running(was)) return { id: was!, running: true, name }
  // (a quicker model answers sooner: each moment is one of its turns)
  const how = howFor(name, agent, model, effort), runs = how.agent
  if (onChat(runs)) return await startChat(name, how, at, after)
  const id = newTerminalId(runs), prompt = promptFor(name)
  starting(name, { ...at, runs, model: how.model || undefined, effort: how.effort || undefined }, after)
  try {
    await startAgent(ctx, id, prompt, { allow: ALLOW, model: how.model || null, effort: how.effort || null })
  } catch (e) { seen.delete(key(name)); unstarted(name); throw e }
  writeSession({ id, name, t: Date.now(), ...(how.model ? { model: how.model } : {}), ...(how.effort ? { effort: how.effort } : {}), handed: 0 })
  return { id, running: false, name, ...how }
}

/** Agent `name`'s session boots: asks to it from now on (or after moment `after`) wait for its first `next`, its cursor
 *  showing it starting. */
export function starting(name: string, a: Partial<KeptAgent> = {}, after = seq) {
  const k = key(name)
  seen.set(k, Date.now()); delivered.set(k, Math.min(after, seq)); handed.delete(k); asking.delete(k)
  life.set(k, "starting")
  return setAgent(name, a)
}
export function unstarted(name: string) {
  if (isMain(name)) life.delete(key(name))
  else life.set(key(name), "away")
  setAgent(name, {})
}

/** What a session is told it is: the setting's prompt, how moments reach it (a chat session's messages, a terminal's
 *  loop of next), and its name when it isn't the companion. */
export const promptFor = (name: string, chat = false) => [setting("prompt"), chat ? CHAT_WORDS : LOOP_WORDS(name),
  isMain(name) ? "" : chat ? `Your name here is ${name}: asks to @${key(name)} are yours.` : `Your name here is ${name}: add \`--as ${name}\` to every vau companion command (\`${nextCmd(name)}\`); asks to @${key(name)} are yours.`].filter(Boolean).join(" ")
const LOOP_WORDS = (name: string) => `Then loop and never stop: run \`${nextCmd(name)}\` (give that command a timeout of 250 seconds or more), which waits for what they do and shows the note's lines around it (no need to read the note again), then act on it with \`vau companion look|say|pass|comment|suggest|propose|edit|highlight\`, then run next again. Never end your turn.`
const CHAT_WORDS = "What the user does comes to you as messages (moments, with the note's lines around them: no need to read the note again). Act on them with your vaultite-app tools (say, pass, comment, suggest, propose, edit, look, highlight, draw...), not vau companion commands. Your last call for a moment says done: true, which ends your turn with it: words outside your tools never reach the user, so write none (pass ends it too). Your say, comment and edit words show as you write them, so give their place (find, after, line) before their text. What they do next comes as your next message: never wait or poll for moments."

// ---------- a fresh session: one that has handled many moments (or read much context) hands over to a new one

export const FRESH_TOKENS = 150_000, FRESH_SHARE = 0.6, ASK_AGAIN = 60_000, HANDOVER_WAIT = 3 * 60_000, OLD_ENDS = 15_000, METER_EVERY = 5 * 60_000
const freshAfter = () => Number(plugin.settings().fresh_after) || Number(plugin.manifest.settings?.fresh_after?.default) || 150
/** When each agent was asked to hand over (it summarizes, then `handover`). */
export const handing = new Map<string, number>()
/** Agents the user asked for a fresh session (Start fresh): asked to hand over at their next `next`. */
export const fresh = new Set<string>()
const metered = new Map<string, number>() // session -> when its context was last read (its agent scans processes)

/** Whether a session is due for a fresh one: past fresh_after moments, or its context (when its agent says) past
 *  FRESH_TOKENS or FRESH_SHARE of its window. */
export async function due(s: Session) {
  if ((s.handed ?? 0) >= freshAfter()) return true
  // (a chat session compacts its context itself)
  if (isChat(s.id) || Date.now() - (metered.get(s.id) ?? 0) < METER_EVERY) return false
  metered.set(s.id, Date.now())
  const agent = parseTerminal(s.id)?.agent
  const meters = agent ? await plugin.ask<AgentMeter[]>(`agent-meters:${agent}`, [], true).catch(() => []) : []
  const m = Array.isArray(meters) ? meters.find((x) => x.terminal === s.id) : undefined
  return !!m?.tokens && m.tokens >= Math.min(FRESH_TOKENS, (m.window || Infinity) * FRESH_SHARE)
}

/** What a fresh session is told after its prompt: the last one's summary, its open threads and the user's last asks. */
export function handoverText(name: string, summary: string, items: Note[], asks: Moment[], chat = false) {
  const open = items.filter((n) => !n.by && key(n.agent) === key(name) && KEPT.has(n.kind)).slice(-20)
  const last = (n: Note) => n.replies?.at(-1), now = nowNote()
  return [`This session continues an earlier one of yours that grew long. The user sees no change: don't greet them or say you're new. ${chat ? "Read `vau docs companion`, then end your turn: their next moments come as your messages" : `Read \`vau docs companion\`, then run \`${nextCmd(name)}\` at once`} (ME.md${now ? ` or ${now.path}` : ""} when a moment needs it).`,
    summary.trim() ? `What your last session handed over:\n${summary.trim()}` : "",
    open.length ? `Your open threads (reply with ${chat ? "your comment tool and its id" : "`vau companion comment --id <id>`"}):\n${open.map((n) => `- ${n.id} ${n.kind} in ${n.path}${n.line ? `:${n.line}` : ""}${n.orphaned ? " (its text is gone)" : ""}: ${JSON.stringify(cut(n.text ?? n.replace ?? "", 160))}${last(n) ? `; last, ${last(n)!.by === "user" ? "the user" : "you"}: ${JSON.stringify(cut(last(n)!.text, 160))}` : ""}`).join("\n")}` : "",
    asks.length ? `The user's last asks:\n${asks.map((m) => `- ${m.path ?? ""}${m.line ? `:${m.line}` : ""} ${JSON.stringify(cut(m.text ?? "", 160))}`).join("\n")}` : ""].filter(Boolean).join("\n\n")
}

/** Start the fresh session (the same agent and account) with the handover, then end the old one once it has answered. */
export async function handOver(ctx: OpCtx, name: string, summary: string) {
  const old = session(name)
  if (!old) throw new OpError(`${name} has no session to hand over`, 404)
  const k = key(name)
  const asks = [...new Map(moments.filter((m) => m.kind === "ask" && key(m.for ?? "") === k).map((m) => [m.text, m])).values()].slice(-5)
  if (isChat(old.id)) return await handOverChat(name, old, handoverText(name, summary, [...notes.values()], asks, true))
  const id = newTerminalId(runsOf(old) || agentSetting())
  // (the same model; its cursor stays as it is: moments wait for the new one's first next, as for any start)
  await startAgent(ctx, id, `${promptFor(name)}\n\n${handoverText(name, summary, [...notes.values()], asks)}`,
    { allow: ALLOW, model: old.model || null, effort: old.effort || null })
  writeSession({ ...old, id, t: Date.now(), handed: 0 })
  handing.delete(k); handed.delete(k)
  seen.set(k, Date.now())
  did(name, "handover")
  // (after its handover call has answered, so it isn't cut off mid-command)
  setTimeout(() => { void (async () => { if (await running(old.id)) await plugin.runOp("terminal.end", { id: old.id }) })().catch(() => {}) }, OLD_ENDS).unref?.()
  return { id, from: old.id, name }
}

/** End a session (the companion's by default), or every one. */
export async function stop(as?: string, all = false) {
  const gone = all ? sessions() : [{ name: as?.trim() || ownName(), id: sessionId(as) ?? "" }]
  for (const s of gone) {
    try { fs.rmSync(sessionFile(s.name)) } catch { /* none */ }
    if (isChat(s.id)) await chat()?.stop(s.id).catch(() => {})
    else if (await running(s.id)) await plugin.runOp("terminal.end", { id: s.id })
  }
  for (const s of gone) if (s.id) dead.add(s.id)
  if (all || isMain(gone[0]?.name ?? "")) await lane().stop()
  for (const a of agents.values()) if (all || gone.some((s) => key(s.name) === key(a.name))) ended(a.name)
  return { id: gone[0]?.id || null }
}

/** Agent `name`'s session ended (stopped, its tab closed, killed): its cursor goes until it starts again (an ask to
 *  the companion wakes it), its waiting `next` answered. `id`: its terminal, whose late calls are let go. */
export function ended(name: string, id?: string) {
  const k = key(name)
  asking.delete(k); handing.delete(k); fresh.delete(k); seen.delete(k); watching.delete(k); handed.delete(k); atWork.delete(k)
  ends.set(k, (ends.get(k) ?? 0) + 1)
  if (id) dead.add(id)
  const wait = waiters.get(k)
  if (wait) { waiters.delete(k); wait([]) }
  life.set(k, "away")
  setAgent(name, { asks: undefined })
  followed.remove(null, name)
}
plugin.onEvent({ types: ["terminal.ended"] }, (ev) => {
  const s = sessions().find((x) => x.id === ev.id)
  if (s) ended(s.name, s.id)
})
// (its agent isn't installed: forgotten, so an ask starts it again; its terminal stays, showing the shell's error)
plugin.onEvent({ types: ["terminal.agent-missing"] }, (ev) => {
  const s = sessions().find((x) => x.id === ev.id)
  if (!s) return
  try { fs.rmSync(sessionFile(s.name)) } catch { /* none */ }
  ended(s.name, s.id)
})
