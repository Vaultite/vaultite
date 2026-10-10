// What you did, as a timeline: ```block-recap (a day, a week or a month, stepping back and forth), a recap file's page
// (Recaps/<date>.md, drawn from its own text), and ```block-recap-stats (a grid of days and counts by kind).
import { useMemo, useState, type ComponentType } from "react"
import {
  Bookmark, Bot, CalendarDays, ChevronLeft, ChevronRight, CircleCheck, CircleDot, CircleX, Dot, FilePlus, FolderInput, ListPlus,
  Pencil, Puzzle, RotateCcw, Trash2,
} from "lucide-react"
import { addDays, cn, dow, Empty, fmtDay, fmtLongDay, Loading, Markdown, openFile, Panel, Segmented, today, type FileCtx, type Store } from "@vaultite"
import { Chips } from "./Feed"
import { groupOf, parseRecap, RECAP_GROUPS, type RecapEntry, type RecapGroup, type RecapKind, verbOf } from "./recap"
import { usePoll } from "./shared"

export const RECAP_TINT = "var(--activity)"

type Look = { icon: ComponentType<{ className?: string; strokeWidth?: number }>; tint: string; label: string }
const LOOKS: Record<RecapKind, Look> = {
  created: { icon: FilePlus, tint: "var(--purple)", label: "Created" },
  edited: { icon: Pencil, tint: "var(--gray)", label: "Edited" },
  moved: { icon: FolderInput, tint: "var(--gray)", label: "Moved" },
  deleted: { icon: Trash2, tint: "var(--red)", label: "Deleted" },
  captured: { icon: Bookmark, tint: "var(--blue)", label: "Captured" },
  logged: { icon: ListPlus, tint: "var(--pink)", label: "Logged" },
  done: { icon: CircleCheck, tint: "var(--teal)", label: "Task completed" },
  cancelled: { icon: CircleX, tint: "var(--orange)", label: "Task cancelled" },
  started: { icon: CircleDot, tint: "var(--blue)", label: "Task started" },
  reopened: { icon: RotateCcw, tint: "var(--gray)", label: "Task reopened" },
  agent: { icon: Bot, tint: "var(--orange)", label: "Agent" },
  updated: { icon: Puzzle, tint: "var(--indigo)", label: "Plugin updated" },
  other: { icon: Dot, tint: "var(--gray)", label: "" },
}
export const GROUP_TINT: Record<RecapGroup, string> = { notes: "var(--purple)", tasks: "var(--teal)", captures: "var(--blue)", logs: "var(--pink)", agents: "var(--orange)", plugins: "var(--indigo)" }

/** An entry's line without its verb (the label says it), and what the label adds after it: "Captured · Raindrop". */
function partsOf(e: RecapEntry) {
  const verb = verbOf(e.kind)
  const rest = verb && e.text.startsWith(`${verb} `) ? e.text.slice(verb.length + 1) : e.text
  const bits = rest.split(" · ")
  if (e.kind === "captured" && bits.length > 1) return { label: `Captured · ${bits[1]}`, title: [bits[0], ...bits.slice(2)].join(" · ") }
  if (e.kind === "updated" && e.text.startsWith("Rolled back ")) return { label: "Plugin rolled back", title: e.text.slice(12) }
  if (e.kind === "agent") { const m = /^(.+?) changed (.+)$/.exec(bits[0]); if (m) return { label: m[1], title: [`Changed ${m[2]}`, ...bits.slice(1)].join(" · ") } }
  return { label: LOOKS[e.kind].label, title: rest }
}

function EntryRow({ e, store, last }: { e: RecapEntry; store: Store; last: boolean }) {
  const look = LOOKS[e.kind] ?? LOOKS.other
  const Icon = look.icon
  const { label, title } = partsOf(e)
  const [head, ...meta] = title.split(" · ")
  const title1 = /^".*"$/.test(head) ? head.slice(1, -1) : head
  // A file's folder, as the mockup's path line.
  const folder = /^\[\[([^\]|]+)\/[^\]/|]+(\|[^\]]*)?\]\]$/.exec(head)?.[1]
  if (folder && e.kind !== "agent") meta.unshift(folder)
  return (
    <div className="flex gap-3" data-recap-entry={e.kind}>
      <time className="w-11 shrink-0 pt-[3px] text-[13px] text-muted-foreground tabular-nums">{e.time}</time>
      <div className="relative flex shrink-0 flex-col items-center">
        <span className="z-[1] grid size-7 place-items-center rounded-full border-[1.5px] bg-background" style={{ borderColor: look.tint, color: look.tint }}>
          <Icon className="size-[15px]" strokeWidth={2.25} />
        </span>
        {!last && <span className="absolute inset-y-0 top-7 w-px bg-border" />}
      </div>
      <div className="min-w-0 flex-1 pb-5">
        {label && <div className="text-[12px] font-semibold leading-[16px] tracking-wide" style={{ color: look.tint }}>{label}</div>}
        <div className="text-[15px] leading-[21px] font-medium break-words"><Markdown text={title1} store={store} inline /></div>
        {meta.length > 0 && <div className="text-[13px] leading-[18px] text-muted-foreground break-words"><Markdown text={meta.join(" · ")} store={store} inline /></div>}
        {e.quote.length > 0 && (
          <div className="mt-1.5 rounded-[8px] bg-foreground/[0.04] px-3 py-2 text-[14px] leading-[20px] text-foreground/85">
            {e.quote.map((q, i) => <div key={i} className="line-clamp-2 break-words"><Markdown text={q} store={store} inline /></div>)}
          </div>
        )}
        {e.items.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] leading-[19px]">
            {e.items.map((x, i) => <span key={i} className="min-w-0 break-words"><Markdown text={x} store={store} inline /></span>)}
          </div>
        )}
      </div>
    </div>
  )
}

