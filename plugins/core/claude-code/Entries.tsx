// A conversation's entries as the chat tab draws them: turns (the user's message, Claude's work folded once it's done,
// its answer), thinking, tool calls with their outcome, asks, notes; and the line saying what a live turn is doing.
import { createContext, Suspense, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { Brain, ChevronRight, CircleAlert, FileText, Folder, Globe, ListTodo, Pencil, Search, SquareTerminal, Bot, Wrench, LoaderCircle, FilePlus } from "lucide-react"
import { cn, Markdown, moves, plural } from "@vaultite"
import type { Entry } from "./chatlog"
import { ClaudeIcon } from "./ClaudeIcon"
import { type Driven } from "./driven"
import { type Ask, type Tool, TINT, str, home } from "./chatbits"
import { AskCard } from "./Asks"
import { EditDiff } from "./chatbits"

type User = Extract<Entry, { k: "user" }>

// ---------- what the transcript shares: the session's folder, what's open, what was drawn already

export type Transcript = {
  cwd: string; home?: string
  isOpen: (key: string, dflt: boolean) => boolean
  toggle: (key: string, dflt: boolean) => void
  /** Ids drawn before (a new one enters with a rise), and whether the first draw is over (it doesn't). */
  seen: Set<string>; settled: () => boolean
}
export const TranscriptOf = createContext<Transcript>({ cwd: "", isOpen: (_, d) => d, toggle: () => {}, seen: new Set(), settled: () => false })

/** The app's motion pace (its Animations setting; none when things are kept still). */
function pace() {
  if (!moves()) return null
  const s = getComputedStyle(document.documentElement)
  const v = s.getPropertyValue("--motion").trim(), ms = parseFloat(v) * (v.endsWith("ms") ? 1 : v.endsWith("s") ? 1000 : 1)
  return { duration: ms || 220, easing: s.getPropertyValue("--ease-out").trim() || "ease-out" }
}

/** A part that wasn't drawn before comes in with a short fade and rise; on the chat's first draw everything just is. */
function Enter({ id, children, className, delay = 0, ...rest }: { id: string; children: ReactNode; className?: string; delay?: number } & Record<`data-${string}`, unknown>) {
  const ref = useRef<HTMLDivElement>(null)
  const t = useContext(TranscriptOf)
  useLayoutEffect(() => {
    if (t.seen.has(id)) return
    t.seen.add(id)
    const p = t.settled() ? pace() : null
    if (p && ref.current) ref.current.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: p.duration * 1.3, easing: p.easing, delay, fill: "backwards" })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref} className={className} {...rest}>{children}</div>
}

/** What folds: its height eases open and shut (drawn only while open or folding). `slow`: a fold the reader didn't ask
 *  for (a turn's work as it ends) goes at an unhurried pace, so it reads as folding, not vanishing. */
