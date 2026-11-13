import { useState, type MouseEvent } from "react"
import { CalendarClock, Clock } from "lucide-react"
import { backDetail, Button, detailPath, getStore, menuBelow, notify, openDetail, openMenu, plural, SheetHead, type MenuItem } from "@vaultite"
import { getEvents, snoozable, snoozeEvents } from "./events"
import { choices, snoozed, stampOf, whenText } from "./snooze"
import { reviewing } from "./threads"
import { eventKey, resultKey, change, leaveTabs } from "./items"

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

export const SNOOZE_DETAIL = "inbox-snooze"

export const snoozeItems = (keys: string[], then?: () => void): MenuItem[] => [
  ...choices().map((c) => ({ label: c.label, hint: whenText(c.at).replace(/^Tomorrow /, ""), run: () => { then?.(); snoozeKeys(keys, c.at) } })),
  { label: "Pick a time…", icon: CalendarClock, sep: true, run: () => openDetail(detailPath(SNOOZE_DETAIL, ...keys)) },
]
export const snoozeMenu = (keys: string[], icon = true): MenuItem => ({ label: "Snooze", ...(icon ? { icon: Clock } : {}), run: () => {}, items: snoozeItems(keys) })
export const snoozeBelow = (keys: string[], then?: () => void) => (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); menuBelow(e, snoozeItems(keys, then)) }
export const snoozeAtRow = (keys: string[]) => (row?: DOMRect) => openMenu({ x: row ? row.left + 16 : 16, y: row ? row.bottom + 4 : innerHeight / 3, flip: row ? row.top - 4 : undefined }, snoozeItems(keys))

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
