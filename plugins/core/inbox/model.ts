import { type Question } from "../../../core/agents.ts"
import { str } from "../../../core/vault.ts"
import { isMessage } from "./threads.ts"

/** Where an event stands for the user: open (in the inbox: a session or an ask needs them, a message is to read),
 *  working (they answered, its agent is on it) or done (dealt with: kept keep_days, under Done). */
export type State = "open" | "working" | "done"
const STATES: State[] = ["open", "working", "done"]

export type InboxEvent = {
  id: string; t: number
  /** Who: a coding agent's name (claude, codex), or anything that posts ("vau", "backup"). */
  source: string
  /** What: session (a coding agent's session, one thread each), waiting (something asks the user: a permission the
   *  server waits on, a browser's ask, a paused plugin), else a message (info, error, done...: news to read). */
  kind: string
  state: State
  title: string; body?: string
  /** What a click opens: a vault path, a view ("view:terminal/<id>"), a sheet ("detail:review") or a web address. A
   *  session's report (Inbox/<Title>.md) is its record: the thread is listed in its place. */
  link?: string
  /** One of a kind: a new event with its source and key takes the place of the one before (Lessons' "cards due"). */
  key?: string
  /** The app's terminal it happened in, and the agent's session: a click goes there. */
  terminal?: string; session?: string
  /** Its host tells its state and answers it (inbox:session; agent-reply, agent-answer), not a terminal. */
  host?: boolean
  /** Why a session needs the user (needs.ts' Need): permission (to run a tool: Approve and Deny answer it), question,
   *  auth, plan, answer (its last message is for them to read), report (an Inbox/ result: link), error. */
  ask?: string
  /** What a session asks, in its own words (its agent's "agent-asking"): picked from its sheet, or a reply. */
  questions?: Question[]
  /** Its body as one plain line, for what can't draw Markdown (the phone's widgets, the watch, push). */
  preview?: string
  /** The user's last message in the turn that opened it (its start): a quiet turn after another of theirs closes it. */
  turn?: string
  /** When it last told the user (a toast, the Mac's and the phone's notifications): set only when it may, so every app
   *  announces the same news once. */
  nt?: number
  /** A permission the server itself waits on (not a terminal's: the service "inbox:ask", e.g. an app connected to the
   *  MCP asking to run what can run code here), and once answered, the answer. */
  gate?: boolean
  answer?: "approve" | "deny"
  /** Seen: drawn plain rather than bold. Only a message is dealt with by it (done once read). */
  read?: boolean
  /** Marked unread by hand: the Inbox seen doesn't read it, only opening it or marking it read. */
  kept?: boolean
  /** Another machine's (Machines): its id there is `<id>@<machine>` here, its terminal too. */
  machine?: string; machineLabel?: string
  /** Snoozed until then (ms): out of the lists till it comes back unread, on top, told again. News from its session
   *  wakes it. */
  snoozed?: number
  /** Pinned by the user: on top of the inbox whatever it waits on, until it's done or unpinned. */
  pinned?: boolean
  stays?: boolean
  /** The session that delegated this one its task (Delegation), by its name then: the thread says "from" it. */
  parent?: { title: string; agent: string; terminal?: string; session?: string }
  /** The session that asked (a gate's, a waiting ask's made in its request), by its name then: "Go to session" opens it. */
  from?: { title: string; agent: string; terminal?: string; session?: string }
  /** Its latest progress line (inbox.progress), each replacing the last: on its row, never told. */
  progress?: string
}

export function byThread(es: InboxEvent[]): InboxEvent[] {
  const seen = new Set<string>()
  const out: InboxEvent[] = []
  for (const e of [...es].sort((a, b) => b.t - a.t)) {
    const thread = !e.gate && (e.kind === "done" || e.kind === "waiting") && (e.session || e.terminal)
    if (!thread) { out.push(e); continue }
    const k = `${e.source}\0${e.session || e.terminal}`
    if (seen.has(k)) continue
    seen.add(k)
    const reported = /^[^:]{1,40}: (.+)$/.exec(e.link ? e.title : "")
    const turn = / (finished|is waiting for you)$/.test(e.title)
    out.push({ ...e, title: reported ? reported[1] : turn && e.kind === "done" && e.body ? e.body : e.title,
      ...(reported ? { ask: "report" } : turn && e.kind === "done" ? { body: undefined } : {}) })
  }
  return out
}

