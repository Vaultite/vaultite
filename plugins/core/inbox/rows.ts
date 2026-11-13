import crypto from "node:crypto"
import type { Asking, Question } from "../../../core/agents.ts"
import { type Item, str } from "../../../core/vault.ts"
import { BLOCKED, clip, type InboxEvent, previewOf, questionLine, questionsText } from "./model.ts"
import type { Verdict } from "./needs.ts"

/** A change of an app terminal's state, as Terminal tells it (the service "inbox:state"; Terminal's StateChange): `was`
 *  the state it told before, `from` "shell" its program gone back to its shell (quit, crashed, interrupted). */
export type StateChange = { terminal: string; agent: string; state: "idle" | "working" | "blocked" | "done" | "error"
  kind?: string; msg?: string; from: "osc7501" | "hooks" | "screen" | "agent" | "backend" | "shell"; was?: string; at: number }

export type Heard = Omit<StateChange, "terminal" | "at"> & { terminal?: string; session?: string; cwd?: string; text?: string; prompt?: string
  own?: boolean
  questions?: Question[]; title?: string
  thread?: string }

export type Who = { agent: string; terminal: string; session: string; host?: boolean; thread?: string }

/** An agent's last turn as its plugin reads it (the service "agent-turn:<agent>"). `auto`: the session started the turn
 *  itself (its task's notice, a schedule); `title`: the session's own name, for an agent that doesn't title its terminal. */
export type Last = { session: string; prompt: string; text: string; at: number; final: boolean; auto?: boolean; title?: string }

/** Where a session stands among delegated tasks (the service "delegate:lineage"). */
export type Lineage = { parent: { agent: string; terminal?: string; session?: string; task: string } | null; consumes: boolean; waits: number }

export const NEEDS: Record<string, string> = { permission: "asks permission", question: "asks", auth: "sign in", plan: "plan", reply: "asks you", answer: "answered", report: "report", error: "failed" }
const ASKING: Record<string, string> = { permission: "Asks permission", question: "Asks you something", auth: "Needs you to sign in", plan: "A plan to approve" }

export const keyOf = (h: Pick<Heard, "terminal" | "session">) => h.terminal || (h.session ? `session:${h.session}` : "")

export function heardWho(h: Heard): Who {
  const who: Who = { agent: h.agent, terminal: h.terminal ?? "", session: h.session ?? "" }
  if (h.from === "agent" && !h.terminal) who.host = true
  if (h.thread) who.thread = h.thread
  return who
}

/** Claude Code's hook JSON or Codex's notify as a change, or null when it isn't news. */
export function fromHook(j: Item): Omit<Heard, "agent" | "from"> | null {
  const hook = str(j.hook_event_name)
  const session = clip(j.session_id ?? j["thread-id"] ?? j.thread_id ?? j.sessionID, 120)
  const message = clip(j.message, 300)
  const said = j.last_assistant_message ?? j["last-assistant-message"]
  const inputs: unknown = j["input-messages"]
  const asked = Array.isArray(inputs) ? inputs.at(-1) : undefined
  const turn = { ...(typeof said === "string" ? { text: said.trim() } : {}), ...(typeof asked === "string" ? { prompt: asked } : {}) }
  const where = { ...(session ? { session } : {}), ...(str(j.cwd) ? { cwd: str(j.cwd) } : {}) }
  const asks = (): Pick<Heard, "kind" | "msg"> => {
    const input: Item = j.tool_input ?? {}
    const question = Array.isArray(input.questions) ? clip(input.questions[0]?.question, 200) : ""
    const kind = j.notification_type === "permission_prompt" ? "permission" : j.tool_name === "ExitPlanMode" ? "plan" : "question"
    const msg = message || (question ? `Asks: ${question}` : j.tool_name === "ExitPlanMode" ? "A plan to approve" : j.tool_name ? `Wants to use ${clip(j.tool_name, 40)}` : "")
    return { kind, ...(msg ? { msg } : {}) }
  }
  if (hook === "Stop" || j.type === "agent-turn-complete") return { state: "done", own: true, ...where, ...turn }
  // Claude Code notifies a minute at its prompt as idle_prompt; its Stop already said the turn ended.
  if (hook === "Notification") return j.notification_type === "idle_prompt" || /waiting for your input/i.test(message) ? null : { state: "blocked", own: true, ...where, ...asks() }
  if (hook === "UserPromptSubmit") return { state: "working", own: true, ...where }
  return null
}

export type Seen = { state: string; kind?: string; msg?: string; since: number }

export type Act =
  | { do: "repeat" }
  | { do: "nothing" }
  | { do: "working"; resolve: "user" | "answer" | null }
  | { do: "ask" }
  | { do: "refused" }
  | { do: "turn"; since: number }

const repeats = (was: Seen, h: Heard) =>
  !h.own && !!h.terminal && was.state === h.state && was.kind === h.kind && was.msg === h.msg

