// The errors the app and server hit, one row per kind; opening one shows its stacks and each time it happened. Polls
// every 10 s while the page shows.
import { useState } from "react"
import { AlertTriangle } from "lucide-react"
import { Bar, cn, confirmDialog, copyText, del, Empty, fmtAgo, fmtStamp, List, Loading, notify, notifyError, Panel, plural, Segmented, useKeptCount, useLive } from "@vaultite"
import type { ErrorDetail, ErrorEvent, ErrorGroup, ErrorList } from "./model"

export const TINT = "var(--errors, var(--red))"
type Filter = "all" | "app" | "server"

const KIND: Record<string, string> = {
  stopped: "stopped the app", boot: "before the app started", boundary: "a block or view failed", uncaught: "uncaught",
  rejection: "unhandled rejection", stale: "an older build (reloaded)", error: "logged", fatal: "ended the server",
}
const whereOf = (g: ErrorGroup) => (g.source === "app" ? `App${g.devices.length ? ` (${g.devices.join(", ")})` : ""}` : "Server")

/** Everything about one time, as text: what Copy puts on the clipboard (for a bug report or an agent). */
function report(g: ErrorGroup, events: ErrorEvent[]) {
  const e = events[0] ?? g.latest
  return [
    `${g.message}`, `${whereOf(g)}, ${KIND[g.kind] ?? g.kind}; ${plural(g.count, "time")}, last ${fmtStamp(g.last, true)} (error ${g.id})`,
    e.where ? `Request: ${e.where}` : "", e.url ? `At: ${e.url}` : "", e.build ? `Build: ${e.build}` : "",
    e.trail?.length ? `Before it: ${e.trail.join(" → ")}` : "",
    e.stack ? `\n${e.stack}` : "", e.component ? `\nComponents:${e.component}` : "",
  ].filter(Boolean).join("\n")
}

const pre = "max-h-72 overflow-auto rounded-[6px] border border-border px-3 py-2 font-mono text-[12px] leading-[1.5] whitespace-pre-wrap break-words select-text"
const linkBtn = "rounded-[6px] px-2 py-1 text-[13px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"

function Detail({ g, onForgot }: { g: ErrorGroup; onForgot: () => void }) {
  const { data } = useLive<ErrorDetail>(`errors/${g.id}`, undefined, undefined, 30_000)
  const events = data?.events ?? [g.latest]
  const e = events[0]
  return (
    <div className="flex flex-col gap-3 pt-1 pb-3 pl-6" data-error-detail={g.id}>
      {e.stack ? <pre className={pre}>{e.stack}</pre> : <Empty>No stack was recorded.</Empty>}
      {e.component && <details><summary className="cursor-pointer text-[13px] text-muted-foreground">Components</summary><pre className={cn(pre, "mt-1")}>{e.component.trim()}</pre></details>}
      <div className="flex flex-col gap-1.5">
        <div className="text-[13px] font-semibold text-muted-foreground">{g.count > events.length ? `The latest ${events.length} of ${g.count} times` : g.count === 1 ? "When" : "Each time"}</div>
        {events.map((x, i) => (
          <div key={i} className="text-[13px] leading-[18px]">
            <span className="tabular-nums">{fmtStamp(x.t, true)}</span>
            {(x.n ?? 1) > 1 && <span className="text-muted-foreground"> · ×{x.n}</span>}
            {x.device && <span className="text-muted-foreground"> · {x.device}</span>}
            {x.where && <span className="font-mono text-[12px] text-muted-foreground"> · {x.where}</span>}
            {x.url && <span className="font-mono text-[12px] text-muted-foreground"> · {x.url}</span>}
            {x.trail?.length ? <div className="text-muted-foreground">Before it: {x.trail.join(" → ")}</div> : null}
          </div>
        ))}
      </div>
      <div className="-ml-2 flex gap-1">
        <button type="button" className={linkBtn} onClick={() => copyText(report(g, events)).then(() => notify("Copied the error", { id: "copied" }), (err) => notifyError(err))}>Copy</button>
        <button type="button" className={linkBtn} onClick={() => del(`errors/${g.id}`).then(onForgot, (err) => notifyError(err, "Couldn't forget it"))}>Forget</button>
      </div>
    </div>
  )
}

const row = "flex w-full min-w-0 items-start gap-2 rounded-[6px] py-2 text-left"
const message = "block text-[15px] leading-[20px]"
const line = "block truncate text-[13px] leading-[18px] text-muted-foreground"
const ago = "shrink-0 pt-[1px] text-[13px] text-muted-foreground tabular-nums"

