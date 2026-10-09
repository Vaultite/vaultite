// The Inbox drawn (header button, panel, tab, block): only what needs the user, results to review and agents' unread
// events; read ones are on the page, folded under Read (with the setting show_read, the last day's stay, greyed).
import { useEffect, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react"
import {
  Bell, Check, CheckCheck, ChevronRight, CircleAlert, CircleCheck, ExternalLink, FileText, FolderInput, Globe, Inbox as InboxIcon, Mail, MailOpen, Maximize2,
  ListChecks, MessageCircleQuestion, MoreHorizontal, RotateCcw, ShieldAlert, Trash2, X,
} from "lucide-react"
import {
  askMove, askMoveMany, Badged, cn, currentFile, Empty, getStore, fmtAgo, haptic, isArchived, isViewOpen, menuBelow, menuFor, notify, notifyError, openFile, openView, optimistic, Panel, pluginFileGroups, put,
  rowMenu, selectClick, selectedAttr, setProperty, SheetHead, SidebarHeading, startSelecting, SwipeRow, useAgents, useSelectable, useSelected, useSelecting, useSidebars, useStore, useTick,
  type MenuItem, type SidebarCtx, type Store, type SwipeAction,
} from "@vaultite"
import { useSettings } from "./settings"
import { agentOf, answerGate, forget, getEvents, markRead, markSeen, markUnread, openEvent, subscribeEvents, targetOf } from "./events"
import type { InboxEvent, InboxItem } from "./types"

export const useEvents = () => useSyncExternalStore(subscribeEvents, getEvents)

/** The results waiting for review: status new, newest first (the store's order). */
export const toReview = (store: Store): InboxItem[] => (store.inbox ?? []).filter((r) => r.status === "new" && !isArchived(r))

/** The results already dealt with: done (so in Inbox/.archive/; an old one archived without it too), newest first. */
const settled = (store: Store): InboxItem[] => (store.inbox ?? []).filter((r) => r.status !== "new" || isArchived(r))

/** How many things are new: unread events and results to review. */
export function useCount(store: Store) {
  const { unread } = useEvents()
  return unread + toReview(store).length
}

export const openInbox = () => openView("inbox", { newTab: !isViewOpen("view:inbox") })

const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000))
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}

const DAY = 86_400_000

/** The events to draw: every unread one (and `keep`'s, still drawn as new); with `read`, then read ones from the last
 *  day, up to `max` rows. `earlier` is how many fold away. */
export function fold(events: InboxEvent[], max: number, keep?: ReadonlySet<string>, read = false) {
  const since = Date.now() - DAY
  const isNew = (e: InboxEvent) => !e.read || !!keep?.has(e.id)
  let room = read ? max - events.filter(isNew).length : 0
  const shown = events.filter((e) => isNew(e) || (e.t >= since && room-- > 0))
  return { shown, earlier: events.length - shown.length }
}

/** "Show N earlier" / "Show less", per list (not saved), with show_read; without it the read ones are left out: `rest`. */
function useFold(events: InboxEvent[], max: number, keep?: ReadonlySet<string>) {
  const [all, setAll] = useState(false)
  const read = useSettings().show_read === true
  const { shown, earlier } = fold(events, max, keep, read)
  const kept = new Set(shown)
  return { shown: all ? events : shown, earlier: read ? earlier : 0, rest: read ? [] : events.filter((e) => !kept.has(e)), all, toggle: () => setAll(!all) }
}

// ---------- results: what a row can do

const pathOf = (r: InboxItem) => `${r.id}.md`

/** Change a result's fields, on screen at once; it answers the result as it is now (done moves it into Inbox/.archive/:
 *  a new id). */
function change(r: InboxItem, fields: Record<string, unknown>): Promise<InboxItem> {
  const now = { ...fields, ...("status" in fields ? { archived: fields.status === "done" } : {}) }
  return optimistic((s) => ({ ...s, inbox: (s.inbox ?? []).map((x) => (x.id === r.id ? { ...x, ...now } as InboxItem : x)) }),
    () => put<InboxItem | null>(`inbox/${encodeURIComponent(r.id)}`, fields).then((out) => out ?? r), "Couldn't change it")
}

/** Done: out of the way, into Inbox/.archive/ (the server makes done archived). Done on the result being read: the
 *  next one to review takes its place (Undo brings it back), rather than its tab following it into the archive. */
