// Delegation: an agent hands a task to another (Claude Code as a chat, Codex or OpenCode in a terminal) and waits for its
// answer or carries on. Its turns are heard through its inbox thread (inbox.event); it never gets more than its parent.
import fs from "node:fs"
import path from "node:path"
import { type AgentModels, type Asking, type Choice, agentName, HOME, KNOWN_AGENTS, MODEL_NAME, newTerminalId, parseTerminal, PERMISSION_MODES, type PermissionMode,
  startAgent } from "../../../core/agents.ts"
import { byUser, type OpCtx, OpError, Plugin, quoted, userSurface } from "../../../core/plugins.ts"
import { type Item, writeAtomic } from "../../../core/vault.ts"
import { cascade, childrenOf, clampMode, ended, known, type Party, same, type Task, taskOf, titleOf } from "./graph.ts"

export const plugin = new Plugin(import.meta.url)

const TARGETS = ["claude", "codex", "opencode"]
/** What an asking child waits on before it goes on. */
const BLOCKED = new Set(["permission", "question", "auth", "plan"])
const WAITS: Record<string, string> = { permission: "a permission", question: "an answer", auth: "a sign-in", plan: "a plan approved" }
const KEEP_DAYS = 7, KEEP = 300
const str = (v: unknown) => (typeof v === "string" ? v : "")
const nameOf = (agent: string) => agentName(agent) ?? (agent ? agent[0].toUpperCase() + agent.slice(1) : "An agent")
const answers = () => plugin.settings({}).agents_answer !== false

// ---------- the tasks, kept on this machine (sessions are its own)

const file = () => path.join(plugin.localDir(), "tasks.json")
let tasks: Task[] | null = null
let saving: ReturnType<typeof setTimeout> | null = null
export function all(): Task[] {
  if (tasks) return tasks
  try { tasks = (JSON.parse(fs.readFileSync(file(), "utf8")).tasks ?? []) as Task[] } catch { tasks = [] }
  return tasks
}
function save() {
  saving ??= setTimeout(() => {
    saving = null
    const since = Date.now() - KEEP_DAYS * 86_400_000
    tasks = all().filter((t, i) => !ended(t) || (t.at >= since && i < KEEP))
    try { writeAtomic(file(), JSON.stringify({ tasks })) } catch (e) { console.error("delegate:", e) }
  }, 200)
}
plugin.onUnload(() => { if (saving) { clearTimeout(saving); saving = null } })

/** Who waits on each task's turn (delegate.start's wait, status --wait): told whenever it changes. */
const waiting = new Map<string, Set<() => void>>()
function changed(t: Task) {
  t.at = Date.now()
  save()
  for (const f of [...waiting.get(t.id) ?? []]) f()
}
/** Whether a waiter is done waiting: its turn ended, or it asks a question its parent may answer. */
const settledFor = (t: Task) => ended(t) || (answers() && t.state === "waiting" && t.ask === "question")
/** Waits for task `t` to settle, at most `ms`: true when it timed out. */
function settle(t: Task, ms: number): Promise<boolean> {
  if (settledFor(t) || ms <= 0) return Promise.resolve(!settledFor(t))
  return new Promise((resolve) => {
    let set = waiting.get(t.id)
    if (!set) waiting.set(t.id, (set = new Set()))
    const done = (late: boolean) => { clearTimeout(timer); set!.delete(check); if (!set!.size) waiting.delete(t.id); resolve(late) }
    const check = () => { if (settledFor(t)) done(false) }
    const timer = setTimeout(() => done(true), ms)
    set.add(check)
  })
}

// ---------- the children's turns, as the inbox hears them (each agent's state signals: hooks, OSC 7501, the chat's host)

plugin.onEvent({ types: ["inbox.event"] }, (ev) => {
  if (ev.kind !== "session" || ev.machine) return
  const p: Party = { agent: str(ev.source), ...(str(ev.terminal) ? { terminal: str(ev.terminal) } : {}), ...(str(ev.session) ? { session: str(ev.session) } : {}) }
  const t = known(p) ? taskOf(all(), p) : null
  if (t && t.state !== "cancelled") void heard(t, p, str(ev.state), str(ev.ask)).catch((e) => console.error("delegate:", e))
})

