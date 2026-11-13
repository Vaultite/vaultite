import type { MouseEvent, ReactNode } from "react"
import { Check, CheckCheck, CircleCheck, Clock, FileText, Inbox as InboxIcon, ListTodo, Maximize2, MessageCircleQuestion, MoreHorizontal, Pin } from "lucide-react"
import {
  Badged, cn, fmtAgo, haptic, HeadingButton, menuFor, openFile, rightClickBelow, rowMenu, selectClick, selectedAttr, SidebarHeading, SwipeRow, useSelected, useSidebars, useStore, useTick, type SidebarCtx, type SwipeAction,
} from "@vaultite"
import { answerable, markRead, openEvent, snoozable, useEvents } from "./events"
import type { InboxEvent } from "./types"
import { DraftTag } from "./Reply"
import { acceptAll, keepDefault } from "./DecisionRows"
import { listsOf, useBack, useCount, openInbox, pathOf, SELECT, resultKey, eventKey, markDone, markManyEventsDone } from "./items"
import { snoozeBelow } from "./Snoozing"
import { useInboxSelect, resultSwipe, eventSwipe, moreMenu, resultItemsMenu, eventItems, decisionItems, decisionSwipe, stop } from "./menus"
import { GateButtons } from "./Gate"
import { lineOf, draftKey, EventIcon } from "./InboxRows"
import { useCap, FoldButton } from "./Sections"

const PANEL = "inbox:inbox"
const usePanelShown = () => { const s = useSidebars(); return s.left.includes(PANEL) || s.right.includes(PANEL) }

export function InboxButton({ store, open, phone }: SidebarCtx) {
  const n = useCount(store)
  const shown = usePanelShown()
  if (shown && !phone) return null
  const label = n ? `Inbox, ${n} new` : "Inbox"
  return (
    <button type="button" data-inbox-button data-count={n} onClick={openInbox} aria-label={label} data-tip={open && !phone ? label : undefined}
      data-tip-side={open ? undefined : "right"}
      className={cn("relative grid shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
        phone ? "size-11 rounded-[10px]" : "size-7")}>
      <InboxIcon className={phone ? "size-[22px]" : "size-4"} strokeWidth={2} />
      {n > 0 && (
        <span aria-hidden className={cn("absolute grid h-3.5 min-w-3.5 place-items-center rounded-full bg-primary px-[3px] text-[10px] leading-none font-semibold text-primary-foreground tabular-nums ring-[1.5px] ring-sidebar",
          phone ? "top-1 right-1" : "-top-0.5 -right-0.5")}>{n > 99 ? "99+" : n}</span>
      )}
    </button>
  )
}

export function InboxRailIcon({ className, strokeWidth }: { className?: string; strokeWidth?: number }) {
  const { store } = useStore()
  const n = useCount(store)
  return <Badged on={n > 0}><InboxIcon className={className} strokeWidth={strokeWidth} /></Badged>
}

function PanelRow({ icon, label, tag, time, active, dim, select, swipe, onClick, onContextMenu, children, ...rest }: {
  icon: ReactNode; label: string; tag?: ReactNode; time?: string; active?: boolean; dim?: boolean; onClick: () => void; onContextMenu?: (e: MouseEvent) => void; children?: ReactNode
  select: string; swipe: () => SwipeAction[]
} & Record<`data-${string}`, string | undefined>) {
  const picked = useSelected(SELECT, select)
  return (
    <SwipeRow actions={swipe} className="rounded-[5px]">
      <a href="#" data-keyrow data-tip={label} data-tip-trunc {...rest} data-select-key={select} {...selectedAttr(picked)} aria-label={label}
        onClick={(e) => { e.preventDefault(); if (!selectClick(e, SELECT, select)) onClick() }} onContextMenu={onContextMenu}
        className={cn("group/row flex h-7 items-center gap-2 rounded-[5px] pl-1.5 pr-1 text-[13px] whitespace-nowrap hover:bg-foreground/[0.04]", active && "bg-foreground/[0.08] font-medium",
          dim && "opacity-50 hover:opacity-100")}>
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {tag}
        {(time || children) && (
          <span className="grid shrink-0 items-center justify-items-end [&>*]:[grid-area:1/1]">
            {time && <span className={cn("text-[11px] text-tertiary tabular-nums", children && "group-hover/row:invisible")}>{time}</span>}
            {children && <span className="invisible flex gap-0.5 group-hover/row:visible">{children}</span>}
          </span>
        )}
      </a>
    </SwipeRow>
  )
}

const small = "grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"

