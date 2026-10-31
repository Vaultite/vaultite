// A Claude Code session as a chat (view:claude-session/<id>, `new` till it starts): live over its socket, what it asks
// answered in place, a composer saying straight into it; `<id>@<machine>` is another machine's, through its server.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { ArrowUp, Brain, Check, ChevronDown, ChevronRight, CircleAlert, FileText, Folder, Globe, History, ListTodo, Pencil, Search, Square, SquareTerminal,
  Bot, Wrench, X, Ellipsis } from "lucide-react"
import { Button, cn, confirmDialog, copyText, DiffRows, get, haptic, isViewOpen, Markdown, menuBelow, notify, notifyError, onMachine, op,
  openAgent, openMenu, openView, splitMachine, textDiff, useScopedState, viewsChanged, type DiffLine, type MenuItem } from "@vaultite"
import type { Entry, Question } from "./chatlog"
import { ClaudeIcon } from "./ClaudeIcon"

type Mode = "default" | "acceptEdits" | "plan" | "auto" | "dontAsk" | "bypassPermissions"
type Summary = { id: string; state: "starting" | "working" | "waiting" | "idle" | "error"; cwd: string; account: string; model: string; effort: string
  mode: Mode; at: number; asks: string[]; error?: string }
type Ask = Extract<Entry, { k: "ask" }>
type Tool = Extract<Entry, { k: "tool" }>
type Options = { models: { id: string; label: string }[]; efforts: string[]; modes: { id: Mode; label: string }[]; accounts: { id: string; label: string; effort: string; mode: Mode }[]
  folders: string[]; vault: string; home: string }

/** A chat tab's arg before its session exists. */
export const NEW = "new"
const TINT = "var(--orange)"

/** Sessions' titles, for their tabs (viewsChanged redraws them). */
const titles = new Map<string, string>()
export const chatTitle = (id: string, fallback: string) => (!id || id === NEW ? "New chat" : titles.get(id) || fallback)
function nameTab(id: string, title: string) {
  if (!title || titles.get(id) === title) return
  titles.set(id, title)
  viewsChanged()
}

let options: Promise<Options> | null = null
const optionsOf = () => (options ??= get<Options>("claude-code/chat/options").catch((e) => { options = null; throw e }))
function useOptions() {
  const [o, setO] = useState<Options | null>(null)
  useEffect(() => { let on = true; void optionsOf().then((x) => { if (on) setO(x) }, () => {}); return () => { on = false } }, [])
  return o
}

