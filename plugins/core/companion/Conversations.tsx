// The Conversations panel (right sidebar, a phone's right drawer): Talk, the day's talk with the companion as a chat,
// and Comments, the focused note's threads in its order (who's around atop them; replying and resolving here).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react"
import { Check, Maximize2, MessagesSquare, RotateCcw, X } from "lucide-react"
import { cn, fmtAgo, HeadingButton, ink, keyHint, Loading, Markdown, notifyError, op, plural, Segmented, share, snippet, today, useFocusedFile, useKeptCount, type SidebarCtx } from "@vaultite"
import { AskLine } from "./AskLine"
import type { Exchange } from "./conversation"
import { accept, answer, getState, type Note, pick, reopen, review, subscribe, tintOf } from "./live"
import { cut, follow, unsent } from "./Overlay"
import { type Day, JobRow, talkOf, Turn, useOp } from "./Page"
import { Faces } from "./Presence"
import { threadsOf } from "./threads"

type Filter = "open" | "resolved"
type Tab = "talk" | "note"

/** The note's dismissed comments (kept on the server), asked again as its open ones change; null until a note's first
 *  answer (another note's aren't shown meanwhile). */
function usePast(path: string, open: Note[]) {
  const [past, setPast] = useState<{ path: string; list: Note[] } | null>(null)
  const key = open.map((n) => n.id).join()
  const off = useSyncExternalStore(subscribe, () => getState().mode === "off")
  useEffect(() => {
    if (off || !path.endsWith(".md")) return setPast({ path, list: [] })
    let live = true
    op<{ past: Note[] }>("companion.history", { path }).then((r) => live && setPast({ path, list: [...r.past].reverse() }), () => live && setPast({ path, list: [] }))
    return () => { live = false }
  }, [path, key, off])
  return past?.path === path ? past.list : null
}

export function ConversationsPanel({ open, file, phone, bounded }: SidebarCtx) {
  const last = useFocusedFile()
  if (!open) return null
  return <Conversations path={file || last.path} big={phone} fit={bounded ? "box" : "stack"} />
}

/** The tab (view:conversations, the whole pane): the threads of the file in the pane focused last, or the talk as a
 *  chat, its line at the pane's foot (its own, as a chat's: the status bar spans the other panes). */
export function ConversationsView() {
  const { path } = useFocusedFile()
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-conversations-view>
      <Conversations path={path} fit="page" />
    </div>
  )
}

/** Where it's drawn: `page` (its tab) and `box` (a panel's box of its own height): the talk scrolls above the ask line.
 *  `stack` (among the sidebar's panels): as tall as it draws, scrolled by the panel's box, never a scroller in one. */
type Fit = "page" | "box" | "stack"

