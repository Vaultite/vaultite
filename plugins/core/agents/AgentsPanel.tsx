// The Agents panel: every coding agent on every machine (core/agentruns.tsx), needing you, working, then done. A row's
// icon says how it runs, its dot where it stands, its end the machine; a click opens it in its terminal or its chat.
import { memo, useContext, useMemo, useRef, useState, type MouseEvent } from "react"
import { ChevronsUpDown, Cloud, MessageCircle, Plus, SquareTerminal, type LucideIcon } from "lucide-react"
import {
  cn, commandItems, fmtAgo, HeadingButton, isViewOpen, LoadingSidebarRows, menuBelow, menuFor, openAgent, openView, PanelFold, Segmented, SidebarHeading, SidebarRow,
  useAgentRuns, useAgents, useKeptCount, useMachines, useScopedState, useTick, type AgentRun, type MenuItem,
} from "@vaultite"

export type Filter = "all" | AgentRun["kind"]
const KINDS: { kind: AgentRun["kind"]; icon: LucideIcon; label: string; one: string }[] = [
  { kind: "terminal", icon: SquareTerminal, label: "Terminals", one: "In a terminal" },
  { kind: "chat", icon: MessageCircle, label: "Chats", one: "In a chat" },
  { kind: "cloud", icon: Cloud, label: "Cloud", one: "In the cloud" },
]
const kindOf = (k: AgentRun["kind"]) => KINDS.find((x) => x.kind === k)!
const GROUPS: { state: AgentRun["state"]; label: string }[] = [
  { state: "needs", label: "Needs you" }, { state: "working", label: "Working" }, { state: "done", label: "Done" },
]
/** The ones at rest shown before Show more. */
const DONE = 5
const FILTER = "agents:filter"
const KEPT = "agents:agents"

/** The runs, the filter picked in this workspace (all when what it picked has none now) and the kinds there are. */
export function useAgentList(on = true) {
  const { runs, loading, feeds } = useAgentRuns(on)
  const [picked, pick] = useScopedState<Filter>(FILTER, "all")
  const kinds = useMemo(() => KINDS.filter((k) => runs.some((r) => r.kind === k.kind)), [runs])
  const filter: Filter = kinds.some((k) => k.kind === picked) ? picked : "all"
  const shown = useMemo(() => (filter === "all" ? runs : runs.filter((r) => r.kind === filter)), [runs, filter])
  return { runs, shown, loading, feeds, kinds, filter, pick: (f: Filter) => pick(f === "all" ? undefined : f) }
}

/** Machines by id, their names: shown on rows only when there's more than one machine. */
function useWhere() {
  const machines = useMachines()
  return useMemo(() => {
    const self = machines?.find((m) => m.self)?.label
    const several = (machines?.length ?? 0) > 1
    return (r: AgentRun) => r.where && !r.machine ? r.where : several ? (r.machine ? machines?.find((m) => m.id === r.machine)?.label ?? r.where ?? r.machine : self) : r.where
  }, [machines])
}

const stateWords = (r: AgentRun) => (r.state === "needs" ? "needs you" : r.state === "working" ? "working" : r.failed ? "failed" : r.unread ? "done, unread" : "done")
const dotOf = (r: AgentRun) => (r.state === "needs" ? "ask" as const : r.state === "working" ? "working" as const : r.failed ? "error" as const : r.unread ? "unread" as const : false)

function open(r: AgentRun, e: MouseEvent) {
  const newTab = e.metaKey || e.ctrlKey || e.button === 1
  if (r.to) openView(r.to, { newTab: newTab || !isViewOpen(r.to) })
  else r.open?.(newTab)
}

