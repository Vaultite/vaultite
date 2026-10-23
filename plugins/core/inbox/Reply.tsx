// The reply box: at the end of an agent's report (```block-reply```), and in a session's sheet (Session.tsx). What's
// typed goes back into the agent's session (inbox.reply), so an answer is replied to where it's read.
import { useEffect, useState, type KeyboardEvent } from "react"
import { MessageSquareReply, SquareTerminal } from "lucide-react"
import { Button, keyHint, notify, notifyError, op, Panel, parseTerminal, type BlockCtx } from "@vaultite"
import { openSession } from "./events"

const field = "w-full resize-y rounded-[7px] border-[0.5px] border-border bg-background px-2.5 py-1.5 text-[17px] leading-[22px] outline-none focus:border-primary md:text-[14px] md:leading-[20px]"
// (a phone's 44px target)
const reply = "h-11 rounded-[6px] px-3 md:h-7 md:px-2.5"

// The unsent reply, kept on this device until it's sent: the box is drawn anew whenever what it answers re-renders.
const DRAFT = (to: string) => `vaultite.reply:${to}`
const draftOf = (to: string) => { try { return localStorage.getItem(DRAFT(to)) ?? "" } catch { return "" } }
function keepDraft(to: string, text: string) {
  try { if (text.trim()) localStorage.setItem(DRAFT(to), text); else localStorage.removeItem(DRAFT(to)) } catch { /* private mode, full */ }
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
 *  so what was sent shows until it's there; `sent`, what happens once it went. */
export function ReplyBox({ to, name, kept = 0, open, sent: done, placeholder = "Answer its questions, or ask for more" }: {
  to: string; name: string; kept?: number; open: () => Promise<void>; sent?: () => void; placeholder?: string
}) {
  const [text, setDraft] = useState(() => draftOf(to))
  const setText = (t: string) => { setDraft(t); keepDraft(to, t) }
  // The reply just sent, shown at once until it's kept (the agent is reached first, which takes a moment).
  const [sent, setSent] = useState<{ text: string; had: number } | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [how, setHow] = useState<"resume" | "new" | "">("")
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
    if (!said || sent) return
    setSent({ text: said, had: kept })
    setText("")
    try {
      const out = await op<{ how: string }>("inbox.reply", { to, text: said, ...(how ? { how } : {}) })
      notify(out.how === "resume" ? "Resumed its session with your reply" : out.how === "new" ? "Started a new session with your reply" : `Sent to ${name}`)
      if (done) { setSent(null); done() }
    } catch (e) {
      setSent(null)
      if (!draftOf(to).trim()) setText(said) // back in the box, unless something new was typed meanwhile
      notifyError(e, "Couldn't send the reply")
    }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() }
  }
  return (
    <Panel title={`Reply to ${name}`} icon={MessageSquareReply} tint="var(--inbox)">
      {sent && (
        <div className="mb-2 rounded-[7px] border-[0.5px] border-border bg-foreground/[0.03] px-2.5 py-1.5" data-reply-sending>
          <div className="text-[13px] font-medium text-muted-foreground">Sending…</div>
          <div className="whitespace-pre-wrap text-[15px] leading-[20px] md:text-[14px]">{sent.text}</div>
        </div>
      )}
      <textarea value={text} rows={3} aria-label="Your reply" placeholder={placeholder}
        onChange={(e) => setText(e.target.value)} onKeyDown={onKey} className={field} data-reply />
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <PlanLine plan={plan} how={how} setHow={setHow} />
        <Button look="quiet" className={reply} onClick={() => void open().catch((e) => notifyError(e, "Couldn't open it"))}>
          <SquareTerminal className="size-4" /> Open session
        </Button>
        <Button look="primary" className={reply} disabled={!text.trim() || !!sent} onClick={() => void send()} data-tip={`Send (${keyHint("Mod+Enter")})`}>
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
  return <ReplyBox to={path} name={r.from || "the agent"} kept={replies(body)} open={() => openSession({ terminal, session, agent, machine: r.machine ?? "" })} />
}
