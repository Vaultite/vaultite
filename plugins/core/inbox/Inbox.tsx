// The Inbox drawn (header button, panel, tab, block): the lists of threads.ts, snoozed and done folded away on the page.
// Reading only makes a row plain: a thread leaves once it's done.
import { useEffect, useState, type MouseEvent, type ReactNode } from "react"
import {
  AlarmClockOff, Bell, CalendarClock, Check, CheckCheck, ChevronRight, CircleAlert, CircleCheck, Clock, ExternalLink, FileText, FolderInput, Globe, Inbox as InboxIcon, Mail, MailOpen,
  Maximize2, ListChecks, MessageCircleQuestion, MoreHorizontal, RotateCcw, ShieldAlert, Trash2, X,
} from "lucide-react"
import {
  askMove, askMoveMany, backDetail, Badged, Button, cn, currentFile, del, detailPath, Empty, fmtAgo, getStore, haptic, HeadingButton, isViewOpen, Loading, LoadingRows, menuBelow, menuFor,
  notify, notifyError, openDetail, openFile, openMenu, openView, optimistic, Panel, pluginFileGroups, plural, put, rightClickBelow, rowMenu, selectClick, selectedAttr, setProperty, SheetHead, snippet,
  SidebarHeading, startSelecting, SwipeRow, useAgents, useKeptCount, useSelectable, useSelected, useSelecting, useSidebars, useStore, useTick, type MenuItem,
  type SidebarCtx, type Store, type SwipeAction,
} from "@vaultite"
import { agentOf, answerable, answerAsk, forget, getEvents, markEventsDone, markRead, markSeen, markUnread, openEvent, snoozable, snoozeEvents, targetOf, useEvents } from "./events"
import type { InboxEvent, InboxItem } from "./types"
import { choices, snoozed, snoozeMs, stampOf, whenText } from "./snooze"
import { countOf, latestOf, lists, reviewing } from "./threads"
import { useHasDraft } from "./drafts"
import { DraftTag } from "./Reply"


/** Not dealt with yet: to review, or snoozed. */
const open = (r: InboxItem) => reviewing(r)
const waiting = (r: InboxItem) => open(r) && !snoozed(r.snoozed)
/** The inbox's lists now (threads.ts), from the events and the store's results. */
const listsOf = (store: Store, events = getEvents().events, fresh?: ReadonlySet<string>) => lists(events, store.inbox ?? [], fresh)
/** The results waiting for review, newest first (one whose snooze just ended on top): not a thread's report, which its
 *  thread stands for. */
export const toReview = (store: Store): InboxItem[] => listsOf(store).review

/** Draw again when the next snooze ends, so what comes back shows (and counts) right then. */
export function useBack(store: Store) {
  const { events } = useEvents()
  const [, redraw] = useState(0)
  const now = Date.now()
  const next = Math.min(...[...(store.inbox ?? []).filter(open).map((r) => snoozeMs(r.snoozed)), ...events.map((e) => e.snoozed ?? 0)].filter((t) => t > now))
  useEffect(() => {
    if (!Number.isFinite(next)) return
    const t = setTimeout(() => redraw((n) => n + 1), Math.min(next - Date.now() + 100, 2 ** 31 - 1))
    return () => clearTimeout(t)
  }, [next])
}

/** What the badge counts: what needs the user (sessions, asks) and results to review; reading doesn't change it. */
export function useCount(store: Store) {
  useBack(store)
  return countOf(listsOf(store, useEvents().events))
}

export const openInbox = () => openView("inbox", { newTab: !isViewOpen("view:inbox") })