const widths = ["66%", "50%", "74%", "58%", "45%"]
/** Errors on their way: GroupRow's shape with bars for its lines. */
function Skeleton({ count }: { count: number }) {
  return (
    <div className="loading-in" aria-busy>
      <p className="mb-1 text-[13px]"><Bar w="14em" /></p>
      <List>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className={row}>
            <span className="mt-[3px] size-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className={message}><Bar w={widths[i % widths.length]} /></span>
              <span className={line}><Bar w={i % 2 ? "30%" : "38%"} /></span>
            </span>
            <span className={ago}><Bar w="2.5em" /></span>
          </div>
        ))}
      </List>
    </div>
  )
}

function GroupRow({ g, open, onToggle, onForgot }: { g: ErrorGroup; open: boolean; onToggle: () => void; onForgot: () => void }) {
  const bad = g.fatal > 0 || g.kind === "stopped" || g.kind === "boot"
  return (
    <div data-error={g.id}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className={cn(row, "hover:bg-foreground/[0.03]")}>
        <AlertTriangle className={cn("mt-[3px] size-4 shrink-0", bad ? "text-[var(--red)]" : g.kind === "stale" ? "text-tertiary" : "text-[var(--orange)]")} strokeWidth={2} />
        <span className="min-w-0 flex-1">
          <span className={cn(message, !open && "truncate")}>{g.message}</span>
          <span className={line}>
            {whereOf(g)} · {KIND[g.kind] ?? g.kind}{g.count > 1 ? ` · ×${g.count}` : ""}
          </span>
        </span>
        <span className={ago} data-tip={fmtStamp(g.last, true)}>{fmtAgo(g.last)}</span>
      </button>
      {open && <Detail g={g} onForgot={onForgot} />}
    </div>
  )
}

export function ErrorsList({ options = {} }: { options?: Record<string, unknown> }) {
  const fixed = options.source === "app" || options.source === "server" ? options.source : null
  const [filter, setFilter] = useState<Filter>("all")
  const source = fixed ?? (filter === "all" ? null : filter)
  const limit = Math.min(Math.max(typeof options.limit === "number" ? Math.round(options.limit) : 20, 1), 200)
  const [asked, setAsked] = useState(0)
  const reload = () => setAsked((n) => n + 1)
  const { data, error } = useLive<ErrorList>(`errors?limit=${limit}${source ? `&source=${source}` : ""}`, asked, undefined, 10_000)
  const [open, setOpen] = useState<string | null>(null)
  const rows = useKeptCount(`errors:${limit}:${source ?? "all"}`, data?.groups.length)
  const title = typeof options.title === "string" && options.title ? options.title : "Errors"
  const clearAll = async () => {
    if (!(await confirmDialog({ title: "Forget every error?", body: "The errors kept on this machine are deleted. New ones are still recorded.", confirm: "Forget all", danger: true }))) return
    del("errors").then(reload, (e) => notifyError(e, "Couldn't forget them"))
  }
  const action = (
    <div className="flex items-center gap-2">
      {!fixed && <Segmented label="Where" value={filter} onChange={setFilter}
        options={[{ value: "all", label: "All" }, { value: "app", label: "App" }, { value: "server", label: "Server" }]} />}
      {!!data?.groups.length && <button type="button" className={linkBtn} onClick={() => void clearAll()}>Clear</button>}
    </div>
  )
  return (
    <Panel title={title} icon={AlertTriangle} tint={TINT} action={action}>
      {!data ? (error || !rows ? <Loading error={error && "Couldn't read the errors."} /> : <Skeleton count={rows} />) : !data.groups.length ? (
        <Empty>No errors{source ? ` in the ${source}` : ""}. When the app or the server hits one, it's here.</Empty>
      ) : (
        <>
          <p className="mb-1 text-[13px] text-muted-foreground">{data.total} kind{data.total === 1 ? "" : "s"} of error, {data.events} time{data.events === 1 ? "" : "s"}{data.total > data.groups.length ? ` (the latest ${data.groups.length})` : ""}</p>
          <List>
            {data.groups.map((g) => <GroupRow key={g.id} g={g} open={open === g.id} onToggle={() => setOpen(open === g.id ? null : g.id)}
              onForgot={() => { setOpen(null); reload() }} />)}
          </List>
        </>
      )}
    </Panel>
  )
}

/** The view (view:errors): the list, the whole width. */
export function ErrorsView() {
  return (
    <div className="pb-10" data-errors-view>
      <h1 className="mb-1 text-[22px] leading-[28px] font-bold max-md:hidden">Errors</h1>
      <p className="mb-4 text-[13px] text-muted-foreground">What went wrong in the app and the server, kept on this machine. Open one for its stack and when it happened.</p>
      <ErrorsList options={{ limit: 100 }} />
    </div>
  )
}
