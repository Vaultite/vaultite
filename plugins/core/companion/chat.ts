import { AsyncLocalStorage } from "node:async_hooks"
import type { IncomingMessage } from "node:http"
import { z } from "zod"
import { type OpCtx, whoOf } from "../../../core/plugins.ts"
import { requestWriter } from "../../../core/vault.ts"
import { ALLOW, sessions, promptFor } from "./alwayson.ts"
import { plugin } from "./self.ts"
import { ownName } from "./settings.ts"
import { atWork, did, key, isMain, restate } from "./state.ts"
import { toolUse, type Streaming, streamed, streamDone } from "./edits.ts"
import { turning } from "./chatturns.ts"
import { inSummoned } from "./summoned.ts"
import { messageOf } from "./errors.ts"

export type ChatTool = { name: string; description: string; schema: { properties?: Record<string, object>; required?: string[] }; run: (args: unknown, use?: string) => Promise<unknown>
  streams?: boolean; ends?: boolean; hidden?: boolean; stream?: (use: string, json: string, end?: "done" | "stop") => void }
export type ChatHow = { cwd?: string; account?: string; model?: string; effort?: string; append?: string; title?: string; by?: string; inbox?: boolean; allowed?: string[]; denied?: string[]; dirs?: string[]; tools?: ChatTool[]
  mode?: "default" | "acceptEdits" | "plan" | "auto" | "dontAsk" | "bypassPermissions"
  confirm?: string; never?: string[]; autoMode?: Record<string, string[]>
  images?: string[]; quick?: boolean
  system?: string; builtins?: string[]; onText?: (use: string, text: string, end?: "done" | "stop" | "tool") => void }
export type ChatState = { id: string; state: "starting" | "working" | "waiting" | "idle" | "error"; error?: string; seq?: number; turn?: { text: string } | null
  context?: number }
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
const Fn = z.custom((v) => typeof v === "function")
const ChatApi = z.object({ start: Fn, send: Fn, stop: Fn, interrupt: Fn, list: Fn, touch: Fn, serve: Fn, on: Fn, asking: Fn })
const isChat = (v: unknown): v is Chat => ChatApi.safeParse(v).success
export const chat = () => { const c: unknown = plugin.peer("claude-code")?.exports.chat; return isChat(c) ? c : null }
export const onChat = (agent: string) => agent.split("_")[0] === "claude"
export const TOOLS = ["say", "pass", "comment", "suggest", "propose", "edit", "look", "highlight", "draw", "layer", "see", "act", "check", "follow", "unfollow", "keep", "clear", "history", "status", "handover", "handoff", "where", "open", "page", "jobs", "job", "job-open", "job-stop", "job-answer", "job-show", "talk", "conversation", "tour", "tour-save"]
const QUIET_RESULTS = new Set(["see", "check", "history", "status", "conversation", "say", "pass", "look", "highlight"])
const DONE = { type: "boolean", description: "true on your last call for this moment: your turn ends with it" } as const
const STREAMS = ["say", "comment", "edit", "draw"] as const satisfies readonly Streaming[], ENDS = new Set(["say", "pass", "comment", "suggest", "propose", "edit", "look", "highlight", "draw", "layer", "act", "follow", "unfollow", "keep", "clear", "handover", "handoff", "open", "page", "job", "job-open", "job-stop", "job-answer", "job-show", "tour"])
const LAST = new Set(["pass", "handover", "handoff"])
export const ALLOWED = ["mcp__vaultite-app", ...ALLOW.filter((c) => c !== "vau companion").map((c) => `Bash(${c}:*)`)]
export const AS_TOOL = whoOf("cli", "claude-code")
const itsTool = new AsyncLocalStorage<string>()
export const asItsTool = <T>(fn: () => T, name = ownName()) => itsTool.run(key(name), fn)
export function itsOwn(name: string, ctx: OpCtx) {
  if (itsTool.getStore() === key(name) || ctx.who.client?.startsWith("app/")) return true
  const w = requestWriter.getStore(), from = [w?.terminal, w?.session].filter(Boolean)
  return from.length > 0 && sessions().some((s) => from.includes(s.id) && key(s.name) === key(name))
}
export const apiCtx = plugin.ctx()
export const liveCtx = (from?: IncomingMessage) => plugin.ctx({ http: from })

const ToolArgs = z.looseObject({ done: z.unknown().optional() }).catch({})
export function toolsFor(name: string, list = TOOLS): ChatTool[] {
  return list.flatMap((short) => {
    const op = plugin.ops.find((o) => o.id === `companion.${short}`)
    if (!op) return []
    const params = Object.entries(op.params ?? {}).filter(([k]) => k !== "as")
    const properties = Object.fromEntries(params.map(([k, p]) => {
      const { required: _r, env: _e, format: _f, ...s } = p
      return [k, s]
    }))
    const description = [op.summary, ...(op.help ?? "").split("\n").filter((l) => !/^\s*vau /.test(l) && !/^\s+[{[]/.test(l))].join("\n").replace(/\n{3,}/g, "\n\n").trim()
    const ends = ENDS.has(short) && !LAST.has(short), streams = STREAMS.find((x) => x === short)
    if (ends) properties.done = DONE
    return [{ name: short, description, schema: { properties, required: params.filter(([, p]) => p.required).map(([k]) => k) },
      ...(streams ? { streams: true, stream: (use: string, json: string, end?: "done" | "stop") => streamed(name, streams, use, json, end) } : {}),
      ...(ENDS.has(short) ? { ends: true } : {}),
      run: async (args: unknown, use?: string) => {
        const { done, ...given } = ToolArgs.parse(args)
        try {
          const r = await toolUse.run(use, () => asItsTool(() => plugin.host.call(op.id, { ...given, ...(isMain(name) ? {} : { as: name }) }, AS_TOOL, { report: `companion ${short}` }), name))
          if (!QUIET_RESULTS.has(short) && r.text) did(name, "result", undefined, `${short}: ${String(r.text).slice(0, 400)}`)
          if (ends && done !== true && turning.has(key(name)) && !inSummoned.getStore()) restate(name, () => atWork.add(key(name)))
          return { content: [{ type: "text", text: r.text }], ...((ends && done === true) || LAST.has(short) ? { endsTurn: true } : {}) }
        } catch (e) {
          did(name, "result", undefined, `${short} failed: ${messageOf(e).slice(0, 300)}`)
          return { isError: true, content: [{ type: "text", text: messageOf(e) }] }
        }
        finally { if (use) streamDone(use) }
      } }]
  })
}

export function chatOptions(name: string, how: { runs?: string; agent?: string; model?: string; effort?: string }): ChatHow {
  const runs = how.runs || how.agent || "claude"
  return { cwd: plugin.vault.path, account: runs.split("_")[1] || undefined, model: how.model || undefined, effort: how.effort || undefined,
    append: promptFor(name, true), title: isMain(name) ? "Companion" : `Companion: ${name}`, by: "companion", inbox: false, allowed: ALLOWED,
    denied: ["Bash(vau companion:*)"], tools: toolsFor(name) }
}