/** At most `max` rows of `rest` after `first` (which always show), "Show N more" for the others (per list, not saved). */
function useCap<T>(first: T[], rest: T[], max: number) {
  const [all, setAll] = useState(false)
  const room = Math.max(0, max - first.length)
  return { shown: all ? rest : rest.slice(0, room), more: Math.max(0, rest.length - room), all, toggle: () => setAll(!all) }
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

/** The result after `r` in what's to review (the one before, when it's the last), not one of `going` too. */
function nextToReview(r: InboxItem, going: InboxItem[] = [r]) {
  const all = toReview(getStore() ?? ({} as Store)), i = all.findIndex((x) => x.id === r.id)
  const list = all.filter((x) => x === r || !going.some((g) => g.id === x.id)), j = list.indexOf(all[i])
  return i < 0 ? undefined : list[j + 1] ?? list[j - 1]
}

/** File it into another folder: it's no longer an inbox item there (its `type` and `status` go), then it moves (Undo). */
export function fileTo(r: InboxItem) {
  const p = pathOf(r)
  askMove(p, { before: () => unInbox(p) })
}
const unInbox = async (p: string) => { await setProperty(p, "status", undefined); await setProperty(p, "type", undefined) }

// ---------- snooze: out of the way until a time, then back on top (the server wakes it, and tells the phone)

/** Snooze results and events (by selection key) till `at`, or bring them back now (null: their snooze ends now, so
 *  they're on top); the result being read gives its tab to the next one, as Done does. Undo puts each as it was. */
export function snoozeKeys(keys: string[], at: Date | null) {
  const results = (getStore()?.inbox ?? []).filter((r) => keys.includes(resultKey(r)) && open(r))
  const evs = getEvents().events.filter((e) => keys.includes(eventKey(e)) && (at ? snoozable(e) : !!e.snoozed))
  const reading = at && results.find((r) => currentFile() === pathOf(r))
  const next = reading ? nextToReview(reading, results) : undefined
  const now = at ?? new Date()
  for (const r of results) void change(r, { snoozed: stampOf(now) })
  if (evs.length) snoozeEvents(evs.map((e) => e.id), at ? at.getTime() : null)
  if (next) openFile(pathOf(next))
  const n = results.length + evs.length
  if (!n) return
  const what = n === 1 ? `“${results[0]?.title ?? evs[0].title}”` : plural(n, "item")
  notify(at ? `Snoozed ${what} until ${whenText(at)}` : `${what} back in the inbox`, { action: { label: "Undo", run: () => {
    for (const r of results) void change({ ...r, snoozed: stampOf(now) }, { snoozed: r.snoozed ?? null })
    for (const e of evs) snoozeEvents([e.id], snoozed(e.snoozed) ? e.snoozed! : null)
  } } })
}

/** The Snooze ▸ choices for these keys, then Pick a time… (a sheet). */
export const snoozeItems = (keys: string[]): MenuItem[] => [
  // (its time, without the day its name says)
  ...choices().map((c) => ({ label: c.label, hint: whenText(c.at).replace(/^Tomorrow /, ""), run: () => snoozeKeys(keys, c.at) })),
  { label: "Pick a time…", icon: CalendarClock, sep: true, run: () => openDetail(detailPath(SNOOZE_DETAIL, ...keys)) },
]
const snoozeMenu = (keys: string[], icon = true): MenuItem => ({ label: "Snooze", ...(icon ? { icon: Clock } : {}), run: () => {}, items: snoozeItems(keys) })
/** The choices as a menu under a button, or under a swiped row. */
const snoozeBelow = (keys: string[]) => (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); menuBelow(e, snoozeItems(keys)) }
const snoozeAtRow = (keys: string[]) => (row?: DOMRect) => openMenu({ x: row ? row.left + 16 : 16, y: row ? row.bottom + 4 : innerHeight / 3, flip: row ? row.top - 4 : undefined }, snoozeItems(keys))

/** The sheet's own time (Pick a time…): any time to come, tomorrow morning to start. */
export const SNOOZE_DETAIL = "inbox-snooze"
export function SnoozeSheet({ keys }: { keys: string[] }) {
  const tomorrow = choices().find((c) => c.key === "tomorrow")!.at
  const [v, setV] = useState(stampOf(tomorrow).slice(0, 16).replace(" ", "T"))
  const at = new Date(v), ok = !Number.isNaN(at.getTime()) && at.getTime() > Date.now()
  return (
    <div data-snooze-sheet>
      <SheetHead icon={Clock} tint="var(--inbox)" kicker="Inbox" title="Snooze until" sub={ok ? whenText(at) : "A time to come"} />
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!ok) return; snoozeKeys(keys, at); backDetail() }}>
        <input type="datetime-local" value={v} onChange={(e) => setV(e.target.value)} aria-label="Until" autoFocus
          className="h-11 min-w-0 flex-1 rounded-[8px] border-[0.5px] border-border bg-card px-2.5 text-[16px] outline-none focus:ring-2 focus:ring-primary/40 md:h-8 md:text-[13px]" />
        <Button type="submit" look="primary" className="h-11 px-4 md:h-8" disabled={!ok}>Snooze</Button>
      </form>
    </div>
  )
}

// ---------- several at once (selected together: ⌘- or ⇧-click, a phone's Select)

/** The Inbox's selection: results as `r:<id>`, events as `e:<id>`, wherever the Inbox is drawn. */
const SELECT = "inbox"
const resultKey = (r: InboxItem) => `r:${r.id}`, eventKey = (e: InboxEvent) => `e:${e.id}`

