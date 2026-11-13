import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react"
import {
  AlarmClockOff, Bell, CalendarClock, Check, CheckCheck, ChevronRight, CircleAlert, CircleCheck, Clock, ExternalLink, FileText, FolderInput, Globe, Inbox as InboxIcon, ListTodo, Mail, MailOpen,
  Maximize2, ListChecks, MessageCircleQuestion, MessageSquareReply, MoreHorizontal, Pin, PinOff, RotateCcw, ShieldAlert, SquareTerminal, Trash2, X,
} from "lucide-react"
import {
  activePane, askMove, askMoveMany, backDetail, closePane, currentRow, moveInList, Badged, Button, cn, del, detailPath, DoIt, Empty, fmtAgo, getStore, haptic, HeadingButton, isViewOpen, Loading, LoadingRows, Markdown, menuBelow, menuFor,
  notify, notifyError, openDetail, replaceDetail, openFile, openMenu, openView, openWebLink, optimistic, Panel, paneTab, panesShowing, pluginFileGroups, plural, put, rightClickBelow, rowMenu, selectClick, selectedAttr, selectPane, setProperty, SheetHead, snippet,
  SidebarHeading, startSelecting, typingIn, SwipeRow, useAgents, useKeptCount, useSelectable, useSelected, useSelecting, useSidebars, useStore, useStoreWith, useTick, type MenuItem,
  type FileHead, type SidebarCtx, type Store, type SwipeAction, type TabButton,
} from "@vaultite"
import { agentOf, answerable, answerAsk, focusedTarget, forget, getEvents, markEventsDone, markRead, markSeen, markUnread, openAsker, openEvent, openSession, pinEvents, SESSION_DETAIL, threadTitle, unsettle, snoozable, snoozeEvents, targetOf, useEvents } from "./events"
import type { InboxEvent, InboxItem } from "./types"
import { choices, snoozed, snoozeMs, stampOf, whenText } from "./snooze"
import { countOf, latestOf, lists, reviewing } from "./threads"
import { useHasDraft } from "./drafts"
import { DraftTag, ReplyBox } from "./Reply"
import { acceptAll, DecisionRow, keepDefault } from "./DecisionRows"

const waiting = (r: InboxItem) => reviewing(r) && !snoozed(r.snoozed)
const listsOf = (store: Store, events = getEvents().events, fresh?: ReadonlySet<string>) => lists(events, store.inbox ?? [], fresh)
export const toReview = (store: Store): InboxItem[] => { const l = listsOf(store); return [...l.pinned.results, ...l.review] }

export function useBack(store: Store) {
  const { events } = useEvents()
  const [, redraw] = useState(0)
  const now = Date.now()
  const next = Math.min(...[...(store.inbox ?? []).filter(reviewing).map((r) => snoozeMs(r.snoozed)), ...events.map((e) => e.snoozed ?? 0)].filter((t) => t > now))
  useEffect(() => {
    if (!Number.isFinite(next)) return
    const t = setTimeout(() => redraw((n) => n + 1), Math.min(next - Date.now() + 100, 2 ** 31 - 1))
    return () => clearTimeout(t)
  }, [next])
}

export function useCount(store: Store) {
  useBack(store)
  return countOf(listsOf(store, useEvents().events))
}

export const openInbox = () => openView("inbox", { newTab: !isViewOpen("view:inbox") })

function useCap<T>(first: T[], rest: T[], max: number) {
  const [all, setAll] = useState(false)
  const room = Math.max(0, max - first.length)
  return { shown: all ? rest : rest.slice(0, room), more: Math.max(0, rest.length - room), all, toggle: () => setAll(!all) }
}

function keyedRow() {
  const row = currentRow()?.closest<HTMLElement>("[data-select-key]")
  return row?.closest(`[data-select-list="${SELECT}"]`) ? row : null
}
export const keysOnInbox = () => !!keyedRow() || (focusedTarget() === "view:inbox" && !typingIn(document.activeElement) && !document.activeElement?.closest("[data-sidebar-body]"))
const rowsAround = (from: Element | null) => {
  const scope = from?.closest(`[data-select-list="${SELECT}"]`) ?? document.querySelector(`[data-inbox-view] [data-select-list="${SELECT}"]`)
  return scope ? [...scope.querySelectorAll<HTMLElement>("[data-select-key]")].filter((r) => r.getClientRects().length > 0 && !!keyOf(r)) : []
}
const keyOf = (row: HTMLElement) => (row.matches("[data-keyrow]") ? row : row.querySelector<HTMLElement>("[data-keyrow]"))

export function stepRow(by: 1 | -1) {
  if (keyedRow()) return moveInList(by)
  const first = rowsAround(null)[0]
  if (first) { keyOf(first)?.focus({ preventScroll: true }); first.scrollIntoView({ block: "nearest" }) }
  return true
}