/** One agent's row: its kind's icon in its agent's colour (grey at rest) with its state's dot, what it's doing, where. */
function Row({ r, open: wide, tab, page, where }: { r: AgentRun; open: boolean; tab: string; page?: boolean; where?: string }) {
  const k = kindOf(r.kind)
  // (when it finished, in the tab: a terminal says only when it started)
  const ended = page && r.state === "done" && !r.started
  const tip = [r.title, r.step && r.step !== r.title ? r.step : "",
    [k.one, r.agent, where && `on ${where}`, stateWords(r), r.started ? `started ${fmtAgo(r.at)}` : r.state === "done" && fmtAgo(r.at)].filter(Boolean).join(" · ")].filter(Boolean).join("\n")
  return (
    <SidebarRow icon={k.icon} tint={r.state === "done" && !r.unread && !r.failed ? undefined : r.tint} badge={dotOf(r)} label={r.title} open={wide}
      active={!!r.to && tab === r.to} tip={tip} more={!!r.menu} data-agent-run={r.id} data-kind={r.kind} data-state={r.state}
      className={r.state === "needs" ? "font-semibold" : undefined}
      onContextMenu={r.menu ? menuFor(r.menu) : undefined} onClick={(e) => open(r, e)}>
      {page && r.step && <span className="mr-2 max-w-[45%] min-w-0 truncate text-[11px] font-normal text-tertiary group-hover/row:hidden" data-agent-step>{r.step}</span>}
      {(where || ended) && (
        <span className={cn("mr-1 shrink-0 truncate text-[11px] font-normal text-tertiary tabular-nums group-hover/row:hidden", page ? "max-w-[12em]" : "max-w-[5.5em]")} data-agent-where>
          {[where, ended && fmtAgo(r.at, { short: true })].filter(Boolean).join(" · ")}
        </span>
      )}
    </SidebarRow>
  )
}

const subhead = "flex h-6 items-end px-1.5 pb-0.5 text-[11px] font-medium text-tertiary max-md:h-8 max-md:text-[13px]"
const quiet = "flex h-7 min-w-0 cursor-pointer items-center truncate rounded-[5px] pl-1.5 text-left text-[13px] whitespace-nowrap text-tertiary hover:text-muted-foreground max-md:min-h-11 max-md:text-[15px]"

/** While the pointer is over the list, nothing moves under it: rows keep their group and place, new ones come last. */
function useSteady(list: AgentRun[], held: boolean) {
  const last = useRef<{ id: string; state: AgentRun["state"] }[]>([])
  if (!held) {
    last.current = list.map((r) => ({ id: r.id, state: r.state }))
    return list.map((r) => ({ r, group: r.state }))
  }
  const now = new Map(list.map((r) => [r.id, r]))
  const kept = last.current.filter((x) => now.has(x.id)).map((x) => ({ r: now.get(x.id)!, group: x.state }))
  const known = new Set(kept.map((x) => x.r.id))
  return [...kept, ...list.filter((r) => !known.has(r.id)).map((r) => ({ r, group: r.state }))]
}

