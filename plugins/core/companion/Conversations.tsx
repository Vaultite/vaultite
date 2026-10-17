// The Conversations panel (the right sidebar by default, a phone's right drawer): the focused note's threads in its
// order, open or resolved, who's around atop them. One clicked lights its line; replying and resolving are here.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Check, MessagesSquare, RotateCcw, X } from "lucide-react"
import { cn, fmtAgo, keyHint, Markdown, op, snippet, useFocusedFile, type SidebarCtx } from "@vaultite"
import { accept, answer, getState, type Note, pick, reopen, subscribe, tintOf } from "./live"
import { cut, follow, inked } from "./Overlay"
import { Faces } from "./Presence"
import { threadsOf } from "./threads"

type Filter = "open" | "resolved"
/** A tint as text: mixed toward the text colour, so a yellow reads on light and a blue on dark. */

/** The note's dismissed comments (kept on the server), asked again as its open ones change. */
function usePast(path: string, open: Note[]) {
  const [past, setPast] = useState<Note[]>([])
  const key = open.map((n) => n.id).join()
  const off = useSyncExternalStore(subscribe, () => getState().mode === "off")
  useEffect(() => {
    if (off || !path.endsWith(".md")) return setPast([])
    let live = true
    op<{ past: Note[] }>("companion.history", { path }).then((r) => live && setPast([...r.past].reverse()), () => {})
    return () => { live = false }
  }, [path, key, off])
  return past
}

export function ConversationsPanel({ open, file, phone }: SidebarCtx) {
  const last = useFocusedFile()
  if (!open) return null
  return <Conversations path={file || last.path} big={phone} />
}

/** The tab (view:conversations): the threads of the file in the pane focused last. */
export function ConversationsView() {
  const { path } = useFocusedFile()
  return (
    <div className="pb-10" data-conversations-view>
      <h1 className="mb-4 truncate text-[22px] leading-[28px] font-bold max-md:hidden">Conversations</h1>
      <div data-size-up className="size-up-bleed"><Conversations path={path} /></div>
    </div>
  )
}

function Conversations({ path, big }: { path: string; big?: boolean }) {
  const s = useSyncExternalStore(subscribe, getState)
  const [filter, setFilter] = useState<Filter>("open")
  const md = /\.md$/i.test(path)
  const threads = useMemo(() => (md ? threadsOf(s.notes, path) : []), [s.notes, path, md])
  const past = usePast(path, threads)
  // (a thread picked from a dot or the margin's history is an open one: shown)
  useEffect(() => { if (s.picked && threads.some((n) => n.id === s.picked)) setFilter("open") }, [s.picked, threads])
  if (s.mode === "off") return <p className="px-1.5 py-1 text-[13px] text-tertiary">The companion is off.</p>
  const list = filter === "open" ? threads : past
  return (
    <div data-companion-panel className="flex flex-col gap-1.5 pb-1">
      <div className="flex min-h-7 items-center gap-2 pl-1">
        <div className="min-w-0 flex-1"><Faces path={path} big={big} fit /></div>
        {md && <Filters filter={filter} setFilter={setFilter} open={threads.length} resolved={past.length} />}
      </div>
      {!md ? <p className="px-1.5 text-[13px] text-tertiary">Open a note to see its conversations.</p>
        : !list.length ? <p className="px-1.5 text-[13px] text-tertiary">{filter === "open" ? "No comments in this note." : "Nothing resolved yet."}</p>
        : list.map((n) => <Thread key={n.id} n={n} picked={s.picked === n.id} resolved={filter === "resolved"} />)}
    </div>
  )
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
  const send = () => { const t = draft.trim(); if (t) answer(n.id, "reply", t); setDraft("") }
  const suggestion = n.kind === "suggestion"
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
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold" style={{ color: inked(tint) }}>
          {n.agent}{suggestion ? " suggests" : ""}
          <span className="ml-1.5 font-normal text-tertiary">{resolved && n.dismissed ? fmtAgo(new Date(n.dismissed).toISOString()) : n.line ? `line ${n.line}${n.orphaned ? ", its text was removed" : ""}` : ""}</span>
        </span>
        {resolved ? <button type="button" aria-label="Reopen" data-tip="Reopen" className={btn} onClick={() => { reopen(n.id); pick(n.id) }}><RotateCcw className="size-3.5" /></button>
          : <button type="button" aria-label={suggestion ? "Reject" : "Resolve"} data-tip={suggestion ? "Reject" : "Resolve"} className={btn} onClick={() => answer(n.id, suggestion ? "reject" : "dismiss")}>
            {suggestion ? <X className="size-3.5" /> : <Check className="size-3.5" />}
          </button>}
      </div>
      {n.find && (
        <div className="mb-1 line-clamp-2 border-l-2 pl-1.5 text-[12px] text-muted-foreground" style={{ borderColor: `color-mix(in srgb, ${tint} 50%, transparent)` }}>
          {suggestion ? <><span className="line-through">{cut(snippet(n.find), 120)}</span> <span className="font-medium" style={{ color: inked(tint) }}>{cut(snippet(n.replace ?? ""), 120)}</span></> : cut(snippet(n.find), 160)}
        </div>
      )}
      {n.text && <Markdown text={n.text} className="companion-md pr-1" />}
      {n.replies?.map((r, i) => (
        <div key={i} className="mt-1.5 border-t border-border/50 pt-1.5 pr-1">
          <div className="text-[12px] font-semibold text-muted-foreground" style={r.by === "user" ? undefined : { color: inked(tint) }}>{r.by === "user" ? "You" : n.agent}</div>
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
      {!resolved && !suggestion && picked && (
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
  const mine = s.mode === "off" ? [] : s.notes.filter((n) => n.path === path && (n.kind === "comment" || n.kind === "suggestion"))
  return (
    <span className={cn("relative inline-grid place-items-center", className)} data-companion-rail={mine.length || undefined}>
      <MessagesSquare className="size-full" strokeWidth={strokeWidth} />
      {mine.length > 0 && <span aria-hidden className="absolute -top-[3px] -right-[3px] size-[7px] rounded-full ring-[1.5px] ring-sidebar" style={{ background: tintOf(mine.at(-1)!.agent) }} />}
    </span>
  )
}
