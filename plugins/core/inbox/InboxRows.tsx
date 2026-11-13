import { useEffect, useRef, useState, type ReactNode } from "react"
import { AlarmClockOff, Bell, Check, CircleAlert, CircleCheck, Clock, FileText, Globe, MessageCircleQuestion, MessageSquareReply, MoreHorizontal, RotateCcw } from "lucide-react"
import { Badged, cn, DoIt, fmtAgo, haptic, Markdown, menuFor, openFile, rightClickBelow, rowMenu, selectClick, selectedAttr, snippet, SwipeRow, useAgents, useSelected, type SwipeAction } from "@vaultite"
import { agentOf, answerable, markRead, openEvent, openSession, threadTitle, snoozable, targetOf } from "./events"
import type { InboxEvent, InboxItem } from "./types"
import { whenText } from "./snooze"
import { useHasDraft } from "./drafts"
import { DraftTag, ReplyBox } from "./Reply"
import { pathOf, SELECT, resultKey, eventKey, markDone, markManyEventsDone, reopen } from "./items"
import { snoozeBelow, snoozeKeys, snoozeMenu } from "./Snoozing"
import { resultSwipe, eventSwipe, moreMenu, settledItems, resultItemsMenu, eventItems } from "./menus"
import { GateButtons } from "./Gate"

export const lineOf = (e: InboxEvent) => (e.state === "working" && e.progress) || e.preview || (e.body ? snippet(e.body) : "")

export const draftKey = (e: InboxEvent) => e.id

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return "" } }

const KIND_ICON: Record<string, typeof Bell> = { done: CircleCheck, waiting: MessageCircleQuestion, error: CircleAlert }
const KIND_TINT: Record<string, string> = { done: "var(--green)", waiting: "var(--orange)", error: "var(--red)" }

export function EventIcon({ e, className }: { e: InboxEvent; className: string }) {
  const a = agentOf(e, useAgents())
  const kind = e.kind === "session" ? (e.state === "done" ? "done" : e.ask === "error" ? "error" : "waiting") : e.kind
  const Icon = a?.icon ?? KIND_ICON[kind] ?? Bell
  return (
    <Badged on={!e.read}>
      <Icon className={className} strokeWidth={2} style={{ color: a?.tint ?? KIND_TINT[kind] ?? "var(--muted-foreground)" }} />
    </Badged>
  )
}

const WHY: Record<string, string> = { permission: "Asks permission", question: "Asks you", auth: "Sign in", plan: "Plan to approve", report: "Report", error: "Failed" }
const standing = (e: InboxEvent) => (e.state === "working" ? "Working on it" : e.state === "open" && e.kind !== "info" ? WHY[e.ask ?? ""] ?? "" : "")

const iconButton = "grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground max-md:size-9"

const pageSwipe = "-mx-2 bg-origin-content px-2"
const rowBox = "relative isolate flex min-h-11 items-center gap-3 py-2 before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] hover:before:bg-foreground/[0.04]"
const rowButton = "flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[6px] text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
export const rowTitle = "line-clamp-2 text-[15px] leading-[20px] max-md:text-[17px] max-md:leading-[22px]"
const onHover = "md:invisible md:group-hover/ev:visible"
const pickedRow = "data-[selected]:!bg-transparent data-[selected]:before:bg-primary/15"