function Conversations({ path, big, fit }: { path: string; big?: boolean; fit: Fit }) {
  const page = fit === "page"
  const s = useSyncExternalStore(subscribe, getState)
  const [filter, setFilter] = useState<Filter>("open")
  const [chosen, setChosen] = useState<{ path: string; tab: Tab } | null>(null)
  const md = /\.md$/i.test(path)
  const threads = useMemo(() => (md ? threadsOf(s.notes, path) : []), [s.notes, path, md])
  const past = usePast(path, threads)
  // (the Resolved count as last time while it's asked, so it doesn't come in from nothing)
  const resolved = useKeptCount(md ? `companion:resolved:${path}` : null, past?.length, 0)
  // (a thread picked from a dot or the margin's history is an open one: shown)
  useEffect(() => { if (s.picked && threads.some((n) => n.id === s.picked)) { setFilter("open"); setChosen({ path, tab: "note" }) } }, [s.picked, threads, path])
  // (a note's threads, once shown, stay when the last is resolved, not swapped for the talk)
  useEffect(() => { if (threads.length && chosen?.path !== path) setChosen({ path, tab: "note" }) }, [threads.length, chosen, path])
  if (s.mode === "off") return <p className="px-1.5 py-1 text-[13px] text-tertiary">The companion is off.</p>
  // (a note with threads shows them, else the talk; one picked stays for that note. A guest has no companion to talk to)
  const tab: Tab = share ? "note" : chosen?.path === path ? chosen.tab : threads.length ? "note" : "talk"
  const list = filter === "open" ? threads : past ?? []
  return (
    <div data-companion-panel data-tab={tab} className={cn("flex flex-col gap-1.5", fit === "stack" ? "pb-1" : "min-h-0 flex-1")}>
      {!share && (
        // (among the panels, it stays under the panel's sticky heading as the talk scrolls by)
        <div className={cn(page ? "mx-auto flex w-full max-w-[44rem] items-center gap-2 px-4 pt-3 max-md:px-3" : fit === "stack" && "sticky top-7 z-[1] bg-sidebar pb-0.5")}>
          <Segmented label="Conversation" value={tab} onChange={(t) => setChosen({ path, tab: t })} className={page ? "w-[15rem] max-md:flex-1" : "mx-0.5 mb-0.5"} big={page}
            options={[{ value: "talk", label: "Talk" }, { value: "note", label: "Comments", count: threads.length }]} />
          {page && <span className="flex-1" />}
          {page && <OpenPage />}
        </div>
      )}
      {tab === "talk" ? <Talk fit={fit} /> : <div className={cn("flex flex-col gap-1.5", page ? "mx-auto min-h-0 w-full max-w-[44rem] flex-1 overflow-y-auto px-4 pb-4 max-md:px-3"
        : fit === "box" && "min-h-0 flex-1 overflow-y-auto overscroll-contain")}>
        <div className="flex min-h-7 items-center gap-2 pl-1">
          <div className="min-w-0 flex-1"><Faces path={path} big={big} fit /></div>
          {md && <Filters filter={filter} setFilter={setFilter} open={threads.length} resolved={resolved} />}
        </div>
        {!md ? <p className="px-1.5 text-[13px] text-tertiary">Open a note to see its comments.</p>
          : filter === "resolved" && !past ? <Loading className="px-1.5 text-[13px] leading-[18px]" />
          : !list.length ? <p className="px-1.5 text-[13px] text-tertiary">{filter === "open" ? "No comments in this note." : "Nothing resolved yet."}</p>
          : list.map((n) => <Thread key={n.id} n={n} picked={s.picked === n.id} resolved={filter === "resolved"} />)}
      </div>}
    </div>
  )
}

/** Turns shown among the sidebar's panels (the rest are on the Companion page, a click away). */
const RECENT = 6