const clipLine = (s: string) => { const l = s.replace(/[`*_#>]/g, "").replace(/\s+/g, " ").trim(); return l.length > 60 ? `${l.slice(0, 59).trimEnd()}…` : l }
const home = (p: string, h = "") => (h && p.startsWith(h) ? `~${p.slice(h.length)}` : p.replace(/^\/Users\/[^/]+/, "~"))
const base = (p: string) => p.split("/").filter(Boolean).pop() ?? p
/** claude-opus-5-5 -> Opus 5.5; an alias as its label. */
function modelLabel(model: string, o: Options | null) {
  const alias = o?.models.find((m) => m.id === model)
  if (alias) return alias.label
  const parts = model.replace(/^claude-/, "").split("-").filter((p) => !(/^\d+$/.test(p) && p.length === 8))
  const words = parts.filter((p) => !/^\d+$/.test(p)), nums = parts.filter((p) => /^\d+$/.test(p))
  return [...words.map((w) => w[0]?.toUpperCase() + w.slice(1)), nums.join(".")].join(" ").trim() || "Default model"
}
const EFFORT: Record<string, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" }
/** The modes' words on a phone, where the composer's chips share one line. */
const MODE_SHORT: Partial<Record<Mode, string>> = { default: "Ask", acceptEdits: "Edits", plan: "Plan", auto: "Auto", bypassPermissions: "Bypass" }
const seconds = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`)

// ---------- the session, live: its socket's hello, then each change, merged by id

type Live = { ready: boolean; found: boolean; s: Summary | null; title: string; cwd: string; account: string; model: string; effort: string; tui: string | null
  /** The plugin driving it with the tools it serves (the companion), or "": it can't go to a terminal. */
  driven: string
  entries: Entry[]; start: number; refused?: string }

function useChat(id: string) {
  const map = useRef(new Map<string, Entry>())
  const [live, setLive] = useState<Live>({ ready: false, found: true, s: null, title: "", cwd: "", account: "", model: "", effort: "", tui: null, driven: "", entries: [], start: 0 })
  const meta = useRef(live)
  useEffect(() => {
    if (!id || id === NEW) return
    let ws: WebSocket | null = null, timer: ReturnType<typeof setTimeout> | null = null, frame = 0, retry = 0, closed = false
    // (a stream's pieces come many a second: drawn once a frame)
    const draw = () => { frame ||= requestAnimationFrame(() => { frame = 0; setLive({ ...meta.current, entries: [...map.current.values()] }) }) }
    const open = () => {
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/claude-code/chat/${encodeURIComponent(id)}`)
      ws.onopen = () => { retry = 0 }
      ws.onmessage = (ev) => {
        let m: Record<string, unknown>
        try { m = JSON.parse(String(ev.data)) } catch { return }
        if (m.t === "hello") {
          map.current = new Map([...(m.history as { entries: Entry[] }).entries, ...(m.live as Entry[])].map((e) => [e.id, e]))
          meta.current = { ready: true, found: !!m.found, s: m.s as Summary | null, title: String(m.title ?? ""), cwd: String(m.cwd ?? ""), account: String(m.account ?? ""), model: String(m.model ?? ""), effort: String(m.effort ?? ""),
            tui: (m.tui as string | null) ?? null, driven: String(m.driven ?? ""), entries: [], start: (m.history as { start: number }).start }
          nameTab(id, meta.current.title)
        } else if (m.t === "put") {
          const e = m.e as Entry
          map.current.set(e.id, e)
          meta.current = { ...meta.current, found: true }
        } else if (m.t === "state") meta.current = { ...meta.current, s: m.s as Summary | null, found: true }
        else if (m.t === "tui") { meta.current = { ...meta.current, tui: (m.tui as string | null) ?? null, title: String(m.title || meta.current.title) }; nameTab(id, meta.current.title) }
        else if (m.t === "title") { meta.current = { ...meta.current, title: String(m.title ?? "") }; nameTab(id, meta.current.title) }
        else if (m.t === "refused") meta.current = { ...meta.current, ready: true, refused: String(m.reason ?? "") }
        draw()
      }
      ws.onclose = () => { if (!closed && !meta.current.refused) timer = setTimeout(open, Math.min(15_000, 500 * 2 ** retry++)) }
    }
    open()
    return () => { closed = true; if (timer) clearTimeout(timer); cancelAnimationFrame(frame); ws?.close() }
  }, [id])
  /** The page before what's shown, from its transcript. */
  const earlier = async () => {
    const r = await get<{ entries: Entry[]; start: number }>(`claude-code/chat/${encodeURIComponent(id)}/history?before=${meta.current.start}`)
    map.current = new Map([...r.entries.map((e) => [e.id, e] as const), ...map.current])
    meta.current = { ...meta.current, start: r.start }
    setLive({ ...meta.current, entries: [...map.current.values()] })
  }
  return { ...live, earlier }
}

// ---------- the view

export function ChatView({ id, setArg }: { id: string; setArg: (arg: string) => void }) {
  return <Chat key={id === NEW ? NEW : id} id={id} setArg={setArg} />
}

function Chat({ id, setArg }: { id: string; setArg: (arg: string) => void }) {
  const fresh = !id || id === NEW
  const c = useChat(id)
  const o = useOptions()
  const scroller = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  const [opened, setOpened] = useState<Set<string>>(() => new Set())
  const toggle = (k: string) => setOpened((s) => { const n = new Set(s); if (!n.delete(k)) n.add(k); return n })
  const working = c.s?.state === "working" || c.s?.state === "starting"
  const pending = c.entries.filter((e): e is Ask => e.k === "ask" && !e.answer && !!c.s?.asks.includes(e.id))

  // Kept at the bottom while it's there, as a chat is; scrolled up, it stays where it was.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stuck.current) el.scrollTop = el.scrollHeight
  }, [c.entries, c.s?.state])
  const onScroll = () => { const el = scroller.current; if (el) stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }

  const asked = pending.map((p) => p.id).join(",")
  const rows = useMemo(() => layout(c.entries, new Set(asked.split(","))), [c.entries, asked])
  const last = c.entries[c.entries.length - 1]
  const streaming = !!last && "live" in last && last.live
  // (till Claude Code names it, what was asked first)
  const first = c.entries.find((e) => e.k === "user")
  const title = fresh ? "New chat" : c.title || (first?.k === "user" ? clipLine(first.text) : c.ready ? "Untitled chat" : "")
  useEffect(() => { if (!c.title && first?.k === "user" && !fresh) nameTab(id, clipLine(first.text)) }, [first?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-chat={fresh ? "new" : id} data-state={c.s?.state ?? (c.tui !== null ? "terminal" : "closed")}>
      <div ref={scroller} onScroll={onScroll} className="isolate min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-[46rem] px-5 pt-5 pb-8 max-md:px-4">
          <Head id={id} fresh={fresh} title={title} c={c} o={o} />
          {fresh ? <Welcome /> : !c.ready ? <Skeleton /> : !c.found ? <p className="py-10 text-center text-[15px] text-muted-foreground">This session isn't on this machine, or it's in a private account.</p> : (
            <>
              {c.start > 0 && (
                <button type="button" onClick={() => void c.earlier().catch((e) => notifyError(e, "Couldn't read the earlier messages"))}
                  className="mb-5 flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] px-2 text-[13px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground max-md:h-11 max-md:text-[15px]">
                  <History className="size-4" strokeWidth={2} />Show earlier messages
                </button>
              )}
              <div className="space-y-4" data-entries>
                {rows.map((r) => r.kind === "tools"
                  ? <div key={r.key} className="-mx-1.5">{r.tools.map((t) => <ToolRow key={t.id} t={t} kids={r.kids.get(t.id) ?? []} open={opened.has(t.id)} toggle={() => toggle(t.id)} />)}</div>
                  : <EntryView key={r.e.id} e={r.e} id={id} open={opened.has(r.e.id)} toggle={() => toggle(r.e.id)} pending={pending.some((p) => p.id === r.e.id)} />)}
              </div>
              {working && !streaming && !pending.length && <Working since={c.s!.at} />}
              {c.s?.state === "error" && c.s.error && <Note tone="error" text={c.s.error} />}
            </>
          )}
        </div>
      </div>
      <Composer id={id} fresh={fresh} c={c} o={o} pending={pending.at(-1) ?? null} working={working} setArg={setArg} onSent={() => { stuck.current = true }} />
    </div>
  )
}

function Skeleton() {
  return (
    <div className="loading-in space-y-5 pt-2" aria-busy>
      <div className="ml-auto h-10 w-2/5 rounded-[16px] bg-muted" />
      <div className="space-y-2"><div className="h-3.5 w-11/12 rounded bg-muted" /><div className="h-3.5 w-4/5 rounded bg-muted" /><div className="h-3.5 w-3/5 rounded bg-muted" /></div>
    </div>
  )
}

function Welcome() {
  return (
    <div className="flex flex-col items-center pt-[14vh] pb-6 text-center max-md:pt-[8vh]">
      <ClaudeIcon className="size-9" style={{ color: TINT }} />
      <p className="mt-4 text-[22px] leading-[28px] font-semibold tracking-tight">What should Claude work on?</p>
      <p className="mt-1.5 max-w-sm text-[14px] text-muted-foreground max-md:text-[15px]">A Claude Code session that runs in the app: it keeps going when the app closes, and asks here and in your inbox.</p>
    </div>
  )
}

type Kin = { id: string; agent: string; title: string; state: string; link: string | null }
type Family = { parent: { title: string; link: string | null } | null; children: Kin[] }
const KIN_STATE: Record<string, string> = { working: "Working", waiting: "Waiting", done: "Done", error: "Failed", cancelled: "Cancelled" }
const AGENT_NAME: Record<string, string> = { claude: "Claude", codex: "Codex", opencode: "OpenCode" }

/** Who delegated this session its task and the subagents it delegated to (Delegation's, when it's on), read again as
 *  its state changes and, while a subagent works, now and then. */
function useFamily(id: string, state: string) {
  const [f, setF] = useState<Family | null>(null)
  useEffect(() => {
    if (!id || id === NEW) return
    let gone = false
    const read = () => void op<Family>("delegate.list", { of: splitMachine(id)[0] }).then((r) => { if (!gone) setF(r.parent || r.children.length ? r : null) }, () => {})
    read()
    const t = setInterval(() => { if (document.visibilityState === "visible" && f?.children.some((k) => k.state === "working" || k.state === "waiting")) read() }, 10_000)
    return () => { gone = true; clearInterval(t) }
  }, [id, state, f?.children.map((k) => k.state).join()]) // eslint-disable-line react-hooks/exhaustive-deps
  return f
}

function Kinfolk({ f }: { f: Family }) {
  const go = (link: string | null) => { if (link) openView(link.replace(/^view:/, ""), { newTab: !isViewOpen(link.replace(/^view:/, "")) }) }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground max-md:text-[15px]" data-family>
      {f.parent && <span>Delegated by <button type="button" data-family-parent className="cursor-pointer font-medium text-foreground/80 underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground/60"
        onClick={() => go(f.parent!.link)}>{f.parent.title}</button></span>}
      {f.children.length > 0 && <span className="flex flex-wrap items-center gap-1">
        Subagents
        {f.children.map((k) => (
          <button key={k.id} type="button" data-family-child={k.id} onClick={() => go(k.link)} data-tip={`${AGENT_NAME[k.agent] ?? k.agent}: ${k.title}`}
            className="flex h-6 max-w-[220px] cursor-pointer items-center gap-1.5 rounded-[6px] bg-foreground/[0.05] px-2 text-foreground/80 hover:bg-foreground/[0.09] max-md:h-8">
            <span className="truncate">{AGENT_NAME[k.agent] ?? k.agent} · {k.title}</span>
            <span className={cn("shrink-0", k.state === "working" || k.state === "waiting" ? "text-tertiary" : "text-muted-foreground")}>{KIN_STATE[k.state] ?? k.state}</span>
          </button>
        ))}
      </span>}
    </div>
  )
}

function Head({ id, fresh, title, c, o }: { id: string; fresh: boolean; title: string; c: ReturnType<typeof useChat>; o: Options | null }) {
  const family = useFamily(fresh ? "" : id, c.s?.state ?? "")
  if (fresh) return null
  const model = c.s?.model || c.model
  const where = [c.cwd && base(c.cwd), model && modelLabel(model, o), o && o.accounts.length > 1 && o.accounts.find((a) => a.id === c.account)?.label].filter(Boolean)
  const toTerminal = async () => {
    if (!c.ready) return
    if (c.tui) { const to = `terminal/${onMachine(c.tui, splitMachine(id)[1])}`; return openView(to, { newTab: !isViewOpen(to) }) }
    if (c.s && (c.s.state === "working" || c.s.state === "waiting")) {
      const ok = await confirmDialog({ title: "Open it in a terminal?", body: "Claude is working on it here. Opening it in a terminal stops what it's doing; the conversation goes on there.", confirm: "Stop and open" })
      if (!ok) return
    }
    try {
      if (c.s) await op("claude-code.chat-stop", { id })
      const [sid, machine] = splitMachine(id)
      await openAgent("claude", { resume: sid, machine, newTab: true })
    } catch (e) { notifyError(e, "Couldn't open it in a terminal") }
  }
  const more = (e: MouseEvent) => menuBelow(e, [
    { label: "Copy session id", run: () => void copyText(id).then(() => notify("Session id copied")) },
    ...(c.s ? [{ label: "Stop session", icon: Square, sep: true, run: () => void op("claude-code.chat-stop", { id }).then(() => notify("Stopped: a message resumes it"), (err) => notifyError(err, "Couldn't stop it")) } satisfies MenuItem] : []),
  ])
  return (
    <header className="mb-6 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-[22px] leading-[28px] font-semibold tracking-tight text-balance break-words max-md:hidden">{title || " "}</h1>
        {where.length > 0 && <div className="mt-1 truncate text-[13px] max-md:mt-2 text-muted-foreground max-md:text-[15px]" data-tip={c.cwd ? home(c.cwd, o?.home) : undefined} data-tip-trunc>{where.join(" · ")}</div>}
        {family && <Kinfolk f={family} />}
      </div>
      <div className="flex shrink-0 items-center gap-1 pt-0.5">
        {/* (a plugin's session that runs here has tools no terminal serves: taking it there would end it for its plugin) */}
        {!(c.driven && c.s) && (
          <Button look="quiet" size="small" className="max-md:size-11 max-md:px-0" disabled={!c.ready} onClick={() => void toTerminal()} aria-label={c.tui ? "Show its terminal" : "Open in terminal"}
            data-tip={c.tui ? "It runs in a terminal" : "Resume it in Claude Code in a terminal"} data-open-terminal>
            <SquareTerminal className="size-4 max-md:size-5" strokeWidth={2} /><span className="max-md:hidden">{c.tui ? "Show terminal" : "Open in terminal"}</span>
          </Button>
        )}
        <button type="button" aria-label="More" onClick={more} className="grid size-7 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground max-md:size-11">
          <Ellipsis className="size-4 max-md:size-5" />
        </button>
      </div>
    </header>
  )
}

// ---------- entries

type Row = { kind: "one"; e: Entry } | { kind: "tools"; key: string; tools: Tool[]; kids: Map<string, Entry[]> }

/** Tool calls in a row drawn together, tight; a subagent's steps inside the call that runs it; the rest one by one. A
 *  call waiting on its ask (`asked`) is drawn as that ask. */
function layout(entries: Entry[], asked: Set<string>): Row[] {
  const out: Row[] = [], kids = new Map<string, Entry[]>(), have = new Set(entries.map((e) => e.id))
  for (const e of entries) if ("parent" in e && e.parent) kids.set(e.parent, [...(kids.get(e.parent) ?? []), e])
  for (const e of entries) {
    if ("parent" in e && e.parent) continue
    if (e.k === "tool" && (e.name === "AskUserQuestion" || e.name === "ExitPlanMode")) {
      // (its ask is drawn; read back from a transcript, it's said how it was answered)
      if (!have.has(`ask:${e.id}`) && e.result !== undefined) out.push({ kind: "one", e: askOf(e) })
      continue
    }
    if (e.k === "tool" && asked.has(`ask:${e.id}`)) continue
    const prev = out[out.length - 1]
    if (e.k === "tool") {
      if (prev?.kind === "tools") prev.tools.push(e)
      else out.push({ kind: "tools", key: e.id, tools: [e], kids })
    } else if (e.k === "result" && e.ok) continue
    else out.push({ kind: "one", e })
  }
  return out
}

/** A question or plan read back from a transcript, as the line an answered ask is. */
function askOf(t: Tool): Ask {
  const i = (t.input ?? {}) as { questions?: { question?: string }[] }
  const question = t.name === "AskUserQuestion" ? i.questions?.map((q) => q.question).filter(Boolean).join(" ") || "Claude asked" : "Claude had a plan"
  const answers = [...(t.result ?? "").matchAll(/"[^"]*"="([^"]*)"/g)].map((m) => m[1])
  const answer = t.error ? (t.name === "ExitPlanMode" ? "Kept planning" : "Not answered") : t.name === "ExitPlanMode" ? "Approved" : answers.length ? `Answered: ${answers.join("; ")}` : "Answered"
  return { k: "ask", id: `ask:${t.id}`, kind: t.name === "ExitPlanMode" ? "plan" : "question", tool: t.name, title: question, answer, at: t.at }
}

function EntryView({ e, id, open, toggle, pending }: { e: Entry; id: string; open: boolean; toggle: () => void; pending: boolean }) {
  switch (e.k) {
    case "user": return (
      <div className="flex justify-end" data-entry="user">
        <div className="max-w-[85%] min-w-0 rounded-[18px] bg-muted px-3.5 py-2 text-[15px] leading-[22px] max-md:text-[17px] max-md:leading-[24px]">
          <Markdown text={e.text} className="min-w-0 break-words" />
        </div>
      </div>
    )
    case "text": return <div data-entry="text" className="text-[15px] leading-[24px] max-md:text-[17px] max-md:leading-[26px]"><Markdown text={e.text} className="min-w-0 break-words" /></div>
    case "thinking": return (
      <div data-entry="thinking">
        <button type="button" onClick={toggle} aria-expanded={open} className="-mx-1.5 flex h-7 cursor-pointer items-center gap-1.5 rounded-[6px] px-1.5 text-[13px] text-muted-foreground hover:bg-foreground/[0.04] max-md:h-11 max-md:text-[15px]">
          <Brain className="size-3.5" strokeWidth={2} />
          <span className={cn(e.live && "shimmer")}>{e.live ? "Thinking" : "Thought"}</span>
          <ChevronRight className={cn("size-3.5 text-tertiary transition-transform", open && "rotate-90")} strokeWidth={2.5} />
        </button>
        {open && <div className="mt-1 border-l-2 border-border pl-3 text-[14px] leading-[21px] text-muted-foreground italic"><Markdown text={e.text} className="min-w-0 break-words" /></div>}
      </div>
    )
    case "ask": return <AskCard e={e} id={id} pending={pending} />
    case "result": return <Note tone="error" text={e.error ?? "It stopped"} />
    case "note": return <Note tone={e.tone} text={e.text} />
    default: return null
  }
}

function Note({ text, tone }: { text: string; tone?: "error" }) {
  return (
    <div data-entry="note" className={cn("flex items-start gap-2 text-[13px] leading-[19px] max-md:text-[15px]", tone === "error" ? "text-[var(--red)]" : "justify-center text-muted-foreground")}>
      {tone === "error" && <CircleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.25} />}
      <span className="min-w-0 break-words whitespace-pre-wrap">{text}</span>
    </div>
  )
}

/** Working since `since`: the time it's taken, as Claude Code shows it. */
function Working({ since }: { since: number }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => { if (!document.hidden) tick((n) => n + 1) }, 1000); return () => clearInterval(t) }, [])
  return (
    <div className="mt-4 flex items-center gap-2 text-[13px] text-muted-foreground max-md:text-[15px]" data-working aria-live="polite">
      <ClaudeIcon className="breathe size-4" style={{ color: TINT }} />
      Working<span className="text-tertiary tabular-nums">{seconds(Date.now() - since)}</span>
    </div>
  )
}

const TOOL_ICONS: Record<string, typeof Wrench> = { Bash: SquareTerminal, PowerShell: SquareTerminal, Read: FileText, Write: Pencil, Edit: Pencil, MultiEdit: Pencil,
  NotebookEdit: Pencil, Grep: Search, Glob: Search, WebFetch: Globe, WebSearch: Globe, Agent: Bot, Task: Bot, TodoWrite: ListTodo, LS: Folder }
const toolName = (n: string) => (n.startsWith("mcp__") ? n.split("__").slice(2).join(" ").replace(/_/g, " ") || n : n === "Task" ? "Agent" : n)

function ToolRow({ t, kids, open, toggle }: { t: Tool; kids: Entry[]; open: boolean; toggle: () => void }) {
  const Icon = TOOL_ICONS[t.name] ?? Wrench
  const steps = kids.filter((k) => k.k === "tool").length
  const running = t.live || t.result === undefined
  return (
    <div data-tool={t.name} data-running={running || undefined}>
      <button type="button" onClick={toggle} aria-expanded={open}
        className="group flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-[6px] px-1.5 text-left text-[13px] hover:bg-foreground/[0.04] max-md:h-11 max-md:text-[15px]">
        <Icon className={cn("size-3.5 shrink-0 text-muted-foreground max-md:size-4", running && "breathe")} strokeWidth={2} />
        <span className="shrink-0 font-medium text-foreground/80">{toolName(t.name)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground max-md:text-[13px]">{t.summary}</span>
        {steps > 0 && <span className="shrink-0 text-[12px] text-tertiary">{steps} step{steps === 1 ? "" : "s"}</span>}
        {t.error && <CircleAlert className="size-3.5 shrink-0 text-[var(--red)]" strokeWidth={2.25} aria-label="Failed" />}
        <ChevronRight className={cn("size-3.5 shrink-0 text-tertiary opacity-0 transition group-hover:opacity-100 max-md:opacity-100", open && "rotate-90 opacity-100")} strokeWidth={2.5} />
      </button>
      {open && (
        <div className="mt-1 mb-2.5 ml-[26px] space-y-2">
          <ToolInput t={t} />
          {kids.length > 0 && <div className="-ml-1.5 border-l-2 border-border pl-1.5">{kids.filter((k): k is Tool => k.k === "tool").map((k) => <ToolLine key={k.id} t={k} />)}</div>}
          {t.result !== undefined && (
            <pre className={cn("max-h-72 overflow-auto rounded-[8px] border-[0.5px] border-border px-3 py-2 font-mono text-[12px] leading-[17px] whitespace-pre-wrap break-words",
              t.error ? "text-[var(--red)]" : "text-muted-foreground")}>{t.result || "(no output)"}</pre>
          )}
        </div>
      )}
    </div>
  )
}

/** A subagent's step, one line. */
const ToolLine = ({ t }: { t: Tool }) => (
  <div className="flex h-6 min-w-0 items-center gap-2 px-1.5 text-[12px] text-muted-foreground">
    <span className="shrink-0 font-medium">{toolName(t.name)}</span><span className="min-w-0 truncate font-mono text-tertiary">{t.summary}</span>
  </div>
)

const str = (v: unknown) => (typeof v === "string" ? v : "")

/** What a call was given: a command, an edit as a diff, a file's text, else its input. */
function ToolInput({ t }: { t: Tool }) {
  const i = (t.input ?? {}) as Record<string, unknown>
  const box = "max-h-72 overflow-auto rounded-[8px] bg-muted px-3 py-2 font-mono text-[12px] leading-[17px] whitespace-pre-wrap break-words"
  if ((t.name === "Bash" || t.name === "PowerShell") && str(i.command)) return <pre className={box}>{str(i.command)}</pre>
  if ((t.name === "Edit" || t.name === "MultiEdit") && (str(i.old_string) || str(i.new_string) || Array.isArray(i.edits))) {
    const edits = Array.isArray(i.edits) ? i.edits as { old_string?: string; new_string?: string }[] : [{ old_string: str(i.old_string), new_string: str(i.new_string) }]
    return <EditDiff file={str(i.file_path)} edits={edits} />
  }
  if (t.name === "Write" && str(i.content)) return <div><div className="mb-1 truncate font-mono text-[12px] text-muted-foreground">{str(i.file_path)}</div><pre className={box}>{str(i.content).slice(0, 6000)}</pre></div>
  if (t.name === "TodoWrite" && Array.isArray(i.todos)) return (
    <ul className="space-y-1 text-[13px]">{(i.todos as { content?: string; status?: string }[]).map((x, n) => (
      <li key={n} className="flex items-start gap-2"><span className={cn("mt-1 size-3 shrink-0 rounded-full border-[1.5px]", x.status === "completed" ? "border-[var(--green)] bg-[var(--green)]" : x.status === "in_progress" ? "border-[var(--orange)]" : "border-border")} />
        <span className={cn(x.status === "completed" && "text-muted-foreground line-through")}>{x.content}</span></li>))}</ul>
  )
  return <pre className={box}>{JSON.stringify(t.input, null, 2)}</pre>
}

function EditDiff({ file, edits }: { file: string; edits: { old_string?: string; new_string?: string }[] }) {
  const [lines, setLines] = useState<DiffLine[] | null>(null)
  useEffect(() => {
    let on = true
    void Promise.all(edits.map((x) => textDiff(x.old_string ?? "", x.new_string ?? "", 3))).then((ds) => { if (on) setLines(ds.flatMap((d, n) => (n ? [{ kind: "gap" as const, text: "", n: 0 }, ...d] : d))) })
    return () => { on = false }
  }, [edits])
  return (
    <div>
      {file && <div className="mb-1 truncate font-mono text-[12px] text-muted-foreground">{file}</div>}
      <div className="max-h-80 overflow-auto rounded-[8px] border-[0.5px] border-border">{lines ? <DiffRows lines={lines} /> : null}</div>
    </div>
  )
}

// ---------- what it asks: a permission, its questions, its plan

function AskCard({ e, id, pending }: { e: Ask; id: string; pending: boolean }) {
  const [busy, setBusy] = useState(false)
  const answer = async (a: Record<string, unknown>, said: string) => {
    if (busy) return
    setBusy(true)
    haptic("medium")
    try { await op("claude-code.chat-answer", { id, ask: e.id, ...a }) } catch (err) { setBusy(false); notifyError(err, "Couldn't answer it"); return }
    notify(said)
  }
  if (!pending) {
    // Answered, or no longer asked: a line saying how it went.
    const ok = !!e.answer && !/^(Denied|Kept planning|Stopped)/.test(e.answer)
    return (
      <div data-entry="ask" data-answered className="-mx-1.5 flex min-h-7 items-start gap-2 px-1.5 text-[13px] text-muted-foreground max-md:text-[15px]">
        {ok ? <Check className="mt-[3px] size-3.5 shrink-0 text-[var(--green)]" strokeWidth={2.5} /> : <X className="mt-[3px] size-3.5 shrink-0" strokeWidth={2.5} />}
        <span className="min-w-0 break-words"><span className="text-foreground/80">{e.kind === "permission" ? e.detail || e.title : e.title}</span>{e.answer ? ` · ${e.answer}` : " · No longer asked"}</span>
      </div>
    )
  }
  return (
    <div data-entry="ask" data-ask={e.kind} className="rounded-[14px] border-[0.5px] border-border bg-card p-4 shadow-[0_1px_3px_rgb(0_0_0/0.06)] max-md:p-3.5">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold max-md:text-[15px]" style={{ color: TINT }}>
        <ClaudeIcon className="size-4" />{e.kind === "permission" ? "Permission" : e.kind === "question" ? "Question" : "Plan"}
      </div>
      {e.kind === "permission" ? <Permission e={e} busy={busy} answer={answer} />
        : e.kind === "question" ? <Questions qs={e.questions ?? []} busy={busy} answer={answer} />
        : <Plan e={e} busy={busy} answer={answer} />}
    </div>
  )
}

type Answering = { busy: boolean; answer: (a: Record<string, unknown>, said: string) => Promise<void> }
const BIG = "max-md:h-11 max-md:px-4 max-md:text-[16px]"

function Permission({ e, busy, answer }: { e: Ask } & Answering) {
  const i = (e.input ?? {}) as Record<string, unknown>
  return (
    <>
      <p className="text-[15px] leading-[22px] font-medium max-md:text-[17px]">{e.title}</p>
      {str(i.command) && e.detail && e.detail !== str(i.command) && <p className="mt-0.5 text-[13px] text-muted-foreground max-md:text-[15px]">{e.detail}</p>}
      {str(i.command) ? <pre className="mt-2 max-h-48 overflow-auto rounded-[8px] bg-muted px-3 py-2 font-mono text-[12px] leading-[17px] whitespace-pre-wrap break-words max-md:text-[13px]">{str(i.command)}</pre>
        : (e.tool === "Edit" || e.tool === "MultiEdit") && (str(i.old_string) || str(i.new_string)) ? <div className="mt-2"><EditDiff file={str(i.file_path)} edits={[{ old_string: str(i.old_string), new_string: str(i.new_string) }]} /></div>
        : e.detail ? <p className="mt-1 text-[13px] break-words text-muted-foreground max-md:text-[15px]">{e.detail}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button look="primary" className={BIG} busy={busy} data-answer="allow" onClick={() => void answer({ allow: true }, "Allowed")}><Check className="size-4" />Allow</Button>
        {e.always && <Button className={BIG} disabled={busy} data-answer="always" data-tip={`From now on in this project: ${e.always}`} onClick={() => void answer({ allow: true, always: true }, "Allowed from now on")}>Always allow</Button>}
        <Button look="quiet" className={BIG} disabled={busy} data-answer="deny" onClick={() => void answer({ allow: false }, "Denied")}><X className="size-4" />Deny</Button>
      </div>
      <p className="mt-2.5 text-[12px] text-tertiary max-md:text-[13px]">Or tell Claude what to do instead, below.</p>
    </>
  )
}

function Questions({ qs, busy, answer }: { qs: Question[] } & Answering) {
  const [picks, setPicks] = useState<(number[] | string)[]>(() => qs.map(() => []))
  const [other, setOther] = useState<string[]>(() => qs.map(() => ""))
  const one = qs.length === 1 && !qs[0].multi
  const done = picks.every((p, n) => (typeof p === "string" ? !!p.trim() : p.length > 0) || !!other[n].trim())
  const send = (ps = picks) => {
    const given = ps.map((p, n) => (other[n].trim() ? other[n].trim() : p))
    void answer({ picks: given.map((p) => (typeof p === "string" ? p : p.join(","))) }, "Answered")
  }
  const pick = (q: number, o: number) => {
    const next = picks.map((p, n) => (n !== q ? p : qs[q].multi ? (Array.isArray(p) && p.includes(o) ? p.filter((x) => x !== o) : [...(Array.isArray(p) ? p : []), o]) : [o]))
    setPicks(next)
    setOther((x) => x.map((v, n) => (n === q && !qs[q].multi ? "" : v)))
    if (one) send(next)
  }
  return (
    <div className="space-y-4">
      {qs.map((q, n) => (
        <div key={n} data-question={n}>
          {q.header && <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase max-md:text-[12px]">{q.header}</div>}
          <p className="text-[15px] leading-[22px] font-medium max-md:text-[17px]">{q.question}</p>
          <div className="mt-2 space-y-1">
            {q.options.map((op, k) => {
              const on = Array.isArray(picks[n]) && (picks[n] as number[]).includes(k + 1)
              return (
                <button key={k} type="button" disabled={busy} onClick={() => pick(n, k + 1)} data-option={k + 1} aria-pressed={on}
                  className={cn("flex w-full cursor-pointer items-start gap-2.5 rounded-[10px] border-[0.5px] px-3 py-2 text-left transition-colors disabled:cursor-default max-md:py-3",
                    on ? "border-primary bg-primary/[0.07]" : "border-border hover:bg-foreground/[0.04]")}>
                  <span className={cn("mt-[3px] grid size-4 shrink-0 place-items-center border-[1.5px]", q.multi ? "rounded-[4px]" : "rounded-full", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                    {on && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium max-md:text-[16px]">{op.label}</span>
                    {op.description && <span className="block text-[13px] text-muted-foreground max-md:text-[15px]">{op.description}</span>}
                  </span>
                </button>
              )
            })}
            <input value={other[n]} disabled={busy} onChange={(ev) => { const v = ev.target.value; setOther((x) => x.map((y, i) => (i === n ? v : y))) }}
              onKeyDown={(ev) => { if (ev.key === "Enter" && !ev.nativeEvent.isComposing && done) { ev.preventDefault(); send() } }}
              placeholder="Something else…" aria-label={`Your own answer to: ${q.question}`}
              className="h-9 w-full rounded-[10px] border-[0.5px] border-border bg-transparent px-3 text-[14px] outline-none placeholder:text-muted-foreground focus:border-primary max-md:h-11 max-md:text-[16px]" />
          </div>
        </div>
      ))}
      {(!one || other[0].trim()) && <Button look="primary" className={BIG} busy={busy} disabled={!done} data-answer="submit" onClick={() => send()}>Submit</Button>}
    </div>
  )
}

function Plan({ e, busy, answer }: { e: Ask } & Answering) {
  return (
    <>
      <div className="max-h-[50vh] overflow-y-auto rounded-[10px] bg-muted/60 px-4 py-3 text-[14px] leading-[22px] max-md:text-[16px]"><Markdown text={e.plan ?? ""} className="min-w-0 break-words" /></div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button look="primary" className={BIG} busy={busy} data-answer="approve-edits" onClick={() => void answer({ allow: true, mode: "acceptEdits" }, "Approved: edits go ahead")}><Check className="size-4" />Approve, accept edits</Button>
        <Button className={BIG} disabled={busy} data-answer="approve" onClick={() => void answer({ allow: true, mode: "default" }, "Approved")}>Approve, ask for edits</Button>
        <Button look="quiet" className={BIG} disabled={busy} data-answer="keep" onClick={() => void answer({ allow: false }, "Kept planning")}>Keep planning</Button>
      </div>
      <p className="mt-2.5 text-[12px] text-tertiary max-md:text-[13px]">Or tell Claude what to change, below.</p>
    </>
  )
}

// ---------- the composer

type Picks = { model?: string; effort?: string; mode?: Mode; account?: string; cwd?: string }

function Composer({ id, fresh, c, o, pending, working, setArg, onSent }: { id: string; fresh: boolean; c: ReturnType<typeof useChat>; o: Options | null
  pending: Ask | null; working: boolean; setArg: (arg: string) => void; onSent: () => void }) {
  const DRAFT = `vaultite.chat.${fresh ? NEW : id}`
  const [text, setText] = useState(() => { try { return localStorage.getItem(DRAFT) ?? "" } catch { return "" } })
  const [sending, setSending] = useState(false)
  // A new chat's choices are the workspace's, kept for the next; a running one's are its own.
  const [saved, save] = useScopedState<Picks>("claude-code:chat", {}, "workspace")
  const [next, setNext] = useState<Picks>({})
  const field = useRef<HTMLTextAreaElement>(null)
  const keep = (v: string) => { setText(v); try { if (v.trim()) localStorage.setItem(DRAFT, v); else localStorage.removeItem(DRAFT) } catch { /* private mode */ } }
  useLayoutEffect(() => { const f = field.current; if (f) { f.style.height = "auto"; f.style.height = `${f.scrollHeight}px` } }, [text])
  useEffect(() => { if (fresh) field.current?.focus({ preventScroll: true }) }, [fresh])

  const picks: Picks = fresh ? saved : { model: c.s?.model || c.model || undefined, effort: c.s?.effort || undefined, mode: c.s?.mode, ...next }
  const blocked = !fresh && c.ready && (c.tui !== null || !c.found)
  const send = async () => {
    const said = text.trim()
    if (!said || sending || blocked) return
    setSending(true)
    try {
      if (fresh) {
        const r = await op<{ id: string }>("claude-code.chat-start", { prompt: said, ...(saved.cwd ? { cwd: saved.cwd } : {}), ...(saved.account ? { account: saved.account } : {}),
          ...(saved.model ? { model: saved.model } : {}), ...(saved.effort ? { effort: saved.effort } : {}), ...(saved.mode ? { mode: saved.mode } : {}) })
        keep("")
        setArg(r.id)
      } else {
        // (a choice made before the tab heard it runs goes with it: the server applies it either way)
        await op("claude-code.chat-send", { id, text: said, ...next })
        keep("")
        setNext({})
      }
      onSent()
    } catch (e) { notifyError(e, fresh ? "Couldn't start the chat" : "Couldn't send it") }
    setSending(false)
    field.current?.focus({ preventScroll: true })
  }
  const stop = () => void op("claude-code.chat-interrupt", { id }).catch((e) => notifyError(e, "Couldn't stop it"))
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() }
    else if (e.key === "Escape" && working && !text) { e.preventDefault(); stop() }
  }
  /** A choice changed: a new chat's is kept for the next one; a running session's changes it now. */
  const choose = (p: Picks) => {
    if (fresh) return save({ ...saved, ...p })
    if (!c.ready) return
    if (!c.s) return setNext((n) => ({ ...n, ...p }))
    void op("claude-code.chat-set", { id, ...p }).catch((e) => notifyError(e, "Couldn't change it"))
  }
  const menu = (e: MouseEvent, items: MenuItem[]) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    openMenu({ x: r.left, y: r.top - 4, flip: r.bottom + 4 }, items.map((it) => ({ ...it, run: () => { it.run(); setTimeout(() => field.current?.focus({ preventScroll: true }), 0) } })), true)
  }
  const model = picks.model ? modelLabel(picks.model, o) : "Default model"
  // (none chosen: what the session runs at, as Claude Code says, else its account's settings)
  const effort = picks.effort || (fresh ? o?.accounts.find((a) => a.id === (saved.account ?? "default"))?.effort ?? o?.accounts[0]?.effort : c.effort) || ""
  // (none chosen: the account's default, auto unless its settings say otherwise)
  const modeId: Mode = picks.mode ?? o?.accounts.find((a) => a.id === (fresh ? saved.account ?? "default" : c.account))?.mode ?? o?.accounts[0]?.mode ?? "auto"
  const mode = o?.modes.find((m) => m.id === modeId)?.label ?? "Auto mode"
  const account = o && o.accounts.length > 1 ? o.accounts.find((a) => a.id === (picks.account ?? c.account))?.label ?? o.accounts[0]?.label : ""
  const folder = fresh ? (saved.cwd || o?.vault || "") : ""
  const placeholder = blocked ? (c.tui !== null ? "It runs in a terminal: answer it there" : "Nothing to reply to") : pending?.kind === "permission" ? "Tell Claude what to do instead…"
    : pending?.kind === "question" ? "Or reply in your own words…" : pending?.kind === "plan" ? "Tell Claude what to change…" : working ? "Queue a message…" : fresh ? "Ask Claude to…" : "Reply to Claude…"
  return (
    <div className="shrink-0 px-4 pb-[max(12px,env(safe-area-inset-bottom))] max-md:px-3" data-composer>
      <div className="mx-auto w-full max-w-[46rem] rounded-[16px] border-[0.5px] border-border bg-card shadow-[0_2px_10px_rgb(0_0_0/0.06)] focus-within:border-foreground/25">
        <textarea ref={field} value={text} rows={1} disabled={blocked} onChange={(e) => keep(e.target.value)} onKeyDown={onKey} enterKeyHint="send"
          placeholder={placeholder} aria-label="Message Claude"
          className="max-h-[40dvh] min-h-12 w-full resize-none overflow-y-auto bg-transparent px-4 pt-3 pb-1 text-[15px] leading-[22px] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed max-md:text-[17px] max-md:leading-[24px]" />
        <div className="flex items-center gap-0.5 px-2 pb-2">
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {/* (first: what's changed mid-session, whole on a phone however far the rest scroll) */}
            <Chip label="Permission mode" onClick={(e) => menu(e, (o?.modes ?? []).filter((m) => m.id !== "dontAsk").map((m) => ({ label: m.label, checked: m.id === modeId,
              danger: m.id === "bypassPermissions", run: () => choose({ mode: m.id }) })))}>
              <span className={cn(modeId === "bypassPermissions" && "text-[var(--red)]", modeId === "plan" && "text-[var(--teal)]")}>
                <span className="max-md:hidden">{mode}</span><span className="md:hidden">{MODE_SHORT[modeId] ?? mode}</span>
              </span>
            </Chip>
            {fresh && account && <Chip label="Account" onClick={(e) => menu(e, (o?.accounts ?? []).map((a) => ({ label: a.label, checked: a.label === account, run: () => choose({ account: a.id }) })))}>{account}</Chip>}
            {fresh && <Chip label="Folder" onClick={(e) => menu(e, folderItems(o, folder, (cwd) => choose({ cwd })))}><Folder className="size-3.5 shrink-0" />{base(folder) || "Folder"}</Chip>}
            <Chip label="Model" onClick={(e) => menu(e, [{ label: "Default model", checked: !picks.model, run: () => choose({ model: undefined }) },
              ...(o?.models ?? []).map((m) => ({ label: m.label, checked: m.id === picks.model || modelLabel(picks.model ?? "", o).startsWith(m.label), run: () => choose({ model: m.id }) }))])}>{model}</Chip>
            <Chip label="Effort" onClick={(e) => menu(e, (o?.efforts ?? []).map((x) => ({ label: EFFORT[x] ?? x, checked: x === effort, run: () => choose({ effort: x }) })))}>{effort ? `${EFFORT[effort] ?? effort} effort` : "Default effort"}</Chip>
          </div>
          {working && !text.trim() ? (
            <button type="button" aria-label="Stop" data-tip="Stop (Esc)" onClick={stop} data-stop
              className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-foreground text-background hover:opacity-85 max-md:size-11">
              <Square className="size-3 fill-current max-md:size-3.5" />
            </button>
          ) : (
            <button type="button" aria-label="Send" disabled={!text.trim() || sending || blocked} onClick={() => void send()} data-send
              className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground disabled:cursor-default disabled:opacity-40 max-md:size-11">
              <ArrowUp className="size-4 max-md:size-5" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function folderItems(o: Options | null, at: string, pick: (cwd: string) => void): MenuItem[] {
  if (!o) return []
  const list = [o.vault, ...o.folders.filter((f) => f !== o.vault)]
  return list.map((f, n) => ({ label: f === o.vault ? "Vault" : base(f), hint: home(f, o.home), checked: f === (at || o.vault), sep: n === 1, run: () => pick(f) }))
}

function Chip({ label, onClick, children }: { label: string; onClick: (e: MouseEvent) => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} aria-haspopup="menu" onClick={onClick}
      className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-[8px] px-2 text-[13px] whitespace-nowrap text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground max-md:h-11 max-md:px-2.5 max-md:text-[15px]">
      {children}
      <ChevronDown className="size-3 shrink-0 opacity-70" />
    </button>
  )
}