/** The rows under Needs you, Working and Done (in the rail, icons with a line between groups); Done's older ones behind Show more. */
function Rows({ list, open, tab, page }: { list: AgentRun[]; open: boolean; tab: string; page?: boolean }) {
  const [held, setHeld] = useState(false)
  const [more, setMore] = useState(false)
  const where = useWhere()
  useTick(60_000, !!page)
  const rows = useSteady(list, held)
  const groups = GROUPS.map((g) => ({ ...g, rows: rows.filter((x) => x.group === g.state).map((x) => x.r) })).filter((g) => g.rows.length)
  return (
    <div className="flex flex-col gap-px" onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)} data-agent-rows>
      {groups.map((g, i) => {
        const cut = g.state === "done" && !more && g.rows.length > DONE + 1 ? DONE : g.rows.length
        return (
          <div key={g.state} className="flex flex-col gap-px" data-agent-group={g.state}>
            {open ? <div className={cn(subhead, i > 0 && "mt-1")}>{g.label}{g.state === "done" ? "" : ` · ${g.rows.length}`}</div>
              : i > 0 && <div aria-hidden className="mx-auto my-1 h-px w-4 bg-border" />}
            {g.rows.slice(0, open ? cut : g.state === "done" ? DONE : g.rows.length).map((r) => <Row key={r.id} r={r} open={open} tab={tab} page={page} where={where(r)} />)}
            {open && g.rows.length > cut && (
              <button type="button" data-keyrow data-agent-more onClick={() => setMore(true)} className={quiet}>Show {g.rows.length - cut} more</button>
            )}
            {open && more && g.state === "done" && g.rows.length > DONE + 1 && (
              <button type="button" data-keyrow data-agent-more onClick={() => setMore(false)} className={quiet}>Show fewer</button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The + menu: a chat with Claude Code, or any coding agent in a terminal. */
function newMenu(e: MouseEvent, agents: ReturnType<typeof useAgents>) {
  const chat = commandItems("claude-code:chat").map((it) => ({ ...it, label: "New chat with Claude Code", icon: MessageCircle }))
  const items: MenuItem[] = [...chat, ...agents.map((a, i) => ({ label: `New ${a.label} in a terminal`, icon: a.icon, sep: i === 0 && !!chat.length, run: () => openAgent(a.name) }))]
  if (items.length) menuBelow(e, items)
}

/** Which kind shows: all, or only terminals, chats or cloud sessions (offered once there are two kinds). */
function Picker({ kinds, filter, pick, runs }: { kinds: typeof KINDS; filter: Filter; pick: (f: Filter) => void; runs: AgentRun[] }) {
  if (kinds.length < 2) return null
  const name = filter === "all" ? "All" : kindOf(filter).label
  const count = (k: Filter) => (k === "all" ? runs.length : runs.filter((r) => r.kind === k).length)
  const menu = (e: MouseEvent) => menuBelow(e, [
    { label: "Show", caption: true, run: () => {} },
    { label: "All", checked: filter === "all", hint: String(count("all")), run: () => pick("all") },
    ...kinds.map((k) => ({ label: k.label, icon: k.icon, checked: filter === k.kind, hint: String(count(k.kind)), run: () => pick(k.kind) })),
  ])
  return (
    <button type="button" onClick={menu} aria-label={`Showing ${name.toLowerCase()}`} data-tip="Which agents" data-agent-filter={filter}
      className="flex h-5 min-w-0 cursor-pointer items-center gap-1 rounded-[4px] px-1.5 text-[11px] font-medium text-tertiary hover:bg-foreground/[0.08] hover:text-muted-foreground">
      <span className="truncate">{name}</span>
      <ChevronsUpDown aria-hidden className="-mx-0.5 size-3 shrink-0" strokeWidth={2.25} />
    </button>
  )
}

/** (only what it shows as props: the sidebar's store changing redraws nothing here) */
export const AgentsPanel = memo(function AgentsPanel({ open, tab }: { open: boolean; tab: string }) {
  const fold = useContext(PanelFold)
  const folded = !!fold?.collapsed && open
  // (folded, it asks nothing: no chat list polled for a panel nobody sees)
  const { runs, shown, loading, feeds, kinds, filter, pick } = useAgentList(!folded)
  const agents = useAgents()
  const rows = useKeptCount(KEPT, loading ? undefined : runs.length, 0)
  if (!open) return <>{feeds}{shown.length ? <Rows list={shown} open={false} tab={tab} /> : null}</>
  return (
    <div className="flex shrink-0 flex-col" data-agents-panel>
      {feeds}
      <SidebarHeading title="Agents" open={open} aside={!folded && <Picker kinds={kinds} filter={filter} pick={pick} runs={runs} />}>
        <HeadingButton icon={Plus} label="New agent" onClick={(e) => newMenu(e, agents)} data-agent-new="" />
      </SidebarHeading>
      {!folded && (
        <div className="flex flex-col gap-px">
          {shown.length ? <Rows list={shown} open tab={tab} />
            : loading ? <LoadingSidebarRows count={rows || 2} data-agents-loading="" />
            : <p className={cn(quiet, "cursor-default hover:text-tertiary")} data-agents-empty>No agents at work</p>}
        </div>
      )}
    </div>
  )
})

/** The panel as a tab (view:agents): the same rows a size up, with where each stands and when it finished. */
export function AgentsView() {
  const { runs, shown, loading, feeds, kinds, filter, pick } = useAgentList()
  const rows = useKeptCount(KEPT, loading ? undefined : runs.length, 0)
  const needs = runs.filter((r) => r.state === "needs").length, working = runs.filter((r) => r.state === "working").length
  return (
    <div data-agents-view>
      {feeds}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="mr-auto text-[13px] text-muted-foreground max-md:text-[15px]" aria-busy={loading || undefined}>
          {loading && !runs.length ? <span className="shimmer">Finding your agents…</span>
            : runs.length ? [needs && `${needs} need${needs === 1 ? "s" : ""} you`, working && `${working} working`, !needs && !working && "All done"].filter(Boolean).join(", ") + ". Click one to open it."
            : "Coding agents on every machine show here: in terminals, in chats and in the cloud."}
        </p>
        {kinds.length > 1 && (
          <Segmented label="Which agents" value={filter} onChange={pick}
            options={[{ value: "all" as Filter, label: "All" }, ...kinds.map((k) => ({ value: k.kind as Filter, label: k.label, count: runs.filter((r) => r.kind === k.kind).length }))]} />
        )}
      </div>
      <div className="size-up-bleed"><div data-size-up>
        {shown.length ? <Rows list={shown} open tab="" page /> : loading ? <LoadingSidebarRows count={rows || 2} right data-agents-loading="" /> : null}
      </div></div>
    </div>
  )
}
