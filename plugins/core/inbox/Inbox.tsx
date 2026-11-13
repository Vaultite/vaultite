import { useEffect, useState, type ReactNode } from "react"
import { Inbox as InboxIcon, ListChecks, Trash2 } from "lucide-react"
import {
  cn, del, Empty, Loading, LoadingRows, notifyError, Panel, startSelecting, useKeptCount, useSelecting, useTick, type Store,
} from "@vaultite"
import { markSeen, useEvents } from "./events"
import type { InboxEvent } from "./types"
import { latestOf } from "./threads"
import { listsOf, useBack, useCount, openInbox, SELECT } from "./items"
import { useInboxSelect } from "./menus"
import { ResultRow, EventRow } from "./InboxRows"
import { DecisionsSection, Reports, Snoozed, Settled, Section } from "./Sections"

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
