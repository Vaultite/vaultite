// A coding agent's usage, drawn alike for every agent plugin (its route answers an AgentUsage). Blocks on a page share
// one request every 15 s; `machine:` and `account:` pick another machine or account.
import { useEffect, useState, type MouseEvent, type ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { BarChart3, Boxes, ChevronRight, FolderGit2, Gauge, Terminal } from "lucide-react"
import { AmbientButton } from "@/components/Ambient"
import { Bars, Empty, List, Loading, Panel, Row, Section, Segmented, Stat } from "@/components/kit"
import { dateText, fmtAgo, fmtDay, fmtMin, fmtTime, numberText, useLive } from "@/core/data"
import type { BlockCtx } from "@/core/define"
import { isViewOpen, openView } from "@/core/files"
import { namedIcon } from "@/core/pages"
import { machinePath, onMachine, useMachines } from "@/core/machines"
import { notify } from "@/core/notify"
import { useEnabled } from "@/core/plugins"

/** Which agent, and where its plugin answers. */
export type AgentSource = {
  /** Its routes under /api/: GET <path>?days= (AgentUsage), GET <path>/session/<id> (SessionPage, AgentSession.tsx). */
  path: string
  /** Its name ("Claude Code"), and what its replies are signed with in a conversation ("Claude"; default: the name). */
  label: string
  speaker?: string
  icon: LucideIcon
  tint: string
  /** Its name in Terminal ("claude"): Resume in terminal opens terminal/resume-<agent>-<id>. */
  agent: string
  /** Its view of one session: view:<view>/<session id>. */
  view: string
  /** Said when there are no limits (yet): where they come from. */
  noLimits?: string
  /** What `cost` is, when it isn't the value at API list prices ("What Cursor charged"). */
  costNote?: string
}

export type Window = { id: string; label: string; minutes: number; used: number; resets_at: string | null }
/** Which account a session is in (a plugin with several), and whether it's private (no title, folder or conversation). */
type OfAccount = { account?: string; accountLabel?: string; private?: boolean }
export type Session = OfAccount & {
  id: string; title: string; project: string; root: string; cwd?: string; first: string; last: string
  cost: number; tokens: number; active_min: number; model: string
}
export type LiveSession = OfAccount & {
  pid: number; id: string; title: string; name: string; project: string; status: string; kind: string
  started: string | null; since: string | null; model: string | null; cost: number; tokens: number
  cwd?: string
  /** The app's terminal it runs in (Terminal plugin), when it does. */
  terminal?: string | null
}
export type Day = { date: string; cost: number; tokens: number; active_min: number; sessions: number }
export type Share = { name: string; cost: number; tokens: number; root?: string; sessions?: number; active_min?: number; last?: string }
export type AgentUsage = {
  updated: string
  plan: { name: string; monthly: number | null } | null
  limits: { source: string; observed: string; windows: Window[] } | null
  live: LiveSession[]; days: Day[]; projects: Share[]; models: Share[]; sessions: Session[]
  total: { cost: number; tokens: number; unpriced: number; cache_hit: number | null }
  /** Each account's plan and limits, when the plugin has several (all of them asked at once). */
  accounts?: { id: string; label: string; private?: boolean; plan: AgentUsage["plan"]; limits: AgentUsage["limits"] }[]
  /** Servers waiting for sessions started elsewhere (Claude Code's Remote Control): name, account, since when. */
  servers?: { pid: number; name: string; account: string; accountLabel: string; started: string | null }[]
}

const EVERY = 15_000
const str = (v: unknown) => (typeof v === "string" ? v : "")

/** A block's data, from its options' `machine` and `account`: the same path at the same moment for every block (so they
 *  share one request), again every 15 s while visible. `on` names another machine (" on Studio"). */
function useAgentUsage(src: AgentSource, options: Record<string, unknown>, days = 30) {
  const machine = str(options.machine), account = str(options.account)
  const machines = useMachines()
  const on = machine ? ` on ${machines?.find((m) => m.id === machine)?.label ?? machine}` : ""
  const [tick, setTick] = useState(() => Math.floor(Date.now() / EVERY))
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) setTick(Math.floor(Date.now() / EVERY)) }, 1000)
    return () => clearInterval(id)
  }, [])
  const { data, error } = useLive<AgentUsage>(machinePath(machine, `${src.path}?days=${days}${account ? `&account=${encodeURIComponent(account)}` : ""}`), tick)
  useEffect(() => {
    if (data) for (const s of [...data.sessions, ...data.live]) if (s.title) titles.set(`${src.view}/${onMachine(s.id, machine)}`, s.title)
  }, [data, src.view, machine])
  return { data, error: data ? null : error, on, machine }
}