export function markDone(r: InboxItem, done = true) {
  const next = done && currentFile() === pathOf(r) ? nextToReview(r) : undefined
  const now = change(r, { status: done ? "done" : "new" })
  if (next) openFile(pathOf(next))
  if (done) notify(`Marked “${r.title}” done`, { action: { label: "Undo", run: async () => {
    const back = await change(await now, { status: "new" })
    if (next) openFile(pathOf(back))
  } } })
  return now
}

/** The result after `r` in what's to review (the one before, when it's the last). */
function nextToReview(r: InboxItem) {
  const list = toReview(getStore() ?? ({} as Store)), i = list.findIndex((x) => x.id === r.id)
  return i < 0 ? undefined : list[i + 1] ?? list[i - 1]
}

/** File it into another folder: it's no longer an inbox item there (its `type` and `status` go), then it moves (Undo). */
export function fileTo(r: InboxItem) {
  const p = pathOf(r)
  askMove(p, { before: () => unInbox(p) })
}
const unInbox = async (p: string) => { await setProperty(p, "status", undefined); await setProperty(p, "type", undefined) }

// ---------- several at once (selected together: ⌘- or ⇧-click, a phone's Select)

/** The Inbox's selection: results as `r:<id>`, events as `e:<id>`, wherever the Inbox is drawn. */
const SELECT = "inbox"
const resultKey = (r: InboxItem) => `r:${r.id}`, eventKey = (e: InboxEvent) => `e:${e.id}`

/** Done (or back to review) for several: one toast, its Undo for all of them. */
async function markManyDone(list: InboxItem[], done = true) {
  const all = await Promise.allSettled(list.map((r) => change(r, { status: done ? "done" : "new", ...(done ? {} : { archived: false }) })))
  const now = all.flatMap((x) => (x.status === "fulfilled" ? [x.value] : []))
  if (now.length) notify(`${done ? "Marked" : "Put back"} ${now.length} ${now.length === 1 ? "result" : "results"} ${done ? "done" : "to review"}`,
    { action: { label: "Undo", run: () => void markManyDone(now, !done) } })
}

/** What the selected rows can do: each item only for the kind it's about (results, events), on all of them. */
function selectionItems(store: Store, keys: string[]): MenuItem[] {
  const all = store.inbox ?? [], { events } = getEvents()
  const results = all.filter((r) => keys.includes(resultKey(r)))
  const fresh = results.filter((r) => r.status === "new" && !isArchived(r)), dealt = results.filter((r) => !fresh.includes(r))
  const evs = events.filter((e) => keys.includes(eventKey(e)))
  const out: MenuItem[] = []
  if (fresh.length) out.push(
    { label: "Done", icon: Check, run: () => void markManyDone(fresh) },
    { label: "File to…", icon: FolderInput, run: () => askMoveMany(fresh.map(pathOf), { before: unInbox }) },
  )
  if (dealt.length) out.push({ label: "Back to review", icon: RotateCcw, run: () => void markManyDone(dealt, false) })
  if (evs.some((e) => !e.read)) out.push({ label: "Mark as read", icon: MailOpen, sep: out.length > 0, run: () => markRead(evs.map((e) => e.id)) })
  if (evs.some((e) => e.read)) out.push({ label: "Mark as unread", icon: Mail, sep: out.length > 0 && !evs.some((e) => !e.read), run: () => markUnread(evs.filter((e) => e.read).map((e) => e.id)) })
  if (evs.length) out.push({ label: "Dismiss", icon: X, run: () => evs.forEach((e) => forget(e.id)) })
  return out
}
/** Make the Inbox's rows selectable here (the panel, the page, the block). */
function useInboxSelect(store: Store) {
  useSelectable(SELECT, { menu: (keys) => selectionItems(store, keys), noun: ["item", "items"] })
}

/** Phones: a row swiped sideways shows what's done with it most (SwipeRow): Done and File to…, back to review, Dismiss. */
const resultSwipe = (r: InboxItem): SwipeAction[] => r.status === "new" && !isArchived(r)
  ? [{ label: "File to", icon: FolderInput, run: () => fileTo(r) }, { label: "Done", icon: Check, run: () => markDone(r), removes: true }]
  : [{ label: "To review", icon: RotateCcw, run: () => reopen(r), removes: true }]