function onRow(act: (key: string, row: HTMLElement) => void, leaves = true) {
  const row = keyedRow()
  if (!row) return
  const key = row.dataset.selectKey!
  const rows = rowsAround(row), i = rows.indexOf(row), list = row.closest(`[data-select-list="${SELECT}"]`)
  const next = leaves ? (rows[i + 1] ?? rows[i - 1])?.dataset.selectKey : undefined
  act(key, row)
  if (!next) return
  requestAnimationFrame(() => {
    const to = list?.querySelector<HTMLElement>(`[data-select-key="${CSS.escape(next)}"]`)
    if (to) keyOf(to)?.focus({ preventScroll: true })
  })
}
const resultOf = (key: string) => (getStore()?.inbox ?? []).find((r) => resultKey(r) === key)
const eventOf = (key: string) => getEvents().events.find((e) => eventKey(e) === key)

export const doneByKey = () => onRow((key) => {
  const r = resultOf(key), e = eventOf(key)
  haptic("medium")
  if (r) void (reviewing(r) ? markDone(r) : reopen(r))
  else if (e) markManyEventsDone([e], e.state !== "done")
})
export const snoozeByKey = () => onRow((key, row) => {
  const r = resultOf(key), e = eventOf(key)
  if (r ? snoozed(r.snoozed) : e ? snoozed(e.snoozed) : false) return snoozeKeys([key], null)
  if (r ? waiting(r) : e ? snoozable(e) : false) snoozeAtRow([key])(row.getBoundingClientRect())
}, false)
export const replyByKey = () => onRow((_, row) => row.querySelector<HTMLButtonElement>("[data-row-reply-button]")?.click(), false)

function sheetOn() {
  const s = [...document.querySelectorAll<HTMLElement>("[data-session-sheet]")].find((x) => x.getClientRects().length > 0)
  return s && !typingIn(document.activeElement) ? s : null
}
export const keysOnThreads = () => !!sheetOn() || keysOnInbox()
export const byKey = (row: () => unknown, sheet: (s: HTMLElement, id: string) => unknown) => () => {
  const s = sheetOn()
  return s ? sheet(s, s.dataset.sessionSheet!) : row()
}
export function stepSheet(id: string, by: 1 | -1) {
  const all = sessionsInOrder()
  const i = all.findIndex((e) => e.id === id)
  const to = i < 0 ? all[0] : all[i + by]
  if (to && to.id !== id) replaceDetail(detailPath(SESSION_DETAIL, to.id))
}
const sessionsInOrder = (working = true) => {
  const l = listsOf(getStore() ?? ({} as Store))
  return [...l.pinned.events, ...l.needs, ...(working ? l.working : []), ...l.messages].filter((e) => e.kind === "session")
}
export function leaveSheet(id: string) {
  const all = sessionsInOrder(false), i = all.findIndex((e) => e.id === id)
  const to = i < 0 ? undefined : all[i + 1] ?? all[i - 1]
  if (to) replaceDetail(detailPath(SESSION_DETAIL, to.id)); else backDetail()
}
export const press = (s: HTMLElement, sel: string) => s.querySelector<HTMLElement>(sel)?.click()

export const pinByKey = () => onRow((key) => {
  const r = resultOf(key), e = eventOf(key)
  pinKeys([key], !(r?.pinned ?? e?.pinned))
}, false)
export const readByKey = (read: boolean) => onRow((key) => {
  const e = eventOf(key)
  if (!e) return
  if (read) markRead([e.id]); else markUnread([e.id])
}, false)

const pathOf = (r: InboxItem) => `${r.id}.md`

function change(r: InboxItem, fields: Record<string, unknown>): Promise<InboxItem> {
  const now = { ...fields, ...("status" in fields ? { archived: fields.status === "done", ...(fields.status === "done" ? { pinned: undefined } : {}) } : {}) }
  return optimistic((s) => ({ ...s, inbox: (s.inbox ?? []).map((x) => (x.id === r.id ? { ...x, ...now } : x)) }),
    () => put<InboxItem | null>(`inbox/${encodeURIComponent(r.id)}`, fields).then((out) => out ?? r), "Couldn't change it")
}

export function markDone(r: InboxItem, done = true) {
  const reading = done && leaveTabs([r])
  const now = change(r, { status: done ? "done" : "new" })
  if (done) notify(`Settled “${r.title}”`, { action: { label: "Undo", run: async () => {
    const back = await change(await now, { status: "new", ...(r.pinned ? { pinned: true } : {}) })
    if (reading) openFile(pathOf(back))
  } } })
  return now
}

function leaveTabs(going: InboxItem[]) {
  const targets = going.map((r) => `file:${pathOf(r)}`), cur = activePane()
  const reading = !paneTab(cur.id)?.pinned && going.find((r) => cur.to === `file:${pathOf(r)}`)
  const next = reading && nextToReview(reading, going)
  const there = next && panesShowing(`file:${pathOf(next)}`)[0]
  for (const p of panesShowing(...targets)) {
    if (paneTab(p.id)?.pinned || (p.id === cur.id && next && !there)) continue
    closePane(p.id)
  }
  if (there) selectPane(there.id)
  else if (next) openFile(pathOf(next))
  return !!reading
}