/** Sessions' titles seen so far, by "<view>/<id>", for their tabs' labels (sessionTitle). */
const titles = new Map<string, string>()
/** A session tab's label: its title once a block has seen it, else "<label> session". */
export const sessionTitle = (src: AgentSource, id: string) => titles.get(`${src.view}/${id}`) || `${src.label} session`

/** Open a session: the terminal tab it runs in (Terminal plugin), or its conversation in a tab (not a private one's).
 *  `machine`: another machine's session. */
export function openSession(src: AgentSource, s: { id: string; terminal?: string | null; private?: boolean }, terminalOn: boolean, e?: MouseEvent, machine = "") {
  if (s.terminal && terminalOn) {
    const to = `terminal/${onMachine(s.terminal, machine)}`
    return openView(to, { newTab: !isViewOpen(to) })
  }
  if (s.private) return notify("A private account's conversations aren't shown")
  openView(`${src.view}/${onMachine(s.id, machine)}`, { newTab: !!(e?.metaKey || e?.ctrlKey) })
}

const titleOf = (s: { title: string; private?: boolean }, untitled: string) => (s.private ? "Private session" : s.title || untitled)

const daysOf = (o: Record<string, unknown>) => Math.min(Math.max(typeof o.days === "number" ? Math.round(o.days) : 30, 1), 30)
export const money = (v: number) => (v < 100 ? `$${v.toFixed(2)}` : `$${numberText(Math.round(v))}`)
export const tokens = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n)
const minsSince = (s: string | null) => (s ? Math.max((Date.now() - new Date(s).getTime()) / 60000, 0) : 0)
const status = (s: string) => (s === "busy" ? "Working" : s ? s[0].toUpperCase() + s.slice(1) : "Open")

/** Until its data comes: "Loading…", in about the room the data will take (`className`: a min height), so the page
 *  under it doesn't jump when it arrives. */
function Waiting({ src, error, className, on = "" }: { src: AgentSource; error: string | null; className?: string; on?: string }) {
  return <Loading className={error ? undefined : className} error={error && `Couldn't read ${src.label}${on || " on this machine"}.`} />
}

/** When a window renews: "in 2h 10m, 21:00" (a weekday when it's further than today). */
function renews(at: string) {
  const d = new Date(at)
  const left = (d.getTime() - Date.now()) / 60000
  const clock = left < 20 * 60 ? fmtTime(at) : `${dateText(d, { weekday: "short" })} ${fmtTime(at)}`
  return `Renews in ${left < 48 * 60 ? fmtMin(Math.max(Math.round(left), 1)) : `${Math.round(left / 1440)} days`}, ${clock}`
}

function Meter({ w, tint }: { w: Window; tint: string }) {
  const left = w.resets_at ? new Date(w.resets_at).getTime() - Date.now() : null
  // How much of the window's time has passed: spending faster than that runs out before it renews.
  const passed = left != null ? Math.min(Math.max(1 - left / (w.minutes * 60000), 0), 1) : null
  const ahead = passed != null && w.used / 100 > passed + 0.1
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[15px]">
        <span className="truncate">{w.label}</span>
        <span className="num shrink-0 font-semibold">{Math.round(w.used)}%</span>
      </div>
      <div className="relative mt-1.5 h-2">
        <div className="h-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${Math.min(w.used, 100)}%`, background: w.used >= 90 ? "var(--red)" : tint }} />
        </div>
        {passed != null && passed > 0.02 && passed < 0.98 && (
          <div data-tip={`${Math.round(passed * 100)}% of the window has passed`}
            className="absolute -top-1 -bottom-1 w-[2px] -translate-x-1/2 rounded-full bg-foreground/35"
            style={{ left: `${passed * 100}%` }} />
        )}
      </div>
      <div className="mt-1 text-[13px] text-muted-foreground">
        {[w.resets_at ? renews(w.resets_at) : w.used ? "Renewal time unknown" : "Not started", ahead && "ahead of pace"].filter(Boolean).join(" · ")}
      </div>
    </div>
  )
}

/** Its plan's allowances (a session, a week, a month), used and when they renew. */
function Limits({ src, lim }: { src: AgentSource; lim: AgentUsage["limits"] }) {
  if (!lim) return <Empty>{src.noLimits ?? "No limits yet."}</Empty>
  return (
    <div className="space-y-4">
      {lim.windows.map((w) => <Meter key={w.id} w={w} tint={src.tint} />)}
      <p className="text-[13px] text-muted-foreground">From the {lim.source}, {fmtAgo(lim.observed)}</p>
    </div>
  )
}

