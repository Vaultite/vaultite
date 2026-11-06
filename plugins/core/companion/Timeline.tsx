// The companion's session tab: a timeline of what it did and what it saw, grouped by note, newest first; its state live
// at the top, its chat a click away, and a line to ask it something not tied to a note. timeline.ts reads the session.
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react"
import { Bot, Check, ChevronRight, CircleAlert, Crosshair, Ellipsis, Eraser, Eye, FilePen, FileText, Highlighter, History, MessageCircle, MessageSquare,
  MessageSquareText, MousePointerClick, Pencil, Replace, RotateCcw, Search, Shapes, ShieldQuestion, SquareTerminal, User, X } from "lucide-react"
import { Button, cn, fmtStamp, fmtTime, getTabLayout, isDesktop, isViewOpen, Markdown, menuBelow, notifyError, op, openFile, openView, allPanes, panesOf, plural, tabOfPane, usePane } from "@vaultite"
import type { ChatLive } from "@plugins/claude-code/driven"
import { getState, subscribe, type Agent } from "./live"
import type { Lines, Message, Read } from "./moments"
import { readMoments } from "./moments"
import { AskLine } from "./AskLine"
import { Arrow, follow } from "./Overlay"
import { agentMenu, MODES } from "./session"
import { type Act, contextOf, noteOf, type Outcome, type Place, type Turn, turnsOf } from "./turns"