function nextToReview(r: InboxItem, going: InboxItem[] = [r]) {
  const all = toReview(getStore() ?? ({} as Store)), i = all.findIndex((x) => x.id === r.id)
  const list = all.filter((x) => x === r || !going.some((g) => g.id === x.id)), j = list.indexOf(all[i])
  return i < 0 ? undefined : list[j + 1] ?? list[j - 1]
}

export function fileTo(r: InboxItem) {
  const p = pathOf(r)
  askMove(p, { before: () => unInbox(p) })
}
const unInbox = async (p: string) => { await setProperty(p, "status", undefined); await setProperty(p, "type", undefined) }

const resultAtPath = (path: string) => (getStore()?.inbox ?? []).find((r) => pathOf(r) === path && reviewing(r))
export function itemButtons(r: InboxItem): TabButton[] {
  const key = resultKey(r)
  return [
    { icon: Check, label: "Settle", run: () => { haptic("medium"); void markDone(r) } },
    snoozed(r.snoozed) ? { icon: AlarmClockOff, label: "Wake", run: () => snoozeKeys([key], null) } : { icon: Clock, label: "Snooze", run: snoozeBelow([key]) },
  ]
}
export const tabButtonsOf = (to: string) => { const r = to.startsWith("file:") ? resultAtPath(to.slice(5)) : undefined; return r ? itemButtons(r) : null }

export function ItemBar({ file }: { file: FileHead & { place: "bar" | "line" } }) {
  const r = useStoreWith((s) => s?.inbox?.find((x) => pathOf(x) === file.path && reviewing(x)))
  if (!r) return null
  const bar = file.place === "bar"
  return (
    <span data-inbox-bar className={cn("flex shrink-0 items-center", bar ? "gap-0.5" : "-my-1.5 md:my-0")}>
      {r.do && <DoIt task={{ text: r.do }} done={() => void markDone(r)} />}
      {itemButtons(r).map((b) => (
        <button key={b.label} type="button" aria-label={b.label} data-tip={b.label} data-inbox-bar-button={b.label} onClick={b.run}
          className={cn("grid shrink-0 cursor-pointer place-items-center text-muted-foreground hover:text-foreground",
            bar ? "size-7 rounded-[5px] hover:bg-foreground/[0.06]" : "size-11 active:opacity-50 md:size-8 md:rounded-[6px] md:hover:bg-foreground/[0.06]")}>
          <b.icon className={bar ? "size-3.5" : "size-4"} strokeWidth={2.25} />
        </button>
      ))}
    </span>
  )
}

export function snoozeKeys(keys: string[], at: Date | null) {
  const results = (getStore()?.inbox ?? []).filter((r) => keys.includes(resultKey(r)) && reviewing(r))
  const evs = getEvents().events.filter((e) => keys.includes(eventKey(e)) && (at ? snoozable(e) : !!e.snoozed))
  const now = at ?? new Date()
  if (at) leaveTabs(results)
  for (const r of results) void change(r, { snoozed: stampOf(now) })
  if (evs.length) snoozeEvents(evs.map((e) => e.id), at ? at.getTime() : null)
  const n = results.length + evs.length
  if (!n) return
  const what = n === 1 ? `“${results[0]?.title ?? evs[0].title}”` : plural(n, "item")
  notify(at ? `Snoozed ${what} until ${whenText(at)}` : `${what} back in the inbox`, { action: { label: "Undo", run: () => {
    for (const r of results) void change({ ...r, snoozed: stampOf(now) }, { snoozed: r.snoozed ?? null })
    for (const e of evs) snoozeEvents([e.id], snoozed(e.snoozed) ? e.snoozed! : null)
  } } })
}

export const snoozeItems = (keys: string[], then?: () => void): MenuItem[] => [
  ...choices().map((c) => ({ label: c.label, hint: whenText(c.at).replace(/^Tomorrow /, ""), run: () => { then?.(); snoozeKeys(keys, c.at) } })),
  { label: "Pick a time…", icon: CalendarClock, sep: true, run: () => openDetail(detailPath(SNOOZE_DETAIL, ...keys)) },
]
const snoozeMenu = (keys: string[], icon = true): MenuItem => ({ label: "Snooze", ...(icon ? { icon: Clock } : {}), run: () => {}, items: snoozeItems(keys) })
export const snoozeBelow = (keys: string[], then?: () => void) => (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); menuBelow(e, snoozeItems(keys, then)) }
const snoozeAtRow = (keys: string[]) => (row?: DOMRect) => openMenu({ x: row ? row.left + 16 : 16, y: row ? row.bottom + 4 : innerHeight / 3, flip: row ? row.top - 4 : undefined }, snoozeItems(keys))

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

export function pinKeys(keys: string[], on: boolean) {
  const results = (getStore()?.inbox ?? []).filter((r) => keys.includes(resultKey(r)) && reviewing(r) && !!r.pinned !== on)
  const evs = getEvents().events.filter((e) => keys.includes(eventKey(e)) && e.state !== "done" && !!e.pinned !== on)
  const n = results.length + evs.length
  if (!n) return
  const apply = (to: boolean) => {
    for (const r of results) void change({ ...r, pinned: !to }, { pinned: to || null })
    if (evs.length) pinEvents(evs.map((e) => e.id), to)
  }
  apply(on)
  const what = n === 1 ? `“${results[0]?.title ?? evs[0].title}”` : plural(n, "item")
  notify(`${on ? "Pinned" : "Unpinned"} ${what}`, { action: { label: "Undo", run: () => apply(!on) } })
}
const pinItem = (keys: string[], pinned: boolean): MenuItem => pinned
  ? { label: "Unpin", icon: PinOff, run: () => pinKeys(keys, false) }
  : { label: "Pin", icon: Pin, run: () => pinKeys(keys, true) }

