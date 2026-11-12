import { AsyncLocalStorage } from "node:async_hooks"
import type { IncomingMessage } from "node:http"
import { type OpCtx, whoOf } from "../../../core/plugins.ts"
import { requestWriter } from "../../../core/vault.ts"
import { ALLOW, sessions, promptFor } from "./alwayson.ts"
import { plugin } from "./self.ts"
import { ownName } from "./settings.ts"
import { atWork, did, key, isMain, restate } from "./state.ts"
import { toolUse, type Streaming, streamed, streamDone } from "./edits.ts"
import { turning } from "./chatturns.ts"
import { inSummoned } from "./summoned.ts"

/** A tool served to a chat session, run here: claude-code's chat relays its calls. */
export type ChatTool = { name: string; description: string; schema: { properties?: Record<string, unknown>; required?: string[] }; run: (args: unknown, use?: string) => Promise<unknown>
  streams?: boolean; ends?: boolean; hidden?: boolean; stream?: (use: string, json: string, end?: "done" | "stop") => void }
export type ChatHow = { cwd?: string; account?: string; model?: string; effort?: string; append?: string; title?: string; by?: string; inbox?: boolean; allowed?: string[]; denied?: string[]; dirs?: string[]; tools?: ChatTool[]
  /** Its permission mode (Claude Code's): the summoned session's is auto, what its classifier blocks offered to them. */
  mode?: "default" | "acceptEdits" | "plan" | "auto" | "dontAsk" | "bypassPermissions"
  /** Its permission asks and auto mode's blocks answered by its hidden tool of that name; commands never run (regex
   *  sources); auto mode's rules (claude-code's chathost.ts). */
  confirm?: string; never?: string[]; autoMode?: Record<string, string[]>
  /** Pictures sent with its message (an ask's screenshot); `quick`: no thinking first. */
  images?: string[]; quick?: boolean
  /** A lean session's whole system prompt and the few Claude Code tools it has; its words as written (`onText`). */
  system?: string; builtins?: string[]; onText?: (use: string, text: string, end?: "done" | "stop" | "tool") => void }
export type ChatState = { id: string; state: "starting" | "working" | "waiting" | "idle" | "error"; error?: string; seq?: number; turn?: { text: string } | null
  /** Tokens its last request read. */
  context?: number }
/** What claude-code exports as `chat`. */
export type Chat = {
  start: (o: ChatHow & { prompt?: string }) => Promise<ChatState>
  send: (id: string, text: string, o?: ChatHow) => Promise<unknown>
  stop: (id: string) => Promise<unknown>
  interrupt: (id: string) => Promise<boolean>
  list: () => ChatState[]
  touch: () => void
  serve: (id: string, o: ChatHow) => void
  on: (fn: (id: string, s: ChatState | null) => void) => () => void
  asking: (id: string) => string[]
}
export const chat = () => (plugin.peer("claude-code")?.exports.chat ?? null) as Chat | null
/** Claude Code's companions run through the SDK; Codex's and OpenCode's in terminals, looping on `next`. */
export const onChat = (agent: string) => agent.split("_")[0] === "claude"
/** The actions a chat session has as tools: the ops of those names, run as it (vau companion is refused it in Bash). */
export const TOOLS = ["say", "pass", "comment", "suggest", "propose", "edit", "look", "highlight", "draw", "layer", "see", "act", "check", "follow", "unfollow", "keep", "clear", "history", "status", "handover", "handoff", "where", "open", "page", "jobs", "job", "job-open", "job-stop", "job-answer", "job-show", "talk", "conversation", "tour", "tour-save"]
/** Tools whose answers the talk leaves out: what it read, and its words (logged as they're said). */
const QUIET_RESULTS = new Set(["see", "check", "history", "status", "conversation", "say", "pass", "look", "highlight"])
/** An action's last call of a turn: its turn ends with it, no call of the model's after (a summary nobody reads). */
const DONE = { type: "boolean", description: "true on your last call for this moment: your turn ends with it" }
/** Those whose words show as they're written; those its turn may end after with no words (a summary holds its next moment). */
const STREAMS = new Set(["say", "comment", "edit", "draw"]), ENDS = new Set(["say", "pass", "comment", "suggest", "propose", "edit", "look", "highlight", "draw", "layer", "act", "follow", "unfollow", "keep", "clear", "handover", "handoff", "open", "page", "job", "job-open", "job-stop", "job-answer", "job-show", "tour"])
/** Those after which its turn always ends. */
const LAST = new Set(["pass", "handover", "handoff"])
/** What it runs unasked: its tools, and reading the vault (its actions are tools, not vau companion). */
export const ALLOWED = ["mcp__vaultite-app", ...ALLOW.filter((c) => c !== "vau companion").map((c) => `Bash(${c}:*)`)]
export const AS_TOOL = whoOf("cli", "claude-code")
/** The agent whose own tool runs now (its chat or summoned session's, by key): AS_TOOL is any agent's vau too. */
const itsTool = new AsyncLocalStorage<string>()
/** Run `fn` as agent `name`'s own tool call, as toolsFor does (the tests' way to act as the companion). */
export const asItsTool = <T>(fn: () => T, name = ownName()) => itsTool.run(key(name), fn)
/** Whether a call as agent `name` is its own: its tool's, its session's terminal's (a Codex or OpenCode companion's vau)
 *  or the user's in the app; not another agent's vau, nor a script's, which may name it all the same. */
