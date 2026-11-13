import { useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { dictationSource, share, useDictation } from "@vaultite"
import type { EditorView } from "@codemirror/view"
import { type Agent, arrivedAt, getState, type Target, type Note, onBump, pick, subscribe, typing, viewOf, views } from "./live"
import { useInMargin } from "./threads"
import { PhoneLayer, usePhone } from "./Phone"
import { DRAFT, coarse } from "./overlaykit"
import { IDLE_MS, home, lastShown, placeKey, placeOf, posIn, screenSpot, spotOf, type Left, type Place, type Spot } from "./spots"
import { Cursor } from "./Cursor"
import { AddComment, Card, Gutter, PaneMark } from "./Card"

const MARGIN = 228

const STYLE = `
.companion-bob { animation: companion-bob 1.1s ease-in-out infinite; }
@keyframes companion-bob { 50% { transform: translate(1px, -3px) rotate(-6deg); } }
.companion-dots { display: inline-flex; gap: 2px; }
.companion-dots i { width: 3px; height: 3px; border-radius: 9px; background: currentColor; animation: companion-dot 1s infinite ease-in-out; }
.companion-dots i:nth-child(2) { animation-delay: .15s } .companion-dots i:nth-child(3) { animation-delay: .3s }
@keyframes companion-dot { 0%, 80%, 100% { opacity: .35 } 40% { opacity: 1 } }
.companion-wave { display: inline-flex; align-items: center; gap: 1.5px; height: 9px; }
.companion-wave i { width: 2px; height: 100%; border-radius: 9px; background: currentColor; transform-origin: center; animation: companion-wave 1s infinite ease-in-out; }
.companion-wave i:nth-child(2) { animation-delay: .2s } .companion-wave i:nth-child(3) { animation-delay: .4s }
@keyframes companion-wave { 0%, 100% { transform: scaleY(.35) } 50% { transform: scaleY(1) } }
.companion-seen { animation: companion-seen .5s ease-out; }
@keyframes companion-seen { from { opacity: 0; scale: .4; } }
.companion-pop { animation: companion-pop .28s cubic-bezier(.2,.9,.3,1.25); transform-origin: top left; }
@keyframes companion-pop { from { opacity: 0; scale: .9; } }
.companion-fade { animation: companion-fade .25s ease-out; }
@keyframes companion-fade { from { opacity: 0; } }
.companion-more { mask-image: linear-gradient(to bottom, #000 55%, transparent); }
.note-prose.companion-md { font-size: inherit; line-height: inherit; }
.note-prose.companion-md :where(p, ul, ol, pre, blockquote, table) { margin: 0 0 4px; }
.note-prose.companion-md > :last-child { margin-bottom: 0; }
.note-prose.companion-md :where(ul, ol) { padding-left: 16px; }
.note-prose.companion-md li + li { margin-top: 1px; }
.note-prose.companion-md :where(.h1, .h2, .h3, h1, h2, h3) { font-size: inherit; line-height: inherit; font-weight: 650; margin: 0 0 2px; }
html[data-drawer] .companion-overlay { visibility: hidden; }
@media (prefers-reduced-motion: reduce) { .companion-cursor, .companion-bob, .companion-pop, .companion-fade, .companion-dots i, .companion-wave i, .companion-seen { animation: none !important; transition: none !important; } }
`

type Placed = { n: Note; v: EditorView; x: number; y: number; folded: boolean; nudge: number; open?: boolean }
type Dot = { n: Note; x: number; y: number }
type Pane = { id: number; top: number; bottom: number; under: number; cards: Placed[]; dots: Dot[]; add?: { x: number; y: number } }
const paneIds = new WeakMap<Element, number>()
let lastPane = 0
let insets = new WeakMap<Element, { top: number; foot: number }>()
const roomy = new Set<EditorView>()
let adding = false
function selecting() {
  if (coarse.matches || (share && share.role === "read")) return null
  for (const v of views.keys()) {
    const sel = v.state.selection.main
    if (v.hasFocus && !sel.empty && (share?.role === "comment" || v.contentDOM.contentEditable === "true") && v.state.sliceDoc(sel.from, sel.to).trim()) return v
  }
  return null
}

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

function topOf(v: EditorView, pos: number) {
  try { const c = v.coordsAtPos(pos); if (c && c.bottom > c.top) return c.top } catch {}
  return v.documentTop + v.lineBlockAt(pos).top
}

let popOpen: ((name: string | null) => void) | null = null
export const showSaid = (name: string) => popOpen?.(name)

export function Overlay() {
  const s = useSyncExternalStore(subscribe, getState)
  const spokeAt = useDictation((d) => d?.spokeAt ?? 0)
  const heldBack = (n: Note) => spokeAt > 0 && arrivedAt(n.id) >= spokeAt
  const says = (a: Agent) => s.notes.filter((n) => n.kind === "say" && n.agent === a.name && !!n.text?.trim())
  const margin = useInMargin()
  const [, redraw] = useReducer((x: number) => x + 1, 0)
  const [popped, setPopped] = useState<string | null>(null)
  popOpen = setPopped
  const phone = usePhone()
  const [hovered, setHovered] = useState<string | null>(null)
  const heights = useRef(new Map<string, number>())
  const rooms = useRef(new Map<EditorView, number>())
  const holds = useRef(new Map<string, Place>()), drawn = useRef(new Map<string, Place>()), lastSpots = useRef(new Map<string, Spot>())
  const hold = (name: string, on: boolean, at?: { x: number; y: number }, text?: Target) => {
    if (!on) { if (!holds.current.get(name)?.left && holds.current.delete(name)) redraw(); return }
    const d = drawn.current.get(name)
    if (!d) return
    if (!at) { if (!holds.current.has(name)) holds.current.set(name, d); return }
    const a = getState().agents.find((x) => x.name === name)
    if (!a) return
    const left: Left = { last: placeKey(a), echo: Date.now() + 3000 }
    const there = text && { ...placeOf({}), ...text }, spot = there && spotOf({ ...a, ...there }, d.i, true)
    const over = document.elementsFromPoint(at.x, at.y).some((e) => !e.closest(".companion-overlay") && !!e.closest("[data-web-box]"))
    holds.current.set(name, there && spot && !spot.parked ? { at: there, i: d.i, shift: 0, dx: at.x - spot.x, dy: at.y - spot.y, left }
      : { ...d, shift: 0, dx: 0, dy: 0, screen: { ...at, over }, left })
    redraw()
  }
  const stays = (a: Agent, left: Left) => {
    if (typing?.agent === a.name) return false
    const k = placeKey(a)
    if (k === left.last) return true
    if (Date.now() > left.echo) return false
    Object.assign(left, { last: k, echo: 0 })
    return true
  }
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null, mark = t?.closest<HTMLElement>("[data-companion-mark]")
      if (mark) pick(mark.dataset.companionMark!)
      else if (!t?.closest("[data-companion-note], [data-companion-dot], [data-companion-gutter], [data-companion-thread], [data-companion-add]")) pick(null)
    }
    addEventListener("pointerdown", down, true)
    return () => removeEventListener("pointerdown", down, true)
  }, [])
  useEffect(() => {
    let frame = 0
    const placed = (n: Note) => !n.path || !!viewOf(n.path)
    const idle = () => { const st = getState(); return !st.draft && !roomy.size && !adding && (st.mode === "off" ? !st.notes.some((n) => n.by && placed(n)) : !st.agents.length && !st.notes.some(placed)) && !selecting() }
    let tick = 0, busy = false
    const later = () => { if (idle() && !busy) return; arm(); if (!frame) frame = requestAnimationFrame(() => { frame = 0; watch(); busy = !idle(); redraw() }) }
    const arm = () => { if (!tick && !idle()) tick = window.setInterval(() => { if (idle()) { clearInterval(tick); tick = 0; later() } else if (document.visibilityState === "visible") later() }, 1500) }
    const off = onBump(later)
    const resized = () => { insets = new WeakMap(); later() }
    addEventListener("scroll", later, { capture: true, passive: true })
    addEventListener("resize", resized)
    const ro = new ResizeObserver(later), watch = () => { for (const el of document.querySelectorAll("[data-pane], #main-scroll")) ro.observe(el) }
    watch()
    const unsub = subscribe(arm)
    arm()
    return () => { off(); unsub(); ro.disconnect(); removeEventListener("scroll", later, { capture: true }); removeEventListener("resize", resized); clearInterval(tick); cancelAnimationFrame(frame) }
  }, [])
  useLayoutEffect(() => {
    for (const v of roomy) if (!rooms.current.has(v)) { v.contentDOM.style.marginBottom = ""; roomy.delete(v) }
    for (const [v, px] of rooms.current) {
      const m = px > 0 ? `${Math.ceil(px)}px` : ""
      if (v.contentDOM.style.marginBottom !== m) v.contentDOM.style.marginBottom = m
      if (m) roomy.add(v); else roomy.delete(v)
    }
  })
  rooms.current = new Map()
  const off = s.mode === "off"
  const notes = [...(off ? s.notes.filter((n) => n.by) : s.notes), ...(s.draft ? [{ ...s.draft, id: DRAFT, kind: "comment", agent: "", by: share ? "guest" : "user", t: Date.now() } satisfies Note] : [])]
  const sv = s.draft ? null : selecting()
  adding = false
  if (off && !notes.length && !sv) return null

  const cursors = (off ? [] : s.agents).map((a, i) => {
    if (dictationSource && !a.path && (a.app || a.sx !== undefined)) {
      const was = lastSpots.current.get(a.name)
      return { a, i, spot: was ? { ...was, away: true } : null, said: null, waiting: false, with: new Array<Agent>(), under: false, shift: 0, held: undefined }
    }
    if (s.riding === a.name) {
      const at = spotOf(a, i)
      return { a, i, spot: at && !at.docked ? { ...at, away: true } : null, said: null, waiting: false, with: new Array<Agent>(), under: false, shift: 0, held: undefined }
    }
    const mine = says(a), said = mine.findLast((n) => !heldBack(n)) ?? null, waiting = mine.some(heldBack)
    let h = holds.current.get(a.name)
    if (h?.left && !stays(a, h.left)) { holds.current.delete(a.name); h = undefined }
    const quiet = !h && !said && !waiting && !a.asks && typing?.agent !== a.name && a.state === "watching"
    const idle = quiet && (!!a.rests || Date.now() - a.t > IDLE_MS)
    let at = h?.screen ? screenSpot(h.screen) : h ? spotOf({ ...a, ...h.at }, h.i, true) : idle ? home(a, i) : spotOf(a, i)
    if (quiet && at?.out && Date.now() - a.t >= 3000) at = { ...at, parked: true, docked: true, faded: true }
    const off = !!h?.left && !h.screen && !(h.at.path && viewOf(h.at.path))
    return { a, i, spot: at && h && !h.screen && !off ? { ...at, x: at.x + h.dx, y: at.y + h.dy } : at, said, waiting, with: new Array<Agent>(), under: false, shift: 0, held: h }
  })
  for (const c of cursors) {
    const top = c.spot && !c.spot.docked && !c.spot.away && cursors.find((o) => o !== c && o.spot && !o.spot.docked && !o.spot.away && !o.under && Math.abs(o.spot.x - c.spot!.x) < 14 && Math.abs(o.spot.y - c.spot!.y) < 10 && cursors.indexOf(o) < cursors.indexOf(c))
    if (top) { c.under = true; top.with.push(c.a); c.shift = top.with.length }
  }
  for (const c of cursors) if (c.held) c.shift = c.held.shift
  for (const c of cursors) if (c.spot && !c.spot.away) { lastSpots.current.set(c.a.name, c.spot); if (!c.spot.docked) lastShown.set(c.a.name, c.spot) }
  drawn.current = new Map(cursors.map((c) => [c.a.name, c.held ?? { at: placeOf(c.a), i: c.i, shift: c.shift, dx: 0, dy: 0 }]))
  const panes = new Map<Element, Pane>()
  const perLine = new Map<string, number>()
  let caret: string | null = null
  const paneOf = (v: EditorView) => {
    const el = v.dom.closest("[data-pane]") ?? v.dom.closest("#main-scroll")
    if (!el?.getClientRects().length) return null
    let p = panes.get(el)
    if (!p) {
      if (!paneIds.has(el)) paneIds.set(el, ++lastPane)
      panes.set(el, p = { id: paneIds.get(el)!, ...shownOf(el), cards: [], dots: [] })
    }
    return { el, p }
  }
  for (const n of notes) {
    if (n.kind !== "comment" && n.kind !== "suggestion" && n.kind !== "proposal") continue
    const v = n.path ? viewOf(n.path) : null
    const pos = v ? posIn(v, n) : null
    if (!v || pos === null) continue
    const at = paneOf(v)
    if (!at) continue
    const { el, p } = at
    const box = el.getBoundingClientRect(), text = v.contentDOM.getBoundingClientRect()
    if (!margin && n.id !== DRAFT) {
      const line = v.state.doc.lineAt(pos).number, k = `${paneIds.get(el)}:${views.get(v)}:${line}`, i = perLine.get(k) ?? 0
      perLine.set(k, i + 1)
      const gutter = text.left - box.left >= 18
      const x = gutter ? text.left - 15 - i * 9 : Math.min(text.right + 2 + i * 9, box.right - 22)
      p.dots.push({ n, x, y: topOf(v, pos) + v.defaultLineHeight / 2 })
      continue
    }
    const edge = box.right, right = text.right
    const folded = edge - right < MARGIN
    p.cards.push({ n, v, x: folded ? Math.min(right + 4, edge - 26) : right + 10, y: topOf(v, pos), folded, nudge: Math.max(0, Math.min(12, edge - right - MARGIN)) })
    if (!caret && v.hasFocus) {
      const doc = v.state.doc, head = doc.lineAt(v.state.selection.main.head).number
      if (head >= doc.lineAt(pos).number && head <= doc.lineAt(Math.min(doc.length, pos + (n.find?.length ?? 0))).number) caret = n.id
    }
  }
  const open = s.picked ?? caret
  const hOf = (c: Placed) => heights.current.get(c.n.id) ?? (c.folded && !c.open ? 20 : 80)
  for (const p of panes.values()) {
    const lo = p.top + 8, hi = p.bottom - 8
    const fit = (c: Placed) => { if (c.y < hi && c.y + hOf(c) > hi) c.y = Math.max(lo, hi - hOf(c)) }
    p.cards.sort((a, b) => a.y - b.y)
    for (const c of p.cards) {
      c.open = c.n.id === open
      if (c.folded && c.open) { c.x -= 198; c.y += 24; fit(c) }
      if (!c.open) c.x += c.nudge
    }
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
  const sp = sv && paneOf(sv)
  if (sv && sp) {
    const sel = sv.state.selection.main, box = sp.el.getBoundingClientRect(), right = sv.contentDOM.getBoundingClientRect().right
    const head = sel.head === sel.to && sv.state.doc.lineAt(sel.to).from === sel.to ? sel.to - 1 : sel.head, y = topOf(sv, head)
    if (y >= sp.p.top && y <= sp.p.bottom - 28) { sp.p.add = { x: box.right - right < MARGIN ? Math.min(right + 4, box.right - 30) : right + 10, y: y - 2 }; adding = true }
  }
  const lit = [...new Set([open, hovered])].filter((x): x is string => !!x).map((id) => `.cm-content .cm-companion-anchor[data-companion-mark="${CSS.escape(id)}"]`).join(", ")
  const minute = Math.floor(Date.now() / 60000)
  const measured = (id: string, h: number) => { if (heights.current.get(id) !== h) { heights.current.set(id, h); requestAnimationFrame(redraw) } }
  return createPortal(
    <div className="companion-overlay" data-companion={s.connected ? "on" : "off"}>
      <style>{STYLE}</style>
      {lit && <style>{`${lit} { background-color: color-mix(in srgb, var(--c) 38%, transparent); box-shadow: 0 1.5px 0 color-mix(in srgb, var(--c) 85%, transparent); }`}</style>}
      {[...panes.values()].map((p) => (
        <div key={p.id} className="pointer-events-none fixed inset-x-0 z-(--z-page-float) overflow-hidden" style={{ top: p.top, height: Math.max(0, p.bottom - p.top) }}>
          {p.cards.map((c) => <Card key={c.n.id} n={c.n} x={c.x} y={c.y - p.top} folded={c.folded} open={!!c.open} cap={Math.max(120, p.bottom - p.top - 16)}
            minute={minute} onHeight={(h) => measured(c.n.id, h)} onOpen={(o) => pick(o ? c.n.id : null)} onHover={(on) => setHovered((h) => (on ? c.n.id : h === c.n.id ? null : h))} />)}
          {p.add && <AddComment x={p.add.x} y={p.add.y - p.top} />}
          {p.dots.map((d) => <Gutter key={d.n.id} n={d.n} x={d.x} y={d.y - p.top} picked={s.picked === d.n.id} />)}
        </div>
      ))}
      {!off && notes.filter((n) => n.kind === "highlight" && !n.path && (n.pane || n.ui)).map((n) => <PaneMark key={n.id} n={n} />)}
      {phone && <PhoneLayer agents={off ? [] : s.agents} popped={popped} setPopped={setPopped}
        sayOf={(a) => { const mine = says(a); return { said: mine.findLast((n) => !heldBack(n)) ?? null, waiting: mine.some(heldBack) } }} />}
      {!phone && cursors.map(({ a, spot, said, waiting, with: others, under, shift }) => spot && <Cursor key={a.name} a={a} spot={spot} said={said} waiting={waiting} others={others} under={under} shift={shift}
        age={Date.now() - a.t < 3000 ? 0 : Date.now() - a.t <= 4000 ? 1 : Date.now() - a.t <= 8000 ? 2 : 3} typed={typing?.agent === a.name}
        open={popped === a.name} setOpen={(o) => setPopped((was) => (o ? a.name : was === a.name ? null : was))} pop={setPopped} hold={(on, at, text) => hold(a.name, on, at, text)} />)}
    </div>,
    document.body,
  )
}
