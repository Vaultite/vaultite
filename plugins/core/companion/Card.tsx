import { memo, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Check, ChevronDown, ChevronUp, Copy, Ellipsis, MessageSquarePlus, Trash2, UserRound, X } from "lucide-react"
import { cn, commandKeys, confirmDialog, copyText, dateText, fmtStamp, keyHint, Markdown, menuBelow, menuFor, type MenuItem, plural, runCommandById, share, snippet } from "@vaultite"
import { uiElement } from "./uidom"
import { accept, answer, authorOf, comment, getState, type Note, type Reply, replyAuthor, review, startComment, threadTint, tintOf } from "./live"
import { showThread } from "./threads"
import { DRAFT, cut, proposes, sameProps, stepTo, unsent } from "./overlaykit"
import { paneBox } from "./spots"

const CLOCK = { hour: "numeric", minute: "2-digit" } as const, DAY = { day: "numeric", month: "short" } as const, YEAR = { ...DAY, year: "numeric" } as const
function when(t: number) {
  const s = (Date.now() - t) / 1000, d = new Date(t), today = new Date()
  if (s < 60) return "now"
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (d.toDateString() === today.toDateString()) return dateText(d, CLOCK)
  return dateText(d, d.getFullYear() === today.getFullYear() ? DAY : YEAR)
}

function Who({ name, tint, t, small, suffix }: { name: string; tint: string; t?: number; small?: boolean; suffix?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-1 items-center", small ? "gap-1.5" : "gap-2")}>
      <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full font-bold text-white", small ? "size-[18px] text-[9.5px]" : "size-6 text-[11px]")} style={{ background: tint }}>
        {name === "You" ? <UserRound className={small ? "size-2.5" : "size-3.5"} strokeWidth={2.75} /> : name.charAt(0).toUpperCase()}
      </span>
      <div className={cn("min-w-0 flex-1 leading-tight", small && "flex items-baseline gap-1.5")}>
        <div className="truncate text-[12.5px] font-semibold text-foreground">{name}{suffix && <span className="font-normal text-muted-foreground"> {suffix}</span>}</div>
        {t ? <div className="shrink-0 text-[11.5px] text-muted-foreground" data-tip={fmtStamp(t)}>{when(t)}</div> : null}
      </div>
    </div>
  )
}

const BTN = "grid size-6 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground [@media(pointer:coarse)]:size-9"

