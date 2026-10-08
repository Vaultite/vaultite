// The feed: what was done, newest first, grouped by day, live (every 4 s while the page shows). The `activity` block,
// the Activity tab (view:activity) and, one line each, the sidebar's Activity panel (Panel.tsx).
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Activity as ActivityIcon, ChevronRight } from "lucide-react"
import { cn, Empty, fmtDay, get, Loading, openFile, pageOf, Panel, Section, useTick, type Store } from "@vaultite"
import { ACTION_KINDS, type ActionKind, type ActivityEvent, type ActivityList, type ActorKind } from "./model"
import { ago, clock, kindLabel, localDay, ms, openTerminal, stamp, usePoll, useLook, whoOf } from "./shared"

export const TINT = "var(--activity)"
export const KINDS: ActorKind[] = ["you", "agent", "cli", "script", "disk"]
const SLOW = 300

/** The files in the vault (a path that's gone isn't a link). */
export function useExists(store: Store) {
  return useMemo(() => {
    const s = new Set<string>()
    for (const f of store.files?.files ?? []) s.add(f.path)
    for (const f of store.files?.others ?? []) s.add(f.path)
    return s
  }, [store.files])
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** What a path reads as in a line: a note by its name (like a [[link]]), any other file by its file name. */
export const shortName = (p: string) => (/\.md$/i.test(p) ? p.split("/").pop()!.replace(/\.md$/i, "") : p.split("/").pop() || p)

/** The event's line with its vault paths as links that open the file (`plain`: names only, no links: a one-line row). */
export function EventText({ e, exists, plain }: { e: ActivityEvent; exists: Set<string>; plain?: boolean }) {
  // Each path where the line says it, or its name ("Saved the note Idea"); longest first.
  const at = new Map<string, string>()
  for (const p of e.paths ?? []) {
    if (e.text.includes(p)) at.set(p, p)
    else { const n = shortName(p); if (n.length >= 3 && e.text.includes(n) && !at.has(n)) at.set(n, p) }
  }
  if (!at.size) return <>{e.text}</>
  const parts = e.text.split(new RegExp(`(${[...at.keys()].sort((a, b) => b.length - a.length).map(esc).join("|")})`))
  return (
    <>
      {parts.map((s, i) => {
        if (i % 2 === 0) return s
        const p = at.get(s) ?? s
        if (plain || !exists.has(p)) return <span key={i} data-tip={p}>{shortName(s)}</span>
        return (
          <button key={i} type="button" data-tip={p} data-path={p}
            onClick={(ev) => { ev.stopPropagation(); openFile(p, { newTab: ev.metaKey || ev.ctrlKey }) }}
            className="cursor-pointer font-medium text-primary hover:underline">{shortName(s)}</button>
        )
      })}
    </>
  )
}

/** Filter chips: All, then each choice (who: You, Agents, CLI, Scripts, On disk; what: Changes, Opens and reads...). */
export function Chips<T extends string>({ name, opts, value, onChange }: { name: string; opts: { v: T; label: string }[]; value: T | ""; onChange: (v: T | "") => void }) {
  const all: { v: T | ""; label: string }[] = [{ v: "", label: "All" }, ...opts]
  return (
    <div role="radiogroup" aria-label={name} className="chip-row -mx-1 mb-2 flex gap-1 overflow-x-auto px-1 max-md:-mt-1.5 max-md:mb-0.5 max-md:py-1.5">
      {all.map((o) => {
        const on = o.v === value
        return (
          <button key={o.v || "all"} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.v)} data-chip={o.v || "all"}
            className={cn(
              "relative h-7 shrink-0 cursor-pointer rounded-full px-2.5 text-[13px] transition-colors max-md:h-8 max-md:px-3 max-md:text-[15px]",
              "after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-['']",
              on ? "bg-foreground/[0.1] font-semibold" : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
            )}>{o.label}</button>
        )
      })}
    </div>
  )
}
const WHO = KINDS.map((k) => ({ v: k, label: kindLabel(k) }))
const WHAT = ACTION_KINDS.map((k) => ({ v: k.id as ActionKind, label: k.label }))