export function Reveal({ open, slow, children, className }: { open: boolean; slow?: boolean; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(open)
  const was = useRef(open)
  if (open && !shown) setShown(true)
  useLayoutEffect(() => {
    const el = ref.current
    if (was.current === open || !el) return
    was.current = open
    const p = pace()
    const from = el.getBoundingClientRect().height
    for (const a of el.getAnimations()) a.cancel()
    if (!p) { if (!open) setShown(false); return }
    const to = open ? el.scrollHeight : 0
    el.style.overflow = "hidden"
    // (its height and its fade go together, the fade done by halfway: what's below glides, never jumps)
    const start = open && from >= to ? 0 : from
    const frames = open ? [{ height: `${start}px`, opacity: 0.4 }, { height: `${to}px`, opacity: 1 }]
      : [{ height: `${start}px`, opacity: 1 }, { opacity: 0, offset: 0.55 }, { height: "0px", opacity: 0 }]
    const a = el.animate(frames, { duration: p.duration * (slow ? 2.8 : 1.2), easing: slow ? "cubic-bezier(0.45, 0, 0.55, 1)" : p.easing, fill: open ? "none" : "forwards" })
    // (shut, it holds at nothing till it's gone: else it shows whole for a frame before it unmounts)
    a.onfinish = () => { el.style.overflow = ""; if (!open) setShown(false) }
  }, [open, shown])
  return shown ? <div ref={ref} className={className}>{children}</div> : null
}

// ---------- turns

export type Row = { kind: "one"; e: Entry } | { kind: "tools"; key: string; tools: Tool[] }
/** One exchange: what the user said, what Claude did (`work`, folded once it's done), what came of it on the way (asks,
 *  notes), and its answer (`tail`: the words after its last call, and what came after them). */
export type Turn = { key: string; user: User | null; work: Row[]; rest: Row[]; tail: Row[]; ms: number; last: Entry | null
  /** Its end came (a result): what works next is a turn not drawn yet. */
  ended: boolean }

/** The entries as turns. Tool calls in a row are one run; a subagent's steps go under the call that runs it (`kids`).
 *  What's drawn elsewhere (`away`: an ask docked by the composer, a queued message) is left out, a call with its ask. */
export function layout(entries: Entry[], away: Set<string>): { turns: Turn[]; kids: Map<string, Entry[]> } {
  const kids = new Map<string, Entry[]>(), have = new Set(entries.map((e) => e.id))
  for (const e of entries) if ("parent" in e && e.parent) kids.set(e.parent, [...(kids.get(e.parent) ?? []), e])
  const groups: { user: User | null; items: Entry[] }[] = []
  for (const e of entries) {
    if (("parent" in e && e.parent) || away.has(e.id)) continue
    if (e.k === "user") { groups.push({ user: e, items: [] }); continue }
    if (!groups.length) groups.push({ user: null, items: [] })
    if (e.k === "tool" && (e.name === "AskUserQuestion" || e.name === "ExitPlanMode")) {
      // (its ask is drawn; read back from a transcript, it's said how it was answered)
      if (!have.has(`ask:${e.id}`) && e.result !== undefined) groups[groups.length - 1].items.push(askOf(e))
      continue
    }
    if (e.k === "tool" && away.has(`ask:${e.id}`)) continue
    groups[groups.length - 1].items.push(e)
  }
  const turns = groups.map(({ user, items }): Turn => {
    const rows: Row[] = []
    let ms = 0
    for (const e of items) {
      const prev = rows[rows.length - 1]
      if (e.k === "result") ms += e.ms
      if (e.k === "tool") {
        if (prev?.kind === "tools") prev.tools.push(e)
        else rows.push({ kind: "tools", key: e.id, tools: [e] })
      } else if (!(e.k === "result" && e.ok)) rows.push({ kind: "one", e })
    }
    const isWork = (r: Row) => r.kind === "tools" || r.e.k === "thinking"
    let end = -1
    rows.forEach((r, n) => { if (isWork(r)) end = n })
    const before = rows.slice(0, end + 1)
    const last = items[items.length - 1] ?? null
    // (a turn read back without its result: from its message to its last entry)
    if (!ms && user) ms = Math.max(0, ...items.map((e) => Date.parse(e.at) - Date.parse(user.at)).filter((n) => n > 0))
    return { key: user?.id ?? `from:${items[0]?.id ?? ""}`, user, work: before.filter((r) => isWork(r) || (r.kind === "one" && r.e.k === "text")),
      rest: before.filter((r) => !isWork(r) && !(r.kind === "one" && r.e.k === "text")), tail: rows.slice(end + 1), ms: Math.max(0, ms), last, ended: items.some((e) => e.k === "result") }
  })
  return { turns, kids }
}

/** A question or plan read back from a transcript, as the line an answered ask is. */
export function askOf(t: Tool): Ask {
  const i = (t.input ?? {}) as { questions?: { question?: string }[] }
  const question = t.name === "AskUserQuestion" ? i.questions?.map((q) => q.question).filter(Boolean).join(" ") || "Claude asked" : "Claude had a plan"
  const answers = [...(t.result ?? "").matchAll(/"[^"]*"="([^"]*)"/g)].map((m) => m[1])
  const answer = t.error ? (t.name === "ExitPlanMode" ? "Kept planning" : "Not answered") : t.name === "ExitPlanMode" ? "Approved" : answers.length ? `Answered: ${answers.join("; ")}` : "Answered"
  return { k: "ask", id: `ask:${t.id}`, kind: t.name === "ExitPlanMode" ? "plan" : "question", tool: t.name, title: question, answer, at: t.at }
}

/** How long it took, short: 5s, 1m 12s, 2h 3m. */
export const took = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

type TurnProps = { t: Turn; kids: Map<string, Entry[]>; live: boolean; id: string; pending: Ask[]; Message?: Driven["Message"]; status?: ReactNode }

/** A turn: once done, its work is one quiet line ("Worked for 1m 12s") that opens it; live, its calls show as they run
 *  and its status stays under it. */
export function TurnView({ t, kids, live, id, pending, Message, status }: TurnProps) {
  const x = useContext(TranscriptOf)
  const fold = `work:${t.key}`
  const open = x.isOpen(fold, live)
  // (the turn just ended: its work folds away on its own, slowly)
  const was = useRef(live)
  const ending = was.current && !live
  useEffect(() => { was.current = live }, [live])
  const tools = t.work.flatMap((r) => (r.kind === "tools" ? r.tools : []))
  const lines = tools.reduce((s, c) => { const d = changed(c); return d ? [s[0] + d[0], s[1] + d[1]] : s }, [0, 0])
  const failed = tools.filter((c) => c.error).length
  // (a thought still being thought is the status line's; drawn here once it's whole)
  const one = (r: Row) => r.kind === "tools"
    ? <Run key={r.key} run={r} kids={kids} live={live} />
    : live && r.e.k === "thinking" && r.e.live ? null
    : <Enter key={r.e.id} id={r.e.id}><EntryView e={r.e} id={id} pending={pending.some((p) => p.id === r.e.id)} Message={Message} /></Enter>
  return (
    <div className="flex flex-col gap-3" data-turn={live ? "live" : "done"}>
      {t.user && <Enter id={t.user.id}><EntryView e={t.user} id={id} pending={false} Message={Message} /></Enter>}
      {t.work.length > 0 && (
        <div data-work={open ? "open" : "closed"}>
          {/* (as a turn ends its line eases in while its work eases out: what's below moves once, smoothly) */}
          <Reveal open={!live} slow>
            <div className="pb-1.5">
              <button type="button" onClick={() => x.toggle(fold, live)} aria-expanded={open}
                className="chat-row chat-small -mx-1.5 flex h-7 max-w-full cursor-pointer items-center gap-1.5 rounded-control px-1.5 text-muted-foreground hover:text-foreground max-md:h-9">
                <span>{t.ms ? `Worked for ${took(t.ms)}` : "Worked"}</span>
                {(lines[0] > 0 || lines[1] > 0) && <Counts plus={lines[0]} minus={lines[1]} />}
                {failed > 0 && <span className="text-ink-(--red)">{failed} failed</span>}
                <Chevron open={open} />
              </button>
            </div>
          </Reveal>
          <Reveal open={open} slow={ending}>
            <div className="flex flex-col gap-3 pb-1 max-md:gap-2">{t.work.map(one)}</div>
          </Reveal>
        </div>
      )}
      {t.rest.map(one)}
      {t.tail.map(one)}
      {/* (closer to what's above it than a paragraph is: it's about that) */}
      {status && <Enter id={`status:${t.key}`} delay={160} className="-mt-4">{status}</Enter>}
    </div>
  )
}

// (chat.css: the chat's text sizes, its Markdown's code and spacing, the caret, rows)
const PROSE = "chat-prose"
const CARET = "chat-caret"

/** Text as it streams: the words come in a few letters a frame, catching up with what's arrived, so it flows rather
 *  than jumping a chunk at a time. Drawn whole at once when things are kept still. */
function useFlow(text: string, live: boolean) {
  const [n, setN] = useState(text.length)
  const len = text.length
  useEffect(() => {
    if (n >= len) { if (n > len) setN(len); return }
    if (!moves()) { setN(len); return }
    const f = requestAnimationFrame(() => setN((k) => Math.min(len, k + Math.max(1, Math.ceil((len - k) / (live ? 9 : 4))))))
    return () => cancelAnimationFrame(f)
  }, [n, len, live])
  if (n >= len) return text
  // (whole words only: a half-written word or mark ("**", "`") would flash raw)
  const cut = text.slice(0, n), sp = cut.search(/\s\S*$/)
  return sp > 0 ? cut.slice(0, sp) : cut
}

function Words({ text, live }: { text: string; live: boolean }) {
  const shown = useFlow(text, live)
  const writing = live || shown.length < text.length
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !writing) return
    const place = () => {
      const was = el.querySelector("[data-caret]")
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent?.trim() && !n.parentElement?.closest(".md-code-head, [data-caret]") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) })
      let end: Node | null = null
      while (walk.nextNode()) end = walk.currentNode
      if (!end?.parentNode || (was && was.previousSibling === end)) return
      was?.remove()
      const dot = document.createElement("span")
      dot.dataset.caret = ""
      dot.className = CARET
      end.parentNode.insertBefore(dot, end.nextSibling)
    }
    place()
    // (the Markdown draws its code's colours after this: the dot goes back after its last letter)
    const mo = new MutationObserver(() => { if (!el.querySelector("[data-caret]")) place() })
    mo.observe(el, { childList: true, subtree: true })
    return () => { mo.disconnect(); el.querySelector("[data-caret]")?.remove() }
  }, [shown, writing])
  return <div ref={ref} data-entry="text" data-live={writing || undefined}><Markdown text={shown} className={PROSE} /></div>
}

