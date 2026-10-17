// The agents over the whole app: each one's cursor gliding to where its attention is (parked by the status bar when
// it's nowhere), its words in a bubble by it (on a drawing, only those: canvas.ts), its comments in the note's margin.
import { useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { Check, Pin, X } from "lucide-react"
import { canvasOf, canvasShown, cn, fmtTime, haptic, keyHint, Markdown, notify, openFile } from "@vaultite"
import type { EditorView } from "@codemirror/view"
import { pointFor } from "./canvas"
import { accept, type Agent, answer, getState, type Target, nearest, type Note, onBump, pick, pin, pointAt, sendMoment, subscribe, tintOf, typing, viewOf, views } from "./live"

/** low: too near the bottom of where it's drawn for its flag below it (the flag goes above); drawn: the canvas draws it. */
type Spot = { x: number; y: number; parked?: boolean; low?: boolean; drawn?: boolean }
const FLAG = 44 // the arrow and its flag below it
const MARGIN = 228 // a card's width and its gaps: less room than this beside the text and it folds to a dot

/** A target's position in its editor, or null when the text is gone. */
function posIn(v: EditorView, t: { line?: number; find?: string }) {
  const doc = v.state.doc
  if (t.find) { const i = nearest(doc.toString(), t.find, t.line); if (i >= 0) return i }
  return t.line ? doc.line(Math.max(1, Math.min(t.line, doc.lines))).from : null
}

/** Where on screen `pos` of `v` is, kept inside its scroller (a cursor at an edge says "up there"). */
function coords(v: EditorView, pos: number) {
  const r = (v.dom.closest("[data-pane]") ?? v.scrollDOM).getBoundingClientRect()
  // (what of it shows: above the status bar or a phone's bar, drawn over its foot)
  const bars = [...document.querySelectorAll("[data-status-bar], [data-phone-bar]")].map((el) => el.getBoundingClientRect()).filter((b) => b.height && b.left < r.right && b.right > r.left)
  const box = { left: r.left, right: r.right, top: r.top, bottom: Math.min(r.bottom, ...bars.map((b) => b.top)) }
  let c: { left: number; top: number; bottom: number } | null = null
  try { c = v.coordsAtPos(pos) } catch { /* outside the drawn part */ }
  const y = c ? c.top : pos < v.viewport.from ? box.top : box.bottom
  return { x: c ? c.left : box.left + 24, y: Math.max(box.top + 2, Math.min(box.bottom - 30, y)), shown: !!c && c.top >= box.top - 4 && c.bottom <= box.bottom + 4, box }
}

/** A file that isn't open: its row in the file tree, when one shows it. */
function rowOf(path: string): Spot | null {
  const el = [...document.querySelectorAll<HTMLElement>(`[data-tree-path="${CSS.escape(path)}"]`)].find((e) => e.offsetParent)
  const r = el?.getBoundingClientRect()
  return r && r.height ? { x: r.left + Math.min(r.width - 24, 120), y: r.top + 4, low: r.top + 4 + FLAG > innerHeight - 40 } : null
}

function home(i: number): Spot {
  return { x: window.innerWidth - 150 - i * 90, y: window.innerHeight - 70, parked: true, low: true }
}

/** Where an agent's cursor goes: where it types, else its target, else home. Beside the line when that's where the user
 *  is writing (their caret stays theirs) or it's talking (its words open into the space after the text). */
function spotOf(a: Agent, i: number, talking: boolean): Spot | null {
  if (a.state === "away") return null
  const canvas = a.path ? canvasOf(a.path) : null
  if (canvas && canvasShown(canvas)) {
    const p = canvas.toScreen(pointFor(canvas, a)), r = canvas.el.getBoundingClientRect()
    return { x: Math.max(r.left + 4, Math.min(r.right - 24, p.x)), y: Math.max(r.top + 4, Math.min(r.bottom - 24, p.y)), drawn: true }
  }
  if (typing && typing.agent === a.name && typing.view.dom.isConnected) {
    const c = coords(typing.view, Math.min(typing.pos, typing.view.state.doc.length))
    return { x: c.x, y: c.y, low: c.y + FLAG > c.box.bottom }
  }
  const v = a.path ? viewOf(a.path) : null
  const pos = v ? posIn(v, a) : null
  if (!v || pos === null) return (a.path && rowOf(a.path)) || home(i)
  const line = v.state.doc.lineAt(pos)
  const caret = v.state.doc.lineAt(v.state.selection.main.head).number
  if (talking || (v.hasFocus && Math.abs(caret - line.number) <= 1)) {
    const c = coords(v, line.to)
    return { x: Math.min(c.box.right - 40, c.x + 28), y: c.y, low: c.y + FLAG > c.box.bottom }
  }
  const c = coords(v, pos)
  return { x: c.x, y: c.y, low: c.y + FLAG > c.box.bottom }
}

function Arrow({ tint }: { tint: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
      <path d="M3 2.5 L16.5 9.2 L10.3 10.9 L7.6 16.8 Z" fill={tint} stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

// (CodeMirror's own scrolling, through the view's class: no CodeMirror in this chunk)
const scroller = (v: EditorView, pos: number) => v.dispatch({ effects: (v.constructor as typeof EditorView).scrollIntoView(pos, { y: "center" }) })
/** Go where an agent is (its flag, its face in the status bar): its note opened, scrolled to its line. */
export function follow(a: Target & { name: string }) {
  if (!a.path) return notify(`${a.name} isn't in a note now`)
  const path = a.path, go = () => {
    const v = viewOf(path)
    if (!v) return false
    const doc = v.state.doc, i = a.find ? nearest(doc.toString(), a.find, a.line) : -1
    scroller(v, i >= 0 ? i : doc.line(Math.max(1, Math.min(a.line ?? 1, doc.lines))).from)
    return true
  }
  if (go()) return
  openFile(path)
  let n = 0
  const t = setInterval(() => { if (go() || ++n > 40) clearInterval(t) }, 100)
}

const STATUS: Record<Agent["state"], string> = { watching: "idle", reading: "reading", thinking: "thinking", writing: "writing", away: "away" }
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches

/** Where a cursor dropped at x, y lands: a note's line (and the selection, dropped on one), or null off the text. */
function dropAt(agent: string, x: number, y: number) {
  const el = document.elementsFromPoint(x, y).find((e) => !e.closest(".companion-overlay") && e.closest(".cm-editor"))
  const v = el ? [...views.keys()].find((x) => x.dom === el.closest(".cm-editor")) : undefined
  const pos = v?.posAtCoords({ x, y })
  if (!v || pos === null || pos === undefined) return false
  const st = v.state, sel = st.selection.main, on = !sel.empty && pos >= sel.from && pos <= sel.to
  const word = on ? null : st.wordAt(pos), selection = on ? st.sliceDoc(sel.from, sel.to) : undefined
  const find = on ? selection!.split("\n")[0].slice(0, 200) : word ? st.sliceDoc(word.from, word.to) : undefined
  pointAt(agent, { path: views.get(v)!, line: st.doc.lineAt(on ? sel.from : pos).number, find: find || undefined, selection })
  return true
}

/** Clicked: its last words (each can be pinned into a comment) above a box to ask it something, there. */
function Popover({ a, left, up, close }: { a: Agent; left: number; up: boolean; close: () => void }) {
  const s = useSyncExternalStore(subscribe, getState)
  const [draft, setDraft] = useState("")
  const list = useRef<HTMLDivElement>(null)
  const mine = s.said.filter((n) => n.agent === a.name)
  useLayoutEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }) }, [mine.length])
  const send = () => {
    const text = draft.trim()
    if (!text) return
    const v = a.path ? viewOf(a.path) : null, pos = v ? posIn(v, a) : null
    sendMoment({ kind: "ask", agent: a.name, path: a.path, line: v && pos !== null ? v.state.doc.lineAt(pos).number : a.line, text })
    close()
  }
  return (
    <div data-companion-popover={a.name} className={cn("companion-pop pointer-events-auto absolute flex w-[280px] flex-col overflow-hidden rounded-[12px] border border-border/60 bg-background text-[13px] leading-snug text-foreground shadow-lg", up ? "bottom-[26px]" : "top-[42px]")}
      style={{ left, boxShadow: `0 0 0 1.5px color-mix(in srgb, ${tintOf(a.name)} 45%, transparent), 0 8px 24px rgba(0,0,0,.14)` }}>
      {mine.length > 0 && (
        <div ref={list} className="max-h-[240px] overflow-y-auto overscroll-contain px-2.5 pt-2 [scrollbar-width:thin]">
          {mine.map((n) => (
            <div key={n.id} data-said={n.id} className="group flex items-start gap-1.5 pb-2">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-muted-foreground">{fmtTime(new Date(n.t).toISOString())}</div>
                <Markdown text={n.text ?? ""} className="companion-md" />
              </div>
              {n.pinned ? <Pin className="mt-3 size-3.5 shrink-0 text-muted-foreground" aria-label="Pinned" />
                : <button type="button" aria-label="Pin as a comment" data-tip="Pin as a comment" className="mt-2 grid size-6 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground"
                  onClick={() => pin(n.id)}><Pin className="size-3.5" /></button>}
            </div>
          ))}
        </div>
      )}
      <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Ask ${a.name}`} enterKeyHint="send"
        onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); send() } else if (e.key === "Escape") { e.preventDefault(); close() } }}
        className={cn("h-9 w-full bg-transparent px-3 text-[13.5px] outline-none max-sm:h-11 max-sm:text-[17px]", mine.length > 0 && "border-t border-border/60")} />
    </div>
  )
}

function Cursor({ a, spot, said, others, under }: { a: Agent; spot: Spot; said: Note | null; others: string[]; under: boolean }) {
  const tint = `var(--${a.tint})`
  const [hover, setHover] = useState(false)
  const [nudge, setNudge] = useState<{ x: number; y: number } | null>(null)
  const [open, setOpen] = useState(false)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const at = drag ?? spot
  // (what opens beside it opens toward the room: its flag needs a little, its words more)
  const right = at.x > innerWidth - 320 && at.x > innerWidth / 2, flagRight = at.x > innerWidth - 140
  // (quiet when it's only watching: the arrow, its name once it does something; a tick when it let a moment pass)
  const idle = a.state === "watching" && !said && typing?.agent !== a.name && Date.now() - a.t > 4000
  const seen = a.state === "watching" && !!a.seen
  // (its name shows as it moves or acts, then fades to the bare arrow, as in a shared doc; hovered, again)
  const flag = Date.now() - a.t < 3000 || a.state === "thinking" || a.state === "writing" || !!said || typing?.agent === a.name || hover || open || !!drag
  const low = !drag && !!spot.low, tag = flag && (!under || hover || open)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    addEventListener("pointerdown", down, true)
    return () => removeEventListener("pointerdown", down, true)
  }, [open])
  if (spot.drawn && !said) return null
  const enter = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return
    setHover(true)
    // (a small nod toward the pointer: it noticed you)
    if (nudge || still()) return
    const dx = e.clientX - spot.x, dy = e.clientY - spot.y, d = Math.hypot(dx, dy) || 1
    setNudge({ x: (dx / d) * 3, y: (dy / d) * 3 })
    setTimeout(() => setNudge(null), 180)
  }
  // Click: the popover. Drag (a finger: hold first), then drop on text: "look at this".
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget, id = e.pointerId, x0 = e.clientX, y0 = e.clientY, touch = e.pointerType === "touch"
    el.setPointerCapture(id)
    // (a finger hides what's under it: the arrow's tip goes above it)
    const tip = (x: number, y: number) => ({ x, y: touch ? y - 40 : y })
    let dragging = false, dead = false
    const timer = touch ? setTimeout(() => { dragging = true; haptic(); setOpen(false); setDrag(tip(x0, y0)) }, 350) : null
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      if (!dragging) {
        const d = Math.hypot(ev.clientX - x0, ev.clientY - y0)
        if (touch) { if (d > 10) { dead = true; end() } return }
        if (d < 4) return
        dragging = true
        setOpen(false)
      }
      setDrag(tip(ev.clientX, ev.clientY))
    }
    const end = () => {
      if (timer) clearTimeout(timer)
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      el.removeEventListener("pointercancel", cancel)
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      end()
      if (dragging) { const p = tip(ev.clientX, ev.clientY); dropAt(a.name, p.x, p.y); setDrag(null) } else if (!dead) setOpen((o) => !o)
    }
    const cancel = () => { end(); setDrag(null) }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
    el.addEventListener("pointercancel", cancel)
  }
  return (
    <div ref={box} className="companion-cursor pointer-events-none fixed top-0 left-0 z-[55]" data-agent={a.name} data-state={a.state} data-seen={seen || undefined} data-open={open || undefined}
      onPointerEnter={enter} onPointerLeave={() => setHover(false)}
      style={{ transform: `translate(${at.x - 3}px, ${at.y - 2}px)`, transition: drag ? "opacity .3s" : `transform ${a.state === "writing" || typing?.agent === a.name ? 90 : 650}ms cubic-bezier(.2,.85,.25,1), opacity .3s`,
        opacity: idle && !hover && !open ? 0.55 : 1, zIndex: open || drag ? 56 : undefined }}>
      {!spot.drawn && <>
      <div className={cn(a.state === "thinking" && !drag && "companion-bob")} style={{ transform: nudge ? `translate(${nudge.x}px, ${nudge.y}px)` : undefined, transition: "transform .18s ease-out" }}>
        <Arrow tint={tint} />
      </div>
      <div role="button" aria-label={`${a.name}: ask, or drag onto text`} data-companion-grip onPointerDown={down} onContextMenu={(e) => e.preventDefault()}
        className={cn("pointer-events-auto absolute top-0 left-0 z-[1] size-5 touch-none select-none [-webkit-touch-callout:none] [@media(pointer:coarse)]:-top-3 [@media(pointer:coarse)]:-left-3 [@media(pointer:coarse)]:size-11",
          drag ? "cursor-grabbing" : "cursor-pointer")} />
      <button type="button" tabIndex={tag ? 0 : -1} aria-label={`Go to ${a.name}`} data-tip={a.path ? "Go to where it is" : undefined} onClick={() => follow(a)}
        className={cn("absolute flex items-center gap-1 rounded-full px-2 py-[2px] text-[11.5px] font-semibold whitespace-nowrap text-white shadow-sm transition-opacity duration-300",
          flagRight ? "right-[-6px]" : "left-[13px]", low ? "top-[-20px]" : "top-[18px]", tag ? "pointer-events-auto cursor-pointer" : "opacity-0")} style={{ background: tint }}>
        {a.name}
        {others.length > 0 && <span className="font-medium opacity-85">{hover ? `, ${others.join(", ")}` : `+${others.length}`}</span>}
        {(hover || open) && <span className="font-medium opacity-85">{STATUS[a.state]}</span>}
        {(a.state === "thinking" || a.state === "reading") && <span className="companion-dots" aria-label={a.state}><i /><i /><i /></span>}
        {seen && <Check key={a.t} className="companion-seen size-3" strokeWidth={3} aria-label="seen" />}
      </button>
      {/* (kept inside the window) */}
      {open && <Popover a={a} up={low || at.y > innerHeight - 360} left={Math.max(4, Math.min(innerWidth - 284, right ? at.x + 23 - 280 : at.x - 1)) - (at.x - 3)} close={() => setOpen(false)} />}
      </>}
      {said && !open && !drag && (
        <div key={said.id} className={cn("companion-pop pointer-events-auto absolute flex w-max cursor-pointer items-start gap-1 rounded-[12px] border border-border/60 bg-background py-1.5 pr-1 pl-3 text-[13.5px] leading-snug text-foreground shadow-lg",
          right ? "right-[22px] rounded-tr-[4px]" : "left-[24px] rounded-tl-[4px]", low ? "bottom-[22px]" : "bottom-[2px]")} style={{ maxWidth: Math.max(160, Math.min(300, right ? at.x - 30 : innerWidth - at.x - 34)), boxShadow: `0 0 0 1.5px color-mix(in srgb, ${tint} 45%, transparent), 0 8px 24px rgba(0,0,0,.12)` }}
          onClick={() => answer(said.id, "dismiss")}>
          <Markdown text={said.text ?? ""} className="companion-md min-w-0 pr-1" />
          {!spot.drawn && <button type="button" aria-label="Pin as a comment" data-tip="Pin as a comment" className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground max-sm:size-7"
            onClick={(e) => { e.stopPropagation(); pin(said.id) }}><Pin className="size-3" /></button>}
        </div>
      )}
    </div>
  )
}

/** A tint as text: mixed toward the text colour, so a yellow reads on light and a blue on dark. */
const inked = (tint: string) => `color-mix(in srgb, ${tint} 72%, var(--foreground))`

/** A margin card. Not open, a long one shows its first lines faded (a dot, where the margin's narrow); open, all of it. */
function Card({ n, x, y, folded, open, cap, onHeight, onOpen }: { n: Note; x: number; y: number; folded: boolean; open: boolean; cap: number
  onHeight: (h: number) => void; onOpen: (open: boolean) => void }) {
  const ref = useRef<HTMLElement | null>(null), keep = (el: HTMLElement | null) => { ref.current = el }
  const body = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  const [replying, setReplying] = useState(false)
  const [draft, setDraft] = useState("")
  const tint = `var(--${getState().agents.find((a) => a.name === n.agent)?.tint ?? "orange"})`
  // (how far below its line it reaches: the next card goes under it, and the note keeps room to scroll to it)
  useLayoutEffect(() => {
    if (ref.current) onHeight(ref.current.offsetHeight)
    const b = body.current
    setMore(!open && !!b && b.scrollHeight > b.clientHeight + 2)
  })
  const replies = n.replies?.length ?? 0, had = useRef(replies)
  useEffect(() => { if (replies > had.current) body.current?.scrollTo({ top: body.current.scrollHeight }); had.current = replies }, [replies])
  if (folded && !open) {
    return (
      <button ref={keep} type="button" aria-label={`${n.agent}'s ${n.kind}`} data-companion-dot={n.id} className="companion-pop pointer-events-auto absolute top-0 left-0 grid size-5 cursor-pointer place-items-center rounded-full shadow"
        style={{ transform: `translate(${x}px, ${y}px)`, background: tint }} onClick={() => onOpen(true)}>
        <span className="size-1.5 rounded-full bg-white" />
      </button>
    )
  }
  const send = () => { const t = draft.trim(); if (t) answer(n.id, "reply", t); setDraft(""); setReplying(false) }
  return (
    <div ref={keep} data-companion-note={n.id} data-open={open || undefined} onPointerDown={() => !open && onOpen(true)} className="companion-pop pointer-events-auto absolute top-0 left-0 flex w-[212px] flex-col rounded-[10px] border border-border/60 bg-background pl-1.5 text-[13px] leading-snug shadow-md"
      style={{ transform: `translate(${x}px, ${y}px)`, transition: "transform .25s ease-out", maxHeight: cap, zIndex: open ? 1 : undefined }}>
      {/* (its colour as a straight bar clear of the rounded corners, not a border bent around them) */}
      <span aria-hidden className="absolute inset-y-2.5 left-[3px] w-[3px] rounded-full" style={{ background: tint }} />
      <div className="flex shrink-0 items-center gap-1.5 px-2.5 pt-2 text-[11.5px] font-semibold text-muted-foreground">
        <span className="min-w-0 flex-1 truncate" style={{ color: inked(tint) }}>{n.agent}{n.kind === "suggestion" ? " suggests" : ""}</span>
        <button type="button" aria-label={n.kind === "suggestion" ? "Reject" : "Dismiss"} data-tip={n.kind === "suggestion" ? `Reject (${keyHint("Escape")})` : "Dismiss"}
          className="grid size-5 cursor-pointer place-items-center rounded hover:bg-foreground/[0.07]"
          onClick={() => (folded && n.kind === "comment" ? onOpen(false) : answer(n.id, n.kind === "suggestion" ? "reject" : "dismiss"))}>
          <X className="size-3.5" />
        </button>
      </div>
      {/* (open, one taller than the pane scrolls inside, its buttons kept in sight) */}
      <div ref={body} className={cn("min-h-0", open ? "overflow-y-auto overscroll-contain [scrollbar-width:thin]" : "max-h-[84px] overflow-hidden", more && "companion-more")}>
        {n.text && <div className="px-2.5 pt-1 pb-2 text-foreground"><Markdown text={n.text} className="companion-md" /></div>}
        {n.kind === "comment" && replies > 0 && (
          <div className="px-2.5">
            {n.replies!.map((r, i) => (
              <div key={i} className="mt-1.5 border-t border-border/50 pt-1.5"><div className="text-[11.5px] font-semibold text-muted-foreground" style={r.by === "user" ? undefined : { color: inked(tint) }}>{r.by === "user" ? "You" : n.agent}</div><Markdown text={r.text} className="companion-md" /></div>
            ))}
          </div>
        )}
      </div>
      {more && <button type="button" className="-mt-1 shrink-0 cursor-pointer self-start px-2.5 pb-1 text-[12px] font-medium text-muted-foreground hover:text-foreground" onClick={() => onOpen(true)}>More</button>}
      {n.kind === "suggestion" && (
        <div className="flex shrink-0 gap-1.5 px-2.5 pb-2.5">
          <button type="button" className="flex h-7 cursor-pointer items-center gap-1 rounded-[7px] px-2.5 text-[12.5px] font-semibold text-white" style={{ background: tint }} onClick={() => void accept(n)}>
            <Check className="size-3.5" strokeWidth={2.5} />Accept<span className="opacity-70">{keyHint("Tab")}</span>
          </button>
        </div>
      )}
      {n.kind === "comment" && (
        <div className="shrink-0 px-2.5 pb-2">
          {replying ? (
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Reply"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send() } else if (e.key === "Escape") setReplying(false) }} onBlur={() => !draft && setReplying(false)}
              className="mt-1.5 h-7 w-full rounded-[6px] border border-border bg-transparent px-2 text-[13px] outline-none focus:border-foreground/30" />
          ) : (
            <button type="button" className="mt-1 cursor-pointer text-[12px] font-medium text-muted-foreground hover:text-foreground" onClick={() => setReplying(true)}>Reply</button>
          )}
        </div>
      )}
    </div>
  )
}

