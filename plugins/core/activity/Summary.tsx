// ```block-activity-summary: the last 24 hours (`days: 1`, per hour) or days (per day): how much was done, by you, by
// coding agents and by everything else; who did it; the files touched most.
import { BarChart3, ChevronRight } from "lucide-react"
import { cn, Empty, fmtDay, Loading, openFile, Panel, Section, useTick, type Store } from "@vaultite"
import type { ActivitySummary, ActorCount } from "./model"
import { Columns } from "./Columns"
import { shortName, TINT, useExists } from "./Feed"
import { ago, clock, count, localDay, openTerminal, stamp, usePoll, useLook } from "./shared"

const SERIES = [
  { key: "you", label: "You", color: "var(--blue)" },
  { key: "agents", label: "Agents", color: "var(--orange)" },
  { key: "other", label: "Other", color: "var(--gray)" },
]

const rowButton = "relative isolate cursor-pointer text-left before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] " +
  "before:transition-colors hover:before:bg-foreground/[0.04] active:before:bg-foreground/[0.07]"

function ActorRow({ a }: { a: ActorCount }) {
  const look = useLook()(a)
  const Icon = look.icon
  const term = a.kind === "agent" ? a.terminal : undefined
  const body = (
    <>
      <Icon className="size-[17px] shrink-0" strokeWidth={2} style={{ color: look.tint }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] leading-[20px]">{a.name}</div>
        <div className="truncate text-[13px] text-muted-foreground" data-tip={stamp(a.last)}>{[a.session, ago(a.last)].filter(Boolean).join(" · ")}</div>
      </div>
      <span className="shrink-0 text-[14px] text-muted-foreground tabular-nums">{count(a.n)}</span>
      {term && <ChevronRight className="-ml-1.5 size-4 shrink-0 text-tertiary" strokeWidth={2.5} />}
    </>
  )
  const cls = "flex min-h-11 w-full items-center gap-2.5 py-2"
  return term ? (
    <button type="button" className={cn(cls, rowButton)} data-tip="Go to its terminal" onClick={() => void openTerminal(term)}>{body}</button>
  ) : <div className={cls}>{body}</div>
}

function FileRow({ f, exists }: { f: ActivitySummary["files"][number]; exists: boolean }) {
  const folder = f.path.split("/").slice(0, -1).join("/")
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-[15px] leading-[20px]", exists ? "text-primary" : "text-muted-foreground")}>{shortName(f.path)}</div>
        <div className="truncate text-[13px] text-muted-foreground">{[folder, f.actors.join(", ")].filter(Boolean).join(" · ")}</div>
      </div>
      <span className="shrink-0 text-[14px] text-muted-foreground tabular-nums" data-tip={`Last ${ago(f.last)}`}>{count(f.n)}</span>
    </>
  )
  const cls = "flex min-h-11 w-full items-center gap-3 py-2"
  return exists ? (
    <button type="button" className={cn(cls, rowButton)} data-tip={f.path} data-path={f.path}
      onClick={(e) => openFile(f.path, { newTab: e.metaKey || e.ctrlKey })}>{body}</button>
  ) : <div className={cls} data-tip={`${f.path} (not in the vault now)`}>{body}</div>
}

export function SummaryBlock({ store, options }: { store: Store; options: Record<string, unknown> }) {
  const days = Math.min(Math.max(typeof options.days === "number" ? Math.round(options.days) : 1, 1), 31)
  const { data, error } = usePoll<ActivitySummary>(`activity/summary?days=${days}`, 15_000)
  const exists = useExists(store)
  useTick(60_000)
  const hourly = data?.bucket === "hour"
  const title = typeof options.title === "string" ? options.title : days === 1 ? "Last 24 hours" : `Last ${days} days`
  return (
    <Panel title={title} icon={BarChart3} tint={TINT}
      action={data && <span className="text-[13px] text-muted-foreground tabular-nums">{count(data.total)} done</span>}>
      {!data ? <Loading error={error && "Couldn't read the activity."} /> : (
        <div data-activity-summary>
          <Columns series={SERIES} legend="totals" format={count}
            cols={data.buckets.map((b) => ({
              values: [b.you, b.agents, b.other],
              tip: hourly ? `${clock(b.t)}–${clock(b.t + 3_600_000)}` : fmtDay(localDay(b.t)),
            }))}
            from={data.buckets.length ? (hourly ? clock(data.buckets[0].t) : fmtDay(localDay(data.buckets[0].t))) : ""}
            to={hourly ? "Now" : "Today"} />
          <div className="mt-5 grid grid-cols-1 gap-x-8 gap-y-4 @2xl:grid-cols-2">
            <Section title="Who">
              {data.actors.length ? <div className="hairline">{data.actors.slice(0, 8).map((a) => <ActorRow key={`${a.kind}:${a.name}`} a={a} />)}</div>
                : <Empty>Nobody yet.</Empty>}
            </Section>
            <Section title="Files touched most">
              {data.files.length ? <div className="hairline">{data.files.slice(0, 8).map((f) => <FileRow key={f.path} f={f} exists={exists.has(f.path)} />)}</div>
                : <Empty>No files yet.</Empty>}
            </Section>
          </div>
        </div>
      )}
    </Panel>
  )
}