export function InboxPanel({ store, open, file }: SidebarCtx) {
  const { unread, events } = useEvents()
  const l = listsOf(store, events)
  const { shown: rest, more, all, toggle } = useCap([...l.pinned.events, ...l.needs], l.messages, 8)
  useTick()
  useBack(store)
  useInboxSelect(store)
  if (!open) return null
  const pin = <Pin className="size-3 shrink-0 text-tertiary" strokeWidth={2.25} aria-label="Pinned" />
  const row = (e: InboxEvent) => (
    <PanelRow key={e.id} data-event={e.id} data-kind={e.kind} data-state={e.state} select={eventKey(e)} swipe={() => eventSwipe(e)}
      label={lineOf(e) ? `${e.title}: ${lineOf(e)}` : e.title} tag={<>{e.pinned && pin}<DraftTag to={draftKey(e)} short /></>}
      time={e.state === "working" ? "working" : fmtAgo(e.t, { short: true })} dim={e.state === "working"}
      icon={<EventIcon e={e} className="size-4 shrink-0" />} onClick={() => openEvent(e)} onContextMenu={menuFor(rowMenu(SELECT, eventKey(e), eventItems(e, !e.read)))}>
      <GateButtons e={e} className={small} size="size-3.5" />
      {!answerable(e) && <HeadingButton icon={Check} label="Settle" onClick={stop(() => { haptic("medium"); markManyEventsDone([e]) })} />}
      {snoozable(e) && e.state !== "working" && <HeadingButton icon={Clock} label="Snooze" onClick={snoozeBelow([eventKey(e)])} />}
      {!answerable(e) && <HeadingButton icon={MoreHorizontal} label="More" onClick={rightClickBelow} />}
    </PanelRow>
  )
  const empty = !l.decisions.length && !l.pinned.events.length && !l.pinned.results.length && !l.needs.length && !l.review.length && !rest.length
  return (
    <div className="flex shrink-0 flex-col" data-inbox-panel data-panel-empty={empty || undefined}>
      <SidebarHeading title="Inbox" open={open}>
        {l.decisions.length > 1 && <HeadingButton icon={ListTodo} label="Accept all defaults" onClick={() => void acceptAll(l.decisions)} />}
        {unread > 0 && <HeadingButton icon={CheckCheck} label="Mark all read" onClick={() => markRead()} />}
        <HeadingButton icon={Maximize2} label="Open inbox" onClick={openInbox} />
      </SidebarHeading>
      <div className="flex flex-col gap-px pb-1" data-select-list={SELECT}>
        {l.decisions.map((r) => (
          <PanelRow key={r.id} data-decision={r.id} select={resultKey(r)} swipe={() => decisionSwipe(r)} label={r.question!} active={file === pathOf(r)}
            time={r.created ? fmtAgo(r.created, { short: true }) : undefined}
            icon={r.blocking ? <MessageCircleQuestion className="size-4 shrink-0" strokeWidth={2} style={{ color: "var(--orange)" }} /> : <CircleCheck className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />}
            onClick={() => openFile(pathOf(r))} onContextMenu={menuFor(rowMenu(SELECT, resultKey(r), () => decisionItems(r)))}>
            <HeadingButton icon={Check} label={`Accept the default: ${r.default}`} onClick={stop(() => void keepDefault(r))} />
            <HeadingButton icon={Clock} label="Snooze" onClick={snoozeBelow([resultKey(r)])} />
          </PanelRow>
        ))}
        {l.pinned.events.map(row)}
        {l.needs.map(row)}
        {[...l.pinned.results, ...l.review].map((r) => (
          <PanelRow key={r.id} data-result={r.id} select={resultKey(r)} swipe={() => resultSwipe(r)} label={r.title} tag={<>{r.pinned && pin}<DraftTag to={pathOf(r)} short /></>} active={file === pathOf(r)} time={r.updated || r.created ? fmtAgo((r.updated || r.created)!, { short: true }) : undefined}
            icon={<Badged on><FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} /></Badged>} onClick={() => openFile(pathOf(r))} onContextMenu={menuFor(rowMenu(SELECT, resultKey(r), resultItemsMenu(r)))}>
            <HeadingButton icon={Check} label="Settle" onClick={stop(() => { haptic("medium"); void markDone(r) })} />
            <HeadingButton icon={Clock} label="Snooze" onClick={snoozeBelow([resultKey(r)])} />
            <HeadingButton icon={MoreHorizontal} label="More" onClick={(e) => { e.preventDefault(); e.stopPropagation(); moreMenu(e, r) }} />
          </PanelRow>
        ))}
        {rest.map(row)}
        {empty && <p className="h-7 pl-1.5 text-[13px] leading-7 text-tertiary">Nothing needs you.</p>}
        <FoldButton more={more} all={all} toggle={toggle} className="h-7 rounded-[5px] pl-1.5 text-[13px] hover:bg-foreground/[0.04]" />
      </div>
    </div>
  )
}