const rowButton = "relative isolate cursor-pointer text-left before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] " +
  "before:transition-colors hover:before:bg-foreground/[0.04] active:before:bg-foreground/[0.07]"

/** One event: who (icon), what (links to its files), when; an agent's row goes to its terminal. */
function EventRow({ e, exists }: { e: ActivityEvent; exists: Set<string> }) {
  const look = useLook()(e.actor)
  const Icon = look.icon
  const term = e.actor.kind === "agent" && e.actor.terminal
  const slow = e.ms !== undefined && e.ms >= SLOW
  const meta = [whoOf(e.actor), e.route && e.method && e.action === "request" ? `${e.method} /api/${e.route}` : ""].filter(Boolean).join(" · ")
  const body = (
    <>
      <span className="grid size-5 shrink-0 place-items-center pt-px"><Icon className="size-[17px]" strokeWidth={2} style={{ color: look.tint }} /></span>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[15px] leading-[20px] break-words">
          <EventText e={e} exists={exists} />
          {(e.count ?? 1) > 1 && <span className="ml-1.5 text-[13px] text-muted-foreground tabular-nums" data-tip={`${e.count} times in a row, the last ${clock(e.last ?? e.t)}`}>×{e.count}</span>}
        </div>
        <div className="flex gap-1 text-[13px] leading-[18px] text-muted-foreground">
          <span className="min-w-0 truncate">{meta}</span>
          {slow && <span className="shrink-0 tabular-nums" data-tip="How long the server took">· {ms(e.ms)}</span>}
        </div>
      </div>
      <span className="shrink-0 pt-px text-[13px] leading-[20px] text-muted-foreground tabular-nums" data-tip={stamp(e.last ?? e.t)}>{ago(e.last ?? e.t)}</span>
      {term && <ChevronRight className="-ml-1.5 mt-0.5 size-4 shrink-0 text-tertiary" strokeWidth={2.5} />}
    </>
  )
  const cls = "flex min-h-11 w-full items-start gap-2.5 py-2"
  return term ? (
    <div role="button" tabIndex={0} className={cn(cls, rowButton)} data-event={e.id} data-tip="Go to its terminal" data-tip-side="left"
      onClick={() => void openTerminal(e.actor.terminal!)} onKeyDown={(k) => { if (k.key === "Enter") void openTerminal(e.actor.terminal!) }}>{body}</div>
  ) : <div className={cls} data-event={e.id}>{body}</div>
}

/** Events by local day, newest first. */
export function byDay(events: ActivityEvent[]) {
  const out: [string, ActivityEvent[]][] = []
  for (const e of events) {
    const d = localDay(e.last ?? e.t)
    if (out.at(-1)?.[0] === d) out.at(-1)![1].push(e)
    else out.push([d, [e]])
  }
  return out
}

/** The query's path: the block's own file for `path: this`. */
export const pathOption = (o: unknown, file: string) => (o === "this" ? file : typeof o === "string" ? o : "")

export type FeedOpts = { limit?: number; actor?: ActorKind | ""; action?: ActionKind | ""; path?: string }

/** The events for a query, live, and older ones on "Load more". */
export function useFeed({ limit = 30, actor = "", action = "", path = "" }: FeedOpts) {
  const q = `limit=${limit}${actor ? `&actor=${actor}` : ""}${action ? `&action=${action}` : ""}${path ? `&path=${encodeURIComponent(path)}` : ""}`
  const { data, error, preview } = usePoll<ActivityList>(`activity?${q}`)
  const [older, setOlder] = useState<{ q: string; events: ActivityEvent[]; done: boolean }>({ q, events: [], done: false })
  const [busy, setBusy] = useState(false)
  useEffect(() => { setOlder({ q, events: [], done: false }) }, [q])
  const mine = older.q === q ? older : { q, events: [], done: false }
  const seen = new Set(data?.events.map((e) => e.id))
  const events = [...(data?.events ?? []), ...mine.events.filter((e) => !seen.has(e.id))]
  const more = !preview && !!data && !mine.done && events.length < data.total
  const loadMore = () => {
    const last = events.at(-1)
    if (!last || busy) return
    setBusy(true)
    get<ActivityList>(`activity?${q}&limit=${Math.max(limit, 50)}&before=${last.last ?? last.t}`).then((r) => {
      setOlder((o) => (o.q !== q ? o : { q, events: [...o.events, ...r.events], done: r.events.length === 0 }))
    }, () => { /* try again */ }).finally(() => setBusy(false))
  }
  return { data, error, events, more, loadMore, busy }
}

