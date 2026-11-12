import { useLayoutEffect, useEffect, useRef, useState } from "react"
import { History, X } from "lucide-react"
import { clock, type Rect, type RegionScene } from "../../core/desktop/clips"
import { HOLD } from "./screendraw/hold"

type Edge = "move" | "nw" | "ne" | "sw" | "se"
const BAND = 8, LEAST = 24

function dragged(r0: Rect, edge: Edge, dx: number, dy: number): Rect {
  if (edge === "move") return { ...r0, x: r0.x + dx, y: r0.y + dy }
  const left = edge === "nw" || edge === "sw", top = edge === "nw" || edge === "ne"
  const x = left ? Math.min(r0.x + dx, r0.x + r0.width - LEAST) : r0.x, y = top ? Math.min(r0.y + dy, r0.y + r0.height - LEAST) : r0.y
  const width = left ? r0.x + r0.width - x : Math.max(LEAST, r0.width + dx), height = top ? r0.y + r0.height - y : Math.max(LEAST, r0.height + dy)
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

const GAP = 8, MARGIN = 4

export function pillAt(rect: Rect, pill: { width: number; height: number }, w: number, h: number, top: number): { x: number; y: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)))
  const x = clamp(rect.x, MARGIN, w - MARGIN - pill.width), y = clamp(rect.y, top + MARGIN, h - MARGIN - pill.height)
  if (rect.y - GAP - pill.height >= top + MARGIN) return { x, y: rect.y - GAP - pill.height }
  if (rect.y + rect.height + GAP + pill.height <= h - MARGIN) return { x, y: rect.y + rect.height + GAP }
  if (rect.x + rect.width + GAP + pill.width <= w - MARGIN) return { x: rect.x + rect.width + GAP, y }
  if (rect.x - GAP - pill.width >= MARGIN) return { x: rect.x - GAP - pill.width, y }
  return { x: clamp(rect.x + GAP, MARGIN, w - MARGIN - pill.width), y: clamp(rect.y + GAP, top + MARGIN, h - MARGIN - pill.height) }
}