/** Done (or back to review) for several: one toast, its Undo for all of them. */
async function markManyDone(list: InboxItem[], done = true) {
  const all = await Promise.allSettled(list.map((r) => change(r, { status: done ? "done" : "new", ...(done ? {} : { archived: false }) })))
  const now = all.flatMap((x) => (x.status === "fulfilled" ? [x.value] : []))
  if (now.length) notify(`${done ? "Marked" : "Put back"} ${plural(now.length, "result")} ${done ? "done" : "to review"}`,
    { action: { label: "Undo", run: () => void markManyDone(now, !done) } })
}

/** Done (or back in the inbox) for several events: one toast, its Undo for all of them. */
function markManyEventsDone(evs: InboxEvent[], done = true) {
  if (!evs.length) return
  void markEventsDone(evs.map((e) => e.id), done)
  notify(evs.length === 1 ? `${done ? "Done" : "Back in the inbox"}: “${evs[0].title}”` : `${done ? "Marked" : "Put back"} ${plural(evs.length, "item")} ${done ? "done" : "in the inbox"}`,
    { action: { label: "Undo", run: () => void markEventsDone(evs.map((e) => e.id), !done) } })
}

/** What the selected rows can do: each item only for the kind it's about (results, events), on all of them. */
function selectionItems(store: Store, keys: string[]): MenuItem[] {
  const all = store.inbox ?? [], { events } = getEvents()
  const results = all.filter((r) => keys.includes(resultKey(r)))
  const fresh = results.filter(waiting), dealt = results.filter((r) => !open(r))
  const evs = events.filter((e) => keys.includes(eventKey(e)))
  const live = evs.filter((e) => e.state !== "done"), gone = evs.filter((e) => e.state === "done")
  const out: MenuItem[] = []
  if (fresh.length || live.length) out.push({ label: "Done", icon: Check, run: () => { if (fresh.length) void markManyDone(fresh); markManyEventsDone(live) } })
  if (fresh.length) out.push({ label: "File to…", icon: FolderInput, run: () => askMoveMany(fresh.map(pathOf), { before: unInbox }) })
  // (what's snoozed is in the Snoozed list: picked there, it comes back)
  const later = [...results.filter((r) => open(r) && snoozed(r.snoozed)).map(resultKey), ...live.filter((e) => snoozed(e.snoozed)).map(eventKey)]
  const soon = [...fresh.map(resultKey), ...live.filter((e) => snoozable(e) && !snoozed(e.snoozed)).map(eventKey)]
  if (soon.length) out.push(snoozeMenu(soon))
  if (later.length) out.push({ label: "Unsnooze", icon: AlarmClockOff, run: () => snoozeKeys(later, null) })
  if (dealt.length) out.push({ label: "Back to review", icon: RotateCcw, run: () => void markManyDone(dealt, false) })
  if (gone.length) out.push({ label: "Back to inbox", icon: RotateCcw, run: () => markManyEventsDone(gone, false) })
  if (evs.some((e) => !e.read)) out.push({ label: "Mark as read", icon: MailOpen, sep: out.length > 0, run: () => markRead(evs.map((e) => e.id)) })
  if (evs.some((e) => e.read)) out.push({ label: "Mark as unread", icon: Mail, sep: out.length > 0 && !evs.some((e) => !e.read), run: () => markUnread(evs.filter((e) => e.read).map((e) => e.id)) })
  if (gone.length) out.push({ label: "Delete", icon: Trash2, sep: true, run: () => gone.forEach((e) => forget(e.id)) })
  return out
}
/** Make the Inbox's rows selectable here (the panel, the page, the block). */
function useInboxSelect(store: Store) {
  useSelectable(SELECT, { menu: (keys) => selectionItems(store, keys), noun: ["item", "items"] })
}

/** Phones: a row swiped sideways shows what's done with it most (SwipeRow): Done and File to…, back to review, Back. */
const resultSwipe = (r: InboxItem): SwipeAction[] => waiting(r)
  ? [{ label: "Snooze", icon: Clock, run: snoozeAtRow([resultKey(r)]) }, { label: "File to", icon: FolderInput, run: () => fileTo(r) },
    { label: "Done", icon: Check, run: () => markDone(r), removes: true }]
  : open(r) ? [{ label: "Unsnooze", icon: AlarmClockOff, run: () => snoozeKeys([resultKey(r)], null), removes: true }]
  : [{ label: "To review", icon: RotateCcw, run: () => reopen(r), removes: true }]
const eventSwipe = (e: InboxEvent): SwipeAction[] => e.state === "done"
  ? [{ label: "Back", icon: RotateCcw, run: () => markManyEventsDone([e], false), removes: true }]
  : snoozed(e.snoozed)
  ? [{ label: "Unsnooze", icon: AlarmClockOff, run: () => snoozeKeys([eventKey(e)], null), removes: true }]
  : [
    ...(!e.read ? [{ label: "Read", icon: MailOpen, run: () => markRead([e.id]) }] : []),
    ...(snoozable(e) ? [{ label: "Snooze", icon: Clock, run: snoozeAtRow([eventKey(e)]) }] : []),
    { label: "Done", icon: Check, run: () => markManyEventsDone([e]), removes: true },
  ]

