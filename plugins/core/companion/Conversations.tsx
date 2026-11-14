import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react"
import { Check, Maximize2, MessagesSquare, RotateCcw, X } from "lucide-react"
import { cn, fmtAgo, HeadingButton, ink, keyHint, Loading, Markdown, notifyError, op, plural, Segmented, share, snippet, today, useFocusedFile, useKeptCount, type SidebarCtx } from "@vaultite"
import { AskLine } from "./AskLine"
import type { Exchange } from "./conversation"
import { accept, answer, getState, type Note, pick, reopen, review, subscribe, tintOf } from "./live"
import { cut, unsent } from "./overlaykit"
import { follow } from "./spots"
import { type Day, JobRow, talkOf, Turn, useOp } from "./Page"
import { Faces } from "./Presence"
import { threadsOf } from "./threads"

type Filter = "open" | "resolved"
type Tab = "talk" | "note"

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

export function ConversationsView() {
  const { path } = useFocusedFile()
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-conversations-view>
      <Conversations path={path} fit="page" />
    </div>
  )
}

type Fit = "page" | "box" | "stack"

function Conversations({ path, big, fit }: { path: string; big?: boolean; fit: Fit }) {
  const page = fit === "page"
  const s = useSyncExternalStore(subscribe, getState)
  const [filter, setFilter] = useState<Filter>("open")
  const [chosen, setChosen] = useState<{ path: string; tab: Tab } | null>(null)
  const md = /\.md$/i.test(path)
  const threads = useMemo(() => (md ? threadsOf(s.notes, path) : []), [s.notes, path, md])
  const past = usePast(path, threads)
  const resolved = useKeptCount(md ? `companion:resolved:${path}` : null, past?.length, 0)
  useEffect(() => { if (s.picked && threads.some((n) => n.id === s.picked)) { setFilter("open"); setChosen({ path, tab: "note" }) } }, [s.picked, threads, path])
  useEffect(() => { if (threads.length && chosen?.path !== path) setChosen({ path, tab: "note" }) }, [threads.length, chosen, path])
  if (s.mode === "off") return <p className="px-1.5 py-1 text-[13px] text-tertiary">The companion is off.</p>
  const tab: Tab = share ? "note" : chosen?.path === path ? chosen.tab : threads.length ? "note" : "talk"
  const list = filter === "open" ? threads : past ?? []
  return (
    <div data-companion-panel data-tab={tab} className={cn("flex flex-col gap-1.5", fit === "stack" ? "pb-1" : "min-h-0 flex-1")}>
      {!share && (
        <div className={cn(page ? "mx-auto flex w-full max-w-[44rem] items-center gap-2 px-4 pt-3 max-md:px-3" : fit === "stack" && "sticky top-7 z-[1] bg-sidebar pt-1 pb-1.5")}>
          <Segmented label="Conversation" value={tab} onChange={(t) => setChosen({ path, tab: t })} className={page ? "w-[15rem] max-md:flex-1" : "mx-0.5"} big={page} small={!page && !big}
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

const RECENT = 6

function Talk({ fit }: { fit: Fit }) {
  const day = today()
  const { data, error, again } = useOp<Day>("companion.conversation", { day })
  const name = useSyncExternalStore(subscribe, () => getState().name)
  const shown = data?.day === day ? data : null
  const items = talkOf(shown, day)
  const [sent, setSent] = useState<{ t: number; text: string }[]>([])
  const pending = sent.filter((x) => Date.now() - x.t < 60_000 && !shown?.exchanges.some((e) => e.t >= x.t - 5000 && e.text.trim() === x.text))
  const box = useRef<HTMLDivElement>(null)
  useAtEnd(box, `${items.length}:${items.at(-1)?.e?.said.length ?? 0}:${pending.length}`, fit === "stack")
  const earlier = fit === "stack" ? Math.max(0, items.length - RECENT) : 0
  const asked = (text: string): Exchange => ({ t: Date.now(), seq: -1, kind: "ask", text, where: "", voice: false, summoned: false, said: [], did: [] })
  const talk = !shown ? <Loading className="px-0.5 text-[13px] leading-[18px]" error={error ? "Couldn't read the companion's talk." : undefined} />
    : !items.length && !pending.length ? <p className="px-0.5 text-[13px] text-tertiary">Nothing yet today.</p>
    : items.slice(earlier).map((x) => (x.e ? <Turn key={`e${x.e.seq}-${x.e.t}`} e={x.e} compact /> : <JobRow key={`j${x.j.id}`} j={x.j} />))
  const sentNow = (text: string) => { setSent((s) => [...s.slice(-4), { t: Date.now(), text }]); again() }
  if (fit === "page") return (
    <div data-companion-talk className="flex min-h-0 flex-1 flex-col">
      <div ref={box} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-[44rem] flex-col gap-6 px-5 pt-4 pb-8 max-md:px-4">
          <div className="text-center text-[11.5px] font-medium text-muted-foreground">Today</div>
          {talk}
          {pending.map((x) => <Turn key={`p${x.t}`} e={{ ...asked(x.text), t: x.t }} compact />)}
        </div>
      </div>
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
      <div ref={box} className={cn("flex flex-col gap-4 px-1 pt-1 pb-4", fit === "box" && "min-h-0 flex-1 overflow-y-auto overscroll-contain")}>
        {earlier > 0 && <button type="button" data-companion-earlier className="cursor-pointer self-center rounded-[6px] px-2 py-0.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={openPage}>{plural(earlier, "earlier turn")}</button>}
        {talk}
        {pending.map((x) => <Turn key={`p${x.t}`} e={{ ...asked(x.text), t: x.t }} compact />)}
      </div>
      <AskLine name={name} compact className="px-0.5" onSent={sentNow} />
    </div>
  )
}

const openPage = () => void op("companion.page").catch((e) => notifyError(e, "Couldn't open its page"))
const OpenPage = () => (
  <HeadingButton icon={Maximize2} label="Open the Companion page" className="max-sm:size-8" data-companion-open-page onClick={openPage} />
)

function useAtEnd(ref: RefObject<HTMLDivElement | null>, key: string, outer = false) {
  const end = useRef(true)
  const scroller = () => { const el = ref.current; return el && outer ? scrollerOf(el) : el }
  const below = (sc: HTMLElement, el: HTMLElement) => outer ? (el.closest("[data-companion-talk]") ?? el).getBoundingClientRect().bottom - sc.getBoundingClientRect().bottom
    : sc.scrollHeight - sc.scrollTop - sc.clientHeight
  useEffect(() => {
    const sc = scroller(), el = ref.current
    if (!sc || !el) return
    const on = () => { end.current = below(sc, el) < 48 }
    sc.addEventListener("scroll", on, { passive: true })
    const ro = new ResizeObserver(() => { if (end.current) sc.scrollTop += Math.max(0, below(sc, el)) })
    ro.observe(sc)
    return () => { sc.removeEventListener("scroll", on); ro.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- it subscribes again only when outer changes
  }, [outer])
  useLayoutEffect(() => {
    const sc = scroller(), el = ref.current
    if (sc && el && end.current) sc.scrollTop += Math.max(0, below(sc, el))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- it scrolls only when key changes
  }, [key])
}

function scrollerOf(el: HTMLElement) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY
    if (y === "auto" || y === "scroll") return p
  }
  return null
}

function Filters({ filter, setFilter, open, resolved }: { filter: Filter; setFilter: (f: Filter) => void; open: number; resolved: number }) {
  return <Segmented label="Show" value={filter} onChange={setFilter} small className="shrink-0"
    options={[{ value: "open", label: "Open", count: open, attrs: { "data-filter": "open" } }, { value: "resolved", label: "Resolved", count: resolved, attrs: { "data-filter": "resolved" } }]} />
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
  const btn = "grid size-6 shrink-0 cursor-pointer place-items-center rounded-control text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground max-sm:size-9"
  const verb = suggestion ? "suggests" : proposal ? (ready ? `proposes ${plural(ready, "change", "changes")}` : "is writing") : ""
  const where = resolved && n.dismissed ? fmtAgo(new Date(n.dismissed).toISOString()) : n.line ? `line ${n.line}${n.orphaned ? ", its text was removed" : ""}` : ""
  const primary = "flex h-7 cursor-pointer items-center gap-1 rounded-control px-2.5 text-[12.5px] font-semibold text-white max-sm:h-9"
  return (
    <div ref={ref} data-companion-thread={n.id} data-picked={picked || undefined} tabIndex={0} aria-label={`${n.agent}'s ${n.kind}${n.line ? `, line ${n.line}` : ""}`}
      onClick={(e) => { if (!(e.target instanceof Element && e.target.closest("button, input, a"))) go() }}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) go() }}
      className={cn("flex cursor-pointer flex-col gap-1.5 rounded-card border bg-card px-2.5 pt-2 pb-2.5 text-[13px] leading-snug outline-none transition-[border-color,box-shadow]",
        picked ? "border-transparent" : "border-border/50 hover:border-border focus-visible:border-border", resolved && "opacity-70")}
      style={picked ? { boxShadow: `0 0 0 1.5px color-mix(in srgb, ${tint} 65%, transparent), 0 4px 14px rgb(0 0 0 / .08)` } : undefined}>
      <div className="flex min-h-6 items-center gap-2">
        <Initial name={n.agent} tint={tint} />
        <span className="min-w-0 flex-1 truncate text-[12.5px]">
          <span className="font-semibold">{n.agent}</span>{verb && <span className="text-muted-foreground"> {verb}</span>}
          {where && <span className="text-tertiary"> · {where}</span>}
        </span>
        {resolved ? <button type="button" aria-label="Reopen" data-tip="Reopen" className={btn} onClick={() => { reopen(n.id); pick(n.id) }}><RotateCcw className="size-3.5" /></button>
          : <button type="button" aria-label={suggestion ? "Reject" : proposal ? "Reject all" : "Resolve"} data-tip={suggestion ? "Reject" : proposal ? "Reject all" : "Resolve"} className={btn}
            onClick={() => (proposal ? review(n.id, "reject") : answer(n.id, suggestion ? "reject" : "dismiss"))}>
            {suggestion || proposal ? <X className="size-3.5" /> : <Check className="size-3.5" />}
          </button>}
      </div>
      {n.find && (
        <div className="line-clamp-2 rounded-[6px] border-l-2 bg-foreground/[0.035] py-1 pr-2 pl-2 text-[12px] leading-[17px] text-muted-foreground" style={{ borderColor: tint }}>
          {suggestion ? <><span className="line-through">{cut(snippet(n.find), 120)}</span> <span className="font-medium" style={{ color: ink(tint) }}>{cut(snippet(n.replace ?? ""), 120)}</span></> : cut(snippet(n.find), 160)}
        </div>
      )}
      {n.text && <Markdown text={n.text} className="companion-md px-0.5" />}
      {n.replies?.map((r, i) => (
        <div key={i} className="flex gap-2 border-t border-border/50 pt-1.5">
          <Initial name={r.by === "user" ? "You" : n.agent} tint={r.by === "user" ? "var(--muted-foreground)" : tint} />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold">{r.by === "user" ? "You" : n.agent}</div>
            <Markdown text={r.text} className="companion-md" />
          </div>
        </div>
      ))}
      {!resolved && suggestion && (
        <div className="flex gap-1.5 pt-0.5">
          <button type="button" className={primary} style={{ background: tint }} onClick={() => void accept(n)}>
            <Check className="size-3.5" strokeWidth={2.5} />Accept<span className="opacity-70 [@media(pointer:coarse)]:hidden">{keyHint("Tab")}</span>
          </button>
        </div>
      )}
      {!resolved && proposal && ready > 0 && (
        <div className="flex gap-1.5 pt-0.5">
          <button type="button" className={primary} style={{ background: tint }} onClick={() => review(n.id, "accept")}>
            <Check className="size-3.5" strokeWidth={2.5} />Accept all
          </button>
        </div>
      )}
      {!resolved && !suggestion && !proposal && picked && (
        <input autoFocus={!big()} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Reply" enterKeyHint="send" aria-label="Reply"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); send() } else if (e.key === "Escape") { e.preventDefault(); pick(null) } }}
          className="h-7 rounded-control border border-border bg-background px-2 text-[13px] outline-none focus:border-foreground/30 max-sm:h-11 max-sm:text-[17px]" />
      )}
    </div>
  )
}

const Initial = ({ name, tint }: { name: string; tint: string }) => (
  <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full text-[10.5px] font-bold text-white" style={{ background: tint }}>{name.charAt(0).toUpperCase()}</span>
)

const big = () => matchMedia("(pointer: coarse)").matches

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