const STYLE = `
.companion-bob { animation: companion-bob 1.1s ease-in-out infinite; }
@keyframes companion-bob { 50% { transform: translate(1px, -3px) rotate(-6deg); } }
.companion-dots { display: inline-flex; gap: 2px; }
.companion-dots i { width: 3px; height: 3px; border-radius: 9px; background: currentColor; animation: companion-dot 1s infinite ease-in-out; }
.companion-dots i:nth-child(2) { animation-delay: .15s } .companion-dots i:nth-child(3) { animation-delay: .3s }
@keyframes companion-dot { 0%, 80%, 100% { opacity: .35 } 40% { opacity: 1 } }
.companion-seen { animation: companion-seen .5s ease-out; }
@keyframes companion-seen { from { opacity: 0; scale: .4; } }
.companion-pop { animation: companion-pop .28s cubic-bezier(.2,.9,.3,1.25); transform-origin: top left; }
@keyframes companion-pop { from { opacity: 0; scale: .9; } }
.companion-more { mask-image: linear-gradient(to bottom, #000 55%, transparent); }
.note-prose.companion-md { font-size: inherit; line-height: inherit; }
.note-prose.companion-md :where(p, ul, ol, pre, blockquote, table) { margin: 0 0 4px; }
.note-prose.companion-md > :last-child { margin-bottom: 0; }
.note-prose.companion-md :where(ul, ol) { padding-left: 16px; }
.note-prose.companion-md li + li { margin-top: 1px; }
.note-prose.companion-md :where(.h1, .h2, .h3, h1, h2, h3) { font-size: inherit; line-height: inherit; font-weight: 650; margin: 0 0 2px; }
@media (prefers-reduced-motion: reduce) { .companion-cursor, .companion-bob, .companion-pop, .companion-dots i, .companion-seen { animation: none !important; transition: none !important; } }
`

