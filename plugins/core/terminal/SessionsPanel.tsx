import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react"
import { Copy, MessagesSquare, Monitor, Plus, SquareTerminal, X } from "lucide-react"
import {
  capitalize, chooseDefaultPlace, choosePlace, cn, copyText, currentWorkspace, EarlierRow, foldsAway, HeadingButton, isViewOpen, LoadingSidebarRows, menuBelow, menuFor, notify,
  notifyError, onMachine, openAgent, openTerminal, openView, PanelFold, SidebarHeading, SidebarRow, startDrag, useAgents, useDrag, useEarlier, useGlide, useHold, useKeptCount,
  useHoverCard, useSteady, useTerminalAccount, useTick, useWorkspaceVersion, viewMenuItems, workspaceList, type Agent, type MenuItem, type SidebarCtx,
} from "@vaultite"
import {
  agentIn, cacheLeft, dotOf, endForGood, getSessions, iconOf, labelOf, meterText, needsYou, rankOf, resting, runOf, stateClass, stateTip, subscribeSessions, tintOf, type Session,
} from "./sessions"
import { useFoldAfter } from "./fold"
import { ScreenCard } from "./Screen"

export const useSessions = () => useSyncExternalStore(subscribeSessions, getSessions)
const listed = (list: Session[] | null) => list?.filter((s) => !s.external || s.clients > 0) ?? null

function Row({ s, open, tab, page, where }: { s: Session; open: boolean; tab: string; page?: boolean
  where?: string }) {
  const to = `view:terminal/${s.id}`
  const a = agentIn(s, useAgents())
  const account = useTerminalAccount(s.id, a)
  const needs = needsYou(s, a)
  const dragged = useDrag((d) => d?.item.to)
  const tip = [labelOf(s, a) + (a ? stateTip(s) : ""),
    [account && `${account} account`, s.machineLabel && `on ${s.machineLabel}`, where && `in ${where}`, !s.clients && "detached"].filter(Boolean).join(", "),
    a && s.meter && capitalize(meterText(s))].filter(Boolean).join("\n")
  const box = useRef<HTMLDivElement>(null)
  const card = useHoverCard(box)
  return (
    <div ref={box} {...card.props} onPointerDown={(e) => startDrag(e, { from: "row", to, label: labelOf(s, a) })} className={cn(dragged === to && "opacity-50")}>
    <SidebarRow icon={iconOf(s, a) ?? SquareTerminal} iconClassName={stateClass(s, a)} tint={tintOf(s, a)} badge={dotOf(s, a)} tag={s.machineLabel && short(s.machineLabel)} label={labelOf(s, a)} open={open}
      active={tab === to} tip={tip} more data-session={s.id} data-glide={s.id} data-state={s.state} data-agent={a?.name} data-needs={needs ? "" : undefined}
      className={needs ? "font-semibold" : undefined}
      data-where={where}
      data-machine={s.machine}
      swipe={() => [{ label: "End", icon: X, danger: true, run: () => endForGood(s.id), removes: true }]}
      onContextMenu={menuFor(() => menuOf(s, a))}
      onClick={(e) => openView(to, { newTab: !isViewOpen(to) || e.metaKey || e.ctrlKey || e.button === 1 })}>
      {page && <span className="mr-1 max-w-[50%] truncate text-[11px] font-normal text-tertiary group-hover/row:hidden">{[where && `in ${where}`, about(s, a, true, account)].filter(Boolean).join(" · ")}</span>}
      {!page && where && <span className="mr-1 max-w-20 shrink-0 truncate text-[11px] font-normal text-tertiary group-hover/row:hidden">{where}</span>}
      {a && s.meter && <Meters s={s} tint={a.tint} />}
    </SidebarRow>
    {card.shown && <ScreenCard shown={card.shown} row={box} id={s.id} title={labelOf(s, a)} about={[where && `In ${where}`, about(s, a, false, account)].filter(Boolean).join(" · ")} />}
    </div>
  )
}

const copy = (text: string, what: string) => () => void copyText(text).then(() => notify(`Copied the ${what}`, { id: "copied" }), (e) => notifyError(e))
export function menuOf(s: Session, a: Agent | null): MenuItem[] {
  const conversation = a?.session && s.session && `view:${a.session}/${onMachine(s.session, s.machine)}`
  return [
    ...(s.session ? [{ label: "Copy session ID", icon: Copy, run: copy(s.session, "session ID") }] : []),
    { label: "Copy terminal ID", icon: Copy, run: copy(s.id, "terminal ID") },
    ...(conversation ? [{ label: "Open conversation", icon: MessagesSquare, sep: true, run: () => openView(conversation, { newTab: !isViewOpen(conversation) }) }] : []),
    ...viewMenuItems(`view:terminal/${s.id}`).map((it, i) => (i ? it : { ...it, sep: true })),
    { label: "End session", icon: X, danger: true, sep: true, run: () => void endForGood(s.id) },
  ]
}

