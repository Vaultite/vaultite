import type { MouseEvent } from "react"
import { AlarmClockOff, Check, Clock, ExternalLink, FileText, FolderInput, Globe, Mail, MailOpen, MoreHorizontal, Pin, PinOff, RotateCcw, ShieldCheck, SquareTerminal, Trash2 } from "lucide-react"
import { askMoveMany, cn, DoIt, getStore, haptic, menuBelow, openFile, openMenu, openWebLink, pluginFileGroups, useSelectable, useStoreWith, type FileHead, type MenuItem, type Store, type SwipeAction, type TabButton } from "@vaultite"
import { fixEvent, forget, getEvents, markRead, markUnread, openAsker, openEvent, snoozable, targetOf } from "./events"
import type { InboxEvent, InboxItem } from "./types"
import { snoozed } from "./snooze"
import { reviewing } from "./threads"
import { keepDefault } from "./DecisionRows"
import { waiting, pathOf, SELECT, resultKey, eventKey, markDone, fileTo, unInbox, pinKeys, markManyDone, markManyEventsDone, reopen } from "./items"
import { snoozeAtRow, snoozeBelow, snoozeKeys, snoozeMenu } from "./Snoozing"

const pinItem = (keys: string[], pinned: boolean): MenuItem => pinned
  ? { label: "Unpin", icon: PinOff, run: () => pinKeys(keys, false) }
  : { label: "Pin", icon: Pin, run: () => pinKeys(keys, true) }

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
export function useInboxSelect(store: Store) {
  useSelectable(SELECT, { menu: (keys) => selectionItems(store, keys), noun: ["item", "items"] })
}

const moreAt = (items: () => MenuItem[]) => (row?: DOMRect) => openMenu({ x: row ? row.right - 16 : 16, y: row ? row.bottom + 4 : innerHeight / 3, flip: row ? row.top - 4 : undefined }, items())
export const resultSwipe = (r: InboxItem): SwipeAction[] => waiting(r)
  ? [{ label: "More", icon: MoreHorizontal, run: moreAt(() => resultItems(r)) }, { label: "Snooze", icon: Clock, run: snoozeAtRow([resultKey(r)]) },
    { label: "Settle", icon: Check, run: () => markDone(r), removes: true }]
  : reviewing(r) ? [{ label: "Wake", icon: AlarmClockOff, run: () => snoozeKeys([resultKey(r)], null), removes: true }]
  : [{ label: "To review", icon: RotateCcw, run: () => reopen(r), removes: true }]
export const eventSwipe = (e: InboxEvent, reply?: SwipeAction): SwipeAction[] => e.state === "done"
  ? [{ label: "Back", icon: RotateCcw, run: () => markManyEventsDone([e], false), removes: true }]
  : snoozed(e.snoozed)
  ? [{ label: "Wake", icon: AlarmClockOff, run: () => snoozeKeys([eventKey(e)], null), removes: true }]
  : [
    { label: "More", icon: MoreHorizontal, run: moreAt(eventItems(e, !e.read)) },
    ...(snoozable(e) ? [{ label: "Snooze", icon: Clock, run: snoozeAtRow([eventKey(e)]) }] : []),
    ...(reply ? [reply] : []),
    e.fix ? { label: e.fix.label, icon: ShieldCheck, run: () => fixEvent(e) } : { label: "Settle", icon: Check, run: () => markManyEventsDone([e]), removes: true },
  ]

const resultItems = (r: InboxItem): MenuItem[] => [
  { label: "Open", icon: FileText, run: () => openFile(pathOf(r)) },
  ...(r.source && /^https?:/.test(r.source) ? [{ label: "Open the page", icon: Globe, run: () => openWebLink(r.source!) }] : []),
  { label: "File to…", icon: FolderInput, sep: true, run: () => fileTo(r) },
  pinItem([resultKey(r)], !!r.pinned),
  snoozeMenu([resultKey(r)]),
  ...pluginFileGroups(pathOf(r), "inbox").rest.flat().map((it, i) => ({ ...it, sep: i === 0 })),
]

export function moreMenu(e: MouseEvent, r: InboxItem) {
  menuBelow(e, resultItems(r))
}


export const settledItems = (r: InboxItem): MenuItem[] => [resultItems(r)[0], { label: "Back to review", icon: RotateCcw, sep: true, run: () => void reopen(r) }]

export const resultItemsMenu = (r: InboxItem) => () => [{ label: "Settle", icon: Check, run: () => markDone(r) }, { ...resultItems(r)[0], sep: true }, ...resultItems(r).slice(1)]

export const eventItems = (e: InboxEvent, shownNew: boolean, touched?: (id: string) => void) => (): MenuItem[] => [
  ...(targetOf(e) ? [{ label: "Open", icon: ExternalLink, run: () => { openEvent(e); touched?.(e.id) } }] : []),
  ...(e.from ? [{ label: "Go to session", icon: SquareTerminal, run: () => openAsker(e) }] : []),
  shownNew
    ? { label: "Mark as read", icon: MailOpen, run: () => { markRead([e.id]); touched?.(e.id) } }
    : { label: "Mark as unread", icon: Mail, run: () => markUnread([e.id]) },
  ...(e.state !== "done" ? [pinItem([eventKey(e)], !!e.pinned)] : []),
  ...(snoozable(e) ? [snoozeMenu([eventKey(e)])] : []),
  ...(e.fix && e.state !== "done" ? [{ label: e.fix.label, icon: ShieldCheck, sep: true, run: () => fixEvent(e) }] : []),
  e.state === "done"
    ? { label: "Back to inbox", icon: RotateCcw, sep: true, run: () => markManyEventsDone([e], false) }
    : { label: "Settle", icon: Check, sep: true, run: () => { markManyEventsDone([e]); touched?.(e.id) } },
  ...(e.state === "done" ? [{ label: "Delete", icon: Trash2, run: () => void forget(e.id) }] : []),
]

export const decisionItems = (r: InboxItem): MenuItem[] => [
  { label: "Open", icon: FileText, run: () => openFile(pathOf(r)) },
  ...(r.default ? [{ label: `Accept the default (${r.default})`, icon: Check, sep: true, run: () => void keepDefault(r) }] : []),
  snoozeMenu([resultKey(r)]),
]
export const decisionSwipe = (r: InboxItem): SwipeAction[] => snoozed(r.snoozed)
  ? [{ label: "Wake", icon: AlarmClockOff, run: () => snoozeKeys([resultKey(r)], null), removes: true }]
  : [{ label: "Snooze", icon: Clock, run: snoozeAtRow([resultKey(r)]) }, ...(r.default ? [{ label: "Keep default", icon: Check, run: () => void keepDefault(r), removes: true }] : [])]
export const decisionSnooze = (r: InboxItem) => snoozeMenu([resultKey(r)])

export const stop = (fn: () => void) => (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); fn() }

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
