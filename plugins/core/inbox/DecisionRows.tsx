// Decisions drawn: a question an agent asked, its options as buttons (the default marked), on the Inbox page, the
// dashboard block and in its own file (```block-decisions```, a report's too). A tap answers it (inbox.decide).
import { useState, type ReactNode } from "react"
import { ArrowUp, Check, Circle, CircleCheck, FileText, MessageCircleQuestion, MoreHorizontal, RotateCcw, X } from "lucide-react"
import {
  Button, cn, confirmDialog, fmtAgo, haptic, menuBelow, menuFor, notify, notifyError, op, openFile, optimistic, snippet, SwipeRow, useStore,
  type BlockCtx, type MenuItem, type Store, type SwipeAction,
} from "@vaultite"
import type { InboxItem } from "./types"
import { snoozed } from "./snooze"
import { useEvents } from "./events"

const pathOf = (r: InboxItem) => `${r.id}.md`
const baseOf = (p: string) => p.replace(/\.md$/i, "").split("/").pop() ?? p
const linkTo = (l: string) => /^\[\[([^\]|#]+)/.exec(l.trim())?.[1]?.trim() ?? l.trim()
/** A report's title without its work and state ("Feature done · Sidebar" -> "Sidebar"). */
const subject = (t: string) => t.replace(/^\S+ (done|needs you|stuck) · /, "")

export const isOpen = (r: InboxItem) => !!r.question && r.status === "new" && !r.archived
/** The report a decision came from, as the store has it (archived ones too). */
const reportIn = (store: Store | null | undefined, r: InboxItem) => {
  const name = baseOf(linkTo(r.report ?? ""))
  return name ? (store?.inbox ?? []).find((x) => !x.question && baseOf(x.id) === name) : undefined
}
/** The session that asked, by its name: kept when it was asked, else its thread's while it's listed (older ones). */
function useWhere(r: InboxItem) {
  const { events } = useEvents()
  if (r.where) return r.where
  const e = (r.session || r.terminal) ? events.find((x) => x.kind === "session" && ((!!r.session && x.session === r.session) || (!!r.terminal && x.terminal === r.terminal))) : undefined
  return e?.title ?? ""
}
/** Its context: the file's words besides its block, one plain line. */
const whyOf = (r: InboxItem) => snippet((r.body ?? "").replace(/```[\s\S]*?```/g, " ")).trim()

/** What a tap does: the decision answered on screen at once (it leaves the lists), then written; Undo opens it again. */
type Decided = { decided: { path: string }[]; sent: string[]; failed: string[] }
function settle(r: InboxItem, fields: Partial<InboxItem>, write: () => Promise<Decided>, said: (out: Decided) => string) {
  haptic("medium")
  const now = { ...fields, status: "done" as const, archived: true }
  return optimistic((s) => ({ ...s, inbox: (s.inbox ?? []).map((x) => (x.id === r.id ? { ...x, ...now } : x)) }), write, "Couldn't answer it").then((out) => {
    const at = out.decided[0]?.path
    if (out.failed.length) notifyError(new Error(out.failed.join("; ")), "Answered, but couldn't tell its agent")
    else notify(said(out), { id: `decide-${r.id}`, action: at && !out.sent.length ? { label: "Undo", run: () => void undo(at) } : undefined })
    return out
  }, () => null)
}
const undo = (path: string) => op("inbox.decide", { item: path, undo: true }).catch((e) => notifyError(e, "Couldn't open it again"))

export function decide(r: InboxItem, answer: string) {
  return settle(r, { answer }, () => op<Decided>("inbox.decide", { item: pathOf(r), answer }),
    (out) => (out.sent.length ? `Answered “${answer}”: sent to ${r.from || "its agent"}` : answer === r.default && !r.blocking ? `Kept “${answer}”` : `Answered “${answer}”`))
}
export const keepDefault = (r: InboxItem) => decide(r, r.default ?? "")
const closeIt = (r: InboxItem) => settle(r, { closed: "Closed by you" }, () => op<Decided>("inbox.decide", { item: pathOf(r), moot: "Closed by you" }), () => "Closed it, unanswered")

/** Accept all defaults: what's only kept is undone with one Undo; when an agent waits on one, that's sent, so it asks. */
export async function acceptAll(rs: InboxItem[]) {
  if (!rs.length) return
  const waiting = rs.filter((r) => r.blocking)
  if (waiting.length && !(await confirmDialog({
    title: `Accept ${rs.length === 1 ? "its default" : `all ${rs.length} defaults`}?`,
    body: `${waiting.length === 1 ? "One agent waits" : `${waiting.length} agents wait`} on ${waiting.length === 1 ? "its answer: it gets its default" : "theirs: each gets its default"} and goes on.`,
    confirm: "Accept defaults",
  }))) return
  haptic("medium")
  const ids = new Set(rs.map((r) => r.id))
  const out = await optimistic((s) => ({ ...s, inbox: (s.inbox ?? []).map((x) => (ids.has(x.id) ? { ...x, answer: x.default, status: "done" as const, archived: true } : x)) }),
    () => op<{ decided: { path: string }[]; failed: string[] }>("inbox.decide", { defaults: true }), "Couldn't accept them").catch(() => null)
  if (!out) return
  const back = out.decided.map((d) => d.path)
  notify(`Accepted ${back.length === 1 ? "its default" : `${back.length} defaults`}`, { id: "decide-all", action: waiting.length ? undefined : { label: "Undo", run: () => void Promise.all(back.map(undo)) } })
}

const tall = "max-md:h-11 max-md:rounded-[10px] max-md:px-4 max-md:text-[15px]"

/** Its own answer, typed: Enter sends it. */
function OwnAnswer({ r, close }: { r: InboxItem; close: () => void }) {
  const [text, setText] = useState("")
  const send = () => { const t = text.trim(); if (t) void decide(r, t) }
  return (
    <div className="flex w-full items-center gap-1.5" data-decision-own>
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer" aria-label={`Your answer to: ${r.question}`} enterKeyHint="send" autoComplete="off"
        onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); send() } if (e.key === "Escape") { e.stopPropagation(); close() } }}
        className="h-7 min-w-0 flex-1 rounded-[6px] border-[0.5px] border-border bg-background px-2.5 text-[14px] outline-none focus:border-primary max-md:h-11 max-md:rounded-[10px] max-md:text-[17px]" />
      <Button look="primary" size="small" className={cn("w-7 px-0 max-md:w-11", tall)} aria-label="Send" disabled={!text.trim()} onClick={send}><ArrowUp className="size-4" strokeWidth={2.5} /></Button>
      <Button look="quiet" size="small" className={cn("w-7 px-0 max-md:w-11", tall)} aria-label="Cancel" onClick={close}><X className="size-4" strokeWidth={2.25} /></Button>
    </div>
  )
}