const base = (p: string) => p.split("/").pop()?.replace(/\.md$/, "") ?? p
const clip = (s: string, n: number) => { const l = s.replace(/\s+/g, " ").trim(); return l.length > n ? `${l.slice(0, n - 1).trimEnd()}…` : l }
const seconds = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.floor(ms / 60_000)} min`)
const linesOf = (s: string) => (s ? s.replace(/\n$/, "").split("\n") : [])

/** Go to a place in a note: its tab if it's open, else beside this pane (on a desktop with another), then its line. */
function jump(p: Place, pane: string) {
  if (!p.path) return
  const path = p.path, l = getTabLayout(), mine = tabOfPane(l, pane)
  const open = allPanes(l).some((x) => x.to === `file:${path}`)
  const other = mine && panesOf(mine).find((x) => x.id !== pane)
  openFile(path, !open && other && isDesktop() ? { pane: other.id } : {})
  follow({ name: "", path, line: p.line ?? 1, find: p.find })
}

/** The session's agent: "Companion: Ada" is Ada's, "Companion" the companion's. */
const nameIn = (title: string) => /^Companion: (.+)$/.exec(title)?.[1] ?? getState().name

export function CompanionView({ id, c, chat }: { id: string; c: ChatLive; chat: () => void }) {
  const s = useSyncExternalStore(subscribe, getState)
  const name = nameIn(c.title)
  const agent = s.agents.find((a) => a.name.toLowerCase() === name.toLowerCase())
  const turns = useMemo(() => turnsOf(c.entries), [c.entries])
  const open = useMemo(() => new Set(s.notes.map((n) => n.id)), [s.notes])
  const tasks = useTasks(id, turns)
  const { pane } = usePane()
  // (items it left anywhere here: an answer to one shows on it, not again as a row)
  const items = useMemo(() => new Set(turns.flatMap((t) => t.acts.flatMap((a) => (a.item ? [a.item] : [])))), [turns])
  const groups = useMemo(() => groupsOf(turns, items), [turns, items])
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-companion-timeline={id}>
      <div className="isolate min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-[40rem] px-5 pt-5 pb-8 max-md:px-4">
          <Head name={name} agent={agent} c={c} mode={s.mode} chat={chat} />
          {!c.ready ? <Skeleton /> : !c.found ? <p className="py-10 text-center text-[15px] text-muted-foreground">This session isn't on this machine.</p> : (
            <>
              {groups.length === 0 && <p className="py-10 text-center text-[15px] text-muted-foreground max-md:text-[17px]">Nothing yet</p>}
              <div className="space-y-6" data-groups>
                {groups.map((g) => <Group key={g.key} path={g.path} turns={g.turns} items={items} open={open} tasks={tasks} pane={pane} chat={chat} />)}
              </div>
              {c.start > 0 && (
                <button type="button" onClick={() => void c.earlier().catch((e) => notifyError(e, "Couldn't read what came before"))}
                  className="mt-5 flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] px-2 text-[13px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground max-md:h-11 max-md:text-[15px]">
                  <History className="size-4" strokeWidth={2} />Show earlier
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <AskLine name={name} />
    </div>
  )
}

function Skeleton() {
  return (
    <div className="loading-in space-y-4 pt-2" aria-busy>
      <div className="h-4 w-1/3 rounded bg-muted" />
      {[0, 1, 2].map((n) => <div key={n} className="flex gap-3"><div className="size-5 rounded-full bg-muted" /><div className="h-4 flex-1 rounded bg-muted" /></div>)}
    </div>
  )
}

// ---------- its state, live

const DOING: Partial<Record<Agent["state"], string>> = { reading: "Reading", thinking: "Thinking", writing: "Writing", starting: "Starting", listening: "Listening" }

function Head({ name, agent, c, mode, chat }: { name: string; agent?: Agent; c: ChatLive; mode: string; chat: () => void }) {
  const working = c.s?.state === "working" || c.s?.state === "starting"
  const [, tick] = useState(0)
  useEffect(() => {
    if (!working) return
    const t = setInterval(() => { if (!document.hidden) tick((n) => n + 1) }, 1000)
    return () => clearInterval(t)
  }, [working])
  const state = c.s?.state === "waiting" ? "Asks your permission" : c.s?.state === "error" ? "Stopped" : working ? DOING[agent?.state ?? "thinking"] ?? "Working"
    : !c.s ? "Asleep" : agent?.seen ? "Seen" : "Idle"
  const tint = `var(--${agent?.tint ?? "orange"})`
  const modeName = MODES.find((m) => m.mode === mode)?.short
  return (
    <header className="mb-6" data-companion-head>
      <div className="flex items-center gap-2.5">
        <Arrow tint={tint} size={22} className={cn("shrink-0", working && "animate-pulse")} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] leading-[22px] font-semibold tracking-tight max-md:text-[19px]">{name}</h1>
          <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground max-md:text-[15px]" data-companion-state={c.s?.state ?? "asleep"}>
            <span className={cn(working && "shimmer", c.s?.state === "waiting" && "text-ink-(--orange)", c.s?.state === "error" && "text-ink-(--red)")}>{state}</span>
            {working && c.s && <span className="text-tertiary tabular-nums">{seconds(Date.now() - c.s.at)}</span>}
            {modeName && mode !== "off" && <><span className="text-tertiary">·</span><span>{modeName}</span></>}
          </div>
        </div>
        <Button look="quiet" size="small" className="max-md:size-11 max-md:px-0" onClick={chat} aria-label="Show chat" data-show-chat>
          <MessageSquare className="size-4 max-md:size-5" strokeWidth={2} /><span className="max-md:hidden">Chat</span>
        </Button>
        {agent && (
          <button type="button" aria-label="More" onClick={(e) => menuBelow(e, agentMenu(agent).filter((m) => m.label !== "Show its session"))}
            className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground max-md:size-11">
            <Ellipsis className="size-4 max-md:size-5" />
          </button>
        )}
      </div>
      {c.s?.state === "waiting" && (
        <div className="mt-3 flex items-center gap-2 rounded-[10px] bg-[color-mix(in_srgb,var(--orange)_10%,transparent)] px-3 py-2 text-[13px] max-md:text-[15px]" data-companion-asks>
          <ShieldQuestion className="size-4 shrink-0 text-ink-(--orange)" strokeWidth={2} />
          <span className="min-w-0 flex-1 truncate">{agent?.asks?.text ?? "It asks your permission"}</span>
          <Button size="small" className="max-md:h-11" onClick={chat}>Answer</Button>
        </div>
      )}
      {c.s?.state === "error" && c.s.error && <p className="mt-2 text-[13px] text-ink-(--red) max-md:text-[15px]">{c.s.error}</p>}
    </header>
  )
}

// ---------- groups: turns in a row in one note

type G = { key: string; path: string; turns: Turn[] }
/** Newest first: turns in a row in the same note go under it. */
function groupsOf(turns: Turn[], items: Set<string>): G[] {
  const out: G[] = []
  for (const t of [...turns].reverse()) {
    if (!t.acts.length && !t.said && !contextOf(t, items).length && !t.message?.before) continue
    const path = noteOf(t), last = out.at(-1)
    if (last && last.path === path) last.turns.push(t)
    else out.push({ key: t.id, path, turns: [t] })
  }
  return out
}

function Group({ path, turns, items, open, tasks, pane, chat }: { path: string; turns: Turn[]; items: Set<string>; open: Set<string>; tasks: Tasks; pane: string; chat: () => void }) {
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
  return (
    <section data-group={path || "none"}>
      {path ? (
        <button type="button" onClick={() => jump({ path }, pane)}
          className="-mx-1.5 mb-1 flex h-7 max-w-full cursor-pointer items-center gap-1.5 rounded-[6px] px-1.5 text-left hover:bg-foreground/[0.05] max-md:h-11">
          <FileText className="size-3.5 shrink-0 text-muted-foreground max-md:size-4" strokeWidth={2} />
          <span className="truncate text-[13px] font-semibold max-md:text-[15px]">{base(path)}</span>
          {folder && <span className="truncate text-[12px] text-tertiary max-md:text-[13px]">{folder}</span>}
        </button>
      ) : <div className="mb-1 flex h-7 items-center text-[13px] font-semibold text-muted-foreground max-md:h-11 max-md:text-[15px]">Not in a note</div>}
      <div className="space-y-3">
        {turns.map((t) => <TurnView key={t.id} t={t} note={path} items={items} open={open} tasks={tasks} pane={pane} chat={chat} />)}
      </div>
    </section>
  )
}

// ---------- a turn: what the user did, then what it did

const OTHER: [RegExp, string][] = [[/^Read ME\.md/, "Its session started"], [/^Time for a fresh session/, "Asked to hand over to a fresh session"],
  [/^Continue where you left off/, "Its session resumed"], [/^Your session has ended/, "Its session ended"]]

function TurnView({ t, note, items, open, tasks, pane, chat }: { t: Turn; note: string; items: Set<string>; open: Set<string>; tasks: Tasks; pane: string; chat: () => void }) {
  const context = contextOf(t, items)
  const other = !t.message && t.said ? OTHER.find(([re]) => re.test(t.said!))?.[1] ?? clip(t.said, 140) : ""
  // (what asked for an answer and got none: it chose silence; an edit let pass is the usual)
  const silent = context.some((m) => m.kind === "ask" || m.kind === "point" || m.kind === "reply") && !t.acts.length && !t.live
  return (
    <div className="relative" data-turn={t.id}>
      {/* (the rail the turn's icons sit on) */}
      <div aria-hidden className="absolute top-3 bottom-3 left-[9px] w-px bg-border max-md:left-[11px]" />
      {context.map((m, n) => <UserRow key={n} m={m} note={note} at={n === 0 ? t.at : undefined} pane={pane} />)}
      {other && <Row icon={t.said?.startsWith("Read ME.md") ? Bot : User} muted at={t.at} title={other} />}
      {t.message?.before && !OTHER[0][0].test(t.message.before) && <Row icon={User} muted title={clip(t.message.before, 140)} />}
      {t.acts.map((a) => <ActRow key={a.id} a={a} note={note} open={open} tasks={tasks} pane={pane} chat={chat} />)}
      {silent && <Row icon={Eye} muted title="Seen, let it pass" />}
    </div>
  )
}

/** A row on the rail: its icon, its title (a click goes to its place), and what's under it. */
function Row({ icon: Icon, title, place, at, muted, live, error, tint, onClick, children, data }: {
  icon: typeof User; title: ReactNode; place?: string; at?: string; muted?: boolean; live?: boolean; error?: boolean; tint?: string
  onClick?: () => void; children?: ReactNode; data?: string
}) {
  const head = (
    <>
      <span className={cn("relative z-[1] grid size-[19px] shrink-0 place-items-center rounded-full bg-background max-md:size-[23px]")}>
        <Icon className={cn("size-3.5 max-md:size-4", muted ? "text-tertiary" : "text-muted-foreground", live && "breathe", error && "text-ink-(--red)")} strokeWidth={2} style={tint ? { color: tint } : undefined} />
      </span>
      <span className={cn("min-w-0 flex-1 truncate", muted ? "text-muted-foreground" : "text-foreground/90", error && "text-ink-(--red)")}>
        {title}{place && <span className="ml-1.5 text-tertiary">{place}</span>}
      </span>
      {at && <span className="shrink-0 text-[12px] text-tertiary tabular-nums max-md:text-[13px]" data-tip={fmtStamp(Date.parse(at))}>{fmtTime(at)}</span>}
    </>
  )
  const line = "-mx-1.5 flex min-h-7 w-[calc(100%+0.75rem)] min-w-0 items-center gap-2.5 rounded-[6px] px-1.5 text-left text-[13px] max-md:min-h-11 max-md:text-[15px]"
  return (
    <div data-row={data}>
      {onClick ? <button type="button" onClick={onClick} className={cn(line, "cursor-pointer hover:bg-foreground/[0.05]")}>{head}</button> : <div className={line}>{head}</div>}
      {children && <div className="mb-1.5 ml-[29px] min-w-0 max-md:ml-[33px]">{children}</div>}
    </div>
  )
}

/** Where on the note: a line, else the text, else nothing; another note's name first. */
function placeText(p: Place, note: string) {
  const at = p.line ? `L${p.line}` : p.find ? `“${clip(p.find, 28)}”` : ""
  return p.path && p.path !== note ? [base(p.path), at].filter(Boolean).join(" · ") : at
}

function UserRow({ m, note, at, pane }: { m: Read; note: string; at?: string; pane: string }) {
  const go = m.path ? () => jump(m, pane) : undefined
  const place = placeText(m, note)
  const said = m.text ? <p className="text-[13px] leading-[19px] break-words text-muted-foreground max-md:text-[15px] max-md:leading-[21px]">{clip(m.text, 400)}</p> : null
  switch (m.kind) {
    case "ask": return <Row data="ask" icon={User} muted at={at} title={m.thread ? "You asked in a comment" : "You asked"} place={place} onClick={go}>{said}</Row>
    case "point": return <Row data="point" icon={MousePointerClick} muted at={at} title="You pointed at" place={place || "this"} onClick={go}>{m.selection ? <Quote text={m.selection} /> : null}</Row>
    case "reply": return <Row data="reply" icon={User} muted at={at} title={m.bubble ? "You replied to its bubble" : "You replied"} place={place} onClick={go}>{said}</Row>
    case "move": return <Row data="move" icon={MessageCircle} muted at={at} title={m.into === "note" ? "You put its bubble in the note" : "You folded its words into a bubble"} place={place} onClick={go}>{said}</Row>
    case "edit": {
      const n = (m.hunks ?? []).reduce((k, h) => k + Math.max(h.added.length, h.removed.length), 0)
      const first = m.hunks?.[0]?.line
      return (
        <Row data="edit" icon={Pencil} muted at={at} title={n ? `You changed ${plural(n, "line")}` : "You changed it"} place={first ? `L${first}` : place} onClick={m.path ? () => jump({ path: m.path, line: first }, pane) : undefined}>
          {m.hunks?.length ? <Hunks hunks={m.hunks} /> : m.changes?.length ? <p className="text-[13px] text-muted-foreground">{m.changes.join("; ")}</p> : null}
        </Row>
      )
    }
    case "accept": case "reject": case "dismiss":
      return <Row data={m.kind} icon={m.kind === "accept" ? Check : X} muted at={at} title={m.bubble ? "You closed its bubble" : `You ${m.kind === "accept" ? "accepted" : m.kind === "reject" ? "rejected" : "dismissed"} one of its items`} place={place} onClick={go} />
    case "change": case "watch":
      return <Row data={m.kind} icon={Eye} muted at={at} title={`${m.kind === "watch" ? "A watch" : "What it follows"}: ${m.what ?? "it changed"}`} place={m.where ? clip(m.where, 40) : undefined}>
        {m.changes?.length ? <p className="text-[13px] break-words whitespace-pre-line text-muted-foreground max-md:text-[15px]">{clip(m.changes.slice(0, 6).join("\n"), 400)}</p> : null}
      </Row>
    default: return null
  }
}

// ---------- what it did

const OUTCOME: Record<Outcome["kind"], string> = { accept: "Accepted", reject: "Rejected", dismiss: "Dismissed", reply: "Replied" }

/** An item's state: how the user answered it last, else open while it's in the app, else gone. */
function Status({ a, open }: { a: Act; open: Set<string> }) {
  const last = a.outcomes?.filter((o) => o.kind !== "reply").at(-1)
  const word = last ? OUTCOME[last.kind] : a.item && open.has(a.item) ? "Open" : ""
  if (!word) return null
  return (
    <span data-status={word.toLowerCase()} className={cn("ml-2 inline-flex h-[18px] items-center rounded-full px-1.5 text-[11px] font-medium align-[1px] max-md:h-5 max-md:text-[12px]",
      word === "Accepted" ? "bg-[color-mix(in_srgb,var(--green)_16%,transparent)] text-ink-(--green)" : word === "Open" ? "bg-[color-mix(in_srgb,var(--blue)_14%,transparent)] text-ink-(--blue)"
        : "bg-foreground/[0.06] text-muted-foreground")}>{word}</span>
  )
}

function ActRow({ a, note, open, tasks, pane, chat }: { a: Act; note: string; open: Set<string>; tasks: Tasks; pane: string; chat: () => void }) {
  const place = placeText(a, note)
  const where = a.path ?? note
  const go = where && (a.line || a.find || a.path) ? () => jump({ ...a, path: where }, pane) : undefined
  const common = { live: a.live, at: undefined, place, onClick: go, data: a.k }
  if (a.error && a.k !== "text") return <Row {...common} icon={CircleAlert} error title={`Couldn't ${VERB[a.k] ?? "do it"}`}><p className="text-[13px] break-words text-muted-foreground max-md:text-[15px]">{clip(a.error, 300)}</p></Row>
  const replies = a.outcomes?.filter((o) => o.kind === "reply" && o.text)
  switch (a.k) {
    case "say": return <Row {...common} icon={MessageCircle} title="Said"><Words text={a.text} /></Row>
    case "comment": return (
      <Row {...common} icon={MessageSquareText} title={<>{a.reply ? "Replied in a comment" : "Commented"}<Status a={a} open={open} /></>}>
        <Words text={a.text} />
        {replies?.map((r, n) => <p key={n} className="mt-1 text-[13px] break-words text-muted-foreground max-md:text-[15px]"><span className="font-medium">You:</span> {clip(r.text!, 300)}</p>)}
      </Row>
    )
    case "suggest": return (
      <Row {...common} icon={Replace} title={<>Suggested a change<Status a={a} open={open} /></>}>
        <DiffBlock removed={linesOf(a.from)} added={linesOf(a.to)} />
        {a.why && <p className="mt-1 text-[13px] text-muted-foreground max-md:text-[15px]">{a.why}</p>}
      </Row>
    )
    case "propose": return (
      <Row {...common} icon={FilePen} title={<>{a.pending ? "Started a proposal" : "Proposed changes"}<Status a={a} open={open} /></>}>
        {a.pending ? <p className="text-[13px] text-muted-foreground max-md:text-[15px]">{a.pending}</p> : a.from !== undefined ? <DiffBlock removed={linesOf(a.from)} added={linesOf(a.to ?? "")} /> : null}
        {a.why && <p className="mt-1 text-[13px] text-muted-foreground max-md:text-[15px]">{a.why}</p>}
      </Row>
    )
    case "edit": {
      const n = linesOf(a.text).length
      return (
        <Row {...common} icon={Pencil} title={<>{a.proposed ? "Proposed it instead" : a.from ? `Rewrote ${plural(n, "line")}` : `Wrote ${plural(n, "line")}`}{a.proposed && <Status a={a} open={open} />}</>}>
          <DiffBlock removed={linesOf(a.from ?? "")} added={linesOf(a.text)} />
        </Row>
      )
    }
    case "look": return <Row {...common} icon={Crosshair} muted title="Pointed at" place={place || "the note"} />
    case "pass": return <Row {...common} icon={Eye} muted title={a.text ? `Let it pass: ${a.text}` : "Let it pass"} place={undefined} />
    case "highlight": return <Row {...common} icon={Highlighter} title="Highlighted" />
    case "draw": return <Row {...common} icon={Shapes} title="Drew in the drawing" />
    case "clear": return <Row {...common} icon={Eraser} muted title="Cleared its words" />
    case "handover": return <Row {...common} icon={RotateCcw} title="Handed over to a fresh session">{a.text && <Words text={a.text} muted />}</Row>
    case "read": return <ReadRow a={a} />
    case "session": return <SessionRow a={a} tasks={tasks} />
    case "text": return <Row {...common} onClick={chat} place={undefined} icon={MessageSquare} muted title="In its session"><Words text={a.text} muted clamp /></Row>
    case "ask": return <Row {...common} onClick={a.answer ? undefined : chat} place={undefined} icon={ShieldQuestion} title={a.answer ? `Asked: ${a.answer}` : "Asks your permission"}><p className="text-[13px] break-words text-muted-foreground max-md:text-[15px]">{clip(a.text, 300)}</p></Row>
  }
}