/** The feed itself: chips, then the days. */
export function FeedList({ store, opts, chips = true, empty }: { store: Store; opts: FeedOpts; chips?: boolean; empty?: ReactNode }) {
  const [actor, setActor] = useState<ActorKind | "">(opts.actor ?? "")
  useEffect(() => setActor(opts.actor ?? ""), [opts.actor])
  const [action, setAction] = useState<ActionKind | "">(opts.action ?? "")
  useEffect(() => setAction(opts.action ?? ""), [opts.action])
  const { data, error, events, more, loadMore, busy } = useFeed({ ...opts, actor, action })
  const exists = useExists(store)
  useTick()
  return (
    <div data-activity-feed>
      {chips && <Chips name="Who" opts={WHO} value={actor} onChange={setActor} />}
      {chips && <Chips name="What" opts={WHAT} value={action} onChange={setAction} />}
      {!data ? (
        <Loading error={error && "Couldn't read the activity."} />
      ) : !events.length ? (
        <Empty>{actor || action ? "Nothing like that yet." : empty ?? "Nothing yet."}</Empty>
      ) : (
        <div className="space-y-3">
          {byDay(events).map(([d, es]) => (
            <Section key={d} title={fmtDay(d)}>
              <div className="hairline">{es.map((e) => <EventRow key={e.id} e={e} exists={exists} />)}</div>
            </Section>
          ))}
          {more && (
            <button type="button" onClick={loadMore} disabled={busy} data-load-more
              className="min-h-11 cursor-pointer text-[15px] text-primary hover:underline disabled:cursor-default disabled:opacity-60">
              {busy ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** ```block-activity: `limit` (30), `actor` (a kind), `path` (a vault path, or `this`: the file the block is in). */
export function FeedBlock({ store, path: file, options }: { store: Store; path: string; options: Record<string, unknown> }) {
  const limit = Math.min(Math.max(typeof options.limit === "number" ? Math.round(options.limit) : 30, 1), 200)
  const actor = typeof options.actor === "string" && (KINDS as string[]).includes(options.actor) ? options.actor as ActorKind : ""
  const path = pathOption(options.path, file)
  const title = typeof options.title === "string" ? options.title : path && options.path === "this" ? "This file's activity" : "Activity"
  return (
    <Panel title={title} icon={ActivityIcon} tint={TINT}>
      <FeedList store={store} opts={{ limit, actor, path }} empty={path ? "Nothing done to this file yet." : undefined} />
    </Panel>
  )
}

/** The Activity tab (view:activity): the feed, page-sized. */
export function FeedView({ store }: { store: Store }) {
  return (
    <div className="pb-10" data-activity-view>
      <h1 className="mb-1 text-[22px] leading-[28px] font-bold max-md:hidden">Activity</h1>
      <p className="mb-4 text-[13px] text-muted-foreground">
        Everything done to the vault and the app, and by whom: you, coding agents, the CLI, scripts, and changes on disk.{" "}
        <button type="button" className="cursor-pointer text-primary hover:underline" onClick={() => openFile(pageOf(store, "activity", "Activity")?.path ?? "Dashboards/Activity.md")}>Open the Activity page</button>
      </p>
      <FeedList store={store} opts={{ limit: 50 }} />
    </div>
  )
}