export const Card = memo(function Card({ n, x, y, folded, open, cap, onHeight, onOpen, onHover }: { n: Note; x: number; y: number; folded: boolean; open: boolean; cap: number
  minute: number
  onHeight: (h: number) => void; onOpen: (open: boolean) => void; onHover: (on: boolean) => void }) {
  const ref = useRef<HTMLElement | null>(null), keep = (el: HTMLElement | null) => { ref.current = el }
  const body = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  const writing = n.id === DRAFT, suggestion = n.kind === "suggestion", proposal = n.kind === "proposal"
  const [draft, setDraft] = useState(() => (writing ? getState().draft?.text ?? "" : ""))
  const tint = threadTint(n), author = writing ? (share ? share.guest : "You") : authorOf(n)
  const closes = !share || (n.by === "guest" && n.agent === share.guest)
  useLayoutEffect(() => {
    if (ref.current) onHeight(ref.current.offsetHeight)
    const b = body.current
    setMore(!open && !!b && b.scrollHeight > b.clientHeight + 2)
  })
  const replies = n.replies ?? [], had = useRef(replies.length)
  useEffect(() => { if (replies.length > had.current) body.current?.scrollTo({ top: body.current.scrollHeight }); had.current = replies.length }, [replies.length])
  if (folded && !open) {
    return (
      <button ref={keep} type="button" aria-label={`${author}'s ${n.kind}`} data-companion-dot={n.id} className="companion-fade pointer-events-auto absolute top-0 left-0 grid size-5 cursor-pointer place-items-center rounded-full shadow"
        style={{ transform: `translate(${x}px, ${y}px)`, background: tint }} onClick={() => onOpen(true)}>
        <span className="size-1.5 rounded-full bg-white" />
      </button>
    )
  }
  const send = () => {
    const t = draft.trim()
    if (writing) return t ? void (comment(t) || unsent()) : startComment(null)
    if (t && !answer(n.id, "reply", t)) return unsent()
    setDraft("")
  }
  const words = n.text ?? n.replace ?? ""
  const items = (): MenuItem[] => [
    ...(words ? [{ label: "Copy text", icon: Copy, run: () => void copyText(words) }] : []),
    ...(!share && n.by === "user" ? [{ label: "Delete", icon: Trash2, danger: true, sep: !!words, run: () => void confirmDialog({ title: "Delete this comment?", body: "It won't be kept with the resolved ones.", confirm: "Delete", danger: true })
      .then((ok) => ok && answer(n.id, "reject")) }] : []),
  ]
  const replyTint = (r: Reply) => (r.by === "agent" ? (n.by ? tintOf(r.name ?? n.ask ?? n.agent) : tint) : r.by === "guest" && r.name === n.agent ? tint : "var(--muted-foreground)")
  return (
    <div ref={keep} data-companion-note={n.id} data-open={open || undefined} onPointerDown={(e) => !open && !(e.target instanceof Element && e.target.closest("button")) && onOpen(true)}
      onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)} onContextMenu={writing ? undefined : menuFor(items)}
      className={cn("companion-pop pointer-events-auto absolute top-0 left-0 flex w-[212px] flex-col rounded-[10px] border bg-background text-[13px] leading-snug transition-[transform,box-shadow,border-color] duration-[250ms] ease-out",
        open ? "border-transparent shadow-[0_2px_6px_rgb(0_0_0/0.10),0_10px_28px_rgb(0_0_0/0.14)]" : "cursor-pointer border-border/70 shadow-[0_1px_2px_rgb(0_0_0/0.06)] hover:border-border")}
      style={{ transform: `translate(${x}px, ${y}px)`, maxHeight: cap, zIndex: open ? 2 : undefined }}>
      <div className="flex shrink-0 items-center gap-0.5 pt-2 pr-1.5 pl-2.5">
        <Who name={author} tint={tint} t={writing ? undefined : n.t} suffix={suggestion ? "suggests" : proposal ? proposes(n) : undefined} />
        {closes && !writing && <button type="button" aria-label={suggestion ? "Reject" : proposal ? "Reject all" : "Resolve"} data-tip={suggestion ? `Reject (${keyHint("Escape")})` : proposal ? "Reject all" : "Resolve"} className={BTN}
          onClick={() => (proposal ? review(n.id, "reject") : answer(n.id, suggestion ? "reject" : "dismiss"))}>
          {suggestion || proposal ? <X className="size-4" /> : <Check className="size-4" strokeWidth={2.25} />}
        </button>}
        {!writing && items().length > 0 && <button type="button" aria-label="More" data-tip="More" className={BTN} onClick={(e) => menuBelow(e, items())}><Ellipsis className="size-4" /></button>}
      </div>
      <div ref={body} className={cn("min-h-0 px-2.5", open ? "overflow-y-auto overscroll-contain" : "max-h-[62px] overflow-hidden", more && "companion-more")}>
        {n.orphaned && <div className="pt-1.5 text-[12px] text-muted-foreground">Its text was removed</div>}
        {n.text && <div className="pt-1.5 text-foreground"><Markdown text={n.text} className="companion-md" /></div>}
        {proposal && <Proposal n={n} tint={tint} />}
        {open && replies.map((r, i) => (
          <div key={i} className="mt-2 border-t border-border/50 pt-2">
            <Who small name={replyAuthor(n, r)} tint={replyTint(r)} t={r.t} />
            <div className="mt-1"><Markdown text={r.text} className="companion-md" /></div>
          </div>
        ))}
      </div>
      {!open && replies.length > 0 && <div className="shrink-0 px-2.5 pt-1 text-[12px] font-medium text-muted-foreground">{plural(replies.length, "reply", "replies")}</div>}
      {proposal && (n.changes ?? []).some((c) => !c.intent && !c.stale) && (
        <div className="flex shrink-0 items-center gap-1.5 px-2.5 pt-2">
          <button type="button" className="flex h-7 cursor-pointer items-center gap-1 rounded-[7px] px-2.5 text-[12.5px] font-semibold text-white" style={{ background: tint }} onClick={() => review(n.id, "accept")}>
            <Check className="size-3.5" strokeWidth={2.5} />Accept all
          </button>
          <span className="flex-1" />
          <button type="button" aria-label="Previous change" data-tip={`Previous change (${keyHint("Alt+[")})`} className={BTN} onClick={() => stepTo(n, -1)}><ChevronUp className="size-4" /></button>
          <button type="button" aria-label="Next change" data-tip={`Next change (${keyHint("Alt+]")})`} className={BTN} onClick={() => stepTo(n, 1)}><ChevronDown className="size-4" /></button>
        </div>
      )}
      {suggestion && (
        <div className="flex shrink-0 gap-1.5 px-2.5 pt-2">
          <button type="button" className="flex h-7 cursor-pointer items-center gap-1 rounded-[7px] px-2.5 text-[12.5px] font-semibold text-white" style={{ background: tint }} onClick={() => void accept(n)}>
            <Check className="size-3.5" strokeWidth={2.5} />Accept<span className="opacity-70">{keyHint("Tab")}</span>
          </button>
        </div>
      )}
      {n.kind === "comment" && (open || writing) ? (
        <div className="shrink-0 px-2.5 pt-2">
          <input autoFocus={writing} value={draft} onFocus={(e) => e.currentTarget.setSelectionRange(draft.length, draft.length)} onChange={(e) => setDraft(e.target.value)} placeholder={writing ? "Comment" : "Reply"} aria-label={writing ? "Comment" : "Reply"} enterKeyHint="send"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
              else if (e.key === "Escape") { e.preventDefault(); if (writing) startComment(null); else { setDraft(""); onOpen(false) } }
            }}
            onBlur={() => writing && !draft && startComment(null)}
            className="h-7 w-full rounded-[6px] border border-border bg-transparent px-2 text-[13px] outline-none focus:border-foreground/30 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:text-[17px]" />
          {(writing || draft) && (
            <div className="flex justify-end gap-1 pt-1.5">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => (writing ? startComment(null) : setDraft(""))}
                className="h-6.5 cursor-pointer rounded-[6px] px-2 text-[12.5px] font-medium text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground">Cancel</button>
              <button type="button" disabled={!draft.trim()} onClick={send}
                className="h-6.5 cursor-pointer rounded-[6px] bg-primary px-2.5 text-[12.5px] font-semibold text-primary-foreground disabled:cursor-default disabled:opacity-50">{writing ? "Comment" : "Reply"}</button>
            </div>
          )}
          <div className="h-2.5" />
        </div>
      ) : <div className="h-2.5 shrink-0" />}
    </div>
  )
}, sameProps)