function UserMessage({ e, Message }: { e: User; Message?: Driven["Message"] }) {
  const [big, setBig] = useState<number | null>(null)
  return (
    <div className="flex flex-col items-end gap-1.5" data-entry="user">
      {!!e.images?.length && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5" data-images>
          {e.images.map((im, n) => (
            <button key={n} type="button" onClick={() => setBig(big === n ? null : n)} aria-label={big === n ? "Show smaller" : "Show larger"}
              className="cursor-zoom-in overflow-hidden rounded-card border-[0.5px] border-border bg-muted" aria-pressed={big === n}>
              <img src={im.src} alt="" draggable={false} className={cn("chat-thumb block object-cover", big === n ? "h-auto max-h-[60vh] max-w-full" : "h-24 max-w-40")} />
            </button>
          ))}
        </div>
      )}
      {e.text.trim() && (
        <div className="max-w-[85%] min-w-0 rounded-[18px] bg-muted px-3.5 py-2 select-text">
          {Message ? <Suspense fallback={<Markdown text={e.text} className={PROSE} />}><Message text={e.text} /></Suspense> : <Markdown text={e.text} className={PROSE} />}
        </div>
      )}
    </div>
  )
}

export function EntryView({ e, id, pending, Message }: { e: Entry; id: string; pending: boolean; Message?: Driven["Message"] }) {
  switch (e.k) {
    case "user": return <UserMessage e={e} Message={Message} />
    case "text": return <Words text={e.text} live={!!e.live} />
    case "thinking": return <Thinking e={e} />
    case "ask": return <AskCard e={e} id={id} pending={pending} />
    case "result": return <Note tone="error" text={e.error ?? "It stopped"} />
    case "note": return <Note tone={e.tone} text={e.text} />
    default: return null
  }
}

