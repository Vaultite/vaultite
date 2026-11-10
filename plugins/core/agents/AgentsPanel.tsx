// The Agents panel: every coding agent on every machine (core/agentruns.tsx) in one quiet list, as T3 Code's threads:
// a glyph says where each stands, a short time ends it, the rest is in its tooltip. What's done and read folds away.
import { memo, useContext, type ReactNode, useMemo, useRef, type MouseEvent } from "react"
import { Cloud, MessageCircle, Plus, SquareTerminal, type LucideIcon } from "lucide-react"
import {
  asksNothing, cn, commandItems, EarlierRow, fmtAgo, foldsAway, HeadingButton, isViewOpen, LoadingSidebarRows, menuBelow, menuFor, openAgent, openView, PanelFold, Segmented,
  SidebarHeading, SidebarRow, useAgentRuns, useAgents, useEarlier, useGlide, useHold, useKeptCount, useMachines, useScopedState, useSteady, useTick, type AgentRun, type MenuItem,
} from "@vaultite"
import { useFoldAfter } from "./fold"

export type Filter = "all" | AgentRun["kind"]
const KINDS: { kind: AgentRun["kind"]; icon: LucideIcon; label: string; one: string }[] = [
  { kind: "terminal", icon: SquareTerminal, label: "Terminals", one: "In a terminal" },
  { kind: "chat", icon: MessageCircle, label: "Chats", one: "In a chat" },
  { kind: "cloud", icon: Cloud, label: "Cloud", one: "In the cloud" },
]
const kindOf = (k: AgentRun["kind"]) => KINDS.find((x) => x.kind === k)!
const ORDER: AgentRun["state"][] = ["needs", "working", "done"]
const FILTER = "agents:filter"
const EARLIER = "agents:earlier"
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

/** Machines by id, their names (said in a row's tooltip, and on the tab's rows when there's more than one machine). */
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

type Lead = "ask" | "working" | "error" | "unread" | "rest"
const LEAD: Record<Lead, string> = {
  ask: "bg-[var(--yellow)] dot-ping", working: "bg-foreground/70 breathe motion-reduce:animate-none", error: "bg-[var(--red)]",
  unread: "bg-[var(--blue)]", rest: "border-[1.5px] border-current opacity-40",
}
/** A row's lead in the open panel: its state as a glyph in the icon's place (amber asking, breathing at work, blue unread,
 *  red failed, a faint ring at rest: Badged's colours), so no icon and dot compete. */
const GLYPHS = Object.fromEntries((Object.keys(LEAD) as Lead[]).map((k) => [k, function Glyph({ className }: { className?: string }) {
  return <span aria-hidden className={cn(className, "grid place-items-center")} data-dot={k === "rest" ? undefined : k}><span className={cn("relative size-[7px] rounded-full", LEAD[k])} /></span>
}])) as Record<Lead, (p: { className?: string }) => ReactNode>

/** One agent's row: its state's glyph (in the rail its kind's icon and dot), what it's doing, how long ago; the rest
 *  (how it runs, which agent, where) in its tooltip. */
function Row({ r, open: wide, tab, page, where }: { r: AgentRun; open: boolean; tab: string; page?: boolean; where?: string }) {
  const k = kindOf(r.kind)
  const tip = [r.title, r.step && r.step !== r.title ? r.step : "",
    [k.one, r.agent, where && `on ${where}`, stateWords(r), r.started ? `started ${fmtAgo(r.at)}` : r.state === "done" && fmtAgo(r.at)].filter(Boolean).join(" · ")].filter(Boolean).join("\n")
  const quiet = asksNothing(r)
  return (
    <SidebarRow icon={wide ? GLYPHS[dotOf(r) || "rest"] : k.icon} tint={wide || quiet ? undefined : r.tint} badge={wide ? undefined : dotOf(r)} label={r.title} open={wide}
      active={!!r.to && tab === r.to} tip={tip} more={!!r.menu} data-agent-run={r.id} data-glide={r.id} data-kind={r.kind} data-state={r.state}
      className={cn(r.state === "needs" && "font-medium", wide && quiet && !(r.to && tab === r.to) && "text-muted-foreground")}
      onContextMenu={r.menu ? menuFor(r.menu) : undefined} onClick={(e) => open(r, e)}>
      {page && r.step && <span className="mr-2 max-w-[45%] min-w-0 truncate text-[11px] font-normal text-tertiary group-hover/row:hidden" data-agent-step>{r.step}</span>}
      {page && where && <span className="mr-2 max-w-[12em] shrink-0 truncate text-[11px] font-normal text-tertiary group-hover/row:hidden" data-agent-where>{where}</span>}
      <span className={cn("mr-1 shrink-0 text-[11px] font-normal text-tertiary tabular-nums", r.menu && "group-hover/row:hidden")} data-agent-when>
        {r.state === "needs" && !page ? "" : fmtAgo(r.at, { short: true })}
      </span>
    </SidebarRow>
  )
}