type Placed = { n: Note; v: EditorView; x: number; y: number; folded: boolean; open?: boolean }
type Pane = { id: number; top: number; bottom: number; under: number; cards: Placed[] }
const paneIds = new WeakMap<Element, number>()
let lastPane = 0
let insets = new WeakMap<Element, { top: number; foot: number }>()
const roomy = new Set<EditorView>()

/** What of a pane's scroller shows: under its bar (a phone's header), above the status bar (a phone's bar). */
function shownOf(el: Element) {
  let i = insets.get(el)
  if (!i) {
    const probe = document.createElement("div")
    probe.style.cssText = "position:absolute;visibility:hidden;height:var(--vau-panel-top,0px);width:var(--vau-panel-bottom,0px)"
    el.append(probe)
    i = { top: probe.offsetHeight, foot: probe.offsetWidth }
    probe.remove()
    insets.set(el, i)
  }
  const r = el.matches("[data-pane]") ? el.getBoundingClientRect() : { top: 0, bottom: innerHeight }, bar = document.querySelector("[data-phone-bar]")?.getBoundingClientRect()
  const bottom = Math.min(bar?.height ? bar.top : innerHeight, innerHeight, r.bottom - i.foot)
  return { top: Math.max(0, r.top + i.top), bottom, under: r.bottom - bottom }
}