// (then what other plugins do with a file, like Dispatch's agents)
const resultItems = (r: InboxItem): MenuItem[] => [
  { label: "Open", icon: FileText, run: () => openFile(pathOf(r)) },
  ...(r.source && /^https?:/.test(r.source) ? [{ label: "Open the page", icon: Globe, run: () => void window.open(r.source, "_blank", "noopener") }] : []),
  { label: "File to…", icon: FolderInput, sep: true, run: () => fileTo(r) },
  snoozeMenu([resultKey(r)]),
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
  ...(snoozable(e) ? [snoozeMenu([eventKey(e)])] : []),
  e.state === "done"
    ? { label: "Back to inbox", icon: RotateCcw, sep: true, run: () => markManyEventsDone([e], false) }
    : { label: "Done", icon: Check, sep: true, run: () => { markManyEventsDone([e]); touched?.(e.id) } },
  ...(e.state === "done" ? [{ label: "Delete", icon: Trash2, run: () => void forget(e.id) }] : []),
]

/** What a reply to it is kept under (drafts.ts): its id, the thread's, whether it links its report or not. */
const draftKey = (e: InboxEvent) => e.id

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return "" } }

// ---------- events: how one looks

const KIND_ICON: Record<string, typeof Bell> = { done: CircleCheck, waiting: MessageCircleQuestion, error: CircleAlert }
const KIND_TINT: Record<string, string> = { done: "var(--green)", waiting: "var(--orange)", error: "var(--red)" }

/** An event's icon: its agent's, else its kind's (a session's by where it stands), a dot while it's unread. */
function EventIcon({ e, className }: { e: InboxEvent; className: string }) {
  const a = agentOf(e, useAgents())
  const kind = e.kind === "session" ? (e.state === "done" ? "done" : e.ask === "error" ? "error" : "waiting") : e.kind
  const Icon = a?.icon ?? KIND_ICON[kind] ?? Bell
  return (
    <Badged on={!e.read}>
      <Icon className={className} strokeWidth={2} style={{ color: a?.tint ?? KIND_TINT[kind] ?? "var(--muted-foreground)" }} />
    </Badged>
  )
}

/** Where a thread stands, in a word or two before its line: why it needs you, or that its agent is on it. */
const WHY: Record<string, string> = { permission: "Asks permission", question: "Asks you", auth: "Sign in", plan: "Plan to approve", report: "Report", error: "Failed" }
const standing = (e: InboxEvent) => (e.state === "working" ? "Working on it" : e.state === "open" && e.kind !== "info" ? WHY[e.ask ?? ""] ?? "" : "")

/** A subagent's parent as its own thread is called now (it may have been named since), else as it was then. */
const parentTitle = (e: InboxEvent) => getEvents().events.find((x) => x.kind === "session" && !x.machine &&
  ((!!e.parent!.terminal && x.terminal === e.parent!.terminal) || (!!e.parent!.session && x.session === e.parent!.session)))?.title ?? e.parent!.title

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

function PanelRow({ icon, label, tag, time, active, dim, select, swipe, onClick, onContextMenu, children, ...rest }: {
  icon: ReactNode; label: string; tag?: ReactNode; time?: string; active?: boolean; dim?: boolean; onClick: () => void; onContextMenu?: (e: MouseEvent) => void; children?: ReactNode
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
        {tag}
        {time && <span className="shrink-0 text-[11px] text-tertiary tabular-nums group-hover/row:hidden">{time}</span>}
        {children && <span className="hidden shrink-0 gap-0.5 group-hover/row:flex">{children}</span>}
      </a>
    </SwipeRow>
  )
}

const stop = (fn: () => void) => (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); fn() }

const answer = (e: InboxEvent, a: "approve" | "deny") => (haptic("medium"), answerAsk(e, a)).then(
  () => notify(a === "approve" ? "Approved" : "Denied"), (err) => notifyError(err, "Couldn't answer it"))

/** A row shows all of what it asks: one short line. */
const shownWhole = (e: InboxEvent) => !e.body || (e.body.length <= 80 && !e.body.includes("\n"))

/** Approve and Deny, on a permission not answered yet (the server's, or an agent's in a terminal). Approve answers at once
 *  only when the row shows the whole request; else it opens it. */
