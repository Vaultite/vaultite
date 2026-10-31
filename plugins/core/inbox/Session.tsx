// An agent's session in the inbox, opened like a mail: what it asks or its last answer, Approve and Deny, the reply back
// into it (on its machine). Opening it reads it; only Done (or the session moving on) settles it.
import { useEffect } from "react"
import { Bot, Check, CheckCheck, RotateCcw, SquareTerminal, X } from "lucide-react"
import { backDetail, Button, detailPath, Empty, fmtAgo, haptic, Markdown, notify, notifyError, openDetail, SheetHead, useAgents } from "@vaultite"
import { agentOf, answerable, answerAsk, getEvents, markEventsDone, markRead, openSession, SESSION_DETAIL, useEvents } from "./events"
import { Questions } from "./Questions"
import { ReplyBox } from "./Reply"
import type { InboxEvent } from "./types"

/** Why a session needs the user, as its sheet says it. */
const WHY: Record<string, string> = {
  permission: "Asks permission", question: "Asks you something", auth: "Needs you to sign in", plan: "Has a plan for you to approve",
  answer: "Answered", report: "Reported", error: "Stopped with an error",
}

/** What an agent asks before it goes on: answered in its terminal (or Approve and Deny), not by a reply. */
const BLOCKED = ["permission", "question", "auth", "plan"]

export const sessionTitle = (id: string) => getEvents().events.find((e) => e.id === id)?.title ?? "Session"

const answer = (e: InboxEvent, a: "approve" | "deny") => (haptic("medium"), answerAsk(e, a)).then(
  () => notify(a === "approve" ? "Approved" : "Denied"), (err) => notifyError(err, "Couldn't answer it"))

/** Whether thread `x` is session `p` (by its terminal, else its session id). */
const isSession = (p: { terminal?: string; session?: string }, x: InboxEvent) => x.kind === "session" && !x.machine &&
  ((!!p.terminal && x.terminal === p.terminal) || (!!p.session && x.session === p.session))
const STATE: Record<string, string> = { open: "Needs you", working: "Working", done: "Done" }