/** Its logo off its own page (the Agents dashboard mixes agents), else what the panel shows. */
const iconFor = (src: AgentSource, fm: Record<string, unknown>, icon: LucideIcon) =>
  namedIcon(typeof fm.icon === "string" ? fm.icon : null) === src.icon ? icon : src.icon

/** Its plan's limits in the status bar (AmbientItem): each account's tightest window, a click to `open`. */
export function AgentLimitsChip({ src, open }: { src: AgentSource; open: () => void }) {
  // (30 days: the same request as the limits block's)
  const { data } = useAgentUsage(src, {})
  const each = data?.accounts && data.accounts.length > 1 ? data.accounts : data?.limits ? [{ label: "", limits: data.limits }] : []
  const shown = each.flatMap((a) => (a.limits?.windows.length ? [{ label: a.label, top: Math.max(...a.limits.windows.map((w) => w.used)), all: a.limits.windows }] : []))
  if (!shown.length) return null
  const top = Math.max(...shown.map((a) => a.top))
  const tip = shown.map((a) => `${a.label ? `${a.label}: ` : ""}${a.all.map((w) => `${w.label.toLowerCase()} ${Math.round(w.used)}%`).join(", ")}`).join("; ")
  return <AmbientButton icon={src.icon} text={shown.map((a) => `${Math.round(a.top)}%`).join(" · ")} tip={`${src.label} limits: ${tip}`}
    tint={top >= 90 ? "var(--red)" : top >= 75 ? "var(--orange)" : undefined} onClick={open} />
}

/** Its plan's allowances; with several accounts, each one's under its name (`account:` for one). */
export function AgentLimits({ src, options, fm }: BlockCtx & { src: AgentSource }) {
  const { data, error, on } = useAgentUsage(src, options)
  const each = data?.accounts && data.accounts.length > 1 ? data.accounts : null
  return (
    <Panel title={`Plan limits${on}`} icon={iconFor(src, fm, Gauge)} tint={src.tint}
      action={!each && data?.plan && <span className="text-[13px] text-muted-foreground">{data.plan.name}</span>}>
      {!data ? <Waiting src={src} error={error} on={on} className={src.noLimits ? undefined : "min-h-[150px]"} /> : each ? (
        <div className="space-y-5">
          {each.map((a) => (
            <Section key={a.id} title={a.plan ? `${a.label} · ${a.plan.name}` : a.label}><Limits src={src} lim={a.limits} /></Section>
          ))}
        </div>
      ) : <Limits src={src} lim={data.limits} />}
    </Panel>
  )
}

const dot = (s: string) => (s === "busy" ? "var(--green)" : s === "idle" ? "var(--gray)" : "var(--yellow)")

const rowButton = "relative isolate flex min-h-11 w-full cursor-pointer items-center gap-3 py-2 text-left before:absolute before:inset-y-0 " +
  "before:-inset-x-2 before:-z-10 before:rounded-[8px] before:transition-colors hover:before:bg-foreground/[0.04] active:before:bg-foreground/[0.07]"

function LiveRow({ src, s, machine = "" }: { src: AgentSource; s: LiveSession; machine?: string }) {
  const on = useEnabled()
  const inTerminal = !!s.terminal && on("terminal")
  return (
    <button type="button" className={rowButton} data-session={s.id} onClick={(e) => openSession(src, s, on("terminal"), e, machine)}
      data-tip={inTerminal ? "Go to its terminal" : s.private ? "A private account's session" : "Open the conversation"}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: dot(s.status) }} data-tip={status(s.status)} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] leading-[20px]">{titleOf({ ...s, title: s.title || s.name }, "New session")}</div>
        <div className="truncate text-[13px] text-muted-foreground">
          {[s.project, s.accountLabel, s.model, `${status(s.status)} ${fmtMin(Math.round(minsSince(s.since)))}`, s.kind && s.kind !== "interactive" && s.kind].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="shrink-0 text-[14px] text-muted-foreground tabular-nums">{money(s.cost)}</div>
      <ChevronRight className="-ml-1.5 size-4 shrink-0 text-tertiary" strokeWidth={2.5} />
    </button>
  )
}