const none = "flex h-7 min-w-0 items-center truncate pl-1.5 text-[13px] whitespace-nowrap text-tertiary max-md:min-h-11 max-md:text-[15px]"

/** The rows, needing you first, then working, then done; in the panel, the ones that have asked nothing a while, with
 *  no tab, fold under Earlier (foldsAway). The tab lists every one. None moves while the user is in the list. */
function Rows({ list, open, tab, page }: { list: AgentRun[]; open: boolean; tab: string; page?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const held = useHold(box)
  const [unfolded, unfold] = useEarlier(EARLIER)
  const where = useWhere()
  useTick(60_000, open)
  const now = Date.now(), after = useFoldAfter()
  const sorted = useMemo(() => ORDER.flatMap((s) => list.filter((r) => r.state === s)), [list])
  const { front, earlier } = useSteady(sorted, held, (r) => !page && foldsAway(r, now, !!r.to && isViewOpen(r.to), after))
  useGlide(box, [...front, null, ...(unfolded ? earlier : [])].map((r) => r?.id ?? "|").join("\n"))
  const row = (r: AgentRun) => <Row key={r.id} r={r} open={open} tab={tab} page={page} where={where(r)} />
  return (
    <div ref={box} className="flex flex-col gap-px" data-agent-rows data-held={held || undefined}>
      {front.map(row)}
      {open && earlier.length > 0 && <EarlierRow count={earlier.length} open={unfolded} onClick={unfold} data-agent-earlier={unfolded ? "open" : "closed"} />}
      {open && unfolded && earlier.map(row)}
    </div>
  )
}

/** The + menu: a chat with Claude Code, or any coding agent in a terminal. */
function newMenu(e: MouseEvent, agents: ReturnType<typeof useAgents>) {
  const chat = commandItems("claude-code:chat").map((it) => ({ ...it, label: "New chat with Claude Code", icon: MessageCircle }))
  const items: MenuItem[] = [...chat, ...agents.map((a, i) => ({ label: `New ${a.label} in a terminal`, icon: a.icon, sep: i === 0 && !!chat.length, run: () => openAgent(a.name) }))]
  if (items.length) menuBelow(e, items)
}

/** (only what it shows as props: the sidebar's store changing redraws nothing here) */
export const AgentsPanel = memo(function AgentsPanel({ open, tab }: { open: boolean; tab: string }) {
  const fold = useContext(PanelFold)
  const folded = !!fold?.collapsed && open
  // (folded, it asks nothing: no chat list polled for a panel nobody sees)
  // (the panel lists every kind: the filter is the tab's)
  const { runs: shown, loading, feeds } = useAgentRuns(!folded)
  const agents = useAgents()
  const rows = useKeptCount(KEPT, loading ? undefined : shown.length, 0)
  if (!open) return <>{feeds}{shown.length ? <Rows list={shown} open={false} tab={tab} /> : null}</>
  return (
    <div className="flex shrink-0 flex-col" data-agents-panel>
      {feeds}
      <SidebarHeading title="Agents" open={open}>
        <HeadingButton icon={Plus} label="New agent" onClick={(e) => newMenu(e, agents)} data-agent-new="" />
      </SidebarHeading>
      {!folded && (
        <div className="flex flex-col gap-px">
          {shown.length ? <Rows list={shown} open tab={tab} />
            : loading ? <LoadingSidebarRows count={rows || 2} data-agents-loading="" />
            : <p className={none} data-agents-empty>No agents at work</p>}
        </div>
      )}
    </div>
  )
})

/** The panel as a tab (view:agents): every row a size up, with what each says, where it runs and when, and the filter. */
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
