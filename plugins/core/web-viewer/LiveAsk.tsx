import { useEffect, useRef, useState } from "react"
import { Bot, Check, CircleSlash, MessageSquareText, SquareTerminal } from "lucide-react"
import { agentNamed, Button, cn, fmtAgo, notifyError, openAgentSession, useAgents, useMachines, type Machine } from "@vaultite"
import { machineOf, type Outcome } from "./askstate"
import type { LiveAsk } from "./livetabs"

const there = (a: LiveAsk, ms: Machine[] | null) => {
  const id = machineOf(a), m = ms?.find((x) => x.id === id)
  return m && !m.self ? m : null
}

function useAsker(ask: LiveAsk) {
  const agent = agentNamed(ask.agent ?? "", useAgents())
  const m = there(ask, useMachines())
  const where = ask.where || (ask.terminal ? "its terminal" : ask.session ? "its session" : "")
  return { name: agent?.label ?? ask.by, Icon: agent?.icon ?? Bot, tint: agent?.tint ?? "var(--purple)", where, on: m?.label ?? "" }
}

const openAsker = (a: LiveAsk) => void openAgentSession({ terminal: a.terminal, session: a.session, agent: a.agent, machine: machineOf(a), host: !a.terminal })
  .catch((e) => notifyError(e, "Couldn't open its session"))

function Session({ ask, alive }: { ask: LiveAsk; alive: boolean | null }) {
  const who = useAsker(ask)
  if (!who.where) return null
  return (
    <button type="button" onClick={() => openAsker(ask)} data-web-live-asker
      className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-[8px] bg-foreground/[0.04] px-2.5 py-2 text-left hover:bg-foreground/[0.07] max-md:min-h-11">
      <SquareTerminal className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] leading-[19px] md:text-[13px] md:leading-[18px]">{who.where}</span>
        <span className="truncate text-[12px] text-muted-foreground">{[alive === false ? "Ended" : "", who.on && `on ${who.on}`].filter(Boolean).join(" · ") || who.name}</span>
      </span>
      <span className="shrink-0 text-[13px] font-medium text-muted-foreground">{alive === false && ask.session ? "Resume" : "Open"}</span>
    </button>
  )
}

function Cant({ name, send, back }: { name: string; send: (note: string) => void; back: () => void }) {
  const [note, setNote] = useState("")
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => field.current?.focus({ preventScroll: true }), [])
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); send(note.trim()) }} data-web-live-cant-form>
      <textarea ref={field} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} aria-label={`Why not, for ${name}`}
        placeholder={`Why not? ${name} reads this (optional)`}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(note.trim()) } else if (e.key === "Escape") back() }}
        className="w-full resize-none rounded-[8px] border-[0.5px] border-border bg-background px-2.5 py-2 text-[16px] outline-none focus:ring-2 focus:ring-primary/40 md:text-[13px]" />
      <span className="flex gap-2">
        <Button type="submit" look="primary" size="small" className="flex-1 max-md:h-11" data-web-live-cant-send>Tell {name}</Button>
        <Button look="secondary" size="small" onClick={back} className="max-md:h-11">Back</Button>
      </span>
    </form>
  )
}

const ENDED: Record<Exclude<Outcome["kind"], "open">, { icon: typeof Check; tint: string; title: string }> = {
  done: { icon: Check, tint: "var(--green)", title: "You said it's done" },
  cant: { icon: CircleSlash, tint: "var(--orange)", title: "You said you can't" },
  elsewhere: { icon: Check, tint: "var(--green)", title: "Answered elsewhere" },
}

function Answered({ outcome, name }: { outcome: Exclude<Outcome, { kind: "open" }>; name: string }) {
  const ended = ENDED[outcome.kind], Icon = ended.icon
  const said = outcome.kind === "done" ? `${name} was told, and goes on.` : outcome.kind === "cant"
    ? `${name} was told${outcome.note ? `: “${outcome.note}”` : "."}` : "Someone answered it on another screen, or the agent went on."
  return (
    <div className="flex items-start gap-2" data-web-live-answered={outcome.kind}>
      <Icon className="mt-px size-4 shrink-0" strokeWidth={2.5} style={{ color: ended.tint }} />
      <span className="flex min-w-0 flex-col"><span className="text-[15px] font-medium md:text-[13px]">{ended.title}</span>
        <span className="text-[13px] text-muted-foreground">{said}</span></span>
    </div>
  )
}

function Gone({ ask, name }: { ask: LiveAsk; name: string }) {
  return (
    <p className="flex items-start gap-2 text-[13px] text-muted-foreground" data-web-live-asker-gone>
      <MessageSquareText className="mt-px size-4 shrink-0" strokeWidth={2} />
      {`${name}'s terminal has ended, so nothing waits for your answer.${ask.session ? " Resume its session to go on there." : ""}`}
    </p>
  )
}

function Answers({ ask, alive, compact, where, name, done, cant }: { ask: LiveAsk; alive: boolean | null; compact: boolean; where: string; name: string
  done: () => void; cant: (note: string) => void }) {
  const [saying, setSaying] = useState(false)
  if (saying) return <Cant name={name} send={(n) => { setSaying(false); cant(n) }} back={() => setSaying(false)} />
  return (
    <span className={cn("flex gap-2", compact && "flex-wrap")}>
      <Button look="primary" onClick={done} className="flex-1 max-md:h-11" data-web-live-done><Check className="size-4" strokeWidth={2.5} />{alive === false ? "Close the ask" : "Done"}</Button>
      {alive !== false && <Button look="secondary" onClick={() => setSaying(true)} className="max-md:h-11" data-web-live-cant>I can't</Button>}
      {compact && where && <Button look="secondary" onClick={() => openAsker(ask)} className="max-md:h-11" data-web-live-asker><SquareTerminal className="size-4" strokeWidth={2} />Session</Button>}
    </span>
  )
}

export function LiveAskCard({ ask, outcome, alive, done, cant, compact }: { ask: LiveAsk; outcome: Outcome; alive: boolean | null
  done: () => void; cant: (note: string) => void; compact: boolean }) {
  const who = useAsker(ask), Icon = who.Icon
  const tint = outcome.kind === "open" ? who.tint : ENDED[outcome.kind].tint
  return (
    <section className={cn("flex flex-col gap-3", compact ? "px-3 py-2.5" : "rounded-[12px] p-4 shadow-sm ring-[0.5px] ring-border")}
      style={{ background: `color-mix(in srgb, ${tint} ${compact ? 8 : 6}%, var(--card))` }} data-web-live-ask={outcome.kind} aria-label={`${who.name} asks`}>
      <span className="flex items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${who.tint} 16%, transparent)` }}>
          <Icon className="size-3.5" strokeWidth={2.25} style={{ color: who.tint }} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{who.name} asks you</span>
        <span className="shrink-0 text-[12px] text-tertiary">{fmtAgo(ask.at)}</span>
      </span>
      <p className={cn("text-[17px] leading-[22px] font-medium select-text", compact && "md:text-[15px] md:leading-[20px]", outcome.kind !== "open" && "text-muted-foreground")}
        data-web-live-reason>{ask.reason}</p>
      {outcome.kind !== "open" ? <Answered outcome={outcome} name={who.name} /> : alive === false && <Gone ask={ask} name={who.name} />}
      {!compact && <Session ask={ask} alive={alive} />}
      {outcome.kind === "open" && <Answers ask={ask} alive={alive} compact={compact} where={who.where} name={who.name} done={done} cant={cant} />}
    </section>
  )
}