function SessionRow({ src, s, machine = "" }: { src: AgentSource; s: Session; machine?: string }) {
  return (
    <Row title={titleOf(s, "Untitled session")} right={money(s.cost)} onOpen={() => openSession(src, s, false, undefined, machine)}
      meta={[s.project, s.accountLabel, s.model, s.active_min >= 1 && fmtMin(Math.round(s.active_min)), fmtAgo(s.last)].filter(Boolean).join(" · ")} />
  )
}

/** What's open now (working or idle), then the latest sessions (`recent: 5`). */
export function AgentSessions({ src, options, fm }: BlockCtx & { src: AgentSource }) {
  const { data, error, on, machine } = useAgentUsage(src, options)
  const n = typeof options.recent === "number" ? options.recent : 5
  const open = new Set(data?.live.map((s) => s.id))
  const recent = data?.sessions.filter((s) => !open.has(s.id)).slice(0, n) ?? []
  return (
    <Panel title={`Sessions${on}`} icon={iconFor(src, fm, Terminal)} tint={src.tint}
      action={data && <span className="text-[13px] text-muted-foreground">{data.live.length} open</span>}>
      {!data ? <Waiting src={src} error={error} on={on} /> : (
        <>
          <Section title="Now">
            {data.live.length ? <List>{data.live.map((s) => <LiveRow key={s.pid || s.id} src={src} s={s} machine={machine} />)}</List> : <Empty>No session is open.</Empty>}
          </Section>
          {n > 0 && (
            <Section title="Recent" className="mt-4">
              {recent.length ? <List>{recent.map((s) => <SessionRow key={s.id} src={src} s={s} machine={machine} />)}</List> : <Empty>Nothing yet.</Empty>}
            </Section>
          )}
          {!!data.servers?.length && (
            <Section title="Remote Control" className="mt-4">
              <List>
                {data.servers.map((r) => (
                  <div key={r.pid} className="flex items-center gap-3 py-2" data-server={r.name}>
                    <span className="size-2 shrink-0 rounded-full bg-[var(--green)]" data-tip="Waiting for sessions" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] leading-[20px]">{r.name || "Unnamed"}</div>
                      <div className="truncate text-[13px] text-muted-foreground">{[r.accountLabel, r.started && `since ${fmtAgo(r.started)}`].filter(Boolean).join(" · ")}</div>
                    </div>
                  </div>
                ))}
              </List>
            </Section>
          )}
        </>
      )}
    </Panel>
  )
}

/** Its value at API prices (or tokens) per day, today and the period (`days: 30`). */
export function AgentUsageBlock({ src, options, fm }: BlockCtx & { src: AgentSource }) {
  const days = daysOf(options)
  const [by, setBy] = useState<"cost" | "tokens">("cost")
  const { data, error, on } = useAgentUsage(src, options, days)
  const today = data?.days.at(-1)
  const plan = data?.plan?.monthly ? data.plan : null
  return (
    <Panel title={`Usage${on}`} icon={iconFor(src, fm, BarChart3)} tint={src.tint}>
      {!data || !today ? <Waiting src={src} error={error} on={on} /> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Today" value={money(today.cost)} hint={`${tokens(today.tokens)} tokens`} />
            <Stat label="Working today" value={fmtMin(Math.round(today.active_min))} hint={`${today.sessions} session${today.sessions === 1 ? "" : "s"}`} />
            <Stat label={`Last ${days} days`} value={money(data.total.cost)}
              hint={plan ? `${((data.total.cost / plan.monthly!) * (30 / days)).toFixed(1)}x ${plan.name}'s price` : `${tokens(data.total.tokens)} tokens`} />
            <Stat label="Cache hits" value={data.total.cache_hit != null ? `${Math.round(data.total.cache_hit * 100)}%` : "–"} hint="of what it read" />
          </div>
          <Bars color={src.tint} format={by === "cost" ? money : tokens}
            data={data.days.map((d) => ({
              label: "",
              value: by === "cost" ? d.cost : d.tokens,
              tip: [fmtDay(d.date), d.sessions && `${d.sessions} session${d.sessions === 1 ? "" : "s"}`, d.active_min >= 1 && fmtMin(Math.round(d.active_min))].filter(Boolean).join(" · "),
            }))} />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>{fmtDay(data.days[0].date)}</span><span>Today</span>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-muted-foreground">
              {src.costNote ?? "Value at API list prices"}{data.total.unpriced ? ", models without a price left out" : ""}{plan ? `; ${plan.name} is ${money(plan.monthly!)} a month` : ""}.
            </p>
            <Segmented label="Show" value={by} onChange={setBy} options={[{ value: "cost", label: "Value" }, { value: "tokens", label: "Tokens" }]} />
          </div>
        </>
      )}
    </Panel>
  )
}