// An agent in a terminal that tells nothing when its turn ends (Codex before 0.163: no OSC 7501, no hooks) says it in its
// transcript (agent-turn's `done`): a child at work is read now and then, and the end told to the inbox as a host would.
const polling = setInterval(() => void poll().catch((e) => console.error("delegate:", e)), 3000)
polling.unref?.()
plugin.onUnload(() => clearInterval(polling))
async function poll() {
  for (const t of all()) {
    if (t.state !== "working" || !t.child.terminal) continue
    const turn = await plugin.ask<{ done?: boolean; at?: number; text?: string; prompt?: string; session?: string } | null>(`agent-turn:${t.child.agent}`, null,
      t.child.terminal, t.child.session ?? "")
    if (turn?.session && !t.child.session) { t.child.session = turn.session; save() }
    if (!turn?.done || (turn.at ?? 0) < t.turn - 1000 || t.state !== "working") continue
    await plugin.ask("inbox:session", null, { agent: t.child.agent, terminal: t.child.terminal, ...(t.child.session ? { session: t.child.session } : {}), state: "done",
      text: turn.text ?? "", prompt: turn.prompt ?? "" })
  }
}

/** A child's terminal ended before its turn did. */
plugin.onEvent({ types: ["terminal.ended"] }, (ev) => {
  const t = taskOf(all(), { agent: "", terminal: str(ev.id) })
  if (!t || ended(t)) return
  Object.assign(t, { state: "error", error: "Its terminal ended before it finished." })
  changed(t)
  void wake(t)
})

async function heard(t: Task, p: Party, state: string, ask: string) {
  // (a terminal's session id, once its agent says it)
  if (!t.child.session && p.session) { t.child.session = p.session; save() }
  // (a turn after its answer is the user's, who talked to it: only delegate.send gives it back to its parent)
  if (ended(t)) return
  if (state === "working") {
    if (t.state === "working") return
    Object.assign(t, { state: "working", ask: undefined, questions: undefined })
    return changed(t)
  }
  if (state === "open" && BLOCKED.has(ask)) {
    const a = ask === "question" ? await plugin.ask<Asking | null>(`agent-asking:${t.child.agent}`, null, t.child.terminal ?? "", t.child.session ?? "") : null
    Object.assign(t, { state: "waiting", ask, questions: a?.kind === "question" ? a.questions : undefined })
    return changed(t)
  }
  if (state !== "done" && state !== "open") return
  // Its turn ended: its last message is the answer, read from its own transcript (the inbox keeps only a preview).
  const turn = await plugin.ask<{ text?: string; files?: string[]; at?: number } | null>(`agent-turn:${t.child.agent}`, null, t.child.terminal ?? "", t.child.session ?? "")
  if (ended(t)) return
  const text = str(turn?.text).trim()
  Object.assign(t, { state: ask === "error" ? "error" : "done", ask: undefined, questions: undefined, result: text, files: turn?.files ?? [],
    ...(ask === "error" ? { error: text || "It stopped with an error." } : { error: undefined }) })
  const awaited = !!waiting.get(t.id)?.size
  changed(t)
  if (!awaited) await wake(t)
}

/** Tell a parent that its child is done, when nothing waited for it: typed into its terminal, or said to its chat (which
 *  resumes it). The user's tasks need nothing: the child's thread is in their inbox. */
async function wake(t: Task) {
  const p = t.parent
  if (!known(p)) return
  const text = `[Vaultite] ${resultText(view(t))}`
  try {
    if (p.terminal && await plugin.ask<boolean>("terminal:runs", false, p.terminal)) await plugin.runOp("terminal.send", { id: p.terminal, text })
    else if (p.session) await (plugin.service(`agent-reply:${p.agent}`) as ((s: string, text: string) => Promise<boolean>) | null)?.(p.session, text)
  } catch (e) { console.error(`delegate: couldn't tell ${p.terminal || p.session} that ${t.id} ended:`, e) }
}

/** Whether a parent hears its children by itself (wake reaches it): its app terminal, or a session its host talks to. */
const wakeable = (p: Party) => !!p.terminal || (!!p.session && !!plugin.service(`agent-reply:${p.agent}`))

/** A session in the graph, for the inbox ("delegate:lineage"): `parent` delegated it its task; `consumes`: this turn is
 *  that parent's to read, not the user's; `waits`: its own subagents still at work, which will tell it when done. */