const SELECT = "inbox"
const resultKey = (r: InboxItem) => `r:${r.id}`, eventKey = (e: InboxEvent) => `e:${e.id}`

async function markManyDone(list: InboxItem[], done = true, pinned: boolean[] = []) {
  if (done) leaveTabs(list)
  const all = await Promise.allSettled(list.map((r, i) => change(r, { status: done ? "done" : "new", ...(done ? {} : { archived: false, ...(pinned[i] ? { pinned: true } : {}) }) })))
  const ok = list.flatMap((was, i) => { const x = all[i]; return x.status === "fulfilled" ? [{ was, now: x.value }] : [] })
  const now = ok.map((x) => x.now)
  if (now.length) notify(done ? `Settled ${plural(now.length, "result")}` : `Put back ${plural(now.length, "result")} to review`,
    { action: { label: "Undo", run: () => void markManyDone(now, !done, done ? ok.map((x) => !!x.was.pinned) : []) } })
}

function markManyEventsDone(evs: InboxEvent[], done = true) {
  if (!evs.length) return
  void markEventsDone(evs.map((e) => e.id), done)
  notify(evs.length === 1 ? (done ? `Settled “${evs[0].title}”` : `Back in the inbox: “${evs[0].title}”`) : (done ? `Settled ${plural(evs.length, "item")}` : `Put back ${plural(evs.length, "item")} in the inbox`),
    { action: { label: "Undo", run: () => void (done ? unsettle(evs) : markEventsDone(evs.map((e) => e.id), true)) } })
}

function selectionItems(store: Store, keys: string[]): MenuItem[] {
  const all = store.inbox ?? [], { events } = getEvents()
  const results = all.filter((r) => keys.includes(resultKey(r)))
  const fresh = results.filter(waiting), dealt = results.filter((r) => !reviewing(r))
  const evs = events.filter((e) => keys.includes(eventKey(e)))
  const live = evs.filter((e) => e.state !== "done"), gone = evs.filter((e) => e.state === "done")
  const out: MenuItem[] = []
  if (fresh.length || live.length) out.push({ label: "Settle", icon: Check, run: () => { if (fresh.length) void markManyDone(fresh); markManyEventsDone(live) } })
  if (fresh.length) out.push({ label: "File to…", icon: FolderInput, run: () => askMoveMany(fresh.map(pathOf), { before: unInbox }) })
  const later = [...results.filter((r) => reviewing(r) && snoozed(r.snoozed)).map(resultKey), ...live.filter((e) => snoozed(e.snoozed)).map(eventKey)]
  const soon = [...fresh.map(resultKey), ...live.filter((e) => snoozable(e) && !snoozed(e.snoozed)).map(eventKey)]
  const pinnable = [...fresh, ...results.filter((r) => reviewing(r) && snoozed(r.snoozed))], unpinned = [...pinnable.filter((r) => !r.pinned).map(resultKey), ...live.filter((e) => !e.pinned).map(eventKey)]
  if (unpinned.length) out.push(pinItem(unpinned, false))
  else if (pinnable.length || live.length) out.push(pinItem([...pinnable.map(resultKey), ...live.map(eventKey)], true))
  if (soon.length) out.push(snoozeMenu(soon))
  if (later.length) out.push({ label: "Wake", icon: AlarmClockOff, run: () => snoozeKeys(later, null) })
  if (dealt.length) out.push({ label: "Back to review", icon: RotateCcw, run: () => void markManyDone(dealt, false) })
  if (gone.length) out.push({ label: "Back to inbox", icon: RotateCcw, run: () => markManyEventsDone(gone, false) })
  if (evs.some((e) => !e.read)) out.push({ label: "Mark as read", icon: MailOpen, sep: out.length > 0, run: () => markRead(evs.map((e) => e.id)) })
  if (evs.some((e) => e.read)) out.push({ label: "Mark as unread", icon: Mail, sep: out.length > 0 && !evs.some((e) => !e.read), run: () => markUnread(evs.filter((e) => e.read).map((e) => e.id)) })
  if (gone.length) out.push({ label: "Delete", icon: Trash2, sep: true, run: () => gone.forEach((e) => forget(e.id)) })
  return out
}
function useInboxSelect(store: Store) {
  useSelectable(SELECT, { menu: (keys) => selectionItems(store, keys), noun: ["item", "items"] })
}

