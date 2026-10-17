// The agents over the whole app: each one's cursor gliding to where its attention is (parked by the status bar when
// it's nowhere), its words in a bubble by the cursor, and its comments and suggestions in the margin of the note.
import { useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { Check, X } from "lucide-react"
import { cn, keyHint, Markdown } from "@vaultite"
import type { EditorView } from "@codemirror/view"
import { accept, type Agent, answer, getState, nearest, type Note, onBump, subscribe, typing, viewOf } from "./live"

type Spot = { x: number; y: number; parked?: boolean }
const MARGIN = 228 // a card's width and its gaps: less room than this beside the text and it folds to a dot

/** A target's position in its editor, or null when the text is gone. */
function posIn(v: EditorView, t: { line?: number; find?: string }) {
  const doc = v.state.doc
  if (t.find) { const i = nearest(doc.toString(), t.find, t.line); if (i >= 0) return i }
  return t.line ? doc.line(Math.max(1, Math.min(t.line, doc.lines))).from : null
}

/** Where on screen `pos` of `v` is, kept inside its scroller (a cursor at an edge says "up there"). */
function coords(v: EditorView, pos: number) {
  const box = (v.dom.closest("[data-pane]") ?? v.scrollDOM).getBoundingClientRect()
  let c: { left: number; top: number; bottom: number } | null = null
  try { c = v.coordsAtPos(pos) } catch { /* outside the drawn part */ }
  const y = c ? c.top : pos < v.viewport.from ? box.top : box.bottom
  return { x: c ? c.left : box.left + 24, y: Math.max(box.top + 2, Math.min(box.bottom - 30, y)), shown: !!c && c.top >= box.top - 4 && c.bottom <= box.bottom + 4, box }
}

/** A file that isn't open: its row in the file tree, when one shows it. */
function rowOf(path: string): Spot | null {
  const el = [...document.querySelectorAll<HTMLElement>(`[data-tree-path="${CSS.escape(path)}"]`)].find((e) => e.offsetParent)
  const r = el?.getBoundingClientRect()
  return r && r.height ? { x: r.left + Math.min(r.width - 24, 120), y: r.top + 4 } : null
}

function home(i: number): Spot {
  return { x: window.innerWidth - 150 - i * 90, y: window.innerHeight - 70, parked: true }
}

/** Where an agent's cursor goes: where it types, else its target, else home. Beside the line when that's where the user
 *  is writing (their caret stays theirs) or it's talking (its words open into the space after the text). */
function spotOf(a: Agent, i: number, talking: boolean): Spot | null {
  if (a.state === "away") return null
  if (typing && typing.agent === a.name && typing.view.dom.isConnected) {
    const c = coords(typing.view, Math.min(typing.pos, typing.view.state.doc.length))
    return { x: c.x, y: c.y }
  }
  const v = a.path ? viewOf(a.path) : null
  const pos = v ? posIn(v, a) : null
  if (!v || pos === null) return (a.path && rowOf(a.path)) || home(i)
  const line = v.state.doc.lineAt(pos)
  const caret = v.state.doc.lineAt(v.state.selection.main.head).number
  if (talking || (v.hasFocus && Math.abs(caret - line.number) <= 1)) {
    const c = coords(v, line.to)
    return { x: Math.min(c.box.right - 40, c.x + 28), y: c.y }
  }
  const c = coords(v, pos)
  return { x: c.x, y: c.y }
}

function Arrow({ tint }: { tint: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
      <path d="M3 2.5 L16.5 9.2 L10.3 10.9 L7.6 16.8 Z" fill={tint} stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

function Cursor({ a, spot, said }: { a: Agent; spot: Spot; said: Note | null }) {
  const tint = `var(--${a.tint})`
  const right = spot.x > window.innerWidth - 320
  // (quiet when it's only watching: the arrow, its name once it does something; a tick when it let a moment pass)
  const idle = a.state === "watching" && !said && typing?.agent !== a.name && Date.now() - a.t > 4000
  const seen = a.state === "watching" && !!a.seen
  return (
    <div className="companion-cursor pointer-events-none fixed top-0 left-0 z-[55]" data-agent={a.name} data-state={a.state} data-seen={seen || undefined}
      style={{ transform: `translate(${spot.x - 3}px, ${spot.y - 2}px)`, transition: `transform ${a.state === "writing" || typing?.agent === a.name ? 90 : 650}ms cubic-bezier(.2,.85,.25,1), opacity .3s`,
        opacity: idle ? 0.55 : 1 }}>
      <div className={cn(a.state === "thinking" && "companion-bob")}><Arrow tint={tint} /></div>
      <div className={cn("absolute top-[18px] flex items-center gap-1 rounded-full px-2 py-[2px] text-[11.5px] font-semibold whitespace-nowrap text-white shadow-sm transition-opacity duration-300",
        right ? "right-[-6px]" : "left-[13px]", idle && "opacity-0")} style={{ background: tint }}>
        {a.name}
        {(a.state === "thinking" || a.state === "reading") && <span className="companion-dots" aria-label={a.state}><i /><i /><i /></span>}
        {seen && <Check key={a.t} className="companion-seen size-3" strokeWidth={3} aria-label="seen" />}
      </div>
      {said && (
        <div key={said.id} className={cn("companion-pop pointer-events-auto absolute bottom-[2px] w-max max-w-[300px] cursor-pointer rounded-[12px] border border-border/60 bg-background px-3 py-1.5 text-[13.5px] leading-snug text-foreground shadow-lg",
          right ? "right-[22px] rounded-tr-[4px]" : "left-[24px] rounded-tl-[4px]")} style={{ boxShadow: `0 0 0 1.5px color-mix(in srgb, ${tint} 45%, transparent), 0 8px 24px rgba(0,0,0,.12)` }}
          onClick={() => answer(said.id, "dismiss")}>
          <Markdown text={said.text ?? ""} className="companion-md" />
        </div>
      )}
    </div>
  )
}

function Card({ n, x, y, folded, cap, onHeight }: { n: Note; x: number; y: number; folded: boolean; cap: number; onHeight: (h: number) => void }) {
  const ref = useRef<HTMLElement | null>(null), keep = (el: HTMLElement | null) => { ref.current = el }
  const body = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [replying, setReplying] = useState(false)
  const [draft, setDraft] = useState("")
  const tint = `var(--${getState().agents.find((a) => a.name === n.agent)?.tint ?? "orange"})`
  // (how far below its line it reaches: the next card goes under it, and the note keeps room to scroll to it)
  useLayoutEffect(() => { if (ref.current) onHeight(ref.current.offsetHeight + (folded && open ? 24 : 0)) })
  const replies = n.replies?.length ?? 0, had = useRef(replies)
  useEffect(() => { if (replies > had.current) body.current?.scrollTo({ top: body.current.scrollHeight }); had.current = replies }, [replies])
  if (folded && !open) {
    return (
      <button ref={keep} type="button" aria-label={`${n.agent}'s ${n.kind}`} className="companion-pop pointer-events-auto absolute top-0 left-0 grid size-5 cursor-pointer place-items-center rounded-full shadow"
        style={{ transform: `translate(${x}px, ${y}px)`, background: tint }} onClick={() => setOpen(true)}>
        <span className="size-1.5 rounded-full bg-white" />
      </button>
    )
  }
  const send = () => { const t = draft.trim(); if (t) answer(n.id, "reply", t); setDraft(""); setReplying(false) }
  return (
    <div ref={keep} data-companion-note={n.id} className="companion-pop pointer-events-auto absolute top-0 left-0 flex w-[212px] flex-col rounded-[10px] border border-border/60 bg-background pl-1.5 text-[13px] leading-snug shadow-md"
      style={{ transform: `translate(${folded ? x - 198 : x}px, ${folded ? y + 24 : y}px)`, transition: "transform .25s ease-out", maxHeight: cap }}>
      {/* (its colour as a straight bar clear of the rounded corners, not a border bent around them) */}
      <span aria-hidden className="absolute inset-y-2.5 left-[3px] w-[3px] rounded-full" style={{ background: tint }} />
      <div className="flex shrink-0 items-center gap-1.5 px-2.5 pt-2 text-[11.5px] font-semibold text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{n.agent}{n.kind === "suggestion" ? " suggests" : ""}</span>
        <button type="button" aria-label={n.kind === "suggestion" ? "Reject" : "Dismiss"} data-tip={n.kind === "suggestion" ? `Reject (${keyHint("Escape")})` : "Dismiss"}
          className="grid size-5 cursor-pointer place-items-center rounded hover:bg-foreground/[0.07]"
          onClick={() => (folded && open && n.kind === "comment" ? setOpen(false) : answer(n.id, n.kind === "suggestion" ? "reject" : "dismiss"))}>
          <X className="size-3.5" />
        </button>
      </div>
      {/* (a long one scrolls inside, its buttons kept in sight) */}
      <div ref={body} className="min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
        {n.text && <div className="px-2.5 pt-1 pb-2 text-foreground"><Markdown text={n.text} className="companion-md" /></div>}
        {n.kind === "comment" && replies > 0 && (
          <div className="px-2.5">
            {n.replies!.map((r, i) => (
              <div key={i} className="mt-1.5 border-t border-border/50 pt-1.5"><div className="font-semibold text-muted-foreground">{r.by === "user" ? "You" : n.agent}</div><Markdown text={r.text} className="companion-md" /></div>
            ))}
          </div>
        )}
      </div>
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
.note-prose.companion-md { font-size: inherit; line-height: inherit; }
.note-prose.companion-md :where(p, ul, ol, pre, blockquote, table) { margin: 0 0 4px; }
.note-prose.companion-md > :last-child { margin-bottom: 0; }
.note-prose.companion-md :where(ul, ol) { padding-left: 16px; }
.note-prose.companion-md li + li { margin-top: 1px; }
.note-prose.companion-md :where(.h1, .h2, .h3, h1, h2, h3) { font-size: inherit; line-height: inherit; font-weight: 650; margin: 0 0 2px; }
@media (prefers-reduced-motion: reduce) { .companion-cursor, .companion-bob, .companion-pop, .companion-dots i, .companion-seen { animation: none !important; transition: none !important; } }
`

type Placed = { n: Note; v: EditorView; x: number; y: number; folded: boolean }
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
    return { a, spot: spotOf(a, i, !!said), said }
  })
  // Cards beside their lines, scrolling with the note and clipped to what of its pane shows (as in a shared doc's margin).
  const panes = new Map<Element, Pane>()
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
  }
  for (const p of panes.values()) {
    // (top to bottom, pushed down so none covers another)
    p.cards.sort((a, b) => a.y - b.y)
    let bottom = -Infinity
    for (const c of p.cards) {
      const h = heights.current.get(c.n.id) ?? (c.folded ? 20 : 80)
      if (!c.folded) { c.y = Math.max(c.y, bottom + 8); bottom = c.y + h }
      const need = c.y + h + 16 + p.under - c.v.contentDOM.getBoundingClientRect().bottom
      rooms.current.set(c.v, Math.max(rooms.current.get(c.v) ?? 0, need))
    }
  }
  const measured = (id: string, h: number) => { if (heights.current.get(id) !== h) { heights.current.set(id, h); requestAnimationFrame(redraw) } }
  return createPortal(
    <div className="companion-overlay" data-companion={s.connected ? "on" : "off"}>
      <style>{STYLE}</style>
      {[...panes.values()].map((p) => (
        <div key={p.id} className="pointer-events-none fixed inset-x-0 z-[54] overflow-hidden" style={{ top: p.top, height: Math.max(0, p.bottom - p.top) }}>
          {p.cards.map((c) => <Card key={c.n.id} n={c.n} x={c.x} y={c.y - p.top} folded={c.folded} cap={Math.max(120, p.bottom - p.top - 16)}
            onHeight={(h) => measured(c.n.id, h)} />)}
        </div>
      ))}
      {cursors.map(({ a, spot, said }) => spot && <Cursor key={a.name} a={a} spot={spot} said={said} />)}
    </div>,
    document.body,
  )
}