const VERB: Partial<Record<Act["k"], string>> = { say: "say it", comment: "comment", suggest: "suggest it", propose: "propose it", edit: "write it", look: "point there",
  highlight: "highlight it", draw: "draw it", clear: "clear it", handover: "hand over", read: "read it", session: "start it" }

function ReadRow({ a }: { a: Extract<Act, { k: "read" }> }) {
  const [open, setOpen] = useState(false)
  const title = a.what.length > 1 ? `Looked into ${plural(a.what.length, "thing")}` : "Looked into"
  return (
    <Row data="read" icon={Search} muted live={a.live} onClick={() => setOpen((o) => !o)}
      title={<>{title}{a.what.length === 1 && <span className="ml-1.5 font-mono text-[12px] text-tertiary max-md:text-[13px]">{clip(a.what[0], 80)}</span>}
        {a.what.length > 1 && <ChevronRight className={cn("ml-1 inline size-3.5 text-tertiary transition-transform", open && "rotate-90")} strokeWidth={2.5} />}</>}>
      {open && a.what.length > 1 ? <ul className="space-y-0.5 font-mono text-[12px] text-muted-foreground max-md:text-[13px]">{a.what.map((w, n) => <li key={n} className="truncate">{w}</li>)}</ul> : null}
    </Row>
  )
}