function GateButtons({ e, className, size }: { e: InboxEvent; className: string; size: string }) {
  if (!answerable(e)) return null
  return <>
    <button type="button" className={className} aria-label="Approve" data-tip="Approve" data-gate="approve" onClick={stop(() => shownWhole(e) ? void answer(e, "approve") : openEvent(e))}>
      <Check className={size} strokeWidth={2.25} /></button>
    <button type="button" className={className} aria-label="Deny" data-tip="Deny" data-gate="deny" onClick={stop(() => void answer(e, "deny"))}>
      <X className={size} strokeWidth={2.25} /></button>
  </>
}
export const gateTitle = (id: string) => getEvents().events.find((e) => e.id === id)?.title ?? "Asks for your yes"

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
          <Button look="primary" data-gate="approve" onClick={() => void answer(e, "approve")}>Approve</Button>
          <Button data-gate="deny" onClick={() => void answer(e, "deny")}>Deny</Button>
        </div>
      )}
    </div>
  )
}

/** The row that unfolds (or folds back) the rest. */
function FoldButton({ more, all, toggle, className }: { more: number; all: boolean; toggle: () => void; className: string }) {
  if (!more && !all) return null
  return (
    <button type="button" data-inbox-fold={all ? "open" : "closed"} onClick={toggle}
      className={cn("cursor-pointer text-left text-tertiary hover:text-foreground", className)}>
      {all ? "Show less" : `Show ${more} more`}
    </button>
  )
}

const small = "grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"

export function InboxPanel({ store, open, file }: SidebarCtx) {
  const { unread, events } = useEvents()
  const l = listsOf(store, events)
  // (what needs you always shows; then messages, then what agents work on, up to 8 rows)
  const { shown: rest, more, all, toggle } = useCap(l.needs, [...l.messages, ...l.working], 8)
  useTick()
  useBack(store)
  useInboxSelect(store)
  if (!open) return null
  const row = (e: InboxEvent) => (
    <PanelRow key={e.id} data-event={e.id} data-kind={e.kind} data-state={e.state} select={eventKey(e)} swipe={() => eventSwipe(e)}
      label={e.preview || e.body ? `${e.title}: ${e.preview || snippet(e.body!)}` : e.title} tag={<DraftTag to={draftKey(e)} short />}
      time={e.state === "working" ? "working" : fmtAgo(e.t, { short: true })} dim={e.state === "working"}
      icon={<EventIcon e={e} className="size-4 shrink-0" />} onClick={() => openEvent(e)} onContextMenu={menuFor(rowMenu(SELECT, eventKey(e), eventItems(e, !e.read)))}>
      <GateButtons e={e} className={small} size="size-3.5" />
      {!answerable(e) && <HeadingButton icon={MoreHorizontal} label="More" onClick={rightClickBelow} />}
      {!answerable(e) && <HeadingButton icon={Check} label="Done" onClick={stop(() => { haptic("medium"); markManyEventsDone([e]) })} />}
    </PanelRow>
  )
  return (
    <div className="flex shrink-0 flex-col" data-inbox-panel>
      <SidebarHeading title="Inbox" open={open}>
        {unread > 0 && <HeadingButton icon={CheckCheck} label="Mark all read" onClick={() => markRead()} />}
        <HeadingButton icon={Maximize2} label="Open inbox" onClick={openInbox} />
      </SidebarHeading>
      <div className="flex flex-col gap-px pb-1" data-select-list={SELECT}>
        {l.needs.map(row)}
        {l.review.map((r) => (
          <PanelRow key={r.id} data-result={r.id} select={resultKey(r)} swipe={() => resultSwipe(r)} label={r.title} tag={<DraftTag to={pathOf(r)} short />} active={file === pathOf(r)} time={r.updated || r.created ? fmtAgo((r.updated || r.created)!, { short: true }) : undefined}
            icon={<Badged on><FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} /></Badged>} onClick={() => openFile(pathOf(r))} onContextMenu={menuFor(rowMenu(SELECT, resultKey(r), resultItemsMenu(r)))}>
            <HeadingButton icon={Check} label="Done" onClick={stop(() => { haptic("medium"); void markDone(r) })} />
            <HeadingButton icon={Clock} label="Snooze" onClick={snoozeBelow([resultKey(r)])} />
            <HeadingButton icon={MoreHorizontal} label="More" onClick={(e) => { e.preventDefault(); e.stopPropagation(); moreMenu(e, r) }} />
          </PanelRow>
        ))}
        {rest.map(row)}
        {!l.needs.length && !l.review.length && !rest.length && <p className="h-7 pl-1.5 text-[13px] leading-7 text-tertiary">Nothing needs you</p>}
        <FoldButton more={more} all={all} toggle={toggle} className="h-7 rounded-[5px] pl-1.5 text-[13px] hover:bg-foreground/[0.04]" />
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
  const draft = useHasDraft(pathOf(r))
  return (
    <SwipeRow actions={() => resultSwipe(r)} className={pageSwipe}>
    <div data-result={r.id} data-select-key={key} {...selectedAttr(picked)} onContextMenu={menuFor(rowMenu(SELECT, key, done ? () => settledItems(r) : resultItemsMenu(r)))}
      className={cn("group/res relative isolate flex min-h-11 items-center gap-3 py-2 before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] hover:before:bg-foreground/[0.04]", pickedRow, done && "opacity-60 hover:opacity-100")}>
      <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left" onClick={(e) => { if (!selectClick(e, SELECT, key)) openFile(pathOf(r)) }}>
        {r.source ? <Globe className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={2} /> : <FileText className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={2} />}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[15px] leading-[20px]">{r.title}</span>
          {(meta || draft) && <span className="block text-[13px] text-muted-foreground max-md:line-clamp-2 md:truncate"><DraftTag to={pathOf(r)} className="mr-1.5 align-[1px]" />{meta}</span>}
        </span>
      </button>
      {done
        ? <button type="button" className={iconButton} aria-label="Back to review" data-tip="Back to review" onClick={() => { haptic("medium"); void reopen(r) }}><RotateCcw className="size-4" strokeWidth={2.25} /></button>
        : <>
          <button type="button" className={iconButton} aria-label="Done" data-tip="Done" onClick={() => { haptic("medium"); void markDone(r) }}><Check className="size-4" strokeWidth={2.25} /></button>
          {/* (a phone swipes for it) */}
          <button type="button" className={cn(iconButton, "max-md:hidden")} aria-label="Snooze" data-tip="Snooze" data-snooze onClick={snoozeBelow([resultKey(r)])}><Clock className="size-4" strokeWidth={2.25} /></button>
          <button type="button" className={iconButton} aria-label="More" data-tip="More" onClick={(e) => moreMenu(e, r)}><MoreHorizontal className="size-4" strokeWidth={2.25} /></button>
        </>}
    </div>
    </SwipeRow>
  )
}