function Thinking({ e }: { e: Extract<Entry, { k: "text" | "thinking" }> }) {
  const x = useContext(TranscriptOf)
  const open = x.isOpen(e.id, false)
  const gist = e.text.replace(/[`*#>]|\*\*/g, "").replace(/\s+/g, " ").trim()
  return (
    <div data-entry="thinking">
      <button type="button" onClick={() => x.toggle(e.id, false)} aria-expanded={open} className={ROW}>
        <Brain className={ICON} strokeWidth={2} />
        {/* (live, the status line says it's thinking: here only what it thinks) */}
        {!e.live && <span data-verb className="shrink-0 font-medium text-foreground/80">Thought</span>}
        <span className={cn("min-w-0 truncate text-muted-foreground", e.live && "italic")}>{gist || "…"}</span>
        <Chevron open={open} />
      </button>
      <Reveal open={open}>
        <div className="pt-1 pb-1 pl-[30px] max-md:pl-0">
          <div className="chat-rule pl-3 text-muted-foreground"><Markdown text={e.text} className="chat-think min-w-0 break-words" /></div>
        </div>
      </Reveal>
    </div>
  )
}

export function Note({ text, tone }: { text: string; tone?: "error" }) {
  return (
    <div data-entry="note" className={cn("chat-small chat-lines flex items-start gap-2", tone === "error" ? "text-ink-(--red)" : "justify-center text-muted-foreground")}>
      {tone === "error" && <CircleAlert className="mt-[3px] size-3.5 shrink-0" strokeWidth={2.25} />}
      <span className="min-w-0 break-words whitespace-pre-wrap select-text">{text}</span>
    </div>
  )
}

// ---------- what a live turn is doing

const GERUND: Record<string, string> = { Read: "Reading", Edit: "Editing", MultiEdit: "Editing", Write: "Writing", NotebookEdit: "Editing", Grep: "Searching for", Glob: "Finding",
  WebFetch: "Fetching", WebSearch: "Searching the web for", Agent: "Delegating", Task: "Delegating", TodoWrite: "Planning", Bash: "Running", PowerShell: "Running", LS: "Listing" }

/** Its one line from send to finish: thinking (its latest words), writing, running a call (which), waiting for the user;
 *  how long so far. */
export function Status({ entries, since, state, asking }: { entries: Entry[]; since: number; state: string; asking: boolean }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => { if (!document.hidden) tick((n) => n + 1) }, 1000); return () => clearInterval(t) }, [])
  const x = useContext(TranscriptOf)
  const last = entries.at(-1)
  const call = [...entries].reverse().find((e): e is Tool => e.k === "tool" && e.result === undefined && !e.parent)
  const word = state === "starting" ? "Starting" : asking || state === "waiting" ? "Waiting for you"
    : last && "live" in last && last.live && last.k === "text" && !last.parent ? "Writing"
    : call ? [GERUND[call.name] ?? `Running ${toolName(call.name)}`, target(call, x.cwd, x.home, true)].filter(Boolean).join(" ")
    : "Thinking"
  // (what it's thinking, as it thinks it: the line's end, the latest words in sight)
  const thought = word === "Thinking" && last?.k === "thinking" && last.live && !last.parent ? last.text.replace(/[`*#>_]/g, "").replace(/\s+/g, " ").trim().slice(-160) : ""
  return (
    <div className="chat-small flex h-7 min-w-0 items-center gap-2 text-muted-foreground" data-working={state} aria-live="polite">
      <ClaudeIcon className={cn("size-4 shrink-0", !asking && state !== "waiting" && "chat-mark animate-spin")} style={{ color: TINT }} />
      <span className={cn("text-foreground/75", thought ? "shrink-0" : "min-w-0 truncate")}>{word}</span>
      {thought && <span className="chat-tail min-w-0 truncate italic" data-thought><bdi>{thought}</bdi></span>}
      <span className="shrink-0 text-tertiary tabular-nums">{took(Date.now() - since)}</span>
    </div>
  )
}

// ---------- tool calls

const TOOL_ICONS: Record<string, typeof Wrench> = { Bash: SquareTerminal, PowerShell: SquareTerminal, Read: FileText, Write: FilePlus, Edit: Pencil, MultiEdit: Pencil,
  NotebookEdit: Pencil, Grep: Search, Glob: Search, WebFetch: Globe, WebSearch: Globe, Agent: Bot, Task: Bot, TodoWrite: ListTodo, LS: Folder }
const NAMES: Record<string, string> = { Task: "Agent", TodoWrite: "Todos", WebFetch: "Fetch", WebSearch: "Web search", NotebookEdit: "Edit notebook", MultiEdit: "Edit", LS: "List" }
const toolName = (n: string) => (n.startsWith("mcp__") ? n.split("__").slice(2).join(" ").replace(/_/g, " ") || n : NAMES[n] ?? n)

const ROW = "chat-row chat-small flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-control px-1.5 -mx-1.5 box-content text-left max-md:h-9"
const ICON = "size-3.5 shrink-0 text-muted-foreground max-md:size-4"
const Chevron = ({ open }: { open: boolean }) => (
  <ChevronRight data-chevron className={cn("size-3.5 shrink-0 text-tertiary transition-transform duration-(--motion) ease-(--ease-out)", open && "rotate-90")} strokeWidth={2.5} />
)
const Counts = ({ plus, minus }: { plus: number; minus: number }) => (
  <span className="chat-count shrink-0 tabular-nums"><span className="text-ink-(--green)">+{plus}</span> <span className="text-ink-(--red)">−{minus}</span></span>
)

/** A path as the session sees it: inside its folder, from there. */
const rel = (p: string, cwd: string, h?: string) => (cwd && p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : home(p, h))
const lineCount = (s: string) => (s ? s.replace(/\n$/, "").split("\n").length : 0)

/** What a call is about, short: a path from the session's folder, a command, a pattern; `brief` for the status line. */
function target(t: Tool, cwd: string, h?: string, brief = false): string {
  const i = (t.input ?? {}) as Record<string, unknown>
  const path = str(i.file_path) || str(i.notebook_path) || str(i.path)
  if (t.name === "Bash" || t.name === "PowerShell") return brief ? str(i.command).split("\n")[0].slice(0, 48) || t.summary : str(i.description) || str(i.command).split("\n")[0] || t.summary
  if (t.name === "Grep") return brief ? str(i.pattern) : [str(i.pattern), str(i.path) && `in ${rel(str(i.path), cwd, h)}`, str(i.glob) && `(${str(i.glob)})`].filter(Boolean).join(" ")
  if (t.name === "Glob") return str(i.pattern) + (str(i.path) && !brief ? ` in ${rel(str(i.path), cwd, h)}` : "")
  if (t.name === "WebFetch") { try { return new URL(str(i.url)).host } catch { return str(i.url) } }
  if (t.name === "Agent" || t.name === "Task") return str(i.description) || t.summary
  if (t.name === "TodoWrite") return ""
  if (path) return brief ? (rel(path, cwd, h).split("/").pop() ?? path) : rel(path, cwd, h)
  return t.summary
}
const isCommand = (t: Tool) => (t.name === "Bash" || t.name === "PowerShell") && !str((t.input as Record<string, unknown>)?.description)
const isPathy = (t: Tool) => !!["Read", "Edit", "MultiEdit", "Write", "NotebookEdit", "Grep", "Glob", "LS"].includes(t.name)

/** An edit's lines added and taken away (lines only in the new text, only in the old), or null for other calls. */
function changed(t: Tool): [number, number] | null {
  const i = (t.input ?? {}) as Record<string, unknown>
  if (t.name === "Write" && typeof i.content === "string") return [lineCount(i.content), 0]
  if (t.name !== "Edit" && t.name !== "MultiEdit") return null
  const edits = Array.isArray(i.edits) ? (i.edits as Record<string, unknown>[]) : [i]
  let plus = 0, minus = 0
  for (const x of edits) {
    const a = str(x.old_string).split("\n"), b = str(x.new_string).split("\n")
    const left = new Map<string, number>()
    for (const l of a) left.set(l, (left.get(l) ?? 0) + 1)
    for (const l of b) { const n = left.get(l) ?? 0; if (n) left.set(l, n - 1); else plus++ }
    for (const n of left.values()) minus += n
  }
  return [plus, minus]
}

/** What came of a call, in a few words: +2 −1, 42 passed, exit 1, 120 lines, 3 matches. */
function outcome(t: Tool, kids: Entry[]): { text: string; tone?: "red" } | { plus: number; minus: number } | null {
  const r = t.result ?? ""
  if (t.result === undefined) {
    const step = [...kids].reverse().find((k): k is Tool => k.k === "tool")
    return step ? { text: `${toolName(step.name)} ${step.summary}`.slice(0, 60) } : null
  }
  const d = changed(t)
  if (d && !t.error) return { plus: d[0], minus: d[1] }
  if (t.name === "Bash" || t.name === "PowerShell") {
    const fails = /(?:ℹ\s*fail|\bfailed:?|failing)\s*(\d+)|(\d+)\s+(?:tests?\s+)?(?:failed|failing)/i.exec(r)
    const failN = fails ? Number(fails[1] ?? fails[2]) : 0
    if (t.error) { const code = /exit code (\d+)/i.exec(r); return { text: failN ? `${failN} failed` : code ? `exit ${code[1]}` : "failed", tone: "red" } }
    const pass = /(?:ℹ\s*pass|\bpassed:?)\s*(\d+)|(\d+)\s+(?:tests?\s+)?pass(?:ed|ing)?\b/i.exec(r)
    if (failN) return { text: `${failN} failed`, tone: "red" }
    if (pass) return { text: `${pass[1] ?? pass[2]} passed` }
    return r.trim() ? null : { text: "no output" }
  }
  if (t.error) return { text: "failed", tone: "red" }
  if (t.name === "Read") return r === "(image)" ? { text: "image" } : { text: plural(lineCount(r), "line") }
  if (t.name === "Grep") {
    if (/^No (matches|files) found/i.test(r) || !r.trim()) return { text: "no matches" }
    const found = /^Found (\d+) (file|line)/i.exec(r)
    return { text: found ? plural(Number(found[1]), found[2].toLowerCase()) : plural(lineCount(r), "match", "matches") }
  }
  if (t.name === "Glob") return /^No files found/i.test(r) || !r.trim() ? { text: "no files" } : { text: plural(lineCount(r), "file") }
  if (t.name === "Agent" || t.name === "Task") { const n = kids.filter((k) => k.k === "tool").length; return n ? { text: plural(n, "step") } : null }
  if (t.name === "TodoWrite") {
    const todos = ((t.input as { todos?: { status?: string }[] })?.todos ?? [])
    return todos.length ? { text: `${todos.filter((x) => x.status === "completed").length} of ${todos.length} done` } : null
  }
  return null
}

/** A run of calls, one row each. A long one in a live turn keeps to a few rows' height, the newest in sight and the rest
 *  fading above (no fold of its own: a turn's work is the one fold). */
function Run({ run, kids, live }: { run: Extract<Row, { kind: "tools" }>; kids: Map<string, Entry[]>; live: boolean }) {
  const list = useRef<HTMLDivElement>(null)
  const capped = live && run.tools.length >= 6
  useLayoutEffect(() => { const el = list.current; if (el && capped) el.scrollTop = el.scrollHeight }, [run.tools.length, capped])
  return (
    <div ref={list} data-run={run.tools.length} className={cn("chat-run flex flex-col", capped && "chat-capped overflow-y-auto overscroll-contain edge-fade-y")}>
      {run.tools.map((t) => <Enter key={t.id} id={t.id}><ToolRow t={t} kids={kids.get(t.id) ?? []} live={live} /></Enter>)}
    </div>
  )
}

const Spinner = () => <LoaderCircle className={cn(ICON, "chat-spin animate-spin")} strokeWidth={2.25} aria-label="Running" />

export function ToolRow({ t, kids, live }: { t: Tool; kids: Entry[]; live: boolean }) {
  const x = useContext(TranscriptOf)
  const open = x.isOpen(t.id, false)
  const Icon = TOOL_ICONS[t.name] ?? Wrench
  const running = live && t.result === undefined
  const stopped = !live && t.result === undefined
  const what = target(t, x.cwd, x.home)
  const out = outcome(t, kids)
  return (
    <div data-tool={t.name} data-state={running ? "running" : t.error ? "failed" : stopped ? "stopped" : "done"}>
      <button type="button" onClick={() => x.toggle(t.id, false)} aria-expanded={open} className={ROW}>
        {running ? <Spinner /> : t.error ? <CircleAlert className={cn(ICON, "text-ink-(--red)")} strokeWidth={2.25} aria-label="Failed" /> : <Icon className={ICON} strokeWidth={2} />}
        <span data-verb className={cn("shrink-0 font-medium text-foreground/80", running && "shimmer")}>{toolName(t.name)}</span>
        {what && <span data-what className={cn("min-w-0 truncate text-muted-foreground", (isPathy(t) || isCommand(t)) && "chat-code")}>{what}</span>}
        {out && ("plus" in out ? <Counts plus={out.plus} minus={out.minus} />
          : <span className={cn("chat-fine shrink-0 truncate", out.tone === "red" ? "text-ink-(--red)" : "text-tertiary", running && "max-w-[40%]")}>{out.text}</span>)}
        {stopped && <span className="chat-fine shrink-0 text-tertiary">stopped</span>}
        <Chevron open={open} />
      </button>
      <Reveal open={open}>
        <div className="flex flex-col gap-2 pt-1 pb-2 pl-[30px] max-md:pl-0">
          <ToolBody t={t} kids={kids} live={live} />
        </div>
      </Reveal>
    </div>
  )
}

// (a box scrolls down; what's in it scrolls sideways on its own, fading where it's cut)
const BOX = "min-w-0 overflow-hidden rounded-card border-[0.5px] border-border bg-foreground/[0.025] font-mono text-[12.5px] leading-[19px] select-text max-md:text-[13px] max-md:leading-[20px]"
// (Claude Code's own words for a call that went through: nothing a person needs to read)
const SIDE = "overflow-x-auto overscroll-x-contain edge-fade-x whitespace-pre"
const BLAND = /^(The file .* has been (updated|created)( successfully)?\.?|File created successfully.*|Todos have been modified successfully.*)$/s

/** A call's box: a long one shows its start, fading, with Show all (chat.css' chat-clamp) rather than scrolling on
 *  its own or running on behind the composer. */
function Box({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [all, setAll] = useState(false)
  const [over, setOver] = useState(false)
  useLayoutEffect(() => { const el = ref.current; if (el && !all) setOver(el.scrollHeight > el.clientHeight + 2) })
  return (
    <div>
      <div className={BOX}><div ref={ref} className={cn(!all && "chat-clamp", over && !all && "chat-clamped", className)}>{children}</div></div>
      {over && !all && (
        <button type="button" onClick={() => setAll(true)} data-show-all
          className="chat-fine chat-row -mx-1.5 mt-0.5 flex h-7 cursor-pointer items-center rounded-control px-1.5 text-muted-foreground hover:text-foreground">Show all</button>
      )}
    </div>
  )
}

/** Lines of code, numbered: Read's (as `cat -n` numbers them) and a file written. */
function Numbered({ text, from = 1 }: { text: string; from?: number }) {
  const lines = text.replace(/\n$/, "").split("\n")
  const read = lines.every((l) => /^\s*\d+[→\t]/.test(l) || !l)
  const rows = read ? lines.filter(Boolean).map((l) => { const m = /^\s*(\d+)[→\t](.*)$/.exec(l)!; return [m[1], m[2]] as const }) : lines.map((l, n) => [String(from + n), l] as const)
  const w = Math.max(2, ...rows.map(([n]) => n.length))
  return (
    <Box className="py-2">
      <div className={SIDE}><div className="min-w-max">
        {rows.map(([n, l], k) => (
          <div key={k} className="flex whitespace-pre pr-3">
            <span className="shrink-0 pr-3 pl-3 text-right text-tertiary select-none" style={{ width: `calc(${w}ch + 1.5rem)` }}>{n}</span><span>{l || " "}</span>
          </div>
        ))}
      </div></div>
    </Box>
  )
}

/** What a call was given and what it gave back, framed one way per kind: a command with its output in one box, an edit
 *  as a diff, a file's lines numbered; a result only when it says something. */
function ToolBody({ t, kids, live }: { t: Tool; kids: Entry[]; live: boolean }) {
  const x = useContext(TranscriptOf)
  const i = (t.input ?? {}) as Record<string, unknown>
  const r = t.result
  const failure = t.error && r !== undefined ? <Box><pre className="px-3 py-2 whitespace-pre-wrap text-ink-(--red)">{r || "It failed"}</pre></Box> : null
  if ((t.name === "Bash" || t.name === "PowerShell") && str(i.command)) return (
    <Box>
      <pre className={cn(SIDE, "px-3 py-2")}><span className="text-tertiary select-none">$ </span>{str(i.command)}</pre>
      {r !== undefined && <pre className={cn(SIDE, "border-t-[0.5px] border-border px-3 py-2", t.error ? "text-ink-(--red)" : "text-muted-foreground")}>{r.replace(/\n+$/, "") || "(no output)"}</pre>}
    </Box>
  )
  if ((t.name === "Edit" || t.name === "MultiEdit") && (str(i.old_string) || str(i.new_string) || Array.isArray(i.edits))) {
    const edits = Array.isArray(i.edits) ? i.edits as { old_string?: string; new_string?: string }[] : [{ old_string: str(i.old_string), new_string: str(i.new_string) }]
    return <><EditDiff file="" edits={edits} />{failure}</>
  }
  if (t.name === "Write" && str(i.content)) return <><Numbered text={str(i.content).slice(0, 6000)} />{failure}</>
  if (t.name === "Read" && r && !t.error && r !== "(image)") return <Numbered text={r} />
  if (t.name === "TodoWrite" && Array.isArray(i.todos)) return (
    <ul className="chat-small space-y-1">{(i.todos as { content?: string; status?: string }[]).map((td, n) => (
      <li key={n} className="flex items-start gap-2"><span className="chat-todo size-3 shrink-0 rounded-full" data-status={td.status} />
        <span className={cn(td.status === "completed" && "text-muted-foreground line-through")}>{td.content}</span></li>))}</ul>
  )
  if (t.name === "Agent" || t.name === "Task") {
    const steps = kids.filter((k): k is Tool => k.k === "tool")
    return (
      <>
        {str(i.prompt) && <div className="chat-small chat-lines line-clamp-4 text-muted-foreground">{str(i.prompt)}</div>}
        {steps.length > 0 && <div className="chat-rule chat-steps">{steps.map((k) => <ToolRow key={k.id} t={k} kids={[]} live={live} />)}</div>}
        {r && <Box className="px-3.5 py-2.5 font-sans"><Markdown text={r} className="min-w-0 break-words" /></Box>}
      </>
    )
  }
  if ((t.name === "Grep" || t.name === "Glob") && r !== undefined) return <Box><pre className={cn(SIDE, "px-3 py-2", t.error ? "text-ink-(--red)" : "text-muted-foreground")}>{r.split("\n").map((l) => l.startsWith(x.cwd + "/") ? l.slice(x.cwd.length + 1) : l).join("\n") || "No matches"}</pre></Box>
  const input = Object.keys(i).length ? JSON.stringify(t.input, null, 2) : ""
  return (
    <>
      {input && <Box><pre className={cn(SIDE, "px-3 py-2")}>{input}</pre></Box>}
      {failure ?? (r && !BLAND.test(r.trim()) ? <Box><pre className="px-3 py-2 whitespace-pre-wrap text-muted-foreground">{r}</pre></Box> : null)}
    </>
  )
}
