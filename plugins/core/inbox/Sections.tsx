import { useState, type ReactNode } from "react"
import { ChevronRight, Clock, FileText, ListTodo } from "lucide-react"
import { cn, fmtAgo, openFile, type Store } from "@vaultite"
import { openEvent, useEvents } from "./events"
import type { InboxItem } from "./types"
import { snoozeMs } from "./snooze"
import { latestOf } from "./threads"
import { acceptAll, DecisionRow } from "./DecisionRows"
import { listsOf, pathOf, resultKey, eventKey } from "./items"
import { resultSwipe, eventSwipe, decisionSwipe, decisionSnooze } from "./menus"
import { EventIcon, rowTitle, ResultRow, EventRow, SnoozedRow } from "./InboxRows"

export function useCap<T>(first: T[], rest: T[], max: number) {
  const [all, setAll] = useState(false)
  const room = Math.max(0, max - first.length)
  return { shown: all ? rest : rest.slice(0, room), more: Math.max(0, rest.length - room), all, toggle: () => setAll(!all) }
}

export function FoldButton({ more, all, toggle, className }: { more: number; all: boolean; toggle: () => void; className: string }) {
  if (!more && !all) return null
  return (
    <button type="button" data-inbox-fold={all ? "open" : "closed"} onClick={toggle}
      className={cn("cursor-pointer text-left text-tertiary hover:text-foreground", className)}>
      {all ? "Show less" : `Show ${more} more`}
    </button>
  )
}

export function DecisionsSection({ rows, max }: { rows: InboxItem[]; max: number }) {
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

export function Reports({ store }: { store: Store }) {
  const rs = listsOf(store, useEvents().events).reports
  return (
    <Folded label="Reports today" n={rs.length} attr="data-inbox-reports">
      {rs.map((r) => (
        <button key={r.id} type="button" data-report={r.id} onClick={() => openFile(pathOf(r))}
          className="relative isolate flex min-h-11 w-full cursor-pointer items-center gap-3 py-2 text-left before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] hover:before:bg-foreground/[0.04]">
          <FileText className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={2} />
          <span className="min-w-0 flex-1">
            <span className={rowTitle}>{r.title}</span>
            {r.tldr && <span className="block text-[13px] text-muted-foreground max-md:line-clamp-2 max-md:text-[15px] md:truncate">{r.tldr}</span>}
          </span>
          {(r.updated || r.created) && <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums max-md:text-[15px]">{fmtAgo((r.updated || r.created)!, { short: true })}</span>}
        </button>
      ))}
    </Folded>
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

export function Snoozed({ store }: { store: Store }) {
  const { results, events: evs } = listsOf(store, useEvents().events).snoozed
  const rows = [
    ...results.map((r) => ({ sel: resultKey(r), title: r.title, until: snoozeMs(r.snoozed), icon: <Clock className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={2} />, open: () => openFile(pathOf(r)), swipe: () => resultSwipe(r) })),
    ...evs.map((e) => ({ sel: eventKey(e), title: e.title, until: e.snoozed!, icon: <EventIcon e={e} className="size-[18px] shrink-0" />, open: () => openEvent(e), swipe: () => eventSwipe(e) })),
  ].sort((a, b) => a.until - b.until)
  return <Folded label="Snoozed" n={rows.length} attr="data-inbox-snoozed">{rows.map((x) => <SnoozedRow key={x.sel} {...x} />)}</Folded>
}

export function Settled({ store, fresh }: { store: Store; fresh?: ReadonlySet<string> }) {
  const { events: evs, results } = listsOf(store, useEvents().events, fresh).done
  const rows = [...evs.map((e) => ({ at: e.t, row: <EventRow key={e.id} e={e} /> })), ...results.map((r) => ({ at: latestOf(r), row: <ResultRow key={r.id} r={r} done /> }))]
    .sort((a, b) => b.at - a.at)
  return <Folded label="Settled" n={rows.length} attr="data-inbox-settled">{rows.map((x) => x.row)}</Folded>
}

export function Section({ title, attr, rows, max, loading }: { title: string; attr: string; rows: ReactNode[]; max: number; loading?: ReactNode }) {
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