/** Days of entries, newest day first and, in each, the latest first. `group` filters by kind. */
export function Timeline({ days, store, group }: { days: { date: string; entries: RecapEntry[] }[]; store: Store; group: RecapGroup | "" }) {
  const shown = days.map((d) => ({ ...d, entries: d.entries.filter((e) => !group || groupOf(e.kind) === group).slice().reverse() }))
  if (!shown.some((d) => d.entries.length)) return <Empty>{group ? "Nothing of this kind." : "Nothing recorded."}</Empty>
  return (
    <div data-recap>
      {shown.map((d) => d.entries.length > 0 && (
        <div key={d.date} data-recap-day={d.date} className="mb-2">
          {days.length > 1 && (
            <div className="mb-2.5 text-[14px]">
              <span className="font-semibold">{fmtLongDay(d.date)}</span>
              <span className="text-muted-foreground"> · {d.date === today() ? "Today" : `${d.entries.length} thing${d.entries.length === 1 ? "" : "s"}`}</span>
            </div>
          )}
          {d.entries.map((e, i) => <EntryRow key={`${e.time}-${i}`} e={e} store={store} last={i === d.entries.length - 1} />)}
        </div>
      ))}
    </div>
  )
}

/** The kinds present, as chips (only when there's more than one). */
function useGroups(days: { entries: RecapEntry[] }[]) {
  return useMemo(() => {
    const have = new Set(days.flatMap((d) => d.entries.map((e) => groupOf(e.kind))))
    return RECAP_GROUPS.filter((g) => have.has(g.id)).map((g) => ({ v: g.id as RecapGroup, label: g.label }))
  }, [days])
}

type Span = "day" | "week" | "month"
const SPAN_DAYS: Record<Span, number> = { day: 1, week: 7, month: 30 }
type RecapAnswer = { days: { date: string; entries: RecapEntry[]; live: boolean; path?: string }[] }

/** The date a block shows by default: the note it's in, when it's a day's (a daily note, a recap), else today. */
const dateOfFile = (p: string) => { const stem = p.split("/").pop()!.replace(/\.md$/, ""); return /^\d{4}-\d\d-\d\d$/.test(stem) ? stem : "" }

export function RecapBlock({ store, path, options }: { store: Store; path: string; options: Record<string, unknown> }) {
  const said = typeof options.date === "string" ? options.date.trim().toLowerCase() : ""
  const base = (/^\d{4}-\d\d-\d\d$/.test(said) ? said : said === "yesterday" ? addDays(today(), -1) : said === "today" ? today() : "") || dateOfFile(path) || today()
  const n = Math.min(Math.max(typeof options.days === "number" ? Math.round(options.days) : 1, 1), 31)
  const [span, setSpan] = useState<Span>(n >= 28 ? "month" : n >= 7 ? "week" : "day")
  const [end, setEnd] = useState(base)
  const [group, setGroup] = useState<RecapGroup | "">("")
  const days = SPAN_DAYS[span]
  const { data, error } = usePoll<RecapAnswer>(`activity/recap?date=${end}&days=${days}`, 30_000)
  const groups = useGroups(data?.days ?? [])
  const from = addDays(end, -(days - 1))
  const label = days === 1 ? fmtDay(end) : `${fmtDay(from)} – ${fmtDay(end)}`
  const step = (k: number) => { const next = addDays(end, k * days); setEnd(next > today() ? today() : next) }
  const file = days === 1 ? data?.days[0]?.path : undefined
  const nav = "grid size-7 cursor-pointer place-items-center rounded-[7px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-40"
  return (
    <Panel title={typeof options.title === "string" ? options.title : "What you did"} icon={CalendarDays} tint={RECAP_TINT}
      action={
        <div className="flex items-center gap-1">
          <button type="button" className={nav} aria-label="Before" data-tip="Before" onClick={() => step(-1)}><ChevronLeft className="size-4" strokeWidth={2.5} /></button>
          <button type="button" className="h-7 cursor-pointer rounded-[7px] px-1.5 text-[13px] text-muted-foreground tabular-nums hover:bg-foreground/[0.06] hover:text-foreground"
            data-tip={file ? `Open ${file}` : "Back to today"} onClick={(e) => (file ? openFile(file, { newTab: e.metaKey || e.ctrlKey }) : setEnd(today()))}>{label}</button>
          <button type="button" className={nav} aria-label="After" data-tip="After" disabled={end >= today()} onClick={() => step(1)}><ChevronRight className="size-4" strokeWidth={2.5} /></button>
        </div>
      }>
      <Segmented label="Span" value={span} onChange={setSpan} className="mb-3 w-full max-w-[280px]"
        options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
      {groups.length > 1 && <Chips name="Kind" opts={groups} value={group} onChange={setGroup} />}
      {!data ? <Loading error={error && "Couldn't read the recap."} /> : <Timeline days={data.days} store={store} group={group} />}
    </Panel>
  )
}