export type Lineage = { parent: (Party & { task: string }) | null; consumes: boolean; waits: number }
plugin.provide("delegate:lineage", (agent: string, terminal = "", session = ""): Lineage | null => {
  const p: Party = { agent, ...(terminal ? { terminal } : {}), ...(session ? { session } : {}) }
  if (!known(p)) return null
  const t = taskOf(all(), p)
  const parent = t && known(t.parent) ? { ...t.parent, task: t.title } : null
  const waits = wakeable(p) ? childrenOf(all(), p).filter((c) => !ended(c)).length : 0
  return parent || waits ? { parent, consumes: !!parent && t!.state !== "done" && t!.state !== "error", waits } : null
})

// ---------- who asks, and what they may

/** Who the caller is: null for the user (the app, vau typed by hand); else its agent and session, as vau fills them in
 *  from its environment (a terminal's id only when it runs an agent). */
function callerOf(p: Item, ctx: OpCtx): Party | null {
  if (byUser(ctx.who) || userSurface(ctx.who)) return null
  const t = str(p.terminal).trim(), s = str(p.session).trim()
  const terminal = /^[\w-]{1,64}$/.test(t) && parseTerminal(t) ? t : ""
  const session = /^[\w.-]{4,120}$/.test(s) ? s : ""
  const own = KNOWN_AGENTS.find((a) => a.id === ctx.who.agent)
  const agent = (/^[a-z][a-z0-9]{0,31}$/.test(str(p.from)) ? str(p.from) : "") || (terminal && parseTerminal(terminal)?.agent) || own?.terminal || own?.id || ctx.who.agent || "agent"
  return { agent, ...(terminal ? { terminal } : {}), ...(session ? { session } : {}) }
}

/** The mode a caller runs in, the most its child may have: undefined for the user (no ceiling), null when its agent
 *  can't say (counted as default). */
async function ceilingOf(caller: Party | null): Promise<PermissionMode | null | undefined> {
  if (!caller) return undefined
  if (!known(caller)) return null
  return await plugin.ask<PermissionMode | null>(`agent-mode:${caller.agent}`, null, caller.terminal ?? "", caller.session ?? "")
}

/** Task `id`, if the caller may act on it: its parent (or the user, for any). */
function taskFor(id: string, caller: Party | null): Task {
  const t = all().find((x) => x.id === id.trim())
  if (!t) throw new OpError(`no delegated task ${id} (vau delegate list)`, 404)
  if (caller && t.parent === null) throw new OpError(`${id} is the user's, not yours`, 403)
  if (caller && known(t.parent) && !(known(caller) && same(t.parent, caller))) throw new OpError(`${id} was delegated by another session, not yours`, 403)
  return t
}

const CALLER = {
  terminal: { type: "string", env: "VAULTITE_TERMINAL", description: "the app terminal you run in (filled in from VAULTITE_TERMINAL)" },
  session: { type: "string", env: "CLAUDE_CODE_SESSION_ID", description: "your session's id (filled in from CLAUDE_CODE_SESSION_ID)" },
  from: { type: "string", env: "VAULTITE_AGENT", description: "who you are (claude, codex): from VAULTITE_AGENT, else your terminal's agent" },
} as const
const ID = { type: "string", required: true, description: "the task's id (vau delegate list)" } as const
const MAX = 1800
const TIMEOUT = { type: "number", minimum: 1, maximum: MAX, default: 100, description: "with wait, the seconds to wait at most (keep it under your shell's own timeout); then it goes on as async" } as const
const MODE = { type: "string", enum: ["wait", "async"], default: "wait", description: "wait: answer once its turn ends (or it asks you something); async: answer at once, its result comes to you as a message when it's done" } as const

// ---------- answers

