// The Activity panel: the last few things done, live; a row opens its file or an agent's terminal. Who and what to
// show are kept per workspace.
import { ListFilter, SquareArrowOutUpRight, Users } from "lucide-react"
import { cn, menuBelow, openFile, openView, SidebarHeading, useScopedState, useTick, type SidebarCtx } from "@vaultite"
import { ACTION_KINDS, type ActionKind, type ActivityEvent, type ActorKind } from "./model"
import { EventText, KINDS, useExists, useFeed } from "./Feed"
import { agoShort, kindLabel, openTerminal, stamp, useLook, whoOf } from "./shared"

function Line({ e, exists }: { e: ActivityEvent; exists: Set<string> }) {
  const look = useLook()(e.actor)
  const Icon = look.icon
  const file = (e.paths ?? []).find((p) => exists.has(p))
  const term = e.actor.kind === "agent" ? e.actor.terminal : undefined
  const go = term ? () => void openTerminal(term) : file ? () => openFile(file) : undefined
  const tip = `${e.text}${(e.count ?? 1) > 1 ? ` (×${e.count})` : ""}\n${whoOf(e.actor)} · ${stamp(e.last ?? e.t)}`
  return (
    <a href="#" data-event={e.id} data-tip={tip} data-tip-side="right" aria-label={e.text}
      onClick={(ev) => { ev.preventDefault(); go?.() }}
      className={cn("group/row flex h-7 items-center gap-2 rounded-[5px] pl-1.5 pr-1 text-[13px] whitespace-nowrap", go ? "hover:bg-foreground/[0.04]" : "cursor-default")}>
      <Icon className="size-4 shrink-0" strokeWidth={2} style={{ color: look.tint }} />
      <span className="min-w-0 flex-1 truncate"><EventText e={e} exists={exists} plain /></span>
      {(e.count ?? 1) > 1 && <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">×{e.count}</span>}
      <span className="w-7 shrink-0 text-right text-[11px] text-tertiary tabular-nums">{agoShort(e.last ?? e.t)}</span>
    </a>
  )
}

/** What the panel shows, kept in the workspace (unset: everything). */
type Filter = { actor?: ActorKind; action?: ActionKind }
const ALL: Filter = {}

export function ActivityPanel({ store, open }: SidebarCtx) {
  const [filter, setFilter] = useScopedState<Filter>("activity:filter", ALL)
  const actor = KINDS.includes(filter.actor as ActorKind) ? filter.actor! : ""
  const action = ACTION_KINDS.some((k) => k.id === filter.action) ? filter.action! : ""
  const { data, error, events } = useFeed({ limit: 10, actor, action })
  const exists = useExists(store)
  useTick()
  if (!open) return null
  const set = (patch: Filter) => {
    const next = { actor: actor || undefined, action: action || undefined, ...patch }
    setFilter(next.actor || next.action ? next : undefined)
  }
  const buttons = [
    { label: actor ? `Who: ${kindLabel(actor)}` : "Who", icon: Users, pressed: !!actor, run: (e: React.MouseEvent) => menuBelow(e, [
      { label: "Everyone", checked: !actor, run: () => set({ actor: undefined }) },
      ...KINDS.map((k, i) => ({ label: kindLabel(k), checked: actor === k, sep: i === 0, run: () => set({ actor: k }) })),
    ]) },
    { label: action ? `What: ${ACTION_KINDS.find((k) => k.id === action)!.label}` : "What", icon: ListFilter, pressed: !!action, run: (e: React.MouseEvent) => menuBelow(e, [
      { label: "Everything", checked: !action, run: () => set({ action: undefined }) },
      ...ACTION_KINDS.map((k, i) => ({ label: k.label, checked: action === k.id, sep: i === 0, run: () => set({ action: k.id }) })),
    ]) },
    { label: "Open in a tab", icon: SquareArrowOutUpRight, pressed: false, run: () => openView("activity", { newTab: true }) },
  ]
  return (
    <div className="flex shrink-0 flex-col pb-1" data-activity-panel data-filter={[actor, action].filter(Boolean).join(",") || undefined}>
      {/* A filter on shows in the title (the buttons show only on hover). */}
      <SidebarHeading title={["Activity", ...(actor ? [kindLabel(actor)] : []), ...(action ? [ACTION_KINDS.find((k) => k.id === action)!.label.toLowerCase()] : [])].join(" · ")} open={open}>
        {buttons.map((b, i) => (
          <button key={i} type="button" onClick={b.run} data-tip={b.label} aria-label={b.label} aria-pressed={b.pressed}
            className={cn("grid size-6 cursor-pointer place-items-center rounded-[4px] hover:bg-foreground/[0.06] hover:text-foreground",
              b.pressed ? "bg-foreground/[0.08] text-foreground" : "text-muted-foreground")}>
            <b.icon className="size-[15px]" strokeWidth={2} />
          </button>
        ))}
      </SidebarHeading>
      <div className="flex flex-col gap-px">
        {!data ? (
          <p className="h-7 pl-1.5 text-[13px] leading-7 text-tertiary">{error ? "Couldn't read the activity" : "Loading…"}</p>
        ) : !events.length ? (
          <p className="h-7 pl-1.5 text-[13px] leading-7 text-tertiary">{actor || action ? "Nothing like that yet" : "Nothing yet"}</p>
        ) : events.map((e) => <Line key={e.id} e={e} exists={exists} />)}
      </div>
    </div>
  )
}
