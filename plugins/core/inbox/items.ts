import { useEffect, useState } from "react"
import { activePane, askMove, closePane, getStore, isViewOpen, notify, openFile, openView, optimistic, paneTab, panesShowing, plural, put, selectPane, setProperty, type Store } from "@vaultite"
import { getEvents, markEventsDone, pinEvents, unsettle, useEvents } from "./events"
import type { InboxEvent, InboxItem } from "./types"
import { snoozed, snoozeMs } from "./snooze"
import { countOf, lists, reviewing } from "./threads"

export const waiting = (r: InboxItem) => reviewing(r) && !snoozed(r.snoozed)
export const listsOf = (store: Store | null | undefined, events = getEvents().events, fresh?: ReadonlySet<string>) => lists(events, store?.inbox ?? [], fresh)
export const toReview = (store: Store | null | undefined): InboxItem[] => { const l = listsOf(store); return [...l.pinned.results, ...l.review] }

export function useBack(store: Store | null | undefined) {
  const { events } = useEvents()
  const [, redraw] = useState(0)
  const now = Date.now()
  const next = Math.min(...[...(store?.inbox ?? []).filter(reviewing).map((r) => snoozeMs(r.snoozed)), ...events.map((e) => e.snoozed ?? 0)].filter((t) => t > now))
  useEffect(() => {
    if (!Number.isFinite(next)) return
    const t = setTimeout(() => redraw((n) => n + 1), Math.min(next - Date.now() + 100, 2 ** 31 - 1))
    return () => clearTimeout(t)
  }, [next])
}

export function useCount(store: Store | null | undefined) {
  useBack(store)
  return countOf(listsOf(store, useEvents().events))
}

export const openInbox = () => openView("inbox", { newTab: !isViewOpen("view:inbox") })

export const pathOf = (r: InboxItem) => `${r.id}.md`

export const SELECT = "inbox"
export const resultKey = (r: InboxItem) => `r:${r.id}`, eventKey = (e: InboxEvent) => `e:${e.id}`

export function change(r: InboxItem, fields: Record<string, unknown>): Promise<InboxItem> {
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

export function leaveTabs(going: InboxItem[]) {
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
  const all = toReview(getStore()), i = all.findIndex((x) => x.id === r.id)
  const list = all.filter((x) => x === r || !going.some((g) => g.id === x.id)), j = list.indexOf(all[i])
  return i < 0 ? undefined : list[j + 1] ?? list[j - 1]
}

export function fileTo(r: InboxItem) {
  const p = pathOf(r)
  askMove(p, { before: () => unInbox(p) })
}
export const unInbox = async (p: string) => { await setProperty(p, "status", undefined); await setProperty(p, "type", undefined) }

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

export async function markManyDone(list: InboxItem[], done = true, pinned: boolean[] = []) {
  if (done) leaveTabs(list)
  const all = await Promise.allSettled(list.map((r, i) => change(r, { status: done ? "done" : "new", ...(done ? {} : { archived: false, ...(pinned[i] ? { pinned: true } : {}) }) })))
  const ok = list.flatMap((was, i) => { const x = all[i]; return x.status === "fulfilled" ? [{ was, now: x.value }] : [] })
  const now = ok.map((x) => x.now)
  if (now.length) notify(done ? `Settled ${plural(now.length, "result")}` : `Put back ${plural(now.length, "result")} to review`,
    { action: { label: "Undo", run: () => void markManyDone(now, !done, done ? ok.map((x) => !!x.was.pinned) : []) } })
}

export function markManyEventsDone(evs: InboxEvent[], done = true) {
  if (!evs.length) return
  void markEventsDone(evs.map((e) => e.id), done)
  notify(evs.length === 1 ? (done ? `Settled “${evs[0].title}”` : `Back in the inbox: “${evs[0].title}”`) : (done ? `Settled ${plural(evs.length, "item")}` : `Put back ${plural(evs.length, "item")} in the inbox`),
    { action: { label: "Undo", run: () => void (done ? unsettle(evs) : markEventsDone(evs.map((e) => e.id), true)) } })
}

export const reopen = (r: InboxItem) => change(r, { status: "new", archived: false })