// ---------- sessions it started

type Kin = { id: string; agent: string; title: string; state: string; link: string | null }
type Tasks = Map<string, Kin>
const AGENT: Record<string, string> = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode", subagent: "a subagent" }
const KIN_STATE: Record<string, string> = { working: "Working", waiting: "Waiting", done: "Done", error: "Failed", cancelled: "Cancelled",
  running: "Working", "needs you": "Needs you", failed: "Failed" }

/** The tasks it delegated (Delegation's), read again as its turns come and while one works. */
function useTasks(id: string, turns: Turn[]): Tasks {
  const [kin, setKin] = useState<Tasks>(() => new Map())
  const asked = turns.reduce((n, t) => n + t.acts.filter((a) => a.k === "session" && a.task).length, 0)
  // (its jobs, handed off for the user: the companion's, not its session's children)
  const jobs = turns.some((t) => t.acts.some((a) => a.k === "session" && a.job))
  const working = [...kin.values()].some((k) => k.state === "working" || k.state === "waiting" || k.state === "running" || k.state === "needs you")
  useEffect(() => {
    if (!asked) return
    let gone = false
    const read = () => void Promise.all([op<{ children: Kin[] }>("delegate.list", { of: id }).then((r) => r.children, () => []),
      jobs ? op<{ jobs: Kin[] }>("companion.jobs", {}).then((r) => r.jobs, () => []) : []])
      .then(([a, b]) => { if (!gone) setKin(new Map([...a, ...b].map((k) => [k.id, k]))) })
    read()
    const t = working ? setInterval(() => { if (document.visibilityState === "visible") read() }, 10_000) : null
    return () => { gone = true; if (t) clearInterval(t) }
  }, [id, asked, working, jobs])
  return kin
}