const moreAt = (items: () => MenuItem[]) => (row?: DOMRect) => openMenu({ x: row ? row.right - 16 : 16, y: row ? row.bottom + 4 : innerHeight / 3, flip: row ? row.top - 4 : undefined }, items())
const resultSwipe = (r: InboxItem): SwipeAction[] => waiting(r)
  ? [{ label: "More", icon: MoreHorizontal, run: moreAt(() => resultItems(r)) }, { label: "Snooze", icon: Clock, run: snoozeAtRow([resultKey(r)]) },
    { label: "Settle", icon: Check, run: () => markDone(r), removes: true }]
  : reviewing(r) ? [{ label: "Wake", icon: AlarmClockOff, run: () => snoozeKeys([resultKey(r)], null), removes: true }]
  : [{ label: "To review", icon: RotateCcw, run: () => reopen(r), removes: true }]
const eventSwipe = (e: InboxEvent, reply?: SwipeAction): SwipeAction[] => e.state === "done"
  ? [{ label: "Back", icon: RotateCcw, run: () => markManyEventsDone([e], false), removes: true }]
  : snoozed(e.snoozed)
  ? [{ label: "Wake", icon: AlarmClockOff, run: () => snoozeKeys([eventKey(e)], null), removes: true }]
  : [
    { label: "More", icon: MoreHorizontal, run: moreAt(eventItems(e, !e.read)) },
    ...(snoozable(e) ? [{ label: "Snooze", icon: Clock, run: snoozeAtRow([eventKey(e)]) }] : []),
    ...(reply ? [reply] : []),
    { label: "Settle", icon: Check, run: () => markManyEventsDone([e]), removes: true },
  ]

const resultItems = (r: InboxItem): MenuItem[] => [
  { label: "Open", icon: FileText, run: () => openFile(pathOf(r)) },
  ...(r.source && /^https?:/.test(r.source) ? [{ label: "Open the page", icon: Globe, run: () => openWebLink(r.source!) }] : []),
  { label: "File to…", icon: FolderInput, sep: true, run: () => fileTo(r) },
  pinItem([resultKey(r)], !!r.pinned),
  snoozeMenu([resultKey(r)]),
  ...pluginFileGroups(pathOf(r), "inbox").rest.flat().map((it, i) => ({ ...it, sep: i === 0 })),
]

function moreMenu(e: MouseEvent, r: InboxItem) {
  menuBelow(e, resultItems(r))
}

const reopen = (r: InboxItem) => change(r, { status: "new", archived: false })
const settledItems = (r: InboxItem): MenuItem[] => [resultItems(r)[0], { label: "Back to review", icon: RotateCcw, sep: true, run: () => void reopen(r) }]

const resultItemsMenu = (r: InboxItem) => () => [{ label: "Settle", icon: Check, run: () => markDone(r) }, { ...resultItems(r)[0], sep: true }, ...resultItems(r).slice(1)]

const eventItems = (e: InboxEvent, shownNew: boolean, touched?: (id: string) => void) => (): MenuItem[] => [
  ...(targetOf(e) ? [{ label: "Open", icon: ExternalLink, run: () => { openEvent(e); touched?.(e.id) } }] : []),
  ...(e.from ? [{ label: "Go to session", icon: SquareTerminal, run: () => openAsker(e) }] : []),
  shownNew
    ? { label: "Mark as read", icon: MailOpen, run: () => { markRead([e.id]); touched?.(e.id) } }
    : { label: "Mark as unread", icon: Mail, run: () => markUnread([e.id]) },
  ...(e.state !== "done" ? [pinItem([eventKey(e)], !!e.pinned)] : []),
  ...(snoozable(e) ? [snoozeMenu([eventKey(e)])] : []),
  e.state === "done"
    ? { label: "Back to inbox", icon: RotateCcw, sep: true, run: () => markManyEventsDone([e], false) }
    : { label: "Settle", icon: Check, sep: true, run: () => { markManyEventsDone([e]); touched?.(e.id) } },
  ...(e.state === "done" ? [{ label: "Delete", icon: Trash2, run: () => void forget(e.id) }] : []),
]

const lineOf = (e: InboxEvent) => (e.state === "working" && e.progress) || e.preview || (e.body ? snippet(e.body) : "")

const decisionItems = (r: InboxItem): MenuItem[] => [
  { label: "Open", icon: FileText, run: () => openFile(pathOf(r)) },
  ...(r.default ? [{ label: `Accept the default (${r.default})`, icon: Check, sep: true, run: () => void keepDefault(r) }] : []),
  snoozeMenu([resultKey(r)]),
]
const decisionSwipe = (r: InboxItem): SwipeAction[] => snoozed(r.snoozed)
  ? [{ label: "Wake", icon: AlarmClockOff, run: () => snoozeKeys([resultKey(r)], null), removes: true }]
  : [{ label: "Snooze", icon: Clock, run: snoozeAtRow([resultKey(r)]) }, ...(r.default ? [{ label: "Keep default", icon: Check, run: () => void keepDefault(r), removes: true }] : [])]
const decisionSnooze = (r: InboxItem) => snoozeMenu([resultKey(r)])