function EventRow({ e, fresh, touched }: { e: InboxEvent; fresh?: boolean; touched?: (id: string) => void }) {
  const read = e.read && !fresh, done = e.state === "done" && !fresh
  const key = eventKey(e), picked = useSelected(SELECT, key)
  // (one that leads nowhere opens in place, its whole body, and stays where it is while the page shows it)
  const [whole, setWhole] = useState(false)
  const asks = answerable(e)
  // (an agent's answer is Markdown: one plain line here, whole in its sheet)
  const line = e.preview || (e.body ? snippet(e.body) : "")
  const draft = useHasDraft(draftKey(e))
  const where = standing(e)
  return (
    <SwipeRow actions={() => eventSwipe(e)} className={pageSwipe}>
    <div data-event={e.id} data-kind={e.kind} data-state={e.state} data-unread={!read || undefined} data-select-key={key} {...selectedAttr(picked)}
      onContextMenu={menuFor(rowMenu(SELECT, key, eventItems(e, !read, touched)))}
      className={cn("group/ev relative isolate flex min-h-11 items-center gap-3 py-2 before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] hover:before:bg-foreground/[0.04]",
        pickedRow, done && !draft && "opacity-60 hover:opacity-100")}>
      <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left" onClick={(ev) => { if (selectClick(ev, SELECT, key)) return; if (!targetOf(e)) { setWhole(!whole); markRead([e.id]); return } openEvent(e); touched?.(e.id) }}>
        <EventIcon e={fresh ? { ...e, read: false } : e} className="size-[18px] shrink-0" />
        <span className="min-w-0 flex-1">
          <span className={cn("line-clamp-2 text-[15px] leading-[20px]", !read && "font-semibold")}>{e.title}</span>
          {(e.body || e.machineLabel || e.parent || draft || where) && <span data-tip={whole ? undefined : line} data-tip-trunc
            className={cn("block text-[13px] text-muted-foreground", whole ? "whitespace-pre-wrap break-words" : "max-md:line-clamp-2 md:truncate")}><DraftTag to={draftKey(e)} className="mr-1.5 align-[1px]" />
            {where && <span data-standing className={cn("font-medium", e.state === "working" ? "text-tertiary" : "text-foreground/80")}>{where}{(line || e.machineLabel || e.parent) && " · "}</span>}
            {[e.parent && `from ${parentTitle(e)}`, whole ? e.body : line, e.machineLabel && `on ${e.machineLabel}`].filter(Boolean).join(" · ")}</span>}
        </span>
        {!asks && <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">{fmtAgo(e.t, { short: true })}</span>}
      </button>
      {/* (a request's Approve takes its time's place and Deny its Done's, so the rows stay in line) */}
      <GateButtons e={e} className={iconButton} size="size-4" />
      {!asks && (e.state === "done"
        ? <button type="button" className={cn(iconButton, "md:invisible md:group-hover/ev:visible")} aria-label="Back to inbox" data-tip="Back to inbox" onClick={() => { haptic("medium"); markManyEventsDone([e], false) }}>
          <RotateCcw className="size-4" strokeWidth={2.25} /></button>
        : <button type="button" className={cn(iconButton, "md:invisible md:group-hover/ev:visible")} aria-label="Done" data-tip="Done" data-done onClick={() => { haptic("medium"); markManyEventsDone([e]); touched?.(e.id) }}>
          <Check className="size-4" strokeWidth={2.25} /></button>)}
    </div>
    </SwipeRow>
  )
}

/** What's out of the way, last on the page and folded: "Snoozed N", "Done N". */
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

/** What's snoozed, soonest back first: its results and events, each with when it comes back. */
function Snoozed({ store }: { store: Store }) {
  const { results, events: evs } = listsOf(store, useEvents().events).snoozed
  const rows = [
    ...results.map((r) => ({ sel: resultKey(r), title: r.title, until: snoozeMs(r.snoozed), icon: <Clock className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={2} />, open: () => openFile(pathOf(r)), swipe: () => resultSwipe(r) })),
    ...evs.map((e) => ({ sel: eventKey(e), title: e.title, until: e.snoozed!, icon: <EventIcon e={e} className="size-[18px] shrink-0" />, open: () => openEvent(e), swipe: () => eventSwipe(e) })),
  ].sort((a, b) => a.until - b.until)
  return <Folded label="Snoozed" n={rows.length} attr="data-inbox-snoozed">{rows.map((x) => <SnoozedRow key={x.sel} {...x} />)}</Folded>
}

function SnoozedRow({ sel, title, until, icon, open: openIt, swipe }: { sel: string; title: string; until: number; icon: ReactNode; open: () => void; swipe: () => SwipeAction[] }) {
  const picked = useSelected(SELECT, sel)
  return (
    <SwipeRow actions={swipe} className={pageSwipe}>
      <div data-snoozed={sel} data-select-key={sel} {...selectedAttr(picked)}
        onContextMenu={menuFor(rowMenu(SELECT, sel, () => [{ label: "Unsnooze", icon: AlarmClockOff, run: () => snoozeKeys([sel], null) }, snoozeMenu([sel])]))}
        className={cn("group/sn relative isolate flex min-h-11 items-center gap-3 py-2 before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] hover:before:bg-foreground/[0.04]", pickedRow)}>
        <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left" onClick={(e) => { if (!selectClick(e, SELECT, sel)) openIt() }}>
          {icon}
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-[15px] leading-[20px]">{title}</span>
            <span className="block truncate text-[13px] text-muted-foreground">Until {whenText(new Date(until)).replace(/^Tomorrow/, "tomorrow")}</span>
          </span>
        </button>
        <button type="button" className={iconButton} aria-label="Unsnooze" data-tip="Unsnooze" onClick={() => { haptic("medium"); snoozeKeys([sel], null) }}>
          <AlarmClockOff className="size-4" strokeWidth={2.25} /></button>
      </div>
    </SwipeRow>
  )
}

/** What's dealt with: threads and events done (kept keep_days), and results done (or archived), the latest first. */
function Settled({ store, fresh }: { store: Store; fresh?: ReadonlySet<string> }) {
  const { events: evs, results } = listsOf(store, useEvents().events, fresh).done
  const rows = [...evs.map((e) => ({ at: e.t, row: <EventRow key={e.id} e={e} /> })), ...results.map((r) => ({ at: latestOf(r), row: <ResultRow key={r.id} r={r} done /> }))]
    .sort((a, b) => b.at - a.at)
  return <Folded label="Done" n={rows.length} attr="data-inbox-settled">{rows.map((x) => x.row)}</Folded>
}

/** One of the lists, under its heading, with "Show N more" past `max`. */
function Section({ title, attr, rows, max, loading }: { title: string; attr: string; rows: ReactNode[]; max: number; loading?: ReactNode }) {
  const { shown, more, all, toggle } = useCap([], rows, max)
  if (!rows.length && !loading) return null
  return (
    <section {...{ [attr]: "" }}>
      <h3 className="mb-1 text-[13px] font-semibold text-muted-foreground">{title}</h3>
      {loading}
      {shown.length > 0 && <div className="hairline">{shown}</div>}
      <FoldButton more={more} all={all} toggle={toggle} className="mt-1 h-8 text-[13px]" />
    </section>
  )
}

function Lists({ store, events: ne, results: nr, fresh, touched, all: dealt }: {
  store: Store; events: number; results: number; fresh?: ReadonlySet<string>; touched?: (id: string) => void
  /** With what's out of the way, folded at the bottom (the Inbox page). */
  all?: boolean
}) {
  const { ready, events } = useEvents()
  const l = listsOf(store, events, fresh)
  useTick()
  useBack(store)
  useInboxSelect(store)
  // (while the events come, as many skeleton rows as there were last time; none: the Loading line, as tall as "Nothing needs you.")
  const loading = !!ne && !ready
  const live = ne ? [...l.needs, ...l.working, ...l.messages] : []
  const kept = ne ? `inbox:${dealt ? "page" : "block"}:events` : null
  const rows = useKeptCount(kept, loading ? undefined : live.length)
  // (a row with a body is taller: as many of those as last time too)
  const bodies = useKeptCount(kept && `${kept}:bodies`, loading ? undefined : live.filter((e) => e.body || e.machineLabel).length, 0)
  const row = (e: InboxEvent) => <EventRow key={e.id} e={e} fresh={fresh?.has(e.id)} touched={touched} />
  const past = dealt && <><Snoozed store={store} /><Settled store={store} fresh={fresh} /></>
  const results = l.review.slice(0, nr)
  if (!results.length && !live.length && !(loading && rows)) return <>{loading ? <Loading /> : <Empty>Nothing needs you.</Empty>}{dealt && <div className="mt-4 flex flex-col gap-4" data-select-list={SELECT}>{past}</div>}</>
  return (
    <div className="flex flex-col gap-4" data-select-list={SELECT}>
      <Section title="Needs you" attr="data-inbox-needs" rows={ne ? l.needs.map(row) : []} max={dealt ? 50 : ne}
        loading={loading && rows > 0 ? <LoadingRows count={rows} meta={bodies} lead={<span className="size-[18px] shrink-0" />} /> : undefined} />
      <Section title="To review" attr="data-inbox-results" rows={results.map((r) => <ResultRow key={r.id} r={r} />)} max={nr} />
      <Section title="Working on it" attr="data-inbox-working" rows={ne ? l.working.map(row) : []} max={dealt ? 20 : ne} />
      <Section title="Messages" attr="data-inbox-messages" rows={ne ? l.messages.map(row) : []} max={dealt ? 20 : ne} />
      {past}
    </div>
  )
}

/** ```block-inbox: what needs you, on a dashboard (Today). */
export function InboxBlock({ store, options }: { store: Store; options: Record<string, unknown> }) {
  const n = useCount(store)
  return (
    <Panel title={String(options.title || "Inbox")} icon={InboxIcon} tint="var(--inbox)"
      action={n > 0 ? <button type="button" className="cursor-pointer text-[13px] font-medium text-primary hover:underline" onClick={openInbox}>{n} new</button> : undefined}>
      <Lists store={store} events={Number(options.events ?? 5)} results={Number(options.results ?? 10)} />
    </Panel>
  )
}

/** Forget the done events (kept keep_days otherwise), here and on the other machines. */
const clearDone = () => void del("inbox/events?done=1").catch((e) => notifyError(e, "Couldn't clear them"))

/** The Inbox in a tab: while focused, its messages are read (not ones marked unread by hand), but the ones new when
 *  they came into view stay drawn where they were, as new, until it closes, since the tab stays drawn while hidden. */
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
  const done = events.filter((e) => e.state === "done").length
  return (
    <div className="pb-10" data-inbox-view>
      <div className="mb-1 flex items-center gap-2">
        <h1 className="flex-1 text-[22px] leading-[28px] font-bold max-md:hidden">Inbox</h1>
        {done > 0 && (
          <button type="button" onClick={clearDone} data-inbox-clear className="flex h-7 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-[13px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground max-md:ml-auto">
            <Trash2 className="size-3.5" strokeWidth={2.25} />Clear done
          </button>
        )}
        {/* Phones (no ⌘ or ⇧): pick several with taps, then the bar's Actions. */}
        {(events.length > 0 || (store.inbox ?? []).length > 0) && !selectingHere && (
          <button type="button" onClick={() => startSelecting(SELECT)} data-inbox-select
            className={cn("flex h-7 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-[13px] text-primary hover:bg-foreground/[0.06] md:hidden", !done && "ml-auto")}>
            <ListChecks className="size-3.5" strokeWidth={2.25} />Select
          </button>
        )}
      </div>
      <p className="mb-4 text-[13px] text-muted-foreground">
        Your coding agents' sessions when they need you (a question, an approval, an answer or a report to read) and results to review. Reading one doesn't settle it: it stays until you mark it done, or you reply and the agent finishes with nothing more for you.
      </p>
      <Lists store={store} events={20} results={100} fresh={fresh} touched={touched} all />
    </div>
  )
}