type View = ReturnType<typeof view>
function view(t: Task, extra: { timedOut?: boolean; clamped?: boolean } = {}) {
  const link = t.child.terminal ? `view:terminal/${t.child.terminal}` : t.child.session ? `view:${t.child.agent}-session/${t.child.session}` : null
  return { id: t.id, agent: t.child.agent, title: t.title, state: t.state, ...(t.ask ? { ask: t.ask } : {}), ...(t.questions?.length ? { questions: t.questions } : {}),
    ...(t.result !== undefined ? { result: t.result } : {}), ...(t.files?.length ? { files: t.files } : {}), ...(t.error ? { error: t.error } : {}),
    mode: t.mode, ...(t.model ? { model: t.model } : {}), ...(t.effort ? { effort: t.effort } : {}), cwd: t.cwd,
    ...(t.child.terminal ? { terminal: t.child.terminal } : {}), ...(t.child.session ? { session: t.child.session } : {}), link,
    byUser: t.parent === null, started: t.started, at: t.at, ...extra }
}

const questionsText = (v: View) => (v.questions ?? []).map((q) => `${q.question}${q.multi ? " (any of them)" : ""}\n${q.options.map((o, i) => `${i + 1}. ${o.label}${o.description ? `: ${o.description}` : ""}`).join("\n")}`).join("\n\n")

/** A task as an agent reads it: its answer once done, what it asks, else that it's on it and how its answer comes. */
export function resultText(v: View) {
  const who = nameOf(v.agent), it = `"${v.title}" (${v.id})`
  const later = v.byUser ? "Its thread is in the inbox." : `Its answer comes to you as a message when it's done; or wait for it: vau delegate status ${v.id} --wait 300.`
  const mode = v.clamped ? ` It runs in ${v.mode} mode: not more than yours.` : ""
  switch (v.state) {
    case "done": return [`${who} finished ${it}:`, v.result || "(It said nothing.)", v.files?.length ? `Files it changed:\n${v.files.map((f) => `- ${f.replace(HOME, "~")}`).join("\n")}` : ""].filter(Boolean).join("\n\n")
    case "error": return `${who} stopped with an error on ${it}: ${v.error ?? ""}`
    case "cancelled": return `Cancelled ${it}.`
    case "waiting": return v.ask === "question" && v.questions?.length
      ? `${who} asks, on ${it}:\n\n${questionsText(v)}\n\n${answers() && !v.byUser ? `Answer: vau delegate answer ${v.id} --picks 1 (an option's number per question, or your own words), or leave it to the user (it's in their inbox).` : "The user answers it, in their inbox."}`
      : `${who} waits on the user for ${WAITS[v.ask ?? ""] ?? "something"} (in their inbox), on ${it}.${mode} ${later}`
    default: return `${who} is ${v.timedOut ? "still " : ""}working on ${it}.${mode} ${later}`
  }
}

// ---------- ops

/** A folder as given (~ for home), which must be there; else the caller's. */
function folderOf(given: unknown) {
  const raw = str(given).trim()
  if (!raw) return plugin.vault.path
  const dir = path.resolve(raw.replace(/^~(?=$|\/)/, HOME))
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new OpError(`there's no folder ${dir}`, 404)
  return dir
}

const newId = () => `d${Array.from({ length: 7 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("")}`

/** What the child is told: the task, and (an agent's) that its last message goes back to whoever asked. */
const promptFor = (t: Task) => (t.parent
  ? `${t.task}\n\n(${nameOf(t.parent.agent)} delegated this to you through Vaultite and reads your last message as your answer: end with the result, and the files you changed.)`
  : t.task)

