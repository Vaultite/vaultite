// The reply box: at the end of an agent's report (```block-reply```), and in a session's sheet (Session.tsx). What's
// typed goes back into the agent's session (inbox.reply), so an answer is replied to where it's read.
import { useEffect, useState, type KeyboardEvent } from "react"
import { MessageSquareReply, PencilLine, SquareTerminal } from "lucide-react"
import { Button, cn, keyHint, notify, notifyError, op, openFile, Panel, parseTerminal, usePane, type BlockCtx } from "@vaultite"
import { draftOf, hasDraft, keepDraft, sendDraft, sendingOf, useHasDraft, useSending } from "./drafts"
import { openSession } from "./events"

const field = "w-full resize-y rounded-[7px] border-[0.5px] border-border bg-background px-2.5 py-1.5 text-[17px] leading-[22px] outline-none focus:border-primary md:text-[14px] md:leading-[20px]"
// (a phone's 44px target)
const reply = "h-11 rounded-[6px] px-3 md:h-7 md:px-2.5"

/** A reply typed on this device and not sent (drafts.ts), on its row and on its box. `short`: a sidebar's row. */
export function DraftTag({ to, short, className }: { to: string; short?: boolean; className?: string }) {
  if (!useHasDraft(to)) return null
  return (
    <span data-reply-draft className={cn(className, "inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full bg-foreground/[0.06] px-1.5 text-[11px] leading-none font-medium text-muted-foreground",
      !short && "max-md:h-5 max-md:text-[12px]")}>
      <PencilLine className="size-3" strokeWidth={2.25} style={{ color: "var(--orange)" }} />{short ? "Draft" : "Draft, not sent"}
    </span>
  )
}

// The boxes shown now, by what they answer: one left with its reply unsent says so, unless it's drawn again at once
// (the box is drawn anew whenever what it answers re-renders).
const shown = new Map<string, number>()
function leave(to: string, back?: () => void) {
  shown.set(to, (shown.get(to) ?? 1) - 1)
  setTimeout(() => {
    if (shown.get(to) || !hasDraft(to) || sendingOf(to) !== null) return
    notify("Reply not sent: saved as a draft", { id: `reply-draft:${to}`, ...(back ? { action: { label: "Back to it", run: back } } : {}) })
  }, 500)
}

/** The replies kept in a report (inbox.reply writes each above the box). */
const replies = (body: string) => body.split("[!note] You replied").length - 1

type Plan = { how: "type" | "resume" | "new" | null; ago: number | null; ttl: number | null }

/** Where the reply goes, in a line: and the other way, when there's one. */
function PlanLine({ plan, how, setHow }: { plan: Plan | null; how: "resume" | "new" | ""; setHow: (h: "resume" | "new" | "") => void }) {
  if (!plan?.how) return <span className="md:flex-1" />
  const auto = plan.how
  const now = how || auto
  const left = plan.ago !== null && plan.ttl ? Math.max(1, Math.round((plan.ttl - plan.ago) / 60)) : null
  const says = auto === "type" ? "Goes into its terminal, still running."
    : now === "resume" ? (auto === "resume" ? `Resumes its session${left ? `, its context cached ${left} min more` : ""}.` : "Resumes its session, its context no longer cached: it's sent again in full.")
    : auto === "new" ? "Starts a new session that's told what this is about: the old one's context is no longer cached." : "Starts a new session that's told what this is about."
  const other = auto === "type" ? null : now === "resume" ? "new" : "resume"
  return (
    <span className="basis-full text-[13px] leading-[18px] text-muted-foreground md:flex-1 md:basis-0" data-reply-plan={now}>
      {says}{" "}
      {other && <button type="button" className="cursor-pointer text-primary" onClick={() => setHow(other === auto ? "" : other)}>
        {other === "new" ? "New session instead" : "Resume instead"}
      </button>}
    </span>
  )
}

/** A reply box for `to` (a report's path, or a session's event id): `kept`, how many replies it has kept (a report's),
 *  so what was sent shows until it's there; `sent`, what happens once it went; `back`, what shows it again. */