function SessionRow({ a, tasks }: { a: Extract<Act, { k: "session" }>; tasks: Tasks }) {
  const kin = a.task ? tasks.get(a.task) : undefined
  const to = a.terminal ? `terminal/${a.terminal}` : kin?.link ? kin.link.replace(/^view:/, "") : ""
  const who = AGENT[a.agent.split("_")[0]] ?? (a.agent || "a shell")
  const title = a.job ? `Handed off to ${who}` : a.terminal || !a.task ? `Opened a terminal: ${who}` : `Delegated to ${who}`
  return (
    <Row data="session" icon={a.agent === "subagent" ? Bot : SquareTerminal} live={a.live} onClick={to ? () => openView(to, { newTab: !isViewOpen(to) }) : undefined}
      title={<>{a.agent === "subagent" ? "Ran a subagent" : title}{kin && <span className="ml-2 text-tertiary">{KIN_STATE[kin.state] ?? kin.state}</span>}</>}>
      {(kin?.title || a.title) && <p className="text-[13px] break-words text-muted-foreground max-md:text-[15px]">{clip(kin?.title || a.title, 200)}</p>}
    </Row>
  )
}

// ---------- text and diffs

function Words({ text, muted, clamp }: { text: string; muted?: boolean; clamp?: boolean }) {
  return text.trim() ? <Markdown text={text} className={cn("min-w-0 break-words", muted && "text-muted-foreground", clamp && "line-clamp-3")} /> : null
}