function DecisionsSection({ rows, max }: { rows: InboxItem[]; max: number }) {
  const waits = rows.filter((r) => r.blocking), kept = rows.filter((r) => !r.blocking)
  const { shown, more, all, toggle } = useCap(waits, kept, max)
  if (!rows.length) return null
  const row = (r: InboxItem) => <DecisionRow key={r.id} r={r} snooze={decisionSnooze} swipe={decisionSwipe(r)} />
  return (
    <section data-inbox-decisions>
      <div className="mb-0.5 flex h-7 items-center gap-2">
        <h3 className="flex-1 text-[13px] font-semibold text-muted-foreground">Decisions <span className="font-normal tabular-nums">{rows.length}</span></h3>
        {rows.length > 1 && (
          <button type="button" data-accept-all onClick={() => void acceptAll(rows)}
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-[13px] text-primary hover:bg-foreground/[0.06] max-md:h-9 max-md:text-[15px]">
            <ListTodo className="size-3.5" strokeWidth={2.25} />Accept all defaults
          </button>
        )}
      </div>
      <div className="hairline">{[...waits.map(row), ...shown.map(row)]}</div>
      <FoldButton more={more} all={all} toggle={toggle} className="mt-1 h-8 text-[13px]" />
    </section>
  )
}

function Reports({ store }: { store: Store }) {
  const rs = listsOf(store, useEvents().events).reports
  return (
    <Folded label="Reports today" n={rs.length} attr="data-inbox-reports">
      {rs.map((r) => (
        <button key={r.id} type="button" data-report={r.id} onClick={() => openFile(pathOf(r))}
          className="relative isolate flex min-h-11 w-full cursor-pointer items-center gap-3 py-2 text-left before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] hover:before:bg-foreground/[0.04]">
          <FileText className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={2} />
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-[15px] leading-[20px] max-md:text-[17px] max-md:leading-[22px]">{r.title}</span>
            {r.tldr && <span className="block text-[13px] text-muted-foreground max-md:line-clamp-2 max-md:text-[15px] md:truncate">{r.tldr}</span>}
          </span>
          {(r.updated || r.created) && <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums max-md:text-[15px]">{fmtAgo((r.updated || r.created)!, { short: true })}</span>}
        </button>
      ))}
    </Folded>
  )
}

const draftKey = (e: InboxEvent) => e.id

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return "" } }

const KIND_ICON: Record<string, typeof Bell> = { done: CircleCheck, waiting: MessageCircleQuestion, error: CircleAlert }
const KIND_TINT: Record<string, string> = { done: "var(--green)", waiting: "var(--orange)", error: "var(--red)" }

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

const WHY: Record<string, string> = { permission: "Asks permission", question: "Asks you", auth: "Sign in", plan: "Plan to approve", report: "Report", error: "Failed" }
const standing = (e: InboxEvent) => (e.state === "working" ? "Working on it" : e.state === "open" && e.kind !== "info" ? WHY[e.ask ?? ""] ?? "" : "")

const iconButton = "grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground max-md:size-9"

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
  const n = useCount(store ?? ({} as Store))
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

const stop = (fn: () => void) => (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); fn() }

const answer = (e: InboxEvent, a: "approve" | "deny") => (haptic("medium"), answerAsk(e, a)).then(
  () => notify(a === "approve" ? "Approved" : "Denied"), (err) => notifyError(err, "Couldn't answer it"))

const shownWhole = (e: InboxEvent) => !e.body || (e.body.length <= 80 && !e.body.includes("\n"))

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

const pageSwipe = "-mx-2 bg-origin-content px-2"
const pickedRow = "data-[selected]:!bg-transparent data-[selected]:before:bg-primary/15"

