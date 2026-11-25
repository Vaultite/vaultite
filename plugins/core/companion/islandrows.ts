import path from "node:path"
import { z } from "zod"
import { awaitsText } from "../../../core/attention.ts"
import type { PresenceAsk, TermRow } from "../../../core/desktop/knocks.ts"
import type { Plugin } from "../../../core/plugins.ts"
import { type Job, terminalOf } from "./jobs.ts"

const opt = <T extends z.ZodType>(s: T) => s.optional().catch(undefined)
const Chat = z.object({ id: z.string(), state: z.string(), asks: z.array(z.string()).catch([]), at: opt(z.number()), cwd: opt(z.string()), title: opt(z.string()), quiet: opt(z.boolean()), error: opt(z.string()),
  turn: opt(z.object({ prompt: opt(z.string()), text: opt(z.string()) })), awaits: opt(z.object({ on: z.string(), since: z.number(), n: z.number() })) })
export type Chat = z.infer<typeof Chat>
const Chats = z.object({ sessions: z.array(z.unknown()) })
const Asked = z.object({ k: z.literal("ask"), id: z.string(), kind: z.string(), title: z.string(), detail: opt(z.string()), input: opt(z.object({ command: opt(z.string()) })), plan: opt(z.string()), answer: opt(z.string()) })
const Talk = z.object({ entries: z.array(z.unknown()) })
const Captured = z.object({ text: z.string() })

const WHAT_MAX = 600
const firstLine = (s: string | undefined) => s?.trim().split("\n")[0]?.slice(0, 140) ?? ""
const askOf = (what: string, id?: string): PresenceAsk | undefined => (!what || what.length > WHAT_MAX ? undefined : id ? { what, id } : { what })

const RULE = /^\s*[╭┌]?[─━╌]{8,}/, QUESTION = /\b(?:Do you want to|Would you like to)\b/, OPTION = /^\s*(?:[❯›>]\s*)?1[.)]\s/
export function askedOn(screen: string) {
  const lines = screen.replace(/\s+$/, "").split("\n").map((l) => l.replace(/^\s*[│┃]|[│┃]\s*$/g, "").trimEnd())
  const q = lines.findLastIndex((l) => QUESTION.test(l))
  if (q < 0) return ""
  const option = lines.findIndex((l, i) => i > q && OPTION.test(l)), top = lines.slice(0, q).findLastIndex((l) => RULE.test(l))
  if (option < 0) return ""
  const box = top >= 0 && q - top <= 24 ? lines.slice(top + 1, q) : []
  const own = [...box, ...lines.slice(q + 1, option)].flatMap((l) => (l.trim() && !RULE.test(l) ? [l.trim()] : []))
  return own.join("\n") || lines[q].trim()
}

export function chatAsk(entries: unknown[], ids: string[]): PresenceAsk | undefined {
  const e = entries.flatMap((x) => Asked.safeParse(x).data ?? []).findLast((x) => ids.includes(x.id) && !x.answer)
  if (!e || e.kind === "question") return undefined
  if (e.kind === "plan") return askOf(e.plan?.trim() ?? "", e.id)
  const of = e.input?.command ?? e.detail ?? ""
  return askOf((e.title.includes(of) ? e.title : `${e.title}\n${of}`).trim(), e.id)
}

export function chatRow(c: Chat, o: { ask?: PresenceAsk; news?: boolean; job?: Job }): TermRow {
  const waits = c.state === "waiting" || c.asks.length > 0, awaits = c.state === "idle" ? c.awaits : undefined
  const state = waits ? "blocked" : c.state === "working" || c.state === "starting" || awaits ? "working" : c.state === "error" ? "error" : "done"
  const step = waits ? o.ask?.what ?? "Waiting for your answer" : awaits ? awaitsText(awaits) : firstLine(state === "error" ? c.error : state === "done" ? c.turn?.text : c.turn?.prompt)
  const row: TermRow = { id: `chat:${c.id}`, source: "chat", agent: "claude", state, name: o.job?.title ?? (c.title || firstLine(c.turn?.prompt) || path.basename(c.cwd ?? "") || "Chat") }
  if (step) row.msg = step
  if (c.at) row.at = c.at
  if (o.ask) row.ask = o.ask
  if (o.news || o.job?.state === "ready for review") row.needs = true
  if (o.job) row.job = o.job.id
  return row
}

const JOB: Partial<Record<Job["state"], string>> = { starting: "working", working: "working", "needs you": "blocked", "ready for review": "done", done: "done", failed: "error" }
export function jobRows(jobs: Job[], at: (j: Job) => string, listed: TermRow[]): TermRow[] {
  const shown = new Set(listed.flatMap((r) => (r.job ? [r.id, r.job] : [r.id])))
  return jobs.flatMap((j) => {
    const state = JOB[j.state], id = at(j) || `job:${j.id}`
    if (!state || j.unreachable || (j.state === "ready for review" && j.seen) || shown.has(id) || shown.has(j.id)) return []
    const row: TermRow = { id, source: "job", agent: j.where.agent || "claude", state, name: j.title, job: j.id, at: j.at, machineLabel: j.where.label }
    if (j.state === "ready for review") row.review = true
    const step = j.state === "needs you" ? j.waits?.question : j.now || j.result?.text
    if (step) row.msg = firstLine(step)
    return [row]
  })
}

export function islandRows(plugin: Plugin, jobs: () => Job[]) {
  let chats: TermRow[] = []

  async function chatOf(c: Chat): Promise<TermRow> {
    const bare = c.id.split("@")[0], job = jobs().find((j) => j.session === bare)
    const talk = c.asks.length ? await plugin.runOp("claude-code.chat-read", { id: c.id, limit: 60 }).then((r) => Talk.safeParse(r.result).data, () => undefined) : undefined
    const news = c.state === "idle" && await plugin.ask<boolean>("inbox:needs", false, "", bare)
    return chatRow(c, { job, news, ask: talk && chatAsk(talk.entries, c.asks) })
  }

  async function readChats() {
    const r = await plugin.runOp("claude-code.chat-list", { machine: "all" }).catch(() => null)
    const listed = Chats.safeParse(r?.result).data?.sessions.flatMap((s) => Chat.safeParse(s).data ?? []) ?? []
    chats = await Promise.all(listed.filter((c) => !c.quiet).map(chatOf))
  }

  async function asking(r: TermRow): Promise<TermRow> {
    if (r.state !== "blocked" || r.kind !== "permission" || !r.agent) return r
    const c = await plugin.runOp("terminal.capture", { id: r.id, lines: 40 }).then((x) => Captured.safeParse(x.result).data, () => undefined)
    const what = c ? askedOn(c.text) || r.msg || "" : "", ask = askOf(what.trim())
    return ask ? { ...r, msg: ask.what, ask } : r
  }

  return { readChats, asking, chats: () => chats, jobs: (listed: TermRow[], local: (id: string) => string) => jobRows(jobs(), (j) => local(terminalOf(j)), listed) }
}
