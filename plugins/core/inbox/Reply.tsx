// The reply box at the end of an agent's report (```block-reply```): the reply goes back into the agent's session
// (inbox.reply), so a report is answered where it's read.
import { useEffect, useState, type KeyboardEvent } from "react"
import { MessageSquareReply, SquareTerminal } from "lucide-react"
import { cn, fetchMachines, get, keepOpen, keyHint, notify, notifyError, onMachine, op, openAgent, openView, Panel, parseTerminal, type BlockCtx } from "@vaultite"

const field = "w-full resize-y rounded-[7px] border-[0.5px] border-border bg-background px-2.5 py-1.5 text-[17px] leading-[22px] outline-none focus:border-primary md:text-[14px] md:leading-[20px]"
const button = "inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] px-3 text-[15px] font-medium disabled:cursor-default disabled:opacity-50 md:h-7 md:px-2.5 md:text-[13px]"

/** Its terminal if it still runs, else its session resumed in a new one: on the machine it ran on (a session is kept
 *  there, so a resume anywhere else finds none). */
async function openSession(terminal: string, session: string, agent: string, machine: string) {
  const [{ sessions }, ms] = await Promise.all([get<{ sessions: { id: string }[] }>("terminals/sessions"), fetchMachines()])
  const there = machine && ms.some((m) => m.id === machine && !m.self) ? machine : ""
  const id = terminal && onMachine(terminal, there)
  if (id && sessions.some((s) => s.id === id)) openView(`terminal/${id}`, { newTab: true })
  else if (session && agent) openAgent(agent, { resume: session, machine: there })
  else notify("Its terminal has ended, and the report has no session to resume")
}

// The unsent reply, kept on this device until it's sent: the box is drawn anew whenever the report re-renders.
const DRAFT = (path: string) => `vaultite.reply:${path}`
const draftOf = (path: string) => { try { return localStorage.getItem(DRAFT(path)) ?? "" } catch { return "" } }
function keepDraft(path: string, text: string) {
  try { if (text.trim()) localStorage.setItem(DRAFT(path), text); else localStorage.removeItem(DRAFT(path)) } catch { /* private mode, full */ }
}

/** The replies kept in the report (inbox.reply writes each above the box). */
const replies = (body: string) => body.split("[!note] You replied").length - 1

type Plan ={ how: "type" | "resume" | "new" | null; ago: number | null; ttl: number | null }

/** Where the reply goes, in a line: and the other way, when there's one. */
function PlanLine({ plan, how, setHow }: { plan: Plan | null; how: "resume" | "new" | ""; setHow: (h: "resume" | "new" | "") => void }) {
  if (!plan?.how) return <span className="md:flex-1" />
  const auto = plan.how
  const now = how || auto
  const left = plan.ago !== null && plan.ttl ? Math.max(1, Math.round((plan.ttl - plan.ago) / 60)) : null
  const says = auto === "type" ? "Goes into its terminal, still running."
    : now === "resume" ? (auto === "resume" ? `Resumes its session${left ? `, its context cached ${left} min more` : ""}.` : "Resumes its session, its context no longer cached: it's sent again in full.")
    : auto === "new" ? "Starts a new session that reads this report: the old one's context is no longer cached." : "Starts a new session that reads this report."
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

export function ReplyBlock({ store, path, body }: BlockCtx) {
  const [text, setDraft] = useState(() => draftOf(path))
  const setText = (t: string) => { setDraft(t); keepDraft(path, t) }
  // The reply just sent, shown at once until the report has it (the agent is reached first, which takes a moment).
  const [sent, setSent] = useState<{ text: string; had: number } | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [how, setHow] = useState<"resume" | "new" | "">("")
  const r = store.inbox?.find((x) => `${x.id}.md` === path)
  const terminal = r?.terminal ?? "", session = r?.session ?? "", agent = r?.agent || parseTerminal(terminal)?.agent || ""
  const named = !!r && !!(terminal || session)
  const kept = replies(body)
  useEffect(() => { if (sent && kept > sent.had) setSent(null) }, [sent, kept])
  useEffect(() => {
    if (!named) return
    let live = true
    const look = () => void op<Plan>("inbox.reply-plan", { path }).then((p) => { if (live) setPlan(p) }).catch(() => {})
    look()
    const t = setInterval(look, 60_000) // the cache runs out while it's open
    return () => { live = false; clearInterval(t) }
  }, [path, named, terminal, session])
  if (!r || !(terminal || session)) {
    return <p className="text-[15px] text-muted-foreground md:text-[13px]">A reply box, for an agent's report: what's typed here goes back into its session.</p>
  }
  const send = async () => {
    const said = text.trim()
    if (!said || sent) return
    setSent({ text: said, had: kept })
    setText("")
    if (r.status !== "done") keepOpen(path) // the report is done once replied to: it stays open, into the archive
    try {
      const out = await op<{ how: string }>("inbox.reply", { path, text: said, ...(how ? { how } : {}) })
      notify(out.how === "resume" ? "Resumed its session with your reply" : out.how === "new" ? "Started a new session with your reply" : `Sent to ${r.from || "the agent"}`)
    } catch (e) {
      setSent(null)
      if (!draftOf(path).trim()) setText(said) // back in the box, unless something new was typed meanwhile
      notifyError(e, "Couldn't send the reply")
    }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() }
  }
  return (
    <Panel title={`Reply to ${r.from || "the agent"}`} icon={MessageSquareReply} tint="var(--inbox)">
      {sent && (
        <div className="mb-2 rounded-[7px] border-[0.5px] border-border bg-foreground/[0.03] px-2.5 py-1.5" data-reply-sending>
          <div className="text-[13px] font-medium text-muted-foreground">Sending…</div>
          <div className="whitespace-pre-wrap text-[15px] leading-[20px] md:text-[14px]">{sent.text}</div>
        </div>
      )}
      <textarea value={text} rows={3} aria-label="Your reply" placeholder="Answer its questions, or ask for more"
        onChange={(e) => setText(e.target.value)} onKeyDown={onKey} className={field} data-reply />
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <PlanLine plan={plan} how={how} setHow={setHow} />
        <button type="button" onClick={() => void openSession(terminal, session, agent, r.machine ?? "").catch((e) => notifyError(e, "Couldn't open it"))}
          className={cn(button, "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground")}>
          <SquareTerminal className="size-4" /> Open session
        </button>
        <button type="button" disabled={!text.trim() || !!sent} onClick={() => void send()} data-tip={`Send (${keyHint("Mod+Enter")})`}
          className={cn(button, "bg-primary text-primary-foreground hover:opacity-90")}>
          Send
        </button>
      </div>
    </Panel>
  )
}