export function ReplyBox({ to, name, kept = 0, open, sent: done, back, placeholder = "Answer its questions, or ask for more" }: {
  to: string; name: string; kept?: number; open: () => Promise<void>; sent?: () => void; back?: () => void; placeholder?: string
}) {
  // (the stored draft is the reply until the server has it: in flight, the box is empty and waits)
  const flying = useSending(to)
  const [text, setDraft] = useState(() => (sendingOf(to) === null ? draftOf(to) : ""))
  const setText = (t: string) => { setDraft(t); keepDraft(to, t) }
  // Once a send settles, the box shows what's stored: nothing when it went, the reply again when it didn't.
  useEffect(() => { if (flying === null) setDraft(draftOf(to)) }, [flying, to])
  // The reply just sent, shown at once until it's kept (the agent is reached first, which takes a moment).
  const [sent, setSent] = useState<{ text: string; had: number } | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [how, setHow] = useState<"resume" | "new" | "">("")
  const { hidden } = usePane()
  useEffect(() => {
    if (hidden) return
    shown.set(to, (shown.get(to) ?? 0) + 1)
    return () => leave(to, back)
  }, [to, hidden]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sent && kept > sent.had) setSent(null) }, [sent, kept])
  useEffect(() => {
    let live = true
    const look = () => void op<Plan>("inbox.reply-plan", { to }).then((p) => { if (live) setPlan(p) }).catch(() => {})
    look()
    const t = setInterval(look, 60_000) // the cache runs out while it's open
    return () => { live = false; clearInterval(t) }
  }, [to])
  const send = async () => {
    const said = text.trim()
    if (!said || sent || sendingOf(to) !== null) return
    setSent({ text: said, had: kept })
    setDraft("")
    try {
      const out = await sendDraft(to, said, () => op<{ how: string }>("inbox.reply", { to, text: said, ...(how ? { how } : {}) }))
      if (!out) { setSent(null); setDraft(draftOf(to)); return }
      notify(out.how === "resume" ? "Resumed its session with your reply" : out.how === "new" ? "Started a new session with your reply" : `Sent to ${name}`)
      if (done) { setSent(null); done() }
    } catch (e) {
      setSent(null)
      notifyError(e, "Couldn't send the reply")
    }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() }
  }
  const showing = sent?.text ?? flying
  return (
    <Panel title={`Reply to ${name}`} icon={MessageSquareReply} tint="var(--inbox)" action={<DraftTag to={to} />}>
      {showing && (
        <div className="mb-2 rounded-[7px] border-[0.5px] border-border bg-foreground/[0.03] px-2.5 py-1.5" data-reply-sending>
          <div className="text-[13px] font-medium text-muted-foreground">Sending…</div>
          <div className="whitespace-pre-wrap text-[15px] leading-[20px] md:text-[14px]">{showing}</div>
        </div>
      )}
      <textarea value={text} rows={3} aria-label="Your reply" placeholder={placeholder} disabled={flying !== null}
        onChange={(e) => setText(e.target.value)} onKeyDown={onKey} className={field} data-reply />
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <PlanLine plan={plan} how={how} setHow={setHow} />
        <Button look="quiet" className={reply} onClick={() => void open().catch((e) => notifyError(e, "Couldn't open it"))}>
          <SquareTerminal className="size-4" /> Open session
        </Button>
        <Button look="primary" className={reply} disabled={!text.trim() || !!sent || flying !== null} onClick={() => void send()} data-tip={`Send (${keyHint("Mod+Enter")})`}>
          Send
        </Button>
      </div>
    </Panel>
  )
}

export function ReplyBlock({ store, path, body }: BlockCtx) {
  const r = store.inbox?.find((x) => `${x.id}.md` === path)
  const terminal = r?.terminal ?? "", session = r?.session ?? ""
  if (!r || !(terminal || session)) {
    return <p className="text-[15px] text-muted-foreground md:text-[13px]">A reply box, for an agent's report: what's typed here goes back into its session.</p>
  }
  const agent = r.agent || parseTerminal(terminal)?.agent || ""
  return <ReplyBox to={path} name={r.from || "the agent"} kept={replies(body)} back={() => openFile(path)}
    open={() => openSession({ terminal, session, agent, machine: r.machine ?? "" })} />
}