const eventSwipe = (e: InboxEvent): SwipeAction[] => [
  ...(!e.read ? [{ label: "Read", icon: MailOpen, run: () => markRead([e.id]) }] : []),
  { label: "Dismiss", icon: X, run: () => forget(e.id), danger: true, removes: true },
]

// (then what other plugins do with a file, like Dispatch's agents)
const resultItems = (r: InboxItem): MenuItem[] => [
  { label: "Open", icon: FileText, run: () => openFile(pathOf(r)) },
  ...(r.source && /^https?:/.test(r.source) ? [{ label: "Open the page", icon: Globe, run: () => void window.open(r.source, "_blank", "noopener") }] : []),
  { label: "File to…", icon: FolderInput, sep: true, run: () => fileTo(r) },
  ...pluginFileGroups(pathOf(r), "inbox").rest.flat().map((it, i) => ({ ...it, sep: i === 0 })),
]

function moreMenu(e: MouseEvent, r: InboxItem) {
  menuBelow(e, resultItems(r))
}

/** A result dealt with, back to review: new, and out of the archive. */
const reopen = (r: InboxItem) => change(r, { status: "new", archived: false })
const settledItems = (r: InboxItem): MenuItem[] => [resultItems(r)[0], { label: "Back to review", icon: RotateCcw, sep: true, run: () => void reopen(r) }]

/** A result's right-click: Done, then what its … button has. */
const resultItemsMenu = (r: InboxItem) => () => [{ label: "Done", icon: Check, run: () => markDone(r) }, { ...resultItems(r)[0], sep: true }, ...resultItems(r).slice(1)]

/** An event's right-click. `shownNew`: drawn as new (unread, or still new on the Inbox page); `touched`: the user read
 *  or unread it here (the page stops drawing it as new). */
const eventItems = (e: InboxEvent, shownNew: boolean, touched?: (id: string) => void) => (): MenuItem[] => [
  ...(targetOf(e) ? [{ label: "Open", icon: ExternalLink, run: () => { openEvent(e); touched?.(e.id) } }] : []),
  shownNew
    ? { label: "Mark as read", icon: MailOpen, run: () => { markRead([e.id]); touched?.(e.id) } }
    : { label: "Mark as unread", icon: Mail, run: () => markUnread([e.id]) },
  { label: "Dismiss", icon: X, sep: true, run: () => forget(e.id) },
]

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return "" } }

// ---------- events: how one looks

const KIND_ICON: Record<string, typeof Bell> = { done: CircleCheck, waiting: MessageCircleQuestion, error: CircleAlert }
const KIND_TINT: Record<string, string> = { done: "var(--green)", waiting: "var(--orange)", error: "var(--red)" }

function EventIcon({ e, className }: { e: InboxEvent; className: string }) {
  const a = agentOf(e, useAgents())
  const Icon = a?.icon ?? KIND_ICON[e.kind] ?? Bell
  return (
    <Badged on={!e.read}>
      <Icon className={className} strokeWidth={2} style={{ color: a?.tint ?? KIND_TINT[e.kind] ?? "var(--muted-foreground)" }} />
    </Badged>
  )
}

const iconButton = "grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground max-md:size-9"

// ---------- the button in the sidebar's header

const PANEL = "inbox:inbox"
/** The Inbox panel is in a sidebar: its icon (folded) or its list (open) says what's new, so the button isn't needed. */
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

// ---------- the sidebar panel

/** The panel's icon in the folded sidebar's rail: a dot while something's new. */
export function InboxRailIcon({ className, strokeWidth }: { className?: string; strokeWidth?: number }) {
  const { store } = useStore()
  const n = useCount(store ?? ({} as Store))
  return <Badged on={n > 0}><InboxIcon className={className} strokeWidth={strokeWidth} /></Badged>
}

function PanelRow({ icon, label, time, active, dim, select, swipe, onClick, onContextMenu, children, ...rest }: {
  icon: ReactNode; label: string; time?: string; active?: boolean; dim?: boolean; onClick: () => void; onContextMenu?: (e: MouseEvent) => void; children?: ReactNode
  /** Its key in the Inbox's selection; `swipe`: what a phone's swipe shows. */
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
        {time && <span className="shrink-0 text-[11px] text-tertiary tabular-nums group-hover/row:hidden">{time}</span>}
        {children && <span className="hidden shrink-0 gap-0.5 group-hover/row:flex">{children}</span>}
      </a>
    </SwipeRow>
  )
}