/** Where on screen the line of `pos` starts, drawn or not. */
function topOf(v: EditorView, pos: number) {
  try { const c = v.coordsAtPos(pos); if (c) return c.top } catch { /* outside the drawn part */ }
  return v.documentTop + v.lineBlockAt(pos).top
}

export function Overlay() {
  const s = useSyncExternalStore(subscribe, getState)
  const [, redraw] = useReducer((x: number) => x + 1, 0)
  const heights = useRef(new Map<string, number>())
  const rooms = useRef(new Map<EditorView, number>())
  // The card open: the one clicked, else the one whose text the user's caret is in (as in a shared doc).
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.("[data-companion-note], [data-companion-dot]")) pick(null) }
    addEventListener("pointerdown", down, true)
    return () => removeEventListener("pointerdown", down, true)
  }, [])
  useEffect(() => {
    let frame = 0
    const later = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; redraw() }) }
    const off = onBump(later)
    const resized = () => { insets = new WeakMap(); later() }
    addEventListener("scroll", later, { capture: true, passive: true })
    addEventListener("resize", resized)
    // (a tab switch or a split moves editors without telling)
    const tick = setInterval(() => document.visibilityState === "visible" && later(), 1500)
    return () => { off(); removeEventListener("scroll", later, { capture: true }); removeEventListener("resize", resized); clearInterval(tick); cancelAnimationFrame(frame) }
  }, [])
  // The note's own room under its text, so scrolling reaches its lowest card.
  useLayoutEffect(() => {
    for (const v of roomy) if (!rooms.current.has(v)) { v.contentDOM.style.marginBottom = ""; roomy.delete(v) }
    for (const [v, px] of rooms.current) {
      const m = px > 0 ? `${Math.ceil(px)}px` : ""
      if (v.contentDOM.style.marginBottom !== m) v.contentDOM.style.marginBottom = m
      if (m) roomy.add(v); else roomy.delete(v)
    }
  })
  rooms.current = new Map()
  if (s.mode === "off") return null

  const cursors = s.agents.map((a, i) => {
    const said = [...s.notes].reverse().find((n) => n.kind === "say" && n.agent === a.name) ?? null
    return { a, spot: spotOf(a, i, !!said), said, with: [] as string[], under: false }
  })
  // (cursors on the same spot: one flag, "Perf +1", that names them all when hovered)
  for (const c of cursors) {
    const top = c.spot && cursors.find((o) => o !== c && o.spot && !o.under && Math.abs(o.spot.x - c.spot!.x) < 14 && Math.abs(o.spot.y - c.spot!.y) < 10 && cursors.indexOf(o) < cursors.indexOf(c))
    if (top) { c.under = true; top.with.push(c.a.name) }
  }
  // Cards beside their lines, scrolling with the note and clipped to what of its pane shows (as in a shared doc's margin).
  const panes = new Map<Element, Pane>()
  let caret: string | null = null
  for (const n of s.notes) {
    if (n.kind !== "comment" && n.kind !== "suggestion") continue
    const v = n.path ? viewOf(n.path) : null
    const pos = v ? posIn(v, n) : null
    if (!v || pos === null) continue
    // (a phone's page scrolls the window; a sheet is a modal dialog, drawn over the margin)
    const el = v.dom.closest("[data-pane]") ?? v.dom.closest("#main-scroll")
    if (!el?.getClientRects().length) continue
    let p = panes.get(el)
    if (!p) {
      if (!paneIds.has(el)) paneIds.set(el, ++lastPane)
      panes.set(el, p = { id: paneIds.get(el)!, ...shownOf(el), cards: [] })
    }
    const edge = el.getBoundingClientRect().right, right = v.contentDOM.getBoundingClientRect().right
    const folded = edge - right < MARGIN
    p.cards.push({ n, v, x: folded ? Math.min(right + 4, edge - 26) : right + 10, y: topOf(v, pos), folded })
    if (!caret && v.hasFocus) {
      const doc = v.state.doc, head = doc.lineAt(v.state.selection.main.head).number
      if (head >= doc.lineAt(pos).number && head <= doc.lineAt(Math.min(doc.length, pos + (n.find?.length ?? 0))).number) caret = n.id
    }
  }
  const open = s.picked ?? caret
  const hOf = (c: Placed) => heights.current.get(c.n.id) ?? (c.folded && !c.open ? 20 : 80)
  for (const p of panes.values()) {
    const lo = p.top + 8, hi = p.bottom - 8
    // (one open past the pane's foot slides up to fit, when its line shows)
    const fit = (c: Placed) => { if (c.y < hi && c.y + hOf(c) > hi) c.y = Math.max(lo, hi - hOf(c)) }
    p.cards.sort((a, b) => a.y - b.y)
    for (const c of p.cards) {
      c.open = c.n.id === open
      if (c.folded && c.open) { c.x -= 198; c.y += 24; fit(c) }
    }
    // (top to bottom, none covering another: the open one by its line, the others moved off it)
    const stack = p.cards.filter((c) => !c.folded), f = stack.findIndex((c) => c.open)
    if (f >= 0) fit(stack[f])
    for (let i = Math.max(0, f) + (f >= 0 ? 1 : 0), bottom = f >= 0 ? stack[f].y + hOf(stack[f]) : -Infinity; i < stack.length; i++) {
      stack[i].y = Math.max(stack[i].y, bottom + 8); bottom = stack[i].y + hOf(stack[i])
    }
    for (let i = f - 1; i >= 0; i--) stack[i].y = Math.min(stack[i].y, stack[i + 1].y - 8 - hOf(stack[i]))
    for (const c of p.cards) {
      const need = c.y + hOf(c) + 16 + p.under - c.v.contentDOM.getBoundingClientRect().bottom
      rooms.current.set(c.v, Math.max(rooms.current.get(c.v) ?? 0, need))
    }
  }
  const measured = (id: string, h: number) => { if (heights.current.get(id) !== h) { heights.current.set(id, h); requestAnimationFrame(redraw) } }
  return createPortal(
    <div className="companion-overlay" data-companion={s.connected ? "on" : "off"}>
      <style>{STYLE}</style>
      {[...panes.values()].map((p) => (
        <div key={p.id} className="pointer-events-none fixed inset-x-0 z-[54] overflow-hidden" style={{ top: p.top, height: Math.max(0, p.bottom - p.top) }}>
          {p.cards.map((c) => <Card key={c.n.id} n={c.n} x={c.x} y={c.y - p.top} folded={c.folded} open={!!c.open} cap={Math.max(120, p.bottom - p.top - 16)}
            onHeight={(h) => measured(c.n.id, h)} onOpen={(o) => pick(o ? c.n.id : null)} />)}
        </div>
      ))}
      {cursors.map(({ a, spot, said, with: others, under }) => spot && <Cursor key={a.name} a={a} spot={spot} said={said} others={others} under={under} />)}
    </div>,
    document.body,
  )
}