plugin.op({
  id: "delegate.start", cli: "delegate", mcp: "delegate", owner: "coding agents on this machine", kind: "write", lock: false,
  summary: "Hand a task to another coding agent as your subagent (Claude Code, Codex, OpenCode): wait for its answer, or start it and carry on.",
  help: `A second opinion (Codex reviewing your diff), a parallel task, or work better done by another model. The child is
its own session, a thread of its own in the user's inbox ("from" yours): Claude Code runs as a chat in the app,
Codex and OpenCode in a terminal of the app. It never gets more permissions than you have (permissions: as much or
less; default: yours), and what it asks permission for goes to the user, not to you. mode wait answers with its last
message (and the files it changed) once its turn ends, or when it asks a question you may answer (vau delegate
answer); past timeout it goes on as async. async answers its id at once; its result comes to you as a message when
it's done (vau delegate status <id> to look, --wait to wait).

  vau delegate codex "Review the diff on this branch for bugs; list them, don't fix" --model gpt-6.1-sol --effort low
  vau delegate claude "Write the migration's tests" --mode async --cwd ~/code/lighthouse --model haiku`,
  params: {
    agent: { type: "string", enum: TARGETS, required: true, description: "who does it: claude (Claude Code), codex or opencode" },
    task: { type: "string", required: true, description: "what to do, standing alone (it doesn't see your conversation): the goal, where, what to answer" },
    mode: MODE,
    timeout: TIMEOUT,
    model: { type: "string", description: "its model (haiku, sonnet, opus; Codex's gpt-...): its default when left out" },
    effort: { type: "string", description: "how hard it thinks (low, medium, high...)" },
    permissions: { type: "string", enum: [...PERMISSION_MODES], description: "how much it may do without asking the user: plan, dontAsk, default, acceptEdits, auto, bypassPermissions; never more than you (default: yours)" },
    cwd: { type: "string", env: "PWD", description: "the folder it works in (default: yours, else the vault's)" },
    title: { type: "string", description: "what it's called in the inbox and the lists (default: the task's first words)" },
    ...CALLER,
  },
  args: ["agent", "task"],
  run: async (p, ctx) => {
    const said = str(p.task).trim()
    if (!said) throw new OpError("task: what to do")
    const parent = callerOf(p, ctx), agent = str(p.agent)
    const { mode, clamped } = clampMode(await ceilingOf(parent), p.permissions as PermissionMode | undefined, !parent)
    const how = await plugin.ask<AgentModels | null>(`agent-models:${agent}`, null)
    if (!how) throw new OpError(`${nameOf(agent)} isn't here: its plugin is off (vau plugin on ${agent === "claude" ? "claude-code" : agent})`, 409)
    if (mode && !how.modes?.includes(mode)) throw new OpError(`${nameOf(agent)} can't be held to a permission mode here (its plugin is older): delegate to another agent`, 409)
    if (p.model && !MODEL_NAME.test(str(p.model))) throw new OpError(`'${p.model}' isn't a model's name`)
    if (p.effort && how.efforts.length && !how.efforts.includes(str(p.effort))) throw new OpError(`effort: ${how.efforts.join(", ")} (got ${p.effort})`)
    const now = Date.now()
    const t: Task = { id: newId(), parent, child: { agent }, task: said, title: str(p.title).trim() || titleOf(said), cwd: folderOf(p.cwd),
      ...(p.model ? { model: str(p.model) } : {}), ...(p.effort ? { effort: str(p.effort) } : {}), mode, state: "working", started: now, at: now, turn: now }
    // (kept before it starts: what it says first finds it)
    all().unshift(t)
    try {
      if (agent === "claude") {
        const r = await ctx.op("claude-code.chat-start", { prompt: promptFor(t), cwd: t.cwd, ...(t.model ? { model: t.model } : {}), ...(t.effort ? { effort: t.effort } : {}),
          ...(mode ? { mode } : {}) }) as { id: string }
        t.child.session = r.id
      } else {
        t.child.terminal = newTerminalId(agent)
        await startAgent(ctx, t.child.terminal, promptFor(t), { model: t.model ?? null, effort: t.effort ?? null, mode, cwd: t.cwd })
      }
    } catch (e) {
      tasks = all().filter((x) => x !== t)
      throw e
    }
    save()
    const timedOut = p.mode === "wait" ? await settle(t, Number(p.timeout) * 1000) : false
    return view(t, { clamped, ...(p.mode === "wait" ? { timedOut } : {}) })
  },
  text: (r) => resultText(r),
  did: ({ agent, task }) => ({ action: "run", text: `Delegated ${quoted(task, 60)} to ${nameOf(str(agent))}` }),
})

plugin.op({
  id: "delegate.status", cli: "delegate status", mcp: true, owner: "coding agents on this machine", kind: "read", lock: false,
  summary: "Where a task you delegated stands: working, waiting (on what), or done with its answer and the files it changed.",
  help: `wait: the seconds to wait for its turn to end (or for a question you may answer), at most ${MAX}.

  vau delegate status d3k2h1g0 --wait 300`,
  params: { id: ID, wait: { type: "number", minimum: 0, maximum: MAX, default: 0, description: "seconds to wait for it to finish (0: answer now)" }, ...CALLER },
  args: ["id"],
  run: async (p, ctx) => {
    const t = taskFor(str(p.id), callerOf(p, ctx))
    const timedOut = await settle(t, Number(p.wait) * 1000)
    return view(t, Number(p.wait) > 0 ? { timedOut } : {})
  },
  text: (r) => resultText(r),
})