function Proposal({ n, tint }: { n: Note; tint: string }) {
  const changes = n.changes ?? [], intents = changes.filter((c) => c.intent), stale = changes.filter((c) => c.stale && !c.intent)
  const ready = changes.length - intents.length - stale.length, done = (n.took ?? 0) + (n.left ?? 0)
  return (
    <div className="flex flex-col gap-1 pt-1.5 text-[12px] text-muted-foreground">
      {ready > 0 && <div data-companion-count>{done > 0 ? `${ready} of ${changes.length - intents.length + done} left` : plural(ready, "change", "changes")}</div>}
      {intents.map((c) => (
        <div key={c.id} className="flex items-center gap-1.5"><span className="companion-dots shrink-0" style={{ color: tint }}><i /><i /><i /></span><span className="min-w-0 truncate">{c.intent}</span></div>
      ))}
      {stale.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="flex-1">{stale.length === 1 ? "1 change no longer fits: its text changed" : `${stale.length} changes no longer fit: their text changed`}</span>
          <button type="button" className="cursor-pointer rounded-[5px] px-1 font-medium hover:bg-foreground/[0.07] hover:text-foreground" onClick={() => stale.forEach((c) => review(n.id, "reject", c.id))}>Leave</button>
        </div>
      )}
    </div>
  )
}

export function AddComment({ x, y }: { x: number; y: number }) {
  const keys = commandKeys("companion:comment")
  return (
    <button type="button" aria-label="Add comment" data-tip={`Add comment${keys ? ` (${keys})` : ""}`} data-companion-add onMouseDown={(e) => e.preventDefault()} onClick={() => runCommandById("companion:comment")}
      className="companion-fade pointer-events-auto absolute top-0 left-0 grid size-7 cursor-pointer place-items-center rounded-full border border-border/70 bg-background text-muted-foreground shadow-md hover:text-foreground"
      style={{ transform: `translate(${x}px, ${y}px)`, zIndex: 3 }}>
      <MessageSquarePlus className="size-4" />
    </button>
  )
}

export function PaneMark({ n }: { n: Note }) {
  const el = n.ui ? uiElement(n.ui) : null, b = el ? el.getBoundingClientRect() : paneBox(n)
  if (!b || !b.width) return null
  const over = !el && !!(b as { over?: boolean }).over, tint = tintOf(n.agent)
  return (
    <div data-companion-highlight={n.id} data-floats={over ? "" : undefined} data-under-pages={over ? undefined : ""} className="companion-fade pointer-events-none fixed rounded-[5px] z-(--z-page-float)"
      style={{ left: b.left - 3, top: b.top - 2, width: b.width + 6, height: b.height + 4, boxShadow: `0 0 0 2px ${tint}`, background: `color-mix(in srgb, ${tint} 14%, transparent)` }} />
  )
}

export function Gutter({ n, x, y, picked }: { n: Note; x: number; y: number; picked: boolean }) {
  const tint = threadTint(n)
  return (
    <button type="button" aria-label={`${authorOf(n)}'s ${n.kind}`} data-companion-gutter={n.id} data-picked={picked || undefined} data-tip={`${authorOf(n)}: ${cut(snippet(n.text ?? n.replace ?? ""), 80)}`}
      onClick={() => showThread(n.id)}
      className="companion-fade pointer-events-auto absolute top-0 left-0 grid size-5 cursor-pointer place-items-center rounded-full [@media(pointer:coarse)]:size-8"
      style={{ transform: `translate(${x}px, ${y}px) translate(-50%, -50%)` }}>
      <span className={cn("rounded-full transition-[width,height,box-shadow]", picked ? "size-2.5" : "size-2")}
        style={{ background: tint, boxShadow: picked ? `0 0 0 3px color-mix(in srgb, ${tint} 30%, transparent)` : undefined }} />
    </button>
  )
}