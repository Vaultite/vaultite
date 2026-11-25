import { memo, useContext, useMemo, type MouseEvent } from "react"
import { ListFilter, MessageCircle, Plus } from "lucide-react"
import {
  cn, commandItems, HeadingButton, LoadingSidebarRows, menuBelow, openAgent, PanelFold, Segmented, SidebarHeading, TryAgain, useAgentRuns, useAgents, useKeptCount,
  useScopedState, type AgentRun, type MenuItem, type Unreachable,
} from "@vaultite"
import { KINDS, useNow } from "./runs"
import { Rows } from "./Rows"
import { useMarks } from "./marks"
import { projectsOf } from "./shelves"
import { useShellRuns } from "./shells"
import { useView, viewMenu } from "./view"

export type Filter = "all" | AgentRun["kind"]
const FILTER = "agents:filter"
const PROJECT = "agents:project"
const KEPT = "agents:agents"

function useRuns(on: boolean) {
  const { runs: all, loading, unreachable, feeds } = useAgentRuns(on)
  const { hide, shells } = useView()
  const plain = useShellRuns(on && shells)
  const runs = useMemo(() => [...(hide.length ? all.filter((r) => !hide.includes(r.kind)) : all), ...plain.filter((s) => !all.some((r) => r.id === s.id))], [all, hide, plain])
  const every = useMemo(() => KINDS.filter((k) => all.some((r) => r.kind === k.kind) || hide.includes(k.kind)), [all, hide])
  return { runs, loading, unreachable, feeds, every }
}

function useProject(runs: AgentRun[]) {
  const marks = useMarks(), now = useNow()
  const projects = useMemo(() => projectsOf(runs, marks, now), [runs, marks, now])
  const [picked, pick] = useScopedState<string>(PROJECT, "")
  const project = projects.length > 1 && projects.includes(picked) ? picked : ""
  const shown = useMemo(() => (project ? runs.filter((r) => r.project === project) : runs), [runs, project])
  return { projects: projects.length > 1 ? projects : [], project, shown, pick: (p: string) => pick(p || undefined) }
}

const CHIP = "h-6 max-w-[12em] shrink-0 truncate rounded-control border-[0.5px] px-2 text-[12px] max-md:h-9 max-md:text-[15px]"
function ProjectChips({ projects, project, pick, className }: { projects: string[]; project: string; pick: (p: string) => void; className?: string }) {
  if (!projects.length) return null
  const chip = (name: string, label: string) => (
    <button key={name || "all"} type="button" aria-pressed={project === name} onClick={() => pick(name)} data-agent-project={name || "all"}
      className={cn(CHIP, project === name ? "border-transparent bg-foreground/[0.09] font-medium text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>{label}</button>
  )
  return (
    <div role="group" aria-label="Repository" className={cn("flex flex-wrap gap-1", className)} data-agent-projects>
      {chip("", "All")}{projects.map((p) => chip(p, p))}
    </div>
  )
}

const none = "flex h-7 min-w-0 items-center truncate pl-1.5 text-[13px] whitespace-nowrap text-tertiary max-md:min-h-11 max-md:text-[15px]"

const OR = new Intl.ListFormat("en", { type: "disjunction" })
function CantReach({ list, className }: { list: Unreachable[]; className?: string }) {
  if (!list.length) return null
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)} data-agents-unreachable role="status">
      <p className="min-w-0 flex-1 truncate text-[13px] text-tertiary max-md:text-[15px]">Can't reach {OR.format(list.map((u) => u.what))}</p>
      <TryAgain quiet onClick={() => { for (const u of list) u.retry?.() }} />
    </div>
  )
}

function newMenu(e: MouseEvent, agents: ReturnType<typeof useAgents>) {
  const chat = commandItems("claude-code:chat").map((it) => ({ ...it, label: "New chat with Claude Code", icon: MessageCircle }))
  const items: MenuItem[] = [...chat, ...agents.map((a, i) => ({ label: `New ${a.label} in a terminal`, icon: a.icon, sep: i === 0 && !!chat.length, run: () => openAgent(a.name) }))]
  if (items.length) menuBelow(e, items)
}