/** Its options as one list of choices, each its words and what picking it does beneath; where it went with the default
 *  already, that one first, marked, and a tap keeps it. Something else… takes an answer of their own. */
function Options({ r }: { r: InboxItem }) {
  const [own, setOwn] = useState(false)
  const options = r.options ?? []
  const doesOf = (o: string) => r.effects?.[options.indexOf(o)] ?? ""
  // (what stands now on top: the default it went with, then what it could change to)
  const order = r.blocking ? options : [...options.filter((o) => o === r.default), ...options.filter((o) => o !== r.default)]
  const row = (o: string) => {
    const def = o === r.default, kept = def && !r.blocking, does = doesOf(o)
    return (
      <button key={o} type="button" data-option={options.indexOf(o) + 1} data-default={def || undefined} data-keep={kept || undefined}
        aria-description={does || undefined} onClick={(e) => { e.stopPropagation(); void (kept ? keepDefault(r) : decide(r, o)) }}
        className={cn("group/opt flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-foreground/[0.05] active:bg-foreground/[0.08] max-md:min-h-11 max-md:py-2.5",
          kept && "bg-foreground/[0.03]")}>
        {kept ? <CircleCheck className="mt-[2px] size-4 shrink-0 text-foreground/80 max-md:mt-[3px]" strokeWidth={2} />
          : <Circle className="mt-[2px] size-4 shrink-0 text-tertiary group-hover/opt:text-muted-foreground max-md:mt-[3px]" strokeWidth={1.75} />}
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] leading-[20px] font-medium text-foreground text-pretty max-md:text-[16px] max-md:leading-[22px]">{o}</span>
          {does && <span className="block text-[13px] leading-[18px] text-muted-foreground text-pretty max-md:text-[15px] max-md:leading-[20px]" data-option-does>{does}</span>}
        </span>
        {def && <span className="mt-[2px] shrink-0 rounded-chip bg-foreground/[0.06] px-1.5 py-px text-[11px] leading-[16px] font-medium text-muted-foreground max-md:text-[12px]">
          {kept ? "Went with this" : "Default"}</span>}
      </button>
    )
  }
  return (
    <div className="max-w-[36rem]">
      <div className="overflow-hidden rounded-control border-[0.5px] border-border divide-y-[0.5px] divide-border" role="group" aria-label={r.question}>{order.map(row)}</div>
      <div className="mt-1.5">{own ? <OwnAnswer r={r} close={() => setOwn(false)} />
        : <button type="button" data-other onClick={(e) => { e.stopPropagation(); setOwn(true) }}
          className="cursor-pointer text-[13px] leading-[20px] text-muted-foreground hover:text-foreground max-md:h-11 max-md:text-[15px]">Something else…</button>}</div>
    </div>
  )
}