export function ResultRow({ r, done }: { r: InboxItem; done?: boolean }) {
  const meta = [r.from && `from ${r.from}`, r.source && host(r.source), (r.updated || r.created) && fmtAgo((r.updated || r.created)!), done && "settled"]
    .filter(Boolean).join(" · ")
  const key = resultKey(r), picked = useSelected(SELECT, key)
  const draft = useHasDraft(pathOf(r))
  return (
    <SwipeRow actions={() => resultSwipe(r)} className={pageSwipe}>
    <div data-result={r.id} data-select-key={key} {...selectedAttr(picked)} onContextMenu={menuFor(rowMenu(SELECT, key, done ? () => settledItems(r) : resultItemsMenu(r)))}
      className={cn(`group/res ${rowBox}`, pickedRow, done && "opacity-60 hover:opacity-100")}>
      <button type="button" data-keyrow className={rowButton} onClick={(e) => { if (!selectClick(e, SELECT, key)) openFile(pathOf(r)) }}>
        {r.source ? <Globe className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={2} /> : <FileText className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={2} />}
        <span className="min-w-0 flex-1">
          <span className={rowTitle}>{r.title}</span>
          {(meta || draft) && <span className="block text-[13px] text-muted-foreground max-md:text-[15px] max-md:line-clamp-2 md:truncate"><DraftTag to={pathOf(r)} className="mr-1.5 align-[1px]" />{meta}</span>}
        </span>
      </button>
      {!done && r.do && <DoIt task={{ text: r.do }} done={() => void markDone(r)} />}
      {done
        ? <button type="button" className={iconButton} aria-label="Back to review" data-tip="Back to review" onClick={() => { haptic("medium"); void reopen(r) }}><RotateCcw className="size-4" strokeWidth={2.25} /></button>
        : <>
          <button type="button" className={iconButton} aria-label="Settle" data-tip="Settle" onClick={() => { haptic("medium"); void markDone(r) }}><Check className="size-4" strokeWidth={2.25} /></button>
          <button type="button" className={cn(iconButton, "max-md:hidden")} aria-label="Snooze" data-tip="Snooze" data-snooze onClick={snoozeBelow([resultKey(r)])}><Clock className="size-4" strokeWidth={2.25} /></button>
          <button type="button" className={iconButton} aria-label="More" data-tip="More" onClick={(e) => moreMenu(e, r)}><MoreHorizontal className="size-4" strokeWidth={2.25} /></button>
        </>}
    </div>
    </SwipeRow>
  )
}

const repliedInPlace = (e: InboxEvent) => e.kind === "session" && !answerable(e) && !(e.state === "open" && ["permission", "question", "auth", "plan"].includes(e.ask ?? ""))
const agentName = (e: InboxEvent, label?: string) => label ?? (e.source ? e.source[0].toUpperCase() + e.source.slice(1) : "the agent")