const short = (l: string) => {
  const w = l.trim().split(/\s+/)
  return (l.length <= 3 ? l : w.length > 1 ? w.map((x) => x[0]).join("").slice(0, 3) : l.slice(0, 2)).toUpperCase()
}

function Meters({ s, tint }: { s: Session; tint?: string }) {
  const { context: c, cache } = s.meter!
  const used = c ? Math.min(1, c.tokens / c.window) : 0
  const rings = [
    c?.as === "bar" && { key: "context", r: 6, part: used, colour: used > 0.9 ? "var(--red)" : used > 0.75 ? "var(--orange)" : "var(--muted-foreground)" },
    cache?.as === "bar" && resting(s) && { key: "cache", r: 3, part: cacheLeft(cache), colour: tint ?? "var(--muted-foreground)" },
  ].filter((b) => !!b)
  const text = c?.as === "percent" ? `${Math.round(used * 100)}%` : c?.as === "tokens" ? `${Math.round(c.tokens / 1000)}k` : ""
  if (!rings.length && !text) return null
  return (
    <span className="mr-1 flex shrink-0 items-center gap-1.5 font-normal group-hover/row:hidden" data-meters>
      {text && <span className="text-[11px] text-tertiary tabular-nums" data-meter="context">{text}</span>}
      {!!rings.length && (
        <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 -rotate-90" aria-hidden>
          {rings.map((b) => {
            const len = 2 * Math.PI * b.r
            return (
              <g key={b.key} data-meter={b.key} data-part={b.part.toFixed(3)}>
                <circle cx={8} cy={8} r={b.r} fill="none" strokeWidth={2} style={{ stroke: "color-mix(in oklab, var(--foreground) 12%, transparent)" }} />
                {b.part > 0 && <circle cx={8} cy={8} r={b.r} fill="none" strokeWidth={2} strokeLinecap="round" strokeDasharray={`${len * b.part} ${len}`} style={{ stroke: b.colour }} />}
              </g>
            )
          })}
        </svg>
      )}
    </span>
  )
}

function elsewhere(): Map<string, string> {
  const desk = currentWorkspace()
  const out = new Map<string, string[]>()
  if (!desk) return new Map()
  const mine = new Set(desk.places)
  for (const w of workspaceList()) {
    if (w.n === desk.n) continue
    for (const p of w.places) if (p.startsWith("view:terminal/") && !mine.has(p)) out.set(p, [...(out.get(p) ?? []), w.label])
  }
  return new Map([...out].map(([p, names]) => [p, names.join(", ")]))
}

const EARLIER = "terminal:earlier"
const placeOf = (s: Session) => `view:terminal/${s.id}`

function Rows({ list, open, tab, page }: { list: Session[]; open: boolean; tab: string; page?: boolean }) {
  useWorkspaceVersion()
  const agents = useAgents()
  const box = useRef<HTMLDivElement>(null)
  const held = useHold(box)
  const [unfolded, unfold] = useEarlier(EARLIER)
  useTick(60_000, !page)
  const now = Date.now(), others = elsewhere(), after = useFoldAfter()
  const sorted = useMemo(() => [...list].sort((x, y) => rankOf(x, agentIn(x, agents)) - rankOf(y, agentIn(y, agents))), [list, agents])
  const { front, earlier } = useSteady(sorted, held, (s) => {
    const run = !page && !others.has(placeOf(s)) && runOf(s, agentIn(s, agents))
    return !!run && foldsAway(run, now, isViewOpen(placeOf(s)), after)
  })
  const here = front.filter((s) => !others.has(placeOf(s))), other = front.filter((s) => others.has(placeOf(s)))
  const folded = open && earlier.length > 0
  const ids = (l: Session[]) => l.map((s) => s.id)
  useGlide(box, [...ids(here), "|", ...(folded && unfolded ? ids(earlier) : []), "|", ...ids(other)].join("\n"))
  const row = (s: Session) => <Row key={s.id} s={s} open={open} tab={tab} page={page} where={others.get(placeOf(s))} />
  return (
    <div ref={box} className="flex flex-col gap-px" data-terminal-rows data-held={held || undefined}>
      {here.map(row)}
      {folded && <EarlierRow count={earlier.length} open={unfolded} onClick={unfold} data-terminals-earlier={unfolded ? "open" : "closed"} />}
      {folded && unfolded && earlier.map(row)}
      {!!other.length && (open
        ? <div data-terminals-elsewhere data-glide="elsewhere" className={cn("flex h-6 items-end px-1.5 pb-0.5 text-[11px] font-medium text-tertiary max-md:h-8 max-md:text-[13px]", here.length && "mt-1")}>Other workspaces</div>
        : here.length > 0 && <div aria-hidden className="mx-auto my-1 h-px w-4 bg-border" />)}
      {other.map(row)}
    </div>
  )
}