const menuOf = (r: InboxItem, store: Store | null | undefined, snooze?: (r: InboxItem) => MenuItem): MenuItem[] => {
  const rep = reportIn(store, r)
  return [
    { label: "Open", icon: FileText, run: () => openFile(pathOf(r)) },
    ...(rep ? [{ label: "Open its report", icon: FileText, run: () => openFile(pathOf(rep)) }] : []),
    ...(r.default ? [{ label: `Accept the default (${r.default})`, icon: Check, sep: true, run: () => void keepDefault(r) }] : []),
    ...(snooze ? [snooze(r)] : []),
    { label: "Close without answering", icon: X, sep: true, run: () => void closeIt(r) },
  ]
}

/** Where it stands, when it's news: an agent waits on it (one it went with the default on says so in its list). */
function Standing({ r }: { r: InboxItem }) {
  if (!r.blocking) return null
  return <span data-standing className="rounded-chip px-1.5 py-px text-[11px] leading-[16px] font-semibold max-md:text-[12px]"
    style={{ color: "var(--orange)", background: "color-mix(in srgb, var(--orange) 14%, transparent)" }}>Waits on you</span>
}

/** One decision, open: where it stands and who asked, the question, its context, its buttons. `snooze`: its menu's
 *  Snooze (the Inbox's), and its swipe's. */
export function DecisionRow({ r, snooze, swipe, lead, inReport }: { r: InboxItem; snooze?: (r: InboxItem) => MenuItem; swipe?: SwipeAction[]; lead?: ReactNode
  /** Drawn in its report: it doesn't link back to it. */
  inReport?: boolean }) {
  const { store } = useStore()
  const rep = inReport ? undefined : reportIn(store, r)
  const why = whyOf(r)
  const where = useWhere(r)
  // (what its report said as it asked, else the report's own TL;DR: an older one's only context)
  const gist = r.gist || rep?.tldr || ""
  const away = snoozed(r.snoozed)
  const Icon = r.blocking ? MessageCircleQuestion : CircleCheck
  const by = [r.from, where].filter(Boolean).join(" · ")
  const row = (
    <div data-decision={r.id} data-blocking={r.blocking || undefined} onContextMenu={menuFor(() => menuOf(r, store, snooze))}
      className="group/dec relative isolate flex gap-3 py-4 before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] hover:before:bg-foreground/[0.02]">
      {lead ?? <Icon className="mt-[2px] size-[18px] shrink-0 max-md:hidden" strokeWidth={2} style={{ color: r.blocking ? "var(--orange)" : "var(--muted-foreground)" }} />}
      <div className="min-w-0 flex-1">
        {/* The question, then who asks; its why in plain words; what its report said; the choices. */}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 text-[15px] leading-[21px] font-semibold text-pretty select-text max-md:text-[17px] max-md:leading-[23px]" data-question>{r.question}</div>
          {r.created && <span className="mt-[2px] shrink-0 text-[12px] leading-[18px] text-tertiary tabular-nums max-md:text-[13px]">{fmtAgo(r.created, { short: true })}</span>}
        </div>
        {(r.blocking || by || away) && <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-[17px] text-muted-foreground max-md:text-[14px] max-md:leading-[19px]">
          <Standing r={r} />
          {by && <span className="min-w-0" data-decision-where={where || undefined}>{by}</span>}
          {away && <span className="text-tertiary">· snoozed</span>}
        </div>}
        {why && <p className="mt-2 max-w-[40rem] text-[14px] leading-[20px] text-foreground/75 text-pretty select-text max-md:text-[16px] max-md:leading-[23px]" data-decision-why>{why}</p>}
        {gist && !inReport && <button type="button" data-decision-tldr disabled={!rep} onClick={(e) => { e.stopPropagation(); if (rep) openFile(pathOf(rep)) }}
          className="group/rep mt-2.5 block w-full max-w-[40rem] border-l-2 border-border pl-3 text-left enabled:cursor-pointer">
          {rep && <span className="flex items-center gap-1 text-[12px] leading-[17px] font-medium text-tertiary group-enabled/rep:group-hover/rep:text-muted-foreground max-md:text-[13px]" data-decision-report>
            <FileText className="size-3 shrink-0" strokeWidth={2.25} /><span className="truncate">Report · {subject(rep.title)}</span></span>}
          <span className="mt-0.5 line-clamp-2 text-[13px] leading-[18px] text-muted-foreground text-pretty group-enabled/rep:group-hover/rep:text-foreground/80 max-md:line-clamp-3 max-md:text-[15px] max-md:leading-[21px]">{gist}</span>
        </button>}
        <div className="mt-3"><Options r={r} /></div>
      </div>
      <button type="button" aria-label="More" data-tip="More" onClick={(e) => { e.stopPropagation(); menuBelow(e, menuOf(r, store, snooze)) }}
        className="-mr-1 grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground max-md:hidden md:invisible md:group-hover/dec:visible">
        <MoreHorizontal className="size-4" strokeWidth={2.25} /></button>
    </div>
  )
  return swipe ? <SwipeRow actions={() => swipe} className="-mx-2 bg-origin-content px-2">{row}</SwipeRow> : row
}