export function itsOwn(name: string, ctx: OpCtx) {
  if (itsTool.getStore() === key(name) || ctx.who.client?.startsWith("app/")) return true
  const w = requestWriter.getStore(), from = [w?.terminal, w?.session].filter(Boolean)
  return from.length > 0 && sessions().some((s) => from.includes(s.id) && key(s.name) === key(name))
}
/** The API as excerpts reads notes with, for a chat session's moments. */
export const apiCtx = { api: (method: string, route: string, body?: unknown) => plugin.host.api(method, route, body) } as unknown as OpCtx
/** An ops context for work the app does itself, as request `from` would (live edits, a proof's Keep). */
export const liveCtx = (from?: IncomingMessage) => ({ ...apiCtx, op: async (id: string, p?: Record<string, unknown>) => (await plugin.runOp(id, p ?? {}, undefined, from)).result }) as unknown as OpCtx

/** Agent `name`'s tools, each op's parameters (but `as`, which is it) and words (but its vau examples). */
export function toolsFor(name: string, list = TOOLS): ChatTool[] {
  return list.flatMap((short) => {
    const op = plugin.ops.find((o) => o.id === `companion.${short}`)
    if (!op) return []
    const params = Object.entries(op.params ?? {}).filter(([k]) => k !== "as")
    const properties = Object.fromEntries(params.map(([k, p]) => {
      const { required: _r, env: _e, format: _f, ...s } = p as Record<string, unknown>
      return [k, s]
    }))
    const description = [op.summary, ...(op.help ?? "").split("\n").filter((l) => !/^\s*vau /.test(l) && !/^\s+[{[]/.test(l))].join("\n").replace(/\n{3,}/g, "\n\n").trim()
    const ends = ENDS.has(short) && !LAST.has(short)
    if (ends) properties.done = DONE
    return [{ name: short, description, schema: { properties, required: params.filter(([, p]) => p.required).map(([k]) => k) },
      ...(STREAMS.has(short) ? { streams: true, stream: (use: string, json: string, end?: "done" | "stop") => streamed(name, short as Streaming, use, json, end) } : {}),
      ...(ENDS.has(short) ? { ends: true } : {}),
      run: async (args: unknown, use?: string) => {
        const { done, ...given } = (args && typeof args === "object" ? args : {}) as Record<string, unknown>
        try {
          const r = await toolUse.run(use, () => asItsTool(() => plugin.host.call(op.id, { ...given, ...(isMain(name) ? {} : { as: name }) }, AS_TOOL, { report: `companion ${short}` }), name))
          // (what it answered, ids and all, for the talk a fresh session is told: "the one you just opened")
          if (!QUIET_RESULTS.has(short) && r.text) did(name, "result", undefined, `${short}: ${String(r.text).slice(0, 400)}`)
          // (not its last call: its turn goes on, and its cursor shows it busy, a bubble or not, until it ends)
          if (ends && done !== true && turning.has(key(name)) && !inSummoned.getStore()) restate(name, () => atWork.add(key(name)))
          return { content: [{ type: "text", text: r.text }], ...((ends && done === true) || LAST.has(short) ? { endsTurn: true } : {}) }
        } catch (e) {
          did(name, "result", undefined, `${short} failed: ${(e as Error).message.slice(0, 300)}`)
          return { isError: true, content: [{ type: "text", text: (e as Error).message }] }
        }
        finally { if (use) streamDone(use) }
      } }]
  })
}

/** How agent `name`'s chat session runs: in the vault, its account (claude_work: work), model and effort, told it's
 *  the companion, out of the inbox, with its tools. */
export function chatOptions(name: string, how: { runs?: string; agent?: string; model?: string; effort?: string }): ChatHow {
  const runs = how.runs || how.agent || "claude"
  return { cwd: plugin.vault.path, account: runs.split("_")[1] || undefined, model: how.model || undefined, effort: how.effort || undefined,
    append: promptFor(name, true), title: isMain(name) ? "Companion" : `Companion: ${name}`, by: "companion", inbox: false, allowed: ALLOWED,
    // (its tools, not the commands the docs show: those go through a server that may be restarting)
    denied: ["Bash(vau companion:*)"], tools: toolsFor(name) }
}