function ShareRow({ name, meta, value, share, tint }: { name: ReactNode; meta?: string; value: string; share: number; tint: string }) {
  return (
    <div className="py-2">
      <div className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1 truncate text-[15px]">{name}</span>
        <span className="shrink-0 text-[14px] text-muted-foreground tabular-nums">{value}</span>
      </div>
      {meta && <div className="truncate text-[13px] text-muted-foreground">{meta}</div>}
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${Math.max(share * 100, 1)}%`, background: tint }} />
      </div>
    </div>
  )
}

const share = (x: Share) => x.cost || x.tokens / 1e6
const top = (xs: Share[]) => Math.max(...xs.map(share), 1e-9)

/** Its usage by project (the first 10) or by model over `days` (30). */
function Shares({ src, options, fm, by }: BlockCtx & { src: AgentSource; by: "projects" | "models" }) {
  const days = daysOf(options)
  const { data, error, on } = useAgentUsage(src, options, days)
  const list = by === "projects" ? data?.projects.slice(0, 10) : data?.models
  const meta = (x: Share) => by === "models" ? `${tokens(x.tokens)} tokens`
    : [`${x.sessions} session${x.sessions === 1 ? "" : "s"}`, (x.active_min ?? 0) >= 1 && fmtMin(Math.round(x.active_min!)), x.last && fmtAgo(x.last)].filter(Boolean).join(" · ")
  return (
    <Panel title={`${by === "projects" ? "Projects" : "Models"}${on}`} icon={iconFor(src, fm, by === "projects" ? FolderGit2 : Boxes)} tint={src.tint}
      action={<span className="text-[13px] text-muted-foreground">Last {days} days</span>}>
      {!data || !list ? <Waiting src={src} error={error} on={on} /> : !list.length ? <Empty>No sessions in the last {days} days.</Empty> : (
        <List>
          {list.map((x) => (
            <ShareRow key={x.root || x.name} tint={src.tint} name={x.name} value={money(x.cost)} meta={meta(x)} share={share(x) / top(data[by])} />
          ))}
        </List>
      )}
    </Panel>
  )
}
export const AgentProjects = (ctx: BlockCtx & { src: AgentSource }) => <Shares {...ctx} by="projects" />
export const AgentModels = (ctx: BlockCtx & { src: AgentSource }) => <Shares {...ctx} by="models" />

/** The names a project file answers to: its path's folder, its repo, its name (the plugins' keysFor, on the server). */
function keysFor(ctx: BlockCtx) {
  if (typeof ctx.options.project === "string") return new Set([ctx.options.project.toLowerCase()])
  const ks = new Set([(ctx.path.split("/").pop() ?? "").replace(/\.md$/, "").toLowerCase()])
  for (const v of [ctx.fm.path, ctx.fm.repo]) if (typeof v === "string" && v) ks.add((v.replace(/\/+$/, "").split("/").pop() ?? "").toLowerCase())
  return ks
}

/** In a project file: that project's last 30 days and its sessions (`project: Name` for another). */
export function AgentProject({ src, ...ctx }: BlockCtx & { src: AgentSource }) {
  const { data, error, machine } = useAgentUsage(src, ctx.options)
  if (!data) return <Waiting src={src} error={error} />
  const ks = keysFor(ctx)
  const p = data.projects.find((x) => ks.has(x.name.toLowerCase()))
  const live = data.live.filter((s) => ks.has(s.project.toLowerCase()))
  if (!p && !live.length) return <Empty>No {src.label} sessions here in the last 30 days.</Empty>
  const open = new Set(live.map((s) => s.id))
  const recent = p ? data.sessions.filter((s) => s.project === p.name && !open.has(s.id)).slice(0, 3) : []
  return (
    <div className="space-y-3">
      {p && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label={`${src.speaker ?? src.label}, 30 days`} value={money(p.cost)} hint={src.costNote ? undefined : "at API prices"} />
          <Stat label="Tokens" value={tokens(p.tokens)} />
          <Stat label="Sessions" value={p.sessions ?? 0} />
          <Stat label="Working" value={fmtMin(Math.round(p.active_min ?? 0))} />
        </div>
      )}
      {(live.length > 0 || recent.length > 0) && (
        <List>
          {live.map((s) => <LiveRow key={s.pid || s.id} src={src} s={s} machine={machine} />)}
          {recent.map((s) => <SessionRow key={s.id} src={src} s={s} machine={machine} />)}
        </List>
      )}
    </div>
  )
}

