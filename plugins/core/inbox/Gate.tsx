import { Check, ShieldAlert, SquareTerminal, X } from "lucide-react"
import {
  Button, cn, Empty, haptic, notify, notifyError, SheetHead,
} from "@vaultite"
import { answerable, answerAsk, getEvents, openAsker, openEvent, threadTitle, useEvents } from "./events"
import type { InboxEvent } from "./types"
import { stop } from "./menus"

const answer = (e: InboxEvent, a: "approve" | "deny") => (haptic("medium"), answerAsk(e, a)).then(
  () => notify(a === "approve" ? "Approved" : "Denied"), (err) => notifyError(err, "Couldn't answer it"))

const shownWhole = (e: InboxEvent) => !e.body || (e.body.length <= 80 && !e.body.includes("\n"))

export function GateButtons({ e, className, size }: { e: InboxEvent; className: string; size: string }) {
  if (!answerable(e)) return null
  return <>
    <button type="button" className={className} aria-label="Approve" data-tip="Approve" data-gate="approve" onClick={stop(() => shownWhole(e) ? void answer(e, "approve") : openEvent(e))}>
      <Check className={size} strokeWidth={2.25} /></button>
    <button type="button" className={className} aria-label="Deny" data-tip="Deny" data-gate="deny" onClick={stop(() => void answer(e, "deny"))}>
      <X className={size} strokeWidth={2.25} /></button>
  </>
}
export const gateTitle = (id: string) => getEvents().events.find((e) => e.id === id)?.title ?? "Asks for your yes"

export function GateSheet({ id }: { id: string }) {
  const { events } = useEvents()
  const e = events.find((x) => x.id === id)
  if (!e) return <Empty>This request is gone: asked again, it comes back.</Empty>
  const from = e.from ? <>From <span data-gate-from className="font-medium text-foreground/80">{threadTitle(e.from, events)}</span>{e.machineLabel && ` on ${e.machineLabel}`}</> : null
  const said = e.answer ? (e.answer === "approve" ? "Approved" : "Denied") : null
  return (
    <div data-gate-sheet={e.id}>
      <SheetHead icon={ShieldAlert} tint="var(--orange)" kicker="Inbox" title={e.title}
        sub={from || said ? <>{from}{from && said && " · "}{said}</> : undefined} />
      {e.body && <pre data-gate-body className="max-h-[60vh] overflow-auto rounded-[10px] bg-muted p-3 font-mono text-[12px] leading-[17px] break-words whitespace-pre-wrap">{e.body}</pre>}
      {(!e.answer || e.from) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!e.answer && <>
            <Button look="primary" data-gate="approve" onClick={() => void answer(e, "approve")}>Approve</Button>
            <Button data-gate="deny" onClick={() => void answer(e, "deny")}>Deny</Button>
          </>}
          {e.from && <Button look="quiet" className={cn(!e.answer && "ml-auto")} data-gate-session onClick={() => openAsker(e)}><SquareTerminal className="size-4" /> Go to session</Button>}
        </div>
      )}
    </div>
  )
}