const stop = (fn: () => void) => (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); fn() }

const answer = (e: InboxEvent, a: "approve" | "deny") => (haptic("medium"), answerGate(e, a)).then(
  () => notify(a === "approve" ? "Approved" : "Denied"), (err) => notifyError(err, "Couldn't answer it"))

/** A row shows all of what it asks: one short line. */
const shownWhole = (e: InboxEvent) => !e.body || (e.body.length <= 80 && !e.body.includes("\n"))

/** Approve and Deny, on a permission the server waits on (an app connected to the MCP) that isn't answered yet. Approve
 *  answers at once only when the row shows the whole request; else it opens it. */
function GateButtons({ e, className, size }: { e: InboxEvent; className: string; size: string }) {
  if (!e.gate || e.answer) return null
  return <>
    <button type="button" className={className} aria-label="Approve" data-tip="Approve" data-gate="approve" onClick={stop(() => shownWhole(e) ? void answer(e, "approve") : openEvent(e))}>
      <Check className={size} strokeWidth={2.25} /></button>
    <button type="button" className={className} aria-label="Deny" data-tip="Deny" data-gate="deny" onClick={stop(() => void answer(e, "deny"))}>
      <X className={size} strokeWidth={2.25} /></button>
  </>
}
export const gateTitle = (id: string) => getEvents().events.find((e) => e.id === id)?.title ?? "Asks for your yes"
const gateButton = "h-9 cursor-pointer rounded-[8px] px-3.5 text-[15px] font-medium transition-colors md:h-8 md:text-[13px]"

/** A permission the server waits on, in a sheet: what it asks to run, whole, in a box that scrolls, and the answer. */
export function GateSheet({ id }: { id: string }) {
  const e = useEvents().events.find((x) => x.id === id)
  if (!e) return <Empty>This request is gone: asked again, it comes back.</Empty>
  return (
    <div data-gate-sheet={e.id}>
      <SheetHead icon={ShieldAlert} tint="var(--orange)" kicker="Inbox" title={e.title}
        sub={e.answer ? (e.answer === "approve" ? "Approved" : "Denied") : undefined} />
      {e.body && <pre data-gate-body className="max-h-[60vh] overflow-auto rounded-[10px] bg-muted p-3 font-mono text-[12px] leading-[17px] break-words whitespace-pre-wrap">{e.body}</pre>}
      {!e.answer && (
        <div className="mt-3 flex gap-2">
          <button type="button" data-gate="approve" onClick={() => void answer(e, "approve")} className={cn(gateButton, "bg-primary text-primary-foreground hover:opacity-90")}>Approve</button>
          <button type="button" data-gate="deny" onClick={() => void answer(e, "deny")} className={cn(gateButton, "bg-foreground/[0.06] hover:bg-foreground/[0.1]")}>Deny</button>
        </div>
      )}
    </div>
  )
}

/** The row that unfolds (or folds back) the earlier events. */
function FoldButton({ earlier, all, toggle, className }: { earlier: number; all: boolean; toggle: () => void; className: string }) {
  if (!earlier) return null
  return (
    <button type="button" data-inbox-fold={all ? "open" : "closed"} onClick={toggle}
      className={cn("cursor-pointer text-left text-tertiary hover:text-foreground", className)}>
      {all ? "Show less" : `Show ${earlier} earlier`}
    </button>
  )
}

const small = "grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"