function RowReply({ e, close }: { e: InboxEvent; close: (back?: boolean) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const name = agentName(e, agentOf(e, useAgents())?.label)
  useEffect(() => { box.current?.querySelector<HTMLTextAreaElement>("textarea[data-reply]")?.focus({ preventScroll: true }); box.current?.scrollIntoView({ block: "nearest" }) }, [])
  return (
    <div ref={box} data-row-reply={e.id} className="pb-3 md:pl-[30px]" onKeyDown={(k) => { if (k.key === "Escape") { k.stopPropagation(); close(true) } }}>
      {e.body && <Markdown text={e.body} className="mb-3 max-h-64 overflow-y-auto break-words text-[15px] md:text-[14px]" />}
      <ReplyBox to={e.id} name={name} sent={() => { markRead([e.id]); close() }}
        open={() => openSession({ terminal: e.terminal, session: e.session, agent: e.source, machine: e.machine, host: e.host })} />
    </div>
  )
}

const replyingTo = new Set<string>()

export function EventRow({ e, fresh, touched }: { e: InboxEvent; fresh?: boolean; touched?: (id: string) => void }) {
  const read = e.read && !fresh, done = e.state === "done" && !fresh
  const key = eventKey(e), picked = useSelected(SELECT, key)
  const [whole, setWhole] = useState(false)
  const asks = answerable(e)
  const line = lineOf(e)
  const draft = useHasDraft(draftKey(e))
  const where = standing(e)
  const [replying, setOpen] = useState(() => replyingTo.has(e.id))
  const setReplying = (on: boolean) => { if (on) replyingTo.add(e.id); else replyingTo.delete(e.id); setOpen(on) }
  const inPlace = repliedInPlace(e)
  const reply = () => { haptic("light"); setReplying(!replying); if (!replying) touched?.(e.id) }
  return (
    <SwipeRow actions={() => eventSwipe(e, inPlace ? { label: "Reply", icon: MessageSquareReply, run: () => setReplying(true) } : undefined)} className={pageSwipe}>
    <div>
    <div data-event={e.id} data-kind={e.kind} data-state={e.state} data-unread={!read || undefined} data-select-key={key} {...selectedAttr(picked)}
      onContextMenu={menuFor(rowMenu(SELECT, key, eventItems(e, !read, touched)))}
      className={cn(`group/ev ${rowBox}`,
        pickedRow, done && !draft && "opacity-60 hover:opacity-100")}>
      <button type="button" data-keyrow className={rowButton} onClick={(ev) => { if (selectClick(ev, SELECT, key)) return; if (!targetOf(e)) { setWhole(!whole); markRead([e.id]); return } openEvent(e); touched?.(e.id) }}>
        <EventIcon e={fresh ? { ...e, read: false } : e} className="size-[18px] shrink-0" />
        <span className="min-w-0 flex-1">
          <span className={cn(rowTitle, !read && "font-semibold")}>{e.title}</span>
          {(e.body || e.machineLabel || e.parent || e.from || draft || where) && <span data-tip={whole ? undefined : line} data-tip-trunc
            className={cn("block text-[13px] text-muted-foreground max-md:text-[15px]", whole ? "whitespace-pre-wrap break-words" : "max-md:line-clamp-2 md:truncate")}><DraftTag to={draftKey(e)} className="mr-1.5 align-[1px]" />
            {where && <span data-standing className={cn("font-medium", e.state === "working" ? "text-tertiary" : "text-foreground/80")}>{where}{((line && !replying) || e.machineLabel || e.parent || e.from) && " · "}</span>}
            {[e.parent && `from ${threadTitle(e.parent)}`, e.from && `from ${threadTitle(e.from)}`, replying ? "" : whole ? e.body : line, e.machineLabel && `on ${e.machineLabel}`].filter(Boolean).join(" · ")}</span>}
        </span>
        {!asks && <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums max-md:text-[15px]">{fmtAgo(e.t, { short: true })}</span>}
      </button>
      <GateButtons e={e} className={iconButton} size="size-4" />
      {inPlace && (
        <button type="button" className={cn(iconButton, !replying && onHover, replying && "text-foreground")} aria-label="Reply" data-tip="Reply"
          aria-expanded={replying} data-row-reply-button onClick={reply}><MessageSquareReply className="size-4" strokeWidth={2.25} /></button>
      )}
      {!asks && (e.state === "done"
        ? <button type="button" className={cn(iconButton, onHover)} aria-label="Back to inbox" data-tip="Back to inbox" onClick={() => { haptic("medium"); markManyEventsDone([e], false) }}>
          <RotateCcw className="size-4" strokeWidth={2.25} /></button>
        : <button type="button" className={cn(iconButton, onHover)} aria-label="Settle" data-tip="Settle" data-done onClick={() => { haptic("medium"); markManyEventsDone([e]); touched?.(e.id) }}>
          <Check className="size-4" strokeWidth={2.25} /></button>)}
      {snoozable(e) && e.state !== "working" && (
        <button type="button" className={cn(iconButton, `max-md:hidden ${onHover}`)} aria-label="Snooze" data-tip="Snooze" data-snooze
          onClick={snoozeBelow([eventKey(e)])}><Clock className="size-4" strokeWidth={2.25} /></button>
      )}
      {!asks && <button type="button" className={cn(iconButton, onHover)} aria-label="More" data-tip="More" onClick={rightClickBelow}>
        <MoreHorizontal className="size-4" strokeWidth={2.25} /></button>}
    </div>
    {replying && inPlace && <RowReply e={e} close={(back) => { setReplying(false); if (back) document.querySelector<HTMLElement>(`[data-event="${CSS.escape(e.id)}"] [data-keyrow]`)?.focus({ preventScroll: true }) }} />}
    </div>
    </SwipeRow>
  )
}

export function SnoozedRow({ sel, title, until, icon, open: openIt, swipe }: { sel: string; title: string; until: number; icon: ReactNode; open: () => void; swipe: () => SwipeAction[] }) {
  const picked = useSelected(SELECT, sel)
  return (
    <SwipeRow actions={swipe} className={pageSwipe}>
      <div data-snoozed={sel} data-select-key={sel} {...selectedAttr(picked)}
        onContextMenu={menuFor(rowMenu(SELECT, sel, () => [{ label: "Wake", icon: AlarmClockOff, run: () => snoozeKeys([sel], null) }, snoozeMenu([sel])]))}
        className={cn(`group/sn ${rowBox}`, pickedRow)}>
        <button type="button" data-keyrow className={rowButton} onClick={(e) => { if (!selectClick(e, SELECT, sel)) openIt() }}>
          {icon}
          <span className="min-w-0 flex-1">
            <span className={rowTitle}>{title}</span>
            <span className="block truncate text-[13px] text-muted-foreground max-md:text-[15px]">Until {whenText(new Date(until)).replace(/^Tomorrow/, "tomorrow")}</span>
          </span>
        </button>
        <button type="button" className={iconButton} aria-label="Wake" data-tip="Wake" onClick={() => { haptic("medium"); snoozeKeys([sel], null) }}>
          <AlarmClockOff className="size-4" strokeWidth={2.25} /></button>
      </div>
    </SwipeRow>
  )
}