/** One dealt with: its answer (or why it closed), and Undo. */
function DecidedRow({ r }: { r: InboxItem }) {
  const said = r.answer ? <>You chose <span className="font-medium text-foreground/80">{r.answer}</span>{r.answer === r.default && !r.blocking ? " (its default)" : ""}</>
    : <>Closed{r.closed && r.closed !== "Closed by you" ? <>: {r.closed.replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, "$1")}</> : ""}</>
  return (
    <div data-decision={r.id} data-decided className="flex gap-3 py-3">
      <CircleCheck className="mt-[1px] size-[18px] shrink-0 text-tertiary" strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <div className="text-[15px] leading-[21px] text-muted-foreground select-text max-md:text-[17px] max-md:leading-[23px]">{r.question}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[13px] text-muted-foreground max-md:text-[15px]">
          <span className="min-w-0 truncate">{said}{r.answered && <> · {fmtAgo(r.answered, { short: true })}</>}</span>
          <button type="button" data-decision-undo className="flex shrink-0 cursor-pointer items-center gap-1 rounded-[5px] px-1 text-tertiary hover:bg-foreground/[0.06] hover:text-foreground max-md:h-9"
            onClick={() => void undo(pathOf(r))}><RotateCcw className="size-3" strokeWidth={2.5} />Undo</button>
        </div>
      </div>
    </div>
  )
}

/** The decisions a file asks (a decision's own file, itself; a report, the ones it asked), newest last. */
export function decisionsIn(store: Store | null | undefined, path: string): InboxItem[] {
  const all = (store?.inbox ?? []).filter((r) => r.question)
  const own = all.find((r) => pathOf(r) === path)
  if (own) return [own]
  const name = baseOf(path)
  const asks = (r: InboxItem) => baseOf(linkTo(r.report ?? "")) === name || (r.also ?? []).some((l) => baseOf(linkTo(l)) === name)
  return all.filter(asks).sort((a, b) => (a.created ?? "").localeCompare(b.created ?? ""))
}

/** ```block-decisions: in a decision's file, it answered there; in a report, what it asked, open ones with their buttons. */
export function DecisionsBlock({ store, path }: BlockCtx) {
  const own = (store?.inbox ?? []).some((r) => r.question && pathOf(r) === path)
  // (what waits on you first, then a default to keep or change, then what's dealt with)
  const rank = (r: InboxItem) => (!isOpen(r) ? 2 : r.blocking ? 0 : 1)
  const ds = decisionsIn(store, path).sort((a, b) => rank(a) - rank(b))
  if (!ds.length) return <p className="text-[15px] text-muted-foreground md:text-[13px]">The decisions a report asks you, each with its options: none here.</p>
  const open = ds.filter(isOpen)
  return (
    <div data-decisions-block className="not-prose">
      {ds.length > 1 && <div className="mb-0.5 text-[13px] font-semibold text-muted-foreground">{open.length ? `${open.length} of ${ds.length} to decide` : `${ds.length} decided`}</div>}
      <div className="hairline">{ds.map((r) => (isOpen(r) ? <DecisionRow key={r.id} r={r} inReport={!own} /> : <DecidedRow key={r.id} r={r} />))}</div>
    </div>
  )
}
