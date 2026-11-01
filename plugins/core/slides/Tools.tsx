// Reveal.js' plugins as Advanced Slides has them, drawn the app's way: a laser pointer (Q), ink on a slide and a board
// to write on (C, B: its chalkboard), the overview of every slide (O) and the time bar (`timeForPresentation`).
import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react"
import { Eraser, Presentation as Board, Undo2, X } from "lucide-react"
import { cn } from "@vaultite"

/** A line drawn on a slide, in its layout's px. */
export type Stroke = { color: string; pts: number[] }
export const INKS = ["red", "yellow", "blue", "green", "foreground"] as const
export type InkColor = (typeof INKS)[number]
const WIDTH = 4

const path = (pts: number[]) => pts.length < 4 ? `M${pts[0]} ${pts[1]}l0 0` : `M${pts[0]} ${pts[1]}${pts.slice(2).map((v, k) => (k % 2 ? ` ${v}` : `L${v}`)).join("")}`

/** What's been drawn on a slide (or its board), over it at its size; `pen`: drawing now, in that colour. */
export function Ink({ w, h, strokes, pen, board, onStroke }: { w: number; h: number; strokes: Stroke[]; pen: InkColor | null; board?: boolean; onStroke: (s: Stroke) => void }) {
  const [live, setLive] = useState<Stroke | null>(null)
  const at = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return [Math.round(((e.clientX - r.left) / r.width) * w * 10) / 10, Math.round(((e.clientY - r.top) / r.height) * h * 10) / 10]
  }
  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (!pen || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setLive({ color: pen, pts: at(e) })
  }
  const move = (e: PointerEvent<SVGSVGElement>) => { if (live) setLive({ ...live, pts: [...live.pts, ...at(e)] }) }
  const up = () => { if (live) onStroke(live); setLive(null) }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" data-slide-ink={board ? "board" : "slide"} data-no-nav
      className={cn("absolute inset-0 size-full overflow-visible", pen ? "cursor-crosshair touch-none" : "pointer-events-none", board && "rounded-[10px] bg-card ring-1 ring-border")}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClick={(e) => e.stopPropagation()}>
      {[...strokes, ...(live ? [live] : [])].map((s, k) => (
        <path key={k} d={path(s.pts)} fill="none" stroke={`var(--${s.color})`} strokeWidth={WIDTH} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  )
}

const tool = "grid size-9 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
const NAMES: Record<InkColor, string> = { red: "Red", yellow: "Yellow", blue: "Blue", green: "Green", foreground: "Text colour" }

/** The pen's bar while drawing: colours, undo, clear, the board, done. */
export function InkBar({ color, board, canUndo, onColor, onUndo, onClear, onBoard, onDone }: {
  color: InkColor; board: boolean; canUndo: boolean; onColor: (c: InkColor) => void; onUndo: () => void; onClear: () => void; onBoard: () => void; onDone: () => void
}) {
  return (
    <div role="toolbar" aria-label="Drawing" data-ink-bar data-no-nav onClick={(e) => e.stopPropagation()}
      className="absolute top-[max(env(safe-area-inset-top),0.5rem)] left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-popover px-1.5 py-1 text-popover-foreground shadow-lg ring-1 ring-border md:top-3">
      {INKS.map((c) => (
        <button key={c} type="button" aria-label={NAMES[c]} aria-pressed={c === color} data-tip={NAMES[c]} className={cn(tool, "size-8")} onClick={() => onColor(c)}>
          <span className={cn("size-4 rounded-full ring-offset-2 ring-offset-popover", c === color && "ring-2 ring-foreground/60")} style={{ background: `var(--${c})` }} />
        </button>
      ))}
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <button type="button" aria-label="Undo" data-tip="Undo (Z)" className={tool} disabled={!canUndo} onClick={onUndo}><Undo2 className="size-4" strokeWidth={2} /></button>
      <button type="button" aria-label="Clear" data-tip="Clear (Delete)" className={tool} disabled={!canUndo} onClick={onClear}><Eraser className="size-4" strokeWidth={2} /></button>
      <button type="button" aria-label={board ? "Back to the slide" : "Board"} aria-pressed={board} data-tip={board ? "Back to the slide (B)" : "Board (B)"} className={cn(tool, board && "text-foreground")} onClick={onBoard}>
        <Board className="size-4" strokeWidth={2} />
      </button>
      <button type="button" aria-label="Done drawing" data-tip="Done (C)" className={tool} onClick={onDone}><X className="size-4" strokeWidth={2} /></button>
    </div>
  )
}

/** A laser pointer where the mouse is over `area`, which hides its own cursor. */
export function Laser({ area }: { area: RefObject<HTMLElement | null> }) {
  const dot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = area.current
    if (!el) return
    const move = (e: globalThis.PointerEvent) => {
      const d = dot.current, r = el.getBoundingClientRect()
      if (!d) return
      d.style.opacity = "1"
      d.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`
    }
    const leave = () => { if (dot.current) dot.current.style.opacity = "0" }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerleave", leave)
    el.style.cursor = "none"
    return () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); el.style.cursor = "" }
  }, [area])
  return (
    <div ref={dot} aria-hidden data-laser className="pointer-events-none absolute top-0 left-0 z-20 opacity-0">
      <div className="-mt-2 -ml-2 size-4 rounded-full bg-[var(--red)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--red)_35%,transparent),0_0_14px_4px_color-mix(in_oklab,var(--red)_55%,transparent)]" />
    </div>
  )
}

/** Time taken against `timeForPresentation` (s), as a bar filling up over it; past the time, red. Paused with the
 *  presenter's timer. */
export function TimeBar({ total, start, paused }: { total: number; start: number; paused: number | null }) {
  const taken = ((paused ?? Date.now()) - start) / 1000
  const [over, setOver] = useState(taken >= total)
  useEffect(() => {
    setOver(taken >= total)
    if (paused !== null || taken >= total) return
    const t = setTimeout(() => setOver(true), (total - taken) * 1000)
    return () => clearTimeout(t)
  }, [total, start, paused]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="absolute inset-x-0 bottom-[3px] h-[3px]" aria-hidden data-time-bar={over ? "over" : "on"}>
      <div key={start} className={cn("h-full", over ? "bg-[var(--red)]" : "bg-foreground/25")}
        style={{ width: over ? "100%" : undefined, animation: over ? undefined : `slides-time ${total}s linear ${-taken}s both`, animationPlayState: paused === null ? "running" : "paused" }} />
    </div>
  )
}
export const TOOLS_CSS = "@keyframes slides-time { from { width: 0 } to { width: 100% } }"

/** Every slide at a glance: arrows move, Enter or a click goes there, O or Escape closes it. */
export function Overview({ n, at, label, thumb, onPick, onClose }: { n: number; at: number; label: (i: number) => string; thumb: (i: number) => ReactNode; onPick: (i: number) => void; onClose: () => void }) {
  const [sel, setSel] = useState(at)
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => { grid.current?.querySelector<HTMLElement>(`[data-overview-slide="${sel + 1}"]`)?.scrollIntoView({ block: "nearest" }) }, [sel])
  const cols = () => {
    const items = grid.current?.children
    if (!items || items.length < 2) return 1
    const top = (items[0] as HTMLElement).offsetTop
    let c = 0
    while (c < items.length && (items[c] as HTMLElement).offsetTop === top) c++
    return Math.max(1, c)
  }
  const key = (k: string) => {
    const d = k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : k === "ArrowDown" ? cols() : k === "ArrowUp" ? -cols() : 0
    if (d) { setSel((s) => Math.min(n - 1, Math.max(0, s + d))); return true }
    if (k === "Enter" || k === " ") { onPick(sel); return true }
    if (k === "o" || k === "Escape") { onClose(); return true }
    if (k === "Home" || k === "End") { setSel(k === "Home" ? 0 : n - 1); return true }
    return false
  }
  overviewKeys.current = key
  useEffect(() => () => { overviewKeys.current = null }, [])
  return (
    <div role="dialog" aria-label="All slides" data-overview data-no-nav onClick={(e) => e.stopPropagation()}
      className="absolute inset-0 z-30 overflow-y-auto bg-background/95 px-4 pt-14 pb-10 backdrop-blur-sm md:px-10">
      <div ref={grid} role="listbox" aria-label="Slides" aria-activedescendant={`overview-${sel + 1}`} className="mx-auto grid max-w-[1400px] grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-4 gap-y-5">
        {Array.from({ length: n }, (_, i) => (
          <button key={i} id={`overview-${i + 1}`} type="button" role="option" aria-selected={i === sel} aria-label={`Slide ${i + 1}: ${label(i)}`} data-overview-slide={i + 1}
            className="flex cursor-pointer flex-col gap-1.5 text-left outline-none" onClick={() => onPick(i)} onPointerEnter={() => setSel(i)}>
            <div className={cn("pointer-events-none flex w-full overflow-hidden rounded-[10px] ring-1 ring-border", i === sel && "ring-2 ring-[var(--r-link-color,var(--primary))]")}>{thumb(i)}</div>
            <span className={cn("truncate px-0.5 text-[13px] tabular-nums", i === at ? "text-foreground" : "text-muted-foreground")}>{i + 1}{label(i) ? `  ${label(i)}` : ""}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
/** The open overview's keys, for the presentation's key handler (its window's and the presenter's). */
export const overviewKeys: { current: ((key: string) => boolean) | null } = { current: null }
