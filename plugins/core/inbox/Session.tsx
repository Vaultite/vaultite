// An agent's session in the inbox, opened like a mail: what it asks or its last answer (Markdown), Approve and Deny for
// a permission, and the reply that goes back into it (on the machine it runs on). Opening it reads it.
import { useEffect } from "react"
import { Bot, Check, SquareTerminal, X } from "lucide-react"
import { Button, Empty, fmtAgo, haptic, Markdown, notify, notifyError, SheetHead, useAgents } from "@vaultite"
import { agentOf, answerable, answerAsk, getEvents, markRead, openSession, useEvents } from "./events"
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

export function SessionSheet({ id }: { id: string }) {
  const e = useEvents().events.find((x) => x.id === id)
  const agent = e ? agentOf(e, useAgents()) : null
  // Opened is read, as a mail is; a permission still waits on its answer.
  useEffect(() => { if (e && !e.read && !answerable(e)) markRead([e.id]) }, [e?.id, e?.t]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!e) return <Empty>This session is no longer in the inbox.</Empty>
  const name = agent?.label ?? (e.source ? e.source[0].toUpperCase() + e.source.slice(1) : "the agent")
  const why = e.kind === "waiting" ? WHY[e.ask ?? ""] : ""
  const sub = [why || "Done", name, e.machineLabel && `on ${e.machineLabel}`, fmtAgo(e.t)].filter(Boolean).join(" · ")
  const asks = answerable(e)
  const blocked = e.kind === "waiting" && BLOCKED.includes(e.ask ?? "")
  const open = () => openSession({ terminal: e.terminal, session: e.session, agent: e.source, machine: e.machine })
  return (
    <div data-session-sheet={e.id} data-ask={e.ask ?? ""}>
      <SheetHead icon={agent?.icon ?? Bot} tint={agent?.tint ?? "var(--inbox)"} kicker="Inbox" title={e.title} sub={sub} />
      {e.body
        ? <Markdown text={e.body} className="mb-5 break-words" />
        : <Empty>{e.kind === "done" ? "It finished with nothing to say." : "It said nothing more."}</Empty>}
      {asks && (
        <div className="mb-5 flex gap-2">
          <Button look="primary" className="h-11 px-4 md:h-8" data-gate="approve" onClick={() => void answer(e, "approve")}><Check className="size-4" /> Approve</Button>
          <Button className="h-11 px-4 md:h-8" data-gate="deny" onClick={() => void answer(e, "deny")}><X className="size-4" /> Deny</Button>
        </div>
      )}
      {/* (while it asks, a reply would be typed into its question: it's answered there, or with Approve and Deny) */}
      {blocked
        ? <Button look="quiet" className="h-11 px-3 md:h-8" onClick={() => void open().catch((err) => notifyError(err, "Couldn't open it"))}><SquareTerminal className="size-4" /> Open session</Button>
        : <ReplyBox to={e.id} name={name} open={open} sent={() => markRead([e.id])} />}
    </div>
  )
}