export function newMenu(e: MouseEvent, agents: Agent[]) {
  menuBelow(e, [
    { label: "New terminal", icon: SquareTerminal, run: () => void openTerminal() },
    ...agents.map((a, i) => ({ label: `New ${a.label}`, icon: a.icon, sep: i === 0, run: () => openAgent(a.name) })),
    { label: "Choose where…", icon: Monitor, sep: true, run: () => void choosePlace() },
    { label: "Where new ones open…", icon: Monitor, run: () => void chooseDefaultPlace() },
  ])
}

export function Sessions({ open, tab }: SidebarCtx) {
  const { list: all, refused } = useSessions()
  const list = listed(all)
  const agents = useAgents()
  const fold = useContext(PanelFold)
  const rows = useKeptCount("terminal:sessions", list?.length, 0)
  const empty = list ? !list.length : !rows
  const [peek, setPeek] = useState(false)
  useEffect(() => { if (!empty) setPeek(false) }, [empty])
  if (refused) return null
  if (!open) return list?.length ? <Rows list={list} open={false} tab={tab} /> : null
  const auto = empty && !peek
  const folded = !!fold?.collapsed || auto
  const own = fold && {
    collapsed: folded,
    toggle: () => {
      if (!empty) return fold.toggle()
      if (fold.collapsed) { fold.toggle(); setPeek(true) } else setPeek(!peek)
    },
  }
  return (
    <div className="flex shrink-0 flex-col" data-auto-folded={auto || undefined} data-panel-empty={auto || undefined}>
      <PanelFold.Provider value={own}>
        <SidebarHeading title="Terminals" open={open}>
          {agents.slice(0, 1).map((a) => (
            <HeadingButton icon={a.icon} label={`New ${a.label}`} strokeWidth={2} key={a.name} data-agent={a.name} onClick={() => openAgent(a.name)} />
          ))}
          <HeadingButton icon={Plus} label="New terminal or agent" onClick={(e) => newMenu(e, agents)} />
        </SidebarHeading>
      </PanelFold.Provider>
      {!folded && (
        <div className="flex flex-col gap-px">
          {list ? <Rows list={list} open={open} tab={tab} /> : <LoadingSidebarRows count={rows} data-terminals-loading="" />}
          {empty && list && (
            <button type="button" onClick={() => void openTerminal()}
              className="flex h-7 min-w-0 cursor-pointer items-center truncate pl-1.5 text-left text-[13px] whitespace-nowrap text-tertiary hover:text-muted-foreground">
              No terminals running. Open one
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function SessionList() {
  const list = listed(useSessions().list)
  const rows = useKeptCount("terminal:sessions", list?.length, 0)
  return (
    <div className="flex flex-col gap-px pb-1">
      {list ? <Rows list={list} open tab="" page /> : <LoadingSidebarRows count={rows} right data-terminals-loading="" />}
      {list && !list.length && (
        <button type="button" onClick={() => void openTerminal()}
          className="flex h-7 min-w-0 cursor-pointer items-center truncate pl-1.5 text-left text-[13px] whitespace-nowrap text-tertiary hover:text-muted-foreground">
          No terminals running. Open one
        </button>
      )}
    </div>
  )
}

export function about(s: Session, a: Agent | null, short?: boolean, account?: string) {
  const st = a ? stateTip(s).replace(/^ \((.*)\)$/, "$1") : ""
  const mins = Math.max(0, Math.round((Date.now() - s.started) / 60000))
  const n = mins < 60 ? `${mins} min` : mins < 60 * 24 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`
  const age = short ? (mins < 1 ? "<1 min" : n) : mins < 1 ? "started just now" : `started ${n} ago`
  return [account, s.machineLabel && `on ${s.machineLabel}`, st && capitalize(st), a && s.meter && meterText(s), age, !s.clients && "detached"].filter(Boolean).join(" · ")
}