plugin.op({
  id: "delegate.send", cli: "delegate send", mcp: true, owner: "coding agents on this machine", kind: "write", lock: false,
  summary: "Tell a subagent something more (a follow-up, a correction): it goes on in the same session, and you wait for its answer or carry on.",
  help: `  vau delegate send d3k2h1g0 "Now fix the two worst ones"`,
  params: { id: ID, text: { type: "string", required: true, description: "what to tell it" }, mode: MODE, timeout: TIMEOUT, ...CALLER },
  args: ["id", "text"],
  run: async (p, ctx) => {
    const t = taskFor(str(p.id), callerOf(p, ctx))
    const text = str(p.text).trim()
    if (!text) throw new OpError("text: what to tell it")
    if (t.state === "cancelled") throw new OpError(`${t.id} was cancelled: delegate it again`, 409)
    if (t.child.terminal) {
      if (!(await plugin.ask<boolean>("terminal:runs", false, t.child.terminal))) throw new OpError(`${t.id}'s terminal ended: delegate it again`, 409)
      await ctx.op("terminal.send", { id: t.child.terminal, text })
    } else await ctx.op("claude-code.chat-send", { id: t.child.session, text })
    Object.assign(t, { state: "working", ask: undefined, questions: undefined, result: undefined, files: undefined, error: undefined, turn: Date.now() })
    changed(t)
    const timedOut = p.mode === "wait" ? await settle(t, Number(p.timeout) * 1000) : false
    return view(t, p.mode === "wait" ? { timedOut } : {})
  },
  text: (r) => resultText(r),
  did: ({ id, text }) => ({ action: "run", text: `Told the subagent ${id} ${quoted(text, 60)}` }),
})

plugin.op({
  id: "delegate.answer", cli: "delegate answer", mcp: true, owner: "coding agents on this machine", kind: "write", lock: false,
  summary: "Answer a question your subagent asks (its AskUserQuestion), as the user would: never a permission, which only they answer.",
  help: `picks: one per question, an option's number (several, comma-separated, in a multi-select) or words of your own. The
user may have set that only they answer (then it waits for them, in their inbox).

  vau delegate answer d3k2h1g0 --picks 2`,
  params: { id: ID, picks: { type: "array", items: { type: "string" }, commas: false, required: true, description: "the questions' answers, in order" }, ...CALLER },
  args: ["id"],
  run: async (p, ctx) => {
    const t = taskFor(str(p.id), callerOf(p, ctx))
    if (!answers()) throw new OpError("the user answers your subagents' questions themselves (Delegation's setting): it waits for them, in their inbox", 403)
    if (t.state !== "waiting" || t.ask !== "question" || !t.questions?.length) {
      throw new OpError(t.state === "waiting" ? `it waits on the user for ${WAITS[t.ask ?? ""] ?? "something"}: only they answer that` : "it doesn't ask anything now", 409)
    }
    const qs = t.questions
    const picks: Choice[] = (p.picks as string[]).map((x, i) => {
      const ns = x.split(",").map((n) => Number(n.trim()))
      return ns.every((n) => Number.isInteger(n) && n >= 1 && n <= (qs[i]?.options.length ?? 0)) ? ns : x
    })
    if (picks.length !== qs.length) throw new OpError(`picks: one answer per question (${qs.length})`)
    const answer = plugin.service(`agent-answer:${t.child.agent}`) as ((s: string, a: Item) => Promise<boolean>) | null
    if (t.child.terminal || !t.child.session || !answer || !(await answer(t.child.session, { picks }))) {
      throw new OpError(`${nameOf(t.child.agent)} takes its answer as a message here: vau delegate send ${t.id} "<your answer>"`, 409)
    }
    Object.assign(t, { state: "working", ask: undefined, questions: undefined })
    changed(t)
    return view(t)
  },
  text: (r) => `Answered. ${resultText(r)}`,
})