const Quote = ({ text }: { text: string }) => <p className="border-l-2 border-border pl-2 text-[13px] break-words text-muted-foreground italic max-md:text-[15px]">{clip(text, 300)}</p>

const MAX = 8
/** Lines taken out and put in, `-` and `+` shown in their colours; long ones folded after a few. */
export function DiffBlock({ removed, added, at }: { removed: string[]; added: string[]; at?: number }) {
  const [all, setAll] = useState(false)
  const rows = [...removed.map((text) => ({ add: false, text })), ...added.map((text) => ({ add: true, text }))]
  if (!rows.length) return null
  const shown = all ? rows : rows.slice(0, MAX)
  return (
    <div className="overflow-hidden rounded-[8px] border-[0.5px] border-border font-mono text-[12px] leading-[18px] max-md:text-[13px] max-md:leading-[20px] select-text" data-diff-block>
      {at !== undefined && <div className="border-b-[0.5px] border-border bg-foreground/[0.03] px-2 font-sans text-[11px] leading-[20px] text-tertiary max-md:text-[12px]">Line {at}</div>}
      {shown.map((r, n) => (
        <div key={n} data-diff={r.add ? "add" : "del"} className={cn("flex min-w-0", r.add ? "bg-[color-mix(in_srgb,var(--green)_14%,transparent)]" : "bg-[color-mix(in_srgb,var(--red)_12%,transparent)]")}>
          <span aria-hidden className={cn("w-5 shrink-0 text-center select-none", r.add ? "text-ink-(--green)" : "text-ink-(--red)")}>{r.add ? "+" : "-"}</span>
          <span className={cn("min-w-0 flex-1 pr-2 break-words whitespace-pre-wrap", !r.add && "text-muted-foreground")}>{r.text || " "}</span>
        </div>
      ))}
      {rows.length > MAX && (
        <button type="button" onClick={() => setAll((x) => !x)} className="w-full cursor-pointer bg-foreground/[0.03] px-2 text-left font-sans text-[12px] leading-[22px] text-muted-foreground hover:text-foreground max-md:min-h-11 max-md:text-[13px]">
          {all ? "Show less" : `Show all ${rows.length} lines`}
        </button>
      )}
    </div>
  )
}