/** The day's talk with the companion, oldest first like a chat, kept at its end as new asks come; a line to ask it. */
function Talk({ fit }: { fit: Fit }) {
  const day = today()
  const { data, error, again } = useOp<Day>("companion.conversation", { day })
  const name = useSyncExternalStore(subscribe, () => getState().name)
  const tint = useSyncExternalStore(subscribe, () => tintOf(getState().name))
  const shown = data?.day === day ? data : null
  const items = talkOf(shown, day)
  // (an ask sent here shows at once, until its log has it)
  const [sent, setSent] = useState<{ t: number; text: string }[]>([])
  const pending = sent.filter((x) => Date.now() - x.t < 60_000 && !shown?.exchanges.some((e) => e.t >= x.t - 5000 && e.text.trim() === x.text))
  const box = useRef<HTMLDivElement>(null)
  useAtEnd(box, `${items.length}:${items.at(-1)?.e?.said.length ?? 0}:${pending.length}`, fit === "stack")
  // (among the panels, only the last few turns: the box around them scrolls, and a whole day would push the rest away)
  const earlier = fit === "stack" ? Math.max(0, items.length - RECENT) : 0
  const asked = (text: string): Exchange => ({ t: Date.now(), seq: -1, kind: "ask", text, where: "", voice: false, summoned: false, said: [], did: [] })
  const talk = !shown ? <Loading className="px-0.5 text-[13px] leading-[18px]" error={error ? "Couldn't read the companion's talk." : undefined} />
    : !items.length && !pending.length ? <p className="px-0.5 text-[13px] text-tertiary">Nothing yet today.</p>
    : items.slice(earlier).map((x) => (x.e ? <Turn key={`e${x.e.seq}-${x.e.t}`} e={x.e} name={name} tint={tint} compact /> : <JobRow key={`j${x.j.id}`} j={x.j} />))
  const sentNow = (text: string) => { setSent((s) => [...s.slice(-4), { t: Date.now(), text }]); again() }
  if (fit === "page") return (
    <div data-companion-talk className="flex min-h-0 flex-1 flex-col">
      <div ref={box} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-[44rem] flex-col gap-6 px-5 pt-4 pb-8 max-md:px-4">
          <div className="text-center text-[11.5px] font-medium text-muted-foreground">Today</div>
          {talk}
          {pending.map((x) => <Turn key={`p${x.t}`} e={{ ...asked(x.text), t: x.t }} name={name} tint={tint} compact />)}
        </div>
      </div>
      {/* (the pane's foot is its own, as a chat's: the status bar spans the other panes; the talk fades out under it) */}
      <AskLine name={name} onSent={sentNow} className="relative mx-auto w-full max-w-[44rem] max-md:px-3
        before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-gradient-to-t before:from-background before:to-transparent" />
    </div>
  )
  return (
    <div data-companion-talk className={cn("flex flex-col gap-1.5", fit === "box" && "min-h-0 flex-1")}>
      <div className="flex min-h-6 items-center gap-1 pr-0.5 pl-1.5">
        <span className="flex-1 text-[12px] font-semibold text-muted-foreground">Today</span>
        <OpenPage />
      </div>
      {/* (in a box of its own the talk scrolls above the ask line; among the panels it's as tall as it draws) */}
      <div ref={box} className={cn("flex flex-col gap-5 px-1 pt-1 pb-5", fit === "box" && "min-h-0 flex-1 overflow-y-auto overscroll-contain")}>
        {earlier > 0 && <button type="button" data-companion-earlier className="cursor-pointer self-center rounded-[6px] px-2 py-0.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={openPage}>{plural(earlier, "earlier turn")}</button>}
        {talk}
        {pending.map((x) => <Turn key={`p${x.t}`} e={{ ...asked(x.text), t: x.t }} name={name} tint={tint} compact />)}
      </div>
      <AskLine name={name} compact className="px-0.5" onSent={sentNow} />
    </div>
  )
}

/** The Companion page (its whole talk, day by day, and what it used), a click away. */
const openPage = () => void op("companion.page").catch((e) => notifyError(e, "Couldn't open its page"))
const OpenPage = () => (
  <HeadingButton icon={Maximize2} label="Open the Companion page" className="max-sm:size-8" data-companion-open-page onClick={openPage} />
)

/** Keeps a chat's end in sight as `key` moves, unless the user scrolled up to read. Its scroller is `ref`, or with
 *  `outer` the nearest box around it that scrolls (a sidebar panel's), where its end is the talk's (its ask line's). */
function useAtEnd(ref: RefObject<HTMLDivElement | null>, key: string, outer = false) {
  const end = useRef(true)
  const scroller = () => { const el = ref.current; return el && outer ? scrollerOf(el) : el }
  // How far the talk's end is below the scroller's (px; at most 0 when it's in sight).
  const below = (sc: HTMLElement, el: HTMLElement) => outer ? (el.closest("[data-companion-talk]") ?? el).getBoundingClientRect().bottom - sc.getBoundingClientRect().bottom
    : sc.scrollHeight - sc.scrollTop - sc.clientHeight
  useEffect(() => {
    const sc = scroller(), el = ref.current
    if (!sc || !el) return
    const on = () => { end.current = below(sc, el) < 48 }
    sc.addEventListener("scroll", on, { passive: true })
    // (a sidebar panel's box gets its height after the talk draws: at its end, it stays there)
    const ro = new ResizeObserver(() => { if (end.current) sc.scrollTop += Math.max(0, below(sc, el)) })
    ro.observe(sc)
    return () => { sc.removeEventListener("scroll", on); ro.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outer])
  useLayoutEffect(() => {
    const sc = scroller(), el = ref.current
    if (sc && el && end.current) sc.scrollTop += Math.max(0, below(sc, el))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/** The nearest box around `el` that scrolls up and down, if any. */
function scrollerOf(el: HTMLElement) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY
    if (y === "auto" || y === "scroll") return p
  }
  return null
}

/** Open / Resolved, as a small segmented control. */
function Filters({ filter, setFilter, open, resolved }: { filter: Filter; setFilter: (f: Filter) => void; open: number; resolved: number }) {
  const item = (f: Filter, label: string, n: number) => (
    <button type="button" role="radio" aria-checked={filter === f} data-filter={f} onClick={() => setFilter(f)}
      className={cn("h-5.5 cursor-pointer rounded-[5px] px-1.5 text-[12px] whitespace-nowrap transition-colors max-sm:h-8 max-sm:px-2.5",
        filter === f ? "bg-card font-semibold text-foreground shadow-[0_1px_3px_rgb(0_0_0/0.12)] dark:bg-[var(--segment-on)]" : "font-medium text-muted-foreground hover:text-foreground")}>
      {label}{n > 0 && <span className="ml-1 tabular-nums opacity-70">{n}</span>}
    </button>
  )
  return (
    <div role="radiogroup" aria-label="Show" className="flex shrink-0 rounded-[7px] bg-muted p-[2px]">
      {item("open", "Open", open)}{item("resolved", "Resolved", resolved)}
    </div>
  )
}

function Thread({ n, picked, resolved }: { n: Note; picked: boolean; resolved: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState("")
  const tint = tintOf(n.agent)
  useEffect(() => { if (picked) ref.current?.scrollIntoView({ block: "nearest" }) }, [picked])
  const go = () => { pick(n.id); follow({ name: n.agent, path: n.path, line: n.line, find: n.find }) }
  const send = () => { const t = draft.trim(); if (t && !answer(n.id, "reply", t)) return unsent(); setDraft("") }
  const suggestion = n.kind === "suggestion", proposal = n.kind === "proposal"
  const ready = (n.changes ?? []).filter((c) => !c.intent && !c.stale).length
  const btn = "grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground max-sm:size-9"
  return (
    <div ref={ref} data-companion-thread={n.id} data-picked={picked || undefined} tabIndex={0} aria-label={`${n.agent}'s ${n.kind}${n.line ? `, line ${n.line}` : ""}`}
      onClick={(e) => { if (!(e.target as Element).closest("button, input, a")) go() }}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) go() }}
      className={cn("relative flex cursor-pointer flex-col rounded-[8px] border bg-background py-1.5 pr-1.5 pl-3 text-[13px] leading-snug outline-none transition-[border-color,box-shadow]",
        picked ? "border-transparent" : "border-border/60 hover:border-border focus-visible:border-border", resolved && "opacity-70")}
      style={picked ? { boxShadow: `0 0 0 1.5px color-mix(in srgb, ${tint} 60%, transparent), 0 4px 14px rgba(0,0,0,.08)` } : undefined}>
      {/* (its colour as a straight bar clear of the rounded corners) */}
      <span aria-hidden className="absolute inset-y-2 left-[4px] w-[3px] rounded-full" style={{ background: tint }} />
      <div className="flex min-h-6 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold" style={{ color: ink(tint) }}>
          {n.agent}{suggestion ? " suggests" : proposal ? (ready ? ` proposes ${plural(ready, "change", "changes")}` : " is writing") : ""}
          <span className="ml-1.5 font-normal text-tertiary">{resolved && n.dismissed ? fmtAgo(new Date(n.dismissed).toISOString()) : n.line ? `line ${n.line}${n.orphaned ? ", its text was removed" : ""}` : ""}</span>
        </span>
        {resolved ? <button type="button" aria-label="Reopen" data-tip="Reopen" className={btn} onClick={() => { reopen(n.id); pick(n.id) }}><RotateCcw className="size-3.5" /></button>
          : <button type="button" aria-label={suggestion ? "Reject" : proposal ? "Reject all" : "Resolve"} data-tip={suggestion ? "Reject" : proposal ? "Reject all" : "Resolve"} className={btn}
            onClick={() => (proposal ? review(n.id, "reject") : answer(n.id, suggestion ? "reject" : "dismiss"))}>
            {suggestion || proposal ? <X className="size-3.5" /> : <Check className="size-3.5" />}
          </button>}
      </div>
      {n.find && (
        <div className="mb-1 line-clamp-2 border-l-2 pl-1.5 text-[12px] text-muted-foreground" style={{ borderColor: `color-mix(in srgb, ${tint} 50%, transparent)` }}>
          {suggestion ? <><span className="line-through">{cut(snippet(n.find), 120)}</span> <span className="font-medium" style={{ color: ink(tint) }}>{cut(snippet(n.replace ?? ""), 120)}</span></> : cut(snippet(n.find), 160)}
        </div>
      )}
      {n.text && <Markdown text={n.text} className="companion-md pr-1" />}
      {n.replies?.map((r, i) => (
        <div key={i} className="mt-1.5 border-t border-border/50 pt-1.5 pr-1">
          <div className="text-[12px] font-semibold text-muted-foreground" style={r.by === "user" ? undefined : { color: ink(tint) }}>{r.by === "user" ? "You" : n.agent}</div>
          <Markdown text={r.text} className="companion-md" />
        </div>
      ))}
      {!resolved && suggestion && (
        <div className="mt-1.5 flex gap-1.5">
          <button type="button" className="flex h-7 cursor-pointer items-center gap-1 rounded-[7px] px-2.5 text-[12.5px] font-semibold text-white max-sm:h-9" style={{ background: tint }} onClick={() => void accept(n)}>
            <Check className="size-3.5" strokeWidth={2.5} />Accept<span className="opacity-70 [@media(pointer:coarse)]:hidden">{keyHint("Tab")}</span>
          </button>
        </div>
      )}
      {!resolved && proposal && ready > 0 && (
        <div className="mt-1.5 flex gap-1.5">
          <button type="button" className="flex h-7 cursor-pointer items-center gap-1 rounded-[7px] px-2.5 text-[12.5px] font-semibold text-white max-sm:h-9" style={{ background: tint }} onClick={() => review(n.id, "accept")}>
            <Check className="size-3.5" strokeWidth={2.5} />Accept all
          </button>
        </div>
      )}
      {!resolved && !suggestion && !proposal && picked && (
        <input autoFocus={!big()} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Reply" enterKeyHint="send" aria-label="Reply"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); send() } else if (e.key === "Escape") { e.preventDefault(); pick(null) } }}
          className="mt-1.5 mr-0.5 h-7 rounded-[6px] border border-border bg-transparent px-2 text-[13px] outline-none focus:border-foreground/30 max-sm:h-11 max-sm:text-[17px]" />
      )}
    </div>
  )
}

/** A finger: a box focused on its own brings the keyboard up over the note. */
const big = () => matchMedia("(pointer: coarse)").matches

/** The panel's rail icon: a dot while the focused note has threads (the panel folded away in the rail). */
export function ConversationsIcon({ className, strokeWidth }: { className?: string; strokeWidth?: number }) {
  const s = useSyncExternalStore(subscribe, getState)
  const { path } = useFocusedFile()
  const mine = s.mode === "off" ? [] : s.notes.filter((n) => n.path === path && (n.kind === "comment" || n.kind === "suggestion" || n.kind === "proposal"))
  return (
    <span className={cn("relative inline-grid place-items-center", className)} data-companion-rail={mine.length || undefined}>
      <MessagesSquare className="size-full" strokeWidth={strokeWidth} />
      {mine.length > 0 && <span aria-hidden className="absolute -top-[3px] -right-[3px] size-[7px] rounded-full ring-[1.5px] ring-sidebar" style={{ background: tintOf(mine.at(-1)!.agent) }} />}
    </span>
  )
}