export function InboxPanel({ store, open, file }: SidebarCtx) {
  const { events, unread } = useEvents()
  const results = toReview(store)
  const { shown: latest, earlier, all, toggle } = useFold(events, 8)
  useTick()
  useInboxSelect(store)
  if (!open) return null
  return (
    <div className="flex shrink-0 flex-col" data-inbox-panel>
      <SidebarHeading title="Inbox" open={open}>
        {unread > 0 && <button type="button" className={small} aria-label="Mark all read" data-tip="Mark all read" onClick={() => markRead()}>
          <CheckCheck className="size-3.5" strokeWidth={2.25} /></button>}
        <button type="button" className={small} aria-label="Open inbox" data-tip="Open inbox" onClick={openInbox}>
          <Maximize2 className="size-3.5" strokeWidth={2.25} /></button>
      </SidebarHeading>
      <div className="flex flex-col gap-px pb-1" data-select-list={SELECT}>
        {results.map((r) => (
          <PanelRow key={r.id} data-result={r.id} select={resultKey(r)} swipe={() => resultSwipe(r)} label={r.title} active={file === pathOf(r)} time={r.updated || r.created ? fmtAgo((r.updated || r.created)!).replace(/ ago$/, "") : undefined}
            icon={<Badged on><FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} /></Badged>} onClick={() => openFile(pathOf(r))} onContextMenu={menuFor(rowMenu(SELECT, resultKey(r), resultItemsMenu(r)))}>
            <button type="button" className={small} aria-label="Done" data-tip="Done" onClick={stop(() => { haptic("medium"); void markDone(r) })}><Check className="size-3.5" strokeWidth={2.25} /></button>
            <button type="button" className={small} aria-label="More" data-tip="More" onClick={(e) => { e.preventDefault(); e.stopPropagation(); moreMenu(e, r) }}>
              <MoreHorizontal className="size-3.5" strokeWidth={2.25} /></button>
          </PanelRow>
        ))}
        {latest.map((e) => (
          <PanelRow key={e.id} data-event={e.id} data-kind={e.kind} select={eventKey(e)} swipe={() => eventSwipe(e)} label={e.body ? `${e.title}: ${e.body}` : e.title} time={ago(e.t)}
            dim={e.read} icon={<EventIcon e={e} className="size-4 shrink-0" />} onClick={() => openEvent(e)} onContextMenu={menuFor(rowMenu(SELECT, eventKey(e), eventItems(e, !e.read)))}>
            <GateButtons e={e} className={small} size="size-3.5" />
            <button type="button" className={small} aria-label="Dismiss" data-tip="Dismiss" onClick={stop(() => { haptic("medium"); void forget(e.id) })}><X className="size-3.5" strokeWidth={2.25} /></button>
          </PanelRow>
        ))}
        {!results.length && !latest.length && <p className="h-7 pl-1.5 text-[13px] leading-7 text-tertiary">Nothing new</p>}
        <FoldButton earlier={earlier} all={all} toggle={toggle} className="h-7 rounded-[5px] pl-1.5 text-[13px] hover:bg-foreground/[0.04]" />
      </div>
    </div>
  )
}

// ---------- the page (view:inbox) and the block

/** A page row's swipe box: as wide as its hover shade (8px out each side), its separator line still the row's width. */
const pageSwipe = "-mx-2 bg-origin-content px-2"
/** A page row's selected look: the shade behind it (its `before:`), as the sidebar's rows have theirs. */
const pickedRow = "data-[selected]:!bg-transparent data-[selected]:before:bg-primary/15"

function ResultRow({ r, done }: { r: InboxItem; done?: boolean }) {
  const meta = [r.from && `from ${r.from}`, r.source && host(r.source), (r.updated || r.created) && fmtAgo((r.updated || r.created)!), done && "done"]
    .filter(Boolean).join(" · ")
  const key = resultKey(r), picked = useSelected(SELECT, key)
  return (
    <SwipeRow actions={() => resultSwipe(r)} className={pageSwipe}>
    <div data-result={r.id} data-select-key={key} {...selectedAttr(picked)} onContextMenu={menuFor(rowMenu(SELECT, key, done ? () => settledItems(r) : resultItemsMenu(r)))}
      className={cn("group/res relative isolate flex min-h-11 items-center gap-3 py-2 before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] hover:before:bg-foreground/[0.04]", pickedRow, done && "opacity-60 hover:opacity-100")}>
      <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left" onClick={(e) => { if (!selectClick(e, SELECT, key)) openFile(pathOf(r)) }}>
        {r.source ? <Globe className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={2} /> : <FileText className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={2} />}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[15px] leading-[20px]">{r.title}</span>
          {meta && <span className="block text-[13px] text-muted-foreground max-md:line-clamp-2 md:truncate">{meta}</span>}
        </span>
      </button>
      {done
        ? <button type="button" className={iconButton} aria-label="Back to review" data-tip="Back to review" onClick={() => { haptic("medium"); void reopen(r) }}><RotateCcw className="size-4" strokeWidth={2.25} /></button>
        : <>
          <button type="button" className={iconButton} aria-label="Done" data-tip="Done" onClick={() => { haptic("medium"); void markDone(r) }}><Check className="size-4" strokeWidth={2.25} /></button>
          <button type="button" className={iconButton} aria-label="More" data-tip="More" onClick={(e) => moreMenu(e, r)}><MoreHorizontal className="size-4" strokeWidth={2.25} /></button>
        </>}
    </div>
    </SwipeRow>
  )
}