function ResultRow({ r, done }: { r: InboxItem; done?: boolean }) {
  const meta = [r.from && `from ${r.from}`, r.source && host(r.source), (r.updated || r.created) && fmtAgo((r.updated || r.created)!), done && "settled"]
    .filter(Boolean).join(" · ")
  const key = resultKey(r), picked = useSelected(SELECT, key)
  const draft = useHasDraft(pathOf(r))
  return (
    <SwipeRow actions={() => resultSwipe(r)} className={pageSwipe}>
    <div data-result={r.id} data-select-key={key} {...selectedAttr(picked)} onContextMenu={menuFor(rowMenu(SELECT, key, done ? () => settledItems(r) : resultItemsMenu(r)))}
      className={cn("group/res relative isolate flex min-h-11 items-center gap-3 py-2 before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] hover:before:bg-foreground/[0.04]", pickedRow, done && "opacity-60 hover:opacity-100")}>
      <button type="button" data-keyrow className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[6px] text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40" onClick={(e) => { if (!selectClick(e, SELECT, key)) openFile(pathOf(r)) }}>
        {r.source ? <Globe className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={2} /> : <FileText className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={2} />}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[15px] leading-[20px] max-md:text-[17px] max-md:leading-[22px]">{r.title}</span>
          {(meta || draft) && <span className="block text-[13px] text-muted-foreground max-md:text-[15px] max-md:line-clamp-2 md:truncate"><DraftTag to={pathOf(r)} className="mr-1.5 align-[1px]" />{meta}</span>}
        </span>
      </button>
      {!done && r.do && <DoIt task={{ text: r.do }} done={() => void markDone(r)} />}
      {done
        ? <button type="button" className={iconButton} aria-label="Back to review" data-tip="Back to review" onClick={() => { haptic("medium"); void reopen(r) }}><RotateCcw className="size-4" strokeWidth={2.25} /></button>
        : <>
          <button type="button" className={iconButton} aria-label="Settle" data-tip="Settle" onClick={() => { haptic("medium"); void markDone(r) }}><Check className="size-4" strokeWidth={2.25} /></button>
          {/* (a phone swipes for it) */}
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

function EventRow({ e, fresh, touched }: { e: InboxEvent; fresh?: boolean; touched?: (id: string) => void }) {
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
      className={cn("group/ev relative isolate flex min-h-11 items-center gap-3 py-2 before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] hover:before:bg-foreground/[0.04]",
        pickedRow, done && !draft && "opacity-60 hover:opacity-100")}>
      <button type="button" data-keyrow className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[6px] text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40" onClick={(ev) => { if (selectClick(ev, SELECT, key)) return; if (!targetOf(e)) { setWhole(!whole); markRead([e.id]); return } openEvent(e); touched?.(e.id) }}>
        <EventIcon e={fresh ? { ...e, read: false } : e} className="size-[18px] shrink-0" />
        <span className="min-w-0 flex-1">
          <span className={cn("line-clamp-2 text-[15px] leading-[20px] max-md:text-[17px] max-md:leading-[22px]", !read && "font-semibold")}>{e.title}</span>
          {(e.body || e.machineLabel || e.parent || e.from || draft || where) && <span data-tip={whole ? undefined : line} data-tip-trunc
            className={cn("block text-[13px] text-muted-foreground max-md:text-[15px]", whole ? "whitespace-pre-wrap break-words" : "max-md:line-clamp-2 md:truncate")}><DraftTag to={draftKey(e)} className="mr-1.5 align-[1px]" />
            {where && <span data-standing className={cn("font-medium", e.state === "working" ? "text-tertiary" : "text-foreground/80")}>{where}{((line && !replying) || e.machineLabel || e.parent || e.from) && " · "}</span>}
            {[e.parent && `from ${threadTitle(e.parent)}`, e.from && `from ${threadTitle(e.from)}`, replying ? "" : whole ? e.body : line, e.machineLabel && `on ${e.machineLabel}`].filter(Boolean).join(" · ")}</span>}
        </span>
        {!asks && <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums max-md:text-[15px]">{fmtAgo(e.t, { short: true })}</span>}
      </button>
      <GateButtons e={e} className={iconButton} size="size-4" />
      {inPlace && (
        <button type="button" className={cn(iconButton, !replying && "md:invisible md:group-hover/ev:visible", replying && "text-foreground")} aria-label="Reply" data-tip="Reply"
          aria-expanded={replying} data-row-reply-button onClick={reply}><MessageSquareReply className="size-4" strokeWidth={2.25} /></button>
      )}
      {!asks && (e.state === "done"
        ? <button type="button" className={cn(iconButton, "md:invisible md:group-hover/ev:visible")} aria-label="Back to inbox" data-tip="Back to inbox" onClick={() => { haptic("medium"); markManyEventsDone([e], false) }}>
          <RotateCcw className="size-4" strokeWidth={2.25} /></button>
        : <button type="button" className={cn(iconButton, "md:invisible md:group-hover/ev:visible")} aria-label="Settle" data-tip="Settle" data-done onClick={() => { haptic("medium"); markManyEventsDone([e]); touched?.(e.id) }}>
          <Check className="size-4" strokeWidth={2.25} /></button>)}
      {/* (a phone swipes for it) */}
      {snoozable(e) && e.state !== "working" && (
        <button type="button" className={cn(iconButton, "max-md:hidden md:invisible md:group-hover/ev:visible")} aria-label="Snooze" data-tip="Snooze" data-snooze
          onClick={snoozeBelow([eventKey(e)])}><Clock className="size-4" strokeWidth={2.25} /></button>
      )}
      {!asks && <button type="button" className={cn(iconButton, "md:invisible md:group-hover/ev:visible")} aria-label="More" data-tip="More" onClick={rightClickBelow}>
        <MoreHorizontal className="size-4" strokeWidth={2.25} /></button>}
    </div>
    {replying && inPlace && <RowReply e={e} close={(back) => { setReplying(false); if (back) document.querySelector<HTMLElement>(`[data-event="${CSS.escape(e.id)}"] [data-keyrow]`)?.focus({ preventScroll: true }) }} />}
    </div>
    </SwipeRow>
  )
}

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
        onContextMenu={menuFor(rowMenu(SELECT, sel, () => [{ label: "Wake", icon: AlarmClockOff, run: () => snoozeKeys([sel], null) }, snoozeMenu([sel])]))}
        className={cn("group/sn relative isolate flex min-h-11 items-center gap-3 py-2 before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] hover:before:bg-foreground/[0.04]", pickedRow)}>
        <button type="button" data-keyrow className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[6px] text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40" onClick={(e) => { if (!selectClick(e, SELECT, sel)) openIt() }}>
          {icon}
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-[15px] leading-[20px] max-md:text-[17px] max-md:leading-[22px]">{title}</span>
            <span className="block truncate text-[13px] text-muted-foreground max-md:text-[15px]">Until {whenText(new Date(until)).replace(/^Tomorrow/, "tomorrow")}</span>
          </span>
        </button>
        <button type="button" className={iconButton} aria-label="Wake" data-tip="Wake" onClick={() => { haptic("medium"); snoozeKeys([sel], null) }}>
          <AlarmClockOff className="size-4" strokeWidth={2.25} /></button>
      </div>
    </SwipeRow>
  )
}

function Settled({ store, fresh }: { store: Store; fresh?: ReadonlySet<string> }) {
  const { events: evs, results } = listsOf(store, useEvents().events, fresh).done
  const rows = [...evs.map((e) => ({ at: e.t, row: <EventRow key={e.id} e={e} /> })), ...results.map((r) => ({ at: latestOf(r), row: <ResultRow key={r.id} r={r} done /> }))]
    .sort((a, b) => b.at - a.at)
  return <Folded label="Settled" n={rows.length} attr="data-inbox-settled">{rows.map((x) => x.row)}</Folded>
}

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
  all?: boolean
}) {
  const { ready, events } = useEvents()
  const l = listsOf(store, events, fresh)
  useTick()
  useBack(store)
  useInboxSelect(store)
  const loading = !!ne && !ready
  const live = ne ? [...l.pinned.events, ...l.needs, ...l.messages] : []
  const kept = ne ? `inbox:${dealt ? "page" : "block"}:events` : null
  const rows = useKeptCount(kept, loading ? undefined : live.length)
  const bodies = useKeptCount(kept && `${kept}:bodies`, loading ? undefined : live.filter((e) => e.body || e.machineLabel).length, 0)
  const row = (e: InboxEvent) => <EventRow key={e.id} e={e} fresh={fresh?.has(e.id)} touched={touched} />
  const past = dealt && <><Reports store={store} /><Snoozed store={store} /><Settled store={store} fresh={fresh} /></>
  const results = l.review.slice(0, nr)
  const byLatest = (xs: { at: number; row: ReactNode }[]) => xs.sort((a, b) => b.at - a.at).map((x) => x.row)
  const pinned = byLatest([...(ne ? l.pinned.events.map((e) => ({ at: e.t, row: row(e) })) : []), ...(nr ? l.pinned.results.map((r) => ({ at: latestOf(r), row: <ResultRow key={r.id} r={r} /> })) : [])])
  const active = [...(ne ? l.needs.map(row) : []),
    ...byLatest([...results.map((r) => ({ at: latestOf(r), row: <ResultRow key={r.id} r={r} /> })), ...(ne ? l.messages.map((e) => ({ at: e.t, row: row(e) })) : [])])]
  const empty = dealt ? "Nothing needs you." : "Nothing needs you. When an agent needs a decision from you, it shows here."
  if (!l.decisions.length && !pinned.length && !active.length && !live.length && !(loading && rows)) return <>{loading ? <Loading /> : <Empty>{empty}</Empty>}{dealt && <div className="mt-4 flex flex-col gap-4" data-select-list={SELECT}>{past}</div>}</>
  return (
    <div className="flex flex-col gap-4" data-select-list={SELECT} data-keylist>
      <DecisionsSection rows={l.decisions} max={dealt ? 100 : Math.max(ne, 3)} />
      <Section title="Pinned" attr="data-inbox-pinned" rows={pinned} max={dealt ? 50 : Math.max(ne, nr)} />
      <Section title="Active" attr="data-inbox-active" rows={active} max={dealt ? 100 : Math.max(ne, nr)}
        loading={loading && rows > 0 ? <LoadingRows count={rows} meta={bodies} lead={<span className="size-[18px] shrink-0" />} /> : undefined} />
      {past}
    </div>
  )
}

export function InboxBlock({ store, options }: { store: Store; options: Record<string, unknown> }) {
  const n = useCount(store)
  return (
    <Panel title={String(options.title || "Inbox")} icon={InboxIcon} tint="var(--inbox)"
      action={n > 0 ? <button type="button" className="cursor-pointer text-[13px] font-medium text-primary hover:underline" onClick={openInbox}>{n} new</button> : undefined}>
      <Lists store={store} events={Number(options.events ?? 5)} results={Number(options.results ?? 10)} />
    </Panel>
  )
}

const clearDone = () => void del("inbox/events?done=1").catch((e) => notifyError(e, "Couldn't clear them"))

export function InboxPage({ store, focused }: { store: Store; focused: boolean }) {
  const { events, unread } = useEvents()
  const selectingHere = useSelecting(SELECT)
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
            <Trash2 className="size-3.5" strokeWidth={2.25} />Clear settled
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
      <p className="mb-4 text-[13px] text-muted-foreground max-md:text-[15px]">
        What your agents need you to decide, each with its options; the ones they wait on come first. What they finished is in the morning brief and under Reports today.
      </p>
      <Lists store={store} events={20} results={100} fresh={fresh} touched={touched} all />
    </div>
  )
}
