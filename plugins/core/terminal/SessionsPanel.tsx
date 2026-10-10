// The Terminals panel: every shell the server runs (sessions outlive tabs), live, with agents' states from their hooks
// and other machines' sessions, sorted by state (waiting on you first). With Workspaces, the current workspace's come first.
// Under them, Claude Code on the web's sessions (cloud.ts), on the desktop app.
import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react"
import { Cloud, Copy, MessagesSquare, Monitor, Plus, SquareTerminal, X } from "lucide-react"
import {
  chooseDefaultPlace, choosePlace, cn, copyText, currentWorkspace, isViewOpen, menuBelow, menuFor, notify, notifyError, onMachine, openAgent, openTerminal, openView, PanelFold,
  SidebarHeading, SidebarRow, startDrag, useAgents, useDrag, useTerminalAccount, useWorkspaceVersion, workspaceList, type Agent, type CloudSession, type MenuItem, type SidebarCtx,
} from "@vaultite"
import { ago, cloudListed, getCloud, subscribeCloud } from "./cloud"
import { agentIn, cacheLeft, endForGood, getSessions, labelOf, meterText, rankOf, stateClass, stateTip, subscribeSessions, tintOf, waiting, type Session } from "./sessions"

/** The sessions, as the server says now (null until it answers; `refused`: this device may not have a shell): the one
 *  list the terminal tabs' names, colours and states come from too (sessions.ts). */
export const useSessions = () => useSyncExternalStore(subscribeSessions, getSessions)
/** The sessions the panel lists: another program's own (a herdr pane) only while a tab shows it (its own panel has the rest). */
const listed = (list: Session[] | null) => list?.filter((s) => !s.external || s.clients > 0) ?? null
/** Claude Code on the web's sessions the panel lists (none but on the desktop app). */
function useCloud() {
  const all = useSyncExternalStore(subscribeCloud, getCloud)
  return useMemo(() => cloudListed(all), [all])
}
type Cloudy = ReturnType<typeof cloudListed>

const button = "grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"

/** One session's row (its icon in its colour, with its name and what the row can't say as the tooltip). `page`: in the
 *  Terminals tab (view:terminals), with what it's doing and since when spelled out. */
function Row({ s, open, tab, page, where }: { s: Session; open: boolean; tab: string; page?: boolean
  /** Shown only in other workspaces' tabs: their names. */
  where?: string }) {
  const to = `view:terminal/${s.id}`
  const a = agentIn(s, useAgents())
  const account = useTerminalAccount(s.id, a)
  const d = useDrag()
  // What the row shows only as colours and rings, or not at all: its state, account, machine, workspace, meters.
  const tip = [labelOf(s, a) + (a ? stateTip(s) : ""),
    [account && `${account} account`, s.machineLabel && `on ${s.machineLabel}`, where && `in ${where}`, !s.clients && "detached"].filter(Boolean).join(", "),
    a && s.meter && cap(meterText(s))].filter(Boolean).join("\n")
  return (
    // Dragged (core/drag.ts), like a file from the tree: onto a pane's edge, its middle or a tab bar, it opens there.
    <div onPointerDown={(e) => startDrag(e, { from: "row", to, label: labelOf(s, a) })} className={cn(d?.item.to === to && "opacity-50")}>
    <SidebarRow icon={a?.icon ?? SquareTerminal} iconClassName={stateClass(s, a)} tint={tintOf(s, a)} badge={waiting(s, a)} tag={s.machineLabel && short(s.machineLabel)} label={labelOf(s, a)} open={open}
      active={tab === to} tip={tip} data-session={s.id} data-state={s.state} data-agent={a?.name}
      data-where={where}
      data-machine={s.machine}
      swipe={() => [{ label: "End", icon: X, danger: true, run: () => void endForGood(s.id) }]}
      onContextMenu={menuFor(() => menuOf(s, a))}
      onClick={(e) => openView(to, { newTab: !isViewOpen(to) || e.metaKey || e.ctrlKey || e.button === 1 })}>
      {/* At most half the row, so the name always shows. The machine is a tag on the icon, and detached (nobody
          watching: no tab on any device, no tmux in a real terminal) is in the tooltip and the Terminals tab. */}
      {page && <span className="mr-1 max-w-[50%] truncate text-[11px] text-tertiary group-hover/row:hidden">{[where && `in ${where}`, about(s, a, true, account)].filter(Boolean).join(" · ")}</span>}
      {!page && where && <span className="mr-1 max-w-20 shrink-0 truncate text-[11px] text-tertiary group-hover/row:hidden">{where}</span>}
      {/* (last, so every row's ring lines up at its edge) */}
      {a && s.meter && <Meters s={s} tint={a.tint} />}
      <button type="button" className={`${button} hidden group-hover/row:grid`} aria-label="End session" data-tip="End session"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void endForGood(s.id) }} data-no-drag><X className="size-3.5" strokeWidth={2.25} /></button>
    </SidebarRow>
    </div>
  )
}