function actOf(h: Heard, prev: string | undefined, since: number): Act {
  if (h.state === "working") return { do: "working", resolve: h.own ? "user" : prev === "blocked" ? "answer" : null }
  if (h.state === "blocked") return { do: "ask" }
  if (prev === "blocked" && h.state !== "error" && !h.own) return { do: "refused" }
  return prev === "working" || h.own ? { do: "turn", since } : { do: "nothing" }
}

export type Hearing = { seen: Seen; act: Act }

export function hear(was: Seen | undefined, h: Heard, now: number): Hearing {
  if (was && repeats(was, h)) return { seen: was, act: { do: "repeat" } }
  const since = h.state === "working" && was?.state !== "working" ? now : was?.since ?? now
  return { seen: { state: h.state, kind: h.kind, msg: h.msg, since }, act: actOf(h, was?.state ?? h.was, since) }
}

export const askOf = (kind?: string) => (BLOCKED.has(str(kind)) ? str(kind) : "question")

export function askedRow(asking: Asking | null, said: string, msg?: string): Partial<InboxEvent> {
  const ask = asking?.kind ?? said
  return { state: "open", ask, read: false, link: undefined, questions: asking?.kind === "question" ? asking.questions : undefined,
    body: asking?.kind === "question" ? questionsText(asking.questions) : asking?.kind === "plan" ? asking.plan : msg || ASKING[ask] }
}

export const wantsLast = (h: Heard) => h.text === undefined || h.prompt === undefined

/** null: Codex says it works while it starts up, then idle with no session to read. */
export function wordsOf(h: Heard, last: Last | null): { text: string; prompt?: string; auto: boolean } | null {
  if (!last && h.from === "osc7501" && h.state === "idle" && h.text === undefined && h.prompt === undefined) return null
  return { text: (h.text ?? last?.text ?? h.msg ?? "").trim(), prompt: h.prompt ?? last?.prompt, auto: !!last?.auto && h.prompt === undefined }
}

export const reportedSince = (row: InboxEvent | undefined, since: number) => row?.ask === "report" && row.state !== "working" && row.t >= since - 2000

const BODY = 8000
export const bodyOf = (text: string) => (text ? (text.length > BODY ? `${text.slice(0, BODY)}\n\n…` : text) : undefined)

export const turnOf = (prompt?: string) => (prompt?.trim() ? crypto.createHash("sha1").update(prompt.trim()).digest("hex").slice(0, 12) : undefined)

export const delegated = (line: Lineage | null): line is Lineage => !!(line?.consumes || line?.waits)

export const delegatedRow = (line: Lineage, error: boolean, body: string | undefined, prompt?: string): Partial<InboxEvent> => ({
  state: line.consumes ? "done" : "working", ask: line.consumes && error ? "error" : undefined, body, read: true, questions: undefined,
  turn: line.consumes ? undefined : turnOf(prompt) })

export const stillOpen = (e: Pick<InboxEvent, "state" | "ask" | "turn">, turn?: string) =>
  e.state === "open" && !BLOCKED.has(str(e.ask)) && (e.ask === "report" || !turn || !e.turn || turn === e.turn)

export type Change = { patch: Partial<InboxEvent>; news: boolean }

export function afterTurn(row: InboxEvent | undefined, v: Verdict, t: { body?: string; prompt?: string; auto: boolean; quietAnswers: boolean }): Change | null {
  const { body } = t, turn = turnOf(t.prompt)
  if (v.needs && v.why === "answer" && t.quietAnswers) return { patch: { state: "done", ask: "answer", body, read: false, link: undefined, questions: undefined, turn: undefined }, news: false }
  if (v.needs) return { patch: { state: "open", ask: v.why, body, read: false, link: undefined, questions: undefined, turn }, news: true }
  const stays = row && (t.auto ? row.state === "open" && !BLOCKED.has(str(row.ask)) : stillOpen(row, turn))
  return stays ? null : { patch: { state: "done", ask: undefined, body, read: true, questions: undefined, turn: undefined }, news: false }
}

export const rowOf = (k: Who) => (e: InboxEvent) => !e.gate && !e.machine && e.source === k.agent &&
  ((!!k.thread && e.id === k.thread) || (!k.thread && ((!!k.session && e.session === k.session) || (!!k.terminal && e.terminal === k.terminal))))

export function rowWith(old: InboxEvent | null, patch: Partial<InboxEvent>, k: Who,
  at: { id: string; t: number; title: string; fallback: string; parent?: InboxEvent["parent"] }): InboxEvent {
  const e: InboxEvent = { ...(old ?? { id: at.id, state: "working" }), t: at.t, source: k.agent, kind: "session", title: at.title || old?.title || at.fallback, ...patch }
  if (k.terminal) e.terminal = k.terminal
  if (k.session) e.session = k.session
  if (k.host) e.host = true
  if (at.parent) e.parent = at.parent
  e.preview = e.questions ? questionLine(e.questions) : e.body ? previewOf(e.body) : undefined
  for (const [f, v] of Object.entries(e)) if (v === undefined) Reflect.deleteProperty(e, f)
  return e
}