/** A recap file read: its entries as the timeline, your own lines around them as they are. */
export function RecapPage({ store, body, path }: FileCtx) {
  const { entries, before, after } = useMemo(() => parseRecap(body), [body])
  const [group, setGroup] = useState<RecapGroup | "">("")
  const days = useMemo(() => [{ date: dateOfFile(path), entries }], [path, entries])
  const groups = useGroups(days)
  return (
    <div className="mx-auto w-full max-w-[720px] px-1 pb-10">
      {before && <Markdown text={before} store={store} className="mb-4" from={path} />}
      {groups.length > 1 && <Chips name="Kind" opts={groups} value={group} onChange={setGroup} />}
      <Timeline days={days} store={store} group={group} />
      {after && <Markdown text={after} store={store} className="mt-4" from={path} />}
    </div>
  )
}

type Counts = { from: string; to: string; days: Record<string, Partial<Record<RecapGroup, number>>> }

export function RecapStats({ store, options }: { store: Store; options: Record<string, unknown> }) {
  const weeks = Math.min(Math.max(typeof options.weeks === "number" ? Math.round(options.weeks) : 10, 1), 53)
  const { data, error } = usePoll<Counts>(`activity/recap/counts?weeks=${weeks}`, 60_000)
  const recaps = useMemo(() => new Map((store.files?.files ?? []).filter((f) => f.kind === "recaps").map((f) => [dateOfFile(f.path), f.path])), [store.files])
  if (!data) return <Panel title="Your days" icon={CalendarDays} tint={RECAP_TINT}><Loading error={error && "Couldn't read the recaps."} /></Panel>
  const sum = (d: string) => Object.values(data.days[d] ?? {}).reduce((n, x) => n + (x ?? 0), 0)
  // Whole weeks, Monday first, ending with this one.
  const start = addDays(data.to, -(dow(data.to) + (weeks - 1) * 7))
  const cols = Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i)))
  const max = Math.max(1, ...cols.flat().map(sum))
  const totals = RECAP_GROUPS.map((g) => ({ ...g, n: Object.values(data.days).reduce((n, d) => n + (d[g.id] ?? 0), 0) }))
  const top = Math.max(1, ...totals.map((t) => t.n))
  return (
    <Panel title={`Your days · last ${weeks} weeks`} icon={CalendarDays} tint={RECAP_TINT}>
      <div className="flex gap-[3px] overflow-x-auto pb-1" data-recap-grid>
        {cols.map((col, w) => (
          <div key={w} className="flex flex-col gap-[3px]">
            {col.map((d) => {
              const n = sum(d), p = recaps.get(d), future = d > data.to
              const level = n ? 0.25 + 0.75 * Math.min(1, n / max) : 0
              return (
                <button key={d} type="button" disabled={!p} data-day={d}
                  data-tip={future ? undefined : `${fmtLongDay(d)}: ${n ? `${n} thing${n === 1 ? "" : "s"}` : "nothing recorded"}`}
                  onClick={(e) => p && openFile(p, { newTab: e.metaKey || e.ctrlKey })}
                  className={cn("size-[15px] rounded-[3px]", p ? "cursor-pointer" : "cursor-default", future && "opacity-0")}
                  style={{ background: n ? `color-mix(in oklab, ${RECAP_TINT} ${Math.round(level * 100)}%, transparent)` : "color-mix(in oklab, var(--foreground) 7%, transparent)" }} />
              )
            })}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-2.5">
        {totals.filter((t) => t.n).map((t) => (
          <div key={t.id} data-recap-total={t.id}>
            <div className="flex justify-between text-[14px]"><span>{t.label}</span><span className="text-muted-foreground tabular-nums">{t.n}</span></div>
            <div className="mt-1 h-[5px] rounded-full bg-foreground/[0.07]"><div className="h-full rounded-full" style={{ width: `${(t.n / top) * 100}%`, background: GROUP_TINT[t.id] }} /></div>
          </div>
        ))}
        {!totals.some((t) => t.n) && <Empty>Nothing recorded yet.</Empty>}
      </div>
    </Panel>
  )
}