function EventRow({ e, fresh, touched }: { e: InboxEvent; fresh?: boolean; touched?: (id: string) => void }) {
  const read = e.read && !fresh
  const key = eventKey(e), picked = useSelected(SELECT, key)
  // (one that leads nowhere opens in place, its whole body, and stays where it is while the page shows it)
  const [whole, setWhole] = useState(false)
  return (
    <SwipeRow actions={() => eventSwipe(e)} className={pageSwipe}>
    <div data-event={e.id} data-kind={e.kind} data-unread={!read || undefined} data-select-key={key} {...selectedAttr(picked)}
      onContextMenu={menuFor(rowMenu(SELECT, key, eventItems(e, !read, touched)))}
      className={cn("group/ev relative isolate flex min-h-11 items-center gap-3 py-2 before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] hover:before:bg-foreground/[0.04]",
        pickedRow, read && "opacity-50 hover:opacity-100")}>
      <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left" onClick={(ev) => { if (selectClick(ev, SELECT, key)) return; if (!targetOf(e)) { setWhole(!whole); markRead([e.id]); return } openEvent(e); touched?.(e.id) }}>
        <EventIcon e={fresh ? { ...e, read: false } : e} className="size-[18px] shrink-0" />
        <span className="min-w-0 flex-1">
          <span className={cn("line-clamp-2 text-[15px] leading-[20px]", (!e.read || fresh) && "font-medium")}>{e.title}</span>
          {(e.body || e.machineLabel) && <span data-tip={whole ? undefined : e.body} data-tip-trunc
            className={cn("block text-[13px] text-muted-foreground", whole ? "whitespace-pre-wrap break-words" : "max-md:line-clamp-2 md:truncate")}>{[e.body, e.machineLabel && `on ${e.machineLabel}`].filter(Boolean).join(" · ")}</span>}
        </span>
        <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">{ago(e.t)}</span>
      </button>
      <GateButtons e={e} className={iconButton} size="size-4" />
      <button type="button" className={cn(iconButton, "md:invisible md:group-hover/ev:visible")} aria-label="Dismiss" data-tip="Dismiss" onClick={() => { haptic("medium"); void forget(e.id) }}>
        <X className="size-4" strokeWidth={2.25} /></button>
    </div>
    </SwipeRow>
  )
}