const Hunks = ({ hunks }: { hunks: NonNullable<Read["hunks"]> }) => (
  <div className="space-y-1.5">{hunks.map((h, n) => <DiffBlock key={n} removed={h.removed} added={h.added} at={hunks.length > 1 ? h.line : undefined} />)}</div>
)

// ---------- a message of moments, in its chat

/** A message the companion's session was sent, in its chat: its moments as lines, what changed as a diff, the note's
 *  lines folded. */
export function MomentMessage({ text }: { text: string }) {
  const m = useMemo(() => readMoments(text), [text])
  if (!m) return <Markdown text={text} className="min-w-0 break-words" />
  return <MomentsOf m={m} />
}

const SAID: Record<Read["kind"], string> = { ask: "Asked", point: "Pointed at", edit: "Changed", open: "Opened", reply: "Replied to", accept: "Accepted", reject: "Rejected", dismiss: "Dismissed", move: "Moved", change: "Saw a change in", watch: "A watch saw" }

function MomentsOf({ m }: { m: Message }) {
  return (
    <div className="min-w-0 space-y-1.5" data-moments>
      {m.before && <Markdown text={m.before} className="min-w-0 text-muted-foreground break-words" />}
      {m.moments.map((x, n) => (
        <div key={n} className="min-w-0" data-moment={x.kind}>
          <div className="break-words">
            <span className="font-medium">{SAID[x.kind]}</span>
            {x.item && <span className="text-muted-foreground"> {x.item}</span>}
            {x.path && <span className="text-muted-foreground"> {base(x.path)}{x.line ? `:${x.line}` : ""}</span>}
            {x.text && x.kind !== "accept" && x.kind !== "dismiss" && x.kind !== "reject" && <span>: {x.text}</span>}
          </div>
          {x.selection && <Quote text={x.selection} />}
          {x.changes?.length ? <p className="text-[13px] text-muted-foreground">{x.changes.join("; ")}</p> : null}
          {x.hunks?.length ? <div className="mt-1"><Hunks hunks={x.hunks} /></div> : null}
        </div>
      ))}
      {m.notes.map((l, n) => <NoteLines key={n} l={l} />)}
      <p className="text-[12px] text-tertiary">{[m.mode && `${m.mode[0].toUpperCase()}${m.mode.slice(1)} mode`, m.focus && `in ${base(m.focus.path)}${m.focus.line ? `:${m.focus.line}` : ""}`].filter(Boolean).join(", ")}</p>
    </div>
  )
}

function NoteLines({ l }: { l: Lines }) {
  const [open, setOpen] = useState(false)
  const label = "lines" in l ? `${base(l.path)}, lines ${l.from}-${l.to} of ${l.of}` : `${base(l.path)}, the drawing`
  return (
    <div data-note-lines>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="-mx-1 flex h-6 cursor-pointer items-center gap-1 rounded-[5px] px-1 text-[12px] text-muted-foreground hover:bg-foreground/[0.05] max-md:h-11 max-md:text-[13px]">
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} strokeWidth={2.5} />{label}
      </button>
      {open && (
        <pre className="mt-1 max-h-72 overflow-auto rounded-[8px] bg-background/60 px-2 py-1.5 font-mono text-[11.5px] leading-[17px] whitespace-pre-wrap break-words text-muted-foreground">
          {"lines" in l ? l.lines.map((x, k) => `${String(l.from + k).padStart(4)}  ${x}`).join("\n") : l.scene.join("\n")}
        </pre>
      )}
    </div>
  )
}