/** Who delegated this session its task (its thread, else its session), and the subagents it delegated to. */
function Lineage({ e }: { e: InboxEvent }) {
  const { events } = useEvents()
  const agents = useAgents()
  const from = e.parent ? events.find((x) => x.id !== e.id && isSession(e.parent!, x)) : undefined
  const kids = events.filter((x) => x.id !== e.id && x.parent && isSession(x.parent, e))
  if (!e.parent && !kids.length) return null
  const toParent = () => {
    if (from) return openDetail(detailPath(SESSION_DETAIL, from.id))
    void openSession({ terminal: e.parent!.terminal, session: e.parent!.session, agent: e.parent!.agent, host: !e.parent!.terminal }).catch((err) => notifyError(err, "Couldn't open it"))
  }
  return (
    <div className="mb-5 flex flex-col gap-3" data-lineage>
      {e.parent && (
        <p className="text-[13px] text-muted-foreground max-md:text-[15px]">
          Delegated by <button type="button" data-lineage-parent className="cursor-pointer font-medium text-foreground/80 underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground/60" onClick={toParent}>{from?.title ?? e.parent.title}</button>
        </p>
      )}
      {kids.length > 0 && (
        <section>
          <h3 className="mb-1 text-[13px] font-medium text-muted-foreground max-md:text-[15px]">Subagents</h3>
          <div className="-mx-2 flex flex-col">
            {kids.map((k) => {
              const a = agentOf(k, agents), Icon = a?.icon ?? Bot
              return (
                <button key={k.id} type="button" data-lineage-child={k.id} onClick={() => openDetail(detailPath(SESSION_DETAIL, k.id))}
                  className="flex min-h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2 text-left hover:bg-foreground/[0.04] max-md:min-h-11">
                  <Icon className="size-4 shrink-0" style={{ color: a?.tint }} />
                  <span className="min-w-0 flex-1 truncate text-[14px] max-md:text-[17px]">{k.title}</span>
                  <span className={k.state === "open" ? "shrink-0 text-[13px] font-medium text-foreground/80" : "shrink-0 text-[13px] text-muted-foreground"}>{STATE[k.state]}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

export function SessionSheet({ id }: { id: string }) {
  const e = useEvents().events.find((x) => x.id === id)
  // (every render calls the same hooks: the event shows up once the inbox loads)
  const agents = useAgents()
  const agent = e ? agentOf(e, agents) : null
  // Opened is read, as a mail is; a permission still waits on its answer.
  useEffect(() => { if (e && !e.read && !answerable(e)) markRead([e.id]) }, [e?.id, e?.t]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!e) return <Empty>This session is no longer in the inbox.</Empty>
  const name = agent?.label ?? (e.source ? e.source[0].toUpperCase() + e.source.slice(1) : "the agent")
  const why = e.state === "working" ? "Working on it" : e.state === "done" ? "Done" : WHY[e.ask ?? ""] ?? "Needs you"
  const sub = [why, name, e.machineLabel && `on ${e.machineLabel}`, fmtAgo(e.t)].filter(Boolean).join(" · ")
  const asks = answerable(e)
  const blocked = e.state === "open" && BLOCKED.includes(e.ask ?? "")
  const done = (to: boolean) => {
    haptic("medium")
    void markEventsDone([e.id], to)
    // (dealt with: the sheet goes, as a mail archived does)
    if (to) backDetail()
    notify(to ? `Done: “${e.title}”` : `Back in the inbox: “${e.title}”`, { action: { label: "Undo", run: () => void markEventsDone([e.id], !to) } })
  }
  const open = () => openSession({ terminal: e.terminal, session: e.session, agent: e.source, machine: e.machine, host: e.host })
  return (
    <div data-session-sheet={e.id} data-ask={e.ask ?? ""}>
      <SheetHead icon={agent?.icon ?? Bot} tint={agent?.tint ?? "var(--inbox)"} kicker="Inbox" title={e.title} sub={sub}>
        {/* (what needs you stays until it's dealt with: settled here, by the title, apart from the sheet bar's Done) */}
        {!asks && (
          <div className="mt-3 flex">
            {e.state === "done"
              ? <Button className="h-11 px-3 md:h-8" data-session-done="undo" onClick={() => done(false)}><RotateCcw className="size-4" /> Back to inbox</Button>
              : <Button className="h-11 px-3 md:h-8" data-session-done onClick={() => done(true)}><CheckCheck className="size-4" /> Done with this</Button>}
          </div>
        )}
      </SheetHead>
      <Lineage e={e} />
      {e.questions && blocked
        ? <Questions e={{ ...e, questions: e.questions }} />
        : e.body
        ? <Markdown text={e.body} className="mb-5 break-words" />
        : <Empty>{e.state === "done" ? "It finished with nothing to say." : "It said nothing more."}</Empty>}
      {asks && (
        <div className="mb-5 flex gap-2">
          <Button look="primary" className="h-11 px-4 md:h-8" data-gate="approve" onClick={() => void answer(e, "approve")}><Check className="size-4" /> Approve</Button>
          <Button className="h-11 px-4 md:h-8" data-gate="deny" onClick={() => void answer(e, "deny")}><X className="size-4" /> Deny</Button>
        </div>
      )}
      {/* (while it asks, a reply would be typed into its question: it's answered there, or with Approve and Deny; its
          own questions take a reply as their answer) */}
      {blocked && !e.questions
        ? <Button look="quiet" className="h-11 px-3 md:h-8" onClick={() => void open().catch((err) => notifyError(err, "Couldn't open it"))}><SquareTerminal className="size-4" /> Open session</Button>
        : <ReplyBox to={e.id} name={name} open={open} sent={() => markRead([e.id])} back={() => openDetail(detailPath(SESSION_DETAIL, e.id))}
          placeholder={!e.questions ? undefined : e.questions.length === 1 && !e.questions[0].multi ? "Or answer in your own words" : "Or tell it something else instead"} />}
    </div>
  )
}