/** What's dealt with, last on the page and folded: "Read N", "Done N". */
function Folded({ label, n, attr, children }: { label: string; n: number; attr: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  if (!n) return null
  return (
    <section {...{ [attr]: open ? "open" : "closed" }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="mb-1 flex cursor-pointer items-center gap-1 text-[13px] font-semibold text-muted-foreground hover:text-foreground">
        <ChevronRight className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} strokeWidth={2.5} />
        {label} <span className="font-normal tabular-nums">{n}</span>
      </button>
      {open && <div className="hairline">{children}</div>}
    </section>
  )
}

/** The results dealt with: done (or archived). */
function Settled({ store }: { store: Store }) {
  const list = settled(store)
  return <Folded label="Done" n={list.length} attr="data-inbox-settled">{list.map((r) => <ResultRow key={r.id} r={r} done />)}</Folded>
}

function Lists({ store, events: ne, results: nr, fresh, touched, all: dealt }: {
  store: Store; events: number; results: number; fresh?: ReadonlySet<string>; touched?: (id: string) => void
  /** With what's dealt with, folded at the bottom (the Inbox page). */
  all?: boolean
}) {
  const { events, ready } = useEvents()
  const results = toReview(store).slice(0, nr)
  const { shown: latest, earlier, rest, all, toggle } = useFold(ne ? events : [], ne, fresh)
  useTick()
  useInboxSelect(store)
  const more = <FoldButton earlier={earlier} all={all} toggle={toggle} className="mt-1 h-8 text-[13px]" />
  const past = dealt && <>
    <Folded label="Read" n={rest.length} attr="data-inbox-read">{rest.map((e) => <EventRow key={e.id} e={e} touched={touched} />)}</Folded>
    <Settled store={store} />
  </>
  if (!results.length && !latest.length) return <><Empty>{ready || !ne ? "Nothing new." : "Loading…"}</Empty>{more}{dealt && <div className="mt-4 flex flex-col gap-4" data-select-list={SELECT}>{past}</div>}</>
  return (
    <div className="flex flex-col gap-4" data-select-list={SELECT}>
      {results.length > 0 && (
        <section data-inbox-results>
          <h3 className="mb-1 text-[13px] font-semibold text-muted-foreground">To review</h3>
          <div className="hairline">{results.map((r) => <ResultRow key={r.id} r={r} />)}</div>
        </section>
      )}
      {(latest.length > 0 || earlier > 0) && (
        <section data-inbox-events>
          <h3 className="mb-1 text-[13px] font-semibold text-muted-foreground">From your agents</h3>
          {latest.length > 0 && <div className="hairline">{latest.map((e) => <EventRow key={e.id} e={e} fresh={fresh?.has(e.id)} touched={touched} />)}</div>}
          {more}
        </section>
      )}
      {past}
    </div>
  )
}

/** ```block-inbox: what's new, on a dashboard (Today). */
export function InboxBlock({ store, options }: { store: Store; options: Record<string, unknown> }) {
  const n = useCount(store)
  return (
    <Panel title={String(options.title || "Inbox")} icon={InboxIcon} tint="var(--inbox)"
      action={n > 0 ? <button type="button" className="cursor-pointer text-[13px] font-medium text-primary hover:underline" onClick={openInbox}>{n} new</button> : undefined}>
      <Lists store={store} events={Number(options.events ?? 5)} results={Number(options.results ?? 10)} />
    </Panel>
  )
}

/** The Inbox in a tab: while focused, events are read (not ones marked unread by hand), but the ones new when they came
 *  into view stay marked new until it closes, since the tab stays drawn while hidden. */
export function InboxPage({ store, focused }: { store: Store; focused: boolean }) {
  const { events, unread } = useEvents()
  const selectingHere = useSelecting(SELECT)
  // What was unread when it came into view: still drawn as new after it's read here.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set(events.filter((e) => !e.read).map((e) => e.id)))
  const more = events.filter((e) => !e.read && !fresh.has(e.id))
  if (more.length) setFresh(new Set([...fresh, ...more.map((e) => e.id)]))
  const touched = (id: string) => setFresh((f) => { const next = new Set(f); next.delete(id); return next })
  useEffect(() => {
    if (!focused || !unread) return
    const t = setTimeout(() => { if (document.visibilityState === "visible") markSeen() }, 1200)
    return () => clearTimeout(t)
  }, [focused, unread])
  return (
    <div className="pb-10" data-inbox-view>
      <div className="mb-1 flex items-center gap-2">
        <h1 className="flex-1 text-[22px] leading-[28px] font-bold max-md:hidden">Inbox</h1>
        {events.length > 0 && (
          <button type="button" onClick={() => forget()} className="flex h-7 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-[13px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground max-md:ml-auto">
            <Trash2 className="size-3.5" strokeWidth={2.25} />Clear events
          </button>
        )}
        {/* Phones (no ⌘ or ⇧): pick several with taps, then the bar's Actions. */}
        {(events.length > 0 || (store.inbox ?? []).length > 0) && !selectingHere && (
          <button type="button" onClick={() => startSelecting(SELECT)} data-inbox-select
            className={cn("flex h-7 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-[13px] text-primary hover:bg-foreground/[0.06] md:hidden", !events.length && "ml-auto")}>
            <ListChecks className="size-3.5" strokeWidth={2.25} />Select
          </button>
        )}
      </div>
      <p className="mb-4 text-[13px] text-muted-foreground">
        Results to review (files in Inbox/) and what your coding agents said: finished, waiting for you. Events are kept on this machine until read, then for a week.
      </p>
      <Lists store={store} events={20} results={100} fresh={fresh} touched={touched} all />
    </div>
  )
}