export const AgentsPanel = memo(function AgentsPanel({ open, tab }: { open: boolean; tab: string }) {
  const fold = useContext(PanelFold)
  const folded = !!fold?.collapsed && open
  const { runs, loading, unreachable, feeds, every } = useRuns(!folded)
  const { projects, project, shown, pick } = useProject(runs)
  const agents = useAgents()
  const rows = useKeptCount(KEPT, loading ? undefined : shown.length, 0)
  if (!open) return <>{feeds}{shown.length ? <Rows list={shown} open={false} tab={tab} /> : null}</>
  return (
    <div className="flex shrink-0 flex-col" data-agents-panel>
      {feeds}
      <SidebarHeading title="Agents" open={open}>
        <HeadingButton icon={ListFilter} label="View options" tip="Group, sort and show" onClick={(e) => viewMenu(e, every)} data-agent-view="" />
        <HeadingButton icon={Plus} label="New agent" onClick={(e) => newMenu(e, agents)} data-agent-new="" />
      </SidebarHeading>
      {!folded && (
        <div className="flex flex-col gap-px">
          <ProjectChips projects={projects} project={project} pick={pick} className="px-1.5 pb-1" />
          {shown.length ? <Rows list={shown} open tab={tab} />
            : loading ? <LoadingSidebarRows count={rows || 2} data-agents-loading="" />
            : !unreachable.length && <p className={none} data-agents-empty>No agents at work</p>}
          <CantReach list={unreachable} className="pl-1.5" />
        </div>
      )}
    </div>
  )
})

function tally(runs: AgentRun[]) {
  const n = (s: AgentRun["state"]) => runs.filter((r) => !r.shell && r.state === s).length
  const needs = n("needs"), working = n("working"), waiting = n("waiting")
  const said = [needs && `${needs} need${needs === 1 ? "s" : ""} you`, working && `${working} working`, waiting && `${waiting} waiting on background work`].filter(Boolean)
  return said.length ? said.join(", ") : "All done"
}

export function AgentsView() {
  const { runs: listed, loading, unreachable, feeds, every } = useRuns(true)
  const { projects, project, shown: inProject, pick } = useProject(listed)
  const [picked, pickKind] = useScopedState<Filter>(FILTER, "all")
  const kinds = KINDS.filter((k) => inProject.some((r) => r.kind === k.kind))
  const filter: Filter = kinds.some((k) => k.kind === picked) ? picked : "all"
  const shown = filter === "all" ? inProject : inProject.filter((r) => r.kind === filter)
  const rows = useKeptCount(KEPT, loading ? undefined : listed.length, 0)
  return (
    <div data-agents-view>
      {feeds}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="mr-auto text-[13px] text-muted-foreground max-md:text-[15px]" aria-busy={loading || undefined}>
          {loading && !listed.length ? <span className="shimmer">Finding your agents…</span>
            : listed.length ? `${tally(listed)}. Click one to open it.`
            : "Coding agents on every machine show here: in terminals, in chats and in the cloud."}
        </p>
        {kinds.length > 1 && (
          <Segmented<Filter> label="Which agents" value={filter} onChange={(f) => pickKind(f === "all" ? undefined : f)}
            options={[{ value: "all", label: "All" }, ...kinds.map((k) => ({ value: k.kind, label: k.label, count: inProject.filter((r) => r.kind === k.kind).length }))]} />
        )}
        <HeadingButton icon={ListFilter} label="View options" tip="Group, sort and show" className="size-7" onClick={(e) => viewMenu(e, every)} data-agent-view="" />
      </div>
      <ProjectChips projects={projects} project={project} pick={pick} className="mb-3" />
      <div className="size-up-bleed"><div data-size-up>
        {shown.length ? <Rows list={shown} open tab="" page /> : loading ? <LoadingSidebarRows count={rows || 2} right data-agents-loading="" /> : null}
      </div></div>
      <CantReach list={unreachable} className="mt-2" />
    </div>
  )
}