const copy = (text: string, what: string) => () => void copyText(text).then(() => notify(`Copied the ${what}`, { id: "copied" }), (e) => notifyError(e))
/** A session's menu: its ids (its agent's own when it says, what `claude --resume` takes), its agent's conversation, End. */
function menuOf(s: Session, a: Agent | null): MenuItem[] {
  const conversation = a?.session && s.session && `view:${a.session}/${onMachine(s.session, s.machine)}`
  return [
    ...(s.session ? [{ label: "Copy session ID", icon: Copy, run: copy(s.session, "session ID") }] : []),
    { label: "Copy terminal ID", icon: Copy, run: copy(s.id, "terminal ID") },
    ...(conversation ? [{ label: "Open conversation", icon: MessagesSquare, sep: true, run: () => openView(conversation, { newTab: !isViewOpen(conversation) }) }] : []),
    { label: "End session", icon: X, danger: true, sep: true, run: () => void endForGood(s.id) },
  ]
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
/** A machine's name short enough for the icon's tag: "M1" as is, "Mini PC" → "MP", "studio" → "ST". */
const short = (l: string) => {
  const w = l.trim().split(/\s+/)
  return (l.length <= 3 ? l : w.length > 1 ? w.map((x) => x[0]).join("").slice(0, 3) : l.slice(0, 2)).toUpperCase()
}

/** Agent meters beside the name (sessions.ts: Meter): its context as a ring that fills up (as Claude's desktop app
 *  does), a percent or tokens, with its cache's time left as an inner ring while idle; the numbers are in the row's tooltip. */
function Meters({ s, tint }: { s: Session; tint?: string }) {
  const { context: c, cache } = s.meter!
  const used = c ? Math.min(1, c.tokens / c.window) : 0
  const rings = [
    c?.as === "bar" && { key: "context", r: 6, part: used, colour: used > 0.9 ? "var(--red)" : used > 0.75 ? "var(--orange)" : "var(--muted-foreground)" },
    cache?.as === "bar" && s.state === "idle" && { key: "cache", r: 3, part: cacheLeft(cache), colour: tint ?? "var(--muted-foreground)" },
  ].filter((b) => !!b)
  const text = c?.as === "percent" ? `${Math.round(used * 100)}%` : c?.as === "tokens" ? `${Math.round(c.tokens / 1000)}k` : ""
  if (!rings.length && !text) return null
  return (
    <span className="mr-1 flex shrink-0 items-center gap-1.5 group-hover/row:hidden" data-meters>
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

/** The sessions split by workspace: the current one's (open in its tabs, or in no workspace's), then the ones only
 *  other workspaces show, with their names (by number order). Without Workspaces, all of them are `here`. */
function byWorkspace(list: Session[]): { here: Session[]; other: { s: Session; where: string }[] } {
  const desk = currentWorkspace()
  if (!desk) return { here: list, other: [] }
  const mine = new Set(desk.places)
  const elsewhere = new Map<string, string[]>()
  for (const w of workspaceList()) {
    if (w.n === desk.n) continue
    for (const p of w.places) if (p.startsWith("view:terminal/") && !mine.has(p)) elsewhere.set(p, [...(elsewhere.get(p) ?? []), w.label])
  }
  const here: Session[] = [], other: { s: Session; where: string }[] = []
  for (const s of list) {
    const w = elsewhere.get(`view:terminal/${s.id}`)
    if (w) other.push({ s, where: w.join(", ") }); else here.push(s)
  }
  return { here, other }
}

/** Sorted by state (Claude Code's agent view: waiting on you, working, idle, plain shells), the server's order within
 *  each. While `held` (the pointer is over them) the order stays, new ones last, so no row moves out from under a click. */
function useByState(list: Session[], held: boolean) {
  const agents = useAgents()
  const last = useRef<string[]>([])
  if (held) {
    const at = new Map(last.current.map((id, i) => [id, i]))
    return [...list].sort((x, y) => (at.get(x.id) ?? Infinity) - (at.get(y.id) ?? Infinity))
  }
  const sorted = [...list].sort((x, y) => rankOf(x, agentIn(x, agents)) - rankOf(y, agentIn(y, agents)))
  last.current = sorted.map((s) => s.id)
  return sorted
}

/** The rows, the current workspace's first, then the others' under their heading. */
function Rows({ list, open, tab, page }: { list: Session[]; open: boolean; tab: string; page?: boolean }) {
  useWorkspaceVersion()
  const [held, setHeld] = useState(false)
  const { here, other } = byWorkspace(useByState(list, held))
  return (
    <div className="flex flex-col gap-px" onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
      {here.map((s) => <Row key={s.id} s={s} open={open} tab={tab} page={page} />)}
      {!!other.length && (open
        ? <div data-terminals-elsewhere className={cn("flex h-6 items-end px-1.5 pb-0.5 text-[11px] font-medium text-tertiary max-md:h-8 max-md:text-[13px]", here.length && "mt-1")}>Other workspaces</div>
        : here.length > 0 && <div aria-hidden className="mx-auto my-1 h-px w-4 bg-border" />)}
      {other.map(({ s, where }) => <Row key={s.id} s={s} open={open} tab={tab} page={page} where={where} />)}
    </div>
  )
}

/** A Claude Code on the web session's row: Claude Code's icon in its state's colour, its page in a web tab. */
function CloudRow({ c, open, tab, page }: { c: CloudSession; open: boolean; tab: string; page?: boolean }) {
  const to = `view:web/${c.url}`
  const a = useAgents().find((x) => x.name === "claude")
  const state = c.state === "running" ? "working" : c.state === "waiting" ? "waiting for you" : "idle"
  return (
    <SidebarRow icon={a?.icon ?? Cloud} iconClassName={c.state === "running" ? "animate-pulse" : undefined}
      tint={c.state === "waiting" ? "var(--yellow)" : c.state === "running" ? a?.tint : undefined} badge={c.state === "waiting"}
      label={c.title} open={open} active={tab === to} tip={`${c.title} (${state}), in the cloud`} data-cloud={c.id} data-state={c.state}
      onClick={(e) => openView(to, { newTab: !isViewOpen(to) || e.metaKey || e.ctrlKey || e.button === 1 })}>
      <span className="mr-1 shrink-0 truncate text-[11px] text-tertiary">{page ? `${cap(state)} · ${ago(c.updated)}` : ago(c.updated)}</span>
    </SidebarRow>
  )
}

/** The cloud's rows under their heading (in the rail: after a rule), the older ones behind Show older (not in the rail). */
function CloudRows({ cloud, open, tab, page, after }: { cloud: Cloudy; open: boolean; tab: string; page?: boolean; after: boolean }) {
  const [older, setOlder] = useState(false)
  const { listed } = cloud
  if (!listed.length && !(open && cloud.older.length)) return null
  return (
    <div className="flex flex-col gap-px" data-terminals-cloud>
      {open
        ? <div className={cn("flex h-6 items-end px-1.5 pb-0.5 text-[11px] font-medium text-tertiary max-md:h-8 max-md:text-[13px]", after && "mt-1")}>Cloud</div>
        : after && <div aria-hidden className="mx-auto my-1 h-px w-4 bg-border" />}
      {listed.map((c) => <CloudRow key={c.id} c={c} open={open} tab={tab} page={page} />)}
      {open && older && cloud.older.map((c) => <CloudRow key={c.id} c={c} open={open} tab={tab} page={page} />)}
      {open && !!cloud.older.length && (
        <button type="button" data-keyrow data-cloud-older onClick={() => setOlder(!older)}
          className="flex h-7 min-w-0 cursor-pointer items-center truncate rounded-[5px] pl-1.5 text-left text-[13px] whitespace-nowrap text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground max-md:min-h-11 max-md:text-[15px]">
          {older ? "Show fewer" : `Show ${cloud.older.length} older`}
        </button>
      )}
    </div>
  )
}

/** The + button's menu: a terminal, then every coding agent that's on. */
export function newMenu(e: MouseEvent, agents: Agent[]) {
  menuBelow(e, [
    { label: "New terminal", icon: SquareTerminal, run: () => void openTerminal() },
    ...agents.map((a, i) => ({ label: `New ${a.label}`, icon: a.icon, sep: i === 0, run: () => openAgent(a.name) })),
    { label: "Choose where…", icon: Monitor, sep: true, run: () => void choosePlace() },
    { label: "Where new ones open…", icon: Monitor, run: () => void chooseDefaultPlace() },
  ])
}

/** The panel folds itself (without saving) while there are no sessions; in the rail, only the sessions' icons. */
export function Sessions({ open, tab }: SidebarCtx) {
  const { list: all, refused } = useSessions()
  const list = listed(all)
  const cloud = useCloud()
  const agents = useAgents()
  const fold = useContext(PanelFold)
  const empty = !!list && !list.length && !cloud.listed.length
  // Opened by hand while empty: until a session comes along (then it's open anyway) or it's folded again.
  const [peek, setPeek] = useState(false)
  useEffect(() => { if (!empty) setPeek(false) }, [empty])
  if (refused) return null
  if (!open) return list?.length || cloud.listed.length
    ? <>{!!list?.length && <Rows list={list} open={false} tab={tab} />}<CloudRows cloud={cloud} open={false} tab={tab} after={!!list?.length} /></>
    : null
  const auto = empty && !peek
  const folded = !!fold?.collapsed || auto
  const own = fold && {
    collapsed: folded,
    toggle: () => {
      if (!empty) return fold.toggle()
      // Empty: showing it is local (peek), so an empty panel never gets saved as open or folded.
      if (fold.collapsed) { fold.toggle(); setPeek(true) } else setPeek(!peek)
    },
  }
  return (
    <div className="flex shrink-0 flex-col" data-auto-folded={auto || undefined}>
      <PanelFold.Provider value={own}>
        <SidebarHeading title="Terminals" open={open}>
          {/* The first agent (Claude Code, when it's on) a click away; + for a terminal or any agent. */}
          {agents.slice(0, 1).map((a) => (
            <button key={a.name} type="button" className={button} aria-label={`New ${a.label}`} data-tip={`New ${a.label}`} data-agent={a.name}
              onClick={() => openAgent(a.name)}><a.icon className="size-3.5" strokeWidth={2} /></button>
          ))}
          <button type="button" className={button} aria-label="New terminal or agent" data-tip="New terminal or agent"
            onClick={(e) => newMenu(e, agents)}><Plus className="size-3.5" strokeWidth={2.25} /></button>
        </SidebarHeading>
      </PanelFold.Provider>
      {!folded && (
        <div className="flex flex-col gap-px">
          {list && <Rows list={list} open={open} tab={tab} />}
          <CloudRows cloud={cloud} open={open} tab={tab} after={!!list?.length} />
          {empty && (
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

/** The sessions' rows in the Terminals tab (view:terminals): the panel's rows, spelled out. */
export function SessionList() {
  const list = listed(useSessions().list)
  const cloud = useCloud()
  return (
    <div className="flex flex-col gap-px pb-1">
      {list && <Rows list={list} open tab="" page />}
      <CloudRows cloud={cloud} open tab="" page after={!!list?.length} />
      {list && !list.length && !cloud.listed.length && !cloud.older.length && (
        <button type="button" onClick={() => void openTerminal()}
          className="flex h-7 min-w-0 cursor-pointer items-center truncate pl-1.5 text-left text-[13px] whitespace-nowrap text-tertiary hover:text-muted-foreground">
          No terminals running. Open one
        </button>
      )}
    </div>
  )
}

/** A session's state in words, for search: "Working · started 5 min ago · detached"; `short`, for its row (next to its
 *  name, on a phone too): "Working · 5 min · detached". `account`: its agent's, when it has several (useTerminalAccount). */
export function about(s: Session, a: Agent | null, short?: boolean, account?: string) {
  const st = a ? stateTip(s).replace(/^ \((.*)\)$/, "$1") : ""
  const mins = Math.max(0, Math.round((Date.now() - s.started) / 60000))
  const n = mins < 60 ? `${mins} min` : mins < 60 * 24 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`
  const age = short ? (mins < 1 ? "<1 min" : n) : mins < 1 ? "started just now" : `started ${n} ago`
  return [account, s.machineLabel && `on ${s.machineLabel}`, st && st[0].toUpperCase() + st.slice(1), a && s.meter && meterText(s), age, !s.clients && "detached"].filter(Boolean).join(" · ")
}