export function asThreads(es: InboxEvent[]): InboxEvent[] {
  return es.map((e): InboxEvent => {
    if (STATES.includes(e.state)) return e
    const session = !e.gate && (e.kind === "waiting" || e.kind === "done") && !!(e.terminal || e.session) && !/^https?:/.test(e.session ?? "")
    const open = e.gate ? !e.answer : !!e.snoozed || (!e.read && !(session && e.kind === "done"))
    const { kept, ...rest } = e
    return { ...rest, kind: session ? "session" : e.kind, state: open ? "open" : "done", ...(open && kept ? { kept } : {}) }
  })
}

export const previewOf = (md: string) => md.replace(/```[\s\S]*?```/g, " ").replace(/!?\[\[([^\]|]*)(\|[^\]]*)?\]\]/g, "$1").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/^\s*(#+|>|[-*+]|\d+\.)\s+/gm, "").replace(/[*_`~]+/g, "").replace(/\s+/g, " ").trim().slice(0, 300)

export const readThere = (e: InboxEvent): InboxEvent => {
  const { kept: _, ...rest } = e
  return { ...rest, read: true, ...(isMessage(e) && e.state === "open" && !e.pinned ? { state: "done" as const } : {}) }
}
export const unreadThere = (e: InboxEvent): InboxEvent => {
  const { snoozed: _, ...rest } = e
  return { ...rest, read: false, kept: true, ...(isMessage(e) && !e.gate ? { state: "open" as const } : {}) }
}
export const doneAs = (e: InboxEvent, done: boolean): InboxEvent => {
  if (!done) return e.state === "done" ? { ...e, state: "open" } : e
  const { snoozed: _, kept: __, questions: ___, pinned: ____, ...rest } = e
  return { ...rest, state: "done", read: true }
}

export const BLOCKED = new Set(["permission", "question", "auth", "plan"])

export const clip = (v: unknown, n = Infinity) => str(v).replace(/\s+/g, " ").trim().slice(0, n)
export const TERMINAL = /^[\w-]{1,64}(@[a-z0-9][a-z0-9-]{0,62})?$/

export function pinnedAs(e: InboxEvent, on: boolean): InboxEvent {
  if (on) return e.state === "done" ? e : { ...e, pinned: true }
  const { pinned: _, ...rest } = e
  return isMessage(e) && !e.gate && e.read && e.state === "open" ? { ...rest, state: "done" } : rest
}

export function snoozedAs(e: InboxEvent, until: number | null): InboxEvent | null {
  if (e.gate || e.state === "done" || (until !== null && e.stays) || (until !== null && e.state === "open" && e.ask === "permission")) return null
  if (until !== null) return { ...e, snoozed: until }
  if (!e.snoozed) return null
  const { snoozed: _, ...rest } = e
  return { ...rest, state: "open", read: false, t: Date.now() }
}

const or = (xs: string[], word = "or") => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${word} ${xs.at(-1)}`)
export const questionsText = (qs: Question[]) => qs.map((q) => `${q.question}${q.multi ? " (any of them)" : ""}\n\n` +
  q.options.map((o, i) => `${i + 1}. **${o.label}**${o.description ? `: ${o.description}` : ""}`).join("\n")).join("\n\n")
export function questionLine(qs: Question[], lines = false) {
  const q = qs[0], more = qs.length > 1 ? ` (${qs.length - 1} more question${qs.length > 2 ? "s" : ""})` : ""
  const labels = q.options.map((o) => o.label)
  return lines ? `${q.question}${more}\n${labels.map((l, i) => `${i + 1}. ${l}`).join("\n")}` : `${q.question} ${or(labels, q.multi ? "and" : "or")}${more}`.slice(0, 300)
}