plugin.op({
  id: "delegate.cancel", cli: "delegate cancel", mcp: true, owner: "coding agents on this machine", kind: "destructive", lock: false,
  summary: "Stop a subagent and every subagent it started (deepest first): what they were doing stops, their conversations stay.",
  params: { id: ID, ...CALLER },
  args: ["id"],
  run: async (p, ctx) => {
    const t = taskFor(str(p.id), callerOf(p, ctx))
    const stopped: string[] = []
    for (const x of cascade(all(), t.id)) {
      if (x.state === "cancelled" && x.id !== t.id) continue
      const busy = x.state === "working" || x.state === "waiting"
      // (cancelled first: what its stopping says is heard as the parent's, quietly; one done keeps its answer)
      if (busy || x.id === t.id) {
        Object.assign(x, { state: "cancelled", ask: undefined, questions: undefined })
        changed(x)
        stopped.push(x.id)
      }
      // (a session kept for a follow-up ends too)
      try {
        if (x.child.terminal) { if (await plugin.ask<boolean>("terminal:runs", false, x.child.terminal)) await ctx.op("terminal.end", { id: x.child.terminal }) }
        else if (x.child.session) {
          await ctx.op("claude-code.chat-stop", { id: x.child.session })
          // (its thread settles: a chat stopped tells the inbox nothing)
          if (busy) await plugin.ask("inbox:session", null, { agent: x.child.agent, session: x.child.session, state: "done", text: "Cancelled." })
        }
      } catch (e) { if (!(e instanceof OpError && e.status === 404)) throw e }
    }
    // (the user stopped the last one a parent waited for: its thread, working meanwhile, is its last turn's again)
    const up = t.parent
    if (!callerOf(p, ctx) && known(up) && !childrenOf(all(), up).some((c) => !ended(c))) {
      await plugin.ask("inbox:session", null, { agent: up.agent, ...(up.terminal ? { terminal: up.terminal } : {}), ...(up.session ? { session: up.session } : {}), state: "done" })
    }
    return { id: t.id, title: t.title, stopped }
  },
  text: (r) => `Cancelled "${r.title}" (${r.id})${r.stopped.length > 1 ? `, and the ${r.stopped.length - 1} subagent${r.stopped.length > 2 ? "s" : ""} under it` : ""}.`,
  did: ({ id }) => ({ action: "run", text: `Cancelled the subagent ${id}` }),
})

plugin.op({
  id: "delegate.list", cli: "delegate list", mcp: true, owner: "coding agents on this machine", kind: "read", lock: false,
  summary: "The tasks you delegated, newest first (each one's state and answer), and who delegated you yours.",
  help: `The user (the app, vau typed by hand) sees every task, or with of, one session's: its parent and children.`,
  params: { of: { type: "string", description: "the user's: a session's (its id or its terminal's) parent and children" }, ...CALLER },
  run: async (p, ctx) => {
    const caller = callerOf(p, ctx)
    const of = str(p.of).trim()
    const who: Party | null = !caller && of ? { agent: "", terminal: of, session: of } : caller
    const mine = known(who) ? taskOf(all(), who) : null
    const children = (known(who) ? childrenOf(all(), who) : who ? [] : all()).slice(0, 50)
    const link = (x: Party) => x.terminal ? `view:terminal/${x.terminal}` : x.session ? `view:${x.agent}-session/${x.session}` : null
    const from = mine && known(mine.parent) ? mine.parent : null
    // (what the parent's called: its agent's name for the session, else its terminal's title)
    const named = from ? str((await plugin.ask<{ title?: string } | null>(`agent-turn:${from.agent}`, null, from.terminal ?? "", from.session ?? ""))?.title) ||
      (from.terminal ? str((await plugin.ask<{ title?: string } | null>("terminal:info", null, from.terminal))?.title) : "") : ""
    return { parent: from ? { ...from, link: link(from), title: named || `${nameOf(from.agent)} session`, task: mine!.id } : null, children: children.map((t) => view(t)) }
  },
  text: (r) => [r.parent ? `Delegated to you by ${nameOf(r.parent.agent)}'s "${r.parent.title}" (${r.parent.task}).` : "",
    r.children.length ? r.children.map((c: View) => `- ${c.id} · ${nameOf(c.agent)} · ${c.state}${c.ask ? ` (${c.ask})` : ""} · ${c.title}`).join("\n") : "No delegated tasks."].filter(Boolean).join("\n\n"),
})