export function Region({ r, top, moved, act }: { r: RegionScene; top: number; moved: (rect: Rect) => void; act: (what: string) => void }) {
  const [held, setHeld] = useState<Rect | null>(null)
  const pill = useRef<HTMLDivElement>(null)
  const drag = useRef<{ edge: Edge; x: number; y: number; r0: Rect; pill?: { x: number; y: number } } | null>(null)
  const [, tick] = useState(0)
  useEffect(() => { if (!r.recording) return; const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t) }, [r.recording])
  const rect = held ?? r.rect, tint = r.recording ? "var(--red)" : `var(--${r.tint})`
  const down = (edge: Edge) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const box = pill.current?.getBoundingClientRect()
    const grip = !!box && pill.current!.contains(e.currentTarget as Node)
    drag.current = { edge, x: e.clientX, y: e.clientY, r0: rect, ...(grip ? { pill: { x: box.left - rect.x, y: box.top - rect.y } } : {}) }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const next = dragged(d.r0, d.edge, e.clientX - d.x, e.clientY - d.y)
    setHeld(next)
    moved(next)
  }
  const up = () => {
    if (!drag.current) return
    drag.current = null
    setHeld(null)
  }
  const handlers = (edge: Edge) => ({ onPointerDown: down(edge), onPointerMove: move, onPointerUp: up, onPointerCancel: up, ...HOLD })
  const band = (style: React.CSSProperties) => <div className="pointer-events-auto absolute cursor-move" style={style} {...handlers("move")} />
  const corner = (edge: Exclude<Edge, "move">, style: React.CSSProperties) =>
    <div className="pointer-events-auto absolute size-3 rounded-[3px] border-2 bg-white" style={{ borderColor: tint, cursor: edge === "nw" || edge === "se" ? "nwse-resize" : "nesw-resize", ...style }} {...handlers(edge)} />
  const [size, setSize] = useState({ width: 160, height: 30 })
  useLayoutEffect(() => {
    const el = pill.current
    if (!el) return
    const fit = () => setSize((s) => s.width === el.offsetWidth && s.height === el.offsetHeight ? s : { width: el.offsetWidth, height: el.offsetHeight })
    fit()
    const o = new ResizeObserver(fit)
    o.observe(el)
    return () => o.disconnect()
  }, [])
  const off = held && drag.current?.pill
  const at = off ? { x: rect.x + off.x, y: rect.y + off.y } : pillAt(rect, size, innerWidth, innerHeight, top)
  return (
    <>
    <div className="screen-in pointer-events-none fixed" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} data-region={r.recording ? "recording" : "idle"}>
      <div className={r.recording ? "absolute inset-0 rounded-[3px] border-2 region-rec" : "absolute inset-0 rounded-[3px] border-2 border-dashed"} style={{ borderColor: tint, boxShadow: "0 0 0 1px rgba(255,255,255,.55)" }} />
      {band({ left: -BAND / 2, right: -BAND / 2, top: -BAND / 2, height: BAND })}
      {band({ left: -BAND / 2, right: -BAND / 2, bottom: -BAND / 2, height: BAND })}
      {band({ top: -BAND / 2, bottom: -BAND / 2, left: -BAND / 2, width: BAND })}
      {band({ top: -BAND / 2, bottom: -BAND / 2, right: -BAND / 2, width: BAND })}
      {!r.recording && <>
        {corner("nw", { left: -6, top: -6 })}{corner("ne", { right: -6, top: -6 })}{corner("sw", { left: -6, bottom: -6 })}{corner("se", { right: -6, bottom: -6 })}
      </>}
    </div>
    <div ref={pill} data-region-pill="" className="screen-in pointer-events-auto fixed flex items-center gap-0.5 rounded-full border border-black/10 bg-background/95 p-0.5 text-[12px] font-medium whitespace-nowrap shadow-md backdrop-blur"
        style={{ left: at.x, top: at.y }} {...HOLD}>
        {r.saving ? <span className="px-2.5 py-1 text-muted-foreground">Saving…</span>
          : r.recording ? (
            <button type="button" className="flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 hover:bg-foreground/[0.07]" onClick={() => act("stop")} aria-label="Stop recording and send">
              <span className="region-dot size-2 rounded-full bg-[var(--red)]" /><span className="tabular-nums">{clock(Date.now() - r.recording)}</span><span className="text-muted-foreground">Stop</span>
            </button>
          ) : <>
            <button type="button" className="flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 hover:bg-foreground/[0.07]" onClick={() => act("record")} aria-label="Record this box">
              <span className="size-2 rounded-full bg-[var(--red)]" />Record
            </button>
            {r.replay && (
              <button type="button" className="flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 hover:bg-foreground/[0.07]" onClick={() => act("replay")} aria-label="Send the last 25 seconds of this box">
                <History className="size-3.5" />Just now
              </button>
            )}
          </>}
        {!r.saving && (
          <button type="button" className="grid size-6 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground" onClick={() => act("close")}
            aria-label={r.recording ? "Discard the recording" : "Close the box"}>
            <X className="size-3.5" />
          </button>
        )}
        <div role="button" tabIndex={-1} aria-label="Move the box"
          className="grid h-6 w-5 cursor-grab touch-none place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground active:cursor-grabbing"
          {...handlers("move")}>
          <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>{[9, 15].flatMap((x) => [5, 12, 19].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r={1.6} />))}</svg>
        </div>
      </div>
    </>
  )
}

export const REGION_STYLE = `
.region-rec { animation: region-rec 1.6s ease-in-out infinite; }
@keyframes region-rec { 50% { opacity: .55; } }
.region-dot { animation: region-rec 1s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .region-rec, .region-dot { animation: none !important; } }
`
